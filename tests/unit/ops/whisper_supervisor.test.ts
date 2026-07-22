import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const projectRoot = join(__dirname, '../../..');
const supervisor = join(projectRoot, 'ops/whisper/whisper-supervisor.mjs');
const fakeServer = join(projectRoot, 'tests/fixtures/fake-whisper-server.mjs');

jest.setTimeout(20_000);

beforeAll(() => chmodSync(fakeServer, 0o755));

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP address');
      server.close(() => resolve(address.port));
    });
  });
}

async function startSupervisor(extraEnv: NodeJS.ProcessEnv = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [supervisor], {
    env: {
      ...process.env,
      WHISPER_BINARY: fakeServer,
      WHISPER_MODEL: fakeServer,
      WHISPER_HOST: '127.0.0.1',
      WHISPER_PORT: String(port),
      WHISPER_STARTUP_TIMEOUT_SECONDS: '1',
      WHISPER_HEALTH_INTERVAL_SECONDS: '1',
      WHISPER_HEALTH_FAILURE_THRESHOLD: '1',
      WHISPER_SHUTDOWN_TIMEOUT_SECONDS: '1',
      WHISPER_GPU_PROBE_BINARY: fakeServer,
      WHISPER_GPU_RECOVERY_COOLDOWN_SECONDS: '1',
      WHISPER_GPU_RECOVERY_PROBE_INTERVAL_SECONDS: '1',
      WHISPER_GPU_RECOVERY_SUCCESS_THRESHOLD: '2',
      WHISPER_GPU_RECOVERY_BACKOFF_SECONDS: '2',
      WHISPER_GPU_PROBE_TIMEOUT_SECONDS: '1',
      ...extraEnv,
    },
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk.toString()));
  child.stderr.on('data', (chunk) => (output += chunk.toString()));
  return { child, output: () => output };
}

