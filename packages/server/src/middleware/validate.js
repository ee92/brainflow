import { ZodError } from 'zod';
import { AppError } from './errors.js';

function isContentTooLarge(issues) {
  return issues.some((issue) => issue.path?.[0] === 'content' && issue.code === 'too_big');
}

export function validate({ body, query, params } = {}) {
  return (req, _res, next) => {
    try {
      if (params) {
        req.params = params.parse(req.params);
      }
      if (query) {
        req.query = query.parse(req.query);
      }
      if (body) {
        req.body = body.parse(req.body ?? {});
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        if (isContentTooLarge(error.issues)) {
          return next(new AppError('PAYLOAD_TOO_LARGE', 'Content exceeds 500KB', 413));
        }
        return next(new AppError('VALIDATION_ERROR', 'Request validation failed', 400, error.issues));
      }
      return next(error);
    }
  };
}
