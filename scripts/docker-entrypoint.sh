#!/bin/sh
set -e

if [ ! -f db/sqlite.db ]; then
  echo "Restoring database from Litestream replica..."
  litestream restore -if-db-not-exists -if-replica-exists db/sqlite.db
fi

exec "$@"