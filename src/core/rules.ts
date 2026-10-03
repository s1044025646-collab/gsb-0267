import {
  Cell,
  Point,
  Stone,
  PlaceOutcome,
  IllegalReason,
} from './types';
import {
  idx,
  inBounds,
  neighbors,
  findGroup,
  cloneBoard,
  boardsEqual,
  opponent,
} from './board';

/**
 * 计算落子结果（不修改入参）。
 * 顺序：占用/越界检查 → 放子 → 移除相邻的所有无气对方棋串（去重）
 *      → 己方新棋串仍无气则自杀 → 单劫比较。
 * 一个对方棋串可能从多个方向接触新子，借助已处理棋串的种子点去重，
 * 保证不会重复提取或重复计数。
 */
export function evaluatePlace(
  board: Cell[],
  size: number,
  player: Stone,
  point: Point,
  history: Cell[][],
): PlaceOutcome {
  const fail = (reason: IllegalReason): PlaceOutcome => ({
    legal: false,
    reason,
    board: cloneBoard(board),
    captured: [],
  });

  if (!inBounds(size, point.row, point.col)) return fail('OUT_OF_BOUNDS');
  if (board[idx(size, point.row, point.col)] !== null) return fail('POINT_OCCUPIED');

  const next = cloneBoard(board);
  next[idx(size, point.row, point.col)] = player;

  // 收集相邻对方棋串（同串只处理一次）
  const captured: Point[] = [];
  const handledStones = new Set<number>();
  const enemy = opponent(player);
  for (const n of neighbors(size, point.row, point.col)) {
    const ni = idx(size, n.row, n.col);
    if (next[ni] !== enemy || handledStones.has(ni)) continue;
    const group = findGroup(next, size, n);
    group.stones.forEach((s) => handledStones.add(idx(size, s.row, s.col)));
    if (group.liberties.length === 0) {
      for (const s of group.stones) {
        next[idx(size, s.row, s.col)] = null;
        captured.push(s);
      }
    }
  }
  captured.sort((a, b) => a.row - b.row || a.col - b.col);

  // 提子后检查己方新棋串
  const own = findGroup(next, size, point);
  if (own.liberties.length === 0) return fail('SUICIDE');

  // 固定简单单劫：落子后棋盘不得等于上上个局面（对方上一手落子前的棋盘）。
  // history 为每手落子前的局面序列；比较目标为 history[history.length - 2]。
  if (history.length >= 2) {
    const target = history[history.length - 2];
    if (boardsEqual(next, target)) return fail('KO');
  }

  return { legal: true, board: next, captured };
}
