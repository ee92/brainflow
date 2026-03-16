import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname: string = path.dirname(fileURLToPath(import.meta.url));
const CLI: string = path.join(__dirname, '../dist/index.js');

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface ChildProcessError {
  stdout?: string;
  stderr?: string;
  status?: number;
  code?: string | number;
}

function isChildProcessError(value: unknown): value is ChildProcessError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return 'status' in value || 'stdout' in value || 'stderr' in value || 'code' in value;
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function run(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  const command: string = `node ${shellQuote(CLI)} ${args.map(shellQuote).join(' ')}`.trim();
  try {
    const result = await execFileAsync('bash', ['-lc', command], {
      env: { ...process.env, DRAW_API_URL: process.env.DRAW_API_URL || 'http://localhost:3030', ...env },
      timeout: 10000,
    });

    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (error: unknown) {
    if (isChildProcessError(error)) {
      const status: number = typeof error.status === 'number' ? error.status : 1;
      const code: number = error.code === 'ERR_CHILD_PROCESS_STDIO_FINAL' ? 1 : status;
      return { stdout: error.stdout || '', stderr: error.stderr || '', code };
    }

    return { stdout: '', stderr: String(error), code: 1 };
  }
}

test('draw list --help shows usage', async (): Promise<void> => {
  const { stdout } = await run(['list', '--help']);
  assert.ok(stdout.includes('List all diagrams'));
});

test('draw get --help shows usage', async (): Promise<void> => {
  const { stdout } = await run(['get', '--help']);
  assert.ok(stdout.includes('Print diagram'));
});

test('draw create --help shows usage', async (): Promise<void> => {
  const { stdout } = await run(['create', '--help']);
  assert.ok(stdout.includes('Create a new diagram'));
});

test('draw url prints URL to stdout', async (): Promise<void> => {
  const { stdout } = await run(['url', 'test-slug']);
  assert.ok(stdout.includes('/d/test-slug'));
});

test('draw --help shows all commands', async (): Promise<void> => {
  const { stdout } = await run(['--help']);
  assert.ok(stdout.includes('list'));
  assert.ok(stdout.includes('get'));
  assert.ok(stdout.includes('create'));
  assert.ok(stdout.includes('update'));
  assert.ok(stdout.includes('delete'));
});
