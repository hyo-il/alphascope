import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Badge, InfoTip, NumberField, PageHeader, SectionTitle, Select } from '../ui';
import { LIST_TABLE_ROW, PANEL_PAD, TABLE_NAME_COL, TABLE_NUM_COL, TABLE_NUM_GAP, TABLE_NUM_GAP_TIGHT } from '../ui/tokens';
import StockName from '../common/StockName';
import { SkeletonTable } from '../common/SkeletonLoader';
import { InlineSpinner } from '../common/LoadingOverlay';
import { useWatchlist } from '../../hooks/useWatchlist';
import { toast } from '../../store/uiStore';
import { HALT_CODES, directionUnknownText, haltCodeLabel, haltCodeTitle } from '../../data/haltCodes';
import {
  DEFAULT_HALT_RANK_TOP,
  DEFAULT_HALT_RANK_VIEW,
  HALT_RANK_TOPS,
  HALT_RANK_VIEWS,
  expectedResume,
  filterGroupsByRank,
  groupHalts,
  groupTurnover,
  isHaltOngoing,
  isHiddenByTurnover,
  isLuldCode,
  longHaltRows,
  rankHitOf,
  rankHits,
  rankSidesOf,
  readSavedHaltView,
  type HaltGroup,
  type HaltRankHit,
  type HaltRankSide,
  type HaltRankTop,
  type HaltRankView,
} from '../../utils/usHalts';
import { kstClockText } from '../../utils/marketDate';
import { changeColor, formatSigned, formatUsdShort } from '../../utils/formatters';
import { MIN_TURNOVER_MAX, type UsHaltFetchStatus, type UsHaltRow, type UsHaltsResponse, type UsOngoingHaltRow } from '../../types/usHalts';
import type { LiveRankingResponse } from '../../types/ranking';

/**
 * 실험실 > 거래정지 (v2.55.0) — **미국 정규장에** **지금 멈춰 있는** 미국 종목(오늘 · 며칠째) · 사유 · 정지 시각 · 예상 재개(한국 시간) · 방향(추정) · 오늘 최대 5분 거래대금.
 *
 * - 같은 종목은 한 줄(`utils/usHalts.groupHalts` — 오늘 표 · 「며칠째 정지 중」 칸 각각). 줄 = 가장 최근 정지 — 오늘 표는 그 정지가 안 풀린(`isHaltOngoing`)
 *   종목만 보인다(풀리면 사라지고, 다시 멈추면 나타난다 · v2.56.2). 풀린 정지 기록은 서버에 남지만 이 화면에는 보이지 않는다.
 * - 거래대금 = 그 묶음 정지들 가운데 가장 큰 5분 거래대금(`groupTurnover`) — 표시와 「거래대금 $N 미만 숨기기」(서버 저장 · `isHiddenByTurnover` —
 *   관심 · 보유 · 거래대금 모름은 숨기지 않는다)가 같은 숫자를 쓴다.
 *
 * - 정규장에만 「지금 정지 중」 표(`regularOpen` — 서버가 종목 지도와 같은 `heatmapSession` 으로 판단). 그 밖에는 그 표 · 토스트 · 순위 읽기를 끄고 「정규장에만 보입니다」 한 줄
 *   (「며칠째 정지 중」 칸은 정규장 밖에도 보인다)
 *   (LULD 는 정규장에만 걸리고, 정규장 밖에는 마감 직전에 멈춰 재개가 안 적힌 정지가 「정지 중」 으로 남아 보였다). 받기 · 저장은 그대로.
 * - 보기 드롭다운 「전체 · 상위 · 급상승 · 급하락」(기본 「상위」) + 상위 N(10 · 20 · 50 · 100) — 「전체」 는 지금 멈춘 종목 전부(순위를 부르지 않고 순위 칸 없음).
 *   나머지는 토스 오늘 상승률 · 하락률 순위(`/api/rankings/live`, 실시간 순위 화면과 같은 API · 서버 30초 캐시) 상위 N 안의 종목만 오늘 표에 남긴다
 *   (「상위」 = 두 순위 합집합 · `utils/usHalts.filterGroupsByRank` → 거래대금 숨기기). **관심 · 보유 종목은 순위와 상관없이 늘 보인다.**
 *   「며칠째 정지 중」 칸은 보기와 상관없이 모든 장기 정지(관심 · 보유가 위). 고른 보기 · N 은 이 브라우저에 기억한다(localStorage — 서버 저장 없음).
 * - 모든 칸은 한 줄(1280 · 1440) — 긴 종목명만 말줄임 + 툴팁(티커 · 시장 · 배지 · 순위는 자르지 않는다).
 * - 서버가 1분마다 Nasdaq Trader 거래정지 RSS 를 받아 쌓는다(`server/usHalts/`) — 화면은 서버 값을 30초마다 읽기만 한다.
 * - 예상 재개는 **서버 시각** 기준으로 1초마다 다시 판단한다(`utils/usHalts.expectedResume`).
 * - 원문(ET 날짜 · 시각 · 사유 코드)은 툴팁 · 작은 글자로 함께 보인다(약관 — 피드를 고치거나 왜곡하지 않는다).
 * - 새 정지 토스트는 이 화면을 보고 있을 때만(화면을 떠나면 언마운트) — 처음 열 때 이미 있던 정지는 알리지 않는다.
 * ⚠️ 방향은 토스 1분봉으로 낸 **추정**이다. 매수 · 매도 신호가 아니다.
 */

const REFRESH_MS = 30_000;
/**
 * 표가 놓인 칸의 안쪽 폭(px)이 이보다 좁으면 사유 칸의 원문 코드를 툴팁으로 옮긴다(`CompactReason`).
 * 오른쪽 관심 패널을 편 채로 1440 창 = 1002px(코드 보임) · 1280 창 = 842px(숨김). 패널을 접은 1280 은 1056px 이라 보인다.
 * 창 폭이 아니라 칸 폭으로 잰다 — 패널을 접고 펴도 따라간다.
 */
const COMPACT_REASON_BELOW = 920;
/** 좁은 칸 — 두 표의 사유 칸(`ReasonText`)이 같이 읽는다 */
const CompactReason = createContext(false);
/** 연속 이만큼 실패하면 경고 */
const FAIL_WARN = 3;
/** 새 정지 토스트는 화면을 연 때보다 이만큼 앞선 정지까지만(목록 지연 0.5~2분 + 여유) — 서버를 막 켠 뒤 처음 받은 목록이 「새 정지」 로 몰려 뜨지 않게 */
const TOAST_LOOKBACK_MS = 3 * 60_000;

