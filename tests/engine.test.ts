import { describe, expect, it } from "vitest";
import { closePosition, equityAt, lotsForRisk, modifyOrder, newEngine, placeOrder, processBar } from "@/lib/engine";
import { account, bar, ctx } from "./helpers";

describe("ordini a mercato", () => {
  it("apre al prezzo di chiusura più lo spread e chiude in profitto al take profit", () => {
    const c = ctx("EURUSD", account({ spreadPips: 1 }));
    const s0 = newEngine(c.account);
    const b0 = bar(0, 1.1, 1.1005, 1.0995, 1.1);
    const r = placeOrder(s0, { side: "buy", type: "market", lots: 1, sl: 1.095, tp: 1.105 }, b0, c);
    expect(r.error).toBeUndefined();
    expect(r.order!.openPrice).toBeCloseTo(1.1001, 6);

    const res = processBar(r.state, bar(1, 1.1, 1.106, 1.0999, 1.104), c);
    const t = res.state.orders[0];
    expect(t.status).toBe("closed");
    expect(t.closeReason).toBe("tp");
    expect(t.closePrice).toBe(1.105);
    // (1.105 - 1.1001) * 100.000 = 490 USD
    expect(t.pnl).toBeCloseTo(490, 2);
    expect(res.state.balance).toBeCloseTo(100_490, 2);
  });

  it("una vendita chiude allo stop loss usando il prezzo ASK", () => {
    const c = ctx("EURUSD", account({ spreadPips: 1 }));
    const r = placeOrder(newEngine(c.account), { side: "sell", type: "market", lots: 0.5, sl: 1.102 }, bar(0, 1.1, 1.1, 1.1, 1.1), c);
    const res = processBar(r.state, bar(1, 1.1, 1.1025, 1.0999, 1.101), c);
    const t = res.state.orders[0];
    expect(t.closeReason).toBe("sl");
    expect(t.closePrice).toBe(1.102);
    expect(t.pnl).toBeCloseTo(-100, 2); // (1.1 - 1.102) * 50.000
  });

  it("se nella stessa candela tocca SL e TP sceglie il caso peggiore", () => {
    const c = ctx();
    const r = placeOrder(newEngine(c.account), { side: "buy", type: "market", lots: 1, sl: 1.099, tp: 1.101 }, bar(0, 1.1, 1.1, 1.1, 1.1), c);
    const res = processBar(r.state, bar(1, 1.1, 1.102, 1.098, 1.1), c);
    expect(res.state.orders[0].closeReason).toBe("sl");
  });

  it("con un gap oltre lo stop esegue all'apertura della candela", () => {
    const c = ctx();
    const r = placeOrder(newEngine(c.account), { side: "buy", type: "market", lots: 1, sl: 1.099 }, bar(0, 1.1, 1.1, 1.1, 1.1), c);
    const res = processBar(r.state, bar(1, 1.097, 1.0975, 1.096, 1.097), c);
    expect(res.state.orders[0].closePrice).toBe(1.097);
  });

  it("rifiuta SL e TP dal lato sbagliato", () => {
    const c = ctx();
    const r = placeOrder(newEngine(c.account), { side: "buy", type: "market", lots: 1, sl: 1.2 }, bar(0, 1.1, 1.1, 1.1, 1.1), c);
    expect(r.error).toMatch(/stop loss/);
  });

  it("applica le commissioni per lotto", () => {
    const c = ctx("EURUSD", account({ commissionPerLot: 7 }));
    const r = placeOrder(newEngine(c.account), { side: "buy", type: "market", lots: 2 }, bar(0, 1.1, 1.1, 1.1, 1.1), c);
    const s = closePosition(r.state, r.order!.id, bar(1, 1.1, 1.1, 1.1, 1.1), c);
    expect(s.orders[0].commission).toBe(14);
    expect(s.balance).toBe(100_000 - 14);
  });
});

