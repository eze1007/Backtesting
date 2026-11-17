import { describe, expect, it } from "vitest";
import { evaluatePropBar, missingRequirements, newPropState, propLevels, tradingDay, type PropBarInput } from "@/lib/prop/engine";
import { customRules, describePhase, getPreset, PROP_PRESETS, resolveRules } from "@/lib/prop/presets";

const DAY = 86400;
const T = Date.UTC(2024, 0, 2, 9, 0) / 1000;

function input(over: Partial<PropBarInput>): PropBarInput {
  return { time: T, balance: 100_000, equity: 100_000, minEquity: 100_000, opened: 0, closedPnl: 0, openPositions: 0, ...over };
}

const rules = customRules({ phases: 2, profitTargetPct: 10, phase2TargetPct: 5, dailyLossPct: 5, maxLossPct: 10, minTradingDays: 2 });

describe("preset", () => {
  it("ci sono 6 prop firm diverse: 4 forex a 2 fasi e 2 futures a fase unica", () => {
    expect(PROP_PRESETS).toHaveLength(6);
    expect(new Set(PROP_PRESETS.map((p) => p.firm)).size).toBe(6);
    for (const p of PROP_PRESETS) {
      expect(p.rules.phases).toHaveLength(p.market === "forex" ? 2 : 1);
      expect(p.sizes.length).toBeGreaterThan(0);
      expect(() => tradingDay(T, p.rules.dayResetTimeZone, p.rules.dayResetHour)).not.toThrow();
      for (const size of p.sizes) expect(describePhase(resolveRules(p, size).phases[0], size)).toContain("target");
    }
    expect(getPreset("ftmo-2step")!.rules.phases[0].profitTargetPct).toBe(10);
  });

  it("le regole di Topstep dipendono dalla taglia del conto", () => {
    const p = getPreset("topstep-combine")!;
    const r50 = resolveRules(p, 50_000).phases[0];
    const r150 = resolveRules(p, 150_000).phases[0];
    expect((50_000 * r50.maxLossPct) / 100).toBeCloseTo(2_000);
    expect((150_000 * r150.maxLossPct) / 100).toBeCloseTo(4_500);
    expect((150_000 * r150.profitTargetPct) / 100).toBeCloseTo(9_000);
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

  it("con il cambio giorno alle 17:00 di New York la sera conta per il giorno dopo", () => {
    const evening = Date.UTC(2024, 0, 2, 23, 0) / 1000; // 18:00 a New York
    const afternoon = Date.UTC(2024, 0, 2, 21, 0) / 1000; // 16:00 a New York
    expect(tradingDay(afternoon, "America/New_York", 17)).toBe("2024-01-02");
    expect(tradingDay(evening, "America/New_York", 17)).toBe("2024-01-03");
  });
});

describe("perdita massima trailing", () => {
  const eod = customRules({ phases: 1, profitTargetPct: 50, dailyLossPct: 0, maxLossPct: 4, maxLossType: "trailing_eod", trailingStopsAtInitial: true, minTradingDays: 0 });
  const intraday = customRules({ phases: 1, profitTargetPct: 50, dailyLossPct: 0, maxLossPct: 5, maxLossType: "trailing_intraday", minTradingDays: 0 });

  it("a fine giornata il limite sale con il saldo di chiusura e si ferma al saldo iniziale", () => {
    let s = newPropState(50_000);
    s = evaluatePropBar(eod, s, input({ balance: 51_000, equity: 51_000, minEquity: 51_000 })).state;
    // Stesso giorno: il limite non è ancora salito
    expect(propLevels(eod, s).maxFloor).toBe(48_000);
    s = evaluatePropBar(eod, s, input({ time: T + DAY, balance: 51_000, equity: 51_000, minEquity: 51_000 })).state;
    expect(propLevels(eod, s).maxFloor).toBe(49_000);
    s = evaluatePropBar(eod, s, input({ time: T + DAY + 60, balance: 55_000, equity: 55_000, minEquity: 55_000 })).state;
    s = evaluatePropBar(eod, s, input({ time: T + 2 * DAY, balance: 55_000, equity: 55_000, minEquity: 55_000 })).state;
    // 55.000 − 2.000 = 53.000, ma il limite si ferma a 50.000
    expect(propLevels(eod, s).maxFloor).toBe(50_000);
    const r = evaluatePropBar(eod, s, input({ time: T + 2 * DAY + 60, balance: 55_000, equity: 50_500, minEquity: 49_999 }));
    expect(r.action).toBe("fail");
  });

  it("intraday il limite segue anche il profitto non realizzato", () => {
    let s = newPropState(50_000);
    s = evaluatePropBar(intraday, s, input({ balance: 50_000, equity: 51_000, minEquity: 50_500, maxEquity: 52_000, openPositions: 1 })).state;
    expect(propLevels(intraday, s).maxFloor).toBe(49_500);
    const r = evaluatePropBar(intraday, s, input({ time: T + 60, balance: 50_000, equity: 49_600, minEquity: 49_400, openPositions: 1 }));
    expect(r.action).toBe("fail");
    expect(r.state.failReason).toMatch(/Perdita massima/);
  });

  it("senza perdita giornaliera non fallisce per una giornata negativa", () => {
    const r = evaluatePropBar(intraday, newPropState(50_000), input({ balance: 48_000, equity: 48_000, minEquity: 47_600 }));
    expect(r.action).toBe("none");
  });
});

describe("regola di consistenza", () => {
  const rules50 = customRules({ phases: 1, profitTargetPct: 6, dailyLossPct: 0, maxLossPct: 10, minTradingDays: 1, consistencyPct: 50 });

  it("blocca il superamento finché il giorno migliore supera il 50% del profitto", () => {
    let s = newPropState(50_000);
    // Giorno 1: +2.500
    s = evaluatePropBar(rules50, s, input({ opened: 1, closedPnl: 2_500, balance: 52_500, equity: 52_500, minEquity: 52_500 })).state;
    // Giorno 2: +600, target 3.000 raggiunto ma il giorno migliore è l'81% del profitto
    let r = evaluatePropBar(rules50, s, input({ time: T + DAY, opened: 1, closedPnl: 600, balance: 53_100, equity: 53_100, minEquity: 53_100 }));
    expect(r.action).toBe("none");
    expect(missingRequirements(rules50, r.state).join(" ")).toMatch(/Consistenza/);
    // Giorno 3: +2.000, profitto 5.100: 2.500 ≤ 2.550, superata
    r = evaluatePropBar(rules50, r.state, input({ time: T + 2 * DAY, opened: 1, closedPnl: 2_000, balance: 55_100, equity: 55_100, minEquity: 55_100 }));
    expect(r.action).toBe("passed");
  });
});