const etTitle = (date: string, time: string) => `미국 동부 시간(원문) ${date} ${time}`;
/** 판단에는 앞뒤 공백을 뺀 코드를 쓴다(화면 글자는 원문) */
const codeOf = (h: UsHaltRow) => h.rawReasonCode.trim();
const KST_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
const KST_MD_HM = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** 한국 날짜 · 시각 「10-20 22:31」(지난 날 정지 — 날짜가 필요하다). 월 · 일만 고르면 sv-SE 도 「20/10」 로 적어 조각으로 맞춘다 */
const kstMonthDayTime = (ms: number) => {
  const p = Object.fromEntries(KST_MD_HM.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
};

/**
 * 고른 보기 · 상위 N — 이 브라우저에만(localStorage). 읽기 · 쓰기가 막혀도 기본값으로 동작한다.
 * 키를 새로 둔다(v2.57.3) — 옛 키의 「all」 은 합친 상위(지금의 「상위」)라 같은 이름의 새 「전체」 와 섞이지 않게. 새 키가 없으면 옛 키를 옮겨 읽는다(`readSavedHaltView`).
 */
const RANK_VIEW_KEY = 'alphascope.usHaltsView.v2';
const LEGACY_RANK_VIEW_KEY = 'alphascope.usHaltsView';
interface SavedRankView {
  view: HaltRankView;
  top: HaltRankTop;
}

function readRankView(): SavedRankView {
  const read = (key: string): unknown => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      return null;
    }
  };
  return readSavedHaltView(read(RANK_VIEW_KEY), read(LEGACY_RANK_VIEW_KEY));
}

function writeRankView(v: SavedRankView) {
  try {
    localStorage.setItem(RANK_VIEW_KEY, JSON.stringify(v));
  } catch {
    /* 저장이 막힌 브라우저 — 이번 화면에서만 유지 */
  }
}

/** 순위 하나의 받은 상태 — data 가 있으면 error 는 「다시 받기 실패(앞 순위로 거르는 중)」 */
interface RankState {
  data: LiveRankingResponse | null;
  error: string | null;
  /** 모의 데이터 모드 — 다시 받지 않는다 */
  stopped: boolean;
}
const EMPTY_RANK: RankState = { data: null, error: null, stopped: false };

/**
 * 토스 오늘 상승률 또는 하락률 순위 하나 — 켠 동안만(보기가 그 순위를 쓰고 · 정규장일 때), 처음 + 30초마다(숨은 탭에서는 쉼).
 * 실패해도 앞서 받은 순위는 그대로 둔다(error 만 채움). 끄면 비운다(N 만 바꾸면 다시 받지 않는다 — 응답이 100개).
 */
