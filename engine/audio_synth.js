/*
 * audio_synth.js — 汎用 Web Audio 手続き合成エンジン（アセットゼロ）
 *
 * 何をする部品か: 音源ファイルを一切使わず、Web Audio の発振器だけでノート音・SFX・
 *   メトロノームを鳴らす。iOS Safari の自動再生制限に対応する unlock() を持ち、
 *   AudioContext のシングルトンをこのファイルが所有して getCtx() で他部品（
 *   pitch_detector.js の PitchDetector.create({ctx}) 等）に共有する。
 * 外部依存: Web Audio API（AudioContext）のみ。
 * 差し替えポイント: SYNTH_PATCHES はパッチ名 → 音色パラメータのテーブル。新しい
 *   楽器の音色を足す場合はここにキーを追加する（パッチ名の値そのものは
 *   instruments/<id>.js の synthPatch フィールドから渡ってくる契約）。
 *
 * 公開API（グローバル関数・const）: getCtx() / unlock() / playNote(midi, opts) /
 *   playSfx(name) / metronome.start(bpm, onTick) / metronome.stop()
 *
 * v1.1音質感アップ: SYNTH_PATCHES に pitchDrop / filterEnv という汎用パラメータを
 *   追加した（楽器名で分岐する専用ロジックではなく、パッチデータが持つ値をエンジンが
 *   読むだけ・エンジン純度は維持）。pitchDrop=立ち上がり数十msでピッチを高音から
 *   目標音へ落とす（プラック感）。filterEnv=同様にローパスの開口を一瞬広げてから
 *   閉じる（ピック/アタックのトランジェント）。どちらも省略可（未指定パッチは
 *   従来どおり定常値のまま鳴る）。
 */

// 可変状態はここに集約する（トップレベル束縛は function宣言 + const オブジェクトのみ、
// という規約を守るため、束縛自体は const にしてプロパティだけ書き換える）。
const __audioState = {
  ctx: null,
  master: null,
  unlocked: false,
  metroTimer: null,
};

// パッチ名 → 音色パラメータ。SPEC:
//   bass  = 三角波+ローパス+短decay（低域が痩せないよう倍音を1つ足す）+プラック
//           アタック（pitchDrop/filterEnv。基音のみに適用・倍音レイヤーには適用しない）
//   piano = 正弦×2倍音+3倍音少量+decay（アタックはピアノらしく素直な立ち上がりのまま）
//   guitar= のこぎり波+ローパス
const SYNTH_PATCHES = {
  bass: {
    wave: 'triangle', filterHz: 900, decay: 0.34, harmonic2Gain: 0.18,
    // 開始45msで+4半音上から目標ピッチへ落ちる＝弦を弾いた瞬間のピッチベンド感
    pitchDrop: { semitones: 4, time: 0.045 },
    // ローパスを一瞬2600Hzまで開いてから900Hzへ閉じる＝ピック/指のアタック
    filterEnv: { startHz: 2600, time: 0.07 },
  },
  piano: { wave: 'sine', filterHz: null, decay: 0.9, harmonic2Gain: 0.5, harmonic3Gain: 0.14 },
  guitar: { wave: 'sawtooth', filterHz: 2200, decay: 0.55, harmonic2Gain: 0 },
};
const DEFAULT_PATCH_NAME = 'bass';

function getCtx() {
  return __audioState.ctx;
}

