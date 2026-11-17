"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import NewSessionForm from "./NewSessionForm";
import { deleteSession, listSessions, newId, saveSession } from "@/lib/storage";
import { retrySession, sessionStatus, type Session } from "@/lib/session";
import { computeStats } from "@/lib/stats";

const STATUS_LABEL = { active: "In corso", passed: "Superata", failed: "Fallita" } as const;

function money(n: number) {
  return n.toLocaleString("it-IT", { style: "currency", currency: "USD" });
}

export default function Home() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => setSessions(listSessions()), []);

  function create(s: Session) {
    if (!saveSession(s)) {
      setSaveError(true);
      return;
    }
    router.push(`/session/${s.id}`);
  }

  function remove(id: string) {
    if (!confirm("Eliminare questa sessione?")) return;
    deleteSession(id);
    setSessions(listSessions());
  }

  function retry(s: Session) {
    // Nuovo tentativo un mese dopo l'inizio del precedente, per non ripetere gli stessi giorni.
    const next = retrySession(s, newId(), s.startTime + 30 * 86400);
    if (saveSession(next)) router.push(`/session/${next.id}`);
  }

  return (
    <main className="container grid" style={{ gap: 20 }}>
      <header className="row">
        <h1 style={{ margin: 0 }}>Backtesting</h1>
        <span className="muted">Replay manuale, dati storici a 1 minuto, sfide prop firm</span>
      </header>

      <NewSessionForm onCreate={create} />
      {saveError && <div className="error">Impossibile salvare: il browser blocca il salvataggio locale.</div>}

      <section className="card">
        <h2>Le tue sessioni</h2>
        {sessions === null ? (
          <p className="muted">Caricamento…</p>
        ) : sessions.length === 0 ? (
          <p className="muted">Nessuna sessione. Creane una qui sopra.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table data-testid="sessions-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Strumento</th>
                  <th>Tipo</th>
                  <th>Stato</th>
                  <th>Operazioni</th>
                  <th>Saldo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const st = sessionStatus(s);
                  const stats = computeStats(s.engine.orders, s.account.initialBalance);
                  return (
                    <tr key={s.id}>
                      <td><a href={`/session/${s.id}`}>{s.name}</a></td>
                      <td>{s.symbol}</td>
                      <td>{s.prop ? s.prop.label : "Conto libero"}{s.prop && s.prop.rules.phases.length > 1 ? ` · fase ${s.prop.state.phase + 1}` : ""}</td>
                      <td>{s.prop ? <span className={`badge ${st}`}>{STATUS_LABEL[st]}</span> : <span className="muted">—</span>}</td>
                      <td>{stats.trades}</td>
                      <td>{money(s.engine.balance)}</td>
                      <td className="row" style={{ justifyContent: "flex-end" }}>
                        {s.prop && st !== "active" && <button className="small" onClick={() => retry(s)}>Nuovo tentativo</button>}
                        <button className="small ghost" onClick={() => remove(s.id)}>Elimina</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="hint">
        Le sessioni sono salvate in questo browser. I grafici usano TradingView Lightweight Charts™. Le regole delle prop firm sono indicative e
        l&apos;app non è collegata alle aziende citate.
      </footer>
    </main>
  );
}
