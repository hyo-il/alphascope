/**
 * 브라우저 `User-Agent` → 「운영체제 · 브라우저」 (v2.51.3 — 설정 「로그인된 기기」). **판별은 이 함수 한 곳**.
 * 예: 「Mac · Chrome」 「Windows · Edge」 「iPhone · Safari」. 둘 다 모르면 「알 수 없는 기기」, 한쪽만 알면 아는 쪽만.
 * ⚠️ 서버도 컴파일한다(DOM 없음). 순서가 중요하다 — Edge·Opera·Samsung 은 UA 에 Chrome 도, Chrome 은 Safari 도 적는다.
 */
export const UNKNOWN_DEVICE = '알 수 없는 기기';

function osOf(ua: string): string | null {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'Mac';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return null;
}

function browserOf(ua: string): string | null {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/Whale\//.test(ua)) return 'Whale';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return null;
}

export function deviceName(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  const parts = [osOf(ua), browserOf(ua)].filter(Boolean);
  return parts.length ? parts.join(' · ') : UNKNOWN_DEVICE;
}
