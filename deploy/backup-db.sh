#!/bin/bash
# AlphaScope — 주간 DB 백업 (v2.61.3). crontab(일요일 03:00) → ~/projects/alphascope/scripts/backup.sh → 이 스크립트.
#
#   손으로 한 번:  bash ~/projects/alphascope/app/deploy/backup-db.sh
#
# 서버가 도는 중에도 온전한 사본을 만든다 — SQLite 온라인 백업 API(backup-db.cjs · better-sqlite3 db.backup()).
#   DB 는 WAL(server/db.ts journal_mode = WAL)이라 .db 만 cp 하면 최근 기록이 빠지거나 깨진 사본이 될 수 있다.
# 저장: backups/db/alphascope_YYYYMMDD.db(한 파일) · 끝나면 사본의 PRAGMA integrity_check = ok 확인
#   · 실패하면 backups/db/backup.log 에 남기고 사본을 지운다(원본 · 예전 백업은 그대로).
#   · 성공했을 때만 30일 넘은 백업(*.db)을 지운다 — 새 사본이 없는데 옛것까지 지우지 않게.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/paths.sh"   # 자리(APP_DIR · BACKUP_DIR …)는 deploy/paths.sh 한 곳

DB_FILE="${DB_FILE:-$APP_DIR/db/alphascope.db}"   # 시험(deploy:test)만 바꾼다
OUT_DIR="$BACKUP_DIR/db"
KEEP_DAYS=30
LOG="$OUT_DIR/backup.log"
DEST="$OUT_DIR/alphascope_$(date +%Y%m%d).db"
PART="$DEST.part"

mkdir -p "$OUT_DIR" || { echo "백업 폴더 $OUT_DIR 를 만들지 못했습니다." >&2; exit 1; }
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG"; }

if [ ! -f "$DB_FILE" ]; then
  log "실패 — DB 파일이 없습니다($DB_FILE)"
  exit 1
fi
rm -f "$PART"
if ERR=$(node "$HERE/backup-db.cjs" "$DB_FILE" "$PART" 2>&1) && [ -s "$PART" ]; then
  mv -f "$PART" "$DEST"
  log "완료 — $DEST ($(du -h "$DEST" | cut -f1)) · integrity_check ok"
else
  rm -f "$PART" "$PART-journal" "$PART-wal" "$PART-shm"
  log "실패 — 사본을 지웠습니다 · 원본과 예전 백업은 그대로 · ${ERR:-원인 모름}"
  exit 1
fi
find "$OUT_DIR" -maxdepth 1 -type f -name '*.db' -mtime +"$KEEP_DAYS" -print | while read -r OLD; do
  rm -f "$OLD" && log "${KEEP_DAYS}일 넘어 지움 — $(basename "$OLD")"
done
exit 0
