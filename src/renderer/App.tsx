import { startTransition, useEffect, useState } from 'react';
import type {
  DemoAppInfo,
  Pm2ActionRequest,
  Pm2CommandResult,
  Pm2EnvironmentReport,
  Pm2ProcessSummary,
  ToolInspection,
} from '../shared/demo-api';

const repoUrl = 'https://github.com/HagiCode-org/electron_demo';
const psfRepoUrl = 'https://github.com/microsoft/MSIX-PackageSupportFramework';

const validationGoals = [
  '验证 Electron 主进程是否能直接调用本机 pm2。',
  '验证 pm2 是否能管理 dotnet 服务，或先管理包内心跳脚本。',
  '验证 Windows MSIX 是否可选注入 PSF 来阻止 child process breakaway。',
];

const psfChecklist = [
  '默认构建不启用 PSF，避免影响现有 Forge 流程。',
  '设置 ELECTRON_DEMO_ENABLE_PSF=true 后，MSIX manifest 会切到 PsfLauncher64.exe。',
  '设置 ELECTRON_DEMO_PSF_DIR 后，Forge postPackage 会把 PSF 二进制和 config.json 写进打包目录根部。',
];

type FormState = {
  processName: string;
  executable: string;
  argsText: string;
  workingDirectory: string;
  pm2Home: string;
  envText: string;
  interpreter: 'default' | 'none';
  createPm2HomeAlias: boolean;
  logLines: string;
};

const initialFormState: FormState = {
  processName: 'hagicode-pm2-demo',
  executable: 'dotnet',
  argsText: '',
  workingDirectory: '',
  pm2Home: '',
  envText: '',
  interpreter: 'none',
  createPm2HomeAlias: true,
  logLines: '80',
};

