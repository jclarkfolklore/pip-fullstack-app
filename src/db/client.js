import initSqlJs from 'sql.js';
// Webpack inlines this as a base64 data: URI (see webpack.config.js) so the
// wasm binary never needs a runtime fetch() — Chrome blocks fetch() to
// file:// resources, but loading a data: URI works everywhere, including
// when this app is opened by double-clicking index.html.
import wasmDataUri from 'sql.js/dist/sql-wasm.wasm';
import { SCHEMA_SQL, SQLITE_USER_VERSION, SEED_WIDGETS } from './schema.js';

let SQL = null;
let db = null;
const listeners = new Set();

async function ensureSqlJs() {
  if (!SQL) {
    SQL = await initSqlJs({ locateFile: () => wasmDataUri });
  }
  return SQL;
}

function notify() {
  for (const fn of listeners) fn();
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function openDatabase(bytes) {
  await ensureSqlJs();
  db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  db.run(SCHEMA_SQL);
  seedIfEmpty();
  return db;
}

function seedIfEmpty() {
  const row = get('SELECT COUNT(*) AS n FROM widgets');
  if (row && row.n === 0) {
    for (const w of SEED_WIDGETS) {
      run(
        'INSERT INTO widgets (id, kind, title, glyph, sort_order, enabled, config_json) VALUES (?,?,?,?,?,1,?)',
        [w.id, w.kind, w.title, w.glyph, w.sort_order, '{}']
      );
    }
  }
  const version = get("SELECT value FROM app_meta WHERE key = 'schema_version'");
  if (!version) {
    run("INSERT INTO app_meta (key, value) VALUES ('schema_version', ?)", [
      String(SQLITE_USER_VERSION)
    ]);
  }
}

export function getDb() {
  if (!db) throw new Error('Database not initialized yet — call openDatabase() first.');
  return db;
}

export function run(sql, params = []) {
  db.run(sql, params);
  notify();
}

export function all(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

export function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length ? rows[0] : null;
}

export function exportDatabase() {
  return db.export();
}
