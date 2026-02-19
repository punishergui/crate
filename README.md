Crate minimal service for TrueNAS SCALE and Dockge

Files at repo root
- package.json
- server.js
- Dockerfile
- .dockerignore

Behavior
- Server listens on PORT env var and defaults to 4000
- Startup creates /app/data and creates /app/data/items.json if missing
- GET /health returns { "ok": true, "name": "crate", "ts": "<iso>" }
- GET / returns a small HTML page with running status and current timestamp
- GET /api/items returns item list
- POST /api/items with JSON body { "title": "..." } creates { id, title, createdAt }

Dockge compose service definition for /mnt/z1/docker/crate/compose.yml
```yaml
services:
  crate:
    container_name: crate
    build:
      context: /mnt/z1/docker/crate/app
      dockerfile: Dockerfile
    restart: unless-stopped
    ports:
      - "4010:4000"
    volumes:
      - /mnt/z1/docker/crate/data:/app/data
    environment:
      NODE_ENV: production
      PORT: 4000
```

Run checklist
```bash
docker compose build
docker compose up -d
curl http://10.0.10.10:4010/health
curl http://10.0.10.10:4010/api/items
```
