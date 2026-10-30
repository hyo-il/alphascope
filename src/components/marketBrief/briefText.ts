import { displayMinus } from '../../utils/formatters';

/** 오늘 시황 칸들이 같이 쓰는 글 도우미 · 상수 — 칸 부품은 이 파일과 `BriefCard.tsx` 만 공유한다 */

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
/** 화면이 만드는 짧은 날짜 「10-28(수)」 (YYYY-MM-DD 의 월-일 · 요일) */
export const dayLabel = (day: string) => `${day.slice(5, 7)}-${day.slice(8, 10)}(${WEEKDAY[new Date(`${day}T12:00:00Z`).getUTCDay()]})`;
/** AI 글 정리 — 이모지를 빼고 하이픈 음수를 마이너스 기호로 · 금액 음수는 부호를 통화 기호 앞으로(`₩-1,214` → `−₩1,214`) */
export const clean = (text: string | null | undefined) =>
  displayMinus(
    String(text ?? '')
      .replace(/\p{Extended_Pictographic}️?/gu, '')
      .replace(/([$₩])[-−](?=\d)/g, '−$1')
      .replace(/\s{2,}/g, ' ')
      .trim(),
  );

/** 이름 열 폭 — 이름표(「패시브(가정)」 · 「스윙 후보(참고)」)가 꺾이지 않는 폭 */
export const LABEL_W = 'w-24';
export const PASSIVE_TIP =
  'AI 에게 준 가상 장기 보유 비중(S&P500 ETF 55% · 미국 배당 ETF 25% · 국고채 10년 ETF 10% · 금 ETF 10%) 기준의 의견입니다 — 내 계좌와 상관없습니다. %p = 비중의 퍼센트 차이(예: 10% → 12% 는 +2%p).';
