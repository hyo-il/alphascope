import { useCallback, useEffect, useState } from 'react';
import { SkeletonList } from '../common/SkeletonLoader';
import { analysisModeLabel } from '../../types/analysis';
import type { Timeframe } from '../../types/toss';
import { formatUsd } from '../../utils/formatters';
import { modal, toast } from '../../store/uiStore';

interface Props {
  symbol: string;
  timeframe: Timeframe;
  currentPrice: number | null;
  /** 방금 사용한 분석 모드와 프롬프트 — 기록에 함께 저장한다 */
  mode: string;
  prompt: string;
}

// 라벨은 types/analysis 의 analysisModeLabel 한 곳에서 만든다 — 여기에 따로 적어 두면
// 모드 이름을 바꿀 때마다 기록 화면만 옛 이름으로 남는다. 지금은 고를 수 없는 옛 모드(비교 분석)도 읽는다.

interface AnalysisRecord {
  id: number;
  symbol: string;
  timeframe: string;
  analyzed_at: string;
  price_at_analysis: number;
  synthesis: string;
  verdict: string;
  confidence: string;
  mode: string | null;
  prompt: string | null;
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
export default function AnalysisHistory({
  symbol,
  timeframe,
  currentPrice,
  mode,
  prompt,
}: Props) {
  const [records, setRecords] = useState<AnalysisRecord[]>([]);
  /** 처음 받는 중 (v2.38.0 로딩 점검) — 받기 전에 "저장된 분석이 없습니다" 를 띄우지 않는다 */
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [verdict, setVerdict] = useState('neutral');
  const [confidence, setConfidence] = useState('medium');
  const [expanded, setExpanded] = useState<number | null>(null);
  /** 상세에서 답변을 볼지, 당시 프롬프트를 볼지 */
  const [detailView, setDetailView] = useState<'answer' | 'prompt'>('answer');
  const [onlyThisSymbol, setOnlyThisSymbol] = useState(true);

  const load = useCallback(async () => {
    const url = onlyThisSymbol ? `/api/analysis?symbol=${symbol}` : '/api/analysis';
    // ⚠️ 불러오기 실패를 "기록 없음" 으로 보이지 않는다 (v2.34.1) — 목록은 그대로 두고 알린다
    const res = await fetch(url).catch(() => null);
    const data = (await res?.json().catch(() => ({}))) as { analyses?: AnalysisRecord[]; error?: string } | undefined;
    setLoaded(true);
    if (!res?.ok) {
      toast.error('분석 기록을 불러오지 못했습니다', data?.error ?? (res ? `요청 실패 (${res.status})` : '서버에 연결하지 못했습니다'));
      return;
    }
    setRecords(data?.analyses ?? []);
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
    /*
     * ⚠️ 저장이 실패하면 붙여넣은 글을 지우지 않는다 (v2.34.1) — 예전에는 응답을 보지 않고 입력칸을 비워,
     * 실패해도 글이 사라지고 아무 표시가 없었다. 성공하면 목록에 바로 보이므로 따로 알리지 않는다.
     */
    const res = await fetch('/api/analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        timeframe,
        priceAtAnalysis: currentPrice ?? 0,
        synthesis: draft,
        verdict,
        confidence,
        mode,
        prompt,
      }),
    }).catch(() => null);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      toast.error('기록을 저장하지 못했습니다 — 붙여넣은 글은 그대로 있습니다', body?.error ?? (res ? `요청 실패 (${res.status})` : '서버에 연결하지 못했습니다'));
      return;
    }
    setDraft('');
    await load();
  };

  /*
   * 사용자가 붙여넣어 저장한 글이라 확인 창 (v2.34.1). 예전에는 바로 지웠고, 실패해도 아무 표시가 없었다.
   * 지우면 「분석 성적표」 집계에서도 빠진다 — 문구에 적는다.
   */
  const handleDelete = (record: AnalysisRecord) => {
    const date = new Date(record.analyzed_at).toLocaleDateString('ko-KR');
    modal.confirm({
      title: '분석 기록 지우기',
      message: `${record.symbol} ${date} 분석 기록을 지웁니다. 되돌릴 수 없고 「분석 성적표」 집계에서도 빠집니다.`,
      confirmText: '지우기',
      danger: true,
      onConfirm: async () => {
        const res = await fetch(`/api/analysis/${record.id}`, { method: 'DELETE' }).catch(() => null);
        if (!res?.ok) {
          const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
          toast.error('기록을 지우지 못했습니다', body?.error ?? (res ? `요청 실패 (${res.status})` : '서버에 연결하지 못했습니다'));
          return;
        }
        await load();
      },
    });
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
          placeholder="여기에 분석 결과를 붙여넣으세요 (Ctrl+V 또는 Cmd+V)"
          className="min-h-0 flex-1 resize-none rounded-md border border-border bg-bg-tertiary p-2 text-xs leading-relaxed text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
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
          <label className="inline-flex w-fit items-center gap-1.5 text-xs text-text-secondary">
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
          {!loaded && <SkeletonList count={3} />}
          {loaded && records.length === 0 && (
            <p className="py-6 text-center text-xs text-text-muted">저장된 분석이 없습니다.</p>
          )}

          {records.map((record) => {
            const isOpen = expanded === record.id;
            const priceChange = currentPrice && record.price_at_analysis
              ? ((currentPrice - record.price_at_analysis) / record.price_at_analysis) * 100
              : null;

            return (
              <article key={record.id} className="rounded-lg bg-bg-primary">
                <header
                  onClick={() => setExpanded(isOpen ? null : record.id)}
                  className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs hover:bg-bg-tertiary/40"
                >
                  <span className="font-medium text-text-primary">{record.symbol}</span>
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
                  <span className="text-text-muted">
                    {analysisModeLabel(record.mode)}
                  </span>
                  <span className="ml-auto text-text-muted">
                    {new Date(record.analyzed_at).toLocaleString('ko-KR')}
                  </span>
                </header>

                {isOpen && (
                  <div className="border-t border-border px-3 py-2">
                    <div className="mb-1.5 flex gap-1">
                      {(['answer', 'prompt'] as const).map((view) => (
                        <button
                          key={view}
                          type="button"
                          onClick={() => setDetailView(view)}
                          disabled={view === 'prompt' && !record.prompt}
                          className={`rounded px-2 py-0.5 text-[13px] transition-colors ${
                            detailView === view
                              ? 'bg-bg-elevated text-text-primary'
                              : 'text-text-muted hover:text-text-primary'
                          } disabled:opacity-40`}
                        >
                          {view === 'answer' ? '분석 답변' : '당시 프롬프트'}
                        </button>
                      ))}
                    </div>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-text-secondary">
                      {detailView === 'prompt'
                        ? (record.prompt ?? '저장된 프롬프트가 없습니다.')
                        : record.synthesis}
                    </pre>
                    <button
                      type="button"
                      onClick={() => handleDelete(record)}
                      className="mt-2 text-[13px] text-text-muted transition-colors hover:text-bearish"
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
