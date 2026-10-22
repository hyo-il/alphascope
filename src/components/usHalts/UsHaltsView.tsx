import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, InfoTip, PageHeader } from '../ui';
import { LIST_TABLE_ROW, PANEL_PAD, TABLE_NAME_COL, TABLE_NUM_COL, TABLE_NUM_GAP_TIGHT } from '../ui/tokens';
import StockName from '../common/StockName';
import { SkeletonTable } from '../common/SkeletonLoader';
import { useWatchlist } from '../../hooks/useWatchlist';
import { toast } from '../../store/uiStore';
import { haltCodeLabel } from '../../data/haltCodes';
import { expectedResume, isLuldCode } from '../../utils/usHalts';
import { kstClockText } from '../../utils/marketDate';
import type { HaltDirectionEstimate, UsHaltFetchStatus, UsHaltRow, UsHaltsResponse } from '../../types/usHalts';

/**
 * 실험실 > 미국 거래정지 (v2.55.0) — 오늘(미국 날짜) 멈춘 미국 종목 · 사유 · 정지 · 예상 재개 · 실제 재개(한국 시간) · 방향(추정).
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

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/us-halts');
      const payload = (await r.json().catch(() => ({}))) as UsHaltsResponse & { error?: string };
      if (!r.ok) throw new Error(payload.error ?? `요청 실패 (${r.status})`);
      offset.current = payload.serverNow - Date.now();
      setNow(payload.serverNow);
      setData(payload);
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
    const line = (h: UsHaltRow) => `${h.rawIssueSymbol} ${haltCodeLabel(codeOf(h)) ?? h.rawReasonCode} · ${kstClockText(h.haltAtMs)}`;
    if (fresh.length === 1) toast.info(line(fresh[0]));
    // 토스트 설명은 한 문단이라 줄바꿈 대신 「 · 」 — 종목 · 정지 시각(한국)만, 5건까지
    else
      toast.info(
        `새 정지 ${fresh.length}건`,
        fresh.slice(0, 5).map((h) => `${h.rawIssueSymbol} ${kstClockText(h.haltAtMs)}`).join(' · ') + (fresh.length > 5 ? ` 외 ${fresh.length - 5}건` : ''),
      );
  }, [data]);

  return (
    <div className="flex h-full flex-col" data-us-halts>
      <PageHeader title="미국 거래정지" />
      <div className={`min-h-0 flex-1 overflow-auto ${PANEL_PAD} pt-0`}>
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-text-muted">
          {data && <span>미국 날짜 {data.day}</span>}
          {data && <StatusLine status={data.status} />}
        </div>
        {error && <p className="mb-2 rounded-lg bg-danger/10 px-3 py-1.5 text-caption text-danger">{error}</p>}

        {!data && !error && <SkeletonTable rows={5} columns={8} />}
        {data && !data.halts.length && (
          <p className="rounded-lg bg-bg-tertiary/40 px-3 py-6 text-center text-caption text-text-muted">
            <EmptyText day={data.day} status={data.status} />
          </p>
        )}
        {data && data.halts.length > 0 && (
          <HaltTable halts={data.halts} now={now} watchlist={watchlist} onSelectSymbol={onSelectSymbol} />
        )}

        {/* 출처 · 지연 · 추정 — 표 아래 고정 문구 */}
        <p className="mt-3 text-caption text-text-muted">
          자료: Nasdaq Trader 거래정지 목록 · 정지 뒤 약 0.5~2분 늦게 보입니다 · 방향은 토스 1분봉으로 낸 추정입니다(매수 · 매도 신호가 아닙니다)
        </p>
      </div>
    </div>
  );
}

/**
 * 빈 목록 문구 — 받은 적이 없거나 받기가 실패 중이면 「없음」 이라고 하지 않는다(정지가 있는지 모른다).
 * 받는 시간대 밖이면 「아직」 을 빼고, 받는 중이면 다시 확인한다고 적는다.
 */
function EmptyText({ day, status }: { day: string; status: UsHaltFetchStatus }) {
  if (status.enabled && (!status.lastSuccessAt || status.consecutiveFailures >= FAIL_WARN))
    return <>아직 Nasdaq 목록을 받지 못해 오늘(미국 날짜 {day}) 정지를 알 수 없습니다.</>;
  if (!status.enabled || !status.inWindow) return <>오늘(미국 날짜 {day}) 멈춘 미국 종목이 없습니다.</>;
  return <>오늘(미국 날짜 {day}) 멈춘 미국 종목이 아직 없습니다 — 1분마다 다시 확인합니다.</>;
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
    return <span>미국 시간 04:00~20:00 ET 평일에만 받습니다{lastMs != null ? ` · 마지막 확인 ${KST_DAY.format(new Date(lastMs))} ${last}` : ''}</span>;
  if (!last) return <span>{status.consecutiveFailures ? `아직 받지 못했습니다(실패 ${status.consecutiveFailures}번 · 1분마다 다시)` : '처음 받는 중…'}</span>;
  return <span>마지막 확인 {last} · 1분마다</span>;
}

