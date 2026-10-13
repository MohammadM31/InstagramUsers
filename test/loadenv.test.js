import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const mod = pathToFileURL(new URL('../src/loadenv.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href;
const run = (dir, env = {}) => execFileSync(process.execPath, ['--input-type=module', '-e',
  `await import(${JSON.stringify(mod)}); console.log(JSON.stringify([process.env.GE_T1, process.env.GE_T2]))`],
  { cwd: dir, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env }, encoding: 'utf8' }).trim();

test('0.2 .env in the working directory is loaded without --env-file; real env vars win', { skip: typeof process.loadEnvFile !== 'function' && 'needs Node 20.12+' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ge-env-'));
  writeFileSync(join(dir, '.env'), 'GE_T1=from-file\r\nGE_T2=also-from-file\r\n'); // CRLF on purpose (Windows editors)
  assert.equal(run(dir), '["from-file","also-from-file"]');
  assert.equal(run(dir, { GE_T1: 'from-shell' }), '["from-shell","also-from-file"]');
});
test('0.2 no .env file is not an error', () => {
  assert.equal(run(mkdtempSync(join(tmpdir(), 'ge-noenv-'))), '[null,null]');
});
