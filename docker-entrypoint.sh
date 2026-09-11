#!/bin/sh
# Zoostudios backend container entrypoint:
#   1. apply pending migrations (idempotent)
#   2. seed baseline data (idempotent)
#   3. start the API
set -e

echo "[entrypoint] prisma migrate deploy"
./node_modules/.bin/prisma migrate deploy

echo "[entrypoint] seed (idempotent)"
./node_modules/.bin/ts-node prisma/seed.ts

echo "[entrypoint] starting API on :${PORT:-3000}"
exec node dist/main.js
