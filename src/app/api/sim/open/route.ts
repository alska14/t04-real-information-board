import { NextResponse } from "next/server";
import { getWalletBalance, openPosition } from "@/lib/db";
import { fetchMarketSnapshot } from "@/lib/coingecko";

export const dynamic = "force-dynamic";

const ALLOWED_PCT = [25, 50, 100];

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    direction?: "long" | "short";
    leverage?: number;
    pct?: number;
    stopLossPct?: number | null;
    rationale?: string;
  };

  if (body.direction !== "long" && body.direction !== "short") {
    return NextResponse.json({ ok: false, error: "direction must be long or short" }, { status: 400 });
  }
  const leverage = Number(body.leverage);
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > 10) {
    return NextResponse.json({ ok: false, error: "leverage must be an integer 1-10" }, { status: 400 });
  }
  const pct = Number(body.pct);
  if (!ALLOWED_PCT.includes(pct)) {
    return NextResponse.json({ ok: false, error: "pct must be 25, 50 or 100" }, { status: 400 });
  }
  let stopLossPct: number | null = null;
  if (body.stopLossPct != null) {
    const sl = Number(body.stopLossPct);
    if (!Number.isFinite(sl) || sl <= 0 || sl > 90) {
      return NextResponse.json({ ok: false, error: "stopLossPct must be between 0 and 90" }, { status: 400 });
    }
    stopLossPct = sl;
  }

  const available = await getWalletBalance();
  const virtualSize = Math.floor(available * (pct / 100));
  if (virtualSize <= 0) {
    return NextResponse.json({ ok: false, error: "insufficient balance" }, { status: 409 });
  }

  const snapshot = await fetchMarketSnapshot();
  if (!snapshot) {
    return NextResponse.json({ ok: false, error: "price unavailable" }, { status: 502 });
  }

  const position = await openPosition(
    body.direction,
    leverage,
    snapshot.price,
    body.rationale?.slice(0, 200) ?? null,
    virtualSize,
    stopLossPct
  );
  return NextResponse.json({ ok: true, position });
}
