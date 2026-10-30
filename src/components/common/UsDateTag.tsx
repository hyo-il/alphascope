import { Fragment, type ReactNode } from 'react';
import InfoTip from '../ui/InfoTip';
import { US_DATE_LABEL, US_DATE_TIP } from '../../utils/marketDate';

/**
 * 「미국 날짜」 표시 — 미국 일정(실적 · FOMC · 옵션 만기 · 미국 휴장) 날짜 옆에 붙인다(v2.59.3, 화면마다 따로 만들지 않는다).
 * 날짜 계산 · 「지남」 은 미국 동부 날짜 그대로이고, 이 표시가 한국 달력과 하루 차이 나는 까닭을 툴팁으로 알린다(마우스 · 키보드 포커스).
 * 국내 일정에는 붙이지 않는다. 글자 · 툴팁 문구는 `utils/marketDate` 의 상수 하나(서버 문장도 같은 글자).
 */
export default function UsDateTag({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex shrink-0 whitespace-nowrap text-caption font-normal text-text-muted ${className}`} data-us-date>
      <InfoTip label={US_DATE_TIP} trigger={US_DATE_LABEL}>
        {US_DATE_TIP}
      </InfoTip>
    </span>
  );
}

/** 서버 문장 속 「미국 날짜」 글자를 이 부품으로 바꿔 그린다(매수 판단 실적 경고) — 글자가 없으면 문장 그대로 */
export function withUsDateTag(text: string): ReactNode {
  const parts = text.split(US_DATE_LABEL);
  if (parts.length === 1) return text;
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && <UsDateTag />}
    </Fragment>
  ));
}
