"""기업 재무 데이터 조회 (yfinance).

밸류에이션·재무제표·배당·섹터 정보를 앱이 쓰기 좋은 형태로 정규화한다.
indicators.py 의 Flask 앱에 라우트로 등록된다 (프로세스는 하나).
"""

from __future__ import annotations

import math
import re
import time
from typing import Any

import yfinance as yf


# ⚠️ yfinance 는 국내 종목에 시장 접미사를 요구한다 — "005930" 은 404,
# "005930.KS"(코스피) / "005930.KQ"(코스닥) 라야 찾는다. 어느 시장인지는 심볼만으로
# 알 수 없으므로 순서대로 시도한다. 미국 종목은 그대로 쓴다.
# 국내 판별 규칙은 src/utils/market.ts 의 isKrSymbol 과 같다 — "숫자로 시작하는 6자리"
# (0126Z0 처럼 영문이 섞인 신규 코드 포함). 두 곳을 함께 고친다.
_KR_SYMBOL = re.compile(r"^\d[0-9A-Z]{5}$")


def to_yf_symbols(symbol: str) -> list[str]:
    """
    토스 심볼 → yfinance 호출용 심볼 후보 (v2.20.0 — **모든 yfinance 종목 호출이 이 함수를 지난다**).

    - 국내: `.KS`(코스피) → `.KQ`(코스닥) 순서로 시도한다.
    - 미국: 클래스 주식의 점을 하이픈으로 — 토스 `BRK.B` 는 yfinance 에서 `BRK-B` 다
      (점 그대로면 찾지 못해 섹터가 비고 종목 지도에서 「기타」 로 빠졌다).
      반대 방향(yfinance → 토스)은 `server/universe.ts` 가 한다.
    """
    if _KR_SYMBOL.match(symbol):
        return [f"{symbol}.KS", f"{symbol}.KQ"]
    return [symbol.replace(".", "-")]


def resolve_ticker(symbol: str):
    """조회에 성공하는 티커를 찾아 (티커, info) 로 돌려준다. 없으면 (None, {})."""
    for candidate in to_yf_symbols(symbol):
        try:
            ticker = yf.Ticker(candidate)
            info = ticker.info or {}
        except Exception:  # noqa: BLE001 - 다음 후보를 시도한다
            continue
        # 이름조차 없으면 찾지 못한 심볼이다 (404 대신 빈 dict 를 주는 경우가 있다).
        if info.get("longName") or info.get("shortName"):
            return ticker, info
    return None, {}


def clean(value: Any) -> Any:
    """JSON 으로 보낼 수 없는 값(NaN, numpy 타입 등)을 정리한다."""
    if value is None:
        return None
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else round(value, 4)
    if hasattr(value, "item"):  # numpy 스칼라
        return clean(value.item())
    return value


def pick(info: dict, *keys: str) -> Any:
    """여러 후보 키 중 먼저 값이 있는 것을 고른다 (yfinance 는 종목마다 키가 다르다)."""
    for key in keys:
        if key in info and info[key] is not None:
            return clean(info[key])
    return None


def statement_rows(frame, wanted: list[str], limit: int = 4) -> list[dict]:
    """손익계산서·재무상태표에서 필요한 항목만 기간별로 뽑는다."""
    if frame is None or frame.empty:
        return []

    periods = list(frame.columns)[:limit]
    rows = []
    for period in periods:
        entry = {"period": str(period)[:10]}
        for label in wanted:
            entry[label] = clean(frame.loc[label, period]) if label in frame.index else None
        rows.append(entry)
    return rows


def earnings_date(info: dict) -> str | None:
    """다음 실적 발표일 (YYYY-MM-DD). yfinance 는 epoch 초로 준다."""
    stamp = info.get("earningsTimestampStart") or info.get("earningsTimestamp")
    if not stamp:
        return None
    try:
        return time.strftime("%Y-%m-%d", time.gmtime(float(stamp)))
    except (TypeError, ValueError, OSError):
        return None


