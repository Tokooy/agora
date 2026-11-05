FROM node:22-alpine AS frontend-build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/data FRONTEND_DIST=/app/static
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home agora && mkdir /data && chown agora:agora /data
COPY backend/ /app/backend/
COPY --from=frontend-build /app/dist/ /app/static/
USER agora
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s CMD python -c "import urllib.request; [urllib.request.urlopen('http://127.0.0.1:8000'+p, timeout=2).read(1) for p in ('/','/api/health')]" || exit 1
CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
