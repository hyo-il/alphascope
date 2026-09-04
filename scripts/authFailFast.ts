/**
 * 인증 4xx 즉시 실패 검증 (수정 3).
 *
 * 일부러 잘못된 키로 요청해, 재시도 4회 + 백오프(약 5초)를 도는 대신
 * 첫 실패에서 바로 끝나는지 확인한다. 실행: npx tsx scripts/authFailFast.ts
 */
process.env.TOSS_CLIENT_ID = 'tsck_invalid_for_test';
process.env.TOSS_CLIENT_SECRET = 'tssk_invalid_for_test';

async function main() {
  const { fetchPrice } = await import('../src/services/toss/market');
  const started = Date.now();
  try {
    await fetchPrice('AAPL');
    console.log('⚠️ 예상과 다르게 성공했습니다 (키가 유효한 상태일 수 있습니다)');
  } catch (e) {
    const seconds = (Date.now() - started) / 1000;
    console.log(`실패까지 ${seconds.toFixed(2)}초 · ${(e as Error).name}`);
    console.log((e as Error).message.slice(0, 140));
    console.log(seconds < 2 ? '✅ 즉시 실패 — 재시도하지 않음' : '❌ 여전히 재시도 중');
  }
}

void main();
