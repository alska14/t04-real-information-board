export function liquidationPrice(direction: "long" | "short", entryPrice: number, leverage: number): number {
  return direction === "long" ? entryPrice * (1 - 1 / leverage) : entryPrice * (1 + 1 / leverage);
}

export function isLiquidated(
  direction: "long" | "short",
  entryPrice: number,
  leverage: number,
  currentPrice: number
): boolean {
  const liq = liquidationPrice(direction, entryPrice, leverage);
  return direction === "long" ? currentPrice <= liq : currentPrice >= liq;
}

export function pnlPct(direction: "long" | "short", entryPrice: number, leverage: number, currentPrice: number) {
  const raw = direction === "long" ? (currentPrice - entryPrice) / entryPrice : (entryPrice - currentPrice) / entryPrice;
  return raw * leverage * 100;
}

export function pnlAmount(virtualSize: number, pnlPercent: number) {
  return (virtualSize * pnlPercent) / 100;
}

export function stopLossHit(stopLossPct: number | null, currentPnlPct: number): boolean {
  if (stopLossPct == null) return false;
  return currentPnlPct <= -Math.abs(stopLossPct);
}
