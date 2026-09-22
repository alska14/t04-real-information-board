import { NextResponse } from "next/server";
import { closePosition, getOpenPosition } from "@/lib/db";
import { fetchMarketSnapshot } from "@/lib/coingecko";

export const dynamic = "force-dynamic";

export async function POST() {
  const open = await getOpenPosition();
  if (!open) {
    return NextResponse.json({ ok: false, error: "no open position" }, { status: 404 });
  }
  const snapshot = await fetchMarketSnapshot();
  if (!snapshot) {
    return NextResponse.json({ ok: false, error: "price unavailable" }, { status: 502 });
  }
  await closePosition(open.id, snapshot.price, "manual");
  return NextResponse.json({ ok: true });
}
