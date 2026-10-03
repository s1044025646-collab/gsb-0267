import type { DatabaseSync } from 'node:sqlite';
import { Cell, GameState, MoveRecord, Point, Stone } from '../core/types';
import {
  applyPass,
  applyPlace,
  createState,
  NewGameInput,
  RuleError,
} from '../core/engine';

interface GameRow {
  id: string;
  size: number;
  rules_version: string;
  initial_board: string;
  first_player: Stone;
  move_number: number;
  next_player: Stone;
  captures_b: number;
  captures_w: number;
  over: number;
  end_reason: string | null;
  created_at: string;
}

interface MoveRow {
  game_id: string;
  move_number: number;
  kind: 'place' | 'pass';
  player: Stone;
  row: number | null;
  col: number | null;
  captured: string;
  board_after: string;
}

function encode(board: Cell[]): string {
  return board.map((c) => (c === null ? '.' : c)).join('');
}

function decode(text: string): Cell[] {
  return [...text].map<Cell>((ch) => (ch === '.' ? null : (ch as Stone)));
}

function encodePoints(points: Point[]): string {
  return JSON.stringify(points);
}

export class GameRepository {
  constructor(private db: DatabaseSync) {}

  create(input: NewGameInput): GameState {
    const state = createState(input, new Date().toISOString());
    this.db
      .prepare(
        `INSERT INTO games (id, size, rules_version, initial_board, first_player,
           move_number, next_player, captures_b, captures_w, over, end_reason, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, 0, 0, 0, NULL, ?)`,
      )
      .run(
        state.id,
        state.size,
        state.rulesVersion,
        encode(state.history[0]),
        state.nextPlayer,
        state.nextPlayer,
        state.createdAt,
      );
    return state;
  }

  /** 从库中重建状态：读取初始盘与全部动作，用规则引擎逐步重放。 */
  load(id: string): GameState {
    const row = this.db.prepare('SELECT * FROM games WHERE id = ?').get(id) as GameRow | undefined;
    if (!row) throw new RuleError('NOT_FOUND', `对局不存在：${id}`);
    const moveRows = this.db
      .prepare('SELECT * FROM moves WHERE game_id = ? ORDER BY move_number')
      .all(id) as unknown as MoveRow[];

    const state: GameState = {
      id: row.id,
      size: row.size,
      rulesVersion: row.rules_version,
      board: decode(row.initial_board),
      nextPlayer: row.first_player,
      moveNumber: 0,
      history: [decode(row.initial_board)],
      moves: [],
      captures: { B: 0, W: 0 },
      over: false,
      endReason: null,
      createdAt: row.created_at,
    };

    for (const mr of moveRows) {
      if (mr.kind === 'pass') {
        applyPass(state, mr.player);
      } else {
        const point = { row: mr.row!, col: mr.col! };
        applyPlace(state, mr.player, point);
      }
    }
    return state;
  }

  /**
   * 原子提交一手：在事务内再次校验当前步号（乐观并发），
   * 重放得到的棋盘/提子必须与动作结果一致。任何异常整体回滚。
   */
  commitPlace(
    id: string,
    expectedMove: number,
    player: Stone,
    point: Point,
  ): { state: GameState; move: MoveRecord; captured: Point[] } {
    const tx = this.db.prepare('BEGIN IMMEDIATE');
    try {
      tx.run();
      const before = this.load(id);
      if (before.moveNumber !== expectedMove) {
        this.db.exec('ROLLBACK');
        throw new RuleError(
          'CONFLICT',
          `期望步号 ${expectedMove} 与当前步号 ${before.moveNumber} 不一致，该请求已过期`,
        );
      }
      const result = applyPlace(before, player, point);
      const move = result.move;
      this.db
        .prepare(
          `INSERT INTO moves (game_id, move_number, kind, player, row, col, captured, board_after)
           VALUES (?, ?, 'place', ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          move.moveNumber,
          player,
          point.row,
          point.col,
          encodePoints(move.captured),
          encode(before.board),
        );
      this.db
        .prepare(
          `UPDATE games SET move_number = ?, next_player = ?,
             captures_b = ?, captures_w = ?, over = ?, end_reason = ? WHERE id = ?`,
        )
        .run(
          before.moveNumber,
          before.nextPlayer,
          before.captures.B,
          before.captures.W,
          before.over ? 1 : 0,
          before.endReason,
          id,
        );
      this.db.exec('COMMIT');
      return { state: before, move, captured: result.captured };
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* 事务可能已结束 */
      }
      throw err;
    }
  }

  commitPass(id: string, expectedMove: number, player: Stone): { state: GameState; move: MoveRecord } {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const before = this.load(id);
      if (before.moveNumber !== expectedMove) {
        this.db.exec('ROLLBACK');
        throw new RuleError(
          'CONFLICT',
          `期望步号 ${expectedMove} 与当前步号 ${before.moveNumber} 不一致，该请求已过期`,
        );
      }
      const move = applyPass(before, player);
      this.db
        .prepare(
          `INSERT INTO moves (game_id, move_number, kind, player, row, col, captured, board_after)
           VALUES (?, ?, 'pass', ?, NULL, NULL, '[]', ?)`,
        )
        .run(id, move.moveNumber, player, encode(before.board));
      this.db
        .prepare(
          `UPDATE games SET move_number = ?, next_player = ?, over = ?, end_reason = ? WHERE id = ?`,
        )
        .run(before.moveNumber, before.nextPlayer, before.over ? 1 : 0, before.endReason, id);
      this.db.exec('COMMIT');
      return { state: before, move };
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  /** 按保存动作重放并与落库的局面摘要逐手核对。 */
  verifyIntegrity(id: string): { ok: true; moves: number } | { ok: false; mismatchAt: number } {
    const state = this.load(id);
    const rows = this.db
      .prepare('SELECT board_after, captured FROM moves WHERE game_id = ? ORDER BY move_number')
      .all(id) as Array<{ board_after: string; captured: string }>;
    for (let i = 0; i < rows.length; i++) {
      const expected = decode(rows[i].board_after);
      const actual = state.history[i + 1];
      if (
        expected.length !== actual.length ||
        expected.some((v, j) => v !== actual[j])
      ) {
        return { ok: false, mismatchAt: i + 1 };
      }
    }
    return { ok: true, moves: rows.length };
  }

  exportRecord(id: string) {
    const state = this.load(id);
    const row = this.db.prepare('SELECT first_player FROM games WHERE id = ?').get(id) as {
      first_player: Stone;
    };
    return {
      id: state.id,
      size: state.size,
      rulesVersion: state.rulesVersion,
      firstPlayer: row.first_player,
      createdAt: state.createdAt,
      initialBoard: state.history[0],
      moves: state.moves,
      finalBoard: state.board,
      nextPlayer: state.nextPlayer,
      captures: state.captures,
      over: state.over,
      endReason: state.endReason,
    };
  }

  list(): Array<{ id: string; size: number; moveNumber: number; over: boolean }> {
    const rows = this.db
      .prepare('SELECT id, size, move_number, over FROM games ORDER BY created_at')
      .all() as Array<{ id: string; size: number; move_number: number; over: number }>;
    return rows.map((r) => ({ id: r.id, size: r.size, moveNumber: r.move_number, over: r.over === 1 }));
  }

}
