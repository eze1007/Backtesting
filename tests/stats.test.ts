import { describe, expect, it } from "vitest";
import { balanceCurve, computeStats, tradesToCsv } from "@/lib/stats";
import type { Order } from "@/lib/engine";

function trade(id: number, pnl: number, side: "buy" | "sell" = "buy"): Order {
  return {
    id, side, type: "market", lots: 1, price: 1, sl: 0.99, tp: 1.02, status: "closed", createdAt: id, openTime: id, openPrice: 1,
    closeTime: id * 100, closePrice: 1, closeReason: "manual", grossPnl: pnl, commission: 0, pnl,
  };
}

describe("statistiche", () => {
  it("calcola win rate, profit factor, expectancy e drawdown", () => {
    const s = computeStats([trade(1, 200), trade(2, -100), trade(3, -100), trade(4, 300, "sell")], 10_000);
    expect(s.trades).toBe(4);
    expect(s.winRate).toBe(0.5);
    expect(s.netProfit).toBe(300);
    expect(s.profitFactor).toBe(2.5);
    expect(s.expectancy).toBe(75);
    expect(s.maxDrawdown).toBe(200);
    expect(s.avgRR).toBe(2);
    expect(s.longTrades).toBe(3);
    expect(s.shortTrades).toBe(1);
  });

  it("gestisce l'assenza di operazioni", () => {
    const s = computeStats([], 10_000);
    expect(s.trades).toBe(0);
    expect(s.winRate).toBe(0);
  });

  it("costruisce la curva del saldo e il CSV", () => {
    const curve = balanceCurve([trade(1, 100), trade(2, -50)], 1000, 0);
    expect(curve.map((p) => p.balance)).toEqual([1000, 1100, 1050]);
    expect(tradesToCsv([trade(1, 100)], "EURUSD").split("\n")).toHaveLength(2);
  });
});
