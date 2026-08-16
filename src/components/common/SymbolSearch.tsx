import { useEffect, useState } from 'react';

interface Props {
  symbol: string;
  onSubmit: (symbol: string) => void;
}

/** 심볼 직접 입력. 종목명 자동완성은 토스 종목 조회 API 연동 후 추가한다. */
export default function SymbolSearch({ symbol, onSubmit }: Props) {
  const [value, setValue] = useState(symbol);

  useEffect(() => setValue(symbol), [symbol]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = value.trim().toUpperCase();
    if (next) onSubmit(next);
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="종목 심볼 (예: AAPL)"
        spellCheck={false}
        className="w-48 rounded-md border border-border bg-bg-tertiary px-3 py-1.5 text-sm uppercase text-text-primary placeholder:normal-case placeholder:text-text-muted focus:border-accent focus:outline-none"
      />
      <button
        type="submit"
        className="rounded-md bg-accent px-3 py-1.5 text-sm text-white transition-colors hover:bg-accent-hover"
      >
        조회
      </button>
    </form>
  );
}
