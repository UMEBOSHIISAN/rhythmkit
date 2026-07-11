// 同梱チャート10曲。全音域はbassのmidiRange(28-55)に収まるよう書く。
// pianoはnoteToLaneのオクターブ丸めでそのまま同じチャートが遊べる。
// 上達順(選曲リスト表示順) = registerChart呼び出し順:
// open_strings → doremi → tulip → bunbun → frets123 → kirakira → mary → kaeru → walking → rock_riff

registerChart({
  id: 'open_strings', title: 'かいほうげんマスター', level: 1,
  bpm: 70, countInBeats: 4,
  // E1 A1 D2 G2 の開放弦を2拍ずつ×3周
  notes: [
    { beat: 0, midi: 28, len: 2 },
    { beat: 2, midi: 33, len: 2 },
    { beat: 4, midi: 38, len: 2 },
    { beat: 6, midi: 43, len: 2 },
    { beat: 8, midi: 28, len: 2 },
    { beat: 10, midi: 33, len: 2 },
    { beat: 12, midi: 38, len: 2 },
    { beat: 14, midi: 43, len: 2 },
    { beat: 16, midi: 28, len: 2 },
    { beat: 18, midi: 33, len: 2 },
    { beat: 20, midi: 38, len: 2 },
    { beat: 22, midi: 43, len: 2 },
  ],
  range: { min: 28, max: 43 },
});

registerChart({
  id: 'doremi', title: 'ドレミのやま', level: 1,
  bpm: 80, countInBeats: 4,
  // C2メジャースケール上行 → 下行
  notes: [
    { beat: 0, midi: 36 },
    { beat: 1, midi: 38 },
    { beat: 2, midi: 40 },
    { beat: 3, midi: 41 },
    { beat: 4, midi: 43 },
    { beat: 5, midi: 45 },
    { beat: 6, midi: 47 },
    { beat: 7, midi: 48 },
    { beat: 8, midi: 47 },
    { beat: 9, midi: 45 },
    { beat: 10, midi: 43 },
    { beat: 11, midi: 41 },
    { beat: 12, midi: 40 },
    { beat: 13, midi: 38 },
    { beat: 14, midi: 36, len: 2 },
  ],
  range: { min: 36, max: 48 },
});

registerChart({
  id: 'tulip', title: 'チューリップ', level: 1,
  bpm: 85, countInBeats: 4,
  // ドレミ ドレミ ソミレドレミレ / ドレミ ドレミ ソミレドレミド（フレーズ末は2拍）
  notes: [
    { beat: 0, midi: 36 }, { beat: 1, midi: 38 }, { beat: 2, midi: 40 },
    { beat: 3, midi: 36 }, { beat: 4, midi: 38 }, { beat: 5, midi: 40 },
    { beat: 6, midi: 43 }, { beat: 7, midi: 40 }, { beat: 8, midi: 38 },
    { beat: 9, midi: 36 }, { beat: 10, midi: 38 }, { beat: 11, midi: 40 },
    { beat: 12, midi: 38, len: 2 },
    { beat: 14, midi: 36 }, { beat: 15, midi: 38 }, { beat: 16, midi: 40 },
    { beat: 17, midi: 36 }, { beat: 18, midi: 38 }, { beat: 19, midi: 40 },
    { beat: 20, midi: 43 }, { beat: 21, midi: 40 }, { beat: 22, midi: 38 },
    { beat: 23, midi: 36 }, { beat: 24, midi: 38 }, { beat: 25, midi: 40 },
    { beat: 26, midi: 36, len: 2 },
  ],
  range: { min: 36, max: 43 },
});

registerChart({
  id: 'bunbun', title: 'ぶんぶんぶん', level: 1,
  bpm: 80, countInBeats: 4,
  // ソミミ ファレレ ドレミファソソソ / ソミミ ファレレ ドミソソド（フレーズ末は2拍）
  notes: [
    { beat: 0, midi: 43 }, { beat: 1, midi: 40 }, { beat: 2, midi: 40 },
    { beat: 3, midi: 41 }, { beat: 4, midi: 38 }, { beat: 5, midi: 38 },
    { beat: 6, midi: 36 }, { beat: 7, midi: 38 }, { beat: 8, midi: 40 },
    { beat: 9, midi: 41 }, { beat: 10, midi: 43 }, { beat: 11, midi: 43 },
    { beat: 12, midi: 43, len: 2 },
    { beat: 14, midi: 43 }, { beat: 15, midi: 40 }, { beat: 16, midi: 40 },
    { beat: 17, midi: 41 }, { beat: 18, midi: 38 }, { beat: 19, midi: 38 },
    { beat: 20, midi: 36 }, { beat: 21, midi: 40 }, { beat: 22, midi: 43 },
    { beat: 23, midi: 43 },
    { beat: 24, midi: 36, len: 2 },
  ],
  range: { min: 36, max: 43 },
});

