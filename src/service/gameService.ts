import { GameRepository } from '../store/repo';
import { Cell, Point, Stone } from '../core/types';
import { allGroups, boardView, findGroup, toGrid } from '../core/board';
import { evaluatePlace } from '../core/rules';
import { RuleError, stateAtMove } from '../core/engine';

export class GameService {
  constructor(private repo: GameRepository) {}

 createGame(size: number, grid?: unknown, firstPlayer?: Stone) {
    return this.repo.create({ size, grid, firstPlayer });
  }

  get(id: string) {
    return this.repo.load(id);
  }

  list() {
    return this.repo.list();
  }

  /** 预览落子：纯计算，不写库、不改轮次与历史。 */
  previewPlace(id: string, player: Stone, point: Point) {
    const state = this.repo.load(id);
    if (state.over) throw new RuleError('GAME_OVER', '对局已结束');
    if (player !== state.nextPlayer) throw new RuleError('NOT_YOUR_TURN', `当前轮次为 ${state.nextPlayer}`);
    const outcome = evaluatePlace(state.board, state.size, player, point, state.history);
    return {
      legal: outcome.legal,
      reason: outcome.reason ?? null,
      captured: outcome.captured,
      boardAfter: toGrid(outcome.board, state.size),
      nextPlayerIfApplied: player === 'B' ? 'W' : 'B',
    };
  }

  place(id: string, expectedMove: number, player: Stone, point: Point) {
    return this.repo.commitPlace(id, expectedMove, player, point);
  }

  pass(id: string, expectedMove: number, player: Stone) {
    return this.repo.commitPass(id, expectedMove, player);
  }

  groups(id: string) {
    const state = this.repo.load(id);
    return {
      size: state.size,
      groups: allGroups(state.board, state.size).map((g) => ({
        color: g.color,
        stones: g.stones,
        liberties: g.liberties,
        libertyCount: g.liberties.length,
        stoneCount: g.stones.length,
      })),
    };
  }

  groupAt(id: string, point: Point) {
    const state = this.repo.load(id);
    if (point.row < 1 || point.row > state.size || point.col < 1 || point.col > state.size) {
      throw new RuleError('OUT_OF_BOUNDS', '坐标越界');
    }
    const v: Cell = state.board[(point.row - 1) * state.size + (point.col - 1)];
    if (v === null) throw new RuleError('POINT_OCCUPIED', '该点为空，没有棋串');
    const g = findGroup(state.board, state.size, point);
    return { color: g.color, stones: g.stones, liberties: g.liberties };
  }

  boardAt(id: string, atMove: number) {
    const state = this.repo.load(id);
    const { board, nextPlayer } = stateAtMove(state, atMove);
    return {
      moveNumber: atMove,
      nextPlayer,
      ...boardView(board, state.size),
    };
  }

  exportRecord(id: string) {
    return this.repo.exportRecord(id);
  }

  verify(id: string) {
    return this.repo.verifyIntegrity(id);
  }
}
