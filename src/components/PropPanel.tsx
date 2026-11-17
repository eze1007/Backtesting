"use client";

import { currentPhase, missingRequirements, propLevels } from "@/lib/prop/engine";
import type { Session } from "@/lib/session";

function money(n: number) {
  return n.toLocaleString("it-IT", { style: "currency", currency: "USD" });
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="progress">
      <div style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export default function PropPanel({ session }: { session: Session }) {
  const prop = session.prop!;
  const st = prop.state;
  const phase = currentPhase(prop.rules, st);
  const lv = propLevels(prop.rules, st);
  const init = st.initialBalance;
  const profit = st.lastBalance - init;
  const targetAmount = lv.target - init;
  const dailyRoom = st.lastEquity - lv.dailyFloor;
  const dailyLimit = (init * phase.dailyLossPct) / 100;
  const maxRoom = st.lastEquity - lv.maxFloor;
  const maxLimit = (init * phase.maxLossPct) / 100;
  const missing = missingRequirements(prop.rules, st);

  return (
    <section data-testid="prop-panel">
      <h3>Sfida · {prop.label}</h3>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className={`badge ${st.status}`} data-testid="prop-status">
          {st.status === "active" ? phase.name : st.status === "passed" ? "Superata" : "Fallita"}
        </span>
        {prop.rules.phases.length > 1 && st.status === "active" && <span className="muted">di {prop.rules.phases.length}</span>}
        {session.attempt > 1 && <span className="muted">· tentativo {session.attempt}</span>}
      </div>

      {st.status === "active" && (
        <div className="grid" style={{ gap: 8 }}>
          <div>
            <div className="row"><span className="muted">Target {phase.profitTargetPct}%</span><span className="spacer" /><span>{money(profit)} / {money(targetAmount)}</span></div>
            <Bar value={profit} max={targetAmount} color="var(--green)" />
          </div>
          <div>
            <div className="row"><span className="muted">Margine perdita giornaliera</span><span className="spacer" /><span>{money(dailyRoom)}</span></div>
            <Bar value={dailyRoom} max={dailyLimit} color="var(--amber)" />
          </div>
          <div>
            <div className="row"><span className="muted">Margine perdita massima</span><span className="spacer" /><span>{money(maxRoom)}</span></div>
            <Bar value={maxRoom} max={maxLimit} color="var(--red)" />
          </div>
          <div className="kv">
            <span>Giorni di trading</span>
            <span>{st.tradingDays.length} / {phase.minTradingDays}</span>
            {phase.minProfitableDays > 0 && (
              <>
                <span>Giorni in profitto</span>
                <span>{lv.profitableDays} / {phase.minProfitableDays}</span>
              </>
            )}
            <span>Limite giornaliero</span>
            <span>{money(lv.dailyFloor)}</span>
            <span>Limite massimo</span>
            <span>{money(lv.maxFloor)}</span>
          </div>
          {missing.length > 0 && <div className="hint">{missing.join(" ")}</div>}
        </div>
      )}

      {st.failReason && <p className="error">{st.failReason}</p>}
      {st.results.length > 0 && (
        <ul className="hint" style={{ paddingLeft: 16, margin: "8px 0 0" }}>
          {st.results.map((r, i) => (
            <li key={i}>
              {r.name}: {r.status === "passed" ? "superata" : "fallita"} il {new Date(r.time * 1000).toISOString().slice(0, 10)}
            </li>
          ))}
        </ul>
      )}
      {st.status !== "active" && (
        <p className="hint">Dalla pagina delle sessioni puoi avviare un nuovo tentativo con le stesse regole.</p>
      )}
    </section>
  );
}
