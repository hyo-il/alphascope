import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Badge, Button, COLLECT_ICON, DisclosureButton, ICON_SM, InfoTip, PageHeader, Panel, SectionTitle, Select } from '../ui';
import { PANEL_PAD } from '../ui/tokens';
import WarnIcon from '../ui/WarnIcon';
import SymbolChartLink from '../common/SymbolChartLink';
import { SkeletonCards } from '../common/SkeletonLoader';
import LoadingOverlay, { InlineSpinner } from '../common/LoadingOverlay';
import { toast } from '../../store/uiStore';
import { changeColor, displayMinus, formatNumber, formatPercent } from '../../utils/formatters';
import { formatDateTime, formatTime } from '../../utils/dateFormat';
import { ASSET_LABEL, EDITION_LABEL, vixZone } from '../../utils/marketBrief';
import {
  BRIEF_AUTO_TIME,
  type BriefAsset,
  type BriefAssetKey,
  type BriefEarning,
  type BriefScheduleItem,
  type BriefStage,
  type MarketBrief,
  type MarketBriefDayResponse,
  type MarketBriefDays,
  type MarketBriefStatus,
} from '../../types/marketBrief';

/**
 * 탐색 → 오늘 시황 (v2.59.0) — Stockproject 시황 브리핑을 화면으로 옮긴 것. 칸 순서는 원본 메시지 그대로
 * ① 시장 기조 · ② 60일 주요 일정 · ③ 주도 섹터 · ④ 핵심 테마 · ⑤ 시장 데이터(참고) · ⑥ 스윙 체크포인트 · ⑦ 액션 포인트 · ⑧ 면책.
 *
 * - 서버가 평일 06:55 KST 뒤 첫 10분 확인(07:05 무렵)에 오전판을 만든다. 「시황 분석」 은 지금 시각의 판(13시 전 오전판 · 뒤 오후판)을 하루 5번까지.
 * - 진행 상태는 서버 것(`/api/market-brief/status`)을 읽는다 — 다른 화면에 갔다 와도 진행 중이면 그대로 보인다. 진행 중에만 2초마다 읽는다.
 * - AI 글의 이모지(⚠️ 🔴 등)는 화면에 그리지 않는다 — 아이콘 · 배지로 바꾼다. 하이픈 음수는 마이너스 기호로(`displayMinus`).
 * - 날짜별 30일 · 그날 여러 번 만든 것은 판/시각으로 고른다.
 * ⚠️ 투자 조언이 아니다 — 맨 아래 면책 문구는 화면 글자로 늘 보인다(지우지 않는다).
 */

const POLL_MS = 2000;
const STAGES: { id: BriefStage; label: string }[] = [
  { id: 'collect', label: '시장 데이터 받는 중' },
  { id: 'ai', label: 'AI 분석 중' },
  { id: 'save', label: '저장 중' },
];
const DISCLAIMER = '본 정보는 투자 권유가 아니며 투자 판단의 책임은 본인에게 있습니다.';
/** AI 없이 만든 브리핑의 ② — 묶음마다 이만큼만 보이고 나머지는 수로 */
const RAW_SCHEDULE_MAX = 8;

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const dayLabel = (day: string) => `${day.slice(5, 7)}/${day.slice(8, 10)}(${WEEKDAY[new Date(`${day}T12:00:00Z`).getUTCDay()]})`;
/** AI 글 정리 — 이모지를 빼고 하이픈 음수를 마이너스 기호로 */
const clean = (text: string | null | undefined) =>
  displayMinus(String(text ?? '').replace(/\p{Extended_Pictographic}️?/gu, '').replace(/\s{2,}/g, ' ').trim());

async function getJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T & { error?: string } }> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  return { ok: response.ok, status: response.status, body };
}

