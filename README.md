CRATE single-container app for TrueNAS SCALE + Dockge

Architecture
- Fastify server in `server/` serves API and static web from `/app/dist`
- React PWA in `web/` is built at image build time
- SQLite database at `/data/crate.sqlite`
- Music library is read-only mount at `/music`

Local scripts
- `npm run dev` starts Vite dev server and API server
- `npm run build` builds web assets
- `npm start` runs Fastify server

API highlights
- `GET /health`
- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/stats`
- `POST /api/scan/start`
- `GET /api/scan/status`
- `POST /api/scan/cancel`
- `GET /api/library/albums`
- `GET /api/library/artists`
- `GET /api/library/artists/:id`
- `GET /api/library/recent`

TrueNAS deployment
Use app path `/mnt/z1/docker/crate/app` and compose file `/mnt/z1/docker/crate/compose.yml`.

```bash
mkdir -p /mnt/z1/docker/crate
cd /mnt/z1/docker/crate
git clone https://github.com/punishergui/crate.git app
cp /mnt/z1/docker/crate/app/compose.yml /mnt/z1/docker/crate/compose.yml
cd /mnt/z1/docker/crate
docker compose -f /mnt/z1/docker/crate/compose.yml up -d --build
curl http://10.0.10.10:4010/health
curl -X POST http://10.0.10.10:4010/api/scan/start
```

Expected compose configuration
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
      - /mnt/z1/docker/crate/data:/data
      - /mnt/z1/media/music:/music:ro
    environment:
      NODE_ENV: production
      PORT: 4000
```

Persistence
- All app data and scanner state are in `/data/crate.sqlite`
- Scan progress is persisted in `scan_state`, so container restarts keep progress history and scan metadata
