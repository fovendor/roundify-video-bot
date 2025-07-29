### build stage
FROM python:3.11-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

### runtime stage
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /usr/local /usr/local
COPY . .

ENV ROUNDIFY_JOBS=3
ENV TTL_SECONDS=60
# ← один eventlet‑воркер, без --preload
ENV GUNICORN_CMD_ARGS="--worker-tmp-dir /dev/shm --workers 1 --timeout 300"

EXPOSE 8000
CMD ["gunicorn","-k","eventlet","-b","0.0.0.0:8000","app:app"]
