import { useState } from 'react';
import { Segmented } from '../ui';
import { InlineSpinner } from '../common/LoadingOverlay';
import { saveHomePage } from '../../hooks/useHomePage';
import { useAppStore } from '../../store/appStore';
import { toast } from '../../store/uiStore';
import { HOME_PAGES, pageMeta, type HomePageId } from '../../types/nav';

/**
 * 「설정 > 앱 기능 설정」 의 홈 화면 — 종목 탐색 · 종목 지도 · 실시간 순위 · 차트(`HOME_PAGES`). 서버 저장.
 * 고르면 바로 저장한다(「매수 판단 기록 보관 기간」 과 같은 모양). 실패하면 이전 값으로 되돌린다.
 * 이름은 메뉴 이름 그대로(`pageMeta(id).label`).
 */
export default function HomePageSetting() {
  const saved = useAppStore((s) => s.homePage);
  const setHomePage = useAppStore((s) => s.setHomePage);
  /** 저장 중에 고른 값 — 성공하면 스토어로, 실패하면 버린다(이전 값으로 돌아간다) */
  const [saving, setSaving] = useState<HomePageId | null>(null);

  const change = async (next: HomePageId) => {
    if (next === saved || saving) return;
    setSaving(next);
    try {
      setHomePage(await saveHomePage(next));
      toast.success(`홈 화면을 ${pageMeta(next)!.label}(으)로 바꿨습니다`);
    } catch (e) {
      toast.error('홈 화면을 바꾸지 못했습니다', (e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const value = saving ?? saved;
  return (
    <div className="space-y-1.5">
      {value == null ? (
        <p className="text-caption text-text-muted">불러오는 중…</p>
      ) : (
        <div className="flex items-center gap-2">
          <Segmented
            label="홈 화면"
            value={value}
            onChange={(v) => void change(v)}
            options={HOME_PAGES.map((id) => ({ value: id, label: pageMeta(id)!.label, disabled: saving != null }))}
          />
          {saving && (
            <span className="flex items-center gap-1.5 text-caption text-text-muted">
              <InlineSpinner /> 저장 중…
            </span>
          )}
        </div>
      )}
      <p className="text-caption text-text-muted">홈 메뉴 · 로고 · 앱을 처음 열 때 이 화면으로 갑니다.</p>
    </div>
  );
}
