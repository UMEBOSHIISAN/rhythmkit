// test_smoke_judge.js — CC統合検証: judge.js の判定ロジックをvmで実行するスモークテスト
// 実行: node tests/test_smoke_judge.js（rhythmkitルートから）
// 検証項目（SPEC「検証」#3の判定系）:
//   1. pitch HIT: 窓内で正しいmidiを60ms以上保持 → perfect
//   2. pitchClass許容: 1オクターブ上でもHIT / exact設定では外れる
//   3. clarity不足はHITしない
//   4. 通常モード: 窓を過ぎたら miss / コンボリセット
//   5. waitモード: 時間が過ぎてもmissしない・正解でperfect・cursorが進む
//   6. lane判定: 正しいレーンのタップでHIT
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'engine', 'judge.js'), 'utf8');
const ctx = { console };
vm.createContext(ctx);
// class宣言はlexicalバインディングでcontextオブジェクトに載らないため、評価値で受け取る
ctx.JudgeEngine = vm.runInContext(src + '\n;JudgeEngine;', ctx);

const INST = {
  id: 'testinst',
  pitchTolerance: 'pitchClass',
  mic: { clarityMin: 0.83, levelMin: 0.01 },
  lanes: [{}, {}, {}, {}],
  noteToLane(midi) { return { laneIndex: midi % 4, fret: 0 }; },
};

const NOTES = [
  { beat: 0, midi: 40 },
  { beat: 2, midi: 45 },
  { beat: 4, midi: 43 },
];
const BPM = 60; // 1 beat = 1 sec で計算が読みやすい

let failures = 0;
function check(name, cond) {
  if (cond) { console.log('  PASS ' + name); }
  else { failures++; console.log('  FAIL ' + name); }
}
function pitchEv(midi, t, clarity, level) {
  return { kind: 'pitch', freq: 0, midi, cents: 0, clarity: clarity == null ? 0.95 : clarity, level: level == null ? 0.1 : level, t };
}

// --- 1. pitch HIT（60ms保持でperfect） ---
console.log('[1] pitch HIT with 60ms hold');
{
  const j = new ctx.JudgeEngine(NOTES, BPM, INST, 'pitch', false, 0);
  // targetSec=0 のノートに対し t=0.00 から 10ms刻みでフィード
  let hit = null;
  for (let i = 0; i <= 8 && !hit; i++) {
    hit = j.feedPitch(pitchEv(40, i * 0.01), 0 + i * 0.01);
  }
  check('hit occurs', !!hit);
  check('rank is perfect', hit && hit.rank === 'perfect');
  check('score added', j.score > 0);
  check('combo=1', j.combo === 1);
}

// --- 2. pitchClass許容 / exact ---
console.log('[2] pitchClass tolerance');
{
  const j = new ctx.JudgeEngine(NOTES, BPM, INST, 'pitch', false, 0);
  let hit = null;
  for (let i = 0; i <= 8 && !hit; i++) hit = j.feedPitch(pitchEv(52, i * 0.01), i * 0.01); // 40+12
  check('octave-up hits with pitchClass', !!hit);
  const exactInst = Object.assign({}, INST, { pitchTolerance: 'exact' });
  const j2 = new ctx.JudgeEngine(NOTES, BPM, exactInst, 'pitch', false, 0);
  let hit2 = null;
  for (let i = 0; i <= 8 && !hit2; i++) hit2 = j2.feedPitch(pitchEv(52, i * 0.01), i * 0.01);
  check('octave-up rejected with exact', !hit2);
}

// --- 3. clarity不足 ---
console.log('[3] low clarity rejected');
{
  const j = new ctx.JudgeEngine(NOTES, BPM, INST, 'pitch', false, 0);
  let hit = null;
  for (let i = 0; i <= 8 && !hit; i++) hit = j.feedPitch(pitchEv(40, i * 0.01, 0.5), i * 0.01);
  check('no hit at clarity=0.5', !hit);
}

// --- 4. 通常モードmiss ---
console.log('[4] rhythm-mode miss past window');
{
  const j = new ctx.JudgeEngine(NOTES, BPM, INST, 'pitch', false, 0);
  const missed = j.update(0.36); // GOOD窓0.35を過ぎた
  check('note0 missed', missed.length === 1 && missed[0].note.midi === 40);
  check('stats.miss=1', j.stats.miss === 1);
  check('cursor advanced', j.cursor === 1);
}

// --- 5. waitモード ---
console.log('[5] wait mode: no miss, hit advances');
{
  const j = new ctx.JudgeEngine(NOTES, BPM, INST, 'pitch', true, 0);
  const missed = j.update(100); // 大幅に時間超過してもmissなし
  check('no miss in wait mode', missed.length === 0 && j.stats.miss === 0);
  let hit = null;
  for (let i = 0; i <= 8 && !hit; i++) hit = j.feedPitch(pitchEv(40, 100 + i * 0.01), 100 + i * 0.01);
  check('late correct pitch still hits', !!hit && hit.rank === 'perfect');
  check('cursor moved to note1', j.cursor === 1);
  // 間違った音では次のノートに進まない
  let wrongHit = null;
  for (let i = 0; i <= 8 && !wrongHit; i++) wrongHit = j.feedPitch(pitchEv(41, 200 + i * 0.01), 200 + i * 0.01);
  check('wrong pitch does not hit', !wrongHit && j.cursor === 1);
}

// --- 6. lane判定 ---
console.log('[6] lane tap judging');
{
  const j = new ctx.JudgeEngine(NOTES, BPM, INST, 'lane', false, 0);
  const wrong = j.feedLane({ kind: 'lane', laneIndex: 1, t: 0 }, 0); // 40%4=0 が正
  check('wrong lane no hit', !wrong);
  const right = j.feedLane({ kind: 'lane', laneIndex: 0, t: 0.01 }, 0.01);
  check('right lane hits', !!right && right.rank === 'perfect');
  const good = j.feedLane({ kind: 'lane', laneIndex: 1, t: 2.25 }, 2.25); // note1(midi45,lane1) delta=0.25→good
  check('0.25s late is good', !!good && good.rank === 'good');
}

console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
