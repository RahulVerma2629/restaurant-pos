#!/usr/bin/env bash
# Restore a backup. Verifies checksum first. Restores into TARGET_DB_URL (use a scratch DB for drills!).
# Usage:  TARGET_DB_URL=postgresql://pos:pos@localhost:5432/pos_restore_test ./scripts/backup/restore.sh backups/pos_20260101T020000Z.dump
set -euo pipefail

file="${1:-}"
if [ -z "$file" ] || [ ! -f "$file" ]; then echo "Usage: TARGET_DB_URL=... $0 <backup.dump>" >&2; exit 1; fi
if [ -z "${TARGET_DB_URL:-}" ]; then echo "ERROR: set TARGET_DB_URL" >&2; exit 1; fi
command -v pg_restore >/dev/null || { echo "ERROR: pg_restore not found" >&2; exit 1; }

if [ -f "$file.sha256" ]; then
  (cd "$(dirname "$file")" && sha256sum -c "$(basename "$file").sha256") || { echo "ERROR: checksum mismatch, backup is corrupted" >&2; exit 1; }
else
  echo "WARNING: no .sha256 file found, skipping integrity check" >&2
fi

pg_restore --clean --if-exists --no-owner --dbname="$TARGET_DB_URL" "$file"
echo "OK restored $file into target database"
