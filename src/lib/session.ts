import type { Candle, TimeframeId } from "./candles";
import {
  closePosition,
  flattenAll,
  modifyOrder,
  cancelOrder,
  equityAt,
  newEngine,
  placeOrder,
  processBar,
  type AccountConfig,
  type EngineEvent,
  type EngineState,
  type MarketCtx,
  type OrderRequest,
} from "./engine";
import { evaluatePropBar, newPropState, type PropAction, type PropState } from "./prop/engine";
import type { PropRules } from "./prop/presets";

export interface Drawing {
  id: string;
  kind: "hline" | "trend";
  points: { time: number; price: number }[];
  color: string;
}

export interface PropConfig {
  presetId: string | null;
  label: string;
  rules: PropRules;
}

export interface Session {
  version: 1;
  id: string;
  name: string;
  symbol: string;
  createdAt: number;
  updatedAt: number;
  /** Istante (secondi) da cui parte il replay. */
  startTime: number;
  /** Apertura dell'ultima candela da 1 minuto visibile; `null` prima di caricare i dati. */
  cursor: number | null;
  timeframe: TimeframeId;
  account: AccountConfig;
  engine: EngineState;
  prop: (PropConfig & { state: PropState }) | null;
  drawings: Drawing[];
  /** Numero del tentativo, per le sfide ripetute con le stesse regole. */
  attempt: number;
}

export type SessionStatus = "active" | "passed" | "failed";

export function sessionStatus(s: Session): SessionStatus {
  return s.prop ? s.prop.state.status : "active";
}

export function currentPhaseIndex(s: Session): number {
  return s.prop ? s.prop.state.phase : 0;
}

export function createSession(input: {
  id: string;
  name: string;
  symbol: string;
  startTime: number;
  timeframe: TimeframeId;
  account: AccountConfig;
  prop: PropConfig | null;
  attempt?: number;
  now?: number;
}): Session {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  return {
    version: 1,
    id: input.id,
    name: input.name,
    symbol: input.symbol,
    createdAt: now,
    updatedAt: now,
    startTime: input.startTime,
    cursor: null,
    timeframe: input.timeframe,
    account: input.account,
    engine: newEngine(input.account),
    prop: input.prop ? { ...input.prop, state: newPropState(input.account.initialBalance) } : null,
    drawings: [],
    attempt: input.attempt ?? 1,
  };
}

export interface StepResult {
  session: Session;
  events: EngineEvent[];
  propAction: PropAction;
  equity: number;
}

/** Avanza la sessione di una candela da 1 minuto. */
export function stepSession(session: Session, bar: Candle, ctx: MarketCtx): StepResult {
  const r = processBar(session.engine, bar, ctx);
  let engine = r.state;
  let prop = session.prop;
  let propAction: PropAction = "none";
  let equity = r.equity;

  if (prop && prop.state.status === "active") {
    const opened = r.events.filter((e) => e.kind === "filled").length;
    const closedPnl = r.events.filter((e) => e.kind === "closed").reduce((s, e) => s + e.order.pnl, 0);
    const openCount = engine.orders.filter((o) => o.status === "open").length;
    const ev = evaluatePropBar(prop.rules, prop.state, {
      time: bar.time + 60,
      balance: engine.balance,
      equity: r.equity,
      minEquity: r.minEquity,
      maxEquity: r.maxEquity,
      opened,
      closedPnl,
      openPositions: openCount,
    });
    propAction = ev.action;
    prop = { ...prop, state: ev.state };
    if (ev.action === "fail") {
      engine = flattenAll(engine, bar, ctx, "prop");
      equity = engine.balance;
    } else if (ev.action === "phase_passed") {
      // Nuova fase: ordini pendenti cancellati e saldo riportato al valore iniziale.
      engine = { ...flattenAll(engine, bar, ctx, "phase"), balance: session.account.initialBalance };
      equity = engine.balance;
    }
  }

  return {
    session: { ...session, engine, prop, cursor: bar.time },
    events: r.events,
    propAction,
    equity,
  };
}

export function canTrade(session: Session): boolean {
  return sessionStatus(session) === "active";
}

export function sessionPlaceOrder(session: Session, req: OrderRequest, bar: Candle, ctx: MarketCtx): { session: Session; error?: string } {
  if (!canTrade(session)) return { session, error: "La sfida è conclusa: non si possono inviare altri ordini." };
  const r = placeOrder(session.engine, req, bar, ctx);
  if (r.error || !r.order) return { session, error: r.error };
  const phase = currentPhaseIndex(session);
  const orders = r.state.orders.map((o) => (o.id === r.order!.id ? { ...o, phase } : o));
  let next: Session = { ...session, engine: { ...r.state, orders } };

  // Un ordine a mercato apre subito una posizione: conta come giorno di trading per la sfida.
  if (req.type === "market" && next.prop && next.prop.state.status === "active") {
    const ev = evaluatePropBar(next.prop.rules, next.prop.state, {
      time: bar.time + 60,
      balance: next.engine.balance,
      equity: next.prop.state.lastEquity,
      minEquity: next.prop.state.lastEquity,
      opened: 1,
      closedPnl: 0,
      openPositions: orders.filter((o) => o.status === "open").length,
    });
    next = { ...next, prop: { ...next.prop, state: ev.state } };
  }
  return { session: next };
}

export function sessionClosePosition(session: Session, id: number, bar: Candle, ctx: MarketCtx): Session {
  const before = session.engine.orders.find((o) => o.id === id);
  const engine = closePosition(session.engine, id, bar, ctx, "manual");
  let next: Session = { ...session, engine };
  const after = engine.orders.find((o) => o.id === id);
  if (next.prop && before?.status === "open" && after?.status === "closed") {
    const eq = equityAt(engine, bar.close, bar.time + 60, ctx);
    const ev = evaluatePropBar(next.prop.rules, next.prop.state, {
      time: bar.time + 60,
      balance: engine.balance,
      equity: eq,
      minEquity: eq,
      opened: 0,
      closedPnl: after.pnl,
      openPositions: engine.orders.filter((o) => o.status === "open").length,
    });
    next = { ...next, prop: { ...next.prop, state: ev.state } };
    if (ev.action === "phase_passed") {
      next = { ...next, engine: { ...flattenAll(next.engine, bar, ctx, "phase"), balance: session.account.initialBalance } };
    }
  }
  return next;
}

export function sessionModifyOrder(session: Session, id: number, changes: { sl?: number | null; tp?: number | null; price?: number }, bar: Candle, ctx: MarketCtx) {
  const r = modifyOrder(session.engine, id, changes, bar, ctx);
  return { session: { ...session, engine: r.state }, error: r.error };
}

export function sessionCancelOrder(session: Session, id: number): Session {
  return { ...session, engine: cancelOrder(session.engine, id) };
}

/** Nuovo tentativo con le stesse regole e lo stesso conto. */
export function retrySession(session: Session, id: string, startTime: number): Session {
  return createSession({
    id,
    name: session.name.replace(/ · tentativo \d+$/, "") + ` · tentativo ${session.attempt + 1}`,
    symbol: session.symbol,
    startTime,
    timeframe: session.timeframe,
    account: session.account,
    prop: session.prop ? { presetId: session.prop.presetId, label: session.prop.label, rules: session.prop.rules } : null,
    attempt: session.attempt + 1,
  });
}
