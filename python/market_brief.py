"""
오늘 시황(탐색 → 오늘 시황, v2.59.0) — 시장 데이터 13종 + VIX · 실적 전망치 4종.

Stockproject(`stock_analyzer.py` · `earnings_collector.py`)의 시황 브리핑을 **같은 티커 · 같은 계산**으로 옮겼다(코드를 부르지 않고 다시 지었다).
- 값 하나 = {current, change, change_pct, data_date} — 마지막 두 종가로 낸다(원본과 같음). 받지 못한 항목은 빠진다.
- yfinance 는 모두 스레드 시간 제한(`fundamentals.yf_history_safe` · `_call_with_timeout`)을 지난다.
- 미국 2년물 금리는 yfinance 에 티커가 없어 미국 재무부 일별 국채 수익률 곡선(Par Yield Curve) XML 의 BC_2YEAR 에서 받는다(15초 제한 · 단위 % · 날짜 = 미국 거래일).
  연준 H.15 의 2년 만기 고정 수익률과 같은 숫자다.
  받기는 「후보 목록(`US2Y_SOURCES`) + 차례로 시도」 모양 그대로 둔다(지금 항목 1개) — 수집 상태 · 점검 명령이 쓴 출처 이름을 같은 모양으로 읽는다.
  yfinance `2YY=F`(2년 금리 선물)는 만기 · 거래소 · 값이 달라 후보에서 뺐다(v2.59.6 — 10-27~29 4.75 고정 · 재무부 4.61).
- 코스피 · 코스닥 · S&P 500 · 나스닥 · 다우 · VIX 는 시황 바와 같은 받기(`yf_history_safe`, 같은 기간 · 60초 캐시)를 쓴다.
  원본은 코스피 · 코스닥을 FinanceDataReader 로 받았다 — 이 엔진에는 없어 시황 바와 같은 yfinance `^KS11` · `^KQ11` 로 받는다.
- 판단 · 주문에 쓰지 않는다. 서버(`server/marketBrief/`)가 받아 Gemini 입력과 화면에 쓴다.
"""

from __future__ import annotations

import concurrent.futures
import math
import re
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import yfinance as yf

from fundamentals import INDEX_HISTORY_PERIOD, market_timezone, to_yf_symbols, yf_history_safe

KST = ZoneInfo("Asia/Seoul")

