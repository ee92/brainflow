import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '../src/index.js');

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function run(args, env = {}) {
  const command = `node ${shellQuote(CLI)} ${args.map(shellQuote).join(' ')}`.trim();
  try {
    const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
      env: { ...process.env, DRAW_API_URL: process.env.DRAW_API_URL || 'http://localhost:3030', ...env },
      timeout: 10000,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', code: err.code === 'ERR_CHILD_PROCESS_STDIO_FINAL' ? 1 : (err.status || 1) };
  }
}

test('draw list --help shows usage', async () => {
  const { stdout } = await run(['list', '--help']);
  assert.ok(stdout.includes('List all diagrams'));
});

test('draw get --help shows usage', async () => {
  const { stdout } = await run(['get', '--help']);
  assert.ok(stdout.includes('Print diagram'));
});

test('draw create --help shows usage', async () => {
  const { stdout } = await run(['create', '--help']);
  assert.ok(stdout.includes('Create a new diagram'));
});

test('draw url prints URL to stdout', async () => {
  const { stdout } = await run(['url', 'test-slug']);
  assert.ok(stdout.includes('/d/test-slug'));
});

test('draw --help shows all commands', async () => {
  const { stdout } = await run(['--help']);
  assert.ok(stdout.includes('list'));
  assert.ok(stdout.includes('get'));
  assert.ok(stdout.includes('create'));
  assert.ok(stdout.includes('update'));
  assert.ok(stdout.includes('delete'));
});
