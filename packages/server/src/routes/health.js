import { Router } from 'express';

export function healthRouter(getReadiness) {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  router.get('/readyz', async (_req, res, next) => {
    try {
      const ready = await getReadiness();
      if (!ready.ok) {
        return res.status(503).json({ ok: false, db: 'disconnected', migrations: 'pending' });
      }
      return res.json({ ok: true, db: 'connected', migrations: 'current' });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