registerChart({
  id: 'frets123', title: 'ゆびのたいそう', level: 2,
  bpm: 80, countInBeats: 4,
  // 各弦でフレット0→1→2→3→2→1→0。E弦から順にA D Gへ
  notes: [
    { beat: 0, midi: 28 },
    { beat: 1, midi: 29 },
    { beat: 2, midi: 30 },
    { beat: 3, midi: 31 },
    { beat: 4, midi: 30 },
    { beat: 5, midi: 29 },
    { beat: 6, midi: 28 },
    { beat: 7, midi: 33 },
    { beat: 8, midi: 34 },
    { beat: 9, midi: 35 },
    { beat: 10, midi: 36 },
    { beat: 11, midi: 35 },
    { beat: 12, midi: 34 },
    { beat: 13, midi: 33 },
    { beat: 14, midi: 38 },
    { beat: 15, midi: 39 },
    { beat: 16, midi: 40 },
    { beat: 17, midi: 41 },
    { beat: 18, midi: 40 },
    { beat: 19, midi: 39 },
    { beat: 20, midi: 38 },
    { beat: 21, midi: 43 },
    { beat: 22, midi: 44 },
    { beat: 23, midi: 45 },
    { beat: 24, midi: 46 },
    { beat: 25, midi: 45 },
    { beat: 26, midi: 44 },
    { beat: 27, midi: 43, len: 2 },
  ],
  range: { min: 28, max: 46 },
});

registerChart({
  id: 'kirakira', title: 'きらきらぼし', level: 2,
  bpm: 90, countInBeats: 4,
  // CCGGAAG FFEEDDC GGFFEED GGFFEED CCGGAAG FFEEDDC（各フレーズ末は2拍）
  notes: [
    { beat: 0, midi: 36 }, { beat: 1, midi: 36 }, { beat: 2, midi: 43 }, { beat: 3, midi: 43 },
    { beat: 4, midi: 45 }, { beat: 5, midi: 45 }, { beat: 6, midi: 43, len: 2 },
    { beat: 8, midi: 41 }, { beat: 9, midi: 41 }, { beat: 10, midi: 40 }, { beat: 11, midi: 40 },
    { beat: 12, midi: 38 }, { beat: 13, midi: 38 }, { beat: 14, midi: 36, len: 2 },
    { beat: 16, midi: 43 }, { beat: 17, midi: 43 }, { beat: 18, midi: 41 }, { beat: 19, midi: 41 },
    { beat: 20, midi: 40 }, { beat: 21, midi: 40 }, { beat: 22, midi: 38, len: 2 },
    { beat: 24, midi: 43 }, { beat: 25, midi: 43 }, { beat: 26, midi: 41 }, { beat: 27, midi: 41 },
    { beat: 28, midi: 40 }, { beat: 29, midi: 40 }, { beat: 30, midi: 38, len: 2 },
    { beat: 32, midi: 36 }, { beat: 33, midi: 36 }, { beat: 34, midi: 43 }, { beat: 35, midi: 43 },
    { beat: 36, midi: 45 }, { beat: 37, midi: 45 }, { beat: 38, midi: 43, len: 2 },
    { beat: 40, midi: 41 }, { beat: 41, midi: 41 }, { beat: 42, midi: 40 }, { beat: 43, midi: 40 },
    { beat: 44, midi: 38 }, { beat: 45, midi: 38 }, { beat: 46, midi: 36, len: 2 },
  ],
  range: { min: 36, max: 45 },
});

registerChart({
  id: 'mary', title: 'メリーさんのひつじ', level: 2,
  bpm: 95, countInBeats: 4,
  // ミレドレミミミ レレレ ミソソ / ミレドレミミミミ レレミレド（フレーズ末は2拍）
  notes: [
    { beat: 0, midi: 40 }, { beat: 1, midi: 38 }, { beat: 2, midi: 36 }, { beat: 3, midi: 38 },
    { beat: 4, midi: 40 }, { beat: 5, midi: 40 }, { beat: 6, midi: 40 },
    { beat: 7, midi: 38 }, { beat: 8, midi: 38 }, { beat: 9, midi: 38 },
    { beat: 10, midi: 40 }, { beat: 11, midi: 43 }, { beat: 12, midi: 43, len: 2 },
    { beat: 14, midi: 40 }, { beat: 15, midi: 38 }, { beat: 16, midi: 36 }, { beat: 17, midi: 38 },
    { beat: 18, midi: 40 }, { beat: 19, midi: 40 }, { beat: 20, midi: 40 }, { beat: 21, midi: 40 },
    { beat: 22, midi: 38 }, { beat: 23, midi: 38 }, { beat: 24, midi: 40 }, { beat: 25, midi: 38 },
    { beat: 26, midi: 36, len: 2 },
  ],
  range: { min: 36, max: 43 },
});

