/*
 * hud.js — スコア/コンボ/進行バー/マイクレベルメーター/チューナー表示
 *
 * 何をする部品か: play中のcanvasオーバーレイHUDと、チューナーモード単独画面の描画、
 *   リザルトパネルの見た目（ボタンはDOM側・game_core.jsが管理）を提供する関数群。
 *   曲名・楽器名などの固有情報は一切持たない（値はすべて呼び出し側から渡す）。
 * 外部依存: Canvas 2D Context。roundRect / rkNoteName（highway.js が提供・結合順序で先）。
 *   clamp（game_core.js が提供。function宣言の巻き上げにより結合後は参照可能）。
 *
 * 公開API:
 *   drawRkScoreHud(ctx,x,y,score,combo)
 *   drawRkProgressBar(ctx,x,y,w,songTimeSec,totalSec)
 *   drawRkMicMeter(ctx,x,y,w,h,level,levelMin)
 *   drawRkDetectedNote(ctx,x,y,detected,naming) — play中「いま鳴っている音」表示（v1.2）
 *   drawRkTuner(ctx,canvasW,canvasH,detected,naming)
 *   drawRkResultPanel(ctx,canvasW,canvasH,rank,stats,isWaitMode) -> {panelX,panelY,panelW,panelH}
 *   drawRkConfetti(ctx,canvasW,canvasH,frame) — リザルト表示中だけ呼ぶ決定論パーティクル
 *     （frame=呼び出し側の整数カウンタ。Math.random/Date.now不使用）
 */

function drawRkScoreHud(ctx, x, y, score, combo){
  ctx.save();
  roundRect(ctx, x, y, 140, 56, 12);
  ctx.fillStyle = 'rgba(255,250,252,0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#3a2a5a';
  ctx.font = 'bold 16px "Hiragino Maru Gothic ProN", sans-serif';
  ctx.fillText('SCORE ' + score, x + 8, y + 24);
  if (combo > 0){
    ctx.fillStyle = '#ff5f97';
    ctx.font = 'bold 14px "Hiragino Maru Gothic ProN", sans-serif';
    ctx.fillText('コンボ ' + combo, x + 8, y + 46);
  }
  ctx.restore();
}

