import type {
  DemoAppInfo,
  DemoEnvironmentRequest,
  ExternalOpenResult,
  Pm2ActionRequest,
  Pm2CommandResult,
  Pm2EnvironmentReport,
  Pm2StartRequest,
} from '../shared/demo-api';

interface ElectronDemoApi {
  getAppInfo: () => Promise<DemoAppInfo>;
  inspectPm2Environment: (request?: DemoEnvironmentRequest) => Promise<Pm2EnvironmentReport>;
  startPm2Process: (request: Pm2StartRequest) => Promise<Pm2CommandResult>;
  runPm2Action: (request: Pm2ActionRequest) => Promise<Pm2CommandResult>;
  openExternal: (url: string) => Promise<ExternalOpenResult>;
}

declare global {
  interface Window {
    electronDemo: ElectronDemoApi;
  }
}

export {};
