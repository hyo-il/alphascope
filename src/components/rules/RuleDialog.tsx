import { MARKET_REF } from '../../utils/market';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import {
  BUY_KEYS,
  GROUP_TABLES,
  cloneRuleBody,
  gatesOf,
  emptyRuleBody,
  isUsed,
  maxScoreOf,
  scaledTable,
  type BuyKey,
  type GroupKey,
  type RuleBody,
  type TradingRule,
} from '../../types/tradingRule';
import { ENGINE_MA_PERIODS } from '../../types/autoTrading';
import { ruleFieldErrors, ruleNameError, ruleWarnings, RULE_INPUT_LIMITS as L } from '../../utils/ruleInput';
import { modal, toast } from '../../store/uiStore';
import { Badge, Button, Dialog, DisclosureButton, FormRow, Input, NumberField, NumberUnitGroup, Select } from '../ui';
import WarnIcon from '../ui/WarnIcon';
import { usageText } from './usage';

/**
 * 「추천」 배지 (사용자 결정 A-9) — **값이 이 값일 때만** 붙는다(바꾸면 사라진다). 뜻은 「자주 사용되는 설정」 — 수익 확인이 아니다.
 * 출처 = 각 지표를 만든 사람이 제시한 표준 설정(지표 해설 자료가 같은 값을 기본으로 설명한다):
 * - RSI(14) 70·30 — J. Welles Wilder, 『New Concepts in Technical Trading Systems』(1978)
 * - MACD(12, 26, 9) — Gerald Appel (1970년대 고안, 같은 저자 『Technical Analysis: Power Tools for Active Investors』 2005)
 * - 볼린저 밴드(20, 2) — John Bollinger, 『Bollinger on Bollinger Bands』(2001)
 * - 스토캐스틱(14, 3, 3) — George Lane 의 %K·%D (14기간 · 3기간 평활이 해설 자료의 흔한 기본값)
 * MACD·볼린저·스토캐스틱은 지표 엔진이 이 값으로만 계산한다(`python/indicators.py`) — 그래서 늘 붙는다.
 * - 50일·200일 이동평균 교차(골든·데드크로스) · 200일선 위에서만 매수(장기 추세 거름망) — 기술적 분석 해설서가 대표 예로 드는 값
 *   (John J. Murphy, 『Technical Analysis of the Financial Markets』(1999) 의 이동평균 장 · 장기 이동평균 거름망은 Mebane Faber,
 *   「A Quantitative Approach to Tactical Asset Allocation」(2007, 10개월 ≈ 200거래일) 이 흔히 인용된다). 교차는 50/200 일 때만 붙는다.
 * - 시장이 200일선 위일 때만 매수(시장 필터) — 같은 Faber(2007)의 장기 이동평균 거름망을 시장 전체 지수에 적용한 형태(지수를 따라가는 ETF 로 잰다).
 * 붙이지 않는 것: 5일·20일 교차 · RSI 35~45 · 점수 배분 · 65점(앱이 정한 값).
 * 처음 화면(매수 조건 표 이름 옆): 「모멘텀」 = 늘(안의 MACD·스토캐스틱이 엔진 고정 표준값) · 「RSI 반등」 = 30 일 때만 ·
 * 「타이밍」 은 붙이지 않는다(RSI 35~45 라는 앱이 정한 값을 포함한다 — 볼린저 배지는 고급 설정 안에만). 매도 「반대 신호」 = 이름 옆, 70 일 때만.
 * 색은 파랑(accent) — docs/rules/design.md 「예외로 남은 파랑」.
 */
const RECOMMENDED = { rsiBelow: 30, rsiAbove: 70 } as const;

function Rec({ show = true }: { show?: boolean }) {
  return show ? (
    <Badge tone="accent" title="자주 사용되는 설정입니다 (수익이 확인된 설정은 아닙니다)">
      추천
    </Badge>
  ) : null;
}

/** 처음 화면 매수 조건 이름 옆 「추천」 — 고급 설정 안 배지와 같은 조건(값이 바뀌면 함께 사라진다) */
function nameRecommended(key: BuyKey, b: RuleBody['buy']): boolean {
  if (key === 'momentum') return true;
  if (key === 'rsiRebound') return b.rsiRebound.below === RECOMMENDED.rsiBelow;
  if (key === 'maCross') return isGoldenCross(b);
  return false;
}

