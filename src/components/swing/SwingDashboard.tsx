import Button from '../ui/Button';
import DisclosureButton from '../ui/DisclosureButton';
import WarnIcon from '../ui/WarnIcon';
import { useState } from 'react';
import { usePageTab } from '../../hooks/usePageTab';
import PageHeader from '../ui/PageHeader';
import type { PageTab } from '../../types/nav';
import { useSwingAnalysis } from '../../hooks/useSwing';
import { usePaperQuickBuy } from '../../hooks/usePaperQuickBuy';
import SwingRecommendationCard from './SwingRecommendationCard';
import SwingSearch from './SwingSearch';
import SwingHistory from './SwingHistory';
import { useTargetAnalysis } from '../../hooks/useTargetAnalysis';
import { TargetRefLine, latestFor } from './TargetAnalysisParts';
import TargetTab, { type TargetSeed } from './TargetTab';
import HelpBox from '../common/HelpBox';
import NotProvenLine from './NotProvenLine';
import CriteriaPanel from '../common/CriteriaPanel';
import StrategyProfileModal from './StrategyProfileModal';
import { STANDARD_SWING_CRITERIA, swingCriteria } from '../../data/criteria';
import { useStrategyProfile } from '../../hooks/useStrategyProfile';
import { useSwingGoal } from '../../hooks/useSwingGoal';
import { goalPct, periodLabel } from '../../types/swingGoal';
import {
  PROFILE_LABEL,
  type ProfileId,
} from '../../types/strategyProfile';
import { toast } from '../../store/uiStore';
import SavedRecommendations from './SavedRecommendations';
import { SkeletonCards } from '../common/SkeletonLoader';
import StockName from '../common/StockName';
import { GRADE_STYLE } from './gradeStyle';
import type { SwingGrade, SwingRecommendation } from '../../types/swing';

/** 탭 목록은 `types/nav.ts` 의 `PAGE_TABS` 한 곳 — 주소 `#/swing/{탭}` (v2.28.0) */
type Tab = PageTab<'swing'>;

/*
 * v2.35.0 (사용자 결정): 「추천 종목」 → 「지금 살 만한가」, 「목표 수익 가능성」 탭을 다시 두고(v2.29.0 에 없앴던 것),
 * 「추천 이력」 → 「지난 기록」. 두 기능(공식 점수 / AI 확률)이 한 탭·한 카드에 섞여 하나처럼 보였다. 주소 조각은 예전 그대로.
 */
const TABS: { id: Tab; label: string }[] = [
  { id: 'list', label: '지금 살 만한가' },
  { id: 'target', label: '목표 수익 가능성' },
  { id: 'search', label: '종목 검색' },
  { id: 'history', label: '히스토리' },
];

/*
  ⚠️ 제목에 점수를 박지 않는다 — 컷오프는 프로파일마다 다르다 (v2.7.0).
  실제 값은 위의 「판정 기준」 패널이 활성 프로파일 기준으로 보여 준다.
*/
const SECTIONS: { grades: SwingGrade[]; title: string }[] = [
  { grades: ['STRONG'], title: '강력 추천' },
  { grades: ['BUY'], title: '추천' },
  { grades: ['WATCH'], title: '관심 — 아직 매수 시점은 아닙니다' },
];

/**
 * 매수 판단 도우미 (예전 「스윙 추천」, v2.35.0 이름).
 *
 * 「지금 살 만한가」 = **관심 목록만** 5가지 조건(공식)으로 채점하고 팔 자리(목표·손절)와 비중을 낸다 — AI 를 쓰지 않는다.
 * 「목표 수익 가능성」 = 고른 종목만 Gemini 로 목표·손절 중 어디에 먼저 닿을지 확률 추정 — 다른 분석이다.
 * ⚠️ 실제 주문은 내지 않는다 — [모의 매수] 는 모의투자 계좌만 건드린다.
 */
