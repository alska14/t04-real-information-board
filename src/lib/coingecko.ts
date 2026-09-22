// 그래프·통계·시뮬레이터 전용 조회. 채점 대상 daily_readings/receipts에는 쓰지 않는다.

export interface MarketSnapshot {
  price: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  marketCap: number;
  sparkline7d: number[];
  updatedAt: string;
}

let cache: { data: MarketSnapshot; expiresAt: number } | null = null;

export async function fetchMarketSnapshot(): Promise<MarketSnapshot | null> {
  if (cache && cache.expiresAt > Date.now()) return cache.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=krw&ids=bitcoin&sparkline=true&price_change_percentage=24h",
      { signal: controller.signal, cache: "no-store" }
    );
    clearTimeout(timer);
    if (!res.ok) return cache?.data ?? null;
    const arr = (await res.json()) as Array<{
      current_price: number;
      price_change_percentage_24h: number;
      high_24h: number;
      low_24h: number;
      total_volume: number;
      market_cap: number;
      sparkline_in_7d?: { price: number[] };
      last_updated: string;
    }>;
    const coin = arr[0];
    if (!coin) return cache?.data ?? null;

    const snapshot: MarketSnapshot = {
      price: coin.current_price,
      change24hPct: coin.price_change_percentage_24h ?? 0,
      high24h: coin.high_24h,
      low24h: coin.low_24h,
      volume24h: coin.total_volume,
      marketCap: coin.market_cap,
      sparkline7d: coin.sparkline_in_7d?.price ?? [],
      updatedAt: coin.last_updated,
    };
    cache = { data: snapshot, expiresAt: Date.now() + 8_000 };
    return snapshot;
  } catch {
    clearTimeout(timer);
    return cache?.data ?? null;
  }
}
