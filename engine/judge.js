/*
 * judge.js — ノート判定エンジン（タイミング×音程／レーン）
 *
 * 何をする部品か: CHART.notes を「これから判定すべきノートの列」として受け取り、
 *   input_router.js から渡される pitch/lane イベントをフィードすることでヒット判定を
 *   行う（PERFECT/GOOD窓・pitch一致条件・れんしゅう(wait)モードの停止挙動・スコア式）。
 *   曲名・楽器名・UIの中身は一切知らない（表示はhighway.js/hud.js側の責務。
 *   noteToLane等の楽器固有の写像だけINSTRUMENT_DEFから読む）。
 * 外部依存: なし（純粋な状態機械）。呼び出し側(game_core.js)が songTimeSec と
 *   input_routerからのイベントを毎フレーム渡す。
 *
 * 公開API: JudgeEngine（1曲分のライフサイクルを管理）。
 *   new JudgeEngine(notes, bpm, instrument, judgeMode, isWaitMode, offsetSec)
 *   .feedPitch(ev, songTimeSec) / .feedLane(ev, songTimeSec) / .update(songTimeSec)
 *   .isDone / .combo / .maxCombo / .score / .stats{perfect,good,miss} / .accuracy()
 */

const RK_PERFECT_WINDOW = 0.18;
const RK_GOOD_WINDOW = 0.35;
const RK_PITCH_HOLD_SEC = 0.06; // 連続60ms保持でHIT確定

// pitchTolerance: 'exact'=同一midi一致 / 'pitchClass'=オクターブ違い許容（既定）
function rkPitchMatches(targetMidi, gotMidi, tolerance){
  if (tolerance === 'pitchClass') return (((targetMidi - gotMidi) % 12) + 12) % 12 === 0;
  return targetMidi === gotMidi;
}

function rkJudgeRankFromDelta(deltaAbsSec){
  if (deltaAbsSec <= RK_PERFECT_WINDOW) return 'perfect';
  if (deltaAbsSec <= RK_GOOD_WINDOW) return 'good';
  return null;
}

// コンボ倍率: 1 + min(combo,20)*0.05（SPEC「スコア: PERFECT100/GOOD50×combo倍率」）
function rkComboMultiplier(combo){ return 1 + Math.min(combo, 20) * 0.05; }

function rkNoteScore(rank, comboBeforeThisHit){
  const base = rank === 'perfect' ? 100 : (rank === 'good' ? 50 : 0);
  return Math.round(base * rkComboMultiplier(comboBeforeThisHit));
}

// リザルトランク: PERFECT率 90%+=S / 70%+=A / 50%+=B / それ以外=C
function rkResultRank(stats){
  const total = stats.perfect + stats.good + stats.miss;
  if (total === 0) return 'C';
  const perfectRate = stats.perfect / total;
  if (perfectRate >= 0.9) return 'S';
  if (perfectRate >= 0.7) return 'A';
  if (perfectRate >= 0.5) return 'B';
  return 'C';
}

// 1ノート分の判定状態。JudgeEngineが内部で使う（外部から直接newしない）。
class RkNoteRunner {
  constructor(note, targetSec){
    this.note = note;             // {beat, midi, len}（CHART.notes の1要素）
    this.targetSec = targetSec;   // 曲頭からの絶対秒（beat→秒変換済み）
    this.state = 'pending';       // pending | hit | missed
    this.rank = null;             // 'perfect' | 'good' | null
    this._holdStart = null;       // pitch連続保持の開始時刻（イベントのtフィールド基準）
  }
}