export default function MarketBriefView({ onSelectSymbol }: { onSelectSymbol: (symbol: string) => void }) {
  const [status, setStatus] = useState<MarketBriefStatus | null>(null);
  const [days, setDays] = useState<MarketBriefDays['days'] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [day, setDay] = useState<MarketBriefDayResponse | null>(null);
  const [loadingDay, setLoadingDay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const wasRunning = useRef(false);

  const loadStatus = useCallback(async () => {
    const r = await getJson<MarketBriefStatus>('/api/market-brief/status');
    if (!r.ok) throw new Error(r.body.error ?? `요청 실패 (${r.status})`);
    setStatus(r.body);
    return r.body;
  }, []);

  const loadDays = useCallback(async () => {
    const r = await getJson<MarketBriefDays>('/api/market-brief/days');
    if (!r.ok) throw new Error(r.body.error ?? `요청 실패 (${r.status})`);
    setDays(r.body.days);
  }, []);

  const loadDay = useCallback(async (d: string, id?: number) => {
    setLoadingDay(true);
    try {
      const r = await getJson<MarketBriefDayResponse>(`/api/market-brief?date=${d}${id ? `&id=${id}` : ''}`);
      if (!r.ok) throw new Error(r.body.error ?? `요청 실패 (${r.status})`);
      setDay(r.body);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingDay(false);
    }
  }, []);

  // 처음 — 상태(오늘 날짜) → 날짜 목록 · 오늘 것
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await loadStatus();
        if (!alive) return;
        wasRunning.current = s.running;
        setDate(s.today);
        await Promise.all([loadDays(), loadDay(s.today)]);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadStatus, loadDays, loadDay]);

  // 진행 중에만 2초마다 상태 — 끝나면 날짜 목록과 오늘(방금 만든 것)을 다시 읽는다
  const running = status?.running ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void loadStatus()
        .then((s) => {
          if (s.running || !wasRunning.current) return;
          wasRunning.current = false;
          if (s.lastError) toast.error('시황을 만들지 못했습니다', s.lastError);
          setDate(s.today);
          void loadDays();
          void loadDay(s.today, s.lastFinishedId ?? undefined);
        })
        .catch(() => {
          /* 다음 차례에 다시 */
        });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, loadStatus, loadDays, loadDay]);

  const run = async () => {
    setStarting(true);
    try {
      const r = await getJson<{ started: boolean; status: MarketBriefStatus }>('/api/market-brief/run', { method: 'POST' });
      if (r.body.status) setStatus(r.body.status);
      if (r.status === 429) {
        toast.warning(r.body.error ?? '오늘 버튼을 다 썼습니다');
        return;
      }
      if (!r.ok) throw new Error(r.body.error ?? `요청 실패 (${r.status})`);
      wasRunning.current = true;
    } catch (e) {
      toast.error('시황 분석을 시작하지 못했습니다', (e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const pickDate = (d: string) => {
    setDate(d);
    void loadDay(d);
  };

  const dateOptions = (() => {
    if (!status || !days) return [];
    const list = [...days];
    if (!list.some((d) => d.date === status.today)) list.unshift({ date: status.today, count: 0 });
    return list;
  })();
  const selected = day?.selected ?? null;
  const firstLoad = !day && !error;

  return (
    <div className="flex h-full flex-col" data-market-brief>
      <PageHeader title="오늘 시황" right={status && <RunControls status={status} starting={starting} onRun={run} />} />
      <div className={`min-h-0 flex-1 overflow-auto ${PANEL_PAD} pt-0`} style={{ scrollbarGutter: 'stable' }}>
        {/* 고르기 줄 — 날짜(30일) · 그날 판/시각 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select
            size="sm"
            aria-label="날짜"
            className="w-52"
            value={date ?? ''}
            disabled={!dateOptions.length}
            onChange={(e) => pickDate(e.target.value)}
          >
            {dateOptions.map((d) => (
              <option key={d.date} value={d.date}>
                {d.date} {dayLabel(d.date).slice(5)}
                {d.date === status?.today ? ' 오늘' : ''} · {d.count ? `${d.count}개` : '없음'}
              </option>
            ))}
          </Select>
          {day && day.items.length > 0 && (
            <Select
              size="sm"
              aria-label="판 · 만든 시각"
              className="w-60"
              value={selected?.id ?? ''}
              onChange={(e) => date && void loadDay(date, Number(e.target.value))}
            >
              {day.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {formatTime(i.createdAt)} {EDITION_LABEL[i.edition]} · {i.trigger === 'auto' ? '자동' : '버튼'}
                  {i.hasAi ? '' : ' · AI 없음'}
                </option>
              ))}
            </Select>
          )}
          {loadingDay && day && <InlineSpinner />}
          <span className="text-caption text-text-muted">30일 보관 · 자동은 평일 {BRIEF_AUTO_TIME} 뒤 첫 확인(07:05 무렵)에 오전판</span>
        </div>

        {status?.running && <ProgressBanner stage={status.stage} edition={status.edition} trigger={status.trigger} />}

        {error && !day && (
          <Panel className="text-xs text-danger">
            <WarnIcon />
            불러오지 못했습니다 — {error}
          </Panel>
        )}
        {firstLoad && <SkeletonCards count={4} />}
        {day && (
          <div className="relative">
            {loadingDay && <LoadingOverlay contained label="불러오는 중…" />}
            {selected ? (
              <BriefBody brief={selected} onOpen={onSelectSymbol} />
            ) : (
              <EmptyDay isToday={day.date === status?.today} running={status?.running ?? false} canRun={!!status && status.buttonUsed < status.buttonLimit} onRun={run} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 제목 줄 오른쪽 — 판 안내 · 남은 횟수 · 「시황 분석」 */
function RunControls({ status, starting, onRun }: { status: MarketBriefStatus; starting: boolean; onRun: () => void }) {
  const left = Math.max(0, status.buttonLimit - status.buttonUsed);
  const spent = left === 0;
  return (
    <>
      <span className="text-caption text-text-muted">
        지금 시각 기준 — {EDITION_LABEL[status.nowEdition]}({status.nowEdition === 'morning' ? '미국 마감 기준' : '국내 마감 · VIX'})
      </span>
      <InfoTip label="오전판 · 오후판">
        한국 시간 13시 전에 누르면 오전판(미국 증시 · 금리 · 달러 · 금 · 원유 등 13가지, 국내 · 해외 뉴스), 13시부터는 오후판(코스피 · 코스닥 마감 · VIX 공포지수, 국내 뉴스)을 만듭니다.
        버튼은 하루 {status.buttonLimit}번까지이고, 평일 아침 자동으로 만드는 오전판은 횟수에 세지 않습니다.
      </InfoTip>
      {status.geminiDisabledReason && (
        <span className="text-caption text-warning" title={status.geminiDisabledReason}>
          <WarnIcon />
          AI 꺼짐 — 데이터만 만듭니다
        </span>
      )}
      <span className={`text-caption tabular-nums ${spent ? 'text-warning' : 'text-text-secondary'}`}>
        {spent ? `오늘 버튼 ${status.buttonLimit}번을 다 썼습니다 — 내일 다시` : `오늘 남은 횟수 ${left}/${status.buttonLimit}`}
      </span>
      <Button variant="primary" busy={status.running || starting} disabled={spent} onClick={onRun}>
        {status.running ? '분석 중…' : '시황 분석'}
      </Button>
    </>
  );
}

function ProgressBanner({ stage, edition, trigger }: { stage: BriefStage | null; edition: MarketBriefStatus['edition']; trigger: MarketBriefStatus['trigger'] }) {
  const at = STAGES.findIndex((s) => s.id === stage);
  return (
    <Panel pad="sm" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" role="status" aria-live="polite">
      <InlineSpinner />
      <span className="font-medium text-text-primary">
        {edition ? EDITION_LABEL[edition] : '시황'} 만드는 중{trigger === 'auto' ? '(자동)' : ''}
      </span>
      <ol className="flex flex-wrap items-center gap-x-2 text-caption">
        {STAGES.map((s, i) => (
          <li key={s.id} className={i === at ? 'font-medium text-text-primary' : i < at ? 'text-text-secondary' : 'text-text-muted'}>
            {i > 0 && <span className="mr-2 text-text-muted">→</span>}
            {s.label}
          </li>
        ))}
      </ol>
      <span className="text-caption text-text-muted">1~3분 걸립니다 · 다른 화면에 다녀와도 계속됩니다</span>
    </Panel>
  );
}

function EmptyDay({ isToday, running, canRun, onRun }: { isToday: boolean; running: boolean; canRun: boolean; onRun: () => void }) {
  return (
    <Panel className="flex flex-wrap items-center gap-3 text-xs text-text-secondary">
      <span>
        {isToday
          ? `아직 오늘 시황이 없습니다 — 평일 07:05 무렵 자동으로 만들어집니다.`
          : '이 날 만든 시황이 없습니다.'}
      </span>
      {isToday && !running && canRun && (
        <Button size="sm" onClick={onRun}>
          시황 분석
        </Button>
      )}
    </Panel>
  );
}

// ── 본문 ────────────────────────────────────────────────────────────────

function Card({ title, aside, info, children, id }: { title: string; aside?: ReactNode; info?: ReactNode; children: ReactNode; id: string }) {
  return (
    <Panel data-brief-card={id} className="space-y-2">
      <SectionTitle aside={aside} info={info}>
        {title}
      </SectionTitle>
      {children}
    </Panel>
  );
}

function BriefBody({ brief, onOpen }: { brief: MarketBrief; onOpen: (symbol: string) => void }) {
  const ai = brief.brief;
  const basisKey: BriefAssetKey = brief.edition === 'morning' ? 'SP500' : 'KOSPI';
  const basis = brief.data.assets[basisKey]?.data_date;
  return (
    <div className="space-y-3">
      {/* 만든 시각 · 데이터 기준 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-text-muted" data-brief-meta>
        <Badge>{EDITION_LABEL[brief.edition]}</Badge>
        <span>{brief.trigger === 'auto' ? '자동으로 만듦' : '「시황 분석」 으로 만듦'}</span>
        <span className="tabular-nums">만든 시각 {formatDateTime(brief.createdAt)}</span>
        <span className="tabular-nums">
          데이터 기준 {basis ? `${brief.edition === 'morning' ? '미국' : '국내'} ${dayLabel(basis)} 종가` : '모름'}
        </span>
      </div>

      {!ai && (
        <Panel pad="sm" className="text-xs text-warning" data-brief-ai-error>
          <WarnIcon />
          AI 분석이 없습니다 — {brief.aiError ?? '이유 모름'}. 시장 데이터와 실적 일정만 보입니다.
        </Panel>
      )}

      {/* ① 시장 기조 */}
      <Card id="regime" title={brief.edition === 'morning' ? '시장 기조' : '시장 총평'}>
        {ai ? <RegimeBody brief={brief} /> : <p className="text-xs text-text-muted">AI 분석이 없어 시장 기조를 쓰지 못했습니다.</p>}
      </Card>

      {/* ② 60일 주요 일정 */}
      <Card
        id="schedule"
        title="향후 60일 주요 일정"
        aside={ai ? '주도 섹터의 실적 · 경제지표' : '수집한 실적 일정(AI 거르기 없음)'}
        info="실적 발표일은 앱의 실적 일정(시총 상위 · 관심 · 자동매매 종목)에서, 예상 EPS · 매출 · 컨센서스는 yfinance 에서 가져옵니다. 이번 주는 섹터마다 3개 · 모두 6개, 이번 달은 3개 · 5개, 다음 한 달은 2개 · 5개까지 보입니다. 국내 종목은 섹터와 상관없이 남깁니다."
      >
        {ai ? <ScheduleBody schedule={ai.upcoming_schedule} earnings={brief.data.earnings} onOpen={onOpen} /> : <RawSchedule earnings={brief.data.earnings} onOpen={onOpen} />}
      </Card>

      {ai && (
        <>
          {/* ③ 주도 섹터 */}
          <Card
            id="sectors"
            title="현재 주도 섹터"
            info="기준 A = 3개월 넘게 이어질 상승 근거, 기준 B = 방향과 상관없이 시장 관심이 몰린 섹터(하락 쪽이면 「숏 관점」 · 「관망」 으로 읽습니다). 별 셋이 가장 강합니다."
          >
            <ul className="space-y-3">
              {ai.leading_sectors.map((s, i) => (
                <li key={i} className="space-y-1 text-xs">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-semibold text-text-primary">{s.name}</span>
                    <span className="text-caption text-text-secondary" aria-label={`별 ${(s.stars.match(/★/g) ?? []).length}개`}>
                      {s.stars}
                    </span>
                  </div>
                  {s.reason && <p className="break-keep text-text-secondary">{clean(s.reason)}</p>}
                  {s.stocks_kr && <LabeledLine label="국내">{clean(s.stocks_kr)}</LabeledLine>}
                  {s.stocks_us && <LabeledLine label="미국">{clean(s.stocks_us)}</LabeledLine>}
                </li>
              ))}
            </ul>
          </Card>

          {/* ④ 핵심 테마 */}
          <Card id="themes" title="핵심 테마" aside="1~3개월">
            <ul className="space-y-3">
              {ai.key_themes.map((t, i) => (
                <li key={i} className="space-y-1 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <ThemeBadge icon={t.icon} />
                    {t.category && <Badge>{clean(t.category)}</Badge>}
                    <span className="font-semibold text-text-primary">{clean(t.title)}</span>
                  </div>
                  {t.duration && <LabeledLine label="지속">{clean(t.duration)}</LabeledLine>}
                  {t.why_important && <LabeledLine label="왜 중요">{clean(t.why_important)}</LabeledLine>}
                  {t.swing_point && <LabeledLine label="스윙 관점">{clean(t.swing_point)}</LabeledLine>}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {/* ⑤ 시장 데이터(참고) */}
      <Card id="market" title="시장 데이터" aside="참고">
        <MarketData brief={brief} />
      </Card>

      {ai && (
        <>
          {/* ⑥ 스윙 체크포인트 */}
          <Card id="swing" title="스윙 체크포인트">
            <div className="space-y-2 text-xs">
              {ai.swing_check.phase && <LabeledLine label="국면">{clean(ai.swing_check.phase)}</LabeledLine>}
              <BulletList label="주목 촉매" items={ai.swing_check.catalysts} empty="1~2주 안 경제지표 · 정책 일정 없음" />
              <BulletList label="주요 리스크" items={ai.swing_check.risks} empty="없음" />
            </div>
          </Card>

          {/* ⑦ 액션 포인트 */}
          <Card id="action" title="액션 포인트" info="AI 가 쓴 참고 의견입니다 — 매수 · 매도 신호가 아니고, 앱의 매매 규칙 · 자동매매에 쓰지 않습니다.">
            <div className="space-y-2 text-xs">
              {ai.portfolio_adjustment.passive_note && <LabeledLine label="패시브">{clean(ai.portfolio_adjustment.passive_note)}</LabeledLine>}
              {ai.portfolio_adjustment.swing_candidates.length > 0 && (
                <div className="space-y-1">
                  <div className="text-caption text-text-muted">스윙 진입 후보</div>
                  <ul className="space-y-1">
                    {ai.portfolio_adjustment.swing_candidates.slice(0, 2).map((c, i) => (
                      <li key={i} className="flex gap-2 break-keep text-text-primary">
                        <span className="text-text-muted">•</span>
                        <CandidateText text={c} onOpen={onOpen} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>
        </>
      )}

      {/* ⑧ 면책 — 화면 글자로 늘 보인다 */}
      <p className="break-keep text-caption text-text-muted" data-brief-disclaimer>
        <WarnIcon />
        {DISCLAIMER} 투자 조언이 아닙니다. AI(Gemini)가 뉴스 제목과 시장 데이터로 쓴 글이라 틀릴 수 있습니다.
      </p>

      <CollectStatus brief={brief} />
    </div>
  );
}

function LabeledLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 text-caption text-text-muted">{label}</span>
      <span className="min-w-0 break-keep text-text-primary">{children}</span>
    </div>
  );
}

function BulletList({ label, items, empty }: { label: string; items: string[]; empty: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 text-caption text-text-muted">{label}</span>
      {items.length ? (
        <ul className="min-w-0 space-y-1">
          {items.map((t, i) => (
            <li key={i} className="flex gap-2 break-keep text-text-primary">
              <span className="text-text-muted">•</span>
              <span>{clean(t)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-text-muted">{empty}</span>
      )}
    </div>
  );
}

const REGIME_TONE = { 'Risk-On': 'bullish', 'Risk-Off': 'bearish', 혼조: 'warning' } as const;
const REGIME_TIP = {
  'Risk-On': '위험 자산(주식)을 사려는 분위기',
  'Risk-Off': '위험을 피하려는 분위기(안전 자산 선호)',
  혼조: '방향이 섞여 뚜렷하지 않음',
} as const;

function RegimeBody({ brief }: { brief: MarketBrief }) {
  const ai = brief.brief!;
  const vix = brief.data.assets.VIX;
  return (
    <div className="space-y-2 text-xs">
      {brief.edition === 'morning' ? (
        <>
          {ai.market_regime && (
            <div className="flex items-center gap-2">
              <Badge tone={REGIME_TONE[ai.market_regime]} title={REGIME_TIP[ai.market_regime]}>
                {ai.market_regime}
              </Badge>
              <span className="text-caption text-text-muted">{REGIME_TIP[ai.market_regime]}</span>
            </div>
          )}
          {ai.regime_summary && <p className="break-keep text-text-primary">{clean(ai.regime_summary)}</p>}
        </>
      ) : (
        <>
          {ai.market_summary && <p className="break-keep text-text-primary">{clean(ai.market_summary)}</p>}
          {ai.vix_comment && (
            <LabeledLine label={vix ? `VIX ${vixZone(vix.current)}` : 'VIX'}>{clean(ai.vix_comment)}</LabeledLine>
          )}
        </>
      )}
      {ai.portfolio_note && <LabeledLine label="포트폴리오">{clean(ai.portfolio_note)}</LabeledLine>}
    </div>
  );
}

const THEME_KIND: Record<string, { tone: 'bullish' | 'bearish' | 'neutral'; label: string }> = {
  '🟢': { tone: 'bullish', label: '상승 모멘텀' },
  '🔴': { tone: 'bearish', label: '하락 리스크' },
  '🟡': { tone: 'neutral', label: '중립 · 혼조' },
};

function ThemeBadge({ icon }: { icon: string }) {
  const kind = THEME_KIND[icon.trim()] ?? THEME_KIND['🟡'];
  return <Badge tone={kind.tone}>{kind.label}</Badge>;
}

const GROUPS = [
  { key: 'this_week', label: '이번 주', range: '7일 안', badge: '매우 중요' },
  { key: 'this_month', label: '이번 달', range: '8~30일 안', badge: '중요' },
  { key: 'next_2_months', label: '다음 한 달', range: '31~60일 안', badge: null },
] as const;

const SANITY_TIP =
  '예상 EPS 가 직전 분기 실제의 2.5배를 넘거나 0.4배에 못 미치거나, 애널리스트 추정치가 크게 갈립니다(분산 50% 초과). 추정치가 부정확할 수 있습니다.';

function ScheduleBody({
  schedule,
  earnings,
  onOpen,
}: {
  schedule: NonNullable<MarketBrief['brief']>['upcoming_schedule'];
  earnings: BriefEarning[];
  onOpen: (symbol: string) => void;
}) {
  const bySymbol = new Map(earnings.map((e) => [e.symbol.toUpperCase(), e]));
  const total = GROUPS.reduce((n, g) => n + schedule[g.key].length, 0);
  if (!total) return <p className="text-xs text-text-muted">60일 안에 주도 섹터의 실적 · 주요 경제지표 일정이 없습니다.</p>;
  return (
    <div className="space-y-3">
      {GROUPS.map((g) =>
        schedule[g.key].length ? (
          <div key={g.key} className="space-y-1.5" data-brief-slot={g.key}>
            <div className="flex items-center gap-2 text-caption text-text-muted">
              <span className="font-medium text-text-secondary">{g.label}</span>
              <span>{g.range}</span>
              {g.badge && <Badge tone="warning">{g.badge}</Badge>}
            </div>
            <ul className="space-y-2">
              {schedule[g.key].map((item, i) => (
                <ScheduleRow key={i} item={item} earning={item.ticker ? bySymbol.get(item.ticker.toUpperCase().replace(/\.(KS|KQ)$/, '')) : undefined} onOpen={onOpen} />
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}

function ScheduleRow({ item, earning, onOpen }: { item: BriefScheduleItem; earning?: BriefEarning; onOpen: (symbol: string) => void }) {
  const flagged = earning?.epsSanityFlag || /신뢰도 주의|⚠/.test(item.detail);
  const detail = clean(item.detail.replace(/,?\s*신뢰도 주의\s*$/, ''));
  const symbol = earning?.symbol ?? (item.ticker ? item.ticker.toUpperCase().replace(/\.(KS|KQ)$/, '') : null);
  return (
    <li className="text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-[72px] shrink-0 tabular-nums text-text-secondary">{item.date.slice(0, 9)}</span>
        <span className="font-medium text-text-primary">{clean(item.event)}</span>
        {/* 회사 이름은 event(「마이크론 실적 발표」)에 이미 있다 — 링크는 티커만(이름 = 티커로 주면 StockName 이 티커만 적는다) */}
        {symbol && <SymbolChartLink symbol={symbol} name={symbol} onOpen={onOpen} className="text-caption" />}
        {item.sector_kr && <Badge>{item.sector_kr}</Badge>}
        {flagged && (
          <span className="inline-flex items-center gap-1 text-caption text-warning">
            <TriangleAlert {...ICON_SM} />
            신뢰도 주의
            <InfoTip label="신뢰도 주의">{SANITY_TIP}</InfoTip>
          </span>
        )}
      </div>
      {detail && <p className="mt-0.5 break-keep pl-[80px] text-caption text-text-secondary tabular-nums">{detail}</p>}
    </li>
  );
}

/** AI 없이 만든 브리핑 — 수집한 실적 일정을 같은 세 묶음으로(묶음마다 앞 8개) */
function RawSchedule({ earnings, onOpen }: { earnings: BriefEarning[]; onOpen: (symbol: string) => void }) {
  if (!earnings.length) return <p className="text-xs text-text-muted">60일 안 실적 일정을 받지 못했습니다(수집 상태를 보세요).</p>;
  const groups = [
    { label: '이번 주', range: '7일 안', items: earnings.filter((e) => e.daysUntil <= 7) },
    { label: '이번 달', range: '8~30일 안', items: earnings.filter((e) => e.daysUntil >= 8 && e.daysUntil <= 30) },
    { label: '다음 한 달', range: '31~60일 안', items: earnings.filter((e) => e.daysUntil >= 31 && e.daysUntil <= 60) },
  ].map((g) => ({ ...g, items: [...g.items].sort((a, b) => a.daysUntil - b.daysUntil) }));
  return (
    <div className="space-y-3">
      {groups.map((g) =>
        g.items.length ? (
          <div key={g.label} className="space-y-1.5">
            <div className="flex items-center gap-2 text-caption text-text-muted">
              <span className="font-medium text-text-secondary">{g.label}</span>
              <span>{g.range}</span>
              <span className="tabular-nums">· {g.items.length}종목</span>
            </div>
            <ul className="space-y-2">
              {g.items.slice(0, RAW_SCHEDULE_MAX).map((e) => (
                <ScheduleRow
                  key={e.symbol}
                  item={{ date: dayLabel(e.date), event: `${e.name} 실적 발표${e.isEstimateDate ? '(예정)' : ''}`, ticker: e.symbol, sector_kr: e.sector, detail: rawDetail(e), importance: 0 }}
                  earning={e}
                  onOpen={onOpen}
                />
              ))}
            </ul>
            {g.items.length > RAW_SCHEDULE_MAX && <p className="text-caption text-text-muted">외 {g.items.length - RAW_SCHEDULE_MAX}종목</p>}
          </div>
        ) : null,
      )}
    </div>
  );
}

/** 원본 압축형 detail 과 같은 모양 */
function rawDetail(e: BriefEarning): string {
  if (!e.estimatesOk) return '전망치를 받지 못했습니다';
  const disp = e.epsDispersion !== '-' ? `, ${e.epsDispersion.replace('분산 ', '')}` : '';
  const rev = e.revenueEstimate !== '-' ? ` | 매출 ${e.revenueEstimate}` : '';
  return `예상 EPS ${e.epsEstimate} (직전 ${e.lastQuarterEps}, YoY ${e.yoyEps}${disp}) | 컨센서스 ${e.recommendation.replace(' (', '(')}${rev}`;
}

/** 「마이크론(MU) — …」 의 앞 종목을 차트 링크로 */
function CandidateText({ text, onOpen }: { text: string; onOpen: (symbol: string) => void }) {
  const t = clean(text);
  const m = /^(.+?)\(([A-Z][A-Z.-]{0,5}|\d[0-9A-Z]{5})(?:\.(?:KS|KQ))?\)(.*)$/s.exec(t);
  if (!m) return <span>{t}</span>;
  return (
    <span>
      <SymbolChartLink symbol={m[2]} name={m[1].trim()} onOpen={onOpen} className="font-medium" />
      {m[3]}
    </span>
  );
}

// ── ⑤ 시장 데이터 ────────────────────────────────────────────────────────

const prevOf = (a: BriefAsset) => a.current - a.change;
const Arrow = ({ change }: { change: number }) => (
  <span className={changeColor(change)} aria-label={change >= 0 ? '올랐음' : '내렸음'}>
    {change >= 0 ? '▲' : '▼'}
  </span>
);

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="shrink-0 text-text-secondary">{label}</span>
      <span className="whitespace-nowrap text-right tabular-nums text-text-primary">{children}</span>
    </div>
  );
}

function Group({ title, date, children }: { title: string; date?: string | null; children: ReactNode }) {
  return (
    <div className="space-y-1 rounded-lg bg-bg-tertiary/60 p-3" data-brief-group={title}>
      <div className="flex items-baseline justify-between gap-2 text-caption">
        <span className="font-medium text-text-secondary">{title}</span>
        {date && <span className="tabular-nums text-text-muted">{dayLabel(date)} 종가</span>}
      </div>
      {children}
    </div>
  );
}

/** 지수 — 원본처럼 「등락률% → 현재값」 */
function IndexRow({ label, a }: { label: string; a?: BriefAsset }) {
  if (!a) return null;
  return (
    <Row label={label}>
      <span className={changeColor(a.change_pct)}>{formatPercent(a.change_pct)}</span>
      <span className="mx-1.5 text-text-muted">→</span>
      {formatNumber(a.current, 2)}
    </Row>
  );
}

/** 금리 · 달러 · 금 · 에너지 — 원본처럼 「전일 → 현재 ▲」 */
function MoveRow({ label, a, digits, suffix = '' }: { label: string; a?: BriefAsset; digits: number; suffix?: string }) {
  if (!a) return null;
  return (
    <Row label={label}>
      {formatNumber(prevOf(a), digits, suffix)}
      <span className="mx-1.5 text-text-muted">→</span>
      {formatNumber(a.current, digits, suffix)} <Arrow change={a.change} />
    </Row>
  );
}

function MarketData({ brief }: { brief: MarketBrief }) {
  const a = brief.data.assets;
  const missing = (keys: BriefAssetKey[]) => keys.filter((k) => !a[k]).map((k) => ASSET_LABEL[k]);
  if (brief.edition === 'afternoon') {
    const lost = missing(['KOSPI', 'KOSDAQ', 'VIX']);
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Group title="국내 지수" date={a.KOSPI?.data_date}>
            <IndexRow label="코스피" a={a.KOSPI} />
            <IndexRow label="코스닥" a={a.KOSDAQ} />
          </Group>
          <Group title="공포지수" date={a.VIX?.data_date}>
            {a.VIX && <MoveRow label={`VIX (${vixZone(a.VIX.current)} 구간)`} a={a.VIX} digits={2} />}
          </Group>
        </div>
        <Missing names={lost} />
      </div>
    );
  }
  const lost = missing(['SP500', 'NASDAQ', 'DOW', 'RUSSELL2000', 'US2Y', 'US10Y', 'DXY', 'GOLD', 'WTI', 'NATGAS', 'USDKRW', 'KOSPI', 'KOSDAQ']);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Group title="미국 증시" date={a.SP500?.data_date}>
          <IndexRow label="S&P500" a={a.SP500} />
          <IndexRow label="나스닥" a={a.NASDAQ} />
          <IndexRow label="다우" a={a.DOW} />
          <IndexRow label="러셀2000" a={a.RUSSELL2000} />
        </Group>
        <Group title="미국 국채 수익률" date={a.US10Y?.data_date ?? a.US2Y?.data_date}>
          <MoveRow label="2년" a={a.US2Y} digits={3} suffix="%" />
          <MoveRow label="10년" a={a.US10Y} digits={3} suffix="%" />
        </Group>
        <Group title="달러 인덱스" date={a.DXY?.data_date}>
          <MoveRow label="DXY" a={a.DXY} digits={3} />
        </Group>
        <Group title="골드" date={a.GOLD?.data_date}>
          <MoveRow label="금(달러/온스)" a={a.GOLD} digits={2} />
        </Group>
        <Group title="에너지" date={a.WTI?.data_date ?? a.NATGAS?.data_date}>
          <MoveRow label="WTI(달러/배럴)" a={a.WTI} digits={2} />
          <MoveRow label="천연가스" a={a.NATGAS} digits={3} />
        </Group>
        <Group title="원/달러" date={a.USDKRW?.data_date}>
          {a.USDKRW && (
            <Row label="환율">
              {formatNumber(prevOf(a.USDKRW), 2)}
              <span className="mx-1.5 text-text-muted">→</span>
              {formatNumber(a.USDKRW.current, 2)}원 <Arrow change={a.USDKRW.change} />{' '}
              <span className={changeColor(a.USDKRW.change_pct)}>{formatPercent(a.USDKRW.change_pct)}</span>
            </Row>
          )}
        </Group>
        <Group title="국내 지수" date={a.KOSPI?.data_date}>
          <IndexRow label="코스피" a={a.KOSPI} />
          <IndexRow label="코스닥" a={a.KOSDAQ} />
        </Group>
      </div>
      <Missing names={lost} />
    </div>
  );
}

function Missing({ names }: { names: string[] }) {
  if (!names.length) return null;
  return (
    <p className="text-caption text-warning">
      <WarnIcon />
      받지 못한 값: {names.join(' · ')}
    </p>
  );
}

// ── 수집 상태 ────────────────────────────────────────────────────────────

function CollectStatus({ brief }: { brief: MarketBrief }) {
  const [open, setOpen] = useState(false);
  const failed = brief.sources.filter((s) => !s.ok).length;
  return (
    <div className="space-y-2" data-brief-sources>
      <div className="flex items-center gap-2">
        <DisclosureButton open={open} onToggle={() => setOpen((v) => !v)} label="수집 상태 보기" controls="brief-sources" />
        <span className={`text-caption ${failed ? 'text-warning' : 'text-text-muted'}`}>
          {failed ? `${failed}곳 실패` : '모두 받음'}
          {brief.model ? ` · 모델 ${brief.model}` : ''}
        </span>
      </div>
      {open && (
        <Panel pad="sm" id="brief-sources" className="space-y-1">
          {brief.sources.map((s, i) => {
            const Icon = s.ok ? COLLECT_ICON.ok : COLLECT_ICON.fail;
            return (
              <div key={i} className="flex items-start gap-2 text-xs">
                <Icon {...ICON_SM} className={`mt-0.5 shrink-0 ${s.ok ? 'text-text-muted' : 'text-danger'}`} />
                <span className="w-64 shrink-0 text-text-secondary">{s.label}</span>
                <span className={`min-w-0 break-keep ${s.ok ? 'text-text-primary' : 'text-danger'}`}>
                  {s.ok ? '받음' : '실패'} · {s.detail}
                </span>
              </div>
            );
          })}
          <div className="pt-1 text-caption text-text-muted tabular-nums">
            AI 호출 {brief.aiCalls}번{brief.tokens ? ` · 토큰 ${brief.tokens.toLocaleString('en-US')}` : ''} · 프롬프트 {brief.promptVersion}
          </div>
        </Panel>
      )}
    </div>
  );
}
