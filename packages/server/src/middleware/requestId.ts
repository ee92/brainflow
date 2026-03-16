import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id: string = randomUUID();
  req.id = id;
  res.setHeader('X-Request-ID', id);
  next();
}
