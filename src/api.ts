/**
 * HTTP API（Node 内置 http，无外部依赖）。
 * 默认端口 0（自动选择空闲端口），可用 PORT 环境变量或 --port 指定。
 */
import * as http from "node:http";
import * as path from "node:path";
import { Store } from "./store";
import { GameService, ServiceError } from "./service";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, "go.db");

const ERROR_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  INVALID_SIZE: 400,
  INVALID_BOARD: 400,
  OUT_OF_BOUNDS: 400,
  OCCUPIED: 400,
  SUICIDE: 400,
  KO: 400,
  GAME_OVER: 400,
  SEQ_CONFLICT: 409,
};

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new ServiceError("BAD_REQUEST", "请求体必须是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function createServer(service: GameService): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";
      const body = method === "POST" ? await readBody(req) : {};

      // POST /games
      if (method === "POST" && parts.length === 1 && parts[0] === "games") {
        const g = service.createGame({
          size: Number(body.size),
          initialBoard: body.initialBoard,
          initialTurn: body.initialTurn,
        });
        return send(res, 201, g);
      }
      // GET /games
      if (method === "GET" && parts.length === 1 && parts[0] === "games") {
        return send(res, 200, service.listGames());
      }
      if (parts.length >= 2 && parts[0] === "games") {
        const id = parts[1];
        const sub = parts[2];
        // GET /games/:id
        if (method === "GET" && parts.length === 2) return send(res, 200, service.getGame(id));
        // GET /games/:id/groups
        if (method === "GET" && sub === "groups") return send(res, 200, service.getGroups(id));
        // POST /games/:id/preview
        if (method === "POST" && sub === "preview") {
          return send(res, 200, service.previewMove(id, Number(body.row), Number(body.col)));
        }
        // POST /games/:id/moves
        if (method === "POST" && sub === "moves") {
          const r = service.confirmMove(id, Number(body.row), Number(body.col), Number(body.expectedSeq));
          return send(res, 201, r);
        }
        // POST /games/:id/pass
        if (method === "POST" && sub === "pass") {
          return send(res, 201, service.pass(id, Number(body.expectedSeq)));
        }
        // GET /games/:id/replay?to=N
        if (method === "GET" && sub === "replay") {
          const to = url.searchParams.get("to");
          return send(res, 200, service.replay(id, to === null ? undefined : Number(to)));
        }
        // GET /games/:id/export
        if (method === "GET" && sub === "export") return send(res, 200, service.export(id));
      }
      throw new ServiceError("NOT_FOUND", `${method} ${url.pathname} 不存在`);
    } catch (e) {
      if (e instanceof ServiceError) {
        return send(res, ERROR_STATUS[e.code] ?? 500, { error: { code: e.code, message: e.message } });
      }
      return send(res, 500, { error: { code: "INTERNAL", message: String(e) } });
    }
  });
}

function parsePort(): number {
  const i = process.argv.indexOf("--port");
  if (i >= 0 && process.argv[i + 1]) return Number(process.argv[i + 1]);
  if (process.env.PORT) return Number(process.env.PORT);
  return 0; // 默认自动选择空闲端口
}

if (require.main === module) {
  const store = new Store(DB_PATH);
  const service = new GameService(store);
  const server = createServer(service);
  const port = parsePort();
  server.listen(port, () => {
    const addr = server.address();
    const p = typeof addr === "object" && addr ? addr.port : port;
    console.log(`围棋服务已启动: http://127.0.0.1:${p}  (数据库: ${DB_PATH})`);
  });
}
