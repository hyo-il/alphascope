import { useMemo, useState } from 'react';
import { Button, Dialog, Segmented } from '../ui';
import { Skeleton } from '../common/SkeletonLoader';
import { modal } from '../../store/uiStore';
import { UNASSIGNED_LABEL, type AssetSheetData } from '../../types/asset';
import { CLASS_VALUES, MIXED, changedKeys, classRowsOf, planClassSave, runClassSave, type ClassSendResult, type ClassValue, type GroupValue } from '../../utils/assetClassPlan';

/**
 * 「자산 분류 정하기」 창(v2.65.3 · v2.65.4 종목 코드로 묶기) — 여러 종목의 자산 분류를 한 곳에서 고르고 [저장] 으로 한 번에 시트 「티커」 D열에 쓴다.
 * - 열기: 「자산 현황」 탭 [자산 분류 정하기] · 총 자산 탭 분류별 표 「미지정」 줄의 링크.
 * - 목록: 종목 코드 하나 = 한 줄(같은 코드가 여러 계좌 · 「티커」 여러 줄에 있어도 한 줄 — `classRowsOf`) · 이름 · 「「티커」 n줄」(2줄 이상) · 코드 · 있는 계좌 · [미지정 | 채권 | 금 | 주식].
 *   줄마다 값이 다르면 「줄마다 다름」 + 아무 버튼도 눌리지 않음 · 하나를 누르면 그 코드의 줄 전부 그 값.
 *   「티커」 D칸이 한 줄이라도 수식이면 버튼 대신 「시트에 수식이 있어 여기서 바꿀 수 없음」.
 * - 위: 「미지정만 보기」(이 기기에 기억 · 창을 연 때 미지정이던 줄 — 고르는 중에 줄이 사라지지 않게) · 「미지정 n개 · 바꾼 것 n개」.
 * - [저장]: 바꾼 줄만 값마다 한 요청(`planClassSave` · `runClassSave` — 많아야 4번). 저장 전에는 시트에 쓰지 않는다. 추천(이름으로 짐작)은 없다.
 *   모두 성공 → 창 닫힘 + 다시 읽기 · 일부 실패 → 창 그대로 · 성공한 줄 「저장됨」 · 실패한 줄은 바꾼 상태 그대로 + 이유 한 줄 · 다시 [저장] = 남은 것만.
 * - 바꾼 것이 있는데 [취소] · × · ESC → 확인 창 「바꾼 n개를 저장하지 않고 닫을까요?」 · 바깥 클릭으로 닫지 않는다(고른 것을 잃는다).
 * - 쓰기 스위치가 꺼진 서버 → 「이 서버에서는 시트 쓰기가 꺼져 있습니다」 · [저장] 막음(보기 · 고르기는 됨). 스위치를 아직 모르면(요약 응답 전) 글 없이 [저장] 만 막음.
 * ⚠️ 자산 값은 콘솔 · 로컬 저장소에 남기지 않는다(로컬 저장소에는 「미지정만 보기」 켬/끔만).
 */

const ONLY_KEY = 'alphascope.asset.classOnlyUnassigned';
function readOnly(): boolean {
  try {
    return localStorage.getItem(ONLY_KEY) === '1';
  } catch {
    return false;
  }
}
function saveOnly(on: boolean) {
  try {
    localStorage.setItem(ONLY_KEY, on ? '1' : '0');
  } catch {
    /* 기억하지 못해도 화면은 그대로 */
  }
}

const OPTIONS = CLASS_VALUES.map((v) => ({ value: v as GroupValue, label: v || UNASSIGNED_LABEL }));
/** 저장 중에는 고르지 못하게 */
const OPTIONS_BUSY = OPTIONS.map((o) => ({ ...o, disabled: true }));

