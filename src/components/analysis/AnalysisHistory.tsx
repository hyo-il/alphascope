import { useCallback, useEffect, useState } from 'react';
import type { Timeframe } from '../../types/toss';
import { formatUsd } from '../../utils/formatters';

interface Props {
  symbol: string;
  timeframe: Timeframe;
  currentPrice: number | null;
}

interface AnalysisRecord {
  id: number;
  symbol: string;
  timeframe: string;
  analyzed_at: string;
  price_at_analysis: number;
  synthesis: string;
  verdict: string;
  confidence: string;
}

const VERDICTS = [
  { value: 'strong_buy', label: '강력 매수' },
  { value: 'buy', label: '매수' },
  { value: 'neutral', label: '중립' },
  { value: 'sell', label: '매도' },
  { value: 'strong_sell', label: '강력 매도' },
];

const CONFIDENCES = [
  { value: 'high', label: '높음' },
  { value: 'medium', label: '중간' },
  { value: 'low', label: '낮음' },
];

const VERDICT_STYLE: Record<string, string> = {
  strong_buy: 'text-bullish',
  buy: 'text-bullish',
  neutral: 'text-text-secondary',
  sell: 'text-bearish',
  strong_sell: 'text-bearish',
};

/** Claude 답변에서 결론을 추정해 기본값으로 채운다 (사용자가 고칠 수 있다). */
function guessVerdict(text: string): string {
  const line = text.match(/\*\*결론\*\*\s*:?\s*(.+)/)?.[1] ?? text.slice(0, 400);
  if (/강력\s*매수/.test(line)) return 'strong_buy';
  if (/강력\s*매도/.test(line)) return 'strong_sell';
  if (/매수/.test(line)) return 'buy';
  if (/매도/.test(line)) return 'sell';
  return 'neutral';
}

function guessConfidence(text: string): string {
  const line = text.match(/\*\*신뢰도\*\*\s*:?\s*(.+)/)?.[1] ?? '';
  if (/높음/.test(line)) return 'high';
  if (/낮음/.test(line)) return 'low';
  return 'medium';
}

/**
 * 분석 히스토리.
 *
 * 앱이 AI 를 직접 호출하지 않으므로, Claude 대화에서 받은 답변을 여기에 붙여넣어 기록한다.
 * 나중에 "그때 판단이 맞았는지" 되돌아보는 것이 이 탭의 목적이다.
 */
export default function AnalysisHistory({ symbol, timeframe, currentPrice }: Props) {
  const [records, setRecords] = useState<AnalysisRecord[]>([]);
  const [draft, setDraft] = useState('');
  const [verdict, setVerdict] = useState('neutral');
  const [confidence, setConfidence] = useState('medium');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [onlyThisSymbol, setOnlyThisSymbol] = useState(true);

  const load = useCallback(async () => {
    const url = onlyThisSymbol ? `/api/analysis?symbol=${symbol}` : '/api/analysis';
    const res = await fetch(url);
    const data = await res.json();
    setRecords(data.analyses ?? []);
  }, [symbol, onlyThisSymbol]);

  useEffect(() => {
    void load();
  }, [load]);

  // 붙여넣는 순간 결론·신뢰도를 추정해 채워 준다.
  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (value.length > 50) {
      setVerdict(guessVerdict(value));
      setConfidence(guessConfidence(value));
    }
  };

  const handleSave = async () => {
    if (!draft.trim()) return;
    await fetch('/api/analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        timeframe,
        priceAtAnalysis: currentPrice ?? 0,
        synthesis: draft,
        verdict,
        confidence,
      }),
    });
    setDraft('');
    await load();
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/analysis/${id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <div className="flex h-full gap-4 overflow-hidden p-4">
      <div className="flex w-80 shrink-0 flex-col gap-2">
        <p className="text-xs text-text-secondary">
          Claude 대화의 분석 결과를 붙여넣어 {symbol} 기록으로 남깁니다.
        </p>

        <textarea
          value={draft}
          onChange={(e) => handleDraftChange(e.target.value)}
          placeholder="여기에 분석 결과를 붙여넣으세요 (⌘V)"
          className="min-h-0 flex-1 resize-none rounded-md border border-border bg-bg-primary p-2 text-xs leading-relaxed text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        />

        <div className="flex gap-2">
          <select
            value={verdict}
            onChange={(e) => setVerdict(e.target.value)}
            className="flex-1 rounded-md border border-border bg-bg-tertiary px-2 py-1.5 text-xs text-text-primary"
          >
            {VERDICTS.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
          <select
            value={confidence}
            onChange={(e) => setConfidence(e.target.value)}
            className="flex-1 rounded-md border border-border bg-bg-tertiary px-2 py-1.5 text-xs text-text-primary"
          >
            {CONFIDENCES.map((c) => (
              <option key={c.value} value={c.value}>
                신뢰도 {c.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!draft.trim()}
          className="rounded-md bg-accent px-3 py-2 text-sm text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          기록 저장 (현재가 {formatUsd(currentPrice)})
        </button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs text-text-muted">저장된 분석 {records.length}건</p>
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={onlyThisSymbol}
              onChange={(e) => setOnlyThisSymbol(e.target.checked)}
              className="accent-accent"
            />
            {symbol}만 보기
          </label>
        </div>

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
          {records.length === 0 && (
            <p className="py-6 text-center text-xs text-text-muted">저장된 분석이 없습니다.</p>
          )}

          {records.map((record) => {
            const isOpen = expanded === record.id;
            const priceChange = currentPrice && record.price_at_analysis
              ? ((currentPrice - record.price_at_analysis) / record.price_at_analysis) * 100
              : null;

            return (
              <article key={record.id} className="rounded-md border border-border bg-bg-primary">
                <header
                  onClick={() => setExpanded(isOpen ? null : record.id)}
                  className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs hover:bg-bg-tertiary/40"
                >
                  <span className="font-medium text-accent">{record.symbol}</span>
                  <span className={VERDICT_STYLE[record.verdict] ?? ''}>
                    {VERDICTS.find((v) => v.value === record.verdict)?.label ?? record.verdict}
                  </span>
                  <span className="text-text-muted">
                    신뢰도 {CONFIDENCES.find((c) => c.value === record.confidence)?.label ?? '—'}
                  </span>
                  <span className="text-text-muted">
                    분석 시점 {formatUsd(record.price_at_analysis)}
                    {record.symbol === symbol && priceChange != null && (
                      <span className={priceChange >= 0 ? ' text-bullish' : ' text-bearish'}>
                        {' '}
                        → 현재 {priceChange > 0 ? '+' : ''}
                        {priceChange.toFixed(2)}%
                      </span>
                    )}
                  </span>
                  <span className="ml-auto text-text-muted">
                    {new Date(record.analyzed_at).toLocaleString('ko-KR')}
                  </span>
                </header>

                {isOpen && (
                  <div className="border-t border-border px-3 py-2">
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-text-secondary">
                      {record.synthesis}
                    </pre>
                    <button
                      type="button"
                      onClick={() => void handleDelete(record.id)}
                      className="mt-2 text-[11px] text-text-muted transition-colors hover:text-bearish"
                    >
                      삭제
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