function useLiveRank(kind: HaltRankSide, enabled: boolean): RankState {
  // 받은 때의 켬 상태(for)를 함께 둔다 — 다시 켠 첫 화면에서 앞 순위로 거르지 않게(effect 의 비우기는 그린 뒤에 돈다)
  const [state, setState] = useState<RankState & { for: boolean }>({ ...EMPTY_RANK, for: enabled });
  useEffect(() => {
    setState({ ...EMPTY_RANK, for: enabled });
    if (!enabled) return;
    let alive = true;
    /** 모의 데이터 모드 — 다시 받아도 같으니 멈춘다(화면은 「30초 뒤 다시」 라고 하지 않는다) */
    let stopped = false;
    const load = async () => {
      if (stopped) return;
      try {
        const r = await fetch(`/api/rankings/live?market=us&kind=${kind}`);
        const payload = (await r.json().catch(() => ({}))) as LiveRankingResponse & { error?: string };
        if (!r.ok) throw new Error(payload.error ?? `요청 실패 (${r.status})`);
        // 토스 키가 없는 서버는 순위가 비어 온다 — 「없음」 이 아니라 못 받은 것
        if (payload.mock) {
          stopped = true;
          if (alive) setState({ for: true, data: null, error: '이 서버는 토스 키가 없어(모의 데이터 모드) 순위가 없습니다', stopped: true });
          return;
        }
        if (alive) setState({ for: true, data: payload, error: null, stopped: false });
      } catch (e) {
        if (alive) setState((s) => ({ ...s, error: (e as Error).message }));
      }
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [kind, enabled]);
  return state.for === enabled ? state : EMPTY_RANK;
}

const SIDE_NAME: Record<HaltRankSide, string> = { gainers: '상승률', losers: '하락률' };
const VIEW_RANK_NAME: Record<HaltRankView, string> = { all: '', top: '상승률 · 하락률', gainers: '상승률', losers: '하락률' };

/** 순위 시각(한국 시간) — 토스 기준 시각, 없으면 서버가 받아 온 시각 */
const rankTimeText = (data: LiveRankingResponse | null) => {
  const at = data?.rankedAt ?? data?.fetchedAt;
  const ms = at ? Date.parse(at) : NaN;
  return Number.isFinite(ms) ? kstClockText(ms) : '모름';
};

export default function UsHaltsView({ onSelectSymbol }: { onSelectSymbol: (symbol: string) => void }) {
  const [data, setData] = useState<UsHaltsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 서버 시각 − 이 PC 시각 — 예상 재개를 서버 시각으로 판단한다 */
  const offset = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef<Set<number> | null>(null);
  /** 화면을 처음 받은 서버 시각 */
  const openedAt = useRef<number | null>(null);
  const { watchlist } = useWatchlist();
  /** 숨긴 줄을 이 화면에서만 잠시 다 보임(저장하지 않음) */
  const [showHidden, setShowHidden] = useState(false);
  /** 숨기기 기준 — 저장에 성공한 값(처음은 서버 값). undefined = 아직 모름 */
  const [minTurnover, setMinTurnover] = useState<number | null | undefined>(undefined);
  const savingMin = useRef(false);
  /** 표가 놓인 칸 — 폭을 재서 좁으면 사유 원문 코드를 툴팁으로 */
  const contentRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCompact(e.contentRect.width < COMPACT_REASON_BELOW));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  /** 토스트를 띄울 정지인가 — 표와 같은 거르기(순위 ∪ 관심 · 보유 · 거래대금 숨기기). null = 순위를 아직 모름(알리지 않는다) */
  const toastShows = useRef<((h: UsHaltRow) => boolean) | null>(null);
  /** 보기(전체 · 상위 · 급상승 · 급하락) + 상위 N — 이 브라우저에 기억(localStorage) */
  const [rankView, setRankView] = useState<SavedRankView>(readRankView);
  useEffect(() => writeRankView(rankView), [rankView]);
  // 순위는 정규장일 때만 · 순위로 거르는 보기에서만 읽는다(「전체」 는 부르지 않는다)
  const regularOpen = data?.regularOpen === true;
  const sides = rankSidesOf(rankView.view);
  const ranks: Record<HaltRankSide, RankState> = {
    gainers: useLiveRank('gainers', regularOpen && sides.includes('gainers')),
    losers: useLiveRank('losers', regularOpen && sides.includes('losers')),
  };

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/us-halts');
      const payload = (await r.json().catch(() => ({}))) as UsHaltsResponse & { error?: string };
      if (!r.ok) throw new Error(payload.error ?? `요청 실패 (${r.status})`);
      offset.current = payload.serverNow - Date.now();
      setNow(payload.serverNow);
      setData(payload);
      // 다른 기기에서 바꾼 기준도 따라간다 — 저장 중에는 덮지 않는다
      if (!savingMin.current) setMinTurnover(payload.minTurnoverUsd ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // 처음 + 30초마다 — 숨은 탭에서는 쉬고, 다시 보이면 곧바로 한 번
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // 예상 재개 — 1초마다 서버 시각으로 다시 판단
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + offset.current), 1000);
    return () => clearInterval(timer);
  }, []);

  // 새 정지 토스트 — 처음 받은 목록은 「본 것」 으로만 두고, 그 뒤 새로 생긴 줄 가운데 지금 멈춰 있는 것만 알린다(여러 건이면 한 토스트)
  useEffect(() => {
    if (!data) return;
    // 정규장 밖 — 알리지 않고 「본 것」 에만 넣는다(열릴 때 그동안 쌓인 정지가 몰려 뜨지 않게 — 처음 받은 목록과 같은 규칙)
    if (!data.regularOpen) {
      seen.current ??= new Set();
      for (const h of data.halts) seen.current.add(h.id);
      openedAt.current ??= data.serverNow;
      return;
    }
    if (!seen.current) {
      seen.current = new Set(data.halts.map((h) => h.id));
      openedAt.current = data.serverNow;
      return;
    }
    const added = data.halts.filter((h) => !seen.current!.has(h.id));
    for (const h of added) seen.current.add(h.id);
    // 화면을 연 뒤에 생긴 정지만 — 서버가 막 켜져(또는 실패 뒤) 처음 받은 목록의 오늘 앞선 정지는 알리지 않는다
    // 지금 멈춘 것만(v2.56.3) — 처음 받을 때 이미 풀려 있던 짧은 정지는 표에 없으니 알리지 않는다(「본 것」 에는 위에서 넣어 다시 알리지 않는다).
    // 기준 시각 = 이 응답의 서버 시각(오늘 표의 1초 시계도 같은 서버 시각 기준)
    // 표에 보일 정지만(v2.57.1 — 「상위」 등은 순위로 거르므로, 거르지 않으면 표에 없는 종목이 자주 알려졌다)
    const shows = toastShows.current;
    const fresh = added.filter((h) => h.haltAtMs >= openedAt.current! - TOAST_LOOKBACK_MS && isHaltOngoing(h, data.serverNow) && !!shows?.(h));
    if (!fresh.length) return;
    // 같은 종목이 오늘 앞서 멈춘 적이 있으면 「다시 정지」(풀렸다 다시 멈춘 새 정지 — 표에서는 한 줄로 묶인다)
    const again = (h: UsHaltRow) => data.halts.some((o) => o.id !== h.id && o.rawIssueSymbol.trim() === h.rawIssueSymbol.trim() && o.haltAtMs < h.haltAtMs);
    const line = (h: UsHaltRow) =>
      again(h) ? `${h.rawIssueSymbol} 다시 정지 · ${kstClockText(h.haltAtMs)}` : `${h.rawIssueSymbol} ${haltCodeLabel(codeOf(h)) ?? h.rawReasonCode} · ${kstClockText(h.haltAtMs)}`;
    if (fresh.length === 1) toast.info(line(fresh[0]));
    // 토스트 설명은 한 문단이라 줄바꿈 대신 「 · 」 — 종목 · 정지 시각(한국)만, 5건까지
    else
      toast.info(
        `새 정지 ${fresh.length}건`,
        fresh
          .slice(0, 5)
          .map((h) => `${h.rawIssueSymbol}${again(h) ? ' 다시' : ''} ${kstClockText(h.haltAtMs)}`)
          .join(' · ') + (fresh.length > 5 ? ` 외 ${fresh.length - 5}건` : ''),
      );
  }, [data]);

  return (
    <div className="flex h-full flex-col" data-us-halts>
      <PageHeader title="거래정지" />
      <div ref={contentRef} className={`min-h-0 flex-1 overflow-auto ${PANEL_PAD} pt-0`} data-compact-reason={compact ? '' : undefined}>
        <CompactReason.Provider value={compact}>
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-text-muted">
          {/* 메뉴 이름에 「미국」 이 없어(거래정지) 받기 상태 줄 앞에 대상을 적는다 */}
          {data && <span>미국 종목 · 미국 날짜 {data.day}</span>}
          {data && <StatusLine status={data.status} />}
        </div>
        {/* 보기(급상승 · 급하락) 왼쪽 · 거래대금 숨기기 오른쪽 — 표 바로 위 */}
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <RankFilter value={rankView} onChange={setRankView} rankedAt={sides.map((k) => ranks[k].data?.rankedAt).find(Boolean) ?? null} />
          {minTurnover !== undefined && (
            <MinTurnoverField
              value={minTurnover}
              onSaving={(on) => (savingMin.current = on)}
              onSaved={(v) => {
                setMinTurnover(v);
                setShowHidden(false);
              }}
            />
          )}
        </div>
        {error && <p className="mb-2 rounded-lg bg-danger/10 px-3 py-1.5 text-caption text-danger">{error}</p>}

        {!data && !error && <SkeletonTable rows={5} columns={6} />}
        {data &&
          (() => {
            const mine = (h: UsHaltRow) => watchlist.includes(h.rawIssueSymbol.trim()) || h.held;
            // 두 칸 모두 안 풀린 정지만 — 1초 시계로 다시 걸러 공지 재개 시각이 지나면 다음 갱신을 기다리지 않고 사라진다
            const split = <T extends UsHaltRow>(groups: HaltGroup<T>[]) => {
              const hidden = groups.filter((g) => isHiddenByTurnover(groupTurnover([g.latest, ...g.earlier]), minTurnover ?? null, mine(g.latest)));
              return { groups, shown: showHidden ? groups : groups.filter((g) => !hidden.includes(g)), hiddenCount: hidden.length };
            };
            const notice = (n: number) =>
              n > 0 && <HiddenNotice count={n} showing={showHidden} onToggle={() => setShowHidden((v) => !v)} />;
            // 며칠째 칸: 보기와 상관없이 모든 장기 정지 · 정규장 밖에도(오늘 거래가 없어 순위와 상관없다 · 관심 · 보유가 위 — `OngoingTable`)
            const ongoing = split(groupHalts(longHaltRows(data.ongoing, data.halts, data.regularOpen, now)));
            // 정규장 밖에도 보인다(SEC 정지처럼 며칠 이어지는 정지는 정규장과 상관없다). 줄이 없으면 그리지 않는다
            const ongoingSection = ongoing.groups.length > 0 && (
              <div className="mt-4 mb-6 space-y-2" data-ongoing-section>
                <SectionTitle>며칠째 정지 중 ({ongoing.groups.length})</SectionTitle>
                {notice(ongoing.hiddenCount)}
                {ongoing.shown.length > 0 && <OngoingTable groups={ongoing.shown} watchlist={watchlist} onSelectSymbol={onSelectSymbol} />}
                <p className="text-caption text-text-muted">최근 30일 안에 시작된 정지만 보입니다(그보다 오래된 정지는 저장하지 않습니다).</p>
              </div>
            );
            // 정규장 밖 — 「지금 정지 중」 자리에 안내 한 줄, 그 아래 며칠째 칸(토스트는 위 effect 가 끈다)
            if (!data.regularOpen) {
              toastShows.current = null;
              return (
                <>
                  <RegularClosed open={data.nextRegularOpen} close={data.nextRegularClose} />
                  {ongoingSection}
                </>
              );
            }
            // 순위 — 받는 중(데이터도 실패도 없음)인 것이 하나라도 있으면 표도 「없음」 도 그리지 않는다. 실패한 순위는 빈 순위로(받은 쪽으로 거른다)
            // 「전체」 는 순위가 없다(sides 빈 배열) — hits = null(거르지 않음)
            const byRank = sides.length > 0;
            const loading = sides.some((k) => !ranks[k].data && !ranks[k].error);
            const failed = sides.filter((k) => ranks[k].error);
            /** 실제로 거른 순위(받았거나 앞서 받은 것) — 하나도 없으면 「없음」 · 개수를 말할 수 없다(관심 · 보유만 보인다) */
            const received = sides.filter((k) => ranks[k].data);
            const hits = loading ? undefined : byRank ? rankHits(received.map((k) => ({ side: k, rows: ranks[k].data!.rows })), rankView.top) : null;
            const unknown = byRank && hits !== undefined && !received.length;
            // 오늘 표: 묶은 뒤 가장 최근 정지로 거른다(풀린 정지는 최대 거래대금 계산에만 쓴다) → 순위 거르기(관심 · 보유는 늘 남김 · 「전체」 는 거르지 않음) → 거래대금 숨기기
            const ongoingToday = () => groupHalts(data.halts).filter((g) => isHaltOngoing(g.latest, now));
            const today = split(hits === undefined ? [] : hits === null ? ongoingToday() : filterGroupsByRank(ongoingToday(), hits, mine));
            const rankName = `${VIEW_RANK_NAME[rankView.view]} 상위 ${rankView.top}`;
            // 빈 상태 문구는 실제로 거른 순위 이름으로(한쪽만 받았으면 그쪽만)
            const receivedName = `${received.map((k) => SIDE_NAME[k]).join(' · ')} 상위 ${rankView.top}`;
            // 토스트도 표와 같은 거르기 — 표에 없는 종목을 알리지 않는다(순위를 아직 모르면 알리지 않는다)
            toastShows.current =
              hits === undefined
                ? null
                : (h) => (hits === null || rankHitOf(hits, h.rawIssueSymbol) != null || mine(h)) && !isHiddenByTurnover(groupTurnover([h]), minTurnover ?? null, mine(h));
            return (
              <>
                {/* 며칠째 정지 중 — 오늘 표 위 */}
                {ongoingSection}
                <div className="mb-2">
                  {/* 받기 실패 중 · 순위를 아직 모르면 개수를 적지 않는다 — 「(0)」 과 「알 수 없습니다」 가 엇갈리지 않게 */}
                  <SectionTitle>{fetchBad(data.status) || hits === undefined || unknown ? '지금 정지 중' : `지금 정지 중 (${today.groups.length})`}</SectionTitle>
                </div>
                {!loading && failed.length > 0 && (
                  <p className="mb-2 rounded-lg bg-danger/10 px-3 py-1.5 text-caption text-danger" data-rank-error title={failed.map((k) => ranks[k].error).join(' · ')}>
                    {failed.map((k) => SIDE_NAME[k]).join(' · ')} 순위를 받지 못했습니다
                    {failed.some((k) => ranks[k].stopped)
                      ? ` — ${ranks[failed[0]].error}`
                      : failed.every((k) => ranks[k].data)
                        ? ` — 앞서 받은 순위로 거르는 중입니다(순위 시각 ${rankTimeText(ranks[failed[0]].data)})`
                        : ' — 30초 뒤 다시 받습니다'}
                    {' · 관심 · 보유 종목은 그대로 보입니다'}
                  </p>
                )}
                {loading && (
                  <p className="flex items-center justify-center gap-2 rounded-lg bg-bg-tertiary/40 px-3 py-6 text-caption text-text-muted" data-rank-loading>
                    <InlineSpinner /> 토스 {rankName} 순위를 받는 중…
                  </p>
                )}
                {hits !== undefined && !unknown && !today.groups.length && (
                  <p className="rounded-lg bg-bg-tertiary/40 px-3 py-6 text-center text-caption text-text-muted" data-halts-empty>
                    {fetchBad(data.status)
                      ? `아직 Nasdaq 목록을 받지 못해 오늘(미국 날짜 ${data.day}) 정지를 알 수 없습니다.`
                      : byRank
                        ? `${receivedName} 안에 지금 멈춘 종목이 없습니다`
                        : '지금 멈춰 있는 종목이 없습니다'}
                  </p>
                )}
                {hits !== undefined && today.hiddenCount > 0 && <div className="mb-2">{notice(today.hiddenCount)}</div>}
                {hits !== undefined && today.shown.length > 0 && (
                  <HaltTable groups={today.shown} now={now} watchlist={watchlist} hits={hits} rankView={rankView.view} onSelectSymbol={onSelectSymbol} />
                )}
              </>
            );
          })()}

        </CompactReason.Provider>
        {/* 출처 · 지연 · 추정 — 표 아래 고정 문구 */}
        <p className="mt-3 text-caption text-text-muted">
          자료: Nasdaq Trader 거래정지 목록 · 정지 뒤 약 0.5~2분 늦게 보입니다 · 방향은 토스 1분봉으로 낸 추정입니다(매수 · 매도 신호가 아닙니다)
        </p>
      </div>
    </div>
  );
}

