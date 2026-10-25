# Backup & Recovery

## Targets
RPO ≤ 24 h (nightly dump), improved to ≤ 5 min with WAL archiving (optional). RTO ≤ 60 min.

## Backup
```bash
export DATABASE_URL_PLAIN="postgresql://pos:pos@localhost:5432/pos"   # no ?schema= suffix
BACKUP_DIR=/var/backups/pos RETENTION_DAYS=14 ./scripts/backup/backup.sh
```
- Creates `pos_<UTC time>.dump` (custom format) and a `.sha256` file; deletes backups older than `RETENTION_DAYS`.
- Optional off-site copy: `OFFSITE_CMD='rclone copy "$FILE" remote:pos-backups'`.
- Schedule daily at 02:15: `15 2 * * * cd /opt/restaurant-pos && ./scripts/backup/backup.sh >> /var/log/pos-backup.log 2>&1`
- Requires `pg_dump` (package `postgresql-client`).
- Orders module (SQLite): copy `pos_orders.db` using `sqlite3 pos_orders.db ".backup 'pos_orders_backup.db'"` (safe while running).

## Restore
```bash
TARGET_DB_URL="postgresql://pos:pos@localhost:5432/pos_restore_test" \
  ./scripts/backup/restore.sh backups/pos_20261025T021500Z.dump
```
The script checks the checksum first and refuses a damaged file.

## Disaster steps (server lost)
1. New machine → install Docker, clone repo, copy `.env`.
2. `docker compose up -d db`, create empty database.
3. Restore latest backup with `restore.sh`.
4. `cd backend && npm ci && npm run start`; check `/api/v1/health/ready` = 200.
5. Terminals reconnect and push their offline queues; duplicates are ignored by `opId`.
6. Write a short incident note (time, cause, data lost).

## Drill (every month)
Restore the latest backup into `pos_restore_test`, run `SELECT count(*) FROM bills;` and compare with production. Record the date and result in `backup_runs.note` or the team log.

## Checklist
- [ ] Backup ran last night (file exists, size > 0)
- [ ] Off-site copy exists
- [ ] Last restore drill < 30 days
- [ ] `.env` stored separately and securely (not in Git)
