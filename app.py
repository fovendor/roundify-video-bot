#!/usr/bin/env python3
"""
Roundify‑Web — конвертация видео в кружочки Telegram.

CLI‑параметры
-------------
  -j, --jobs <1‑6>      —  параллельных конверсий (default 1)
  -e, --expire <1‑300>  —  секунд хранить результат (default 60)

Параметры окружения (используются, если нет CLI‑флага):
  ROUNDIFY_JOBS     —   то же, что -j
  TTL_SECONDS       —   то же, что -e
  FFMPEG            —   путь к ffmpeg
  PORT              —   порт для `python app.py`
"""
from __future__ import annotations
import argparse, importlib.util, os, platform, subprocess, sys, tempfile, threading, uuid
from contextlib import contextmanager
from pathlib import Path
from typing import List

# ─────────────────── автоустановка зависимостей ──────────────────────────────
BASE = Path(__file__).resolve().parent
REQ  = BASE / "requirements.txt"
for mod in ("flask", "requests"):
    if importlib.util.find_spec(mod) is None:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", str(REQ)])

# ─────────────────────────── CLI / ENV чтение ────────────────────────────────
def _parse_cli() -> tuple[int, int]:
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument("-j", "--jobs",   type=int, help="parallel conversions (1‑6)")
    p.add_argument("-e", "--expire", type=int, help="seconds to keep result (1‑300)")
    ns, _ = p.parse_known_args()

    jobs   = ns.jobs   or int(os.getenv("ROUNDIFY_JOBS", 1))
    expire = ns.expire or int(os.getenv("TTL_SECONDS",   60))
    jobs   = max(1, min(6, jobs))
    expire = max(1, min(300, expire))
    return jobs, expire

MAX_JOBS, TTL_SECONDS = _parse_cli()

# ───────────────────────────── Flask импорты ─────────────────────────────────
from flask import (Flask, jsonify, render_template, request,
                   send_from_directory, url_for)                              # type: ignore
import requests                                                               # type: ignore

# ──────────────────────────────── FS и FFmpeg ────────────────────────────────
FFMPEG   = os.getenv("FFMPEG", "ffmpeg")
TMP_DIR  = Path(tempfile.gettempdir()) / "roundify_web"
SLOT_DIR = TMP_DIR / "slots"
for d in (TMP_DIR, SLOT_DIR): d.mkdir(exist_ok=True)

# ─────────────── файловый семафор (MAX_JOBS параллельно) ─────────────────────
if platform.system() == "Windows":
    if importlib.util.find_spec("portalocker") is None:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "portalocker>=2"])
    import portalocker                             # type: ignore
    @contextmanager
    def _lock(path: Path):
        with portalocker.Lock(str(path),
                              flags=portalocker.LOCK_EX | portalocker.LOCK_NB):
            yield
else:
    import fcntl
    @contextmanager
    def _lock(path: Path):
        path.touch(exist_ok=True)
        with path.open("r+") as fh:
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:    yield
            finally: fcntl.flock(fh, fcntl.LOCK_UN)

class Busy(Exception): ...

@contextmanager
def acquire_slot():
    for i in range(MAX_JOBS):
        try:
            with _lock(SLOT_DIR / f"slot{i}.lock"):
                yield; return
        except Exception:
            continue
    raise Busy

# ───────────────────────────── утилиты ───────────────────────────────────────
def _run(cmd: List[str]) -> None:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr or r.stdout)

def _convert(src: Path, dst: Path, size: int, dur: int, off: int) -> None:
    vf = f"crop='min(iw\\,ih)':min(iw\\,ih),setsar=1,scale={size}:{size}"
    cmd = [FFMPEG, "-y", "-ss", str(off), "-i", str(src), "-t", str(dur),
           "-vf", vf,
           "-c:v", "libx264", "-profile:v", "baseline", "-level", "3.0",
           "-preset", "veryfast", "-crf", "23",
           "-pix_fmt", "yuv420p", "-movflags", "+faststart",
           "-c:a", "aac", "-b:a", "128k", str(dst)]
    _run(cmd)

def _send_note(tok: str, chat: str, video: Path, length: int) -> None:
    url = f"https://api.telegram.org/bot{tok}/sendVideoNote"
    with video.open("rb") as f:
        r = requests.post(url, data={"chat_id": chat, "length": length},
                          files={"video_note": f}, timeout=45)
    if not r.ok:
        raise RuntimeError(r.text)

def _schedule_delete(path: Path, delay: int = TTL_SECONDS) -> None:
    t = threading.Timer(delay, path.unlink, kwargs={"missing_ok": True})
    t.daemon = True
    t.start()

# ──────────────────────────── Flask app ──────────────────────────────────────
app = Flask(__name__, template_folder="templates", static_folder="static")

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/convert", methods=["POST"])
def api_convert():
    try:
        with acquire_slot():
            up = request.files.get("video")
            if not up:
                return jsonify(error="file not selected"), 400

            size = int(request.form.get("size", 640))
            dur  = int(request.form.get("duration", 60))
            off  = int(request.form.get("offset", 0))

            src = TMP_DIR / f"in_{uuid.uuid4().hex}"
            up.save(src)
            out = TMP_DIR / f"{src.stem}_round.mp4"

            try:
                _convert(src, out, size, dur, off)
            finally:
                src.unlink(missing_ok=True)

            tok, chat = request.form.get("token"), request.form.get("chat")
            if tok and chat:                             # Telegram‑режим
                try:
                    _send_note(tok, chat, out, length=size)
                except Exception as e:
                    out.unlink(missing_ok=True)
                    return jsonify(error=str(e)), 500
                _schedule_delete(out)                    # держим TTL для скачивания
                return jsonify(download=url_for('download', filename=out.name),
                               expires_in=TTL_SECONDS,
                               sent=True)

            _schedule_delete(out)                        # обычный сценарий
            return jsonify(download=url_for('download', filename=out.name),
                           expires_in=TTL_SECONDS,
                           sent=False)

    except Busy:
        return jsonify(error="Server busy, try again later"), 429
    except Exception as e:
        return jsonify(error=str(e)), 500

@app.route("/favicon.ico")
def favicon():
    return send_from_directory(
        app.static_folder,     # = "static"
        "favicon.ico",
        mimetype="image/vnd.microsoft.icon",
    )

@app.route("/download/<path:filename>")
def download(filename):
    return send_from_directory(TMP_DIR, filename, as_attachment=True)

@app.route("/ping")
def ping(): return "pong"

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=True)
