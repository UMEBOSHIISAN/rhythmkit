const INSTRUMENT_PIANO = {
  id: 'piano', label: 'ピアノ', emoji: '🎹',
  judgeModes: ['lane', 'pitch'],
  defaultJudgeMode: 'lane',
  // C4〜C5 の白鍵8本
  lanes: [
    { id: 'C4', label: 'ド', openMidi: 60, color: '#ff6b6b' },
    { id: 'D4', label: 'レ', openMidi: 62, color: '#ffa94d' },
    { id: 'E4', label: 'ミ', openMidi: 64, color: '#ffe066' },
    { id: 'F4', label: 'ファ', openMidi: 65, color: '#8ce99a' },
    { id: 'G4', label: 'ソ', openMidi: 67, color: '#63e6be' },
    { id: 'A4', label: 'ラ', openMidi: 69, color: '#66d9e8' },
    { id: 'B4', label: 'シ', openMidi: 71, color: '#91a7ff' },
    { id: 'C5', label: 'ド', openMidi: 72, color: '#f783ac' },
  ],
  midiRange: { min: 60, max: 72 },
  mic: { fmin: 230, fmax: 560, clarityMin: 0.83, levelMin: 0.01 },
  display: { type: 'keyboard' },
  // midi → {laneIndex, fret:null}。オクターブを畳んで白鍵に丸める（黒鍵は半音下の白鍵へ）
  // 同梱チャートはbass音域(28-55)で書かれているため、pitch class（音名）だけを見て
  // C4〜B4の7レーンへ丸める。ちょうどmidi72(C5)の時だけ8番目のレーンを使う。
  noteToLane(midi) {
    if (midi === 72) {
      return { laneIndex: 7, fret: null };
    }
    var pc = ((midi % 12) + 12) % 12;
    var whiteLane = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 }; // C D E F G A B
    var blackToWhitePc = { 1: 0, 3: 2, 6: 5, 8: 7, 10: 9 }; // 半音下の白鍵へ丸める
    var wpc = whiteLane.hasOwnProperty(pc) ? pc : blackToWhitePc[pc];
    return { laneIndex: whiteLane[wpc], fret: null };
  },
  pitchTolerance: 'exact',
  synthPatch: 'piano',
};
registerInstrument(INSTRUMENT_PIANO);
