#!/bin/sh
# Replace the TMS data (tms.db + uploads/) with a .tar.gz read from stdin.
# The archive is unpacked and checked first; live data is only touched once it
# has passed. Stop the app container before running this.
#
# Usage: docker compose run --rm -T app tms-restore < tms-backup.tar.gz
set -eu

db=$TMS_DB_PATH
uploads=$TMS_UPLOADS_DIR
stage="$(dirname "$db")/.restore"   # same filesystem, so the swap is a rename

rm -rf "$stage"
mkdir -p "$stage"
trap 'rm -rf "$stage"' EXIT

tar -xzf - -C "$stage"

if [ ! -f "$stage/tms.db" ]; then
  echo "tms-restore: archive has no tms.db at its top level; nothing was changed" >&2
  exit 1
fi
if [ "$(head -c 15 "$stage/tms.db")" != "SQLite format 3" ]; then
  echo "tms-restore: tms.db in the archive is not a SQLite database; nothing was changed" >&2
  exit 1
fi

rm -rf "$db" "$db-wal" "$db-shm" "$uploads"
mv "$stage/tms.db" "$db"
# A -wal file only exists in archives of an install that wasn't shut down
# cleanly; it holds committed rows that aren't in tms.db yet.
if [ -f "$stage/tms.db-wal" ]; then mv "$stage/tms.db-wal" "$db-wal"; fi
if [ -d "$stage/uploads" ]; then mv "$stage/uploads" "$uploads"; else mkdir -p "$uploads"; fi

echo "tms-restore: restored database + $(find "$uploads" -type f | wc -l) screenshot file(s)" >&2
