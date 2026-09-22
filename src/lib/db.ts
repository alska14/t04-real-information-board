import { neon } from "@neondatabase/serverless";
import { ErrorCode, NormalizedReading } from "./adapter";

const sql = neon(process.env.DATABASE_URL!);

let schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS daily_readings (
          signal_id text NOT NULL,
          record_date date NOT NULL,
          normalized_value double precision NOT NULL,
          unit text NOT NULL,
          source_name text NOT NULL,
          source_url text NOT NULL,
          source_time timestamptz,
          record_timezone text NOT NULL,
          first_fetched_at timestamptz NOT NULL,
          last_fetched_at timestamptz NOT NULL,
          PRIMARY KEY (signal_id, record_date)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS reading_status (
          signal_id text PRIMARY KEY,
          freshness text NOT NULL,
          error_code text NOT NULL,
          last_run jsonb,
          sequence integer NOT NULL DEFAULT 0,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS sealed_receipts (
          signal_id text NOT NULL,
          record_date date NOT NULL,
          canonical_kind text NOT NULL DEFAULT 't04_day',
          server_created_at timestamptz NOT NULL DEFAULT now(),
          source_url text NOT NULL,
          source_observed_at timestamptz,
          normalized_value double precision NOT NULL,
          unit text NOT NULL,
          PRIMARY KEY (signal_id, record_date)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS sim_positions (
          id serial PRIMARY KEY,
          direction text NOT NULL CHECK (direction IN ('long', 'short')),
          leverage integer NOT NULL CHECK (leverage BETWEEN 1 AND 10),
          entry_price double precision NOT NULL,
          entry_at timestamptz NOT NULL DEFAULT now(),
          virtual_size double precision NOT NULL DEFAULT 1000000,
          status text NOT NULL DEFAULT 'open',
          close_price double precision,
          close_at timestamptz,
          close_reason text,
          rationale text,
          stop_loss_pct double precision
        )
      `;
      await sql`ALTER TABLE sim_positions ADD COLUMN IF NOT EXISTS stop_loss_pct double precision`;
      await sql`
        CREATE TABLE IF NOT EXISTS sim_wallet (
          id integer PRIMARY KEY DEFAULT 1,
          balance double precision NOT NULL DEFAULT 10000000
        )
      `;
      await sql`INSERT INTO sim_wallet (id, balance) VALUES (1, 10000000) ON CONFLICT (id) DO NOTHING`;
    })();
  }
  return schemaReady;
}

export interface DailyRow {
  signal_id: string;
  record_date: string;
  normalized_value: number;
  unit: string;
  source_name: string;
  source_url: string;
  source_time: string | null;
  record_timezone: string;
  first_fetched_at: string;
  last_fetched_at: string;
}

export async function listDailyRows(signalId: string): Promise<DailyRow[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT signal_id, record_date::text, normalized_value, unit, source_name, source_url,
           source_time, record_timezone, first_fetched_at, last_fetched_at
    FROM daily_readings WHERE signal_id = ${signalId} ORDER BY record_date ASC
  `) as unknown as DailyRow[];
  return rows;
}

export async function getStatus(signalId: string) {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM reading_status WHERE signal_id = ${signalId}
  `) as unknown as {
    signal_id: string;
    freshness: string;
    error_code: string;
    last_run: unknown;
    sequence: number;
    updated_at: string;
  }[];
  return rows[0] ?? null;
}

export async function applySuccessfulReading(
  reading: NormalizedReading,
  runMeta: { fixture_id?: string | null; virtual_now?: string | null }
) {
  await ensureSchema();

  const previousRows = (await sql`
    SELECT * FROM daily_readings
    WHERE signal_id = ${reading.signal_id} AND record_date < ${reading.record_date}
    ORDER BY record_date DESC
    LIMIT 1
  `) as unknown as DailyRow[];
  const previous = previousRows[0] ?? null;

  await sql`
    INSERT INTO daily_readings (
      signal_id, record_date, normalized_value, unit, source_name, source_url,
      source_time, record_timezone, first_fetched_at, last_fetched_at
    ) VALUES (
      ${reading.signal_id}, ${reading.record_date}, ${reading.normalized_value}, ${reading.unit},
      ${reading.source_name}, ${reading.source_url}, ${reading.source_time},
      ${reading.record_timezone}, ${reading.fetched_at}, ${reading.fetched_at}
    )
    ON CONFLICT (signal_id, record_date) DO UPDATE SET
      normalized_value = EXCLUDED.normalized_value,
      unit = EXCLUDED.unit,
      source_name = EXCLUDED.source_name,
      source_url = EXCLUDED.source_url,
      source_time = EXCLUDED.source_time,
      record_timezone = EXCLUDED.record_timezone,
      last_fetched_at = EXCLUDED.last_fetched_at
  `;

  await sql`
    INSERT INTO reading_status (signal_id, freshness, error_code, last_run, sequence, updated_at)
    VALUES (
      ${reading.signal_id}, 'fresh', 'none',
      ${JSON.stringify({
        fixture_id: runMeta.fixture_id ?? null,
        virtual_now: runMeta.virtual_now ?? reading.fetched_at,
        outcome: "success",
        error_code: "none",
        retry_after_seconds: null,
      })}::jsonb,
      1, now()
    )
    ON CONFLICT (signal_id) DO UPDATE SET
      freshness = 'fresh',
      error_code = 'none',
      last_run = EXCLUDED.last_run,
      sequence = reading_status.sequence + 1,
      updated_at = now()
  `;

  let delta: number | null = null;
  if (previous && previous.unit === reading.unit) {
    delta = reading.normalized_value - previous.normalized_value;
  }

  return { previous, delta };
}

export async function applyError(
  signalId: string,
  errorCode: ErrorCode,
  runMeta: { fixture_id?: string | null; virtual_now?: string | null; retry_after_seconds?: number | null }
) {
  await ensureSchema();
  await sql`
    INSERT INTO reading_status (signal_id, freshness, error_code, last_run, sequence, updated_at)
    VALUES (
      ${signalId}, 'stale', ${errorCode},
      ${JSON.stringify({
        fixture_id: runMeta.fixture_id ?? null,
        virtual_now: runMeta.virtual_now ?? null,
        outcome: "error",
        error_code: errorCode,
        retry_after_seconds: runMeta.retry_after_seconds ?? null,
      })}::jsonb,
      1, now()
    )
    ON CONFLICT (signal_id) DO UPDATE SET
      freshness = 'stale',
      error_code = ${errorCode},
      last_run = EXCLUDED.last_run,
      sequence = reading_status.sequence + 1,
      updated_at = now()
  `;
}

export async function sealReceipt(reading: NormalizedReading) {
  await ensureSchema();
  await sql`
    INSERT INTO sealed_receipts (
      signal_id, record_date, canonical_kind, source_url, source_observed_at, normalized_value, unit
    ) VALUES (
      ${reading.signal_id}, ${reading.record_date}, 't04_day',
      ${reading.source_url}, ${reading.source_time}, ${reading.normalized_value}, ${reading.unit}
    )
    ON CONFLICT (signal_id, record_date) DO UPDATE SET
      source_url = EXCLUDED.source_url,
      source_observed_at = EXCLUDED.source_observed_at,
      normalized_value = EXCLUDED.normalized_value,
      unit = EXCLUDED.unit
  `;
}

export async function listReceipts(signalId: string) {
  await ensureSchema();
  const rows = (await sql`
    SELECT signal_id, record_date::text, canonical_kind, server_created_at, source_url,
           source_observed_at, normalized_value, unit
    FROM sealed_receipts WHERE signal_id = ${signalId} ORDER BY server_created_at ASC
  `) as unknown as {
    signal_id: string;
    record_date: string;
    canonical_kind: string;
    server_created_at: string;
    source_url: string;
    source_observed_at: string | null;
    normalized_value: number;
    unit: string;
  }[];
  return rows;
}

export async function resetSignal(signalId: string) {
  await ensureSchema();
  await sql`DELETE FROM daily_readings WHERE signal_id = ${signalId}`;
  await sql`DELETE FROM reading_status WHERE signal_id = ${signalId}`;
  await sql`DELETE FROM sealed_receipts WHERE signal_id = ${signalId}`;
}

export interface SimPosition {
  id: number;
  direction: "long" | "short";
  leverage: number;
  entry_price: number;
  entry_at: string;
  virtual_size: number;
  status: "open" | "closed" | "liquidated";
  close_price: number | null;
  close_at: string | null;
  close_reason: string | null;
  rationale: string | null;
  stop_loss_pct: number | null;
}

export async function listOpenPositions(): Promise<SimPosition[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM sim_positions WHERE status = 'open' ORDER BY entry_at DESC
  `) as unknown as SimPosition[];
  return rows;
}

