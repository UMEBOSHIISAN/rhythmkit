/*
 * fingerboard.js — 運指ガイドパネル描画（v1.3: pitchモードの主役UI）
 *
 * 何をする部品か: pitchモード中、highway.panelRegion（縦長画面=判定線下30%の横長い帯／
 *   横長画面=右45%の縦長い帯。向きはhighway.jsがcanvasの実寸から判定する）に
 *   「次にどこを押さえるか」を INSTRUMENT_DEF.display の type（fretboard|keyboard）に
 *   応じて描画する。本ファイル自身は「画面の向き」を知らず、渡された領域の形
 *   （w>h=横長い帯 / h>w=縦長い帯）だけを見て内部レイアウトを選ぶ（自己完結）。
 *   fretboard型: 横長い帯（縦長画面の下部帯）は左55%(フレットボード図)/右45%(手の絵)の
 *   左右分割+最下段ことば指示。縦長い帯（横長画面の右パネル）はフレットボード図→
 *   手の絵→ことば指示を縦に積む。keyboard型は鍵盤図を大型化+ことば指示1行のみ
 *   （どちらの帯形状でも同じ2段構成で自然に収まるため向き分岐は不要）。
 *   レーン色・音域・音名・運指（One-Finger-Per-Fret規則）はinstrument/namingから
 *   受け取るか本ファイルの rkFingerForFret で導出するだけで、楽器名そのものは
 *   一切書かない（fretboard/keyboardという表示型の分岐のみ知っている）。
 * 外部依存: Canvas 2D Context。roundRect / rkNoteName（highway.js が提供・
 *   function宣言の巻き上げにより結合順序に関わらず参照可能）。clamp（game_core.js
 *   が提供。同様に巻き上げにより参照可能。結合順序は highway.js -> fingerboard.js
 *   -> judge.js -> hud.js -> game_core.js だが、実行はスクリプト全体ロード後なので
 *   問題ない＝hud.jsが既に同じ前提でclampを使っている）。
 *
 * 公開API:
 *   rkFingerForFret(fret) -> {finger:0-4, name:string|null}
 *     （純関数・楽器知識なし・tests/test_finger.js のvm単体テスト対象）
 *   new FingerBoard(instrument, naming)
 *     .setInstrument(instrument) / .setNaming(naming)
 *     .draw(ctx, x, y, w, h, current, next, theme)
 *     current/next: {laneIndex, fret, midi} | null（呼び出し側がnoteToLaneで解決して渡す）
 *     instrument.display が無い/未知typeなら何も描かない（防御。並行して
 *     instruments/*.js に display フィールドが追加される途上でもクラッシュしない）。
 */

// 運指マッピング（One-Finger-Per-Fret・エンジン共通規則。楽器の弦/フレット構造は知らず、
// fret番号だけを受け取る純関数）。
// fret 0(開放)=指なし / fret 1-4=指番号=フレット番号 / fret 5-7=指番号=fret-4（ポジション移動。
// 表示は指名のみでポジション概念はUIに出さない）。
const RK_FINGER_NAMES = [null, 'ひとさしゆび', 'なかゆび', 'くすりゆび', 'こゆび'];
function rkFingerForFret(fret){
  if (fret == null || fret <= 0) return { finger: 0, name: null };
  const raw = fret <= 4 ? fret : fret - 4;
  const finger = Math.max(0, Math.min(4, raw));
  return { finger: finger, name: RK_FINGER_NAMES[finger] || null };
}

class FingerBoard {
  constructor(instrument, naming){
    this.instrument = instrument;
    this.naming = naming || 'doremi';
    // 呼ばれるたびに1増える擬似時間カウンタ。current dot / 指の脈動に使う
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
    if (display.type === 'fretboard') this._drawFretboardPanel(ctx, x, y, w, h, current, next, theme, display);
    else if (display.type === 'keyboard') this._drawKeyboardPanel(ctx, x, y, w, h, current, next, theme);
  }

