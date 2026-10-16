import Button from '../ui/Button';
import Dialog from '../ui/Dialog';
import { Children, useEffect, useState } from 'react';
import FormRow from '../ui/FormRow';
import NumberField, { NumberUnitGroup } from '../ui/NumberField';
import type { AccountStrategy } from '../../types/autoTrading';
import TargetSymbolsEditor from './TargetSymbolsEditor';
import RuleSelect from '../rules/RuleSelect';
import { useTradingRules } from '../../hooks/useTradingRules';
import { JUDGE_TIMING_TEXT } from '../../utils/ruleText';
import { toast } from '../../store/uiStore';
import { InfoTip, Segmented } from '../ui';
import WarnIcon from '../ui/WarnIcon';
import { useGeminiStatus } from '../../hooks/useGemini';
import { AI_CHECK_DAILY_LIMIT } from '../../types/aiCheck';

/**
 * 계좌별 자동매매 설정 패널 (v2.44.0 — 퀀트 다시 만들기 2단계).
 *
 * 위에서 아래로 한 줄: **① 매매 규칙 → ② 대상 종목 → ③ 계좌 운용 → ④ 신규 매수 안전장치 → 저장**.
 * 매수·매도 조건과 손절·익절·트레일링은 **매매 규칙 안에만** 있다(「퀀트 > 매매 규칙」 에서 고친다). 판단 방식·성향·분석 주기·「미국 정규장만」·
 * ④ 청산은 v2.44.0 에 없앴다. 이 창에 「고급 설정」 은 없다(남는 숫자가 적다).
 * v2.46.0: ① 줄 맨 오른쪽 「AI 검증 [끔 | 켬]」(따로 번호 칸을 두지 않는다 — 규칙 고르기의 덧붙임) · ② 대상 종목은 종목이 있으면 접힌 한 줄 요약으로 연다.
 *
 * ⚠️ 값 검증의 최종 권한은 **서버**다(`normalizeStrategy` · 켤 때 규칙 확인). 저장 응답으로 온 값을 그대로 화면에 되돌린다.
 */

interface Props {
  strategy: AccountStrategy;
  onSave: (patch: Partial<AccountStrategy>) => Promise<AccountStrategy>;
  onClose: () => void;
  /** 저장 뒤 토스트 — 처음 켜기 안내는 이 창의 값을 서버에 저장하지 않고 안내로 되돌려 받는다 */
  doneMessage?: string;
  /** 저장 버튼 글자 — 기본 「저장」 */
  saveLabel?: string;
}

