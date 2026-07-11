/*
 * game_core.js — レジストリ + 状態機械（rhythmkit の心臓部）
 *
 * 何をする部品か: instruments/*.js・charts/*.js が自己登録するレジストリ
 *   （registerInstrument/registerChart）と、GAME_DEF を受け取ってタイトル/設定/
 *   マイク準備/プレイ/リザルト/チューナーの画面遷移を管理する RhythmGame を提供する。
 *   audio_synth.js（音合成・iOS unlock）・pitch_detector.js（マイク検出。直接は
 *   使わず input_router.js 経由）・input_router.js（統一入力）・highway.js（描画）・
 *   judge.js（判定）・hud.js（HUD描画）を結線してゲームループを回す。
 *   楽器名・曲名・キャラ固有名は一切書かない（GAME_DEF/INSTRUMENT_DEF/CHART から
 *   受け取ったデータを表示するだけ）。
 * 外部依存: DOM（template.html が用意する #rk-* 要素群）, Canvas 2D,
 *   InputRouter.create(opts)（input_router.js。opts={fmin,fmax,levelMin}=instrument.mic）,
 *   unlock()/getCtx()/playSfx()/metronome（audio_synth.js のグローバル関数・
 *   存在すれば使う＝未実装でもクラッシュしない防御コーディング）,
 *   Highway/FingerBoard/JudgeEngine（highway.js/fingerboard.js/judge.js・
 *   結合順序で本ファイルより前。FingerBoardはpitchモード中のみ、highway.panelRegion
 *   （縦長=判定線下30%帯／横長=右45%全高。向きはHighwayが自分のw/hから判定）に
 *   押さえ位置ガイドを描く。instrument.display未定義/未知typeなら自然に何も描かない）,
 *   drawRkScoreHud等（hud.js・結合順序で本ファイルより前）。
 *   lane modeのタッチボタンは input_router.js の attachTouch(el, lanes) が
 *   #rk-lane-buttons 内に実DOMボタンを生成する。本ファイルは highway.js の
 *   レイアウト計算値(laneButtons)を使ってそのDOM位置をCSSで重ねるだけ。
 *
 * レジストリはファイル先頭で定義する（結合順で instruments/*.js・charts/*.js が
 * 本ファイルより後に来るため、それらの末尾の registerInstrument()/registerChart() 呼び出し
 * が実行される時点で __RK_INSTRUMENTS/__RK_CHARTS が既に存在している必要がある）。
 */
var __RK_INSTRUMENTS = {};
var __RK_CHARTS = {};
function registerInstrument(def){ __RK_INSTRUMENTS[def.id] = def; }
function registerChart(def){ __RK_CHARTS[def.id] = def; }

// 汎用の数値ヘルパー（highway.js/hud.js からも使う。巻き上げにより結合順に関わらず参照可能）
function clamp(v, lo, hi){ return v < lo ? lo : (v > hi ? hi : v); }
function lerp(a, b, t){ return a + (b - a) * t; }

