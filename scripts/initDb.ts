import 'dotenv/config';
import { getDb } from '../server/db';

const db = getDb();
const tables = db
  .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
  .all() as { name: string }[];

console.log('SQLite 초기화 완료. 테이블:', tables.map((t) => t.name).join(', '));
