import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DemoAppInfo, DemoPlatformId, ExternalOpenResult } from '../shared/demo-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_RENDERER_HOST = '127.0.0.1';
const DEV_RENDERER_PORT = 36598;
const DEV_RENDERER_URL = `http://${DEV_RENDERER_HOST}:${DEV_RENDERER_PORT}`;

let mainWindow: BrowserWindow | null = null;

function resolvePlatformId(platform: NodeJS.Platform, arch: string): DemoPlatformId {
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'osx-arm64' : 'osx-x64';
  }

  if (platform === 'win32') {
    return arch === 'arm64' ? 'win-arm64' : 'win-x64';
  }

  return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
}

function getDistRootPath(): string {
  return path.resolve(__dirname, '..');
}

function getRendererEntryPath(): string {
  return path.join(getDistRootPath(), 'renderer', 'index.html');
}

function getPreloadPath(): string {
  return path.join(getDistRootPath(), 'preload', 'index.mjs');
}

function getWindowIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icon.png');
  }

  return path.resolve(process.cwd(), 'resources', 'icon.png');
}

function isDevServerEnabled(): boolean {
  return process.env.NODE_ENV === 'development';
}

function createAppInfo(): DemoAppInfo {
  return {
    appName: app.getName(),
    appVersion: app.getVersion(),
    platform: resolvePlatformId(process.platform, process.arch),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    isPackaged: app.isPackaged,
    buildChannel: isDevServerEnabled() ? 'development' : 'production',
  };
}

function registerIpcHandlers(): void {
  ipcMain.handle('demo:get-app-info', () => createAppInfo());
  ipcMain.handle('demo:open-external', async (_event, url: string): Promise<ExternalOpenResult> => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#09111f',
    autoHideMenuBar: true,
    title: 'HagiCode Electron Demo',
    icon: getWindowIconPath(),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDevServerEnabled()) {
    await mainWindow.loadURL(DEV_RENDERER_URL);
    return;
  }

  await mainWindow.loadFile(getRendererEntryPath());
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    registerIpcHandlers();
    await createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow();
      }
    });
  }).catch((error) => {
    console.error('[main] failed to initialize electron demo', error);
    app.exit(1);
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
