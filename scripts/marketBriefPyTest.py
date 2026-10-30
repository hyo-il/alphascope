"""
지표 엔진 계산 시험(오늘 시황 · 실적일 현지 날짜 v2.59.1) — `npm run marketbrief:test` 가 부른다(혼자 돌리지 않는다).
네트워크 0: yfinance · 미국 재무부 받기는 모두 가짜로 바꿔 끼운다. 실패하면 종료 코드 1.
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

# 3) 모으기 — 실패 항목은 빠지고 failed 에 남는다
asked = []


def fake_history(ticker, period, decimals):
    asked.append((ticker, period))
    if ticker == "DX-Y.NYB":
        return None
    return mb.summarize_closes([100.0, 101.0], date(2026, 10, 28), decimals)


t_xml = ('<m:properties><d:NEW_DATE m:type="Edm.DateTime">2026-10-27T00:00:00</d:NEW_DATE><d:BC_2YEAR m:type="Edm.Double">3.51</d:BC_2YEAR></m:properties>'
         '<m:properties><d:NEW_DATE m:type="Edm.DateTime">2026-10-28T00:00:00</d:NEW_DATE><d:BC_2YEAR m:type="Edm.Double">3.49</d:BC_2YEAR></m:properties>')
us2y_ok = [("미국 재무부", lambda: t_xml, mb.parse_treasury_xml)]
data = mb.collect_market_data("morning", history=fake_history, us2y=lambda: mb.fetch_us2y(us2y_ok))
keys = set(data["assets"])
want = {"KOSPI", "KOSDAQ", "SP500", "NASDAQ", "DOW", "RUSSELL2000", "GOLD", "US2Y", "US10Y", "USDKRW", "WTI", "NATGAS", "ES", "NQ"}
check("오전판 13종 + 선물 2 중 실패 1(DXY) 빠짐", keys == want and data["failed"] == ["DXY"], f"{sorted(keys)} {data['failed']}")
tickers = dict(asked)
check("원본 티커 그대로", tickers.get("CL=F") and tickers.get("NG=F") and tickers.get("^TNX") and tickers.get("^RUT") and tickers.get("USDKRW=X") and tickers.get("GC=F"))
check("시황 바와 겹치는 지수는 같은 기간(공용 캐시)", tickers["^GSPC"] == fundamentals.INDEX_HISTORY_PERIOD and tickers["^KS11"] == fundamentals.INDEX_HISTORY_PERIOD)
check("오전판에 VIX 없음", "^VIX" not in tickers)

asked.clear()
us2y_called = []
data = mb.collect_market_data("afternoon", history=fake_history, us2y=lambda: us2y_called.append(1) or mb.fetch_us2y(us2y_ok))
check("오후판 = 코스피 · 코스닥 · S&P500 · 나스닥 · VIX + 선물 2(미2년물 받지 않음)", set(data["assets"]) == {"KOSPI", "KOSDAQ", "SP500", "NASDAQ", "VIX", "ES", "NQ"} and not us2y_called and data["sources"] == {})
check("선물 티커 — ES=F(E-mini S&P 500) · NQ=F(E-mini Nasdaq-100) · 러셀도 지수와 같은 기간", dict(asked).get("ES=F") == "5d" and dict(asked).get("NQ=F") == "5d" and mb._INDEX_ASSETS[5][2] == fundamentals.INDEX_HISTORY_PERIOD)

# 2-3) 최근 흐름(5 · 20거래일, v2.60.0)
closes = [100.0 + i for i in range(21)]  # 100 … 120 (21개)
t = mb.trend_from_closes(closes)
check("흐름 — 마지막 ÷ 5거래일 전 − 1 · 20거래일 전", t == {"d5": round((120 / 115 - 1) * 100, 2), "d20": 20.0}, str(t))
t6 = mb.trend_from_closes(closes[-6:])
check("흐름 — 봉 6개면 5일만 · 20일은 None(일봉 모자람)", t6 == {"d5": round((120 / 115 - 1) * 100, 2), "d20": None}, str(t6))
check("흐름 — 봉 5개 이하면 None(칸을 붙이지 않음)", mb.trend_from_closes(closes[-5:]) is None and "trend" not in mb.summarize_closes([100.0, 101.0], date(2026, 10, 28), 2))
check("summarize_closes 에 trend 가 붙음(봉이 6개 넘으면)", mb.summarize_closes(closes, date(2026, 10, 28), 2)["trend"]["d20"] == 20.0)

# 2-4) 채점용 일봉 — 그 시장 날짜 · 오래된 것부터 · 빈 값 줄 빼기
import pandas as pd

frame = pd.DataFrame({"Close": [2500.0, float("nan"), 2550.0]}, index=pd.DatetimeIndex(["2026-10-28", "2026-10-29", "2026-10-30"]).tz_localize("Asia/Seoul"))
got = mb.index_closes(["KOSPI", "SP500", "XX"], history=lambda ticker, period: frame if ticker == "^KS11" else pd.DataFrame())
check("채점 일봉 — 날짜 · 종가(빈 값 뺌) · 못 받으면 빈 목록 · 모르는 키 무시", got == {"KOSPI": [{"date": "2026-10-28", "close": 2500.0}, {"date": "2026-10-30", "close": 2550.0}], "SP500": []}, str(got))


def boom():
    raise TimeoutError("timed out")


# 2-2) 미2년물 후보(v2.59.6) — 재무부 XML · 후보 차례 · 모두 실패
treasury_xml = """<feed><entry><content><m:properties><d:NEW_DATE m:type="Edm.DateTime">2026-10-28T00:00:00</d:NEW_DATE>
<d:BC_1MONTH m:type="Edm.Double">4.06</d:BC_1MONTH><d:BC_2YEAR m:type="Edm.Double">4.67</d:BC_2YEAR></m:properties></content></entry>
<entry><content><m:properties><d:NEW_DATE m:type="Edm.DateTime">2026-10-29T00:00:00</d:NEW_DATE>
<d:BC_2YEAR m:type="Edm.Double">4.61</d:BC_2YEAR></m:properties></content></entry>
<entry><content><m:properties><d:NEW_DATE m:type="Edm.DateTime">2026-10-30T00:00:00</d:NEW_DATE>
<d:BC_2YEAR m:type="Edm.Double" m:null="true" /></m:properties></content></entry></feed>"""
tv = mb.parse_treasury_xml(treasury_xml)
check("재무부 XML — 날짜마다 BC_2YEAR · 빈 값 줄 빼고 마지막 두 날", tv == {"current": 4.61, "change": -0.06, "change_pct": -1.28, "data_date": "2026-10-29"}, str(tv))
check("재무부 XML — 한 날이면 빠짐", mb.parse_treasury_xml(treasury_xml.split("<entry>")[0] + "<entry>" + treasury_xml.split("<entry>")[1]) is None)
urls = []
mb.fetch_treasury_xml(datetime(2026, 11, 2, 7, 0, tzinfo=ZoneInfo("Asia/Seoul")), get=lambda u, t: (urls.append((u, t)), "")[1])
check("재무부 — 미국 날짜의 달(11-01 ET → 202611) · 두 날이 안 되면 지난달(202610)도 · 15초 제한",
      [u.split("month=")[1] for u, _ in urls] == ["202611", "202610"] and all(t == 15 for _, t in urls), str(urls))
check("재무부 주소 = 공식 XML 피드(daily_treasury_yield_curve)", mb.TREASURY_URL.startswith("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month="))
check("미2년물 출처 = 미국 재무부 하나(v2.59.7)", [x[0] for x in mb.US2Y_SOURCES] == ["미국 재무부"])
check("FRED 코드가 남지 않음", not any(hasattr(mb, n) for n in ("parse_fred_csv", "fetch_fred_csv", "FRED_TIMEOUT_SEC", "_FRED_DAYS")))
one = [("미국 재무부", lambda: treasury_xml, mb.parse_treasury_xml)]
v, info = mb.fetch_us2y(one)
check("재무부 성공 → 값 · used=미국 재무부 · 시도 1번", v == tv and info["used"] == "미국 재무부" and [t["ok"] for t in info["tried"]] == [True], str(info))
v, info = mb.fetch_us2y([("미국 재무부", boom, mb.parse_treasury_xml)])
check("재무부 실패 → 값 없음 · used=None · 이유 남김", v is None and info["used"] is None and len(info["tried"]) == 1 and "timed out" in info["tried"][0]["error"], str(info))
v, info = mb.fetch_us2y([("가", boom, mb.parse_treasury_xml), ("나", lambda: treasury_xml, mb.parse_treasury_xml)])
check("목록 모양 그대로 — 앞 출처 실패면 다음 출처(나중에 출처가 늘 때)", v == tv and info["used"] == "나" and [t["ok"] for t in info["tried"]] == [False, True], str(info))
data = mb.collect_market_data("morning", history=fake_history, us2y=lambda: mb.fetch_us2y(one))
check("모으기 — 쓴 출처 이름이 sources.US2Y.used", data["assets"].get("US2Y") == tv and data["sources"]["US2Y"]["used"] == "미국 재무부")
data = mb.collect_market_data("morning", history=fake_history, us2y=lambda: mb.fetch_us2y([("미국 재무부", boom, mb.parse_treasury_xml)]))
check("재무부 실패 → US2Y 빠짐(failed)", "US2Y" not in data["assets"] and "US2Y" in data["failed"])
rows = mb.check_us2y_sources(one)
check("점검 — 재무부 1번 · 코드 200 · 시간 · 값", [r["source"] for r in rows] == ["미국 재무부"] and rows[0]["status"] == 200 and rows[0]["value"] == tv and isinstance(rows[0]["ms"], int), str(rows))

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

# 7) 오늘 시황 전망치 — 종목 시장 시간대로 날짜 · 오늘(v2.59.2). 한국 10-30 10:00 = 미국 10-29 21:00
ET = ZoneInfo("America/New_York")
inst = datetime(2026, 10, 30, 10, 0, tzinfo=ZoneInfo("Asia/Seoul"))
us_frame = pd.DataFrame(
    {"EPS Estimate": [2.1, 1.9], "Reported EPS": [None, 1.8]},
    index=pd.DatetimeIndex([datetime(2026, 10, 29, 8, 0, tzinfo=ET), datetime(2026, 7, 29, 8, 0, tzinfo=ET)]),
)
check("전망치 — 미국 종목은 미국 날짜(10-29 장 전 발표 · 미국 오늘 10-29) → 예상 EPS 잡힘", mb.eps_from_earnings_dates(us_frame, date(2026, 10, 29), ET)["epsEstimate"] == 2.1)
check("전망치 — (예전) 한국 시간으로 바꾸면 10-29 21:00 KST < 한국 오늘 10-30 → 빠졌던 경우", mb.eps_from_earnings_dates(us_frame, date(2026, 10, 30))["epsEstimate"] is None)
real_call, real_ticker = mb._call_with_timeout, mb.yf.Ticker


class _T:
    def __init__(self, *_):
        self.earnings_dates = us_frame


mb.yf.Ticker = _T
mb._call_with_timeout = lambda fn, timeout=None: fn() if fn.__code__.co_names[-1:] == ("earnings_dates",) else None
us = mb._estimates_one("AAPL", inst)
kr_frame = pd.DataFrame({"EPS Estimate": [1200.0], "Reported EPS": [None]}, index=pd.DatetimeIndex([datetime(2026, 10, 30, 8, 0, tzinfo=ZoneInfo("Asia/Seoul"))]))
_T.__init__ = lambda self, *_: setattr(self, "earnings_dates", kr_frame)
kr = mb._estimates_one("005930", inst)
mb._call_with_timeout, mb.yf.Ticker = real_call, real_ticker
check("전망치 — _estimates_one 이 같은 순간을 종목 시간대의 오늘로(미국 10-29 → 잡힘)", us.get("ok") and us.get("epsEstimate") == 2.1, str(us))
check("전망치 — 국내 종목은 한국 날짜 그대로(10-30 08:00 KST · 한국 오늘 10-30 → 잡힘)", kr.get("ok") and kr.get("epsEstimate") == 1200.0, str(kr))

print(f"PY_RESULT {len(failures)} fail")
sys.exit(1 if failures else 0)
