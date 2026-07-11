'use strict';
// コンテンツ層（instruments/charts）の自己検証。
// registerInstrument/registerChart をスタブし、対象ファイルを vm 実行して機械チェックする。
// game_core.js 等のengine実体には依存しない（未実装でもこのテストは独立して回る）。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const INSTRUMENT_FILES = ['instruments/bass.js', 'instruments/guitar.js', 'instruments/piano.js'];
const CHART_FILE = 'charts/charts_basic.js';
const STRING_INSTRUMENT_IDS = new Set(['bass', 'guitar']);

const instruments = [];
const charts = [];

const sandbox = {
  registerInstrument(def) { instruments.push(def); },
  registerChart(chart) { charts.push(chart); },
  console,
};
vm.createContext(sandbox);

function runFile(relPath) {
  const full = path.join(ROOT, relPath);
  const code = fs.readFileSync(full, 'utf8');
  const script = new vm.Script(code, { filename: relPath });
  script.runInContext(sandbox);
}

const failures = [];

try {
  INSTRUMENT_FILES.forEach(runFile);
  runFile(CHART_FILE);
} catch (e) {
  console.error('LOAD ERROR:', e.stack || e);
  process.exit(1);
}

if (instruments.length !== 3) {
  failures.push(`expected 3 instruments registered, got ${instruments.length}`);
}
if (charts.length !== 10) {
  failures.push(`expected 10 charts registered, got ${charts.length}`);
}

// チェック1: 各チャートのnotesがbeat昇順、チェック2: midiが28-55内
charts.forEach((chart) => {
  let prevBeat = -Infinity;
  chart.notes.forEach((note, idx) => {
    if (note.beat < prevBeat) {
      failures.push(`chart ${chart.id}: beat not ascending at note[${idx}] (beat=${note.beat}, prev=${prevBeat})`);
    }
    prevBeat = note.beat;
    if (note.midi < 28 || note.midi > 55) {
      failures.push(`chart ${chart.id}: midi ${note.midi} out of [28,55] at note[${idx}]`);
    }
  });
});

// チェック3: 3楽器 × 全チャート × 全ノートで noteToLane() が laneIndex範囲内を返す
// チェック4: 弦楽器はfret 0-12内
instruments.forEach((inst) => {
  if (typeof inst.noteToLane !== 'function') {
    failures.push(`instrument ${inst.id}: noteToLane is not a function`);
    return;
  }
  charts.forEach((chart) => {
    chart.notes.forEach((note, idx) => {
      const result = inst.noteToLane(note.midi);
      if (!result || typeof result.laneIndex !== 'number' || !Number.isInteger(result.laneIndex)) {
        failures.push(`${inst.id}/${chart.id} note[${idx}] midi=${note.midi}: noteToLane returned invalid laneIndex`);
        return;
      }
      if (result.laneIndex < 0 || result.laneIndex >= inst.lanes.length) {
        failures.push(`${inst.id}/${chart.id} note[${idx}] midi=${note.midi}: laneIndex ${result.laneIndex} out of [0,${inst.lanes.length - 1}]`);
      }
      if (STRING_INSTRUMENT_IDS.has(inst.id)) {
        if (typeof result.fret !== 'number' || !Number.isInteger(result.fret) || result.fret < 0 || result.fret > 7) {
          failures.push(`${inst.id}/${chart.id} note[${idx}] midi=${note.midi}: fret ${result.fret} out of [0,7]`);
        }
      }
    });
  });
});

if (failures.length > 0) {
  console.error(`FAIL: ${failures.length} issue(s) found`);
  failures.forEach((f) => console.error(' - ' + f));
  process.exit(1);
}

const totalNotes = charts.reduce((sum, c) => sum + c.notes.length, 0);
console.log(`PASS: instruments=${instruments.length} charts=${charts.length} totalNotesChecked=${totalNotes * instruments.length}`);
process.exit(0);
