FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8090

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY api.py ./api.py
COPY artifacts ./artifacts

EXPOSE 8090

CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT}"]
