#!/usr/bin/env node

import { accessSync, constants } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

function loadConfig() {
  const config = {
    binary: process.env.WHISPER_BINARY,
    gpuBinary: process.env.WHISPER_GPU_BINARY || process.env.WHISPER_BINARY,
    cpuBinary: process.env.WHISPER_CPU_BINARY || process.env.WHISPER_BINARY,
    model: process.env.WHISPER_MODEL,
    host: process.env.WHISPER_HOST,
    port: positiveInteger('WHISPER_PORT', 9700),
    gpuDevice: process.env.WHISPER_GPU_DEVICE ?? '0',
    gpuThreads: positiveInteger('WHISPER_GPU_THREADS', 4),
    cpuThreads: positiveInteger('WHISPER_CPU_THREADS', 24),
    startupTimeoutMs: positiveInteger('WHISPER_STARTUP_TIMEOUT_SECONDS', 20) * 1000,
    healthIntervalMs: positiveInteger('WHISPER_HEALTH_INTERVAL_SECONDS', 5) * 1000,
    healthFailureThreshold: positiveInteger('WHISPER_HEALTH_FAILURE_THRESHOLD', 3),
    shutdownTimeoutMs: positiveInteger('WHISPER_SHUTDOWN_TIMEOUT_SECONDS', 10) * 1000,
    gpuProbeBinary: process.env.WHISPER_GPU_PROBE_BINARY || '/usr/bin/nvidia-smi',
    gpuRecoveryCooldownMs: positiveInteger('WHISPER_GPU_RECOVERY_COOLDOWN_SECONDS', 300) * 1000,
    gpuRecoveryProbeIntervalMs:
      positiveInteger('WHISPER_GPU_RECOVERY_PROBE_INTERVAL_SECONDS', 60) * 1000,
    gpuRecoverySuccessThreshold: positiveInteger('WHISPER_GPU_RECOVERY_SUCCESS_THRESHOLD', 3),
    gpuRecoveryBackoffMs: positiveInteger('WHISPER_GPU_RECOVERY_BACKOFF_SECONDS', 900) * 1000,
    gpuProbeTimeoutMs: positiveInteger('WHISPER_GPU_PROBE_TIMEOUT_SECONDS', 10) * 1000,
  };
  for (const [name, value] of [
    ['WHISPER_BINARY', config.binary],
    ['WHISPER_MODEL', config.model],
    ['WHISPER_HOST', config.host],
  ]) {
    if (!value) throw new Error(`${name} is required`);
  }
  if (config.port > 65535) throw new Error('WHISPER_PORT must be at most 65535');
  for (const path of new Set([config.binary, config.gpuBinary, config.cpuBinary])) {
    accessSync(path, constants.X_OK);
  }
  accessSync(config.model, constants.R_OK);
  return config;
}

