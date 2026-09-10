import type { MixedCardInstance, OrderTarget, Role } from './types'

export type TradeActionInput =
  | { kind: 'buy'; marketIndex: number }
  | { kind: 'sell'; cardInstanceId: string }
  | { kind: 'ipo' }
  | { kind: 'abandonEtf'; cardInstanceId: string }
  | { kind: 'end' }

// What the engine is waiting for right now.
export type PendingDecision =
  | { type: 'chooseRole'; playerId: string }
  | { type: 'valueInvestorKeep'; playerId: string; drawn: MixedCardInstance[] }
  | { type: 'declareOrder'; playerId: string }
  | { type: 'insideTradingChoice'; playerId: string; eligibleCardIds: string[] }
  | { type: 'tradeAction'; playerId: string }
  | { type: 'lateMarketNewsChoice'; playerId: string; eligibleCardIds: string[] }
  | { type: 'traderPenaltyDiscard'; playerId: string }
  /** §15.2 Short Seller's Tip (Market News): the TARGET picks what to lose. */
  | { type: 'forcedDiscard'; playerId: string; rumorCardIds: string[]; actionCardIds: string[] }
  /** §15.2 Insider Wiretap (Market News): the ACTING player picks the swap after seeing the hand. */
  | { type: 'insiderSwap'; playerId: string; opponentId: string; ownCardIds: string[]; opponentCardIds: string[] }

// What a controller (human UI / bot) submits in response.
export type Decision =
  | { type: 'chooseRole'; playerId: string; role: Role }
  | { type: 'valueInvestorKeep'; playerId: string; keepInstanceIds: string[] }
  | { type: 'declareOrder'; playerId: string; target: OrderTarget; marketNewsCardInstanceId?: string }
  | { type: 'insideTradingChoice'; playerId: string; play: boolean; cardInstanceId?: string }
  | { type: 'tradeAction'; playerId: string; action: TradeActionInput }
  | { type: 'lateMarketNewsChoice'; playerId: string; play: boolean; cardInstanceId?: string }
  | { type: 'traderPenaltyDiscard'; playerId: string; cardInstanceId: string }
  | { type: 'forcedDiscard'; playerId: string; rumorInstanceId?: string; actionInstanceId?: string }
  | { type: 'insiderSwap'; playerId: string; giveInstanceId: string; takeInstanceId: string }
