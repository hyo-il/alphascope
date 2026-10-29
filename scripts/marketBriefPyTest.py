"""
지표 엔진 계산 시험(오늘 시황 · 실적일 현지 날짜 v2.59.1) — `npm run marketbrief:test` 가 부른다(혼자 돌리지 않는다).
네트워크 0: yfinance · FRED 받기는 모두 가짜로 바꿔 끼운다. 실패하면 종료 코드 1.
"""

import sys
import time
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "python"))

import pandas as pd  # noqa: E402

import fundamentals  # noqa: E402
import market_brief as mb  # noqa: E402

failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    print(("  ok   " if cond else "  FAIL ") + name + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


# 1) 계산 — 원본 stock_analyzer 와 같은 식(마지막 두 종가 · change 반올림 뒤 등락률)
v = mb.summarize_closes([6100.0, 6000.0, 6031.8], date(2026, 10, 28), 2)
check("지수: current · change · change_pct", v == {"current": 6031.8, "change": 31.8, "change_pct": 0.53, "data_date": "2026-10-28"}, str(v))
v = mb.summarize_closes([1385.0, 1391.2345], date(2026, 10, 28), 4)
check("매크로: 소수 4자리", v["current"] == 1391.2345 and v["change"] == 6.2345 and v["change_pct"] == 0.45, str(v))
check("종가 하나면 빠짐", mb.summarize_closes([100.0], None, 2) is None)
check("NaN 은 건너뜀", mb.summarize_closes([100.0, float("nan"), 101.0], None, 2)["change"] == 1.0)

# 2) FRED — 머리글 이름에 기대지 않는다 · "." 휴일 제외 · 날짜순
csv_new = "observation_date,DGS2\n2026-10-24,3.51\n2026-10-27,.\n2026-10-28,3.49\n"
csv_old = "DATE,DGS2\n2026-10-28,3.49\n2026-10-24,3.51\n"
for label, text in (("observation_date 머리글", csv_new), ("DATE 머리글", csv_old)):
    v = mb.parse_fred_csv(text)
    check(f"FRED {label}", v == {"current": 3.49, "change": -0.02, "change_pct": -0.57, "data_date": "2026-10-28"}, str(v))
check("FRED 한 줄이면 빠짐", mb.parse_fred_csv("observation_date,DGS2\n2026-10-28,3.49\n") is None)

captured = {}


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return csv_new.encode()


def fake_urlopen(request, timeout=None):
    captured["url"] = request.full_url
    captured["timeout"] = timeout
    return FakeResponse()


real_urlopen = mb.urllib.request.urlopen
mb.urllib.request.urlopen = fake_urlopen
mb.fetch_fred_csv(datetime(2026, 10, 29, 7, 0, tzinfo=ZoneInfo("Asia/Seoul")))
mb.urllib.request.urlopen = real_urlopen
check("FRED 최근 30일만(cosd)", captured.get("url", "").endswith("id=DGS2&cosd=2026-09-29"), captured.get("url", ""))
check("FRED 15초 제한", captured.get("timeout") == 15)

# 3) 모으기 — 실패 항목은 빠지고 failed 에 남는다
asked = []


def fake_history(ticker, period, decimals):
    asked.append((ticker, period))
    if ticker == "DX-Y.NYB":
        return None
    return mb.summarize_closes([100.0, 101.0], date(2026, 10, 28), decimals)


data = mb.collect_market_data("morning", history=fake_history, fred=lambda: csv_new)
keys = set(data["assets"])
want = {"KOSPI", "KOSDAQ", "SP500", "NASDAQ", "DOW", "RUSSELL2000", "GOLD", "US2Y", "US10Y", "USDKRW", "WTI", "NATGAS"}
check("오전판 13종 중 실패 1(DXY) 빠짐", keys == want and data["failed"] == ["DXY"], f"{sorted(keys)} {data['failed']}")
tickers = dict(asked)
check("원본 티커 그대로", tickers.get("CL=F") and tickers.get("NG=F") and tickers.get("^TNX") and tickers.get("^RUT") and tickers.get("USDKRW=X") and tickers.get("GC=F"))
check("시황 바와 겹치는 지수는 같은 기간(공용 캐시)", tickers["^GSPC"] == fundamentals.INDEX_HISTORY_PERIOD and tickers["^KS11"] == fundamentals.INDEX_HISTORY_PERIOD)
check("오전판에 VIX 없음", "^VIX" not in tickers)

asked.clear()
fred_called = []
data = mb.collect_market_data("afternoon", history=fake_history, fred=lambda: fred_called.append(1) or csv_new)
check("오후판 = 코스피 · 코스닥 · VIX", set(data["assets"]) == {"KOSPI", "KOSDAQ", "VIX"} and not fred_called)


def boom():
    raise TimeoutError("timed out")


data = mb.collect_market_data("morning", history=fake_history, fred=boom)
check("FRED 실패 → US2Y 빠짐", "US2Y" not in data["assets"] and "US2Y" in data["failed"])

# 4) 시간 제한 — 느린 yfinance 를 기다리지 않는다(원본 헬퍼는 with 블록이 스레드를 기다렸다)
real_ticker = fundamentals.yf.Ticker


class SlowTicker:
    def __init__(self, *_):
        pass

    def history(self, **_):
        time.sleep(3)
        return pd.DataFrame({"Close": [1.0, 2.0]})


fundamentals.yf.Ticker = SlowTicker
started = time.time()
frame = fundamentals.yf_history_safe("SLOW", "5d", per_call_timeout=0.3)
elapsed = time.time() - started
fundamentals.yf.Ticker = real_ticker
check("yf_history_safe 시간 제한(0.3초)", frame.empty and elapsed < 1.5, f"{elapsed:.2f}s")

# 5) 전망치 원값 — 한국 시간으로 바꾼 뒤 날짜 · 다가오는 예상 EPS · 직전 · 4분기 전
et = ZoneInfo("America/New_York")
idx = pd.DatetimeIndex(
    [
        datetime(2027, 1, 20, 16, 5, tzinfo=et),   # 다음다음
        datetime(2026, 10, 29, 20, 0, tzinfo=et),  # ET 10/29 저녁 = KST 10/30 09:00 → 오늘(10/30) 이후로 잡혀야
        datetime(2026, 7, 20, 16, 5, tzinfo=et),
        datetime(2026, 4, 20, 16, 5, tzinfo=et),
        datetime(2026, 1, 20, 16, 5, tzinfo=et),
        datetime(2025, 10, 20, 16, 5, tzinfo=et),
    ]
)
frame = pd.DataFrame(
    {"EPS Estimate": [1.9, 1.57, 1.4, 1.3, 1.2, 1.1], "Reported EPS": [None, None, 1.45, 1.35, 1.25, 1.30]},
    index=idx,
)
v = mb.eps_from_earnings_dates(frame, date(2026, 10, 30))
check("예상 EPS = 다가오는 가장 가까운 줄(KST 날짜)", v["epsEstimate"] == 1.57, str(v))
check("직전 분기 · 전년 동기(4분기 전)", v["lastQuarterEps"] == 1.45 and v["yearAgoEps"] == 1.30, str(v))
v = mb.eps_from_earnings_dates(frame, date(2026, 10, 31))
check("KST 로 바꾸지 않으면 놓칠 줄 — 지난 날은 제외", v["epsEstimate"] == 1.9, str(v))

rev = pd.DataFrame({"avg": [10e9, 11.51e9], "yearAgoRevenue": [9e9, 3e9]}, index=["0q", "+1q"])
check("매출 = +1q 줄", mb.revenue_from_estimate(rev) == {"revenueAvg": 11.51e9, "yearAgoRevenue": 3e9})
rec = pd.DataFrame({"period": ["0m", "-1m"], "strongBuy": [10, 9], "buy": [18, 17], "hold": [5, 6], "sell": [1, 1], "strongSell": [1, 0]})
check("컨센서스 = 0m 줄", mb.recommendation_counts(rec) == {"strongBuy": 10, "buy": 18, "hold": 5, "sell": 1, "strongSell": 1})
check("calendar 평균 · 최고 · 최저", mb.calendar_eps({"Earnings Average": 1.5, "Earnings High": 2.0, "Earnings Low": 1.0}) == {"epsAvg": 1.5, "epsHigh": 2.0, "epsLow": 1.0})

# 6) 실적일 — 종목 시장의 현지 날짜(v2.59.1 — UTC 로 자르면 국내 아침 발표가 하루 이르게 됐다)
UTC = ZoneInfo("UTC")


def ep(y, mo, d, h, mi, tz):
    return datetime(y, mo, d, h, mi, tzinfo=ZoneInfo(tz)).timestamp()


ed = fundamentals.earnings_date
cases = [
    ("국내 08:00 KST(전날 23:00 UTC) → 그날", "005930", ep(2026, 10, 30, 8, 0, "Asia/Seoul"), "2026-10-30"),
    ("국내 16:00 KST → 그날", "005930", ep(2026, 10, 30, 16, 0, "Asia/Seoul"), "2026-10-30"),
    ("국내 .KS 접미사도 한국 날짜", "000660.KS", ep(2026, 10, 30, 7, 30, "Asia/Seoul"), "2026-10-30"),
    ("국내 영문 섞인 코드(0126Z0)도 한국", "0126Z0", ep(2026, 11, 2, 8, 0, "Asia/Seoul"), "2026-11-02"),
    ("미국 장 전 07:00 ET → 그날", "AAPL", ep(2026, 10, 29, 7, 0, "America/New_York"), "2026-10-29"),
    ("미국 장 뒤 16:05 ET → 그날", "AAPL", ep(2026, 10, 29, 16, 5, "America/New_York"), "2026-10-29"),
    ("미국 21:00 ET(다음 날 UTC) → 그날", "AAPL", ep(2026, 10, 29, 21, 0, "America/New_York"), "2026-10-29"),
    ("서머타임 끝 전날 23:30 EDT → 10-31", "MSFT", ep(2026, 10, 31, 23, 30, "America/New_York"), "2026-10-31"),
    ("서머타임 끝나는 날 00:30 EDT → 11-01", "MSFT", ep(2026, 11, 1, 0, 30, "America/New_York"), "2026-11-01"),
    ("서머타임 끝나는 날 23:30 EST(다음 날 04:30 UTC) → 11-01", "MSFT", ep(2026, 11, 1, 23, 30, "America/New_York"), "2026-11-01"),
    ("서머타임 시작 전날 23:30 EST → 03-07", "MSFT", ep(2026, 3, 7, 23, 30, "America/New_York"), "2026-03-07"),
    ("서머타임 시작 날 03:30 EDT → 03-08", "MSFT", ep(2026, 3, 8, 3, 30, "America/New_York"), "2026-03-08"),
    ("국내 00:00 KST(전날 15:00 UTC) → 그날", "005930", ep(2026, 11, 2, 0, 0, "Asia/Seoul"), "2026-11-02"),
    ("국내 08:59 KST → 그날", "005930", ep(2026, 11, 2, 8, 59, "Asia/Seoul"), "2026-11-02"),
    ("국내 09:00 KST(00:00 UTC) → 그날", "005930", ep(2026, 11, 2, 9, 0, "Asia/Seoul"), "2026-11-02"),
    ("미국 19:59 EDT → 그날", "AAPL", ep(2026, 10, 29, 19, 59, "America/New_York"), "2026-10-29"),
    ("미국 20:00 EDT(UTC 날짜가 바뀌는 순간) → 그날", "AAPL", ep(2026, 10, 29, 20, 0, "America/New_York"), "2026-10-29"),
    ("미국 23:59 ET → 그날", "AAPL", ep(2026, 10, 29, 23, 59, "America/New_York"), "2026-10-29"),
    ("점 있는 미국 티커 BRK.B → 미국", "BRK.B", ep(2026, 11, 2, 21, 0, "America/New_York"), "2026-11-02"),
    ("국내 .KQ 접미사 · 소문자", "005930.kq", ep(2026, 11, 2, 8, 0, "Asia/Seoul"), "2026-11-02"),
]
for name, sym, stamp, want in cases:
    got = ed({"earningsTimestamp": int(stamp)}, sym)
    check(f"실적일 {name}", got == want, f"{got} != {want}")
check("실적일 Start 가 없거나 0 이면 earningsTimestamp", ed({"earningsTimestampStart": None, "earningsTimestamp": int(ep(2026, 11, 2, 8, 0, "Asia/Seoul"))}, "005930") == "2026-11-02" and ed({"earningsTimestampStart": 0, "earningsTimestamp": int(ep(2026, 11, 2, 8, 0, "Asia/Seoul"))}, "005930") == "2026-11-02")
check("실적일 숫자 문자열도 받음", ed({"earningsTimestamp": str(int(ep(2026, 11, 2, 8, 0, "Asia/Seoul")))}, "005930") == "2026-11-02")
check("실적일 earningsTimestampStart 먼저", ed({"earningsTimestampStart": int(ep(2026, 11, 2, 8, 0, "Asia/Seoul")), "earningsTimestamp": 0}, "005930") == "2026-11-02")
check("실적일 UTC 로 잘랐다면 하루 이른 경우였음(확인)", datetime.fromtimestamp(ep(2026, 10, 30, 8, 0, "Asia/Seoul"), tz=UTC).strftime("%Y-%m-%d") == "2026-10-29")
for label, info in (("값 없음", {}), ("None", {"earningsTimestamp": None}), ("글자", {"earningsTimestamp": "abc"}), ("NaN", {"earningsTimestamp": float("nan")}), ("너무 큼", {"earningsTimestamp": 1e20}), ("0", {"earningsTimestamp": 0}), ("True", {"earningsTimestamp": True}), ("inf", {"earningsTimestamp": float("inf")})):
    check(f"실적일 {label} → None", ed(info, "AAPL") is None)

print(f"PY_RESULT {len(failures)} fail")
sys.exit(1 if failures else 0)
