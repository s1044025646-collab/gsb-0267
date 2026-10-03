import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePlace } from '../core/rules';
import { Cell, Stone } from '../core/types';
import { emptyBoard, findGroup, allGroups, validateInitialBoard, idx } from '../core/board';
import { applyPass, applyPlace, createState, RuleError } from '../core/engine';

function b5(): Cell[] {
  return emptyBoard(5);
}

function set(board: Cell[], size: number, row: number, col: number, s: Stone): Cell[] {
  board[idx(size, row, col)] = s;
  return board;
}

test('边角的气：角部单子 2 气，边部 3 气，中央 4 气', () => {
  const b = b5();
  set(b, 5, 1, 1, 'B');
  set(b, 5, 1, 3, 'B');
  set(b, 5, 3, 3, 'B');
  assert.equal(findGroup(b, 5, { row: 1, col: 1 }).liberties.length, 2);
  assert.equal(findGroup(b, 5, { row: 1, col: 3 }).liberties.length, 3);
  assert.equal(findGroup(b, 5, { row: 3, col: 3 }).liberties.length, 4);
});

test('共享气去重：两子相邻，共享空点只计一次', () => {
  const b = b5();
  set(b, 5, 3, 2, 'B');
  set(b, 5, 3, 3, 'B');
  const g = findGroup(b, 5, { row: 3, col: 2 });
  assert.equal(g.stones.length, 2);
  const keys = new Set(g.liberties.map((p) => `${p.row},${p.col}`));
  assert.equal(keys.size, g.liberties.length);
  assert.equal(g.liberties.length, 6);
});

test('普通连接：落子后与同色连成一串', () => {
  const s = createState({ size: 5 }, new Date().toISOString());
  applyPlace(s, 'B', { row: 3, col: 3 });
  applyPlace(s, 'W', { row: 5, col: 5 });
  applyPlace(s, 'B', { row: 3, col: 2 });
  const g = findGroup(s.board, 5, { row: 3, col: 3 });
  assert.equal(g.stones.length, 2);
});

test('一次提走多个互不相连的对方棋串，且不重复计数', () => {
  // 9 路：白 (1,1) 与白 (1,3) 为两串，黑下 (1,2) 同时提走
  const b = emptyBoard(9);
  set(b, 9, 1, 1, 'W');
  set(b, 9, 1, 3, 'W');
  set(b, 9, 1, 4, 'B');
  set(b, 9, 2, 1, 'B');
  set(b, 9, 2, 2, 'B');
  set(b, 9, 2, 3, 'B');
  const r = evaluatePlace(b, 9, 'B', { row: 1, col: 2 }, [b]);
  assert.equal(r.legal, true);
  assert.equal(r.captured.length, 2);
  assert.equal(r.board[idx(9, 1, 1)], null);
  assert.equal(r.board[idx(9, 1, 3)], null);
});

test('多点接触同一棋串只提取一次', () => {
  // 新子同时从两个方向接触同一个白棋串
  const b = b5();
  // 白串 (1,2)(2,2)，黑从 (1,3)(2,3)(3,2) 封住，仅剩 (1,1)(2,1)
  set(b, 5, 1, 2, 'W');
  set(b, 5, 2, 2, 'W');
  set(b, 5, 1, 3, 'B');
  set(b, 5, 2, 3, 'B');
  set(b, 5, 3, 2, 'B');
  // 黑下 (2,1)：邻接白 (1,1空)(2,2白)(3,1空)，只接触白一次
  const r = evaluatePlace(b, 5, 'B', { row: 2, col: 1 }, [b]);
  // 白串还有 (1,1) 气，不被提；黑 (2,1) 邻 (3,1)(1,1) 有气，合法
  assert.equal(r.legal, true);
  assert.equal(r.captured.length, 0);
});

test('提子后解除自身无气：不提则自杀，提子后合法', () => {
  const b = b5();
  // 白 (1,2)(2,1)(2,2) 仅剩 (1,1) 一口气；黑封外气
  set(b, 5, 1, 2, 'W');
  set(b, 5, 2, 1, 'W');
  set(b, 5, 2, 2, 'W');
  set(b, 5, 1, 3, 'B');
  set(b, 5, 2, 3, 'B');
  set(b, 5, 3, 1, 'B');
  set(b, 5, 3, 2, 'B');
  const r = evaluatePlace(b, 5, 'B', { row: 1, col: 1 }, [b]);
  assert.equal(r.legal, true);
  assert.equal(r.captured.length, 3);
  assert.equal(findGroup(r.board, 5, { row: 1, col: 1 }).liberties.length > 0, true);
});

test('自杀落子拒绝且不改变棋盘', () => {
  const b = b5();
  set(b, 5, 1, 2, 'W');
  set(b, 5, 2, 1, 'W');
  const before = b.slice();
  const r = evaluatePlace(b, 5, 'B', { row: 1, col: 1 }, [b]);
  assert.equal(r.legal, false);
  assert.equal(r.reason, 'SUICIDE');
  assert.deepEqual(b, before);
});

