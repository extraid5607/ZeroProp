import asyncio

from app.prices import PriceHub, aggregate


def test_candle_cache_does_not_shorten_a_bigger_request():
    hub = PriceHub()
    assert hub.demo
    small = asyncio.run(hub.candles("BTCUSDT", "15m", 120))
    big = asyncio.run(hub.candles("BTCUSDT", "15m", 300))
    assert len(small) == 120 and len(big) == 300
    # a smaller request right after a bigger one is served from the cache, correctly trimmed
    again = asyncio.run(hub.candles("BTCUSDT", "15m", 50))
    assert len(again) == 50 and again[-1][0] == big[-1][0]


def test_aggregate_builds_4h_from_1h():
    h = 3600
    rows = [[0 * h, 10, 12, 9, 11, 1], [1 * h, 11, 15, 10, 14, 2],
            [2 * h, 14, 14, 8, 9, 3], [3 * h, 9, 13, 9, 12, 4], [4 * h, 12, 20, 12, 19, 5]]
    out = aggregate(rows, 4 * h)
    assert out[0] == [0, 10, 15, 8, 12, 10]   # open of first, high/low extremes, close of last, volume sum
    assert out[1] == [4 * h, 12, 20, 12, 19, 5]
