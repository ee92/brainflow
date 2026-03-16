import type { AppContext } from './context.js';

declare global {
  namespace Express {
    interface Request {
      ctx: AppContext;
    }
  }
}
