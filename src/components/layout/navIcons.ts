import { House, CalendarDays, Sigma, ChartCandlestick, Compass, FlaskConical, LogOut, Settings, Wallet } from 'lucide-react';
import type { NavIconKey } from '../../types/nav';

/**
 * 사이드 메뉴 아이콘 (v2.36.0) — 예전 이모지(🧭📊📅🔍🧪💼⚙️·⎋)를 lucide 선 아이콘으로. 펼친 메뉴·접힌 메뉴·플라이아웃이 같은 것을 쓴다.
 */
export const NAV_ICON: Record<NavIconKey, typeof Compass> = {
  home: House,
  explore: Compass,
  chart: ChartCandlestick,
  calendar: CalendarDays,
  // 퀀트 (v2.43.0) — 매수 조건 점수의 「합계」. 차트·전구·플라스크와 겹치지 않는 모양
  quant: Sigma,
  lab: FlaskConical,
  account: Wallet,
  settings: Settings,
};
export const LOGOUT_ICON = LogOut;
