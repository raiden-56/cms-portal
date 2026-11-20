import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { isProd } from '../config/env';
import { HttpError, tooManyRequests } from '../lib/errors';
import { clientIp } from '../lib/http';
import { logger, redis } from '../lib/infra';

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  req.requestId = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

export const requestLogger: RequestHandler = (req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
    logger[level]({ id: req.requestId, method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Math.round(ms) }, 'request');
  });
  next();
};

/**
 * Fixed-window rate limiter backed by Redis, so limits hold across API instances.
 * `key` returns the bucket identity for the request; returning null skips limiting.
 */
export function rateLimit(opts: { name: string; limit: number | ((req: Request) => number); windowSeconds: number; key: (req: Request) => string | null }): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const identity = opts.key(req);
    if (!identity) return next();
    const limit = typeof opts.limit === 'function' ? opts.limit(req) : opts.limit;
    const window = Math.floor(Date.now() / 1000 / opts.windowSeconds);
    const redisKey = `rl:${opts.name}:${identity}:${window}`;
    let count: number;
    try {
      count = await redis.incr(redisKey);
      if (count === 1) await redis.expire(redisKey, opts.windowSeconds + 1);
    } catch (err) {
      // Failing open keeps content delivery available if Redis blips; the error is logged.
      logger.error({ err: (err as Error).message }, 'rate limiter unavailable');
      return next();
    }
    const resetIn = opts.windowSeconds - (Math.floor(Date.now() / 1000) % opts.windowSeconds);
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - count)));
    res.setHeader('X-RateLimit-Reset', String(resetIn));
    if (count > limit) {
      res.setHeader('Retry-After', String(resetIn));
      throw tooManyRequests('Rate limit exceeded. Slow down and retry shortly.');
    }
    next();
  };
}

export const ipKey = (req: Request) => clientIp(req) ?? 'unknown';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}`, requestId: req.requestId } });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let code = 'internal_error';
  let message = 'Something went wrong on our side';
  let details: unknown;

  if (err instanceof HttpError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    code = err.code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'upload_error';
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the maximum upload size' : err.message;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      status = 409;
      code = 'conflict';
      message = 'A record with the same unique value already exists';
      details = { fields: err.meta?.target };
    } else if (err.code === 'P2025') {
      status = 404;
      code = 'not_found';
      message = 'Resource not found';
    } else if (err.code === 'P2003') {
      status = 409;
      code = 'conflict';
      message = 'This record is still referenced by other data';
    } else if (err.code === 'P2023') {
      status = 404;
      code = 'not_found';
      message = 'Resource not found';
    }
  } else if (err instanceof Prisma.PrismaClientValidationError) {
    status = 400;
    code = 'bad_request';
    message = 'Malformed request';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'invalid_json';
    message = 'Request body is not valid JSON';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'payload_too_large';
    message = 'Request body is too large';
  }

  if (status >= 500) {
    logger.error({ id: req.requestId, err: { message: err?.message, stack: err?.stack } }, 'unhandled error');
  }
  if (res.headersSent) return;
  res.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      requestId: req.requestId,
      ...(status >= 500 && !isProd ? { debug: err?.message } : {}),
    },
  });
};
