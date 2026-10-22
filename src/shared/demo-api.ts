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

/** How the window is left while the chain runs: in front, minimized to the taskbar, or hidden (as when parked in the tray). */
export type SpawnChainWindowMode = 'focused' | 'minimized' | 'hidden';

export interface SpawnChainRequest {
  /** Free-text tag copied into the report, for example "msix" or "unpackaged". */
  label?: string;
  /** The built SpawnProbe.dll (tools/spawn-probe). */
  probeDll: string;
  dotnet?: string;
  gitPath?: string;
  claudePath?: string;
  /** A git repository the git scenarios run in. */
  repo?: string;
  iterations?: number;
  /** Also send one tiny real Claude print-mode request per iteration (calls the API). */
  claudePrompt?: boolean;
  /** Only run probe scenarios whose name starts with this prefix. */
  probeOnly?: string;
  /** Keep the probe alive and idle this many seconds after its scenarios, sampling the file-system baseline. */
  probeIdleSeconds?: number;
  /** During the idle time, clear the probe's execution-speed throttling at this second. */
  probeOptOutThrottleAt?: number;
  /** Which settings that opt-out touches: a comma list of power, memory, io, background. */
  probeOptOutWhat?: string;
  /** Run the throttled-versus-opted-out comparison scenarios (use with probeOnly "compare"). */
  probeCompare?: boolean;
  /** Open the app window before measuring, so the run happens with a visible window. */
  showWindow?: boolean;
  /** With showWindow: the window state while the chain runs. Defaults to focused. */
  windowMode?: SpawnChainWindowMode;
  outFile?: string;
}

export interface SpawnChainSample {
  name: string;
  count: number;
  firstMs: number;
  minMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  error?: string;
}

export interface SpawnChainReport {
  startedAt: string;
  completedAt: string;
  label: string;
  electron: {
    isPackaged: boolean;
    windowsStore: boolean;
    execPath: string;
    pid: number;
    electronVersion: string;
    nodeVersion: string;
  };
  scenarios: SpawnChainSample[];
  dotnetProbeWallMs: number;
  /** The SpawnProbe JSON report, as the dotnet process produced it. */
  dotnetProbe: unknown;
  dotnetProbeError?: string;
}
