import { useState } from 'react';
import AutoTradeSettings from './AutoTradeSettings';
import { useAutoTrading } from '../../hooks/useAutoTrading';
import { useGeminiStatus } from '../../hooks/useGemini';
import { toast } from '../../store/uiStore';
import { useStockNames } from '../../hooks/useStockNames';
import { autoTradeView } from '../../utils/autoTradeStatus';
import { explainNote, kstLabel, nextUsOpen, nowSentence, sortNotes } from '../../utils/autoTradeExplain';

/**
 * 계좌 대시보드 상단의 자동매매 바.
 *
 * 한 줄에 **지금 도는가 / 왜 안 도는가 / 켜고 끄기 / 설정**만 둔다.
 * 조건·종목은 설정 패널로 보낸다 — 계좌 화면은 잔고와 거래를 보는 자리이지
 * 전략을 편집하는 자리가 아니다.
 */
export default function AutoTradeBar({ accountId }: { accountId: number | null }) {
  const { strategy, status, error, save } = useAutoTrading(accountId);
  const { state: gemini } = useGeminiStatus(60_000);
  const [open, setOpen] = useState(false);
  const [toggling, setToggling] = useState(false);
  const nameOf = useStockNames(status?.lastNotes.map((n) => n.symbol) ?? []);

  if (!accountId || !strategy) return null;

  const on = strategy.enabled;
  const geminiEnabled = gemini?.enabled ?? false;

  const toggle = async () => {
    // 종목이 없으면 켜지지 않는다 — 서버도 같은 상태를 blockedReason 으로 알려 주지만,
    // 켜 놓고 아무 일도 일어나지 않는 것보다 켜는 순간 막고 이유를 말하는 편이 낫다.
    if (!on && strategy.symbols.length === 0) {
      toast.warning('대상 종목이 없습니다', '[자동매매 설정] 에서 종목을 먼저 담아 주세요');
      setOpen(true);
      return;
    }
    if (!on && strategy.mode === 'ai' && !geminiEnabled) {
      toast.warning('Gemini 키가 설정되지 않았습니다', '규칙형으로 바꾸면 키 없이 동작합니다');
      setOpen(true);
      return;
    }
    setToggling(true);
    try {
      await save({ enabled: !on });
      toast.success(on ? '자동매매를 껐습니다' : '자동매매를 켰습니다');
    } catch (e) {
      toast.error('바꾸지 못했습니다', (e as Error).message);
    } finally {
      setToggling(false);
    }
  };

  const nextRun = status?.nextRunAt ? new Date(status.nextRunAt).toLocaleTimeString('ko-KR') : null;
  /** 바 맨 위의 "지금 상태" 한 문장 (v2.32.0) — 분류는 `autoTradeView` 한 곳, 문장은 `autoTradeExplain` 한 곳 */
  const view = autoTradeView(strategy, status);
  const sentence = nowSentence(strategy, status, view);
  const notes = status ? sortNotes(status.lastNotes) : [];

  return (
    <>
      {/*
        켜 놓고 "지금 무엇을 하는지" 를 한 문장으로 (v2.32.0). 기호(●◐⚠)는 카드와 같다 — 색만으로 구분하지 않는다.
      */}
      {sentence && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-border bg-bg-tertiary/30 px-4 py-1.5 text-xs">
          <span className={view.state === 'running' ? 'text-bullish' : view.state === 'blocked' ? 'text-warning' : 'text-text-secondary'}>
            {view.symbol}
          </span>
          <span className="text-text-primary">{sentence.text}</span>
          {sentence.extra && <span className="text-text-muted">{sentence.extra}</span>}
          {sentence.fix && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="shrink-0 whitespace-nowrap rounded border border-warning/60 px-2 py-0.5 text-[13px] text-warning transition-colors hover:bg-warning/10"
            >
              설정 열기
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <span className="text-xs font-medium text-text-primary">🤖 자동매매</span>

        <span
          className={`rounded px-1.5 py-0.5 text-[13px] font-medium ${
            on ? 'bg-bullish/15 text-bullish' : 'bg-bg-tertiary text-text-muted'
          }`}
        >
          {on ? '켜짐' : '꺼짐'}
        </span>

        {/* 뱃지만 보고는 둘의 차이를 알 수 없다 — 올리면 한 줄로 설명한다 (설정 패널과 같은 문장) */}
        <span
          title={
            strategy.mode === 'ai'
              ? 'AI형 — 전문가 AI 다섯이 매번 새로 읽고 정합니다. 흐름까지 보지만 답이 조금씩 달라지고 Gemini 키가 필요합니다.'
              : '규칙형 — 정해 둔 숫자 조건(이동평균 교차·RSI)이 맞을 때만 삽니다. 이유가 분명하고 키가 필요 없습니다.'
          }
          className="cursor-help rounded border border-border px-1.5 py-0.5 text-[13px] text-text-secondary"
        >
          {strategy.mode === 'ai' ? 'AI형' : '규칙형'}
        </span>

        <span className="text-[13px] text-text-muted">종목 {strategy.symbols.length}개</span>

        {/*
          켜져 있는데 못 도는 이유가 있으면 그것을 먼저 보여 준다.
          "켜짐" 만 떠 있고 아무 일도 일어나지 않으면 사용자는 고장으로 읽는다.
        */}
        {/* 서버 스위치로 꺼진 서버 — 설정이 꺼져 있어도 알린다 (켜 봐야 돌지 않는다) */}
        {!on && status?.serverEnabled === false && (
          <span className="rounded bg-warning/15 px-2 py-0.5 text-[13px] text-warning">
            ⚠️ 이 서버에서는 자동매매가 꺼져 있습니다(AUTO_TRADING_ENABLED=false)
          </span>
        )}
        {/*
          ⚠️ 대기(장 닫힘)는 정상 상태라 경고색을 쓰지 않는다 (v2.33.0) — 맨 위 "지금 상태" 문장이 이미 설명한다.
          예전에는 대기에도 주황 ⚠️ 배지가 겹쳐 떠서 고장처럼 보였다. 멈춤(설정·하루 손실·서버 꺼짐)만 경고색.
        */}
        {on && status?.blockedReason && status.blockedKind === 'market_closed' && (
          <span className="rounded bg-bg-tertiary px-2 py-0.5 text-[13px] text-text-secondary">◐ 대기 — 장 시간이 아닙니다</span>
        )}
        {on && status?.blockedReason && status.blockedKind !== 'market_closed' && (
          <span className="rounded bg-warning/15 px-2 py-0.5 text-[13px] text-warning">
            ⚠️ {status.blockedReason}
          </span>
        )}
        {on && !status?.blockedReason && nextRun && (
          <span className="text-[13px] text-text-muted">
            다음 실행 {nextRun}
            {strategy.mode === 'ai' && status ? ` · 오늘 호출 ${status.callsToday}회` : ''}
          </span>
        )}
        {error && <span className="text-[13px] text-bearish">상태 조회 실패: {error}</span>}

        <span className="ml-auto flex items-center gap-2">
          <span className="rounded bg-warning/15 px-2 py-0.5 text-[13px] text-warning">
            모의 — 실제 주문은 나가지 않습니다
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 whitespace-nowrap rounded border border-border px-2 py-1 text-[13px] text-text-secondary transition-colors hover:border-accent hover:text-accent"
          >
            자동매매 설정
          </button>
          <button
            type="button"
            onClick={() => void toggle()}
            disabled={toggling}
            /*
              ⚠️ 끄기는 **빨강**이다. 돌고 있는 자동매매를 멈추는 동작이라, 켜기와 같은 무게로
              보이면 안 된다 — 눌러 놓고 "왜 안 도나" 를 찾게 된다.
            */
            className={`shrink-0 whitespace-nowrap rounded px-3 py-1 text-[13px] font-medium transition-colors disabled:opacity-50 ${
              on
                ? 'bg-bearish text-white hover:bg-bearish/90'
                : 'bg-accent text-white hover:bg-accent-hover'
            }`}
          >
            {toggling ? '…' : on ? '끄기' : '켜기'}
          </button>
        </span>
      </div>

      {/*
        마지막 한 바퀴의 판단 — 매수·매도와 **건너뛴 이유**(실적 발표 직전·하루 손실 한도·한도 초과 등).
        거래내역은 체결만 보여서, 예전에는 "왜 안 샀나" 를 확인할 곳이 없었다 (v2.16.0).
      */}
      {/*
        켰는데 아직 한 번도 판단하지 않았으면 그 자리를 비워 두지 않는다 (v2.35.0) — 비어 있으면 고장인지 모른다.
        시각은 「지금 상태」 문장과 같은 `nextUsOpen`(주말만 본다, 휴장일은 보지 않는다). 꺼져 있으면 아무것도 그리지 않는다.
        멈춤(서버 꺼짐·설정·하루 손실)이면 그 시각에도 판단하지 않으므로 그리지 않는다 — 멈춤 이유는 위 줄이 말한다.
      */}
      {on && status && status.lastNotes.length === 0 && (!status.blockedKind || status.blockedKind === 'market_closed') && (
        <p className="border-b border-border px-4 py-1.5 text-[13px] text-text-muted">
          아직 판단한 적이 없습니다. 미국 장이 열리는 {kstLabel(nextUsOpen())}에 첫 판단을 합니다.
        </p>
      )}
      {status && status.lastNotes.length > 0 && (
        <details className="border-b border-border px-4 py-1.5 text-[13px]">
          <summary className="text-text-muted">
            최근 판단 {status.lastNotes.length}건
            {status.lastNotesAt && ` · ${new Date(status.lastNotesAt).toLocaleString('ko-KR')}`}
          </summary>
          {/* 쉬운 문장이 먼저, 원래 문장은 작은 회색으로 아래 — 사거나 판 줄이 위, 기다림 줄이 아래 */}
          <ul className="mt-1 space-y-1">
            {notes.map((n, i) => {
              const easy = explainNote(n, nameOf(n.symbol) ?? n.symbol, strategy);
              return (
                <li key={i} className="flex gap-2">
                  <span
                    className={`w-9 shrink-0 font-medium ${
                      n.action === 'BUY' ? 'text-bullish' : n.action === 'SELL' ? 'text-bearish' : 'text-text-muted'
                    }`}
                  >
                    {n.action === 'BUY' ? '매수' : n.action === 'SELL' ? '매도' : '건너뜀'}
                  </span>
                  <span className="min-w-0">
                    {easy ? (
                      <>
                        <span className="block text-text-primary">{easy}</span>
                        <span className="block text-text-muted">
                          {n.symbol} · {n.reason}
                        </span>
                      </>
                    ) : (
                      <span className="text-text-secondary">
                        <span className="mr-2 text-text-secondary">{n.symbol}</span>
                        {n.reason}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {open && (
        <AutoTradeSettings
          strategy={strategy}
          geminiEnabled={geminiEnabled}
          onSave={save}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