// iOS unlock: 最初のタップ内で呼ぶこと（AudioContext生成/resumeはユーザー操作内が前提）。
// 2回目以降は既存ctxをresumeするだけの冪等呼び出し。
function unlock() {
  if (__audioState.unlocked) {
    if (__audioState.ctx && __audioState.ctx.state === 'suspended') __audioState.ctx.resume();
    return __audioState.ctx;
  }
  __audioState.unlocked = true;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  __audioState.ctx = new Ctx();
  __audioState.master = __audioState.ctx.createGain();
  __audioState.master.gain.value = 0.6;
  __audioState.master.connect(__audioState.ctx.destination);
  // iOS unlock定石: 無音バッファを一度再生してAudioContextを確実に起こす
  const silentBuf = __audioState.ctx.createBuffer(1, 1, 22050);
  const silentSrc = __audioState.ctx.createBufferSource();
  silentSrc.buffer = silentBuf;
  silentSrc.connect(__audioState.ctx.destination);
  silentSrc.start(0);
  if (__audioState.ctx.state === 'suspended') __audioState.ctx.resume();
  return __audioState.ctx;
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// 1つの発振器レイヤー（基音 or 倍音）をt0からdur秒のエンベロープで鳴らす。
// pitchDrop: {semitones, time} を渡すと開始周波数を高くしてtime秒で目標へ落とす（プラック感）。
// filterEnv: {startHz, time} を渡すとローパスをstartHzから開始しtime秒でfilterHzへ閉じる。
// 両方省略時は従来どおり定常値（後方互換）。
function playOscLayer(ctx, out, waveType, freq, freqMul, gainMul, filterHz, dur, t0, pitchDrop, filterEnv) {
  const osc = ctx.createOscillator();
  osc.type = waveType;
  const targetFreq = freq * freqMul;
  if (pitchDrop && pitchDrop.semitones > 0) {
    const startFreq = targetFreq * Math.pow(2, pitchDrop.semitones / 12);
    osc.frequency.setValueAtTime(startFreq, t0);
    osc.frequency.exponentialRampToValueAtTime(targetFreq, t0 + pitchDrop.time);
  } else {
    osc.frequency.setValueAtTime(targetFreq, t0);
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gainMul, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let node = osc;
  if (filterHz) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    if (filterEnv && filterEnv.startHz > filterHz) {
      f.frequency.setValueAtTime(filterEnv.startHz, t0);
      f.frequency.exponentialRampToValueAtTime(filterHz, t0 + filterEnv.time);
    } else {
      f.frequency.value = filterHz;
    }
    osc.connect(f);
    node = f;
  }
  node.connect(g);
  g.connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// playNote(midi, {patch, dur, vel}) — プレビュー再生・れんしゅうモードの正解音などに使う。
// patch: SYNTH_PATCHES のキー（未知パッチ名はDEFAULT_PATCH_NAMEにフォールバック）
// dur: 秒（省略時はパッチ既定のdecay）。vel: 0-1（省略時0.8）
function playNote(midi, opts) {
  const ctx = __audioState.ctx;
  if (!ctx) return;
  opts = opts || {};
  const patchName = opts.patch && SYNTH_PATCHES[opts.patch] ? opts.patch : DEFAULT_PATCH_NAME;
  const patch = SYNTH_PATCHES[patchName];
  const dur = opts.dur != null ? opts.dur : patch.decay;
  const vel = opts.vel != null ? opts.vel : 0.8;
  const freq = midiToFreq(midi);
  const t0 = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = vel;
  out.connect(__audioState.master);

  // pitchDrop/filterEnv は基音レイヤーのみに適用する（倍音まで揺らすと音程感が濁るため）。
  playOscLayer(ctx, out, patch.wave, freq, 1, 1, patch.filterHz, dur, t0, patch.pitchDrop, patch.filterEnv);
  if (patch.harmonic2Gain) {
    playOscLayer(ctx, out, patch.wave, freq, 2, patch.harmonic2Gain, patch.filterHz, dur, t0);
  }
  if (patch.harmonic3Gain) {
    playOscLayer(ctx, out, patch.wave, freq, 3, patch.harmonic3Gain, patch.filterHz, dur, t0);
  }
}

function scheduleTone(ctx, t0, freq, dur, gain, type) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(__audioState.master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function scheduleSweep(ctx, t0, freqFrom, freqTo, dur, gain, type) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freqFrom, t0);
  osc.frequency.exponentialRampToValueAtTime(freqTo, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.02);
  osc.connect(g);
  g.connect(__audioState.master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// SFX名 → 実際のスケジューリング。t0を外から与えられるようにして、
// メトロノームの先読みスケジューリングと playSfx() の即時再生の両方から使う。
function scheduleSfxAt(name, t0) {
  const ctx = __audioState.ctx;
  if (!ctx) return;
  if (name === 'perfect') {
    scheduleTone(ctx, t0, 1200, 0.09, 0.5, 'sine');
    scheduleTone(ctx, t0 + 0.06, 1800, 0.14, 0.42, 'sine');
  } else if (name === 'good') {
    scheduleTone(ctx, t0, 700, 0.12, 0.4, 'triangle');
  } else if (name === 'miss') {
    // v1.1: 下降スイープ（責められてる感）をやめ、短く静かな2音の「ぽて」に変更。
    // 「おしい！」表示に合わせ、叱られている印象を与えない音量・音域にする。
    scheduleTone(ctx, t0, 349.23, 0.08, 0.22, 'sine');
    scheduleTone(ctx, t0 + 0.06, 293.66, 0.1, 0.16, 'sine');
  } else if (name === 'cheer') {
    // コンボ5刻みの応援用。perfect(高音2音)/fanfare(リザルト4音+伸ばし)と被らないよう、
    // 明るい短い上昇アルペジオ（矩形波で少しゲームらしい輝き）にする。
    const notes = [659.25, 830.61, 1046.5]; // E5 - G#5 - C6
    for (let i = 0; i < notes.length; i++) {
      scheduleTone(ctx, t0 + i * 0.055, notes[i], 0.1, 0.32, 'square');
    }
  } else if (name === 'fanfare') {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    for (let i = 0; i < notes.length; i++) {
      scheduleTone(ctx, t0 + i * 0.09, notes[i], 0.22, 0.4, 'triangle');
    }
    scheduleTone(ctx, t0 + notes.length * 0.09, notes[notes.length - 1] * 1.5, 0.4, 0.35, 'triangle');
  } else if (name === 'metro') {
    scheduleTone(ctx, t0, 1600, 0.03, 0.28, 'square');
  }
}

// playSfx(name) — 'perfect' | 'good' | 'miss' | 'cheer' | 'fanfare' | 'metro' を即時再生
function playSfx(name) {
  const ctx = __audioState.ctx;
  if (!ctx) return;
  scheduleSfxAt(name, ctx.currentTime);
}

// メトロノーム: count-in等で使う。先読みスケジューリングでタイミングのブレを抑える。
const metronome = {
  start(bpm, onTick) {
    metronome.stop();
    const ctx = __audioState.ctx;
    if (!ctx) return;
    const secPerBeat = 60 / bpm;
    const lookahead = 0.12;
    let nextBeatTime = ctx.currentTime + 0.05;
    let beat = 0;
    __audioState.metroTimer = setInterval(() => {
      while (nextBeatTime < ctx.currentTime + lookahead) {
        scheduleSfxAt('metro', nextBeatTime);
        if (typeof onTick === 'function') onTick(beat, nextBeatTime);
        nextBeatTime += secPerBeat;
        beat++;
      }
    }, 25);
  },
  stop() {
    if (__audioState.metroTimer) {
      clearInterval(__audioState.metroTimer);
      __audioState.metroTimer = null;
    }
  },
};
