# Roundify‑Web

**Roundify‑Web** is a small Flask service that turns any video into a Telegram‑style circular *video note*.
Upload a file in your browser, hit **Convert**, and download the square MP4 — or have the app send it straight to a chat.

---

## Features

* ⭕  Auto‑crop to a perfect circle (square frame, aspect‑correct).
* ⚙️  Adjustable diameter (240–1024 px), clip length, and start offset.
* 🤖  Optional **Bot Token** + **Chat ID** → posts result to Telegram.
* ⏳  Each result is kept for *TTL* seconds (default 60 s) and then auto‑deleted; a countdown is shown on the page.
* 🔒  Semaphore limits the number of simultaneous conversions (default 1, configurable 1‑6).
* 🧩  Simple REST mini‑API (`/api/convert`, `/download/<file>`, `/ping`).

---

## Quick Local Run (without Docker)

```bash
# prerequisites
sudo apt‑get install ffmpeg python3‑venv

# clone & install
git clone https://github.com/yourname/roundify-video-bot.git
cd roundify-video-bot
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# run: 2 parallel jobs, each result kept 90 s
python app.py -j 2 -e 90
#   or production‑style
gunicorn -b 0.0.0.0:8000 app:app --worker-tmp-dir /dev/shm
```

Open [http://localhost:8000](http://localhost:8000) in your browser.

---

## Docker Deployment (recommended)

**Dockerfile** (place in repo root):

```
### build
FROM python:3.12-slim AS build
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

### runtime
FROM python:3.12-slim
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /usr/local /usr/local
COPY . .
ENV ROUNDIFY_JOBS=3
ENV TTL_SECONDS=60
EXPOSE 8000
CMD ["gunicorn","-b","0.0.0.0:8000","app:app","--worker-tmp-dir","/dev/shm"]
```

Build & run:

```bash
docker build -t roundify-web .
docker run -d --name roundify \
  -p 127.0.0.1:8000:8000 \
  -e ROUNDIFY_JOBS=2 \
  -e TTL_SECONDS=90 \
  --restart unless-stopped \
  roundify-web
curl http://127.0.0.1:8000/ping   # → pong
```

---

## Production Behind NGINX + HTTPS

```bash
sudo apt-get install nginx python3-certbot-nginx
```

Basic config `/etc/nginx/sites-available/roundify`:

```
server {
    listen 80;
    server_name example.com;
    client_max_body_size 200M;

    location / {
        proxy_pass         http://127.0.0.1:8000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering    off;
    }
}
```

Enable and reload nginx:

```bash
sudo ln -s /etc/nginx/sites-available/roundify /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Enable HTTPS:

```bash
sudo certbot --nginx -d example.com
```

Now open [https://example.com](https://example.com) to access the service securely.

---

## Configuration Flags / Variables

* `-j`, `--jobs` / `ROUNDIFY_JOBS`: number of parallel conversions (1–6, default 1)
* `-e`, `--expire` / `TTL_SECONDS`: time to keep each result (1–300 s, default 60)
* `FFMPEG`: custom path to `ffmpeg` binary
* `PORT`: port for `python app.py` (for local use)

---

## API Endpoints

* **GET /** – main upload form
* **POST /api/convert** – accepts video, returns `{download, expires_in, sent}`
* **GET /download/<filename>** – serves file (until TTL expiry)
* **GET /ping** – returns `pong`

---

## Updating in Production

```bash
cd /opt/roundify
git pull
docker build -t roundify-web .
docker stop roundify && docker rm roundify
docker run -d --name roundify \
  -p 127.0.0.1:8000:8000 \
  --restart unless-stopped \
  roundify-web
sudo systemctl reload nginx   # only if nginx config changed
```

---

## License

MIT. FFmpeg is provided under its own LGPL/GPL terms.