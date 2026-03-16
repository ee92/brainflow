import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { requestId } from './middleware/requestId.js';
import { errorHandler } from './middleware/errors.js';
import { diagramsRouter } from './routes/diagrams.js';
import { healthRouter } from './routes/health.js';
import type { ApiErrorResponse } from './types/api.js';

const __filename: string = fileURLToPath(import.meta.url);
const __dirname: string = path.dirname(__filename);

interface ReadinessState {
  migrations: boolean;
}

interface CreateAppDeps {
  logger: Logger;
  pool: Pool;
  readiness: ReadinessState;
}

export function createApp({ logger, pool, readiness }: CreateAppDeps): Express {
  const app: Express = express();
  const publicDir: string = path.join(__dirname, '../public');
  const corsOrigin: string = process.env.CORS_ORIGIN || '*';

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req: Request): string => req.id,
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 100,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req: Request, res: Response): void => {
        res.setHeader('Retry-After', '30');
        res.status(429).json({
          ok: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Try again in 30 seconds.',
            status: 429,
            requestId: req.id,
          },
        } satisfies ApiErrorResponse);
      },
    }),
  );

  app.use(cors({ origin: corsOrigin }));
  app.use(express.static(publicDir));

  app.use(healthRouter(async (): Promise<{ ok: boolean }> => {
    if (!readiness.migrations) {
      return { ok: false };
    }

    await pool.query('SELECT 1');
    return { ok: true };
  }));

  app.use('/api/v1/diagrams', diagramsRouter(pool));

  app.get('*', (req: Request, res: Response, next: NextFunction): void => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }

    if (req.path === '/healthz' || req.path === '/readyz') {
      next();
      return;
    }

    if (path.extname(req.path)) {
      next();
      return;
    }

    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use(errorHandler);

  return app;
}