  // --- fretboard型パネル ---
  // 渡された帯の形状だけで内部レイアウトを決める（呼び出し側の画面向きは知らない）。
  //   横長い帯(w>=h・縦長画面の下部30%帯): 左55%フレットボード図 + 右45%手の絵（横並び）
  //   縦長い帯(h>w・横長画面の右45%パネル): フレットボード図 → 手の絵 を縦に積む
  // どちらも最下段1行はことば指示。
  _drawFretboardPanel(ctx, x, y, w, h, current, next, theme, display){
    const lanes = this.instrument.lanes;
    const lane = (current && current.laneIndex != null && lanes[current.laneIndex]) ? lanes[current.laneIndex] : null;
    const stacked = h > w;
    const instructionH = clamp(h * (stacked ? 0.1 : 0.2), 18, 30);
    const bodyH = Math.max(1, h - instructionH);
    if (stacked){
      const fbH = bodyH * 0.55;
      const handH = Math.max(1, bodyH - fbH);
      this._drawFretboard(ctx, x, y, w, fbH, current, next, theme, display);
      this._drawHand(ctx, x, y + fbH, w, handH, current, lane, theme);
    } else {
      const fbW = w * 0.55;
      const handW = Math.max(1, w - fbW);
      this._drawFretboard(ctx, x, y, fbW, bodyH, current, next, theme, display);
      this._drawHand(ctx, x + fbW, y, handW, bodyH, current, lane, theme);
    }
    const text = this._buildFretInstruction(lanes, current);
    this._drawInstructionLine(ctx, x, y + bodyH, w, instructionH, text, theme);
  }

