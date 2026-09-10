import { createContext, useContext } from 'react'
import { DEFAULT_CONFIG, type GameConfig } from '../engine/config'

/** Rende il GameConfig della partita in corso disponibile a tutti i componenti carta,
 *  così nessun pezzo di UI ha valori di gioco cablati dentro. */
export const ConfigContext = createContext<GameConfig>(DEFAULT_CONFIG)

export function useConfig(): GameConfig {
  return useContext(ConfigContext)
}
