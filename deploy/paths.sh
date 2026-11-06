# AlphaScope — 오라클 자리 한 곳 (v2.61.3). 배포 스크립트들이 맨 위에서 이 파일을 읽는다(`. paths.sh`) — 경로를 파일마다 따로 적지 않는다.
#
#   ~/projects/
#   ├── _common/                 비워 둠(나중에 여러 프로젝트가 같이 쓰는 것)
#   └── alphascope/              관리 루트 PROJECT_DIR
#       ├── app/                 APP_DIR — 저장소(git) · DB 는 app/db/
#       ├── secrets/             SECRETS_DIR (700 · 파일 600)
#       ├── scripts/             SCRIPTS_DIR — deploy.sh(저장소 deploy/deploy.sh 의 사본) · backup.sh · setpw.sh
#       ├── backups/             BACKUP_DIR — db/ · node24/ · https/ · nginx/
#       └── data/                DATA_DIR — 미국 마감 값 표본(ussample)
#
# 시험(deploy:test)만 HOME · APP_DIR 을 임시 폴더로 바꾼다.
PROJECTS_ROOT="$HOME/projects"
PROJECT_DIR="$PROJECTS_ROOT/alphascope"
APP_DIR="${APP_DIR:-$PROJECT_DIR/app}"
SECRETS_DIR="$PROJECT_DIR/secrets"
SCRIPTS_DIR="$PROJECT_DIR/scripts"
BACKUP_DIR="$PROJECT_DIR/backups"
DATA_DIR="$PROJECT_DIR/data"
