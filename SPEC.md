# rhythmkit — 落ち音符・楽器学習ゲーム基盤 SPEC v1

> 2026-07-11 human指示: 「昔のビートマニアみたいに、音符が落ちてきたら（実物の）ベースで正しい音を弾くと当たる、子供のベース学習アプリ。iPhoneで遊べて、マイクで音をちゃんと拾うこと。ピアノ・ギター等も後付けできる資産化基盤にすること」
> 方針: catchkit と同じ「engine汎用部品 + 契約オブジェクト + build.py 単一HTML組立」。**楽器1つ = INSTRUMENT_DEF 1ファイル / 曲1つ = CHART 1オブジェクト / ゲーム1本 = GAME_DEF 1ファイル**。

## ゴール構造

```
goods/rhythmkit/
├── SPEC.md（本ファイル・契約の正本）
├── README.md（部品構成・新楽器/新曲の作り方チュートリアル）
├── build.py            ← python3 build.py <game_id>（catchkit/build.py と同型・決定論・標準ライブラリのみ）
├── template.html       ← __ENGINE_JS__ / __INSTRUMENTS_JS__ / __CHARTS_JS__ / __GAME_JS__ を置換
├── engine/             ← 汎用部品（楽器固有・曲固有・キャラ固有ゼロ）
│   ├── audio_synth.js      音合成（プレビュー音/メトロノーム/SFX）・iOS unlock
│   ├── pitch_detector.js   マイク→ピッチ検出（自己相関MPM・低音対応）
│   ├── input_router.js     mic/touch/keyboard を統一入力イベントに正規化
│   ├── highway.js          落下レーン描画（canvas）
│   ├── judge.js            判定（タイミング×音程・wait mode）
│   ├── game_core.js        状態機械・ゲームループ・チャート進行
│   └── hud.js              スコア/コンボ/チューナー/マイクレベル表示
├── instruments/        ← INSTRUMENT_DEF（1楽器1ファイル・拡張の主戦場①）
│   ├── bass.js  guitar.js  piano.js
├── charts/             ← CHART 群（拡張の主戦場②）
│   └── charts_basic.js     同梱曲すべて（開放弦/ドレミ/きらきら星/かえるのうた 等）
├── games/<id>/game.js  ← GAME_DEF（テーマ・キャラ・収録曲の選定）
└── dist/<id>/index.html ← 生成物（単一ファイル・外部参照ゼロ・iPhone Safari動作）
```

## build.py 結合順序（固定）

```
engine: audio_synth.js → pitch_detector.js → input_router.js → highway.js → judge.js → hud.js → game_core.js
その後: instruments/*.js（アルファベット順） → charts/*.js（アルファベット順） → games/<id>/game.js
```

全ファイル function宣言 + const オブジェクトのみ（ES modules 不使用・グローバル結合）。
`"use strict"` はtemplate側の1箇所のみ。

## 共有契約（3ワーカー間のAPI境界。ここに書いた通りに実装する。勝手に変えない）

### レジストリ（グローバル）

```js
// instruments/*.js は末尾でこれを呼ぶ:
registerInstrument(INSTRUMENT_DEF_OBJ);      // game_core.js が提供
// charts/*.js は末尾でこれを呼ぶ:
registerChart(CHART_OBJ);                    // game_core.js が提供
// games/<id>/game.js は const GAME_DEF = {...} を宣言するだけ（catchkit と同じ）
```

registerInstrument / registerChart は game_core.js が **ファイル先頭で** 定義する
（結合順で instruments が後に来るため、function宣言の巻き上げで解決するが、
 内部の格納Mapは `var __RK_INSTRUMENTS = {}` 等のトップレベル var で先頭に置く）。

### INSTRUMENT_DEF（instruments/<id>.js）

