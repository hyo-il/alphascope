import { formatDate, formatDateTime, formatTime } from '../../utils/dateFormat';
import DateGroupList, { SymbolsTitle } from '../common/DateGroupList';
import { formatSigned } from '../../utils/formatters';
import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useBacktest, useBacktestUniverse, useGeminiStatus } from '../../hooks/useBacktest';
import { draftRequest, useBacktestDraft } from '../../hooks/useBacktestDraft';
import { useTradingRules } from '../../hooks/useTradingRules';
import HelpBox from '../common/HelpBox';
import TrashIcon from '../common/TrashIcon';
import { SkeletonList } from '../common/SkeletonLoader';
import { Button, Panel, SectionTitle } from '../ui';
import { ICON } from '../ui/icon';
import { modal, toast } from '../../store/uiStore';
import { stockNameOf } from '../../utils/stockNames';
import { backtestInputError } from '../../utils/backtestInput';
import { ruleSellText } from '../../utils/ruleText';
import { MAX_COMPARE_SYMBOLS, methodName, type BacktestListItem } from '../../types/backtest';
import { HISTORY_DAYS_PAGE } from '../../types/buyJudge'; // 날짜 목록 한 번에 30일 — 매수 판단 히스토리와 같은 값
import SymbolTable from '../common/SymbolTable';
import ConditionForm from './ConditionForm';
import CustomResult from './CustomResult';
import ApplyRuleButton from './ApplyRuleButton';

/**
 * 「퀀트 > 백테스트」 (v2.38.0 → v2.44.0 매매 규칙) — **내가 고른 종목을 내가 고른 매매 규칙으로** 과거에 시험한다.
 * ① 종목(표) → ② 방법(규칙 1~3개) → ③ 기간 → [시험 실행] → 결과 → 백테스트 히스토리.
 *
 * - 계산은 서버(`runCustomBacktest` → 계좌와 같은 엔진 `evaluateRule`). 주문을 내지 않는다.
 * - 판정 배지 없음 — 거래가 적으면 「결론 내기 어려움」 만. 「가장 좋음」 강조 금지.
 * - 예전 「미리 정한 시험」(교차 계산기 고정 3년)은 v2.44.0 에 지웠다.
 * - 계좌 → 백테스트로 값을 넘기던 [백테스트에서 시험하기] 는 v2.44.2 에 없앴다(사용자 결정 C-2). 결과의 [계좌에 적용](백테스트 → 계좌)은 그대로.
 * - v2.36.0 디자인 규칙 — 이모지 없음, 파란 주요 버튼은 [시험 실행] 하나.
 */
const when = (iso: string) => formatDateTime(iso);
const pct = (v: number | null | undefined) => (v == null ? '—' : `${formatSigned(v, 2)}%`);

function elapsed(startedAt: string | null, now: number): string {
  if (!startedAt) return '';
  const sec = Math.max(0, Math.round((now - Date.parse(startedAt)) / 1000));
  return sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;
}

