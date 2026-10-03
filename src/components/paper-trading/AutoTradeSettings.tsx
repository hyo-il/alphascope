import WarnIcon from '../ui/WarnIcon';
import { ICON_SM } from '../ui/icon';
import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AccountStrategy, StrategyMode } from '../../types/autoTrading';
import RuleChoices from './RuleChoices';
import TargetSymbolsEditor from './TargetSymbolsEditor';
import ModePicker from './ModePicker';
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
  /**
   * 저장 뒤 토스트 (v2.32.0) — 처음 켜기 안내는 이 창의 값을 서버에 저장하지 않고 안내로 되돌려 받는다
   * ([켜기] 를 눌러야 저장된다). 그 경우 "저장했습니다" 라고 말하면 거짓이 된다.
   */
  doneMessage?: string;
  /** 저장 버튼 글자 — 기본 「저장」 */
  saveLabel?: string;
}

/** 조건 프리셋 — 1단계 기본값(중립)과 정합을 맞춘다 */
const PRESETS = [
  { id: 'safe', label: '보수', confidence: 0.8, size: 5, max: 3, hint: '신뢰도 80% · 비중 5% · 3종목' },
  { id: 'normal', label: '중립', confidence: 0.7, size: 10, max: 5, hint: '신뢰도 70% · 비중 10% · 5종목' },
  { id: 'bold', label: '공격', confidence: 0.6, size: 20, max: 8, hint: '신뢰도 60% · 비중 20% · 8종목' },
] as const;

const FIELD = 'w-24 rounded border border-border bg-bg-tertiary px-2 py-1 text-xs tabular-nums';
const LABEL = 'text-xs text-text-secondary';

