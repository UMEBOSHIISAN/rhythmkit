// test_finger.js — CC統合検証: engine/fingerboard.js の rkFingerForFret をvmで実行するスモークテスト
// 実行: node tests/test_finger.js（rhythmkitルートから）
// 検証項目（SPEC v1.3「運指ガイドパネル」運指マッピング契約 One-Finger-Per-Fret）:
//   fret 0(開放)=指なし / fret 1-4=指番号=フレット番号 / fret 5-7=指番号=fret-4（ポジション移動）
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'engine', 'fingerboard.js'), 'utf8');
const sandbox = { console };
vm.createContext(sandbox);
// rkFingerForFret はfunction宣言なのでcontextに直接載る想定だが、
// class FingerBoard（lexicalバインディング）はcontextに載らないため、
// test_calib.js と同じ「評価値で受け取る」方式で確実に取り出す。
const [rkFingerForFret] = vm.runInContext(src + '\n;[rkFingerForFret];', sandbox, {
  filename: 'engine/fingerboard.js',
});

let failures = 0;
function check(name, cond) {
  if (cond) console.log('  PASS ' + name);
  else { failures++; console.log('  FAIL ' + name); }
}

const expected = {
  0: { finger: 0, name: null },
  1: { finger: 1, name: 'ひとさしゆび' },
  2: { finger: 2, name: 'なかゆび' },
  3: { finger: 3, name: 'くすりゆび' },
  4: { finger: 4, name: 'こゆび' },
  5: { finger: 1, name: 'ひとさしゆび' },
  6: { finger: 2, name: 'なかゆび' },
  7: { finger: 3, name: 'くすりゆび' },
};

Object.keys(expected).forEach((fretStr) => {
  const fret = Number(fretStr);
  const want = expected[fret];
  const got = rkFingerForFret(fret);
  check(
    'fret ' + fret + ' -> finger=' + want.finger + ' name=' + want.name,
    got && got.finger === want.finger && got.name === want.name
  );
});

// 境界値: null/undefined/負のfretは開放弦扱い（指なし）
check('fret null -> open (no finger)', (() => {
  const r = rkFingerForFret(null);
  return r.finger === 0 && r.name === null;
})());
check('fret undefined -> open (no finger)', (() => {
  const r = rkFingerForFret(undefined);
  return r.finger === 0 && r.name === null;
})());
check('fret negative -> open (no finger)', (() => {
  const r = rkFingerForFret(-1);
  return r.finger === 0 && r.name === null;
})());

console.log(failures === 0 ? '=== test_finger PASS ===' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