function HaltTable({
  halts,
  now,
  watchlist,
  onSelectSymbol,
}: {
  halts: UsHaltRow[];
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
            <th className={`${NUM} py-2 font-normal`}>시장</th>
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
            <th className={`${NUM} py-2 font-normal`}>실제 재개</th>
            <th className={`${NUM} py-2 font-normal`}>상태</th>
            <th className={`${NUM} py-2 pr-3 font-normal`}>
              <span className="inline-flex items-center gap-1">
                방향(추정)
                <InfoTip label="방향 추정 설명">
                  정지 직전 1분봉 종가를 그 5분 전 종가와 비교해 짐작한 것입니다(토스 1분봉). Nasdaq 목록에는 위로 멈췄는지 아래로 멈췄는지 칸이 없어 맞았는지 확인할 수 없습니다. 매수 · 매도 신호가 아닙니다 — 상승 중 정지는 급하게 오르다 멈춘 것이라 재개 직후 크게 흔들릴 수 있습니다. 1분봉이 모자라거나 · 값이 같거나 · 토스에 없는 종목이면 「판정 못 함」 입니다.
                </InfoTip>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {halts.map((h) => {
            const symbol = h.rawIssueSymbol.trim();
            const resume = expectedResume({ ...h, rawReasonCode: codeOf(h) }, now);
            const resumed = resume.kind === 'resumed';
            const watched = watchlist.includes(symbol);
            return (
              <tr key={h.id} className={`border-b border-border/30 last:border-0 ${LIST_TABLE_ROW}`} data-halt-row={symbol}>
                {/* 칸이 8개라 1280 에서 종목 칸이 좁다 — 말줄임 대신 단어 단위 줄바꿈(매수 판단 표와 같다 · 티커는 자르지 않는다) */}
                <td className="py-1.5 pl-3 pr-3">
                  {h.inToss ? (
                    <button type="button" onClick={() => onSelectSymbol(symbol)} className="rounded text-left hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent">
                      <StockName symbol={symbol} name={h.catalogName ?? (h.rawIssueName.trim() || null)} wrap />
                    </button>
                  ) : (
                    <span title="토스에 없는 종목" aria-disabled="true" className="cursor-not-allowed text-text-secondary">
                      <StockName symbol={symbol} name={h.rawIssueName.trim() || null} wrap />
                    </span>
                  )}
                  {(watched || h.held) && (
                    <span className="mt-0.5 flex gap-1">
                      {watched && <Badge>관심</Badge>}
                      {h.held && <Badge>보유</Badge>}
                    </span>
                  )}
                </td>
                <td className={`${NUM} py-1.5 text-text-secondary`}>{h.rawMarket}</td>
                {/* 쉬운 말 아래에 원문 코드 — 한 줄로 두면 1280 에서 종목 칸이 좁아져 이름이 두 줄로 꺾였다 */}
                <td className={`${NUM} py-1.5`}>
                  {haltCodeLabel(codeOf(h)) ? (
                    <>
                      <span className="block">{haltCodeLabel(codeOf(h))}</span>
                      <span className="block text-caption text-text-muted">{h.rawReasonCode}</span>
                    </>
                  ) : (
                    h.rawReasonCode
                  )}
                </td>
                <td className={`${NUM} py-1.5`}>
                  <span className="block tabular-nums" title={etTitle(h.rawHaltDate, h.rawHaltTime)}>
                    {kstClockText(h.haltAtMs)}
                  </span>
                  <span className="block text-caption text-text-muted">오늘 {h.nthToday}번째</span>
                </td>
                {/* 최소 폭 — 「22:46:03 예상」 → 「조건이 맞으면 재개」 로 바뀔 때 칸 폭이 흔들려 표 전체가 움직이지 않게 */}
                <td className={`${NUM} min-w-32 py-1.5`}>
                  <ResumeCell resume={resume} />
                </td>
                <td className={`${NUM} py-1.5 tabular-nums`}>
                  {resumed && h.resumeAtMs != null ? (
                    <span title={etTitle(h.rawResumptionDate || h.rawHaltDate, h.rawResumptionTradeTime)}>{kstClockText(h.resumeAtMs)}</span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className={`${NUM} py-1.5`}>{resumed ? <span className="text-text-secondary">재개됨</span> : <span className="font-medium text-warning">정지 중</span>}</td>
                <td className={`${NUM} py-1.5 pr-3`}>
                  <DirectionText est={h.directionEst} luld={isLuldCode(codeOf(h))} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 예상 재개 — 재개되면 비운다(「실제 재개」 만) */
function ResumeCell({ resume }: { resume: ReturnType<typeof expectedResume> }) {
  switch (resume.kind) {
    case 'resumed':
      return null;
    case 'first':
      return <span className="tabular-nums">{kstClockText(resume.at)} 예상</span>;
    case 'extended':
      return <span className="tabular-nums">연장 · {kstClockText(resume.at)} 예상</span>;
    case 'announced':
      return <span className="tabular-nums">{kstClockText(resume.at)} 재개 예정(공지)</span>;
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

/** 방향(추정) — 색만으로 뜻을 전하지 않는다(글자 · ▲▼). LULD 가 아니면 「—」 */
function DirectionText({ est, luld }: { est: HaltDirectionEstimate; luld: boolean }) {
  if (est === 'none' || !luld) return <span className="text-text-muted">—</span>;
  if (est === 'up') return <span className="text-bullish">▲ 상승 중 정지(추정)</span>;
  if (est === 'down') return <span className="text-bearish">▼ 하락 중 정지(추정)</span>;
  if (est === 'pending') return <span className="text-text-muted">추정 중…</span>;
  return <span className="text-text-muted">판정 못 함</span>;
}