export default function AutoTradeSettings({
  strategy,
  geminiEnabled,
  onSave,
  onClose,
  doneMessage = '자동매매 설정을 저장했습니다',
  saveLabel = '저장',
}: Props) {
  const [draft, setDraft] = useState<AccountStrategy>(strategy);
  const [detailOpen, setDetailOpen] = useState(false);
  const [ruleDetailOpen, setRuleDetailOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // 바깥에서 값이 바뀌면(저장 응답 등) 따라간다.
  useEffect(() => setDraft(strategy), [strategy]);

  const patch = (change: Partial<AccountStrategy>) => setDraft((prev) => ({ ...prev, ...change }));

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
      toast.success(doneMessage);
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
      <div className="flex h-[min(640px,85vh)] w-[min(680px,90vw)] flex-col overflow-hidden rounded-xl bg-bg-secondary shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">자동매매 설정</h2>
          <span className="rounded bg-warning/15 px-2 py-0.5 text-[13px] text-warning">
            모의 — 실제 주문은 나가지 않습니다
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="ml-auto text-text-muted transition-colors hover:text-text-primary"
          >
            <X {...ICON_SM} />
          </button>
        </div>

        {/*
          ⚠️ `scrollbar-gutter: stable` 이 필요하다. 트레일링 스톱을 켜면 입력 한 줄이 늘어
          스크롤바가 생기는데, 그 순간 안쪽 폭이 줄면서 **패널 전체가 옆으로 튄다** —
          체크박스를 껐다 켰다 하면 화면이 흔들린다. 자리를 미리 비워 두면 움직이지 않는다.
        */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 [scrollbar-gutter:stable]">
          {/* ① 모드 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-text-primary">① 판단 방식</h3>
            <ModePicker mode={draft.mode} onMode={mode} geminiEnabled={geminiEnabled} />
          </section>

          {/* ② 대상 종목 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-text-primary">
              ② 대상 종목 <span className="font-normal text-text-muted">({draft.symbols.length}개)</span>
            </h3>

            <TargetSymbolsEditor
              symbols={draft.symbols}
              onChange={(symbols) => patch({ symbols })}
              maxPositions={draft.maxPositions}
              marketHoursOnly={draft.marketHoursOnly}
            />
          </section>

          {/* ③ 매매 조건 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-text-primary">③ 매매 조건</h3>
            {draft.mode === 'rule' && (
              <>
                <RuleChoices
                  rule={draft.rule}
                  onChange={(rule) => patch({ rule })}
                  symbols={draft.symbols}
                  hardStopLossPercent={draft.hardStopLossPercent}
                  trailingStopEnabled={draft.trailingStopEnabled}
                  trailingStopPercent={draft.trailingStopPercent}
                />
                <button
                  type="button"
                  onClick={() => setRuleDetailOpen((v) => !v)}
                  className="text-[13px] text-text-muted transition-colors hover:text-text-primary"
                >
                  {ruleDetailOpen ? '자세히 접기' : '자세히 — 숫자 직접 고치기'}
                </button>
                {ruleDetailOpen && (
                  <div className="space-y-2 rounded-md border border-border bg-bg-tertiary/30 p-3">
                    <label className="inline-flex w-fit items-center gap-2 text-xs text-text-secondary">
                      <input
                        type="checkbox"
                        checked={draft.rule.useMaCross}
                        onChange={(e) => patch({ rule: { ...draft.rule, useMaCross: e.target.checked } })}
                      />
                      이동평균 교차 사용
                    </label>
                    <p className="-mt-1 text-[13px] text-text-muted">짧은 평균선이 긴 평균선을 넘으면 사고, 아래로 내려가면 팝니다.</p>
                    <Row label="단기 이동평균">
                      <input
                        type="number" min={2}
                        value={draft.rule.maShort}
                        onChange={(e) => patch({ rule: { ...draft.rule, maShort: Number(e.target.value) } })}
                        className={FIELD}
                      />
                      <span className="text-[13px] text-text-muted">최근 며칠의 평균 가격 — 작을수록 빨리 반응합니다</span>
                    </Row>
                    <Row label="장기 이동평균 (단기보다 커야 합니다)">
                      <input
                        type="number" min={3}
                        value={draft.rule.maLong}
                        onChange={(e) => patch({ rule: { ...draft.rule, maLong: Number(e.target.value) } })}
                        className={FIELD}
                      />
                      <span className="text-[13px] text-text-muted">더 긴 기간의 평균 — 큰 흐름의 기준선입니다</span>
                    </Row>
                    <label className="inline-flex w-fit items-center gap-2 text-xs text-text-secondary">
                      <input
                        type="checkbox"
                        checked={draft.rule.useRsi}
                        onChange={(e) => patch({ rule: { ...draft.rule, useRsi: e.target.checked } })}
                      />
                      RSI 사용
                    </label>
                    <p className="-mt-1 text-[13px] text-text-muted">RSI 는 최근 오른 힘과 내린 힘의 비율입니다(0~100, 낮을수록 많이 떨어진 상태).</p>
                    <Row label="RSI 매수 기준 (이 값 이하에서 반등, 50 이하)">
                      <input
                        type="number" min={5} max={50}
                        value={draft.rule.rsiBuyBelow}
                        onChange={(e) => patch({ rule: { ...draft.rule, rsiBuyBelow: Number(e.target.value) } })}
                        className={FIELD}
                      />
                      <span className="text-[13px] text-text-muted">낮출수록 더 많이 떨어진 뒤에만 삽니다(기회는 줄어듭니다)</span>
                    </Row>
                    <Row label="RSI 매도 기준 (이 값 이상이면 매도)">
                      <input
                        type="number" min={50} max={95}
                        value={draft.rule.rsiSellAbove}
                        onChange={(e) => patch({ rule: { ...draft.rule, rsiSellAbove: Number(e.target.value) } })}
                        className={FIELD}
                      />
                      <span className="text-[13px] text-text-muted">높일수록 더 오래 들고 갑니다</span>
                    </Row>
                    {!draft.rule.useMaCross && !draft.rule.useRsi && (
                      <p className="text-[13px] text-warning"><WarnIcon />둘 다 끄면 매수 신호가 나지 않습니다(손절·트레일링만 동작).</p>
                    )}
                    <p className="text-[13px] leading-relaxed text-text-muted">
                      지표 엔진이 주는 이동평균은 5·20·60·120 입니다. 다른 값을 넣으면 가장 가까운
                      기간으로 맞추고, 실제로 쓴 기간을 거래 사유에 적습니다. 판단은 전날 마감한 일봉 기준입니다.
                    </p>
                  </div>
                )}
              </>
            )}
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
              <span className="self-center text-[13px] text-text-muted">
                {PRESETS.find((p) => p.id === activePreset)?.hint ?? '직접 설정한 값'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setDetailOpen((v) => !v)}
              className="text-[13px] text-text-muted transition-colors hover:text-text-primary"
            >
              {detailOpen ? '상세 접기' : '상세 설정'}
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
                ) : null}
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
              <span className="text-[13px] text-text-muted">
                평균 매수가 대비 -{draft.hardStopLossPercent}% 에서 전량 청산
              </span>
            </Row>
            <p className="text-[13px] leading-relaxed text-text-muted">
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

            <p className="rounded border border-border bg-bg-tertiary/40 px-3 py-2 text-[13px] leading-relaxed text-text-muted">
              <span className="text-text-secondary">익절은 고정하지 않습니다.</span> 추세가 살아
              있으면 계속 들고 가도록 {draft.mode === 'ai' ? 'AI 가 매 주기 보유 종목을 다시 평가해' : '데드크로스·RSI 과열 규칙으로'}{' '}
              팔 때를 정합니다.
            </p>
          </section>

          {/*
            ⑤ 신규 매수 안전장치 (v2.16.0) — 둘 다 **새로 사는 것만** 막는다. 손절·청산은 그대로 돈다.
            값은 앱의 출발값이지 검증된 권장값이 아니다 — 권장값을 적지 않는다.
          */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-text-primary">⑤ 신규 매수 안전장치</h3>
            <Row label="실적 발표 전 (거래일)">
              <input
                type="number" min={0} max={10} step={1}
                value={draft.earningsBlackoutDays}
                onChange={(e) => patch({ earningsBlackoutDays: Number(e.target.value) })}
                className={FIELD}
              />
              <span className="text-[13px] text-text-muted">
                {draft.earningsBlackoutDays > 0
                  ? `실적 발표 ${draft.earningsBlackoutDays} 거래일 전부터 발표일까지 새로 사지 않습니다`
                  : '끔 — 실적 발표와 상관없이 삽니다'}
              </span>
            </Row>
            <Row label="하루 손실 한도 (%)">
              <input
                type="number" min={0} max={20} step={0.5}
                value={draft.dailyLossLimitPercent}
                onChange={(e) => patch({ dailyLossLimitPercent: Number(e.target.value) })}
                className={FIELD}
              />
              <span className="text-[13px] text-text-muted">
                {draft.dailyLossLimitPercent > 0
                  ? `하루 동안 계좌 평가액이 ${draft.dailyLossLimitPercent}% 넘게 줄면 그날은 새로 사지 않습니다 (보유 종목 손절·청산은 계속)`
                  : '끔 (0) — 하루 손실과 상관없이 삽니다'}
              </span>
            </Row>
            <p className="text-[13px] leading-relaxed text-text-muted">
              실적일은 매일 한 번 받아 둔 달력(yfinance)을 봅니다. 실적일을 모르는 종목은 막지 않고 거래 사유에
              「실적일 미확인」 을 남깁니다. 하루는 미국 종목이면 미국 거래일 기준이고, 다음 거래일이 되면 자동으로 풀립니다.
            </p>
          </section>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
          <span className="min-w-0 text-[13px] text-text-muted">
            값의 허용 범위는 저장할 때 서버가 다시 한 번 조입니다.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 whitespace-nowrap ml-auto rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="shrink-0 whitespace-nowrap rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? '저장 중…' : saveLabel}
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
