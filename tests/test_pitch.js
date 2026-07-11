#!/usr/bin/env node
/*
 * test_pitch.js — pitch_detector.js の検出コア（純関数）ユニット検証
 *
 * engine/pitch_detector.js を vm でロードし、AudioContext/DOM抜きで
 * detectPitchFromBuffer() を直接呼ぶ。合成正弦波（44100Hz, 4096サンプル）を
 * 41.2Hz(E1)/55Hz/110Hz/220Hz で入力し、検出誤差±1Hz以内・clarity>0.9を確認する。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'engine', 'pitch_detector.js');
const code = fs.readFileSync(SRC, 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: SRC });

const detectPitchFromBuffer = sandbox.detectPitchFromBuffer;
if (typeof detectPitchFromBuffer !== 'function') {
  console.error('FAIL: detectPitchFromBuffer が純関数としてグローバルに切り出されていない');
  process.exit(1);
}

const SAMPLE_RATE = 44100;
const N = 4096;
const FMIN = 35;
const FMAX = 900;
const FREQS = [41.2, 55, 110, 220];

let allPass = true;
for (const f of FREQS) {
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    buf[i] = Math.sin((2 * Math.PI * f * i) / SAMPLE_RATE);
  }
  const result = detectPitchFromBuffer(buf, SAMPLE_RATE, FMIN, FMAX);
  const err = Math.abs(result.freq - f);
  const pass = err <= 1 && result.clarity > 0.9;
  console.log(
    `freq=${f}Hz -> detected=${result.freq.toFixed(4)}Hz err=${err.toFixed(4)}Hz clarity=${result.clarity.toFixed(4)} ${pass ? 'PASS' : 'FAIL'}`
  );
  if (!pass) allPass = false;
}

console.log(allPass ? 'ALL PASS' : 'SOME FAILED');
process.exit(allPass ? 0 : 1);
