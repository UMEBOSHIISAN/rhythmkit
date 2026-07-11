// test_boot_smoke.js — CC統合検証: dist/umebass/index.html のscriptを
// 最小DOMスタブ付きvmで実行し、「読み込み→boot→title画面到達」を確認する。
// 起動呼び出し欠落・結合順序バグ・レジストリ未登録・load時例外の検出網。
// 実行: node tests/test_boot_smoke.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'umebass', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('FAIL: script tag not found'); process.exit(1); }
const script = m[1];

// --- 最小DOMスタブ ---
function makeCtx2d() {
  const noop = () => {};
  return new Proxy({}, { get: (t, k) => (k === 'canvas' ? {} : noop) });
}
function makeEl(id) {
  const el = {
    id: id || '', children: [], style: {}, dataset: {},
    _classes: new Set(), _listeners: {}, innerHTML: '', textContent: '', value: '-0.12',
    classList: {
      toggle(cls, force) { force ? el._classes.add(cls) : el._classes.delete(cls); },
      add(cls) { el._classes.add(cls); }, remove(cls) { el._classes.delete(cls); },
      contains(cls) { return el._classes.has(cls); },
    },
    addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
    removeEventListener() {}, appendChild(c) { el.children.push(c); return c; },
    contains() { return false; },
    getContext() { return makeCtx2d(); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 375, height: 667 }; },
    width: 375, height: 667, type: '', className: '',
    click() { (el._listeners.click || []).forEach(fn => fn({ target: el })); },
  };
  return el;
}
const elements = {};
function getEl(id) { return elements[id] || (elements[id] = makeEl(id)); }

const sandbox = {
  console,
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0, // boot段階ではループを回さない
  document: {
    getElementById: getEl,
    createElement: () => makeEl(),
    elementFromPoint: () => null,
  },
  navigator: {},
  addEventListener: () => {},
  removeEventListener: () => {},
};
sandbox.window = sandbox; // window.AudioContext等はundefinedのまま（防御コーディング検証を兼ねる）
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

let failures = 0;
function check(name, cond) {
  if (cond) console.log('  PASS ' + name);
  else { failures++; console.log('  FAIL ' + name); }
}

try {
  vm.runInContext(script, sandbox, { filename: 'dist/umebass/index.html#script' });
  console.log('[boot] script executed without exception');
} catch (e) {
  console.error('FAIL: exception during load: ' + e.stack);
  process.exit(1);
}

// IIFE内部の状態はDOM副作用から観測する
const titleEl = elements['rk-game-title'];
check('game title rendered', titleEl && titleEl.textContent === 'うめベース！');
const instRow = elements['rk-instrument-row'];
check('3 instrument chips rendered', instRow && instRow.children.length === 3);
const songList = elements['rk-song-list'];
check('10 song rows rendered', songList && songList.children.length === 10);
const modeRow = elements['rk-mode-row'];
check('2 mode chips rendered', modeRow && modeRow.children.length === 2);
const titleScreen = elements['rk-title'];
check('title screen visible', titleScreen && !titleScreen._classes.has('rk-hidden'));
const resultScreen = elements['rk-result'];
check('result screen hidden', resultScreen && resultScreen._classes.has('rk-hidden'));

// 「はじめる」タップ → pitch楽器(bass)なのでmicSetupへ遷移するはず
// （AudioContext未定義環境でもクラッシュしない防御コーディングの検証を兼ねる）
try {
  elements['rk-btn-start'].click();
  const micScreen = elements['rk-micsetup'];
  check('start tap → micSetup visible (no crash without AudioContext)',
    micScreen && !micScreen._classes.has('rk-hidden'));
} catch (e) {
  failures++;
  console.log('  FAIL start tap crashed: ' + e.message);
}

console.log(failures === 0 ? '=== test_boot_smoke PASS ===' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
