import { randomUUID } from 'node:crypto';
import {
  Cell,
  GameState,
  MoveRecord,
  Point,
  Stone,
  RULES_VERSION,
} from './types';
import { emptyBoard, cloneBoard, opponent, validateInitialBoard } from './board';
import { evaluatePlace } from './rules';

export interface NewGameInput {
  size: number;
  grid?: unknown;
  firstPlayer?: Stone;
}

export function createState(input: NewGameInput, createdAt: string): GameState {
  const result = validateInitialBoard(input.size, input.grid ?? null);
  if (result.error || !result.board) throw new ValidationError(result.error ?? '初始棋盘非法');
  const firstPlayer: Stone = input.firstPlayer ?? 'B';
  if (firstPlayer !== 'B' && firstPlayer !== 'W') {
    throw new ValidationError("firstPlayer 仅允许 'B' 或 'W'");
  }
  const board = result.board;
  return {
    id: randomUUID(),
    size: input.size,
    rulesVersion: RULES_VERSION,
    board,
    nextPlayer: firstPlayer,
    moveNumber: 0,
    history: [cloneBoard(board)],
    moves: [],
    captures: { B: 0, W: 0 },
    over: false,
    endReason: null,
    createdAt,
  };
}

export class ValidationError extends Error {
  code = 'VALIDATION';
}

export interface PlaceResult {
  state: GameState;
  captured: Point[];
  move: MoveRecord;
}

/**
 * 确认落子。expectedMove 为请求时客户端看到的步号；
 * 不一致则拒绝（CONFLICT），状态不变。
 */
export function applyPlace(state: GameState, player: Stone, point: Point): PlaceResult {
  if (state.over) throw new RuleError('GAME_OVER', '对局已因连续两次停一手结束');
  if (player !== state.nextPlayer) {
    throw new RuleError('NOT_YOUR_TURN', `当前轮次为 ${state.nextPlayer}`);
  }
  const outcome = evaluatePlace(state.board, state.size, player, point, state.history);
  if (!outcome.legal) {
    throw new RuleError(outcome.reason!, reasonText(outcome.reason!));
  }
  const moveNumber = state.moveNumber + 1;
  const move: MoveRecord = {
    moveNumber,
    kind: 'place',
    player,
    point,
    captured: outcome.captured,
  };
  state.board = outcome.board;
  state.history.push(cloneBoard(outcome.board));
  state.moves.push(move);
  state.moveNumber = moveNumber;
  state.captures[player] += outcome.captured.length;
  state.nextPlayer = opponent(player);
  return { state, captured: outcome.captured, move };
}

export function applyPass(state: GameState, player: Stone): MoveRecord {
  if (state.over) throw new RuleError('GAME_OVER', '对局已结束');
  if (player !== state.nextPlayer) {
    throw new RuleError('NOT_YOUR_TURN', `当前轮次为 ${state.nextPlayer}`);
  }
  const moveNumber = state.moveNumber + 1;
  const move: MoveRecord = { moveNumber, kind: 'pass', player, point: null, captured: [] };
  // 停一手按普通一步更新历史（棋盘不变），本身不触发单劫检查。
  state.history.push(cloneBoard(state.board));
  state.moves.push(move);
  state.moveNumber = moveNumber;
  state.nextPlayer = opponent(player);
  const prev = state.moves[state.moves.length - 2];
  if (prev && prev.kind === 'pass') {
    state.over = true;
    state.endReason = 'two-passes';
  }
  return move;
}

export class RuleError extends Error {
  constructor(
    public code:
      | 'GAME_OVER'
      | 'NOT_YOUR_TURN'
      | 'OUT_OF_BOUNDS'
      | 'POINT_OCCUPIED'
      | 'SUICIDE'
      | 'KO'
      | 'CONFLICT'
      | 'NOT_FOUND',
    message: string,
  ) {
    super(message);
  }
}

function reasonText(reason: string): string {
  switch (reason) {
    case 'OUT_OF_BOUNDS':
      return '落子坐标越界';
    case 'POINT_OCCUPIED':
      return '该点已有棋子';
    case 'SUICIDE':
      return '自杀落子：提子后己方棋串仍无气';
    case 'KO':
      return '单劫：禁止立即还原到对方上一手落子前的局面';
    default:
      return reason;
  }
}

/** 从空盘 + 已保存动作序列重放，返回重放后的状态（用于重启加载与一致性校验）。 */
export function replay(
  size: number,
  rulesVersion: string,
  initialBoard: Cell[],
  firstPlayer: Stone,
  createdAt: string,
  savedMoves: Array<{ kind: 'place' | 'pass'; player: Stone; point: Point | null }>,
  id: string,
): GameState {
  void rulesVersion;
  const state: GameState = {
    id,
    size,
    rulesVersion: RULES_VERSION,
    board: cloneBoard(initialBoard),
    nextPlayer: firstPlayer,
    moveNumber: 0,
    history: [cloneBoard(initialBoard)],
    moves: [],
    captures: { B: 0, W: 0 },
    over: false,
    endReason: null,
    createdAt,
  };
  for (const m of savedMoves) {
    if (m.kind === 'pass') applyPass(state, m.player);
    else applyPlace(state, m.player, m.point!);
  }
  return state;
}

export function stateAtMove(state: GameState, atMove: number): { board: Cell[]; nextPlayer: Stone } {
  if (atMove < 0 || atMove > state.moveNumber) {
    throw new ValidationError(`步号须在 0..${state.moveNumber}`);
  }
  // history[k] 为第 k 手之后的局面；history[0] 即初始盘。
  return { board: cloneBoard(state.history[atMove]), nextPlayer: playerAfter(state, atMove) };
}

function playerAfter(state: GameState, atMove: number): Stone {
  if (atMove === 0) {
    return state.moves.length > 0 ? state.moves[0].player : state.nextPlayer;
  }
  return opponent(state.moves[atMove - 1].player);
}

export function newEmptyBoard(size: number): Cell[] {
  return emptyBoard(size);
}
