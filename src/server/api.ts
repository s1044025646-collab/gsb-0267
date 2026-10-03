import { createServer, Server } from 'node:http';
import { join } from 'node:path';
import { getDb } from '../store/db';
import { GameRepository } from '../store/repo';
import { GameService } from '../service/gameService';
import { RuleError, ValidationError } from '../core/engine';
import { boardView } from '../core/board';
import { Point, Stone } from '../core/types';

const DATA_DIR = process.env.GO_DATA_DIR ?? join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'go.sqlite');

import type { ServerResponse, IncomingMessage } from 'node:http';

export function buildService(): GameService {
  return new GameService(new GameRepository(getDb(DB_PATH)));
}

const service = buildService();

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new ValidationError('请求体过大'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ValidationError('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

function parseInt10(v: unknown, name: string): number {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new ValidationError(`${name} 必须是整数`);
  return n;
}

function parsePoint(body: any): Point {
  if (!body || typeof body !== 'object' || body.point === undefined) {
    throw new ValidationError('缺少 point（含 1 基 row、col）');
  }
  const row = Number(body.point.row);
  const col = Number(body.point.col);
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    throw new ValidationError('point.row / point.col 必须是 1 基整数');
  }
  return { row, col };
}

function parsePlayer(body: any): Stone {
  if (body?.player !== 'B' && body?.player !== 'W') {
    throw new ValidationError("player 必须是 'B' 或 'W'");
  }
  return body.player;
}

function parseExpectedMove(body: any): number {
  if (!Number.isInteger(body?.expectedMove)) {
    throw new ValidationError('expectedMove 必须是整数（客户端看到的当前步号）');
  }
  return body.expectedMove;
}

function stateView(id: string) {
  const s = service.get(id);
  return {
    ...boardView(s.board, s.size),
    id: s.id,
    size: s.size,
    rulesVersion: s.rulesVersion,
    moveNumber: s.moveNumber,
    nextPlayer: s.nextPlayer,
    over: s.over,
    endReason: s.endReason,
    captures: s.captures,
  };
}

const HANDLERS: Array<{
  method: string;
  pattern: RegExp;
  handle: (req: IncomingMessage, res: ServerResponse, m: RegExpMatchArray) => Promise<void> | void;
}> = [
  {
    method: 'POST',
    pattern: /^\/api\/games$/,
    handle: async (req, res) => {
      const body = await readBody(req);
      const size = parseInt10(body?.size, 'size');
      const firstPlayer = body?.firstPlayer ?? undefined;
      const g = service.createGame(size, body?.grid ?? undefined, firstPlayer);
      send(res, 201, stateView(g.id));
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/games$/,
    handle: (_req, res) => send(res, 200, { games: service.list() }),
  },
  {
    method: 'GET',
    pattern: /^\/api\/games\/([^/]+)$/,
    handle: (_req, res, m) => send(res, 200, stateView(m[1])),
  },
  {
    method: 'GET',
    pattern: /^\/api\/games\/([^/]+)\/groups$/,
    handle: (_req, res, m) => send(res, 200, service.groups(m[1])),
  },
  {
    method: 'POST',
    pattern: /^\/api\/games\/([^/]+)\/preview$/,
    handle: async (req, res, m) => {
      const body = await readBody(req);
      const point = parsePoint(body);
      const player = parsePlayer(body);
      send(res, 200, service.previewPlace(m[1], player, point));
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/games\/([^/]+)\/moves$/,
    handle: async (req, res, m) => {
      const body = await readBody(req);
      const player = parsePlayer(body);
      const expectedMove = parseExpectedMove(body);
      const point = parsePoint(body);
      const result = service.place(m[1], expectedMove, player, point);
      send(res, 201, {
        move: result.move,
        captured: result.captured,
        state: stateView(m[1]),
      });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/games\/([^/]+)\/pass$/,
    handle: async (req, res, m) => {
      const body = await readBody(req);
      const player = parsePlayer(body);
      const expectedMove = parseExpectedMove(body);
      const result = service.pass(m[1], expectedMove, player);
      send(res, 201, { move: result.move, state: stateView(m[1]) });
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/games\/([^/]+)\/moves\/(\d+)$/,
    handle: (_req, res, m) => {
      const at = parseInt10(m[2], 'moveNumber');
      send(res, 200, service.boardAt(m[1], at));
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/games\/([^/]+)\/record$/,
    handle: (_req, res, m) => {
      const rec = service.exportRecord(m[1]);
      send(res, 200, {
        ...rec,
        initialBoard: boardView(rec.initialBoard, rec.size).grid,
        finalBoard: boardView(rec.finalBoard, rec.size).grid,
      });
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/games\/([^/]+)\/verify$/,
    handle: (_req, res, m) => send(res, 200, service.verify(m[1])),
  },
];

const server: Server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    for (const h of HANDLERS) {
      if (h.method !== req.method) continue;
      const m = url.pathname.match(h.pattern);
      if (!m) continue;
      await h.handle(req, res, m);
      return;
    }
    send(res, 404, { error: { code: 'NOT_FOUND', message: '未知接口' } });
  } catch (err) {
    if (err instanceof ValidationError) return send(res, 400, { error: { code: 'VALIDATION', message: err.message } });
    if (err instanceof RuleError) {
      const status =
        err.code === 'NOT_FOUND'
          ? 404
          : err.code === 'CONFLICT'
            ? 409
            : 422;
      return send(res, status, { error: { code: err.code, message: err.message } });
    }
    send(res, 500, { error: { code: 'INTERNAL', message: (err as Error).message } });
  }
});

export function choosePort(preferred?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(preferred ?? 0, '127.0.0.1', () => {
      const addr = probe.address();
      probe.close(() => resolve(typeof addr === 'object' && addr ? addr.port : 0));
    });
  });
}

if (require.main === module) {
  const preferred = process.env.PORT ? Number(process.env.PORT) : undefined;
  choosePort(preferred)
    .then((port) => {
      server.listen(port, '127.0.0.1', () => {
        console.log(`围棋规则服务已启动: http://127.0.0.1:${port}`);
        console.log(`数据目录: ${DATA_DIR}`);
      });
    })
    .catch((err) => {
      console.error('端口选择失败', err);
      process.exit(1);
    });
}

export { server };
