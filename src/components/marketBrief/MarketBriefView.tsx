import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../ui';
import { PANEL_PAD } from '../ui/tokens';
import { SkeletonCards } from '../common/SkeletonLoader';
import LoadingOverlay from '../common/LoadingOverlay';
import { toast } from '../../store/uiStore';
import type { MarketBriefDayResponse, MarketBriefDays, MarketBriefStatus } from '../../types/marketBrief';
import RunControls from './RunControls';
import BriefPicker from './BriefPicker';
import ProgressBanner from './ProgressBanner';
import BriefBody from './BriefBody';
import { EmptyDay, LoadError } from './BriefStates';

/**
 * 탐색 → 오늘 시황 (v2.59.0) — Stockproject 시황 브리핑을 화면으로 옮긴 것. 칸 순서는 원본 메시지 그대로
 * ① 시장 기조 · ② 60일 주요 일정 · ③ 주도 섹터 · ④ 핵심 테마 · ⑤ 시장 데이터(참고) · ⑥ 스윙 체크포인트 · ⑦ 액션 포인트 · ⑧ 면책.
 *
 * - 서버가 평일 06:55 KST 뒤 첫 10분 확인(07:05 무렵)에 오전판을 만든다. 「시황 분석」 은 지금 시각의 판(13시 전 오전판 · 뒤 오후판)을 하루 5번까지.
 * - 진행 상태는 서버 것(`/api/market-brief/status`)을 읽는다 — 다른 화면에 갔다 와도 진행 중이면 그대로 보인다. 진행 중에만 2초마다 읽는다.
 * - AI 글의 이모지(⚠️ 🔴 등)는 화면에 그리지 않는다 — 아이콘 · 배지로 바꾼다. 하이픈 음수는 마이너스 기호로(`displayMinus`).
 * - 날짜별 30일 · 그날 여러 번 만든 것은 판/시각으로 고른다.
 * - 이 파일은 상태 · 불러오기 · 배치만. 머리(`RunControls` · `BriefPicker` · `ProgressBanner`) · 본문(`BriefBody` → 칸마다 `*Card`) ·
 *   빈 날/실패(`BriefStates`)는 같은 폴더의 부품이다.
 * ⚠️ 투자 조언이 아니다 — 맨 아래 면책 문구는 화면 글자로 늘 보인다(지우지 않는다).
 */

const POLL_MS = 2000;
/** 빈 오늘 화면에서 자동 오전판을 기다릴 때 상태를 읽는 간격 */
const AUTO_WATCH_MS = 30_000;

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
      setDate(r.body.date);
      setError(null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
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
  /** 진행을 본 때의 서버 기동 시각 — 끝났을 때 다르면 서버가 다시 켜진 것 */
  const bootAt = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    if (bootAt.current === null) bootAt.current = status?.bootAt ?? null;
    const timer = setInterval(() => {
      void loadStatus()
        .then((s) => {
          if (s.running || !wasRunning.current) return;
          wasRunning.current = false;
          if (s.lastError) toast.error('시황을 만들지 못했습니다', s.lastError);
          // 진행 중에 서버가 다시 켜졌으면 결과도 오류도 없다 — 끊겼다고 알린다
          else if (s.lastFinishedId == null || (bootAt.current !== null && s.bootAt !== bootAt.current)) {
            toast.warning('진행 중이던 시황이 서버 재시작으로 끊겼습니다', '다시 눌러 주세요 — 끊긴 것은 횟수에 세지 않습니다');
          }
          bootAt.current = null;
          void loadDays();
          // 방금 만든 줄의 날짜로 간다(자정을 넘겨 끝나도)
          void loadDay(s.lastFinishedDate ?? s.today, s.lastFinishedId ?? undefined);
        })
        .catch(() => {
          /* 다음 차례에 다시 */
        });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, status?.bootAt, loadStatus, loadDays, loadDay]);

  // 오늘 화면이 비어 있고 자동 시간대면 30초마다 상태만 — 자동 오전판(또는 다른 기기의 버튼)이 시작되면 진행 표시로 넘어간다
  const watchAuto = !running && !!status?.autoWindowNow && !status.autoDoneToday && day?.date === status.today && day.items.length === 0;
  useEffect(() => {
    if (!watchAuto) return;
    const timer = setInterval(() => {
      void loadStatus()
        .then((s) => {
          if (s.running) wasRunning.current = true;
          else if (s.autoDoneToday) void Promise.all([loadDays(), loadDay(s.today)]);
        })
        .catch(() => {});
    }, AUTO_WATCH_MS);
    return () => clearInterval(timer);
  }, [watchAuto, loadStatus, loadDays, loadDay]);

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
      if (!r.body.started) toast.info('이미 시황을 만드는 중입니다 — 끝나면 보여 드립니다', '이번 누름은 횟수에 세지 않습니다');
      wasRunning.current = true;
    } catch (e) {
      toast.error('시황 분석을 시작하지 못했습니다', (e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const pickDate = (d: string) => {
    const prev = date;
    setDate(d);
    void loadDay(d).then((ok) => {
      if (!ok) setDate(prev); // 못 불러오면 고르기 칸을 보이는 본문 날짜로 되돌린다(오류 줄은 본문 위에)
    });
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
        <BriefPicker
          status={status}
          dateOptions={dateOptions}
          date={date}
          day={day}
          selected={selected}
          loadingDay={loadingDay}
          onPickDate={pickDate}
          onPickBrief={(id) => date && void loadDay(date, id)}
        />

        {status?.running && <ProgressBanner stage={status.stage} edition={status.edition} trigger={status.trigger} />}

        {error && <LoadError error={error} hasDay={!!day} />}
        {firstLoad && <SkeletonCards count={4} />}
        {day && (
          <div className="relative">
            {loadingDay && <LoadingOverlay contained label="불러오는 중…" />}
            {selected ? (
              <BriefBody brief={selected} onOpen={onSelectSymbol} />
            ) : (
              <EmptyDay isToday={day.date === status?.today} status={status} onRun={run} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