def get_earnings(symbols: list[str]) -> list[dict]:
    """
    실적 발표일만 — `/earnings` 라우트 (v2.16.0). 재무제표·동종업계를 받지 않아 `/fundamentals` 보다 훨씬 가볍다.

    `isEstimate`: yfinance 의 `isEarningsDateEstimate` — 회사가 확정 발표하기 전의 **추정일**이면 True.
    실적일이 없으면(국내 종목은 대개 없다) date=None 으로 돌려준다 — 서버가 "실적일 미확인" 으로 다룬다.
    ⚠️ 날짜가 지난 것일 수 있다(다음 일정이 아직 안 잡힌 경우 yfinance 가 직전 발표일을 준다).
    """
    out = []
    for symbol in symbols:
        _ticker, info = resolve_ticker(symbol)
        estimate = info.get("isEarningsDateEstimate")
        out.append({
            "symbol": symbol,
            "date": earnings_date(info),
            "isEstimate": bool(estimate) if estimate is not None else None,
            "found": bool(info),
            # 같은 info 에서 섹터·시총도 함께 준다 (v2.18.0 종목 지도) — 따로 받으면 하루에 같은 호출을 두 번 한다
            "sector": info.get("sector"),
            # v2.42.0 — 동종업계 자동 고르기(같은 세부 업종). 같은 info 에서 함께 받는다(호출을 늘리지 않는다)
            "industry": info.get("industry"),
            "marketCap": clean(info.get("marketCap")),
        })
    return out


def _iso(epoch) -> str | None:
    try:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(float(epoch)))
    except (TypeError, ValueError, OSError):
        return None


def get_news(symbol: str, count: int = 10) -> dict:
    """
    종목 뉴스 — `/news` 라우트 (v2.18.0). 제목·발행처·링크·시각만 준다(본문은 받지 않는다).

    yfinance 1.6.0 확인 결과(2026-09-30):
    - `Ticker.get_news()` 가 쓰는 Yahoo `xhr/ncp` 는 HTTP 500 을 준다 → 빈 목록. 살아나면 먼저 쓴다.
    - `yf.Search(query).news` 는 동작한다 — 필드 `title` · `publisher` · `link` · `providerPublishTime`(epoch 초) · `relatedTickers`.
    - ⚠️ Search 는 관련 없는 시장 뉴스도 섞어 준다(삼성전자를 회사명으로 찾으면 카니발 크루즈 기사). 그래서
      **`relatedTickers` 에 이 종목이 있는 기사만** 남긴다. 국내 종목은 대개 0건 — 엉뚱한 기사보다 "뉴스 없음" 이 낫다.
    """
    candidates = to_yf_symbols(symbol)
    ticker, info = resolve_ticker(symbol)
    yf_symbol = ticker.ticker if ticker is not None else candidates[0]
    wanted = {yf_symbol.upper(), symbol.upper()}
    items: list[dict] = []
    source = "none"

    # 1) Ticker.get_news (새 형식: content.title / provider.displayName / canonicalUrl.url / pubDate)
    try:
        raw = (ticker or yf.Ticker(yf_symbol)).get_news(count=count) or []
        for x in raw:
            c = x.get("content") or x
            url = (c.get("canonicalUrl") or {}).get("url") or (c.get("clickThroughUrl") or {}).get("url") or c.get("link")
            if c.get("title") and url:
                items.append({
                    "title": c.get("title"),
                    "publisher": (c.get("provider") or {}).get("displayName") or c.get("publisher"),
                    "link": url,
                    "publishedAt": c.get("pubDate") or _iso(c.get("providerPublishTime")),
                })
        if items:
            source = "ticker"
    except Exception:  # noqa: BLE001 - 다음 경로를 시도한다
        items = []

    # 2) Search — 이 종목이 relatedTickers 에 있는 기사만
    if not items:
        queries = [yf_symbol]
        name = info.get("shortName") or info.get("longName")
        if name:
            queries.append(name)
        seen = set()
        for q in queries:
            try:
                news = yf.Search(q, news_count=count, max_results=1).news or []
            except Exception:  # noqa: BLE001
                continue
            for x in news:
                related = {t.upper() for t in (x.get("relatedTickers") or [])}
                if not (related & wanted) or x.get("uuid") in seen:
                    continue
                seen.add(x.get("uuid"))
                items.append({
                    "title": x.get("title"),
                    "publisher": x.get("publisher"),
                    "link": x.get("link"),
                    "publishedAt": _iso(x.get("providerPublishTime")),
                })
            if items:
                source = "search"
                break

    items = [i for i in items if i.get("title") and i.get("link")]
    items.sort(key=lambda i: i.get("publishedAt") or "", reverse=True)
    return {"symbol": symbol, "yfSymbol": yf_symbol, "source": source, "items": items[:count]}


