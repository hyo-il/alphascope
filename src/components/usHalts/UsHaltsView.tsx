import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, InfoTip, NumberField, PageHeader, SectionTitle } from '../ui';
import { LIST_TABLE_ROW, PANEL_PAD, TABLE_NAME_COL, TABLE_NUM_COL, TABLE_NUM_GAP_TIGHT } from '../ui/tokens';
import StockName from '../common/StockName';
import { SkeletonTable } from '../common/SkeletonLoader';
import { InlineSpinner } from '../common/LoadingOverlay';
import { useWatchlist } from '../../hooks/useWatchlist';
import { toast } from '../../store/uiStore';
import { directionUnknownText, haltCodeLabel } from '../../data/haltCodes';
import { expectedResume, groupHalts, groupTurnover, isHaltOngoing, isHiddenByTurnover, isLuldCode, type HaltGroup } from '../../utils/usHalts';
import { kstClockText } from '../../utils/marketDate';
import { formatUsdShort } from '../../utils/formatters';
import { MIN_TURNOVER_MAX, type UsHaltFetchStatus, type UsHaltRow, type UsHaltsResponse, type UsOngoingHaltRow } from '../../types/usHalts';

/**
 * 실험실 > 미국 거래정지 (v2.55.0) — **지금 멈춰 있는** 미국 종목(오늘 · 며칠째) · 사유 · 정지 시각 · 예상 재개(한국 시간) · 방향(추정) · 오늘 최대 5분 거래대금.
 *
 * - 같은 종목은 한 줄(`utils/usHalts.groupHalts` — 오늘 표 · 「며칠째 정지 중」 칸 각각). 줄 = 가장 최근 정지 — 오늘 표는 그 정지가 안 풀린(`isHaltOngoing`)
 *   종목만 보인다(풀리면 사라지고, 다시 멈추면 나타난다 · v2.56.2). 풀린 정지 기록은 서버에 남지만 이 화면에는 보이지 않는다.
 * - 거래대금 = 그 묶음 정지들 가운데 가장 큰 5분 거래대금(`groupTurnover`) — 표시와 「거래대금 $N 미만 숨기기」(서버 저장 · `isHiddenByTurnover` —
 *   관심 · 보유 · 거래대금 모름은 숨기지 않는다)가 같은 숫자를 쓴다.
 *
 * - 서버가 1분마다 Nasdaq Trader 거래정지 RSS 를 받아 쌓는다(`server/usHalts/`) — 화면은 서버 값을 30초마다 읽기만 한다.
 * - 예상 재개는 **서버 시각** 기준으로 1초마다 다시 판단한다(`utils/usHalts.expectedResume`).
 * - 원문(ET 날짜 · 시각 · 사유 코드)은 툴팁 · 작은 글자로 함께 보인다(약관 — 피드를 고치거나 왜곡하지 않는다).
 * - 새 정지 토스트는 이 화면을 보고 있을 때만(화면을 떠나면 언마운트) — 처음 열 때 이미 있던 정지는 알리지 않는다.
 * ⚠️ 방향은 토스 1분봉으로 낸 **추정**이다. 매수 · 매도 신호가 아니다.
 */

