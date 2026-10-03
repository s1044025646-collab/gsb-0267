/**
 * 小棋盘围棋规则引擎（纯函数，无 IO）。
 *
 * 坐标约定（文档 / API / CLI 一致）：
 *   - row、col 均为 1 基。
 *   - row 从上到下递增，col 从左到右递增。
 *   - 仅横竖四邻接。
 */

export type Color = 1 | 2; // 1=黑 2=白
export type Cell = 0 | Color;

export const BLACK: Color = 1;
export const WHITE: Color = 2;

export function other(color: Color): Color {
  return color === BLACK ? WHITE : BLACK;
}

export interface Point {
  row: number;
  col: number;
}

export interface Group {
  color: Color;
  stones: Point[];
  liberties: Point[]; // 去重后的气
}

export const BOARD_SIZES = [5, 9, 13] as const;
export type BoardSize = (typeof BOARD_SIZES)[number];

export function isValidSize(size: number): size is BoardSize {
  return (BOARD_SIZES as readonly number[]).includes(size);
}

export function emptyBoard(size: number): Cell[] {
  return new Array<Cell>(size * size).fill(0);
}

export function boardKey(cells: Cell[]): string {
  return cells.join("");
}

export function inBounds(size: number, row: number, col: number): boolean {
  return row >= 1 && row <= size && col >= 1 && col <= size;
}

function idx(size: number, row: number, col: number): number {
  return (row - 1) * size + (col - 1);
}

export function getCell(size: number, cells: Cell[], row: number, col: number): Cell {
  return cells[idx(size, row, col)];
}

export function neighbors(size: number, row: number, col: number): Point[] {
  const out: Point[] = [];
  if (row > 1) out.push({ row: row - 1, col });
  if (row < size) out.push({ row: row + 1, col });
  if (col > 1) out.push({ row, col: col - 1 });
  if (col < size) out.push({ row, col: col + 1 });
  return out;
}

/** 计算某点所在的相连棋串及其去重后的气。 */
export function groupAt(size: number, cells: Cell[], row: number, col: number): Group | null {
  const color = getCell(size, cells, row, col);
  if (color === 0) return null;
  const stones: Point[] = [];
  const libSeen = new Set<number>();
  const liberties: Point[] = [];
  const visited = new Set<number>();
  const stack: Point[] = [{ row, col }];
  visited.add(idx(size, row, col));
  while (stack.length > 0) {
    const p = stack.pop()!;
    stones.push(p);
    for (const n of neighbors(size, p.row, p.col)) {
      const c = getCell(size, cells, n.row, n.col);
      const ni = idx(size, n.row, n.col);
      if (c === 0) {
        if (!libSeen.has(ni)) {
          libSeen.add(ni);
          liberties.push(n);
        }
      } else if (c === color && !visited.has(ni)) {
        visited.add(ni);
        stack.push(n);
      }
    }
  }
  return { color, stones, liberties };
}

/** 列出全盘所有棋串（每串只出现一次）。 */
export function allGroups(size: number, cells: Cell[]): Group[] {
  const visited = new Set<number>();
  const groups: Group[] = [];
  for (let row = 1; row <= size; row++) {
    for (let col = 1; col <= size; col++) {
      const i = idx(size, row, col);
      if (visited.has(i) || cells[i] === 0) continue;
      const g = groupAt(size, cells, row, col)!;
      for (const s of g.stones) visited.add(idx(size, s.row, s.col));
      groups.push(g);
    }
  }
  return groups;
}

export type MoveError = "OUT_OF_BOUNDS" | "OCCUPIED" | "SUICIDE" | "KO";

export interface AppliedMove {
  ok: true;
  board: Cell[];
  captured: Point[];
}

export interface RejectedMove {
  ok: false;
  code: MoveError;
  message: string;
}

export type MoveResult = AppliedMove | RejectedMove;

/**
 * 尝试在 (row, col) 落 color 子。
 * 规则：先移除所有因该手无气的对方棋串（同一串多点接触只提一次），
 * 再检查己方新棋串；提子后有气则合法，否则自杀拒绝。
 * koHistory 为局面键历史（含初始局面，最后一项为当前局面）；
 * 简单单劫：落子后的棋盘不得等于 history[len-2]。
 */
export function applyMove(
  size: number,
  cells: Cell[],
  color: Color,
  row: number,
  col: number,
  koHistory: string[]
): MoveResult {
  if (!inBounds(size, row, col)) {
    return { ok: false, code: "OUT_OF_BOUNDS", message: `坐标 (${row},${col}) 超出 ${size} 路棋盘` };
  }
  if (getCell(size, cells, row, col) !== 0) {
    return { ok: false, code: "OCCUPIED", message: `坐标 (${row},${col}) 已有棋子` };
  }

  const next = cells.slice();
  next[idx(size, row, col)] = color;

  // 1) 提走无气的对方棋串（用 visited 去重，避免同一串被重复提取/计数）
  const captured: Point[] = [];
  const checked = new Set<number>();
  for (const n of neighbors(size, row, col)) {
    const ni = idx(size, n.row, n.col);
    if (checked.has(ni)) continue;
    if (getCell(size, next, n.row, n.col) !== other(color)) continue;
    const g = groupAt(size, next, n.row, n.col)!;
    for (const s of g.stones) checked.add(idx(size, s.row, s.col));
    if (g.liberties.length === 0) {
      for (const s of g.stones) {
        next[idx(size, s.row, s.col)] = 0;
        captured.push(s);
      }
    }
  }

  // 2) 检查己方新棋串的气
  const own = groupAt(size, next, row, col)!;
  if (own.liberties.length === 0) {
    return { ok: false, code: "SUICIDE", message: `(${row},${col}) 落子后己方棋串无气，自杀禁着` };
  }

  // 3) 简单单劫：不能还原到上上个局面
  const key = boardKey(next);
  if (koHistory.length >= 2 && key === koHistory[koHistory.length - 2]) {
    return { ok: false, code: "KO", message: "单劫禁着：不能立即还原到对方上一手落子前的局面" };
  }

  return { ok: true, board: next, captured };
}

/** 校验测试初始棋盘：尺寸、单元值、每个已有棋串至少一口气。 */
export function validateInitialBoard(
  size: number,
  cells: Cell[]
): { ok: true } | { ok: false; code: string; message: string } {
  if (!isValidSize(size)) {
    return { ok: false, code: "INVALID_SIZE", message: `棋盘路数必须是 ${BOARD_SIZES.join("/")}` };
  }
  if (!Array.isArray(cells) || cells.length !== size * size) {
    return { ok: false, code: "INVALID_BOARD", message: `棋盘必须包含 ${size * size} 个单元` };
  }
  for (const c of cells) {
    if (c !== 0 && c !== 1 && c !== 2) {
      return { ok: false, code: "INVALID_BOARD", message: "棋盘单元只能是 0(空)/1(黑)/2(白)" };
    }
  }
  for (const g of allGroups(size, cells)) {
    if (g.liberties.length === 0) {
      const s = g.stones[0];
      return {
        ok: false,
        code: "INVALID_BOARD",
        message: `初始棋盘中 (${s.row},${s.col}) 所在棋串无气，非法`,
      };
    }
  }
  return { ok: true };
}
