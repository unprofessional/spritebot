#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import http from 'node:http';

const args = process.argv.slice(2);
const valueAfter = (flag) => args[args.indexOf(flag) + 1];
const mode = args.includes('-ng') ? 'cpu' : 'gpu';
const behavior = process.env[`FAKE_${mode.toUpperCase()}_BEHAVIOR`] ?? 'healthy';
const marker = process.env.FAKE_SIGNAL_MARKER;

if (behavior === 'fail_start') process.exit(23);

const startedAt = Date.now();
const server = http.createServer((request, response) => {
  if (request.url !== '/health') {
    response.writeHead(404).end();
    return;
  }
  const unhealthy =
    behavior === 'unhealthy_after_ready' &&
    Date.now() - startedAt >= Number(process.env.FAKE_UNHEALTHY_AFTER_MS ?? 300);
  response.writeHead(unhealthy ? 500 : 200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ status: unhealthy ? 'error' : 'ok', mode }));
});

const shutdown = (signal) => {
  if (marker) writeFileSync(marker, `${mode}:${signal}\n`, { flag: 'a' });
  server.close(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(Number(valueAfter('--port')), valueAfter('--host'), () => {
  if (behavior === 'exit_after_ready') setTimeout(() => process.exit(24), 300);
});
