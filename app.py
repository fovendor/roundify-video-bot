#!/usr/bin/env python3
"""
Roundify-WS — video-to-circle converter with real-time WebSocket progress
и авто-отправкой в Telegram + авто-TTL-очисткой.
"""
from __future__ import annotations
import json, os, subprocess, tempfile, uuid, pathlib as pl, time, threading, logging
from concurrent.futures import ProcessPoolExecutor
from typing import Optional

import requests
from flask import (Flask, jsonify, request, send_from_directory,
                   url_for, render_template)
from flask_socketio import SocketIO, emit, join_room, leave_room

# ─────────────── settings ───────────────
WORKERS     = int(os.getenv("ROUNDIFY_JOBS", 2))
TTL_SECONDS = int(os.getenv("TTL_SECONDS", 60))
TMP         = pl.Path(tempfile.gettempdir()) / "roundify_ws"
TMP.mkdir(exist_ok=True)

# ────────── Flask / Socket.IO ───────────
app = Flask(__name__, static_folder="static", template_folder="templates")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

EXECUTOR = ProcessPoolExecutor(max_workers=WORKERS)
log      = logging.getLogger("roundify")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# ───────────── helpers ──────────────────
def ffprobe_meta(path: pl.Path) -> dict[str, float | int]:
    """Быстро вытащить длительность и разрешение видео."""
    cmd = ["ffprobe", "-v", "error", "-select_streams", "v:0",
           "-show_entries", "stream=width,height", "-show_entries", "format=duration",
           "-print_format", "json", str(path)]
    meta = json.loads(subprocess.check_output(cmd))
    return {
        "duration": float(meta["format"]["duration"]),
        "width":    int(meta["streams"][0]["width"]),
        "height":   int(meta["streams"][0]["height"])
    }

def calc_video_bitrate(max_mb: int, clip_sec: int, audio_kbps: int = 128) -> int:
    total_kbps = max_mb * 8192 // clip_sec
    return max(200, total_kbps - audio_kbps)

# ───────── Telegram ──────────
def send_to_telegram(path: pl.Path, token: str, chat: str) -> bool:
    url = f"https://api.telegram.org/bot{token}/sendVideoNote"
    with path.open("rb") as f:
        r = requests.post(url, data={"chat_id": chat, "supports_streaming": "true"}, files={"video_note": f}, timeout=120)
    if not r.ok:
        log.warning("Telegram error %s – %s", r.status_code, r.text)
    return r.ok

# ───────── FFmpeg Worker ─────
def run_ffmpeg(job_id: str, src: str, opts: dict):
    src = pl.Path(src)
    # Метаданные уже отправлены на фронт
    meta = ffprobe_meta(src)
    socketio.emit("metadata", {**meta, "size_mb": round(src.stat().st_size / 2**20, 2), "job": job_id}, to=job_id)

    vb  = calc_video_bitrate(opts["max_mb"], opts["clip_sec"])
    dst = TMP / f"{src.stem}_round.mp4"
    vf  = (f"crop='min(iw\\,ih)':min(iw\\,ih),setsar=1,"
           f"scale={opts['size']}:{opts['size']}")

    cmd = ["ffmpeg", "-y",
           "-ss", str(opts["offset"]),
           "-t",  str(opts["clip_sec"]),
           "-i",  str(src),
           "-vf", vf,
           "-c:v", "libx264", "-b:v", f"{vb}k",
           "-pix_fmt", "yuv420p", "-movflags", "+faststart",
           "-c:a", "aac", "-b:a", "128k",
           "-progress", "pipe:1", "-f", "mp4", str(dst)]

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, text=True, encoding='utf-8')

    for line in proc.stdout:
        if line.startswith("out_time_ms"):
            try:
                # ИЗМЕНЕНИЕ: Конвертируем микросекунды в миллисекунды
                ms = int(line.strip().split("=")[1]) // 1000
                socketio.emit("progress", {"job": job_id, "ms": ms}, to=job_id)
            except (ValueError, IndexError):
                continue
        elif line.strip() == "progress=end":
            break
    proc.wait()

    socketio.emit("status_update", {"job": job_id, "status": "Finalizing..."}, to=job_id)

    tg_ok = False
    if opts.get("token") and opts.get("chat"):
        if dst.exists() and dst.stat().st_size > 0:
            socketio.emit("status_update", {"job": job_id, "status": "Sending to Telegram..."}, to=job_id)
            tg_ok = send_to_telegram(dst, opts["token"], opts["chat"])
        else:
            log.error(f"FFmpeg did not produce an output file for job {job_id}")
            socketio.emit("status_update", {"job": job_id, "status": "Error: FFmpeg failed"}, to=job_id)

    socketio.emit("done",
                  {"job": job_id,
                   "download": url_for('download', filename=dst.name, _external=True),
                   "telegram": tg_ok},
                  to=job_id)
    src.unlink(missing_ok=True)

