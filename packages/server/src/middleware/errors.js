import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(code, message, status, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function payloadTooLargeError(req) {
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

export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        status: err.status,
        requestId: req.id,
      },
    });
  }

  if (err?.type === 'entity.too.large') {
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
    });
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
  });
}
