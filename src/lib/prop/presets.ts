/**
 * Regole delle sfide prop firm.
 *
 * I valori dei preset sono indicativi: sono stati scritti a partire dai regolamenti pubblici
 * delle aziende e vanno ricontrollati prima dell'uso, perché le aziende li cambiano spesso.
 * Questa app non è collegata in alcun modo alle aziende citate.
 */

export type DailyLossBase = "balance" | "max_balance_equity";

/**
 * Come si muove il limite di perdita massima:
 * - static: fisso a saldo iniziale − perdita massima;
 * - trailing_eod: segue il saldo più alto registrato a fine giornata;
 * - trailing_intraday: segue l'equity più alta raggiunta, anche con posizioni aperte.
 */
export type MaxLossType = "static" | "trailing_eod" | "trailing_intraday";

export interface PhaseRules {
  name: string;
  /** Target di profitto in % del saldo iniziale. */
  profitTargetPct: number;
  /** Perdita giornaliera massima in % del saldo iniziale (0 = nessun limite). */
  dailyLossPct: number;
  /** Perdita massima in % del saldo iniziale. */
  maxLossPct: number;
  maxLossType?: MaxLossType;
  /** Per i limiti trailing: il limite smette di salire quando arriva al saldo iniziale. */
  trailingStopsAtInitial?: boolean;
  /** Giorni minimi con almeno un'operazione aperta. */
  minTradingDays: number;
  /** Giorni minimi chiusi in profitto (0 = nessun requisito). */
  minProfitableDays: number;
  /** Profitto minimo di una giornata per contare come "in profitto", in % del saldo iniziale. */
  profitableDayPct: number;
  /**
   * Regola di consistenza: il giorno migliore non può superare questa % del profitto totale (0 = nessuna).
   * Non fa fallire la sfida: la fase viene superata solo quando la regola è rispettata.
   */
  consistencyPct?: number;
}

export interface PropRules {
  /** Su cosa si calcola la perdita giornaliera: saldo di inizio giornata o il maggiore tra saldo ed equity. */
  dailyLossBase: DailyLossBase;
  /** Fuso orario in cui inizia il nuovo giorno di trading. */
  dayResetTimeZone: string;
  /** Ora locale (0–23) in cui inizia il nuovo giorno di trading; 0 = mezzanotte. */
  dayResetHour?: number;
  phases: PhaseRules[];
}

export interface PropPreset {
  id: string;
  firm: string;
  program: string;
  /** Mercati per cui è pensata la sfida (informativo). */
  market: "forex" | "futures";
  sizes: number[];
  rules: PropRules;
  /** Valori che cambiano con la taglia del conto (non sempre proporzionali). */
  sizeOverrides?: Record<number, Partial<PhaseRules>[]>;
  /** Data dell'ultima verifica dei valori. */
  checkedOn: string;
  notes: string;
}

function twoPhase(p1Target: number, p2Target: number, daily: number, max: number, minDays: number, minProfitDays = 0, profitableDayPct = 0): PhaseRules[] {
  const base = { dailyLossPct: daily, maxLossPct: max, maxLossType: "static" as const, minTradingDays: minDays, minProfitableDays: minProfitDays, profitableDayPct };
  return [
    { name: "Fase 1", profitTargetPct: p1Target, ...base },
    { name: "Fase 2", profitTargetPct: p2Target, ...base },
  ];
}

/** Converte importi in dollari in percentuali della taglia del conto. */
function usd(size: number, amounts: { target: number; maxLoss: number; dailyLoss?: number }): Partial<PhaseRules> {
  const pct = (v: number) => Math.round((v / size) * 100 * 10_000) / 10_000;
  return {
    profitTargetPct: pct(amounts.target),
    maxLossPct: pct(amounts.maxLoss),
    ...(amounts.dailyLoss != null ? { dailyLossPct: pct(amounts.dailyLoss) } : {}),
  };
}

