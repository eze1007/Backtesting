import type { PropRules, PhaseRules } from "./presets";

export type PropStatus = "active" | "passed" | "failed";

export interface PhaseResult {
  phase: number;
  name: string;
  status: "passed" | "failed";
  reason: string;
  time: number;
  balance: number;
}

export interface PropState {
  status: PropStatus;
  phase: number;
  initialBalance: number;
  /** Giorno di trading corrente (YYYY-MM-DD nel fuso dell'azienda). */
  day: string | null;
  dayStartBalance: number;
  dayStartEquity: number;
  /** Giorni con almeno un'operazione aperta, nella fase corrente. */
  tradingDays: string[];
  /** P&L chiuso per giorno, nella fase corrente. */
  dailyPnl: Record<string, number>;
  /** Equity minima toccata nella fase, per mostrare quanto si è andati vicini ai limiti. */
  lowestEquity: number;
  lastBalance: number;
  lastEquity: number;
  /** Massimo di riferimento per la perdita massima trailing (saldo di fine giornata o equity). */
  peak: number;
  results: PhaseResult[];
  failReason: string | null;
}

export interface PropBarInput {
  /** Istante di chiusura della candela da 1 minuto, in secondi. */
  time: number;
  balance: number;
  equity: number;
  minEquity: number;
  /** Equity migliore stimata dentro la candela (per il trailing intraday); se manca si usa `equity`. */
  maxEquity?: number;
  /** Operazioni aperte in questa candela. */
  opened: number;
  /** P&L netto delle operazioni chiuse in questa candela. */
  closedPnl: number;
  openPositions: number;
}

export type PropAction = "none" | "fail" | "phase_passed" | "passed";

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Giorno di trading (YYYY-MM-DD) di `time` nel fuso orario `tz`, con il cambio giorno all'ora `resetHour`.
 * Con resetHour = 17 le 18:00 di lunedì appartengono al giorno di trading di martedì.
 */