describe("ordini pendenti", () => {
  it("un buy limit si esegue quando il prezzo scende al livello", () => {
    const c = ctx();
    const r = placeOrder(newEngine(c.account), { side: "buy", type: "limit", lots: 1, price: 1.098 }, bar(0, 1.1, 1.1, 1.1, 1.1), c);
    expect(r.state.orders[0].status).toBe("pending");
    let res = processBar(r.state, bar(1, 1.1, 1.1, 1.099, 1.099), c);
    expect(res.state.orders[0].status).toBe("pending");
    res = processBar(res.state, bar(2, 1.099, 1.099, 1.0975, 1.098), c);
    expect(res.state.orders[0].status).toBe("open");
    expect(res.state.orders[0].openPrice).toBe(1.098);
  });

  it("un sell stop si esegue alla rottura del livello", () => {
    const c = ctx();
    const r = placeOrder(newEngine(c.account), { side: "sell", type: "stop", lots: 1, price: 1.099 }, bar(0, 1.1, 1.1, 1.1, 1.1), c);
    const res = processBar(r.state, bar(1, 1.1, 1.1, 1.0985, 1.0988), c);
    expect(res.state.orders[0].status).toBe("open");
    expect(res.state.orders[0].openPrice).toBe(1.099);
  });

  it("rifiuta un limit dal lato sbagliato del prezzo", () => {
    const c = ctx();
    const r = placeOrder(newEngine(c.account), { side: "buy", type: "limit", lots: 1, price: 1.2 }, bar(0, 1.1, 1.1, 1.1, 1.1), c);
    expect(r.error).toBeDefined();
  });
});

describe("conversione valuta e rischio", () => {
  it("converte il P&L di USDJPY in dollari dividendo per il prezzo", () => {
    const c = { ...ctx("USDJPY"), rate: (_t: number, p: number) => 1 / p };
    const r = placeOrder(newEngine(c.account), { side: "buy", type: "market", lots: 1 }, bar(0, 150, 150, 150, 150), c);
    const s = closePosition(r.state, 1, bar(1, 151, 151, 151, 151), c);
    expect(s.orders[0].pnl).toBeCloseTo((1 * 100_000) / 151, 1);
  });

  it("calcola i lotti per rischiare una percentuale del saldo", () => {
    const c = ctx();
    // 1% di 100.000 = 1.000 USD, stop a 50 pip: 1.000 / (0.005 * 100.000) = 2 lotti
    expect(lotsForRisk(100_000, 1, 0.005, 1.1, 0, c)).toBe(2);
    expect(lotsForRisk(100_000, 0.33, 0.005, 1.1, 0, c)).toBe(0.66);
  });

  it("calcola l'equity con le posizioni aperte", () => {
    const c = ctx();
    const r = placeOrder(newEngine(c.account), { side: "buy", type: "market", lots: 1 }, bar(0, 1.1, 1.1, 1.1, 1.1), c);
    expect(equityAt(r.state, 1.101, 0, c)).toBeCloseTo(100_100, 2);
  });

  it("l'equity minima della candela tiene conto del minimo raggiunto", () => {
    const c = ctx();
    const r = placeOrder(newEngine(c.account), { side: "buy", type: "market", lots: 1 }, bar(0, 1.1, 1.1, 1.1, 1.1), c);
    const res = processBar(r.state, bar(1, 1.1, 1.1, 1.095, 1.1), c);
    expect(res.minEquity).toBeCloseTo(99_500, 2);
    expect(res.equity).toBeCloseTo(100_000, 2);
  });

  it("modifica lo stop di una posizione aperta", () => {
    const c = ctx();
    const r = placeOrder(newEngine(c.account), { side: "buy", type: "market", lots: 1 }, bar(0, 1.1, 1.1, 1.1, 1.1), c);
    const ok = modifyOrder(r.state, 1, { sl: 1.099 }, bar(0, 1.1, 1.1, 1.1, 1.1), c);
    expect(ok.error).toBeUndefined();
    expect(ok.state.orders[0].sl).toBe(1.099);
    const bad = modifyOrder(r.state, 1, { sl: 1.2 }, bar(0, 1.1, 1.1, 1.1, 1.1), c);
    expect(bad.error).toBeDefined();
  });
});
