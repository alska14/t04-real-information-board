import { NextResponse } from "next/server";
import { closePosition, getOpenPosition, listPositionHistory } from "@/lib/db";
import { fetchMarketSnapshot } from "@/lib/coingecko";
import { isLiquidated, liquidationPrice, pnlAmount, pnlPct } from "@/lib/sim";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await fetchMarketSnapshot();
  let open = await getOpenPosition();

  if (open && snapshot) {
    if (isLiquidated(open.direction, open.entry_price, open.leverage, snapshot.price)) {
      await closePosition(open.id, snapshot.price, "liquidation");
      open = null;
    }
  }

  const openWithPnl = open && snapshot
    ? {
        ...open,
        current_price: snapshot.price,
        liquidation_price: liquidationPrice(open.direction, open.entry_price, open.leverage),
        pnl_pct: pnlPct(open.direction, open.entry_price, open.leverage, snapshot.price),
        pnl_amount: pnlAmount(open.virtual_size, pnlPct(open.direction, open.entry_price, open.leverage, snapshot.price)),
      }
    : null;

  const history = await listPositionHistory(20);

  return NextResponse.json({ ok: true, open: openWithPnl, history, price: snapshot?.price ?? null });
}
