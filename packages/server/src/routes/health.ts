import { Router, type NextFunction, type Request, type Response } from 'express';

interface ReadinessStatus {
  ok: boolean;
}

interface ReadinessProvider {
  (): Promise<ReadinessStatus>;
}

export function healthRouter(getReadiness: ReadinessProvider): Router {
  const router: Router = Router();

  router.get('/healthz', (_req: Request, res: Response): void => {
    res.json({ ok: true });
  });

  router.get('/readyz', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ready: ReadinessStatus = await getReadiness();
      if (!ready.ok) {
        res.status(503).json({ ok: false, db: 'disconnected', migrations: 'pending' });
        return;
      }

      res.json({ ok: true, db: 'connected', migrations: 'current' });
    } catch (error: unknown) {
      next(error);
    }
  });

  return router;
}