export default function AssetClassDialog({
  data,
  loadError,
  onRetryLoad,
  writeEnabled,
  onSend,
  onPartial,
  onSaved,
  onClose,
}: {
  /** 시트 값 — 아직 받지 못했으면 null(뼈대) */
  data: AssetSheetData | null;
  /** 시트 읽기 실패 문구 */
  loadError: string | null;
  onRetryLoad: () => void;
  /** 이 서버에서 시트 쓰기가 켜져 있나 — 아직 모르면 null */
  writeEnabled: boolean | null;
  /** 한 묶음 쓰기(`PUT /api/asset/class`) */
  onSend: (rows: number[], value: ClassValue) => Promise<ClassSendResult>;
  /** 일부만 성공 — 다시 읽은 시트 값(창은 열린 채) */
  onPartial: (data: AssetSheetData) => void;
  /** 모두 성공 — 창을 닫고 다시 읽는다 */
  onSaved: (data: AssetSheetData | null) => void;
  onClose: () => void;
}) {
  const rows = useMemo(() => (data ? classRowsOf(data) : []), [data]);
  /** 창을 연 뒤 처음 받은 값 — 「미지정만 보기」 기준 · 저장 기준(성공한 줄은 바꾼 값으로 옮긴다) */
  const [base, setBase] = useState<Record<string, GroupValue> | null>(null);
  const [initialUnassigned, setInitialUnassigned] = useState<Set<string> | null>(null);
  if (data && base == null) {
    setBase(Object.fromEntries(rows.map((r) => [r.key, r.value])));
    setInitialUnassigned(new Set(rows.filter((r) => r.value === '').map((r) => r.key)));
  }
  const [draft, setDraft] = useState<Record<string, ClassValue>>({});
  const [only, setOnly] = useState(readOnly);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [failedKeys, setFailedKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const b = base ?? {};
  const valueOf = (key: string): GroupValue => draft[key] ?? b[key] ?? '';
  const changed = changedKeys(rows, b, draft);
  const unassigned = rows.filter((r) => valueOf(r.key) === '').length;
  const shown = only ? rows.filter((r) => initialUnassigned?.has(r.key)) : rows;
  const canSave = writeEnabled === true && changed.length > 0 && !busy;

  const pick = (key: string, v: ClassValue) => {
    setDraft((d) => ({ ...d, [key]: v }));
    setSaved((s) => {
      if (!s.has(key)) return s;
      const n = new Set(s);
      n.delete(key);
      return n;
    });
  };

  const save = async () => {
    if (!canSave || base == null) return;
    setBusy(true);
    setError(null);
    setFailedKeys(new Set());
    const out = await runClassSave(planClassSave(rows, base, draft), onSend);
    setBusy(false);
    if (out.failed.length === 0) {
      onSaved(out.data);
      return;
    }
    // 성공한 줄은 기준을 옮겨 「저장됨」 · 실패한 줄은 바꾼 상태 그대로(다시 [저장] = 남은 것만)
    if (out.savedKeys.length > 0) {
      setBase((prev) => ({ ...(prev ?? {}), ...Object.fromEntries(out.savedKeys.map((k) => [k, draft[k] ?? ''])) }));
      setSaved((s) => new Set([...s, ...out.savedKeys]));
      if (out.data) onPartial(out.data);
    }
    const failed = out.failed.flatMap((g) => g.keys);
    setFailedKeys(new Set(failed));
    setError(`${failed.length}개를 시트에 쓰지 못했습니다 — ${out.failed[0].error}`);
  };

  const requestClose = () => {
    if (busy) return;
    if (changed.length === 0) return onClose();
    modal.confirm({
      title: '저장하지 않고 닫기',
      message: `바꾼 ${changed.length}개를 저장하지 않고 닫을까요?`,
      confirmText: '닫기',
      cancelText: '계속 고르기',
      onConfirm: onClose,
    });
  };

  return (
    <Dialog
      title="자산 분류 정하기"
      onClose={requestClose}
      size="lg"
      closeOnBackdrop={false}
      bodyClassName="p-0"
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={requestClose} data-class-cancel>
            취소
          </Button>
          <Button variant="primary" busy={busy} disabled={!canSave} onClick={() => void save()} data-class-save>
            저장
          </Button>
        </>
      }
    >
      <div className="flex min-h-full flex-col" data-class-dialog>
        <div className="sticky top-0 z-10 space-y-2 border-b border-border/40 bg-bg-secondary px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-text-primary">
              <input
                type="checkbox"
                checked={only}
                onChange={(e) => {
                  setOnly(e.target.checked);
                  saveOnly(e.target.checked);
                }}
                data-class-only
              />
              미지정만 보기
            </label>
            {base != null && (
              <span className="ml-auto whitespace-nowrap text-caption text-text-muted tabular-nums" data-class-count>
                미지정 {unassigned}개 · 바꾼 것 {changed.length}개
              </span>
            )}
          </div>
          {writeEnabled === false && (
            <p className="text-caption text-text-muted keep-all" data-class-write-off>
              이 서버에서는 시트 쓰기가 꺼져 있습니다 — 고를 수는 있지만 [저장] 할 수 없습니다.
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-danger/10 px-3 py-1.5 text-xs text-danger keep-all" data-class-error>
              {error}
            </p>
          )}
        </div>
        {data == null && loadError == null && (
          <div className="space-y-2 p-4" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))}
          </div>
        )}
        {data == null && loadError != null && (
          <p role="alert" className="m-4 flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-1.5 text-xs text-danger keep-all">
            {loadError}
            <Button size="sm" onClick={onRetryLoad} className="ml-auto">
              다시 시도
            </Button>
          </p>
        )}
        {data != null && shown.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-text-muted" data-class-empty>
            {only ? '미지정 종목이 없습니다.' : '「티커」 탭과 이어진 종목이 없습니다.'}
          </p>
        )}
        {data != null && shown.length > 0 && (
          <ul className="divide-y divide-border/30">
            {shown.map((r) => {
              const v = valueOf(r.key);
              const isChanged = changed.includes(r.key);
              return (
                <li key={r.key} className="flex flex-col gap-2 px-4 py-2.5 md:flex-row md:items-center md:gap-4" data-class-row={r.rows.join(',')}>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="min-w-0 truncate text-xs text-text-primary" title={r.name}>
                        {r.name}
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-caption text-text-secondary">
                        {r.symbol ?? '—'}
                        {r.exchange && <span className="ml-1 text-text-muted">{r.exchange}</span>}
                      </span>
                      {/* 코드 뒤 — 이름 바로 뒤에 두면 이 줄만 코드가 밀린다(캡처 검토) */}
                      {r.rows.length > 1 && (
                        <span className="shrink-0 whitespace-nowrap text-caption text-text-muted" data-class-row-count>
                          「티커」 {r.rows.length}줄
                        </span>
                      )}
                    </div>
                    <div className="truncate text-caption text-text-muted" title={r.sections.join(' · ')}>
                      {r.sections.join(' · ')}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {saved.has(r.key) && !isChanged && (
                      <span className="whitespace-nowrap text-caption text-text-muted" data-class-saved>
                        저장됨
                      </span>
                    )}
                    {failedKeys.has(r.key) && isChanged && (
                      <span className="whitespace-nowrap text-caption text-danger" data-class-failed>
                        저장 안 됨
                      </span>
                    )}
                    {!r.locked && v === MIXED && (
                      <span className="whitespace-nowrap text-caption text-text-muted" data-class-mixed>
                        줄마다 다름
                      </span>
                    )}
                    {r.locked ? (
                      <span className="whitespace-nowrap text-caption text-text-muted" data-class-locked>
                        시트에 수식이 있어 여기서 바꿀 수 없음
                      </span>
                    ) : (
                      <Segmented<GroupValue> size="sm" label={`${r.name} 자산 분류`} options={busy ? OPTIONS_BUSY : OPTIONS} value={v} onChange={(nv) => nv !== MIXED && pick(r.key, nv)} />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
