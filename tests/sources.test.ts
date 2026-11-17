import { describe, expect, it } from "vitest";
import { fetchBinanceApiRange, fetchBinanceArchiveMonth } from "@/lib/data/binance";

// Test di integrazione con le fonti reali: girano solo con RUN_SOURCE_TESTS=1 (in CI su GitHub).
const run = process.env.RUN_SOURCE_TESTS === "1";

describe.skipIf(!run)("fonti dati reali", () => {
  it("Binance: archivio mensile", async () => {
    const rows = await fetchBinanceArchiveMonth("BTCUSDT", "2024-01");
    expect(rows).not.toBeNull();
    expect(rows!.length).toBeGreaterThan(40_000);
    expect(rows![0].time).toBe(Date.UTC(2024, 0, 1) / 1000);
  }, 60_000);

  it("Binance: archivio 2025 con timestamp in microsecondi", async () => {
    const rows = await fetchBinanceArchiveMonth("ETHUSDT", "2025-02");
    expect(rows![0].time).toBe(Date.UTC(2025, 1, 1) / 1000);
  }, 60_000);

  it("Binance: API pubblica", async () => {
    const from = Math.floor(Date.now() / 1000) - 3 * 3600;
    const rows = await fetchBinanceApiRange("BTCUSDT", from, from + 1200 * 60);
    expect(rows.length).toBeGreaterThan(100);
  }, 60_000);

  it("Dukascopy: un giorno di EURUSD a 1 minuto", async () => {
    const { getHistoricalRates } = await import("dukascopy-node");
    const rows = (await getHistoricalRates({
      instrument: "eurusd",
      dates: { from: new Date("2024-01-03"), to: new Date("2024-01-04") },
      timeframe: "m1",
      priceType: "bid",
      format: "array",
      volumes: true,
      ignoreFlats: true,
      ...(process.env.CHROME_PATH ? { chromePath: process.env.CHROME_PATH } : {}),
    })) as unknown as number[][];
    expect(rows.length).toBeGreaterThan(1000);
    expect(rows[0][1]).toBeGreaterThan(1);
    expect(rows[0][1]).toBeLessThan(1.2);
  }, 300_000);
});
