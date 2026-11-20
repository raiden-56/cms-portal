export interface ErrorDetail {
  path?: string;
  message: string;
  code?: string;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetail[] | Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, details?: ErrorDetail[]) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Authentication required') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do that') => new HttpError(403, 'forbidden', message);
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (message: string, details?: Record<string, unknown>) => new HttpError(409, 'conflict', message, details);
export const unprocessable = (message: string, details?: ErrorDetail[]) => new HttpError(422, 'validation_failed', message, details);
export const tooManyRequests = (message = 'Too many requests') => new HttpError(429, 'rate_limited', message);
