import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let dbInstance: DatabaseSync | null = null;

export function openDb(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      size INTEGER NOT NULL,
      rules_version TEXT NOT NULL,
      initial_board TEXT NOT NULL,
      first_player TEXT NOT NULL,
      move_number INTEGER NOT NULL DEFAULT 0,
      next_player TEXT NOT NULL,
      captures_b INTEGER NOT NULL DEFAULT 0,
      captures_w INTEGER NOT NULL DEFAULT 0,
      over INTEGER NOT NULL DEFAULT 0,
      end_reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS moves (
      game_id TEXT NOT NULL,
      move_number INTEGER NOT NULL,
      kind TEXT NOT NULL,
      player TEXT NOT NULL,
      row INTEGER,
      col INTEGER,
      captured TEXT NOT NULL,
      board_after TEXT NOT NULL,
      PRIMARY KEY (game_id, move_number),
      FOREIGN KEY (game_id) REFERENCES games(id)
    );
  `);
  return db;
}

export function getDb(dbPath: string): DatabaseSync {
  if (!dbInstance) dbInstance = openDb(dbPath);
  return dbInstance;
}

export function resetDbForTests(): void {
  dbInstance = null;
}
