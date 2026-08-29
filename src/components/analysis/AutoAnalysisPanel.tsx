import { useEffect, useState } from 'react';
import type { AutoAnalysisSettings } from '../../types/gemini';
import { HORIZONS, type InvestmentHorizon } from '../../services/analysis/horizons';
import { useGeminiStatus } from '../../hooks/useGemini';
import { useRecentSymbols, useWatchlist } from '../../hooks/useWatchlist';
import { toast } from '../../store/uiStore';
import SymbolTagInput from '../common/SymbolTagInput';
import { Skeleton } from '../common/SkeletonLoader';
import GeminiDisabledNotice from './GeminiDisabledNotice';
import type { AnalysisRunResult } from './AIAnalysisView';

/**
 * 자동 분석 설정 — **무엇을 언제 어떤 관점으로 분석할지**.
 *
 * 매매 조건(신호·신뢰도·금액·한도)은 `AutoTradePanel` 로 뺐다.
 * 돈이 움직이는 설정과 분석 설정을 한 화면에 쌓아 두면, 정작 중요한 자동매매
 * 스위치가 스크롤 아래로 밀려 보이지 않는다.
 */
export default function AutoAnalysisPanel({
  symbol,
  onAnalyzed,
}: {
  symbol: string | null;
  onAnalyzed?: (result: AnalysisRunResult) => void;
}) {
  const { state, save, refresh } = useGeminiStatus();
  const { watchlist } = useWatchlist();
  // 빈 문자열을 넘겨 "지금 보는 종목" 을 최근 목록에 새로 넣지 않는다 — 읽기만 한다.
  const { recent } = useRecentSymbols('');
  const [draft, setDraft] = useState<AutoAnalysisSettings | null>(null);
  /** 진행 상황 — "AAPL 분석 중… (2/5)" */
  const [progress, setProgress] = useState<{ current: number; total: number; symbol: string } | null>(
    null,
  );
  const [single, setSingle] = useState(false);

  useEffect(() => {
    if (state?.settings && !draft) setDraft(state.settings);
  }, [state, draft]);

  if (!state) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }

  if (!state.enabled) return <GeminiDisabledNotice />;

  const settings = draft ?? state.settings!;
  const busy = progress !== null || single;

  const patch = (change: Partial<AutoAnalysisSettings>) => setDraft({ ...settings, ...change });

  const persist = async (change: Partial<AutoAnalysisSettings>) => {
    const next = { ...settings, ...change };
    setDraft(next);
    try {
      await save(next);
    } catch (e) {
      toast.error('설정 저장 실패', (e as Error).message);
    }
  };

  /** 한 종목 분석 — 진행률을 보여 주려고 서버의 일괄 실행 대신 종목별로 부른다. */
  const analyzeOne = async (target: string) => {
    const response = await fetch('/api/gemini/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symbol: target, horizon: settings.horizon }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? '분석 실패');
    return data;
  };

  const analyzeCurrent = async () => {
    if (!symbol) return;
    const since = Date.now();
    setSingle(true);
    try {
      const data = await analyzeOne(symbol);
      toast.success(`${symbol} 분석 완료 — ${data.signal}`, data.summary);
      // 결과 탭으로 데려간다 — 이 자리에 남으면 아무 일도 없어 보인다.
      onAnalyzed?.({ scope: 'single', since });
      void refresh();
    } catch (e) {
      toast.error(`${symbol} 분석 실패`, (e as Error).message);
    } finally {
      setSingle(false);
    }
  };

  const analyzeAll = async () => {
    const targets = settings.symbols;
    if (!targets.length) return;

    const since = Date.now();
    const failures: string[] = [];
    for (const [index, target] of targets.entries()) {
      setProgress({ current: index + 1, total: targets.length, symbol: target });
      try {
        await analyzeOne(target);
      } catch (e) {
        // 한 종목이 실패해도 나머지는 계속 돌린다 — 성공한 결과는 그대로 남는다.
        failures.push(`${target}: ${(e as Error).message}`);
      }
    }
    setProgress(null);
    void refresh();

    const done = targets.length - failures.length;
    const headline =
      targets.length > 1 ? `${targets[0]} 외 ${targets.length - 1}개 종목 분석 완료` : `${targets[0]} 분석 완료`;

    if (failures.length === targets.length) {
      toast.error('분석에 모두 실패했습니다', failures.join(' / '));
      return;
    }
    if (failures.length) toast.warning(`${done}개 완료 · ${failures.length}개 실패`, failures.join(' / '));
    else toast.success(headline);

    // 여러 종목을 돌렸으므로 결과 탭의 '현재 종목만' 필터를 풀어야 방금 것이 보인다.
    onAnalyzed?.({ scope: 'all', since });
  };

  // 1종목 = 5호출. 정규장 6.5시간 기준으로 하루 호출 수를 어림한다.
  const runsPerDay = Math.max(1, Math.floor((6.5 * 60) / settings.intervalMinutes));
  const estimatedCalls = settings.symbols.length * 5 * runsPerDay;

  return (
    <div className="space-y-4">
      {/* 상태 + 실행 */}
      <div className="rounded-lg border border-border bg-bg-secondary p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-text-primary">자동 분석</span>
          <span className="rounded bg-bg-tertiary px-2 py-0.5 text-[11px] text-text-secondary">
            {state.model}
          </span>
          <label className="ml-auto inline-flex w-fit items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => void persist({ enabled: e.target.checked })}
            />
            주기 실행 켜기
          </label>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-secondary sm:grid-cols-4">
          <div>
            <dt className="text-text-muted">상태</dt>
            <dd>{state.status?.running ? '분석 중…' : settings.enabled ? '대기 중' : '꺼짐'}</dd>
          </div>
          <div>
            <dt className="text-text-muted">마지막 실행</dt>
            <dd>
              {state.status?.lastRunAt
                ? new Date(state.status.lastRunAt).toLocaleString('ko-KR')
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-text-muted">다음 실행</dt>
            <dd>
              {state.status?.nextRunAt
                ? new Date(state.status.nextRunAt).toLocaleTimeString('ko-KR')
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-text-muted">오늘 호출</dt>
            <dd>{state.status?.callsToday ?? 0}회</dd>
          </div>
        </dl>

        {state.status?.lastError && (
          <p className="mt-2 rounded bg-bearish/10 p-2 text-xs text-bearish">
            마지막 오류: {state.status.lastError}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={analyzeAll}
            disabled={busy || !settings.symbols.length}
            title={settings.symbols.length ? undefined : '아래에서 종목을 추가하세요'}
            className="rounded bg-accent px-3 py-1.5 text-sm text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            ▶ 전체 종목 분석 ({settings.symbols.length}개)
          </button>
          <button
            onClick={analyzeCurrent}
            disabled={busy || !symbol}
            title={symbol ? undefined : '차트에서 종목을 먼저 고르세요'}
            className="rounded border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-tertiary disabled:opacity-40"
          >
            ▶ {symbol ? `${symbol} 분석` : '단일 종목 분석'}
          </button>

          {progress && (
            <span className="text-xs text-accent">
              {progress.symbol} 분석 중… ({progress.current}/{progress.total})
            </span>
          )}
          {single && symbol && <span className="text-xs text-accent">{symbol} 분석 중…</span>}
        </div>

        {!settings.symbols.length && (
          <p className="mt-2 text-xs text-text-muted">
            '전체 종목 분석' 을 쓰려면 아래에서 종목을 먼저 추가하세요.
          </p>
        )}
      </div>

      {/* 대상 종목 */}
      <div className="rounded-lg border border-border bg-bg-secondary p-4">
        <p className="mb-2 text-sm font-medium text-text-primary">분석 대상 종목</p>
        <SymbolTagInput
          symbols={settings.symbols}
          onChange={(symbols) => void persist({ symbols })}
          watchlist={watchlist}
          recent={recent}
        />
      </div>

      {/* 투자 기간 */}
      <div className="rounded-lg border border-border bg-bg-secondary p-4">
        <p className="mb-1 text-sm font-medium text-text-primary">투자 기간</p>
        <p className="mb-3 text-xs text-text-muted">
          같은 차트라도 1주와 6개월은 다른 질문입니다. 네 에이전트가 이 시간축으로 판단합니다.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {HORIZONS.map((item) => (
            <button
              key={item.id}
              onClick={() => void persist({ horizon: item.id as InvestmentHorizon })}
              className={`rounded border px-3 py-1.5 text-xs transition-colors ${
                settings.horizon === item.id
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border text-text-secondary hover:bg-bg-tertiary'
              }`}
            >
              <span className="block font-medium">{item.label}</span>
              <span className="block text-[10px] text-text-muted">{item.period}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 주기 */}
      <div className="rounded-lg border border-border bg-bg-secondary p-4">
        <p className="mb-3 text-sm font-medium text-text-primary">실행 주기</p>
        <div className="flex flex-wrap items-center gap-4 text-sm text-text-secondary">
          <label className="inline-flex w-fit items-center gap-2">
            <input
              type="number"
              min={5}
              value={settings.intervalMinutes}
              onChange={(e) => patch({ intervalMinutes: Number(e.target.value) })}
              onBlur={() => void persist({ intervalMinutes: settings.intervalMinutes })}
              className="w-20 rounded border border-border bg-bg-tertiary px-2 py-1 text-text-primary"
            />
            분마다
          </label>
          <label className="inline-flex w-fit items-center gap-2">
            <input
              type="checkbox"
              checked={settings.marketHoursOnly}
              onChange={(e) => void persist({ marketHoursOnly: e.target.checked })}
            />
            미국 정규장에만 실행
          </label>
        </div>
        <p className="mt-2 text-xs text-text-muted">
          1종목 분석 = API 5회(에이전트 4 + 종합 1). 현재 설정이면 하루 약{' '}
          <strong className="text-text-secondary">{estimatedCalls.toLocaleString()}회</strong>
          {estimatedCalls > 1200 && (
            <span className="text-warning">
              {' '}
              — 무료 한도(1,500회)에 근접합니다. 주기를 늘리거나 종목을 줄이세요.
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
