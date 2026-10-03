import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, resetDbForTests } from '../store/db';
import { GameRepository } from '../store/repo';
import { RuleError } from '../core/engine';
import { Cell } from '../core/types';

const dbPath = join(process.cwd(), 'data', 'test-store.sqlite');
let repo: GameRepository;

before(() => {
  resetDbForTests();
  for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
  repo = new GameRepository(openDb(dbPath));
});

after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(dbPath + suffix, { force: true });
    } catch {
      /* Windows 下已关闭句柄可能仍短暂占用，不影响结论 */
    }
  }
});

test('创建、落子、重启重放得到完全相同的棋盘与提子计数', () => {
  const g = repo.create({ size: 5 });
  repo.commitPlace(g.id, 0, 'B', { row: 1, col: 2 });
  repo.commitPlace(g.id, 1, 'W', { row: 2, col: 3 });
  repo.commitPlace(g.id, 2, 'B', { row: 2, col: 1 });
  repo.commitPlace(g.id, 3, 'W', { row: 3, col: 2 });
  const cap = repo.commitPlace(g.id, 4, 'B', { row: 3, col: 3 });
  repo.commitPlace(g.id, 5, 'W', { row: 2, col: 2 });
  void cap;

  const before = repo.load(g.id);
  const snapshot = {
    board: before.board.slice(),
    captures: { ...before.captures },
    moveNumber: before.moveNumber,
    next: before.nextPlayer,
  };

  // 模拟重启：新建仓储（同一库文件），状态由保存动作重放
  resetDbForTests();
  const repo2 = new GameRepository(openDb(dbPath));
  const reloaded = repo2.load(g.id);
  assert.deepEqual(reloaded.board, snapshot.board);
  assert.deepEqual(reloaded.captures, snapshot.captures);
  assert.equal(reloaded.moveNumber, snapshot.moveNumber);
  assert.equal(reloaded.nextPlayer, snapshot.next);

  const v = repo2.verifyIntegrity(g.id);
  assert.equal(v.ok, true);
  repo = repo2;
});

test('期望步号冲突被明确拒绝 (CONFLICT)', () => {
  const g = repo.create({ size: 5 });
  repo.commitPlace(g.id, 0, 'B', { row: 1, col: 1 });
  assert.throws(
    () => repo.commitPlace(g.id, 0, 'W', { row: 2, col: 2 }),
    (e: Error) => e instanceof RuleError && e.code === 'CONFLICT',
  );
  const s = repo.load(g.id);
  assert.equal(s.moveNumber, 1);
});

test('非法落子前后数据库状态一致（回滚）', () => {
  const g = repo.create({ size: 5 });
  repo.commitPlace(g.id, 0, 'B', { row: 3, col: 3 });
  repo.commitPlace(g.id, 1, 'W', { row: 1, col: 2 });
  repo.commitPlace(g.id, 2, 'B', { row: 3, col: 4 });
  repo.commitPlace(g.id, 3, 'W', { row: 2, col: 1 });
  const before = repo.load(g.id);
  assert.throws(() => repo.commitPlace(g.id, 4, 'B', { row: 1, col: 1 }), (e: Error) => e instanceof RuleError && e.code === 'SUICIDE');
  const after = repo.load(g.id);
  assert.deepEqual(after.board, before.board);
  assert.equal(after.moveNumber, before.moveNumber);
  assert.deepEqual(after.captures, before.captures);
  const v = repo.verifyIntegrity(g.id);
  assert.equal(v.ok, true);
});

test('测试棋盘创建后可继续行棋', () => {
  const grid: Cell[][] = [
    [null, 'W', 'B', null, null],
    ['W', 'W', 'B', null, null],
    ['B', 'B', null, null, null],
    [null, null, null, null, null],
    [null, null, null, null, null],
  ];
  const g = repo.create({ size: 5, grid, firstPlayer: 'B' });
  const r = repo.commitPlace(g.id, 0, 'B', { row: 1, col: 1 });
  assert.equal(r.captured.length, 3);
});

test('导出棋谱含初始盘与每手动作', () => {
  const g = repo.create({ size: 5 });
  repo.commitPass(g.id, 0, 'B');
  const rec = repo.exportRecord(g.id);
  assert.equal(rec.moves.length, 1);
  assert.equal(rec.moves[0].kind, 'pass');
  assert.equal(rec.over, false);
});
