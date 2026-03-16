import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodIssue, type ZodType } from 'zod';
import { AppError } from './errors.js';

interface ValidateOptions {
  body?: ZodType<unknown>;
  query?: ZodType<unknown>;
  params?: ZodType<unknown>;
}

function isContentTooLarge(issues: ZodIssue[]): boolean {
  return issues.some((issue: ZodIssue): boolean => issue.path[0] === 'content' && issue.code === 'too_big');
}

export function validate(options: ValidateOptions = {}): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (options.params) {
        options.params.parse(req.params);
      }
      if (options.query) {
        options.query.parse(req.query);
      }
      if (options.body) {
        options.body.parse(req.body ?? {});
      }
      next();
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        if (isContentTooLarge(error.issues)) {
          next(new AppError('PAYLOAD_TOO_LARGE', 'Content exceeds 500KB', 413));
          return;
        }

        next(new AppError('VALIDATION_ERROR', 'Request validation failed', 400, error.issues));
        return;
      }

      next(error);
    }
  };
}
