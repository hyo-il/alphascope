import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useBacktest, useBacktestUniverse, useGeminiStatus } from '../../hooks/useBacktest';
import { draftInput, useBacktestDraft } from '../../hooks/useBacktestDraft';
import HelpBox from '../swing/HelpBox';
import TrashIcon from '../common/TrashIcon';
import { SkeletonList } from '../common/SkeletonLoader';
import { Badge, Button, Panel, SectionTitle } from '../ui';
import { ICON } from '../ui/icon';
import { modal, toast } from '../../store/uiStore';
import { useAppStore } from '../../store/appStore';
import { stockNameOf } from '../../utils/stockNames';
import { maRoundingNotes, ruleConditionLine } from '../../utils/autoTradeExplain';
import { backtestInputErrors } from '../../utils/backtestInput';
import { nearestEngineMa } from '../../types/autoTrading';
import { isCustomReport, isCustomSummary, type BacktestListItem } from '../../types/backtest';
import SymbolPicker from './SymbolPicker';
import ConditionForm from './ConditionForm';
import CustomResult from './CustomResult';
import FixedResult from './FixedResult';
import ApplyRuleButton from './ApplyRuleButton';

/**
 * 「실험실 > 백테스트」 (v2.38.0) — **내가 고른 종목을 내가 정한 조건으로** 과거에 시험한다.
 * ① 종목 고르기(왼쪽) → ② 조건 정하기 → ③ 실행 → ④ 결과 → ⑤ 지난 기록(오른쪽 맨 아래).
 *
 * - 계산은 서버(`runCustomBacktest` — v2.37.0 재현 함수 그대로). 주문을 내지 않는다.
 * - 판정 배지 없음 — 조건을 바꿔 보는 화면이라 "좋음" 을 붙이면 우연을 고르게 된다. 거래가 적으면 「결론 내기 어려움」 만.
 * - v2.37.0 「미리 정한 시험」 은 여기서 실행하지 않는다(`npm run research:rule`). ⑤ 에서 「미리 정한 시험」 배지로 읽기만 한다.
 * - 계좌 [백테스트에서 시험하기] 가 넘긴 종목·조건은 `appStore.backtestPreset`(일회성)으로 받아 ①② 를 채운다.
 * - v2.36.0 디자인 규칙 — 이모지 없음, 파란 주요 버튼은 [시험 실행] 하나.
 */
const when = (iso: string) => new Date(iso).toLocaleString('ko-KR');
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const VERDICT_LABEL = { good: '기준선보다 좋음', bad: '기준선 이하', hold: '판단 보류' } as const;

function elapsed(startedAt: string | null, now: number): string {
  if (!startedAt) return '';
  const sec = Math.max(0, Math.round((now - Date.parse(startedAt)) / 1000));
  return sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;
}

