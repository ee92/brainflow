import type { NextFunction, Request, Response } from 'express';
import { DEFAULT_CONTEXT, type AppContext } from '../types/context.js';

/**
 * Creates middleware that resolves AppContext for every request.
 * The resolved context is attached to req.ctx for use in routes and services.
 *
 * @param getContext - Custom resolver (provided by cloud layer), or undefined for default.
 */
export function contextMiddleware(
  getContext?: (req: Request) => Promise<AppContext>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!getContext) {
      req.ctx = DEFAULT_CONTEXT;
      next();
      return;
    }

    getContext(req)
      .then((ctx: AppContext): void => {
        req.ctx = ctx;
        next();
      })
      .catch((error: unknown): void => {
        next(error);
      });
  };
}
