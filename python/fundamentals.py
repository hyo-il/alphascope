"""기업 재무 데이터 조회 (yfinance).

밸류에이션·재무제표·배당·섹터 정보를 앱이 쓰기 좋은 형태로 정규화한다.
indicators.py 의 Flask 앱에 라우트로 등록된다 (프로세스는 하나).
"""

from __future__ import annotations

import math
from typing import Any

import yfinance as yf


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


def get_fundamentals(symbol: str) -> dict:
    """한 종목의 기업 정보를 모아 반환한다."""
    ticker = yf.Ticker(symbol)
    info = ticker.info or {}

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
        try:
            info = yf.Ticker(symbol).info or {}
        except Exception:  # noqa: BLE001 - 한 종목 실패가 전체를 막지 않게 한다
            continue
        if not info.get("longName") and not info.get("shortName"):
            continue

        peers.append(
            {
                "symbol": symbol,
                "name": pick(info, "longName", "shortName"),
                "sector": pick(info, "sector"),
                "marketCap": pick(info, "marketCap"),
                "per": pick(info, "trailingPE"),
                "pbr": pick(info, "priceToBook"),
                "dividendYield": pick(info, "dividendYield"),
                "profitMargin": pick(info, "profitMargins"),
            }
        )
    return peers
