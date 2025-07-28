# Roundify‑Web

**Roundify‑Web** is a lightweight Flask service that converts any video into a circular “video note” ready to be sent to Telegram. Upload a file in your browser, press **Convert**, and download a square MP4 (or let the app post it straight to a chat).

---

## Tech Stack

| Layer            | Technology                                    |
| ---------------- | --------------------------------------------- |
| Backend          | Python 3 · Flask · Gunicorn                   |
| Video processing | **FFmpeg** (you must have it in `$PATH`)      |
| Front‑end        | HTML 5 · vanilla JS · CSS                     |
| Deployment       | Runs on Linux/macOS/Windows · Docker‑friendly |

---

## Installation (local)

1. **Prerequisite:** FFmpeg in `$PATH` (`ffmpeg -version`).
2. Clone the repo and move into it:

   ```
   git clone https://github.com/<you>/roundify-video-bot.git
   cd roundify-video-bot
   ```
3. Install Python deps (they will auto‑install on first run, but explicit is clearer):

   ```
   python -m pip install -r requirements.txt
   ```
4. Run the server:

   * **Development:** `python app.py` → [http://localhost:8000](http://localhost:8000)
   * **Production (local):** `gunicorn -b 0.0.0.0:8000 app:app`

---

## Configuration

| Setting                 | Default  | Meaning                                   |
| ----------------------- | -------- | ----------------------------------------- |
| `-j <N>` / `--jobs <N>` | `1`      | Max parallel conversions (1 – 6)          |
| `ROUNDIFY_JOBS` (env)   | —        | Same as above; CLI flag overrides env‑var |
| `FFMPEG` (env)          | `ffmpeg` | Path to the FFmpeg binary                 |
| `PORT` (env)            | `8000`   | Port for `python app.py`                  |

Example:

```
python app.py --jobs 3
# or
ROUNDIFY_JOBS=3 FFMPEG=/usr/local/bin/ffmpeg gunicorn -b 0.0.0.0:8000 app:app
```

---

## Usage

1. Open the server URL.
2. Select a video (any format FFmpeg understands).
3. Optionally set

   * *diameter* (240 – 1024 px);
   * *duration* (1 – 60 s) and *offset*;
   * *Bot Token* and *Chat ID* if you want the video note sent automatically.
4. Click **Convert**. After processing a **Download** link appears — the file is saved as
   `<original_name>_round.mp4`.

---

## Where files live

During processing, the app creates a folder `roundify_web` inside the system temp directory:

```
/tmp/roundify_web/           # Linux & macOS
%TEMP%\roundify_web\         # Windows
```

| File                     | Lifecycle                                                    |
| ------------------------ | ------------------------------------------------------------ |
| `in_<uuid>` (raw upload) | Deleted immediately after conversion                         |
| `<uuid>_round.mp4`       | Kept until the user downloads it **or** the OS purges `/tmp` |

If *Bot Token* & *Chat ID* are supplied, the finished video is also posted via
Telegram Bot API (`sendVideoNote`) before it is offered for download.

---

## Mini‑API

| Method | URL                    | Purpose                             |
| ------ | ---------------------- | ----------------------------------- |
| `GET`  | `/`                    | Upload form                         |
| `POST` | `/api/convert`         | Accepts file & params, returns JSON |
| `GET`  | `/download/<filename>` | Serves the converted MP4            |
| `GET`  | `/ping`                | Health‑check (`pong`)               |

---

## Scaling: job semaphore

Roundify‑Web enforces a **job semaphore** implemented by lock files.
Set `--jobs`/`ROUNDIFY_JOBS` to 1…6; if all slots are busy the server replies **HTTP 429**.

---

## Production Deployment Options

### 1 · Docker (recommended — avoids polluting the host)

**Dockerfile (multi‑stage):**

```Dockerfile
FROM python:3.12-slim AS build
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.12-slim
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /usr/local/lib/python*/site-packages /usr/local/lib/python*/site-packages
COPY . .
EXPOSE 8000
ENV ROUNDIFY_JOBS=3
CMD ["gunicorn", "-b", "0.0.0.0:8000", "app:app"]
```

Build & run:

```
docker build -t roundify-web .
docker run -d --name roundify \
           -p 8000:8000 \
           -e ROUNDIFY_JOBS=3 \
           roundify-web
```

*Pros:* totally self‑contained; upgrade/rollback is one `docker pull`.
*Cons:* need Docker daemon (≈ 100 MB extra disk).

---

### 2 · Systemd service inside a Python **virtual env**

1. Create a dedicated system user, e.g. `roundify`.

2. Place project in `/opt/roundify-web`.

3. Create venv:

   ```
   python3 -m venv /opt/roundify-web/venv
   /opt/roundify-web/venv/bin/pip install -r /opt/roundify-web/requirements.txt
   ```

4. Install FFmpeg via package manager (`apt install ffmpeg`).

5. **systemd unit** (`/etc/systemd/system/roundify.service`):

   ```
   [Unit]
   Description=Roundify‑Web video‑note converter
   After=network.target

   [Service]
   User=roundify
   WorkingDirectory=/opt/roundify-web
   Environment=ROUNDIFY_JOBS=2
   ExecStart=/opt/roundify-web/venv/bin/gunicorn -b 0.0.0.0:8000 app:app
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```

6. `sudo systemctl daemon-reload && sudo systemctl enable --now roundify.service`.

*Pros:* no global Python packages; minimal footprint.
*Cons:* host still needs FFmpeg package; manual updates (`git pull && pip install`).

---

## License

MIT. FFmpeg is distributed under its own LGPL/GPL terms.
