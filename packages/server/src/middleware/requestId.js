import { randomUUID } from 'node:crypto';

export function requestId(req, res, next) {
  const id = randomUUID();
  req.id = id;
  res.setHeader('X-Request-ID', id);
  next();
}