```js
const INSTRUMENT_BASS = {
  id: 'bass', label: 'ベース', emoji: '🎸',
  judgeModes: ['pitch', 'lane'],       // 対応入力。pitch=マイク実演奏 / lane=画面タップ
  defaultJudgeMode: 'pitch',
  // 表示レーン（上から順に描画）。ベース=TAB譜と同じ G D A E（Gが上）
  lanes: [
    { id:'G', label:'G(ソ)', openMidi:43, color:'#f6c945' },
    { id:'D', label:'D(レ)', openMidi:38, color:'#6fd66f' },
    { id:'A', label:'A(ラ)', openMidi:33, color:'#5db4f0' },
    { id:'E', label:'E(ミ)', openMidi:28, color:'#ef8bb0' },
  ],
  midiRange: { min:28, max:55 },       // E1〜G3
  mic: { fmin:35, fmax:420, clarityMin:0.83, levelMin:0.01 },
  // midi → 表示位置。弦楽器: ローフレット優先で {laneIndex, fret} を返す
  // 鍵盤: {laneIndex, fret:null} を返す（レーン=鍵）
  noteToLane(midi) { /* ... */ },
  // 判定音程の許容: 'exact'=同一midi / 'pitchClass'=オクターブ違い許容（bass倍音対策で既定on）
  pitchTolerance: 'pitchClass',
  synthPatch: 'bass',                  // audio_synth のプレビュー音色キー
};
registerInstrument(INSTRUMENT_BASS);
```

- guitar.js: 6レーン（e B G D A E）、openMidi = 64,59,55,50,45,40、pitchTolerance:'pitchClass'
- piano.js: judgeModes:['lane','pitch'], defaultJudgeMode:'lane'（タップ鍵盤）。
  lanes = C4〜C5 の白鍵8本（openMidi=そのままその鍵のmidi 60,62,64,65,67,69,71,72）。
  noteToLane は白鍵に丸める（同梱チャートは白鍵のみ使用）。synthPatch:'piano'

### CHART（charts/*.js 内で複数登録可）

```js
registerChart({
  id: 'kirakira', title: 'きらきらぼし', level: 2,       // level 1-5（表示用の星）
  bpm: 90, countInBeats: 4,
  // beat = 曲頭からの拍。midi は実音高（楽器がレーンへ写像する）
  // len は拍単位の長さ（表示用・省略時1）
  notes: [ { beat:0, midi:36 }, { beat:1, midi:36 }, { beat:2, midi:43 }, ... ],
  range: { min:36, max:45 },   // 使用音域。楽器の midiRange 外の曲は選曲画面でグレーアウト
});
```

同梱チャート（charts_basic.js・全部この順・childが飽きない並び）:
1. `open_strings` かいほうげんマスター Lv1（E A D G をゆっくり順に・bpm70）
2. `doremi` ドレミのやま Lv1（C2メジャースケール上下・bpm80）
3. `frets123` ゆびのたいそう Lv2（各弦フレット0-3・bpm80）
4. `kirakira` きらきらぼし Lv2（C2始まりの単音ベースライン・bpm90）
5. `kaeru` かえるのうた Lv2（C2〜・bpm95）
6. `walking` はじめてのウォーキング Lv3（C2 ルート5度ウォーキング・bpm100）
7. `rock_riff` ロックのきほん Lv3（E1中心の8分ルート弾き・bpm110）

音域はすべて bass の midiRange（28-55）に収まるよう1〜2オクターブ低めに書く。
piano では noteToLane 丸めで白鍵レンジに写像されるので同じチャートがそのまま遊べる。

### GAME_DEF（games/umebass/game.js）

```js
const GAME_DEF = {
  meta: { id:'umebass', title:'うめベース！', subtitle:'おとをひいて キャッチしよう' },
  instruments: ['bass','guitar','piano'],   // 選択画面に出す順。先頭=既定
  charts: 'all',                            // 'all' or ids配列
  noteNaming: 'doremi',                     // 'doremi'|'abc' 設定でトグル可
  theme: {
    bg:['#1a1038','#2a1a58'], laneLine:'#ffffff22', judgeLine:'#ffd34d',
    text:'#fff7e8', accent:'#ff8fb3',
    mascot: { enable:true, cheer:['いいね！','その調子！','すごい！','天才や！'] }
  },
};
```

### 統一入力イベント（input_router → game_core）

```js
// pitch（マイク）: 継続的に流れる。clarity=検出信頼度0-1
{ kind:'pitch', freq, midi, cents, clarity, level, t }   // t = performance.now()/1000
// lane（タップ/キーボード）: 押した瞬間のみ
{ kind:'lane', laneIndex, t }
InputRouter.create(opts) → { onEvent(cb), startMic():Promise<bool>, stopMic(), attachTouch(el, lanes), attachKeyboard(lanes), micActive }
```

キーボード割当: レーン数ぶん `1..9` と `a s d f g h j k`（上レーンから）。開発検証用。

### 判定（judge.js）

