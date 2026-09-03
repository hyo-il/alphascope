import { useEffect, useState } from 'react';
import type { AnalysisPeriod, SurgeSettings as Settings } from '../../types/surge';
import { toast } from '../../store/uiStore';
import { useSurgeSettings } from '../../hooks/useSurge';

const PERIODS: { id: AnalysisPeriod; label: string }[] = [
  { id: '3mo', label: '3개월' },
  { id: '6mo', label: '6개월' },
  { id: '1y', label: '1년' },
];

/**
 * 탐지 조건 설정.
 *
 * 값은 서버에서도 한 번 더 조인다(surgeStore.saveSettings) — 화면 입력만 믿으면
 * 거래량 0% 같은 값이 그대로 들어가 모든 종목이 급등으로 잡힌다.
 */
export default function SurgeSettings({ watchlistCount }: { watchlistCount: number }) {
  const { settings, error, save } = useSurgeSettings();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  if (error) {
    return (
      <p className="rounded border border-bearish/40 bg-bearish/10 px-3 py-2 text-[11px] text-bearish">
        {error}
      </p>
    );
  }
  if (!draft) return <p className="text-xs text-text-muted">설정을 불러오는 중…</p>;

  const patch = (change: Partial<Settings>) => setDraft({ ...draft, ...change });

  const submit = async () => {
    setSaving(true);
    try {
      const saved = await save(draft);
      setDraft(saved);
      toast.success('설정을 저장했습니다', '다음 분석부터 적용됩니다.');
    } catch (e) {
      toast.error('저장 실패', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg space-y-4 text-xs">
      <section className="space-y-2">
        <h3 className="font-semibold text-text-secondary">급등 판정 기준</h3>
        <Field label="가격 변동 (% 이상)">
          <input
            type="number"
            step={0.5}
            min={0.5}
            max={50}
            value={draft.priceThreshold}
            onChange={(e) => patch({ priceThreshold: Number(e.target.value) })}
            className="w-24 rounded px-2 py-1"
          />
        </Field>
        <Field label="거래량 (% 이상, 20일 평균 대비)">
          <input
            type="number"
            step={10}
            min={100}
            max={2000}
            value={draft.volumeThreshold}
            onChange={(e) => patch({ volumeThreshold: Number(e.target.value) })}
            className="w-24 rounded px-2 py-1"
          />
        </Field>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold text-text-secondary">주기성 판정</h3>
        <Field label="최소 급등 횟수">
          <input
            type="number"
            min={2}
            max={20}
            value={draft.minSurgeCount}
            onChange={(e) => patch({ minSurgeCount: Number(e.target.value) })}
            className="w-24 rounded px-2 py-1"
          />
        </Field>
        <Field label="분석 기간">
          <select
            value={draft.analysisPeriod}
            onChange={(e) => patch({ analysisPeriod: e.target.value as AnalysisPeriod })}
            className="rounded px-2 py-1"
          >
            {PERIODS.map((period) => (
              <option key={period.id} value={period.id}>
                {period.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="규칙성 기준 (% 이상)">
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={draft.regularityThreshold}
            onChange={(e) => patch({ regularityThreshold: Number(e.target.value) })}
            className="w-24 rounded px-2 py-1"
          />
        </Field>
        <p className="text-[11px] text-text-muted">
          규칙성 = 100 × (1 − 표준편차/평균). 50% 는 "표준편차가 평균의 절반 이하" 와 같은 선입니다.
        </p>
      </section>

      <section className="space-y-1.5">
        <h3 className="font-semibold text-text-secondary">분석 대상</h3>
        <label className="inline-flex w-fit items-center gap-2">
          <input
            type="checkbox"
            checked={draft.usePreset}
            onChange={(e) => patch({ usePreset: e.target.checked })}
          />
          <span>미국 주요 종목 (S&P 500 상위 50)</span>
        </label>
        <br />
        <label className="inline-flex w-fit items-center gap-2">
          <input
            type="checkbox"
            checked={draft.useWatchlist}
            onChange={(e) => patch({ useWatchlist: e.target.checked })}
          />
          <span>내 관심 목록 ({watchlistCount}개)</span>
        </label>
        <p className="text-[11px] text-text-muted">
          토스 랭킹 상위는 대상에 넣지 않았습니다 — 랭킹은 Rate Limit 소모가 크고 하루에도 여러 번
          바뀌는데, 주기성은 몇 달을 두고 봐야 하는 성질이라 고정 종목군이 더 맞습니다.
        </p>
      </section>

      <section className="space-y-1">
        <h3 className="font-semibold text-text-secondary">데이터 소스</h3>
        <p className="text-[11px] text-text-muted">
          과거 일봉은 <span className="text-text-secondary">yfinance</span> 를 씁니다 (24시간 캐시).
          토스 <code>/candles</code> 는 200봉씩 페이지네이션이라 수십 종목 × 6개월을 받으려면
          왕복이 수백 번이 됩니다. 현재가·호가 등 실시간 데이터는 그대로 토스 API 입니다.
        </p>
      </section>

      <button
        type="button"
        onClick={submit}
        disabled={saving}
        className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        {saving ? '저장 중…' : '설정 저장'}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-56 text-text-secondary">{label}</span>
      {children}
    </div>
  );
}
