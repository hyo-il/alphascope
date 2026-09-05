import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeminiAnalysis } from '../../types/gemini';
import { formatUsd } from '../../utils/formatters';
import { modal, toast } from '../../store/uiStore';
import AISourceBadge from './AISourceBadge';
import StockName from '../common/StockName';
import { useStockNames } from '../../hooks/useStockNames';
import GeminiAnalysisCard from './GeminiAnalysisCard';
import { SkeletonList } from '../common/SkeletonLoader';

/** Claude 기록 (analysis_history) — 저장·편집은 '수동 분석' 탭이 담당하고 여기서는 읽기만 한다 */
interface ClaudeRecord {
  id: number;
  symbol: string;
  analyzed_at: string;
  price_at_analysis: number;
  synthesis: string;
  verdict: string;
  confidence: string;
  mode: string | null;
}

const CLAUDE_VERDICT: Record<string, { label: string; className: string }> = {
  strong_buy: { label: '강력 매수', className: 'text-bullish font-semibold' },
  buy: { label: '매수', className: 'text-bullish' },
  neutral: { label: '중립', className: 'text-text-secondary' },
  sell: { label: '매도', className: 'text-bearish' },
  strong_sell: { label: '강력 매도', className: 'text-bearish font-semibold' },
};

const CONFIDENCE_LABEL: Record<string, string> = { high: '높음', medium: '중간', low: '낮음' };

/** 두 AI 의 방향이 같은지 — 라벨 체계가 달라 방향으로만 비교한다 */
function directionOf(signal: string): 'up' | 'down' | 'flat' {
  const upper = signal.toUpperCase();
  if (upper.includes('BUY') || upper.includes('매수')) return 'up';
  if (upper.includes('SELL') || upper.includes('매도')) return 'down';
  return 'flat';
}

type Item =
  | { kind: 'gemini'; at: string; data: GeminiAnalysis }
  | { kind: 'claude'; at: string; data: ClaudeRecord };

/** NEW 뱃지를 띄워 두는 시간 */
const HIGHLIGHT_MS = 3000;

