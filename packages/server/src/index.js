import pino from 'pino';
import { pool } from './db/pool.js';
import { createApp } from './app.js';
import { runMigrations } from './services/migration.js';

const PORT = Number(process.env.PORT || 3900);
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const readiness = { migrations: false };

async function main() {
  try {
    await runMigrations(pool, logger);
    readiness.migrations = true;
  } catch (error) {
    logger.error({ err: error }, 'Migration failed');
    process.exit(1);
  }

  const app = createApp({ logger, pool, readiness });
  const server = app.listen(PORT, () => {
    logger.info(`Server ready on port ${PORT}`);
  });

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
      logger.info({ signal }, 'Shutting down...');
      server.close(() => {
        pool
          .end()
          .then(() => process.exit(0))
          .catch(() => process.exit(1));
      });
      setTimeout(() => process.exit(1), 10000);
    });
  }
}

main();
