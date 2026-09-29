"""
시가총액 상위 종목 후보 — `npm run universe:update` 가 부른다 (scripts/universeUpdate.ts).

yfinance 의 스크리너(`yf.screen`, 시가총액 내림차순)로 미국·국내 후보를 넉넉히 받아
**JSON 으로 stdout 에 찍기만** 한다. 거르기(ETF·SPAC·우선주·중복 클래스·토스 카탈로그 확인)는
TS 쪽이 한다 — 토스 심볼 확인에 SQLite 카탈로그가 필요해서다.

pykrx 를 쓰지 않은 이유: 새 의존성 없이 yfinance 하나로 국내(KSC·KOE)까지 받아진다 (2026-09-29 확인).
"""

import json
import sys

import yfinance as yf
from yfinance import EquityQuery

PAGE = 250


def screen(query, want):
    out = []
    offset = 0
    while len(out) < want:
        result = yf.screen(query, sortField="intradaymarketcap", sortAsc=False, size=PAGE, offset=offset)
        quotes = result.get("quotes", [])
        if not quotes:
            break
        out += quotes
        offset += len(quotes)
        if len(quotes) < PAGE:
            break
    return out


def slim(q):
    return {
        "symbol": q.get("symbol"),
        "name": q.get("longName") or q.get("shortName"),
        "shortName": q.get("shortName"),
        "quoteType": q.get("quoteType"),
        "exchange": q.get("exchange"),
        "marketCap": q.get("marketCap"),
        "avgVolume": q.get("averageDailyVolume3Month"),
    }


def main():
    us_query = EquityQuery(
        "and",
        [
            EquityQuery("eq", ["region", "us"]),
            # 미국 주요 거래소만 — 장외(OTC)는 뺀다
            EquityQuery("is-in", ["exchange", "NMS", "NYQ", "NGM", "NCM", "ASE"]),
        ],
    )
    kr_query = EquityQuery("eq", ["region", "kr"])
    # 거른 뒤 100개가 남도록 넉넉히 받는다 (국내는 우선주가 많다)
    us = [slim(q) for q in screen(us_query, 250)]
    kr = [slim(q) for q in screen(kr_query, 300)]
    json.dump({"us": us, "kr": kr, "yfinance": yf.__version__}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