- 判定窓（秒）: PERFECT ±0.18 / GOOD ±0.35（子供向けに広め）。全モード共通で offsetSec（設定画面のスライダー -0.3〜+0.3・既定 -0.12 = iOSマイク遅延ぶん）を加味
- pitch判定: ノート窓内に「対象midi一致（pitchTolerance準拠）かつ clarity≥clarityMin の pitchイベントが 連続60ms以上」で HIT。最初に閾値を満たした時刻で PERFECT/GOOD を決める
- lane判定: 窓内の laneIndex 一致タップで HIT
- **れんしゅうモード（wait）**: ノートは判定線で停止し、正しい音が出るまで待つ。MISSなし。何秒かかってもOK。正解で ○ 演出+次へ。← 学習の主役モード
- **リズムモード**: 通常の落下判定。MISS = 窓を過ぎたら。スコア: PERFECT100/GOOD50×combo倍率（1+min(combo,20)*0.05）。ライフ無し（子供向け・最後まで完走してリザルト）
- **チューナーモード**: チャート無し。検出音を大きく表示（音名+セントメーター）。ベースのチューニング用

### 状態機械（game_core.js）

```
boot → title(楽器選択/モード選択/曲選択/設定)
     → micSetup(pitch modeのみ: 権限取得→レベルメーター→「おとが みえたら OK！」)
     → play(count-in → チャート進行 → 終了)
     → result(ランク S/A/B/C・PERFECT/GOOD/MISS数・もういちど/曲をえらぶ)
tuner は title から直行・戻る
```

- ループ: requestAnimationFrame。時間軸は AudioContext.currentTime 基準（rAFのt駄目）
- 曲終了 = 最終ノート+2秒
- リザルトランク: PERFECT率 90%+=S / 70%+=A / 50%+=B / それ以外=C（れんしゅうは常に「クリア！」のみ）

### highway.js（描画）

- canvas 2D・縦スクロール。レーン数は instrument.lanes.length で可変（4/6/8対応を実証）
- ノート表示: レーン色の丸角バッジ。**中身にフレット数字（弦楽器）or 音名（鍵盤）**、下に音名（noteNaming設定でドレミ/ABC）
- 先読み表示 4秒ぶん。判定線は下から18%。判定線の下にタッチ入力ボタン列（lane mode時のみ表示）
- HIT演出: パーティクル的リング+「パーフェクト!/グッド!」ポップ（DOM でなく canvas 内）
- devicePixelRatio 対応・縦持ちiPhone最優先（375×667〜のビューポートで崩れない）

### pitch_detector.js（心臓部・iPhone実機で音を拾う）

- `getUserMedia({audio:{echoCancellation:false, noiseSuppression:false, autoGainControl:false}})`
  ← **楽器判定に3つのOFF必須**（iOSのAECは楽器音を潰す）
- AnalyserNode fftSize=4096, `getFloatTimeDomainData` を rAF ポーリング
- アルゴリズム: MPM系自己相関（NSDF）。E1=41.2Hz を拾うため探索下限 fmin=35Hz（周期約1260サンプル@44.1k・バッファ4096で3周期確保）
- clarity = NSDFピーク値。levelはRMS。levelMin未満は無音として捨てる（ノイズゲート）
- 出力は onPitch コールバック（input_router が包む）
- 権限拒否/未対応時は false を返し、UIは「マイクがつかえないので タップであそぼう」でlane modeへフォールバック

### audio_synth.js

- 全音は合成（アセットゼロ）: bass=三角波+ローパス+短decay / piano=正弦×2倍音+decay / guitar=のこぎり+ローパス
- SFX: perfect(明るいピコン)/good(ポン)/miss(小さくボフ)/fanfare(リザルト)/metro(カウントイン)
- **iOS unlock**: AudioContext は最初のタップで生成/resume。`unlock()` を title の「はじめる」タップに配線
- プレビュー機能: 選曲画面で曲の最初の4音を聴ける / れんしゅうモードで正解音が鳴る

## v1.1 追加契約（2026-07-11 human指示: 「どこを押さえるか表示・視覚品質アップ・練習寄り・OSSレベル」）

### INSTRUMENT_DEF.display（追加フィールド・必須）

```js
display: { type: 'fretboard', fretCount: 7 }   // bass/guitar: 押さえ位置図（0=開放〜fret7）
display: { type: 'keyboard' }                  // piano: 鍵盤図（lanes=鍵）
```

### engine/fingerboard.js（新部品・押さえ位置ガイド描画）

```js
new FingerBoard(instrument, naming)
  .draw(ctx, x, y, w, h, current, next, theme)
  // current/next: {laneIndex, fret, midi} | null（呼び出し側がnoteToLaneで解決して渡す）
```