export default function SwingDashboard({
  watchlist,
  onSelectSymbol,
  onAnalyze,
}: {
  watchlist: string[];
  onSelectSymbol: (symbol: string) => void;
  onAnalyze: (symbol: string) => void;
}) {
  const [tab, setTab] = usePageTab('swing');
  const { result, saved, savedLoading, loading, error, analyze } = useSwingAnalysis(watchlist);
  const paperBuy = usePaperQuickBuy();
  const profile = useStrategyProfile();
  const [profileOpen, setProfileOpen] = useState(false);
  /** 「부적합 이유 보기」 펼침 — 기억하지 않는다 */
  const [rejectedOpen, setRejectedOpen] = useState(false);
  const swingGoal = useSwingGoal();
  const goal = swingGoal.goal;
  /** 목표 수익 가능성 — 엔진·기록·채점은 그대로. 「지금 살 만한가」 카드의 참고 줄과 탭이 같은 상태를 본다 */
  const target = useTargetAnalysis();
  /** 다른 탭에서 「목표 수익 가능성」 으로 넘길 것(체크할 종목·볼 종목) */
  const [targetSeed, setTargetSeed] = useState<TargetSeed | null>(null);
  const openTarget = (symbols: string[], focus: string | null) => {
    setTargetSeed((prev) => ({ symbols, focus, nonce: (prev?.nonce ?? 0) + 1 }));
    setTab('target');
  };

  const activeId: ProfileId = profile.state?.active ?? 'standard';
  const activeParams = profile.state
    ? activeId === 'standard'
      ? profile.state.standard
      : profile.state.custom[activeId]
    : null;
  // 기준을 못 받았으면 표준을 그린다 — 빈 자리보다 낫고, 서버 기본값도 표준이다.
  const criteria = activeParams ? swingCriteria(activeParams, activeId) : STANDARD_SWING_CRITERIA;

  /** 지금 화면에 보이는 결과가 어떤 기준으로 나왔는지 (없으면 null) */
  const resultProfile: ProfileId | null =
    result?.recommendations[0]?.profile ?? saved.records[0]?.profile ?? null;
  const stale = resultProfile != null && resultProfile !== activeId;

  const switchProfile = async (id: ProfileId) => {
    try {
      await profile.save({ active: id });
      toast.success(`${PROFILE_LABEL[id]} 기준으로 바꿨습니다`, '다시 실행해야 새 기준이 적용됩니다');
    } catch (e) {
      toast.error('기준을 바꾸지 못했습니다', (e as Error).message);
    }
  };

  const recommendations = result?.recommendations ?? [];
  const rejected = recommendations.filter((r) => r.grade === 'HOLD' || r.grade === 'AVOID');

  /** 참고 한 줄 — 지금 목표 조건과 같은 가능성 결과가 있을 때만 (방금 결과·저장된 결과 공통) */
  const refLine = (symbol: string) => {
    const latest = latestFor(target.records, symbol, goal);
    return latest ? <TargetRefLine record={latest} onMore={() => openTarget([], symbol)} /> : undefined;
  };

  /** 「지금 살 만한가」 등급 이름 — 방금 결과가 있으면 그것, 없으면 저장된 결과 */
  const gradeOf = (symbol: string) => {
    const g = result?.recommendations.find((r) => r.symbol === symbol)?.grade ?? saved.records.find((r) => r.symbol === symbol)?.grade;
    return g ? (GRADE_STYLE[g]?.label ?? g) : null;
  };

  const card = (recommendation: SwingRecommendation) => (
    <SwingRecommendationCard
      key={recommendation.symbol}
      recommendation={recommendation}
      onSelectSymbol={onSelectSymbol}
      onPaperBuy={paperBuy}
      onAnalyze={onAnalyze}
      extra={refLine(recommendation.symbol)}
    />
  );

  const checkLabel = `관심 종목 ${watchlist.length}개 점검하기`;

  return (
    <div className="flex h-full flex-col">
      <PageHeader tabs={TABS} value={tab} onChange={setTab} tabsLabel="매수 판단 도우미" />

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'list' && (
          <div className="space-y-4">
            <HelpBox id="list" title="지금 살 만한가는 무엇을 하나요?">
              <p>
                관심 목록에 넣어 둔 종목을 하나씩 <b className="text-text-primary">정해진 5가지 질문</b>으로 검사해 점수를 매깁니다. (시장 전체에서 종목을
                찾아 주는 기능이 아닙니다.)
              </p>
              <ol className="list-decimal space-y-0.5 pl-5">
                <li>오르는 흐름인가요? (추세)</li>
                <li>너무 오르지 않고 잠깐 쉬는 중인가요? (타이밍)</li>
                <li>다시 오를 신호가 있나요? (모멘텀)</li>
                <li>매수·매도하는 사람이 많은가요? (거래량)</li>
                <li>벌 수 있는 돈이 잃을 돈보다 큰가요? (손익비)</li>
              </ol>
              <p>
                결과로 <b className="text-text-primary">등급</b>과 <b className="text-text-primary">매매 계획</b>(어디서 매수하고, 어디서 매도하고, 어디서 손절할지)이
                나옵니다. 정해진 공식으로 계산해 AI 를 쓰지 않고 바로 끝납니다. 내 목표 수익률은 보지 않습니다.
              </p>
            </HelpBox>

            <header className="flex flex-wrap items-center gap-3 rounded-xl bg-bg-secondary px-3 py-2 text-caption text-text-secondary">
              <span>
                점검 대상: 관심 목록{' '}
                <span className="text-text-primary">{watchlist.length}개 종목</span>
              </span>
              <span>
                마지막 점검:{' '}
                <span className="text-text-primary">
                  {result
                    ? new Date(result.analyzedAt).toLocaleString('ko-KR')
                    : saved.analyzedAt
                      ? `${new Date(saved.analyzedAt).toLocaleString('ko-KR')} (저장된 결과 ${saved.records.length}건)`
                      : '없음'}
                </span>
              </span>
              <Button variant="primary" size="sm"
                onClick={analyze}
                disabled={loading || !watchlist.length}
                className="ml-auto">
                {loading ? '점검 중…' : checkLabel}
              </Button>
            </header>

            {/*
              스윙 기준 — **버튼 하나** (v2.33.0 사용자 결정 "사실상 같은 메뉴, 하나로"). 예전에는 [표준/공격/수비] + [⚙ 기준 편집] + [목표 요약]
              셋이 있었고 뒤의 둘은 같은 창을 열었다. 표준/공격/수비 선택은 창 맨 위로 옮겼다(바꾸는 동작은 `switchProfile` 그대로).
            */}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm"
                onClick={() => setProfileOpen(true)}
                disabled={!profile.state}
                title="판정 기준(표준·공격·수비)과 목표 수익 가능성의 조건을 함께 봅니다 — 목표는 점수·등급을 바꾸지 않습니다">
                판단 기준 · {PROFILE_LABEL[activeId]} · 목표 +{goalPct(goal.targetPct)} · {periodLabel(goal.days)}
              </Button>
              {profile.error && (
                <span className="text-caption text-warning">
                  기준을 불러오지 못해 표준을 표시합니다 ({profile.error})
                </span>
              )}
            </div>

            {/*
              결과와 지금 기준이 다르면 알린다. 자동으로 다시 돌리지는 않는다 —
              관심 종목 전체 분석이라 무겁고, 언제 돌릴지는 사용자가 정한다.
            */}
            {stale && (
              <p className="flex flex-wrap items-center gap-2 rounded-lg bg-warning/10 px-3 py-1.5 text-caption text-warning">
                이 결과는 '{PROFILE_LABEL[resultProfile]}' 기준입니다 · 지금은 '
                {PROFILE_LABEL[activeId]}' 기준
                <button
                  type="button"
                  onClick={analyze}
                  disabled={loading || !watchlist.length}
                  className="rounded border border-warning/60 px-2 py-0.5 text-caption transition-colors hover:bg-warning/20 disabled:opacity-50"
                >
                  다시 점검
                </button>
              </p>
            )}

            {/* 점수·등급만 보이고 기준이 없으면 결과를 받아들이거나 무시하거나 둘뿐이다 */}
            <CriteriaPanel spec={criteria} />

            {!watchlist.length && (
              <p className="rounded-xl bg-bg-secondary px-3 py-6 text-center text-xs text-text-muted">
                관심 목록이 비어 있습니다. 오른쪽 관심 목록에 종목을 담거나 「종목 검색」 탭에서 한 종목씩
                점검해 보세요.
              </p>
            )}

            {error && (
              <p className="rounded-lg bg-danger/10 px-3 py-2 text-caption text-danger">
                {error}
              </p>
            )}

            {result?.failures.length ? (
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-caption text-warning">
                분석하지 못한 종목:{' '}
                {result.failures.map((f) => `${f.symbol}(${f.error})`).join(' · ')}
              </p>
            ) : null}

            {/*
              이번 세션에서 아직 돌리지 않았어도 저장된 마지막 추천을 보여 준다 —
              화면을 오갈 때마다 빈 화면에서 다시 시작하지 않게.
            */}
            {!result && !loading && savedLoading && <SkeletonCards count={3} />}
            {!result && !loading && !savedLoading && (
              <SavedRecommendations
                records={saved.records}
                analyzedAt={saved.analyzedAt}
                onSelectSymbol={onSelectSymbol}
                extraFor={refLine}
              />
            )}

            {!result && !loading && !savedLoading && !saved.records.length && watchlist.length > 0 && (
              <p className="rounded-xl bg-bg-secondary px-3 py-6 text-center text-xs text-text-muted">
                「{checkLabel}」 를 누르면 관심 종목을 5가지 조건으로 채점합니다.
              </p>
            )}

            {/* 방금 점검한 결과 — 저장된 결과와 같은 자리, 같은 참고 줄 */}
            {result && (
              <p className="text-xs font-semibold text-text-secondary">
                {new Date(result.analyzedAt).toLocaleString('ko-KR')}에 점검한 결과
              </p>
            )}

            {SECTIONS.map((section) => {
              const items = recommendations.filter((r) => section.grades.includes(r.grade));
              if (!result) return null;
              return (
                <section key={section.title} className="space-y-4">
                  <h3 className="text-xs font-semibold text-text-secondary">
                    {section.title} · {items.length}개
                  </h3>
                  {items.length ? (
                    /* 카드 안은 세로 배치라 420px 면 충분하다 — 넓은 화면에서는 여러 열로 늘어선다 */
                    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(420px,1fr))]">
                      {items.map(card)}
                    </div>
                  ) : (
                    <p className="text-caption text-text-muted">해당하는 종목이 없습니다.</p>
                  )}
                </section>
              );
            })}

            {rejected.length > 0 && (
              <div className="rounded-xl bg-bg-secondary px-3 py-2">
                <DisclosureButton
                  open={rejectedOpen}
                  onToggle={() => setRejectedOpen((v) => !v)}
                  label={`부적합 이유 보기 (${rejected.length}개)`}
                  controls="swing-rejected"
                />
                {rejectedOpen && (
                <ul id="swing-rejected" className="mt-1 space-y-1 text-caption">
                  {rejected.map((r) => {
                    return (
                      <li key={r.symbol} className="space-y-1">
                        <div className="mt-1 flex gap-2">
                          <StockName symbol={r.symbol} name={r.name} />
                          <span className="tabular-nums text-text-muted">({r.score}점)</span>
                          <span className="min-w-0 text-text-secondary">{r.rejection}</span>
                        </div>
                        {refLine(r.symbol)}
                      </li>
                    );
                  })}
                </ul>
                )}
              </div>
            )}

            <p className="text-caption text-text-muted">
              <WarnIcon />이 점수는 지표 조건을 기계적으로 채점한 결과이며 투자 조언이 아닙니다. 목표가·손절가는
              계획을 세우기 위한 기준일 뿐 가격을 보장하지 않습니다.
            </p>
            <NotProvenLine />
          </div>
        )}

        {tab === 'target' && (
          <TargetTab
            goal={goal}
            target={target}
            gradeOf={gradeOf}
            seed={targetSeed}
            onOpenCriteria={() => setProfileOpen(true)}
          />
        )}

        {tab === 'search' && (
          <SwingSearch
            onSelectSymbol={onSelectSymbol}
            onAnalyze={onAnalyze}
            goal={goal}
            onGoTarget={(symbol) => openTarget([symbol], null)}
          />
        )}
        {tab === 'history' && <SwingHistory />}
      </div>

      {profileOpen && profile.state && (
        <StrategyProfileModal
          state={profile.state}
          onSave={(custom) => profile.save({ custom })}
          goal={goal}
          onSaveGoal={swingGoal.save}
          activeId={activeId}
          onSwitchProfile={switchProfile}
          onClose={() => setProfileOpen(false)}
        />
      )}
    </div>
  );
}
