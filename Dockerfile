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

ENV ROUNDIPY_JOBS=2
ENV TTL_SECONDS=60

EXPOSE 8000

### Изменено: включена поддержка proxy‑headers для правильного HTTPS‑URL в шаблонах
CMD ["gunicorn",
     "-k", "uvicorn.workers.UvicornWorker",
     "-b", "0.0.0.0:8000",
     "--proxy-headers",
     "--forwarded-allow-ips=127.0.0.1",
     "app:app"]
