# Roundify-Web

**Roundify-Web** is a lightweight Flask service that turns any video into a Telegram-style circular *video note*.
Upload a clip in your browser, press **Convert**, and download a square MP4—or let the app post it straight to a chat.

---

## Tech stack

| Layer            | Technology                                 |
| ---------------- | ------------------------------------------ |
| Backend          | Python 3 · Flask · Gunicorn                |
| Video processing | **FFmpeg** (must be on `$PATH`)            |
| Front-end        | HTML 5 · vanilla JS · CSS                  |
| Deploy           | Runs on Linux/macOS/Windows · Docker-ready |

---

## Quick install (virtual env)

```bash
# system prerequisites
sudo apt-get install ffmpeg python3-venv

# project
git clone https://github.com/yourname/roundify-video-bot.git
cd roundify-video-bot
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# run (1 job, 60-second TTL)
python app.py
```

*Systemd sample* (`/etc/systemd/system/roundify.service`):

```
[Unit]
Description=Roundify Web
After=network.target

[Service]
User=roundify
WorkingDirectory=/opt/roundify
ExecStart=/opt/roundify/venv/bin/gunicorn \
          -b 0.0.0.0:8000 app:app \
          --worker-tmp-dir /dev/shm
Environment=ROUNDIFY_JOBS=2
Environment=TTL_SECONDS=45
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

---

## Or run in Docker

Create `Dockerfile` in the repo root:

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
ENV ROUNDIFY_JOBS=3
ENV TTL_SECONDS=60
EXPOSE 8000
CMD ["gunicorn", "-b", "0.0.0.0:8000", "app:app", "--worker-tmp-dir", "/dev/shm"]
```

Build & run:

```bash
docker build -t roundify-web .
docker run -d --name roundify \
           -p 8000:8000 \
           -e ROUNDIFY_JOBS=3 \
           -e TTL_SECONDS=45 \
           roundify-web
```

Add Nginx (or Caddy, Traefik) in front for HTTPS; proxy → `roundify:8000`, set `client_max_body_size` as needed.

---

## Configuration

| Option (CLI)   | Env-var         | Range / default      | Meaning                                                |
| -------------- | --------------- | -------------------- | ------------------------------------------------------ |
| `-j, --jobs`   | `ROUNDIFY_JOBS` | **1-6** · *1*        | Parallel conversions (semaphore)                       |
| `-e, --expire` | `TTL_SECONDS`   | **1-300** s · *60* s | How long the finished MP4 is kept before auto-deletion |
| —              | `FFMPEG`        | path                 | FFmpeg binary if not in `$PATH`                        |
| —              | `PORT`          | 8000                 | Port for `python app.py`                               |

Examples:

```bash
# 2 jobs, each result auto-removed after 90 s
python app.py -j 2 -e 90

# same inside Docker / systemd
ROUNDIFY_JOBS=2 TTL_SECONDS=90 gunicorn -b 0.0.0.0:8000 app:app
```

---

## How it works

* **Semaphore** — only *JOBS* conversions run in parallel; extras get **HTTP 429**.
* **Auto-cleanup** — every output file is scheduled for deletion after *TTL* seconds;
  a countdown appears on the page.
* **Telegram mode** — if *Bot Token* + *Chat ID* are provided, the video note is sent
  first, then kept locally for *TTL* seconds in case you still want to download it.

---

## Usage

1. Open the server URL.
2. Pick a video; set diameter, duration/offset if desired.
3. Optionally fill **Bot Token** & **Chat ID**.
4. Press **Convert**. After processing you’ll see:

   * a **Download** link, plus a live timer (file removed at 0 s);
   * or “Sent to Telegram” (same timer, file auto-deleted).

---

## Mini API

| Method | URL                    | Purpose                            |
| ------ | ---------------------- | ---------------------------------- |
| GET    | `/`                    | Upload form                        |
| POST   | `/api/convert`         | Accepts video; returns JSON        |
| GET    | `/download/<filename>` | Serves the MP4 (until TTL expires) |
| GET    | `/ping`                | Health-check (`pong`)              |

---

## License

MIT. FFmpeg is distributed under its own LGPL/GPL terms.
