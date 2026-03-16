import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, {
  type ErrorRequestHandler,
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { requestId } from './middleware/requestId.js';
import { contextMiddleware } from './middleware/context.js';
import { errorHandler } from './middleware/errors.js';
import { diagramsRouter } from './routes/diagrams.js';
import { healthRouter } from './routes/health.js';
import type { BrainflowConfig } from './types/context.js';
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
  config?: BrainflowConfig;
}

/**
 * Create a configured Brainflow Express application.
 *
 * Self-hosted: pass only logger, pool, and readiness. All defaults apply.
 * Cloud: pass a BrainflowConfig with getContext hook for auth/workspace resolution.
 */
export function createApp({ logger, pool, readiness, config }: CreateAppDeps): Express {
  const app: Express = express();
  const publicDir: string = path.join(__dirname, '../public');
  const corsOrigin: string = config?.corsOrigin ?? process.env.CORS_ORIGIN ?? '*';
  const jsonParser: Function = express.json({ limit: '1mb' });
  const staticHandler: Function = express.static(publicDir);
  const corsHandler: Function = cors({ origin: corsOrigin });
  const httpLogger: Function = pinoHttp();
  const rateLimitHandler: Function = rateLimit({
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
          requestId: String(req.id),
        },
      } satisfies ApiErrorResponse);
    },
  });

  const adaptMiddleware = (middleware: Function): RequestHandler => {
    return (req: Request, res: Response, next: NextFunction): void => {
      Reflect.apply(middleware, undefined, [req, res, (): void => next()]);
    };
  };
  const handleErrors: ErrorRequestHandler = errorHandler;

  app.use(requestId);
  app.use(adaptMiddleware(httpLogger));
  app.use(adaptMiddleware(jsonParser));
  app.use(adaptMiddleware(rateLimitHandler));
  app.use(adaptMiddleware(corsHandler));
  app.use(contextMiddleware(config?.getContext));
  app.use(adaptMiddleware(staticHandler));

  app.use(healthRouter(async (): Promise<{ ok: boolean }> => {
    if (!readiness.migrations) {
      return { ok: false };
    }

    await pool.query('SELECT 1');
    return { ok: true };
  }));

  app.use('/api/v1/diagrams', diagramsRouter(pool, config?.hooks));

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

  app.use(handleErrors);

  return app;
}
