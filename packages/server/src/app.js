import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { requestId } from './middleware/requestId.js';
import { errorHandler } from './middleware/errors.js';
import { diagramsRouter } from './routes/diagrams.js';
import { healthRouter } from './routes/health.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp({ logger, pool, readiness }) {
  const app = express();
  const publicDir = path.join(__dirname, '../public');
  const corsOrigin = process.env.CORS_ORIGIN || '*';

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 100,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        res.setHeader('Retry-After', '30');
        res.status(429).json({
          ok: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Try again in 30 seconds.',
            status: 429,
            requestId: req.id,
          },
        });
      },
    }),
  );
  app.use(cors({ origin: corsOrigin }));

  app.use(express.static(publicDir));
  app.use(healthRouter(async () => {
    if (!readiness.migrations) {
      return { ok: false };
    }

    await pool.query('SELECT 1');
    return { ok: true };
  }));

  app.use('/api/v1/diagrams', diagramsRouter(pool));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }
    if (req.path === '/healthz' || req.path === '/readyz') {
      return next();
    }
    if (path.extname(req.path)) {
      return next();
    }
    return res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use(errorHandler);

  return app;
}