# (키, yfinance 티커, 기간, 소수 자릿수) — 원본 collect_morning_stocks 의 티커 그대로.
# 시황 바와 겹치는 지수는 시황 바와 같은 기간(INDEX_HISTORY_PERIOD)으로 받아 캐시를 함께 쓴다. 나머지는 원본처럼 5일.
_INDEX_ASSETS = [
    ("KOSPI", "^KS11", INDEX_HISTORY_PERIOD, 2),
    ("KOSDAQ", "^KQ11", INDEX_HISTORY_PERIOD, 2),
    ("SP500", "^GSPC", INDEX_HISTORY_PERIOD, 2),
    ("NASDAQ", "^IXIC", INDEX_HISTORY_PERIOD, 2),
    ("DOW", "^DJI", INDEX_HISTORY_PERIOD, 2),
    # 러셀도 지수 흐름(5 · 20거래일)을 내려고 같은 기간으로 받는다(v2.60.0 — 시황 바에는 러셀이 없어 캐시 영향 없음)
    ("RUSSELL2000", "^RUT", INDEX_HISTORY_PERIOD, 2),
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
# 미국 지수 선물(v2.60.0) — 밤사이 흐름. CME E-mini S&P 500(ES) · E-mini Nasdaq-100(NQ) 근월물(yfinance 연속 티커).
# 값 = 마지막 일봉(지금 거래 중인 세션이면 그 순간 값) · 바뀐 만큼 = 직전 세션 종가(정산 기준) 대비. 받은 시각은 응답 fetchedAt.
_FUTURES = [
    ("ES", "ES=F", "5d", 2),
    ("NQ", "NQ=F", "5d", 2),
]
# 흐름(5 · 20거래일)을 붙이는 지수
TREND_DAYS = (5, 20)

TREASURY_TIMEOUT_SEC = 15
# 미국 재무부 일별 국채 수익률(Par Yield Curve) XML — 공식 안내 https://home.treasury.gov/treasury-daily-interest-rate-xml-feed
# 달(YYYYMM)마다 한 묶음. 값 칸 BC_2YEAR(%) · 날짜 칸 NEW_DATE(미국 날짜)
TREASURY_URL = (
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml"
    "?data=daily_treasury_yield_curve&field_tdr_date_value_month={month}"
)
NY = ZoneInfo("America/New_York")

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
    out = {
        "current": round(current, decimals),
        "change": change,
        "change_pct": change_pct,
        "data_date": last_day.isoformat() if last_day else None,
    }
    trend = trend_from_closes(values)
    if trend:
        out["trend"] = trend
    return out


def trend_from_closes(values: list[float]) -> dict | None:
    """
    최근 흐름(%) — 마지막 값 ÷ N거래일 전 종가 − 1 (N = 5 · 20). 봉이 모자라면 그 칸은 None, 둘 다 모자라면 None(칸을 붙이지 않는다).
    마지막 값은 등락률과 같은 값(장중이면 장중 값 — 서버 · 화면이 「장중」 을 붙인다).
    """
    out = {}
    for n in TREND_DAYS:
        base = values[-1 - n] if len(values) > n else None
        out[f"d{n}"] = round((values[-1] / base - 1) * 100, 2) if base else None
    return out if any(v is not None for v in out.values()) else None


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


def _rate_from_rows(rows: list[tuple[str, float]]) -> dict | None:
    """(날짜, 값) 줄 → 마지막 두 날의 값(금리 — 소수 4자리). 같은 날짜가 겹치면 하나만. 두 날이 안 되면 None"""
    by_day = dict(sorted(rows, key=lambda r: r[0]))
    days = sorted(by_day)
    if len(days) < 2:
        return None
    current, previous = by_day[days[-1]], by_day[days[-2]]
    change = round(current - previous, 4)
    return {
        "current": round(current, 4),
        "change": change,
        "change_pct": round((change / previous) * 100, 2) if previous != 0 else 0.0,
        "data_date": days[-1],
    }


def _http_get(url: str, timeout: float) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (AlphaScope personal use)"})
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - 고정 주소
        return response.read().decode("utf-8", errors="replace")


def parse_treasury_xml(text: str) -> dict | None:
    """재무부 XML → US2Y 값. 줄(m:properties)마다 NEW_DATE · BC_2YEAR 를 짝지어 읽는다(값이 빈 줄은 뺀다)"""
    rows = []
    for block in re.findall(r"<m:properties>(.*?)</m:properties>", text, re.S):
        day = re.search(r"<d:NEW_DATE[^>]*>(\d{4}-\d{2}-\d{2})", block)
        value = re.search(r"<d:BC_2YEAR[^>]*>([^<]+)</d:BC_2YEAR>", block)
        if not day or not value:
            continue
        try:
            rows.append((day.group(1), float(value.group(1))))
        except ValueError:
            continue
    return _rate_from_rows(rows)


def fetch_treasury_xml(now: datetime | None = None, get=_http_get) -> str:
    """이번 달(미국 날짜) — 달 초라 두 날이 안 되면 지난달도 붙인다"""
    today = (now or datetime.now(NY)).astimezone(NY).date()
    text = get(TREASURY_URL.format(month=today.strftime("%Y%m")), TREASURY_TIMEOUT_SEC)
    if parse_treasury_xml(text) is None:
        prev = today.replace(day=1) - timedelta(days=1)
        text = get(TREASURY_URL.format(month=prev.strftime("%Y%m")), TREASURY_TIMEOUT_SEC) + text
    return text


# 미2년물 출처 — 앞에서부터 차례로(첫 성공을 쓴다). (화면 이름, 받기, 풀기). 오라클 확인: `npm run -s marketbrief:sources`
# 지금은 재무부 하나(v2.59.7). 다른 출처가 생기면 이 목록에 한 줄 더한다.
US2Y_SOURCES = [
    ("미국 재무부", lambda: fetch_treasury_xml(), parse_treasury_xml),
]


def fetch_us2y(sources=None) -> tuple[dict | None, dict]:
    """후보를 차례로 — (값, {"used": 쓴 후보 이름 | None, "tried": [{source, ok, error}]})"""
    tried = []
    for label, fetch, parse in sources if sources is not None else US2Y_SOURCES:
        try:
            value = parse(fetch())
            error = None if value else "값 두 날이 안 됨"
        except Exception as e:  # noqa: BLE001 - 시간 초과 · 막힘 — 다음 후보로
            value, error = None, (str(e) or type(e).__name__)[:120]
        tried.append({"source": label, "ok": bool(value), "error": error})
        if value:
            return value, {"used": label, "tried": tried}
    return None, {"used": None, "tried": tried}


def check_us2y_sources(sources=None) -> list[dict]:
    """점검 명령용 — 후보마다 1번씩(성공해도 다음 후보까지). HTTP 코드 · 걸린 시간 · 값"""
    out = []
    for label, fetch, parse in sources if sources is not None else US2Y_SOURCES:
        started = time.time()
        code, value, error = None, None, None
        try:
            value = parse(fetch())
            code = 200
            if not value:
                error = "값 두 날이 안 됨"
        except urllib.error.HTTPError as e:
            code, error = e.code, str(e)
        except Exception as e:  # noqa: BLE001
            error = (str(e) or type(e).__name__)[:120]
        out.append({"source": label, "status": code, "ms": int((time.time() - started) * 1000), "value": value, "error": error})
    return out


def collect_market_data(edition: str, history=_from_history, us2y=fetch_us2y) -> dict:
    """
    오전판(morning) = 13종 + 미국 지수 선물 2 · 오후판(afternoon) = 코스피 · 코스닥 · S&P500 · 나스닥 · VIX + 선물 2
    (원본 collect_morning_stocks · collect_afternoon_stocks 에 v2.60.0 이 선물 · 오후판 미국 지수를 더했다).
    돌려주는 값: {"assets": {키: 값}, "failed": [받지 못한 키], "sources": {"US2Y": 쓴 후보 · 시도}}. 시험이 history · us2y 를 바꿔 끼운다.
    """
    if edition == "afternoon":
        # 오후판은 「오늘 밤 미국」 예상을 쓴다 — 미국 마지막 종가(S&P500 · 나스닥)와 선물도 받는다(v2.60.0)
        plan = [_INDEX_ASSETS[0], _INDEX_ASSETS[1], _INDEX_ASSETS[2], _INDEX_ASSETS[3], _VIX, *_FUTURES]
        want_us2y = False
    else:
        plan = [*_INDEX_ASSETS, *_MACRO_ASSETS, *_FUTURES]
        want_us2y = True

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
    sources: dict = {}
    if want_us2y:
        value, sources["US2Y"] = us2y()
        if value:
            assets["US2Y"] = value
        else:
            failed.append("US2Y")
    return {"assets": assets, "failed": failed, "sources": sources}


# 채점용 일봉(v2.60.0) — 오늘 시황 「오늘 예상 방향」 의 실제 결과(정규장 종가 ÷ 전일 정규장 종가 − 1). 시장 데이터와 같은 받기 · 같은 티커
SCORE_TICKERS = {"KOSPI": "^KS11", "SP500": "^GSPC"}


def index_closes(keys: list[str], history=None) -> dict:
    """{키: [{date, close}, …]}(오래된 것부터 · 그 시장 날짜) — 받지 못하면 그 키는 빈 목록. 봉이 끝났는지는 서버가 시각으로 가린다"""
    out: dict = {}
    for key in keys:
        ticker = SCORE_TICKERS.get(key)
        if not ticker:
            continue
        frame = (history or yf_history_safe)(ticker, INDEX_HISTORY_PERIOD)
        rows = []
        if frame is not None and not frame.empty and "Close" in frame:
            frame = frame[frame["Close"].notna()]
            for idx, close in zip(frame.index, frame["Close"]):
                rows.append({"date": idx.date().isoformat() if hasattr(idx, "date") else str(idx)[:10], "close": float(close)})
        out[key] = rows
    return out


def get_market_brief_data(edition: str) -> dict:
    """라우트용 — 10분 캐시(판별로). fetchedAt = 실제로 받은 시각(ms) — 캐시 값이면 그때 시각(장중/종가 판단에 쓴다)"""
    now = time.time()
    hit = _data_cache.get(edition)
    if hit is not None and now - hit[0] < _DATA_TTL_SEC:
        return hit[1]
    data = {**collect_market_data(edition), "fetchedAt": int(now * 1000)}
    # 빠진 항목이 있으면 캐시하지 않는다 — 10분 안에 다시 눌러도 빠진 값을 다시 받아 본다
    if data["assets"] and not data["failed"]:
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


def eps_from_earnings_dates(frame, today: date, tz=KST) -> dict:
    """
    earnings_dates 표 → 다가오는 예상 EPS · 직전 분기 실제 EPS · 4분기 전(전년 동기) 실제 EPS.
    - 날짜는 **그 종목 시장 시간대(tz)로 바꾼 뒤** 잡는다(원본 주의사항 28 의 뜻 — 시간대를 바꾼 뒤 날짜). 원본은 모두 한국 시간이었다 —
      미국 장 뒤 발표가 한국 다음 날로 넘어가 실적 달력(미국 날짜 · `fundamentals.earnings_date`)과 하루 어긋났다(v2.59.2).
    - today 도 같은 시간대의 오늘이어야 한다(`_estimates_one` 이 종목마다 낸다).
    - 예상 EPS = 아직 발표 안 한 줄(Reported EPS 비어 있음) 가운데 오늘 이후 가장 가까운 줄.
    """
    out = {"epsEstimate": None, "lastQuarterEps": None, "yearAgoEps": None}
    if frame is None or frame.empty or "Reported EPS" not in frame:
        return out
    frame = frame.copy()
    if getattr(frame.index, "tz", None) is not None:
        frame.index = frame.index.tz_convert(tz).tz_localize(None)
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


def _estimates_one(symbol: str, now: datetime | None = None) -> dict:
    """한 종목 — 「오늘」 은 같은 순간(now)을 그 종목 시장 시간대로 바꾼 날짜(국내 한국 · 미국 동부 — 실적 달력과 같은 기준)"""
    tz = market_timezone(symbol)
    today = (now or datetime.now(tz)).astimezone(tz).date()
    result = {"symbol": symbol, "ok": False}
    for candidate in to_yf_symbols(symbol):
        dates = _call_with_timeout(lambda c=candidate: yf.Ticker(c).earnings_dates)
        if dates is None or getattr(dates, "empty", True):
            continue
        ticker = yf.Ticker(candidate)
        result.update(eps_from_earnings_dates(dates, today, tz))
        result.update(revenue_from_estimate(_call_with_timeout(lambda: ticker.revenue_estimate)))
        result["recommendation"] = recommendation_counts(_call_with_timeout(lambda: ticker.recommendations))
        result.update(calendar_eps(_call_with_timeout(lambda: ticker.calendar)))
        result["ok"] = True
        break
    return result


def get_earnings_estimates(symbols: list[str]) -> list[dict]:
    """종목 묶음(최대 10)의 전망치 — 4개씩 나란히. 한 종목 실패는 ok=false 로 돌려준다"""
    instant = datetime.now(KST)  # 같은 순간 — 종목마다 그 시장의 오늘로 바꾼다
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
            for symbol, value in zip(todo, pool.map(lambda s: _estimates_one(s, instant), todo)):
                out[symbol] = value
                if value.get("ok"):
                    _estimate_cache[symbol] = (now, value)
    return [out[s] for s in symbols]


if __name__ == "__main__":
    # 점검 명령(`npm run -s marketbrief:sources`)이 부른다 — 미2년물 후보를 1번씩 열어 JSON 한 줄. DB · Gemini 없음
    import json
    import sys

    if sys.argv[1:] == ["--check-us2y"]:
        print(json.dumps(check_us2y_sources(), ensure_ascii=False))
