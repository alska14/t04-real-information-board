"use client";

import { useCallback, useEffect, useState } from "react";

type Row = {
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
};

type Status = {
  freshness: "fresh" | "stale";
  error_code: string;
  last_run: {
    fixture_id: string | null;
    virtual_now: string | null;
    outcome: string;
    error_code: string;
    retry_after_seconds: number | null;
  } | null;
  sequence: number;
} | null;

type ReadingResponse = {
  ok: boolean;
  error_code?: string;
  delta?: number | null;
  current?: Row;
  rows: Row[];
  status: Status;
};

const ERROR_LABEL: Record<string, string> = {
  none: "정상",
  timeout: "응답 지연(타임아웃)",
  auth: "인증 거절(401/403)",
  rate_limit: "호출 제한(429)",
  offline: "오프라인",
  schema_error: "응답 형식 오류",
};

const FIXTURE_BUTTONS: { id: string; label: string; kind: "success" | "failure" | "recover" }[] = [
  { id: "T04-NORMAL-D1-A", label: "1일차 조회 (D1-A)", kind: "success" },
  { id: "T04-NORMAL-D1-B", label: "1일차 재조회 (D1-B, 같은 날)", kind: "success" },
  { id: "T04-NORMAL-D2", label: "2일차 조회 (D2)", kind: "success" },
  { id: "T04-TIMEOUT", label: "느린 응답(타임아웃)", kind: "failure" },
  { id: "T04-AUTH-401", label: "외부 원천 401 거절", kind: "failure" },
  { id: "T04-RATE-429", label: "외부 원천 호출 제한", kind: "failure" },
  { id: "T04-OFFLINE", label: "오프라인", kind: "failure" },
  { id: "T04-SCHEMA-BREAK", label: "응답 형식 변경", kind: "failure" },
  { id: "T04-RECOVER-D2", label: "다시 시도 → 회복(RECOVER-D2)", kind: "recover" },
];

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function StatusBadge({ status }: { status: Status }) {
  if (!status) return <span className="badge badge-dim">아직 조회 안 함</span>;
  if (status.freshness === "fresh") {
    return <span className="badge badge-fresh">fresh · 정상</span>;
  }
  return (
    <span className="badge badge-stale">
      stale(오래된 값) · {ERROR_LABEL[status.error_code] ?? status.error_code}
    </span>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <header className="panel-header">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </header>
      {children}
    </section>
  );
}

