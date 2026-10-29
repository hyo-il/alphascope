"""
오늘 시황(탐색 → 오늘 시황, v2.59.0) — 시장 데이터 13종 + VIX · 실적 전망치 4종.

Stockproject(`stock_analyzer.py` · `earnings_collector.py`)의 시황 브리핑을 **같은 티커 · 같은 계산**으로 옮겼다(코드를 부르지 않고 다시 지었다).
- 값 하나 = {current, change, change_pct, data_date} — 마지막 두 종가로 낸다(원본과 같음). 받지 못한 항목은 빠진다.
- yfinance 는 모두 스레드 시간 제한(`fundamentals.yf_history_safe` · `_call_with_timeout`)을 지난다.
- 미국 2년물 금리는 yfinance 에 티커가 없어 FRED(DGS2, 최근 30일만 · 15초 제한)에서 받는다.
- 코스피 · 코스닥 · S&P 500 · 나스닥 · 다우 · VIX 는 시황 바와 같은 받기(`yf_history_safe`, 같은 기간 · 60초 캐시)를 쓴다.
  원본은 코스피 · 코스닥을 FinanceDataReader 로 받았다 — 이 엔진에는 없어 시황 바와 같은 yfinance `^KS11` · `^KQ11` 로 받는다.
- 판단 · 주문에 쓰지 않는다. 서버(`server/marketBrief/`)가 받아 Gemini 입력과 화면에 쓴다.
"""

from __future__ import annotations

import concurrent.futures
import csv
import io
import math
import re
import time
import urllib.request
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import yfinance as yf

from fundamentals import INDEX_HISTORY_PERIOD, to_yf_symbols, yf_history_safe

KST = ZoneInfo("Asia/Seoul")

# (키, yfinance 티커, 기간, 소수 자릿수) — 원본 collect_morning_stocks 의 티커 그대로.
# 시황 바와 겹치는 지수는 시황 바와 같은 기간(INDEX_HISTORY_PERIOD)으로 받아 캐시를 함께 쓴다. 나머지는 원본처럼 5일.
_INDEX_ASSETS = [
    ("KOSPI", "^KS11", INDEX_HISTORY_PERIOD, 2),
    ("KOSDAQ", "^KQ11", INDEX_HISTORY_PERIOD, 2),
    ("SP500", "^GSPC", INDEX_HISTORY_PERIOD, 2),
    ("NASDAQ", "^IXIC", INDEX_HISTORY_PERIOD, 2),
    ("DOW", "^DJI", INDEX_HISTORY_PERIOD, 2),
    ("RUSSELL2000", "^RUT", "5d", 2),
]
_MACRO_ASSETS = [
    ("GOLD", "GC=F", "5d", 4),       # 금 선물
    ("DXY", "DX-Y.NYB", "5d", 4),    # 달러인덱스
    ("US10Y", "^TNX", "5d", 4),      # 미국 10년물 국채 수익률(%)
    ("USDKRW", "USDKRW=X", "5d", 4), # 원/달러 환율
    ("WTI", "CL=F", "5d", 4),        # WTI 원유 선물
    ("NATGAS", "NG=F", "5d", 4),     # 천연가스 선물
]
_VIX = ("VIX", "^VIX", INDEX_HISTORY_PERIOD, 2)

FRED_TIMEOUT_SEC = 15
_FRED_DAYS = 30

# 브리핑 한 번에 한 번 받으면 된다 — 버튼을 잇달아 눌러도(하루 5번) 10분 안이면 다시 받지 않는다.
# 장중(오후판 코스피)은 10분 사이 값이 바뀌지만, 브리핑은 그 시각의 사진이라 10분 차이는 문제가 아니다.
_DATA_TTL_SEC = 600
_data_cache: dict = {}


def summarize_closes(closes: list[float], last_day: date | None, decimals: int) -> dict | None:
    """마지막 두 종가 → {current, change, change_pct, data_date}. 두 개가 안 되면 None (원본: 데이터 부족이면 빠진다)."""
    values = [float(v) for v in closes if v is not None and not (isinstance(v, float) and math.isnan(v))]
    if len(values) < 2:
        return None
    current, previous = values[-1], values[-2]
    change = round(current - previous, decimals)
    change_pct = round((change / previous) * 100, 2) if previous != 0 else 0.0
    return {
        "current": round(current, decimals),
        "change": change,
        "change_pct": change_pct,
        "data_date": last_day.isoformat() if last_day else None,
    }


def _from_history(ticker: str, period: str, decimals: int) -> dict | None:
    frame = yf_history_safe(ticker, period)
    if frame is None or frame.empty or "Close" not in frame:
        return None
    frame = frame[frame["Close"].notna()]
    if len(frame) < 2:
        return None
    last = frame.index[-1]
    last_day = last.date() if hasattr(last, "date") else None
    return summarize_closes(list(frame["Close"]), last_day, decimals)