const REFRESH_MS = 30_000;
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

  // 새 정지 토스트 — 처음 받은 목록은 「본 것」 으로만 두고, 그 뒤 새로 생긴 줄만 알린다(여러 건이면 한 토스트)
  useEffect(() => {
    if (!data) return;
    if (!seen.current) {
      seen.current = new Set(data.halts.map((h) => h.id));
      openedAt.current = data.serverNow;
      return;
    }
    const added = data.halts.filter((h) => !seen.current!.has(h.id));
    for (const h of added) seen.current.add(h.id);
    // 화면을 연 뒤에 생긴 정지만 — 서버가 막 켜져(또는 실패 뒤) 처음 받은 목록의 오늘 앞선 정지는 알리지 않는다
    const fresh = added.filter((h) => h.haltAtMs >= openedAt.current! - TOAST_LOOKBACK_MS);
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
      <PageHeader title="미국 거래정지" />
      <div className={`min-h-0 flex-1 overflow-auto ${PANEL_PAD} pt-0`}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-text-muted">
            {data && <span>미국 날짜 {data.day}</span>}
            {data && <StatusLine status={data.status} />}
          </div>
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

        {!data && !error && <SkeletonTable rows={5} columns={5} />}
        {data &&
          (() => {
            const mine = (h: UsHaltRow) => watchlist.includes(h.rawIssueSymbol.trim()) || h.held;
            // live: 오늘 표는 가장 최근 정지가 안 풀린 묶음만(풀린 정지는 최대 거래대금 계산에만 쓴다)
            const split = <T extends UsHaltRow>(rows: T[], live: boolean) => {
              const groups = groupHalts(rows).filter((g) => !live || isHaltOngoing(g.latest, now));
              const hidden = groups.filter((g) => isHiddenByTurnover(groupTurnover([g.latest, ...g.earlier]).usd, minTurnover ?? null, mine(g.latest)));
              return { groups, shown: showHidden ? groups : groups.filter((g) => !hidden.includes(g)), hiddenCount: hidden.length };
            };
            const today = split(data.halts, true);
            const ongoing = split(data.ongoing, false);
            const notice = (n: number) =>
              n > 0 && <HiddenNotice count={n} showing={showHidden} onToggle={() => setShowHidden((v) => !v)} />;
            return (
              <>
                {/* 며칠째 정지 중 — 0건이면 그리지 않는다. 오늘 표 위 */}
                {ongoing.groups.length > 0 && (
                  <div className="mt-4 mb-6 space-y-2">
                    <SectionTitle>며칠째 정지 중 ({ongoing.groups.length})</SectionTitle>
                    {notice(ongoing.hiddenCount)}
                    {ongoing.shown.length > 0 && <OngoingTable groups={ongoing.shown} watchlist={watchlist} onSelectSymbol={onSelectSymbol} />}
                    <p className="text-caption text-text-muted">최근 30일 안에 시작된 정지만 보입니다(그보다 오래된 정지는 저장하지 않습니다).</p>
                  </div>
                )}
                <div className="mb-2">
                  <SectionTitle>지금 정지 중 ({today.groups.length})</SectionTitle>
                </div>
                {!today.groups.length && (
                  <p className="rounded-lg bg-bg-tertiary/40 px-3 py-6 text-center text-caption text-text-muted">
                    <EmptyText day={data.day} status={data.status} />
                  </p>
                )}
                {today.hiddenCount > 0 && <div className="mb-2">{notice(today.hiddenCount)}</div>}
                {today.shown.length > 0 && <HaltTable groups={today.shown} now={now} watchlist={watchlist} onSelectSymbol={onSelectSymbol} />}
              </>
            );
          })()}

        {/* 출처 · 지연 · 추정 — 표 아래 고정 문구 */}
        <p className="mt-3 text-caption text-text-muted">
          자료: Nasdaq Trader 거래정지 목록 · 정지 뒤 약 0.5~2분 늦게 보입니다 · 방향은 토스 1분봉으로 낸 추정입니다(매수 · 매도 신호가 아닙니다)
        </p>
      </div>
    </div>
  );
}

/**
 * 빈 목록 문구(지금 멈춘 종목 0) — 받은 적이 없거나 받기가 실패 중이면 「없음」 이라고 하지 않는다(정지가 있는지 모른다).
 * 받는 중이면 다시 확인한다고 적는다.
 */
