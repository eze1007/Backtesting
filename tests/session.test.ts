import { describe, expect, it } from "vitest";
import { createSession, retrySession, sessionClosePosition, sessionPlaceOrder, stepSession } from "@/lib/session";
import { customRules } from "@/lib/prop/presets";
import { account, bar, ctx, T0 } from "./helpers";

const rules = customRules({ phases: 2, profitTargetPct: 1, phase2TargetPct: 1, dailyLossPct: 2, maxLossPct: 4, minTradingDays: 1 });

function propSession() {
  return createSession({
    id: "s1", name: "Prova", symbol: "EURUSD", startTime: T0, timeframe: "5m",
    account: account({ initialBalance: 100_000 }), prop: { presetId: null, label: "Personalizzata", rules },
  });
}

describe("sessione con sfida prop", () => {
  it("chiude le posizioni e blocca il trading quando la sfida fallisce", () => {
    const c = ctx();
    let s = propSession();
    s = sessionPlaceOrder(s, { side: "buy", type: "market", lots: 10 }, bar(0, 1.1, 1.1, 1.1, 1.1), c).session;
    // 10 lotti, il prezzo scende di 25 pip: −2.500 USD, oltre il 2% giornaliero
    const r = stepSession(s, bar(1, 1.1, 1.1, 1.0975, 1.098), c);
    expect(r.propAction).toBe("fail");
    expect(r.session.engine.orders[0].status).toBe("closed");
    expect(r.session.engine.orders[0].closeReason).toBe("prop");
    const again = sessionPlaceOrder(r.session, { side: "buy", type: "market", lots: 1 }, bar(2, 1.1, 1.1, 1.1, 1.1), c);
    expect(again.error).toBeDefined();
  });

  it("passa alla fase 2 e riporta il saldo al valore iniziale", () => {
    const c = ctx();
    let s = propSession();
    s = sessionPlaceOrder(s, { side: "buy", type: "market", lots: 10 }, bar(0, 1.1, 1.1, 1.1, 1.1), c).session;
    s = stepSession(s, bar(1, 1.1, 1.1012, 1.1, 1.1011), c).session;
    s = sessionClosePosition(s, 1, bar(1, 1.1, 1.1012, 1.1, 1.1011), c);
    expect(s.prop!.state.phase).toBe(1);
    expect(s.engine.balance).toBe(100_000);
    expect(s.engine.orders[0].phase).toBe(0);
    const next = sessionPlaceOrder(s, { side: "sell", type: "market", lots: 1 }, bar(2, 1.1, 1.1, 1.1, 1.1), c).session;
    expect(next.engine.orders[1].phase).toBe(1);
  });

  it("un nuovo tentativo riparte con le stesse regole", () => {
    const s = retrySession(propSession(), "s2", T0 + 86400 * 30);
    expect(s.attempt).toBe(2);
    expect(s.name).toBe("Prova · tentativo 2");
    expect(s.prop!.state.status).toBe("active");
    expect(s.engine.balance).toBe(100_000);
  });
});
