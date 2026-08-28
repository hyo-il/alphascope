import { useState } from 'react';

interface Props {
  /** 현재 차트 종목 — 항상 비교에 포함된다 */
  baseSymbol: string;
  symbols: string[];
  onChange: (symbols: string[]) => void;
}

const MAX_EXTRA = 2;

export default function CompareSymbols({ baseSymbol, symbols, onChange }: Props) {
  const [input, setInput] = useState('');

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const next = input.trim().toUpperCase();
    if (!next || next === baseSymbol || symbols.includes(next)) return;
    if (symbols.length >= MAX_EXTRA) return;
    onChange([...symbols, next]);
    setInput('');
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

      <form onSubmit={add} className="flex gap-1">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="심볼 (예: MSFT)"
          spellCheck={false}
          disabled={symbols.length >= MAX_EXTRA}
          className="min-w-0 flex-1 rounded border border-border bg-bg-tertiary px-2 py-1 text-xs uppercase text-text-primary placeholder:normal-case placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-40"
        />
        <button
          type="submit"
          disabled={symbols.length >= MAX_EXTRA}
          className="rounded border border-border px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-40"
        >
          추가
        </button>
      </form>
    </div>
  );
}