function HistoryRow({ item, selected, onOpen, onRetry, onRemove }: { item: BacktestListItem; selected: boolean; onOpen: () => void; onRetry?: () => void; onRemove: () => void }) {
  const s = item.summary;
  return (
    <li className={`flex items-center gap-3 px-3 py-2 text-[13px] ${selected ? 'bg-bg-tertiary' : ''}`}>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-text-primary">{when(item.createdAt)}</span>
          {isCustomSummary(s) ? (
            <>
              <span className="text-text-secondary">
                {s.symbols}종목 · {s.years}년
              </span>
              <span className="tabular-nums text-text-secondary">
                이 방법 {pct(s.rule)} vs 들고 있기 {pct(s.hold)}
              </span>
            </>
          ) : (
            <>
              <Badge>미리 정한 시험</Badge>
              <span className="text-text-secondary">{s.symbols}종목 · 3년</span>
            </>
          )}
        </span>
        <span className="mt-0.5 block text-text-muted">
          {isCustomSummary(s) ? ruleConditionLine(s.input) : s.methods.map((m) => `${m.title} ${VERDICT_LABEL[m.verdict]}`).join(' · ')}
        </span>
      </button>
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          이 조건으로 다시 시험
        </Button>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${when(item.createdAt)} 기록 지우기`}
        title="지우기"
        className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-bg-tertiary hover:text-bearish"
      >
        <TrashIcon className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

export default function BacktestView() {
  const bt = useBacktest();
  const uni = useBacktestUniverse();
  const gemini = useGeminiStatus();
  const { draft, setDraft, patch, toggle, addMany, removeMany } = useBacktestDraft();
  const preset = useAppStore((s) => s.backtestPreset);
  const setPreset = useAppStore((s) => s.setBacktestPreset);
  const [loadedNote, setLoadedNote] = useState<string[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const resultRef = useRef<HTMLDivElement>(null);
  /** 이 id 의 결과가 화면에 도착하면 그리로 내린다 — 상세를 받기 전에 내리면 높이가 바뀌며 밀린다 */
  const scrollTo = useRef<number | null>(null);
  const running = bt.progress?.running ?? false;

  // 계좌에서 넘어온 종목·조건 — 한 번 채우고 비운다
  useEffect(() => {
    if (!preset) return;
    const notes = maRoundingNotes(preset.rule).map((n) => `이 계좌의 ${n} — 엔진이 5·20·60·120일만 계산합니다`);
    setDraft((d) => ({
      ...d,
      symbols: [...preset.symbols],
      rule: { ...preset.rule, maShort: nearestEngineMa(preset.rule.maShort), maLong: nearestEngineMa(preset.rule.maLong) },
      hardStopLossPercent: preset.hardStopLossPercent,
      trailingStopEnabled: preset.trailingStopEnabled,
      trailingStopPercent: preset.trailingStopPercent,
    }));
    setLoadedNote([`${preset.from}의 종목·조건을 불러왔습니다.`, ...notes]);
    setPreset(null);
  }, [preset, setDraft, setPreset]);

  // 고른 종목 중 어느 묶음에도 없는 것은 「직접 추가한 종목」 에 보이게 한다(계좌에서 넘어온 종목·다시 시험 등)
  useEffect(() => {
    if (!uni.data) return;
    const known = new Set([...uni.data.watchlist.map((w) => w.symbol), ...uni.data.sectors.flatMap((g) => g.symbols.map((s) => s.symbol)), ...draft.added]);
    const missing = draft.symbols.filter((s) => !known.has(s));
    if (missing.length) patch({ added: [...draft.added, ...missing] });
  }, [uni.data, draft.symbols, draft.added, patch]);

  // 걸린 시간 — 실행 중일 때만 1초마다
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  // 이 화면에서 지켜본 실행이 끝나면 알리고 결과로 내린다
  useEffect(() => {
    if (!bt.finished) return;
    const r = bt.reports?.find((x) => x.id === bt.finished!.id);
    toast.success(`시험이 끝났습니다 (${r && isCustomSummary(r.summary) ? r.summary.symbols : bt.progress?.total ?? 0}종목)`);
    scrollTo.current = bt.finished.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bt.finished]);

  useEffect(() => {
    if (bt.detail && bt.detail.id === scrollTo.current) {
      scrollTo.current = null;
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }, [bt.detail]);

  const input = draftInput(draft);
  const errors = backtestInputErrors(input);
  const firstError = Object.values(errors)[0] ?? null;

  const run = async (force = false, override = input) => {
    setStarting(true);
    try {
      const p = await bt.start(override, force);
      if (p.reused) {
        toast.info('오늘 같은 조건으로 한 시험 결과를 열었습니다', '다시 계산하려면 결과의 [다시 계산] 을 누르세요.');
        scrollTo.current = p.reportId;
        if (bt.detail?.id === p.reportId) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (e) {
      toast.error('시험을 시작하지 못했습니다', (e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const confirmRemove = (item: BacktestListItem) =>
    modal.confirm({
      title: '백테스트 기록 지우기',
      message: `${when(item.createdAt)} ${isCustomSummary(item.summary) ? `시험(${item.summary.symbols}종목)` : '미리 정한 시험'}의 결과${
        isCustomSummary(item.summary) ? '와 AI 설명' : ''
      }을 지웁니다. 되돌릴 수 없습니다.${isCustomSummary(item.summary) ? '' : '\n서버의 파일 보고서는 남습니다.'}`,
      confirmText: '지우기',
      danger: true,
      onConfirm: async () => {
        try {
          await bt.remove(item.id);
        } catch (e) {
          toast.error('지우지 못했습니다', (e as Error).message);
        }
      },
    });

  const retry = (item: BacktestListItem) => {
    if (!isCustomSummary(item.summary)) return;
    const i = item.summary.input;
    setDraft((d) => ({ ...d, symbols: [...i.symbols], rule: { ...i.rule }, hardStopLossPercent: i.hardStopLossPercent, trailingStopEnabled: i.trailingStopEnabled, trailingStopPercent: i.trailingStopPercent, years: i.years }));
    setLoadedNote([`${when(item.createdAt)} 시험의 종목·조건을 채웠습니다.`]);
    document.getElementById('backtest-top')?.scrollIntoView({ behavior: 'smooth' });
  };

  const d = bt.detail;
  const p = bt.progress;
  const currentName = p?.current ? (stockNameOf(p.current) ?? p.current) : null;

  return (
    <div className="flex h-full min-h-0 gap-4 p-4">
      {/* ① 왼쪽 — 세로로 스크롤. 폭 360px, 1280 창에서는 300px(오른쪽 결과 표 자리를 남긴다) */}
      <div className="flex w-[300px] shrink-0 flex-col min-[1500px]:w-[360px]">
        <SymbolPicker
          universe={uni.data}
          loading={uni.loading}
          error={uni.error}
          onRetry={uni.reload}
          selected={draft.symbols}
          added={draft.added}
          onToggle={toggle}
          onAddMany={addMany}
          onRemoveMany={removeMany}
          onAddOutside={(s) => {
            patch({ added: draft.added.includes(s) ? draft.added : [...draft.added, s] });
            addMany([s]);
          }}
        />
      </div>

      {/* ②~⑤ 오른쪽 */}
      <div className="min-w-0 flex-1 space-y-4 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
        <div id="backtest-top">
          <SectionTitle level={1}>백테스트</SectionTitle>
        </div>
        <HelpBox id="backtest" storageKey="alphascope.backtestHelp" title="백테스트는 무엇인가요?">
          <p>백테스트는 정한 규칙으로 과거에 사고팔았다면 어땠을지 계산해 보는 것입니다. 실제 주문은 나가지 않습니다.</p>
          <p>순서: 왼쪽에서 종목을 고르고 → 조건을 정하고 → [시험 실행]. 그냥 들고 있었을 때·아무 날이나 사고팔았을 때와 나란히 보여 줍니다.</p>
          <p>과거 결과는 앞으로를 보장하지 않습니다.</p>
        </HelpBox>

        {loadedNote && (
          <Panel pad="sm" tone="tertiary" className="flex items-start gap-3 text-[13px] text-text-secondary">
            <div className="min-w-0 flex-1 space-y-0.5">
              {loadedNote.map((n) => (
                <p key={n}>{n}</p>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setLoadedNote(null)}>
              닫기
            </Button>
          </Panel>
        )}

        <ConditionForm draft={draft} patch={patch} gemini={gemini} />

        {/* ③ 실행 */}
        <Panel pad="sm" className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => void run()} disabled={running || starting || !!firstError}>
              {running || starting ? '시험 중…' : '시험 실행'}
            </Button>
            {!running && firstError && <span className="min-w-0 text-[13px] text-text-muted">{firstError}</span>}
            {!running && !firstError && (
              <span className="min-w-0 text-[13px] text-text-muted">
                {draft.symbols.length}종목 · {ruleConditionLine(input)} · 기간 {draft.years}년
              </span>
            )}
          </div>
          {running && p && (
            <div role="status" aria-live="polite" className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-secondary">
                <LoaderCircle {...ICON} className="animate-spin text-text-muted" aria-hidden />
                <span className="tabular-nums">
                  {p.done}/{p.total || '…'}
                </span>
                {currentName && <span>· 지금 {currentName}</span>}
                <span className="text-text-muted">· {elapsed(p.startedAt, now)} 지남</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${p.total ? Math.round((p.done / p.total) * 100) : 3}%` }} />
              </div>
              <p className="text-[13px] text-text-muted">다른 화면에 다녀와도 계산은 이어집니다.</p>
            </div>
          )}
          {bt.engineDown && <p className="rounded-lg bg-warning/10 px-3 py-2 text-[13px] text-warning">지표 엔진이 꺼져 있어 계산할 수 없습니다.</p>}
          {bt.error && !bt.engineDown && <p className="rounded-lg bg-bearish/10 px-3 py-2 text-[13px] text-bearish">{bt.error}</p>}
        </Panel>

        {/* ④ 결과 */}
        <div ref={resultRef} className="scroll-mt-2 space-y-2">
          <SectionTitle aside={d ? when(d.createdAt) : undefined}>결과</SectionTitle>
          {bt.detailLoading && !d ? (
            <Panel pad="sm">
              <SkeletonList count={4} />
            </Panel>
          ) : d ? (
            isCustomReport(d.detail) ? (
              <CustomResult
                id={d.id}
                report={d.detail}
                gemini={gemini}
                onExplain={bt.explain}
                onRerun={() => isCustomReport(d.detail) && void run(true, d.detail.input)}
                rerunBusy={running || starting}
                applySlot={<ApplyRuleButton conditions={d.detail.input} />}
              />
            ) : (
              <FixedResult r={d.detail} />
            )
          ) : (
            <Panel pad="sm" className="text-[13px] text-text-muted">
              {bt.reports == null ? '불러오는 중…' : '아직 결과가 없습니다. 종목과 조건을 정하고 [시험 실행] 을 누르세요.'}
            </Panel>
          )}
        </div>

        {/* ⑤ 지난 기록 */}
        <section className="space-y-2">
          <SectionTitle aside="내 시험 최근 20개 · 미리 정한 시험 최근 5개">지난 기록</SectionTitle>
          <Panel pad="none">
            {bt.reports == null ? (
              <div className="p-3">
                <SkeletonList count={3} />
              </div>
            ) : bt.reports.length === 0 ? (
              <p className="p-3 text-[13px] text-text-muted">아직 기록이 없습니다.</p>
            ) : (
              <ul className="divide-y divide-border/40">
                {bt.reports.map((item) => (
                  <HistoryRow
                    key={item.id}
                    item={item}
                    selected={item.id === bt.selectedId}
                    onOpen={() => {
                      scrollTo.current = item.id;
                      if (bt.detail?.id === item.id) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      bt.setSelectedId(item.id);
                    }}
                    onRetry={isCustomSummary(item.summary) ? () => retry(item) : undefined}
                    onRemove={() => confirmRemove(item)}
                  />
                ))}
              </ul>
            )}
          </Panel>
        </section>

        {/* ⚠️ 고정 문구 5개 — 지우지 않는다, 정보 아이콘에 넣지 않는다 (CLAUDE.md) */}
        <div className="space-y-0.5 pb-2 text-[13px] text-text-muted">
          <p>과거 결과이며 앞으로를 보장하지 않습니다.</p>
          <p>여러 조건을 바꿔 보며 가장 좋은 숫자를 고르면 우연에 속기 쉽습니다.</p>
          <p>종목마다 따로 계산했습니다 — 실제 계좌의 비중·동시 보유 한도는 반영하지 않았습니다.</p>
          <p>오늘의 시가총액 상위 종목으로 과거를 시험하면 그동안 사라진 종목이 빠져 실제보다 좋게 보일 수 있습니다(생존 편향).</p>
          <p>어느 방법도 이 앱에서 돈을 번다고 확인된 적은 없습니다.</p>
        </div>
      </div>
    </div>
  );
}
