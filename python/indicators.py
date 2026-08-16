"""기술적 지표 계산 서비스.

Node API 서버가 캔들 배열을 POST 하면 지표 시리즈를 JSON 으로 돌려준다.
계산은 pandas-ta 가 맡는다.

실행:
    python/.venv/bin/python python/indicators.py     # 기본 포트 5001
"""

from __future__ import annotations

import os

import pandas as pd
import pandas_ta as ta
from flask import Flask, jsonify, request

app = Flask(__name__)


def to_frame(candles: list[dict]) -> pd.DataFrame:
    """캔들 배열 → pandas DataFrame (시간 오름차순)."""
    frame = pd.DataFrame(candles)
    required = {"timestamp", "open", "high", "low", "close", "volume"}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"캔들에 필요한 필드가 없습니다: {sorted(missing)}")

    frame = frame.sort_values("timestamp").reset_index(drop=True)
    for column in ("open", "high", "low", "close", "volume"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame


def series_to_list(series: pd.Series | None) -> list[float | None]:
    """NaN 을 None 으로 바꿔 JSON 으로 보낼 수 있게 만든다."""
    if series is None:
        return []
    return [None if pd.isna(value) else round(float(value), 6) for value in series]


def compute(frame: pd.DataFrame) -> dict:
    """명세의 지표 목록을 한 번에 계산한다."""
    close, high, low, volume = frame["close"], frame["high"], frame["low"], frame["volume"]

    macd = ta.macd(close, fast=12, slow=26, signal=9)
    bbands = ta.bbands(close, length=20, std=2)
    stoch = ta.stoch(high, low, close, k=14, d=3, smooth_k=3)

    def column(table: pd.DataFrame | None, prefix: str) -> pd.Series | None:
        """접두사로 컬럼을 고른다.

        pandas-ta 는 'MACDh_12_26_9' 처럼 파라미터가 붙은 이름을 쓰므로 위치 인덱스보다
        접두사 매칭이 버전 변화에 안전하다.
        """
        if table is None or table.empty:
            return None
        for name in table.columns:
            if str(name).startswith(prefix):
                return table[name]
        return None

    return {
        "timestamps": [int(value) for value in frame["timestamp"]],
        # 추세 — 차트에 겹쳐 그린다
        "sma20": series_to_list(ta.sma(close, length=20)),
        "sma60": series_to_list(ta.sma(close, length=60)),
        "sma120": series_to_list(ta.sma(close, length=120)),
        "ema12": series_to_list(ta.ema(close, length=12)),
        "ema26": series_to_list(ta.ema(close, length=26)),
        # 볼린저밴드 — 하단/중단/상단 순서로 반환된다
        "bbLower": series_to_list(column(bbands, "BBL_")),
        "bbMiddle": series_to_list(column(bbands, "BBM_")),
        "bbUpper": series_to_list(column(bbands, "BBU_")),
        # 오실레이터 — 별도 패널
        "rsi14": series_to_list(ta.rsi(close, length=14)),
        "macd": series_to_list(column(macd, "MACD_")),
        "macdHistogram": series_to_list(column(macd, "MACDh_")),
        "macdSignal": series_to_list(column(macd, "MACDs_")),
        "stochK": series_to_list(column(stoch, "STOCHk_")),
        "stochD": series_to_list(column(stoch, "STOCHd_")),
        # 변동성·거래량
        "atr14": series_to_list(ta.atr(high, low, close, length=14)),
        "obv": series_to_list(ta.obv(close, volume)),
        "vwap": series_to_list(vwap(frame)),
    }


def vwap(frame: pd.DataFrame) -> pd.Series:
    """VWAP.

    pandas-ta 의 vwap 는 DatetimeIndex 를 요구하고 일 단위로 리셋한다.
    여기서는 조회 구간 전체에 대한 누적 VWAP 를 직접 계산한다 — 일봉에서도
    의미가 있고, 인덱스 형태에 의존하지 않는다.
    """
    typical = (frame["high"] + frame["low"] + frame["close"]) / 3
    cumulative_volume = frame["volume"].cumsum()
    return (typical * frame["volume"]).cumsum() / cumulative_volume.replace(0, pd.NA)


@app.get("/health")
def health():
    return jsonify({"ok": True, "pandas_ta": ta.version})


@app.post("/indicators")
def indicators():
    payload = request.get_json(silent=True) or {}
    candles = payload.get("candles")
    if not isinstance(candles, list) or not candles:
        return jsonify({"error": "candles 배열이 필요합니다."}), 400

    try:
        frame = to_frame(candles)
        return jsonify(compute(frame))
    except Exception as error:  # noqa: BLE001 - 클라이언트에 원인을 그대로 전달
        return jsonify({"error": f"{type(error).__name__}: {error}"}), 500


if __name__ == "__main__":
    port = int(os.environ.get("INDICATORS_PORT", "5001"))
    app.run(host="127.0.0.1", port=port, debug=False)
