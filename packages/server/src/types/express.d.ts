import type { Logger } from 'pino';

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
    log?: Logger;
  }
}
