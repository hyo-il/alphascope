import { useState } from 'react';
import { Button } from '../ui';
import { saveClock } from '../../hooks/useClockSetting';
import { toast } from '../../store/uiStore';
import { DEFAULT_CLOCK } from '../../types/clock';

/**
 * 「설정 > 앱 기능 설정」 의 「시계 위치 초기화」 — 떠 있는 한국 시간 시계(`common/KstClock`)를 기본 자리 · 고정 풀림으로(서버 저장).
 * 시계가 화면 밖에 걸려 못 찾을 때 쓴다. 저장에 실패하면 `saveClock` 이 오류 토스트를 띄운다(화면의 시계는 기본 자리로 옮겨 둔다).
 */
export default function ClockResetSetting() {
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    setBusy(true);
    try {
      if (await saveClock(DEFAULT_CLOCK)) toast.success('시계를 기본 자리로 옮겼습니다');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1.5">
      <Button variant="secondary" size="md" busy={busy} onClick={() => void reset()}>
        시계 위치 초기화
      </Button>
      <p className="text-caption text-text-muted">한국 시간 시계를 기본 자리(화면 오른쪽 위)에 두고 고정을 풉니다.</p>
    </div>
  );
}
