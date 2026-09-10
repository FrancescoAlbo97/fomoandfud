import { useState } from 'react'
import { createInitialState, type NewPlayerConfig } from './engine/engine'
import type { GameState } from './engine/types'
import { ConfigContext } from './ui/configContext'
import { GameBoard } from './ui/GameBoard'
import { GameSetup } from './ui/GameSetup'

export default function App() {
  const [game, setGame] = useState<GameState | null>(null)

  if (!game) {
    return (
      <GameSetup
        onStart={(players: NewPlayerConfig[]) => setGame(createInitialState(players))}
      />
    )
  }

  return (
    <ConfigContext.Provider value={game.config}>
      <GameBoard game={game} onGame={setGame} onRestart={() => setGame(null)} />
    </ConfigContext.Provider>
  )
}