def parse_fred_csv(text: str) -> dict | None:
    """
    FRED fredgraph.csv → US2Y 값. 날짜(YYYY-MM-DD) 줄 가운데 값이 숫자인 줄만(휴일 "." · 빈 값 · 머리글 제외).
    머리글 이름(DATE · observation_date)에 기대지 않는다 — 머리글이 바뀌면 원본 거르기로는 머리글 줄이 값으로 들어갔다.
    """
    rows = []
    for row in csv.reader(io.StringIO(text)):
        if len(row) != 2 or not re.match(r"^\d{4}-\d{2}-\d{2}$", row[0].strip()):
            continue
        try:
            rows.append((row[0].strip(), float(row[1].strip())))
        except ValueError:
            continue
    rows.sort(key=lambda r: r[0])
    if len(rows) < 2:
        return None
    current, previous = rows[-1][1], rows[-2][1]
    change = round(current - previous, 4)
    return {
        "current": round(current, 4),
        "change": change,
        "change_pct": round((change / previous) * 100, 2) if previous != 0 else 0.0,
        "data_date": rows[-1][0],
    }


def fetch_fred_csv(now: datetime | None = None) -> str:
    """최근 30일만(cosd) — 전체 시계열(1976년~)을 받으면 시간 제한에 자주 걸렸다(원본 주의사항 33)."""
    start = ((now or datetime.now(KST)) - timedelta(days=_FRED_DAYS)).strftime("%Y-%m-%d")
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS2&cosd={start}"
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=FRED_TIMEOUT_SEC) as response:  # noqa: S310 - 고정 주소
        return response.read().decode("utf-8", errors="replace")


def collect_market_data(edition: str, history=_from_history, fred=fetch_fred_csv) -> dict:
    """
    오전판(morning) = 13종 · 오후판(afternoon) = 코스피 · 코스닥 · VIX (원본 collect_morning_stocks · collect_afternoon_stocks).
    돌려주는 값: {"assets": {키: 값}, "failed": [받지 못한 키]}. 시험이 history · fred 를 바꿔 끼운다.
    """
    if edition == "afternoon":
        plan = [_INDEX_ASSETS[0], _INDEX_ASSETS[1], _VIX]
        want_fred = False
    else:
        plan = [*_INDEX_ASSETS, *_MACRO_ASSETS]
        want_fred = True

    assets: dict = {}
    failed: list[str] = []
    for key, ticker, period, decimals in plan:
        try:
            value = history(ticker, period, decimals)
        except Exception:  # noqa: BLE001 - 그 항목만 빠진다
            value = None
        if value:
            assets[key] = value
        else:
            failed.append(key)
    if want_fred:
        try:
            value = parse_fred_csv(fred())
        except Exception:  # noqa: BLE001 - 시간 초과 · 막힘 — 그 항목만 빠진다
            value = None
        if value:
            assets["US2Y"] = value
        else:
            failed.append("US2Y")
    return {"assets": assets, "failed": failed}


def get_market_brief_data(edition: str) -> dict:
    """라우트용 — 10분 캐시(판별로)"""
    now = time.time()
    hit = _data_cache.get(edition)
    if hit is not None and now - hit[0] < _DATA_TTL_SEC:
        return hit[1]
    data = collect_market_data(edition)
    if data["assets"]:
        _data_cache[edition] = (now, data)
    return data


# ─────────────────────────────────────────────────────────────────────────────
# 실적 전망치 — 60일 안에 실적이 있는 종목만(원본 2단계 구조의 2단계). 실적일 자체는 서버 `earningsCalendar.ts` 한 곳에서 온다.
# 원본 _yf_revenue_estimate_safe · _yf_earnings_history_safe · _yf_recommendations_safe · _yf_calendar_safe 에 해당한다.
# 원본은 earnings_dates 를 두 번(1단계 · 직전 분기) 받았다 — 여기서는 한 번 받아 예상 EPS 와 지난 EPS 를 함께 꺼낸다.
# sanity 규칙 · 표기는 서버(`server/marketBrief/earnings.ts`)가 한다(숫자를 그대로 넘긴다).
# ─────────────────────────────────────────────────────────────────────────────

_PER_CALL_TIMEOUT = 10.0
# 전망치는 하루에 크게 바뀌지 않는다 — 버튼을 다시 눌러도 6시간 안이면 다시 받지 않는다(yfinance 를 몰아 치지 않게)
_ESTIMATE_TTL_SEC = 6 * 3600
_estimate_cache: dict = {}
_ESTIMATE_WORKERS = 4


def _call_with_timeout(fn, timeout: float = _PER_CALL_TIMEOUT):
    """원본 `_yf_*_safe` 와 같은 스레드 시간 제한. 실패 · 시간 초과는 None."""
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    try:
        return pool.submit(fn).result(timeout=timeout)
    except Exception:  # noqa: BLE001
        return None
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


def _num(value) -> float | None:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(v) or math.isinf(v) else v


