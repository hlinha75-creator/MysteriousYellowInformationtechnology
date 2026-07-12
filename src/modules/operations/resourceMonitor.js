const { monitorEventLoopDelay } = require('node:perf_hooks');

const INTERVAL_MS = 5 * 60 * 1000;

function startResourceMonitor(options = {}) {
  const intervalMs = options.intervalMs || INTERVAL_MS;
  const logger = options.logger || console.log;
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  let previousCpu = process.cpuUsage();
  let previousTime = process.hrtime.bigint();

  const timer = setInterval(() => {
    const now = process.hrtime.bigint();
    const elapsedMicros = Number(now - previousTime) / 1000;
    const cpu = process.cpuUsage(previousCpu);
    const cpuPercent = ((cpu.user + cpu.system) / elapsedMicros) * 100;
    const memory = process.memoryUsage();
    logger(`[RECURSOS] CPU ${cpuPercent.toFixed(1)}% | RAM RSS ${(memory.rss / 1048576).toFixed(1)} MB/512 MB | Heap ${(memory.heapUsed / 1048576).toFixed(1)} MB | Event loop p99 ${(delay.percentile(99) / 1e6).toFixed(1)} ms`);
    previousCpu = process.cpuUsage();
    previousTime = now;
    delay.reset();
  }, intervalMs);
  timer.unref?.();
  return { stop() { clearInterval(timer); delay.disable(); } };
}

module.exports = { startResourceMonitor };