/** 날짜를 펼친 안의 시험 한 줄 — 시각 · 종목 수 · 기간 · 방법(규칙 이름) · [열기] · [이 조건으로 다시 실행] · 삭제 */
function HistoryRow({ item, selected, onOpen, onRetry, onRemove }: { item: BacktestListItem; selected: boolean; onOpen: () => void; onRetry?: () => void; onRemove: () => void }) {
  const s = item.summary;
  return (
    // 왼쪽 끝은 날짜 줄 안쪽과 같다(매수 판단 히스토리와 같은 모양 — 들여쓰기·바탕 상자 없음). 지금 보는 결과는 「보는 중」 글자로
    <li className="flex items-center gap-3 py-2 text-caption">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="tabular-nums text-text-primary">{formatTime(item.createdAt)}</span>
          {selected && <span className="text-text-primary">· 보는 중</span>}
          <span className="text-text-secondary">
            {s.symbols}종목 · {s.years}년
          </span>
          <span className="tabular-nums text-text-secondary">
            {s.input.conditions.length > 1 ? `방법 ${s.input.conditions.length}개 · 방법 1` : '이 방법'} {pct(s.rule)} vs 들고 있기 {pct(s.hold)}
          </span>
        </span>
        <span className="mt-0.5 block text-text-muted">
          {s.input.conditions
            .map((c) => `${s.input.conditions.length > 1 ? `${methodName(c.label)}: ` : ''}규칙 「${c.ruleName}」 (${ruleSellText(c.rule)})`)
            .join(' / ')}
        </span>
      </button>
      <Button size="sm" variant="secondary" onClick={onOpen}>
        열기
      </Button>
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          이 조건으로 다시 실행
        </Button>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${when(item.createdAt)} 결과 삭제`}
        title="삭제"
        className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-bg-tertiary hover:text-danger"
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
  const { draft, setDraft, patch, setMethodRule, addMethod, removeMethod } = useBacktestDraft();
  const { rules } = useTradingRules();
  const [loadedNote, setLoadedNote] = useState<string[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const resultRef = useRef<HTMLDivElement>(null);
  /** 이 id 의 결과가 화면에 도착하면 그리로 내린다 — 상세를 받기 전에 내리면 높이가 바뀌며 밀린다 */
  const scrollTo = useRef<number | null>(null);
  const running = bt.progress?.running ?? false;
  /** 백테스트 히스토리 — 날짜(이 기기 날짜)별로 묶는다. 최근이 위 */
  const [historyDays, setHistoryDays] = useState(HISTORY_DAYS_PAGE);
  const historyGroups = (() => {
    const map = new Map<string, BacktestListItem[]>();
    for (const r of bt.reports ?? []) {
      const d = formatDate(r.createdAt);
      map.set(d, [...(map.get(d) ?? []), r]);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([date, items]) => ({ date, items }));
  })();

  // 고른 종목 중 어느 묶음에도 없는 것은 「직접 추가한 종목」 에 보이게 한다(다시 시험 등)
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
    toast.success(`시험이 끝났습니다 (${r ? r.summary.symbols : (bt.progress?.total ?? 0)}종목)`);
    scrollTo.current = bt.finished.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bt.finished]);

  useEffect(() => {
    if (bt.detail && bt.detail.id === scrollTo.current) {
      scrollTo.current = null;
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }, [bt.detail]);

  const input = draftRequest(draft);
  // 종목 21개 이상 + 방법 2개 이상 · 규칙을 고르지 않은 방법이면 여기서 막고 이유를 보인다(조용히 자르지 않는다)
  const firstError = rules != null && rules.length === 0 ? '매매 규칙이 없습니다. 「퀀트 > 매매 규칙」 에서 먼저 만드세요.' : backtestInputError(input);
  const ruleNameOf = (id: number | null) => (id != null ? (rules?.find((r) => r.id === id)?.name ?? '—') : '—');

  const run = async (force = false, override = input) => {
    setStarting(true);
    try {
      const p = await bt.start(override, force);
      if (p.reused) {
        toast.info('오늘 같은 조건으로 한 시험 결과를 열었습니다', '새로 계산하려면 결과의 [다시 실행] 을 누르세요.');
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
      title: '백테스트 결과 삭제',
      message: `${when(item.createdAt)} 시험(${item.summary.symbols}종목)의 결과와 AI 설명을 삭제합니다. 되돌릴 수 없습니다.`,
      confirmText: '삭제',
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
    const i = item.summary.input;
    // 방법 전부를 채운다 — 규칙은 id 로(지금 그 규칙의 내용으로 시험된다). 지워진 규칙이면 그 방법을 비워 둔다
    const missing = i.conditions.filter((c) => !rules?.some((r) => r.id === c.ruleId));
    setDraft((d) => ({
      ...d,
      symbols: [...i.symbols],
      years: i.years,
      conditions: i.conditions.map((c) => ({ label: c.label, ruleId: rules?.some((r) => r.id === c.ruleId) ? c.ruleId : null })),
    }));
    setLoadedNote([
      `${when(item.createdAt)} 시험의 종목·방법을 채웠습니다. 규칙은 지금 내용으로 시험됩니다.`,
      ...(missing.length ? [`그 사이 지워진 규칙(${missing.map((c) => `「${c.ruleName}」`).join(', ')})은 비워 두었습니다.`] : []),
    ]);
    document.getElementById('backtest-top')?.scrollIntoView({ behavior: 'smooth' });
  };

  const d = bt.detail;
  const p = bt.progress;
  const currentName = p?.current ? (stockNameOf(p.current) ?? p.current) : null;

  return (
    <div className="h-full min-h-0 overflow-y-auto p-4 [scrollbar-gutter:stable]">
      <div className="space-y-4">
        <div id="backtest-top">
          <SectionTitle level={1}>백테스트</SectionTitle>
        </div>
        <HelpBox id="backtest" storageKey="alphascope.backtestHelp" title="백테스트는 무엇인가요?">
          <p>백테스트는 정한 규칙으로 과거에 매수·매도했다면 어땠을지 계산해 보는 것입니다. 실제 주문은 나가지 않습니다.</p>
          <p>순서: [종목 추가] → 방법(매매 규칙) 고르기 → 기간 → [시험 실행]. 그냥 들고 있었을 때·아무 날이나 매수·매도했을 때와 나란히 보여 줍니다.</p>
          <p>계좌와 같은 판단(매매 규칙 엔진)으로 계산합니다 — 신호는 그날 끝난 봉 기준, 매수·매도는 다음 날 시가, 손절·익절·트레일링은 그날 고가·저가로 봅니다.</p>
          <p>실적 발표 전 매수 막기 · 하루 손실 한도 · 종목당 비중 · 최대 보유 종목 수는 계좌 설정이라 백테스트에는 들어가지 않습니다.</p>
          <p>과거 결과는 앞으로를 보장하지 않습니다.</p>
        </HelpBox>

        {/* ① 종목 — 종목 목록 표(`common/SymbolTable`, v2.44.0 — 계좌 「② 대상 종목」 과 같은 부품) */}
        <Panel pad="sm" className="space-y-2">
          <SectionTitle>① 종목</SectionTitle>
          <SymbolTable
            selected={draft.symbols}
            onChange={(next) => patch({ symbols: next })}
            added={draft.added}
            onAddedChange={(next) => patch({ added: next })}
            softLimit={draft.conditions.length >= 2 ? MAX_COMPARE_SYMBOLS : null}
            softLimitText={(n, limit) => `방법을 비교할 때는 종목을 ${limit}개까지 고를 수 있습니다 — 지금 ${n}개`}
            dialogTitle="백테스트 종목 추가"
            // 종목이 많아도 아래 ② 방법이 밀리지 않게 접힌 한 줄로 연다 (v2.48.0)
            collapsible
          />
        </Panel>

        {loadedNote && (
          <Panel pad="sm" tone="tertiary" className="flex items-start gap-3 text-caption text-text-secondary">
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

        <ConditionForm draft={draft} rules={rules} patch={patch} setMethodRule={setMethodRule} addMethod={addMethod} removeMethod={removeMethod} />

        {/* 실행 */}
        <Panel pad="sm" className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => void run()} disabled={running || starting || !!firstError}>
              {running || starting ? '시험 중…' : '시험 실행'}
            </Button>
            {!running && firstError && <span className="min-w-0 text-caption text-text-muted">{firstError}</span>}
            {!running && !firstError && (
              <span className="min-w-0 text-caption text-text-muted">
                {draft.symbols.length}종목 · {input.conditions.length > 1 ? `방법 ${input.conditions.length}개 비교` : `규칙 「${ruleNameOf(input.conditions[0].ruleId)}」`} · 기간 {draft.years}년
              </span>
            )}
          </div>
          {running && p && (
            <div role="status" aria-live="polite" className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-caption text-text-secondary">
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
              <p className="text-caption text-text-muted">다른 화면에 다녀와도 계산은 이어집니다.</p>
            </div>
          )}
          {bt.engineDown && <p className="rounded-lg bg-warning/10 px-3 py-2 text-caption text-warning">지표 엔진이 꺼져 있어 계산할 수 없습니다.</p>}
          {bt.error && !bt.engineDown && <p className="rounded-lg bg-danger/10 px-3 py-2 text-caption text-danger">{bt.error}</p>}
        </Panel>

        {/* ④ 결과 */}
        <div ref={resultRef} className="scroll-mt-2 space-y-2">
          <SectionTitle aside={d ? when(d.createdAt) : undefined}>결과</SectionTitle>
          {bt.detailLoading && !d ? (
            <Panel pad="sm">
              <SkeletonList count={4} />
            </Panel>
          ) : d ? (
            <CustomResult
              id={d.id}
              report={d.detail}
              rules={rules}
              gemini={gemini}
              onExplain={bt.explain}
              onRerun={() =>
                void run(true, { symbols: d.detail.input.symbols, years: d.detail.input.years, conditions: d.detail.input.conditions.map((c) => ({ label: c.label, ruleId: c.ruleId })) })
              }
              rerunBusy={running || starting}
              applySlot={<ApplyRuleButton key={d.id} options={d.detail.input.conditions} rules={rules} />}
            />
          ) : (
            <Panel pad="sm" className="text-caption text-text-muted">
              {bt.reports == null ? '불러오는 중…' : '아직 결과가 없습니다. 종목과 방법(매매 규칙)을 고르고 [시험 실행] 을 누르세요.'}
            </Panel>
          )}
        </div>

        {/*
          ⑤ 백테스트 히스토리 (v2.48.0 — 매수 판단 히스토리와 같은 날짜별 목록 · 공용 DateGroupList).
          날짜 줄 = 그날 시험한 종목(「애플 외 9개」) · 방법 수·기간(시험이 여럿이면 「시험 N건」). 펼치면 그날 시험들.
          서버는 최근 100개를 보관한다(`researchStore` KEEP) — 날짜는 30일씩 보이고 [더 보기].
        */}
        <section className="space-y-2">
          <SectionTitle aside="최근 100개 보관">백테스트 히스토리</SectionTitle>
          {bt.reports == null ? (
            <Panel pad="sm">
              <SkeletonList count={3} />
            </Panel>
          ) : bt.reports.length === 0 ? (
            <Panel pad="sm" className="text-caption text-text-muted">
              아직 히스토리가 없습니다.
            </Panel>
          ) : (
            <DateGroupList
              label="날짜별 백테스트"
              hasMore={historyGroups.length > historyDays}
              onMore={() => setHistoryDays((n) => n + HISTORY_DAYS_PAGE)}
              groups={historyGroups.slice(0, historyDays).map(({ date, items }) => ({
                key: date,
                date,
                title: <SymbolsTitle symbols={[...new Set(items.flatMap((x) => x.summary.input.symbols))]} />,
                summary:
                  items.length === 1
                    ? `시험 1건 · 방법 ${items[0].summary.input.conditions.length}개 · ${items[0].summary.years}년`
                    : `시험 ${items.length}건`,
                render: () => (
                  <ul data-list className="space-y-1">
                    {items.map((item) => (
                      <HistoryRow
                        key={item.id}
                        item={item}
                        selected={item.id === bt.selectedId}
                        onOpen={() => {
                          scrollTo.current = item.id;
                          if (bt.detail?.id === item.id) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          bt.setSelectedId(item.id);
                        }}
                        onRetry={() => retry(item)}
                        onRemove={() => confirmRemove(item)}
                      />
                    ))}
                  </ul>
                ),
              }))}
            />
          )}
        </section>

        {/* ⚠️ 고정 문구 5개 — 지우지 않는다, 정보 아이콘에 넣지 않는다 (CLAUDE.md) */}
        <div className="space-y-0.5 pb-2 text-caption text-text-muted">
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