def eps_from_earnings_dates(frame, today: date) -> dict:
    """
    earnings_dates 표 → 다가오는 예상 EPS · 직전 분기 실제 EPS · 4분기 전(전년 동기) 실제 EPS.
    - 날짜는 **한국 시간으로 바꾼 뒤** 잡는다(원본 주의사항 28 — 안 하면 국내 · 미국 저녁 발표가 하루 밀린다).
    - 예상 EPS = 아직 발표 안 한 줄(Reported EPS 비어 있음) 가운데 오늘 이후 가장 가까운 줄.
    """
    out = {"epsEstimate": None, "lastQuarterEps": None, "yearAgoEps": None}
    if frame is None or frame.empty or "Reported EPS" not in frame:
        return out
    frame = frame.copy()
    if getattr(frame.index, "tz", None) is not None:
        frame.index = frame.index.tz_convert(KST).tz_localize(None)
    future = frame[frame["Reported EPS"].isna()]
    future = future[[d.date() >= today for d in future.index]].sort_index()
    if not future.empty and "EPS Estimate" in future:
        out["epsEstimate"] = _num(future.iloc[0]["EPS Estimate"])
    past = frame[frame["Reported EPS"].notna()].sort_index(ascending=False)
    if len(past) >= 1:
        out["lastQuarterEps"] = _num(past.iloc[0]["Reported EPS"])
    if len(past) >= 4:
        out["yearAgoEps"] = _num(past.iloc[3]["Reported EPS"])
    return out


def revenue_from_estimate(frame) -> dict:
    """revenue_estimate 표 → 다음 분기(+1q) 평균 · 전년 동기 매출 (원본과 같음 — +1q 가 없으면 첫 줄)"""
    out = {"revenueAvg": None, "yearAgoRevenue": None}
    if frame is None or frame.empty:
        return out
    row = frame.loc["+1q"] if "+1q" in frame.index else frame.iloc[0]
    out["revenueAvg"] = _num(row.get("avg"))
    out["yearAgoRevenue"] = _num(row.get("yearAgoRevenue"))
    return out


def recommendation_counts(frame) -> dict | None:
    """recommendations 표 → 지금(0m) 등급 수. 원본과 같음"""
    if frame is None or frame.empty:
        return None
    if "period" in frame.columns:
        rows = frame[frame["period"] == "0m"]
        row = rows.iloc[0] if not rows.empty else frame.iloc[0]
    else:
        row = frame.iloc[0]
    return {k: int(_num(row.get(k)) or 0) for k in ("strongBuy", "buy", "hold", "sell", "strongSell")}


def calendar_eps(cal) -> dict:
    """calendar → 예상 EPS 평균 · 최고 · 최저 (분산 계산용). 일부 국내 종목의 Earnings Date 는 오염돼 있어 쓰지 않는다(원본과 같음)"""
    out = {"epsAvg": None, "epsHigh": None, "epsLow": None}
    if not isinstance(cal, dict):
        return out
    out["epsAvg"] = _num(cal.get("Earnings Average"))
    out["epsHigh"] = _num(cal.get("Earnings High"))
    out["epsLow"] = _num(cal.get("Earnings Low"))
    return out


def _estimates_one(symbol: str, today: date) -> dict:
    result = {"symbol": symbol, "ok": False}
    for candidate in to_yf_symbols(symbol):
        dates = _call_with_timeout(lambda c=candidate: yf.Ticker(c).earnings_dates)
        if dates is None or getattr(dates, "empty", True):
            continue
        ticker = yf.Ticker(candidate)
        result.update(eps_from_earnings_dates(dates, today))
        result.update(revenue_from_estimate(_call_with_timeout(lambda: ticker.revenue_estimate)))
        result["recommendation"] = recommendation_counts(_call_with_timeout(lambda: ticker.recommendations))
        result.update(calendar_eps(_call_with_timeout(lambda: ticker.calendar)))
        # 표에 다가오는 예상 EPS 가 없으면 calendar 평균으로 채운다
        if result.get("epsEstimate") is None:
            result["epsEstimate"] = result.get("epsAvg")
        result["ok"] = True
        break
    return result


def get_earnings_estimates(symbols: list[str]) -> list[dict]:
    """종목 묶음(최대 10)의 전망치 — 4개씩 나란히. 한 종목 실패는 ok=false 로 돌려준다"""
    today = datetime.now(KST).date()
    now = time.time()
    out: dict[str, dict] = {}
    todo = []
    for symbol in symbols:
        hit = _estimate_cache.get(symbol)
        if hit is not None and now - hit[0] < _ESTIMATE_TTL_SEC:
            out[symbol] = hit[1]
        else:
            todo.append(symbol)
    if todo:
        with concurrent.futures.ThreadPoolExecutor(max_workers=_ESTIMATE_WORKERS) as pool:
            for symbol, value in zip(todo, pool.map(lambda s: _estimates_one(s, today), todo)):
                out[symbol] = value
                if value.get("ok"):
                    _estimate_cache[symbol] = (now, value)
    return [out[s] for s in symbols]