def interest_coverage(financials) -> float | None:
    """
    이자보상배율 = 영업이익 / 이자비용.

    yfinance `info` 에는 없어서 손익계산서에서 직접 낸다. 이자비용이 0 이거나
    항목 자체가 없는(무차입) 기업은 나눌 수 없으므로 None 을 돌려준다 —
    그런 기업을 '무한대' 로 적으면 비교 표에서 최고값을 독차지한다.
    """
    if financials is None or financials.empty:
        return None

    period = financials.columns[0]
    ebit = next((row for row in ("EBIT", "Operating Income") if row in financials.index), None)
    expense = next(
        (row for row in ("Interest Expense", "Interest Expense Non Operating") if row in financials.index),
        None,
    )
    if ebit is None or expense is None:
        return None

    try:
        operating = float(financials.loc[ebit, period])
        interest = abs(float(financials.loc[expense, period]))
    except (TypeError, ValueError):
        return None

    return clean(operating / interest) if interest else None


def get_fundamentals(symbol: str) -> dict:
    """한 종목의 기업 정보를 모아 반환한다."""
    ticker, info = resolve_ticker(symbol)
    if ticker is None:
        # 상장 직후·비상장·심볼 오류 — 빈 값으로 채워 화면이 "—" 로 뜨게 둔다.
        raise ValueError(f"yfinance 에서 {symbol} 을(를) 찾지 못했습니다.")

    dividends = ticker.dividends
    recent_dividends = []
    if dividends is not None and not dividends.empty:
        recent_dividends = [
            {"date": str(date)[:10], "amount": clean(float(amount))}
            for date, amount in dividends.tail(8).items()
        ]

    return {
        "symbol": symbol,
        "profile": {
            "name": pick(info, "longName", "shortName"),
            "sector": pick(info, "sector"),
            "industry": pick(info, "industry"),
            "country": pick(info, "country"),
            "employees": pick(info, "fullTimeEmployees"),
            "marketCap": pick(info, "marketCap"),
            "currency": pick(info, "currency"),
            "summary": pick(info, "longBusinessSummary"),
            # 스윙 추천이 "실적 발표 임박" 경고에 쓴다. 없는 종목도 많아 항상 선택 값이다.
            "earningsDate": earnings_date(info),
        },
        "valuation": {
            "per": pick(info, "trailingPE"),
            "forwardPer": pick(info, "forwardPE"),
            "pbr": pick(info, "priceToBook"),
            "eps": pick(info, "trailingEps"),
            "forwardEps": pick(info, "forwardEps"),
            "peg": pick(info, "trailingPegRatio", "pegRatio"),
            "priceToSales": pick(info, "priceToSalesTrailing12Months"),
            "evToEbitda": pick(info, "enterpriseToEbitda"),
        },
        "profitability": {
            "revenue": pick(info, "totalRevenue"),
            "revenueGrowth": pick(info, "revenueGrowth"),
            "earningsGrowth": pick(info, "earningsGrowth"),
            "grossMargin": pick(info, "grossMargins"),
            "operatingMargin": pick(info, "operatingMargins"),
            "profitMargin": pick(info, "profitMargins"),
            "roe": pick(info, "returnOnEquity"),
            "roa": pick(info, "returnOnAssets"),
        },
        "stability": {
            "debtToEquity": pick(info, "debtToEquity"),
            "currentRatio": pick(info, "currentRatio"),
            "quickRatio": pick(info, "quickRatio"),
            "totalCash": pick(info, "totalCash"),
            "totalDebt": pick(info, "totalDebt"),
            "freeCashflow": pick(info, "freeCashflow"),
            "beta": pick(info, "beta"),
            "interestCoverage": interest_coverage(ticker.financials),
        },
        "dividend": {
            "yield": pick(info, "dividendYield"),
            "rate": pick(info, "dividendRate"),
            "payoutRatio": pick(info, "payoutRatio"),
            "recent": recent_dividends,
        },
        "incomeStatement": statement_rows(
            ticker.financials,
            ["Total Revenue", "Gross Profit", "Operating Income", "Net Income"],
        ),
        "balanceSheet": statement_rows(
            ticker.balance_sheet,
            ["Total Assets", "Total Debt", "Stockholders Equity", "Cash And Cash Equivalents"],
        ),
    }


