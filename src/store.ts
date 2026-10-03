/**
 * SQLite 持久化层（使用 Node 内置 node:sqlite，无原生依赖）。
 *
 * games 表保存冻结的规则、初始盘、当前状态与局面历史；
 * moves 表逐步记录每手动作与被提坐标，支持重启后继续与逐步回放。
 */
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Cell, Color, Point } from "./engine";

export interface MoveRow {
  seq: number;
  color: Color;
  type: "move" | "pass";
  row: number | null;
  col: number | null;
  captured: Point[];
  boardKey: string;
}

export interface GameRow {
  id: string;
  size: number;
  rules: { ko: "simple"; suicide: "forbidden" };
  initialBoard: Cell[];
  initialTurn: Color;
  status: "playing" | "ended";
  turn: Color;
  moveCount: number;
  board: Cell[];
  capturedByBlack: number;
  capturedByWhite: number;
  consecutivePasses: number;
  history: string[];
  createdAt: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        rules_json TEXT NOT NULL,
        initial_board_json TEXT NOT NULL,
        initial_turn INTEGER NOT NULL,
        status TEXT NOT NULL,
        turn INTEGER NOT NULL,
        move_count INTEGER NOT NULL,
        board_json TEXT NOT NULL,
        captured_by_black INTEGER NOT NULL,
        captured_by_white INTEGER NOT NULL,
        consecutive_passes INTEGER NOT NULL,
        history_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS moves (
        game_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        color INTEGER NOT NULL,
        type TEXT NOT NULL,
        row INTEGER,
        col INTEGER,
        captured_json TEXT NOT NULL,
        board_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (game_id, seq)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  createGame(g: GameRow): void {
    this.db
      .prepare(
        `INSERT INTO games (id,size,rules_json,initial_board_json,initial_turn,status,turn,
           move_count,board_json,captured_by_black,captured_by_white,consecutive_passes,history_json,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        g.id, g.size, JSON.stringify(g.rules), JSON.stringify(g.initialBoard), g.initialTurn,
        g.status, g.turn, g.moveCount, JSON.stringify(g.board), g.capturedByBlack,
        g.capturedByWhite, g.consecutivePasses, JSON.stringify(g.history), g.createdAt
      );
  }

  getGame(id: string): GameRow | null {
    const r = this.db.prepare(`SELECT * FROM games WHERE id = ?`).get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      size: r.size,
      rules: JSON.parse(r.rules_json),
      initialBoard: JSON.parse(r.initial_board_json),
      initialTurn: r.initial_turn,
      status: r.status,
      turn: r.turn,
      moveCount: r.move_count,
      board: JSON.parse(r.board_json),
      capturedByBlack: r.captured_by_black,
      capturedByWhite: r.captured_by_white,
      consecutivePasses: r.consecutive_passes,
      history: JSON.parse(r.history_json),
      createdAt: r.created_at,
    };
  }

  listGames(): GameRow[] {
    const rows = this.db.prepare(`SELECT id FROM games ORDER BY created_at`).all() as any[];
    return rows.map((r) => this.getGame(r.id)!);
  }

  /** 原子提交一手：更新 games 并插入 moves，同事务。 */
  commitMove(g: GameRow, m: MoveRow): void {
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `UPDATE games SET status=?, turn=?, move_count=?, board_json=?,
             captured_by_black=?, captured_by_white=?, consecutive_passes=?, history_json=?
           WHERE id=?`
        )
        .run(
          g.status, g.turn, g.moveCount, JSON.stringify(g.board), g.capturedByBlack,
          g.capturedByWhite, g.consecutivePasses, JSON.stringify(g.history), g.id
        );
      this.db
        .prepare(
          `INSERT INTO moves (game_id,seq,color,type,row,col,captured_json,board_key,created_at)
           VALUES (?,?,?,?,?,?,?,?,?)`
        )
        .run(
          g.id, m.seq, m.color, m.type, m.row, m.col,
          JSON.stringify(m.captured), m.boardKey, new Date().toISOString()
        );
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  listMoves(gameId: string): MoveRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM moves WHERE game_id = ? ORDER BY seq`)
      .all(gameId) as any[];
    return rows.map((r) => ({
      seq: r.seq,
      color: r.color,
      type: r.type,
      row: r.row,
      col: r.col,
      captured: JSON.parse(r.captured_json),
      boardKey: r.board_key,
    }));
  }
}
