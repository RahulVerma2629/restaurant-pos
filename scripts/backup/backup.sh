#!/usr/bin/env bash
# Nightly PostgreSQL backup with checksum and retention.
# Usage:  BACKUP_DIR=/var/backups/pos DATABASE_URL_PLAIN=postgresql://pos:pos@localhost:5432/pos ./scripts/backup/backup.sh
# Cron :  15 2 * * * cd /opt/restaurant-pos && ./scripts/backup/backup.sh >> /var/log/pos-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DB_URL="${DATABASE_URL_PLAIN:-}"
if [ -z "$DB_URL" ]; then echo "ERROR: set DATABASE_URL_PLAIN (no ?schema= suffix)" >&2; exit 1; fi
command -v pg_dump >/dev/null || { echo "ERROR: pg_dump not found (install postgresql-client)" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/pos_${stamp}.dump"

pg_dump --format=custom --no-owner --dbname="$DB_URL" --file="$file.partial"
mv "$file.partial" "$file"
sha256sum "$file" > "$file.sha256"
echo "OK backup $file ($(du -h "$file" | cut -f1))"

# Optional off-site copy: set OFFSITE_CMD, e.g.  OFFSITE_CMD='rclone copy "$FILE" remote:pos-backups'
if [ -n "${OFFSITE_CMD:-}" ]; then FILE="$file" bash -c "$OFFSITE_CMD"; fi

find "$BACKUP_DIR" -name 'pos_*.dump*' -mtime +"$RETENTION_DAYS" -delete
