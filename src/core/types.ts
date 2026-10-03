/**
 * 全局约定（文档 / API / CLI 一致）：
 * - 坐标采用 1 基整数：row 行（从上到下 1..size），col 列（从左到右 1..size）。
 * - 棋盘表示为 size*size 的一维数组，下标 idx = (row-1)*size + (col-1)。
 * - 单元值：'B' 黑、'W' 白、null 空点。
 * - 行棋方 firstPlayer：'B' 黑先（默认），'W' 白先（仅测试棋盘可指定）。
 */

export type Stone = 'B' | 'W';
export type Cell = Stone | null;

export interface Point {
  row: number;
  col: number;
}

export interface Group {
  color: Stone;
  stones: Point[];
  liberties: Point[];
}

export interface BoardView {
  size: number;
  /** 二维网格 board[row-1][col-1]，单元为 'B' | 'W' | null */
  grid: Cell[][];
}

export type MoveKind = 'place' | 'pass';

export interface MoveRecord {
  moveNumber: number;
  kind: MoveKind;
  player: Stone;
  point: Point | null;
  captured: Point[];
}

export interface GameState {
  id: string;
  size: number;
  /** 冻结的规则版本，重放时沿用 */
  rulesVersion: string;
  board: Cell[];
  nextPlayer: Stone;
  /** 已完成的手数（不含尚未确认的一手） */
  moveNumber: number;
  history: Cell[][];
  moves: MoveRecord[];
  captures: { B: number; W: number };
  over: boolean;
  endReason: 'two-passes' | null;
  createdAt: string;
}

export interface PlaceOutcome {
  legal: boolean;
  reason?: IllegalReason;
  board: Cell[];
  captured: Point[];
}

export type IllegalReason =
  | 'GAME_OVER'
  | 'OUT_OF_BOUNDS'
  | 'POINT_OCCUPIED'
  | 'SUICIDE'
  | 'KO';

export const RULES_VERSION = 'simple-ko-v1';
export const SUPPORTED_SIZES = [5, 9, 13] as const;
