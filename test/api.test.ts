import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Store } from "../src/store";
import { GameService } from "../src/service";
import { createServer } from "../src/api";

let server: Server;
let base: string;

before(async () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "go-api-")), "test.db");
  server = createServer(new GameService(new Store(dbPath)));
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

async function call(method: string, p: string, body?: any): Promise<{ status: number; json: any }> {
  const res = await fetch(base + p, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test("API 全流程：创建/预览/确认/棋串/回放/导出/停手", async () => {
  let r = await call("POST", "/games", { size: 5 });
  assert.equal(r.status, 201);
  const id = r.json.id;

  r = await call("POST", `/games/${id}/preview`, { row: 3, col: 3 });
  assert.equal(r.json.ok, true);
  r = await call("GET", `/games/${id}`);
  assert.equal(r.json.moveCount, 0); // 预览未写入

  r = await call("POST", `/games/${id}/moves`, { row: 3, col: 3, expectedSeq: 1 });
  assert.equal(r.status, 201);
  r = await call("POST", `/games/${id}/moves`, { row: 1, col: 1, expectedSeq: 1 });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, "SEQ_CONFLICT");

  r = await call("POST", `/games/${id}/moves`, { row: 9, col: 1, expectedSeq: 2 });
  assert.equal(r.json.error.code, "OUT_OF_BOUNDS");

  r = await call("GET", `/games/${id}/groups`);
  assert.equal(r.json.groups.length, 1);
  assert.equal(r.json.groups[0].liberties.length, 4);

  r = await call("POST", `/games/${id}/pass`, { expectedSeq: 2 });
  assert.equal(r.status, 201);
  r = await call("POST", `/games/${id}/pass`, { expectedSeq: 3 });
  assert.equal(r.json.game.status, "ended");

  r = await call("GET", `/games/${id}/replay?to=1`);
  assert.equal(r.json.seq, 1);
  r = await call("GET", `/games/${id}/export`);
  assert.equal(r.json.moves.length, 3);

  r = await call("GET", `/games/nope`);
  assert.equal(r.status, 404);
});