export async function listPositionHistory(limit = 20): Promise<SimPosition[]> {
  await ensureSchema();
  const rows = (await sql`
    SELECT * FROM sim_positions WHERE status != 'open' ORDER BY close_at DESC LIMIT ${limit}
  `) as unknown as SimPosition[];
  return rows;
}

export async function getWalletBalance(): Promise<number> {
  await ensureSchema();
  const rows = (await sql`SELECT balance FROM sim_wallet WHERE id = 1`) as unknown as { balance: number }[];
  return rows[0]?.balance ?? 0;
}

export async function openPosition(
  direction: "long" | "short",
  leverage: number,
  entryPrice: number,
  rationale: string | null,
  virtualSize: number,
  stopLossPct: number | null
): Promise<SimPosition> {
  await ensureSchema();
  const rows = (await sql`
    INSERT INTO sim_positions (direction, leverage, entry_price, rationale, virtual_size, stop_loss_pct)
    VALUES (${direction}, ${leverage}, ${entryPrice}, ${rationale}, ${virtualSize}, ${stopLossPct})
    RETURNING *
  `) as unknown as SimPosition[];
  await sql`UPDATE sim_wallet SET balance = balance - ${virtualSize} WHERE id = 1`;
  return rows[0];
}

export async function closePosition(
  id: number,
  closePrice: number,
  reason: "manual" | "liquidation" | "stop_loss",
  returnAmount: number
): Promise<void> {
  await ensureSchema();
  await sql`
    UPDATE sim_positions
    SET status = ${reason === "manual" ? "closed" : "liquidated"},
        close_price = ${closePrice},
        close_at = now(),
        close_reason = ${reason}
    WHERE id = ${id} AND status = 'open'
  `;
  await sql`UPDATE sim_wallet SET balance = balance + ${returnAmount} WHERE id = 1`;
}
