"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

type Stats = {
  price: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  marketCap: number;
  sparkline7d: number[];
  updatedAt: string;
};

type NewsItem = { title: string; link: string; source: string; pubDate: string };

type SimPosition = {
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
  current_price?: number;
  liquidation_price?: number;
  pnl_pct?: number;
  pnl_amount?: number;
};

type AdviceOption = { direction: "long" | "short"; leverage: number; rationale: string };

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

const LEVERAGE_CHOICES = [1, 2, 3, 5, 10];

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

function fmtKrw(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toLocaleString("ko-KR");
}

function StatusBadge({ status }: { status: Status }) {
  if (!status) return <span className="badge badge-dim">아직 조회 안 함</span>;
  const key = `${status.freshness}-${status.error_code}-${status.sequence}`;
  if (status.freshness === "fresh") {
    return (
      <span key={key} className="badge badge-fresh pulse">
        fresh · 정상
      </span>
    );
  }
  return (
    <span key={key} className="badge badge-stale pulse">
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

function Sparkline({ points }: { points: number[] }) {
  if (!points || points.length < 2) return <p className="empty">차트 데이터가 아직 없습니다.</p>;
  const w = 600;
  const h = 140;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const coords = points.map((p, i) => `${(i * step).toFixed(1)},${(h - ((p - min) / range) * h).toFixed(1)}`);
  const up = points[points.length - 1] >= points[0];
  const areaPath = `M0,${h} L${coords.join(" L")} L${w},${h} Z`;
  const linePath = `M${coords.join(" L")}`;
  const color = up ? "var(--fresh)" : "var(--error)";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="sparkline" preserveAspectRatio="none" role="img" aria-label="7일 가격 추세">
      <path d={areaPath} fill={color} opacity="0.12" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function Home() {
  const [live, setLive] = useState<ReadingResponse | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [demo, setDemo] = useState<{ rows: Row[]; status: Status } | null>(null);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);
  const [lastFixture, setLastFixture] = useState<string | null>(null);

  const [stats, setStats] = useState<Stats | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);

  const [openPos, setOpenPos] = useState<SimPosition | null>(null);
  const [history, setHistory] = useState<SimPosition[]>([]);
  const [advice, setAdvice] = useState<AdviceOption[] | null>(null);
  const [adviceSource, setAdviceSource] = useState<string | null>(null);
  const [adviceMsg, setAdviceMsg] = useState<string | null>(null);
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [simBusy, setSimBusy] = useState(false);
  const [manualDirection, setManualDirection] = useState<"long" | "short">("long");
  const [manualLeverage, setManualLeverage] = useState(2);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeySaved, setApiKeySaved] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("t04-openai-key");
      if (stored) {
        setApiKey(stored);
        setApiKeySaved(true);
      }
    } catch {
      // localStorage 접근 불가(프라이빗 모드 등) — 무시하고 키 없이 진행
    }
  }, []);

  function saveApiKey() {
    const trimmed = apiKeyInput.trim();
    try {
      if (trimmed) {
        window.localStorage.setItem("t04-openai-key", trimmed);
      } else {
        window.localStorage.removeItem("t04-openai-key");
      }
    } catch {
      // 무시
    }
    setApiKey(trimmed);
    setApiKeySaved(Boolean(trimmed));
    setApiKeyInput("");
  }

  function clearApiKey() {
    try {
      window.localStorage.removeItem("t04-openai-key");
    } catch {
      // 무시
    }
    setApiKey("");
    setApiKeySaved(false);
  }

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const loadStats = useCallback(async () => {
    const res = await fetch("/api/bitcoin-stats", { cache: "no-store" });
    if (!res.ok) return;
    const json = (await res.json()) as { ok: boolean } & Stats;
    if (json.ok) setStats(json);
  }, []);

  const loadNews = useCallback(async () => {
    const res = await fetch("/api/news", { cache: "no-store" });
    if (!res.ok) return;
    const json = (await res.json()) as { ok: boolean; items: NewsItem[] };
    if (json.ok) setNews(json.items);
  }, []);

  const loadSim = useCallback(async () => {
    const res = await fetch("/api/sim/positions", { cache: "no-store" });
    if (!res.ok) return;
    const json = (await res.json()) as { ok: boolean; open: SimPosition | null; history: SimPosition[] };
    if (json.ok) {
      setOpenPos(json.open);
      setHistory(json.history);
    }
  }, []);

  useEffect(() => {
    loadLive();
    loadDemo();
    loadStats();
    loadNews();
    loadSim();

    pollRef.current = setInterval(() => {
      loadStats();
      loadSim();
    }, 30_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadLive, loadDemo, loadStats, loadNews, loadSim]);

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

  function ruleBasedAdvice(): AdviceOption[] {
    const change = stats?.change24hPct ?? 0;
    const bullish = change >= 0;
    return [
      {
        direction: bullish ? "long" : "short",
        leverage: 2,
        rationale: bullish ? "24시간 상승세, 낮은 배수로 추세 추종" : "24시간 하락세, 낮은 배수로 추세 추종",
      },
      { direction: "long", leverage: 1, rationale: "무배수에 가까운 안전한 롱 관망" },
      { direction: "short", leverage: 5, rationale: "변동성 베팅용 고배수 숏 (재미용)" },
    ];
  }

  function parseAiOptions(raw: unknown): AdviceOption[] | null {
    const obj = raw as { options?: unknown };
    if (!Array.isArray(obj.options) || obj.options.length === 0) return null;
    const out: AdviceOption[] = [];
    for (const item of obj.options.slice(0, 3)) {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      if (o.direction !== "long" && o.direction !== "short") return null;
      const lev = Number(o.leverage);
      if (!Number.isInteger(lev) || lev < 1 || lev > 10) return null;
      out.push({ direction: o.direction, leverage: lev, rationale: typeof o.rationale === "string" ? o.rationale.slice(0, 120) : "" });
    }
    return out.length ? out : null;
  }

  async function requestAdvice() {
    setAdviceLoading(true);
    setAdviceMsg(null);
    try {
      if (!apiKey) {
        setAdvice(ruleBasedAdvice());
        setAdviceSource("rule");
        return;
      }

      const sparkline = stats?.sparkline7d ?? [];
      const sparkMin = sparkline.length ? Math.min(...sparkline) : 0;
      const sparkMax = sparkline.length ? Math.max(...sparkline) : 0;
      const priceText = stats ? stats.price.toLocaleString("ko-KR") : "알 수 없음";
      const changeText = stats ? stats.change24hPct.toFixed(2) : "0";

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.7,
          max_tokens: 300,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "당신은 오락용 가상 모의투자 게임의 도우미입니다. 실제 금융 조언이 아니고, 참가자는 실제 자금이 아닌 가상 자금으로만 놉니다. " +
                "주어진 시세를 참고해 재미있는 가상 포지션 추천안 정확히 3개를 만드세요. " +
                '반드시 {"options":[{"direction":"long|short","leverage":정수(1~10),"rationale":"한국어 20자 내외"}, ...]} 형태의 JSON 객체만 답하세요. 다른 설명은 쓰지 마세요.',
            },
            {
              role: "user",
              content: `비트코인 현재가 ${priceText}KRW, 24시간 변동 ${changeText}%, 7일 구간 ${sparkMin.toFixed(0)}~${sparkMax.toFixed(0)}KRW.`,
            },
          ],
        }),
      });

      if (!res.ok) {
        setAdviceMsg(res.status === 401 ? "API 키가 올바르지 않습니다. 규칙 기반 추천으로 대신합니다." : "OpenAI 호출 실패, 규칙 기반 추천으로 대신합니다.");
        setAdvice(ruleBasedAdvice());
        setAdviceSource("rule-fallback");
        return;
      }

      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = json.choices?.[0]?.message?.content;
      const parsed = content ? parseAiOptions(JSON.parse(content)) : null;
      if (parsed) {
        setAdvice(parsed);
        setAdviceSource("openai");
      } else {
        setAdviceMsg("AI 응답 형식이 이상해 규칙 기반 추천으로 대신합니다.");
        setAdvice(ruleBasedAdvice());
        setAdviceSource("rule-fallback");
      }
    } catch {
      setAdviceMsg("호출 중 오류가 발생해 규칙 기반 추천으로 대신합니다. (브라우저 CORS 차단일 수 있음)");
      setAdvice(ruleBasedAdvice());
      setAdviceSource("rule-fallback");
    } finally {
      setAdviceLoading(false);
    }
  }

  async function enterPosition(direction: "long" | "short", leverage: number, rationale?: string) {
    setSimBusy(true);
    try {
      const res = await fetch("/api/sim/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ direction, leverage, rationale }),
      });
      if (res.ok) {
        setAdvice(null);
        await loadSim();
      }
    } finally {
      setSimBusy(false);
    }
  }

  async function closeCurrent() {
    setSimBusy(true);
    try {
      await fetch("/api/sim/close", { method: "POST" });
      await loadSim();
    } finally {
      setSimBusy(false);
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

      <Panel title="② 7일 추세 & 24시간 통계" subtitle="30초마다 자동 새로고침됩니다. 그래프·통계는 채점 저장소와 분리된 참고용입니다.">
        <div className="live-card">
          <Sparkline points={stats?.sparkline7d ?? []} />
          <div className="stat-grid">
            <div className="stat-tile">
              <span className="stat-label">현재가</span>
              <span className="stat-value">{fmtKrw(stats?.price)} KRW</span>
            </div>
            <div className={`stat-tile ${stats && stats.change24hPct >= 0 ? "up" : "down"}`}>
              <span className="stat-label">24시간 변동</span>
              <span className="stat-value">
                {stats ? `${stats.change24hPct >= 0 ? "+" : ""}${stats.change24hPct.toFixed(2)}%` : "—"}
              </span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">24h 고가</span>
              <span className="stat-value">{fmtKrw(stats?.high24h)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">24h 저가</span>
              <span className="stat-value">{fmtKrw(stats?.low24h)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">24h 거래대금</span>
              <span className="stat-value">{fmtKrw(stats?.volume24h)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">시가총액</span>
              <span className="stat-value">{fmtKrw(stats?.marketCap)}</span>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="③ 실시간 이슈" subtitle="비트코인 관련 최신 뉴스 (Google 뉴스 RSS, 비개인 공개 원천)">
        {news.length === 0 ? (
          <p className="empty">뉴스를 불러오는 중이거나 아직 없습니다.</p>
        ) : (
          <ul className="news-list">
            {news.map((n, i) => (
              <li key={i}>
                <a href={n.link} target="_blank" rel="noreferrer">
                  {n.title}
                </a>
                <span className="news-meta">
                  {n.source} · {fmtTime(n.pubDate)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="④ AI 모의투자 시뮬레이터 (오락용)" subtitle="가상 자금(1,000,000 KRW 단위)으로만 노는 게임입니다. 실제 투자 조언이 아니며 실제 거래는 없습니다.">
        <div className="disclaimer">
          ⚠ 이 섹션은 재미를 위한 시뮬레이션입니다. AI 추천은 실제 금융 조언이 아니며, 실제 자금 거래를 발생시키지 않습니다.
        </div>

        <div className="apikey-box">
          {apiKeySaved ? (
            <>
              <span className="hint">내 OpenAI API 키가 이 브라우저에만 저장되어 있습니다(서버 전송 없음).</span>
              <button className="btn ghost" onClick={clearApiKey}>
                키 삭제
              </button>
            </>
          ) : (
            <>
              <input
                type="password"
                placeholder="OpenAI API 키 (sk-... , 내 브라우저에만 저장됨)"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
              />
              <button className="btn ghost" onClick={saveApiKey}>
                저장
              </button>
              <span className="hint">키 없이도 규칙 기반 추천으로 사용 가능합니다.</span>
            </>
          )}
        </div>

        {openPos ? (
          <div className="live-card">
            <div className="live-value-row">
              <div>
                <div className="live-value">
                  {openPos.direction === "long" ? "롱" : "숏"} × {openPos.leverage}
                  <span className="unit"> 진입가 {fmtKrw(openPos.entry_price)}</span>
                </div>
                {openPos.pnl_amount != null && (
                  <div className={`delta ${openPos.pnl_amount >= 0 ? "up" : "down"}`}>
                    손익 {openPos.pnl_amount >= 0 ? "+" : ""}
                    {fmtKrw(Math.round(openPos.pnl_amount))} KRW ({openPos.pnl_pct?.toFixed(2)}%)
                  </div>
                )}
              </div>
              <span className="badge badge-fresh pulse">포지션 보유 중</span>
            </div>
            <dl className="meta-grid">
              <dt>현재가</dt>
              <dd className="mono">{fmtKrw(openPos.current_price)} KRW</dd>
              <dt>청산가</dt>
              <dd className="mono">{fmtKrw(openPos.liquidation_price)} KRW</dd>
              <dt>진입 시각</dt>
              <dd className="mono">{fmtTime(openPos.entry_at)}</dd>
              {openPos.rationale && (
                <>
                  <dt>근거</dt>
                  <dd>{openPos.rationale}</dd>
                </>
              )}
            </dl>
            <button className="btn ghost" onClick={closeCurrent} disabled={simBusy}>
              {simBusy ? "처리 중…" : "지금 청산(수동)"}
            </button>
          </div>
        ) : (
          <>
            <div className="demo-toolbar">
              <button className="btn primary" onClick={requestAdvice} disabled={adviceLoading}>
                {adviceLoading ? "추천 받는 중…" : "AI 추천 받기"}
              </button>
            </div>
            {adviceMsg && <p className="empty">{adviceMsg}</p>}
            {advice && (
              <div className="advice-grid">
                {advice.map((a, i) => (
                  <div key={i} className="advice-card">
                    <div className={`advice-dir ${a.direction}`}>{a.direction === "long" ? "롱" : "숏"} × {a.leverage}</div>
                    <p>{a.rationale}</p>
                    <button
                      className="btn success"
                      onClick={() => enterPosition(a.direction, a.leverage, a.rationale)}
                      disabled={simBusy}
                    >
                      이 추천안으로 진입
                    </button>
                  </div>
                ))}
                {adviceSource && adviceSource !== "openai" && <p className="hint">(규칙 기반 추천을 사용했습니다.)</p>}
              </div>
            )}

            <h3 className="subhead">직접 진입</h3>
            <div className="manual-entry">
              <select value={manualDirection} onChange={(e) => setManualDirection(e.target.value as "long" | "short")}>
                <option value="long">롱(상승 베팅)</option>
                <option value="short">숏(하락 베팅)</option>
              </select>
              <select value={manualLeverage} onChange={(e) => setManualLeverage(Number(e.target.value))}>
                {LEVERAGE_CHOICES.map((l) => (
                  <option key={l} value={l}>
                    {l}배
                  </option>
                ))}
              </select>
              <button
                className="btn"
                onClick={() => enterPosition(manualDirection, manualLeverage, "직접 진입")}
                disabled={simBusy}
              >
                직접 진입
              </button>
            </div>
          </>
        )}

        <h3 className="subhead">청산·종료 기록</h3>
        {history.length === 0 ? (
          <p className="empty">아직 기록이 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>방향</th>
                  <th>배수</th>
                  <th>진입가</th>
                  <th>종료가</th>
                  <th>결과</th>
                  <th>종료 시각</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{h.direction === "long" ? "롱" : "숏"}</td>
                    <td>{h.leverage}배</td>
                    <td className="mono">{fmtKrw(h.entry_price)}</td>
                    <td className="mono">{fmtKrw(h.close_price)}</td>
                    <td className={h.close_reason === "liquidation" ? "down" : ""}>
                      {h.close_reason === "liquidation" ? "청산됨" : "수동 종료"}
                    </td>
                    <td className="mono">{fmtTime(h.close_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="⑤ 합성 재생 데모 (채점용)"
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