def get_peers(symbols: list[str]) -> list[dict]:
    """동종업계 비교용 — 여러 종목의 핵심 지표만 간단히 가져온다."""
    peers = []
    for symbol in symbols:
        # 국내 종목은 .KS/.KQ 접미사가 필요하다 (resolve_ticker 가 처리).
        _, info = resolve_ticker(symbol)
        if not info:
            continue  # 한 종목 실패가 전체를 막지 않게 한다

        peers.append(
            {
                "symbol": symbol,
                "name": pick(info, "longName", "shortName"),
                "sector": pick(info, "sector"),
                "currency": pick(info, "currency"),
                "marketCap": pick(info, "marketCap"),
                "per": pick(info, "trailingPE"),
                "pbr": pick(info, "priceToBook"),
                "dividendYield": pick(info, "dividendYield"),
                "profitMargin": pick(info, "profitMargins"),
            }
        )
    return peers


# 시황 카드에 표시할 지수 — 토스 market-indicators 는 국내 지수·채권만 제공하고
# 등락률도 없어서, 지수는 yfinance 로 통일한다 (환율만 토스 실시간).
# 표시 순서 = 이 배열 순서. 국내장 → 미국 지수 → 변동성 순으로 둔다 (환율은 맨 뒤에 붙는다).
MARKET_INDICES = [
    ("^KS11", "코스피"),
    ("^KQ11", "코스닥"),
    ("^GSPC", "S&P 500"),
    ("^IXIC", "나스닥"),
    ("^DJI", "다우존스"),
    ("^VIX", "VIX 공포지수"),
]

# yfinance 를 30초마다 6종목씩 치면 차단될 수 있다. 서버에서 캐시하고 주기를 늘린다.
_overview_cache: dict = {"at": 0.0, "rows": []}
_OVERVIEW_TTL_SEC = 60


# 환율 스파크라인 — 토스 /exchange-rate 는 현재가만 주고 과거 시계열이 없어서
# yfinance "KRW=X"(USD/KRW) 의 최근 30 거래일 종가를 쓴다.
# 지수보다 훨씬 느리게 움직이고 카드 한 장에만 쓰이므로 30분 캐시로 충분하다.
_FX_SYMBOL = "KRW=X"
_fx_cache: dict = {"at": 0.0, "closes": []}
_FX_TTL_SEC = 1800


def get_fx_sparkline(force: bool = False) -> list[float]:
    """USD/KRW 최근 30 거래일 종가."""
    now = time.time()
    if not force and _fx_cache["closes"] and now - _fx_cache["at"] < _FX_TTL_SEC:
        return _fx_cache["closes"]

    closes: list[float] = []
    try:
        history = yf.Ticker(_FX_SYMBOL).history(period="2mo", interval="1d")
        if history is not None and not history.empty:
            closes = [v for v in (clean(x) for x in history["Close"].tail(30)) if v is not None]
    except Exception:  # noqa: BLE001 - 환율 카드의 미니 차트만 비게 된다
        return _fx_cache["closes"]

    # 조회에 성공했을 때만 캐시를 갱신한다 (빈 결과로 이전 값을 지우지 않는다).
    if closes:
        _fx_cache.update({"at": now, "closes": closes})
    return closes


