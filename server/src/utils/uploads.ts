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

/**
 * Shared upload file-policy (SRS §19: validate file type and size).
 *
 * The internal chat upload (message.controller) and the omni-channel media
 * relay (omni.controller) must accept the SAME files — the composer offers
 * the same paperclip in both. One source of truth keeps them from drifting
 * (the omni endpoint originally missed text/pdf and agents got a confusing
 * 400 for plain .txt files).
 */

/** Extensions accepted by default; overridable via ALLOWED_FILE_TYPES. */
export const ALLOWED_FILE_TYPES = (
  process.env.ALLOWED_FILE_TYPES ||
  'jpg,jpeg,png,gif,webp,pdf,doc,docx,xls,xlsx,txt,csv,zip,mp3,m4a,wav,ogg,oga,opus,webm,aac'
).split(',').map((t) => t.trim().toLowerCase());

/** MIME families accepted by default. */
const ALLOWED_MIME_PREFIXES = ['image/', 'audio/', 'video/', 'text/'];

/** Exact MIME types accepted by default (no useful prefix family). */
const ALLOWED_MIME_EXACT = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
]);

/** The hard byte ceiling (MAX_FILE_SIZE, default 10 MB). */
export const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '10485760', 10);

/** True when the file's extension + content type are both allowed. */
export function isAllowedUpload(file: { originalname: string; mimetype?: string }): boolean {
  const ext = path.extname(file.originalname).toLowerCase().slice(1);
  if (!ALLOWED_FILE_TYPES.includes(ext)) return false;
  const mime = (file.mimetype || '').toLowerCase();
  return ALLOWED_MIME_EXACT.has(mime) || ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p));
}

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