function EmptyText({ day, status }: { day: string; status: UsHaltFetchStatus }) {
  if (status.enabled && (!status.lastSuccessAt || status.consecutiveFailures >= FAIL_WARN))
    return <>아직 Nasdaq 목록을 받지 못해 오늘(미국 날짜 {day}) 정지를 알 수 없습니다.</>;
  if (!status.enabled || !status.inWindow) return <>지금 멈춰 있는 종목이 없습니다.</>;
  return <>지금 멈춰 있는 종목이 없습니다 — 1분마다 다시 확인합니다.</>;
}

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
 * 묶음 거래대금(`groupTurnover` — 정지들 가운데 가장 큰 5분 거래대금) — 0 = 거래 없음 · null = 모름(아직이면 확인 중).
 * 일부 정지만 모르면 아는 값 가운데 최대 + 정보 아이콘. `prefix` — 오늘 표 「오늘 최대 5분」 · 며칠째 칸 「최대 5분」
 */
function TurnoverText({ halts, prefix }: { halts: UsHaltRow[]; prefix: string }) {
  const t = groupTurnover(halts);
  if (t.pending) return <span className="text-text-muted">거래대금 확인 중…</span>;
  if (t.usd == null) return <span className="text-text-muted">거래량 모름</span>;
  if (t.usd === 0)
    return (
      <span className="inline-flex items-center gap-1 text-text-muted">
        5분 거래 없음
        {t.partial && <InfoTip label="거래량 모름 설명">일부 정지는 거래량을 모릅니다.</InfoTip>}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-text-secondary">
      <span className="tabular-nums">
        {prefix} {formatUsdShort(t.usd)}
      </span>
      {t.partial && <InfoTip label="거래량 모름 설명">일부 정지는 거래량을 모릅니다.</InfoTip>}
    </span>
  );
}

const TURNOVER_TIP = '이 종목이 오늘 멈췄던 정지들 가운데, 정지 전 5분 거래대금이 가장 컸던 값(종가 × 거래량, 토스 1분봉)';
const ONGOING_TURNOVER_TIP = '이 칸에 묶인 정지들 가운데, 정지 전 5분 거래대금이 가장 컸던 값(종가 × 거래량, 토스 1분봉)';

