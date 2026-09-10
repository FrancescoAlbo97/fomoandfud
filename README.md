# FOMO & FUD

Implementazione digitale del gioco da tavolo *FOMO & FUD* (regole in [regolamento.md](regolamento.md)),
con interfaccia giocabile e un simulatore headless per il bilanciamento.

```bash
npm install
npm run dev        # gioca nel browser
npm run balance    # verifica il file di bilanciamento
npm run sim        # simula gli scenari scritti in simulazione.yaml
npm run report     # rigenera i grafici da un .jsonl esistente

python3 python/play.py   # gioca dal Python, stesso simulazione.yaml
```

I due file che si toccano tutti i giorni:

| File | Cosa contiene |
|---|---|
| [`simulazione.yaml`](simulazione.yaml) | quali scenari simulare, con quanti agenti e quante partite |
| [`src/engine/balance.ts`](src/engine/balance.ts) | carte, prezzi, economia — il catalogo completo del gioco |

---

## Modificare carte e valori

**Tutti** i numeri e le carte del gioco stanno in un unico file: [`src/engine/balance.ts`](src/engine/balance.ts).
Nessun valore di gioco è cablato altrove — né nell'engine, né nella UI, né negli agenti.

Il ciclo di lavoro è sempre lo stesso:

```bash
# 1. modifica src/engine/balance.ts
# 2. controlla che il bilanciamento regga
npm run balance
# 3. misura l'effetto
npm run sim -- --games 20000
```

`npm run balance` esegue una **validazione con invarianti**: se una modifica rompe qualcosa
te lo dice con precisione invece di far esplodere una simulazione a metà.

```
❌ Bilanciamento non valido:
  - ETF "etf-monopolio-tech" richiede 14 carte tech ma nel mazzo ce ne sono 12
  - marketFees ha 3 valori ma marketSize è 4: devono coincidere
  - reboundTo (7) deve stare STRETTAMENTE fra shortSqueezeAt e crashAt, altrimenti
    squeeze e crash si autoinnescano all'infinito
```

Ci sono anche avvertimenti non bloccanti (il mazzo può esaurirsi, una svendita ETF
non è metà dei PV, un ETF non è completabile da tutti al tavolo).

### Provare una variante

Aggiungi uno scenario a `simulazione.yaml` con il suo blocco `balance:` — così
la variante resta scritta e confrontabile. Per un tentativo usa e getta basta
`npm run sim -- --set trader.cash=3`.

### Aggiungere una carta

- **Carta Azione**: aggiungi il nome alla lista `cards` del suo settore. La quantità
  di carte per settore *è* la lunghezza della lista.
- **Rumor**: aggiungi una voce a `rumors` con bersaglio, le due metà (Inside e
  Market News) e quante copie. Il validatore controlla che la direzione dichiarata
  e il segno dell'effetto coincidano.
- **ETF**: aggiungi una voce a `etfs` con i requisiti per settore, i PV e la svendita.
- **Settore**: aggiungi una voce a `sectors` con id, etichetta, icona e carte —
  poi ricordati i Rumor e gli ETF che lo riguardano. Tutto il resto (plancia,
  osservazioni, agenti, statistiche) si adatta da solo.

---

### Il riepilogo a terminale

```
AGENTI (ordinati per win rate)
agente           win   ±95%   score     PV  patr.    ETF   %ETF   cash   buy   bluff   segue
etfhunter      31.1%   0.6%   0.556   27.9   16.2   11.8  42.1%    2.5   7.9   28.7%   64.8%
...
EQUITÀ DEI POSTI (atteso 25.0% ciascuno)
  posto 0: 23.1% · posto 1: 24.8% · posto 2: 26.6% · posto 3: 25.4%
MERCATO
  acquisti per posizione: 1ª 53.8% · 2ª 14.6% · 3ª 16.6% · 4ª 15.0%
```