def get_market_overview(force: bool = False) -> list[dict]:
    """주요 지수의 현재가·등락률·스파크라인(최근 30 거래일 종가)."""
    now = time.time()
    if not force and _overview_cache["rows"] and now - _overview_cache["at"] < _OVERVIEW_TTL_SEC:
        return _overview_cache["rows"]

    rows = []
    for symbol, label in MARKET_INDICES:
        price = previous = None
        sparkline: list[float] = []

        try:
            ticker = yf.Ticker(symbol)
            # FastInfo 의 키는 카멜케이스다 (last_price 가 아니라 lastPrice).
            info = ticker.fast_info
            price = clean(info.get("lastPrice"))
            previous = clean(info.get("previousClose"))

            history = ticker.history(period="2mo", interval="1d")
            if history is not None and not history.empty:
                closes = [clean(v) for v in history["Close"].tail(30)]
                sparkline = [v for v in closes if v is not None]
                # fast_info 가 비어 있으면 종가로 대신한다.
                if price is None and sparkline:
                    price = sparkline[-1]
                if previous is None and len(sparkline) >= 2:
                    previous = sparkline[-2]
        except Exception:  # noqa: BLE001 - 하나가 실패해도 나머지는 보여 준다
            pass

        change = round(price - previous, 4) if price is not None and previous is not None else None
        change_rate = (
            round((price - previous) / previous * 100, 2)
            if price is not None and previous
            else None
        )

        rows.append(
            {
                "symbol": symbol,
                "label": label,
                "price": price,
                "change": change,
                "changeRate": change_rate,
                "sparkline": sparkline,
            }
        )

    _overview_cache.update({"at": now, "rows": rows})
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# 급등 탐지용 과거 일봉 (Step 9)
#
# 토스 /candles 는 200봉씩 페이지네이션이라 50~100 종목 × 6개월을 받으려면 왕복이
# 수백 번이다. yfinance 는 한 번에 6개월을 주므로 탐지의 주 데이터원으로 쓴다.
# ⚠️ 국내 종목(6자리 숫자)은 yfinance 에서 접미사가 필요하다 (.KS 코스피 / .KQ 코스닥).
# ─────────────────────────────────────────────────────────────────────────────

def get_history(symbol: str, period: str = "6mo") -> tuple[list[dict], float | None]:
    """일봉 배열(오래된 것부터)과 시가총액.

    시가총액을 함께 주는 이유: 급등 탐지가 대형주/중소형주에 다른 기준을 적용하는데,
    그것 하나 때문에 종목마다 `/fundamentals` 를 또 부르면 조회가 두 배가 된다.
    `fast_info` 는 `.info` 보다 훨씬 가볍다.
    """
    for candidate in to_yf_symbols(symbol):
        try:
            ticker = yf.Ticker(candidate)
            frame = ticker.history(period=period, interval="1d", auto_adjust=False)
        except Exception:  # noqa: BLE001 - 다음 후보를 시도한다
            continue
        if frame is None or frame.empty:
            continue

        try:
            market_cap = clean(ticker.fast_info.get("marketCap"))
        except Exception:  # noqa: BLE001 - 시총이 없으면 기본 기준을 쓴다
            market_cap = None

        candles = []
        for index, row in frame.iterrows():
            close = clean(row.get("Close"))
            if close is None:
                continue  # 거래정지일 등 — 지표 계산이 깨지지 않도록 건너뛴다
            candles.append(
                {
                    "timestamp": int(index.timestamp() * 1000),
                    "open": clean(row.get("Open")),
                    "high": clean(row.get("High")),
                    "low": clean(row.get("Low")),
                    "close": close,
                    "volume": clean(row.get("Volume")) or 0,
                }
            )
        if candles:
            return candles, market_cap
    return [], None
