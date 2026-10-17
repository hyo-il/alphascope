import { useEffect, useState } from 'react';
import { Segmented } from '../ui';
import { applyRetention, fetchRetention, retentionPreview } from '../../hooks/useBuyJudge';
import { modal, toast } from '../../store/uiStore';
import { RETENTIONS, type Retention } from '../../types/buyJudge';

/**
 * 「설정 > 앱 기능 설정」 의 매수 판단 기록 보관 기간 (사용자 결정 A-9) — 6개월 · 1년 · 2년 · 계속 보관, 기본 1년.
 * 「사도 됨」 기록과 성과는 기간과 상관없이 남는다. 기간을 줄여 지워질 줄이 있으면 확인 창을 띄우고, 확인하면 곧바로 정리한다.
 */
export default function BuyJudgeRetention() {
  const [value, setValue] = useState<Retention | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void fetchRetention()
      .then(setValue)
      .catch((e) => toast.error('보관 기간을 불러오지 못했습니다', (e as Error).message));
  }, []);

  const apply = async (next: Retention) => {
    setBusy(true);
    try {
      const deleted = await applyRetention(next);
      setValue(next);
      toast.success(`보관 기간을 ${RETENTIONS.find((r) => r.id === next)!.label}(으)로 바꿨습니다`, deleted ? `판단 기록 ${deleted}줄을 지웠습니다` : undefined);
    } catch (e) {
      toast.error('보관 기간을 바꾸지 못했습니다', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const change = async (next: Retention) => {
    if (next === value) return;
    setBusy(true);
    let n = 0;
    try {
      n = await retentionPreview(next);
    } catch (e) {
      setBusy(false);
      return toast.error('보관 기간을 바꾸지 못했습니다', (e as Error).message);
    }
    setBusy(false);
    if (!n) return void apply(next);
    modal.confirm({
      title: '보관 기간을 줄이고 판단 기록 삭제',
      message: `보관 기간이 지난 판단 기록 ${n}줄이 삭제됩니다(「사도 됨」 기록은 남습니다). 되돌릴 수 없습니다.`,
      confirmText: '삭제',
      danger: true,
      onConfirm: () => apply(next),
    });
  };

  return (
    <div className="space-y-1.5">
      {value == null ? (
        <p className="text-caption text-text-muted">불러오는 중…</p>
      ) : (
        <Segmented label="매수 판단 기록 보관 기간" value={value} onChange={(v) => void change(v)} options={RETENTIONS.map((r) => ({ value: r.id, label: r.label, disabled: busy }))} />
      )}
      <p className="text-caption text-text-muted">서버가 매일 기록하는 매수 판단 중 「사도 됨」 이 아닌 기록을 이 기간이 지나면 하루 한 번 지웁니다. 「사도 됨」 기록과 그 뒤 성과는 계속 남습니다.</p>
    </div>
  );
}
