/**
 * 演示脚本：在 5 路小盘上手工核对核心规则场景。
 * 运行: npm run demo
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Store } from "./store";
import { GameService } from "./service";
import { renderBoard } from "./render";
import type { Cell } from "./engine";

const tmp = path.join(process.cwd(), "data", "demo.db");
fs.rmSync(tmp, { force: true });
const store = new Store(tmp);
const svc = new GameService(store);

function show(title: string, size: number, board: Cell[]): void {
  console.log(`\n=== ${title} ===`);
  console.log(renderBoard(size, board));
}

function tryMove(id: string, row: number, col: number, note: string): void {
  const g = svc.getGame(id);
  try {
    const r = svc.confirmMove(id, row, col, g.nextSeq);
    console.log(`\n${note}: 第 ${r.move.seq} 手 ${r.move.color === 1 ? "黑" : "白"} (${row},${col}) 提 ${r.move.captured.length} 子`);
    console.log(renderBoard(r.game.size, r.game.board));
  } catch (e: any) {
    console.log(`\n${note}: (${row},${col}) 被拒绝 [${e.code}] ${e.message}`);
  }
}

// 场景 1：一手同时提走两个白串，且提子解除自身无气
//   O X . . .
//   . O . . .
//   O X . . .
//   X . . . .
//   . . . . .
// 黑落 (2,1)：白 (1,1) 与白 (3,1) 两串同时无气被提；
// 若不提子，黑 (2,1) 自身无气（自杀），提子后获得 (1,1)/(3,1) 两口真气。
const b1: Cell[] = [
  2, 1, 0, 0, 0,
  0, 2, 0, 0, 0,
  2, 1, 0, 0, 0,
  1, 0, 0, 0, 0,
  0, 0, 0, 0, 0,
];
const g1 = svc.createGame({ size: 5, initialBoard: b1, initialTurn: 1 });
show("场景1 初始盘", 5, b1);
tryMove(g1.id, 2, 1, "黑落 (2,1)，一手提两串共 2 子，提子解除自身无气");

// 场景 2：自杀拒绝
//   X . X . .
//   . X . . .
//   . . . . .
// 白落 (1,2) 后无气且不提任何子 -> 自杀
const b2: Cell[] = [
  1, 0, 1, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 0, 0, 0,
  0, 0, 0, 0, 0,
  0, 0, 0, 0, 0,
];
const g2 = svc.createGame({ size: 5, initialBoard: b2, initialTurn: 2 });
show("场景2 初始盘", 5, b2);
tryMove(g2.id, 1, 2, "白落 (1,2)");

// 场景 3：单劫
//   . X O . .
//   X O . O .
//   . X O . .
//   . . . . .
//   . . . . .
const b3: Cell[] = [
  0, 1, 2, 0, 0,
  1, 2, 0, 2, 0,
  0, 1, 2, 0, 0,
  0, 0, 0, 0, 0,
  0, 0, 0, 0, 0,
];
const g3 = svc.createGame({ size: 5, initialBoard: b3, initialTurn: 1 });
show("场景3 初始盘", 5, b3);
tryMove(g3.id, 2, 3, "黑落 (2,3) 提白 (2,2)");
tryMove(g3.id, 2, 2, "白立即提回 (2,2)（应被单劫拒绝）");
{
  let g = svc.getGame(g3.id);
  svc.pass(g3.id, g.nextSeq);
  console.log("\n白停一手");
  g = svc.getGame(g3.id);
  svc.confirmMove(g3.id, 5, 5, g.nextSeq);
  console.log("黑在 (5,5) 落子");
}
tryMove(g3.id, 2, 2, "白此时提回 (2,2)（停手已打破立即提回限制，合法）");

// 场景 4：连续两次停手结束对局
const g4 = svc.createGame({ size: 5 });
{
  let g = svc.getGame(g4.id);
  svc.pass(g4.id, g.nextSeq);
  g = svc.getGame(g4.id);
  const r = svc.pass(g4.id, g.nextSeq);
  console.log(`\n场景4: 连续两次停手，状态 = ${r.game.status}（不判定胜负）`);
}

store.close();
console.log("\n演示完成。");
