/**
 * 대형주 유니버스 갱신 — `npm run universe:update`
 *
 * 본체는 `server/universe.ts` 다 (서버의 월별 스냅샷과 같은 함수). 받은 결과는 `server/data/universe.json`
 * (최신본)에 쓰고, 그 달 스냅샷이 없으면 DB `universe_snapshots` 에도 남긴다.
 * 서버가 떠 있으면 매월 자동으로 받으므로 손으로 돌릴 일은 드물다.
 */

import 'dotenv/config';
import { UNIVERSE_PATH, updateUniverse } from '../server/universe';

updateUniverse()
  .then((u) => {
    console.log(`[universe] 미국 ${u.us.length} · 국내 ${u.kr.length} · 제외 ${u.excluded.length}건 → ${UNIVERSE_PATH}`);
    console.log(`[universe] 미국 앞 10: ${u.us.slice(0, 10).map((e) => e.symbol).join(' ')}`);
    console.log(`[universe] 국내 앞 10: ${u.kr.slice(0, 10).map((e) => `${e.symbol}(${e.name})`).join(' ')}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error('[universe] 실패:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
