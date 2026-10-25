import 'server-only';
import { createRequire } from 'node:module';
import type { DatabaseSync as SQLiteDatabase } from 'node:sqlite';

import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Vitest 2 会剥离新内置模块的 node: 前缀，使用原生加载器保留它。
const { DatabaseSync } = createRequire(import.meta.url)(
  'node:sqlite'
) as typeof import('node:sqlite');

let current: SQLiteDatabase | undefined;
let currentPath: string | undefined;
export function databasePath() {
  return resolve(process.env.SQLITE_PATH || './data/putv.sqlite');
}
export function database() {
  const path = databasePath();
  if (current && currentPath === path) return current;
  current?.close();
  let opened: SQLiteDatabase | undefined;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const db = (opened = new DatabaseSync(path));
    chmodSync(path, 0o600);
    db.exec(
      'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;'
    );
    db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)'
    );
    db.exec('BEGIN IMMEDIATE');
    try {
      if (
        !db.prepare('SELECT 1 FROM schema_migrations WHERE version=1').get()
      ) {
        db.exec(`
          CREATE TABLE accounts (
            id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
            password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user')),
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
          );
          CREATE TABLE profiles (
            id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
            name TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT 'preset:blue',
            is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
          );
          CREATE UNIQUE INDEX profiles_default ON profiles(account_id) WHERE is_default=1;
          CREATE INDEX profiles_owner ON profiles(account_id);
          CREATE TABLE sessions (
            id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, revoked_at INTEGER,
            created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL,
            selected_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
            device_id TEXT NOT NULL, user_agent TEXT NOT NULL DEFAULT ''
          );
          CREATE INDEX sessions_account ON sessions(account_id);
          CREATE INDEX sessions_device ON sessions(account_id,device_id,created_at);
          CREATE TRIGGER sessions_profile_insert BEFORE INSERT ON sessions
            WHEN NEW.selected_profile_id IS NOT NULL AND NOT EXISTS
              (SELECT 1 FROM profiles WHERE id=NEW.selected_profile_id AND account_id=NEW.account_id)
            BEGIN SELECT RAISE(ABORT, 'session profile ownership'); END;
          CREATE TRIGGER sessions_profile_update BEFORE UPDATE OF selected_profile_id,account_id ON sessions
            WHEN NEW.selected_profile_id IS NOT NULL AND NOT EXISTS
              (SELECT 1 FROM profiles WHERE id=NEW.selected_profile_id AND account_id=NEW.account_id)
            BEGIN SELECT RAISE(ABORT, 'session profile ownership'); END;
          CREATE INDEX sessions_expiry ON sessions(expires_at);
          CREATE TABLE auth_attempts (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
        `);
        db.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(Date.now());
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    current = db;
    currentPath = path;
    return db;
  } catch (error) {
    opened?.close();
    current = undefined;
    throw new Error(
      'SQLite 无法初始化或写入，请检查 SQLITE_PATH 和持久化目录权限',
      { cause: error }
    );
  }
}
export function transaction<T>(fn: () => T): T {
  const db = database();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export function closeDatabase() {
  current?.close();
  current = undefined;
  currentPath = undefined;
}
