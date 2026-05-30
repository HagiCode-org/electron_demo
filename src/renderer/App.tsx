import { useEffect, useState } from 'react';
import type { DemoAppInfo } from '../shared/demo-api';

const repoUrl = 'https://github.com/HagiCode-org/electron_demo';

const checks = [
  '保留 Electron 三段式结构：main / preload / renderer',
  '保留基于 Vite 的 renderer 与 preload 构建',
  '保留 Electron Forge 多平台打包入口',
  '保留 GitHub Actions 的 PR 校验与 build/release 通道',
];

function App() {
  const [appInfo, setAppInfo] = useState<DemoAppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function loadAppInfo() {
    setIsRefreshing(true);
    setError(null);

    try {
      const nextInfo = await window.electronDemo.getAppInfo();
      setAppInfo(nextInfo);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    document.getElementById('loading-container')?.remove();
    void loadAppInfo();
  }, []);

  return (
    <main className="shell">
      <section className="hero card">
        <p className="eyebrow">HagiCode Electron Demo</p>
        <h1>最小可发布 Electron 应用</h1>
        <p className="hero-copy">
          这个仓库只保留未来 GitHub Actions 打包验证真正需要的骨架：Electron 主进程、preload 桥接、React 首页、
          Electron Forge 配置，以及 Linux / Windows / macOS 的发布构建路径。
        </p>

        <div className="hero-actions">
          <button className="primary-button" type="button" onClick={() => void loadAppInfo()} disabled={isRefreshing}>
            {isRefreshing ? '刷新中...' : '刷新应用信息'}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void window.electronDemo.openExternal(repoUrl)}
          >
            打开仓库
          </button>
        </div>
      </section>

      <section className="grid">
        <article className="card info-card">
          <h2>运行信息</h2>
          {error ? <p className="error-text">读取应用信息失败：{error}</p> : null}
          <dl className="info-list">
            <div>
              <dt>名称</dt>
              <dd>{appInfo?.appName ?? '加载中'}</dd>
            </div>
            <div>
              <dt>版本</dt>
              <dd>{appInfo?.appVersion ?? '加载中'}</dd>
            </div>
            <div>
              <dt>平台标识</dt>
              <dd>{appInfo?.platform ?? '加载中'}</dd>
            </div>
            <div>
              <dt>运行模式</dt>
              <dd>{appInfo ? `${appInfo.buildChannel} / packaged=${String(appInfo.isPackaged)}` : '加载中'}</dd>
            </div>
            <div>
              <dt>Electron / Chrome / Node</dt>
              <dd>
                {appInfo
                  ? `${appInfo.electronVersion} / ${appInfo.chromeVersion} / ${appInfo.nodeVersion}`
                  : '加载中'}
              </dd>
            </div>
          </dl>
        </article>

        <article className="card checklist-card">
          <h2>这个 demo 验证什么</h2>
          <ul>
            {checks.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}

export default App;