/** 받은 적이 없거나 받기가 실패 중 — 지금 멈춘 종목이 있는지 모른다 */
const fetchBad = (status: UsHaltFetchStatus) => status.enabled && (!status.lastSuccessAt || status.consecutiveFailures >= FAIL_WARN);

/** 받기 상태 한 줄 — 시각은 한국 시간. 받는 시간대 밖이면 날짜도(전날 값을 오늘로 읽지 않게) */
function StatusLine({ status }: { status: UsHaltFetchStatus }) {
  const lastMs = status.lastSuccessAt ? Date.parse(status.lastSuccessAt) : null;
  const last = lastMs != null ? kstClockText(lastMs) : null;
  if (!status.enabled) return <span>이 서버는 Nasdaq 목록을 받지 않습니다(받기 꺼짐)</span>;
  if (status.consecutiveFailures >= FAIL_WARN)
    return (
      <span className="text-warning" title={status.lastError ?? undefined}>
        Nasdaq 목록을 받지 못하고 있습니다(마지막 성공 {last ?? '없음'})
      </span>
    );
  if (!status.inWindow)
    return <span>미국 시간 평일 04:00~20:00 ET 에 받습니다(20:00 뒤에는 안 풀린 오늘 정지가 있을 때만 자정까지){lastMs != null ? ` · 마지막 확인 ${KST_DAY.format(new Date(lastMs))} ${last}` : ''}</span>;
  if (!last) return <span>{status.consecutiveFailures ? `아직 받지 못했습니다(실패 ${status.consecutiveFailures}번 · 1분마다 다시)` : '처음 받는 중…'}</span>;
  if (status.window === 'extended')
    return <span>20:00 ET 뒤 — 아직 안 풀린 정지 {status.openToday}건 때문에 이어 받는 중(미국 자정까지) · 마지막 확인 {last}</span>;
  return <span>마지막 확인 {last} · 1분마다</span>;
}

