const INSTRUMENT_BASS = {
  id: 'bass', label: 'ベース', emoji: '🎸',
  judgeModes: ['pitch', 'lane'],
  defaultJudgeMode: 'pitch',
  // TAB譜と同じ並び。上から G D A E
  lanes: [
    { id: 'G', label: 'G(ソ)', openMidi: 43, color: '#f6c945', colorName: 'きいろ', thickness: 1 },
    { id: 'D', label: 'D(レ)', openMidi: 38, color: '#6fd66f', colorName: 'みどり', thickness: 2 },
    { id: 'A', label: 'A(ラ)', openMidi: 33, color: '#5db4f0', colorName: 'あお', thickness: 3 },
    { id: 'E', label: 'E(ミ)', openMidi: 28, color: '#ef8bb0', colorName: 'ピンク', thickness: 4 },
  ],
  midiRange: { min: 28, max: 55 },
  mic: { fmin: 35, fmax: 420, clarityMin: 0.83, levelMin: 0.01 },
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
  // bassは倍音で基音とオクターブが混同されやすいのでオクターブ違い許容
  pitchTolerance: 'pitchClass',
  synthPatch: 'bass',
};
registerInstrument(INSTRUMENT_BASS);
