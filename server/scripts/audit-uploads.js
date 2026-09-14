#!/usr/bin/env node
/**
 * Audit /uploads/ references across the database (READ-ONLY).
 *
 * Discovers every character/text/json column, pulls values that reference
 * /uploads/..., and checks each referenced file against the uploads directory
 * the server resolves (server/uploads by default, or UPLOAD_DIR when absolute).
 *
 * Broken rows are grouped by table/column with their primary key so they can
 * be inspected or repaired later. Nothing is written to the DB or the disk.
 *
 * Usage: node scripts/audit-uploads.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT || '3306', 10);
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'kneachat';

// Mirror the server's resolution: absolute UPLOAD_DIR wins, else <server>/uploads.
const configured = (process.env.UPLOAD_DIR || '').trim();
const UPLOAD_DIR =
  configured && path.isAbsolute(configured)
    ? configured
    : path.join(__dirname, '..', configured || 'uploads');

// Columns that hold large free-form values are worth scanning, but skip the
// huge ones we never store upload URLs in to keep the scan cheap.
const SKIP_TABLES = new Set(['schema_migrations']);
const JSON_URL_RE = /"(?:file_url|fileUrl|url|avatar|logo|profile_picture|photo)"\s*:\s*"(\/uploads\/[^"]+)"/g;
const BARE_URL_RE = /\/uploads\/[A-Za-z0-9._\-]+\.[A-Za-z0-9]{1,6}/g;

/** Normalize a driver row to lowercase keys (MariaDB returns UPPER_CASE
 * keys from information_schema; aliases keep their given case). */
function norm(row) {
  const out = {};
  for (const k of Object.keys(row)) out[k.toLowerCase()] = row[k];
  return out;
}

/** Extract every distinct /uploads/<name> reference from a raw column value. */
function extractUploadRefs(value) {
  if (typeof value !== 'string' || !value.includes('/uploads/')) return [];
  const refs = new Set();
  for (const m of value.matchAll(JSON_URL_RE)) refs.add(m[1]);
  for (const m of value.matchAll(BARE_URL_RE)) refs.add(m[0]);
  return [...refs];
}

async function main() {
  const pool = mysql.createPool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    connectionLimit: 4,
  });

  try {
    // 1. Discover candidate columns (char/text/json, excluding binary blobs
    //    and id-ish columns which can never hold a URL).
    const [colsRaw] = await pool.query(
      `SELECT table_name, column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = ?
          AND data_type IN ('char','varchar','text','mediumtext','longtext','json')
          AND column_name NOT LIKE '%_id'
          AND column_name NOT IN ('id','password','token_hash','email')
        ORDER BY table_name, column_name`,
      [DB_NAME],
    );
    const cols = colsRaw.map(norm);

    const candidates = cols.filter(
      (c) => !SKIP_TABLES.has(c.table_name) && !/_hash$/.test(c.column_name),
    );

    console.log(`Scanning ${candidates.length} columns in ${candidates.length ? new Set(candidates.map((c) => c.table_name)).size : 0} tables (db=${DB_NAME})`);
    console.log(`Uploads dir: ${UPLOAD_DIR}`);
    console.log('');

    // 2. Scan each column; collect references with row identity.
    /** @type {Map<string, { table: string, column: string, pk: string|number, url: string }[]>} */
    const broken = new Map();
    let totalRefs = 0;
    let scannedTables = new Set();

    for (const col of candidates) {
      const t = `\`${col.table_name}\``;
      const c = `\`${col.column_name}\``;
      scannedTables.add(col.table_name);

      // Primary key for row identity — prefer id, else first char/int column
      // is unreliable, so fall back to ROW identifiers via all PK parts.
      let pkCols;
      try {
        const [pkRaw] = await pool.query(
          `SELECT column_name FROM information_schema.key_column_usage
            WHERE table_schema = ? AND table_name = ? AND constraint_name = 'PRIMARY'
            ORDER BY ordinal_position`,
          [DB_NAME, col.table_name],
        );
        pkCols = pkRaw.map(norm);
      } catch {
        pkCols = [];
      }
      const pkNames = pkCols.map((r) => r.column_name);
      const selectPk = pkNames.length
        ? pkNames.map((p) => `\`${p}\``).join(", ' # ', ") + ' AS row_id'
        : `CONCAT('row ', ROW_NUMBER() OVER ()) AS row_id`;

      let rows;
      try {
        [rows] = await pool.query(
          `SELECT ${selectPk}, ${c} AS value FROM ${t} WHERE ${c} LIKE '%/uploads/%'`,
        );
      } catch (err) {
        console.warn(`  ! skipping ${col.table_name}.${col.column_name}: ${err.message}`);
        continue;
      }

      for (const row of rows) {
        for (const url of extractUploadRefs(row.value)) {
          totalRefs += 1;
          const fileName = path.basename(url);
          const exists = fs.existsSync(path.join(UPLOAD_DIR, fileName));
          if (!exists) {
            const key = `${col.table_name}.${col.column_name}`;
            if (!broken.has(key)) broken.set(key, []);
            broken.get(key).push({ table: col.table_name, column: col.column_name, pk: String(row.row_id), url });
          }
        }
      }
    }

    // 3. Report.
    console.log(`Scanned tables: ${scannedTables.size}`);
    console.log(`/uploads/ references found: ${totalRefs}`);
    console.log('');

    if (broken.size === 0) {
      console.log('✅ No broken /uploads/ references — every stored URL resolves to a file on disk.');
      return;
    }

    let brokenCount = 0;
    console.log(`❌ Broken references (${broken.size} table.column groups):`);
    for (const [key, entries] of broken) {
      console.log(`\n  ${key} — ${entries.length} broken`);
      for (const e of entries) {
        brokenCount += 1;
        console.log(`    [${e.table}#${e.pk}] ${e.url}`);
      }
    }
    console.log(`\nTotal broken: ${brokenCount} of ${totalRefs} references.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Audit failed:', err.message);
  process.exit(1);
});