function DailyTable({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return <p className="empty">저장된 일별 기록이 아직 없습니다.</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>날짜(KST)</th>
            <th>값</th>
            <th>단위</th>
            <th>첫 조회</th>
            <th>마지막 조회</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.record_date}>
              <td>{r.record_date}</td>
              <td className="mono">{r.normalized_value.toLocaleString("ko-KR")}</td>
              <td>{r.unit}</td>
              <td className="mono">{fmtTime(r.first_fetched_at)}</td>
              <td className="mono">{fmtTime(r.last_fetched_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Home() {
  const [live, setLive] = useState<ReadingResponse | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [demo, setDemo] = useState<{ rows: Row[]; status: Status } | null>(null);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);
  const [lastFixture, setLastFixture] = useState<string | null>(null);

  const loadLive = useCallback(async () => {
    setLiveLoading(true);
    try {
      const res = await fetch("/api/reading", { cache: "no-store" });
      const json = (await res.json()) as ReadingResponse;
      setLive(json);
    } finally {
      setLiveLoading(false);
    }
  }, []);

  const loadDemo = useCallback(async () => {
    const res = await fetch("/api/replay", { cache: "no-store" });
    const json = (await res.json()) as { rows: Row[]; status: Status };
    setDemo(json);
  }, []);

  useEffect(() => {
    loadLive();
    loadDemo();
  }, [loadLive, loadDemo]);

  async function runFixture(id: string) {
    setDemoBusy(id);
    try {
      const res = await fetch("/api/replay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixture_id: id }),
      });
      const json = (await res.json()) as { rows: Row[]; status: Status };
      setDemo(json);
      setLastFixture(id);
    } finally {
      setDemoBusy(null);
    }
  }

  async function resetDemo() {
    setDemoBusy("reset");
    try {
      await fetch("/api/reset", { method: "POST" });
      setLastFixture(null);
      await loadDemo();
    } finally {
      setDemoBusy(null);
    }
  }

  const cur = live?.current;

  return (
    <main className="page">
      <header className="hero">
        <h1>오늘의 진짜 정보판</h1>
        <p>데이터가 안 올 때, 값을 지어내지 않고 정직하게 보여줍니다.</p>
      </header>

      <Panel
        title="① 실제 정보판 (비트코인 KRW 시세)"
        subtitle="비개인 공개 원천(CoinGecko)에서 실시간 값을 조회합니다. 로그인·API 키 없음."
      >
        <div className="live-card">
          <div className="live-value-row">
            <div>
              <div className="live-value">
                {cur ? cur.normalized_value.toLocaleString("ko-KR") : "—"}
                <span className="unit">{cur?.unit ?? ""}</span>
              </div>
              {live?.delta != null && (
                <div className={`delta ${live.delta >= 0 ? "up" : "down"}`}>
                  전일 대비 {live.delta >= 0 ? "+" : ""}
                  {live.delta.toLocaleString("ko-KR")}
                </div>
              )}
            </div>
            <StatusBadge status={live?.status ?? null} />
          </div>

          <dl className="meta-grid">
            <dt>출처</dt>
            <dd>
              {cur ? (
                <a href={cur.source_url} target="_blank" rel="noreferrer">
                  {cur.source_name}
                </a>
              ) : (
                "—"
              )}
            </dd>
            <dt>출처 시각</dt>
            <dd className="mono">{fmtTime(cur?.source_time ?? null)}</dd>
            <dt>조회 시각</dt>
            <dd className="mono">{fmtTime((cur as unknown as { fetched_at?: string })?.fetched_at ?? null)}</dd>
            <dt>기준 시간대</dt>
            <dd>Asia/Seoul (KST)</dd>
          </dl>

          <button className="btn primary" onClick={loadLive} disabled={liveLoading}>
            {liveLoading ? "조회 중…" : "다시 조회"}
          </button>
        </div>

        <h3 className="subhead">저장된 일별 기록</h3>
        <DailyTable rows={live?.rows ?? []} />
      </Panel>

      <Panel
        title="② 합성 재생 데모 (채점용)"
        subtitle="아래 버튼은 합성 시험값만 사용합니다. 실제 정보판 데이터와 분리되어 있습니다."
      >
        <div className="demo-toolbar">
          <button className="btn ghost" onClick={resetDemo} disabled={demoBusy !== null}>
            {demoBusy === "reset" ? "초기화 중…" : "초기화(reset)"}
          </button>
          {FIXTURE_BUTTONS.map((f) => (
            <button
              key={f.id}
              className={`btn ${f.kind}`}
              onClick={() => runFixture(f.id)}
              disabled={demoBusy !== null}
            >
              {demoBusy === f.id ? "재생 중…" : f.label}
            </button>
          ))}
        </div>

        <div className="live-card">
          <div className="live-value-row">
            <div>
              <div className="live-value">
                {demo?.rows?.length
                  ? demo.rows[demo.rows.length - 1].normalized_value.toLocaleString("ko-KR")
                  : "—"}
                <span className="unit">{demo?.rows?.length ? demo.rows[demo.rows.length - 1].unit : ""}</span>
              </div>
              <div className="hint">마지막 재생: {lastFixture ?? "없음"}</div>
            </div>
            <StatusBadge status={demo?.status ?? null} />
          </div>
        </div>

        <h3 className="subhead">데모 일별 기록</h3>
        <DailyTable rows={demo?.rows ?? []} />
      </Panel>

      <footer className="footer">
        <a href="/api/receipts">제출정보.json (과정영수증) 보기</a>
      </footer>
    </main>
  );
}
