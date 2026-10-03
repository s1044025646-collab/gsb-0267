/**
 * 对局服务：组合规则引擎与持久化，提供创建/预览/确认/停手/回放/导出。
 * 所有错误以 { code, message } 抛出（ServiceError），由 API/CLI 统一映射。
 */
import { randomUUID } from "node:crypto";
import {
  allGroups, applyMove, boardKey, emptyBoard, isValidSize, other,
  validateInitialBoard, type Cell, type Color, type Group, type Point,
} from "./engine";
import { Store, type GameRow, type MoveRow } from "./store";

export class ServiceError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface GameView {
  id: string;
  size: number;
  rules: GameRow["rules"];
  status: "playing" | "ended";
  turn: Color;
  moveCount: number;
  nextSeq: number;
  board: Cell[];
  capturedByBlack: number;
  capturedByWhite: number;
  consecutivePasses: number;
  createdAt: string;
}

function toView(g: GameRow): GameView {
  return {
    id: g.id,
    size: g.size,
    rules: g.rules,
    status: g.status,
    turn: g.turn,
    moveCount: g.moveCount,
    nextSeq: g.moveCount + 1,
    board: g.board,
    capturedByBlack: g.capturedByBlack,
    capturedByWhite: g.capturedByWhite,
    consecutivePasses: g.consecutivePasses,
    createdAt: g.createdAt,
  };
}

export class GameService {
  constructor(private store: Store) {}

  private mustGet(id: string): GameRow {
    const g = this.store.getGame(id);
    if (!g) throw new ServiceError("NOT_FOUND", `对局 ${id} 不存在`);
    return g;
  }

  createGame(opts: { size: number; initialBoard?: Cell[]; initialTurn?: Color }): GameView {
    if (!isValidSize(opts.size)) {
      throw new ServiceError("INVALID_SIZE", "棋盘路数必须是 5/9/13");
    }
    const board = opts.initialBoard ?? emptyBoard(opts.size);
    const v = validateInitialBoard(opts.size, board);
    if (!v.ok) throw new ServiceError(v.code, v.message);
    const initialTurn = opts.initialTurn ?? 1;
    if (initialTurn !== 1 && initialTurn !== 2) {
      throw new ServiceError("BAD_REQUEST", "initialTurn 只能是 1(黑) 或 2(白)");
    }
    const g: GameRow = {
      id: randomUUID().slice(0, 8),
      size: opts.size,
      rules: { ko: "simple", suicide: "forbidden" },
      initialBoard: board.slice(),
      initialTurn,
      status: "playing",
      turn: initialTurn,
      moveCount: 0,
      board: board.slice(),
      capturedByBlack: 0,
      capturedByWhite: 0,
      consecutivePasses: 0,
      history: [boardKey(board)],
      createdAt: new Date().toISOString(),
    };
    this.store.createGame(g);
    return toView(g);
  }

  getGame(id: string): GameView {
    return toView(this.mustGet(id));
  }

  listGames(): GameView[] {
    return this.store.listGames().map(toView);
  }

  getGroups(id: string): { size: number; groups: Group[] } {
    const g = this.mustGet(id);
    return { size: g.size, groups: allGroups(g.size, g.board) };
  }

  /** 预览落子：只计算，不写入。 */
  previewMove(id: string, row: number, col: number) {
    const g = this.mustGet(id);
    if (g.status === "ended") throw new ServiceError("GAME_OVER", "对局已结束");
    const r = applyMove(g.size, g.board, g.turn, row, col, g.history);
    if (!r.ok) return { ok: false as const, code: r.code, message: r.message };
    return {
      ok: true as const,
      color: g.turn,
      captured: r.captured,
      board: r.board,
      nextTurn: other(g.turn),
    };
  }

  private checkSeq(g: GameRow, expectedSeq: number): void {
    if (!Number.isInteger(expectedSeq)) {
      throw new ServiceError("BAD_REQUEST", "expectedSeq 必须是整数");
    }
    if (expectedSeq !== g.moveCount + 1) {
      throw new ServiceError(
        "SEQ_CONFLICT",
        `期望步号 ${expectedSeq} 与当前下一步 ${g.moveCount + 1} 不一致，请求被拒绝`
      );
    }
  }

