/**
 * 命令行界面。用法见 README 或 `node dist/cli.js help`。
 * 坐标与 API 一致：row/col 均为 1 基，row 从上到下，col 从左到右。
 */
import * as path from "node:path";
import { Store } from "./store";
import { GameService, ServiceError } from "./service";
import { renderBoard } from "./render";
import type { Cell } from "./engine";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, "go.db");

const USAGE = `用法: node dist/cli.js <命令> [参数]

命令:
  create <size> [--turn 1|2] [--board <json数组>]   创建对局 (size: 5/9/13)
  list                                              列出所有对局
  show <id>                                         查看当前棋盘与状态
  groups <id>                                       查看棋串与气
  preview <id> <row> <col>                          预览落子（不写入）
  move <id> <row> <col> <expectedSeq>               确认落子
  pass <id> <expectedSeq>                           停一手
  replay <id> [n]                                   回放到第 n 手（缺省为最新）
  export <id>                                       导出棋谱 JSON
  help                                              显示本说明

坐标: row/col 均为 1 基；row 从上到下，col 从左到右。X=黑 O=白
数据库: ${DB_PATH}（可用 DB_PATH / DATA_DIR 环境变量覆盖）
`;

function printGame(g: { id: string; size: number; status: string; turn: number; moveCount: number; nextSeq: number; board: Cell[]; capturedByBlack: number; capturedByWhite: number }): void {
  console.log(renderBoard(g.size, g.board));
  console.log(
    `对局 ${g.id} | ${g.size}路 | 状态 ${g.status} | 下一手: ${g.turn === 1 ? "黑(X)" : "白(O)"}` +
      ` | 已下 ${g.moveCount} 手 | 下一步号 ${g.nextSeq} | 提子 黑${g.capturedByBlack} : 白${g.capturedByWhite}`
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const store = new Store(DB_PATH);
  const svc = new GameService(store);
  try {
    switch (cmd) {
      case "create": {
        const size = Number(args[1]);
        const ti = args.indexOf("--turn");
        const bi = args.indexOf("--board");
        const g = svc.createGame({
          size,
          initialTurn: ti >= 0 ? (Number(args[ti + 1]) as 1 | 2) : undefined,
          initialBoard: bi >= 0 ? JSON.parse(args[bi + 1]) : undefined,
        });
        printGame(g);
        break;
      }
      case "list": {
        for (const g of svc.listGames()) {
          console.log(`${g.id}  ${g.size}路  ${g.status}  手数=${g.moveCount}  轮到=${g.turn === 1 ? "黑" : "白"}`);
        }
        break;
      }
      case "show":
        printGame(svc.getGame(args[1]));
        break;
      case "groups": {
        const { size, groups } = svc.getGroups(args[1]);
        console.log(`棋串数: ${groups.length}`);
        for (const g of groups) {
          const stones = g.stones.map((s) => `(${s.row},${s.col})`).join(" ");
          const libs = g.liberties.map((s) => `(${s.row},${s.col})`).join(" ");
          console.log(`${g.color === 1 ? "黑" : "白"} 串[${stones}] 气${g.liberties.length}: ${libs}`);
        }
        console.log(renderBoard(size, svc.getGame(args[1]).board));
        break;
      }
      case "preview": {
        const r = svc.previewMove(args[1], Number(args[2]), Number(args[3]));
        if (!r.ok) {
          console.log(`预览: 非法 (${r.code}) ${r.message}`);
        } else {
          console.log(`预览: 合法，提 ${r.captured.length} 子 ${JSON.stringify(r.captured)}，下一手 ${r.nextTurn === 1 ? "黑" : "白"}`);
          console.log(renderBoard(svc.getGame(args[1]).size, r.board));
          console.log("（预览不写入对局）");
        }
        break;
      }
      case "move": {
        const r = svc.confirmMove(args[1], Number(args[2]), Number(args[3]), Number(args[4]));
        console.log(`第 ${r.move.seq} 手 ${r.move.color === 1 ? "黑" : "白"} 落子 (${r.move.row},${r.move.col})，提 ${r.move.captured.length} 子`);
        printGame(r.game);
        break;
      }
      case "pass": {
        const r = svc.pass(args[1], Number(args[2]));
        console.log(`第 ${r.move.seq} 手 ${r.move.color === 1 ? "黑" : "白"} 停一手${r.game.status === "ended" ? "，连续两手停，对局结束（不判定胜负）" : ""}`);
        printGame(r.game);
        break;
      }
      case "replay": {
        const r = svc.replay(args[1], args[2] === undefined ? undefined : Number(args[2]));
        console.log(renderBoard(r.size, r.board));
        console.log(`回放至第 ${r.seq} 手 | 提子 黑${r.capturedByBlack} : 白${r.capturedByWhite}`);
        break;
      }
      case "export":
        console.log(JSON.stringify(svc.export(args[1]), null, 2));
        break;
      case "help":
      case undefined:
        process.stdout.write(USAGE);
        break;
      default:
        console.error(`未知命令: ${cmd}\n`);
        process.stdout.write(USAGE);
        process.exitCode = 1;
    }
  } catch (e) {
    if (e instanceof ServiceError) {
      console.error(`错误 [${e.code}] ${e.message}`);
      process.exitCode = 2;
    } else {
      throw e;
    }
  } finally {
    store.close();
  }
}

main();
