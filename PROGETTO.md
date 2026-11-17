# Progetto: app di backtesting manuale con simulazione prop firm

Documento di partenza per costruire la nostra app web di backtesting. L'ispirazione viene dalle funzioni offerte da siti come backtestingmax.com, ma l'app è nostra: nome, grafica, testi e codice saranno originali.

## Obiettivo e ambito

L'app deve fare bene tre cose:

1. **Trading manuale su grafico con replay**: si sceglie uno strumento e una data, il grafico nasconde il futuro e lo si fa avanzare candela per candela, aprendo e chiudendo operazioni come se fosse live.
2. **Dati storici di molte coppie e valute**: forex, oro e crypto già nella prima versione, poi indici e futures, con anni di storico a 1 minuto.
3. **Simulazione di sfide prop firm e di conti diversi**: si crea un conto con regole (target, perdita giornaliera, drawdown massimo, giorni minimi) e l'app dice se la sfida è superata o fallita.

**Fuori ambito**: tutte le funzioni AI, community e strategie pubbliche, journal del trading reale, abbonamenti e pagamenti (per ora), dati al secondo, Renko e range bar.

---

## 1. Cosa offre il sito di riferimento (solo i punti che ci interessano)

Ricerca fatta il 17/11/2026 sulle pagine pubbliche del sito (home, features, pricing, prop firm simulator, manuale, documentazione). Sono affermazioni di marketing, non verificate.

### 1.1 Replay e trading manuale
- Replay candela per candela su dati a 1 minuto; il futuro resta nascosto e il tempo va solo avanti.
- Comandi: play/pausa, velocità regolabile (millisecondi per candela), avanti di 1 o 5 candele, salto alla prossima sessione (Asia, Europa, USA) o a una data precisa.
- **Intrabar**: sui timeframe alti la candela si forma minuto per minuto, così stoppini e livelli si toccano nell'ordine reale.
- Timeframe da 1m a 1D, più timeframe personalizzati (3m, 10m, 2h) e settimanale/mensile.
- Layout con 2–4 grafici sincronizzati nel tempo (es. H4 + M15 + M1 dello stesso cambio).
- Ordini: a mercato e limite, long/short, stop loss e take profit trascinabili, fino a 4 take profit parziali, chiusure parziali (25/50/75%).
- Dimensione posizione in lotti oppure come % di rischio sul saldo.
- Costi: spread fisso o variabile, commissione per lotto, preset per broker.
- Strumenti di disegno (linee, Fibonacci, rettangoli, strumento posizione long/short) e indicatori classici (medie, RSI, MACD, Bollinger, VWAP, sessioni).
- Sessioni salvabili e riprendibili; scorciatoie da tastiera; note con screenshot.
- Statistiche in tempo reale: win rate, profit factor, expectancy, R:R medio, drawdown massimo e giornaliero, curva di equity, export CSV.

### 1.2 Dati storici
- Oltre 250 strumenti: 61 coppie forex + oro, circa 50 crypto in USDT, azioni, ETF, indici, futures (NQ, ES, micro, oro, petrolio).
- Base a 1 minuto; forex e oro dal 2003, gli altri mercati dal 2004–2020.
- La fonte dei dati non è dichiarata.

### 1.3 Sfide prop firm
- 36 regolamenti di 17 aziende (FTMO, The5ers, FundedNext, Topstep, Apex e altre), ognuno con la data dell'ultima verifica.
- Regole tracciate durante il replay: target di profitto, perdita giornaliera, perdita massima, tutte in % del conto con l'importo in dollari accanto.
- Tre tipi di drawdown massimo: **statico**, **trailing a fine giornata**, **trailing intraday** (segue anche il profitto aperto); alcuni si fermano al saldo iniziale.
- Il "giorno di trading" cambia per azienda (futures alle 17:00 di New York, FTMO a mezzanotte CET).
- Giorni minimi di trading o giorni in profitto; regola di consistenza (il giorno migliore non può superare una certa % del profitto totale).
- Limiti di contratti per i futures; sfide in due fasi concatenate.
- Tentativi illimitati, ognuno salvato con le sue regole; regole personalizzate.
- Non modellato: restrizioni sulle news, weekend, fase funded e payout.

---

## 2. Cosa costruiamo noi

