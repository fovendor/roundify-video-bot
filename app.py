#!/usr/bin/env python3

from __future__ import annotations
import json
import logging
import os
import pathlib as pl
import subprocess
import tempfile
import threading
import time
import uuid
from typing import Any, Dict
from concurrent.futures import ThreadPoolExecutor

import requests
from flask import (Flask, jsonify, render_template, request,
                   send_from_directory, url_for)
from flask_socketio import SocketIO, emit, join_room, leave_room

# ─────────────── settings ───────────────
WORKERS = int(os.getenv("ROUNDIFY_JOBS", 2))
TTL_SECONDS = int(os.getenv("TTL_SECONDS", 60))
MAX_CLIP_SECONDS = int(os.getenv("MAX_CLIP_SECONDS", 60))
executor = ThreadPoolExecutor(max_workers=WORKERS)
TMP = pl.Path(tempfile.gettempdir()) / "roundify_ws"
TMP.mkdir(exist_ok=True)

# ────────── Flask / Socket.IO ───────────
app = Flask(__name__, static_folder="static", template_folder="templates")
socketio = SocketIO(app, cors_allowed_origins="*")

log = logging.getLogger("roundify")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# ───────────── helpers ──────────────────
def ffprobe_meta(path: pl.Path) -> Dict[str, Any]:
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-show_entries", "format=duration",
        "-print_format", "json", str(path)
    ]
    meta = json.loads(subprocess.check_output(cmd))
    return {
        "duration": float(meta["format"]["duration"]),
        "width": int(meta["streams"][0]["width"]),
        "height": int(meta["streams"][0]["height"])
    }

def calc_video_bitrate(max_mb: int, clip_sec: float, audio_kbps: int = 128) -> int:
    if clip_sec <= 0:
        clip_sec = 1.0
    total_kbps = int(max_mb * 8192 / clip_sec)
    return max(200, total_kbps - audio_kbps)

# ───────── Telegram ──────────
def send_to_telegram(path: pl.Path, token: str, chat: str) -> bool:
    url = f"https://api.telegram.org/bot{token}/sendVideoNote"
    try:
        with path.open("rb") as f:
            r = requests.post(url, data={"chat_id": chat}, files={"video_note": f}, timeout=120)
        if not r.ok:
            log.warning("Telegram error %s – %s", r.status_code, r.text)
        return r.ok
    except requests.RequestException as e:
        log.error(f"Failed to send to Telegram: {e}")
        return False

# ───────── FFmpeg Background Task ─────
def run_ffmpeg_and_notify(job_id: str, src_path_str: str, dst_filename: str, download_url: str, opts: dict):
    socketio.emit("status_update", {"job": job_id, "status": "Обработка..."}, to=job_id)
    src_path = pl.Path(src_path_str)
    dst_path = TMP / dst_filename

    try:
        vb = calc_video_bitrate(opts["max_mb"], opts["clip_sec"])
        vf = f"crop='min(iw\\,ih)':min(iw\\,ih),setsar=1,scale={opts['size']}:{opts['size']}"

        cmd = [
            "ffmpeg", "-y", "-ss", str(opts["offset"]), "-t", str(opts["clip_sec"]),
            "-i", str(src_path), "-vf", vf, "-c:v", "libx264", "-b:v", f"{vb}k",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac",
            "-b:a", "128k", "-progress", "pipe:1", "-f", "mp4", str(dst_path)
        ]

        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding='utf-8')

        for line in proc.stdout:
            if line.startswith("out_time_ms"):
                try:
                    ms = int(line.strip().split("=")[1]) // 1000
                    socketio.emit("progress", {"job": job_id, "ms": ms}, to=job_id)
                except (ValueError, IndexError):
                    continue
        proc.wait()

        socketio.emit("status_update", {"job": job_id, "status": "Финализация..."}, to=job_id)

        tg_ok = False
        if opts.get("token") and opts.get("chat"):
            if dst_path.exists() and dst_path.stat().st_size > 0:
                socketio.emit("status_update", {"job": job_id, "status": "Отправка в Telegram..."}, to=job_id)
                tg_ok = send_to_telegram(dst_path, opts["token"], opts["chat"])

        socketio.emit("done", {
            "job": job_id,
            "download": download_url,
            "telegram": tg_ok,
            "ttl": TTL_SECONDS
        }, to=job_id)

    except Exception as e:
        log.error(f"Error in background task for job {job_id}: {e}")
        socketio.emit("status_update", {"job": job_id, "status": "Ошибка во время конвертации."}, to=job_id)

    finally:
        if src_path.exists():
            src_path.unlink()

