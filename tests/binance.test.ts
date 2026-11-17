import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { fetchBinanceApiRange, parseKlinesCsv, parseMonthlyZip, toSeconds } from "@/lib/data/binance";

describe("Binance", () => {
  it("normalizza millisecondi e microsecondi", () => {
    expect(toSeconds(1704067200000)).toBe(1704067200);
    expect(toSeconds(1735689600000000)).toBe(1735689600);
  });

  it("legge il CSV, anche con intestazione", () => {
    const csv = "open_time,open,high,low,close,volume\n1704067200000,42283.58,42298.62,42261.02,42298.61,35.92\n1704067260000,42298.62,42320,42298.61,42320,21.5\n";
    const rows = parseKlinesCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ time: 1704067200, open: 42283.58, high: 42298.62, low: 42261.02, close: 42298.61, volume: 35.92 });
  });

  it("legge l'archivio mensile zip", () => {
    const zip = zipSync({ "BTCUSDT-1m-2025-01.csv": strToU8("1735689600000000,1,2,0.5,1.5,10\n") });
    expect(parseMonthlyZip(zip)[0].time).toBe(1735689600);
  });

  it("pagina le richieste all'API", async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      const start = Number(new URL(url).searchParams.get("startTime"));
      const end = Number(new URL(url).searchParams.get("endTime"));
      const rows = [];
      for (let t = start; t <= end && rows.length < 1000; t += 60000) rows.push([t, "1", "2", "0.5", "1.5", "3"]);
      return new Response(JSON.stringify(rows));
    }) as unknown as typeof fetch;
    const from = 1704067200;
    const out = await fetchBinanceApiRange("BTCUSDT", from, from + 1500 * 60, fake);
    expect(out).toHaveLength(1500);
    expect(calls).toHaveLength(2);
    expect(out[1499].time).toBe(from + 1499 * 60);
  });
});
