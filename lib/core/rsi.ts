/**
 * RSI calculation — single source of truth.
 */

export function calculateRsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

/** RSI-based signal: oversold (< 30) → UP, overbought (> 80) → DOWN */
export function rsiSignal(rsi: number | null): "UP" | "DOWN" | null {
  if (rsi == null) return null;
  if (rsi <= 30) return "UP";
  if (rsi >= 80) return "DOWN";
  return null;
}
