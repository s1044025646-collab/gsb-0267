import { Cell, Point, Stone, Group, BoardView, SUPPORTED_SIZES } from './types';

export function isSupportedSize(size: number): boolean {
  return (SUPPORTED_SIZES as readonly number[]).includes(size);
}

export function idx(size: number, row: number, col: number): number {
  return (row - 1) * size + (col - 1);
}

export function inBounds(size: number, row: number, col: number): boolean {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 1 && row <= size && col >= 1 && col <= size;
}

export function emptyBoard(size: number): Cell[] {
  return new Array<Cell>(size * size).fill(null);
}

export function cloneBoard(board: Cell[]): Cell[] {
  return board.slice();
}

export function boardsEqual(a: Cell[], b: Cell[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 横竖四邻接，不含对角。 */
export function neighbors(size: number, row: number, col: number): Point[] {
  const out: Point[] = [];
  if (row > 1) out.push({ row: row - 1, col });
  if (row < size) out.push({ row: row + 1, col });
  if (col > 1) out.push({ row, col: col - 1 });
  if (col < size) out.push({ row, col: col + 1 });
  return out;
}

/**
 * 从指定起点泛洪求棋串及不重复气集合。
 * 气点以点坐标去重（共享气只计一次）。
 */
export function findGroup(board: Cell[], size: number, start: Point): Group {
  const color = board[idx(size, start.row, start.col)] as Stone;
  const seen = new Set<number>();
  const stones: Point[] = [];
  const libSet = new Set<number>();
  const liberties: Point[] = [];
  const stack: Point[] = [start];
  seen.add(idx(size, start.row, start.col));

  while (stack.length) {
    const p = stack.pop()!;
    stones.push(p);
    for (const n of neighbors(size, p.row, p.col)) {
      const ni = idx(size, n.row, n.col);
      const v = board[ni];
      if (v === color && !seen.has(ni)) {
        seen.add(ni);
        stack.push(n);
      } else if (v === null && !libSet.has(ni)) {
        libSet.add(ni);
        liberties.push(n);
      }
    }
  }
  stones.sort((a, b) => a.row - b.row || a.col - b.col);
  liberties.sort((a, b) => a.row - b.row || a.col - b.col);
  return { color, stones, liberties };

}

/** 列出全盘所有棋串（每个棋串只出现一次）。 */
export function allGroups(board: Cell[], size: number): Group[] {
  const visited = new Set<number>();
  const groups: Group[] = [];
  for (let row = 1; row <= size; row++) {
    for (let col = 1; col <= size; col++) {
      const i = idx(size, row, col);
      const v = board[i];
      if (v === null || visited.has(i)) continue;
      const g = findGroup(board, size, { row, col });
      g.stones.forEach((s) => visited.add(idx(size, s.row, s.col)));
      groups.push(g);
    }
  }
  return groups;
}

/** 校验初始/测试棋盘：尺寸、单元值、每个已有棋串至少一口气。 */
export function validateInitialBoard(size: number, grid: unknown): { board?: Cell[]; error?: string } {
  if (!isSupportedSize(size)) {
    return { error: `不支持的棋盘尺寸 ${size}，仅支持 5、9、13` };
  }
  if (grid === null || grid === undefined) {
    return { board: emptyBoard(size) };
  }
  if (!Array.isArray(grid) || grid.length !== size || !grid.every((r) => Array.isArray(r) && r.length === size)) {
    return { error: `grid 必须是 ${size}x${size} 的二维数组` };
  }
  const board: Cell[] = emptyBoard(size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const v = (grid as unknown[][])[r][c];
      if (v === null || v === 'B' || v === 'W') {
        board[r * size + c] = v as Cell;
      } else {
        return { error: `单元值非法于 row=${r + 1}, col=${c + 1}：仅允许 'B'、'W'、null` };
      }
    }
  }
  for (const g of allGroups(board, size)) {
    if (g.liberties.length === 0) {
      const p = g.stones[0];
      return { error: `初始棋盘存在无气棋串（${g.color}）于 row=${p.row}, col=${p.col}` };
    }
  }
  return { board };
}

export function toGrid(board: Cell[], size: number): Cell[][] {
  const grid: Cell[][] = [];
  for (let r = 0; r < size; r++) grid.push(board.slice(r * size, r * size + size));
  return grid;
}

export function boardView(board: Cell[], size: number): BoardView {
  return { size, grid: toGrid(board, size) };
}

export function opponent(color: Stone): Stone {
  return color === 'B' ? 'W' : 'B';
}