export function tradingDay(time: number, tz: string, resetHour = 0): string {
  let f = dayFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
    dayFormatters.set(tz, f);
  }
  const parts = f.formatToParts(new Date(time * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  if (resetHour <= 0 || Number(get("hour")) < resetHour) return date;
  const next = new Date(Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")) + 1));
  return next.toISOString().slice(0, 10);
}

export function newPropState(initialBalance: number): PropState {
  return {
    status: "active",
    phase: 0,
    initialBalance,
    day: null,
    dayStartBalance: initialBalance,
    dayStartEquity: initialBalance,
    tradingDays: [],
    dailyPnl: {},
    lowestEquity: initialBalance,
    lastBalance: initialBalance,
    lastEquity: initialBalance,
    peak: initialBalance,
    results: [],
    failReason: null,
  };
}

export function currentPhase(rules: PropRules, state: PropState): PhaseRules {
  return rules.phases[Math.min(state.phase, rules.phases.length - 1)];
}

/** Livelli in USD della fase corrente, utili per l'interfaccia. */
export function propLevels(rules: PropRules, state: PropState) {
  const p = currentPhase(rules, state);
  const init = state.initialBalance;
  const dailyBase = rules.dailyLossBase === "balance" ? state.dayStartBalance : Math.max(state.dayStartBalance, state.dayStartEquity);
  const maxLoss = (init * p.maxLossPct) / 100;
  let maxFloor = init - maxLoss;
  if ((p.maxLossType ?? "static") !== "static") {
    const peak = state.peak ?? init;
    maxFloor = peak - maxLoss;
    if (p.trailingStopsAtInitial) maxFloor = Math.min(maxFloor, init);
  }
  return {
    target: init * (1 + p.profitTargetPct / 100),
    dailyFloor: p.dailyLossPct > 0 ? dailyBase - (init * p.dailyLossPct) / 100 : -Infinity,
    maxFloor,
    profitableDays: profitableDays(rules, state),
    consistency: consistency(rules, state),
  };
}

/** Stato della regola di consistenza: giorno migliore rispetto al profitto totale. */
export function consistency(rules: PropRules, state: PropState): { required: boolean; ok: boolean; bestDay: number; maxBestDay: number } {
  const p = currentPhase(rules, state);
  const pct = p.consistencyPct ?? 0;
  const bestDay = Math.max(0, ...Object.values(state.dailyPnl));
  const profit = state.lastBalance - state.initialBalance;
  const maxBestDay = (Math.max(0, profit) * pct) / 100;
  return { required: pct > 0, ok: pct <= 0 || (profit > 0 && bestDay <= maxBestDay + 1e-6), bestDay, maxBestDay };
}

export function profitableDays(rules: PropRules, state: PropState): number {
  const p = currentPhase(rules, state);
  const min = (state.initialBalance * p.profitableDayPct) / 100;
  return Object.values(state.dailyPnl).filter((v) => v > 0 && v >= min).length;
}

function fmt(n: number) {
  return n.toLocaleString("it-IT", { style: "currency", currency: "USD" });
}

/**
 * Valuta le regole dopo una candela da 1 minuto.
 * Restituisce il nuovo stato e l'azione che il simulatore deve compiere.
 */
export function evaluatePropBar(rules: PropRules, state: PropState, bar: PropBarInput): { state: PropState; action: PropAction } {
  if (state.status !== "active") return { state, action: "none" };
  const s: PropState = { ...state, tradingDays: state.tradingDays, dailyPnl: { ...state.dailyPnl } };

  // Cambio di giornata: il punto di partenza è il saldo/equity di fine giornata precedente.
  const phaseRules = currentPhase(rules, s);
  const lossType = phaseRules.maxLossType ?? "static";
  const day = tradingDay(bar.time - 1, rules.dayResetTimeZone, rules.dayResetHour ?? 0);
  if (s.day !== day) {
    if (s.day !== null) {
      s.dayStartBalance = s.lastBalance;
      s.dayStartEquity = s.lastEquity;
      // Trailing a fine giornata: il massimo si aggiorna con il saldo di chiusura del giorno precedente.
      if (lossType === "trailing_eod") s.peak = Math.max(s.peak ?? s.initialBalance, s.lastBalance);
    }
    s.day = day;
  }
  // Trailing intraday: il massimo segue l'equity migliore, anche con posizioni aperte.
  if (lossType === "trailing_intraday") s.peak = Math.max(s.peak ?? s.initialBalance, bar.maxEquity ?? bar.equity, bar.balance);
  if (bar.opened > 0 && !s.tradingDays.includes(day)) s.tradingDays = [...s.tradingDays, day];
  if (bar.closedPnl !== 0) s.dailyPnl[day] = Math.round(((s.dailyPnl[day] ?? 0) + bar.closedPnl) * 100) / 100;

  s.lastBalance = bar.balance;
  s.lastEquity = bar.equity;
  s.lowestEquity = Math.min(s.lowestEquity, bar.minEquity);

  const phase = currentPhase(rules, s);
  const levels = propLevels(rules, s);

  if (bar.minEquity <= levels.maxFloor) {
    return fail(s, phase.name, `Perdita massima superata: l'equity è scesa a ${fmt(bar.minEquity)}, sotto il limite di ${fmt(levels.maxFloor)}.`, bar);
  }
  if (bar.minEquity <= levels.dailyFloor) {
    return fail(s, phase.name, `Perdita giornaliera superata: l'equity è scesa a ${fmt(bar.minEquity)}, sotto il limite di giornata di ${fmt(levels.dailyFloor)}.`, bar);
  }

  const targetReached = bar.balance >= levels.target && bar.openPositions === 0;
  const daysOk = s.tradingDays.length >= phase.minTradingDays;
  const profitDaysOk = profitableDays(rules, s) >= phase.minProfitableDays;
  const consistencyOk = levels.consistency.ok;
  if (targetReached && daysOk && profitDaysOk && consistencyOk) {
    const result: PhaseResult = {
      phase: s.phase,
      name: phase.name,
      status: "passed",
      reason: `Target raggiunto in ${s.tradingDays.length} giorni di trading.`,
      time: bar.time,
      balance: bar.balance,
    };
    const results = [...s.results, result];
    if (s.phase + 1 >= rules.phases.length) {
      return { state: { ...s, status: "passed", results }, action: "passed" };
    }
    // Nuova fase: si riparte dal saldo iniziale.
    const fresh = newPropState(s.initialBalance);
    return {
      state: { ...fresh, phase: s.phase + 1, results, day: s.day },
      action: "phase_passed",
    };
  }
  return { state: s, action: "none" };
}

function fail(s: PropState, name: string, reason: string, bar: PropBarInput): { state: PropState; action: PropAction } {
  const result: PhaseResult = { phase: s.phase, name, status: "failed", reason, time: bar.time, balance: bar.equity };
  return { state: { ...s, status: "failed", failReason: reason, results: [...s.results, result] }, action: "fail" };
}

/** Cosa manca per superare la fase corrente, in frasi brevi. */
export function missingRequirements(rules: PropRules, state: PropState): string[] {
  if (state.status !== "active") return [];
  const p = currentPhase(rules, state);
  const lv = propLevels(rules, state);
  const out: string[] = [];
  if (state.lastBalance < lv.target) out.push(`Mancano ${fmt(lv.target - state.lastBalance)} al target.`);
  const days = p.minTradingDays - state.tradingDays.length;
  if (days > 0) out.push(`Servono ancora ${days} giorni di trading.`);
  const pd = p.minProfitableDays - lv.profitableDays;
  if (pd > 0) out.push(`Servono ancora ${pd} giorni in profitto.`);
  const c = lv.consistency;
  if (c.required && !c.ok && state.lastBalance > state.initialBalance) {
    out.push(`Consistenza: il giorno migliore (${fmt(c.bestDay)}) supera il ${p.consistencyPct}% del profitto; serve un profitto totale di almeno ${fmt((c.bestDay * 100) / (p.consistencyPct ?? 100))}.`);
  }
  return out;
}
