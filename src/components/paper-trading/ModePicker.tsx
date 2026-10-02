import type { StrategyMode } from '../../types/autoTrading';

/**
 * 자동매매 **판단 방식** 고르기 — AI형 / 규칙형 카드 + 비교 표 (v2.31.0).
 * 설정 창 「① 판단 방식」 과 처음 켜기 안내 2단계가 **같은 컴포넌트**를 쓴다 (v2.32.0).
 * 키가 없으면 AI형을 고를 수 없다(설정 창과 같은 가드 — `onMode` 가 무시한다).
 */
export default function ModePicker({
  mode,
  onMode,
  geminiEnabled,
}: {
  mode: StrategyMode;
  onMode: (mode: StrategyMode) => void;
  geminiEnabled: boolean;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {([
          {
            id: 'ai' as const,
            title: 'AI형',
            desc: 'Gemini 5인 분석의 매수·매도 신호로 판단합니다',
            /*
              ⚠️ "AI형 / 규칙형" 만으로는 무엇을 고르는지 알 수 없다 — 둘 다 자동이라
              이름만 보면 차이가 없다. 무엇이 판단하는지, 무엇이 필요한지, 어떤 성격인지를
              한 줄로 적는다.
            */
            easy: '전문가 AI 다섯이 매번 새로 읽고 정합니다. 뉴스·실적 같은 흐름까지 보지만, 같은 상황에서도 답이 조금씩 달라지고 Gemini 키가 필요합니다.',
          },
          {
            id: 'rule' as const,
            title: '규칙형',
            desc: '이동평균 교차와 RSI 로 판단합니다 (AI 키 불필요)',
            easy: '정해 둔 숫자 조건이 맞을 때만 삽니다. 왜 샀는지가 늘 분명하고 결과가 같게 재현되지만, 조건에 없는 일은 보지 못합니다. 키가 필요 없습니다.',
          },
        ]).map((item) => {
          const disabled = item.id === 'ai' && !geminiEnabled;
          const active = mode === item.id;
          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              onClick={() => onMode(item.id)}
              title={item.easy}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                active ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/50'
              }`}
            >
              <p className={`text-xs font-medium ${active ? 'text-accent' : 'text-text-primary'}`}>
                {item.title}
              </p>
              <p className="mt-0.5 text-[14px] leading-relaxed text-text-muted">{item.desc}</p>
              {/* 고른 쪽만 펼쳐 설명한다 — 둘 다 펼치면 카드가 길어져 정작 제목이 안 읽힌다 */}
              {active && (
                <p className="mt-1.5 border-t border-border/60 pt-1.5 text-[14px] leading-relaxed text-text-secondary">
                  {item.easy}
                </p>
              )}
            </button>
          );
        })}
      </div>
      {!geminiEnabled && (
        <p className="text-[14px] text-warning">
          ⚠️ Gemini 키가 설정되지 않았습니다 — 규칙형은 키 없이 동작합니다.
        </p>
      )}
      {/* AI형 vs 규칙형 (v2.31.0) — 사실만 적는다. 어느 쪽이 낫다는 말은 하지 않는다 */}
      <table className="w-full text-[14px]">
        <thead>
          <tr className="border-b border-border text-text-muted">
            <th className="w-24 py-1 text-left font-normal" />
            <th className="py-1 text-left font-normal">AI형</th>
            <th className="py-1 text-left font-normal">규칙형</th>
          </tr>
        </thead>
        <tbody className="text-text-secondary">
          {[
            ['판단하는 것', 'Gemini 가 읽고 판단', '정해진 공식'],
            ['Gemini 사용', '종목당 5회', '0회'],
            ['이유 설명', 'AI 가 쓴 글', '늘 같은 형식'],
          ].map(([k, a, r]) => (
            <tr key={k} className="border-b border-border/50">
              <td className="py-1 text-text-muted">{k}</td>
              <td className="py-1">{a}</td>
              <td className="py-1">{r}</td>
            </tr>
          ))}
          <tr>
            <td className="py-1 text-text-muted">같은 점</td>
            <td colSpan={2} className="py-1">
              모의투자만 · 비중·최대 종목 수·손절·실적 발표 전 회피 안전장치
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
