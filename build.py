#!/usr/bin/env python3
"""
build.py — rhythmkit: template.html + engine/*.js + instruments/*.js + charts/*.js +
games/<id>/game.js から単一の dist/<id>/index.html を組み立てる。

依存: Python 標準ライブラリのみ。

使い方:
    python3 build.py <game_id>          # dist/<game_id>/index.html を生成

やること:
    1. template.html を読む
    2. engine/ 配下の汎用部品を固定順序で結合
       （audio_synth.js -> pitch_detector.js -> input_router.js -> highway.js
        -> judge.js -> hud.js -> game_core.js）
    3. instruments/ 配下の全 *.js をファイル名アルファベット順に結合
    4. charts/ 配下の全 *.js をファイル名アルファベット順に結合
    5. games/<game_id>/game.js を読む
    6. game.js の中身から GAME_DEF.meta.title を正規表現で抽出し、<title> タグに使う
       （見つからなければ game_id をフォールバックにする）
    7. テンプレートの __ENGINE_JS__ / __INSTRUMENTS_JS__ / __CHARTS_JS__ / __GAME_JS__ /
       __GAME_TITLE__ を置換して書き出す

決定論: ファイル読み込みと文字列置換のみで、乱数・タイムスタンプ・実行環境依存の
出力は一切含まない。同じ入力なら同じバイト列が常に生成される。
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENGINE_DIR = ROOT / "engine"
INSTRUMENTS_DIR = ROOT / "instruments"
CHARTS_DIR = ROOT / "charts"
GAMES_DIR = ROOT / "games"

# 結合順序（SPEC.md「build.py 結合順序」節に固定。勝手に変えない）。
ENGINE_ORDER = [
    "audio_synth.js",
    "pitch_detector.js",
    "input_router.js",
    "highway.js",
    "fingerboard.js",
    "judge.js",
    "hud.js",
    "game_core.js",
]

# GAME_DEF.meta.title 抽出パターン（最初のマッチのみ使う）
TITLE_RE = re.compile(r"meta:\s*\{[^}]*?title:\s*'([^']+)'")


def read(path):
    return path.read_text(encoding="utf-8")


def extract_game_title(game_js, game_id):
    m = TITLE_RE.search(game_js)
    return m.group(1) if m else game_id


def read_dir_sorted(dir_path, label):
    """dir_path 配下の *.js をファイル名アルファベット順に結合して返す。
    1つも無ければ、何が足りないか分かるエラーメッセージで止める
    （instruments/charts が未実装の段階でも build.py が動作確認できるように）。
    """
    files = sorted(dir_path.glob("*.js"), key=lambda p: p.name) if dir_path.exists() else []
    if not files:
        raise FileNotFoundError(
            f"{label} が1つも見つかりません: {dir_path} に *.js を配置してください"
        )
    return "\n\n".join(read(p).rstrip() for p in files)


def build(game_id):
    game_dir = GAMES_DIR / game_id
    game_js_path = game_dir / "game.js"
    if not game_js_path.exists():
        raise FileNotFoundError(f"game not found: {game_js_path}")

    missing_engine = [name for name in ENGINE_ORDER if not (ENGINE_DIR / name).exists()]
    if missing_engine:
        raise FileNotFoundError(
            "engine/ に未実装の部品があります: " + ", ".join(missing_engine)
        )

    template = read(ROOT / "template.html")
    engine_js = "\n\n".join(read(ENGINE_DIR / name).rstrip() for name in ENGINE_ORDER)
    instruments_js = read_dir_sorted(INSTRUMENTS_DIR, "instruments/*.js")
    charts_js = read_dir_sorted(CHARTS_DIR, "charts/*.js")
    game_js = read(game_js_path).rstrip()
    game_title = extract_game_title(game_js, game_id)

    out = template
    out = out.replace("__ENGINE_JS__", engine_js)
    out = out.replace("__INSTRUMENTS_JS__", instruments_js)
    out = out.replace("__CHARTS_JS__", charts_js)
    out = out.replace("__GAME_JS__", game_js)
    out = out.replace("__GAME_TITLE__", game_title)
    return out


def main():
    if len(sys.argv) < 2:
        print("usage: python3 build.py <game_id>", file=sys.stderr)
        sys.exit(1)
    game_id = sys.argv[1]
    content = build(game_id)

    out_path = ROOT / "dist" / game_id / "index.html"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(content, encoding="utf-8")
    print(f"wrote {out_path} ({len(content)} bytes)")


if __name__ == "__main__":
    main()
