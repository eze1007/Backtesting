# Backtesting

App web per fare backtesting manuale: si sceglie uno strumento e una data, il grafico nasconde il futuro e lo si fa avanzare candela per candela, aprendo e chiudendo operazioni come se fosse live. Si può anche simulare una sfida prop firm, con le regole di FTMO, The5ers, FundedNext, Funding Pips o regole personalizzate.

Il piano completo è in [PROGETTO.md](PROGETTO.md).

## Cosa fa (MVP)

- **Replay**: play/pausa, velocità, avanti di 1 minuto o di 1 candela, salto a una data. La candela del timeframe si forma minuto per minuto.
- **Timeframe**: 1m, 5m, 15m, 1H, 4H, 1D, tutti calcolati dai dati a 1 minuto.
- **Ordini**: a mercato, limit e stop, buy e sell, stop loss e take profit (anche trascinandoli sul grafico), dimensione in lotti o in % di rischio, spread e commissioni.
- **Conti e sessioni**: quante sessioni vuoi, ognuna con il suo conto, salvate nel browser e riprendibili.
- **Statistiche**: win rate, profit factor, expectancy, drawdown, curva del saldo, esportazione CSV.
- **Sfide prop**: 4 prop firm con le taglie di conto, sfide a 2 fasi, perdita giornaliera, perdita massima, giorni minimi, giorni in profitto, esito superata/fallita e nuovi tentativi.
- **Strumenti**: 28 coppie forex, oro (XAUUSD) e 8 crypto (BTC, ETH, BNB, SOL, XRP, ADA, DOGE, LTC).
- **Disegni**: linee orizzontali e trend line.

## Dati storici

- Forex e oro: Dukascopy, dal 2010. Crypto: Binance, dal 2018 circa.
- Il workflow **Dati storici** (`.github/workflows/data.yml`) scarica le candele a 1 minuto e le pubblica come file della release `data-v1` del repository, un file per strumento e anno. Gira da solo ogni lunedì per aggiungere le ultime settimane, e si può avviare a mano da GitHub → Actions → Dati storici → Run workflow.
- L'app scarica questi file lato server e li tiene in cache. Per le crypto, se un mese non è ancora nella release, li prende direttamente da Binance.
- I dati sono per uso personale: prima di aprire l'app ad altri utenti vanno verificate le licenze delle fonti.

## Avviarla

Serve Node.js 20 o superiore.

```bash
npm ci
npm run dev        # http://localhost:3000, dati reali dalla release
npm run dev:demo   # dati sintetici, utile senza connessione
```

Senza installare niente sul PC:
- **GitHub Codespaces**: dal repository, Code → Codespaces → Create codespace. L'app si avvia da sola e si apre nel browser.
- **Vercel**: importa il repository su vercel.com; non servono variabili d'ambiente.

Variabili d'ambiente facoltative:

| Variabile | A cosa serve |
|---|---|
| `DATA_SOURCE=demo` | Usa dati sintetici invece di quelli reali |
| `DATA_BASE_URL` | Indirizzo alternativo da cui scaricare i file annuali |
| `DATA_CACHE_DIR` | Cartella della cache su disco (predefinita: cartella temporanea) |

## Test

```bash
npm test              # test dei motori (ordini, regole prop, statistiche, dati)
npm run build && npm run e2e   # test nel browser con dati demo
npm run test:sources  # verifica che Dukascopy e Binance rispondano (serve rete)
```

La CI su GitHub esegue typecheck, test, build e test nel browser a ogni push.

## Struttura

```
src/lib/engine.ts        motore ordini (esecuzione su candele a 1 minuto, SL/TP, spread, commissioni)
src/lib/prop/            regole e preset delle prop firm
src/lib/session.ts       sessione = conto + ordini + sfida prop
src/lib/stats.ts         statistiche
src/lib/candles.ts       aggregazione dei timeframe
src/lib/data/            formato dei file, fonti dati, cache lato server
src/app/api/candles      API che serve le candele per mese
src/components/          interfaccia (grafico, ticket ordini, pannelli)
scripts/data/            pipeline dei dati storici
```

## Note

- Esecuzione degli ordini: se nello stesso minuto vengono toccati sia lo stop loss sia il take profit, si assume il caso peggiore (stop loss).
- Le regole delle prop firm sono indicative e vanno verificate sui regolamenti ufficiali. L'app non è collegata alle aziende citate.
- I grafici usano [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/) (licenza Apache 2.0).