  _drawFretboard(ctx, x, y, w, h, current, next, theme, display){
    const lanes = this.instrument.lanes;
    const n = lanes.length;
    const fretCount = Math.max(1, display.fretCount || 7);
    // フレット番号ラベルの帯・フォントはパネルの高さに応じて拡大する（品質基準:
    // 「フレット番号を大きく」。縦長い帯(横長画面の右パネル)はhが大きいので上限で頭打ちにする）。
    const labelFontPx = Math.round(clamp(h * 0.09, 11, 15));
    const labelH = labelFontPx + 6;
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

    // 弦（highwayレーンと同順・同色 = 視覚リンク。thicknessに応じた太さで描く。
    // 品質基準「弦の太さ差をはっきり」: 1刻みごとに2pxずつ明確に太くする）。
    for (let i = 0; i < n; i++){
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = lanes[i].color || 'rgba(255,255,255,0.4)';
      ctx.lineWidth = lanes[i].thickness ? (2 + (lanes[i].thickness - 1) * 2) : 2;
      ctx.lineCap = 'round';
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
      ctx.fillStyle = 'rgba(230,216,255,0.85)';
      ctx.font = 'bold ' + labelFontPx + 'px "Hiragino Maru Gothic ProN", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(f), fx, y + labelH - 4);
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
    // 現在ノートのドット半径・フレット番号フォントもパネルサイズに応じて拡大する
    // （品質基準「押さえるドットは指名の色と一致」＋視認性向上。laneW=弦間隔が上限）
    const dotR = clamp(Math.min(staffH / n, neckW / fretCount) * 0.32, 14, 26);
    const dotFontPx = Math.round(clamp(dotR * 0.9, 12, 18));

    if (next && next.laneIndex != null && lanes[next.laneIndex]){
      const nx = cellX(next.fret);
      const ny = stringY[next.laneIndex];
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = theme.accent || '#ff8fb3';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(nx, ny, dotR * 0.8, 0, Math.PI * 2);
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
        ctx.arc(cx, cy, dotR * 0.75 + pulse * 0.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = theme.text || '#fff7e8';
        ctx.font = 'bold ' + Math.round(dotFontPx * 0.7) + 'px "Hiragino Maru Gothic ProN", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('かいほうげん', cx, cy + dotR + 8);
      } else {
        // 押さえるドットはlane.color（指の色と同じ源）＝手の絵の指ハイライトと一致させる
        ctx.beginPath();
        ctx.arc(cx, cy, dotR + pulse, 0, Math.PI * 2);
        ctx.fillStyle = lane.color || theme.accent || '#ff8fb3';
        ctx.fill();
        ctx.strokeStyle = theme.judgeLine || '#ffd34d';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = '#1a1030';
        ctx.font = 'bold ' + dotFontPx + 'px "Hiragino Maru Gothic ProN", sans-serif';
        ctx.fillText(String(current.fret), cx, cy + dotFontPx * 0.36);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  // --- 左手の絵: 4本指+親指の簡易シルエット（丸角）。使う指だけ塗って脈動+指名ラベル。
  // 開放弦(またはcurrent無し)は手全体を薄くして「おさえない」。 ---
  _drawHand(ctx, x, y, w, h, current, lane, theme){
    const isOpen = !current || (current.fret == null ? true : current.fret <= 0);
    const fingerObj = (current && !isOpen) ? rkFingerForFret(current.fret) : { finger: 0, name: null };
    const activeFinger = fingerObj.finger;
    const activeColor = (lane && lane.color) || theme.accent || '#ff8fb3';
    const pulse = 2 + Math.sin(this._frame * 0.18) * 2;

    const cx = x + w / 2;
    const palmW = w * 0.46;
    const palmH = h * 0.34;
    const palmX = cx - palmW / 2;
    const palmY = y + h * 0.56;

    ctx.save();
    ctx.globalAlpha = isOpen ? 0.35 : 1;

    // おやゆび（左下に斜め付け・機能割当なし・シルエットのみ。常に中立色）
    const thumbW = palmW * 0.42;
    const thumbH = h * 0.2;
    roundRect(ctx, palmX - thumbW * 0.5, palmY + palmH * 0.42, thumbW, thumbH, thumbW / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 4ほんゆび: ひとさしゆび〜こゆびを左から並べる（なか/くすりゆびをやや長く=自然な見た目）
    const fingerW = palmW * 0.19;
    const fingerGap = Math.max(1, (palmW - fingerW * 4) / 5);
    const fingerLenRatio = [0.62, 0.74, 0.72, 0.58];
    let fx = palmX + fingerGap;
    for (let f = 1; f <= 4; f++){
      const isActive = !isOpen && activeFinger === f;
      const fingerH = h * fingerLenRatio[f - 1] + (isActive ? pulse : 0);
      const fy = palmY + palmH * 0.1 - fingerH;
      roundRect(ctx, fx, fy, fingerW, fingerH, fingerW / 2);
      ctx.fillStyle = isActive ? activeColor : 'rgba(255,255,255,0.16)';
      ctx.fill();
      ctx.strokeStyle = isActive ? (theme.judgeLine || '#ffd34d') : 'rgba(255,255,255,0.32)';
      ctx.lineWidth = isActive ? 2.5 : 1.5;
      ctx.stroke();
      fx += fingerW + fingerGap;
    }

    // てのひら（指の付け根を隠す土台。指より後に描くと指が埋まるので指の前に描画順を保つため
    // ここでは指のあとに重ねず、指の根本だけ隠れるよう指より薄い不透明度で下敷きにする）
    roundRect(ctx, palmX, palmY, palmW, palmH, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // ラベル: 開放弦・current無し=「おさえない」/ それ以外=指名
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.text || '#fff7e8';
    ctx.font = 'bold 12px "Hiragino Maru Gothic ProN", sans-serif';
    const label = isOpen ? 'おさえない' : (fingerObj.name || '');
    if (label) ctx.fillText(label, cx, y + h - 4);
    ctx.restore();
  }

  // ことば指示（fretboard型）を組み立てる。current無し/lane不明なら空文字（何も描かない）。
  // 「いちばん ふとい/ほそい」は lanes 中の thickness 最大/最小のときだけ付ける
  // （エンジンは値比較のみ・楽器知識は持たない）。
  _buildFretInstruction(lanes, current){
    if (!current || current.laneIndex == null || !lanes[current.laneIndex]) return '';
    const lane = lanes[current.laneIndex];
    const fret = current.fret == null ? 0 : current.fret;
    const colorName = lane.colorName || '';
    if (fret <= 0){
      const thicknesses = lanes.map((l) => l.thickness).filter((t) => typeof t === 'number');
      let note = '';
      if (thicknesses.length && typeof lane.thickness === 'number'){
        const maxT = Math.max.apply(null, thicknesses);
        const minT = Math.min.apply(null, thicknesses);
        if (maxT !== minT){
          if (lane.thickness === maxT) note = '（いちばん ふとい）';
          else if (lane.thickness === minT) note = '（いちばん ほそい）';
        }
      }
      return colorName + 'の げん' + note + 'を そのまま ベン！';
    }
    const fingerObj = rkFingerForFret(fret);
    return colorName + 'の げん・' + fret + 'フレットを ' + (fingerObj.name || '') + 'で！';
  }

  // ことば指示の共通描画（fretboard/keyboard両方から呼ばれる・最下段1行・大きく太く）
  _drawInstructionLine(ctx, x, y, w, h, text, theme){
    if (!text) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.text || '#fff7e8';
    const fontSize = Math.round(clamp(h * 0.55, 13, 20));
    ctx.font = 'bold ' + fontSize + 'px "Hiragino Maru Gothic ProN", sans-serif';
    ctx.fillText(text, x + w / 2, y + h * 0.7);
    ctx.restore();
  }

  // --- keyboard型パネル: 鍵盤図を大型化 + 最下段ことば指示（指指定なし） ---
  _drawKeyboardPanel(ctx, x, y, w, h, current, next, theme){
    const instructionH = clamp(h * 0.2, 18, 30);
    const imgH = Math.max(1, h - instructionH);
    this._drawKeyboard(ctx, x, y, w, imgH, current, next, theme);
    const text = this._buildKeyInstruction(current);
    this._drawInstructionLine(ctx, x, y + imgH, w, instructionH, text, theme);
  }

  _buildKeyInstruction(current){
    if (!current || current.midi == null) return '';
    return '"' + rkNoteName(current.midi, this.naming) + '" の けんばんを おして！';
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