// 純関数（v1.2 オートキャリブレーション用・vm単体テスト対象。tests/test_calib.js参照）
function rkMedian(arr){
  if (!arr || !arr.length) return null;
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
// deltas: 各tickとオンセットの差分秒(delta = onset - tick)の配列。4サンプル未満はnull（リトライ対象）。
// offsetSec = -median(deltas) を[-0.3,0.3]にclampする（SPEC v1.2）。
function rkCalibOffset(deltas){
  if (!deltas || deltas.length < 4) return null;
  const med = rkMedian(deltas);
  return clamp(-med, -0.3, 0.3);
}

const RK_SCREEN_IDS = ['rk-title', 'rk-settings', 'rk-micsetup', 'rk-calib', 'rk-tuner', 'rk-result'];
const RK_DEFAULT_OFFSET_SEC = -0.12;

class RhythmGame {
  constructor(gameDef){
    this.gameDef = gameDef;
    this.mode = 'boot';
    this.selectedInstrumentId = null;
    this.selectedModeKey = 'wait'; // 'wait'(れんしゅう) | 'rhythm'
    this.selectedChartId = null;
    this.naming = gameDef.noteNaming || 'doremi';
    this.offsetSec = RK_DEFAULT_OFFSET_SEC;
    this.instrument = null;
    this.judgeMode = null; // 'pitch' | 'lane'
    this.isWaitMode = false;
    this.judge = null;
    this.highway = null;
    this.fingerboard = null;
    this._micLevel = 0;
    this._tunerDetected = null;
    this.inputRouter = null; // instrument確定後に _setupInputRouter() で生成する（micパラメータが楽器依存のため）
    this._laneButtonEls = null;
    // v1.2: play中HUDの「いま鳴っている音」表示（2フレーム連続同一丸めmidiで確定・0.5秒無イベントで消える）
    this._detectedNote = null;
    this._detectedCandidateMidi = null;
    this._detectedCandidateCount = 0;
    this._lastPitchEventAt = null; // ev.t（performance.now()/1000）。0.5秒アイドル判定に使う
    // v1.2: micSetup画面の検出音名表示（チューナーと同じclarity条件）
    this._micSetupDetected = null;
    // v1.2: オートキャリブレーション実行中の状態
    this._calibActive = false;
    this._calibDeltas = [];
    this._calibTicks = [];
    this._calibUsedTicks = []; // tickごとに1オンセットまでの使用済み管理（indexはthis._calibTicksと対応）
    this._calibLastPitchAt = null;
    // v1.2: プレイrAFループの世代トークン。_startPlay()を跨いだ古いループが自然停止するようにする
    // （連打二重タップ等で_startPlay()が複数回呼ばれてもrAFループが複製されない）。
    this._tickGen = 0;
  }

  // instrument.mic を渡してInputRouterを（再）生成する。楽器を変えるたびに呼び直す前提。
  _setupInputRouter(instrument){
    if (this.inputRouter && this.inputRouter.stopMic) this.inputRouter.stopMic();
    const mic = (instrument && instrument.mic) || {};
    this.inputRouter = (typeof InputRouter !== 'undefined' && InputRouter && InputRouter.create)
      ? InputRouter.create({ fmin: mic.fmin, fmax: mic.fmax, levelMin: mic.levelMin })
      : null;
    if (this.inputRouter && this.inputRouter.onEvent){
      this.inputRouter.onEvent((ev) => this._handleInputEvent(ev));
    }
  }

  // --- 起動 ---
  boot(){
    this._bindStaticEvents();
    this._restoreOptions();
    this.selectedInstrumentId = this.gameDef.instruments[0] || null;
    const charts = this._selectableCharts();
    this.selectedChartId = charts.length ? charts[0].id : null;
    this._toTitle();
  }

  // --- 設定の永続化（v1.2・localStorage key=rk_opt_<gameId>） ---
  _optionsKey(){
    return 'rk_opt_' + this.gameDef.meta.id;
  }
  _saveOptions(){
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(this._optionsKey(), JSON.stringify({
        offsetSec: this.offsetSec, noteNaming: this.naming,
      }));
    } catch (e) {
      // localStorage不可環境（file://・プライベートモード等）は無視
    }
  }
  // _bindStaticEvents() でスライダー既定値を読んだ直後に呼ぶ。保存値があれば上書きする。
  _restoreOptions(){
    let saved = null;
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(this._optionsKey());
        if (raw) saved = JSON.parse(raw);
      }
    } catch (e) {
      saved = null;
    }
    if (!saved) return;
    if (typeof saved.offsetSec === 'number'){
      this.offsetSec = clamp(saved.offsetSec, -0.3, 0.3);
      const slider = document.getElementById('rk-offset-slider');
      if (slider) slider.value = String(this.offsetSec);
    }
    if (saved.noteNaming === 'doremi' || saved.noteNaming === 'abc'){
      this.naming = saved.noteNaming;
    }
  }

  _now(){
    const ctx = (typeof getCtx === 'function') ? getCtx() : null;
    if (ctx && ctx.currentTime != null) return ctx.currentTime;
    return performance.now() / 1000;
  }

  _selectableCharts(){
    const def = this.gameDef;
    if (def.charts === 'all') return Object.keys(__RK_CHARTS).map(id => __RK_CHARTS[id]);
    return (def.charts || []).map(id => __RK_CHARTS[id]).filter(Boolean);
  }

  _showScreen(id){
    for (const s of RK_SCREEN_IDS){
      const el = document.getElementById(s);
      if (el) el.classList.toggle('rk-hidden', s !== id);
    }
  }

  // --- 静的DOMイベント（一度だけバインド） ---
  _bindStaticEvents(){
    const on = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    on('rk-btn-settings', () => this._toSettings());
    on('rk-btn-settings-back', () => this._toTitle());
    on('rk-btn-start', () => this._onStartTapped());
    on('rk-btn-tuner', () => this._toTuner());
    on('rk-btn-tuner-back', () => this._onTunerBack());
    on('rk-btn-mic-ok', () => this._onMicOk());
    on('rk-btn-mic-skip', () => this._onMicSkip());
    on('rk-btn-retry', () => this._startPlay());
    on('rk-btn-song-select', () => this._toTitle());
    on('rk-btn-calib-start', () => this._toCalib());
    on('rk-btn-calib-back', () => this._onCalibBack());
    on('rk-btn-calib-retry', () => this._startCalibRun());

    const slider = document.getElementById('rk-offset-slider');
    if (slider){
      this.offsetSec = parseFloat(slider.value) || RK_DEFAULT_OFFSET_SEC;
      slider.addEventListener('input', (e) => {
        this.offsetSec = parseFloat(e.target.value);
        this._saveOptions();
      });
    }

    const onViewportChange = () => {
      if (this.highway) this.highway.fit();
      this._positionLaneButtons();
    };
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('orientationchange', onViewportChange);
  }

  // --- title ---
  _toTitle(){
    this.mode = 'title';
    if (this.inputRouter && this.inputRouter.stopMic) this.inputRouter.stopMic();
    this._renderTitleScreen();
    this._showScreen('rk-title');
  }

  _renderTitleScreen(){
    const def = this.gameDef;
    const titleEl = document.getElementById('rk-game-title');
    if (titleEl) titleEl.textContent = def.meta.title;
    const subEl = document.getElementById('rk-game-subtitle');
    if (subEl) subEl.textContent = def.meta.subtitle || '';

    const instRow = document.getElementById('rk-instrument-row');
    if (instRow){
      instRow.innerHTML = '';
      def.instruments.forEach((id) => {
        const inst = __RK_INSTRUMENTS[id];
        if (!inst) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rk-chip' + (id === this.selectedInstrumentId ? ' rk-active' : '');
        btn.textContent = (inst.emoji ? inst.emoji + ' ' : '') + inst.label;
        btn.addEventListener('click', () => {
          this.selectedInstrumentId = id;
          this._renderTitleScreen();
        });
        instRow.appendChild(btn);
      });
    }

    const modeRow = document.getElementById('rk-mode-row');
    if (modeRow){
      modeRow.innerHTML = '';
      [['wait', 'れんしゅう'], ['rhythm', 'リズム']].forEach(([key, label]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rk-chip' + (key === this.selectedModeKey ? ' rk-active' : '');
        btn.textContent = label;
        btn.addEventListener('click', () => {
          this.selectedModeKey = key;
          this._renderTitleScreen();
        });
        modeRow.appendChild(btn);
      });
    }

    const songList = document.getElementById('rk-song-list');
    if (songList){
      songList.innerHTML = '';
      const instrument = __RK_INSTRUMENTS[this.selectedInstrumentId];
      this._selectableCharts().forEach((chart) => {
        const inRange = !instrument || !chart.range
          || (chart.range.min >= instrument.midiRange.min && chart.range.max <= instrument.midiRange.max);
        const row = document.createElement('div');
        row.className = 'rk-song'
          + (chart.id === this.selectedChartId ? ' rk-active' : '')
          + (inRange ? '' : ' rk-disabled');
        const title = document.createElement('span');
        title.textContent = chart.title;
        const right = document.createElement('span');
        right.className = 'rk-song-right';
        const stars = document.createElement('span');
        stars.className = 'rk-song-stars';
        stars.textContent = '★'.repeat(chart.level || 1);
        right.appendChild(stars);
        const best = this._getBestScore(chart.id, this.selectedInstrumentId, this.selectedModeKey);
        if (best != null){
          const bestEl = document.createElement('span');
          bestEl.className = 'rk-song-best';
          bestEl.textContent = '🏆' + best;
          right.appendChild(bestEl);
        }
        row.appendChild(title);
        row.appendChild(right);
        if (inRange){
          row.addEventListener('click', () => {
            if (this.selectedChartId === chart.id){
              // 選択中の曲をもう一度タップ＝プレビュー再生（SPEC「選曲画面で曲の最初の4音を聴ける」）
              this._previewChart(chart);
            } else {
              this.selectedChartId = chart.id;
              this._renderTitleScreen();
            }
          });
        }
        songList.appendChild(row);
      });
    }

    this._renderNamingChips('rk-naming-row');
  }

  _renderNamingChips(rowId){
    const row = document.getElementById(rowId);
    if (!row) return;
    row.innerHTML = '';
    [['doremi', 'ドレミ'], ['abc', 'ABC']].forEach(([key, label]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rk-chip' + (key === this.naming ? ' rk-active' : '');
      btn.textContent = label;
      btn.addEventListener('click', () => {
        this.naming = key;
        this._renderNamingChips(rowId);
        if (this.highway) this.highway.setNaming(this.naming);
        this._saveOptions();
      });
      row.appendChild(btn);
    });
  }

  // 選曲画面プレビュー: 選択中楽器のsynthPatchでchart.notesの先頭4音をsecPerBeat間隔で鳴らす。
  // 連打で多重再生しないよう再生中フラグで抑止する。
  _previewChart(chart){
    if (this._previewing) return;
    const instrument = __RK_INSTRUMENTS[this.selectedInstrumentId];
    if (!instrument || typeof playNote !== 'function') return;
    if (typeof unlock === 'function') unlock();
    const notes = chart.notes.slice(0, 4);
    if (!notes.length) return;
    this._previewing = true;
    const secPerBeat = 60 / chart.bpm;
    notes.forEach((note, i) => {
      setTimeout(() => {
        playNote(note.midi, { patch: instrument.synthPatch });
        if (i === notes.length - 1) this._previewing = false;
      }, i * secPerBeat * 1000);
    });
  }

  // ベストスコア（localStorage・リズムモードのみ。key=rk_best_<gameId>_<chartId>_<instrumentId>_<mode>）。
  // localStorage不可環境（file://・プライベートモード等）ではtry/catchで安全に無視する。
  _bestScoreKey(chartId, instrumentId, modeKey){
    return 'rk_best_' + this.gameDef.meta.id + '_' + chartId + '_' + instrumentId + '_' + modeKey;
  }
  _getBestScore(chartId, instrumentId, modeKey){
    try {
      if (typeof localStorage === 'undefined' || !chartId || !instrumentId) return null;
      const v = localStorage.getItem(this._bestScoreKey(chartId, instrumentId, modeKey));
      if (v == null || v.trim() === '') return null;
      // 壊れた/改ざんされたlocalStorage値（NaN・負値・小数）で🏆NaN表示や以後の更新不能を防ぐ
      const n = Number(v);
      return (Number.isFinite(n) && Number.isInteger(n) && n >= 0) ? n : null;
    } catch (e) {
      return null;
    }
  }
  _maybeSaveBestScore(){
    if (this.isWaitMode) return; // SPEC: ベストスコアはリズムモードのみ
    try {
      if (typeof localStorage === 'undefined') return;
      const prev = this._getBestScore(this.selectedChartId, this.selectedInstrumentId, this.selectedModeKey);
      if (prev == null || this.judge.score > prev){
        const key = this._bestScoreKey(this.selectedChartId, this.selectedInstrumentId, this.selectedModeKey);
        localStorage.setItem(key, String(this.judge.score));
      }
    } catch (e) {
      // localStorage不可環境は無視
    }
  }

  _onStartTapped(){
    if (typeof unlock === 'function') unlock();
    const instrument = __RK_INSTRUMENTS[this.selectedInstrumentId];
    if (!instrument || !this.selectedChartId || !__RK_CHARTS[this.selectedChartId]) return;
    this.instrument = instrument;
    this.selectedChart = __RK_CHARTS[this.selectedChartId];
    this.isWaitMode = this.selectedModeKey === 'wait';
    this._setupInputRouter(instrument);

    const wantsPitch = instrument.defaultJudgeMode === 'pitch';
    if (wantsPitch){
      this.judgeMode = 'pitch';
      this._toMicSetup();
    } else {
      this.judgeMode = instrument.defaultJudgeMode || 'lane';
      this._startPlay();
    }
  }

  // --- settings ---
  _toSettings(){
    this.mode = 'settings';
    this._renderNamingChips('rk-naming-row');
    this._showScreen('rk-settings');
  }

  // --- micSetup ---
  async _toMicSetup(){
    this.mode = 'micSetup';
    this._micLevel = 0;
    this._micSetupDetected = null;
    const msgEl = document.getElementById('rk-mic-message');
    if (msgEl) msgEl.textContent = 'がっきを マイクに ちかづけて おとを だしてね';
    this._showScreen('rk-micsetup');
    this._startMicMeterLoop();
    const ok = (this.inputRouter && this.inputRouter.startMic) ? await this.inputRouter.startMic() : false;
    if (this.mode !== 'micSetup') return; // 待っている間に画面遷移していたら何もしない
    if (!ok){
      if (msgEl) msgEl.textContent = 'マイクが つかえないので タップで あそぼう';
      this.judgeMode = 'lane';
    }
  }

  _startMicMeterLoop(){
    const canvas = document.getElementById('rk-mic-meter-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const detectedEl = document.getElementById('rk-mic-detected');
    const step = () => {
      if (this.mode !== 'micSetup') return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const levelMin = (this.instrument && this.instrument.mic && this.instrument.mic.levelMin) || 0;
      drawRkMicMeter(ctx, 4, 2, canvas.width - 8, canvas.height - 4, this._micLevel, levelMin);
      if (detectedEl){
        detectedEl.textContent = this._micSetupDetected
          ? rkNoteName(this._micSetupDetected.midi, this.naming) + ' が きこえたよ！'
          : '';
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  _onMicOk(){
    this._startPlay();
  }

  _onMicSkip(){
    if (this.inputRouter && this.inputRouter.stopMic) this.inputRouter.stopMic();
    this.judgeMode = 'lane';
    this._startPlay();
  }

  // --- じどうタイミングあわせ（calib・v1.2） ---
  // 選択中楽器のmicでstartMic→90bpmで4拍カウントイン+8拍→各tickとオンセットの差から
  // offsetSecを推定する。設定画面から直行・「もどる」で設定に戻る。
  _toCalib(){
    this.mode = 'calib';
    this._showScreen('rk-calib');
    this._startCalibRun();
  }

  _onCalibBack(){
    this._calibActive = false;
    if (typeof metronome !== 'undefined' && metronome.stop) metronome.stop();
    if (this.inputRouter && this.inputRouter.stopMic) this.inputRouter.stopMic();
    this._toSettings();
  }

  async _startCalibRun(){
    if (typeof unlock === 'function') unlock();
    const msgEl = document.getElementById('rk-calib-message');
    const resultEl = document.getElementById('rk-calib-result');
    const retryBtn = document.getElementById('rk-btn-calib-retry');
    if (retryBtn) retryBtn.classList.add('rk-hidden');
    if (resultEl) resultEl.textContent = '';
    if (msgEl) msgEl.textContent = 'マイクを じゅんびしてるよ…';

    const instrument = __RK_INSTRUMENTS[this.selectedInstrumentId];
    this._setupInputRouter(instrument);
    const ok = (this.inputRouter && this.inputRouter.startMic) ? await this.inputRouter.startMic() : false;
    if (this.mode !== 'calib') return; // 待っている間に画面遷移していたら何もしない
    if (!ok){
      if (msgEl) msgEl.textContent = 'マイクが つかえないので タイミングあわせは できないよ';
      return;
    }

    this._calibActive = true;
    this._calibDeltas = [];
    this._calibTicks = [];
    this._calibUsedTicks = [];
    this._calibLastPitchAt = null;
    if (msgEl) msgEl.textContent = 'カチッに あわせて どのおとでもいいから 1かいずつ ひいてね';

    const CALIB_BPM = 90;
    const COUNT_IN_BEATS = 4;
    const MAIN_BEATS = 8;
    const TOTAL_BEATS = COUNT_IN_BEATS + MAIN_BEATS;
    metronome.start(CALIB_BPM, (beat, tickTime) => {
      if (!this._calibActive) return;
      if (beat >= COUNT_IN_BEATS) this._calibTicks.push(tickTime); // 本編8拍分だけ収集対象にする
      if (beat >= TOTAL_BEATS - 1){
        metronome.stop();
        const secPerBeat = 60 / CALIB_BPM;
        // 最終tickの音が鳴り切り、ユーザーがそれに合わせて弾き終える猶予を待ってから集計する
        setTimeout(() => this._finishCalibRun(), (secPerBeat + 0.4) * 1000);
      }
    });
  }

  // pitchイベントからオンセットを検出する。「直前のpitchイベントから200ms以上あいた後の
  // 最初のイベント」をオンセットとみなす（ev.t=performance.now()/1000同士の相対比較のみに使う）。
  // tickTimeはAudioContext.currentTime基準で、ev.t（wall clock）とはエポックが異なり直接比較
  // できないため、delta計算はオンセット検出と同じ瞬間のthis._now()（ctx.currentTime）で行う。
  _handleCalibPitch(ev){
    if (!this._calibActive || ev.midi == null) return;
    // チューナー/micSetupと同じclarity/level品質ゲート（ノイズ・弱い雑音をオンセット扱いしない）
    const instrument = this.instrument || __RK_INSTRUMENTS[this.selectedInstrumentId] || {};
    const mic = instrument.mic || {};
    const clarityMin = mic.clarityMin != null ? mic.clarityMin : 0.83;
    const levelMin = mic.levelMin != null ? mic.levelMin : 0;
    if (ev.clarity == null || ev.clarity < clarityMin) return;
    if (ev.level != null && ev.level < levelMin) return;
    const isOnset = this._calibLastPitchAt == null || (ev.t - this._calibLastPitchAt) >= 0.2;
    this._calibLastPitchAt = ev.t;
    if (!isOnset) return;
    const audioNow = this._now();
    // 複数tickの±0.4s窓に入る場合は最近傍のtickに割り当て、tickごとに1オンセットまでとする
    let bestIdx = -1;
    let bestAbsDelta = Infinity;
    for (let i = 0; i < this._calibTicks.length; i++){
      if (this._calibUsedTicks[i]) continue;
      const delta = audioNow - this._calibTicks[i];
      const absDelta = Math.abs(delta);
      if (absDelta <= 0.4 && absDelta < bestAbsDelta){
        bestAbsDelta = absDelta;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0){
      this._calibUsedTicks[bestIdx] = true;
      this._calibDeltas.push(audioNow - this._calibTicks[bestIdx]);
    }
  }

  _finishCalibRun(){
    if (this.mode !== 'calib') return;
    this._calibActive = false;
    if (typeof metronome !== 'undefined' && metronome.stop) metronome.stop();
    if (this.inputRouter && this.inputRouter.stopMic) this.inputRouter.stopMic();
    const msgEl = document.getElementById('rk-calib-message');
    const resultEl = document.getElementById('rk-calib-result');
    const retryBtn = document.getElementById('rk-btn-calib-retry');
    const offset = rkCalibOffset(this._calibDeltas);
    if (offset == null){
      if (msgEl) msgEl.textContent = 'うまく きこえなかった… もういちど';
      if (resultEl) resultEl.textContent = '';
      if (retryBtn) retryBtn.classList.remove('rk-hidden');
      return;
    }
    this.offsetSec = offset;
    this._saveOptions();
    const slider = document.getElementById('rk-offset-slider');
    if (slider) slider.value = String(offset);
    if (msgEl) msgEl.textContent = '';
    if (resultEl) resultEl.textContent = 'ずれ ' + Math.abs(offset).toFixed(2) + 'びょう → あわせたよ！';
    if (retryBtn) retryBtn.classList.add('rk-hidden');
    // 結果を少し見せてから自動で設定画面へ戻る（子供に追加タップを要求しない）
    setTimeout(() => { if (this.mode === 'calib') this._toSettings(); }, 1600);
  }

  // --- play ---
  _startPlay(){
    this.mode = 'play';
    this._showScreen(null);
    const canvas = document.getElementById('rk-canvas');
    if (!this.highway){
      this.highway = new Highway(canvas, this.instrument, this.naming);
    } else {
      this.highway.setInstrument(this.instrument);
      this.highway.setNaming(this.naming);
      this.highway.fit();
    }
    // v1.3: pitchモードは判定線を0.70に上げ画面下30%を運指ガイドパネルに空ける。
    // laneモードは従来どおり0.82（タッチボタンのレイアウトを変えない）。
    if (this.highway.setJudgeMode) this.highway.setJudgeMode(this.judgeMode);
    if (typeof FingerBoard !== 'undefined'){
      if (!this.fingerboard) this.fingerboard = new FingerBoard(this.instrument, this.naming);
      else {
        this.fingerboard.setInstrument(this.instrument);
        this.fingerboard.setNaming(this.naming);
      }
    }
    this.judge = new JudgeEngine(
      this.selectedChart.notes, this.selectedChart.bpm, this.instrument,
      this.judgeMode, this.isWaitMode, this.offsetSec
    );
    // v1.2: 前回プレイの「いま鳴っている音」表示が新しい曲に持ち越されないようリセットする
    this._detectedNote = null;
    this._detectedCandidateMidi = null;
    this._detectedCandidateCount = 0;
    this._lastPitchEventAt = null;

    this._teardownLaneButtons();
    if (this.judgeMode === 'lane' && this.inputRouter){
      const laneEl = document.getElementById('rk-lane-buttons');
      if (laneEl && this.inputRouter.attachTouch){
        this._laneButtonEls = this.inputRouter.attachTouch(laneEl, this.instrument.lanes);
        this._positionLaneButtons();
      }
      if (this.inputRouter.attachKeyboard) this._keyboardDetach = this.inputRouter.attachKeyboard(this.instrument.lanes);
    }

    const countInBeats = this.selectedChart.countInBeats != null ? this.selectedChart.countInBeats : 4;
    const secPerBeat = 60 / this.selectedChart.bpm;
    if (typeof metronome !== 'undefined' && metronome.start){
      // count-inのcountInBeats拍だけ鳴らし、曲本体（beat0以降）ではメトロノームを止める
      metronome.start(this.selectedChart.bpm, (beat) => {
        if (beat >= countInBeats - 1 && typeof metronome.stop === 'function') metronome.stop();
      });
    }
    this.playStartAudioTime = this._now() + countInBeats * secPerBeat;
    // waitモード用のクロック。カウントイン分をマイナスから始め、_tick内でactiveノートの
    // targetSecにクランプする（実時間を無条件に進めるとノートが判定線を通過してしまうため）。
    this._songClock = -(countInBeats * secPerBeat);
    this._lastFrameTime = this._now();
    this._tickGen++;
    this._tick(this._tickGen);
  }

  // 曲内経過秒の単一ソース。waitモードは「正解待ちで停止するクロック」、
  // 通常モードはAudioContext.currentTime基準の実時間。_tick()と_handleInputEvent()の
  // 両方がこれを使うことで、判定に使う時刻と描画に使う時刻の不整合を防ぐ。
  _songTime(){
    if (this.isWaitMode) return this._songClock;
    return this._now() - this.playStartAudioTime;
  }

  // canvas上のレーンレイアウト(highway.laneButtons)に合わせて、input_router.jsが
  // 生成した実DOMボタンをCSSで重ねて配置する。resize時にも呼び直す。
  _positionLaneButtons(){
    if (!this._laneButtonEls || !this.highway) return;
    const canvas = document.getElementById('rk-canvas');
    const stage = document.getElementById('rk-stage');
    if (!canvas || !stage) return;
    const canvasRect = canvas.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const offsetX = canvasRect.left - stageRect.left;
    const offsetY = canvasRect.top - stageRect.top;
    this.highway.laneButtons.forEach((b, i) => {
      const el = this._laneButtonEls[i];
      if (!el) return;
      el.style.left = (offsetX + b.x + 4) + 'px';
      el.style.top = (offsetY + b.y) + 'px';
      el.style.width = (b.w - 8) + 'px';
      el.style.height = b.h + 'px';
    });
  }

  _teardownLaneButtons(){
    const laneEl = document.getElementById('rk-lane-buttons');
    if (laneEl) laneEl.innerHTML = '';
    this._laneButtonEls = null;
    if (this._keyboardDetach){ this._keyboardDetach(); this._keyboardDetach = null; }
  }

  _lastNoteTargetSec(){
    const runners = this.judge.runners;
    return runners.length ? runners[runners.length - 1].targetSec : 0;
  }

  _tick(gen){
    if (this.mode !== 'play' || gen !== this._tickGen) return;
    const now = this._now();
    const dt = Math.max(0, now - this._lastFrameTime);
    this._lastFrameTime = now;

    if (this.isWaitMode){
      this._songClock += dt;
      const active = this.judge.runners[this.judge.cursor];
      if (active) this._songClock = Math.min(this._songClock, active.targetSec);
    }
    const songTimeSec = this._songTime();

    const missed = this.judge.update(songTimeSec);
    if (missed && missed.length){
      for (const r of missed){
        const pos = this.instrument.noteToLane(r.note.midi);
        this.highway.spawnMissFx(pos.laneIndex);
      }
      if (typeof playSfx === 'function') playSfx('miss');
    }
    this.highway.updateFx(dt);
    this._drawPlayFrame(songTimeSec);

    const lastTarget = this._lastNoteTargetSec();
    if (this.judge.isDone && songTimeSec >= lastTarget + 2){
      this._toResult();
      return;
    }
    requestAnimationFrame(() => this._tick(gen));
  }

  // judge.runners[index] を FingerBoard.draw が要求する {laneIndex, fret, midi} に解決する。
  // index が範囲外/undefinedならnull（fingerboard.js側で「何も描かない」に倒れる）。
  _fingerboardPos(index){
    const runner = index != null ? this.judge.runners[index] : null;
    if (!runner) return null;
    const pos = this.instrument.noteToLane(runner.note.midi);
    return { laneIndex: pos.laneIndex, fret: pos.fret, midi: runner.note.midi };
  }
  // fromIndex以降で最初にstate==='pending'のrunnerインデックスを探す（無ければ-1）。
  // judge.cursorの次に弾くべきノート（next）を求めるのに使う。
  _nextPendingIndex(fromIndex){
    const runners = this.judge.runners;
    for (let i = fromIndex; i < runners.length; i++){
      if (runners[i].state === 'pending') return i;
    }
    return -1;
  }

  _drawPlayFrame(songTimeSec){
    const theme = this.gameDef.theme || {};
    this.highway.draw(this.judge.runners, songTimeSec, theme);
    const ctx = this.highway.ctx;
    drawRkScoreHud(ctx, 12, 12, this.judge.score, this.judge.combo);
    if (this.judgeMode === 'pitch'){
      const levelMin = (this.instrument.mic && this.instrument.mic.levelMin) || 0;
      // contentW基準（横長×pitch時はハイウェイ自体が55%に縮むため、右パネルにかぶらないよう
      // ハイウェイ自身の幅の中で右寄せ/中央寄せする。縦長/laneはcontentW===wで従来どおり）。
      drawRkMicMeter(ctx, this.highway.contentW - 132, 12, 120, 14, this._micLevel, levelMin);
      // 0.5秒pitchイベントが無ければ表示を消す（ev.tと同じwall clock系列=performance.now()で判定）
      if (this._detectedNote && (this._lastPitchEventAt == null
          || (performance.now() / 1000 - this._lastPitchEventAt) > 0.5)){
        this._detectedNote = null;
      }
      drawRkDetectedNote(ctx, this.highway.contentW / 2, this.highway.judgeY - 16, this._detectedNote, this.naming);
      if (this.fingerboard && this.highway.panelRegion){
        const current = this._fingerboardPos(this.judge.cursor);
        const next = this._fingerboardPos(this._nextPendingIndex(this.judge.cursor + 1));
        const pr = this.highway.panelRegion;
        this.fingerboard.draw(ctx, pr.x, pr.y, pr.w, pr.h, current, next, theme);
      }
    }
    if (!this.isWaitMode){
      const totalSec = this._lastNoteTargetSec() + 2;
      drawRkProgressBar(ctx, 12, this.highway.h - 14, this.highway.contentW - 24, Math.max(0, songTimeSec), totalSec);
    }
  }

  // --- result ---
  _toResult(){
    this.mode = 'result';
    this._teardownLaneButtons();
    if (this.inputRouter && this.inputRouter.stopMic) this.inputRouter.stopMic();
    this._showScreen('rk-result');
    this._maybeSaveBestScore();
    this._resultRank = rkResultRank(this.judge.stats);
    if (typeof playSfx === 'function') playSfx('fanfare');
    this._resultFrame = 0;
    this._resultLoop();
  }

  // リザルト表示中だけ回すrAFループ（紙吹雪を動かすため、パネルごと毎フレーム再描画する）。
  // mode!=='result'になったら自然停止する（もういちど/きょくをえらぶタップでmodeが変わる）。
  _resultLoop(){
    if (this.mode !== 'result') return;
    const ctx = this.highway.ctx;
    const w = this.highway.w, h = this.highway.h;
    ctx.clearRect(0, 0, w, h);
    drawRkResultPanel(ctx, w, h, this._resultRank, this.judge.stats, this.isWaitMode);
    drawRkConfetti(ctx, w, h, this._resultFrame);
    this._resultFrame++;
    requestAnimationFrame(() => this._resultLoop());
  }

  // --- tuner（title から直行・戻る） ---
  _toTuner(){
    if (typeof unlock === 'function') unlock();
    this.mode = 'tuner';
    this._tunerDetected = null;
    this._showScreen('rk-tuner');
    const canvas = document.getElementById('rk-canvas');
    const instrument = __RK_INSTRUMENTS[this.selectedInstrumentId] || this.instrument;
    this._setupInputRouter(instrument);
    if (!this.highway) this.highway = new Highway(canvas, instrument, this.naming);
    else this.highway.setInstrument(instrument);
    this.highway.fit();
    if (this.inputRouter && this.inputRouter.startMic) this.inputRouter.startMic();
    this._tunerLoop();
  }

  _tunerLoop(){
    if (this.mode !== 'tuner') return;
    const ctx = this.highway.ctx;
    ctx.clearRect(0, 0, this.highway.w, this.highway.h);
    drawRkTuner(ctx, this.highway.w, this.highway.h, this._tunerDetected, this.naming);
    requestAnimationFrame(() => this._tunerLoop());
  }

  _onTunerBack(){
    if (this.inputRouter && this.inputRouter.stopMic) this.inputRouter.stopMic();
    this._toTitle();
  }

  // --- 統一入力イベントの受け口（input_router.js からのコールバック） ---
  _handleInputEvent(ev){
    if (ev.kind === 'pitch'){
      // play中のマイクレベル表示がmicSetup時の値のまま凍結しないよう、モードに関わらず常に更新する
      this._micLevel = ev.level || 0;
      if (this.mode === 'micSetup'){
        this._updateMicSetupDetected(ev);
        return;
      }
      if (this.mode === 'tuner'){
        const instrument = __RK_INSTRUMENTS[this.selectedInstrumentId] || this.instrument || {};
        const mic = instrument.mic || {};
        const clarityMin = mic.clarityMin != null ? mic.clarityMin : 0.83;
        this._tunerDetected = (ev.clarity != null && ev.clarity >= clarityMin)
          ? { midi: ev.midi, cents: ev.cents } : null;
        return;
      }
      if (this.mode === 'calib'){
        this._handleCalibPitch(ev);
        return;
      }
      if (this.mode === 'play' && this.judgeMode === 'pitch'){
        this._updatePlayDetectedNote(ev);
      }
    }
    if (this.mode !== 'play' || !this.judge) return;
    const songTimeSec = this._songTime();
    let result = null;
    if (ev.kind === 'pitch') result = this.judge.feedPitch(ev, songTimeSec);
    else if (ev.kind === 'lane') result = this.judge.feedLane(ev, songTimeSec);
    if (result){
      const pos = this.instrument.noteToLane(result.runner.note.midi);
      this.highway.spawnHitFx(pos.laneIndex, result.rank);
      if (typeof playSfx === 'function') playSfx(result.rank);
      // れんしゅうモードの正解音・リズムモードのヒット音（自分が弾いた音の代わりにもなる）
      if (typeof playNote === 'function') playNote(result.runner.note.midi, { patch: this.instrument.synthPatch });
      this._maybeCheer();
    }
  }

  // micSetup画面の検出音名表示を更新する（v1.2・チューナーと同じclarity条件）。
  _updateMicSetupDetected(ev){
    const instrument = this.instrument || __RK_INSTRUMENTS[this.selectedInstrumentId] || {};
    const mic = instrument.mic || {};
    const clarityMin = mic.clarityMin != null ? mic.clarityMin : 0.83;
    this._micSetupDetected = (ev.midi != null && ev.clarity != null && ev.clarity >= clarityMin)
      ? { midi: ev.midi } : null;
  }

  // judge.cursor位置の「次に弾くべきノート」のmidi（無ければnull）。検出音のmatch判定に使う。
  _currentTargetMidi(){
    if (!this.judge) return null;
    const runner = this.judge.runners[this.judge.cursor];
    return runner ? runner.note.midi : null;
  }

  // play中(pitchモード)のHUD「いま鳴っている音」表示を更新する（v1.2）。
  // 2フレーム連続で同じ丸めmidiのときだけ表示を更新する（チラつき防止）。
  // 0.5秒イベントが無ければ消す処理は描画側（_drawPlayFrame）で行う。
  _updatePlayDetectedNote(ev){
    if (ev.midi == null){
      this._detectedCandidateMidi = null;
      this._detectedCandidateCount = 0;
      return;
    }
    this._lastPitchEventAt = ev.t;
    if (ev.midi === this._detectedCandidateMidi){
      this._detectedCandidateCount++;
    } else {
      this._detectedCandidateMidi = ev.midi;
      this._detectedCandidateCount = 1;
    }
    if (this._detectedCandidateCount >= 2){
      const targetMidi = this._currentTargetMidi();
      const match = targetMidi != null
        && rkPitchMatches(targetMidi, ev.midi, this.instrument.pitchTolerance);
      this._detectedNote = { midi: ev.midi, match };
    }
  }

  // GAME_DEF.theme.mascot.cheer をコンボ5の倍数ヒットごとに順繰りで表示する（乱数不使用・決定論）。
  // mascot.enableがfalsyなら何もしない。文言の中身は一切解釈せずhighwayへそのまま渡すだけ。
  _maybeCheer(){
    const mascot = (this.gameDef.theme && this.gameDef.theme.mascot) || null;
    if (!mascot || !mascot.enable || !mascot.cheer || !mascot.cheer.length) return;
    if (this.judge.combo === 0 || this.judge.combo % 5 !== 0) return;
    const idx = (this.judge.combo / 5 - 1) % mascot.cheer.length;
    this.highway.spawnCheerFx(mascot.cheer[idx]);
    this.highway.spawnComboPulse();
    if (typeof playSfx === 'function') playSfx('cheer');
  }
}

function createRhythmGame(gameDef){
  const game = new RhythmGame(gameDef);
  game.boot();
  return game;
}