- fretboard型: 横向きネック。弦はhighwayレーンと**同順・同色**（視覚リンク）。ナット太線+フレット線+フレット番号。
  current=大きい脈動ドット（中にフレット番号・fret0は「0 かいほうげん」でナット左にリング表示）/ next=輪郭だけのゴーストドット
- keyboard型: lanesを白鍵として横並び描画。current=塗り+音名 / next=輪郭
- 配置: **pitchモード時は判定線下の帯（judgeY〜h）に描く**（laneモード時は従来どおりタッチボタンが占有・fretboardは出さない。pianoはlaneモード=鍵盤ボタン自体がガイドを兼ねる）
- currentの解決: judge.runners[judge.cursor]（wait/リズム共通で「次に弾くべきノート」）、nextはその次のpending

### チャートのフレット上限（新制約）

同梱チャートは**最低フレット写像が fret ≤ 7** に収まる音のみ使う（fretboard表示可能域）。
tests/test_content.js の検証も fret ≤ 7 に強化する。walking はこの制約で書き直し（下記）。

### 練習寄りの演出（ゲームオーバー制度なしを明文化）

- ライフ制・途中終了は**基盤として持たない**（rules自体が無い。曲は必ず最後まで流れてリザルト）
- MISS の表示文言は「おしい！」（stats名はmissのまま・見た目だけ優しく）
- リザルトは常にポジティブ文言（リズムモード: ランク+「さいごまで ひけたね！」/ れんしゅう: 「クリア！」）
- ベストスコア: localStorage（key=`rk_best_<gameId>_<chartId>_<instrumentId>_<mode>`）に保存し、選曲リストに🏆ベスト表示。localStorage不可環境ではtry/catchで無視

### 視覚品質（v1.1で highway/title に入れるもの）

- 背景: theme.bg の縦グラデをcanvasに描く（今は単色CSS任せ）
- 判定線グロー・レーン薄色フィル・ノートが判定線に近づくと光る
- コンボ5刻みで画面パルス+マスコット応援（既存cheer）
- リザルトに紙吹雪風パーティクル（時間ベース決定論・乱数不使用）
- iPhoneホーム画面追加用メタタグ（apple-mobile-web-app-capable / theme-color）

## iPhone Safari 制約（実装の前提・違反したら動かない）

1. AudioContext 生成/resume・getUserMedia はユーザータップのハンドラ内で行う
2. getUserMedia は HTTPS 必須（pages.dev/Artifact は満たす。file:// は不可）
3. `<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no, viewport-fit=cover">` + タッチの `touch-action:none`（誤ズーム防止）
4. 単一HTML・外部参照ゼロ（CSP環境でも動く）
5. 画面スリープ対策はやらない（wake lockはiOS Safari非対応期あり・スコープ外）

## 検証（CCがやること）

1. `python3 build.py umebass` ×2 → バイト同一（決定論）
2. 全 engine/instruments/charts/games ファイル + 組立後の script 抽出 → `node --check` PASS
3. node vm スモーク（DOM/canvas/AudioContextスタブ）: title→選曲→play遷移 / 合成pitchイベント→judge HIT / wait mode 停止と解除 / lane tap HIT / 全7チャートのnotes整合（midiが楽器レンジ内・beat昇順）
4. エンジン純度: `grep -rn "うめ\|梅\|umeko\|bass\|piano\|guitar" engine/` で楽器名・固有名ヒット0件（変数名の一般語 'base' 等は除く。楽器知識は instruments/ のみ）
   - **許容例外（2026-07-11裁定）**: `audio_synth.js` の SYNTH_PATCHES 音色テーブルのキー 'bass'/'piano'/'guitar' のみ許容。これは楽器ロジックではなく汎用音色名（INSTRUMENT_DEF.synthPatch が文字列で選ぶ契約の受け側）。エンジンが楽器の構造（弦・フレット・レーン）を知ることは引き続き禁止
5. 3楽器それぞれで noteToLane 全チャート全ノート写像がエラーゼロ
6. 外部URL参照ゼロ（`grep -n "https\?://" dist/`）

## 資産化（closeoutでやること）

- PARTS_CATALOG.md に rhythmkit / うめベース！ を登録
- README.md: 「新しい楽器を10分で足す」「新しい曲を5分で足す」チュートリアル必須
- goods repo に commit（push/deployは human 裁定）