Con `saveMatches: true` resta anche un `.jsonl`: una riga JSON per partita con PV
scomposti, ruoli per Round, traiettorie dei prezzi, **ogni dichiarazione con il flag
`wasBluff`**, acquisti per posizione di Mercato, IPO, ETF abbandonati, macro-azioni usate.

Le simulazioni sono **deterministiche**: stesso seed e stessi agenti danno la stessa
partita, anche in parallelo. Velocità indicativa: ~4.000 partite/s su 8 thread; le
partite non restano mai tutte in memoria, quindi si può salire di ordine di grandezza.

---

## Simulare: `simulazione.yaml`

Tutti i parametri di una campagna di simulazione stanno in
[`simulazione.yaml`](simulazione.yaml). Si modifica il file e si lancia:

```bash
npm run sim
```

Nient'altro. Ogni scenario elencato viene simulato, riassunto a schermo e messo
a confronto nello stesso report.

```yaml
games: 20000
agents: [heuristic, etfhunter, cashking, bluffer]
seed: 1
workers: auto
outDir: data
report: true
saveMatches: false      # true per conservare i .jsonl grezzi

scenarios:
  - name: base            # nessun override: il bilanciamento di serie

  - name: commissioni piatte
    balance:
      marketFees: [0, 1, 1, 2]

  - name: trader povero
    balance:
      trader:
        cash: 3
```

Le chiavi dentro `balance:` sono **esattamente** i campi di `src/engine/balance.ts`;
quello che non scrivi resta al default. Un refuso non passa in silenzio:

```
❌ simulazione.yaml non è valido:
  - scenario "trader povero": "markteFees" non è un campo di balance.
    Campi validi: rounds, minPlayers, maxPlayers, startingCash, ...
```

Un blocco annidato si fonde col default, quindi scrivere solo `trader: { cash: 3 }`
non azzera `draw` e `penaltyDiscards`.

Massimo 3 scenari per volta: oltre, i colori del report non restano
distinguibili sotto daltonismo.

### Flag per le prove al volo

I flag vincono sul file, così non serve editarlo per un tentativo veloce:

| Flag | Effetto |
|---|---|
| `--only NOME` | simula solo quello scenario |
| `--games N` · `--agents a,b,c` · `--seed N` | sovrascrivono i valori del file |
| `--set K=V` | override di bilanciamento su tutti gli scenari |
| `--save-matches` / `--no-save-matches` | conserva o scarta i `.jsonl` |
| `--report` / `--no-report` | forza o salta il report grafico |
| `--config FILE` | usa un altro file di configurazione |

```bash
npm run sim -- --only base --games 2000
npm run sim -- --set wealthPerPV=3 --no-save-matches
```

---

## I grafici

Il report esce da solo con `npm run sim` (finisce in `data/report.html`). Per
rigenerarlo da file `.jsonl` già salvati:

```bash
npm run report -- data/base.jsonl
npm run report -- base=data/base.jsonl "fee alte=data/fee-alte.jsonl"
```

Il report è **un unico file HTML autoconsistente**: niente dipendenze, niente rete, si
apre con un doppio clic e pesa ~40 KB anche quando i dati di partenza sono 50 MB.
Tema chiaro/scuro, tooltip su ogni grafico e una vista tabella con tutti i numeri.

Cosa mostra, e a quale domanda di design risponde:

