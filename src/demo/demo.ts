import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { getDb, resetDbForTests } from '../store/db';
import { GameRepository } from '../store/repo';
import { GameService } from '../service/gameService';
import { evaluatePlace } from '../core/rules';
import { Cell, Stone } from '../core/types';
import { renderBoard } from '../cli/render';

void evaluatePlace;

resetDbForTests();
const dbPath = join(process.cwd(), 'data', 'demo.sqlite');
rmSync(dbPath, { force: true });
rmSync(dbPath + '-wal', { force: true });
rmSync(dbPath + '-shm', { force: true });

const service = new GameService(new GameRepository(getDb(dbPath)));

function line(t: string): void {
  console.log('\n=== ' + t + ' ===');
}

// 场景 1：普通连接
line('场景 1 普通连接（5 路）');
let g = service.createGame(5);
service.place(g.id, 0, 'B', { row: 3, col: 3 });
service.place(g.id, 1, 'W', { row: 4, col: 3 });
let r = service.place(g.id, 2, 'B', { row: 3, col: 2 });
console.log(renderBoard(service.get(g.id).board, 5));
console.log('黑子 (3,3) 与 (3,2) 相连成串');

// 场景 2：一次提走多个棋串（白两子不相连，均只剩一口气）
line('场景 2 一次提走多个棋串（9 路测试盘）');
// 构造：白 (1,1) 与白 (1,3) 不相连；黑围住除 (1,2) 外的气
const N = null;
const grid9: Cell[][] = [
  ['W', N, 'W', 'B', N, N, N, N, N],
  ['B', 'B', 'B', N, N, N, N, N, N],
  ...Array.from({ length: 7 }, () => new Array<Cell>(9).fill(N)),
];
g = service.createGame(9, grid9, 'B');
console.log('落子前：');
console.log(renderBoard(service.get(g.id).board, 9));
r = service.place(g.id, 0, 'B', { row: 1, col: 2 });
console.log('黑下 (1,2) 后：');
console.log(renderBoard(service.get(g.id).board, 9));
console.log(`一次提走 ${r.captured.length} 个白子：`, r.captured);

// 场景 3：提子后解除自身无气
line('场景 3 提子后解除自身无气（5 路角部）');
// 白棋串 (1,2)(2,1)(2,2) 仅剩一口气 (1,1)，其余外气全部被黑封住：
// 黑 (1,3)(2,3)(3,2)(3,1)。黑下 (1,1) 提走整个白棋串并获得大量气。
const g3: Cell[][] = [
  [N, 'W', 'B', N, N],
  ['W', 'W', 'B', N, N],
  ['B', 'B', N, N, N],
  [N, N, N, N, N],
  [N, N, N, N, N],
];
g = service.createGame(5, g3, 'B');
console.log('落子前（白棋串仅剩 (1,1) 一口气）：');
console.log(renderBoard(service.get(g.id).board, 5));
const save = service.place(g.id, 0, 'B', { row: 1, col: 1 });
console.log('黑下 (1,1) 提走白棋串：');
console.log(renderBoard(service.get(g.id).board, 5));
console.log(`提子 ${save.captured.length} 个：`, save.captured, '（若不能提子，该点对黑本是自杀）');

// 场景 4：被拒绝的自杀
line('场景 4 自杀落子被拒（5 路角部）');
g = service.createGame(5);
// 角部 (1,1)，白占 (1,2)(2,1)，黑下 (1,1) 即自杀（不提任何子）
service.place(g.id, 0, 'B', { row: 3, col: 3 });
service.place(g.id, 1, 'W', { row: 1, col: 2 });
service.place(g.id, 2, 'B', { row: 3, col: 4 });
service.place(g.id, 3, 'W', { row: 2, col: 1 });
const prev = service.previewPlace(g.id, 'B', { row: 1, col: 1 });
console.log(`黑预览下 (1,1)：legal=${prev.legal} reason=${prev.reason}`);

// 场景 5：单劫立即提回被拒，停一手后可打破
line('场景 5 单劫（5 路）');
g = service.createGame(5);
const seq: Array<[Stone, number, number]> = [
  ['B', 1, 2], ['W', 1, 3],
  ['B', 2, 1], ['W', 3, 3],
  ['B', 3, 2], ['W', 2, 4],
  ['B', 5, 5], ['W', 2, 2],
  ['B', 2, 3], // 黑提 (2,2) 形成劫
];
let step = 0;
for (const [p, row, col] of seq) {
  const rr = service.place(g.id, step, p, { row, col });
  step = rr.move.moveNumber;
}
console.log(renderBoard(service.get(g.id).board, 5));
const koTry = service.previewPlace(g.id, 'W', { row: 2, col: 2 });
console.log(`白立即于 (2,2) 提回：legal=${koTry.legal} reason=${koTry.reason}`);
service.pass(g.id, step, 'W');
const afterPass = service.previewPlace(g.id, 'B', { row: 5, col: 4 });
console.log(`白停一手后（黑下别处）预览：legal=${afterPass.legal}（停手已推进历史）`);

// 场景 6：连续两次停手结束，不判胜负
line('场景 6 连续停一手结束');
g = service.createGame(5);
service.pass(g.id, 0, 'B');
const end = service.pass(g.id, 1, 'W');
console.log(`over=${end.state.over} endReason=${end.state.endReason}（不据此判定胜负）`);

line('一致性校验（按保存动作重放）');
g = service.list()[0] ? service.get(service.list()[0].id) : g;
for (const item of service.list()) {
  const v = service.verify(item.id);
  console.log(item.id.slice(0, 8), v);
}
console.log('\n演示完成，数据库：' + dbPath);
