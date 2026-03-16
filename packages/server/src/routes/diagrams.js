import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errors.js';
import {
  createDiagramSchema,
  updateDiagramSchema,
  deleteDiagramSchema,
  listDiagramsSchema,
  slugParamSchema,
} from '../schemas/diagram.js';
import {
  createDiagram,
  deleteDiagram,
  getDiagram,
  listDiagrams,
  restoreDiagram,
  updateDiagram,
} from '../services/diagram.js';

function getDeleteVersion(req) {
  if (req.body && req.body.version !== undefined) {
    return req.body.version;
  }

  const ifMatch = req.get('if-match');
  if (!ifMatch) {
    throw new AppError('VALIDATION_ERROR', 'Request validation failed', 400);
  }

  const version = Number(ifMatch);
  if (!Number.isInteger(version) || version < 1) {
    throw new AppError('VALIDATION_ERROR', 'Request validation failed', 400);
  }

  return version;
}

export function diagramsRouter(pool) {
  const router = Router();

  router.get('/', validate({ query: listDiagramsSchema }), async (req, res, next) => {
    try {
      const result = await listDiagrams(pool, req.query);
      res.json({ ok: true, data: result.data, meta: { total: result.total, limit: result.limit, offset: result.offset } });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:slug', validate({ params: slugParamSchema }), async (req, res, next) => {
    try {
      const diagram = await getDiagram(pool, req.params.slug);
      res.json({ ok: true, data: diagram });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', validate({ body: createDiagramSchema }), async (req, res, next) => {
    try {
      const diagram = await createDiagram(pool, req.body);
      res.status(201).json({ ok: true, data: diagram });
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    '/:slug',
    validate({ params: slugParamSchema, body: updateDiagramSchema }),
    async (req, res, next) => {
      try {
        const diagram = await updateDiagram(pool, req.params.slug, req.body);
        res.json({ ok: true, data: diagram });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete('/:slug', validate({ params: slugParamSchema }), async (req, res, next) => {
    try {
      const version = getDeleteVersion(req);
      deleteDiagramSchema.parse({ version });
      const diagram = await deleteDiagram(pool, req.params.slug, version);
      res.json({ ok: true, data: diagram });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:slug/restore', validate({ params: slugParamSchema }), async (req, res, next) => {
    try {
      const diagram = await restoreDiagram(pool, req.params.slug);
      res.json({ ok: true, data: diagram });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
