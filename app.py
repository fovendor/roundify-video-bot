#!/usr/bin/env python3
"""
Roundify-WS — video-to-circle converter with WebSocket progress.

*   HTTP  POST /api/upload   → {job_id}
*   WS   /socket.io          → events: metadata, progress, done
*   GET  /download/<file>    → result mp4

Config via env:
  ROUNDIFY_JOBS   — workers in ProcessPoolExecutor   (default 2)
  TTL_SECONDS     — result life-time before delete   (default 60)
  PORT            — Flask port (dev)                 (default 8000)
  GUNICORN_CMD_ARGS is set in Dockerfile for prod.
"""
from __future__ import annotations
import json, os, subprocess, tempfile, uuid, pathlib as pl
from concurrent.futures import ProcessPoolExecutor
from flask import (Flask, jsonify, request, send_from_directory,
                   url_for, render_template)
from flask_socketio import SocketIO, emit, join_room, leave_room

# ───────────────────────────── settings ──────────────────────────────────────
WORKERS      = int(os.getenv("ROUNDIFY_JOBS", 2))
TTL_SECONDS  = int(os.getenv("TTL_SECONDS", 60))
TMP          = pl.Path(tempfile.gettempdir()) / "roundify_ws"
TMP.mkdir(exist_ok=True)

# ─────────────────────────── Flask / SocketIO ────────────────────────────────
app     = Flask(__name__, static_folder="static", template_folder="templates")
socketio = SocketIO(app, cors_allowed_origins="*")

EXECUTOR = ProcessPoolExecutor(max_workers=WORKERS)

# ─────────────────────────── helpers ─────────────────────────────────────────
def ffprobe_meta(path: pl.Path) -> dict:
    """Return duration, width, height via ffprobe (≈30 ms)."""
    cmd = ["ffprobe", "-v", "error", "-select_streams", "v:0",
           "-show_entries", "stream=width,height",
           "-show_entries", "format=duration",
           "-print_format", "json", str(path)]
    meta = json.loads(subprocess.check_output(cmd))
    return {
        "duration": float(meta["format"]["duration"]),
        "width":    int(meta["streams"][0]["width"]),
        "height":   int(meta["streams"][0]["height"])
    }

def calc_video_bitrate(max_mb: int, clip_sec: int,
                       audio_kbps: int = 128) -> int:
    """
    Return required video bitrate (kbit/s) to keep file ≤ max_mb.
    VB =  (MaxMiB * 8 * 1024) / seconds  –  AB
                                             ↓
                         audio bitrate (kbit/s)
    """
    total_kbps = max_mb * 8192 // clip_sec
    return max(200, total_kbps - audio_kbps)        # min 200 kbps

def run_ffmpeg(job_id: str, src: str, opts: dict):
    """Executed in worker process; emits WS events via SocketIO server."""
    src = pl.Path(src)
    meta = ffprobe_meta(src)
    socketio.emit("metadata", {**meta, "job": job_id}, to=job_id)

    vb = calc_video_bitrate(opts["max_mb"], opts["clip_sec"])
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
                            stderr=subprocess.DEVNULL, text=True)

    for line in proc.stdout:
        if line.startswith("out_time_ms"):
            ms = int(line.split("=")[1])
            socketio.emit("progress",
                          {"job": job_id, "ms": ms},
                          to=job_id)
        elif line.strip() == "progress=end":
            break
    proc.wait()

    socketio.emit("done",
                  {"job": job_id,
                   "download": url_for("download",
                                       filename=dst.name,
                                       _external=True)},
                  to=job_id)
    src.unlink(missing_ok=True)  # clean input

# ─────────────────────────── routes ──────────────────────────────────────────
@app.route("/")
def index(): return render_template("index.html")

@app.post("/api/upload")
def api_upload():
    up = request.files.get("video")
    if not up:
        return jsonify(error="file field missing"), 400

    job_id = uuid.uuid4().hex
    tmp_in = TMP / f"in_{job_id}"
    up.save(tmp_in)

    opts = dict(
        size      = int(request.form.get("size", 640)),
        offset    = int(request.form.get("offset", 0)),
        clip_sec  = int(request.form.get("duration", 60)),
        max_mb    = 48 if request.form.get("token") and request.form.get("chat")
                         else 100
    )
    EXECUTOR.submit(run_ffmpeg, job_id, str(tmp_in), opts)
    return jsonify(job_id=job_id)

@socketio.on("join")
def on_join(data): join_room(data["job"])

@socketio.on("leave")
def on_leave(data): leave_room(data["job"])

@app.get("/download/<path:filename>")
def download(filename):
    return send_from_directory(TMP, filename, as_attachment=True,
                               max_age=TTL_SECONDS)

@app.get("/ping")
def ping(): return "pong"

# ─────────────────────────── main (dev) ──────────────────────────────────────
if __name__ == "__main__":
    import eventlet; eventlet.monkey_patch()
    socketio.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
