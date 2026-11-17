import type { Order } from "./engine";

export interface Stats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netProfit: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  avgRR: number | null;
  bestTrade: number;
  worstTrade: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  longTrades: number;
  shortTrades: number;
  commissions: number;
  returnPct: number;
}

export interface EquityPoint {
  time: number;
  balance: number;
}

/** Curva del saldo dopo ogni operazione chiusa, partendo dal saldo iniziale. */
export function balanceCurve(trades: Order[], initialBalance: number, startTime: number): EquityPoint[] {
  const sorted = [...trades].filter((t) => t.status === "closed").sort((a, b) => (a.closeTime ?? 0) - (b.closeTime ?? 0) || a.id - b.id);
  const curve: EquityPoint[] = [{ time: startTime, balance: initialBalance }];
  let bal = initialBalance;
  for (const t of sorted) {
    bal += t.pnl;
    curve.push({ time: t.closeTime ?? startTime, balance: Math.round(bal * 100) / 100 });
  }
  return curve;
}

export function computeStats(trades: Order[], initialBalance: number): Stats {
  const closed = trades.filter((t) => t.status === "closed").sort((a, b) => (a.closeTime ?? 0) - (b.closeTime ?? 0) || a.id - b.id);
  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = -losses.reduce((s, t) => s + t.pnl, 0);
  const net = grossProfit - grossLoss;

  let peak = initialBalance;
  let bal = initialBalance;
  let maxDd = 0;
  let maxDdPct = 0;
  for (const t of closed) {
    bal += t.pnl;
    if (bal > peak) peak = bal;
    const dd = peak - bal;
    if (dd > maxDd) maxDd = dd;
    if (peak > 0 && dd / peak > maxDdPct) maxDdPct = dd / peak;
  }

  // Rapporto rischio/rendimento pianificato: distanza TP / distanza SL, quando entrambi sono presenti.
  const rrs = closed
    .filter((t) => t.sl != null && t.tp != null && t.openPrice != null)
    .map((t) => Math.abs(t.tp! - t.openPrice!) / Math.abs(t.openPrice! - t.sl!))
    .filter((x) => Number.isFinite(x));

  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    netProfit: r2(net),
    grossProfit: r2(grossProfit),
    grossLoss: r2(grossLoss),
    profitFactor: grossLoss > 0 ? r2(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    expectancy: closed.length ? r2(net / closed.length) : 0,
    avgWin: wins.length ? r2(grossProfit / wins.length) : 0,
    avgLoss: losses.length ? r2(grossLoss / losses.length) : 0,
    avgRR: rrs.length ? r2(rrs.reduce((a, b) => a + b, 0) / rrs.length) : null,
    bestTrade: closed.length ? Math.max(...closed.map((t) => t.pnl)) : 0,
    worstTrade: closed.length ? Math.min(...closed.map((t) => t.pnl)) : 0,
    maxDrawdown: r2(maxDd),
    maxDrawdownPct: maxDdPct,
    longTrades: closed.filter((t) => t.side === "buy").length,
    shortTrades: closed.filter((t) => t.side === "sell").length,
    commissions: r2(closed.reduce((s, t) => s + t.commission, 0)),
    returnPct: initialBalance > 0 ? net / initialBalance : 0,
  };
}

export function tradesToCsv(trades: Order[], symbol: string): string {
  const header = ["id", "simbolo", "lato", "tipo", "lotti", "apertura", "prezzo_apertura", "sl", "tp", "chiusura", "prezzo_chiusura", "motivo", "pnl_lordo", "commissioni", "pnl_netto"];
  const iso = (t: number | null) => (t == null ? "" : new Date(t * 1000).toISOString());
  const rows = trades
    .filter((t) => t.status === "closed")
    .map((t) => [t.id, symbol, t.side, t.type, t.lots, iso(t.openTime), t.openPrice, t.sl ?? "", t.tp ?? "", iso(t.closeTime), t.closePrice, t.closeReason, t.grossPnl, t.commission, t.pnl].join(","));
  return [header.join(","), ...rows].join("\n");
}
