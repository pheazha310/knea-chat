/**
 * Shared uploads-directory resolution.
 *
 * The upload writers (message/task/shared-file/user controllers + the
 * omni-channel media store) and the `/uploads` static route in app.ts must all
 * agree on one directory, or files land somewhere the client can never fetch —
 * historically `dist/uploads` for omni media (a 404) and `dist/var/...` under
 * tests. One helper keeps them in lockstep.
 *
 * Resolution order:
 *  1. An *absolute* UPLOAD_DIR env var wins (tests rely on this).
 *  2. Otherwise it is resolved relative to the server package root, found by
 *     walking up from this compiled file (`dist/src/utils/uploads.js`) until a
 *     package.json containing `"name": "kneachat-backend"` is located. Walking
 *     is what makes the path stable no matter where dist/ nests the file, so
 *     nobody has to keep `..` counts in sync across modules again.
 */
import fs from 'fs';
import path from 'path';

const PACKAGE_NAME = 'kneachat-backend';
let cachedPackageRoot: string | null = null;

/** Locate the server package root (the dir holding server/package.json). */
function findServerRoot(): string {
  if (cachedPackageRoot) return cachedPackageRoot;
  let dir = __dirname;
  while (true) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        if (JSON.parse(fs.readFileSync(pkg, 'utf8')).name === PACKAGE_NAME) {
          cachedPackageRoot = dir;
          return cachedPackageRoot;
        }
      } catch {
        // Unreadable/invalid package.json — keep walking up.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      // Reached the filesystem root; fall back to cwd rather than looping.
      cachedPackageRoot = process.cwd();
      break;
    }
    dir = parent;
  }
  return cachedPackageRoot;
}

/**
 * The single uploads directory: absolute UPLOAD_DIR wins, otherwise relative
 * to the server package root (e.g. `<server>/uploads`).
 */
export function resolveUploadDir(): string {
  const configured = process.env.UPLOAD_DIR?.trim();
  if (configured && path.isAbsolute(configured)) return configured;
  return path.join(findServerRoot(), configured || 'uploads');
}
