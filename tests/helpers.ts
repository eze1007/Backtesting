import type { Candle } from "@/lib/candles";
import type { AccountConfig, MarketCtx } from "@/lib/engine";
import { getInstrument } from "@/lib/instruments";

export const T0 = Date.UTC(2024, 0, 2, 10, 0) / 1000; // martedì 2 gennaio 2024, 10:00 UTC

export function bar(i: number, o: number, h: number, l: number, c: number): Candle {
  return { time: T0 + i * 60, open: o, high: h, low: l, close: c, volume: 1 };
}

export function account(over: Partial<AccountConfig> = {}): AccountConfig {
  return { initialBalance: 100_000, spreadPips: 0, commissionPerLot: 0, commissionPct: 0, ...over };
}

export function ctx(symbol = "EURUSD", acc: AccountConfig = account(), rate = 1): MarketCtx {
  return { inst: getInstrument(symbol), account: acc, rate: () => rate };
}
