/**
 * Regole delle sfide prop firm.
 *
 * I valori dei preset sono indicativi: sono stati scritti a partire dai regolamenti pubblici
 * delle aziende e vanno ricontrollati prima dell'uso, perché le aziende li cambiano spesso.
 * Questa app non è collegata in alcun modo alle aziende citate.
 */

export type DailyLossBase = "balance" | "max_balance_equity";

export interface PhaseRules {
  name: string;
  /** Target di profitto in % del saldo iniziale. */
  profitTargetPct: number;
  /** Perdita giornaliera massima in % del saldo iniziale. */
  dailyLossPct: number;
  /** Perdita massima complessiva (statica) in % del saldo iniziale. */
  maxLossPct: number;
  /** Giorni minimi con almeno un'operazione aperta. */
  minTradingDays: number;
  /** Giorni minimi chiusi in profitto (0 = nessun requisito). */
  minProfitableDays: number;
  /** Profitto minimo di una giornata per contare come "in profitto", in % del saldo iniziale. */
  profitableDayPct: number;
}

export interface PropRules {
  /** Su cosa si calcola la perdita giornaliera: saldo di inizio giornata o il maggiore tra saldo ed equity. */
  dailyLossBase: DailyLossBase;
  /** Fuso orario in cui inizia il nuovo giorno di trading (mezzanotte locale). */
  dayResetTimeZone: string;
  phases: PhaseRules[];
}

export interface PropPreset {
  id: string;
  firm: string;
  program: string;
  sizes: number[];
  rules: PropRules;
  /** Data dell'ultima verifica dei valori. */
  checkedOn: string;
  notes: string;
}

function twoPhase(p1Target: number, p2Target: number, daily: number, max: number, minDays: number, minProfitDays = 0, profitableDayPct = 0) {
  const base = { dailyLossPct: daily, maxLossPct: max, minTradingDays: minDays, minProfitableDays: minProfitDays, profitableDayPct };
  return [
    { name: "Fase 1", profitTargetPct: p1Target, ...base },
    { name: "Fase 2", profitTargetPct: p2Target, ...base },
  ];
}

export const PROP_PRESETS: PropPreset[] = [
  {
    id: "ftmo-2step",
    firm: "FTMO",
    program: "Challenge 2 fasi",
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
    sizes: [5_000, 10_000, 25_000, 50_000, 100_000],
    rules: {
      dailyLossBase: "max_balance_equity",
      dayResetTimeZone: "Europe/Athens",
      phases: twoPhase(8, 5, 5, 10, 3),
    },
    checkedOn: "2026-11-17",
    notes: "Perdita giornaliera dal maggiore tra saldo ed equity di inizio giornata.",
  },
];

export function getPreset(id: string): PropPreset | undefined {
  return PROP_PRESETS.find((p) => p.id === id);
}

export function customRules(input: {
  phases: 1 | 2;
  profitTargetPct: number;
  phase2TargetPct?: number;
  dailyLossPct: number;
  maxLossPct: number;
  minTradingDays: number;
  dailyLossBase?: DailyLossBase;
  dayResetTimeZone?: string;
}): PropRules {
  const base = {
    dailyLossPct: input.dailyLossPct,
    maxLossPct: input.maxLossPct,
    minTradingDays: input.minTradingDays,
    minProfitableDays: 0,
    profitableDayPct: 0,
  };
  const phases: PhaseRules[] = [{ name: input.phases === 2 ? "Fase 1" : "Sfida", profitTargetPct: input.profitTargetPct, ...base }];
  if (input.phases === 2) phases.push({ name: "Fase 2", profitTargetPct: input.phase2TargetPct ?? input.profitTargetPct / 2, ...base });
  return {
    dailyLossBase: input.dailyLossBase ?? "balance",
    dayResetTimeZone: input.dayResetTimeZone ?? "UTC",
    phases,
  };
}
