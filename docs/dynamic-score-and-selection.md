# Dextrip Arena, dynamic score formula and agent strategy selection

## Goal
Replace fixed strategy usage with a dynamic system where each agent evaluates multiple strategy cards and chooses the best fit for the current BTC 15m market state.

## Core idea
Each agent has:
- a personality
- a preferred strategy
- secondary strategies
- a risk temperament
- a selection process

Each strategy has:
- a base score
- a market fit profile
- strengths
- weaknesses
- confidence rules

The agent does not blindly use one strategy every round. It scores candidate strategies, then chooses the highest adjusted score.

## Proposed agent setup

### Lisa
- preferred: Volume Surge
- secondary: VWAP Reclaim, Trend Pullback
- personality: disciplined, analytical
- bias: likes confirmation and quality over frequency

### Bart
- preferred: Momentum Break
- secondary: Volume Surge, Liquidity Sweep Reversal
- personality: aggressive, opportunistic
- bias: likes breakout and expansion

### Homer
- preferred: RSI Reversal
- secondary: Range Fade, Liquidity Sweep Reversal
- personality: contrarian, impulsive
- bias: likes oversold and overbought snapbacks

### Marge
- preferred: VWAP Reclaim
- secondary: Trend Pullback, Volume Surge
- personality: stable, risk-aware
- bias: likes structured, lower-chaos setups

### Maggie
- preferred: Range Fade
- secondary: VWAP Reclaim, RSI Reversal
- personality: silent precision
- bias: selective, low-noise entries only

### Mr Burns
- preferred: Trend Ride
- secondary: Trend Pullback, Volume Surge
- personality: patient, calculating
- bias: favors strong directional conditions

### Milhouse
- preferred: Trend Pullback
- secondary: VWAP Reclaim, RSI Reversal
- personality: cautious, hesitant
- bias: safer continuation entries

### Nelson
- preferred: Liquidity Sweep Reversal
- secondary: Momentum Break, RSI Reversal
- personality: aggressive, punishing
- bias: hunts stop-runs and sharp reversals

## Market state inputs
For BTC 15m, compute these per round:
- trend direction
- trend strength
- volatility level
- range compression or expansion
- volume expansion ratio
- RSI zone
- VWAP distance
- recent breakout status
- liquidity sweep flag
- support/resistance proximity

## Strategy market fit rules

### Volume Surge
Works best when:
- volume expansion is high
- directional candle close is strong
- trend is aligned

### RSI Reversal
Works best when:
- RSI is stretched
- recent move is extended
- trend is weakening

### Momentum Break
Works best when:
- range compression breaks
- volatility expands
- price leaves structure cleanly

### Trend Ride
Works best when:
- trend is already strong
- pullbacks are shallow
- volume confirms continuation

### VWAP Reclaim
Works best when:
- price reclaims VWAP cleanly
- volume is supportive
- session is not flat

### Range Fade
Works best when:
- volatility is low to medium
- price repeatedly respects boundaries
- no breakout confirmation exists

### Trend Pullback
Works best when:
- trend is healthy
- pullback reaches a structure level
- continuation remains intact

### Liquidity Sweep Reversal
Works best when:
- sweep above or below recent liquidity is detected
- reclaim happens quickly
- reversal impulse is strong

## Dynamic score formula
Each candidate strategy gets:

finalScore =
- baseStrategyScore
- + marketFitBonus
- + agentPreferenceBonus
- + recentStrategyPerformanceBonus
- + recentAgentPerformanceBonus
- - volatilityMismatchPenalty
- - losingStreakPenalty
- - overtradePenalty

## Suggested scoring weights
- baseStrategyScore: 0 to 100 baseline
- marketFitBonus: +0 to +20
- agentPreferenceBonus: +0 to +10
- recentStrategyPerformanceBonus: -10 to +10
- recentAgentPerformanceBonus: -10 to +10
- volatilityMismatchPenalty: 0 to -12
- losingStreakPenalty: 0 to -10
- overtradePenalty: 0 to -8

## Example simplified formula
finalScore =
base
+ fit
+ preference
+ strategyRecent
+ agentRecent
- volatilityPenalty
- streakPenalty
- overtradePenalty

Then clamp to 0 to 100.

## Confidence formula
Confidence should not equal score directly.

Suggested confidence:
confidence =
- 0.45 base
- + marketFitComponent
- + strategyScoreComponent
- + signalClarityComponent
- - uncertaintyPenalty

Then clamp to 0.45 to 0.95.

## Strategy selection algorithm
1. Build candidate list from preferred plus secondary strategies.
2. Compute market-state features.
3. Score every candidate strategy.
4. Rank candidates by finalScore.
5. If top score is below threshold, HOLD.
6. Else choose top strategy.
7. Generate signal and confidence.
8. Store reasoning.

## Suggested thresholds
- score < 68 → HOLD
- score 68 to 74 → weak trade, reduced conviction
- score 75 to 84 → standard trade
- score 85+ → high conviction trade

## Promotion logic upgrade
Promotion should not be pure win rate.
Use:
- weighted recent win rate
- strategy quality score average
- minimum sample size
- max drawdown check
- streak control

## Better promotion score
promotionScore =
- 35 percent recent win rate
- 25 percent recent strategy score average
- 20 percent risk-adjusted consistency
- 10 percent drawdown control
- 10 percent sample size confidence

## Immediate implementation plan
1. Add preferred and secondary strategy arrays per agent.
2. Add market-state feature extractor.
3. Add scoreStrategy(agent, strategy, marketState) helper.
4. Replace single preferred strategy pick with candidate ranking.
5. Store chosen strategy, score, confidence, reasoning.
6. Update leaderboard to show actual selected strategy score.

## Blunt note
This is the point where Dextrip stops being a themed demo and starts becoming a real strategy tournament engine.
