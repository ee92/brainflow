import pino, { type Logger } from 'pino';
import type { Server } from 'node:http';
import { pool } from './db/pool.js';
import { createApp } from './app.js';
import { runMigrations } from './services/migration.js';

const PORT: number = Number(process.env.PORT || 3900);
const logger: Logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const readiness: { migrations: boolean } = { migrations: false };

function isError(error: unknown): error is Error {
  return error instanceof Error;
}

async function shutdown(server: Server): Promise<void> {
  await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
    server.close((error?: Error): void => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  await pool.end();
}

async function main(): Promise<void> {
  try {
    await runMigrations(pool, logger);
    readiness.migrations = true;
  } catch (error: unknown) {
    logger.error({ err: error }, 'Migration failed');
    process.exit(1);
  }

  const app = createApp({ logger, pool, readiness });
  const server: Server = app.listen(PORT, (): void => {
    logger.info(`Server ready on port ${PORT}`);
  });

  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  for (const signal of signals) {
    process.on(signal, (): void => {
      logger.info({ signal }, 'Shutting down...');
      shutdown(server)
        .then((): never => process.exit(0))
        .catch((): never => process.exit(1));

      setTimeout((): never => process.exit(1), 10000);
    });
  }
}

main().catch((error: unknown): never => {
  if (isError(error)) {
    logger.error({ err: error }, 'Unhandled startup error');
  } else {
    logger.error({ err: String(error) }, 'Unhandled startup error');
  }

  process.exit(1);
});
