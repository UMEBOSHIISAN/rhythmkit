const GAME_DEF = {
  meta: { id: 'umebass', title: 'うめベース！', subtitle: 'おとをひいて キャッチしよう' },
  instruments: ['bass', 'guitar', 'piano'],
  charts: 'all',
  noteNaming: 'doremi',
  theme: {
    bg: ['#1a1038', '#2a1a58'], laneLine: '#ffffff22', judgeLine: '#ffd34d',
    text: '#fff7e8', accent: '#ff8fb3',
    mascot: {
      enable: true,
      cheer: [
        'いいね！', 'そのちょうし！', 'すごい！', 'てんさいや！',
        'ええやん！', 'ばっちこい！', 'のってきたで！',
      ],
      name: 'うめこ',
      // 16x16の梅干しキャラ・ドット絵（pixel_art.jsのrkDrawPixelmapが読む形式）。
      // '.'=透過。 a=本体(うめ色) c=ほっぺ d=ヘタ(葉) e=め f=にっこりくち
      pixelmap: {
        palette: { a: '#e75480', c: '#ffb6c9', d: '#5cb85c', e: '#2a1a3a', f: '#c23b56' },
        grid: [
          '.......dd.......',
          '......dddd......',
          '.....aaaaaa.....',
          '...aaaaaaaaaa...',
          '..aaaaaaaaaaaa..',
          '.aaaaaaaaaaaaaa.',
          '.aaaaaaaaaaaaaa.',
          '.aaaaeaaaaeaaaa.',
          '.aaccaaaaaaccaa.',
          '.aaaaaffffaaaaa.',
          '.aaaaaaaaaaaaaa.',
          '.aaaaaaaaaaaaaa.',
          '..aaaaaaaaaaaa..',
          '...aaaaaaaaaa...',
          '.....aaaaaa.....',
          '.......aa.......',
        ],
      },
    },
  },
  // タイトル/リザルト画面専用の短いBGMループ（bgmStart()/bgmStop()が読む）。
  // Cメジャーペンタトニック中心・8拍・8bit風の口ずさめる短いフレーズ。
  // play/micSetup/calib画面では鳴らさない（audio_synth.js bgmStartのコメント参照）。
  titleBgm: {
    bpm: 96,
    patch: 'piano',
    loop: [
      { beat: 0, midi: 72, dur: 0.42 },
      { beat: 1, midi: 67, dur: 0.42 },
      { beat: 2, midi: 69, dur: 0.42 },
      { beat: 3, midi: 67, dur: 0.42 },
      { beat: 4, midi: 64, dur: 0.42 },
      { beat: 5, midi: 62, dur: 0.42 },
      { beat: 6, midi: 64, dur: 0.42 },
      { beat: 7, midi: 60, dur: 1.4 },
    ],
  },
};
