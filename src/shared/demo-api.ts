export type DemoPlatformId = 'linux-x64' | 'linux-arm64' | 'win-x64' | 'win-arm64' | 'osx-x64' | 'osx-arm64';

export interface DemoAppInfo {
  appName: string;
  appVersion: string;
  platform: DemoPlatformId;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  isPackaged: boolean;
  buildChannel: 'development' | 'production';
}

export interface ExternalOpenResult {
  success: boolean;
  error?: string;
}
