import { app } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type {
  DemoCommandResult,
  DemoEnvironmentRequest,
  Pm2ActionRequest,
  Pm2CommandResult,
  Pm2EnvironmentReport,
  Pm2ProcessSummary,
  Pm2StartRequest,
  PsfRuntimeInfo,
  ToolInspection,
} from '../shared/demo-api.js';
import { ensurePm2HomeAlias } from './pm2-home-alias.js';

const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;
const MSIX_EXECUTABLE_NAME = 'electron-demo';

interface RunCommandOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

interface ResolvedCommand {
  candidate: string;
  resolvedPath: string;
}

function quoteForDisplay(value: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(quoteForDisplay).join(' ');
}

function normalizeLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function shouldUseShell(command: string): boolean {
  if (process.platform !== 'win32') {
    return false;
  }

  return /(?:\.cmd|\.bat)$/i.test(command) || !command.includes(path.sep);
}

function getLookupBinary(): string {
  return process.platform === 'win32' ? 'where' : 'which';
}

function getDefaultPm2Home(): string {
  return path.join(app.getPath('userData'), 'pm2-lab');
}

function getProbeScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'pm2', 'heartbeat-worker.cjs');
  }

  return path.resolve(process.cwd(), 'resources', 'pm2', 'heartbeat-worker.cjs');
}

function getPsfTemplatePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'psf', 'config.template.json');
  }

  return path.resolve(process.cwd(), 'resources', 'psf', 'config.template.json');
}

function getExpectedPsfLauncherName(): string | null {
  if (process.platform !== 'win32') {
    return null;
  }

  return 'PsfLauncher64.exe';
}

function parsePm2Processes(stdout: string): Pm2ProcessSummary[] {
  try {
    const items = JSON.parse(stdout) as Array<Record<string, unknown>>;

    if (!Array.isArray(items)) {
      return [];
    }

    return items.map((item) => {
      const env = (item.pm2_env && typeof item.pm2_env === 'object' ? item.pm2_env : {}) as Record<string, unknown>;
      const monit = (item.monit && typeof item.monit === 'object' ? item.monit : {}) as Record<string, unknown>;

      return {
        id: typeof item.pm_id === 'number' ? item.pm_id : null,
        name: typeof item.name === 'string' ? item.name : 'unknown',
        status: typeof env.status === 'string' ? env.status : 'unknown',
        pid: typeof item.pid === 'number' ? item.pid : null,
        cpu: typeof monit.cpu === 'number' ? monit.cpu : null,
        memory: typeof monit.memory === 'number' ? monit.memory : null,
        uptime: typeof env.pm_uptime === 'number' ? env.pm_uptime : null,
        interpreter: typeof env.exec_interpreter === 'string' ? env.exec_interpreter : null,
        execPath: typeof env.pm_exec_path === 'string' ? env.pm_exec_path : null,
        cwd: typeof env.pm_cwd === 'string' ? env.pm_cwd : null,
      };
    });
  } catch {
    return [];
  }
}

function toProcessEnv(extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(extraEnv || {}),
    FORCE_COLOR: '0',
  };
}

async function runCommand(options: RunCommandOptions): Promise<DemoCommandResult> {
  const args = options.args || [];
  const startedAt = new Date().toISOString();
  const started = Date.now();

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let spawnError: string | undefined;
    let timedOut = false;

    const child = spawn(options.command, args, {
      cwd: options.cwd || undefined,
      env: options.env,
      shell: shouldUseShell(options.command),
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      spawnError = error.message;
    });

    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);

      resolve({
        ok: exitCode === 0 && !spawnError && !timedOut,
        command: options.command,
        args,
        displayCommand: formatCommand(options.command, args),
        cwd: options.cwd || null,
        durationMs: Date.now() - started,
        exitCode,
        signal,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        startedAt,
        completedAt: new Date().toISOString(),
        ...(spawnError ? { spawnError } : {}),
        ...(timedOut ? { timedOut: true } : {}),
      });
    });
  });
}

