import { LoaderCircle } from 'lucide-react';
import type { AutoTradeView } from '../../utils/autoTradeStatus';
import { AUTO_TRADE_ICON } from './statusIcons';
import { ICON_SM } from './icon';

/**
 * 자동매매 상태 아이콘 (v2.36.0) — 예전 글자 기호 ●◐⚠○ 를 대신한다. **모양이 상태마다 다르다**(색만으로 구분하지 않는다).
 * 처리 중이면 도는 원. 깜빡임은 가동 중에만(`motion-safe`). 색은 부르는 쪽이 `AUTO_TRADE_TONE` 으로 준다.
 */
export default function AutoTradeIcon({ view }: { view: Pick<AutoTradeView, 'state' | 'busy'> }) {
  if (view.busy) return <LoaderCircle {...ICON_SM} className="motion-safe:animate-spin" />;
  const Icon = AUTO_TRADE_ICON[view.state];
  return <Icon {...ICON_SM} className={view.state === 'running' ? 'motion-safe:animate-pulse' : undefined} />;
}