  /** 确认落子：校验期望步号，原子写入。 */
  confirmMove(id: string, row: number, col: number, expectedSeq: number) {
    const g = this.mustGet(id);
    if (g.status === "ended") throw new ServiceError("GAME_OVER", "对局已结束");
    this.checkSeq(g, expectedSeq);
    const r = applyMove(g.size, g.board, g.turn, row, col, g.history);
    if (!r.ok) throw new ServiceError(r.code, r.message);

    const color = g.turn;
    g.board = r.board;
    g.moveCount += 1;
    g.turn = other(color);
    g.consecutivePasses = 0;
    if (color === 1) g.capturedByBlack += r.captured.length;
    else g.capturedByWhite += r.captured.length;
    const key = boardKey(g.board);
    g.history.push(key);
    const move: MoveRow = {
      seq: g.moveCount, color, type: "move", row, col, captured: r.captured, boardKey: key,
    };
    this.store.commitMove(g, move);
    return { move, game: toView(g) };
  }

  /** 停一手：记录并切换行棋方；不做单劫检查，但按普通一步更新历史。 */
  pass(id: string, expectedSeq: number) {
    const g = this.mustGet(id);
    if (g.status === "ended") throw new ServiceError("GAME_OVER", "对局已结束");
    this.checkSeq(g, expectedSeq);

    const color = g.turn;
    g.moveCount += 1;
    g.turn = other(color);
    g.consecutivePasses += 1;
    if (g.consecutivePasses >= 2) g.status = "ended";
    const key = boardKey(g.board);
    g.history.push(key);
    const move: MoveRow = { seq: g.moveCount, color, type: "pass", row: null, col: null, captured: [], boardKey: key };
    this.store.commitMove(g, move);
    return { move, game: toView(g) };
  }

  /**
   * 回放到第 n 手（n=0 为初始盘）。只读计算，不修改当前局面。
   * 使用创建时冻结的规则与初始盘重新执行保存的动作。
   */
  replay(id: string, toSeq?: number) {
    const g = this.mustGet(id);
    const moves = this.store.listMoves(id);
    const n = toSeq === undefined ? moves.length : toSeq;
    if (!Number.isInteger(n) || n < 0 || n > moves.length) {
      throw new ServiceError("BAD_REQUEST", `步号必须在 0..${moves.length} 之间`);
    }
    let board = g.initialBoard.slice();
    let history = [boardKey(board)];
    let capturedByBlack = 0;
    let capturedByWhite = 0;
    const applied: MoveRow[] = [];
    for (let i = 0; i < n; i++) {
      const m = moves[i];
      if (m.type === "move") {
        const r = applyMove(g.size, board, m.color, m.row!, m.col!, history);
        if (!r.ok) {
          throw new ServiceError("REPLAY_FAILED", `第 ${m.seq} 手回放失败: ${r.message}`);
        }
        board = r.board;
        if (m.color === 1) capturedByBlack += r.captured.length;
        else capturedByWhite += r.captured.length;
      }
      history.push(boardKey(board));
      applied.push(m);
    }
    return {
      id: g.id,
      size: g.size,
      seq: n,
      board,
      capturedByBlack,
      capturedByWhite,
      moves: applied,
    };
  }

  /** 导出棋谱 JSON。 */
  export(id: string) {
    const g = this.mustGet(id);
    const moves = this.store.listMoves(id);
    return {
      id: g.id,
      size: g.size,
      rules: g.rules,
      initialTurn: g.initialTurn,
      initialBoard: g.initialBoard,
      status: g.status,
      moveCount: g.moveCount,
      capturedByBlack: g.capturedByBlack,
      capturedByWhite: g.capturedByWhite,
      moves,
      createdAt: g.createdAt,
    };
  }
}
