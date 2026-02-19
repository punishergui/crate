# Crate (Phase 1)

Crate is a lightweight "crate + items" app for TrueNAS SCALE + Dockge.

## TrueNAS / Dockge target

- Host: `10.0.10.10`
- App URL: `http://10.0.10.10:4010`
- Stack folder: `/mnt/z1/docker/crate`
- Persistent data: `/mnt/z1/docker/crate/data`
- In-container data mount: `/app/data`

## Repository layout

- `app/server.js` - HTTP server, SQLite-backed API, and simple HTML UI
- `app/Dockerfile` - production image build for TrueNAS host Docker
- `compose.yml` - stack definition intended for `/mnt/z1/docker/crate/compose.yml`

## Deploy on TrueNAS SCALE

1. Place the repository on TrueNAS, for example:
   - `/mnt/z1/docker/crate/app` (source)
   - `/mnt/z1/docker/crate/compose.yml` (stack file)
2. Run compose from the stack folder:

```bash
cd /mnt/z1/docker/crate
docker compose up -d --build
```

3. Verify:

```bash
curl -sS http://10.0.10.10:4010/health
curl -sS http://10.0.10.10:4010/api/crates
```

## API quick examples

Create a crate:

```bash
curl -sS -X POST http://10.0.10.10:4010/api/crates \
  -H 'Content-Type: application/json' \
  -d '{"name":"recipes"}'
```

List crates:

```bash
curl -sS http://10.0.10.10:4010/api/crates
```

Create an item in crate `1`:

```bash
curl -sS -X POST http://10.0.10.10:4010/api/crates/1/items \
  -H 'Content-Type: application/json' \
  -d '{"type":"note","title":"starter","content":"first note","tags":"home,food"}'
```

List items for crate `1`:

```bash
curl -sS http://10.0.10.10:4010/api/crates/1/items
```

Delete an item:

```bash
curl -sS -X DELETE http://10.0.10.10:4010/api/items/1
```

Delete a crate (cascades item deletion):

```bash
curl -sS -X DELETE http://10.0.10.10:4010/api/crates/1
```

## Safe data reset

To reset all app data, stop the stack and remove files only under:

- `/mnt/z1/docker/crate/data`

Example:

```bash
cd /mnt/z1/docker/crate
docker compose down
rm -f /mnt/z1/docker/crate/data/*
docker compose up -d --build
```
