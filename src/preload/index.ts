import { contextBridge, ipcRenderer } from 'electron';
import type {
  DemoAppInfo,
  DemoEnvironmentRequest,
  ExternalOpenResult,
  Pm2ActionRequest,
  Pm2CommandResult,
  Pm2EnvironmentReport,
  Pm2StartRequest,
} from '../shared/demo-api.js';

const electronDemo = {
  getAppInfo: () => ipcRenderer.invoke('demo:get-app-info') as Promise<DemoAppInfo>,
  inspectPm2Environment: (request?: DemoEnvironmentRequest) => ipcRenderer.invoke(
    'demo:inspect-pm2-environment',
    request,
  ) as Promise<Pm2EnvironmentReport>,
  startPm2Process: (request: Pm2StartRequest) => ipcRenderer.invoke(
    'demo:start-pm2-process',
    request,
  ) as Promise<Pm2CommandResult>,
  runPm2Action: (request: Pm2ActionRequest) => ipcRenderer.invoke(
    'demo:run-pm2-action',
    request,
  ) as Promise<Pm2CommandResult>,
  openExternal: (url: string) => ipcRenderer.invoke('demo:open-external', url) as Promise<ExternalOpenResult>,
};

contextBridge.exposeInMainWorld('electronDemo', electronDemo);

export type ElectronDemoApi = typeof electronDemo;
