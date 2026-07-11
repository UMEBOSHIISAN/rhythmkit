/*
 * pitch_detector.js — マイク→ピッチ検出（心臓部・iPhone実機で本物の楽器音を拾う）
 *
 * 何をする部品か: getUserMedia でマイク入力を取得し、AnalyserNode の時間領域データを
 *   rAF ポーリングして MPM系自己相関（NSDF）で基本周波数を推定する。検出結果は
 *   input_router.js が統一入力イベント {kind:'pitch', freq, midi, cents, clarity,
 *   level, t} に包んで配信する（このファイル自身はイベント形式を組み立てるだけ）。
 * 外部依存: getUserMedia / AnalyserNode（AudioContextは自分で作らず外から受け取る。
 *   シングルトンは audio_synth.js の getCtx() が所有する）。
 * 差し替えポイント: detectPitchFromBuffer 以下の純関数群はAudioContext・DOM一切
 *   不要の「バッファを渡すと周波数が返る」関数として独立させてある。ユニットテストは
 *   tests/test_pitch.js からこの関数を直接呼ぶ（ブラウザなしで検証可能）。
 *
 * 公開API: PitchDetector.create(opts) → { start():Promise<bool>, stop() }
 *   opts: { ctx, fmin, fmax, levelMin, onPitch }
 *   注意: getUserMediaは楽器判定のためAEC/NS/AGCを全てOFFにする（iOSのAECは
 *   楽器の生音を潰してしまうため必須）。
 */

// ---------------------------------------------------------------------------
// 純関数コア（AudioContext/DOM不要・ユニットテスト対象）
// ---------------------------------------------------------------------------

// NSDF (Normalized Square Difference Function) を lag=0..maxLag で計算する。
// buf: Float32Array の時間領域サンプル。
function computeNSDF(buf, maxLag) {
  const n = buf.length;
  const limitLag = Math.min(maxLag, n - 1);
  const nsdf = new Float32Array(limitLag + 1);
  for (let lag = 0; lag <= limitLag; lag++) {
    let acf = 0;
    let m = 0;
    const limit = n - lag;
    for (let i = 0; i < limit; i++) {
      const a = buf[i];
      const b = buf[i + lag];
      acf += a * b;
      m += a * a + b * b;
    }
    nsdf[lag] = m > 0 ? (2 * acf) / m : 0;
  }
  return nsdf;
}

// NSDF の「正の区間ごとの極大（ローブ）」を集め、MPMのkey-maximum選択則
// （最大ピークのthreshold倍以上に達した最初＝最小lagのローブを採用）でlagを選ぶ。
// 放物線補間でサブサンプル精度に補正する。
// minLag: これより手前のローブは候補から除外する（NSDF値自体は書き換えない。
// 書き換えるとminLag境界に人工的なゼロ交差ができて誤検出する）。
// 戻り値: { lag, clarity } / 未検出時 { lag:-1, clarity:0 }
function findNSDFPeak(nsdf, minLag, threshold) {
  threshold = threshold == null ? 0.9 : threshold;
  minLag = minLag || 0;
  const n = nsdf.length;
  const peaks = [];
  let i = 1;
  while (i < n - 1) {
    if (nsdf[i - 1] <= 0 && nsdf[i] > 0) {
      let localMaxIdx = i;
      while (i < n - 1 && nsdf[i] > 0) {
        if (nsdf[i] > nsdf[localMaxIdx]) localMaxIdx = i;
        i++;
      }
      if (localMaxIdx >= minLag) peaks.push(localMaxIdx);
    } else {
      i++;
    }
  }
  if (peaks.length === 0) return { lag: -1, clarity: 0 };
  let maxVal = -Infinity;
  for (let p = 0; p < peaks.length; p++) {
    if (nsdf[peaks[p]] > maxVal) maxVal = nsdf[peaks[p]];
  }
  let chosen = peaks[0];
  for (let q = 0; q < peaks.length; q++) {
    if (nsdf[peaks[q]] >= maxVal * threshold) { chosen = peaks[q]; break; }
  }
  if (chosen <= 0 || chosen >= n - 1) return { lag: -1, clarity: 0 };
  // 放物線補間（3点: chosen-1, chosen, chosen+1）でサブサンプル精度のlagとpeak値を求める
  const y0 = nsdf[chosen - 1];
  const y1 = nsdf[chosen];
  const y2 = nsdf[chosen + 1];
  const denom = y0 - 2 * y1 + y2;
  const shift = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0;
  const refinedLag = chosen + shift;
  const refinedVal = y1 - 0.25 * (y0 - y2) * shift;
  return { lag: refinedLag, clarity: Math.min(1, Math.max(0, refinedVal)) };
}

