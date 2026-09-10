/**
 * ============================================================================
 *  FOMO & FUD — FILE DI BILANCIAMENTO
 * ============================================================================
 *
 *  QUESTO È L'UNICO FILE CHE DEVI MODIFICARE per cambiare carte, prezzi,
 *  economia, mazzi e valori. L'engine, il simulatore e le AI leggono tutto da
 *  qui: nessun numero di gioco è scritto altrove nel codice.
 *
 *  Ogni modifica passa da `validateBalance()` (in config.ts), che controlla le
 *  invarianti e ti dice esattamente cosa non torna invece di far esplodere una
 *  partita a metà simulazione. Lancia `npm run balance` per il check.
 *
 *  Per una variante ("e se le commissioni fossero 0/2/4/6?") non toccare questo
 *  file: passa un override a `makeConfig({ marketFees: [0, 2, 4, 6] })`.
 * ============================================================================
 */
import type { EffectSpec, RumorTarget, SectorId } from './types'

// ---------------------------------------------------------------------------
// Definizioni di forma (non toccarle: descrivono COME sono fatti i dati sotto)
// ---------------------------------------------------------------------------

export interface SectorBalance {
  id: SectorId
  label: string
  icon: string
  /** I nomi delle Carte Azione di questo settore. La QUANTITÀ di carte del
   *  settore è semplicemente la lunghezza di questa lista. */
  cards: string[]
}

export interface RumorBalance {
  id: string
  name: string
  target: RumorTarget
  /** Metà debole, si risolve subito al Passo 3. */
  insideTrading: EffectSpec
  /** Metà forte, si risolve al Passo 1 del Round successivo. */
  marketNews: EffectSpec
  /** Quante copie fisiche di questa carta stanno nel mazzo misto. */
  quantity: number
}

export interface EtfBalance {
  id: string
  name: string
  /** Carte Azione da possedere a fine partita, per settore. */
  requirement: Partial<Record<SectorId, number>>
  pv: number
  /** Costo in $ per abbandonarlo entro il Round limite (§9). */
  fireSaleCost: number
}

export interface Balance {
  // --- Struttura della partita (§12) -------------------------------------
  rounds: number
  minPlayers: number
  maxPlayers: number
  startingCash: number
  /** Carte pescate a testa dal mazzo misto durante il Setup. */
  startingMixedCards: number

  // --- Settori e scala prezzi (§3.1) --------------------------------------
  sectors: SectorBalance[]
  priceMin: number
  priceMax: number
  priceStart: number
  /** §4.2 — carte rivelate nel Setup che alzano / abbassano gli indicatori. */
  setupBumpUpCards: number
  setupBumpDownCards: number

  // --- Short Squeeze e Crash (§8) -----------------------------------------
  shortSqueezeAt: number
  crashAt: number
  /** Dove torna l'indicatore dopo uno Short Squeeze o un Crash. */
  reboundTo: number

  // --- Mercato e commissioni (§3.2) ---------------------------------------
  marketSize: number
  /** Una commissione per posizione, dalla più vecchia alla più recente.
   *  DEVE avere esattamente `marketSize` elementi. */
  marketFees: number[]

  // --- IPO (§3.3) ----------------------------------------------------------
  ipoCost: number
  /** Quante carte vengono rimosse dal Mercato (e ripescate) con un'IPO. */
  ipoRefreshCount: number
  ipoPerRound: number

  // --- Ruoli (§5) ----------------------------------------------------------
  valueInvestor: { draw: number; keepMax: number; cash: number }
  trader: { draw: number; cash: number; penaltyDiscards: number }

  // --- Mazzi ---------------------------------------------------------------
  rumors: RumorBalance[]
  etfs: EtfBalance[]

  // --- Punteggio (§11) -----------------------------------------------------
  /** Quanti $ di patrimonio valgono 1 Punto Vittoria (arrotondato per difetto). */
  wealthPerPV: number
  /** Ultimo Round in cui si può abbandonare un ETF (§9.2). */
  etfAbandonUntilRound: number
}

// ---------------------------------------------------------------------------
// I VALORI. Da qui in giù è tutto modificabile.
// ---------------------------------------------------------------------------