function HaltTable({
  groups,
  now,
  watchlist,
  onSelectSymbol,
}: {
  groups: HaltGroup<UsHaltRow>[];
  now: number;
  watchlist: string[];
  onSelectSymbol: (symbol: string) => void;
}) {
  const NUM = `${TABLE_NUM_COL} ${TABLE_NUM_GAP_TIGHT}`;
  return (
    <div className="rounded-lg bg-bg-tertiary/40">
      <table className="w-full text-left text-xs">
        <thead className="text-caption text-text-muted">
          <tr className="border-b border-border/50">
            <th className={`${TABLE_NAME_COL} py-2 pl-3 pr-3 font-normal`}>종목</th>
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
            <th className={`${NUM} py-2 pr-3 font-normal`}>
              <span className="flex items-center gap-1">
                방향(추정)
                <InfoTip label="방향 추정 설명">
                  정지 직전 1분봉 종가를 그 5분 전 종가와 비교해 짐작한 것입니다(토스 1분봉). Nasdaq 목록에는 위로 멈췄는지 아래로 멈췄는지 칸이 없어 맞았는지 확인할 수 없습니다. 매수 · 매도 신호가 아닙니다 — 상승 중 정지는 급하게 오르다 멈춘 것이라 재개 직후 크게 흔들릴 수 있습니다. 판정하지 못하면 이유를 함께 적습니다(거래 적음 · 변화 없음 · 토스에 없음 · 받기 실패).
                </InfoTip>
              </span>
              <span className="flex items-center gap-1">
                거래대금
                <InfoTip label="거래대금 설명">{TURNOVER_TIP}</InfoTip>
              </span>
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
                {/*
                  1280 에서 종목 칸이 좁다 — 말줄임 대신 단어 단위 줄바꿈(매수 판단 표와 같다 · 티커는 자르지 않는다).
                  시장은 종목 칸 티커 뒤(시장 칸을 두면 1280 에서 표가 상자를 넘었다)
                */}
                <td className="py-1.5 pl-3 pr-3">
                  <HaltName h={h} watched={watched} market={h.rawMarket} onSelectSymbol={onSelectSymbol} />
                </td>
                {/* 쉬운 말 아래에 원문 코드 — 한 줄로 두면 1280 에서 종목 칸이 좁아져 이름이 두 줄로 꺾였다 */}
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
                <td className={`${NUM} py-1.5 pr-3`}>
                  <span className="block">
                    <DirectionText h={h} />
                  </span>
                  <span className="block text-caption">
                    <TurnoverText halts={[h, ...earlier]} prefix="오늘 최대 5분" />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 예상 재개 — 오늘 표는 안 풀린 정지만 보여 resumed 는 오지 않는다(오면 비운다) */
function ResumeCell({ resume }: { resume: ReturnType<typeof expectedResume> }) {
  switch (resume.kind) {
    case 'resumed':
      return null;
    case 'first':
      return <span className="tabular-nums">{kstClockText(resume.at)} 예상</span>;
    case 'extended':
      return <span className="tabular-nums">연장 · {kstClockText(resume.at)} 예상</span>;
    case 'announced':
      // 두 줄 — 한 줄이면 1280 에서 칸이 넓어져 마지막 칸(방향)이 표 밖으로 밀렸다
      return (
        <>
          <span className="block tabular-nums">{kstClockText(resume.at)}</span>
          <span className="block text-caption text-text-muted">재개 예정(공지)</span>
        </>
      );
    case 'open':
      return (
        <span className="text-text-secondary">
          <span className="block">조건이 맞으면 재개</span>
          <span className="block text-caption text-text-muted">시각 정해지지 않음</span>
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
  if (est === 'up') return <span className="text-bullish">▲ 상승 중 정지(추정)</span>;
  if (est === 'down') return <span className="text-bearish">▼ 하락 중 정지(추정)</span>;
  if (est === 'pending') return <span className="text-text-muted">추정 중…</span>;
  return <span className="whitespace-nowrap text-text-muted">{directionUnknownText(h.directionReason)}</span>;
}

/**
 * 종목 칸 — 이름 · 티커(누르면 차트, 토스에 없으면 못 누름) + 시장(오늘 표만, 티커 뒤) + 둘째 줄 관심 · 보유 배지. 오늘 표 · 며칠째 표가 같이 쓴다
 */
function HaltName({ h, watched, market, onSelectSymbol }: { h: UsHaltRow; watched: boolean; market?: string; onSelectSymbol: (symbol: string) => void }) {
  const symbol = h.rawIssueSymbol.trim();
  return (
    <>
      {h.inToss ? (
        <button type="button" onClick={() => onSelectSymbol(symbol)} className="rounded text-left hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent">
          <StockName symbol={symbol} name={h.catalogName ?? (h.rawIssueName.trim() || null)} wrap />
        </button>
      ) : (
        <span title="토스에 없는 종목" aria-disabled="true" className="cursor-not-allowed text-text-secondary">
          <StockName symbol={symbol} name={h.rawIssueName.trim() || null} wrap />
        </span>
      )}
      {/* 시장은 이름 · 티커 뒤에 이어서(따로 줄을 두면 1280 에서 줄이 3줄로 늘었다) */}
      {/* 앞에 공백 — 없으면 티커와 붙어 줄바꿈 자리가 없어져 종목 칸이 넓어졌다 */}
      {market && (
        <>
          {' '}
          <span className="whitespace-nowrap text-caption text-text-muted">{market}</span>
        </>
      )}
      {(watched || h.held) && (
        <span className="mt-0.5 flex gap-1 whitespace-nowrap">
          {watched && <Badge>관심</Badge>}
          {h.held && <Badge>보유</Badge>}
        </span>
      )}
    </>
  );
}

/** 사유 칸 — 쉬운 말 아래에 원문 코드(한 줄로 두면 1280 에서 종목 칸이 좁아져 이름이 꺾였다). 모르는 코드는 원문만 */
function ReasonText({ h }: { h: UsHaltRow }) {
  const label = haltCodeLabel(codeOf(h));
  if (!label) return <>{h.rawReasonCode}</>;
  return (
    <>
      {/*
        긴 쉬운 말(「뉴스 발표 · 재개 시각 공지」 등)은 단어 단위로 꺾는다 — 한 줄로 두면 1280 에서 표가 상자를 19px 넘었다.
        최소 폭 128px — 없으면 칸(w-px)이 한 단어씩 꺾였다. 「변동성 정지(LULD)」 는 한 줄
      */}
      <span className="block min-w-32 whitespace-normal break-keep">{label}</span>
      <span className="block text-caption text-text-muted">{h.rawReasonCode}</span>
    </>
  );
}

/**
 * 며칠째 정지 중 — 지난 날 정지 가운데 안 풀린 것(서버가 고름 · 「안 풀림」 = `isHaltOngoing`). 오늘 표와 같은 칸 모양.
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
            <th className={`${TABLE_NAME_COL} py-2 pl-3 pr-3 font-normal`}>종목</th>
            <th className={`${NUM} py-2 font-normal`}>사유</th>
            <th className={`${NUM} py-2 font-normal`}>정지 시작</th>
            <th className={`${NUM} py-2 text-right font-normal`}>며칠째</th>
            <th className={`${NUM} py-2 font-normal`}>재개</th>
            <th className={`${NUM} py-2 font-normal`}>상태</th>
            <th className={`${NUM} py-2 pr-3 font-normal`}>
              <span className="inline-flex items-center gap-1">
                거래대금
                <InfoTip label="거래대금 설명">{ONGOING_TURNOVER_TIP}</InfoTip>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ latest: h, earlier }) => (
            <tr key={h.id} className={`border-b border-border/30 last:border-0 ${LIST_TABLE_ROW}`} data-ongoing-row={h.rawIssueSymbol.trim()}>
              <td className="py-1.5 pl-3 pr-3">
                <HaltName h={h} watched={watchlist.includes(h.rawIssueSymbol.trim())} onSelectSymbol={onSelectSymbol} />
              </td>
              <td className={`${NUM} py-1.5`}>
                <ReasonText h={h} />
              </td>
              <td className={`${NUM} py-1.5 tabular-nums`}>
                <span title={etTitle(h.rawHaltDate, h.rawHaltTime)}>{kstMonthDayTime(h.haltAtMs)}</span>
              </td>
              <td className={`${NUM} py-1.5 text-right tabular-nums`}>{h.daysHalted}일째</td>
              <td className={`${NUM} py-1.5`}>
                {/* 서버가 안 풀린 줄만 보낸다 — 공지 시각이 지나도 다음 읽기(30초)까지는 그 시각을 그대로 둔다(「없음」 으로 바뀌지 않게) */}
                {h.resumeAtMs != null ? (
                  <span title={etTitle(h.rawResumptionDate || h.rawHaltDate, h.rawResumptionTradeTime)}>
                    <span className="block tabular-nums">{kstMonthDayTime(h.resumeAtMs)}</span>
                    <span className="block text-caption text-text-muted">재개 예정(공지)</span>
                  </span>
                ) : (
                  <span className="text-text-muted">정해진 시각 없음</span>
                )}
              </td>
              <td className={`${NUM} py-1.5`}>
                {h.unlisted ? (
                  <span className="inline-flex items-center gap-1 text-text-muted">
                    목록에서 사라짐 — 상태 모름
                    <InfoTip label="상태 모름 설명">Nasdaq 목록에서 빠져 풀렸는지 알 수 없습니다.</InfoTip>
                  </span>
                ) : (
                  <span className="font-medium text-warning">정지 중</span>
                )}
              </td>
              <td className={`${NUM} py-1.5 pr-3`}>
                <TurnoverText halts={[h, ...earlier]} prefix="최대 5분" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