/** 50일·200일 교차 — 「추천」 */
function isGoldenCross(b: RuleBody['buy']): boolean {
  return b.maCross.short === 50 && b.maCross.long === 200;
}

const NAMES: Record<BuyKey, string> = {
  trend: '추세',
  timing: '타이밍',
  momentum: '모멘텀',
  volume: '거래량',
  riskReward: '손익비',
  maCross: '이동평균 교차',
  rsiRebound: 'RSI 반등',
};

/** 조건마다 한 줄 쉬운 설명 */
function describe(key: BuyKey, b: RuleBody['buy']): string {
  switch (key) {
    case 'trend':
      return '주가가 60일 평균보다 위에 있고 오르는 흐름인지 봅니다.';
    case 'timing':
      return '오른 뒤 잠깐 쉬어 가는 자리(눌림)인지 봅니다.';
    case 'momentum':
      return '내려가던 힘이 꺾이고 다시 오르기 시작했는지 봅니다.';
    case 'volume':
      return '거래량이 가격 움직임을 뒷받침하는지 봅니다.';
    case 'riskReward':
      return '벌 수 있는 폭이 잃을 수 있는 폭보다 큰지 봅니다(2배 이상이면 만점).';
    case 'maCross':
      return `${b.maCross.short}일 평균선이 ${b.maCross.long}일 평균선을 위로 넘는 날에만 점수가 붙습니다.`;
    case 'rsiRebound':
      return `RSI 가 ${b.rsiRebound.below} 이하로 떨어졌다가 다시 오르는 날에만 점수가 붙습니다.`;
  }
}

/** 그룹 안 작은 검사 이름 (고급 설정 안에 이름만) */
const CHECKS: Record<Exclude<BuyKey, 'riskReward' | 'maCross' | 'rsiRebound'>, (b: RuleBody['buy']) => ReactNode[]> = {
  trend: () => ['현재가 > 60일선', '20일선 > 60일선 (정배열)', '60일선이 5일 전보다 높음'],
  timing: (b) => [
    `RSI(14) ${b.timing.rsiLow}~${b.timing.rsiHigh} (눌림 구간)`,
    '현재가가 20일선 ±1.5% 안',
    <span key="bb" className="inline-flex items-center gap-1.5">볼린저(20, 2) 중단~하단 <Rec /></span>,
  ],
  momentum: () => [
    <span key="macd" className="inline-flex items-center gap-1.5">MACD(12, 26, 9) 양전환 또는 전환 임박 <Rec /></span>,
    <span key="st" className="inline-flex items-center gap-1.5">스토캐스틱(14, 3, 3) %K 가 %D 를 위로 돌파 <Rec /></span>,
    'RSI 가 최근 3봉 사이 오름',
  ],
  volume: () => ['최근 3일 거래량 ≥ 20일 평균의 120%', '내린 날 거래량 < 오른 날 거래량', 'OBV 가 10일 전보다 높음'],
};

const num = (text: string): number => (text.trim() === '' ? Number.NaN : Number(text));
const shown = (v: number) => (Number.isFinite(v) ? v : '');