# ───────────── routes ───────────────────
@app.route("/")
def index():
    return render_template("index.html")

@app.post("/api/upload")
def api_upload():
    up = request.files.get("video")
    if not up:
        return jsonify(error="file field missing"), 400

    job_id = uuid.uuid4().hex
    tmp_in = TMP / f"in_{job_id}_{up.filename}"
    up.save(tmp_in)

    try:
        meta = ffprobe_meta(tmp_in)
        size_mb = round(tmp_in.stat().st_size / 2**20, 2)
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        log.error(f"Failed to get metadata for {tmp_in}: {e}")
        tmp_in.unlink(missing_ok=True)
        return jsonify(error="Invalid video file"), 400

    return jsonify(
        job_id=job_id,
        duration=meta["duration"],
        width=meta["width"],
        height=meta["height"],
        size_mb=size_mb
    )

@app.post("/api/convert")
def api_convert():
    job_id = request.form.get("job_id")
    if not job_id:
        return jsonify(error="job_id missing"), 400

    # Находим исходный файл по job_id
    try:
        tmp_in = next(TMP.glob(f"in_{job_id}_*"))
    except StopIteration:
        return jsonify(error="Original file not found for this job_id"), 404

    is_for_telegram = bool(request.form.get("token") and request.form.get("chat"))

    opts = dict(
        size     = int(request.form.get("size", 640)),
        offset   = float(request.form.get("offset", 0)),
        clip_sec = float(request.form.get("duration", 60)),
        # Для кружочков в Telegram ставим безопасный лимит в 8МБ
        max_mb   = 8 if is_for_telegram else 100,
        token    = request.form.get("token"),
        chat     = request.form.get("chat"),
    )
    EXECUTOR.submit(run_ffmpeg, job_id, str(tmp_in), opts)
    return jsonify(status="ok", message="Conversion started")

@socketio.on("join")
def on_join(data):
    join_room(data["job"])

@socketio.on("leave")
def on_leave(data):
    leave_room(data["job"])

@app.get("/download/<path:filename>")
def download(filename):
    return send_from_directory(TMP, filename, as_attachment=True,
                               max_age=TTL_SECONDS)

@app.get("/ping")
def ping():
    return "pong"

# ────── background TTL janitor ──────
def janitor():
    while True:
        now = time.time()
        for p in TMP.iterdir():
            try:
                if p.stat().st_mtime < now - TTL_SECONDS:
                    p.unlink(missing_ok=True)
            except FileNotFoundError:
                pass
        # Пауза между чистками
        time.sleep(max(TTL_SECONDS, 60))


# Запуск фоновой задачи очистки
if os.getenv("GUNICORN_CMD_ARGS"):
    socketio.start_background_task(janitor)

# ─────────── dev runner ────────────────
if __name__ == "__main__":
    import eventlet
    eventlet.monkey_patch()
    # Запускаем чистильщика только в основном процессе, чтобы избежать дублирования
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true":
         threading.Thread(target=janitor, daemon=True).start()
    socketio.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))