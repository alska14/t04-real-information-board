import { NextResponse } from "next/server";
import { getOpenPosition, openPosition } from "@/lib/db";
import { fetchMarketSnapshot } from "@/lib/coingecko";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    direction?: "long" | "short";
    leverage?: number;
    rationale?: string;
  };

  if (body.direction !== "long" && body.direction !== "short") {
    return NextResponse.json({ ok: false, error: "direction must be long or short" }, { status: 400 });
  }
  const leverage = Number(body.leverage);
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > 10) {
    return NextResponse.json({ ok: false, error: "leverage must be an integer 1-10" }, { status: 400 });
  }

  const existing = await getOpenPosition();
  if (existing) {
    return NextResponse.json({ ok: false, error: "position already open" }, { status: 409 });
  }

  const snapshot = await fetchMarketSnapshot();
  if (!snapshot) {
    return NextResponse.json({ ok: false, error: "price unavailable" }, { status: 502 });
  }

  const position = await openPosition(body.direction, leverage, snapshot.price, body.rationale?.slice(0, 200) ?? null);
  return NextResponse.json({ ok: true, position });
}
