import { contextBridge, ipcRenderer } from 'electron';
import type { DemoAppInfo, ExternalOpenResult } from '../shared/demo-api.js';

const electronDemo = {
  getAppInfo: () => ipcRenderer.invoke('demo:get-app-info') as Promise<DemoAppInfo>,
  openExternal: (url: string) => ipcRenderer.invoke('demo:open-external', url) as Promise<ExternalOpenResult>,
};

contextBridge.exposeInMainWorld('electronDemo', electronDemo);

export type ElectronDemoApi = typeof electronDemo;
