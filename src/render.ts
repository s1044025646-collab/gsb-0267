/** 棋盘文本渲染（CLI 与演示共用）。 */
import type { Cell } from "./engine";

export function renderBoard(size: number, cells: Cell[]): string {
  const sym = (c: Cell) => (c === 0 ? "." : c === 1 ? "X" : "O");
  const lines: string[] = [];
  const header = "   " + Array.from({ length: size }, (_, i) => String(i + 1).padStart(2)).join(" ");
  lines.push(header);
  for (let r = 1; r <= size; r++) {
    const row = Array.from({ length: size }, (_, c) => sym(cells[(r - 1) * size + c])).join("  ");
    lines.push(String(r).padStart(2) + " " + row);
  }
  return lines.join("\n");
}
