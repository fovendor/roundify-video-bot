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
