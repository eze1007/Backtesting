import { describe, expect, it } from "vitest";
import { INSTRUMENTS, conversionSymbol, getInstrument, quoteConversion } from "@/lib/instruments";

describe("strumenti", () => {
  it("contiene 28 coppie forex, l'oro e le crypto", () => {
    expect(INSTRUMENTS.filter((i) => i.category === "forex")).toHaveLength(28);
    expect(getInstrument("XAUUSD").category).toBe("metal");
    expect(INSTRUMENTS.filter((i) => i.category === "crypto").length).toBeGreaterThanOrEqual(8);
    expect(new Set(INSTRUMENTS.map((i) => i.symbol)).size).toBe(INSTRUMENTS.length);
  });

  it("sa convertire ogni valuta di quotazione in USD", () => {
    for (const i of INSTRUMENTS) expect(() => quoteConversion(i)).not.toThrow();
    expect(quoteConversion(getInstrument("EURUSD"))).toEqual({ kind: "identity" });
    expect(quoteConversion(getInstrument("USDJPY"))).toEqual({ kind: "self" });
    expect(conversionSymbol(getInstrument("EURJPY"))).toBe("USDJPY");
    expect(conversionSymbol(getInstrument("EURGBP"))).toBe("GBPUSD");
  });
});
