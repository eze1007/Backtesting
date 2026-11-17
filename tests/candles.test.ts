import { describe, expect, it } from "vitest";
import { addMonths, aggregate, bucketStart, indexAtOrBefore, mergeInto, monthKey, monthRange, type Candle } from "@/lib/candles";

const mk = (min: number, o: number, h: number, l: number, c: number): Candle => ({ time: 1_700_000_040 - (1_700_000_040 % 3600) + min * 60, open: o, high: h, low: l, close: c, volume: 1 });

describe("aggregazione", () => {
  it("unisce le candele da 1 minuto in candele da 5", () => {
    const src = [mk(0, 1, 2, 0.5, 1.5), mk(1, 1.5, 3, 1, 2), mk(4, 2, 2.5, 0.2, 1), mk(5, 1, 1.1, 0.9, 1.05)];
    const out = aggregate(src, 5);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ open: 1, high: 3, low: 0.2, close: 1, volume: 3 });
    expect(out[1]).toMatchObject({ open: 1, close: 1.05 });
    expect(out[0].time % 300).toBe(0);
  });

  it("l'aggiornamento incrementale dà lo stesso risultato dell'aggregazione completa", () => {
    const src = Array.from({ length: 130 }, (_, i) => mk(i, 1 + i / 100, 1.02 + i / 100, 0.99 + i / 100, 1.01 + i / 100));
    const inc: Candle[] = [];
    for (const c of src) mergeInto(inc, c, 60);
    expect(inc).toEqual(aggregate(src, 60));
  });

  it("calcola l'inizio del bucket", () => {
    expect(bucketStart(3600 * 5 + 120, 60)).toBe(3600 * 5);
    expect(bucketStart(86400 * 3 + 5000, 1440)).toBe(86400 * 3);
  });
});

describe("mesi e ricerca", () => {
  it("gestisce le chiavi dei mesi", () => {
    expect(monthKey(Date.UTC(2023, 11, 31, 23, 59) / 1000)).toBe("2023-12");
    expect(addMonths("2023-12", 1)).toBe("2024-01");
    expect(addMonths("2024-01", -1)).toBe("2023-12");
    expect(addMonths("2024-03", -14)).toBe("2023-01");
    const r = monthRange("2024-02");
    expect(r.to - r.from).toBe(29 * 86400);
  });

  it("trova l'ultima candela non successiva a un istante", () => {
    const arr = [{ time: 10 }, { time: 20 }, { time: 30 }];
    expect(indexAtOrBefore(arr, 5)).toBe(-1);
    expect(indexAtOrBefore(arr, 20)).toBe(1);
    expect(indexAtOrBefore(arr, 99)).toBe(2);
  });
});