/**
 * 「거래대금 [$ ____] 미만 숨기기」 — 서버 저장(맥 · 윈도우 같게). 칸을 떠나거나 Enter 로 저장, 비우면 숨기지 않음.
 * 저장 중 표시 · 실패하면 앞 값으로 되돌리고 오류 토스트.
 */
function MinTurnoverField({ value, onSaving, onSaved }: { value: number | null; onSaving: (on: boolean) => void; onSaved: (v: number | null) => void }) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const [saving, setSaving] = useState(false);
  const focused = useRef(false);
  // 서버 값이 바뀌면(다른 기기 · 저장 성공) 고치는 중이 아닐 때만 따라간다
  useEffect(() => {
    if (!focused.current) setDraft(value == null ? '' : String(value));
  }, [value]);

  const commit = async () => {
    const next = draft === '' ? null : Number(draft);
    if (next === value || saving) return;
    if (next != null && !(next > 0)) {
      toast.error('숨기기 기준은 0 보다 큰 금액입니다', '비우면 숨기지 않습니다.');
      setDraft(value == null ? '' : String(value));
      return;
    }
    setSaving(true);
    onSaving(true);
    try {
      const r = await fetch('/api/settings/us-halts-min-turnover', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ minTurnoverUsd: next }),
      });
      const payload = (await r.json().catch(() => ({}))) as { minTurnoverUsd?: number | null; error?: string };
      if (!r.ok) throw new Error(payload.error ?? `요청 실패 (${r.status})`);
      onSaved(payload.minTurnoverUsd ?? null);
    } catch (e) {
      setDraft(value == null ? '' : String(value));
      toast.error('숨기기 기준을 저장하지 못했습니다', (e as Error).message);
    } finally {
      setSaving(false);
      onSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5 text-caption text-text-secondary" data-min-turnover>
      <span className="whitespace-nowrap">거래대금 $</span>
      <NumberField
        size="sm"
        kind="long"
        thousands
        max={MIN_TURNOVER_MAX}
        maxText={`최대 $${MIN_TURNOVER_MAX.toLocaleString('en-US')}`}
        value={draft}
        onValue={setDraft}
        disabled={saving}
        placeholder="없음"
        aria-label="숨기기 기준 거래대금(달러)"
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          void commit();
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <span className="whitespace-nowrap">미만 숨기기</span>
      <InfoTip label="숨기기 설명">
        가장 최근 정지 전 5분 거래대금이 이 금액보다 적은 종목을 숨깁니다. 관심 · 보유 종목과 거래량을 모르는 종목은 숨기지 않습니다. 비우면 숨기지 않습니다(이 기기와 다른 기기 모두).
      </InfoTip>
      {saving && (
        <span className="flex items-center gap-1 text-text-muted">
          <InlineSpinner /> 저장 중…
        </span>
      )}
    </div>
  );
}

/** 숨긴 줄 안내 — 「보기」 는 이 화면에서만 잠시(저장하지 않음) */
function HiddenNotice({ count, showing, onToggle }: { count: number; showing: boolean; onToggle: () => void }) {
  return (
    <p className="text-caption text-text-muted" data-hidden-notice>
      {showing ? `거래대금이 적은 ${count}종목도 보이는 중입니다` : `거래대금이 적은 ${count}종목을 숨겼습니다`}
      {' · '}
      <button type="button" onClick={onToggle} className="rounded text-accent hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent">
        {showing ? '다시 숨기기' : '보기'}
      </button>
    </p>
  );
}

/**
 * 보기 드롭다운 「전체 · 상위 · 급상승 · 급하락」 + 상위 N(「전체」 에서는 쓰지 않아 흐리게). 순위 기준 안내는 정보 아이콘.
 */
function RankFilter({ value, onChange, rankedAt }: { value: SavedRankView; onChange: (v: SavedRankView) => void; rankedAt: string | null }) {
  const rankedMs = rankedAt ? Date.parse(rankedAt) : NaN;
  return (
    <div className="flex items-center gap-2" data-rank-filter>
      <Select
        size="sm"
        className="w-28"
        aria-label="보기"
        value={value.view}
        onChange={(e) => onChange({ ...value, view: HALT_RANK_VIEWS.find((v) => v === e.target.value) ?? DEFAULT_HALT_RANK_VIEW })}
      >
        <option value="all">전체</option>
        <option value="top">상위</option>
        <option value="gainers">급상승</option>
        <option value="losers">급하락</option>
      </Select>
      <Select
        size="sm"
        className="w-28"
        aria-label="순위 상위 몇 종목까지"
        disabled={value.view === 'all'}
        value={value.top}
        onChange={(e) => onChange({ ...value, top: (HALT_RANK_TOPS.find((n) => n === Number(e.target.value)) ?? DEFAULT_HALT_RANK_TOP) as HaltRankTop })}
      >
        {HALT_RANK_TOPS.map((n) => (
          <option key={n} value={n}>
            상위 {n}
          </option>
        ))}
      </Select>
      <InfoTip label="보기 설명">
        「전체」 는 지금 멈춘 종목을 순위와 상관없이 모두 보입니다. 「상위」 · 「급상승」 · 「급하락」 은 토스 오늘 상승률 · 하락률 순위 상위 N 안에 든 종목 가운데 지금 멈춘 것만 — 「상위」 는 두 순위를 합친 것, 「급상승」 은 상승률, 「급하락」 은 하락률만. 관심 · 보유 종목은 순위와 상관없이 멈추면 보입니다. 「며칠째 정지 중」 칸은 보기와 상관없이 며칠째 멈춘 종목을 모두 보입니다. 순위는 30초마다 다시 읽고, 순위 시각은 토스 기준입니다.
        {Number.isFinite(rankedMs) ? ` 지금 순위 시각 ${kstClockText(rankedMs)}(한국 시간).` : ''}
      </InfoTip>
    </div>
  );
}

