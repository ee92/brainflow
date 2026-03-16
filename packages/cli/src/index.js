#!/usr/bin/env node

import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Command, CommanderError } from 'commander';

const EXIT = {
  SUCCESS: 0,
  GENERAL: 1,
  INPUT: 2,
  NOT_FOUND: 3,
  CONFLICT: 4,
  NETWORK: 5,
};

const API_BASE = (process.env.DRAW_API_URL || 'http://localhost:3030').replace(/\/+$/, '');
const TOKEN = process.env.DRAW_TOKEN;

class CliError extends Error {
  constructor(message, code = EXIT.GENERAL) {
    super(message);
    this.code = code;
  }
}

function buildApiUrl(path, query = null) {
  const url = new URL(`${API_BASE}/api/v1${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function apiRequest(path, { method = 'GET', query, body } = {}) {
  const headers = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (TOKEN) {
    headers.Authorization = `Bearer ${TOKEN}`;
  }

  let response;
  try {
    response = await fetch(buildApiUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new CliError('Network error: failed to reach API server', EXIT.NETWORK);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new CliError('Invalid API response', EXIT.NETWORK);
  }

  if (!response.ok || !payload.ok) {
    const status = payload?.error?.status || response.status;
    const message = payload?.error?.message || `Request failed with status ${status}`;
    throw new CliError(message, mapStatusToExitCode(status));
  }

  return payload;
}

function mapStatusToExitCode(status) {
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

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function formatRelativeTime(iso) {
  const value = Date.parse(iso);
  if (Number.isNaN(value)) {
    return 'just now';
  }

  const diffSec = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (diffSec < 60) {
    return `${diffSec}s ago`;
  }

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function trimDisplay(value, max) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

function formatListRow(item) {
  const slug = trimDisplay(item.slug, 20).padEnd(20, ' ');
  const title = trimDisplay(item.title, 32).padEnd(32, ' ');
  const tags = `[${(item.tags || []).join(', ')}]`.padEnd(28, ' ');
  const updated = formatRelativeTime(item.updated_at);
  return `${slug}  ${title}  ${tags}  ${updated}`;
}

async function readStdin() {
  if (process.stdin.isTTY) {
    throw new CliError('No stdin input available', EXIT.INPUT);
  }

  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => reject(new CliError('Failed to read stdin', EXIT.INPUT)));
  });
}

async function readContent(options) {
  if (options.file && options.stdin) {
    throw new CliError('Use either --file or --stdin, not both', EXIT.INPUT);
  }

  if (options.file) {
    try {
      return await fs.readFile(options.file, 'utf8');
    } catch {
      throw new CliError(`Failed to read file: ${options.file}`, EXIT.INPUT);
    }
  }

  if (options.stdin) {
    return readStdin();
  }

  return null;
}

async function getCurrentVersion(slug) {
  const response = await apiRequest(`/diagrams/${encodeURIComponent(slug)}`);
  return response.data.version;
}

function toOrigin() {
  try {
    const url = new URL(API_BASE);
    return `${url.protocol}//${url.host}`;
  } catch {
    throw new CliError('Invalid DRAW_API_URL', EXIT.INPUT);
  }
}

function diagramUrl(slug) {
  return `${toOrigin()}/d/${encodeURIComponent(slug)}`;
}

function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  let args;

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

const program = new Command();

program
  .name('draw')
  .description('CLI for Brainflow diagrams')
  .exitOverride()
  .showHelpAfterError();

program
  .command('list')
  .description('List all diagrams')
  .option('--tag <tag>', 'Filter by tag')
  .option('--search <query>', 'Full-text search')
  .option('--sort <field>', 'Sort: updated_at, created_at, title')
  .option('--order <dir>', 'Order: asc, desc')
  .option('--limit <n>', 'Max results (default 50)', (v) => Number.parseInt(v, 10), 50)
  .option('--offset <n>', 'Pagination offset', (v) => Number.parseInt(v, 10), 0)
  .option('--json', 'Output as JSON (for agents/scripts)')
  .action(async (options) => {
    if (!Number.isInteger(options.limit) || options.limit < 1) {
      throw new CliError('--limit must be a positive integer', EXIT.INPUT);
    }
    if (!Number.isInteger(options.offset) || options.offset < 0) {
      throw new CliError('--offset must be a non-negative integer', EXIT.INPUT);
    }

    const query = {
      search: options.search,
      tags: options.tag,
      sort: options.sort,
      order: options.order,
      limit: options.limit,
      offset: options.offset,
    };

    const response = await apiRequest('/diagrams', { query });
    const diagrams = response.data;

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
  .action(async (slug, options) => {
    const response = await apiRequest(`/diagrams/${encodeURIComponent(slug)}`);
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
  .option('--tag <tag>', 'Tag (repeatable)', (value, previous = []) => {
    previous.push(value);
    return previous;
  }, [])
  .option('--json', 'Output as JSON')
  .action(async (title, options) => {
    const content = await readContent(options);
    if (!content || content.trim().length === 0) {
      throw new CliError('Diagram content is required (use --file or --stdin)', EXIT.INPUT);
    }

    const payload = {
      title,
      content,
      slug: options.slug,
      description: options.description,
      tags: options.tag,
    };

    const response = await apiRequest('/diagrams', {
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
  .option('--tag <tag>', 'Replace tags (repeatable)', (value, previous = []) => {
    previous.push(value);
    return previous;
  }, undefined)
  .option('--json', 'Output as JSON')
  .action(async (slug, options) => {
    const content = await readContent(options);
    const hasTagOption = options.tag !== undefined;

    if (
      options.title === undefined
      && options.description === undefined
      && content === null
      && !hasTagOption
    ) {
      throw new CliError('No updates provided', EXIT.INPUT);
    }

    const version = await getCurrentVersion(slug);
    const payload = { version };

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

    const response = await apiRequest(`/diagrams/${encodeURIComponent(slug)}`, {
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
  .action(async (slug) => {
    const version = await getCurrentVersion(slug);
    await apiRequest(`/diagrams/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
      body: { version },
    });
    process.stdout.write(`Deleted ${slug}\n`);
  });

program
  .command('url <slug>')
  .description('Print the diagram URL to stdout')
  .action((slug) => {
    process.stdout.write(`${diagramUrl(slug)}\n`);
  });

program
  .command('open <slug>')
  .description('Open diagram in default browser')
  .action((slug) => {
    const url = diagramUrl(slug);
    openBrowser(url);
    process.stdout.write(`${url}\n`);
  });

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
        return;
      }
      process.stderr.write(`${error.message}\n`);
      process.exit(error.exitCode || EXIT.INPUT);
    }

    if (error instanceof CliError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(error.code);
    }

    process.stderr.write(`Unexpected error: ${error?.message || String(error)}\n`);
    process.exit(EXIT.GENERAL);
  }
}

await main();
