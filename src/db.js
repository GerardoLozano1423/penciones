import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function openDatabase(databasePath) {
  const resolved = path.resolve(databasePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  seedAdmin(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS calculations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      customer_name TEXT NOT NULL,
      nss TEXT,
      engine_version TEXT NOT NULL,
      input_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS calculation_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      calculation_id INTEGER NOT NULL REFERENCES calculations(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
      customer_name TEXT NOT NULL,
      nss TEXT,
      engine_version TEXT NOT NULL,
      input_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(calculation_id, version_number)
    );
  `);

  ensureColumn(db, 'calculations', 'current_version', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'calculations', 'updated_at', 'TEXT');
  seedCalculationVersions(db);
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function seedCalculationVersions(db) {
  const missing = db.prepare(`
    SELECT calculations.*
    FROM calculations
    LEFT JOIN calculation_versions ON calculation_versions.calculation_id = calculations.id
    WHERE calculation_versions.id IS NULL
  `).all();

  const insert = db.prepare(`
    INSERT INTO calculation_versions (
      calculation_id, version_number, user_id, customer_name, nss, engine_version,
      input_json, result_json, notes, created_at
    )
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction((rows) => {
    rows.forEach((row) => {
      insert.run(
        row.id,
        row.user_id,
        row.customer_name,
        row.nss,
        row.engine_version,
        row.input_json,
        row.result_json,
        row.notes,
        row.created_at
      );
    });
  });

  transaction(missing);
}

function seedAdmin(db) {
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!exists) {
    const passwordHash = bcrypt.hashSync(password, 12);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
  }
}

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  return { token, expiresAt };
}

export function getSessionUser(db, token) {
  if (!token) return null;
  return db.prepare(`
    SELECT users.id, users.username
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ? AND sessions.expires_at > CURRENT_TIMESTAMP
  `).get(token) || null;
}

export function deleteSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function cleanupSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP').run();
}