/**
 * 정규장 밖 — 표 · 토스트 대신 한 줄. 한국 시각은 서버가 준 다음 정규장 시각으로(서머타임 · 조기 마감 · 휴장이 저절로 맞는다).
 */
function RegularClosed({ open, close }: { open: number | null; close: number | null }) {
  return (
    <p className="mt-4 flex items-center justify-center gap-1 rounded-lg bg-bg-tertiary/40 px-3 py-6 text-center text-caption text-text-muted" data-regular-closed>
      {open != null && close != null
        ? `「지금 정지 중」 은 미국 정규장에만 보입니다 — 다음 정규장 한국 ${kstMonthDayTime(open)}~${kstClockText(close).slice(0, 5)}`
        : '「지금 정지 중」 은 미국 정규장(09:30~16:00 ET)에만 보입니다'}
      <InfoTip label="정규장에만 보이는 이유">
        가격 제한 정지(LULD)는 정규장에만 걸립니다. 정규장 밖에는 장 마감 직전에 멈춰 재개 시각이 적히지 않은 정지가 「정지 중」 으로 남아 보여 목록을 숨깁니다. 기록은 서버가 계속 쌓습니다.
      </InfoTip>
    </p>
  );
}

/**
 * 순위 칸 「상승 3위 · +45.2%」 · 「하락 2위 · −38.1%」(「상위」) · 「3위 · +45.2%」(급상승 · 급하락 — 칸 머리가 방향을 말한다 · 1280 이름 폭) —
 * 종목 칸 바로 옆 따로 칸(왼쪽 끝 맞춤 — 오른쪽 끝이면 왼쪽 끝 맞춤인 사유 칸과 붙어 한 말로 읽혔다). 순위 밖(관심 · 보유라 보이는 줄)은 「—」.
 * 색은 등락 부호(상승 초록 · 하락 빨강)
 */
function RankCell({ hit, showSide }: { hit: HaltRankHit | null; showSide: boolean }) {
  if (!hit) return <span className="text-text-muted">—</span>;
  const color = hit.changeRate != null ? changeColor(hit.changeRate) : hit.side === 'losers' ? 'text-bearish' : 'text-bullish';
  // 작은 글자 — 「상위」 는 「하락 10위 · −45.6%」 처럼 길어 1280 에서 이름 칸이 34px 까지 줄었다
  return (
    <span className={`text-caption tabular-nums ${color}`} data-rank-tag>
      {showSide ? `${hit.side === 'losers' ? '하락' : '상승'} ` : ''}
      {hit.rank}위{hit.changeRate != null ? ` · ${formatSigned(hit.changeRate, 1, '%')}` : ''}
    </span>
  );
}

/**
 * 묶음 거래대금(`groupTurnover` — 정지들 가운데 가장 큰 5분 거래대금) — 0 = 거래 없음 · null = 모름(아직이면 확인 중).
 * 일부 정지만 모르면 아는 값 가운데 최대 + 정보 아이콘. 「오늘 최대 · 최대」 는 칸 머리 설명에 둔다(칸을 한 줄로).
 */
