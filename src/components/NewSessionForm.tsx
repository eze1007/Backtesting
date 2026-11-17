"use client";

import { useMemo, useState } from "react";
import { INSTRUMENTS, getInstrument, type Category } from "@/lib/instruments";
import { TIMEFRAMES, type TimeframeId } from "@/lib/candles";
import { PROP_PRESETS, customRules, describePhase, getPreset, resolveRules, type MaxLossType } from "@/lib/prop/presets";
import { createSession, type Session } from "@/lib/session";
import { newId } from "@/lib/storage";

const CATEGORY_LABEL: Record<Category, string> = { forex: "Forex", metal: "Metalli", crypto: "Crypto" };

function defaultStart(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

export default function NewSessionForm({ onCreate }: { onCreate: (s: Session) => void }) {
  const [mode, setMode] = useState<"free" | "prop">("prop");
  const [symbol, setSymbol] = useState("EURUSD");
  const [date, setDate] = useState(defaultStart());
  const [hour, setHour] = useState("08:00");
  const [tf, setTf] = useState<TimeframeId>("15m");
  const [balance, setBalance] = useState(10_000);
  const [presetId, setPresetId] = useState(PROP_PRESETS[0].id);
  const [size, setSize] = useState(PROP_PRESETS[0].sizes[2] ?? PROP_PRESETS[0].sizes[0]);
  const [custom, setCustom] = useState({ phases: 2 as 1 | 2, target: 10, target2: 5, daily: 5, max: 10, minDays: 4, lossType: "static" as MaxLossType, lockAtInitial: false, consistency: 0 });
  const [spread, setSpread] = useState<number | "">("");
  const [commission, setCommission] = useState(0);
  const [commissionPct, setCommissionPct] = useState(0);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const inst = getInstrument(symbol);
  const preset = getPreset(presetId);
  const groups = useMemo(() => {
    const g = new Map<Category, typeof INSTRUMENTS>();
    for (const i of INSTRUMENTS) g.set(i.category, [...(g.get(i.category) ?? []), i]);
    return [...g.entries()];
  }, []);

  function onPreset(id: string) {
    setPresetId(id);
    const p = getPreset(id);
    if (p) setSize(p.sizes.includes(size) ? size : p.sizes[Math.min(2, p.sizes.length - 1)]);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const start = Date.parse(`${date}T${hour}:00Z`) / 1000;
    if (!Number.isFinite(start)) return setError("Data di inizio non valida.");
    const minStart = Date.UTC(inst.startYear, 0, 1) / 1000;
    if (start < minStart) return setError(`Per ${inst.symbol} i dati partono dal ${inst.startYear}.`);
    if (start > Date.now() / 1000 - 86400) return setError("Scegli una data nel passato.");

    let initial = balance;
    let prop = null;
    if (mode === "prop") {
      if (presetId === "custom") {
        initial = balance;
        prop = {
          presetId: null,
          label: "Sfida personalizzata",
          rules: customRules({
            phases: custom.phases,
            profitTargetPct: custom.target,
            phase2TargetPct: custom.target2,
            dailyLossPct: custom.daily,
            maxLossPct: custom.max,
            minTradingDays: custom.minDays,
            maxLossType: custom.lossType,
            trailingStopsAtInitial: custom.lockAtInitial,
            consistencyPct: custom.consistency,
          }),
        };
      } else if (preset) {
        initial = size;
        prop = { presetId: preset.id, label: `${preset.firm} · ${preset.program}`, rules: resolveRules(preset, size) };
      }
    }
    if (!(initial > 0)) return setError("Il saldo iniziale deve essere maggiore di zero.");

    const label = name.trim() || `${inst.symbol} · ${prop ? prop.label : "conto libero"} · ${(initial / 1000).toLocaleString("it-IT")}k`;
    const s = createSession({
      id: newId(),
      name: label,
      symbol,
      startTime: start,
      timeframe: tf,
      account: {
        initialBalance: initial,
        spreadPips: spread === "" ? inst.defaultSpreadPips : Number(spread),
        commissionPerLot: inst.category === "crypto" ? 0 : commission,
        commissionPct: inst.category === "crypto" ? commissionPct : 0,
      },
      prop,
    });
    onCreate(s);
  }

  return (
    <form className="card grid" onSubmit={submit} data-testid="new-session-form">
      <h2>Nuova sessione</h2>
      <div className="seg" role="group" aria-label="Tipo di conto">
        <button type="button" className={mode === "prop" ? "active" : ""} onClick={() => setMode("prop")}>Sfida prop firm</button>
        <button type="button" className={mode === "free" ? "active" : ""} onClick={() => setMode("free")}>Conto libero</button>
      </div>

      <div className="grid grid-4">
        <label>
          Strumento
          <select value={symbol} onChange={(e) => { setSymbol(e.target.value); setSpread(""); }} name="symbol">
            {groups.map(([cat, list]) => (
              <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
                {list.map((i) => (
                  <option key={i.symbol} value={i.symbol}>{i.symbol}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          Data di inizio
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} name="date" required />
        </label>
        <label>
          Ora (UTC)
          <input type="time" value={hour} onChange={(e) => setHour(e.target.value)} name="hour" required />
        </label>
        <label>
          Timeframe
          <select value={tf} onChange={(e) => setTf(e.target.value as TimeframeId)}>
            {TIMEFRAMES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
      </div>

      {mode === "prop" ? (
        <div className="grid grid-4">
          <label>
            Prop firm
            <select value={presetId} onChange={(e) => onPreset(e.target.value)} name="preset">
              <optgroup label="Forex / CFD">
                {PROP_PRESETS.filter((p) => p.market === "forex").map((p) => (
                  <option key={p.id} value={p.id}>{p.firm} · {p.program}</option>
                ))}
              </optgroup>
              <optgroup label="Futures">
                {PROP_PRESETS.filter((p) => p.market === "futures").map((p) => (
                  <option key={p.id} value={p.id}>{p.firm} · {p.program}</option>
                ))}
              </optgroup>
              <option value="custom">Regole personalizzate</option>
            </select>
          </label>
          {presetId !== "custom" && preset ? (
            <label>
              Dimensione del conto
              <select value={size} onChange={(e) => setSize(Number(e.target.value))} name="size">
                {preset.sizes.map((s) => (
                  <option key={s} value={s}>{s.toLocaleString("it-IT")} USD</option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              Saldo iniziale (USD)
              <input type="number" min={100} step={100} value={balance} onChange={(e) => setBalance(Number(e.target.value))} />
            </label>
          )}
          {presetId !== "custom" && preset && (
            <div className="hint" style={{ gridColumn: "span 2" }}>
              {resolveRules(preset, size).phases.map((p) => (
                <div key={p.name}>
                  <b>{p.name}</b>: {describePhase(p, size)}
                </div>
              ))}
              <div>{preset.notes} Valori indicativi, verificati il {preset.checkedOn}.</div>
              {preset.market === "futures" && <div>Pensata per i futures: per ora si può simulare su forex, oro e crypto.</div>}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-4">
          <label>
            Saldo iniziale (USD)
            <input type="number" min={100} step={100} value={balance} onChange={(e) => setBalance(Number(e.target.value))} name="balance" />
          </label>
        </div>
      )}

      {mode === "prop" && presetId === "custom" && (
        <div className="grid grid-4">
          <label>
            Fasi
            <select value={custom.phases} onChange={(e) => setCustom({ ...custom, phases: Number(e.target.value) as 1 | 2 })}>
              <option value={1}>1 fase</option>
              <option value={2}>2 fasi</option>
            </select>
          </label>
          <label>
            Target fase 1 (%)
            <input type="number" step={0.5} min={0.5} value={custom.target} onChange={(e) => setCustom({ ...custom, target: Number(e.target.value) })} />
          </label>
          {custom.phases === 2 && (
            <label>
              Target fase 2 (%)
              <input type="number" step={0.5} min={0.5} value={custom.target2} onChange={(e) => setCustom({ ...custom, target2: Number(e.target.value) })} />
            </label>
          )}
          <label>
            Perdita giornaliera (%, 0 = nessuna)
            <input type="number" step={0.5} min={0} value={custom.daily} onChange={(e) => setCustom({ ...custom, daily: Number(e.target.value) })} />
          </label>
          <label>
            Perdita massima (%)
            <input type="number" step={0.5} min={1} value={custom.max} onChange={(e) => setCustom({ ...custom, max: Number(e.target.value) })} />
          </label>
          <label>
            Tipo di perdita massima
            <select value={custom.lossType} onChange={(e) => setCustom({ ...custom, lossType: e.target.value as MaxLossType })} name="lossType">
              <option value="static">Statica</option>
              <option value="trailing_eod">Trailing a fine giornata</option>
              <option value="trailing_intraday">Trailing intraday</option>
            </select>
          </label>
          {custom.lossType !== "static" && (
            <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={custom.lockAtInitial} onChange={(e) => setCustom({ ...custom, lockAtInitial: e.target.checked })} />
              Il limite si ferma al saldo iniziale
            </label>
          )}
          <label>
            Giorni minimi
            <input type="number" step={1} min={0} value={custom.minDays} onChange={(e) => setCustom({ ...custom, minDays: Number(e.target.value) })} />
          </label>
          <label>
            Consistenza (% max del giorno migliore, 0 = no)
            <input type="number" step={5} min={0} max={100} value={custom.consistency} onChange={(e) => setCustom({ ...custom, consistency: Number(e.target.value) })} />
          </label>
        </div>
      )}

      <details>
        <summary className="muted">Costi e nome</summary>
        <div className="grid grid-4" style={{ marginTop: 8 }}>
          <label>
            Spread (pip)
            <input type="number" step={0.1} min={0} placeholder={String(inst.defaultSpreadPips)} value={spread} onChange={(e) => setSpread(e.target.value === "" ? "" : Number(e.target.value))} />
          </label>
          {inst.category === "crypto" ? (
            <label>
              Commissione (% andata e ritorno)
              <input type="number" step={0.01} min={0} value={commissionPct} onChange={(e) => setCommissionPct(Number(e.target.value))} />
            </label>
          ) : (
            <label>
              Commissione (USD per lotto)
              <input type="number" step={0.5} min={0} value={commission} onChange={(e) => setCommission(Number(e.target.value))} />
            </label>
          )}
          <label style={{ gridColumn: "span 2" }}>
            Nome della sessione
            <input type="text" placeholder="Automatico" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        </div>
      </details>

      {error && <div className="error">{error}</div>}
      <div className="row">
        <button type="submit" className="primary">Crea e apri</button>
      </div>
    </form>
  );
}
