import { app } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  SpawnChainReport,
  SpawnChainRequest,
  SpawnChainSample,
} from '../shared/demo-api.js';

const DEFAULT_ITERATIONS = 20;
const DEFAULT_TIMEOUT_MS = 120_000;

interface SpawnOutcome {
  ms: number;
  exitCode: number | null;
  stdout: string;
  error?: string;
}

function getDefaultRequestPath(): string {
  return process.env.HAGICODE_SPAWN_CHAIN_REQUEST
    || path.join(os.homedir(), 'win_tester_logs', 'spawn-chain', 'request.json');
}

function readRequest(requestPath: string): SpawnChainRequest | null {
  if (!fs.existsSync(requestPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(requestPath, 'utf8')) as SpawnChainRequest;
}

function spawnOnce(command: string, args: string[], cwd?: string): Promise<SpawnOutcome> {
  const started = performance.now();

  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const finish = (outcome: Omit<SpawnOutcome, 'ms'>) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve({ ms: performance.now() - started, ...outcome });
    };

    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill();
      finish({ exitCode: null, stdout, error: 'timed out' });
    }, DEFAULT_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', () => undefined);
    child.on('error', (error) => finish({ exitCode: null, stdout, error: error.message }));
    child.on('close', (code) => finish({ exitCode: code, stdout }));
  });
}

function summarize(name: string, samples: number[], error?: string): SpawnChainSample {
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (value: number | undefined) => (value === undefined ? 0 : Math.round(value * 10) / 10);

  return {
    name,
    count: samples.length,
    firstMs: round(samples[0]),
    minMs: round(sorted[0]),
    medianMs: round(sorted[Math.floor(sorted.length / 2)]),
    p95Ms: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]),
    maxMs: round(sorted[sorted.length - 1]),
    ...(error ? { error } : {}),
  };
}

async function measure(name: string, iterations: number, run: () => Promise<SpawnOutcome>): Promise<SpawnChainSample> {
  const samples: number[] = [];
  let error: string | undefined;

  for (let index = 0; index < iterations; index += 1) {
    const outcome = await run();
    samples.push(outcome.ms);
    error = error || outcome.error;
  }

  return summarize(name, samples, error);
}

function measureSync(name: string, iterations: number, run: () => void): SpawnChainSample {
  const samples: number[] = [];

  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    run();
    samples.push(performance.now() - started);
  }

  return summarize(name, samples);
}

/**
 * Times the Electron -> dotnet -> (git, claude) chain the desktop app uses.
 * Electron measures its own direct launches and how long the dotnet host takes to come up, then lets the dotnet probe
 * time git and claude from inside the .NET process, which is where the backend spawns them.
 */
export async function runSpawnChain(request: SpawnChainRequest): Promise<SpawnChainReport> {
  const iterations = request.iterations ?? DEFAULT_ITERATIONS;
  const dotnet = request.dotnet || 'dotnet';
  const scenarios: SpawnChainSample[] = [];
  const startedAt = new Date().toISOString();

  // The same file-system probes the .NET resolver makes, from the Electron main process itself.
  const presentPath = process.execPath;
  const missingPath = path.join(path.dirname(process.execPath), 'hagicode-probe-missing.exe');
  scenarios.push(measureSync('electron.fs-exists-hit-x100', iterations, () => { for (let i = 0; i < 100; i += 1) { fs.existsSync(presentPath); } }));
  scenarios.push(measureSync('electron.fs-exists-missing-x100', iterations, () => { for (let i = 0; i < 100; i += 1) { fs.existsSync(missingPath); } }));

  if (request.gitPath) {
    scenarios.push(await measure('electron.git-version', iterations, () => spawnOnce(request.gitPath!, ['--version'])));

    if (request.repo) {
      scenarios.push(await measure('electron.git-status', iterations, () => spawnOnce(request.gitPath!, ['status', '--porcelain=v2', '--branch'], request.repo)));
    }
  }

  if (request.claudePath) {
    scenarios.push(await measure('electron.claude-version', Math.max(5, Math.floor(iterations / 2)), () => spawnOnce(request.claudePath!, ['--version'])));
  }

  // The dotnet host start-up as Electron sees it: spawn, run one trivial scenario, exit.
  scenarios.push(await measure('electron.dotnet-startup', Math.max(5, Math.floor(iterations / 2)), () => spawnOnce(dotnet, [request.probeDll, '--only', 'raw.cmd-exit', '--iterations', '1'])));

  const probeArgs = [request.probeDll, '--iterations', String(iterations)];
  if (request.repo) {
    probeArgs.push('--repo', request.repo);
  }
  if (request.claudePath) {
    probeArgs.push('--claude', request.claudePath);
  }
  if (request.claudePrompt) {
    probeArgs.push('--prompt');
  }

  const probeWall = performance.now();
  const probe = await spawnOnce(dotnet, probeArgs, request.repo);
  const probeWallMs = Math.round(performance.now() - probeWall);
  let dotnetProbe: unknown = null;
  let dotnetProbeError = probe.error;

  try {
    dotnetProbe = JSON.parse(probe.stdout);
  } catch (error) {
    dotnetProbeError = dotnetProbeError || `probe output is not JSON (exit ${probe.exitCode}): ${probe.stdout.slice(0, 300)}`;
    void error;
  }

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    label: request.label ?? '',
    electron: {
      isPackaged: app.isPackaged,
      windowsStore: Boolean((process as NodeJS.Process & { windowsStore?: boolean }).windowsStore),
      execPath: process.execPath,
      pid: process.pid,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
    },
    scenarios,
    dotnetProbeWallMs: probeWallMs,
    dotnetProbe,
    dotnetProbeError,
  };
}

/**
 * Headless entry: when a request file exists at startup, run the chain, write the report next to it and report back.
 * Returns true when a request was handled, so the caller can quit instead of opening a window.
 */
export async function runSpawnChainFromRequestFile(): Promise<boolean> {
  const requestPath = getDefaultRequestPath();
  const request = readRequest(requestPath);

  if (!request) {
    return false;
  }

  const outFile = request.outFile || path.join(path.dirname(requestPath), `report-${request.label || 'run'}.json`);

  try {
    const report = await runSpawnChain(request);
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');
  } catch (error) {
    fs.writeFileSync(outFile, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), 'utf8');
  }

  // Consume the request so the next normal start opens the window.
  fs.rmSync(requestPath, { force: true });
  return true;
}