| Grafico | Domanda |
|---|---|
| Win rate per agente (con margine d'errore al 95%) | c'è una strategia dominante? |
| Da dove arrivano i PV (patrimonio vs ETF) | una delle due fonti è decorativa? |
| Prezzo medio a fine Round | le carte Rumor muovono davvero il mercato? |
| Acquisti per posizione del Mercato | le commissioni sono tarate bene? |
| Ruolo scelto Round per Round | Value Investor e Trader sono entrambi una scelta? |
| ETF completati sui tenuti | quali obiettivi sono carte morte e quali regali? |
| Equità dei posti | contare la posizione al tavolo? |
| Bluff e coerenza | quanto si bluffa, e quanto si esegue? |
| Short Squeeze e Crash per settore | un settore è più instabile degli altri? |
| Distribuzione dei PV finali | l'agente forte sposta la curva o solo la media? |
| Scarto di PV fra 1° e 2° | le partite sono tirate o già decise? |

Con più scenari (o più file) ogni grafico li affianca. Accanto a ogni `.jsonl`
viene scritto un `.meta.json` con gli override usati, così il report sa dare i
nomi giusti a settori ed ETF anche per le varianti.

---

## Addestrare, poi far giocare la policy

Due fasi, un file di configurazione.

```bash
npm run py:setup -- --rl     # una volta: numpy, torch, gymnasium
npm run train                # fase 1: addestra e salva i pesi
npm run sim                  # fase 2: la policy gioca fra gli archetipi
```

### Fase 1 — addestramento

Tutto sta nel blocco `training:` di `simulazione.yaml`:

```yaml
training:
  scenario: base                             # su quale scenario allenarsi
  opponents: [etfhunter, cashking, bluffer]  # chi siede agli altri posti
  steps: 2000000
  envs: 64
  out: models/policy.json
  hidden: [128, 128]
  learningRate: 0.0003
  entropy: 0.02
```

Il tavolo è `1 + len(opponents)`: il learner occupa un posto (a rotazione), gli
altri li riempiono gli agenti del motore. PPO con action masking, ricompensa
terminale basata sul rango. Durante l'addestramento vedi le quattro diagnostiche
che contano:

```
     40,960 passi | score 0.058 | entropia 1.57 | var.spiegata +0.01 | 1,074 episodi | 16,244 passi/s
  ── eval su 2,000 episodi: score 0.358 (migliore 0.358)  → salvata in models/policy.json
```

- **score** — ricompensa media; 0,5 = in media col tavolo, una policy casuale sta a 0,01
- **entropia** — se crolla ha smesso di esplorare e si è incastrata
- **var. spiegata** — sotto 0,2 la testa valore non sta imparando
- l'`eval` è **greedy** (senza esplorazione) e salva solo se migliora

### Fase 2 — la policy in gioco

Registrala fra le `policies:` e mettila fra gli `agents:` di uno scenario:

```yaml
policies:
  trained:
    file: models/policy.json
    temperature: 0     # 0 = mossa migliore · 1 = campiona come in addestramento

scenarios:
  - name: rete vs archetipi
    agents: [trained, etfhunter, cashking, bluffer]
```

Da quel momento `trained` è un agente come tutti gli altri: entra in
`npm run sim`, nella tabella, nei grafici e nel menu di setup della partita.
**Stesso tavolo, stesso metro** — è il solo modo onesto di sapere se ha imparato.

```
agente           win   ±95%   score     PV  patr.    ETF   %ETF   cash   buy   bluff   VI/Tr
bluffer        32.1%   1.7%   0.592   27.0   15.7   11.2  41.6%    4.4   7.4   65.1%  15%/85%
etfhunter      30.8%   1.7%   0.572   26.5   15.4   11.1  41.8%    2.6   7.4   28.5%  20%/80%
cashking       21.1%   1.5%   0.479   24.3   15.5    8.8  36.1%    8.7   6.0   22.4%   9%/91%
trained        16.1%   1.3%   0.357   21.8   13.4    8.4  38.4%   10.7   4.0   75.3%   0%/100%
```

Le colonne dicono subito *cosa* ha imparato. Nell'esempio (solo 40.000 passi):
sceglie Trader il 100% delle volte e accumula $10,7 di cassa comprando 4 carte
contro le 7,4 degli altri — ha capito che i soldi contano, non ancora che vanno
spesi in ETF.

### Le tre soglie per capire se ha imparato

| Soglia | Score | Cosa dimostra |
|---|---|---|
| Batte `random` | > 0,90 | ha capito le regole |
| Pareggia con `heuristic` | ≈ 0,50 | gioca decentemente |
| Batte il tavolo di archetipi | > 0,50 e win > 25% | ha imparato qualcosa che non gli hai detto |

Una policy casuale sta a **0,008**: quello è il pavimento.

### Cambiare i parametri senza riaddestrare

Il modello porta con sé l'impronta della **forma** del gioco — settori, dimensione
del Mercato, Round, giocatori. I parametri *economici* non ne fanno parte, quindi
la stessa policy gioca su qualunque variante di bilanciamento:

```bash
npm run sim -- --only rete --set trader.cash=3      # trained: 30,5%
npm run sim -- --only rete --set marketFees=0,2,4,6 # trained: 15,6%
```

Se invece cambi la forma (aggiungi un settore, cambi `marketSize`), il caricamento
si ferma con un errore che dice esattamente cosa non torna:

```
La policy è stata addestrata su una forma di gioco diversa.
  addestrata su: sectors=tech|energy|crypto;market=4;...
  in uso ora:    sectors=tech|energy|crypto|bio;market=4;...
```

E `temperature` cambia carattere alla stessa policy: 0 gioca sempre la mossa che
ritiene migliore (forte ma prevedibile — in un gioco di bluff è sfruttabile), 1
campiona come in addestramento.

---

## Giocare dal Python (per il reinforcement learning)

```bash
npm run play                                   # crea .venv al primo avvio
npm run play -- --scenario "trader povero" --episodes 20000 --envs 256
```

L'ambiente virtuale sta in `.venv/` e viene creato e popolato da solo al primo
`npm run play`: non serve attivarlo, gli script npm usano il suo Python. Per
lavorarci a mano, `source .venv/bin/activate`.

```bash
npm run py:setup          # solo PyYAML: quanto basta per giocare
npm run py:setup -- --rl  # aggiunge numpy e gymnasium per addestrare
```

Legge lo **stesso `simulazione.yaml`** (scenari, agenti, seed, e il blocco `rl:`).
Il motore non viene duplicato: un processo Node tiene N partite in parallelo e
Python decide solo per il posto in addestramento — gli altri li gioca il ponte
con gli agenti del motore.

```
Scenario 'base' · 4 giocatori · 5 Round
Avversari: heuristic, etfhunter, cashking, bluffer
Osservazione: 155 feature · azioni: 95 (mascherate)

ricompensa media (rango): 0.008   — 0,500 = perfettamente in media
vittorie nette:           0.0%   — atteso 25.0% al caso
125.440 decisioni in 4.8s (26.218 decisioni/s)
```

### Dove va la rete

In `python/play.py`, una funzione sola:

```python
def choose_action(obs: list[float], legal: list[int], rng) -> int:
    # obs   = 155 numeri (vedi la stampa del layout all'avvio)
    # legal = indici delle azioni ammesse adesso
    # con una rete: logits = net(obs); logits[non legali] = -inf; campiona
    return rng.choice(legal)
```

La **ricompensa è terminale e basata sul rango**: 0 durante la partita, poi 1,0 se
hai battuto tutti e 0,0 se sei ultimo (condivisa nei pareggi). Si massimizza la
vittoria, non i Punti Vittoria — sono cose diverse, e chi massimizza i punti gioca
male il finale.

### Con Gymnasium / SB3

```bash
npm run py:setup -- --rl
```

```python
from fomofud import make_gym_env
env = make_gym_env(scenario="base")     # Discrete(95), Box(155), action_masks()
```

Gymnasium è single-agent e qui i giocatori sono 3-5: gli altri posti stanno
**dentro** l'ambiente, giocati dal motore. È il modo consueto di impostare il
self-play. `action_masks()` è il nome che si aspetta `MaskablePPO` di sb3-contrib.
Per addestrare sul serio conviene però usare direttamente `FomoFudVecEnv`, che è
già vettorizzato.

### Le prestazioni, per capire cosa aspettarsi

| | decisioni/s |
|---|---|
| motore TS nativo | ~110.000 (posto in addestramento) |
| ponte, Node su entrambi i lati | ~30.000 |
| ponte, con Python | ~26.000 |

Il canale verso Python costa il 13%: il collo di bottiglia è la codifica delle
osservazioni, non l'IPC. Un milione di episodi sono circa 27 minuti.

**Verificato**: la policy casuale via Python ottiene score 0,008 contro lo 0,012
dell'agente `random` del motore TS allo stesso tavolo. Stesso comportamento,
stesso risultato — encoder, spazio azioni e decodifica sono allineati.

---

## Architettura

```
src/engine/
  balance.ts       ← IL FILE DA MODIFICARE: carte, prezzi, economia
  config.ts        validazione + cataloghi derivati (makeConfig)
  types.ts         tipi di dominio, GameState
  engine.ts        macchina a stati: settle() → PendingDecision → submitDecision()
  market.ts        compravendita e IPO
  effects.ts       effetti delle carte Rumor
  scoring.ts       punteggio finale
  observation.ts   FIREWALL INFORMATIVO: view(state, playerId)
  macroActions.ts  macro-azioni del Passo 4
  features.ts      Observation → vettore piatto di 155 numeri (ingresso della rete)
  actionSpace.ts   spazio azioni piatto Discrete(95) con maschere di legalità
  policyFormat.ts  formato dei pesi, verifica di compatibilità, forward pass
  agents/          agenti (euristici + policy addestrate) + ponte engine↔agente
simulazione.yaml   ← IL PANNELLO DI CONTROLLO: scenari, agenti, partite
src/sim/
  configFile.ts    legge e valida simulazione.yaml
  runGame.ts       una partita headless → MatchRecord
  reportData.ts    aggregazione unica (accumulatore fondibile fra i thread)
  aggregate.ts     accumulatore → riepilogo a terminale
  reportHtml.ts    accumulatore → pagina HTML (SVG scritti a mano, zero dipendenze)
  cli.ts           npm run sim
  report.ts        npm run report
  bridge.ts        server vettorizzato per Python (npm run bridge)
  policyLoader.ts  carica i pesi e registra le policy come agenti
python/
  fomofud.py       client del ponte + FomoFudVecEnv + ambiente Gymnasium
  play.py          npm run play — gioca leggendo simulazione.yaml
  train.py         npm run train — PPO con action masking, esporta i pesi in JSON
  requirements.txt / requirements-rl.txt
models/            pesi addestrati (gitignored)
.venv/             ambiente virtuale Python, creato da npm run py:setup
src/ui/            interfaccia React
```

Due vincoli architetturali che vale la pena non rompere:

**1. Gli agenti vedono solo l'`Observation`.** `view(state, playerId)` proietta lo
stato in ciò che quel giocatore può davvero sapere al tavolo: la propria mano, il
pubblico, e il *card counting* su ciò che non ha ancora visto. Un bot che leggesse
le mani altrui non potrebbe imparare a bluffare né a temere il bluff, e i numeri di
bilanciamento che produce descriverebbero un altro gioco.

**2. Il Passo 4 si esprime in macro-azioni.** Una sequenza di compravendite ha
migliaia di varianti; le intenzioni sono una dozzina (`buyForEtf`, `sellSector:tech`,
`ipo`, `pass`…). Branching costante, log leggibili, e una policy che sceglie fra
intenzioni invece che fra click.

Gli agenti dell'interfaccia e quelli del simulatore sono **gli stessi**: quello che
batti al tavolo è esattamente quello che misuri in torneo.

### Aggiungere un agente

Implementa `Agent` (in [`src/engine/agents/types.ts`](src/engine/agents/types.ts)) e
registralo in `AGENT_REGISTRY`. Comparirà automaticamente sia nel menu di setup della
partita sia in `--agents`.

Gli archetipi attuali (`etfhunter`, `cashking`, `bluffer`, `impatient`) sono lo stesso
codice euristico con `AgentParams` diversi — è il modello previsto anche per la
popolazione di policy addestrate.
