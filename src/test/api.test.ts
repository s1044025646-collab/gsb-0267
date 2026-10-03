import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { resetDbForTests } from '../store/db';

process.env.GO_DATA_DIR = join(process.cwd(), 'data', 'test-api');
const dir = process.env.GO_DATA_DIR;

const { server } = require('../server/api') as typeof import('../server/api');

let base = '';

before(async () => {
  resetDbForTests();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(join(dir, 'go.sqlite') + suffix, { force: true });
    } catch {
      /* Windows 文件锁延迟，忽略 */
    }
  }
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => {
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    resolve();
  }));
});

after(() => {
  server.close();
  resetDbForTests();
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

test('健康检查', async () => {
  const r = await call('GET', '/health');
  assert.equal(r.status, 200);
});

test('完整 API 流程：创建、预览不写入、确认落子、非法、冲突、历史、导出', async () => {
  const created = await call('POST', '/api/games', { size: 5 });
  assert.equal(created.status, 201);
  const id = created.json.id as string;
  assert.equal(created.json.nextPlayer, 'B');

  const prev = await call('POST', `/api/games/${id}/preview`, { player: 'B', point: { row: 1, col: 1 } });
  assert.equal(prev.json.legal, true);
  const still = await call('GET', `/api/games/${id}`);
  assert.equal(still.json.moveNumber, 0, '预览不得写入');

  const placed = await call('POST', `/api/games/${id}/moves`, {
    player: 'B', expectedMove: 0, point: { row: 1, col: 2 },
  });
  assert.equal(placed.status, 201);

  const wrongTurn = await call('POST', `/api/games/${id}/moves`, {
    player: 'B', expectedMove: 1, point: { row: 2, col: 2 },
  });
  assert.equal(wrongTurn.status, 422);
  assert.equal(wrongTurn.json.error.code, 'NOT_YOUR_TURN');

  const stale = await call('POST', `/api/games/${id}/moves`, {
    player: 'W', expectedMove: 0, point: { row: 2, col: 2 },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error.code, 'CONFLICT');

  const bad = await call('POST', '/api/games', { size: 7 });
  assert.equal(bad.status, 400);

  await call('POST', `/api/games/${id}/moves`, {
    player: 'W', expectedMove: 1, point: { row: 2, col: 3 },
  });
  const groups = await call('GET', `/api/games/${id}/groups`);
  assert.ok(Array.isArray(groups.json.groups));

  const at0 = await call('GET', `/api/games/${id}/moves/0`);
  assert.equal(at0.json.moveNumber, 0);
  assert.equal(at0.json.nextPlayer, 'B');

  const rec = await call('GET', `/api/games/${id}/record`);
  assert.equal(rec.json.moves.length, 2);

  const verify = await call('GET', `/api/games/${id}/verify`);
  assert.equal(verify.json.ok, true);
});

test('连续停一手结束（不判胜负）', async () => {
  const created = await call('POST', '/api/games', { size: 5 });
  const id = created.json.id as string;
  await call('POST', `/api/games/${id}/pass`, { player: 'B', expectedMove: 0 });
  const end = await call('POST', `/api/games/${id}/pass`, { player: 'W', expectedMove: 1 });
  assert.equal(end.json.state.over, true);
  assert.equal(end.json.state.endReason, 'two-passes');
  assert.ok(!('winner' in end.json.state), '不提供胜负判定');
});
