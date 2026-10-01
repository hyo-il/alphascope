import { useCallback, useEffect, useRef, useState } from 'react';
import { useGeminiStatus } from '../../../hooks/useGemini';
import type { NewsAnalysis, NewsList, OverallSentiment } from '../../../types/news';

/**
 * 차트 하단 「뉴스」 탭 (v2.18.0) — 이 종목의 최신 뉴스 10건 + 버튼을 눌렀을 때만 AI 긍정/부정.
 *
 * - 목록은 `GET /api/news?symbol=`(서버 30분 캐시). 제목을 누르면 원문이 새 탭으로 열린다.
 * - ⚠️ AI 판정은 **[AI 요약·판정] 버튼으로만** 부른다(무료 한도를 자동매매와 함께 쓴다).
 *   입력은 제목·발행처·시각·링크뿐이고, 서버가 인용 번호를 검증한다 — 범위 밖 번호는 버리고 개수만 알린다.
 * - ⚠️ 자동매매와 연결되어 있지 않다. 참고용이다.
 */

const SENTIMENT_STYLE: Record<OverallSentiment, string> = {
  긍정: 'border-bullish/50 bg-bullish/15 text-bullish',
  부정: 'border-bearish/50 bg-bearish/15 text-bearish',
  중립: 'border-border bg-bg-tertiary text-text-secondary',
  '판단 불가': 'border-border bg-bg-tertiary text-text-muted',
};

function Badge({ value }: { value: OverallSentiment }) {
  return (
    <span className={`shrink-0 rounded border px-1.5 py-px text-[12px] font-medium ${SENTIMENT_STYLE[value]}`}>{value}</span>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return '시각 미상';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '시각 미상';
  const min = Math.round((Date.now() - t) / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  if (min < 24 * 60) return `${Math.round(min / 60)}시간 전`;
  return new Date(t).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

export default function NewsPanel({ symbol }: { symbol: string }) {
  const [news, setNews] = useState<NewsList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<NewsAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const { state: gemini } = useGeminiStatus(0);
  const sequence = useRef(0);
  const itemRefs = useRef(new Map<number, HTMLLIElement>());

  useEffect(() => {
    const mine = ++sequence.current;
    setNews(null);
    setError(null);
    setAnalysis(null);
    setAnalyzeError(null);
    fetch(`/api/news?symbol=${encodeURIComponent(symbol)}`)
      .then(async (r) => {
        const payload = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(payload.error ?? `요청 실패 (${r.status})`);
        if (mine === sequence.current) setNews(payload as NewsList);
      })
      .catch((e: Error) => mine === sequence.current && setError(e.message));
  }, [symbol]);

  const analyze = useCallback(async () => {
    const mine = sequence.current;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const r = await fetch('/api/news/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      const payload = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(payload.error ?? `요청 실패 (${r.status})`);
      if (mine === sequence.current) {
        const result = payload as NewsAnalysis;
        setAnalysis(result);
        setNews(result.news); // 판정한 목록과 번호가 어긋나지 않게 같은 목록을 보여 준다
      }
    } catch (e) {
      if (mine === sequence.current) setAnalyzeError((e as Error).message);
    } finally {
      if (mine === sequence.current) setAnalyzing(false);
    }
  }, [symbol]);

  const jumpTo = (index: number) => itemRefs.current.get(index)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  const byIndex = new Map(analysis?.judgment.articles.map((a) => [a.index, a]) ?? []);
  const disabledReason = gemini && !gemini.enabled ? gemini.reason ?? 'Gemini 를 쓸 수 없습니다.' : null;
  const canAnalyze = !!news?.items.length && !analyzing && !!gemini?.enabled;

  return (
    <div className="flex flex-col gap-2 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void analyze()}
          disabled={!canAnalyze}
          className="rounded border border-accent/60 bg-accent/10 px-2.5 py-1 text-[12px] font-medium text-accent disabled:border-border disabled:bg-transparent disabled:text-text-muted"
        >
          {analyzing ? 'AI 판정 중…' : '🤖 AI 요약·판정'}
        </button>
        <span className="text-[12px] text-text-muted">
          {disabledReason
            ? `버튼이 꺼져 있습니다 — ${disabledReason}`
            : '누를 때만 Gemini 를 1회 부릅니다. 기사 제목만 보냅니다.'}
        </span>
      </div>

      {analyzeError && (
        <p className="rounded border border-bearish/40 bg-bearish/10 px-2 py-1 text-[12px] text-bearish">{analyzeError}</p>
      )}

      {analysis && (
        <section className="rounded border border-border bg-bg-secondary p-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[12px] font-semibold text-text-primary">종합</span>
            <Badge value={analysis.judgment.overall} />
            {analysis.judgment.citedIndexes.length > 0 && (
              <span className="text-[12px] text-text-muted">
                근거:{' '}
                {analysis.judgment.citedIndexes.map((i) => (
                  <button key={i} type="button" onClick={() => jumpTo(i)} className="mr-1 text-accent hover:underline">
                    [{i}]
                  </button>
                ))}
              </span>
            )}
          </div>
          {analysis.judgment.summary && <p className="leading-relaxed text-text-secondary">{analysis.judgment.summary}</p>}
          {analysis.judgment.dropped > 0 && (
            <p className="mt-1 text-[12px] text-warning">
              ⚠ 검증 실패 항목 {analysis.judgment.dropped}개 제외 (목록에 없는 기사 번호를 인용했습니다)
            </p>
          )}
          <p className="mt-1 text-[12px] text-text-muted">
            참고용 — 투자 조언이 아닙니다. 제목만 보고 판단했습니다. · {analysis.model} · {analysis.promptVersion}
          </p>
        </section>
      )}

      {error && <p className="text-[12px] text-bearish">뉴스를 불러오지 못했습니다: {error}</p>}
      {!news && !error && <p className="text-[12px] text-text-muted">뉴스를 불러오는 중…</p>}
      {news && news.items.length === 0 && (
        <p className="text-[12px] text-text-muted">
          뉴스 없음 — 이 종목과 연결된 최근 기사가 yfinance 에 없습니다
          {/^\d/.test(symbol) ? ' (국내 종목은 대개 비어 있습니다).' : '.'}
        </p>
      )}

      {news && news.items.length > 0 && (
        <ol className="flex flex-col divide-y divide-border rounded border border-border">
          {news.items.map((item, i) => {
            const index = i + 1;
            const judged = byIndex.get(index);
            const cited = analysis?.judgment.citedIndexes.includes(index);
            return (
              <li
                key={item.link}
                ref={(el) => {
                  if (el) itemRefs.current.set(index, el);
                  else itemRefs.current.delete(index);
                }}
                className={`flex gap-2 px-2 py-1.5 ${cited ? 'bg-accent/5' : ''}`}
              >
                <span className="w-5 shrink-0 pt-px text-right tabular-nums text-text-muted">[{index}]</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-1.5">
                    {judged && <Badge value={judged.sentiment} />}
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-text-primary hover:text-accent hover:underline"
                    >
                      {item.title}
                    </a>
                  </div>
                  <p className="text-[12px] text-text-muted">
                    {item.publisher ?? '발행처 미상'} · {timeAgo(item.publishedAt)}
                  </p>
                  {judged && <p className="text-[12px] text-text-secondary">↳ {judged.reason}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {news && (
        <p className="text-[12px] text-text-muted">
          출처: Yahoo Finance(yfinance) · 30분마다 새로 받습니다 ·{' '}
          {new Date(news.fetchedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준
        </p>
      )}
    </div>
  );
}
