#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';

const args = process.argv.slice(2);
const valueAfter = (flag) => args[args.indexOf(flag) + 1];
const mode = args.includes('-ng') ? 'cpu' : 'gpu';
const behavior = process.env[`FAKE_${mode.toUpperCase()}_BEHAVIOR`] ?? 'healthy';
const marker = process.env.FAKE_SIGNAL_MARKER;
const stuckPidMarker = process.env.FAKE_STUCK_PID_MARKER;

if (args.includes('--query-gpu=index')) {
  process.exit(process.env.FAKE_GPU_PROBE_BEHAVIOR === 'fail' ? 25 : 0);
}

if (args.includes('--stuck-listener')) {
  const stuckServer = http.createServer((_request, response) => response.writeHead(200).end());
  stuckServer.listen(Number(valueAfter('--port')), valueAfter('--host'), () => {
    if (stuckPidMarker) writeFileSync(stuckPidMarker, String(process.pid));
  });
  await new Promise(() => undefined);
}

if (behavior === 'fail_start') process.exit(23);
if (behavior === 'fail_start_count') {
  const startMarker = process.env.FAKE_GPU_START_MARKER;
  const starts =
    startMarker && existsSync(startMarker) ? Number(readFileSync(startMarker, 'utf8')) : 0;
  if (startMarker) writeFileSync(startMarker, String(starts + 1));
  if (starts < Number(process.env.FAKE_GPU_FAIL_STARTS ?? 1)) process.exit(23);
}

const startedAt = Date.now();
const server = http.createServer((request, response) => {
  if (request.url !== '/health') {
    response.writeHead(404).end();
    return;
  }
  const unhealthy =
    ['unhealthy_after_ready', 'unhealthy_leave_stuck_port'].includes(behavior) &&
    Date.now() - startedAt >= Number(process.env.FAKE_UNHEALTHY_AFTER_MS ?? 300);
  response.writeHead(unhealthy ? 500 : 200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ status: unhealthy ? 'error' : 'ok', mode }));
});

const shutdown = (signal) => {
  if (marker) writeFileSync(marker, `${mode}:${signal}\n`, { flag: 'a' });
  if (behavior === 'ignore_term') return;
  server.close(() => {
    if (behavior === 'unhealthy_leave_stuck_port') {
      const stuck = spawn(
        process.execPath,
        [
          process.argv[1],
          '--stuck-listener',
          '--host',
          valueAfter('--host'),
          '--port',
          valueAfter('--port'),
        ],
        { detached: true, env: process.env, stdio: 'ignore' },
      );
      stuck.unref();
      setTimeout(() => process.exit(0), 100);
      return;
    }
    process.exit(0);
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(Number(valueAfter('--port')), valueAfter('--host'), () => {
  if (behavior === 'exit_after_ready') setTimeout(() => process.exit(24), 300);
});
