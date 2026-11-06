// AlphaScope — DB 온전한 사본 만들기 (v2.61.3). deploy/backup-db.sh 가 부른다: node backup-db.cjs <원본 DB> <사본>
//
// 서버가 도는 중(WAL)에도 온전한 사본을 만든다 — SQLite 온라인 백업 API.
//   · .db 만 cp 하면 -wal 에만 있는 최근 기록이 빠지거나, 복사하는 동안 쓰인 쪽이 섞여 깨진 사본이 될 수 있다.
//   · 백업 API 는 원본을 한 페이지씩 읽으며 그동안 바뀐 것을 다시 읽어 「한 시점의 온전한 DB」 를 만든다(WAL 의 기록 포함).
//   출처: https://www.sqlite.org/backup.html (Online Backup API)
//         https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#backupdestination-options---promise
// 끝나면 사본을 한 파일(journal_mode=DELETE)로 바꾸고 PRAGMA integrity_check = ok 를 확인한다. 아니면 종료 코드 1(사본은 부른 쪽이 지운다).
// 원본은 읽기만 한다(쓰는 문장 없음).
const Database = require('better-sqlite3'); // 앱의 node_modules(이 파일은 app/deploy/)

async function main() {
  const [src, dest] = process.argv.slice(2);
  if (!src || !dest) throw new Error('쓰는 법: node backup-db.cjs <원본 DB> <사본>');
  const db = new Database(src, { fileMustExist: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
  const copy = new Database(dest, { fileMustExist: true });
  try {
    copy.pragma('journal_mode = DELETE'); // 사본은 -wal · -shm 없이 한 파일로
    const result = copy.pragma('integrity_check', { simple: true });
    if (result !== 'ok') throw new Error(`integrity_check 결과가 ok 가 아닙니다: ${result}`);
  } finally {
    copy.close();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`백업 실패: ${e && e.message ? e.message : e}`);
    process.exit(1);
  },
);