function TurnoverText({ halts }: { halts: UsHaltRow[] }) {
  const t = groupTurnover(halts);
  if (t.usd == null) return <span className="whitespace-nowrap text-text-muted">{t.checking ? '확인 중…' : '거래량 모름'}</span>;
  // 일부만 모름 — 아직 내지 않은 정지가 있으면 「확인 중」(숨기지도 않는다), 아니면 「모릅니다」
  const tip = t.partial && (
    <InfoTip label="거래대금 일부 설명">{t.checking ? '일부 정지는 거래대금을 아직 확인 중입니다.' : '일부 정지는 거래량을 모릅니다.'}</InfoTip>
  );
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap ${t.usd === 0 ? 'text-text-muted' : 'text-text-secondary'}`}>
      {tip}
      <span className="tabular-nums">{t.usd === 0 ? '거래 없음' : formatUsdShort(t.usd)}</span>
    </span>
  );
}

const TURNOVER_TIP = '오늘 최대 5분 거래대금 — 이 종목이 오늘 멈췄던 정지들 가운데, 정지 전 5분 거래대금이 가장 컸던 값(종가 × 거래량, 토스 1분봉)';
const ONGOING_TURNOVER_TIP = '최대 5분 거래대금 — 이 칸에 묶인 정지들 가운데, 정지 전 5분 거래대금이 가장 컸던 값(종가 × 거래량, 토스 1분봉)';

/** 거래대금 칸 머리 — 숫자 칸이라 오른쪽 끝 맞춤 */
function TurnoverHead({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <InfoTip label="거래대금 설명">{tip}</InfoTip>
    </span>
  );
}

function HaltTable({
  groups,
  now,
  watchlist,
  hits,
  rankView,
  onSelectSymbol,
}: {
  groups: HaltGroup<UsHaltRow>[];
  now: number;
  watchlist: string[];
  /** 보기의 순위(「상위」 = 두 순위 합집합) — 종목 칸 옆 순위 칸 「상승 3위 · +45.2%」. null = 「전체」(순위 칸을 그리지 않는다 — 넓어진 폭은 이름 칸에) */
  hits: Map<string, HaltRankHit> | null;
  rankView: HaltRankView;
  onSelectSymbol: (symbol: string) => void;
}) {
  const NUM = `${TABLE_NUM_COL} ${TABLE_NUM_GAP_TIGHT}`;
  return (
    <div className="rounded-lg bg-bg-tertiary/40">
      <table className="w-full text-left text-xs">
        <thead className="text-caption text-text-muted">
          <tr className="border-b border-border/50">
            <th className={`${TABLE_NAME_COL} py-2 pl-3 font-normal`}>종목</th>
            {hits && <th className={`${NUM} py-2 font-normal`}>{rankView === 'gainers' || rankView === 'losers' ? `${SIDE_NAME[rankView]} 순위` : '순위'}</th>}
            <th className={`${NUM} py-2 font-normal`}>사유</th>
            <th className={`${NUM} py-2 font-normal`}>정지 시각</th>
            <th className={`${NUM} py-2 font-normal`}>
              <span className="inline-flex items-center gap-1">
                예상 재개
                <InfoTip label="예상 재개 설명">
                  LULD 정지는 보통 5분, 못 열리면 5분 더(10분). 10분 뒤에는 조건이 맞을 때 풀려 시각이 정해지지 않습니다. 이 목록은 정지 뒤 약 0.5~2분 늦게 보입니다.
                </InfoTip>
              </span>
            </th>
            <th className={`${NUM} py-2 font-normal`}>
              <span className="inline-flex items-center gap-1">
                방향(추정)
                <InfoTip label="방향 추정 설명">
                  정지 직전 1분봉 종가를 그 5분 전 종가와 비교해 짐작한 것입니다(토스 1분봉). Nasdaq 목록에는 위로 멈췄는지 아래로 멈췄는지 칸이 없어 맞았는지 확인할 수 없습니다. 매수 · 매도 신호가 아닙니다 — 상승 중 정지는 급하게 오르다 멈춘 것이라 재개 직후 크게 흔들릴 수 있습니다. 판정하지 못하면 이유를 함께 적습니다(거래 적음 · 변화 없음 · 토스에 없음 · 받기 실패).
                </InfoTip>
              </span>
            </th>
            <th className={`${NUM} py-2 pr-3 text-right font-normal`}>
              <TurnoverHead label="거래대금" tip={TURNOVER_TIP} />
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map(({ latest: h, earlier }) => {
            const symbol = h.rawIssueSymbol.trim();
            const resume = expectedResume({ ...h, rawReasonCode: codeOf(h) }, now);
            const watched = watchlist.includes(symbol);
            return (
              <tr key={h.id} className={`border-b border-border/30 last:border-0 ${LIST_TABLE_ROW}`} data-halt-row={symbol}>
                {/* 한 줄 — 이름 칸이 남는 폭을 가져가고(max-w-0), 시장 → 긴 이름 순서로 말줄임 + 툴팁. 티커 · 배지는 자르지 않는다 */}
                <td className="max-w-0 py-1.5 pl-3">
                  <HaltName h={h} watched={watched} market={h.rawMarket} onSelectSymbol={onSelectSymbol} />
                </td>
                {hits && (
                  <td className={`${NUM} py-1.5`}>
                    <RankCell hit={rankHitOf(hits, symbol)} showSide={rankView === 'top'} />
                  </td>
                )}
                <td className={`${NUM} py-1.5`}>
                  <ReasonText h={h} />
                </td>
                {/* 지금 멈춘 정지의 시각만(이전 정지 시각은 보이지 않는다 — v2.56.2) */}
                <td className={`${NUM} py-1.5 tabular-nums`}>
                  <span title={etTitle(h.rawHaltDate, h.rawHaltTime)}>{kstClockText(h.haltAtMs)}</span>
                </td>
                {/* 최소 폭 — 「22:46:03 예상」 → 「조건이 맞으면 재개」 로 바뀔 때 칸 폭이 흔들려 표 전체가 움직이지 않게 */}
                <td className={`${NUM} min-w-32 py-1.5`}>
                  <ResumeCell resume={resume} />
                </td>
                <td className={`${NUM} py-1.5`}>
                  <DirectionText h={h} />
                </td>
                <td className={`${NUM} py-1.5 pr-3 text-right`}>
                  <TurnoverText halts={[h, ...earlier]} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 예상 재개(한 줄) — 오늘 표는 안 풀린 정지만 보여 resumed 는 오지 않는다(오면 비운다) */
function ResumeCell({ resume }: { resume: ReturnType<typeof expectedResume> }) {
  switch (resume.kind) {
    case 'resumed':
      return null;
    case 'first':
      return (
        <span>
          <span className="tabular-nums">{kstClockText(resume.at)}</span> <span className="text-caption text-text-muted">예상</span>
        </span>
      );
    case 'extended':
      return (
        <span>
          연장 · <span className="tabular-nums">{kstClockText(resume.at)}</span> <span className="text-caption text-text-muted">예상</span>
        </span>
      );
    case 'announced':
      return (
        <span>
          <span className="tabular-nums">{kstClockText(resume.at)}</span> <span className="text-caption text-text-muted">재개(공지)</span>
        </span>
      );
    case 'open':
      return (
        <span className="text-text-secondary" title="시각 정해지지 않음">
          조건이 맞으면 재개
        </span>
      );
    case 'none':
      return <span className="text-text-muted">정해진 시각 없음</span>;
  }
}

/** 방향(추정) — 색만으로 뜻을 전하지 않는다(글자 · ▲▼). LULD 가 아니면 「—」 · 판정 못 하면 이유(`directionUnknownText`) */
function DirectionText({ h }: { h: UsHaltRow }) {
  const est = h.directionEst;
  if (est === 'none' || !isLuldCode(codeOf(h))) return <span className="text-text-muted">—</span>;
  if (est === 'up') return <span className="text-bullish">▲ 상승 중(추정)</span>;
  if (est === 'down') return <span className="text-bearish">▼ 하락 중(추정)</span>;
  if (est === 'pending') return <span className="text-text-muted">추정 중…</span>;
  // 「판정 못 함」 뒤 이유는 작은 글자 — 이 칸이 1280 에서 표 폭을 정하는 가장 긴 글자다
  const [head, ...why] = directionUnknownText(h.directionReason).split(' · ');
  return (
    <span className="text-text-muted">
      {head}
      {why.length > 0 && <span className="text-caption"> · {why.join(' · ')}</span>}
    </span>
  );
}

/**
 * 종목 칸(한 줄) — 이름 · 티커(누르면 차트, 토스에 없으면 못 누름) + 시장(오늘 표만) + 관심 · 보유 배지. 오늘 표 · 며칠째 표가 같이 쓴다.
 * 좁으면 시장 → 이름 순서로 말줄임 + 툴팁(`StockName` `keepTicker`) · 티커 · 배지는 자르지 않는다. 좁은 칸(`CompactReason`)에서는 시장을 줄 툴팁으로.
 */
function HaltName({
  h,
  watched,
  market,
  onSelectSymbol,
}: {
  h: UsHaltRow;
  watched: boolean;
  market?: string;
  onSelectSymbol: (symbol: string) => void;
}) {
  const symbol = h.rawIssueSymbol.trim();
  const compact = useContext(CompactReason);
  return (
    <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap" title={market && compact ? `시장 ${market}` : undefined}>
      {h.inToss ? (
        <button type="button" onClick={() => onSelectSymbol(symbol)} className="flex rounded text-left hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent">
          <StockName symbol={symbol} name={h.catalogName ?? (h.rawIssueName.trim() || null)} keepTicker />
        </button>
      ) : (
        <span title="토스에 없는 종목" aria-disabled="true" className="flex cursor-not-allowed text-text-secondary">
          <StockName symbol={symbol} name={h.rawIssueName.trim() || null} keepTicker />
        </span>
      )}
      {/* 좁으면 시장이 먼저 줄어들고(shrink 10000 : 1 — 말줄임 + 툴팁) 그다음 이름. 100 : 1 이면 짧은 이름(테슬라)이 1px 줄어 「테…」 가 됐다. 티커는 `keepTicker` 로 줄지 않는다.
          좁은 칸(사유 코드를 툴팁으로 옮기는 폭 — `CompactReason`)에서는 시장을 그리지 않고 줄 툴팁으로 — 1~6px 까지 눌려 말줄임표도 없이 글자 조각만 남았다(「전체」 1280).
          최소 폭을 주면 그만큼 이름이 「보유…」 처럼 잘렸다 */}
      {market && !compact && (
        <span className="min-w-0 shrink-[10000] truncate text-caption text-text-muted" title={market}>
          {market}
        </span>
      )}
      {watched && <Badge>관심</Badge>}
      {h.held && <Badge>보유</Badge>}
    </div>
  );
}

/** 사유 칸(한 줄) — 「뉴스 대기 · T1」: 쉬운 말 + 원문 코드(작은 글자 · 흐린 색). 모르는 코드는 원문만 */
function ReasonText({ h }: { h: UsHaltRow }) {
  const label = haltCodeLabel(codeOf(h));
  const compact = useContext(CompactReason);
  // 모르는 코드는 좁아도 원문 그대로(숨기면 아무 글자도 없다)
  if (!label) return <>{h.rawReasonCode}</>;
  // 좁은 칸 — 원문 코드를 툴팁으로(쉬운 말이 단추 · 마우스 · 키보드 초점으로 열린다)
  if (compact)
    return (
      <span className="whitespace-nowrap">
        <InfoTip label={`${label} — 원문 코드 보기`} trigger={label}>
          원문 코드: {h.rawReasonCode} — {HALT_CODES[codeOf(h)]?.en}
          {HALT_CODES[codeOf(h)]?.note ? ` (${HALT_CODES[codeOf(h)]!.note})` : ''}
        </InfoTip>
      </span>
    );
  return (
    <span className="whitespace-nowrap" title={haltCodeTitle(codeOf(h)) ?? undefined}>
      {label}
      <span className="text-caption text-text-muted"> · {h.rawReasonCode}</span>
    </span>
  );
}

/**
 * 며칠째 정지 중 — 지난 날 정지 가운데 안 풀린 것(서버가 고름 · 「안 풀림」 = `isHaltOngoing`). 오늘 표와 같은 칸 모양(모든 칸 한 줄).
 * 관심 · 보유 종목이 맨 위, 그다음 오래된 정지부터. 방향(추정)은 두지 않는다(오늘 정지만 추정).
 * 「목록에서 사라짐」 은 정지 중으로 단정하지 않는다(풀렸는지 모른다 — 옅은 색 + 설명).
 */
function OngoingTable({
  groups,
  watchlist,
  onSelectSymbol,
}: {
  groups: HaltGroup<UsOngoingHaltRow>[];
  watchlist: string[];
  onSelectSymbol: (symbol: string) => void;
}) {
  const NUM = `${TABLE_NUM_COL} ${TABLE_NUM_GAP_TIGHT}`;
  const mine = (h: UsHaltRow) => watchlist.includes(h.rawIssueSymbol.trim()) || h.held;
  // 묶인 줄은 그 종목의 가장 최근 정지로 — 관심 · 보유가 위, 그다음 오래된 것부터
  const sorted = [...groups].sort((a, b) => Number(mine(b.latest)) - Number(mine(a.latest)) || a.latest.haltAtMs - b.latest.haltAtMs);
  return (
    <div className="rounded-lg bg-bg-tertiary/40" data-ongoing-halts>
      <table className="w-full text-left text-xs">
        <thead className="text-caption text-text-muted">
          <tr className="border-b border-border/50">
            <th className={`${TABLE_NAME_COL} py-2 pl-3 font-normal`}>종목</th>
            <th className={`${NUM} py-2 font-normal`}>사유</th>
            <th className={`${NUM} py-2 font-normal`}>정지 시작</th>
            <th className={`${NUM} py-2 text-right font-normal`}>며칠째</th>
            {/* 앞 칸(며칠째)이 오른쪽 끝 맞춤이라 넓은 여백 — 좁으면 「며칠째 재개」 가 한 말로 읽혔다 */}
            <th className={`${TABLE_NUM_COL} ${TABLE_NUM_GAP} py-2 font-normal`}>재개</th>
            <th className={`${NUM} py-2 font-normal`}>상태</th>
            <th className={`${NUM} py-2 pr-3 text-right font-normal`}>
              <TurnoverHead label="거래대금" tip={ONGOING_TURNOVER_TIP} />
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ latest: h, earlier }) => (
            <tr key={h.id} className={`border-b border-border/30 last:border-0 ${LIST_TABLE_ROW}`} data-ongoing-row={h.rawIssueSymbol.trim()}>
              <td className="max-w-0 py-1.5 pl-3">
                <HaltName h={h} watched={watchlist.includes(h.rawIssueSymbol.trim())} onSelectSymbol={onSelectSymbol} />
              </td>
              <td className={`${NUM} py-1.5`}>
                <ReasonText h={h} />
              </td>
              <td className={`${NUM} py-1.5 tabular-nums`}>
                <span title={etTitle(h.rawHaltDate, h.rawHaltTime)}>{kstMonthDayTime(h.haltAtMs)}</span>
              </td>
              <td className={`${NUM} py-1.5 text-right tabular-nums`}>{h.daysHalted}일째</td>
              <td className={`${TABLE_NUM_COL} ${TABLE_NUM_GAP} py-1.5`}>
                {/* 공지 시각이 지나면 줄째 사라진다(위 1초 거르기) — 남는 것은 「상태 모름」 줄뿐이라 그 시각을 그대로 둔다 */}
                {h.resumeAtMs != null ? (
                  <span title={etTitle(h.rawResumptionDate || h.rawHaltDate, h.rawResumptionTradeTime)}>
                    <span className="tabular-nums">{kstMonthDayTime(h.resumeAtMs)}</span> <span className="text-caption text-text-muted">재개(공지)</span>
                  </span>
                ) : (
                  <span className="text-text-muted">정해진 시각 없음</span>
                )}
              </td>
              <td className={`${NUM} py-1.5`}>
                {h.unlisted ? (
                  <span className="inline-flex items-center gap-1 text-text-muted">
                    상태 모름
                    <InfoTip label="상태 모름 설명">Nasdaq 목록에서 사라져 풀렸는지 알 수 없습니다.</InfoTip>
                  </span>
                ) : (
                  <span className="font-medium text-warning">정지 중</span>
                )}
              </td>
              <td className={`${NUM} py-1.5 pr-3 text-right`}>
                <TurnoverText halts={[h, ...earlier]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
