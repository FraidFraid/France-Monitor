FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    RADAR_STORAGE_DIR=/data \
    RADAR_PUBLIC_BASE_URL=http://localhost:8091 \
    ECCODES_DEFINITION_PATH=/app/eccodes-definitions:/MEMFS/definitions

RUN apt-get update \
    && apt-get install -y --no-install-recommends libeccodes0 libeccodes-data \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py radar_api.py bufr_decoder.py render.py models.py ./
COPY eccodes-definitions ./eccodes-definitions

RUN mkdir -p /data && chown -R 65532:65532 /data
USER 65532:65532

EXPOSE 8091
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8091"]
