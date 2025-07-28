#!/usr/bin/env python3
"""
Roundify‑Web — Flask‑сервис, который конвертирует видео в кружочки Telegram.
⇢ Параллелизм задаётся флагом `-j/--jobs` или переменной окружения ROUNDIFY_JOBS.

Запуск примеры
--------------
# 3 одновременных задачи
python app.py -j 3
# либо
ROUNDIFY_JOBS=3 gunicorn -b 0.0.0.0:8000 app:app
"""
from __future__ import annotations
import argparse, importlib.util, os, platform, subprocess, sys, tempfile, uuid
from contextlib import contextmanager
from pathlib import Path
from typing import List

# ── автоустановка зависимостей ────────────────────────────────────────────────
BASE = Path(__file__).resolve().parent
REQ  = BASE / "requirements.txt"
MISSING = [m for m in ("flask", "requests") if importlib.util.find_spec(m) is None]
if MISSING:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", str(REQ)])

# ── CLI / переменные окружения ────────────────────────────────────────────────
def _jobs_arg() -> int:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("-j", "--jobs", type=int, help="parallel conversions (1‑6)")
    ns, _ = ap.parse_known_args()
    if ns.jobs is not None:
        return max(1, min(6, ns.jobs))
    env = os.getenv("ROUNDIFY_JOBS")
    return max(1, min(6, int(env))) if env and env.isdigit() else 1

MAX_JOBS = _jobs_arg()

# ── импорт после установки ────────────────────────────────────────────────────
from flask import (Flask, jsonify, render_template, request,  # type: ignore
                   send_from_directory, url_for)
import requests                                                # type: ignore

# ── пути и FFmpeg ─────────────────────────────────────────────────────────────
FFMPEG   = os.getenv("FFMPEG", "ffmpeg")
TMP_DIR  = Path(tempfile.gettempdir()) / "roundify_web"
TMP_DIR.mkdir(exist_ok=True)
SLOT_DIR = TMP_DIR / "slots"
SLOT_DIR.mkdir(exist_ok=True)

# ── кросс‑платформенная файловая блокировка ───────────────────────────────────
if platform.system() == "Windows":
    if importlib.util.find_spec("portalocker") is None:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "portalocker>=2"])
    import portalocker  # type: ignore

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
            try:
                yield
            finally:
                fcntl.flock(fh, fcntl.LOCK_UN)

class Busy(Exception):
    """Все слоты заняты."""

@contextmanager
def acquire_slot():
    """Пытается захватить один из файлов slot<i>.lock; всего MAX_JOBS штук."""
    for idx in range(MAX_JOBS):
        try:
            with _lock(SLOT_DIR / f"slot{idx}.lock"):
                yield
                return
        except Exception:  # занято, пробуем следующий
            continue
    raise Busy

# ── Flask‑приложение ──────────────────────────────────────────────────────────
app = Flask(__name__, template_folder="templates", static_folder="static")

# ── утилиты ───────────────────────────────────────────────────────────────────
def _run(cmd: List[str]) -> None:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr or r.stdout)

def _convert(src: Path, dst: Path, *, size: int, dur: int, off: int) -> None:
    vf = f"crop='min(iw\\,ih)':min(iw\\,ih),setsar=1,scale={size}:{size}"
    cmd = [FFMPEG, "-y", "-ss", str(off), "-i", str(src), "-t", str(dur),
           "-vf", vf,
           "-c:v", "libx264", "-profile:v", "baseline", "-level", "3.0",
           "-preset", "veryfast", "-crf", "23",
           "-pix_fmt", "yuv420p", "-movflags", "+faststart",
           "-c:a", "aac", "-b:a", "128k", str(dst)]
    _run(cmd)

def _send_note(token: str, chat: str, video: Path, *, length: int) -> None:
    url = f"https://api.telegram.org/bot{token}/sendVideoNote"
    with video.open("rb") as f:
        resp = requests.post(url, data={"chat_id": chat, "length": length},
                             files={"video_note": f}, timeout=45)
    if not resp.ok:
        raise RuntimeError(resp.text)

# ── маршруты ─────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html", jobs=MAX_JOBS)

@app.route("/api/convert", methods=["POST"])
def api_convert():
    try:
        with acquire_slot():          # критическая секция
            uploaded = request.files.get("video")
            if not uploaded:
                return jsonify(error="no file selected"), 400

            size = int(request.form.get("size", 640))
            dur  = int(request.form.get("duration", 60))
            off  = int(request.form.get("offset", 0))

            src = TMP_DIR / f"in_{uuid.uuid4().hex}"
            uploaded.save(src)
            out = TMP_DIR / f"{src.stem}_round.mp4"

            try:
                _convert(src, out, size=size, dur=dur, off=off)
            finally:
                src.unlink(missing_ok=True)

            tok, chat = request.form.get("token"), request.form.get("chat")
            sent = False
            if tok and chat:
                try:
                    _send_note(tok, chat, out, length=size)
                    sent = True
                except Exception as e:
                    return jsonify(download=url_for("download", filename=out.name),
                                   sent=False, error=str(e)), 500

            return jsonify(download=url_for("download", filename=out.name), sent=sent)

    except Busy:
        return jsonify(error="Server busy, try again later"), 429
    except Exception as e:
        return jsonify(error=str(e)), 500

@app.route("/download/<path:filename>")
def download(filename):
    return send_from_directory(TMP_DIR, filename, as_attachment=True)

@app.route("/ping")
def ping():
    return "pong"

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=True)