export const DEFAULT_BALANCE: Balance = {
  rounds: 5,
  minPlayers: 3,
  maxPlayers: 5,
  startingCash: 10,
  startingMixedCards: 1,

  sectors: [
    {
      id: 'tech',
      label: 'Tech',
      icon: '💻',
      cards: [
        'NeuraCore', 'PixelForge', 'QuantumLeap Inc.', 'ByteHive', 'SynthMind', 'Vaporware Ventures',
        'CodeSprawl', 'GlitchWorks', 'LogicLoom', 'ChipTonic', 'DataDredge', 'EchoScript',
      ],
    },
    {
      id: 'energy',
      label: 'Energy',
      icon: '⚡',
      cards: [
        'SolarSurge', 'FusionFolly', 'GridLock Energy', 'CarbonCoin', 'WattWagon', 'TidalTitan',
        'CragOil', 'BioBurn', 'VoltVine', 'ReactorRush', 'WindWhisper', 'HydroHype',
      ],
    },
    {
      id: 'crypto',
      label: 'Crypto',
      icon: '🪙',
      cards: [
        'MoonShiba', 'RugPull Capital', 'ApeChain', 'DiamondHandz', 'HodlCorp', 'ToTheMoon Ltd.',
        'PumpDump Inc.', 'WhaleWatch', 'ChainSaga', 'MemeVault', 'DegenDAO', 'LiquidateMe',
      ],
    },
  ],
  priceMin: 1,
  priceMax: 7,
  priceStart: 4,
  setupBumpUpCards: 2,
  setupBumpDownCards: 2,

  shortSqueezeAt: 1,
  crashAt: 7,
  reboundTo: 4,

  marketSize: 4,
  marketFees: [0, 1, 2, 3],

  ipoCost: 1,
  ipoRefreshCount: 2,
  ipoPerRound: 1,

  valueInvestor: { draw: 3, keepMax: 2, cash: 2 },
  trader: { draw: 1, cash: 5, penaltyDiscards: 1 },

  // --- Rumor di Settore: 4 carte per combinazione settore/direzione ---------
  rumors: [
    { id: 'rumor-tech-up-a', name: 'Breakthrough Chip Unveiled', target: { kind: 'sector', sector: 'tech', direction: 'up' }, insideTrading: { kind: 'movePrice', amount: 1 }, marketNews: { kind: 'movePrice', amount: 2 }, quantity: 2 },
    { id: 'rumor-tech-up-b', name: 'Tech IPO Frenzy', target: { kind: 'sector', sector: 'tech', direction: 'up' }, insideTrading: { kind: 'movePrice', amount: 1 }, marketNews: { kind: 'movePrice', amount: 2 }, quantity: 2 },
    { id: 'rumor-tech-down-a', name: 'Antitrust Probe', target: { kind: 'sector', sector: 'tech', direction: 'down' }, insideTrading: { kind: 'movePrice', amount: -1 }, marketNews: { kind: 'movePrice', amount: -2 }, quantity: 2 },
    { id: 'rumor-tech-down-b', name: 'Chip Shortage Panic', target: { kind: 'sector', sector: 'tech', direction: 'down' }, insideTrading: { kind: 'movePrice', amount: -1 }, marketNews: { kind: 'movePrice', amount: -2 }, quantity: 2 },

    { id: 'rumor-energy-up-a', name: 'Pipeline Deal Signed', target: { kind: 'sector', sector: 'energy', direction: 'up' }, insideTrading: { kind: 'movePrice', amount: 1 }, marketNews: { kind: 'movePrice', amount: 2 }, quantity: 2 },
    { id: 'rumor-energy-up-b', name: 'Heatwave Demand Spike', target: { kind: 'sector', sector: 'energy', direction: 'up' }, insideTrading: { kind: 'movePrice', amount: 1 }, marketNews: { kind: 'movePrice', amount: 2 }, quantity: 2 },
    { id: 'rumor-energy-down-a', name: 'Oil Glut Warning', target: { kind: 'sector', sector: 'energy', direction: 'down' }, insideTrading: { kind: 'movePrice', amount: -1 }, marketNews: { kind: 'movePrice', amount: -2 }, quantity: 2 },
    { id: 'rumor-energy-down-b', name: 'Grid Failure Scandal', target: { kind: 'sector', sector: 'energy', direction: 'down' }, insideTrading: { kind: 'movePrice', amount: -1 }, marketNews: { kind: 'movePrice', amount: -2 }, quantity: 2 },

    { id: 'rumor-crypto-up-a', name: 'Whale Accumulation', target: { kind: 'sector', sector: 'crypto', direction: 'up' }, insideTrading: { kind: 'movePrice', amount: 1 }, marketNews: { kind: 'movePrice', amount: 2 }, quantity: 2 },
    { id: 'rumor-crypto-up-b', name: 'Exchange Listing News', target: { kind: 'sector', sector: 'crypto', direction: 'up' }, insideTrading: { kind: 'movePrice', amount: 1 }, marketNews: { kind: 'movePrice', amount: 2 }, quantity: 2 },
    { id: 'rumor-crypto-down-a', name: 'Exchange Hack Rumor', target: { kind: 'sector', sector: 'crypto', direction: 'down' }, insideTrading: { kind: 'movePrice', amount: -1 }, marketNews: { kind: 'movePrice', amount: -2 }, quantity: 2 },
    { id: 'rumor-crypto-down-b', name: 'Regulator Crackdown', target: { kind: 'sector', sector: 'crypto', direction: 'down' }, insideTrading: { kind: 'movePrice', amount: -1 }, marketNews: { kind: 'movePrice', amount: -2 }, quantity: 2 },

    // --- Rumor di Commissioni ---------------------------------------------
    { id: 'rumor-fees-down', name: 'Broker Price War', target: { kind: 'fees', direction: 'down' }, insideTrading: { kind: 'adjustFees', amount: -1 }, marketNews: { kind: 'adjustFees', amount: -2 }, quantity: 2 },
    { id: 'rumor-fees-up', name: 'Regulatory Fee Hike', target: { kind: 'fees', direction: 'up' }, insideTrading: { kind: 'adjustFees', amount: 1 }, marketNews: { kind: 'adjustFees', amount: 2 }, quantity: 2 },

    // --- Rumor di Avversario ----------------------------------------------
    { id: 'rumor-opponent-down', name: "Short Seller's Tip", target: { kind: 'opponent', direction: 'down' }, insideTrading: { kind: 'discardRandomRumor' }, marketNews: { kind: 'discardChosenRumorAndAzione' }, quantity: 1 },
    { id: 'rumor-opponent-up', name: 'Insider Wiretap', target: { kind: 'opponent', direction: 'up' }, insideTrading: { kind: 'peekHand' }, marketNews: { kind: 'swapAzioneCard' }, quantity: 1 },
  ],

  // --- ETF: obiettivi privati di fine partita (§15.3) -----------------------
  etfs: [
    { id: 'etf-tech-starter', name: 'Tech Starter', requirement: { tech: 2 }, pv: 4, fireSaleCost: 2 },
    { id: 'etf-energy-starter', name: 'Energy Starter', requirement: { energy: 2 }, pv: 4, fireSaleCost: 2 },
    { id: 'etf-crypto-starter', name: 'Crypto Starter', requirement: { crypto: 2 }, pv: 4, fireSaleCost: 2 },
    { id: 'etf-tripla', name: 'Tripla Diversificata', requirement: { tech: 1, energy: 1, crypto: 1 }, pv: 6, fireSaleCost: 3 },
    { id: 'etf-tech-heavy', name: 'Tech Heavy', requirement: { tech: 4 }, pv: 8, fireSaleCost: 4 },
    { id: 'etf-energy-heavy', name: 'Energy Heavy', requirement: { energy: 4 }, pv: 8, fireSaleCost: 4 },
    { id: 'etf-crypto-heavy', name: 'Crypto Heavy', requirement: { crypto: 4 }, pv: 8, fireSaleCost: 4 },
    { id: 'etf-tech-energy', name: 'Tech & Energy', requirement: { tech: 2, energy: 2 }, pv: 10, fireSaleCost: 5 },
    { id: 'etf-energy-crypto', name: 'Energy & Crypto', requirement: { energy: 2, crypto: 2 }, pv: 10, fireSaleCost: 5 },
    { id: 'etf-tech-crypto', name: 'Tech & Crypto', requirement: { tech: 2, crypto: 2 }, pv: 10, fireSaleCost: 5 },
    { id: 'etf-grande-diversificazione', name: 'Grande Diversificazione', requirement: { tech: 2, energy: 2, crypto: 2 }, pv: 14, fireSaleCost: 7 },
    { id: 'etf-monopolio-tech', name: 'Monopolio Tech', requirement: { tech: 6 }, pv: 16, fireSaleCost: 8 },
  ],

  wealthPerPV: 2,
  etfAbandonUntilRound: 3,
}
