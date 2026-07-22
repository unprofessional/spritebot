import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync } from 'node:fs';
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