function parseLineInput(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseEnvInput(value: string): { env: Record<string, string>; invalidLines: string[] } {
  const env: Record<string, string> = {};
  const invalidLines: string[] = [];

  for (const line of parseLineInput(value)) {
    const separatorIndex = line.indexOf('=');

    if (separatorIndex <= 0) {
      invalidLines.push(line);
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const nextValue = line.slice(separatorIndex + 1);

    if (!key) {
      invalidLines.push(line);
      continue;
    }

    env[key] = nextValue;
  }

  return { env, invalidLines };
}

function summarizeTool(tool?: ToolInspection): string {
  if (!tool) {
    return '加载中';
  }

  if (!tool.exists) {
    return '未找到';
  }

  const stdoutLine = tool.versionResult?.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  const stderrLine = tool.versionResult?.stderr.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return stdoutLine || stderrLine || tool.resolvedCommand || '已找到';
}

function formatBytes(value: number | null): string {
  if (!value || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatProcessAge(startedAt: number | null): string {
  if (!startedAt || startedAt <= 0) {
    return '未知';
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function renderConsole(result: Pm2CommandResult | null): string {
  if (!result) {
    return '尚未执行任何 pm2 命令。';
  }

  const parts = [
    `$ ${result.displayCommand}`,
    `ok=${String(result.ok)} exit=${String(result.exitCode)} duration=${result.durationMs}ms`,
    `pm2=${result.resolvedPm2Command || 'unresolved'}`,
    `PM2_HOME=${result.effectivePm2Home || 'n/a'}`,
  ];

  if (result.stdout) {
    parts.push('\n[stdout]\n' + result.stdout);
  }

  if (result.stderr) {
    parts.push('\n[stderr]\n' + result.stderr);
  }

  if (result.spawnError) {
    parts.push('\n[error]\n' + result.spawnError);
  }

  if (result.timedOut) {
    parts.push('\n[timeout]\nCommand exceeded the configured timeout.');
  }

  return parts.join('\n');
}

function getStatusTone(status: string): 'running' | 'stopped' | 'unknown' {
  if (status === 'online' || status === 'launching') {
    return 'running';
  }

  if (status === 'stopped' || status === 'errored') {
    return 'stopped';
  }

  return 'unknown';
}

function ProcessItem({ processItem }: { processItem: Pm2ProcessSummary }) {
  const tone = getStatusTone(processItem.status);

  return (
    <article className="process-item">
      <div className="process-row">
        <div>
          <h3>{processItem.name}</h3>
          <p>{processItem.execPath || '未记录可执行文件'}</p>
        </div>
        <span className={`status-pill ${tone}`}>{processItem.status}</span>
      </div>

      <dl className="process-meta">
        <div>
          <dt>PID</dt>
          <dd>{processItem.pid ?? 'N/A'}</dd>
        </div>
        <div>
          <dt>CPU</dt>
          <dd>{processItem.cpu == null ? 'N/A' : `${processItem.cpu.toFixed(1)}%`}</dd>
        </div>
        <div>
          <dt>内存</dt>
          <dd>{formatBytes(processItem.memory)}</dd>
        </div>
        <div>
          <dt>存活</dt>
          <dd>{formatProcessAge(processItem.uptime)}</dd>
        </div>
      </dl>

      <p className="process-footnote">
        cwd: {processItem.cwd || 'N/A'}
        {' · '}
        interpreter: {processItem.interpreter || 'default'}
      </p>
    </article>
  );
}

function App() {
  const [appInfo, setAppInfo] = useState<DemoAppInfo | null>(null);
  const [environment, setEnvironment] = useState<Pm2EnvironmentReport | null>(null);
  const [result, setResult] = useState<Pm2CommandResult | null>(null);
  const [form, setForm] = useState<FormState>(initialFormState);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  async function refreshDashboard() {
    setIsRefreshing(true);
    setLoadError(null);

    try {
      const request = {
        pm2Home: form.pm2Home.trim() || undefined,
        createPm2HomeAlias: form.createPm2HomeAlias,
      };
      const [nextAppInfo, nextEnvironment] = await Promise.all([
        window.electronDemo.getAppInfo(),
        window.electronDemo.inspectPm2Environment(request),
      ]);

      startTransition(() => {
        setAppInfo(nextAppInfo);
        setEnvironment(nextEnvironment);
        setForm((current) => ({
          ...current,
          pm2Home: current.pm2Home.trim() ? current.pm2Home : nextEnvironment.effectivePm2Home,
        }));
      });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    document.getElementById('loading-container')?.remove();
    void refreshDashboard();
  }, []);

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function applyHeartbeatPreset() {
    const nodeCommand = environment?.tools.node.resolvedCommand || 'node';
    const probeScriptPath = environment?.probeScriptPath || 'resources/pm2/heartbeat-worker.cjs';

    setForm((current) => ({
      ...current,
      processName: 'hagicode-heartbeat',
      executable: nodeCommand,
      argsText: `${probeScriptPath}\nhagicode-heartbeat\n5000`,
      workingDirectory: '',
      interpreter: 'none',
    }));
  }

  function applyDotnetPreset() {
    const dotnetCommand = environment?.tools.dotnet.resolvedCommand || 'dotnet';
    const serverPath = appInfo?.platform.startsWith('win')
      ? 'C:\\path\\to\\Your.Server.dll'
      : '/path/to/Your.Server.dll';

    setForm((current) => ({
      ...current,
      processName: 'hagicode-dotnet-server',
      executable: dotnetCommand,
      argsText: `${serverPath}\n--urls\nhttp://127.0.0.1:5078`,
      interpreter: 'none',
    }));
  }

  async function execute(action: 'start' | Pm2ActionRequest['action']) {
    setBusyAction(action);
    setActionError(null);

    try {
      const { env, invalidLines } = parseEnvInput(form.envText);

      if (invalidLines.length > 0) {
        throw new Error(`环境变量格式错误：${invalidLines.join('，')}。请输入 KEY=VALUE。`);
      }

      let nextResult: Pm2CommandResult;

      if (action === 'start') {
        nextResult = await window.electronDemo.startPm2Process({
          name: form.processName.trim(),
          executable: form.executable.trim(),
          args: parseLineInput(form.argsText),
          cwd: form.workingDirectory.trim() || undefined,
          pm2Home: form.pm2Home.trim() || undefined,
          env,
          interpreter: form.interpreter,
          createPm2HomeAlias: form.createPm2HomeAlias,
        });
      } else {
        nextResult = await window.electronDemo.runPm2Action({
          action,
          name: form.processName.trim() || undefined,
          lines: Number(form.logLines) || 80,
          pm2Home: form.pm2Home.trim() || undefined,
          env,
          createPm2HomeAlias: form.createPm2HomeAlias,
        });
      }

      startTransition(() => {
        setResult(nextResult);
      });

      await refreshDashboard();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }

  const currentProcesses = environment?.processes || [];

  return (
    <main className="shell">
      <section className="hero surface">
        <div className="hero-copy">
          <p className="eyebrow">PM2 + PSF Validation Lab</p>
          <h1>在 Electron demo 里直接验证本机 pm2 与 MSIX PSF 方案。</h1>
          <p className="hero-text">
            这个页面不是展示页，而是一个实验台：它从 Electron 主进程发起本地进程调用，允许你检查 `pm2`
            是否可见、是否能管理 dotnet 服务，以及当前包是否具备 PSF 注入证据。
          </p>

          <div className="hero-actions">
            <button type="button" className="primary-button" onClick={() => void refreshDashboard()} disabled={isRefreshing}>
              {isRefreshing ? '刷新中...' : '刷新环境'}
            </button>
            <button type="button" className="secondary-button" onClick={() => void window.electronDemo.openExternal(repoUrl)}>
              打开仓库
            </button>
            <button type="button" className="secondary-button" onClick={() => void window.electronDemo.openExternal(psfRepoUrl)}>
              打开 PSF 仓库
            </button>
          </div>
        </div>

        <div className="hero-side">
          <div className="hero-stat">
            <span>运行模式</span>
            <strong>{appInfo ? `${appInfo.buildChannel} / packaged=${String(appInfo.isPackaged)}` : '加载中'}</strong>
          </div>
          <div className="hero-stat">
            <span>平台</span>
            <strong>{appInfo?.platform || '加载中'}</strong>
          </div>
          <div className="hero-stat">
            <span>版本</span>
            <strong>{appInfo ? `${appInfo.electronVersion} / Node ${appInfo.nodeVersion}` : '加载中'}</strong>
          </div>
        </div>
      </section>

      <section className="dashboard-grid">
        <article className="surface section-card">
          <div className="section-head">
            <div>
              <p className="section-kicker">Validation Scope</p>
              <h2>本次要验证什么</h2>
            </div>
          </div>
          <ul className="clean-list">
            {validationGoals.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {loadError ? <p className="error-text">环境读取失败：{loadError}</p> : null}
          {actionError ? <p className="error-text">命令执行失败：{actionError}</p> : null}
        </article>

        <article className="surface section-card">
          <div className="section-head">
            <div>
              <p className="section-kicker">Tooling</p>
              <h2>本机工具探测</h2>
            </div>
            <span className="hint-text">PATH 预览 {environment?.pathEntries.length || 0} 项</span>
          </div>

          <div className="tool-grid">
            {(['pm2', 'dotnet', 'node'] as const).map((toolKey) => {
              const tool = environment?.tools[toolKey];

              return (
                <article className="tool-card" key={toolKey}>
                  <div className="tool-row">
                    <h3>{toolKey}</h3>
                    <span className={`status-pill ${tool?.exists ? 'running' : 'stopped'}`}>
                      {tool?.exists ? '可用' : '未找到'}
                    </span>
                  </div>
                  <p>{summarizeTool(tool)}</p>
                  <code>{tool?.resolvedCommand || 'not found on PATH'}</code>
                </article>
              );
            })}
          </div>

          <div className="path-stack">
            <div>
              <span>exe</span>
              <code>{environment?.executablePath || '加载中'}</code>
            </div>
            <div>
              <span>resources</span>
              <code>{environment?.resourcesPath || '加载中'}</code>
            </div>
            <div>
              <span>PM2_HOME</span>
              <code>{environment?.effectivePm2Home || '加载中'}</code>
            </div>
          </div>
        </article>

        <article className="surface section-card span-two">
          <div className="section-head">
            <div>
              <p className="section-kicker">Service Lab</p>
              <h2>pm2 服务操作</h2>
            </div>
            <div className="inline-actions">
              <button type="button" className="ghost-button" onClick={applyHeartbeatPreset}>填充心跳脚本示例</button>
              <button type="button" className="ghost-button" onClick={applyDotnetPreset}>填充 .NET Server 示例</button>
            </div>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>进程名</span>
              <input value={form.processName} onChange={(event) => updateForm('processName', event.target.value)} />
            </label>
            <label className="field">
              <span>可执行文件</span>
              <input value={form.executable} onChange={(event) => updateForm('executable', event.target.value)} />
            </label>
            <label className="field span-two">
              <span>工作目录</span>
              <input
                placeholder="留空则使用当前进程默认 cwd"
                value={form.workingDirectory}
                onChange={(event) => updateForm('workingDirectory', event.target.value)}
              />
            </label>
            <label className="field span-two">
              <span>PM2_HOME</span>
              <input value={form.pm2Home} onChange={(event) => updateForm('pm2Home', event.target.value)} />
            </label>
            <label className="field span-two">
              <span>参数列表（每行一个）</span>
              <textarea
                rows={6}
                placeholder="例如：\nC:\\path\\to\\Your.Server.dll\n--urls\nhttp://127.0.0.1:5078"
                value={form.argsText}
                onChange={(event) => updateForm('argsText', event.target.value)}
              />
            </label>
            <label className="field span-two">
              <span>环境变量（KEY=VALUE，每行一个）</span>
              <textarea
                rows={5}
                placeholder="ASPNETCORE_ENVIRONMENT=Development\nDOTNET_PRINT_TELEMETRY_MESSAGE=false"
                value={form.envText}
                onChange={(event) => updateForm('envText', event.target.value)}
              />
            </label>
          </div>

          <div className="toggle-row">
            <label className="toggle-item">
              <input
                type="checkbox"
                checked={form.createPm2HomeAlias}
                onChange={(event) => updateForm('createPm2HomeAlias', event.target.checked)}
              />
              <span>PM2_HOME 含空格时创建无空格别名</span>
            </label>

            <label className="toggle-item select-item">
              <span>interpreter</span>
              <select value={form.interpreter} onChange={(event) => updateForm('interpreter', event.target.value as FormState['interpreter'])}>
                <option value="none">none</option>
                <option value="default">default</option>
              </select>
            </label>

            <label className="toggle-item select-item">
              <span>日志行数</span>
              <input value={form.logLines} onChange={(event) => updateForm('logLines', event.target.value)} />
            </label>
          </div>

          <div className="action-grid">
            <button type="button" className="primary-button" onClick={() => void execute('start')} disabled={busyAction !== null}>
              {busyAction === 'start' ? '启动中...' : 'pm2 start'}
            </button>
            <button type="button" className="secondary-button" onClick={() => void execute('restart')} disabled={busyAction !== null}>
              restart
            </button>
            <button type="button" className="secondary-button" onClick={() => void execute('stop')} disabled={busyAction !== null}>
              stop
            </button>
            <button type="button" className="secondary-button" onClick={() => void execute('delete')} disabled={busyAction !== null}>
              delete
            </button>
            <button type="button" className="secondary-button" onClick={() => void execute('describe')} disabled={busyAction !== null}>
              describe
            </button>
            <button type="button" className="secondary-button" onClick={() => void execute('logs')} disabled={busyAction !== null}>
              logs
            </button>
            <button type="button" className="secondary-button" onClick={() => void execute('list')} disabled={busyAction !== null}>
              jlist
            </button>
            <button type="button" className="secondary-button" onClick={() => void execute('ping')} disabled={busyAction !== null}>
              ping
            </button>
          </div>
        </article>

        <article className="surface section-card">
          <div className="section-head">
            <div>
              <p className="section-kicker">Managed Processes</p>
              <h2>当前 pm2 进程</h2>
            </div>
            <span className="hint-text">{currentProcesses.length} 项</span>
          </div>

          {currentProcesses.length > 0 ? (
            <div className="process-grid">
              {currentProcesses.map((processItem) => (
                <ProcessItem key={`${processItem.id ?? 'na'}-${processItem.name}`} processItem={processItem} />
              ))}
            </div>
          ) : (
            <p className="empty-copy">当前 PM2_HOME 下没有读取到进程，可以先用“心跳脚本示例”验证 Electron 到 pm2 的调用链。</p>
          )}
        </article>

        <article className="surface section-card">
          <div className="section-head">
            <div>
              <p className="section-kicker">Command Output</p>
              <h2>最近一次执行结果</h2>
            </div>
          </div>

          <pre className="console-panel">{renderConsole(result)}</pre>
        </article>

        <article className="surface section-card span-two">
          <div className="section-head">
            <div>
              <p className="section-kicker">PSF / MSIX</p>
              <h2>PSF 方案与运行证据</h2>
            </div>
          </div>

          <div className="psf-grid">
            <div>
              <h3>集成策略</h3>
              <ul className="clean-list compact">
                {psfChecklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3>运行时证据</h3>
              <dl className="path-stack path-stack-tight">
                <div>
                  <span>launcher</span>
                  <code>{environment?.psf.expectedLauncherName || 'N/A'}</code>
                </div>
                <div>
                  <span>config.json</span>
                  <code>{environment?.psf.runtimeConfigPath || '加载中'}</code>
                </div>
                <div>
                  <span>检测结果</span>
                  <code>
                    {environment
                      ? `launcher=${String(environment.psf.detectedLauncher)} / config=${String(environment.psf.runtimeConfigExists)}`
                      : '加载中'}
                  </code>
                </div>
                <div>
                  <span>包内入口</span>
                  <code>{environment?.psf.packageEntryExecutable || '加载中'}</code>
                </div>
                <div>
                  <span>模板路径</span>
                  <code>{environment?.psf.templatePath || '加载中'}</code>
                </div>
              </dl>
              <p className="hint-block">{environment?.psf.note || '加载中'}</p>
            </div>
          </div>
        </article>
      </section>
    </main>
  );
}

export default App;
