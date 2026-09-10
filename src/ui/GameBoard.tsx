import { useEffect, useRef, useState } from 'react'
import { decideAgentMove, applyAgentMove, makeAgent } from '../engine/agents'
import type { Decision } from '../engine/decisions'
import { currentPending, submitDecision } from '../engine/engine'
import { makeRng, type Rng } from '../engine/rng'
import type { GameState, Phase } from '../engine/types'
import { MarketStrip, SectorTrack } from './Board'
import { DecisionPanel } from './DecisionPanel'
import { GameOverScreen } from './GameOverScreen'
import { HandPanel } from './HandPanel'
import { LogPanel } from './LogPanel'
import { PlayersRow } from './PlayersRow'

const PHASE_LABEL: Record<Phase, string> = {
  setup: 'Setup',
  step1_roleAndFud: 'Passo 1 — Ruolo e FUD',
  step2_declare: 'Passo 2 — Dichiarazione e Market News',
  step3_insideTrading: 'Passo 3 — Inside Trading',
  step4_trade: 'Passo 4 — Compravendita',
  step5_lateMarketNews: 'Passo 5 — Market News tardiva',
  step6_closing: 'Passo 6 — Chiusura',
  gameOver: 'Fine partita',
}

const BOT_MOVE_DELAY_MS = 550

export function GameBoard({
  game,
  onGame,
  onRestart,
}: {
  game: GameState
  onGame: (g: GameState) => void
  onRestart: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  // One seeded stream for every bot decision in this match, so a game replays identically.
  const botRng = useRef<Rng | null>(null)
  if (botRng.current === null) botRng.current = makeRng(game.rngSeed ^ 0x5bf03635)
  const humanPlayers = game.players.filter((p) => p.controller === 'human')
  const [viewedHumanId, setViewedHumanId] = useState<string | undefined>(humanPlayers[0]?.id)
  const viewedHuman = humanPlayers.find((p) => p.id === viewedHumanId) ?? humanPlayers[0]
  const pending = currentPending(game)

  useEffect(() => {
    if (!pending) return
    const player = game.players.find((p) => p.id === pending.playerId)
    if (!player || player.controller === 'human') return
    const agent = makeAgent(player.agentName ?? 'heuristic')

    const timer = setTimeout(() => {
      try {
        const move = decideAgentMove(game, agent, pending, botRng.current!)
        onGame(applyAgentMove(game, player.id, move).state)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }, BOT_MOVE_DELAY_MS)

    return () => clearTimeout(timer)
  }, [game, pending, onGame])

  function handleSubmit(decision: Decision) {
    setError(null)
    try {
      onGame(submitDecision(game, decision))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (game.phase === 'gameOver') {
    return <GameOverScreen state={game} onRestart={onRestart} />
  }

  const activePlayer = pending ? game.players.find((p) => p.id === pending.playerId) : undefined
  const waitingOnBot = pending && activePlayer && activePlayer.controller !== 'human'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ fontSize: 22 }}>📈 FOMO &amp; FUD</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <span className="tag">Round {game.round}/5</span>
          <span className="tag">{PHASE_LABEL[game.phase]}</span>
          <button onClick={onRestart}>Nuova partita</button>
        </div>
      </header>

      <SectorTrack state={game} />
      <MarketStrip state={game} />
      <PlayersRow state={game} activePlayerId={pending?.playerId} />

      {viewedHuman && (
        <div>
          {humanPlayers.length > 1 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <span style={{ color: 'var(--text-dim)', fontSize: 12, alignSelf: 'center' }}>Guarda la mano di:</span>
              {humanPlayers.map((p) => (
                <button key={p.id} className={p.id === viewedHuman.id ? 'primary' : ''} onClick={() => setViewedHumanId(p.id)}>
                  {p.name}
                </button>
              ))}
            </div>
          )}
          <HandPanel player={viewedHuman} />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, alignItems: 'start' }}>
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, background: 'var(--panel)', minHeight: 160 }}>
          {error && (
            <p style={{ color: 'var(--down)', marginBottom: 10 }}>
              ⚠️ {error}
            </p>
          )}
          {pending && !waitingOnBot && <DecisionPanel state={game} pending={pending} onSubmit={handleSubmit} />}
          {pending && waitingOnBot && (
            <p style={{ color: 'var(--text-dim)' }}>
              {CONTROLLER_ICON[activePlayer!.controller]} {activePlayer!.name} sta decidendo…
            </p>
          )}
        </div>
        <div style={{ height: 280 }}>
          <LogPanel log={game.log} />
        </div>
      </div>
    </div>
  )
}

const CONTROLLER_ICON: Record<string, string> = { human: '🧑', random: '🎲', ai: '🤖' }
