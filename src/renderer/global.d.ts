import type { DemoAppInfo, ExternalOpenResult } from '../shared/demo-api';

interface ElectronDemoApi {
  getAppInfo: () => Promise<DemoAppInfo>;
  openExternal: (url: string) => Promise<ExternalOpenResult>;
}

declare global {
  interface Window {
    electronDemo: ElectronDemoApi;
  }
}

export {};
