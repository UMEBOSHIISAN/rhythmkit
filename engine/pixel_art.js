/*
 * pixel_art.js — パレット+グリッド形式のドット絵を描く汎用描画部品
 *
 * 何をする部品か: { palette: {key: color}, grid: ['..aa..', ...] } という抽象的な
 *   ドット絵データを受け取り、cellSize四方の正方形をgrid通りに並べて描くだけの
 *   純粋関数。ドット絵が何を表しているか（マスコットか、アイコンか）は一切知らない。
 * 外部依存: Canvas 2D Context のみ。
 *
 * 公開API: rkDrawPixelmap(ctx, x, y, cellSize, pixelmap)
 */

// x,y = 描画開始位置（左上）。cellSize = 1マスの一辺の長さ(px)。
// pixelmap.grid の各行は同じ文字数である前提（不揃いな行は短い側でそのまま止まる）。
// '.' と ' ' は透過（描かない）。palette未登録の文字も防御的に無視する。
function rkDrawPixelmap(ctx, x, y, cellSize, pixelmap) {
  if (!pixelmap || !pixelmap.grid || !pixelmap.palette) return;
  const palette = pixelmap.palette;
  const grid = pixelmap.grid;
  for (let row = 0; row < grid.length; row++) {
    const line = grid[row];
    for (let col = 0; col < line.length; col++) {
      const key = line[col];
      if (key === '.' || key === ' ') continue;
      const color = palette[key];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + col * cellSize, y + row * cellSize, cellSize, cellSize);
    }
  }
}
