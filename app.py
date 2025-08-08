#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations
import asyncio
import json
import logging
import logging.config
import logging.handlers
import os
import pathlib as pl
import sys
import tempfile
import uuid
from typing import Any, Dict

import aiofiles
import httpx
from fastapi import (
    FastAPI,
    File,
    HTTPException,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

LOGS_DIR = pl.Path("logs")
LOGS_DIR.mkdir(exist_ok=True)

LOGGING_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "console_formatter": {
            "()": "uvicorn.logging.DefaultFormatter",
            "fmt": "%(levelprefix)s %(asctime)s | %(message)s",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        },
        "file_formatter": {
            "format": "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        },
    },
    "handlers": {
        "console": {
            "formatter": "console_formatter",
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stderr",
        },
        "file": {
            "formatter": "file_formatter",
            "class": "logging.handlers.RotatingFileHandler",
            "filename": LOGS_DIR / "roundipy.log",
            "maxBytes": 10 * 1024 * 1024,  # 10 MB
            "backupCount": 3,
            "encoding": "utf8",
        },
    },
    "loggers": {
        # Наш кастомный логгер
        "roundipy": {"handlers": ["console", "file"], "level": "INFO", "propagate": False},
        # Логгеры Uvicorn
        "uvicorn": {"handlers": ["console", "file"], "level": "INFO", "propagate": False},
        "uvicorn.error": {"handlers": ["console", "file"], "level": "INFO", "propagate": False},
        "uvicorn.access": {"handlers": ["console", "file"], "level": "INFO", "propagate": False},
    },
}

logging.config.dictConfig(LOGGING_CONFIG)

# ───────────── settings ─────────────
WORKERS = int(os.getenv("ROUNDIPY_JOBS", 2))
ffmpeg_semaphore = asyncio.Semaphore(WORKERS)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")

MAX_CLIP_SECONDS = int(os.getenv("MAX_CLIP_SECONDS", 60))
MAX_UPLOAD_BYTES = 600 * 1024 * 1024  # 600 MB

TMP = pl.Path(tempfile.gettempdir()) / "roundipy_ws"
TMP.mkdir(exist_ok=True)

# ────────── FastAPI ──────────
app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

log = logging.getLogger("roundipy")

# ───────────── helpers ─────────────
async def ffprobe_meta(path: pl.Path) -> Dict[str, Any]:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-show_entries",
        "format=duration",
        "-print_format",
        "json",
        str(path),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {stderr.decode()}")
    meta = json.loads(stdout)
    return {
        "duration": float(meta["format"]["duration"]),
        "width": int(meta["streams"][0]["width"]),
        "height": int(meta["streams"][0]["height"]),
    }

def calc_video_bitrate(max_mb: int, clip_sec: float, audio_kbps: int = 128) -> int:
    if clip_sec <= 0:
        clip_sec = 1.0
    total_kbps = int(max_mb * 8192 / clip_sec)
    return max(200, total_kbps - audio_kbps)

async def send_to_telegram(path: pl.Path, chat: str) -> bool:
    if not TELEGRAM_BOT_TOKEN:
        log.error("Telegram token is not configured. Cannot send video note.")
        return False

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendVideoNote"
    try:
        async with aiofiles.open(path, "rb") as f:
            content = await f.read()

        async with httpx.AsyncClient(timeout=120) as client:
            files = {"video_note": (path.name, content, "video/mp4")}
            data = {"chat_id": chat}
            r = await client.post(url, data=data, files=files)

        if not r.is_success:
            log.warning("Telegram error %s – %s", r.status_code, r.text)
        return r.is_success
    except httpx.RequestError as e:
        log.error(f"Failed to send to Telegram: {e}")
        return False

# ────── FFmpeg background task ──────
async def run_ffmpeg_and_notify(
    websocket: WebSocket,
    job_id: str,
    src_path: pl.Path,
    dst_filename: str,
    opts: dict,
):
    dst_path = TMP / dst_filename

    try:
        if ffmpeg_semaphore.locked():
            waiters = getattr(ffmpeg_semaphore, "_waiters", None)
            position = len(waiters) + 1 if waiters else 1
            await websocket.send_json({"type": "queued", "job": job_id, "position": position})

        async with ffmpeg_semaphore:
            await websocket.send_json(
                {"type": "status_update", "job": job_id, "status": "Processing..."}
            )

            if not src_path.exists():
                raise FileNotFoundError(f"Source file for job {job_id} not found. It may have expired.")

            meta_w = opts['videoWidth']
            meta_h = opts['videoHeight']
            scale = opts.get('scale', 1.0)
            offset_x = opts.get('offsetX', 0.0)
            offset_y = opts.get('offsetY', 0.0)
            preview_w = opts.get('previewWidth', meta_w)
            
            crop_size = min(meta_w, meta_h) / scale

            pixel_ratio = min(meta_w, meta_h) / preview_w
            offset_x_src = offset_x * pixel_ratio
            offset_y_src = offset_y * pixel_ratio

            crop_x = (meta_w - crop_size) / 2 - offset_x_src
            crop_y = (meta_h - crop_size) / 2 - offset_y_src
            
            vb = calc_video_bitrate(opts["max_mb"], opts["clip_sec"])
            vf = (
                f"crop={crop_size}:{crop_size}:{crop_x}:{crop_y},"
                f"setsar=1,"
                f"scale={opts['size']}:{opts['size']}"
            )

            cmd = [
                "ffmpeg",
                "-y",
                "-ss",
                str(opts["offset"]),
                "-t",
                str(opts["clip_sec"]),
                "-i",
                str(src_path),
                "-vf",
                vf,
                "-c:v",
                "libx264",
                "-b:v",
                f"{vb}k",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-progress",
                "pipe:1",
                "-f",
                "mp4",
                str(dst_path),
            ]
            log.info(f"Job {job_id} FFmpeg command: {' '.join(cmd)}")

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            while proc.stdout and (line := await proc.stdout.readline()):
                if line.startswith(b"out_time_ms"):
                    try:
                        ms = int(line.split(b"=")[1]) // 1000
                        await websocket.send_json(
                            {"type": "progress", "job": job_id, "ms": ms}
                        )
                    except (ValueError, IndexError):
                        pass
            
            _, stderr_data = await proc.communicate()
            if proc.returncode != 0:
                error_output = stderr_data.decode('utf-8', 'ignore').strip()
                log.error(f"FFmpeg failed for job {job_id}:\n{error_output}")
                raise RuntimeError(f"FFmpeg failed. Error: {error_output.splitlines()[-1] if error_output else 'Unknown'}")

            await websocket.send_json(
                {"type": "status_update", "job": job_id, "status": "Finalizing..."}
            )

            tg_ok = False
            if opts.get("chat") and TELEGRAM_BOT_TOKEN:
                if dst_path.exists() and dst_path.stat().st_size > 0:
                    await websocket.send_json(
                        {
                            "type": "status_update",
                            "job": job_id,
                            "status": "Sending to Telegram...",
                        }
                    )
                    tg_ok = await send_to_telegram(dst_path, opts["chat"])

            await websocket.send_json(
                {
                    "type": "done",
                    "job": job_id,
                    "download": None,
                    "telegram": tg_ok,
                    "ttl": None,
                }
            )

    except Exception as e:
        log.error(f"Error in background task for job {job_id}: {e}", exc_info=True)
        try:
            await websocket.send_json(
                {
                    "type": "error",
                    "job": job_id,
                    "message": f"Unexpected error: {e}",
                }
            )
        except WebSocketDisconnect:
            pass
    finally:
        if src_path.exists():
            os.unlink(src_path)
        if dst_path.exists():
            os.unlink(dst_path)