export default function AnalysisTimeline({
  symbol,
  currentPrice,
  refreshKey,
  lastRun,
}: {
  /** 지정하면 그 종목만 */
  symbol: string | null;
  currentPrice: number | null;
  /** 값이 바뀌면 다시 불러온다 (자동 분석 실행 직후 등) */
  refreshKey?: number;
  /** 방금 돌린 분석 — 필터를 실행 범위에 맞추고 새 결과에 NEW 를 붙인다 */
  lastRun?: { scope: 'all' | 'single'; since: number } | null;
}) {
  const [gemini, setGemini] = useState<GeminiAnalysis[]>([]);
  const [claude, setClaude] = useState<ClaudeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyThisSymbol, setOnlyThisSymbol] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  /** NEW 뱃지를 보여 줄 기준 시각 — 3초 뒤에 스스로 꺼진다 */
  const [highlightSince, setHighlightSince] = useState<number | null>(null);

  /*
   * 여러 종목을 돌렸으면 '현재 종목만' 을 자동으로 푼다.
   * 그러지 않으면 방금 분석한 다른 종목이 하나도 보이지 않아
   * "결과가 나오지 않는다" 로 읽힌다.
   */
  useEffect(() => {
    if (!lastRun) return;
    if (lastRun.scope === 'all') setOnlyThisSymbol(false);
    setHighlightSince(lastRun.since);
    const timer = setTimeout(() => setHighlightSince(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [lastRun]);

  /*
   * 요청 순번.
   *
   * 필터가 바뀌면 새 요청이 나가는데, 먼저 보낸 요청이 늦게 도착하면 최신 결과를
   * 덮어쓴다. 실제로 "여러 종목을 분석했는데 현재 종목 것만 보인다" 가 이것이었다 —
   * 필터를 푸는 순간 두 요청이 겹쳤다.
   */
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++requestId.current;
    setLoading(true);
    const query = onlyThisSymbol && symbol ? `?symbol=${encodeURIComponent(symbol)}` : '';
    try {
      const [g, c] = await Promise.all([
        fetch(`/api/gemini/analyses${query || '?limit=100'}`).then((r) => (r.ok ? r.json() : [])),
        fetch(`/api/analysis${query}`).then((r) => (r.ok ? r.json() : [])),
      ]);
      // 내가 마지막 요청이 아니면 결과를 버린다.
      if (ticket !== requestId.current) return;
      setGemini(Array.isArray(g) ? g : []);
      setClaude(Array.isArray(c) ? c : []);
    } finally {
      if (ticket === requestId.current) setLoading(false);
    }
  }, [symbol, onlyThisSymbol]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // 목록에 뜬 모든 종목의 이름을 한 번에 받아 둔다.
  useStockNames([...gemini.map((item) => item.symbol), ...claude.map((item) => item.symbol)]);

  const items = useMemo<Item[]>(() => {
    const merged: Item[] = [
      ...gemini.map((data) => ({ kind: 'gemini' as const, at: data.createdAt, data })),
      ...claude.map((data) => ({ kind: 'claude' as const, at: data.analyzed_at, data })),
    ];
    return merged.sort((a, b) => b.at.localeCompare(a.at));
  }, [gemini, claude]);

  /** 같은 종목·같은 날 두 AI 가 모두 분석한 경우의 일치 여부 */
  const agreement = useMemo(() => {
    const key = (sym: string, at: string) => `${sym}|${at.slice(0, 10)}`;
    const claudeByKey = new Map(claude.map((item) => [key(item.symbol, item.analyzed_at), item]));
    const pairs = gemini
      .map((item) => {
        const partner = claudeByKey.get(key(item.symbol, item.createdAt));
        return partner
          ? { symbol: item.symbol, agreed: directionOf(item.signal) === directionOf(partner.verdict) }
          : null;
      })
      .filter(Boolean) as { symbol: string; agreed: boolean }[];
    return pairs;
  }, [gemini, claude]);

  /**
   * 일괄 삭제.
   *
   * 지금 화면에 걸린 필터(현재 종목만)를 그대로 적용한다 — 화면에 보이는 것과
   * 지워지는 것이 다르면 사고가 난다. 그래서 확인 문구에도 범위를 적는다.
   */
  const removeMany = (source: 'all' | 'claude' | 'gemini') => {
    const scope = onlyThisSymbol && symbol ? symbol : null;
    const count =
      source === 'claude' ? claude.length : source === 'gemini' ? gemini.length : items.length;
    if (!count) return;

    const sourceLabel =
      source === 'claude' ? 'Claude 분석' : source === 'gemini' ? 'Gemini 분석' : '분석 결과';

    modal.confirm({
      title: `${sourceLabel} ${count}건 삭제`,
      message: `${scope ? `${scope} 종목의 ` : '전체 '}${sourceLabel} ${count}건을 모두 삭제합니다. 되돌릴 수 없으며, 삭제한 기록은 '분석 성적표' 집계에서도 빠집니다.`,
      confirmText: '삭제',
      danger: true,
      onConfirm: async () => {
        const query = new URLSearchParams({ source });
        if (scope) query.set('symbol', scope);
        try {
          const response = await fetch(`/api/analyses?${query}`, { method: 'DELETE' });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? '삭제에 실패했습니다.');
          toast.success(`${data.deleted}건 삭제 완료`);
          await load();
        } catch (e) {
          toast.error('삭제 실패', (e as Error).message);
        }
      },
    });
  };

  const removeGemini = async (id: number) => {
    const response = await fetch(`/api/gemini/analyses/${id}`, { method: 'DELETE' });
    if (response.ok) {
      setGemini((list) => list.filter((item) => item.id !== id));
      toast.success('분석을 삭제했습니다');
    } else {
      toast.error('삭제 실패');
    }
  };

  if (loading) return <SkeletonList count={4} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex w-fit items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={onlyThisSymbol}
            onChange={(e) => setOnlyThisSymbol(e.target.checked)}
            disabled={!symbol}
          />
          현재 종목만 {symbol ? `(${symbol})` : ''}
        </label>
        <span className="text-xs text-text-muted">
          총 {items.length}건 (Gemini {gemini.length} · Claude {claude.length})
        </span>
        {highlightSince && (
          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[11px] text-accent">
            방금 분석한 결과를 표시하고 있습니다
          </span>
        )}
        <button
          onClick={() => void load()}
          className="ml-auto text-xs text-accent hover:underline"
        >
          새로고침
        </button>
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => removeMany('all')}
            className="rounded border border-bearish/40 px-2 py-1 text-xs text-bearish transition-colors hover:bg-bearish/10"
          >
            🗑 전체 삭제 ({items.length})
          </button>
          <button
            onClick={() => removeMany('claude')}
            disabled={!claude.length}
            className="rounded border border-border px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary disabled:opacity-40"
          >
            Claude만 삭제 ({claude.length})
          </button>
          <button
            onClick={() => removeMany('gemini')}
            disabled={!gemini.length}
            className="rounded border border-border px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary disabled:opacity-40"
          >
            Gemini만 삭제 ({gemini.length})
          </button>
          {onlyThisSymbol && symbol && (
            <span className="text-[11px] text-text-muted">— {symbol} 종목만 지웁니다</span>
          )}
        </div>
      )}

      {agreement.length > 0 && (
        <div className="rounded-lg border border-border bg-bg-secondary p-3 text-xs">
          <p className="mb-1 font-medium text-text-primary">두 AI 가 같은 날 함께 본 종목</p>
          <div className="flex flex-wrap gap-2">
            {agreement.map((pair, index) => (
              <span
                key={`${pair.symbol}-${index}`}
                className={`rounded px-2 py-0.5 ${pair.agreed ? 'bg-bullish/15 text-bullish' : 'bg-warning/15 text-warning'}`}
              >
                {pair.symbol} {pair.agreed ? '의견 일치 ✅' : '의견 불일치 ⚠️'}
              </span>
            ))}
          </div>
        </div>
      )}

      {items.length === 0 && (
        <p className="rounded-lg border border-border bg-bg-secondary p-6 text-center text-sm text-text-muted">
          아직 분석 기록이 없습니다. '자동 분석' 탭에서 실행하거나, '수동 분석' 탭에서 Claude
          답변을 저장하세요.
        </p>
      )}

      {items.map((item) =>
        item.kind === 'gemini' ? (
          <GeminiAnalysisCard
            key={`g-${item.data.id}`}
            analysis={item.data}
            currentPrice={item.data.symbol === symbol ? currentPrice : null}
            isNew={highlightSince != null && Date.parse(item.at) >= highlightSince}
            onDelete={(id) => void removeGemini(id)}
          />
        ) : (
          <ClaudeCard
            key={`c-${item.data.id}`}
            record={item.data}
            currentPrice={item.data.symbol === symbol ? currentPrice : null}
            open={expanded === item.data.id}
            onToggle={() => setExpanded(expanded === item.data.id ? null : item.data.id)}
          />
        ),
      )}
    </div>
  );
}