function drawRkProgressBar(ctx, x, y, w, songTimeSec, totalSec){
  const t = clamp(totalSec > 0 ? songTimeSec / totalSec : 0, 0, 1);
  ctx.save();
  roundRect(ctx, x, y, w, 6, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fill();
  if (t > 0){
    roundRect(ctx, x, y, Math.max(w * t, 6), 6, 3);
    ctx.fillStyle = '#ffd34d';
    ctx.fill();
  }
  ctx.restore();
}

// level: おおよそ0-0.3程度のRMSレベル値
function drawRkMicMeter(ctx, x, y, w, h, level, levelMin){
  ctx.save();
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fill();
  const t = clamp((level || 0) / 0.3, 0, 1);
  if (t > 0){
    roundRect(ctx, x, y, Math.max(w * t, h), h, h / 2);
    ctx.fillStyle = (level || 0) >= (levelMin || 0) ? '#8fe0a0' : '#ffb0b0';
    ctx.fill();
  }
  ctx.restore();
}

// v1.2: play中(pitchモード)の判定線すぐ上に「いま鳴っている音」を表示する。
// detected: null（非表示・呼び出し側が2フレーム連続同一丸めmidi/0.5秒アイドルを判定して渡す）
//   または {midi, match}。match=trueはターゲットとpitch class一致（緑系）、falseは不一致（柔らかい橙系）。
function drawRkDetectedNote(ctx, x, y, detected, naming){
  if (!detected) return;
  const name = rkNoteName(detected.midi, naming);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = detected.match ? '#8fe0a0' : '#ffb677';
  ctx.font = 'bold 15px "Hiragino Maru Gothic ProN", sans-serif';
  ctx.fillText('いま: ' + name, x, y);
  ctx.restore();
}

// detected: null（未検出）または {midi, cents}
function drawRkTuner(ctx, canvasW, canvasH, detected, naming){
  ctx.save();
  ctx.textAlign = 'center';
  if (!detected){
    ctx.fillStyle = '#fff7e8';
    ctx.font = 'bold 20px "Hiragino Maru Gothic ProN", sans-serif';
    ctx.fillText('おとを だしてね', canvasW / 2, canvasH / 2);
    ctx.restore();
    return;
  }
  const name = rkNoteName(detected.midi, naming);
  ctx.fillStyle = '#fff7e8';
  ctx.font = 'bold 64px "Hiragino Maru Gothic ProN", sans-serif';
  ctx.fillText(name, canvasW / 2, canvasH / 2 - 20);

  const cents = clamp(detected.cents || 0, -50, 50);
  const meterW = Math.min(280, canvasW - 60);
  const meterX = canvasW / 2 - meterW / 2;
  const meterY = canvasH / 2 + 20;
  roundRect(ctx, meterX, meterY, meterW, 14, 7);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // 中央=ぴったり
  ctx.beginPath();
  ctx.moveTo(canvasW / 2, meterY - 4);
  ctx.lineTo(canvasW / 2, meterY + 18);
  ctx.strokeStyle = '#ffd34d';
  ctx.stroke();
  const cx = meterX + meterW / 2 + (cents / 50) * (meterW / 2);
  ctx.beginPath();
  ctx.arc(cx, meterY + 7, 9, 0, Math.PI * 2);
  ctx.fillStyle = Math.abs(cents) < 8 ? '#8fe0a0' : '#ff8fb3';
  ctx.fill();

  ctx.fillStyle = '#cbb8e0';
  ctx.font = '13px "Hiragino Maru Gothic ProN", sans-serif';
  ctx.fillText((cents >= 0 ? '+' : '') + Math.round(cents) + ' セント', canvasW / 2, meterY + 40);
  ctx.restore();
}

// stats: {perfect, good, miss}。isWaitMode=trueなら「クリア！」表示（rankは無視）。
// ボタンはDOM側（game_core.js）が担当するため、ここではパネルの矩形情報だけ返す。
function drawRkResultPanel(ctx, canvasW, canvasH, rank, stats, isWaitMode){
  const pw = Math.min(300, canvasW - 40);
  const ph = 260;
  const px = canvasW / 2 - pw / 2;
  const py = canvasH / 2 - ph / 2 - 20;
  ctx.save();
  ctx.fillStyle = 'rgba(20,10,40,0.55)';
  ctx.fillRect(0, 0, canvasW, canvasH);
  roundRect(ctx, px, py, pw, ph, 22);
  ctx.fillStyle = 'rgba(40,20,70,0.96)';
  ctx.fill();
  ctx.strokeStyle = '#ffd34d';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd34d';
  ctx.font = 'bold 40px "Hiragino Maru Gothic ProN", sans-serif';
  ctx.fillText(isWaitMode ? 'クリア！' : rank, canvasW / 2, py + 70);

  ctx.font = 'bold 18px "Hiragino Maru Gothic ProN", sans-serif';
  ctx.fillStyle = '#fff7e8';
  if (!isWaitMode){
    ctx.fillText('パーフェクト ' + stats.perfect, canvasW / 2, py + 120);
    ctx.fillText('グッド ' + stats.good, canvasW / 2, py + 150);
    ctx.fillText('おしい ' + stats.miss, canvasW / 2, py + 180);
    // 練習寄り: 常にポジティブな締めの一言（ゲームオーバー概念が無いことの明示）
    ctx.font = 'bold 15px "Hiragino Maru Gothic ProN", sans-serif';
    ctx.fillStyle = '#ffd34d';
    ctx.fillText('さいごまで ひけたね！', canvasW / 2, py + 215);
  } else {
    ctx.fillText('できた！ ' + stats.perfect + 'こ', canvasW / 2, py + 140);
  }
  ctx.restore();
  return { panelX: px, panelY: py, panelW: pw, panelH: ph };
}

// リザルト表示中だけ呼ぶ紙吹雪パーティクル。frameは呼び出し側が持つ整数カウンタ
// （requestAnimationFrameごとに+1する想定）。乱数不使用: 粒ごとのindexをsin/cosの位相に
// 使うことで、同じframe値なら常に同じ絵になる決定論描画にする。
const RK_CONFETTI_COLORS = ['#ffd34d', '#ff8fb3', '#8fe0a0', '#66d9e8', '#ffa94d'];
function drawRkConfetti(ctx, canvasW, canvasH, frame){
  const n = 24;
  ctx.save();
  for (let i = 0; i < n; i++){
    const xBase = ((Math.sin(i * 12.9898) * 0.5 + 0.5)) * canvasW;
    const sway = Math.sin(frame * 0.05 + i) * 16;
    const x = xBase + sway;
    const y = ((frame * 2.4 + i * 41) % (canvasH + 60)) - 40;
    const size = 5 + (i % 3) * 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(frame * 0.04 + i);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = RK_CONFETTI_COLORS[i % RK_CONFETTI_COLORS.length];
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.restore();
  }
  ctx.restore();
}