# ───────────── routes ───────────────────
@app.route("/")
def index():
    return render_template("index.html", max_clip_seconds=MAX_CLIP_SECONDS)

@app.post("/api/upload")
def api_upload():
    up = request.files.get("video")
    if not up or not up.filename:
        return jsonify(error="file field missing"), 400

    job_id = uuid.uuid4().hex
    tmp_in = TMP / f"in_{job_id}{pl.Path(up.filename).suffix}"
    up.save(tmp_in)

    try:
        meta = ffprobe_meta(tmp_in)
        size_mb = round(tmp_in.stat().st_size / 2**20, 2)
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        log.error(f"Failed to get metadata for {tmp_in}: {e}")
        tmp_in.unlink(missing_ok=True)
        return jsonify(error="Invalid video file"), 400

    return jsonify(job_id=job_id, duration=meta["duration"], width=meta["width"], height=meta["height"], size_mb=size_mb)

@app.post("/api/convert")
def api_convert():
    job_id = request.form.get("job_id")
    clip_duration = float(request.form.get("duration", 0))

    if clip_duration > MAX_CLIP_SECONDS:
        return jsonify(error=f"Duration cannot exceed {MAX_CLIP_SECONDS} seconds."), 400
    if not job_id:
        return jsonify(error="job_id missing"), 400

    try:
        tmp_in = next(TMP.glob(f"in_{job_id}*"))
    except StopIteration:
        return jsonify(error="Original file not found for this job_id"), 404

    is_for_telegram = bool(request.form.get("token") and request.form.get("chat"))
    opts = {
        "size": int(request.form.get("size", 640)),
        "offset": float(request.form.get("offset", 0)),
        "clip_sec": clip_duration,
        "max_mb": 8 if is_for_telegram else 100,
        "token": request.form.get("token"),
        "chat": request.form.get("chat"),
    }
    
    dst_filename = f"{tmp_in.stem}_round.mp4"
    download_url = url_for('download', filename=dst_filename, _external=True)

    executor.submit(
        run_ffmpeg_and_notify,
        job_id=job_id,
        src_path_str=str(tmp_in),
        dst_filename=dst_filename,
        download_url=download_url,
        opts=opts
    )

    socketio.emit("status_update", {"job": job_id, "status": "В очереди..."}, to=job_id)
    return jsonify(status="ok", message="Conversion queued")

@socketio.on("join")
def on_join(data):
    join_room(data["job"])

@socketio.on("leave")
def on_leave(data):
    leave_room(data["job"])

@app.get("/download/<path:filename>")
def download(filename):
    return send_from_directory(TMP, filename, as_attachment=True, max_age=TTL_SECONDS)

@app.get("/ping")
def ping():
    return "pong"

def janitor():
    while True:
        now = time.time()
        try:
            for p in TMP.iterdir():
                if p.is_file() and p.stat().st_mtime < now - TTL_SECONDS:
                    p.unlink(missing_ok=True)
        except Exception as e:
            log.error(f"Janitor error: {e}")
        time.sleep(max(TTL_SECONDS, 60))

janitor_thread = threading.Thread(target=janitor, daemon=True)
janitor_thread.start()