async function resolveCommand(candidates: string[]): Promise<ResolvedCommand | null> {
  const uniqueCandidates = [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))];

  for (const candidate of uniqueCandidates) {
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) {
      return {
        candidate,
        resolvedPath: candidate,
      };
    }

    const lookup = await runCommand({
      command: getLookupBinary(),
      args: [candidate],
      env: process.env,
      timeoutMs: 4_000,
    });
    const [firstMatch] = normalizeLines(lookup.stdout);

    if (lookup.ok && firstMatch) {
      return {
        candidate,
        resolvedPath: firstMatch,
      };
    }
  }

  return null;
}

function getPm2Candidates(): string[] {
  const override = String(process.env.ELECTRON_DEMO_PM2_COMMAND || '').trim();

  if (override) {
    return [override];
  }

  return process.platform === 'win32'
    ? ['pm2.cmd', 'pm2.exe', 'pm2']
    : ['pm2'];
}

function getNodeCandidates(): string[] {
  const override = String(process.env.ELECTRON_DEMO_NODE_COMMAND || '').trim();

  if (override) {
    return [override];
  }

  return process.platform === 'win32'
    ? ['node.exe', 'node']
    : ['node'];
}

function getDotnetCandidates(): string[] {
  const override = String(process.env.ELECTRON_DEMO_DOTNET_COMMAND || '').trim();

  if (override) {
    return [override];
  }

  return process.platform === 'win32'
    ? ['dotnet.exe', 'dotnet']
    : ['dotnet'];
}

async function inspectTool(input: {
  label: ToolInspection['label'];
  candidates: string[];
  versionArgs: string[];
}): Promise<ToolInspection> {
  const resolved = await resolveCommand(input.candidates);

  if (!resolved) {
    return {
      label: input.label,
      exists: false,
      resolvedCommand: null,
      versionCommand: null,
      versionResult: null,
    };
  }

  const versionResult = await runCommand({
    command: resolved.candidate,
    args: input.versionArgs,
    env: process.env,
    timeoutMs: 8_000,
  });

  return {
    label: input.label,
    exists: true,
    resolvedCommand: resolved.resolvedPath,
    versionCommand: resolved.candidate,
    versionResult,
  };
}

async function resolveEffectivePm2Home(input: DemoEnvironmentRequest | Pm2ActionRequest | Pm2StartRequest): Promise<string> {
  const candidate = String(input.pm2Home || '').trim() || getDefaultPm2Home();

  if (input.createPm2HomeAlias) {
    return ensurePm2HomeAlias(candidate, 'electron-demo-pm2-lab');
  }

  fs.mkdirSync(candidate, { recursive: true });
  return candidate;
}

function getPsfRuntimeInfo(): PsfRuntimeInfo {
  const expectedLauncherName = getExpectedPsfLauncherName();
  const runtimeConfigPath = path.join(path.dirname(process.execPath), 'config.json');
  const runtimeExecutableName = path.basename(process.execPath).toLowerCase();

  return {
    expectedLauncherName,
    runtimeExecutablePath: process.execPath,
    runtimeConfigPath,
    runtimeConfigExists: fs.existsSync(runtimeConfigPath),
    detectedLauncher: runtimeExecutableName.startsWith('psflauncher'),
    buildFlagEnabled: String(process.env.ELECTRON_DEMO_ENABLE_PSF || '').trim().toLowerCase() === 'true',
    buildSourceDirectory: String(process.env.ELECTRON_DEMO_PSF_DIR || '').trim() || null,
    templatePath: getPsfTemplatePath(),
    packageEntryExecutable: `app\\${MSIX_EXECUTABLE_NAME}.exe`,
    note: 'PSF 验证针对 Windows x64 MSIX；启用后 manifest 入口会改为 PsfLauncher64.exe，并在打包输出根目录写入 config.json。',
  };
}