function ClaudeCard({
  record,
  currentPrice,
  open,
  onToggle,
}: {
  record: ClaudeRecord;
  currentPrice: number | null;
  open: boolean;
  onToggle: () => void;
}) {
  const verdict = CLAUDE_VERDICT[record.verdict] ?? {
    label: record.verdict,
    className: 'text-text-secondary',
  };
  const change =
    currentPrice && record.price_at_analysis
      ? ((currentPrice - record.price_at_analysis) / record.price_at_analysis) * 100
      : null;

  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-3">
      <div className="flex flex-wrap items-center gap-2">
        <AISourceBadge source="claude" suffix="수동" />
        <StockName symbol={record.symbol} className="text-text-primary" />
        <span className={verdict.className}>{verdict.label}</span>
        <span className="text-xs text-text-muted">
          신뢰도 {CONFIDENCE_LABEL[record.confidence] ?? record.confidence}
        </span>
        <span className="ml-auto text-xs text-text-muted">
          {new Date(record.analyzed_at).toLocaleString('ko-KR')}
        </span>
      </div>

      <p className="mt-1.5 line-clamp-2 text-sm text-text-secondary">
        {record.synthesis.slice(0, 200)}
      </p>

      {record.price_at_analysis > 0 && (
        <p className="mt-1 text-xs text-text-muted">
          분석 시점 {formatUsd(record.price_at_analysis)}
          {change != null && (
            <span className={change >= 0 ? 'text-bullish' : 'text-bearish'}>
              {' '}
              → 현재 {change >= 0 ? '+' : ''}
              {change.toFixed(2)}%
            </span>
          )}
        </p>
      )}

      <button onClick={onToggle} className="mt-2 text-xs text-accent hover:underline">
        {open ? '접기' : '전문 보기'}
      </button>

      {open && (
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap border-t border-border pt-2 text-xs text-text-secondary">
          {record.synthesis}
        </pre>
      )}
    </div>
  );
}