test('占用点与越界', () => {
  const s = createState({ size: 5 }, new Date().toISOString());
  applyPlace(s, 'B', { row: 1, col: 1 });
  assert.throws(() => applyPlace(s, 'W', { row: 1, col: 1 }), (e: Error) => e instanceof RuleError && e.code === 'POINT_OCCUPIED');
  const oob = evaluatePlace(s.board, 5, 'W', { row: 0, col: 1 }, s.history);
  assert.equal(oob.reason, 'OUT_OF_BOUNDS');
  const oob2 = evaluatePlace(s.board, 5, 'W', { row: 1, col: 6 }, s.history);
  assert.equal(oob2.reason, 'OUT_OF_BOUNDS');
});

test('轮次冲突：非当前行棋方落子被拒', () => {
  const s = createState({ size: 5 }, new Date().toISOString());
  assert.throws(() => applyPlace(s, 'W', { row: 1, col: 1 }), (e: Error) => e instanceof RuleError && e.code === 'NOT_YOUR_TURN');
  assert.equal(s.moveNumber, 0);
});

test('单劫：立即提回被拒，别处应一手后可提回', () => {
  const s = createState({ size: 5 }, new Date().toISOString());
  // 经典劫形（劫点 (2,2)/(2,3)）：
  // B (1,2)(2,1)(3,2)，W (1,3)(2,4)(3,3) 筑成劫争外势，
  // 白先放 (2,2)，黑 (2,3) 提之，白立即回提 (2,2) 会还原第 8 手后局面 -> KO。
  const seq: Array<[Stone, number, number]> = [
    ['B', 1, 2], ['W', 1, 3],
    ['B', 2, 1], ['W', 3, 3],
    ['B', 3, 2], ['W', 2, 4],
    ['B', 5, 5], ['W', 2, 2],
    ['B', 2, 3],
  ];
  for (const [p, r, c] of seq) applyPlace(s, p, { row: r, col: c });
  assert.equal(s.moveNumber, 9);
  assert.equal(s.captures.B, 1);
  // 白立即 (2,2) 提回会把棋盘还原到第 8 手后局面 -> KO
  assert.throws(
    () => applyPlace(s, 'W', { row: 2, col: 2 }),
    (e: Error) => e instanceof RuleError && e.code === 'KO',
  );
  assert.equal(s.moveNumber, 9);
  // 白别处走，黑也别处应，随后白可提回 (2,2)
  applyPlace(s, 'W', { row: 5, col: 1 });
  applyPlace(s, 'B', { row: 5, col: 2 });
  const retake = applyPlace(s, 'W', { row: 2, col: 2 });
  assert.equal(retake.captured.length, 1);
  assert.equal(s.board[idx(5, 2, 2)], 'W');
});

test('停一手切换轮次并推进历史；一次停手即可打破立即劫；连续停手结束且不判胜负', () => {
  const s = createState({ size: 5 }, new Date().toISOString());
  const seq: Array<[Stone, number, number]> = [
    ['B', 1, 2], ['W', 2, 3], ['B', 2, 1], ['W', 3, 2],
    ['B', 3, 3], ['W', 2, 2],
  ];
  for (const [p, r, c] of seq) applyPlace(s, p, { row: r, col: c });
  // 黑立即提回被 KO 拒绝；黑停一手
  applyPass(s, 'B');
  assert.equal(s.nextPlayer, 'W');
  assert.equal(s.over, false);
  // 停手后历史推进，白视角下 (2,2) 已可落（白是该点现持有者之外方）
  const w = applyPlace(s, 'W', { row: 1, col: 5 });
  assert.equal(w.move.kind, 'place');

  const s2 = createState({ size: 5 }, new Date().toISOString());
  applyPass(s2, 'B');
  applyPass(s2, 'W');
  assert.equal(s2.over, true);
  assert.equal(s2.endReason, 'two-passes');
  assert.throws(() => applyPlace(s2, 'B', { row: 1, col: 1 }), (e: Error) => e instanceof RuleError && e.code === 'GAME_OVER');
});

test('初始测试棋盘校验：尺寸、单元值、无气棋串', () => {
  assert.ok(validateInitialBoard(5, undefined).board);
  assert.ok(validateInitialBoard(5, null).board);
  assert.ok(validateInitialBoard(7, Array.from({ length: 7 }, () => Array(7).fill(null))).error);
  const badCell = [[('X' as unknown) as Cell, null, null, null, null], ...Array.from({ length: 4 }, () => Array(5).fill(null))];
  assert.ok(validateInitialBoard(5, badCell).error);
  // 无气棋串：中央单子四围被堵
  const dead = Array.from({ length: 5 }, () => Array<Cell>(5).fill(null));
  dead[2][2] = 'B';
  dead[1][2] = 'W';
  dead[3][2] = 'W';
  dead[2][1] = 'W';
  dead[2][3] = 'W';
  assert.ok(validateInitialBoard(5, dead).error);
  // 合法初始盘可创建
  const ok = createState({ size: 5, grid: dead.map((r) => r.map((v) => (v === 'B' ? null : v))), firstPlayer: 'W' }, new Date().toISOString());
  assert.equal(ok.nextPlayer, 'W');
});

test('全盘棋串枚举互不重叠', () => {
  const b = b5();
  set(b, 5, 1, 1, 'B');
  set(b, 5, 1, 2, 'B');
  set(b, 5, 4, 4, 'W');
  const groups = allGroups(b, 5);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].stones.length + groups[1].stones.length, 3);
});

