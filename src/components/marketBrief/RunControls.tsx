import { Button, InfoTip } from '../ui';
import WarnIcon from '../ui/WarnIcon';
import { EDITION_LABEL } from '../../utils/marketBrief';
import type { MarketBriefStatus } from '../../types/marketBrief';

/** 제목 줄 오른쪽 — 판 안내 · 「시황 분석」(횟수 제한 없음 — Gemini 한도에 닿으면 그 판은 데이터만) */
export default function RunControls({ status, starting, onRun }: { status: MarketBriefStatus; starting: boolean; onRun: () => void }) {
  return (
    <>
      <span className="text-caption text-text-muted">
        {status.running
          ? '만드는 중 — 끝나면 이 화면에 보입니다'
          : `지금 누르면 ${EDITION_LABEL[status.nowEdition]}(${status.nowEdition === 'morning' ? '미국 마감 기준' : '국내 마감 · VIX'})을 만듭니다`}
      </span>
      <InfoTip label="오전판 · 오후판">
        한국 시간 13시 전에 누르면 오전판(미국 증시 · 금리 · 달러 · 금 · 원유 등 13가지, 국내 · 해외 뉴스), 13시부터는 오후판(코스피 · 코스닥 마감 · VIX 공포지수, 국내 뉴스)을 만듭니다.
      </InfoTip>
      {status.geminiDisabledReason && (
        <span className="text-caption text-warning" title={status.geminiDisabledReason}>
          <WarnIcon />
          AI 꺼짐 — 데이터만 만듭니다
        </span>
      )}
      <Button variant="primary" busy={status.running || starting} onClick={onRun}>
        {status.running ? '분석 중…' : '시황 분석'}
      </Button>
    </>
  );
}
