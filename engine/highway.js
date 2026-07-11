/*
 * highway.js — 落下ノートの縦スクロール描画（canvas 2D）
 *
 * 何をする部品か: 判定線に向かってノートが降下していく描画、レーン配置（4/6/8可変）、
 *   HIT演出（リング+ポップ）、lane mode時のタッチ入力ボタン列を描く。楽器の中身
 *   （レーン色・音域・noteToLane写像）はINSTRUMENT_DEFから、曲の中身（notes）は
 *   judge.js の RkNoteRunner から、表示に必要な値だけを読み取る。
 *   楽器名・曲名・キャラ固有名は一切書かない。
 * 外部依存: Canvas 2D Context。RkNoteRunner の形（judge.js）を読む。
 *
 * 公開API: roundRect(共有ヘルパー), rkNoteName(共有ヘルパー), Highway クラス。
 *   new Highway(canvasEl, instrument, naming)
 *   .fit() / .draw(runners, songTimeSec, theme) / .updateFx(dt)
 *   .spawnHitFx(laneIndex, rank) / .spawnMissFx(laneIndex) / .spawnCheerFx(text)
 *   .spawnComboPulse() / .laneButtons
 *   .setJudgeMode('pitch'|'lane') — v1.3: 判定線比率/レイアウトをモードと画面の向きで切り替える。
 *     pitchモード:
 *       - 縦長（w<=h）: 判定線0.70・下30%帯を運指ガイドパネルに（横並び配置。contentW=全幅）
 *       - 横長（w>h・Mac/iPad横）: 判定線0.82のまま・ハイウェイ自体をcontentW=55%に縮め、
 *         右45%全高を運指ガイドパネル領域(panelRegion)にする
 *     laneモード: 常に判定線0.82・contentW=全幅・panelRegion=null（両向き共通・従来どおり）。
 *     既定値は'lane'（tuner等、明示的にpitchが設定されない画面で従来レイアウトを保つ防御）。
 *     向きの判定はfit()のたびに再計算する（resize/orientationchangeで自動追従）。
 *   .contentW — ハイウェイ自身の描画幅（横長×pitch時のみ縮小。他は.wと同じ）
 *   .panelRegion — {x,y,w,h}|null。pitchモード時のみ非null（FingerBoard.drawへそのまま渡す領域）
 */

// 丸角矩形パス（hud.js からも共有で使う）
function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const RK_NOTE_NAMES_ABC = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const RK_NOTE_NAMES_DOREMI = ['ド','ド#','レ','レ#','ミ','ファ','ファ#','ソ','ソ#','ラ','ラ#','シ'];

// naming: 'doremi'|'abc'（hud.js のチューナー表示からも共有で使う）
function rkNoteName(midi, naming){
  const table = naming === 'abc' ? RK_NOTE_NAMES_ABC : RK_NOTE_NAMES_DOREMI;
  const oct = Math.floor(midi / 12) - 1;
  return table[((midi % 12) + 12) % 12] + oct;
}

const RK_LOOKAHEAD_SEC = 4;      // 先読み表示4秒ぶん
// 判定線比率（v1.3: pitchモード縦長は下30%を運指ガイドパネルに空けるため0.70に引き上げ。
// pitchモード横長は判定線はそのまま0.82で、幅の方をcontentWで縮めて右にパネルを空ける。
// laneモードは常に0.82＝下18%＝タッチボタン列のレイアウトを維持）。
const RK_JUDGE_LINE_RATIO_PITCH = 0.70;
const RK_JUDGE_LINE_RATIO_LANE = 0.82;
const RK_PANEL_LANDSCAPE_CONTENT_RATIO = 0.55; // 横長×pitch時、ハイウェイに残す幅の割合（残り45%がパネル）

