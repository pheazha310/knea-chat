/**
 * Error sanitization helpers.
 *
 * Database errors (mysql2) carry raw SQL, table/column names, credentials
 * (access-denied messages), and connection details in `message`/`sqlMessage`.
 * These must never be echoed back to the client — see SRS security
 * requirements. App-level errors thrown by services are safe user-facing
 * strings and pass through unchanged.
 */

/** True when the error originated from the database layer (mysql2 etc.). */
export const isDatabaseError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const err = error as { sqlMessage?: unknown; code?: string };
  // mysql2 query errors expose sqlMessage/sql on the error object.
  if (err.sqlMessage !== undefined) return true;
  const code = err.code || '';
  return /^(ER_|ECONN|PROTOCOL|ETIMEDOUT|EHOST|ENOTFOUND|EPIPE|EAI_|ETIMEDOUT)/.test(code);
};

/**
 * Return a client-safe message for an error: the original message for
 * app-level errors, a generic one for database-layer errors.
 */
export const getSafeErrorMessage = (error: unknown): string => {
  if (isDatabaseError(error)) {
    return 'Database operation failed. Please try again.';
  }
  return error instanceof Error && error.message ? error.message : 'Internal server error';
};

/**
 * A client-facing validation / business-rule rejection (HTTP 400). Services
 * throw these instead of plain Errors so the global error handler responds
 * 400 with the safe message instead of a generic 500.
 */
export const badRequest = (message: string): Error => {
  return Object.assign(new Error(message), { statusCode: 400 });
};