export default function AutoTradeSettings({ strategy, onSave, onClose, doneMessage = '자동매매 설정을 저장했습니다', saveLabel = '저장' }: Props) {
  const [draft, setDraft] = useState<AccountStrategy>(strategy);
  const [saving, setSaving] = useState(false);
  const { rules } = useTradingRules();
  // AI 검증 — 서버에서 Gemini 가 꺼져 있으면 켜 두었을 때 매수가 모두 「검증 못 함」 이 된다는 것을 미리 알린다(키 유무는 서버 재시작 때만 바뀐다 — 한 번만 묻는다)
  const { state: gemini } = useGeminiStatus(0);

  // 바깥에서 값이 바뀌면(저장 응답 등) 따라간다.
  useEffect(() => setDraft(strategy), [strategy]);

  const patch = (change: Partial<AccountStrategy>) => setDraft((prev) => ({ ...prev, ...change }));

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

  return (
    <Dialog
      title="자동매매 설정"
      titleAside={<span className="rounded bg-warning/15 px-2 py-0.5 text-caption text-warning">모의 — 실제 주문은 나가지 않습니다</span>}
      onClose={onClose}
      size="lg"
      z={90}
      bodyClassName="flex flex-col"
    >
      {/* 숫자 칸 단위 폭을 창 전체가 같게 — 「%」·「종목」·「거래일」 이 달라도 숫자 오른쪽 끝이 한 줄 */}
      <NumberUnitGroup w="lg">
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 [scrollbar-gutter:stable]">
          {/* ① 매매 규칙 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-text-primary">① 매매 규칙</h3>
            <RuleSelect
              rules={rules}
              value={draft.ruleId}
              onChange={(ruleId) => patch({ ruleId })}
              warnNoStop
              aside={
                <>
                  <span className="whitespace-nowrap text-xs text-text-secondary">AI 검증</span>
                  <Segmented
                    label="AI 검증"
                    value={draft.aiCheck ? 'on' : 'off'}
                    onChange={(v) => patch({ aiCheck: v === 'on' })}
                    options={[
                      { value: 'off', label: '끔' },
                      // 켬 = 주황(v2.48.0) — 켜 두면 매수 직전 AI 가 막을 수 있다는 것이 한눈에 보이게
                      { value: 'on', label: '켬', activeTone: 'warning' },
                    ]}
                  />
                  <InfoTip label="AI 검증">
                    규칙이 「사도 됨」 을 낸 종목을 사기 직전에 AI에게 한 번 묻고, 위험하다고 하면 사지 않습니다. 하루 최대 {AI_CHECK_DAILY_LIMIT}번 · AI가 답을 못
                    하면 사지 않습니다. 매도에는 쓰지 않습니다.
                  </InfoTip>
                </>
              }
            />
            {gemini && !gemini.enabled && (
              <p className="text-caption text-warning">
                <WarnIcon />
                이 서버에서는 AI를 쓸 수 없어, 켜 두면 매수가 모두 「AI 검증 못 함」이 됩니다.
              </p>
            )}
            {rules != null && rules.length > 0 && <p className="text-caption text-text-muted">{JUDGE_TIMING_TEXT}(값은 규칙의 매도 조건).</p>}
          </section>

          {/* ② 대상 종목 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-text-primary">② 대상 종목</h3>
            <TargetSymbolsEditor symbols={draft.symbols} onChange={(symbols) => patch({ symbols })} maxPositions={draft.maxPositions} collapsible />
          </section>

          {/* ③ 계좌 운용 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-text-primary">③ 계좌 운용</h3>
            <Row label="종목당 비중">
              <NumberField unit="%" min={1} max={100} value={draft.positionSizePercent} onChange={(e) => patch({ positionSizePercent: Number(e.target.value) })} />
              <span>총자산 대비 한 종목에 넣는 비중</span>
            </Row>
            <Row label="최대 보유 종목 수">
              <NumberField unit="종목" min={1} max={50} value={draft.maxPositions} onChange={(e) => patch({ maxPositions: Number(e.target.value) })} />
              <span>이미 보유한 종목의 추가 매수는 막지 않습니다</span>
            </Row>
          </section>

          {/*
            ④ 신규 매수 안전장치 (v2.16.0) — 둘 다 **새로 사는 것만** 막는다. 손절·청산은 그대로 돈다.
            값은 앱의 출발값이지 검증된 권장값이 아니다 — 권장값을 적지 않는다.
          */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-text-primary">④ 신규 매수 안전장치</h3>
            <Row label="실적 발표 전">
              <NumberField unit="거래일" min={0} max={10} step={1} value={draft.earningsBlackoutDays} onChange={(e) => patch({ earningsBlackoutDays: Number(e.target.value) })} />
              <span>
                {draft.earningsBlackoutDays > 0
                  ? `실적 발표 ${draft.earningsBlackoutDays} 거래일 전부터 발표일까지 새로 매수하지 않습니다`
                  : '끔 — 실적 발표와 상관없이 매수합니다'}
              </span>
            </Row>
            <Row label="하루 손실 한도">
              <NumberField unit="%" min={0} max={20} step={0.5} value={draft.dailyLossLimitPercent} onChange={(e) => patch({ dailyLossLimitPercent: Number(e.target.value) })} />
              <span>
                {draft.dailyLossLimitPercent > 0
                  ? `하루 동안 계좌 평가액이 ${draft.dailyLossLimitPercent}% 넘게 줄면 그날은 새로 매수하지 않습니다 (보유 종목 손절·매도는 계속)`
                  : '끔 (0) — 하루 손실과 상관없이 매수합니다'}
              </span>
            </Row>
            <p className="text-caption leading-relaxed text-text-muted">
              실적일은 매일 한 번 받아 둔 달력(yfinance)을 봅니다. 실적일을 모르는 종목은 막지 않고 거래 사유에 「실적일 미확인」 을 남깁니다. 하루는 미국 종목이면 미국
              거래일 기준이고, 다음 거래일이 되면 자동으로 풀립니다.
            </p>
          </section>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
          <span className="min-w-0 text-caption text-text-muted">값의 허용 범위는 저장할 때 서버가 다시 한 번 조입니다.</span>
          <Button variant="secondary" size="md" onClick={onClose} className="ml-auto">
            취소
          </Button>
          <Button variant="primary" size="md" onClick={() => void save()} disabled={saving}>
            {saving ? '저장하는 중…' : saveLabel}
          </Button>
        </div>
      </NumberUnitGroup>
    </Dialog>
  );
}

/** 이 창의 폼 줄 — 첫 자식 = 값 칸, 나머지 = 오른쪽 설명 (입력칸 오른쪽 끝 · 단위 열 · 설명 시작점을 맞춘다) */
function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  const [control, ...rest] = Children.toArray(children);
  return (
    <FormRow label={label} labelW="md" valueW="sm" hint={rest.length ? <>{rest}</> : undefined}>
      {control}
    </FormRow>
  );
}