# ───────────── routes ─────────────
@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(
        "index.html", {"request": request, "max_clip_seconds": MAX_CLIP_SECONDS}
    )

@app.post("/api/upload")
async def api_upload(request: Request, video: UploadFile = File(...)):
    cl = request.headers.get("content-length")
    if cl and int(cl) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413, detail=f"File too large. Limit is {MAX_UPLOAD_BYTES // 1048576} MB."
        )

    if not video or not video.filename:
        raise HTTPException(status_code=400, detail="file field missing")

    job_id = uuid.uuid4().hex
    suffix = pl.Path(video.filename).suffix
    tmp_in = TMP / f"in_{job_id}{suffix}"

    try:
        async with aiofiles.open(tmp_in, "wb") as f:
            while content := await video.read(1024 * 1024):
                await f.write(content)
        meta = await ffprobe_meta(tmp_in)
        size_mb = round(tmp_in.stat().st_size / 2**20, 2)
    except (RuntimeError, FileNotFoundError) as e:
        log.error(f"Failed to process upload {tmp_in}: {e}")
        if tmp_in.exists():
            os.unlink(tmp_in)
        raise HTTPException(status_code=400, detail="Invalid video file")

    return {
        "job_id": job_id,
        "duration": meta["duration"],
        "width": meta["width"],
        "height": meta["height"],
        "size_mb": size_mb,
    }

@app.websocket("/ws/{job_id}")
async def websocket_endpoint(websocket: WebSocket, job_id: str):
    await websocket.accept()
    log.info(f"WebSocket /ws/{job_id} [accepted]")
    try:
        tmp_in = next(TMP.glob(f"in_{job_id}*"), None)
        if not tmp_in:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "File not found for this job_id. Please upload again.",
                }
            )
            return

        data = await websocket.receive_json()
        if data.get("type") != "start_conversion":
            return

        opts = data.get("options", {})
        clip_duration = float(opts.get("clip_sec", 0))
        if not (1 <= clip_duration <= MAX_CLIP_SECONDS):
            await websocket.send_json(
                {
                    "type": "error",
                    "message": f"Duration must be between 1 and {MAX_CLIP_SECONDS} seconds.",
                }
            )
            return

        is_for_telegram = bool(opts.get("chat") and TELEGRAM_BOT_TOKEN)
        opts["max_mb"] = 8 if is_for_telegram else 100
        dst_filename = f"{tmp_in.stem}_round.mp4"

        asyncio.create_task(
            run_ffmpeg_and_notify(
                websocket=websocket,
                job_id=job_id,
                src_path=tmp_in,
                dst_filename=dst_filename,
                opts=opts,
            )
        )

        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        log.info(f"Client {job_id} disconnected.")
    except Exception as e:
        log.error(f"WebSocket Error for job {job_id}: {e}")

@app.get("/ping")
async def ping():
    return "pong"

def check_telegram_token():
    if not TELEGRAM_BOT_TOKEN:
        log.error("CRITICAL: TELEGRAM_BOT_TOKEN environment variable not set. Application will not start.")
        sys.exit(1)
    
    log.info("Validating Telegram token...")
    try:
        r = httpx.get(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getMe", timeout=10)
        if r.status_code == 200:
            bot_info = r.json().get("result", {})
            log.info(f"Telegram token is valid for bot: @{bot_info.get('username')}")
        else:
            log.error(f"CRITICAL: Telegram token is invalid. API response: {r.status_code} - {r.text}. Application will not start.")
            sys.exit(1)
    except httpx.RequestError as e:
        log.error(f"CRITICAL: Could not connect to Telegram API to validate token: {e}. Application will not start.")
        sys.exit(1)

@app.on_event("startup")
async def startup_event():
    check_telegram_token()