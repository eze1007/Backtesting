import type { Candle } from "./candles";
import type { Instrument } from "./instruments";

export type Side = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop";
export type OrderStatus = "pending" | "open" | "closed" | "cancelled";
export type CloseReason = "sl" | "tp" | "manual" | "prop" | "phase";

export interface Order {
  id: number;
  side: Side;
  type: OrderType;
  lots: number;
  /** Prezzo richiesto per limit e stop; per market è il prezzo al momento dell'invio. */
  price: number;
  sl: number | null;
  tp: number | null;
  status: OrderStatus;
  createdAt: number;
  openTime: number | null;
  openPrice: number | null;
  closeTime: number | null;
  closePrice: number | null;
  closeReason: CloseReason | null;
  /** P&L lordo in USD (senza commissioni). */
  grossPnl: number;
  commission: number;
  /** P&L netto in USD. */
  pnl: number;
  /** Fase della sfida prop in cui è stato inviato l'ordine (0 se non è una sfida). */
  phase?: number;
}

export interface AccountConfig {
  initialBalance: number;
  /** Spread in pip, aggiunto al prezzo BID per ottenere l'ASK. */
  spreadPips: number;
  /** Commissione andata e ritorno in USD per lotto. */
  commissionPerLot: number;
  /** Commissione andata e ritorno in % del controvalore. */
  commissionPct: number;
}

export interface EngineState {
  balance: number;
  orders: Order[];
  nextId: number;
}

/**
 * Contesto di mercato. I prezzi delle candele sono BID.
 * `rate(time, price)` restituisce il cambio da valuta di quotazione a USD.
 */
export interface MarketCtx {
  inst: Instrument;
  account: AccountConfig;
  rate: (time: number, instrumentPrice: number) => number;
}

export interface EngineEvent {
  kind: "filled" | "closed" | "cancelled";
  order: Order;
}

export interface BarResult {
  state: EngineState;
  events: EngineEvent[];
  /** Equity alla chiusura della candela. */
  equity: number;
  /** Equity peggiore stimata dentro la candela (per le regole prop). */
  minEquity: number;
}

export interface OrderRequest {
  side: Side;
  type: OrderType;
  lots: number;
  price?: number;
  sl?: number | null;
  tp?: number | null;
}

export function newEngine(account: AccountConfig): EngineState {
  return { balance: account.initialBalance, orders: [], nextId: 1 };
}

export function spreadOf(ctx: MarketCtx): number {
  return ctx.account.spreadPips * ctx.inst.pipSize;
}

const dir = (side: Side) => (side === "buy" ? 1 : -1);

/** Prezzo a cui si apre una posizione partendo dal prezzo BID. */
function entrySidePrice(side: Side, bid: number, spread: number) {
  return side === "buy" ? bid + spread : bid;
}
/** Prezzo a cui si chiude una posizione partendo dal prezzo BID. */
function exitSidePrice(side: Side, bid: number, spread: number) {
  return side === "buy" ? bid : bid + spread;
}

