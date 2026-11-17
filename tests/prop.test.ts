import { describe, expect, it } from "vitest";
import { evaluatePropBar, missingRequirements, newPropState, propLevels, tradingDay, type PropBarInput } from "@/lib/prop/engine";
import { customRules, getPreset, PROP_PRESETS } from "@/lib/prop/presets";

const DAY = 86400;
const T = Date.UTC(2024, 0, 2, 9, 0) / 1000;

function input(over: Partial<PropBarInput>): PropBarInput {
  return { time: T, balance: 100_000, equity: 100_000, minEquity: 100_000, opened: 0, closedPnl: 0, openPositions: 0, ...over };
}

const rules = customRules({ phases: 2, profitTargetPct: 10, phase2TargetPct: 5, dailyLossPct: 5, maxLossPct: 10, minTradingDays: 2 });

describe("preset", () => {
  it("ci sono 4 prop firm diverse, tutte con 2 fasi", () => {
    expect(PROP_PRESETS).toHaveLength(4);
    expect(new Set(PROP_PRESETS.map((p) => p.firm)).size).toBe(4);
    for (const p of PROP_PRESETS) {
      expect(p.rules.phases).toHaveLength(2);
      expect(p.sizes.length).toBeGreaterThan(0);
      expect(() => tradingDay(T, p.rules.dayResetTimeZone)).not.toThrow();
    }
    expect(getPreset("ftmo-2step")!.rules.phases[0].profitTargetPct).toBe(10);
  });
});

describe("regole della sfida", () => {
  it("fallisce quando l'equity scende sotto la perdita massima", () => {
    const r = evaluatePropBar(rules, newPropState(100_000), input({ minEquity: 89_999, equity: 92_000 }));
    expect(r.action).toBe("fail");
    expect(r.state.failReason).toMatch(/Perdita massima/);
  });

  it("fallisce quando la perdita del giorno supera il 5%", () => {
    const r = evaluatePropBar(rules, newPropState(100_000), input({ minEquity: 94_999 }));
    expect(r.action).toBe("fail");
    expect(r.state.failReason).toMatch(/giornaliera/);
  });

  it("il limite giornaliero riparte dal saldo di fine giornata precedente", () => {
    let s = newPropState(100_000);
    s = evaluatePropBar(rules, s, input({ balance: 104_000, equity: 104_000, minEquity: 104_000 })).state;
    // Giorno dopo: il limite è 104.000 − 5.000 = 99.000
    const next = evaluatePropBar(rules, s, input({ time: T + DAY, balance: 104_000, equity: 99_500, minEquity: 99_500 }));
    expect(next.action).toBe("none");
    expect(propLevels(rules, next.state).dailyFloor).toBe(99_000);
    const fail = evaluatePropBar(rules, next.state, input({ time: T + DAY + 60, balance: 104_000, equity: 98_900, minEquity: 98_900 }));
    expect(fail.action).toBe("fail");
  });

  it("con base 'max_balance_equity' usa l'equity se più alta del saldo", () => {
    const r2 = { ...rules, dailyLossBase: "max_balance_equity" as const };
    let s = newPropState(100_000);
    s = evaluatePropBar(r2, s, input({ balance: 100_000, equity: 103_000, minEquity: 103_000, openPositions: 1 })).state;
    s = evaluatePropBar(r2, s, input({ time: T + DAY, balance: 100_000, equity: 103_000, minEquity: 103_000, openPositions: 1 })).state;
    expect(propLevels(r2, s).dailyFloor).toBe(98_000);
  });

  it("supera la fase 1 solo con target, posizioni chiuse e giorni minimi, poi passa alla fase 2", () => {
    let s = newPropState(100_000);
    s = evaluatePropBar(rules, s, input({ opened: 1, openPositions: 1 })).state;
    // Target raggiunto ma un solo giorno di trading
    let r = evaluatePropBar(rules, s, input({ time: T + 600, balance: 110_500, equity: 110_500, minEquity: 110_500, closedPnl: 10_500 }));
    expect(r.action).toBe("none");
    expect(missingRequirements(rules, r.state)).toEqual(["Servono ancora 1 giorni di trading."]);
    // Secondo giorno con un'operazione
    r = evaluatePropBar(rules, r.state, input({ time: T + DAY, balance: 110_500, equity: 110_500, minEquity: 110_500, opened: 1, openPositions: 1 }));
    expect(r.action).toBe("none");
    r = evaluatePropBar(rules, r.state, input({ time: T + DAY + 60, balance: 110_600, equity: 110_600, minEquity: 110_600, closedPnl: 100 }));
    expect(r.action).toBe("phase_passed");
    expect(r.state.phase).toBe(1);
    expect(r.state.results[0].status).toBe("passed");
    expect(r.state.tradingDays).toEqual([]);
  });

  it("dopo l'ultima fase la sfida è superata", () => {
    const one = customRules({ phases: 1, profitTargetPct: 5, dailyLossPct: 5, maxLossPct: 10, minTradingDays: 1 });
    let s = newPropState(10_000);
    s = evaluatePropBar(one, s, input({ balance: 10_000, equity: 10_000, minEquity: 10_000, opened: 1, openPositions: 1 })).state;
    const r = evaluatePropBar(one, s, input({ time: T + 60, balance: 10_600, equity: 10_600, minEquity: 10_600, closedPnl: 600 }));
    expect(r.action).toBe("passed");
    expect(r.state.status).toBe("passed");
  });

  it("conta i giorni in profitto con la soglia minima", () => {
    const p = getPreset("the5ers-highstakes")!;
    let s = newPropState(100_000);
    s = evaluatePropBar(p.rules, s, input({ closedPnl: 300 })).state; // +0,3%: non basta
    s = evaluatePropBar(p.rules, s, input({ time: T + DAY, closedPnl: 600 })).state; // +0,6%: conta
    expect(propLevels(p.rules, s).profitableDays).toBe(1);
  });

  it("il giorno di trading segue il fuso orario dell'azienda", () => {
    // 23:30 UTC di inverno = 00:30 a Praga del giorno dopo
    const t = Date.UTC(2024, 0, 2, 23, 30) / 1000;
    expect(tradingDay(t, "UTC")).toBe("2024-01-02");
    expect(tradingDay(t, "Europe/Prague")).toBe("2024-01-03");
  });
});