async function runPm2Command(args: string[], input: {
  pm2Home?: string;
  env?: Record<string, string>;
  createPm2HomeAlias?: boolean;
}): Promise<Pm2CommandResult> {
  const effectivePm2Home = await resolveEffectivePm2Home(input);
  const resolvedPm2 = await resolveCommand(getPm2Candidates());

  if (!resolvedPm2) {
    return {
      ok: false,
      command: 'pm2',
      args,
      displayCommand: formatCommand('pm2', args),
      cwd: null,
      durationMs: 0,
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: '',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      spawnError: 'pm2 was not found on PATH. Install pm2 globally or set ELECTRON_DEMO_PM2_COMMAND.',
      effectivePm2Home,
      resolvedPm2Command: null,
    };
  }

  const result = await runCommand({
    command: resolvedPm2.candidate,
    args,
    env: {
      ...toProcessEnv(input.env),
      PM2_HOME: effectivePm2Home,
    },
  });

  const processes = args[0] === 'jlist' && result.stdout ? parsePm2Processes(result.stdout) : undefined;

  return {
    ...result,
    effectivePm2Home,
    resolvedPm2Command: resolvedPm2.resolvedPath,
    ...(processes ? { processes } : {}),
  };
}

export async function inspectPm2Environment(request: DemoEnvironmentRequest = {}): Promise<Pm2EnvironmentReport> {
  const [pm2, dotnet, node] = await Promise.all([
    inspectTool({ label: 'pm2', candidates: getPm2Candidates(), versionArgs: ['-v'] }),
    inspectTool({ label: 'dotnet', candidates: getDotnetCandidates(), versionArgs: ['--version'] }),
    inspectTool({ label: 'node', candidates: getNodeCandidates(), versionArgs: ['--version'] }),
  ]);
  const effectivePm2Home = await resolveEffectivePm2Home(request);
  const [pm2Ping, pm2List] = pm2.exists
    ? await Promise.all([
      runPm2Command(['ping'], request),
      runPm2Command(['jlist'], request),
    ])
    : [null, null];

  return {
    currentWorkingDirectory: process.cwd(),
    executablePath: process.execPath,
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath('userData'),
    homePath: app.getPath('home'),
    pathEntries: String(process.env.PATH || '')
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean),
    requestedPm2Home: String(request.pm2Home || '').trim() || null,
    effectivePm2Home,
    probeScriptPath: getProbeScriptPath(),
    tools: {
      pm2,
      dotnet,
      node,
    },
    pm2Ping,
    pm2List,
    processes: pm2List?.processes || [],
    psf: getPsfRuntimeInfo(),
  };
}

export async function startPm2Process(request: Pm2StartRequest): Promise<Pm2CommandResult> {
  const name = request.name.trim();
  const executable = request.executable.trim();

  if (!name) {
    throw new Error('Process name is required.');
  }

  if (!executable) {
    throw new Error('Executable is required.');
  }

  const args = ['start', executable, '--name', name];

  if (request.cwd?.trim()) {
    args.push('--cwd', request.cwd.trim());
  }

  if (request.interpreter === 'none') {
    args.push('--interpreter', 'none');
  }

  const normalizedArgs = (request.args || []).map((value) => value.trim()).filter(Boolean);

  if (normalizedArgs.length > 0) {
    args.push('--', ...normalizedArgs);
  }

  return runPm2Command(args, request);
}

export async function runPm2Action(request: Pm2ActionRequest): Promise<Pm2CommandResult> {
  switch (request.action) {
    case 'ping':
      return runPm2Command(['ping'], request);
    case 'list':
      return runPm2Command(['jlist'], request);
    case 'describe':
      if (!request.name?.trim()) {
        throw new Error('Process name is required for describe.');
      }
      return runPm2Command(['describe', request.name.trim()], request);
    case 'logs':
      if (!request.name?.trim()) {
        throw new Error('Process name is required for logs.');
      }
      return runPm2Command([
        'logs',
        request.name.trim(),
        '--nostream',
        '--lines',
        String(Math.max(1, request.lines || 80)),
      ], request);
    case 'stop':
    case 'restart':
    case 'delete':
      if (!request.name?.trim()) {
        throw new Error(`Process name is required for ${request.action}.`);
      }
      return runPm2Command([request.action, request.name.trim()], request);
    default:
      throw new Error(`Unsupported pm2 action: ${request.action}`);
  }
}
