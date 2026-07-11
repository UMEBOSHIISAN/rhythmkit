const INSTRUMENT_GUITAR = {
  id: 'guitar', label: 'ギター', emoji: '🪕',
  judgeModes: ['pitch', 'lane'],
  defaultJudgeMode: 'pitch',
  // TAB譜と同じ並び。上から e B G D A E（標準チューニング）
  lanes: [
    { id: 'e', label: 'e(高いミ)', openMidi: 64, color: '#ff8787' },
    { id: 'B', label: 'B(シ)', openMidi: 59, color: '#ffa94d' },
    { id: 'G', label: 'G(ソ)', openMidi: 55, color: '#ffe066' },
    { id: 'D', label: 'D(レ)', openMidi: 50, color: '#69db7c' },
    { id: 'A', label: 'A(ラ)', openMidi: 45, color: '#4dabf7' },
    { id: 'E', label: 'E(ミ)', openMidi: 40, color: '#9775fa' },
  ],
  midiRange: { min: 40, max: 76 },
  mic: { fmin: 70, fmax: 1400, clarityMin: 0.83, levelMin: 0.01 },
  display: { type: 'fretboard', fretCount: 7 },
  // midi → {laneIndex, fret}。ローフレット(0-5)優先、無ければ最も近い写像でfret上限12にクランプ
  noteToLane(midi) {
    var lanes = this.lanes;
    var i, fret, candidates = [];
    for (i = 0; i < lanes.length; i++) {
      fret = midi - lanes[i].openMidi;
      if (fret >= 0 && fret <= 5) {
        candidates.push({ laneIndex: i, fret: fret });
      }
    }
    if (candidates.length > 0) {
      candidates.sort(function (a, b) {
        return (a.fret - b.fret) || (a.laneIndex - b.laneIndex);
      });
      return { laneIndex: candidates[0].laneIndex, fret: candidates[0].fret };
    }
    var best = null;
    for (i = 0; i < lanes.length; i++) {
      fret = midi - lanes[i].openMidi;
      var clamped = Math.max(0, Math.min(12, fret));
      var dist = Math.abs(fret - clamped);
      var better = best === null
        || dist < best.dist
        || (dist === best.dist && clamped < best.fret)
        || (dist === best.dist && clamped === best.fret && i < best.laneIndex);
      if (better) {
        best = { laneIndex: i, fret: clamped, dist: dist };
      }
    }
    return { laneIndex: best.laneIndex, fret: best.fret };
  },
  pitchTolerance: 'pitchClass',
  synthPatch: 'guitar',
};
registerInstrument(INSTRUMENT_GUITAR);
