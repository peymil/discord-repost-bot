#!/usr/bin/env bash
set -euo pipefail

if [ ! -f litestream.yml ]; then
  echo "litestream.yml not found. Run from project root."
  exit 1
fi

# Restore from S3 replica if the local DB doesn't exist
if [ ! -f db/sqlite.db ]; then
  echo "Restoring database from Litestream replica..."
  litestream restore -if-db-not-exists -if-replica-exists db/sqlite.db
  echo "Restore complete."
else
  echo "Database exists locally, skipping restore."
fi