import { useEffect, useMemo, useState } from 'react';
import type { AccountStrategy, StrategyMode } from '../../types/autoTrading';
import type { SurgeDetection } from '../../types/surge';
import type { SwingRecord } from '../../types/swing';
import SymbolSearch from '../common/SymbolSearch';
import StockName from '../common/StockName';
import { useStockNames } from '../../hooks/useStockNames';
import { useWatchlist } from '../../hooks/useWatchlist';
import { toast } from '../../store/uiStore';

/**
 * 계좌별 자동매매 설정 패널.
 *
 * 흐름을 위에서 아래로 한 줄로 세운다 — **모드 → 종목 → 조건 → 청산 → 저장**.
 * 조건은 프리셋을 먼저 보여 주고 상세는 접어 둔다: 처음 쓰는 사람이 신뢰도·비중·종목 수를
 * 각각 정하려면 시작을 못 한다.
 *
 * ⚠️ 값 검증의 최종 권한은 **서버**다 (1단계 `normalizeStrategy`). 여기서는 범위를 힌트로만
 * 주고, 저장 응답으로 온 값을 그대로 화면에 되돌린다 — 두 곳에서 조이면 규칙이 갈라진다.
 */

interface Props {
  strategy: AccountStrategy;
  /** Gemini 키가 있는지 — 없으면 AI형을 고를 수 없다 */
  geminiEnabled: boolean;
  onSave: (patch: Partial<AccountStrategy>) => Promise<AccountStrategy>;
  onClose: () => void;
}

/** 조건 프리셋 — 1단계 기본값(중립)과 정합을 맞춘다 */
const PRESETS = [
  { id: 'safe', label: '보수', confidence: 0.8, size: 5, max: 3, hint: '신뢰도 80% · 비중 5% · 3종목' },
  { id: 'normal', label: '중립', confidence: 0.7, size: 10, max: 5, hint: '신뢰도 70% · 비중 10% · 5종목' },
  { id: 'bold', label: '공격', confidence: 0.6, size: 20, max: 8, hint: '신뢰도 60% · 비중 20% · 8종목' },
] as const;

const FIELD = 'w-24 rounded border border-border bg-bg-tertiary px-2 py-1 text-xs tabular-nums';
const LABEL = 'text-xs text-text-secondary';

