/*
 * fingerboard.js — 押さえ位置ガイド描画（弦楽器フレットボード / 鍵盤）
 *
 * 何をする部品か: pitchモード中、判定線の下の帯に「次にどこを押さえるか」を
 *   INSTRUMENT_DEF.display の type（fretboard|keyboard）に応じて描画する。
 *   レーン色・音域・音名はinstrument/namingから受け取るだけで、楽器名そのものは
 *   一切書かない（fretboard/keyboardという表示型の分岐のみ知っている）。
 * 外部依存: Canvas 2D Context。roundRect / rkNoteName（highway.js が提供・
 *   function宣言の巻き上げにより結合順序に関わらず参照可能）。
 *
 * 公開API: new FingerBoard(instrument, naming)
 *   .setInstrument(instrument) / .setNaming(naming)
 *   .draw(ctx, x, y, w, h, current, next, theme)
 *   current/next: {laneIndex, fret, midi} | null（呼び出し側がnoteToLaneで解決して渡す）
 *   instrument.display が無い/未知typeなら何も描かない（防御。並行して
 *   instruments/*.js に display フィールドが追加される途上でもクラッシュしない）。
 */
class FingerBoard {
  constructor(instrument, naming){
    this.instrument = instrument;
    this.naming = naming || 'doremi';
    // 呼ばれるたびに1増える擬似時間カウンタ。current dot の脈動に使う
    // （Date.now/Math.random不使用・呼び出し回数ベースの決定論パルス）。
    this._frame = 0;
  }
  setInstrument(instrument){ this.instrument = instrument; }
  setNaming(naming){ this.naming = naming; }

  draw(ctx, x, y, w, h, current, next, theme){
    const instrument = this.instrument;
    const display = instrument && instrument.display;
    if (!display || !display.type) return;
    this._frame++;
    theme = theme || {};
    if (display.type === 'fretboard') this._drawFretboard(ctx, x, y, w, h, current, next, theme, display);
    else if (display.type === 'keyboard') this._drawKeyboard(ctx, x, y, w, h, current, next, theme);
  }

  _drawFretboard(ctx, x, y, w, h, current, next, theme, display){
    const lanes = this.instrument.lanes;
    const n = lanes.length;
    const fretCount = Math.max(1, display.fretCount || 7);
    const labelH = 14;
    const openW = Math.min(38, w * 0.14);
    const neckX = x + openW;
    const neckW = Math.max(1, w - openW);
    const staffY = y + labelH;
    const staffH = Math.max(1, h - labelH);
    const stringY = lanes.map((l, i) => staffY + (i + 0.5) * (staffH / n));

    ctx.save();
    // ネック地の帯
    roundRect(ctx, neckX, staffY, neckW, staffH, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();

    // 弦（highwayレーンと同順・同色 = 視覚リンク）
    for (let i = 0; i < n; i++){
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = lanes[i].color || 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(neckX, stringY[i]);
      ctx.lineTo(neckX + neckW, stringY[i]);
      ctx.stroke();
      ctx.restore();
    }

    // フレット線（0=ナット太線）+ 番号
    for (let f = 0; f <= fretCount; f++){
      const fx = neckX + (f / fretCount) * neckW;
      ctx.strokeStyle = f === 0 ? (theme.text || '#fff7e8') : 'rgba(255,255,255,0.28)';
      ctx.lineWidth = f === 0 ? 4 : 1;
      ctx.beginPath();
      ctx.moveTo(fx, staffY);
      ctx.lineTo(fx, staffY + staffH);
      ctx.stroke();
      ctx.fillStyle = 'rgba(230,216,255,0.65)';
      ctx.font = '10px "Hiragino Maru Gothic ProN", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(f), fx, y + labelH - 3);
    }

    // fret→x座標。fret<=0(開放弦)はナット左の専用ゾーン中央、fret>=1はフレット間セルの中点
    const cellX = (fret) => {
      const f = fret == null ? 0 : fret;
      if (f <= 0) return x + openW / 2;
      const clamped = Math.max(1, Math.min(fretCount, f));
      return neckX + ((clamped - 0.5) / fretCount) * neckW;
    };

    // 脈動量（現在ノート用）。Math.sinは_frame(呼び出し回数)にのみ依存し決定論的
    const pulse = 2.5 + Math.sin(this._frame * 0.18) * 2.5;

    if (next && next.laneIndex != null && lanes[next.laneIndex]){
      const nx = cellX(next.fret);
      const ny = stringY[next.laneIndex];
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = theme.accent || '#ff8fb3';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(nx, ny, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (current && current.laneIndex != null && lanes[current.laneIndex]){
      const cx = cellX(current.fret);
      const cy = stringY[current.laneIndex];
      const lane = lanes[current.laneIndex];
      const isOpen = (current.fret == null ? 0 : current.fret) <= 0;
      ctx.save();
      if (isOpen){
        // かいほうげん: ナット左のリング表示（塗りつぶさず輪郭のみ）
        ctx.strokeStyle = theme.judgeLine || '#ffd34d';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, 11 + pulse * 0.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = theme.text || '#fff7e8';
        ctx.font = 'bold 9px "Hiragino Maru Gothic ProN", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('かいほうげん', cx, cy + 22);
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, 15 + pulse, 0, Math.PI * 2);
        ctx.fillStyle = lane.color || theme.accent || '#ff8fb3';
        ctx.fill();
        ctx.strokeStyle = theme.judgeLine || '#ffd34d';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = '#1a1030';
        ctx.font = 'bold 14px "Hiragino Maru Gothic ProN", sans-serif';
        ctx.fillText(String(current.fret), cx, cy + 5);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  _drawKeyboard(ctx, x, y, w, h, current, next, theme){
    const lanes = this.instrument.lanes;
    const n = lanes.length;
    const keyW = w / n;
    ctx.save();
    for (let i = 0; i < n; i++){
      const kx = x + i * keyW;
      const isCurrent = current && current.laneIndex === i;
      const isNext = !isCurrent && next && next.laneIndex === i;
      roundRect(ctx, kx + 2, y, keyW - 4, h, 8);
      ctx.fillStyle = isCurrent ? (lanes[i].color || theme.accent || '#ff8fb3') : 'rgba(255,255,255,0.08)';
      ctx.fill();
      ctx.lineWidth = isNext ? 2 : 1.5;
      ctx.strokeStyle = isNext ? (theme.accent || '#ff8fb3') : 'rgba(255,255,255,0.25)';
      ctx.stroke();
      if (isCurrent && current.midi != null){
        ctx.fillStyle = '#1a1030';
        ctx.textAlign = 'center';
        ctx.font = 'bold 14px "Hiragino Maru Gothic ProN", sans-serif';
        ctx.fillText(rkNoteName(current.midi, this.naming), kx + keyW / 2, y + h / 2 + 5);
      }
    }
    ctx.restore();
  }
}
