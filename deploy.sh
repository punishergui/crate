#!/usr/bin/env bash
set -euo pipefail

docker compose up -d

echo "----- Running image -----"
docker inspect crate --format '{{.Config.Image}}'

echo "----- Container ID -----"
docker inspect crate --format '{{.Id}}'

echo "----- Health -----"
curl -fsS http://10.0.10.10:4010/health | sed 's/}/}\n/g'