export default function AutoTradeSettings({ strategy, geminiEnabled, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<AccountStrategy>(strategy);
  const [detailOpen, setDetailOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { watchlist } = useWatchlist();
  useStockNames(draft.symbols);

  // 바깥에서 값이 바뀌면(저장 응답 등) 따라간다.
  useEffect(() => setDraft(strategy), [strategy]);

  const patch = (change: Partial<AccountStrategy>) => setDraft((prev) => ({ ...prev, ...change }));

  const addSymbols = (symbols: string[], source: string) => {
    const merged = [...new Set([...draft.symbols, ...symbols.map((s) => s.toUpperCase())])];
    const added = merged.length - draft.symbols.length;
    patch({ symbols: merged });
    toast[added ? 'success' : 'info'](
      added ? `${source}에서 ${added}종목 담았습니다` : `${source}에서 새로 담을 종목이 없습니다`,
    );
  };

  /** 발굴 — 앱에 이미 있는 데이터를 그대로 가져온다 (새로 분석하지 않는다) */
  const pullFrom = async (source: 'surge' | 'swing' | 'watchlist') => {
    try {
      if (source === 'watchlist') {
        if (!watchlist.length) return toast.info('관심 목록이 비어 있습니다');
        return addSymbols(watchlist, '관심 목록');
      }
      if (source === 'surge') {
        const data = await fetch('/api/surge/results').then((r) => r.json());
        const rows: SurgeDetection[] = data.results ?? [];
        // 점수가 높은 쪽부터 — 등급이 낮은 것까지 담으면 대상이 금세 수십 개가 된다.
        const picked = rows
          .filter((r) => r.grade === 'HIGH' || r.grade === 'MEDIUM')
          .sort((a, b) => b.surgeScore - a.surgeScore)
          .slice(0, 10)
          .map((r) => r.symbol);
        if (!picked.length) return toast.info('급등 탐지 결과가 없습니다', '급등 탐지에서 먼저 분석해 보세요');
        return addSymbols(picked, '급등 탐지');
      }
      const data = await fetch('/api/swing/recommendations').then((r) => r.json());
      const rows: SwingRecord[] = data.records ?? [];
      const picked = rows.map((r) => r.symbol);
      if (!picked.length) return toast.info('저장된 스윙 추천이 없습니다', '스윙 추천에서 먼저 분석해 보세요');
      addSymbols(picked, '스윙 추천');
    } catch (e) {
      toast.error('종목을 가져오지 못했습니다', (e as Error).message);
    }
  };

  const applyPreset = (preset: (typeof PRESETS)[number]) =>
    patch({
      buyMinConfidence: preset.confidence,
      sellMinConfidence: preset.confidence,
      positionSizePercent: preset.size,
      maxPositions: preset.max,
    });

  const activePreset = useMemo(
    () =>
      PRESETS.find(
        (p) =>
          p.confidence === draft.buyMinConfidence &&
          p.size === draft.positionSizePercent &&
          p.max === draft.maxPositions,
      )?.id ?? null,
    [draft.buyMinConfidence, draft.positionSizePercent, draft.maxPositions],
  );

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      toast.success('자동매매 설정을 저장했습니다');
      onClose();
    } catch (e) {
      toast.error('저장하지 못했습니다', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const mode = (value: StrategyMode) => {
    if (value === 'ai' && !geminiEnabled) return;
    patch({ mode: value });
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[min(640px,85vh)] w-[min(680px,90vw)] flex-col overflow-hidden rounded-xl border border-border bg-bg-secondary shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">🤖 자동매매 설정</h2>
          <span className="rounded bg-warning/15 px-2 py-0.5 text-[10px] text-warning">
            모의 — 실제 주문은 나가지 않습니다
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="ml-auto text-text-muted transition-colors hover:text-text-primary"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {/* ① 모드 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-text-primary">① 판단 방식</h3>
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: 'ai' as const, title: 'AI형', desc: 'Gemini 5인 분석의 매수·매도 신호로 판단합니다' },
                { id: 'rule' as const, title: '규칙형', desc: '이동평균 교차와 RSI 로 판단합니다 (AI 키 불필요)' },
              ]).map((item) => {
                const disabled = item.id === 'ai' && !geminiEnabled;
                const active = draft.mode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => mode(item.id)}
                    className={`rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      active ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/50'
                    }`}
                  >
                    <p className={`text-xs font-medium ${active ? 'text-accent' : 'text-text-primary'}`}>
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">{item.desc}</p>
                  </button>
                );
              })}
            </div>
            {!geminiEnabled && (
              <p className="text-[11px] text-warning">
                ⚠️ Gemini 키가 설정되지 않았습니다 — 규칙형은 키 없이 동작합니다.
              </p>
            )}
          </section>

          {/* ② 대상 종목 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-text-primary">
              ② 대상 종목 <span className="font-normal text-text-muted">({draft.symbols.length}개)</span>
            </h3>

            <SymbolSearch
              symbol=""
              onSubmit={(s) => addSymbols([s], '검색')}
              placeholder="종목 검색해 담기 (애플, AAPL…)"
              submitLabel="담기"
              compact
              clearOnSubmit
              dropUp={false}
              isAdded={(candidate) => draft.symbols.includes(candidate)}
            />

            <div className="flex flex-wrap gap-1.5">
              <span className="text-[11px] text-text-muted">발굴해서 담기:</span>
              {([
                { id: 'surge' as const, label: '🔥 급등 탐지' },
                { id: 'swing' as const, label: '📈 스윙 추천' },
                { id: 'watchlist' as const, label: '★ 관심 목록' },
              ]).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => void pullFrom(s.id)}
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-text-secondary transition-colors hover:border-accent hover:text-accent"
                >
                  {s.label}
                </button>
              ))}
            </div>

            {draft.symbols.length === 0 ? (
              <p className="rounded border border-border bg-bg-tertiary/40 px-3 py-3 text-center text-[11px] text-text-muted">
                담긴 종목이 없습니다. 종목이 없으면 자동매매를 켤 수 없습니다.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {draft.symbols.map((symbol) => (
                  <span
                    key={symbol}
                    className="flex items-center gap-1 rounded-full border border-border bg-bg-tertiary/60 py-0.5 pl-2 pr-1 text-[11px]"
                  >
                    <StockName symbol={symbol} size="sm" className="text-text-primary" />
                    <button
                      type="button"
                      onClick={() => patch({ symbols: draft.symbols.filter((s) => s !== symbol) })}
                      aria-label={`${symbol} 빼기`}
                      className="rounded px-1 text-text-muted transition-colors hover:text-bearish"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* ③ 매매 조건 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-text-primary">③ 매매 조건</h3>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  title={preset.hint}
                  className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                    activePreset === preset.id
                      ? 'border-accent bg-accent/10 font-medium text-accent'
                      : 'border-border text-text-secondary hover:border-accent/50'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
              <span className="self-center text-[11px] text-text-muted">
                {PRESETS.find((p) => p.id === activePreset)?.hint ?? '직접 설정한 값'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setDetailOpen((v) => !v)}
              className="text-[11px] text-text-muted transition-colors hover:text-text-primary"
            >
              {detailOpen ? '▾ 상세 접기' : '▸ 상세 설정'}
            </button>

            {detailOpen && (
              <div className="space-y-2 rounded-md border border-border bg-bg-tertiary/30 p-3">
                <Row label="분석 주기 (분, 5 이상)">
                  <input
                    type="number"
                    min={5}
                    value={draft.intervalMinutes}
                    onChange={(e) => patch({ intervalMinutes: Number(e.target.value) })}
                    className={FIELD}
                  />
                </Row>
                <label className="inline-flex w-fit items-center gap-2 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    checked={draft.marketHoursOnly}
                    onChange={(e) => patch({ marketHoursOnly: e.target.checked })}
                  />
                  미국 정규장에만 실행 (청산은 시간과 무관하게 항상 검사합니다)
                </label>
                <Row label="종목당 비중 (%)">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={draft.positionSizePercent}
                    onChange={(e) => patch({ positionSizePercent: Number(e.target.value) })}
                    className={FIELD}
                  />
                </Row>
                <Row label="최대 보유 종목 수">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={draft.maxPositions}
                    onChange={(e) => patch({ maxPositions: Number(e.target.value) })}
                    className={FIELD}
                  />
                </Row>

                {draft.mode === 'ai' ? (
                  <>
                    <Row label="매수 신호">
                      <select
                        value={draft.buySignal}
                        onChange={(e) => patch({ buySignal: e.target.value as 'BUY' | 'STRONG_BUY' })}
                        className="rounded border border-border bg-bg-tertiary px-2 py-1 text-xs"
                      >
                        <option value="BUY">매수 이상</option>
                        <option value="STRONG_BUY">강력 매수만</option>
                      </select>
                    </Row>
                    <Row label="매수 최소 신뢰도 (0~1)">
                      <input
                        type="number" step={0.05} min={0} max={1}
                        value={draft.buyMinConfidence}
                        onChange={(e) => patch({ buyMinConfidence: Number(e.target.value) })}
                        className={FIELD}
                      />
                    </Row>
                    <Row label="매도 신호">
                      <select
                        value={draft.sellSignal}
                        onChange={(e) => patch({ sellSignal: e.target.value as 'SELL' | 'STRONG_SELL' })}
                        className="rounded border border-border bg-bg-tertiary px-2 py-1 text-xs"
                      >
                        <option value="SELL">매도 이상</option>
                        <option value="STRONG_SELL">강력 매도만</option>
                      </select>
                    </Row>
                    <Row label="매도 최소 신뢰도 (0~1)">
                      <input
                        type="number" step={0.05} min={0} max={1}
                        value={draft.sellMinConfidence}
                        onChange={(e) => patch({ sellMinConfidence: Number(e.target.value) })}
                        className={FIELD}
                      />
                    </Row>
                  </>
                ) : (
                  <>
                    <Row label="단기 이동평균">
                      <input
                        type="number" min={2}
                        value={draft.rule.maShort}
                        onChange={(e) => patch({ rule: { ...draft.rule, maShort: Number(e.target.value) } })}
                        className={FIELD}
                      />
                    </Row>
                    <Row label="장기 이동평균 (단기보다 커야 합니다)">
                      <input
                        type="number" min={3}
                        value={draft.rule.maLong}
                        onChange={(e) => patch({ rule: { ...draft.rule, maLong: Number(e.target.value) } })}
                        className={FIELD}
                      />
                    </Row>
                    <Row label="RSI 매수 기준 (이 값 이하에서 반등, 50 이하)">
                      <input
                        type="number" min={5} max={50}
                        value={draft.rule.rsiBuyBelow}
                        onChange={(e) => patch({ rule: { ...draft.rule, rsiBuyBelow: Number(e.target.value) } })}
                        className={FIELD}
                      />
                    </Row>
                    <Row label="RSI 매도 기준 (이 값 이상이면 매도)">
                      <input
                        type="number" min={50} max={95}
                        value={draft.rule.rsiSellAbove}
                        onChange={(e) => patch({ rule: { ...draft.rule, rsiSellAbove: Number(e.target.value) } })}
                        className={FIELD}
                      />
                    </Row>
                    <p className="text-[11px] leading-relaxed text-text-muted">
                      지표 엔진이 주는 이동평균은 5·20·60·120 입니다. 다른 값을 넣으면 가장 가까운
                      기간으로 맞추고, 실제로 쓴 기간을 거래 사유에 적습니다.
                    </p>
                  </>
                )}
              </div>
            )}
          </section>

          {/* ④ 청산 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-text-primary">④ 청산</h3>
            <Row label="하드 손절 (%)">
              <input
                type="number" min={1} max={50}
                value={draft.hardStopLossPercent}
                onChange={(e) => patch({ hardStopLossPercent: Number(e.target.value) })}
                className={FIELD}
              />
              <span className="text-[11px] text-text-muted">
                평균 매수가 대비 -{draft.hardStopLossPercent}% 에서 전량 청산
              </span>
            </Row>
            <p className="text-[11px] leading-relaxed text-text-muted">
              분석 주기와 무관하게 <span className="text-text-secondary">1분마다</span> 검사하는
              안전망입니다 — 급락은 다음 분석을 기다려 주지 않습니다.
            </p>

            <label className="inline-flex w-fit items-center gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={draft.trailingStopEnabled}
                onChange={(e) => patch({ trailingStopEnabled: e.target.checked })}
              />
              트레일링 스톱 사용
            </label>
            {draft.trailingStopEnabled && (
              <Row label="고점 대비 하락 (%)">
                <input
                  type="number" min={1} max={50}
                  value={draft.trailingStopPercent}
                  onChange={(e) => patch({ trailingStopPercent: Number(e.target.value) })}
                  className={FIELD}
                />
              </Row>
            )}

            <p className="rounded border border-border bg-bg-tertiary/40 px-3 py-2 text-[11px] leading-relaxed text-text-muted">
              💡 <span className="text-text-secondary">익절은 고정하지 않습니다.</span> 추세가 살아
              있으면 계속 들고 가도록 {draft.mode === 'ai' ? 'AI 가 매 주기 보유 종목을 다시 평가해' : '데드크로스·RSI 과열 규칙으로'}{' '}
              팔 때를 정합니다.
            </p>
          </section>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
          <span className="text-[11px] text-text-muted">
            값의 허용 범위는 저장할 때 서버가 다시 한 번 조입니다.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`${LABEL} min-w-[14rem]`}>{label}</span>
      {children}
    </div>
  );
}
