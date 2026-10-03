#!/usr/bin/env node
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { getDb } from '../store/db';
import { GameRepository } from '../store/repo';
import { GameService } from '../service/gameService';
import { RuleError, ValidationError } from '../core/engine';
import { Stone } from '../core/types';
import { renderBoard } from './render';

const DATA_DIR = process.env.GO_DATA_DIR ?? join(process.cwd(), 'data');
const service = new GameService(new GameRepository(getDb(join(DATA_DIR, 'go.sqlite'))));

function usage(): string {
  return [
    '用法：',
    '  npm run cli -- create --size 5 [--first B|W]',
    '  npm run cli -- create-test --size 5 --first B --grid \'[[null,"B",...],...]\'',
    '  npm run cli -- list',
    '  npm run cli -- show <gameId>',
    '  npm run cli -- groups <gameId>',
    '  npm run cli -- preview <gameId> B <row> <col>',
    '  npm run cli -- place <gameId> B <row> <col> --expected <步号>',
    '  npm run cli -- pass <gameId> B --expected <步号>',
    '  npm run cli -- at <gameId> <步号>',
    '  npm run cli -- record <gameId> [--out 文件.json]',
    '  npm run cli -- verify <gameId>',
    '',
    '坐标 row/col 均为 1 基整数；黑 B 白 W。',
  ].join('\n');
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function showGame(id: string): void {
  const s = service.get(id);
  console.log(renderBoard(s.board, s.size));
  console.log(
    `对局 ${s.id}  尺寸 ${s.size}  步号 ${s.moveNumber}  下一手 ${s.nextPlayer}  ` +
      `提子 B=${s.captures.B} W=${s.captures.W}  结束=${s.over ? '是(' + s.endReason + '，不判定胜负)' : '否'}`,
  );
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.log(usage());
    return;
  }

  switch (cmd) {
    case 'create': {
      const size = Number(arg(rest, '--size'));
      const first = (arg(rest, '--first') as Stone | undefined) ?? 'B';
      const g = service.createGame(size, undefined, first);
      showGame(g.id);
      break;
    }
    case 'create-test': {
      const size = Number(arg(rest, '--size'));
      const first = (arg(rest, '--first') as Stone | undefined) ?? 'B';
      const gridText = arg(rest, '--grid');
      if (!gridText) throw new ValidationError('--grid 必填，为 JSON 二维数组');
      const grid = JSON.parse(gridText);
      const g = service.createGame(size, grid, first);
      showGame(g.id);
      break;
    }
    case 'list':
      console.log(JSON.stringify(service.list(), null, 2));
      break;
    case 'show':
      showGame(requireId(rest));
      break;
    case 'groups': {
      const r = service.groups(requireId(rest));
      for (const g of r.groups) {
        console.log(
          `${g.color} 子数=${g.stoneCount} 气数=${g.libertyCount} 棋子=${fmt(g.stones)} 气=${fmt(g.liberties)}`,
        );
      }
      break;
    }
    case 'preview': {
      const [id, player, row, col] = rest;
      const r = service.previewPlace(id, player as Stone, { row: Number(row), col: Number(col) });
      const state = service.get(id);
      console.log(`合法=${r.legal}${r.reason ? ' 原因=' + r.reason : ''} 提子=${fmt(r.captured)}`);
      console.log(renderBoard(flat(r.boardAfter), state.size));
      console.log('（预览未写入对局）');
      break;
    }
    case 'place': {
      const [id, player, row, col] = rest;
      const expected = Number(arg(rest, '--expected'));
      const r = service.place(id, expected, player as Stone, { row: Number(row), col: Number(col) });
      console.log(`第 ${r.move.moveNumber} 手 ${player} 落于 ${row},${col}，提子 ${fmt(r.captured)}`);
      showGame(id);
      break;
    }
    case 'pass': {
      const [id, player] = rest;
      const expected = Number(arg(rest, '--expected'));
      const r = service.pass(id, expected, player as Stone);
      console.log(`第 ${r.move.moveNumber} 手 ${player} 停一手`);
      showGame(id);
      break;
    }
    case 'at': {
      const [id, at] = rest;
      const view = service.boardAt(id, Number(at));
      console.log(renderBoard(flat(view.grid), view.size));
      console.log(`步号 ${view.moveNumber}，该手之后下一行棋方 ${view.nextPlayer}`);
      break;
    }
    case 'record': {
      const id = requireId(rest);
      const text = JSON.stringify(service.exportRecord(id), null, 2);
      const out = arg(rest, '--out');
      if (out) {
        writeFileSync(out, text, 'utf8');
        console.log(`已导出到 ${out}`);
      } else {
        console.log(text);
      }
      break;
    }
    case 'verify': {
      const r = service.verify(requireId(rest));
      console.log(r.ok ? `一致性校验通过：${r.moves} 手` : `第 ${r.mismatchAt} 手局面不一致`);
      if (!r.ok) process.exitCode = 1;
      break;
    }
    default:
      console.error(`未知命令：${cmd}\n`);
      console.log(usage());
      process.exitCode = 1;
  }
}

function requireId(rest: string[]): string {
  const id = rest[0];
  if (!id) throw new ValidationError('缺少 gameId');
  return id;
}

function fmt(points: Array<{ row: number; col: number }>): string {
  return points.length ? points.map((p) => `(${p.row},${p.col})`).join(' ') : '无';
}

function flat(grid: Array<Array<'B' | 'W' | null>>): Array<'B' | 'W' | null> {
  return grid.flat();
}

try {
  main();
} catch (err) {
  if (err instanceof ValidationError) {
    console.error(`参数错误 [VALIDATION]：${err.message}`);
  } else if (err instanceof RuleError) {
    console.error(`规则错误 [${err.code}]：${err.message}`);
  } else {
    console.error((err as Error).message);
  }
  process.exitCode = 1;
}
