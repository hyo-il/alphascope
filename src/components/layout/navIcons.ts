import { CalendarDays, ChartCandlestick, Compass, FlaskConical, Lightbulb, LogOut, Settings, Wallet } from 'lucide-react';
import type { NavIconKey } from '../../types/nav';

/**
 * 사이드 메뉴 아이콘 (v2.36.0) — 예전 이모지(🧭📊📅🔍🧪💼⚙️·⎋)를 lucide 선 아이콘으로. 펼친 메뉴·접힌 메뉴·플라이아웃이 같은 것을 쓴다.
 * 투자 분석은 돋보기·과녁 계열을 피했다(검색·목표 수익 가능성과 헷갈린다) — 「살펴보고 판단한다」 는 뜻으로 전구.
 */
export const NAV_ICON: Record<NavIconKey, typeof Compass> = {
  explore: Compass,
  chart: ChartCandlestick,
  calendar: CalendarDays,
  analysis: Lightbulb,
  lab: FlaskConical,
  account: Wallet,
  settings: Settings,
};
export const LOGOUT_ICON = LogOut;
