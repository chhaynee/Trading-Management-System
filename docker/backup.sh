#!/bin/sh
# Stream a backup of the TMS data (tms.db + uploads/) to stdout as a .tar.gz.
# Safe while the app is running: VACUUM INTO writes a consistent snapshot.
# The archive has the same layout as a pre-Docker install, so it can also be
# unpacked next to server/ and used with plain `npm start`.
#
# Usage: docker compose run --rm -T app tms-backup > tms-backup.tar.gz
set -eu

if [ ! -f "$TMS_DB_PATH" ]; then
  echo "tms-backup: no database at $TMS_DB_PATH yet, nothing to back up" >&2
  exit 0
fi

snapshot=$(mktemp -d)
trap 'rm -rf "$snapshot"' EXIT

node -e '
  const Database = require("better-sqlite3");
  const [src, dest] = process.argv.slice(1);
  new Database(src, { fileMustExist: true }).prepare("VACUUM INTO ?").run(dest);
' "$TMS_DB_PATH" "$snapshot/tms.db"

tar -czf - -C "$snapshot" tms.db -C "$(dirname "$TMS_UPLOADS_DIR")" "$(basename "$TMS_UPLOADS_DIR")"
