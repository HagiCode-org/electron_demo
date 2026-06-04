const startedAt = new Date();
const rawInterval = Number(process.env.ELECTRON_DEMO_HEARTBEAT_INTERVAL_MS || process.argv[3] || 5000);
const intervalMs = Number.isFinite(rawInterval) && rawInterval >= 250 ? rawInterval : 5000;
const label = String(process.env.ELECTRON_DEMO_HEARTBEAT_LABEL || process.argv[2] || 'electron-demo-heartbeat');

function write(message) {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

write(`[heartbeat] ${label} booted (pid=${process.pid}, interval=${intervalMs}ms)`);

const timer = setInterval(() => {
  write(`[heartbeat] ${label} alive ${Math.floor((Date.now() - startedAt.getTime()) / 1000)}s`);
}, intervalMs);

function shutdown(signal) {
  clearInterval(timer);
  write(`[heartbeat] ${label} received ${signal}`);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
