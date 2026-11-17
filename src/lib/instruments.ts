export type Category = "forex" | "metal" | "crypto";
export type Source = "dukascopy" | "binance";

export interface Instrument {
  symbol: string;
  name: string;
  category: Category;
  source: Source;
  /** Identificativo dello strumento presso la fonte dati. */
  sourceId: string;
  base: string;
  quote: string;
  /** Cifre decimali mostrate e usate per salvare i prezzi come interi. */
  digits: number;
  /** Valore di un pip (o del tick di riferimento per oro e crypto). */
  pipSize: number;
  /** Unità del sottostante in 1 lotto. */
  contractSize: number;
  minLot: number;
  lotStep: number;
  /** Primo anno con dati disponibili. */
  startYear: number;
  /** Spread predefinito in pip. */
  defaultSpreadPips: number;
}

const FX_MAJORS = ["EUR", "GBP", "AUD", "NZD", "USD", "CAD", "CHF", "JPY"];

/** Le 28 coppie formate dalle 8 valute principali, nell'ordine di priorità convenzionale. */
function buildForex(): Instrument[] {
  const list: Instrument[] = [];
  for (let i = 0; i < FX_MAJORS.length; i++) {
    for (let j = i + 1; j < FX_MAJORS.length; j++) {
      const base = FX_MAJORS[i];
      const quote = FX_MAJORS[j];
      const symbol = base + quote;
      const jpy = quote === "JPY";
      const major = base === "USD" || quote === "USD";
      list.push({
        symbol,
        name: `${base}/${quote}`,
        category: "forex",
        source: "dukascopy",
        sourceId: symbol.toLowerCase(),
        base,
        quote,
        digits: jpy ? 3 : 5,
        pipSize: jpy ? 0.01 : 0.0001,
        contractSize: 100_000,
        minLot: 0.01,
        lotStep: 0.01,
        startYear: 2010,
        defaultSpreadPips: major ? 0.8 : 1.6,
      });
    }
  }
  return list;
}

const METALS: Instrument[] = [
  {
    symbol: "XAUUSD",
    name: "Oro / USD",
    category: "metal",
    source: "dukascopy",
    sourceId: "xauusd",
    base: "XAU",
    quote: "USD",
    digits: 2,
    pipSize: 0.1,
    contractSize: 100,
    minLot: 0.01,
    lotStep: 0.01,
    startYear: 2010,
    defaultSpreadPips: 2.5,
  },
];

function crypto(base: string, name: string, digits: number, startYear: number, lotStep: number): Instrument {
  return {
    symbol: `${base}USDT`,
    name: `${name} / USDT`,
    category: "crypto",
    source: "binance",
    sourceId: `${base}USDT`,
    base,
    quote: "USDT",
    digits,
    pipSize: Math.pow(10, -digits),
    contractSize: 1,
    minLot: lotStep,
    lotStep,
    startYear,
    defaultSpreadPips: 1,
  };
}

const CRYPTO: Instrument[] = [
  crypto("BTC", "Bitcoin", 2, 2018, 0.001),
  crypto("ETH", "Ethereum", 2, 2018, 0.01),
  crypto("BNB", "BNB", 2, 2018, 0.01),
  crypto("SOL", "Solana", 2, 2021, 0.1),
  crypto("XRP", "XRP", 4, 2019, 1),
  crypto("ADA", "Cardano", 4, 2019, 1),
  crypto("DOGE", "Dogecoin", 5, 2020, 1),
  crypto("LTC", "Litecoin", 2, 2018, 0.01),
];

export const INSTRUMENTS: Instrument[] = [...buildForex(), ...METALS, ...CRYPTO];

const BY_SYMBOL = new Map(INSTRUMENTS.map((i) => [i.symbol, i]));

export function getInstrument(symbol: string): Instrument {
  const inst = BY_SYMBOL.get(symbol);
  if (!inst) throw new Error(`Strumento sconosciuto: ${symbol}`);
  return inst;
}

export function findInstrument(symbol: string): Instrument | undefined {
  return BY_SYMBOL.get(symbol);
}

export function priceScale(inst: Instrument): number {
  return Math.pow(10, inst.digits);
}

/**
 * Come convertire un importo nella valuta di quotazione in USD.
 * - `identity`: la quotazione è già in dollari (USD o USDT).
 * - `self`: coppia USDxxx, si divide per il prezzo dello strumento stesso.
 * - `multiply` / `divide`: serve il prezzo di un'altra coppia (`symbol`).
 */
export type Conversion =
  | { kind: "identity" }
  | { kind: "self" }
  | { kind: "multiply"; symbol: string }
  | { kind: "divide"; symbol: string };

export function quoteConversion(inst: Instrument): Conversion {
  if (inst.quote === "USD" || inst.quote === "USDT") return { kind: "identity" };
  if (inst.base === "USD") return { kind: "self" };
  const direct = `${inst.quote}USD`;
  if (BY_SYMBOL.has(direct)) return { kind: "multiply", symbol: direct };
  const inverse = `USD${inst.quote}`;
  if (BY_SYMBOL.has(inverse)) return { kind: "divide", symbol: inverse };
  throw new Error(`Nessuna conversione in USD per ${inst.symbol}`);
}

/** Simbolo extra da caricare per convertire il P&L, se serve. */
export function conversionSymbol(inst: Instrument): string | null {
  const c = quoteConversion(inst);
  return c.kind === "multiply" || c.kind === "divide" ? c.symbol : null;
}

export function formatPrice(inst: Instrument, price: number): string {
  return price.toFixed(inst.digits);
}
