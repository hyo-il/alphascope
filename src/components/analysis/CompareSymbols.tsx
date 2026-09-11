import SymbolSearch from '../common/SymbolSearch';

interface Props {
  /** 현재 차트 종목 — 항상 비교에 포함된다 */
  baseSymbol: string;
  symbols: string[];
  onChange: (symbols: string[]) => void;
}

/** 기준 종목 + 3개 = 4종목. 비교 화면(`compare/CompareView`)과 같은 상한이다. */
const MAX_EXTRA = 3;

export default function CompareSymbols({ baseSymbol, symbols, onChange }: Props) {
  const add = (next: string) => {
    const symbol = next.trim().toUpperCase();
    if (!symbol || symbol === baseSymbol || symbols.includes(symbol)) return;
    if (symbols.length >= MAX_EXTRA) return;
    onChange([...symbols, symbol]);
  };

  return (
    <div className="rounded-md border border-border bg-bg-tertiary/40 p-2">
      <p className="mb-1.5 text-[11px] text-text-secondary">
        비교 종목 (최대 {MAX_EXTRA}개 추가)
      </p>

      <div className="mb-1.5 flex flex-wrap gap-1">
        <span className="rounded bg-accent/20 px-2 py-0.5 text-[11px] text-accent">
          {baseSymbol} (기준)
        </span>
        {symbols.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(symbols.filter((x) => x !== s))}
            title="제거"
            className="rounded bg-bg-tertiary px-2 py-0.5 text-[11px] text-text-secondary transition-colors hover:text-bearish"
          >
            {s} ✕
          </button>
        ))}
      </div>

      {/*
        관심 목록과 같은 검색 컴포넌트를 쓴다 — 여기만 평범한 입력창이면
        "구글" 을 그대로 대문자로 바꿔 담으려 해서 한글 검색이 안 된다.
      */}
      <SymbolSearch
        symbol=""
        onSubmit={add}
        placeholder={symbols.length >= MAX_EXTRA ? `최대 ${MAX_EXTRA}개` : '종목명 또는 심볼'}
        submitLabel="추가"
        compact
        clearOnSubmit
        isAdded={(s) => s === baseSymbol || symbols.includes(s)}
      />
    </div>
  );
}
