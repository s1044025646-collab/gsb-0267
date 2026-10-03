import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allGroups, applyMove, boardKey, emptyBoard, groupAt, validateInitialBoard,
  type Cell,
} from "../src/engine";

const B = (rows: number[][]): Cell[] => rows.flat() as Cell[];

test("角上棋串只有两口气", () => {
  const cells = emptyBoard(5);
  cells[0] = 1; // (1,1)
  const g = groupAt(5, cells, 1, 1)!;
  assert.equal(g.stones.length, 1);
  assert.deepEqual(
    g.liberties.map((p) => [p.row, p.col]).sort(),
    [[1, 2], [2, 1]]
  );
});

test("边上棋串共享气去重", () => {
  const cells = emptyBoard(5);
  cells[0] = 1;
  cells[1] = 1;
  const g = groupAt(5, cells, 1, 1)!;
  assert.equal(g.stones.length, 2);
  assert.equal(g.liberties.length, 3); // (1,3) (2,1) (2,2)
  const keys = g.liberties.map((p) => `${p.row},${p.col}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("同一棋串多点接触只提取一次", () => {
  const cells = B([
    [2, 2, 0, 0, 0],
    [1, 1, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ]);
  const r = applyMove(5, cells, 1, 1, 3, [boardKey(cells)]);
  assert.ok(r.ok);
  assert.equal(r.captured.length, 2);
});

test("一手同时提走两个不同棋串", () => {
  const cells = B([
    [2, 1, 0, 0, 0],
    [0, 2, 0, 0, 0],
    [2, 1, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ]);
  const r = applyMove(5, cells, 1, 2, 1, [boardKey(cells)]);
  assert.ok(r.ok);
  assert.equal(r.captured.length, 2);
  assert.deepEqual(
    r.captured.map((p) => [p.row, p.col]).sort(),
    [[1, 1], [3, 1]]
  );
  const g = groupAt(5, r.board, 2, 1)!;
  assert.ok(g.liberties.length >= 2);
});

test("自杀被拒绝", () => {
  const cells = B([
    [1, 0, 1, 0, 0],
    [0, 1, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ]);
  const r = applyMove(5, cells, 2, 1, 2, [boardKey(cells)]);
  assert.ok(!r.ok);
  assert.equal(r.code, "SUICIDE");
});

test("占用点与越界", () => {
  const cells = emptyBoard(5);
  cells[0] = 1;
  const h = [boardKey(cells)];
  const occ = applyMove(5, cells, 2, 1, 1, h);
  assert.ok(!occ.ok && occ.code === "OCCUPIED");
  const oob = applyMove(5, cells, 2, 0, 1, h);
  assert.ok(!oob.ok && oob.code === "OUT_OF_BOUNDS");
  const oob2 = applyMove(5, cells, 2, 6, 1, h);
  assert.ok(!oob2.ok && oob2.code === "OUT_OF_BOUNDS");
});

test("单劫：立即提回被拒，停一手后允许", () => {
  const b3 = B([
    [0, 1, 2, 0, 0],
    [1, 2, 0, 2, 0],
    [0, 1, 2, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ]);
  const h = [boardKey(b3)];
  const m1 = applyMove(5, b3, 1, 2, 3, h);
  assert.ok(m1.ok);
  h.push(boardKey(m1.board));
  const ko = applyMove(5, m1.board, 2, 2, 2, h);
  assert.ok(!ko.ok && ko.code === "KO");
  h.push(boardKey(m1.board)); // 白停一手，历史按普通一步推进
  const m2 = applyMove(5, m1.board, 1, 5, 5, h);
  assert.ok(m2.ok);
  h.push(boardKey(m2.board));
  const ok = applyMove(5, m2.board, 2, 2, 2, h);
  assert.ok(ok.ok);
  assert.equal(ok.captured.length, 1);
});

test("初始棋盘校验：尺寸/单元值/无气棋串", () => {
  assert.equal(validateInitialBoard(7, []).ok, false);
  assert.equal(validateInitialBoard(5, emptyBoard(5).slice(0, 24)).ok, false);
  const bad = emptyBoard(5);
  bad[0] = 3 as any;
  assert.equal(validateInitialBoard(5, bad).ok, false);
  const dead = B([
    [2, 1, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ]);
  assert.equal(validateInitialBoard(5, dead).ok, false);
  assert.ok(validateInitialBoard(5, emptyBoard(5)).ok);
});

test("allGroups 每串只出现一次", () => {
  const cells = B([
    [1, 1, 0, 2, 2],
    [1, 0, 0, 2, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ]);
  const groups = allGroups(5, cells);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.stones.length).sort(), [3, 3]);
});