function log(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ service: 'spritebot-whisper', event, ...fields })}\n`);
}

function childArgs(config, mode) {
  return [
    '-m',
    config.model,
    '--host',
    config.host,
    '--port',
    String(config.port),
    '-t',
    String(mode === 'gpu' ? config.gpuThreads : config.cpuThreads),
    ...(mode === 'cpu' ? ['-ng'] : []),
  ];
}

function startChild(config, mode, attempt) {
  const binary = mode === 'gpu' ? config.gpuBinary : config.cpuBinary;
  const env = { ...process.env };
  if (mode === 'gpu') env.CUDA_VISIBLE_DEVICES = config.gpuDevice;
  else delete env.CUDA_VISIBLE_DEVICES;
  const child = spawn(binary, childArgs(config, mode), {
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  log('child_started', { mode, reason: 'attempt', pid: child.pid ?? null, attempt });
  return child;
}

function childExit(child) {
  return new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
}

function probeHealth(config, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const request = http.get(
      { host: config.host, port: config.port, path: '/health', timeout: timeoutMs },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(false));
  });
}

async function waitUntilReady(config, child, mode, attempt) {
  const startedAt = Date.now();
  const exit = childExit(child).then((result) => ({ kind: 'exit', result }));
  while (Date.now() - startedAt < config.startupTimeoutMs) {
    if ((await probeHealth(config)) && child.exitCode === null && child.signalCode === null) {
      const readyMs = Date.now() - startedAt;
      log('mode_ready', { mode, reason: 'health_ready', pid: child.pid, readyMs, attempt });
      return { ok: true, exit };
    }
    const outcome = await Promise.race([
      exit,
      sleep(Math.min(250, config.healthIntervalMs)).then(() => null),
    ]);
    if (outcome?.kind === 'exit') {
      return {
        ok: false,
        reason: `child_exit:${outcome.result.code ?? outcome.result.signal ?? 'unknown'}`,
      };
    }
  }
  return { ok: false, reason: 'startup_timeout' };
}

function probeGpu(config) {
  return new Promise((resolve) => {
    const child = spawn(
      config.gpuProbeBinary,
      ['-i', config.gpuDevice, '--query-gpu=index', '--format=csv,noheader,nounits'],
      {
        env: { ...process.env, CUDA_VISIBLE_DEVICES: config.gpuDevice },
        stdio: 'ignore',
      },
    );
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(ok);
    };
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(false);
    }, config.gpuProbeTimeoutMs);
    child.once('error', () => finish(false));
    child.once('exit', (code) => finish(code === 0));
  });
}

async function monitor(config, child, exit, mode, recoveryCooldownMs = 0) {
  let failures = 0;
  let recoverySuccesses = 0;
  let nextRecoveryProbeAt = Date.now() + recoveryCooldownMs;
  while (true) {
    const outcome = await Promise.race([exit, sleep(config.healthIntervalMs).then(() => null)]);
    if (outcome?.kind === 'exit') {
      return `child_exit:${outcome.result.code ?? outcome.result.signal ?? 'unknown'}`;
    }
    if (await probeHealth(config)) failures = 0;
    else failures += 1;
    if (failures >= config.healthFailureThreshold) return `health_failures:${failures}`;
    if (mode === 'cpu' && Date.now() >= nextRecoveryProbeAt) {
      const ok = await probeGpu(config);
      recoverySuccesses = ok ? recoverySuccesses + 1 : 0;
      log('gpu_recovery_probe', {
        mode: 'cpu',
        reason: ok ? 'probe_succeeded' : 'probe_failed',
        pid: child.pid ?? null,
        successes: recoverySuccesses,
        required: config.gpuRecoverySuccessThreshold,
      });
      if (recoverySuccesses >= config.gpuRecoverySuccessThreshold) return 'gpu_recovery';
      nextRecoveryProbeAt = Date.now() + config.gpuRecoveryProbeIntervalMs;
    }
  }
}

async function stopChild(child, timeoutMs, reason) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exit = childExit(child);
  log('child_stopping', { reason, pid: child.pid });
  child.kill('SIGTERM');
  const stopped = await Promise.race([exit.then(() => true), sleep(timeoutMs).then(() => false)]);
  if (!stopped && child.exitCode === null) {
    log('child_killing', { reason: 'shutdown_timeout', pid: child.pid });
    child.kill('SIGKILL');
    await exit;
  }
}

function portIsFree(config) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: config.host, port: config.port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(true));
  });
}

async function waitForFreePort(config) {
  const deadline = Date.now() + config.shutdownTimeoutMs;
  while (Date.now() < deadline) {
    if (await portIsFree(config)) return true;
    await sleep(100);
  }
  return false;
}

async function main() {
  let config;
  try {
    process.umask(0o077);
    config = loadConfig();
  } catch (error) {
    log('configuration_error', { reason: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
    return;
  }

  let activeChild = null;
  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    log('supervisor_stopping', { reason: signal, pid: activeChild?.pid ?? null });
    await stopChild(activeChild, config.shutdownTimeoutMs, signal);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  if (!(await portIsFree(config))) {
    log('port_in_use', { reason: 'listener_preexisted', pid: null, attempt: 0 });
    process.exitCode = 1;
    return;
  }

  let mode = 'gpu';
  let attempt = 0;
  let promotionAttempt = false;
  let cpuRecoveryCooldownMs = config.gpuRecoveryCooldownMs;
  while (!stopping) {
    attempt += 1;
    if (stopping) return;
    activeChild = startChild(config, mode, attempt);
    const readiness = await waitUntilReady(config, activeChild, mode, attempt);
    let modeReason = readiness.ok ? null : readiness.reason;
    if (!readiness.ok) {
      log('mode_failed', { mode, reason: readiness.reason, pid: activeChild.pid ?? null, attempt });
    } else {
      const reason = await monitor(
        config,
        activeChild,
        readiness.exit,
        mode,
        mode === 'cpu' ? cpuRecoveryCooldownMs : 0,
      );
      modeReason = reason;
      if (stopping) return;
      if (mode === 'cpu' && reason === 'gpu_recovery') {
        log('mode_promotion', {
          mode: 'gpu',
          reason: 'gpu_probe_threshold_met',
          pid: activeChild.pid ?? null,
          attempt: attempt + 1,
        });
      } else {
        log('mode_failed', { mode, reason, pid: activeChild.pid ?? null, attempt });
      }
    }
    await stopChild(
      activeChild,
      config.shutdownTimeoutMs,
      modeReason === 'gpu_recovery' ? 'gpu_promotion' : 'mode_failed',
    );
    if (!(await waitForFreePort(config))) {
      log('port_release_failed', {
        mode,
        reason: 'listener_remained',
        pid: activeChild.pid ?? null,
        attempt,
      });
      process.exitCode = 1;
      return;
    }
    if (mode === 'gpu') {
      cpuRecoveryCooldownMs = promotionAttempt
        ? config.gpuRecoveryBackoffMs
        : config.gpuRecoveryCooldownMs;
      log('mode_transition', {
        mode: 'cpu',
        reason: promotionAttempt ? 'gpu_promotion_failed' : 'gpu_failed',
        pid: null,
        attempt: attempt + 1,
      });
      mode = 'cpu';
      promotionAttempt = false;
      continue;
    }
    if (modeReason === 'gpu_recovery') {
      mode = 'gpu';
      promotionAttempt = true;
      continue;
    }
    break;
  }

  log('supervisor_failed', { reason: 'gpu_and_cpu_failed', pid: null, attempt });
  process.exitCode = 1;
}

await main();