registerChart({
  id: 'kaeru', title: 'かえるのうた', level: 2,
  bpm: 95, countInBeats: 4,
  // ドレミファミレド ミファソラソファミ ドドドド ドドレレミミファファ ミレド
  notes: [
    { beat: 0, midi: 36 }, { beat: 1, midi: 38 }, { beat: 2, midi: 40 }, { beat: 3, midi: 41 },
    { beat: 4, midi: 40 }, { beat: 5, midi: 38 }, { beat: 6, midi: 36 },
    { beat: 7, midi: 40 }, { beat: 8, midi: 41 }, { beat: 9, midi: 43 }, { beat: 10, midi: 45 },
    { beat: 11, midi: 43 }, { beat: 12, midi: 41 }, { beat: 13, midi: 40 },
    { beat: 14, midi: 36 }, { beat: 15, midi: 36 }, { beat: 16, midi: 36 }, { beat: 17, midi: 36 },
    { beat: 18, midi: 36, len: 0.5 }, { beat: 18.5, midi: 36, len: 0.5 },
    { beat: 19, midi: 38, len: 0.5 }, { beat: 19.5, midi: 38, len: 0.5 },
    { beat: 20, midi: 40, len: 0.5 }, { beat: 20.5, midi: 40, len: 0.5 },
    { beat: 21, midi: 41, len: 0.5 }, { beat: 21.5, midi: 41, len: 0.5 },
    { beat: 22, midi: 40 }, { beat: 23, midi: 38 }, { beat: 24, midi: 36, len: 2 },
  ],
  range: { min: 36, max: 45 },
});

registerChart({
  id: 'walking', title: 'はじめてのウォーキング', level: 3,
  bpm: 100, countInBeats: 4,
  // C(36,43,45,43) F(41,48,50,48) G(43,47,50,47) C(36,43,45,43)。最後にmidi36を2拍
  // fretboard表示のためfret<=7に収まる音域で書く（C2〜1オクターブ上のC3まで）
  notes: [
    { beat: 0, midi: 36 }, { beat: 1, midi: 43 }, { beat: 2, midi: 45 }, { beat: 3, midi: 43 },
    { beat: 4, midi: 41 }, { beat: 5, midi: 48 }, { beat: 6, midi: 50 }, { beat: 7, midi: 48 },
    { beat: 8, midi: 43 }, { beat: 9, midi: 47 }, { beat: 10, midi: 50 }, { beat: 11, midi: 47 },
    { beat: 12, midi: 36 }, { beat: 13, midi: 43 }, { beat: 14, midi: 45 }, { beat: 15, midi: 43 },
    { beat: 16, midi: 36, len: 2 },
  ],
  range: { min: 36, max: 50 },
});

registerChart({
  id: 'rock_riff', title: 'ロックのきほん', level: 3,
  bpm: 110, countInBeats: 4,
  // E1の8分刻み8発 → G1 → A1 変化のシンプルなロックライン（2周）
  notes: [
    { beat: 0, midi: 28, len: 0.5 }, { beat: 0.5, midi: 28, len: 0.5 },
    { beat: 1, midi: 28, len: 0.5 }, { beat: 1.5, midi: 28, len: 0.5 },
    { beat: 2, midi: 28, len: 0.5 }, { beat: 2.5, midi: 28, len: 0.5 },
    { beat: 3, midi: 28, len: 0.5 }, { beat: 3.5, midi: 28, len: 0.5 },
    { beat: 4, midi: 31 }, { beat: 5, midi: 33 },
    { beat: 6, midi: 28, len: 0.5 }, { beat: 6.5, midi: 28, len: 0.5 },
    { beat: 7, midi: 28, len: 0.5 }, { beat: 7.5, midi: 28, len: 0.5 },
    { beat: 8, midi: 28, len: 0.5 }, { beat: 8.5, midi: 28, len: 0.5 },
    { beat: 9, midi: 28, len: 0.5 }, { beat: 9.5, midi: 28, len: 0.5 },
    { beat: 10, midi: 31 }, { beat: 11, midi: 33, len: 2 },
  ],
  range: { min: 28, max: 33 },
});
