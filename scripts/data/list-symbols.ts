// Stampa i simboli di tutti gli strumenti, separati da virgola (usato dal workflow dei dati).
// I più usati vengono per primi, così sono pronti prima.
import { INSTRUMENTS } from "../../src/lib/instruments";

const FIRST = ["EURUSD", "XAUUSD", "GBPUSD", "USDJPY", "BTCUSDT", "ETHUSDT", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "GBPJPY", "EURJPY"];
const all = INSTRUMENTS.map((i) => i.symbol);
console.log([...FIRST.filter((s) => all.includes(s)), ...all.filter((s) => !FIRST.includes(s))].join(","));
