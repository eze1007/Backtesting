import { describe, expect, it } from "vitest";
import { gzipSync, gunzipSync } from "node:zlib";
import { decodeYear, encodeYear } from "@/lib/data/format";
import { demoCandles } from "@/lib/data/demo";
import { getInstrument } from "@/lib/instruments";

describe("formato dei file annuali", () => {
  it("codifica e decodifica senza perdere dati", () => {
    const inst = getInstrument("EURUSD");
    const from = Date.UTC(2024, 0, 1) / 1000;
    const src = demoCandles(inst, from, from + 10 * 86400);
    const file = encodeYear("EURUSD", 2024, inst.digits, src);
    const back = decodeYear(JSON.parse(gunzipSync(gzipSync(JSON.stringify(file))).toString()));
    expect(back).toHaveLength(src.length);
    for (let i = 0; i < src.length; i += 97) {
      expect(back[i].time).toBe(src[i].time);
      expect(back[i].open).toBeCloseTo(src[i].open, 5);
      expect(back[i].high).toBeCloseTo(src[i].high, 5);
      expect(back[i].low).toBeCloseTo(src[i].low, 5);
      expect(back[i].close).toBeCloseTo(src[i].close, 5);
    }
  });

  it("scarta i duplicati e ordina per tempo", () => {
    const c = (t: number) => ({ time: t, open: 1, high: 1.1, low: 0.9, close: 1, volume: 0 });
    const file = encodeYear("X", 2024, 2, [c(180), c(60), c(60), c(120)]);
    expect(decodeYear(file).map((k) => k.time)).toEqual([60, 120, 180]);
  });

  it("i dati demo saltano il weekend per il forex ma non per le crypto", () => {
    const sat = Date.UTC(2024, 0, 6, 12) / 1000;
    expect(demoCandles(getInstrument("EURUSD"), sat, sat + 3600)).toHaveLength(0);
    expect(demoCandles(getInstrument("BTCUSDT"), sat, sat + 3600)).toHaveLength(60);
  });
});
