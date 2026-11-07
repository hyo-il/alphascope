import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button, ICON_SM, NumberField } from "../ui";
import type { AssetTargetRatio } from "../../types/asset";

/**
 * 설정 창 「목표 비율」(v2.63.0) — 현금 · 채권 · 금 · 주식 / 코어 · 위성 정수 % 입력 · 합을 바로 보인다 · [저장] 은 두 합이 100 일 때만.
 * 저장하면 시트 「자산 투자 비율 관리」 여섯 칸에 쓴다(서버 `writeTargetRatio` — 칸 순서 · 모양 · 수식 칸 확인은 서버 한 곳).
 * - 저장 중 로딩 · 성공하면 시트에서 다시 읽은 값으로 칸이 바뀜 · 실패하면 원래 값 + 이유 한 줄.
 * - 이 서버에서 시트 쓰기가 꺼져 있으면(`writeEnabled` false — 시험 서버) 안내 한 줄 + [저장] 막음.
 * 설정 창과 떼어 쓸 수 있게 부품 하나로 둔다(사용자 결정 1).
 */

type Key = keyof AssetTargetRatio;
/** 화면 순서 — 시트 칸 순서(현금 · 금 · 채권 · 투자)와 다르다. 저장은 이름(key)으로 보내 칸이 섞이지 않는다 */
const ASSET_FIELDS: { key: Key; label: string }[] = [
  { key: "cash", label: "현금" },
  { key: "bond", label: "채권" },
  { key: "gold", label: "금" },
  { key: "invest", label: "주식" },
];
const STOCK_FIELDS: { key: Key; label: string }[] = [
  { key: "core", label: "코어" },
  { key: "satellite", label: "위성" },
];
const ALL = [...ASSET_FIELDS, ...STOCK_FIELDS];

type Texts = Record<Key, string>;
const toTexts = (r: AssetTargetRatio): Texts =>
  Object.fromEntries(
    ALL.map(({ key }) => [key, r[key] == null ? "" : String(r[key])]),
  ) as Texts;
/** 정수 0~100 이면 그 수, 아니면 null */
const intOf = (t: string): number | null =>
  /^\d{1,3}$/.test(t) && Number(t) <= 100 ? Number(t) : null;

function SumLine({ sum, ok }: { sum: number | null; ok: boolean }) {
  if (ok)
    return (
      <span
        className="inline-flex items-center gap-1 whitespace-nowrap text-caption text-bullish"
        data-sum-ok
      >
        <Check {...ICON_SM} aria-hidden />합 100%
      </span>
    );
  return (
    <span className="whitespace-nowrap text-caption text-warning" data-sum-bad>
      {sum == null
        ? "0~100 정수만 넣을 수 있습니다"
        : `합 ${sum}% — 100이 되어야 저장`}
    </span>
  );
}

function FieldGroup({
  title,
  fields,
  texts,
  onText,
  disabled,
  firstRef,
}: {
  title: string;
  fields: { key: Key; label: string }[];
  texts: Texts;
  onText: (k: Key, v: string) => void;
  disabled: boolean;
  firstRef?: React.Ref<HTMLInputElement>;
}) {
  const nums = fields.map(({ key }) => intOf(texts[key]));
  const sum = nums.every((n) => n != null)
    ? nums.reduce<number>((a, n) => a + (n ?? 0), 0)
    : null;
  return (
    <div className="min-w-0 space-y-1" data-ratio-group={title}>
      <div className="flex min-w-0 items-center gap-x-4">
        <span className="w-16 shrink-0 text-xs text-text-secondary">
          {title}
        </span>
        {fields.map(({ key, label }, i) => (
          <label
            key={key}
            className="inline-flex items-center gap-1.5 text-xs text-text-primary"
          >
            <span className="whitespace-nowrap">{label}</span>
            <NumberField
              ref={i === 0 ? firstRef : undefined}
              size="sm"
              kind="short"
              unit="%"
              unitW="sm"
              inputMode="numeric"
              aria-label={`목표 비율 ${label}`}
              data-ratio={key}
              value={texts[key]}
              invalid={intOf(texts[key]) == null}
              disabled={disabled}
              onChange={(e) =>
                onText(key, e.target.value.replace(/[^\d]/g, "").slice(0, 3))
              }
            />
          </label>
        ))}
      </div>
      <div className="pl-20">
        <SumLine sum={sum} ok={sum === 100} />
      </div>
    </div>
  );
}

export default function AssetTargetRatioForm({
  initial,
  writeEnabled,
  onSave,
  autoFocus = false,
}: {
  /** 시트에서 읽은 목표 비율(백분율) */
  initial: AssetTargetRatio;
  writeEnabled: boolean;
  /** 저장 — 성공이면 시트에서 다시 읽은 목표 비율, 실패면 이유 */
  onSave: (
    ratio: Record<Key, number>,
  ) => Promise<
    { ok: true; ratio: AssetTargetRatio } | { ok: false; error: string }
  >;
  /** [목표 비율 바꾸기] 로 열면 첫 칸에 초점 */
  autoFocus?: boolean;
}) {
  const [saved, setSaved] = useState<AssetTargetRatio>(initial);
  const [texts, setTexts] = useState<Texts>(() => toTexts(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    boxRef.current?.scrollIntoView({ block: "center" });
    firstRef.current?.focus();
  }, [autoFocus]);

  const nums = Object.fromEntries(
    ALL.map(({ key }) => [key, intOf(texts[key])]),
  ) as Record<Key, number | null>;
  const sumOf = (fs: { key: Key }[]) =>
    fs.reduce((a, { key }) => a + (nums[key] ?? Number.NaN), 0);
  const valid =
    ALL.every(({ key }) => nums[key] != null) &&
    sumOf(ASSET_FIELDS) === 100 &&
    sumOf(STOCK_FIELDS) === 100;
  const changed = ALL.some(({ key }) => texts[key] !== toTexts(saved)[key]);

  const save = async () => {
    if (!valid || busy || !writeEnabled) return;
    setBusy(true);
    setError(null);
    setDone(false);
    const r = await onSave(nums as Record<Key, number>);
    setBusy(false);
    if (r.ok) {
      setSaved(r.ratio);
      setTexts(toTexts(r.ratio));
      setDone(true);
    } else {
      setTexts(toTexts(saved));
      setError(`저장하지 못했습니다 — ${r.error}`);
    }
  };

  return (
    <div ref={boxRef} className="space-y-2" data-setting="target-ratio">
      <FieldGroup
        title="자산"
        fields={ASSET_FIELDS}
        texts={texts}
        onText={(k, v) => (setTexts((t) => ({ ...t, [k]: v })), setDone(false))}
        disabled={busy}
        firstRef={firstRef}
      />
      <FieldGroup
        title="주식 안"
        fields={STOCK_FIELDS}
        texts={texts}
        onText={(k, v) => (setTexts((t) => ({ ...t, [k]: v })), setDone(false))}
        disabled={busy}
      />
      <div className="flex min-w-0 items-center gap-3">
        <Button
          size="sm"
          variant="primary"
          busy={busy}
          disabled={!valid || !writeEnabled}
          onClick={() => void save()}
          data-save-target
        >
          저장
        </Button>
        {!writeEnabled && (
          <span className="text-caption text-warning keep-all">
            이 서버에서는 시트 쓰기가 꺼져 있습니다.
          </span>
        )}
        {writeEnabled && done && !changed && (
          <span className="text-caption text-text-muted">
            시트에 저장했습니다.
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger keep-all">
          {error}
        </p>
      )}
    </div>
  );
}
