import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errors.js';
import {
  createDiagramSchema,
  deleteDiagramSchema,
  listDiagramsSchema,
  slugParamSchema,
  updateDiagramSchema,
} from '../schemas/diagram.js';
import type { DeleteDiagramInput } from '../schemas/diagram.js';
import {
  createDiagram,
  deleteDiagram,
  getDiagram,
  listDiagrams,
  restoreDiagram,
  updateDiagram,
} from '../services/diagram.js';
import type { ApiSuccess, ApiSuccessWithMeta, ListMeta } from '../types/api.js';
import type { DiagramRecord, DiagramSummary } from '../types/diagram.js';

function getDeleteVersion(req: Request): number {
  const rawBodyVersion: unknown = req.body && typeof req.body === 'object' && req.body !== null && 'version' in req.body
    ? req.body.version
    : undefined;

  if (typeof rawBodyVersion === 'number') {
    return rawBodyVersion;
  }

  const ifMatch: string | undefined = req.get('if-match');
  if (!ifMatch) {
    throw new AppError('VALIDATION_ERROR', 'Request validation failed', 400);
  }

  const version: number = Number(ifMatch);
  if (!Number.isInteger(version) || version < 1) {
    throw new AppError('VALIDATION_ERROR', 'Request validation failed', 400);
  }

  return version;
}

export function diagramsRouter(pool: Pool): Router {
  const router: Router = Router();

  router.get('/', validate({ query: listDiagramsSchema }), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = listDiagramsSchema.parse(req.query);
      const result = await listDiagrams(pool, query);
      const payload: ApiSuccessWithMeta<DiagramSummary[], ListMeta> = {
        ok: true,
        data: result.data,
        meta: {
          total: result.total,
          limit: result.limit,
          offset: result.offset,
        },
      };
      res.json(payload);
    } catch (error: unknown) {
      next(error);
    }
  });

  router.get('/:slug', validate({ params: slugParamSchema }), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = slugParamSchema.parse(req.params);
      const diagram = await getDiagram(pool, params.slug);
      res.json({ ok: true, data: diagram } satisfies ApiSuccess<DiagramRecord>);
    } catch (error: unknown) {
      next(error);
    }
  });

  router.post('/', validate({ body: createDiagramSchema }), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = createDiagramSchema.parse(req.body ?? {});
      const diagram = await createDiagram(pool, body);
      res.status(201).json({ ok: true, data: diagram } satisfies ApiSuccess<DiagramRecord>);
    } catch (error: unknown) {
      next(error);
    }
  });

  router.patch(
    '/:slug',
    validate({ params: slugParamSchema, body: updateDiagramSchema }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const params = slugParamSchema.parse(req.params);
        const body = updateDiagramSchema.parse(req.body ?? {});
        const diagram = await updateDiagram(pool, params.slug, body);
        res.json({ ok: true, data: diagram } satisfies ApiSuccess<DiagramRecord>);
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  router.delete('/:slug', validate({ params: slugParamSchema }), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = slugParamSchema.parse(req.params);
      const version: number = getDeleteVersion(req);
      const parsedVersion: DeleteDiagramInput = deleteDiagramSchema.parse({ version });
      const diagram = await deleteDiagram(pool, params.slug, parsedVersion.version);
      res.json({ ok: true, data: diagram } satisfies ApiSuccess<DiagramRecord>);
    } catch (error: unknown) {
      next(error);
    }
  });

  router.post('/:slug/restore', validate({ params: slugParamSchema }), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = slugParamSchema.parse(req.params);
      const diagram = await restoreDiagram(pool, params.slug);
      res.json({ ok: true, data: diagram } satisfies ApiSuccess<DiagramRecord>);
    } catch (error: unknown) {
      next(error);
    }
  });

  return router;
}