export const PROP_PRESETS: PropPreset[] = [
  {
    id: "ftmo-2step",
    firm: "FTMO",
    program: "Challenge 2 fasi",
    market: "forex",
    sizes: [10_000, 25_000, 50_000, 100_000, 200_000],
    rules: {
      dailyLossBase: "balance",
      dayResetTimeZone: "Europe/Prague",
      phases: twoPhase(10, 5, 5, 10, 4),
    },
    checkedOn: "2026-11-17",
    notes: "Perdita giornaliera calcolata dal saldo di inizio giornata; il giorno cambia a mezzanotte CET.",
  },
  {
    id: "the5ers-highstakes",
    firm: "The5ers",
    program: "High Stakes",
    market: "forex",
    sizes: [5_000, 10_000, 20_000, 60_000, 100_000],
    rules: {
      dailyLossBase: "max_balance_equity",
      dayResetTimeZone: "Europe/Athens",
      phases: twoPhase(8, 5, 5, 10, 3, 3, 0.5),
    },
    checkedOn: "2026-11-17",
    notes: "Servono 3 giorni in profitto (almeno +0,5% del saldo iniziale ciascuno).",
  },
  {
    id: "fundednext-stellar2",
    firm: "FundedNext",
    program: "Stellar 2 fasi",
    market: "forex",
    sizes: [6_000, 15_000, 25_000, 50_000, 100_000, 200_000],
    rules: {
      dailyLossBase: "max_balance_equity",
      dayResetTimeZone: "Europe/Athens",
      phases: twoPhase(8, 5, 5, 10, 5),
    },
    checkedOn: "2026-11-17",
    notes: "Perdita giornaliera dal maggiore tra saldo ed equity di inizio giornata.",
  },
  {
    id: "fundingpips-2step",
    firm: "Funding Pips",
    program: "2 fasi",
    market: "forex",
    sizes: [5_000, 10_000, 25_000, 50_000, 100_000],
    rules: {
      dailyLossBase: "max_balance_equity",
      dayResetTimeZone: "Europe/Athens",
      phases: twoPhase(8, 5, 5, 10, 3),
    },
    checkedOn: "2026-11-17",
    notes: "Perdita giornaliera dal maggiore tra saldo ed equity di inizio giornata.",
  },
  {
    id: "topstep-combine",
    firm: "Topstep",
    program: "Trading Combine",
    market: "futures",
    sizes: [50_000, 100_000, 150_000],
    rules: {
      dailyLossBase: "balance",
      dayResetTimeZone: "America/New_York",
      dayResetHour: 17,
      phases: [
        {
          name: "Combine",
          profitTargetPct: 6,
          dailyLossPct: 2,
          maxLossPct: 4,
          maxLossType: "trailing_eod",
          trailingStopsAtInitial: true,
          minTradingDays: 2,
          minProfitableDays: 0,
          profitableDayPct: 0,
          consistencyPct: 50,
        },
      ],
    },
    sizeOverrides: {
      50_000: [usd(50_000, { target: 3_000, maxLoss: 2_000, dailyLoss: 1_000 })],
      100_000: [usd(100_000, { target: 6_000, maxLoss: 3_000, dailyLoss: 2_000 })],
      150_000: [usd(150_000, { target: 9_000, maxLoss: 4_500, dailyLoss: 3_000 })],
    },
    checkedOn: "2026-11-17",
    notes:
      "Fase unica. Perdita massima trailing sul saldo di fine giornata, che smette di salire al saldo iniziale. Il giorno migliore non può superare il 50% del profitto. Il giorno cambia alle 17:00 di New York.",
  },
  {
    id: "apex-eval",
    firm: "Apex Trader Funding",
    program: "Valutazione",
    market: "futures",
    sizes: [25_000, 50_000, 100_000, 150_000],
    rules: {
      dailyLossBase: "balance",
      dayResetTimeZone: "America/New_York",
      dayResetHour: 17,
      phases: [
        {
          name: "Valutazione",
          profitTargetPct: 6,
          dailyLossPct: 0,
          maxLossPct: 5,
          maxLossType: "trailing_intraday",
          trailingStopsAtInitial: false,
          minTradingDays: 7,
          minProfitableDays: 0,
          profitableDayPct: 0,
        },
      ],
    },
    sizeOverrides: {
      25_000: [usd(25_000, { target: 1_500, maxLoss: 1_500 })],
      50_000: [usd(50_000, { target: 3_000, maxLoss: 2_500 })],
      100_000: [usd(100_000, { target: 6_000, maxLoss: 3_000 })],
      150_000: [usd(150_000, { target: 9_000, maxLoss: 5_000 })],
    },
    checkedOn: "2026-11-17",
    notes:
      "Fase unica senza perdita giornaliera. Il limite di perdita segue l'equity più alta raggiunta, anche con posizioni aperte. Il giorno cambia alle 17:00 di New York.",
  },
];

