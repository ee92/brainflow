import type { AppContext } from './context.js';

declare global {
  namespace Express {
    interface Request {
      /** Per-request context resolved by contextMiddleware. */
      ctx: AppContext;
    }
  }
}