// buf(時間領域サンプル) + sampleRate + fmin/fmax から基本周波数を推定する純関数。
// fmin=35Hzが既定（E1=41.2Hzを確実に拾うための探索下限）。fmaxは楽器から渡される。
// 戻り値: { freq, clarity } / 未検出時 { freq:0, clarity:0 }
function detectPitchFromBuffer(buf, sampleRate, fmin, fmax) {
  fmin = fmin || 35;
  fmax = fmax || 1000;
  const maxLag = Math.min(buf.length - 1, Math.ceil(sampleRate / fmin));
  const minLag = Math.max(2, Math.floor(sampleRate / fmax));
  if (maxLag <= minLag) return { freq: 0, clarity: 0 };
  const nsdf = computeNSDF(buf, maxLag);
  // fmaxより高い（=lagが短すぎる）ローブはminLag未満として候補から除外する
  const peak = findNSDFPeak(nsdf, minLag, 0.9);
  if (peak.lag <= 0) return { freq: 0, clarity: 0 };
  return { freq: sampleRate / peak.lag, clarity: peak.clarity };
}

function computeRMS(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

// 実数midiを最寄りの整数midiとセント偏差に分解する。
function midiCents(midiFloat) {
  const midi = Math.round(midiFloat);
  const cents = (midiFloat - midi) * 100;
  return { midi, cents };
}

// ---------------------------------------------------------------------------
// マイク入力ラッパー（AudioContext/DOM必須。ここから下はブラウザでのみ動く）
// ---------------------------------------------------------------------------

const PitchDetector = {
  // opts: { ctx, fmin, fmax, levelMin, onPitch }
  // ctx は外から渡される既存の AudioContext（ここでは新規生成しない）。
  create(opts) {
    opts = opts || {};
    const ctx = opts.ctx || null;
    const fmin = opts.fmin || 35;
    const fmax = opts.fmax || 1000;
    const levelMin = opts.levelMin != null ? opts.levelMin : 0.01;
    const onPitch = typeof opts.onPitch === 'function' ? opts.onPitch : function () {};

    const state = {
      stream: null,
      source: null,
      analyser: null,
      rafId: null,
      timeBuf: null,
      running: false,
    };

    function loop() {
      if (!state.running || !state.analyser) return;
      state.analyser.getFloatTimeDomainData(state.timeBuf);
      const level = computeRMS(state.timeBuf);
      let freq = 0;
      let midi = null;
      let cents = 0;
      let clarity = 0;
      // levelMin未満は無音として捨てる（ノイズゲート）。level自体は常に報告する
      // （hud.jsのマイクレベルメーターが無音時も継続して針を振れるようにするため）。
      if (level >= levelMin) {
        const result = detectPitchFromBuffer(state.timeBuf, ctx.sampleRate, fmin, fmax);
        if (result.freq > 0) {
          freq = result.freq;
          clarity = result.clarity;
          const mc = midiCents(freqToMidi(freq));
          midi = mc.midi;
          cents = mc.cents;
        }
      }
      onPitch({ kind: 'pitch', freq, midi, cents, clarity, level, t: performance.now() / 1000 });
      state.rafId = requestAnimationFrame(loop);
    }

    return {
      start() {
        return new Promise((resolve) => {
          try {
            if (!ctx) { resolve(false); return; }
            if (typeof window !== 'undefined' && window.isSecureContext === false) { resolve(false); return; }
            if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
              resolve(false);
              return;
            }
            navigator.mediaDevices.getUserMedia({
              audio: {
                // 楽器判定に3つのOFF必須: iOSのAECは楽器音を潰す
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
              },
            }).then((stream) => {
              try {
                state.stream = stream;
                state.source = ctx.createMediaStreamSource(stream);
                state.analyser = ctx.createAnalyser();
                state.analyser.fftSize = 4096;
                state.timeBuf = new Float32Array(state.analyser.fftSize);
                state.source.connect(state.analyser);
                state.running = true;
                state.rafId = requestAnimationFrame(loop);
                resolve(true);
              } catch (e) {
                resolve(false);
              }
            }).catch(() => resolve(false));
          } catch (e) {
            resolve(false);
          }
        });
      },
      stop() {
        state.running = false;
        if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = null; }
        if (state.source) { try { state.source.disconnect(); } catch (e) {} state.source = null; }
        if (state.stream) {
          state.stream.getTracks().forEach((tr) => tr.stop());
          state.stream = null;
        }
        state.analyser = null;
      },
    };
  },
};
