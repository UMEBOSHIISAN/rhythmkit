'use strict';
/*
 * test_waitclock.js — FIX-2（れんしゅう/waitモードの描画クロッククランプ）の自己検証。
 *
 * game_core.js の _tick() は以下のロジックでwaitモードのクロックを進める
 * （このテストはそのロジックをそのまま模擬し、engine/judge.js の実物と組み合わせて検証する）:
 *
 *   this._songClock += dt;
 *   const active = this.judge.runners[this.judge.cursor];
 *   if (active) this._songClock = Math.min(this._songClock, active.targetSec);
 *
 * 確認すること:
 *   1. dtをいくら積み重ねても、activeノート（cursor位置）のtargetSecでクロックが止まる
 *   2. 正しいpitchでHITしてcursorが進んだら、クロックは次のactiveノートのtargetSecまで進めるようになる
 *   3. 次のノードも未HITならそこで再び止まる
 *
 * 実行: node tests/test_waitclock.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const files = ['engine/highway.js', 'engine/judge.js'];

const ctx = { console };
ctx.clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
vm.createContext(ctx);
for (const f of files) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf-8'), ctx, { filename: f });
}
// vm.createContext 経由の const/class 宣言はcontextオブジェクトのプロパティに現れないため、
// 同一コンテキスト内で globalThis 経由に橋渡しする。
vm.runInContext('globalThis.__JudgeEngine = JudgeEngine;', ctx, { filename: 'bridge.js' });
const JudgeEngine = ctx.__JudgeEngine;

const instrument = {
  id: 'test',
  lanes: [{ id: 'A', label: 'A', openMidi: 40, color: '#fff' }],
  midiRange: { min: 30, max: 60 },
  mic: { fmin: 30, fmax: 500, clarityMin: 0.8, levelMin: 0.01 },
  noteToLane(midi) { return { laneIndex: 0, fret: midi - 40 }; },
  pitchTolerance: 'exact',
};

const notes = [{ beat: 0, midi: 40 }, { beat: 2, midi: 42 }];
const bpm = 60; // secPerBeat = 1 -> notes[0].targetSec=0, notes[1].targetSec=2

const judge = new JudgeEngine(notes, bpm, instrument, 'pitch', true, 0);

// game_core.js _tick() のwaitモードクランプロジックをそのまま模擬する
function simulateWaitClock(clockRef, dt, judgeEngine) {
  clockRef.v += dt;
  const active = judgeEngine.runners[judgeEngine.cursor];
  if (active) clockRef.v = Math.min(clockRef.v, active.targetSec);
  return clockRef.v;
}

let ok = true;
function check(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) ok = false;
}

const clock = { v: -1 }; // count-in相当で-1秒から開始

// --- 1. HITしていない状態でdtを積み重ねても、targetSec(0)を超えて進まない ---
let t;
for (let i = 0; i < 20; i++) t = simulateWaitClock(clock, 0.1, judge); // 2.0秒分試みる
check('clock clamps at note[0].targetSec(0) before any hit', t === 0);

// --- 2. 正しいpitchを連続60ms以上送ってHITさせる ---
let hit = null;
for (let i = 0; i < 6; i++) {
  const ev = { kind: 'pitch', midi: 40, clarity: 0.95, level: 0.05, t: i * 0.02 };
  const r = judge.feedPitch(ev, t);
  if (r) { hit = r; break; }
}
check('note[0] HIT after 60ms+ correct pitch', !!hit && hit.rank === 'perfect');
check('cursor advances to 1 after hit', judge.cursor === 1);

// --- 3. hit後はクロックが次のactiveノート(targetSec=2)まで進めるようになる ---
for (let i = 0; i < 20; i++) t = simulateWaitClock(clock, 0.1, judge);
check('clock progresses to note[1].targetSec(2) after hit', t === 2);

// --- 4. 2つ目のノートは未HITなので、そこで再度止まる（際限なく進まない） ---
for (let i = 0; i < 10; i++) t = simulateWaitClock(clock, 0.1, judge);
check('clock stays clamped at target(2) without 2nd hit', t === 2);

console.log(ok ? '=== test_waitclock PASS ===' : '=== test_waitclock FAIL ===');
process.exit(ok ? 0 : 1);
