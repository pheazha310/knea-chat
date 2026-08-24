/**
 * KneaChat — tiny CommonJS module-stubbing helper for unit tests.
 *
 * Node's built-in test runner gives us per-test mocking (t.mock.method) but no
 * module replacement. This helper seeds `Module._cache` BEFORE the module under
 * test is required, so its `require(...)` calls resolve to our stub objects
 * instead of the real (database-touching) modules. No new dependencies needed.
 *
 * IMPORTANT: `node --test` runs each test file in its own process, so seeding
 * here never leaks across test files. Within one file, seed once (in `before`)
 * and then override individual methods with `t.mock.method` per test.
 */
import Module from 'module';
import path from 'path';

const BASE_DIR = __dirname;

/** Private Module internals we need for cache seeding (not in the public types). */
interface ModuleInternals {
  _resolveFilename(request: string, options: { paths: string[] }): string;
  _cache: Record<string, NodeModule>;
}

const internals = Module as unknown as ModuleInternals;

/** Resolve a module path (relative to this file) exactly as Node would. */
const resolve = (modulePath: string): string =>
  internals._resolveFilename(path.resolve(BASE_DIR, modulePath), { paths: [BASE_DIR] });

/**
 * Seed a stub in the require cache. Call BEFORE requiring any module that
 * depends on `modulePath`.
 *
 * @param modulePath - Path relative to this helper (e.g. '../src/repositories/messageRepository')
 * @param stubValue - Object to return for every require of that module
 */
export const seed = (modulePath: string, stubValue: unknown): unknown => {
  const resolved = resolve(modulePath);
  internals._cache[resolved] = { exports: stubValue } as unknown as NodeModule;
  return stubValue;
};