### 2.1 Funzioni della prima versione (MVP)
| Area | Funzione |
|---|---|
| Replay | Scelta strumento + data di inizio, play/pausa, velocità, avanti 1 candela, salto a data |
| Grafico | Candele, timeframe 1m/5m/15m/1h/4h/1D, zoom, linee orizzontali e trend line |
| Ordini | Market e limit, long/short, SL e TP trascinabili, size in lotti o in % di rischio |
| Conto | Saldo iniziale, valuta, leva, spread e commissione |
| Statistiche | Lista operazioni, win rate, P&L, profit factor, drawdown, curva di equity |
| Sessioni | Salvataggio e ripresa |
| Prop | **4 prop firm diverse già pronte** (vedi 2.3), sfide a 1 e 2 fasi, target, perdita giornaliera, drawdown massimo statico, giorni minimi, regole personalizzate |
| Dati | 28 coppie forex principali + XAUUSD a 1 minuto dal 2010, più le crypto principali (BTC, ETH, SOL, XRP, BNB e altre in USDT) dal 2017 |

### 2.2 Dopo l'MVP
- Intrabar, multi-grafico sincronizzato, indicatori (EMA, SMA, RSI, ATR, sessioni).
- Drawdown trailing (EOD e intraday), regola di consistenza, altre prop firm oltre alle 4 dell'MVP (comprese quelle futures come Topstep e Apex).
- Più conti in parallelo e confronto tra tentativi.
- Indici, futures, altri metalli e materie prime (le crypto sono già nell'MVP).
- Chiusure parziali, TP multipli, export CSV.

### 2.3 Le 4 prop firm dell'MVP
Sono quattro aziende forex/CFD tra le più usate, tutte con sfida in due fasi e drawdown massimo statico, quindi simulabili con i dati forex, oro e crypto dell'MVP. Ogni preset è un file JSON scritto da noi a partire dal regolamento pubblico, con la data dell'ultima verifica.

| Prop firm | Sfida | Target fase 1 / fase 2 | Perdita giornaliera | Perdita massima | Giorni minimi |
|---|---|---|---|---|---|
| FTMO | Challenge 2 fasi | 10% / 5% | 5% | 10% statica | 4 giorni di trading |
| The5ers | High Stakes | 8% / 5% | 5% | 10% statica | 3 giorni in profitto |
| FundedNext | Stellar 2 fasi | 8% / 5% | 5% | 10% statica | 5 giorni di trading |
| Funding Pips | 2 fasi | 8% / 5% | 5% | 10% statica | 3 giorni di trading |

I valori sono indicativi e vanno ricontrollati sui regolamenti ufficiali prima di scrivere i preset, perché le aziende li cambiano spesso. Per ogni azienda il preset indica anche:
- le taglie di conto disponibili (per esempio 10k, 25k, 50k, 100k, 200k);
- su cosa si calcola la perdita giornaliera (saldo o equity di inizio giornata) e a che ora si azzera il giorno (per FTMO mezzanotte CET);
- se nella fase 2 il target cambia.

Oltre ai 4 preset, l'utente può sempre creare una sfida con regole proprie.

---

## 3. Architettura proposta

```
 Browser (Next.js + React)
 ┌───────────────────────────────────────────────┐
 │ Grafico (Lightweight Charts)                  │
 │ Motore di replay  ── avanza il tempo           │
 │ Motore ordini     ── esegue SL/TP/limit        │
 │ Motore regole prop── valuta la sfida ad ogni   │
 │                      passo                     │
 └──────────────┬────────────────────────────────┘
                │ HTTPS (API)
 ┌──────────────▼────────────────────────────────┐
 │ Backend API (Next.js route handlers)          │
 │  - auth utenti                                │
 │  - sessioni, conti, operazioni, regole prop   │
 │  - URL firmati per i blocchi di dati          │
 └──────┬──────────────────────────┬─────────────┘
        │                          │
 ┌──────▼──────┐          ┌────────▼─────────────┐
 │ PostgreSQL  │          │ Object storage (R2/S3)│
 │ utenti,     │          │ candele 1m in blocchi │
 │ sessioni,   │          │ mensili compressi     │
 │ trade       │          │ (es. EURUSD/2019-03)  │
 └─────────────┘          └────────▲─────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │ Pipeline dati (script batch) │
                    │ scarica → pulisce → converte │
                    └─────────────────────────────┘
```

### Scelte chiave
- **Il replay gira tutto nel browser.** Il client scarica i blocchi di candele a 1 minuto del mese corrente e del successivo, e aggrega da solo i timeframe superiori. Niente server in tempo reale, costi bassi, replay fluido.
- **Una sola fonte di verità: le candele a 1 minuto.** Ogni timeframe (5m, 1h, 4h…) è calcolato dal 1m. Questo rende facile l'intrabar: la candela H1 "in costruzione" è l'aggregato dei minuti già passati.
- **Esecuzione ordini sul minuto.** Ad ogni minuto si controlla se high/low tocca entry, SL o TP. Se nello stesso minuto sono toccati sia SL sia TP si assume lo scenario peggiore (SL), e lo si dichiara nell'interfaccia.
- **Motore regole prop come modulo puro.** Funzione `valuta(regole, storicoEquity, operazioni) → stato` senza dipendenze dall'interfaccia, quindi testabile con unit test. Le regole sono dati JSON, così aggiungere un'azienda vuol dire aggiungere un file, non codice.
- **Anti-sbirciata.** Il client riceve solo i blocchi fino al mese corrente del replay; il server non serve blocchi futuri rispetto alla posizione salvata della sessione (protezione semplice, non assoluta).

### Modello dati (essenziale)
- `users` – id, email, creato_il
- `accounts` – id, user_id, nome, saldo_iniziale, valuta, leva, spread, commissione, `prop_rules_id` (facoltativo)
- `prop_rules` – id, nome, fasi (JSON: target %, perdita giornaliera %, perdita massima %, tipo drawdown, giorni minimi, consistenza %, orario di reset del giorno)
- `sessions` – id, account_id, strumento, timeframe, data_inizio, cursore_corrente, stato (attiva / superata / fallita)
- `trades` – id, session_id, lato, size, entry, sl, tp, apertura, chiusura, prezzo_chiusura, pnl, commissioni
- `drawings` – id, session_id, tipo, dati JSON

### Formato dei dati storici
- Un file per strumento per mese: `/{simbolo}/{anno}/{mese}.bin.gz` (o Parquet).
- Ogni riga: timestamp (UTC), open, high, low, close, volume. Prezzi salvati come interi (es. EURUSD × 100.000) per risparmiare spazio.
- Stima: un mese di EURUSD a 1m ≈ 31.000 righe ≈ 300–400 KB compressi. 30 strumenti × 15 anni ≈ 2–3 GB totali: costo di storage trascurabile.

---

## 4. Fonti di dati storici

| Fonte | Mercati | Granularità e storico | Costo | Note |
|---|---|---|---|---|
| **Dukascopy** (download pubblico, libreria `dukascopy-node`) | Forex, metalli, indici CFD, materie prime | Tick e 1m, forex dal 2003 circa | Gratis | Fonte principale consigliata per l'MVP. Verificare i termini d'uso prima di usarla in un prodotto pubblico |
| **HistData.com** | Forex, alcuni metalli e indici | 1m dal 2000 circa | Gratis | Buona come seconda fonte o controllo incrociato; uso commerciale da verificare |
| **Binance Public Data** (data.binance.vision) | Crypto | 1m (anche 1s) dal 2017 | Gratis | File CSV mensili già pronti, ideale per le crypto |
| **Databento** | Futures CME (ES, NQ, GC, CL), azioni USA | Tick e 1m, anni di storico | A pagamento (a consumo) | Per futures di qualità con licenza chiara |
| **Polygon.io** | Azioni, ETF, indici, forex, crypto USA | 1m, molti anni | Abbonamento | Alternativa per azioni ed ETF |
| **FirstRate Data** | Futures, azioni, ETF, forex | 1m, 15+ anni | Acquisto una tantum | Comodo per caricare tutto in un colpo solo |

**Consiglio**: partire con Dukascopy per forex e oro, aggiungere Binance per le crypto, e valutare Databento o FirstRate solo quando servono i futures. Prima di aprire l'app al pubblico controlliamo le licenze di ciascuna fonte: alcune permettono l'uso personale ma non la redistribuzione.

### Pipeline dati
1. Script (Node o Python) che scarica i dati di un simbolo per un intervallo di date.
2. Pulizia: fuso orario UTC, rimozione duplicati, gestione dei buchi del weekend, controllo di prezzi anomali.
3. Conversione in blocchi mensili compressi e caricamento su object storage.
4. Esecuzione periodica (GitHub Actions programmata, ad esempio ogni settimana) per aggiungere il mese nuovo.

---

## 5. Stack consigliato

| Livello | Scelta | Perché |
|---|---|---|
| Linguaggio | TypeScript ovunque | Un solo linguaggio per client, server e motori |
| Frontend | Next.js (React) + Tailwind CSS | Diffuso, facile da ospitare, routing e API nello stesso progetto |
| Grafico | **TradingView Lightweight Charts** (open source, licenza Apache 2.0) | Leggero, veloce, fatto per le candele; richiede solo l'attribuzione. In alternativa KLineChart |
| Stato client | Zustand | Semplice per lo stato del replay e del conto |
| Database | PostgreSQL su Supabase (o Neon) | Gratis per iniziare, include autenticazione |
| ORM | Drizzle (o Prisma) | Schema tipizzato e migrazioni |
| Storage dati | Cloudflare R2 (o Supabase Storage) | Economico, nessun costo di traffico in uscita su R2 |
| Hosting | Vercel | Deploy automatico da GitHub |
| Test | Vitest per i motori, Playwright per l'interfaccia | I motori ordini e prop devono avere test solidi |
| CI | GitHub Actions | Test a ogni push e pipeline dati programmata |

Tutto gira in cloud, niente da installare sul PC.

---

## 6. Fasi di sviluppo

| Fase | Contenuto | Risultato visibile |
|---|---|---|
| **0. Fondamenta** | Progetto Next.js, CI, lint, deploy su Vercel, database e login | Sito online vuoto con accesso |
| **1. Dati** | Pipeline Dukascopy per le 28 coppie forex e XAUUSD, pipeline Binance per le crypto principali, formato a blocchi, API che serve i blocchi | Forex, oro e crypto disponibili |
| **2. Grafico e replay** | Lightweight Charts, aggregazione timeframe dal 1m, play/pausa/velocità/step/salto a data | Replay funzionante senza trading |
| **3. Trading** | Motore ordini (market, limit, SL, TP), size in lotti o % rischio, spread e commissioni, pannello operazioni | Si può fare backtest manuale |
| **4. Conti e statistiche** | Conti multipli, salvataggio sessioni, statistiche e curva di equity | Sessioni riprendibili con risultati |
| **5. Prop firm (MVP)** | Motore regole: target, perdita giornaliera, drawdown statico, giorni minimi, 2 fasi; i 4 preset (FTMO, The5ers, FundedNext, Funding Pips) più regole personalizzate; esito superata/fallita e storico tentativi | 4 sfide prop simulabili |
| **6. Prop firm (avanzato)** | Drawdown trailing EOD e intraday, consistenza, altre aziende comprese le futures | Simulazione prop completa |
| **7. Più mercati** | Indici, futures, altri metalli e materie prime; ricerca strumenti | Catalogo ampio |
| **8. Rifinitura** | Intrabar, multi-grafico, indicatori, disegni, scorciatoie, export CSV | App completa per l'uso quotidiano |

Le fasi 0–5 formano l'MVP. Ogni fase si chiude con una pull request revisionabile.

---

## 7. Rischi e punti aperti
- **Licenze dei dati**: le fonti gratuite vanno bene per uso personale; per un'app pubblica servono verifica dei termini o una fonte a pagamento.
- **Preset delle prop firm**: le regole cambiano spesso. Ogni preset va scritto da noi dal regolamento pubblico, con data di verifica, e presentato come simulazione indicativa.
- **Precisione**: con dati a 1 minuto l'ordine esatto SL/TP dentro lo stesso minuto non è noto; adottiamo l'ipotesi peggiore.
- **Marchi**: niente nomi, loghi, testi o grafica del sito di riferimento.

## 8. Decisioni da prendere con Eze
1. App solo personale o da aprire anche ad altri utenti (cambia la scelta delle fonti dati)?
2. Nome dell'app.
3. Elenco preciso delle crypto da includere nell'MVP.
