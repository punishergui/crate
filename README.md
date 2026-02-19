# Crate (Phase 0)

Minimal production-shaped Node web app for TrueNAS SCALE deployment via Docker Compose.

## What it provides

- HTTP server on container port `4000`
- Host mapping `10.0.10.10:4010 -> container:4000`
- Persistent data volume mounted at `/app/data`
- Boot log append to `/app/data/boot.log` on startup
- Endpoints:
  - `GET /health`
  - `GET /`
  - `GET /api/info`

## Repository layout

- `app/` - application source + Dockerfile
- `compose.yml` - compose stack definition for local build and run
- `.gitignore`

## How to deploy on TrueNAS

> Place this repository at `/mnt/z1/docker/crate` on the TrueNAS SCALE host.

```bash
cd /mnt/z1/docker/crate
docker compose up -d --build
```

## Verify service from TrueNAS or LAN client

```bash
curl -sS http://10.0.10.10:4010/health
curl -sS http://10.0.10.10:4010/
curl -sS http://10.0.10.10:4010/api/info
```

Expected health response shape:

```json
{
  "ok": true,
  "name": "crate",
  "version": "0.1.0",
  "time": "2026-01-01T00:00:00.000Z"
}
```
