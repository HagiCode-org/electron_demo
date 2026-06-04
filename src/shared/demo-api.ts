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

export interface DemoEnvironmentRequest {
  pm2Home?: string;
  createPm2HomeAlias?: boolean;
}

export interface DemoCommandResult {
  ok: boolean;
  command: string;
  args: string[];
  displayCommand: string;
  cwd: string | null;
  durationMs: number;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  completedAt: string;
  spawnError?: string;
  timedOut?: boolean;
}

export interface ToolInspection {
  label: 'pm2' | 'dotnet' | 'node';
  exists: boolean;
  resolvedCommand: string | null;
  versionCommand: string | null;
  versionResult: DemoCommandResult | null;
}

export interface Pm2ProcessSummary {
  id: number | null;
  name: string;
  status: string;
  pid: number | null;
  cpu: number | null;
  memory: number | null;
  uptime: number | null;
  interpreter: string | null;
  execPath: string | null;
  cwd: string | null;
}

export interface PsfRuntimeInfo {
  expectedLauncherName: string | null;
  runtimeExecutablePath: string;
  runtimeConfigPath: string;
  runtimeConfigExists: boolean;
  detectedLauncher: boolean;
  buildFlagEnabled: boolean;
  buildSourceDirectory: string | null;
  templatePath: string;
  packageEntryExecutable: string;
  note: string;
}

export interface Pm2CommandResult extends DemoCommandResult {
  effectivePm2Home: string | null;
  resolvedPm2Command: string | null;
  processes?: Pm2ProcessSummary[];
}

export interface Pm2EnvironmentReport {
  currentWorkingDirectory: string;
  executablePath: string;
  resourcesPath: string;
  userDataPath: string;
  homePath: string;
  pathEntries: string[];
  requestedPm2Home: string | null;
  effectivePm2Home: string;
  probeScriptPath: string;
  tools: {
    pm2: ToolInspection;
    dotnet: ToolInspection;
    node: ToolInspection;
  };
  pm2Ping: Pm2CommandResult | null;
  pm2List: Pm2CommandResult | null;
  processes: Pm2ProcessSummary[];
  psf: PsfRuntimeInfo;
}

export interface Pm2StartRequest {
  name: string;
  executable: string;
  args?: string[];
  cwd?: string;
  pm2Home?: string;
  env?: Record<string, string>;
  interpreter?: 'default' | 'none';
  createPm2HomeAlias?: boolean;
}

export interface Pm2ActionRequest {
  action: 'ping' | 'list' | 'describe' | 'logs' | 'stop' | 'restart' | 'delete';
  name?: string;
  lines?: number;
  pm2Home?: string;
  env?: Record<string, string>;
  createPm2HomeAlias?: boolean;
}
