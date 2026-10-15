import { useState, type ReactNode } from 'react';
import { Eye } from 'lucide-react';
import { Button, Select } from '../ui';
import WarnIcon from '../ui/WarnIcon';
import { useAppStore } from '../../store/appStore';
import { usePaperAccounts } from '../../hooks/usePaperTrading';
import { NO_STOP_WARNING } from '../../utils/ruleText';
import type { TradingRule } from '../../types/tradingRule';
import RuleDialog from './RuleDialog';

/**
 * 매매 규칙 고르기 — 계좌 설정 「① 매매 규칙」 · 처음 켜기 안내 · 백테스트 방법마다 **같은 부품** (v2.44.0).
 * [조건 보기] = `RuleDialog` 보기 전용([수정] 없음 — 고치기는 「퀀트 > 매매 규칙」 에서만).
 * 규칙이 하나도 없으면 막힌 이유와 가는 길(링크)을 같은 자리에 보인다. 손절이 꺼진 규칙이면 경고 한 줄(`warnNoStop`).
 */
export default function RuleSelect({
  rules,
  value,
  onChange,
  disabled = false,
  warnNoStop = false,
  label = '매매 규칙',
  size = 'md',
  aside,
}: {
  /** `useTradingRules().rules` — null = 불러오는 중 */
  rules: TradingRule[] | null;
  value: number | null;
  onChange: (id: number | null) => void;
  disabled?: boolean;
  warnNoStop?: boolean;
  label?: string;
  size?: 'sm' | 'md';
  /** 고르기 줄 **맨 오른쪽**에 붙이는 덧붙임(계좌 설정의 「AI 검증」 토글 — v2.46.0) */
  aside?: ReactNode;
}) {
  const [viewing, setViewing] = useState(false);
  const setPage = useAppStore((s) => s.setPage);
  const { accounts } = usePaperAccounts();
  const accountName = (id: number) => accounts.find((a) => a.id === id)?.name ?? `계좌 ${id}`;

  if (rules == null) return <p className="text-xs text-text-muted">매매 규칙을 불러오는 중…</p>;
  if (!rules.length) {
    return (
      <p className="text-xs text-text-secondary">
        매매 규칙이 없습니다. 「퀀트 &gt; 매매 규칙」 에서 먼저 만드세요.{' '}
        <button type="button" className="text-accent hover:underline" onClick={() => setPage('rules')}>
          매매 규칙으로 가기
        </button>
      </p>
    );
  }

  const selected = value != null ? (rules.find((r) => r.id === value) ?? null) : null;
  const missing = value != null && !selected;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          size={size}
          aria-label={label}
          value={selected ? String(selected.id) : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          className="min-w-48"
        >
          <option value="">규칙 고르기</option>
          {rules.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        <Button size={size} icon={Eye} onClick={() => setViewing(true)} disabled={!selected}>
          조건 보기
        </Button>
        {aside && <div className="ml-auto flex shrink-0 items-center gap-2">{aside}</div>}
      </div>
      {missing && <p className="text-caption text-warning">고른 규칙이 지워졌습니다 — 다시 고르세요.</p>}
      {!selected && !missing && (
        <p className="text-caption text-text-muted">
          「퀀트 &gt; 매매 규칙」 에서 규칙을 만들 수 있습니다.{' '}
          <button type="button" className="text-accent hover:underline" onClick={() => setPage('rules')}>
            매매 규칙으로 가기
          </button>
        </p>
      )}
      {warnNoStop && selected && !selected.sell.stopLoss.on && (
        <p className="text-caption text-warning">
          <WarnIcon />
          {NO_STOP_WARNING}
        </p>
      )}
      {viewing && selected && <RuleDialog rule={selected} readOnly onClose={() => setViewing(false)} accountName={accountName} />}
    </div>
  );
}