async function waitForOutput(
  running: Awaited<ReturnType<typeof startSupervisor>>,
  text: string,
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!running.output().includes(text)) {
    if (running.child.exitCode !== null)
      throw new Error(`Exited before ${text}: ${running.output()}`);
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for ${text}: ${running.output()}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitForOccurrences(
  running: Awaited<ReturnType<typeof startSupervisor>>,
  text: string,
  count: number,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (running.output().split(text).length - 1 < count) {
    if (running.child.exitCode !== null)
      throw new Error(`Exited before ${count} occurrences of ${text}: ${running.output()}`);
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for ${count} occurrences of ${text}: ${running.output()}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  return new Promise((resolve) => child.once('exit', (code) => resolve(code)));
}

async function stop(running: Awaited<ReturnType<typeof startSupervisor>>): Promise<void> {
  if (running.child.exitCode !== null) return;
  const exit = waitForExit(running.child);
  running.child.kill('SIGTERM');
  await exit;
}

test('keeps a healthy GPU child active without starting CPU', async () => {
  const running = await startSupervisor();
  await waitForOutput(running, '"event":"mode_ready","mode":"gpu"');
  expect(running.output()).not.toContain('"mode":"cpu"');
  await stop(running);
});

test('falls back to CPU when GPU startup fails', async () => {
  const running = await startSupervisor({ FAKE_GPU_BEHAVIOR: 'fail_start' });
  await waitForOutput(running, '"event":"mode_ready","mode":"cpu"');
  expect(running.output()).toContain('"event":"mode_transition","mode":"cpu"');
  await stop(running);
});

test('falls back to CPU when the ready GPU child exits', async () => {
  const running = await startSupervisor({ FAKE_GPU_BEHAVIOR: 'exit_after_ready' });
  await waitForOutput(running, '"event":"mode_ready","mode":"cpu"');
  expect(running.output()).toContain('child_exit:24');
  await stop(running);
});

test('falls back to CPU after the GPU health threshold', async () => {
  const running = await startSupervisor({ FAKE_GPU_BEHAVIOR: 'unhealthy_after_ready' });
  await waitForOutput(running, '"event":"mode_ready","mode":"cpu"');
  expect(running.output()).toContain('health_failures:1');
  await stop(running);
});

test('promotes healthy CPU fallback after consecutive GPU recovery probes', async () => {
  const marker = join(mkdtempSync(join(tmpdir(), 'whisper-supervisor-')), 'gpu-starts');
  const running = await startSupervisor({
    FAKE_GPU_BEHAVIOR: 'fail_start_count',
    FAKE_GPU_START_MARKER: marker,
  });
  await waitForOutput(running, '"event":"mode_ready","mode":"cpu"');
  await waitForOutput(running, '"event":"mode_promotion","mode":"gpu"');
  await waitForOutput(running, '"event":"mode_ready","mode":"gpu"', 10_000);
  expect(running.output()).toContain('"successes":2,"required":2');
  await stop(running);
});

test('keeps CPU active when a GPU recovery probe fails', async () => {
  const running = await startSupervisor({
    FAKE_GPU_BEHAVIOR: 'fail_start',
    FAKE_GPU_PROBE_BEHAVIOR: 'fail',
  });
  await waitForOutput(running, '"event":"gpu_recovery_probe"');
  expect(running.output()).toContain('"reason":"probe_failed"');
  expect(running.output()).not.toContain('"event":"mode_promotion"');
  await stop(running);
});

test('restores CPU and applies backoff after an earned GPU promotion fails', async () => {
  const marker = join(mkdtempSync(join(tmpdir(), 'whisper-supervisor-')), 'gpu-starts');
  const running = await startSupervisor({
    FAKE_GPU_BEHAVIOR: 'fail_start_count',
    FAKE_GPU_FAIL_STARTS: '2',
    FAKE_GPU_START_MARKER: marker,
  });
  await waitForOutput(running, '"event":"mode_promotion","mode":"gpu"');
  await waitForOutput(running, '"reason":"gpu_promotion_failed"');
  await waitForOccurrences(running, '"event":"mode_ready","mode":"cpu"', 2);
  expect(Number(readFileSync(marker, 'utf8'))).toBe(2);
  await stop(running);
});

test('exits nonzero when GPU and CPU both fail', async () => {
  const running = await startSupervisor({
    FAKE_GPU_BEHAVIOR: 'fail_start',
    FAKE_CPU_BEHAVIOR: 'fail_start',
  });
  expect(await waitForExit(running.child)).toBe(1);
  expect(running.output()).toContain('"event":"supervisor_failed"');
});

test('forwards SIGTERM to the active verified child', async () => {
  const marker = join(mkdtempSync(join(tmpdir(), 'whisper-supervisor-')), 'signals');
  const running = await startSupervisor({ FAKE_SIGNAL_MARKER: marker });
  await waitForOutput(running, '"event":"mode_ready","mode":"gpu"');
  await stop(running);
  expect(readFileSync(marker, 'utf8')).toContain('gpu:SIGTERM');
});

test('forwards SIGTERM to the active CPU fallback child', async () => {
  const marker = join(mkdtempSync(join(tmpdir(), 'whisper-supervisor-')), 'signals');
  const running = await startSupervisor({
    FAKE_GPU_BEHAVIOR: 'fail_start',
    FAKE_SIGNAL_MARKER: marker,
  });
  await waitForOutput(running, '"event":"mode_ready","mode":"cpu"');
  await stop(running);
  expect(readFileSync(marker, 'utf8')).toContain('cpu:SIGTERM');
});

test('force-kills a child that ignores graceful shutdown', async () => {
  const running = await startSupervisor({ FAKE_GPU_BEHAVIOR: 'ignore_term' });
  await waitForOutput(running, '"event":"mode_ready","mode":"gpu"');
  await stop(running);
  expect(running.output()).toContain('"event":"child_killing"');
});

test('fails instead of starting CPU when the failed GPU leaves the port occupied', async () => {
  const marker = join(mkdtempSync(join(tmpdir(), 'whisper-supervisor-')), 'stuck-pid');
  const running = await startSupervisor({
    FAKE_GPU_BEHAVIOR: 'unhealthy_leave_stuck_port',
    FAKE_UNHEALTHY_AFTER_MS: '1',
    FAKE_STUCK_PID_MARKER: marker,
  });
  try {
    expect(await waitForExit(running.child)).toBe(1);
    expect(running.output()).toContain('"event":"port_release_failed"');
    expect(running.output()).not.toContain('"event":"mode_ready","mode":"cpu"');
  } finally {
    if (existsSync(marker)) {
      const pid = Number(readFileSync(marker, 'utf8').trim());
      if (Number.isSafeInteger(pid)) process.kill(pid, 'SIGKILL');
    }
  }
});

test('rejects invalid configuration before spawning', async () => {
  const running = await startSupervisor({ WHISPER_PORT: 'not-a-port' });
  expect(await waitForExit(running.child)).toBe(1);
  expect(running.output()).toContain('"event":"configuration_error"');
});

test('refuses to replace an unknown listener on the configured port', async () => {
  const port = await freePort();
  const listener = net.createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(port, '127.0.0.1', () => resolve());
  });
  try {
    const running = await startSupervisor({ WHISPER_PORT: String(port) });
    expect(await waitForExit(running.child)).toBe(1);
    expect(running.output()).toContain('"event":"port_in_use"');
  } finally {
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
});