function round(n: number, digits = 2) {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

export function grossPnlUsd(order: Pick<Order, "side" | "lots" | "openPrice">, exitPrice: number, time: number, ctx: MarketCtx): number {
  if (order.openPrice == null) return 0;
  const diff = (exitPrice - order.openPrice) * dir(order.side);
  return diff * order.lots * ctx.inst.contractSize * ctx.rate(time, exitPrice);
}

export function commissionUsd(order: Pick<Order, "lots" | "openPrice">, time: number, ctx: MarketCtx): number {
  const perLot = ctx.account.commissionPerLot * order.lots;
  const notional = (order.openPrice ?? 0) * order.lots * ctx.inst.contractSize * ctx.rate(time, order.openPrice ?? 0);
  const pct = (ctx.account.commissionPct / 100) * notional;
  return round(perLot + pct);
}

/** P&L flottante in USD di una posizione aperta, al prezzo BID `bid`. */
export function floatingPnl(order: Order, bid: number, time: number, ctx: MarketCtx): number {
  if (order.status !== "open") return 0;
  const exit = exitSidePrice(order.side, bid, spreadOf(ctx));
  return grossPnlUsd(order, exit, time, ctx) - commissionUsd(order, time, ctx);
}

export function equityAt(state: EngineState, bid: number, time: number, ctx: MarketCtx): number {
  let eq = state.balance;
  for (const o of state.orders) if (o.status === "open") eq += floatingPnl(o, bid, time, ctx);
  return eq;
}

export function openPositions(state: EngineState): Order[] {
  return state.orders.filter((o) => o.status === "open");
}
export function pendingOrders(state: EngineState): Order[] {
  return state.orders.filter((o) => o.status === "pending");
}
export function closedTrades(state: EngineState): Order[] {
  return state.orders.filter((o) => o.status === "closed");
}

/** Controlla che SL e TP siano dal lato giusto rispetto al prezzo di ingresso. */
export function validateLevels(side: Side, entry: number, sl: number | null | undefined, tp: number | null | undefined): string | null {
  if (sl != null) {
    if (side === "buy" && sl >= entry) return "Per un acquisto lo stop loss deve stare sotto il prezzo di ingresso.";
    if (side === "sell" && sl <= entry) return "Per una vendita lo stop loss deve stare sopra il prezzo di ingresso.";
  }
  if (tp != null) {
    if (side === "buy" && tp <= entry) return "Per un acquisto il take profit deve stare sopra il prezzo di ingresso.";
    if (side === "sell" && tp >= entry) return "Per una vendita il take profit deve stare sotto il prezzo di ingresso.";
  }
  return null;
}

/**
 * Invia un ordine. `bar` è l'ultima candela da 1 minuto visibile: un ordine a mercato
 * viene eseguito alla sua chiusura (più lo spread per gli acquisti).
 */
export function placeOrder(state: EngineState, req: OrderRequest, bar: Candle, ctx: MarketCtx): { state: EngineState; order?: Order; error?: string } {
  const { inst } = ctx;
  if (!(req.lots > 0)) return { state, error: "La dimensione deve essere maggiore di zero." };
  if (req.lots < inst.minLot - 1e-9) return { state, error: `La dimensione minima è ${inst.minLot} lotti.` };
  const spread = spreadOf(ctx);
  const sl = req.sl ?? null;
  const tp = req.tp ?? null;
  const time = bar.time + 60;

  if (req.type === "market") {
    const fill = entrySidePrice(req.side, bar.close, spread);
    const err = validateLevels(req.side, fill, sl, tp);
    if (err) return { state, error: err };
    const order: Order = {
      ...blankOrder(state.nextId, req, fill, time),
      status: "open",
      openTime: time,
      openPrice: fill,
    };
    return { state: { ...state, orders: [...state.orders, order], nextId: state.nextId + 1 }, order };
  }

  if (req.price == null || !(req.price > 0)) return { state, error: "Indica il prezzo dell'ordine." };
  const current = entrySidePrice(req.side, bar.close, spread);
  if (req.type === "limit") {
    if (req.side === "buy" && req.price >= current) return { state, error: "Un buy limit va messo sotto il prezzo attuale." };
    if (req.side === "sell" && req.price <= current) return { state, error: "Un sell limit va messo sopra il prezzo attuale." };
  } else {
    if (req.side === "buy" && req.price <= current) return { state, error: "Un buy stop va messo sopra il prezzo attuale." };
    if (req.side === "sell" && req.price >= current) return { state, error: "Un sell stop va messo sotto il prezzo attuale." };
  }
  const err = validateLevels(req.side, req.price, sl, tp);
  if (err) return { state, error: err };
  const order = blankOrder(state.nextId, req, req.price, time);
  return { state: { ...state, orders: [...state.orders, order], nextId: state.nextId + 1 }, order };
}

function blankOrder(id: number, req: OrderRequest, price: number, time: number): Order {
  return {
    id,
    side: req.side,
    type: req.type,
    lots: req.lots,
    price,
    sl: req.sl ?? null,
    tp: req.tp ?? null,
    status: "pending",
    createdAt: time,
    openTime: null,
    openPrice: null,
    closeTime: null,
    closePrice: null,
    closeReason: null,
    grossPnl: 0,
    commission: 0,
    pnl: 0,
  };
}

function closeAt(order: Order, exitPrice: number, time: number, reason: CloseReason, ctx: MarketCtx): Order {
  const gross = round(grossPnlUsd(order, exitPrice, time, ctx));
  const commission = commissionUsd(order, time, ctx);
  return {
    ...order,
    status: "closed",
    closeTime: time,
    closePrice: exitPrice,
    closeReason: reason,
    grossPnl: gross,
    commission,
    pnl: round(gross - commission),
  };
}

export function modifyOrder(state: EngineState, id: number, changes: { sl?: number | null; tp?: number | null; price?: number }, bar: Candle, ctx: MarketCtx): { state: EngineState; error?: string } {
  const o = state.orders.find((x) => x.id === id);
  if (!o || (o.status !== "open" && o.status !== "pending")) return { state, error: "Ordine non trovato." };
  const next: Order = { ...o, ...changes };
  if (o.status === "open") {
    next.price = o.price;
    // Per una posizione aperta SL e TP vanno confrontati con il prezzo attuale di uscita.
    const exit = exitSidePrice(o.side, bar.close, spreadOf(ctx));
    if (next.sl != null && ((o.side === "buy" && next.sl >= exit) || (o.side === "sell" && next.sl <= exit)))
      return { state, error: "Lo stop loss è oltre il prezzo attuale." };
    if (next.tp != null && ((o.side === "buy" && next.tp <= exit) || (o.side === "sell" && next.tp >= exit)))
      return { state, error: "Il take profit è oltre il prezzo attuale." };
  } else {
    const err = validateLevels(o.side, next.price, next.sl, next.tp);
    if (err) return { state, error: err };
  }
  return { state: { ...state, orders: state.orders.map((x) => (x.id === id ? next : x)) } };
}

export function cancelOrder(state: EngineState, id: number): EngineState {
  return {
    ...state,
    orders: state.orders.map((o) => (o.id === id && o.status === "pending" ? { ...o, status: "cancelled" as const } : o)),
  };
}

/** Chiude una posizione al prezzo di chiusura della candela `bar`. */
export function closePosition(state: EngineState, id: number, bar: Candle, ctx: MarketCtx, reason: CloseReason = "manual"): EngineState {
  const o = state.orders.find((x) => x.id === id);
  if (!o || o.status !== "open") return state;
  const exit = exitSidePrice(o.side, bar.close, spreadOf(ctx));
  const closed = closeAt(o, exit, bar.time + 60, reason, ctx);
  return {
    ...state,
    balance: round(state.balance + closed.pnl),
    orders: state.orders.map((x) => (x.id === id ? closed : x)),
  };
}

/** Chiude tutte le posizioni e cancella gli ordini pendenti. */
export function flattenAll(state: EngineState, bar: Candle, ctx: MarketCtx, reason: CloseReason): EngineState {
  let s = state;
  for (const o of state.orders) {
    if (o.status === "open") s = closePosition(s, o.id, bar, ctx, reason);
    else if (o.status === "pending") s = cancelOrder(s, o.id);
  }
  return s;
}

/**
 * Elabora una nuova candela da 1 minuto: esegue gli ordini pendenti, poi controlla SL e TP.
 * Se nella stessa candela vengono toccati sia lo SL sia il TP si assume il caso peggiore (SL),
 * a meno che l'apertura della candela non abbia già superato uno dei due livelli.
 */
export function processBar(state: EngineState, bar: Candle, ctx: MarketCtx): BarResult {
  const spread = spreadOf(ctx);
  const events: EngineEvent[] = [];
  const time = bar.time + 60;
  let balance = state.balance;
  let worstFloating = 0;
  const startBalance = state.balance;

  const orders = state.orders.map((o) => {
    let cur = o;
    if (cur.status === "pending") {
      const askOpen = bar.open + spread;
      const askLow = bar.low + spread;
      const askHigh = bar.high + spread;
      let fill: number | null = null;
      if (cur.type === "limit") {
        if (cur.side === "buy" && askLow <= cur.price) fill = Math.min(cur.price, askOpen);
        if (cur.side === "sell" && bar.high >= cur.price) fill = Math.max(cur.price, bar.open);
      } else if (cur.type === "stop") {
        if (cur.side === "buy" && askHigh >= cur.price) fill = Math.max(cur.price, askOpen);
        if (cur.side === "sell" && bar.low <= cur.price) fill = Math.min(cur.price, bar.open);
      }
      if (fill == null) return cur;
      cur = { ...cur, status: "open", openTime: time, openPrice: fill };
      events.push({ kind: "filled", order: cur });
    }
    if (cur.status !== "open") return cur;

    // Prezzi di uscita della candela per questo lato.
    const exOpen = exitSidePrice(cur.side, bar.open, spread);
    const exLow = exitSidePrice(cur.side, bar.low, spread);
    const exHigh = exitSidePrice(cur.side, bar.high, spread);
    const isBuy = cur.side === "buy";
    const slHit = cur.sl != null && (isBuy ? exLow <= cur.sl : exHigh >= cur.sl);
    const tpHit = cur.tp != null && (isBuy ? exHigh >= cur.tp : exLow <= cur.tp);

    let exit: { price: number; reason: CloseReason } | null = null;
    if (slHit && tpHit) {
      const gapTp = isBuy ? exOpen >= cur.tp! : exOpen <= cur.tp!;
      exit = gapTp ? { price: exOpen, reason: "tp" } : { price: isBuy ? Math.min(cur.sl!, exOpen) : Math.max(cur.sl!, exOpen), reason: "sl" };
    } else if (slHit) {
      exit = { price: isBuy ? Math.min(cur.sl!, exOpen) : Math.max(cur.sl!, exOpen), reason: "sl" };
    } else if (tpHit) {
      exit = { price: isBuy ? Math.max(cur.tp!, exOpen) : Math.min(cur.tp!, exOpen), reason: "tp" };
    }

    // Prezzo peggiore raggiunto mentre la posizione era aperta.
    let worst = isBuy ? exLow : exHigh;
    if (exit?.reason === "sl") worst = exit.price;
    worstFloating += grossPnlUsd(cur, worst, time, ctx) - commissionUsd(cur, time, ctx);

    if (!exit) return cur;
    const closed = closeAt(cur, exit.price, time, exit.reason, ctx);
    balance = round(balance + closed.pnl);
    events.push({ kind: "closed", order: closed });
    return closed;
  });

  const next: EngineState = { ...state, balance, orders };
  const equity = equityAt(next, bar.close, time, ctx);
  const minEquity = Math.min(equity, startBalance + worstFloating);
  return { state: next, events, equity, minEquity };
}

/** Lotti per rischiare `riskPct`% del saldo con lo stop a `slDistance` di prezzo. */
export function lotsForRisk(balance: number, riskPct: number, slDistance: number, price: number, time: number, ctx: MarketCtx): number {
  if (!(slDistance > 0) || !(riskPct > 0)) return 0;
  const riskUsd = (balance * riskPct) / 100;
  const perLot = slDistance * ctx.inst.contractSize * ctx.rate(time, price);
  const raw = riskUsd / perLot;
  const step = ctx.inst.lotStep;
  const lots = Math.floor(raw / step + 1e-9) * step;
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Number(lots.toFixed(decimals));
}
