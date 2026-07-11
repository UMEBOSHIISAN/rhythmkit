/*
 * input_router.js — mic/touch/keyboard を統一入力イベントに正規化する
 *
 * 何をする部品か: pitch_detector.js（マイク）・画面下のレーンボタン（タッチ）・
 *   キーボード（開発検証用）の3系統の入力を、SPECの統一入力イベント形式
 *   { kind:'pitch', freq, midi, cents, clarity, level, t } または
 *   { kind:'lane', laneIndex, t } に正規化して onEvent(cb) 購読者へ配信する。
 * 外部依存: pitch_detector.js の PitchDetector（結合順で本ファイルより前に読み込まれる
 *   前提）、audio_synth.js の getCtx()（AudioContextは自分で作らない）。
 * 差し替えポイント: attachTouch(el, lanes) はレーンボタンDOM自体をこの関数が
 *   生成する設計（highway.js/hud.js が別途ボタンDOMを作る場合は二重生成に
 *   注意。lanes配列の color/label をそのままボタンの見た目に使う）。
 *
 * 公開API: InputRouter.create(opts) →
 *   { onEvent(cb), startMic():Promise<bool>, stopMic(), attachTouch(el, lanes),
 *     attachKeyboard(lanes), micActive }
 *   opts: { fmin, fmax, levelMin } （instrument.mic をそのまま渡す想定）
 */

// レーン数ぶんの割当。上レーンから 1..9 → a s d f g h j k の順（開発検証用）
const RK_KEY_SEQUENCE = ['1','2','3','4','5','6','7','8','9','a','s','d','f','g','h','j','k'];

function rkLaneIndexOfElement(target, buttons) {
  for (let i = 0; i < buttons.length; i++) {
    if (buttons[i] === target || (buttons[i].contains && buttons[i].contains(target))) return i;
  }
  return -1;
}

// 画面下のレーンボタンをel内に生成し、タッチスタート即発火・マルチタッチ対応で
// laneイベントを発火する。マウス/ペン（開発機での確認用）はpointerdownで拾い、
// touchpointerは touchstart側で処理済みなので二重発火しないようスキップする。
function rkAttachTouch(el, lanes, emit) {
  el.innerHTML = '';
  const buttons = [];
  for (let i = 0; i < lanes.length; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.laneIndex = String(i);
    btn.style.background = lanes[i].color || '#888';
    btn.style.touchAction = 'none';
    btn.textContent = lanes[i].label || '';
    el.appendChild(btn);
    buttons.push(btn);
  }
  function fireLane(idx) {
    emit({ kind: 'lane', laneIndex: idx, t: performance.now() / 1000 });
  }
  el.addEventListener('touchstart', (ev) => {
    ev.preventDefault();
    for (let i = 0; i < ev.changedTouches.length; i++) {
      const touch = ev.changedTouches[i];
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      const idx = rkLaneIndexOfElement(target, buttons);
      if (idx >= 0) fireLane(idx);
    }
  }, { passive: false });
  el.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'touch') return; // touchstartで処理済み・二重発火防止
    const idx = rkLaneIndexOfElement(ev.target, buttons);
    if (idx >= 0) fireLane(idx);
  });
  return buttons;
}

// キーボード割当（開発検証用）。window.keydownを監視しrepeatは無視する。
// 戻り値: detach関数（stopMic等とは独立にリスナーを外したい場合用）。
function rkAttachKeyboard(lanes, emit) {
  const map = {};
  for (let i = 0; i < lanes.length && i < RK_KEY_SEQUENCE.length; i++) {
    map[RK_KEY_SEQUENCE[i]] = i;
  }
  function onKeyDown(ev) {
    if (ev.repeat) return;
    const key = ev.key ? ev.key.toLowerCase() : '';
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      emit({ kind: 'lane', laneIndex: map[key], t: performance.now() / 1000 });
    }
  }
  window.addEventListener('keydown', onKeyDown);
  return function detach() { window.removeEventListener('keydown', onKeyDown); };
}

const InputRouter = {
  // opts: { fmin, fmax, levelMin } — instrument.mic をそのまま渡す想定
  create(opts) {
    opts = opts || {};
    const listeners = [];
    const state = { micActive: false, detector: null };

    function emit(evt) {
      for (let i = 0; i < listeners.length; i++) listeners[i](evt);
    }

    return {
      onEvent(cb) {
        if (typeof cb === 'function') listeners.push(cb);
      },
      // pitch_detector.js を包んでPromise<bool>を返す。AudioContextは
      // audio_synth.js の getCtx()（結合順で本ファイルより前に定義済み）を使う。
      startMic() {
        const ctx = typeof getCtx === 'function' ? getCtx() : null;
        state.detector = PitchDetector.create({
          ctx,
          fmin: opts.fmin,
          fmax: opts.fmax,
          levelMin: opts.levelMin,
          onPitch(evt) { emit(evt); },
        });
        return state.detector.start().then((ok) => {
          state.micActive = ok;
          return ok;
        });
      },
      stopMic() {
        if (state.detector) state.detector.stop();
        state.micActive = false;
      },
      attachTouch(el, lanes) {
        return rkAttachTouch(el, lanes, emit);
      },
      attachKeyboard(lanes) {
        return rkAttachKeyboard(lanes, emit);
      },
      get micActive() { return state.micActive; },
    };
  },
};