class Highway {
  constructor(canvas, instrument, naming){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.instrument = instrument;
    this.naming = naming || 'doremi';
    this.hitFx = []; // {x, y, timer, label}
    this.comboPulse = 0; // コンボ5刻み到達時の画面パルス残り秒（0で無効）
    this.laneButtons = [];
    this.judgeMode = 'lane'; // 既定lane（tuner等、setJudgeModeが呼ばれない画面での安全側デフォルト）
    this.fit();
  }
  setInstrument(instrument){
    this.instrument = instrument;
    this._layoutLanes();
  }
  setNaming(naming){ this.naming = naming; }
  // game_core._startPlay()がjudgeMode確定後に呼ぶ。lane以外は全部'lane'扱い（安全側）。
  setJudgeMode(mode){
    this.judgeMode = mode === 'pitch' ? 'pitch' : 'lane';
    this._layoutLanes();
  }
  fit(){
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, Math.round(rect.width || this.canvas.width || 1));
    this.h = Math.max(1, Math.round(rect.height || this.canvas.height || 1));
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._layoutLanes();
  }
  _layoutLanes(){
    if (!this.instrument) return;
    const lanes = this.instrument.lanes;
    const n = lanes.length;
    const isPitchPanel = this.judgeMode === 'pitch';
    const isLandscape = this.w > this.h; // 向きはfit()のたびにここで再判定（resize/orientationchange追従）
    // 横長×pitchのみハイウェイ幅をcontentWに縮め、残りを右パネルに回す。
    // それ以外（縦長×pitch=下30%帯／laneモード=パネル無し）はハイウェイが全幅を使う。
    this.contentW = (isPitchPanel && isLandscape) ? this.w * RK_PANEL_LANDSCAPE_CONTENT_RATIO : this.w;
    const laneW = this.contentW / n;
    this.laneX = lanes.map((l, i) => (i + 0.5) * laneW);
    this.laneW = laneW;
    // 縦長×pitchのみ判定線比率を0.70に上げる。横長×pitch/laneモードは0.82のまま
    // （横長はパネルを幅で確保するため判定線の高さ比率は変えない）。
    this.judgeY = this.h * ((isPitchPanel && !isLandscape) ? RK_JUDGE_LINE_RATIO_PITCH : RK_JUDGE_LINE_RATIO_LANE);
    const btnH = Math.min(64, Math.max(36, this.h - this.judgeY - 8));
    this.laneButtons = lanes.map((l, i) => ({
      laneIndex: i, x: i * laneW, y: this.judgeY + 6, w: laneW, h: btnH,
    }));
    // 運指ガイドパネルの領域（FingerBoard.drawへそのまま渡す）。laneモードはnull=非表示。
    if (!isPitchPanel){
      this.panelRegion = null;
    } else if (isLandscape){
      this.panelRegion = { x: this.contentW, y: 0, w: Math.max(1, this.w - this.contentW), h: this.h };
    } else {
      this.panelRegion = { x: 0, y: this.judgeY, w: this.w, h: Math.max(1, this.h - this.judgeY) };
    }
  }
  // songTimeSec時点でtargetSecのノートがどのy座標にいるか（判定線=judgeYに来る時刻がtargetSec）
  _yFor(targetSec, songTimeSec){
    const dt = targetSec - songTimeSec;
    return this.judgeY - (dt / RK_LOOKAHEAD_SEC) * this.judgeY;
  }
  spawnHitFx(laneIndex, rank){
    const label = rank === 'perfect' ? 'パーフェクト！' : (rank === 'good' ? 'グッド！' : null);
    if (!label || this.laneX == null) return;
    this.hitFx.push({ x: this.laneX[laneIndex], y: this.judgeY, timer: 0.5, ring: 0, label, cheer: false });
  }
  // マスコット応援テキストのポップ（GAME_DEF.theme.mascot.cheer由来の文言を受け取って表示するだけ。
  // 文言の中身・選び方は一切知らない＝呼び出し側(game_core.js)が決める）。リング演出は出さず
  // テキストだけを画面中央上寄りに大きくポップさせる。既存のhitFx更新/描画パイプラインに相乗りする。
  spawnCheerFx(text){
    if (!text) return;
    // contentW中心（横長×pitch時は右パネルにかぶらないよう、ハイウェイ自身の幅の中心に出す）
    this.hitFx.push({ x: this.contentW / 2, y: this.judgeY * 0.4, timer: 0.7, ring: 0, label: text, cheer: true });
  }
  // MISS演出（練習寄り: 「おしい！」の柔らかいポップ。リングは出さず責める見た目にしない）
  spawnMissFx(laneIndex){
    if (this.laneX == null || this.laneX[laneIndex] == null) return;
    this.hitFx.push({ x: this.laneX[laneIndex], y: this.judgeY, timer: 0.5, ring: 0, label: 'おしい！', cheer: false, miss: true });
  }
  // コンボ5刻み到達時に画面を一瞬明るくパルスさせる（game_core._maybeCheerから呼ばれる）
  spawnComboPulse(){
    this.comboPulse = 0.3;
  }
  updateFx(dt){
    for (let i = this.hitFx.length - 1; i >= 0; i--){
      const fx = this.hitFx[i];
      fx.timer -= dt;
      fx.ring += dt * 3;
      if (fx.timer <= 0) this.hitFx.splice(i, 1);
    }
    if (this.comboPulse > 0) this.comboPulse = Math.max(0, this.comboPulse - dt);
  }
  // runners: JudgeEngine.runners（judge.js の RkNoteRunner 配列）
  // lane modeのタッチボタン列は input_router.js が実DOM要素として生成し、
  // game_core.js が座標をCSSで重ねて配置する（canvas内には描画しない設計。
  // laneButtons はそのDOM配置計算のためにレイアウト情報として公開する）。
  draw(runners, songTimeSec, theme){
    const ctx = this.ctx;
    theme = theme || {};
    ctx.clearRect(0, 0, this.w, this.h);

    // 背景（theme.bgの縦グラデ。省略時は単色フォールバック）
    const bg = theme.bg || ['#1a1038', '#2a1a58'];
    const bgGrad = ctx.createLinearGradient(0, 0, 0, this.h);
    bgGrad.addColorStop(0, bg[0] || '#1a1038');
    bgGrad.addColorStop(1, bg[1] || bg[0] || '#2a1038');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, this.w, this.h);

    // レーンごとの薄色フィル（レーン色を淡く敷いて視覚リンクを作る）
    for (let i = 0; i < this.instrument.lanes.length; i++){
      const lane = this.instrument.lanes[i];
      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = lane.color || '#ffffff';
      ctx.fillRect(i * this.laneW, 0, this.laneW, this.judgeY);
      ctx.restore();
    }

    // レーン仕切り線
    ctx.strokeStyle = theme.laneLine || 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    for (let i = 1; i < this.instrument.lanes.length; i++){
      const x = i * this.laneW;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.judgeY); ctx.stroke();
    }
    // 判定線（グロー: shadowBlurは高コストなので、低alphaの太線を下敷きにして重ね描きする）。
    // contentWまで（横長×pitch時は右パネル領域に判定線を伸ばさない）。
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = theme.judgeLine || '#ffd34d';
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(0, this.judgeY); ctx.lineTo(this.contentW, this.judgeY); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = theme.judgeLine || '#ffd34d';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, this.judgeY); ctx.lineTo(this.contentW, this.judgeY); ctx.stroke();

    // ノート
    for (const r of runners){
      if (r.state === 'missed') continue;
      const y = this._yFor(r.targetSec, songTimeSec);
      if (y < -40 || y > this.h + 40) continue;
      const pos = this.instrument.noteToLane(r.note.midi);
      const lane = this.instrument.lanes[pos.laneIndex];
      const x = this.laneX[pos.laneIndex];
      const badgeR = Math.min(this.laneW * 0.36, 26);
      // 判定線に近づく(±1秒)ノートは薄い後光を足して光らせる
      if (r.state === 'pending' && Math.abs(r.targetSec - songTimeSec) < 1){
        ctx.save();
        ctx.globalAlpha = 0.35 * (1 - Math.abs(r.targetSec - songTimeSec));
        ctx.beginPath();
        ctx.arc(x, y, badgeR + 8, 0, Math.PI * 2);
        ctx.fillStyle = lane.color || '#ffffff';
        ctx.fill();
        ctx.restore();
      }
      ctx.save();
      ctx.globalAlpha = r.state === 'hit' ? 0.35 : 1;
      ctx.beginPath();
      ctx.arc(x, y, badgeR, 0, Math.PI * 2);
      ctx.fillStyle = lane.color || '#ffffff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#1a1030';
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px "Hiragino Maru Gothic ProN", sans-serif';
      const inner = pos.fret != null ? String(pos.fret) : rkNoteName(r.note.midi, this.naming);
      ctx.fillText(inner, x, y + 5);
      ctx.font = '10px "Hiragino Maru Gothic ProN", sans-serif';
      ctx.fillStyle = theme.text || '#fff7e8';
      ctx.fillText(rkNoteName(r.note.midi, this.naming), x, y + badgeR + 13);
      ctx.restore();
    }

    // HIT/MISS演出（canvas内。DOMでなくパーティクル的リング+ポップ）。
    // cheer=true（マスコット応援）とmiss=true（練習寄りの「おしい！」）はリングを出さず
    // テキストだけをポップさせる（missを責める見た目にしない）。
    for (const fx of this.hitFx){
      const alpha = Math.max(0, fx.timer / (fx.cheer ? 0.7 : 0.5));
      ctx.save();
      ctx.globalAlpha = alpha;
      if (!fx.cheer && !fx.miss){
        ctx.strokeStyle = theme.accent || '#ff8fb3';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, 20 + fx.ring * 18, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = fx.miss ? (theme.text || '#fff7e8') : (theme.accent || '#ff8fb3');
      ctx.textAlign = 'center';
      ctx.font = fx.cheer
        ? 'bold 22px "Hiragino Maru Gothic ProN", sans-serif'
        : 'bold 16px "Hiragino Maru Gothic ProN", sans-serif';
      ctx.fillText(fx.label, fx.x, fx.y - (fx.cheer ? 0 : 30));
      ctx.restore();
    }

    // コンボ5刻みパルス（画面を一瞬明るく。fadeはupdateFxのcomboPulse減衰に追従）
    if (this.comboPulse > 0){
      ctx.save();
      ctx.globalAlpha = (this.comboPulse / 0.3) * 0.22;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.restore();
    }

    // lane mode時の実タッチボタンはDOM要素（input_router.jsが生成）が担当するため、
    // canvas内には描画しない。laneButtons のレイアウト値はそのDOM位置合わせに使われる。
  }
}