export default function RuleDialog({
  rule,
  onClose,
  onSave,
  accountName,
  readOnly = false,
}: {
  /** null = 새 규칙(빈 규칙) */
  rule: TradingRule | null;
  onClose: () => void;
  onSave?: (name: string, body: RuleBody) => Promise<void>;
  accountName: (id: number) => string;
  /** 보기 전용 (계좌 설정·백테스트의 [조건 보기]) — [수정] 을 숨긴다. 고치기는 「퀀트 > 매매 규칙」 에서만 */
  readOnly?: boolean;
}) {
  const isNew = rule == null;
  const [editing, setEditing] = useState(isNew);
  const [name, setName] = useState(rule?.name ?? '');
  const [body, setBody] = useState<RuleBody>(() => (rule ? cloneRuleBody(rule) : emptyRuleBody()));
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  /** 이름 오류는 고친 뒤나 [저장] 을 누른 뒤에만 보인다 — 새 규칙을 열자마자 빨간 글자가 뜨지 않게 */
  const [nameTouched, setNameTouched] = useState(false);
  const advId = useId();
  const locked = !editing || saving;

  const errors = useMemo(() => ruleFieldErrors(body), [body]);
  const nameError = ruleNameError(name);
  const warnings = useMemo(() => ruleWarnings(body), [body]);
  const hasError = !!nameError || Object.keys(errors).length > 0;
  const err = (key: string) => (editing ? errors[key] : undefined);

  const setBuy = <K extends BuyKey>(key: K, patch: Partial<RuleBody['buy'][K]>) =>
    setBody((b) => ({ ...b, buy: { ...b.buy, [key]: { ...b.buy[key], ...patch } } }));
  const setSell = <K extends keyof RuleBody['sell']>(key: K, patch: Partial<RuleBody['sell'][K]>) =>
    setBody((b) => ({ ...b, sell: { ...b.sell, [key]: { ...b.sell[key], ...patch } } }));

  const doSave = async () => {
    setSaving(true);
    try {
      await onSave?.(name.trim(), body);
      if (!isNew) setEditing(false);
    } catch (e) {
      toast.error('저장하지 못했습니다', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (hasError) {
      setNameTouched(true);
      return;
    }
    if (rule && isUsed(rule.usedBy)) {
      modal.confirm({
        title: '매매 규칙 저장',
        message: `이 규칙을 쓰는 곳: ${usageText(rule.usedBy, accountName)}.\n${
          rule.usedBy.accounts.length ? `계좌 ${rule.usedBy.accounts.length}개의 다음 판단부터 바뀝니다.` : '다음 판단부터 바뀝니다.'
        }`,
        confirmText: '저장',
        onConfirm: doSave,
      });
      return;
    }
    void doSave();
  };

  const cancelEdit = () => {
    if (isNew) return onClose();
    setName(rule.name);
    setBody(cloneRuleBody(rule));
    setEditing(false);
  };

  const maxScore = maxScoreOf(body.buy);

  return (
    <Dialog
      title={isNew ? '새 규칙 만들기' : editing ? '규칙 수정' : '규칙 조건 보기'}
      titleAside={readOnly ? '보기 전용 — 고치려면 「퀀트 > 매매 규칙」 에서' : !isNew && !editing ? '보기 상태 — 고치려면 [수정] 을 누르세요' : undefined}
      onClose={onClose}
      size="xl"
      closeOnBackdrop={!editing}
      bodyClassName="p-4 [scrollbar-gutter:stable]"
      footer={
        editing ? (
          <>
            <Button variant="ghost" onClick={cancelEdit} disabled={saving}>
              취소
            </Button>
            <Button busy={saving} variant="primary" onClick={save} disabled={saving}>
              {saving ? '저장 중…' : '저장'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              닫기
            </Button>
            {!readOnly && (
              <Button variant="primary" icon={Pencil} onClick={() => setEditing(true)}>
                수정
              </Button>
            )}
          </>
        )
      }
    >
      <div className="space-y-5">
        <FormRow label="이름" labelW="md" valueW="auto" error={editing && nameTouched ? nameError : undefined}>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
            disabled={locked}
            maxLength={L.nameLength}
            placeholder="예: 눌림 매수"
            invalid={editing && nameTouched && !!nameError}
            className="w-80"
          />
        </FormRow>

        {/* ── 매수 조건 ───────────────────────────────── */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-text-primary">매수 조건</h3>
          <table className="w-full text-left text-xs" data-rows-differ>
            <thead className="text-caption text-text-muted">
              <tr className="border-b border-border/50">
                {/* 사용 48px + 조건 140px = 188px — 위 「이름」 폼 줄의 값 칸 시작(이름 칸 176px + 간격 12px)과 같은 선 */}
                <th className="w-12 whitespace-nowrap py-1.5 text-center">사용</th>
                <th className="w-[8.75rem] whitespace-nowrap py-1.5">조건</th>
                <th className="w-px whitespace-nowrap py-1.5 pr-4">점수</th>
                <th className="py-1.5">설명</th>
              </tr>
            </thead>
            <tbody>
              {BUY_KEYS.map((key) => {
                const c = body.buy[key];
                return (
                  <tr key={key} className="border-b border-border/30">
                    {/* 체크 박스는 칸 가운데 — 머리 「사용」 글자와 가로 가운데가 같은 선. 브라우저 기본 여백(왼 4·오 3px)을 지워 정확히 가운데 */}
                    <td className="py-1.5 text-center">
                      <input
                        className="m-0 align-middle"
                        type="checkbox"
                        aria-label={`${NAMES[key]} 사용`}
                        checked={c.on}
                        disabled={locked}
                        onChange={(e) => setBuy(key, { on: e.target.checked } as never)}
                      />
                    </td>
                    <td className={`whitespace-nowrap py-1.5 ${c.on ? 'font-medium text-text-primary' : 'text-text-secondary'}`}>
                      <span className="inline-flex items-center gap-1.5">
                        {NAMES[key]}
                        <Rec show={nameRecommended(key, body.buy)} />
                      </span>
                    </td>
                    <td className="py-1.5 pr-4">
                      <div className="flex">
                        <NumberField
                          size="sm"
                          unit="점"
                          unitW="sm"
                          aria-label={`${NAMES[key]} 점수`}
                          min={L.points.min}
                          max={L.points.max}
                          value={shown(c.points)}
                          disabled={locked || !c.on}
                          invalid={!!err(`buy.${key}.points`)}
                          title={err(`buy.${key}.points`)}
                          onChange={(e) => setBuy(key, { points: num(e.target.value) } as never)}
                        />
                      </div>
                    </td>
                    <td className="py-1.5 text-text-secondary">
                      {describe(key, body.buy)}
                      {err(`buy.${key}.points`) && <span className="ml-2 text-danger">{err(`buy.${key}.points`)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {/* 매수 기준 — 점수 칸과 같은 열(입력칸·단위·설명 시작점이 위 줄과 한 선) */}
              <tr>
                <td className="py-2" />
                <td className="whitespace-nowrap py-2 font-medium text-text-primary">매수 기준</td>
                <td className="py-2 pr-4">
                  <div className="flex">
                    <NumberField
                      size="sm"
                      unit="점"
                      unitW="sm"
                      aria-label="매수 기준 점수"
                      min={L.minScore.min}
                      max={L.minScore.max}
                      value={shown(body.buy.minScore)}
                      disabled={locked}
                      invalid={!!err('buy.minScore')}
                      onChange={(e) => setBody((b) => ({ ...b, buy: { ...b.buy, minScore: num(e.target.value) } }))}
                    />
                  </div>
                </td>
                <td className="py-2 text-text-secondary">
                  합계가 이 점수 이상이면 매수 <span className="text-text-muted">· 켠 조건의 최대 점수 {maxScore}점</span>
                  {err('buy.minScore') && <span className="ml-2 text-danger">{err('buy.minScore')}</span>}
                </td>
              </tr>
            </tfoot>
          </table>

          <p className="text-xs text-text-primary">잃을 돈이 벌 돈보다 큰 거래(손익비 1 미만)는 어떤 규칙이든 사지 않습니다.</p>
          {warnings.map((w) => (
            <p key={w} className="text-caption text-warning">
              <WarnIcon />
              {w}
            </p>
          ))}

          <DisclosureButton open={advanced} onToggle={() => setAdvanced((v) => !v)} label="고급 설정" controls={advId} />
          {advanced && (
            <div id={advId} className="space-y-4 rounded-lg bg-bg-primary/40 p-3">
              <p className="text-caption text-text-muted">
                추세·타이밍·모멘텀·거래량은 작은 검사 3개 중 몇 개를 통과했는지로 점수를 냅니다. 만점을 바꾸면 점수표가 같은 비율로 바뀝니다.
                판단은 전날 마감한 일봉 기준입니다.
              </p>
              {(['trend', 'timing', 'momentum', 'volume'] as const).map((key) => (
                <div key={key} className="space-y-1.5">
                  <h4 className="text-xs font-medium text-text-primary">{NAMES[key]}</h4>
                  <ul className="list-disc space-y-0.5 pl-5 text-caption text-text-secondary">
                    {CHECKS[key](body.buy).map((label, i) => (
                      <li key={i}>{label}</li>
                    ))}
                  </ul>
                  <TableLine k={key} points={body.buy[key].points} />
                  {key === 'timing' && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs text-text-secondary">
                      <span>눌림 구간 RSI(14)</span>
                      <NumberField
                        aria-label="RSI 눌림 구간 아래"
                        min={L.rsiBand.min}
                        max={L.rsiBand.max}
                        value={shown(body.buy.timing.rsiLow)}
                        disabled={locked}
                        invalid={!!err('buy.timing.rsiLow')}
                        onChange={(e) => setBuy('timing', { rsiLow: num(e.target.value) })}
                      />
                      <span>~</span>
                      <NumberField
                        aria-label="RSI 눌림 구간 위"
                        min={L.rsiBand.min}
                        max={L.rsiBand.max}
                        value={shown(body.buy.timing.rsiHigh)}
                        disabled={locked}
                        invalid={!!err('buy.timing.rsiHigh')}
                        onChange={(e) => setBuy('timing', { rsiHigh: num(e.target.value) })}
                      />
                      <span className="text-caption text-text-muted">{L.rsiBand.min}~{L.rsiBand.max}</span>
                      {(err('buy.timing.rsiLow') || err('buy.timing.rsiHigh')) && (
                        <span className="text-caption text-danger">{err('buy.timing.rsiLow') ?? err('buy.timing.rsiHigh')}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}

              <div className="space-y-1.5">
                <h4 className="text-xs font-medium text-text-primary">손익비</h4>
                <p className="text-caption text-text-secondary">
                  손익비 = (1·2차 목표까지 평균 이익) ÷ (손절까지 손실). 손절은 ATR×2 · 최근 20일 지지선 −1% · 60일선 −0.5% 중 가장 가까운 값입니다.
                </p>
                <p className="text-caption text-text-muted">
                  점수표: 1 미만 {scaledTable('riskReward', body.buy.riskReward.points)[0]}점 · 1 이상{' '}
                  {scaledTable('riskReward', body.buy.riskReward.points)[1]}점 · 1.5 이상 {scaledTable('riskReward', body.buy.riskReward.points)[2]}점 · 2 이상{' '}
                  {scaledTable('riskReward', body.buy.riskReward.points)[3]}점
                </p>
              </div>

              <div className="space-y-1.5">
                <h4 className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
                  이동평균 교차
                  <Rec show={isGoldenCross(body.buy)} />
                </h4>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
                  <span>단기선</span>
                  <Select
                    aria-label="단기 이동평균"
                    value={body.buy.maCross.short}
                    disabled={locked}
                    onChange={(e) => setBuy('maCross', { short: Number(e.target.value) })}
                  >
                    {ENGINE_MA_PERIODS.map((p) => (
                      <option key={p} value={p}>
                        {p}일
                      </option>
                    ))}
                  </Select>
                  <span>이 장기선</span>
                  <Select
                    aria-label="장기 이동평균"
                    value={body.buy.maCross.long}
                    disabled={locked}
                    onChange={(e) => setBuy('maCross', { long: Number(e.target.value) })}
                  >
                    {ENGINE_MA_PERIODS.map((p) => (
                      <option key={p} value={p}>
                        {p}일
                      </option>
                    ))}
                  </Select>
                  <span>을 위로 넘는 날</span>
                  {err('buy.maCross.long') && <span className="text-caption text-danger">{err('buy.maCross.long')}</span>}
                </div>
                <p className="text-caption text-text-muted">
                  지표 엔진이 계산하는 이동평균은 {ENGINE_MA_PERIODS.join('·')}일뿐이라 이 중에서 고릅니다. 50일 · 200일을 고르면 널리 쓰이는 골든크로스입니다.
                </p>
              </div>

              <div className="space-y-1.5">
                <h4 className="text-xs font-medium text-text-primary">RSI 반등</h4>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
                  <span>RSI(14) 가</span>
                  <NumberField
                    aria-label="RSI 반등 기준"
                    min={L.rsiBelow.min}
                    max={L.rsiBelow.max}
                    value={shown(body.buy.rsiRebound.below)}
                    disabled={locked}
                    invalid={!!err('buy.rsiRebound.below')}
                    onChange={(e) => setBuy('rsiRebound', { below: num(e.target.value) })}
                  />
                  <span>이하였다가 다시 오르는 날</span>
                  <Rec show={body.buy.rsiRebound.below === RECOMMENDED.rsiBelow} />
                  <span className="text-caption text-text-muted">{L.rsiBelow.min}~{L.rsiBelow.max}</span>
                  {err('buy.rsiRebound.below') && <span className="text-caption text-danger">{err('buy.rsiRebound.below')}</span>}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── 거름망 — 점수 표와 다른 칸: 통과하지 못하면 점수가 높아도 사지 않는다. 매도에는 쓰지 않는다 ── */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-text-primary">거름망</h3>
          <p className="text-caption text-text-secondary">아래 조건을 통과하지 못하면 점수가 높아도 사지 않습니다.</p>
          {/* 항목 글자는 다른 조건 이름과 같은 본문 크기(text-xs) · 보조 설명은 항목 글자 시작점에 맞춘다(체크 박스 칸 + 간격) */}
          <div className="space-y-2">
            {(
              [
                ['above200', '주가가 200일선 위일 때만 매수', '전날 마감 종가 기준입니다(200일선 = 최근 200거래일 종가 평균, 약 10개월). 일봉이 200개가 안 되면 사지 않습니다.'],
                // 시장 필터 — 시장 기준은 `server/rules/marketRef.ts`
                [
                  'marketAbove200',
                  '시장이 200일선 위일 때만 매수',
                  `미국 종목은 ${MARKET_REF.US.name}(${MARKET_REF.US.tracks} 지수를 따라가는 ETF), 국내 종목은 ${MARKET_REF.KR.name}(${MARKET_REF.KR.tracks} 지수를 따라가는 ETF) 기준이며, 종목과 같은 날 마감 종가로 봅니다. 시장 가격을 받지 못한 날은 사지 않습니다.`,
                ],
              ] as const
            ).map(([key, label, hint]) => {
              const on = gatesOf(body.buy)[key].on;
              return (
                <div key={key} className="flex items-baseline gap-2 text-xs" data-gate={key}>
                  <input
                    type="checkbox"
                    className="m-0 shrink-0"
                    aria-label={`${label} 사용`}
                    checked={on}
                    disabled={locked}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setBody((b) => ({ ...b, buy: { ...b.buy, gates: { ...gatesOf(b.buy), [key]: { on: next } } } }));
                    }}
                  />
                  <div className="min-w-0 space-y-0.5">
                    <span className="inline-flex items-center gap-2">
                      <span className={on ? 'text-text-primary' : 'text-text-secondary'}>{label}</span>
                      <Rec />
                    </span>
                    <p className="text-caption text-text-muted">{hint}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── 매도 조건 ───────────────────────────────── */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-text-primary">매도 조건</h3>
          <NumberUnitGroup w="lg">
            <div className="space-y-2">
              <FormRow
                label={<Toggle label="점수 매도" checked={body.sell.scoreBelow.on} disabled={locked} onChange={(on) => setSell('scoreBelow', { on })} />}
                labelW="md"
                valueW="sm"
                hint="점수가 이 값 아래로 떨어지면 매도합니다."
                error={err('sell.scoreBelow.value')}
              >
                <NumberField
                  unit="점"
                  aria-label="매도 점수"
                  value={shown(body.sell.scoreBelow.value)}
                  disabled={locked || !body.sell.scoreBelow.on}
                  invalid={!!err('sell.scoreBelow.value')}
                  onChange={(e) => setSell('scoreBelow', { value: num(e.target.value) })}
                />
              </FormRow>
              <FormRow
                label={
                  <Toggle
                    label="반대 신호"
                    checked={body.sell.opposite.on}
                    disabled={locked}
                    onChange={(on) => setSell('opposite', { on })}
                    badge={<Rec show={body.sell.opposite.rsiAbove === RECOMMENDED.rsiAbove} />}
                  />
                }
                labelW="md"
                valueW="sm"
                hint={
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <span>RSI 반등을 켰으면 RSI(14) 가 이 값 이상일 때 매도</span>
                    <span>· 이동평균 교차를 켰으면 데드크로스(단기선이 장기선 아래로)일 때 매도</span>
                  </span>
                }
                error={err('sell.opposite.rsiAbove')}
              >
                <NumberField
                  aria-label="반대 신호 RSI 기준"
                  min={L.rsiAbove.min}
                  max={L.rsiAbove.max}
                  value={shown(body.sell.opposite.rsiAbove)}
                  disabled={locked || !body.sell.opposite.on}
                  invalid={!!err('sell.opposite.rsiAbove')}
                  onChange={(e) => setSell('opposite', { rsiAbove: num(e.target.value) })}
                />
              </FormRow>
              <FormRow
                label={<Toggle label="손절" checked={body.sell.stopLoss.on} disabled={locked} onChange={(on) => setSell('stopLoss', { on })} />}
                labelW="md"
                valueW="sm"
                hint="매수가보다 이만큼 내려가면 매도합니다."
                error={err('sell.stopLoss.percent')}
              >
                <NumberField
                  unit="%"
                  aria-label="손절"
                  value={shown(body.sell.stopLoss.percent)}
                  disabled={locked || !body.sell.stopLoss.on}
                  invalid={!!err('sell.stopLoss.percent')}
                  onChange={(e) => setSell('stopLoss', { percent: num(e.target.value) })}
                />
              </FormRow>
              <FormRow
                label={<Toggle label="익절" checked={body.sell.takeProfit.on} disabled={locked} onChange={(on) => setSell('takeProfit', { on })} />}
                labelW="md"
                valueW="sm"
                hint="매수가보다 이만큼 오르면 매도합니다."
                error={err('sell.takeProfit.percent')}
              >
                <NumberField
                  unit="%"
                  aria-label="익절"
                  value={shown(body.sell.takeProfit.percent)}
                  disabled={locked || !body.sell.takeProfit.on}
                  invalid={!!err('sell.takeProfit.percent')}
                  onChange={(e) => setSell('takeProfit', { percent: num(e.target.value) })}
                />
              </FormRow>
              <FormRow
                label={<Toggle label="트레일링" checked={body.sell.trailing.on} disabled={locked} onChange={(on) => setSell('trailing', { on })} />}
                labelW="md"
                valueW="sm"
                hint="트레일링 = 들고 있는 동안의 최고가보다 이만큼 내려가면 매도합니다."
                error={err('sell.trailing.percent')}
              >
                <NumberField
                  unit="%"
                  aria-label="트레일링"
                  value={shown(body.sell.trailing.percent)}
                  disabled={locked || !body.sell.trailing.on}
                  invalid={!!err('sell.trailing.percent')}
                  onChange={(e) => setSell('trailing', { percent: num(e.target.value) })}
                />
              </FormRow>
              <FormRow
                label="손절 뒤 다시 매수"
                labelW="md"
                valueW="sm"
                hint="손절한 뒤 이만큼 거래일이 지나야 다시 매수합니다 (0 = 바로)."
                error={err('reentryWaitDays')}
              >
                <NumberField
                  unit="거래일"
                  aria-label="손절 뒤 다시 매수까지 거래일"
                  min={L.reentryWaitDays.min}
                  max={L.reentryWaitDays.max}
                  value={shown(body.reentryWaitDays)}
                  disabled={locked}
                  invalid={!!err('reentryWaitDays')}
                  onChange={(e) => setBody((b) => ({ ...b, reentryWaitDays: num(e.target.value) }))}
                />
              </FormRow>
            </div>
          </NumberUnitGroup>
        </section>

        <p className="text-caption text-text-muted">「추천」은 자주 사용되는 설정입니다. 이 앱에서 수익이 확인된 설정은 아닙니다.</p>
      </div>
    </Dialog>
  );
}

/** 점수표 한 줄 — 통과 0·1·2·3개 → 점수 */
function TableLine({ k, points }: { k: GroupKey; points: number }) {
  const t = Number.isFinite(points) ? scaledTable(k, points) : GROUP_TABLES[k].map(() => Number.NaN);
  return (
    <p className="text-caption text-text-muted">
      점수표: 통과 0·1·2·3개 → {t.map((v) => (Number.isFinite(v) ? v : '—')).join('·')}점
    </p>
  );
}

/** 폼 줄 이름 칸의 체크박스 + 이름 */
function Toggle({
  label,
  checked,
  disabled,
  onChange,
  badge,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
  /** 이름 옆 배지(「추천」) */
  badge?: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <input type="checkbox" aria-label={`${label} 사용`} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={checked ? 'text-text-primary' : ''}>{label}</span>
      {badge}
    </span>
  );
}
