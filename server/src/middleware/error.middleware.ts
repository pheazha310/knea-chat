/**
 * Error Handling Middleware
 * Centralized error handler for all routes. Database-layer error messages are
 * sanitized so raw SQL / credentials never reach the client.
 */
import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { getSafeErrorMessage } from '../utils/errors.utils';

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const err = error as { message?: string; stack?: string; name?: string; code?: string; statusCode?: number; errors?: Record<string, unknown> };
  console.error(`[ERROR] ${err.message}`, err.stack);

  // Default error response. Never echo raw DB/SQL error messages to the
  // client — sanitize anything that originated from the database layer.
  let statusCode = 500;
  let message = 'Internal server error';
  let errors: Record<string, unknown> = { server: getSafeErrorMessage(error) };

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 422;
    message = 'Validation failed';
    errors = (err.errors as Record<string, unknown>) || {};
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid ID format';
    errors = { id: 'Invalid identifier' };
  } else if (err.code === 'ER_DUP_ENTRY') {
    statusCode = 409;
    message = 'Resource already exists';
    errors = { duplicate: 'This resource already exists' };
  } else if (err.statusCode) {
    statusCode = err.statusCode;
    message = err.message || 'Error';
    errors = err.errors || {};
  }

  // Send error response
  res.status(statusCode).json({
    success: false,
    message,
    errors,
  });
};

/**
 * Custom API Error class
 */
export class APIError extends Error {
  statusCode: number;
  errors: Record<string, unknown>;

  constructor(message: string, statusCode = 500, errors: Record<string, unknown> = {}) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.name = 'APIError';
  }
}
