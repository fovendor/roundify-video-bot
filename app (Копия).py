#!/usr/bin/env python3
"""Roundify-Web — Flask-сервер с автодоустановкой зависимостей."""
from __future__ import annotations
import importlib.util, os, subprocess, sys, tempfile, uuid
from pathlib import Path
from typing import List

BASE = Path(__file__).resolve().parent
REQ  = BASE / "requirements.txt"

# ── автомагия: ставим недостающие библиотеки ────────────────────────────────
NEEDED = {"flask": "flask", "requests": "requests", "gunicorn": "gunicorn"}
missing = [pkg for pkg, mod in NEEDED.items()
           if importlib.util.find_spec(mod) is None]
if missing:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", str(REQ)])

# ── теперь можно импортировать ───────────────────────────────────────────────
from flask import (Flask, jsonify, render_template, request,
                   send_from_directory, url_for)                        # type: ignore
import requests                                                       # type: ignore

FFMPEG   = os.getenv("FFMPEG", "ffmpeg")
TMP_DIR  = Path(tempfile.gettempdir()) / "roundify_web"
TMP_DIR.mkdir(exist_ok=True)

app = Flask(__name__,
            template_folder="templates",
            static_folder="static")    #  ← статика рядом с app.py
app.config["SECRET_KEY"] = "roundify-secret"

# ── вспомогательные функции ─────────────────────────────────────────────────
def _run(cmd: List[str]) -> None:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:  raise RuntimeError(r.stderr or r.stdout)

def _convert(src: Path, dst: Path, *, size: int, dur: int, off: int) -> None:
    vf = f"crop='min(iw\\,ih)':min(iw\\,ih),setsar=1,scale={size}:{size}"
    cmd = [FFMPEG, "-y", "-ss", str(off), "-i", str(src), "-t", str(dur),
           "-vf", vf,
           "-c:v", "libx264", "-profile:v", "baseline", "-level", "3.0",
           "-preset", "veryfast", "-crf", "23",
           "-pix_fmt", "yuv420p", "-movflags", "+faststart",
           "-c:a", "aac", "-b:a", "128k", str(dst)]
    _run(cmd)

def _send_note(tok: str, chat: str, video: Path, *, length: int) -> None:
    url = f"https://api.telegram.org/bot{tok}/sendVideoNote"
    with video.open("rb") as f:
        r = requests.post(url, data={"chat_id": chat, "length": length},
                          files={"video_note": f}, timeout=45)
    if not r.ok:  raise RuntimeError(r.text)

# ── маршруты ────────────────────────────────────────────────────────────────
@app.route("/")
def index():  return render_template("index.html")

@app.route("/api/convert", methods=["POST"])
def api_convert():
    f = request.files.get("video")
    if not f:  return jsonify(error="файл не выбран"), 400
    size = int(request.form.get("size",      640))
    dur  = int(request.form.get("duration",   60))
    off  = int(request.form.get("offset",      0))

    src = TMP_DIR / f"in_{uuid.uuid4().hex}"
    f.save(src)
    out = TMP_DIR / (src.stem + "_round.mp4")

    try:        _convert(src, out, size=size, dur=dur, off=off)
    except Exception as e:
        src.unlink(missing_ok=True)
        return jsonify(error=str(e)), 500
    finally:    src.unlink(missing_ok=True)

    sent = False
    tok, chat = request.form.get("token"), request.form.get("chat")
    if tok and chat:
        try:    _send_note(tok, chat, out, length=size);  sent = True
        except Exception as e:
            return jsonify(download=url_for("download", filename=out.name),
                           sent=False, error=str(e))

    return jsonify(download=url_for("download", filename=out.name), sent=sent)

@app.route("/download/<path:filename>")
def download(filename):  return send_from_directory(TMP_DIR, filename, as_attachment=True)

@app.route("/ping")  # Health-check
def ping():  return "pong"

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=8000)
