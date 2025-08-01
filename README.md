# RoundiPy

**Roundipy** is a web service that converts any video into a perfect circular Telegram Video Note. The conversion process features a real-time progress bar via WebSocket, and the result can be instantly sent to Telegram.

▶ **Live Demo:** [https://roundipy.ether-memory.com](https://roundipy.ether-memory.com)

## Key Features

- 💿 **Perfect Crop:** Video is automatically cropped to a square and scaled to the desired resolution (240-1024px).
- 📊 **Integrated Progress Bar:** Track the conversion process in real-time with a satisfying text "fill" effect.
- ⏱️ **Flexible Settings:** Easily adjust the duration and start offset for the clip you want to create.
- 🤖 **Telegram Integration:** Provide a bot token and chat ID, and the finished video note will be sent directly to Telegram.
- 🗑️ **Auto-Cleanup:** Every generated file lives on the server for `TTL_SECONDS` (default is 60), after which it is automatically deleted.
- ⚙️ **Parallel Tasks:** The service can process multiple videos simultaneously (the number of workers is configurable).

## Architecture

The video processing flow is split into several stages for a better, more responsive UI.

```mermaid
sequenceDiagram
    participant Client
    participant Server as Server (FastAPI)
    participant FFmpeg as FFmpeg Task (Background)

    Client->>+Server: (1) POST /api/upload (file)
    Server->>-Client: (2) Response: {job_id, meta}
    Client->>+Server: (3) WebSocket /ws/{job_id}
    Server-->>-Client: WebSocket Connected
    Client->>Server: (4) WS Message: {type: "start_conversion", ...}
    Server->>+FFmpeg: (5) Starts background task
    loop During conversion
        FFmpeg-->>Server: (6) Progress (pipe)
        Server-->>Client: (7) WS Message: {type: "progress", ...}
    end
    FFmpeg-->>-Server: (8) Conversion complete
    Server-->>Client: (9) WS Message: {type: "done", ...}
```

## Deployment

### Quick Start (Local)

```bash
# Install dependencies
sudo apt-get install ffmpeg python3-venv

# Clone and run
git clone https://github.com/yourname/roundipy-video-bot.git
cd roundipy-video-bot
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000

# Open http://localhost:8000 in your browser
```

### Docker Compose Deployment (Recommended)

This is the easiest and most reliable way to run the service in production.

**1. `docker-compose.yml`**

Create this file in the project root. This example includes advanced network settings to assign a static IP to the container, which can be useful in complex setups.

```yml
services:
  roundipy:
    build: .
    image: roundipy-img
    container_name: roundipy
    restart: unless-stopped
    environment:
      # Number of concurrent FFmpeg processes
      ROUNDIFY_JOBS: 2
      # Lifetime of the finished file in seconds
      TTL_SECONDS: 60
      # Maximum clip duration (Telegram's limit)
      MAX_CLIP_SECONDS: 60
    ports:
      # The service will only be available locally on port 8000
      - "127.0.0.1:8000:8000"
    volumes:
      - ./static:/static
    # -------------------------
    networks:
      roundipy_net:
        ipv4_address: 10.77.0.10

networks:
  roundipy_net:
    driver: bridge
    ipam:
      config:
        - subnet: 10.77.0.0/24
```

**2. Build and Launch**

```bash
# One-time image build
docker compose build

# Start the container in the background
docker compose up -d
```

**3. View Logs**

```bash
docker compose logs -f roundipy
```

**4. Upgrade**

```bash
# Get the latest code
git pull

# Rebuild the image, pulling in the changes
docker compose build --pull

# Restart the container with the new version
docker compose up -d
```

### Nginx Reverse Proxy Setup

To make your service available on the internet with a domain name and SSL certificate.

Example configuration for `/etc/nginx/sites-available/roundipy`:

```nginx
server {
    server_name roundipy.example.com;
    client_max_body_size 600M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";

        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
    }

    listen 443 ssl;                                   # managed by Certbot
    ssl_certificate     /etc/letsencrypt/live/roundipy.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/roundipy.example.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if ($host = roundipy.example.com) {
        return 301 https://$host$request_uri;
    }
    listen 80;
    server_name roundipy.example.com;
    return 404;                                       # managed by Certbot
}
```

## API and Request Lifecycle

| Method | Path | Description |
| --- | --- | --- |
| GET | / | Serves the main page. |
| POST | /api/upload | **Step 1:** Accepts a video, saves it, returns metadata (duration, resolution) and a `job_id`. |
| WS | /ws/{job_id} | **Step 2:** Establishes a WebSocket connection. The client sends a `start_conversion` message with options to begin the conversion. The server sends real-time events: `queued`, `progress`, `done`, `error`. |
| GET | /download/{filename} | Allows downloading the finished file before its TTL expires. |
| GET | /ping | Health check, responds with `pong`. |

## Environment Variables

| Name | Default | Purpose |
| --- | --- | --- |
| `ROUNDIPY_JOBS` | 2 | Number of concurrent conversion jobs. |
| `TTL_SECONDS` | 60 | Lifetime of the finished file and its download link. |
| `MAX_CLIP_SECONDS` | 60 | Maximum duration of the final clip (Telegram's limit). |

## License

- MIT.
- FFmpeg is distributed under the LGPL/GPL license.
