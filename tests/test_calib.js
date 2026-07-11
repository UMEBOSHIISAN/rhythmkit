// test_calib.js — CC統合検証: game_core.js の rkMedian/rkCalibOffset をvmで実行するスモークテスト
// 実行: node tests/test_calib.js（rhythmkitルートから）
// 検証項目（SPEC v1.2「オートキャリブレーション」の純関数部分）:
//   1. rkMedian: 奇数個/偶数個の配列で正しい中央値を返す
//   2. rkCalibOffset: offsetSec = -median(deltas) を [-0.3, +0.3] にclampする
//   3. rkCalibOffset: サンプルが4未満ならnull（リトライ対象）を返す
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'engine', 'game_core.js'), 'utf8');
const sandbox = { console };
vm.createContext(sandbox);
// rkMedian/rkCalibOffset はfunction宣言なのでcontextに直接載る想定だが、
// class/const宣言（lexicalバインディング）はcontextに載らないため、
// test_smoke_judge.js と同じ「評価値で受け取る」方式で確実に取り出す。
const [rkMedian, rkCalibOffset] = vm.runInContext(src + '\n;[rkMedian, rkCalibOffset];', sandbox, {
  filename: 'engine/game_core.js',
});

let failures = 0;
function check(name, cond) {
  if (cond) console.log('  PASS ' + name);
  else { failures++; console.log('  FAIL ' + name); }
}

// --- rkMedian ---
check('median odd count', rkMedian([3, 1, 2]) === 2);
check('median even count', rkMedian([1, 2, 3, 4]) === 2.5);
check('median single element', rkMedian([5]) === 5);
check('median does not mutate input', (() => {
  const arr = [3, 1, 2];
  rkMedian(arr);
  return arr[0] === 3 && arr[1] === 1 && arr[2] === 2;
})());
check('median empty/null returns null', rkMedian([]) === null && rkMedian(null) === null);

// --- rkCalibOffset ---
// deltas = onset - tick。offsetSec = -median(deltas)。
check('offset basic (4 samples, median 0.1 -> offset -0.1)',
  Math.abs(rkCalibOffset([0.1, 0.1, 0.1, 0.1]) - (-0.1)) < 1e-9);
check('offset with mixed samples (median computed correctly)', (() => {
  const deltas = [0.05, 0.08, 0.12, 0.09]; // sorted: 0.05,0.08,0.09,0.12 -> median (0.08+0.09)/2=0.085
  const offset = rkCalibOffset(deltas);
  return Math.abs(offset - (-0.085)) < 1e-9;
})());
check('offset clamps to +0.3 upper bound', rkCalibOffset([-0.5, -0.5, -0.5, -0.5]) === 0.3);
check('offset clamps to -0.3 lower bound', rkCalibOffset([0.5, 0.5, 0.5, 0.5]) === -0.3);
check('offset with exactly 4 samples succeeds (boundary)', rkCalibOffset([0.1, 0.1, 0.1, 0.1]) !== null);
check('offset with fewer than 4 samples returns null (retry)', rkCalibOffset([0.1, 0.1, 0.1]) === null);
check('offset with 0 samples returns null', rkCalibOffset([]) === null);
check('offset with null/undefined returns null', rkCalibOffset(null) === null && rkCalibOffset(undefined) === null);

console.log(failures === 0 ? '=== test_calib PASS ===' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
