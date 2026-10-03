import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Store } from "../src/store";
import { GameService, ServiceError } from "../src/service";
import { boardKey, type Cell } from "../src/engine";

function makeSvc(): { svc: GameService; store: Store; dbPath: string } {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "go-")), "test.db");
  const store = new Store(dbPath);
  return { svc: new GameService(store), store, dbPath };
}

const KO_BOARD: Cell[] = [
  0, 1, 2, 0, 0,
  1, 2, 0, 2, 0,
  0, 1, 2, 0, 0,
  0, 0, 0, 0, 0,
  0, 0, 0, 0, 0,
];

test("创建/落子/提子计数/轮换", () => {
  const { svc } = makeSvc();
  const g = svc.createGame({ size: 5 });
  assert.equal(g.turn, 1);
  const r1 = svc.confirmMove(g.id, 3, 3, 1);
  assert.equal(r1.game.turn, 2);
  assert.equal(r1.game.moveCount, 1);
  assert.equal(r1.game.board[(3 - 1) * 5 + 2], 1);
});

test("期望步号冲突被拒绝且状态不变", () => {
  const { svc } = makeSvc();
  const g = svc.createGame({ size: 5 });
  svc.confirmMove(g.id, 1, 1, 1);
  assert.throws(() => svc.confirmMove(g.id, 2, 2, 1), (e: ServiceError) => e.code === "SEQ_CONFLICT");
  const after = svc.getGame(g.id);
  assert.equal(after.moveCount, 1);
  assert.equal(after.turn, 2);
});

test("非法落子不改变棋盘/轮次/提子/历史", () => {
  const { svc } = makeSvc();
  const g = svc.createGame({ size: 5, initialBoard: KO_BOARD, initialTurn: 1 });
  const before = svc.getGame(g.id);
  svc.confirmMove(g.id, 2, 3, 1); // 黑提劫
  assert.throws(() => svc.confirmMove(g.id, 2, 2, 2), (e: ServiceError) => e.code === "KO");
  const after = svc.getGame(g.id);
  assert.equal(after.moveCount, 1);
  assert.equal(after.turn, 2);
  assert.equal(after.capturedByBlack, 1);
  assert.equal(boardKey(after.board), boardKey(svc.replay(g.id, 1).board));
  assert.equal(before.moveCount, 0);
});

test("预览不写入对局", () => {
  const { svc } = makeSvc();
  const g = svc.createGame({ size: 5 });
  const p = svc.previewMove(g.id, 2, 2);
  assert.ok(p.ok);
  const after = svc.getGame(g.id);
  assert.equal(after.moveCount, 0);
  assert.equal(boardKey(after.board), boardKey(g.board));
});

test("停手切换行棋方并进入历史；连续两次停手结束", () => {
  const { svc } = makeSvc();
  const g = svc.createGame({ size: 5 });
  const p1 = svc.pass(g.id, 1);
  assert.equal(p1.game.turn, 2);
  assert.equal(p1.game.status, "playing");
  const p2 = svc.pass(g.id, 2);
  assert.equal(p2.game.status, "ended");
  assert.throws(() => svc.pass(g.id, 3), (e: ServiceError) => e.code === "GAME_OVER");
  assert.throws(() => svc.confirmMove(g.id, 1, 1, 3), (e: ServiceError) => e.code === "GAME_OVER");
});

test("停一手打破单劫立即提回限制", () => {
  const { svc } = makeSvc();
  const g = svc.createGame({ size: 5, initialBoard: KO_BOARD, initialTurn: 1 });
  svc.confirmMove(g.id, 2, 3, 1); // 黑提劫
  assert.throws(() => svc.confirmMove(g.id, 2, 2, 2), (e: ServiceError) => e.code === "KO");
  svc.pass(g.id, 2); // 白停一手
  svc.confirmMove(g.id, 5, 5, 3); // 黑他处落子
  const r = svc.confirmMove(g.id, 2, 2, 4); // 白提回合法
  assert.equal(r.move.captured.length, 1);
});

test("回放与当前局面一致，历史查询不覆盖当前局面", () => {
  const { svc } = makeSvc();
  const g = svc.createGame({ size: 5, initialBoard: KO_BOARD, initialTurn: 1 });
  svc.confirmMove(g.id, 2, 3, 1);
  svc.pass(g.id, 2);
  svc.confirmMove(g.id, 5, 5, 3);
  svc.confirmMove(g.id, 2, 2, 4);
  const cur = svc.getGame(g.id);
  const full = svc.replay(g.id);
  assert.equal(boardKey(full.board), boardKey(cur.board));
  assert.equal(full.capturedByBlack, cur.capturedByBlack);
  assert.equal(full.capturedByWhite, cur.capturedByWhite);
  const mid = svc.replay(g.id, 1);
  assert.equal(mid.board[(2 - 1) * 5 + 1], 0); // (2,2) 已被提
  const after = svc.getGame(g.id);
  assert.equal(after.moveCount, 4); // 查询未修改当前局面
  assert.equal(boardKey(after.board), boardKey(cur.board));
});

test("重启后继续轮流行棋", () => {
  const { svc, dbPath } = makeSvc();
  const g = svc.createGame({ size: 9 });
  svc.confirmMove(g.id, 4, 4, 1);
  svc.pass(g.id, 2);
  // 模拟重启：新 Store/Service 读同一数据库
  const svc2 = new GameService(new Store(dbPath));
  const g2 = svc2.getGame(g.id);
  assert.equal(g2.moveCount, 2);
  assert.equal(g2.turn, 1);
  const r = svc2.confirmMove(g.id, 5, 5, 3);
  assert.equal(r.game.moveCount, 3);
});

test("导出棋谱包含初始盘与每手动作", () => {
  const { svc } = makeSvc();
  const g = svc.createGame({ size: 5 });
  svc.confirmMove(g.id, 1, 1, 1);
  svc.pass(g.id, 2);
  const exp = svc.export(g.id);
  assert.equal(exp.moves.length, 2);
  assert.equal(exp.moves[0].type, "move");
  assert.equal(exp.moves[1].type, "pass");
  assert.equal(exp.rules.ko, "simple");
});

test("非法初始棋盘被拒绝", () => {
  const { svc } = makeSvc();
  assert.throws(() => svc.createGame({ size: 7 }), (e: ServiceError) => e.code === "INVALID_SIZE");
  const dead: Cell[] = [
    2, 1, 0, 0, 0,
    1, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
  ];
  assert.throws(
    () => svc.createGame({ size: 5, initialBoard: dead }),
    (e: ServiceError) => e.code === "INVALID_BOARD"
  );
});
