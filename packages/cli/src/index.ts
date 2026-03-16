#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { Command } from 'commander';

type ExitCode = 0 | 1 | 2 | 3 | 4 | 5;

const EXIT_SUCCESS: ExitCode = 0;
const EXIT_GENERAL: ExitCode = 1;
const EXIT_INPUT: ExitCode = 2;
const EXIT_NOT_FOUND: ExitCode = 3;
const EXIT_CONFLICT: ExitCode = 4;
const EXIT_NETWORK: ExitCode = 5;

const EXIT = {
  SUCCESS: EXIT_SUCCESS,
  GENERAL: EXIT_GENERAL,
  INPUT: EXIT_INPUT,
  NOT_FOUND: EXIT_NOT_FOUND,
  CONFLICT: EXIT_CONFLICT,
  NETWORK: EXIT_NETWORK,
};

type QueryValue = string | number | string[] | undefined | null;
type QueryRecord = Record<string, QueryValue>;

interface ApiError {
  code: string;
  message: string;
  status: number;
  requestId?: string;
}

interface ApiSuccess<TData> {
  ok: true;
  data: TData;
  meta?: {
    total: number;
    limit: number;
    offset: number;
  };
}

interface ApiFailure {
  ok: false;
  error: ApiError;
}

interface DiagramSummary {
  id: number;
  slug: string;
  title: string;
  description: string;
  diagram_type: 'mermaid';
  tags: string[];
  version: number;
  created_at: string;
  updated_at: string;
}

interface Diagram extends DiagramSummary {
  content: string;
}

interface CliErrorLike {
  code: unknown;
  stdout?: string;
  stderr?: string;
  status?: number;
}

const API_BASE: string = (process.env.DRAW_API_URL || 'http://localhost:3030').replace(/\/+$/, '');
const TOKEN: string | undefined = process.env.DRAW_TOKEN;

class CliError extends Error {
  public readonly code: ExitCode;