export function getPreset(id: string): PropPreset | undefined {
  return PROP_PRESETS.find((p) => p.id === id);
}

/** Regole del preset per una certa taglia di conto. */
export function resolveRules(preset: PropPreset, size: number): PropRules {
  const overrides = preset.sizeOverrides?.[size];
  if (!overrides) return preset.rules;
  return {
    ...preset.rules,
    phases: preset.rules.phases.map((p, i) => ({ ...p, ...(overrides[i] ?? {}) })),
  };
}

export function customRules(input: {
  phases: 1 | 2;
  profitTargetPct: number;
  phase2TargetPct?: number;
  dailyLossPct: number;
  maxLossPct: number;
  maxLossType?: MaxLossType;
  trailingStopsAtInitial?: boolean;
  minTradingDays: number;
  consistencyPct?: number;
  dailyLossBase?: DailyLossBase;
  dayResetTimeZone?: string;
}): PropRules {
  const base = {
    dailyLossPct: input.dailyLossPct,
    maxLossPct: input.maxLossPct,
    maxLossType: input.maxLossType ?? "static",
    trailingStopsAtInitial: input.trailingStopsAtInitial ?? false,
    minTradingDays: input.minTradingDays,
    minProfitableDays: 0,
    profitableDayPct: 0,
    consistencyPct: input.consistencyPct ?? 0,
  };
  const phases: PhaseRules[] = [{ name: input.phases === 2 ? "Fase 1" : "Sfida", profitTargetPct: input.profitTargetPct, ...base }];
  if (input.phases === 2) phases.push({ name: "Fase 2", profitTargetPct: input.phase2TargetPct ?? input.profitTargetPct / 2, ...base });
  return {
    dailyLossBase: input.dailyLossBase ?? "balance",
    dayResetTimeZone: input.dayResetTimeZone ?? "UTC",
    phases,
  };
}

const LOSS_TYPE_LABEL: Record<MaxLossType, string> = {
  static: "statica",
  trailing_eod: "trailing a fine giornata",
  trailing_intraday: "trailing intraday",
};

/** Descrizione breve di una fase, per l'interfaccia. */
export function describePhase(p: PhaseRules, size: number): string {
  const money = (pct: number) => ((size * pct) / 100).toLocaleString("it-IT", { maximumFractionDigits: 0 }) + " USD";
  const parts = [
    `target ${p.profitTargetPct}% (${money(p.profitTargetPct)})`,
    p.dailyLossPct > 0 ? `perdita giornaliera ${p.dailyLossPct}%` : "nessuna perdita giornaliera",
    `perdita massima ${p.maxLossPct}% ${LOSS_TYPE_LABEL[p.maxLossType ?? "static"]}${p.trailingStopsAtInitial ? " (si ferma al saldo iniziale)" : ""}`,
    `minimo ${p.minTradingDays} giorni`,
  ];
  if (p.minProfitableDays) parts.push(`${p.minProfitableDays} giorni in profitto`);
  if (p.consistencyPct) parts.push(`giorno migliore ≤ ${p.consistencyPct}% del profitto`);
  return parts.join(", ");
}
