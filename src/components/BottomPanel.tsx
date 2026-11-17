"use client";

import { useMemo, useState } from "react";
import type { Candle } from "@/lib/candles";
import { floatingPnl, type MarketCtx, type Order } from "@/lib/engine";
import { formatPrice, type Instrument } from "@/lib/instruments";
import { balanceCurve, computeStats, tradesToCsv } from "@/lib/stats";
import type { Session } from "@/lib/session";

function money(n: number) {
  return n.toLocaleString("it-IT", { style: "currency", currency: "USD" });
}
function when(t: number | null) {
  return t == null ? "—" : new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ");
}
const REASON: Record<string, string> = { sl: "Stop loss", tp: "Take profit", manual: "Manuale", prop: "Regola prop", phase: "Fine fase" };

interface Props {
  session: Session;
  inst: Instrument;
  bar: Candle | null;
  ctx: MarketCtx | null;
  onClose: (id: number) => void;
  onCancel: (id: number) => void;
  onModify: (id: number, changes: { sl?: number | null; tp?: number | null; price?: number }) => void;
}

function LevelInput({ value, digits, onCommit }: { value: number | null; digits: number; onCommit: (v: number | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value == null ? "" : value.toFixed(digits));
  return (
    <input
      type="number"
      step={Math.pow(10, -digits)}
      value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft == null) return;
        const v = draft.trim() === "" ? null : Number(draft);
        setDraft(null);
        if (v == null || Number.isFinite(v)) onCommit(v);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function EquityCurve({ points }: { points: { balance: number }[] }) {
  if (points.length < 2) return <p className="muted">La curva del saldo compare dopo la prima operazione chiusa.</p>;
  const w = 600;
  const h = 140;
  const vals = points.map((p) => p.balance);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const d = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / span) * (h - 10) - 5}`).join(" ");
  const up = vals[vals.length - 1] >= vals[0];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", maxWidth: 640, height: 140 }} role="img" aria-label="Curva del saldo">
      <polyline points={d} fill="none" stroke={up ? "#22b07d" : "#e5484d"} strokeWidth={2} />
    </svg>
  );
}

export default function BottomPanel({ session, inst, bar, ctx, onClose, onCancel, onModify }: Props) {
  const [tab, setTab] = useState<"positions" | "history" | "stats">("positions");
  const [phaseFilter, setPhaseFilter] = useState<"current" | "all">("current");
  const orders = session.engine.orders;
  const active = orders.filter((o) => o.status === "open" || o.status === "pending");
  const phase = session.prop?.state.phase ?? 0;
  const closed = useMemo(
    () => orders.filter((o) => o.status === "closed" && (phaseFilter === "all" || (o.phase ?? 0) === phase)),
    [orders, phaseFilter, phase],
  );
  const stats = useMemo(() => computeStats(closed, session.account.initialBalance), [closed, session.account.initialBalance]);
  const curve = useMemo(() => balanceCurve(closed, session.account.initialBalance, session.startTime), [closed, session.account.initialBalance, session.startTime]);

  function exportCsv() {
    const blob = new Blob([tradesToCsv(closed, session.symbol)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${session.name.replace(/[^\w-]+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const multiPhase = (session.prop?.rules.phases.length ?? 1) > 1;

  return (
    <div className="ws-bottom">
      <div className="tabs">
        <button className={`small ${tab === "positions" ? "active" : ""}`} onClick={() => setTab("positions")}>Posizioni e ordini ({active.length})</button>
        <button className={`small ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")} data-testid="tab-history">Storico ({closed.length})</button>
        <button className={`small ${tab === "stats" ? "active" : ""}`} onClick={() => setTab("stats")} data-testid="tab-stats">Statistiche</button>
        <span className="spacer" />
        {multiPhase && tab !== "positions" && (
          <select className="small" value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value as "current" | "all")}>
            <option value="current">Fase corrente</option>
            <option value="all">Tutte le fasi</option>
          </select>
        )}
        {tab === "history" && <button className="small" onClick={exportCsv} disabled={!closed.length}>Esporta CSV</button>}
      </div>
      <div className="tab-body">
        {tab === "positions" &&
          (active.length === 0 ? (
            <p className="muted">Nessuna posizione aperta.</p>
          ) : (
            <table data-testid="positions-table">
              <thead>
                <tr><th>#</th><th>Lato</th><th>Tipo</th><th>Lotti</th><th>Ingresso</th><th>SL</th><th>TP</th><th>P&amp;L</th><th /></tr>
              </thead>
              <tbody>
                {active.map((o: Order) => {
                  const pnl = o.status === "open" && bar && ctx ? floatingPnl(o, bar.close, bar.time + 60, ctx) : null;
                  return (
                    <tr key={o.id}>
                      <td>{o.id}</td>
                      <td className={o.side === "buy" ? "pos" : "neg"}>{o.side === "buy" ? "Buy" : "Sell"}</td>
                      <td>{o.status === "pending" ? `${o.type} (in attesa)` : "aperta"}</td>
                      <td>{o.lots}</td>
                      <td>{formatPrice(inst, o.openPrice ?? o.price)}</td>
                      <td><LevelInput value={o.sl} digits={inst.digits} onCommit={(v) => onModify(o.id, { sl: v })} /></td>
                      <td><LevelInput value={o.tp} digits={inst.digits} onCommit={(v) => onModify(o.id, { tp: v })} /></td>
                      <td className={pnl == null ? "" : pnl >= 0 ? "pos" : "neg"}>{pnl == null ? "—" : money(pnl)}</td>
                      <td>
                        {o.status === "open" ? (
                          <button className="small" onClick={() => onClose(o.id)} data-testid={`close-${o.id}`}>Chiudi</button>
                        ) : (
                          <button className="small" onClick={() => onCancel(o.id)}>Annulla</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ))}

        {tab === "history" &&
          (closed.length === 0 ? (
            <p className="muted">Nessuna operazione chiusa.</p>
          ) : (
            <table data-testid="history-table">
              <thead>
                <tr><th>#</th><th>Lato</th><th>Lotti</th><th>Apertura</th><th>Ingresso</th><th>Chiusura</th><th>Uscita</th><th>Motivo</th><th>Commissioni</th><th>P&amp;L</th></tr>
              </thead>
              <tbody>
                {[...closed].reverse().map((o) => (
                  <tr key={o.id}>
                    <td>{o.id}</td>
                    <td className={o.side === "buy" ? "pos" : "neg"}>{o.side === "buy" ? "Buy" : "Sell"}</td>
                    <td>{o.lots}</td>
                    <td>{when(o.openTime)}</td>
                    <td>{formatPrice(inst, o.openPrice!)}</td>
                    <td>{when(o.closeTime)}</td>
                    <td>{formatPrice(inst, o.closePrice!)}</td>
                    <td>{REASON[o.closeReason ?? ""] ?? "—"}</td>
                    <td>{money(o.commission)}</td>
                    <td className={o.pnl >= 0 ? "pos" : "neg"}>{money(o.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

        {tab === "stats" && (
          <div className="grid grid-2" data-testid="stats">
            <div className="kv" style={{ maxWidth: 460 }}>
              <span>Operazioni</span><span>{stats.trades} ({stats.longTrades} long, {stats.shortTrades} short)</span>
              <span>Win rate</span><span>{(stats.winRate * 100).toFixed(1)}%</span>
              <span>Profitto netto</span><span className={stats.netProfit >= 0 ? "pos" : "neg"}>{money(stats.netProfit)} ({(stats.returnPct * 100).toFixed(2)}%)</span>
              <span>Profit factor</span><span>{stats.profitFactor == null ? "∞" : stats.profitFactor}</span>
              <span>Expectancy per operazione</span><span>{money(stats.expectancy)}</span>
              <span>Vincita media / perdita media</span><span>{money(stats.avgWin)} / {money(stats.avgLoss)}</span>
              <span>R:R medio pianificato</span><span>{stats.avgRR == null ? "—" : `1:${stats.avgRR}`}</span>
              <span>Migliore / peggiore</span><span>{money(stats.bestTrade)} / {money(stats.worstTrade)}</span>
              <span>Drawdown massimo</span><span>{money(stats.maxDrawdown)} ({(stats.maxDrawdownPct * 100).toFixed(2)}%)</span>
              <span>Commissioni</span><span>{money(stats.commissions)}</span>
            </div>
            <div>
              <EquityCurve points={curve} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