  public constructor(message: string, code: ExitCode = EXIT.GENERAL) {
    super(message);
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isApiFailure(value: unknown): value is ApiFailure {
  if (!isRecord(value) || value.ok !== false || !('error' in value)) {
    return false;
  }

  const errorValue: unknown = value.error;
  if (!isRecord(errorValue)) {
    return false;
  }

  return typeof errorValue.message === 'string' && typeof errorValue.status === 'number' && typeof errorValue.code === 'string';
}

function isApiSuccess<TData>(value: unknown): value is ApiSuccess<TData> {
  return isRecord(value) && value.ok === true && 'data' in value;
}

function isCliErrorLike(value: unknown): value is CliErrorLike {
  if (!isRecord(value)) {
    return false;
  }

  return 'code' in value;
}

function isExitCode(value: unknown): value is ExitCode {
  return value === EXIT.SUCCESS
    || value === EXIT.GENERAL
    || value === EXIT.INPUT
    || value === EXIT.NOT_FOUND
    || value === EXIT.CONFLICT
    || value === EXIT.NETWORK;
}

function buildApiUrl(pathSegment: string, query: QueryRecord | null = null): URL {
  const url: URL = new URL(`${API_BASE}/api/v1${pathSegment}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }

      if (Array.isArray(value)) {
        url.searchParams.set(key, value.join(','));
        continue;
      }

      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: QueryRecord;
  body?: unknown;
}

async function apiRequest<TData>(pathSegment: string, { method = 'GET', query, body }: RequestOptions = {}): Promise<ApiSuccess<TData>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (TOKEN) {
    headers.Authorization = `Bearer ${TOKEN}`;
  }

  let response: Response;
  try {
    const requestInit: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      requestInit.body = JSON.stringify(body);
    }

    response = await fetch(buildApiUrl(pathSegment, query || null), requestInit);
  } catch (_error: unknown) {
    throw new CliError('Network error: failed to reach API server', EXIT.NETWORK);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (_error: unknown) {
    throw new CliError('Invalid API response', EXIT.NETWORK);
  }

  if (isApiFailure(payload)) {
    const status: number = payload.error.status || response.status;
    const message: string = payload.error.message || `Request failed with status ${status}`;
    throw new CliError(message, mapStatusToExitCode(status));
  }

  if (!response.ok || !isApiSuccess<TData>(payload)) {
    throw new CliError(`Request failed with status ${response.status}`, mapStatusToExitCode(response.status));
  }

  return payload;
}

function mapStatusToExitCode(status: number): ExitCode {
  if (status === 400 || status === 412 || status === 413) {
    return EXIT.INPUT;
  }
  if (status === 404) {
    return EXIT.NOT_FOUND;
  }
  if (status === 409) {
    return EXIT.CONFLICT;
  }
  if (status >= 500) {
    return EXIT.NETWORK;
  }
  return EXIT.GENERAL;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function formatRelativeTime(iso: string): string {
  const value: number = Date.parse(iso);
  if (Number.isNaN(value)) {
    return 'just now';
  }

  const diffSec: number = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (diffSec < 60) {
    return `${diffSec}s ago`;
  }

  const diffMin: number = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }

  const diffHours: number = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays: number = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function trimDisplay(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

function formatListRow(item: DiagramSummary): string {
  const slug: string = trimDisplay(item.slug, 20).padEnd(20, ' ');
  const title: string = trimDisplay(item.title, 32).padEnd(32, ' ');
  const tags: string = `[${(item.tags || []).join(', ')}]`.padEnd(28, ' ');
  const updated: string = formatRelativeTime(item.updated_at);
  return `${slug}  ${title}  ${tags}  ${updated}`;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new CliError('No stdin input available', EXIT.INPUT);
  }

  return new Promise<string>((resolve: (value: string) => void, reject: (error: Error) => void): void => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string): void => {
      data += chunk;
    });
    process.stdin.on('end', (): void => resolve(data));
    process.stdin.on('error', (): void => reject(new CliError('Failed to read stdin', EXIT.INPUT)));
  });
}

interface ContentOptions {
  file?: string;
  stdin?: boolean;
}

async function readContent(options: ContentOptions): Promise<string | null> {
  if (options.file && options.stdin) {
    throw new CliError('Use either --file or --stdin, not both', EXIT.INPUT);
  }

  if (options.file) {
    try {
      return await fs.readFile(options.file, 'utf8');
    } catch (_error: unknown) {
      throw new CliError(`Failed to read file: ${options.file}`, EXIT.INPUT);
    }
  }

  if (options.stdin) {
    return readStdin();
  }

  return null;
}

async function getCurrentVersion(slug: string): Promise<number> {
  const response = await apiRequest<Diagram>(`/diagrams/${encodeURIComponent(slug)}`);
  return response.data.version;
}

function toOrigin(): string {
  try {
    const url: URL = new URL(API_BASE);
    return `${url.protocol}//${url.host}`;
  } catch (_error: unknown) {
    throw new CliError('Invalid DRAW_API_URL', EXIT.INPUT);
  }
}

function diagramUrl(slug: string): string {
  return `${toOrigin()}/d/${encodeURIComponent(slug)}`;
}

function openBrowser(url: string): void {
  const platform: NodeJS.Platform = process.platform;
  let cmd = '';
  let args: string[] = [];

  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }

  const child = spawn(cmd, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

interface ListOptions {
  tag?: string;
  search?: string;
  sort?: 'updated_at' | 'created_at' | 'title';
  order?: 'asc' | 'desc';
  limit: number;
  offset: number;
  json?: boolean;
}

interface GetOptions {
  json?: boolean;
}

interface CreateOptions extends ContentOptions {
  slug?: string;
  description?: string;
  tag: string[];
  json?: boolean;
}

interface UpdateOptions extends ContentOptions {
  title?: string;
  description?: string;
  tag?: string[];
  json?: boolean;
}

const program: Command = new Command();

program
  .name('draw')
  .description('CLI for Brainflow diagrams')
  .showHelpAfterError();

program
  .command('list')
  .description('List all diagrams')
  .option('--tag <tag>', 'Filter by tag')
  .option('--search <query>', 'Full-text search')
  .option('--sort <field>', 'Sort: updated_at, created_at, title')
  .option('--order <dir>', 'Order: asc, desc')
  .option('--limit <n>', 'Max results (default 50)', (value: string): number => Number.parseInt(value, 10), 50)
  .option('--offset <n>', 'Pagination offset', (value: string): number => Number.parseInt(value, 10), 0)
  .option('--json', 'Output as JSON (for agents/scripts)')
  .action(async (options: ListOptions): Promise<void> => {
    if (!Number.isInteger(options.limit) || options.limit < 1) {
      throw new CliError('--limit must be a positive integer', EXIT.INPUT);
    }

    if (!Number.isInteger(options.offset) || options.offset < 0) {
      throw new CliError('--offset must be a non-negative integer', EXIT.INPUT);
    }

    const query: QueryRecord = {
      search: options.search,
      tags: options.tag,
      sort: options.sort,
      order: options.order,
      limit: options.limit,
      offset: options.offset,
    };

    const response = await apiRequest<DiagramSummary[]>('/diagrams', { query });
    const diagrams: DiagramSummary[] = response.data;

    if (options.json) {
      printJson(diagrams);
      return;
    }

    if (diagrams.length === 0) {
      process.stdout.write('No diagrams found\n');
      return;
    }

    for (const item of diagrams) {
      process.stdout.write(`${formatListRow(item)}\n`);
    }
  });

program
  .command('get <slug>')
  .description('Print diagram Mermaid content to stdout')
  .option('--json', 'Full metadata + content as JSON')
  .action(async (slug: string, options: GetOptions): Promise<void> => {
    const response = await apiRequest<Diagram>(`/diagrams/${encodeURIComponent(slug)}`);
    if (options.json) {
      printJson(response.data);
      return;
    }

    process.stdout.write(`${response.data.content}\n`);
  });

program
  .command('create <title>')
  .description('Create a new diagram')
  .option('--file <path>', 'Read content from file')
  .option('--stdin', 'Read content from stdin')
  .option('--slug <slug>', 'Custom slug (auto-generated if omitted)')
  .option('--description <text>', 'Description')
  .option('--tag <tag>', 'Tag (repeatable)', (value: string, previous: string[] = []): string[] => {
    previous.push(value);
    return previous;
  }, [])
  .option('--json', 'Output as JSON')
  .action(async (title: string, options: CreateOptions): Promise<void> => {
    const content: string | null = await readContent(options);
    if (!content || content.trim().length === 0) {
      throw new CliError('Diagram content is required (use --file or --stdin)', EXIT.INPUT);
    }

    const payload: QueryRecord = {
      title,
      content,
      slug: options.slug,
      description: options.description,
      tags: options.tag,
    };

    const response = await apiRequest<Diagram>('/diagrams', {
      method: 'POST',
      body: payload,
    });

    if (options.json) {
      printJson(response.data);
      return;
    }

    process.stdout.write(`Created "${response.data.title}" -> ${diagramUrl(response.data.slug)}\n`);
  });

program
  .command('update <slug>')
  .description('Update an existing diagram')
  .option('--file <path>', 'Read new content from file')
  .option('--stdin', 'Read new content from stdin')
  .option('--title <title>', 'Update title')
  .option('--description <text>', 'Update description')
  .option('--tag <tag>', 'Replace tags (repeatable)', (value: string, previous: string[] = []): string[] => {
    previous.push(value);
    return previous;
  }, undefined)
  .option('--json', 'Output as JSON')
  .action(async (slug: string, options: UpdateOptions): Promise<void> => {
    const content: string | null = await readContent(options);
    const hasTagOption: boolean = options.tag !== undefined;

    if (
      options.title === undefined
      && options.description === undefined
      && content === null
      && !hasTagOption
    ) {
      throw new CliError('No updates provided', EXIT.INPUT);
    }

    const version: number = await getCurrentVersion(slug);
    const payload: QueryRecord = { version };

    if (options.title !== undefined) {
      payload.title = options.title;
    }
    if (options.description !== undefined) {
      payload.description = options.description;
    }
    if (content !== null) {
      payload.content = content;
    }
    if (hasTagOption) {
      payload.tags = options.tag;
    }

    const response = await apiRequest<Diagram>(`/diagrams/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      body: payload,
    });

    if (options.json) {
      printJson(response.data);
      return;
    }

    process.stdout.write(`Updated "${response.data.title}"\n`);
  });

program
  .command('delete <slug>')
  .description('Soft-delete a diagram')
  .action(async (slug: string): Promise<void> => {
    const version: number = await getCurrentVersion(slug);
    await apiRequest<Diagram>(`/diagrams/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
      body: { version },
    });
    process.stdout.write(`Deleted ${slug}\n`);
  });

program
  .command('url <slug>')
  .description('Print the diagram URL to stdout')
  .action((slug: string): void => {
    process.stdout.write(`${diagramUrl(slug)}\n`);
  });

program
  .command('open <slug>')
  .description('Open diagram in default browser')
  .action((slug: string): void => {
    const url: string = diagramUrl(slug);
    openBrowser(url);
    process.stdout.write(`${url}\n`);
  });

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error: unknown) {
    if (error instanceof CliError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(error.code);
    }

    if (isCliErrorLike(error) && isExitCode(error.code)) {
      process.stderr.write(`${String(error)}\n`);
      process.exit(error.code);
    }

    process.stderr.write(`Unexpected error: ${String(error)}\n`);
    process.exit(EXIT.GENERAL);
  }
}

await main();
