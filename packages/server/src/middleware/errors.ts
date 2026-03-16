import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorResponse } from '../types/api.js';

export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;

  public constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

interface EntityTooLargeError {
  type: string;
}

function isEntityTooLargeError(error: unknown): error is EntityTooLargeError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  if (!('type' in error)) {
    return false;
  }

  return typeof error.type === 'string' && error.type === 'entity.too.large';
}

function payloadTooLargeError(req: Request): ApiErrorResponse {
  return {
    ok: false,
    error: {
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Content exceeds 500KB',
      status: 413,
      requestId: req.id,
    },
  };
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): Response {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        status: err.status,
        requestId: req.id,
      },
    } satisfies ApiErrorResponse);
  }

  if (isEntityTooLargeError(err)) {
    return res.status(413).json(payloadTooLargeError(req));
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        status: 400,
        requestId: req.id,
      },
    } satisfies ApiErrorResponse);
  }

  req.log?.error({ err }, 'Unhandled error');
  return res.status(500).json({
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Unexpected server error',
      status: 500,
      requestId: req.id,
    },
  } satisfies ApiErrorResponse);
}
