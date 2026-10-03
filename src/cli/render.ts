import { Cell } from '../core/types';
import { toGrid } from '../core/board';

export function renderBoard(board: Cell[], size: number): string {
  const grid = toGrid(board, size);
  const colW = String(size).length;
  const lines: string[] = [];
  const header =
    ' '.repeat(String(size).length + 1) +
  grid[0].map((_, c) => String(c + 1).padStart(colW + 1)).join('');
  lines.push(header);
  grid.forEach((rowArr, r) => {
    const label = String(r + 1).padStart(String(size).length);
    const cells = rowArr.map((v) => ' ' + (v === 'B' ? '●' : v === 'W' ? '○' : '·').padStart(colW)).join('');
    lines.push(`${label} ${cells}`);
  });
  return lines.join('\n');
}
