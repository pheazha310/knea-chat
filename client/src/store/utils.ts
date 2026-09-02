// Shared helpers for the Zustand stores.

/** Coerce an unknown value to a number, or null when it isn't numeric. */
export const toNumber = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Pull a readable `message` out of an axios-shaped error, falling back to a
 * default. Keeps `catch` blocks strongly typed instead of using `any`.
 */
export const getErrorMessage = (err: unknown, fallback: string): string => {
  if (err && typeof err === 'object' && 'response' in err) {
    const data = (err as { response?: { data?: { message?: string } } }).response?.data;
    if (data?.message) return data.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
};