class JudgeEngine {
  // notes: CHART.notes（beat昇順前提）, bpm: CHART.bpm, instrument: INSTRUMENT_DEF
  // judgeMode: 'pitch'|'lane', isWaitMode: true=れんしゅう（時間経過でmissにせず待つ）
  // offsetSec: 設定スライダー値。イベント側の時刻に加算して補正する（既定-0.12）
  constructor(notes, bpm, instrument, judgeMode, isWaitMode, offsetSec){
    this.instrument = instrument;
    this.judgeMode = judgeMode;
    this.isWaitMode = !!isWaitMode;
    this.offsetSec = offsetSec || 0;
    this.secPerBeat = 60 / bpm;
    this.runners = notes.map(n => new RkNoteRunner(n, n.beat * this.secPerBeat));
    // 次に判定対象となりうる runner の先頭インデックス。全ノードpending消化と共に前進する
    this.cursor = 0;
    this.stats = { perfect: 0, good: 0, miss: 0 };
    this.combo = 0;
    this.maxCombo = 0;
    this.score = 0;
    this.lastHit = null; // 直近のヒット結果 {runner, rank}（highway.jsの演出トリガー用）
  }
  get isDone(){ return this.cursor >= this.runners.length; }
  get totalNotes(){ return this.runners.length; }
  _activeRunner(){
    // wait modeでは常にcursor位置の1ノートだけが判定対象
    return this.cursor < this.runners.length ? this.runners[this.cursor] : null;
  }
  // 通常モード: タイミング窓(±GOOD)に入っているpending runnerを列挙する。
  // notesはbeat昇順なので、窓より未来のノートに達したら打ち切ってよい。
  _windowedRunners(songTimeSec){
    const out = [];
    for (let i = this.cursor; i < this.runners.length; i++){
      const r = this.runners[i];
      if (r.state !== 'pending') continue;
      const delta = songTimeSec - r.targetSec;
      if (delta > RK_GOOD_WINDOW) continue;
      if (delta < -RK_GOOD_WINDOW) break;
      out.push(r);
    }
    return out;
  }
  _settleHit(runner, rank){
    runner.state = 'hit';
    runner.rank = rank;
    this.score += rkNoteScore(rank, this.combo);
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.stats[rank]++;
    this.lastHit = { runner, rank };
    this._advanceCursor();
    return this.lastHit;
  }
  _settleMiss(runner){
    runner.state = 'missed';
    this.combo = 0;
    this.stats.miss++;
    this._advanceCursor();
  }
  _advanceCursor(){
    while (this.cursor < this.runners.length && this.runners[this.cursor].state !== 'pending') this.cursor++;
  }
  // pitchイベント: {kind:'pitch', freq, midi, cents, clarity, level, t}
  // songTimeSec: このイベントを処理する時点の曲内経過秒（AudioContext.currentTime基準）
  // 戻り値: ヒットした場合 {runner, rank}、なければ null
  feedPitch(ev, songTimeSec){
    if (this.judgeMode !== 'pitch') return null;
    const mic = this.instrument.mic || {};
    const clarityOk = ev.clarity != null && ev.clarity >= (mic.clarityMin != null ? mic.clarityMin : 0.83);
    const levelOk = ev.level == null || ev.level >= (mic.levelMin != null ? mic.levelMin : 0);
    const t = songTimeSec + this.offsetSec;
    const targets = this.isWaitMode
      ? (this._activeRunner() ? [this._activeRunner()] : [])
      : this._windowedRunners(t);
    for (const runner of targets){
      const matches = clarityOk && levelOk && rkPitchMatches(runner.note.midi, ev.midi, this.instrument.pitchTolerance);
      if (!matches){ runner._holdStart = null; continue; }
      if (runner._holdStart == null) runner._holdStart = ev.t;
      const held = ev.t - runner._holdStart;
      if (held < RK_PITCH_HOLD_SEC) continue;
      if (this.isWaitMode) return this._settleHit(runner, 'perfect');
      const rank = rkJudgeRankFromDelta(Math.abs(t - runner.targetSec));
      if (rank) return this._settleHit(runner, rank);
    }
    return null;
  }
  // laneイベント: {kind:'lane', laneIndex, t}
  feedLane(ev, songTimeSec){
    if (this.judgeMode !== 'lane') return null;
    const t = songTimeSec + this.offsetSec;
    const targets = this.isWaitMode
      ? (this._activeRunner() ? [this._activeRunner()] : [])
      : this._windowedRunners(t);
    for (const runner of targets){
      const pos = this.instrument.noteToLane(runner.note.midi);
      if (pos.laneIndex !== ev.laneIndex) continue;
      if (this.isWaitMode) return this._settleHit(runner, 'perfect');
      const rank = rkJudgeRankFromDelta(Math.abs(t - runner.targetSec));
      if (rank) return this._settleHit(runner, rank);
    }
    return null;
  }
  // 毎フレーム呼ぶ。GOOD窓を過ぎたpendingノートをmiss化する。
  // wait modeでは何もしない（SPEC「れんしゅうモードはMISSなし・何秒かかってもOK」）。
  // 戻り値: このフレームでmiss確定したrunnerの配列
  update(songTimeSec){
    if (this.isWaitMode) return [];
    const t = songTimeSec + this.offsetSec;
    const missed = [];
    for (let i = this.cursor; i < this.runners.length; i++){
      const r = this.runners[i];
      if (r.state !== 'pending') continue;
      if (t - r.targetSec > RK_GOOD_WINDOW){
        this._settleMiss(r);
        missed.push(r);
      } else break;
    }
    return missed;
  }
  accuracy(){
    const total = this.stats.perfect + this.stats.good + this.stats.miss;
    return total ? this.stats.perfect / total : 0;
  }
}
