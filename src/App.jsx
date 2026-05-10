import { useState, useEffect, useCallback } from "react";

// Use the Vercel proxy in production, direct API in dev
const useProxy = typeof window !== "undefined" && window.location.hostname !== "localhost";

const gammaFetch = async (path, params = {}) => {
  const qs = new URLSearchParams(params).toString();
  if (useProxy) {
    const url = `/api/proxy?path=${encodeURIComponent(path)}${qs ? `&${qs}` : ""}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Proxy ${r.status}`);
    return r.json();
  }
  const url = `https://gamma-api.polymarket.com${path}${qs ? `?${qs}` : ""}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
};

const SPORTS = [
  { id: "soccer", label: "⚽ World Cup", keywords: ["FIFA", "World Cup"], icon: "⚽" },
  { id: "tennis", label: "🎾 Tennis", keywords: ["Tennis", "Roland Garros", "Wimbledon", "US Open", "Australian Open", "ATP", "WTA"], icon: "🎾" },
  { id: "basketball", label: "🏀 NBA", keywords: ["NBA", "Basketball"], icon: "🏀" },
];

const probToDecimalOdds = (prob) => {
  if (!prob || prob <= 0) return "-";
  return (1 / prob).toFixed(2);
};

const probToAmericanOdds = (prob) => {
  if (!prob || prob <= 0) return "-";
  if (prob >= 0.5) return `-${Math.round((prob / (1 - prob)) * 100)}`;
  return `+${Math.round(((1 - prob) / prob) * 100)}`;
};

const formatVolume = (vol) => {
  if (!vol) return "$0";
  const n = parseFloat(vol);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

const parseEvent = (event) => {
  const markets = event.markets || [];
  const title = event.title || "";
  const slug = event.slug || "";

  const vsMatch = title.match(/^(.+?)\s+(?:vs\.?|v\.?)\s+(.+?)$/i);
  let outcomes = [];

  if (markets.length === 1 && vsMatch) {
    const m = markets[0];
    const outcomePrices = m.outcomePrices ? JSON.parse(m.outcomePrices) : [];
    const outcomeLabels = m.outcomes ? JSON.parse(m.outcomes) : [];
    outcomes = outcomeLabels.map((label, i) => ({
      label,
      prob: parseFloat(outcomePrices[i] || 0),
    }));
  } else if (markets.length > 1) {
    outcomes = markets
      .filter((m) => m.outcomePrices)
      .map((m) => {
        const prices = JSON.parse(m.outcomePrices);
        const labels = m.outcomes ? JSON.parse(m.outcomes) : [];
        return {
          label: labels[0] || m.groupItemTitle || m.question || "?",
          prob: parseFloat(prices[0] || 0),
        };
      })
      .sort((a, b) => b.prob - a.prob);
  } else if (markets.length === 1) {
    const m = markets[0];
    const outcomePrices = m.outcomePrices ? JSON.parse(m.outcomePrices) : [];
    const outcomeLabels = m.outcomes ? JSON.parse(m.outcomes) : [];
    outcomes = outcomeLabels.map((label, i) => ({
      label,
      prob: parseFloat(outcomePrices[i] || 0),
    }));
  }

  return {
    id: event.id,
    title,
    slug,
    isMatch: !!vsMatch,
    team1: vsMatch ? vsMatch[1].trim() : null,
    team2: vsMatch ? vsMatch[2].trim() : null,
    outcomes,
    volume: event.volume || 0,
    volume24hr: event.volume24hr || 0,
    endDate: event.endDate,
    active: event.active,
    polymarketUrl: `https://polymarket.com/event/${slug}`,
    marketCount: markets.length,
  };
};

/* ── REFERRAL ── */
// Replace with your Polymarket referral tag when eligible
const REFERRAL_TAG = ""; // e.g. "?ref=YOUR_REF"
const polyLink = (slug) =>
  `https://polymarket.com/event/${slug}${REFERRAL_TAG}`;

/* ── Match Row ── */
const MatchRow = ({ event, oddsFormat }) => {
  const [expanded, setExpanded] = useState(false);
  const getOdds = (prob) =>
    oddsFormat === "decimal"
      ? probToDecimalOdds(prob)
      : probToAmericanOdds(prob);

  if (event.isMatch) {
    const t1 = event.outcomes[0]?.prob || 0;
    const t2 = event.outcomes[1]?.prob || 0;
    const draw = event.outcomes[2]?.prob || null;

    return (
      <a
        href={polyLink(event.slug)}
        target="_blank"
        rel="noopener noreferrer"
        className="match-row"
      >
        <div className="match-teams">
          <div className="team-row">
            <span
              className="team-name"
              style={{
                fontWeight: t1 > t2 ? 700 : 400,
                color: t1 > t2 ? "#fff" : "#94a3b8",
              }}
            >
              {event.team1}
            </span>
          </div>
          <div className="team-row">
            <span
              className="team-name"
              style={{
                fontWeight: t2 > t1 ? 700 : 400,
                color: t2 > t1 ? "#fff" : "#94a3b8",
              }}
            >
              {event.team2}
            </span>
          </div>
        </div>
        <div className="odds-container">
          <OddsBadge label="1" prob={t1} getOdds={getOdds} fav={t1 > t2} />
          {draw !== null && (
            <OddsBadge label="X" prob={draw} getOdds={getOdds} />
          )}
          <OddsBadge label="2" prob={t2} getOdds={getOdds} fav={t2 > t1} />
        </div>
        <div className="match-meta">
          <span className="vol-tag">{formatVolume(event.volume)}</span>
        </div>
      </a>
    );
  }

  /* tournament / outright */
  const topOutcomes = expanded ? event.outcomes : event.outcomes.slice(0, 5);
  const hasMore = event.outcomes.length > 5;

  return (
    <div className="tournament-block">
      <a
        href={polyLink(event.slug)}
        target="_blank"
        rel="noopener noreferrer"
        className="tournament-header"
      >
        <span className="tournament-title">{event.title}</span>
        <span className="vol-tag">{formatVolume(event.volume)}</span>
      </a>
      <div className="outcomes-grid">
        {topOutcomes.map((o, i) => (
          <div
            key={i}
            className="outcome-row"
            style={i === 0 ? { borderLeft: "2px solid #22c55e" } : {}}
          >
            <span
              className="outcome-name"
              style={{
                color: i === 0 ? "#fff" : "#94a3b8",
                fontWeight: i === 0 ? 600 : 400,
              }}
            >
              {i === 0 && <span className="fav-star">★</span>}
              {o.label}
            </span>
            <div className="outcome-right">
              <div className="prob-bar">
                <div
                  className="prob-bar-fill"
                  style={{
                    width: `${Math.min(o.prob * 100, 100)}%`,
                    background:
                      i === 0 ? "#22c55e" : "rgba(99,102,241,0.5)",
                  }}
                />
              </div>
              <span className="outcome-odds">{getOdds(o.prob)}</span>
              <span className="outcome-prob">
                {(o.prob * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        ))}
      </div>
      {hasMore && (
        <button
          className="show-more"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? "Show less ▲"
            : `Show all ${event.outcomes.length} outcomes ▼`}
        </button>
      )}
    </div>
  );
};

const OddsBadge = ({ label, prob, getOdds, fav }) => (
  <div className={`odds-badge${fav ? " odds-fav" : ""}`}>
    <span className="odds-label">{label}</span>
    <span className="odds-value">{getOdds(prob)}</span>
    <span className="odds-prob">{(prob * 100).toFixed(0)}%</span>
  </div>
);

/* ── Main App ── */
export default function App() {
  const [sport, setSport] = useState("soccer");
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [oddsFormat, setOddsFormat] = useState("decimal");
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchEvents = useCallback(async (sportId) => {
    setLoading(true);
    setError(null);
    const cfg = SPORTS.find((s) => s.id === sportId);
    if (!cfg) return;

    try {
      const all = [];
      const seen = new Set();

      const tryFetch = async (params) => {
        try {
          const arr = await gammaFetch("/events", params);
          for (const ev of arr) {
            if (!seen.has(ev.id)) {
              seen.add(ev.id);
              all.push(ev);
            }
          }
        } catch (_) {}
      };

      // search by tag name
      for (const kw of cfg.keywords) {
        await tryFetch({
          active: "true", closed: "false", limit: "50",
          order: "volume_24hr", ascending: "false",
          tag: kw,
        });
      }
      // fallback: search by title
      for (const kw of cfg.keywords.slice(0, 2)) {
        await tryFetch({
          active: "true", closed: "false", limit: "50",
          order: "volume_24hr", ascending: "false",
          title: kw,
        });
      }

      const parsed = all
        .map(parseEvent)
        .filter((e) => e.outcomes.length > 0)
        .sort((a, b) => parseFloat(b.volume) - parseFloat(a.volume));

      setData((prev) => ({
        ...prev,
        [sportId]: {
          matches: parsed.filter((e) => e.isMatch),
          tournaments: parsed.filter((e) => !e.isMatch),
          total: parsed.length,
        },
      }));
      setLastRefresh(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents(sport);
  }, [sport, fetchEvents]);

  const cur = data[sport] || { matches: [], tournaments: [], total: 0 };

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        {/* Header */}
        <header className="header">
          <div className="header-left">
            <div className="logo">
              <span className="logo-icon">📊</span>
              <span className="logo-text">PolyScores</span>
            </div>
            <span className="tagline">Polymarket Odds · Live</span>
          </div>
          <div className="header-right">
            <div className="odds-toggle">
              <button
                className={`toggle-btn${oddsFormat === "decimal" ? " active" : ""}`}
                onClick={() => setOddsFormat("decimal")}
              >
                DEC
              </button>
              <button
                className={`toggle-btn${oddsFormat === "american" ? " active" : ""}`}
                onClick={() => setOddsFormat("american")}
              >
                US
              </button>
            </div>
            <button
              className="refresh-btn"
              onClick={() => fetchEvents(sport)}
              title="Refresh"
            >
              ↻
            </button>
          </div>
        </header>

        {/* Tabs */}
        <nav className="tabs">
          {SPORTS.map((s) => (
            <button
              key={s.id}
              className={`tab${sport === s.id ? " tab-active" : ""}`}
              onClick={() => setSport(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <main className="content">
          {loading && (
            <div className="state-msg">
              <div className="spinner" />
              <span>Loading markets…</span>
            </div>
          )}

          {error && (
            <div className="state-msg warn">
              <span style={{ fontSize: 20 }}>⚠️</span>
              <p>
                Could not reach the Polymarket API directly (CORS).
                <br />
                Deploy with the included <code>/api/proxy</code> route to fix
                this.
              </p>
            </div>
          )}

          {!loading && !error && cur.total === 0 && (
            <div className="state-msg">
              <span style={{ fontSize: 32 }}>
                {SPORTS.find((s) => s.id === sport)?.icon}
              </span>
              <p style={{ color: "#94a3b8" }}>
                No active markets found for this sport.
              </p>
              <p style={{ color: "#64748b", fontSize: 12 }}>
                Markets appear as events approach.
              </p>
            </div>
          )}

          {cur.matches.length > 0 && (
            <Section title="MATCHES" count={cur.matches.length}>
              {cur.matches.map((e) => (
                <MatchRow key={e.id} event={e} oddsFormat={oddsFormat} />
              ))}
            </Section>
          )}

          {cur.tournaments.length > 0 && (
            <Section title="FUTURES & OUTRIGHTS" count={cur.tournaments.length}>
              {cur.tournaments.map((e) => (
                <MatchRow key={e.id} event={e} oddsFormat={oddsFormat} />
              ))}
            </Section>
          )}

          {lastRefresh && !loading && (
            <footer className="footer">
              <span>Updated {lastRefresh.toLocaleTimeString()}</span>
              <span className="dot">·</span>
              <span>Data from Polymarket</span>
              <span className="dot">·</span>
              <a
                href="https://polymarket.com/sports"
                target="_blank"
                rel="noopener noreferrer"
              >
                Trade on Polymarket →
              </a>
            </footer>
          )}
        </main>
      </div>
    </>
  );
}

const Section = ({ title, count, children }) => (
  <section className="section">
    <div className="section-header">
      <span className="section-title">{title}</span>
      <span className="section-count">{count}</span>
    </div>
    {children}
  </section>
);

/* ── CSS ── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');

* { margin:0; padding:0; box-sizing:border-box; }
body { background:#0f1116; }
::-webkit-scrollbar { width:4px; }
::-webkit-scrollbar-thumb { background:#1e293b; border-radius:4px; }

.app {
  font-family:'DM Sans',sans-serif;
  background:#0f1116;
  color:#e2e8f0;
  min-height:100vh;
  max-width:680px;
  margin:0 auto;
}

/* Header */
.header {
  display:flex; justify-content:space-between; align-items:center;
  padding:16px 16px 12px;
  border-bottom:1px solid rgba(255,255,255,.06);
}
.header-left { display:flex; align-items:center; gap:12px; }
.header-right { display:flex; align-items:center; gap:8px; }
.logo { display:flex; align-items:center; gap:6px; }
.logo-icon { font-size:22px; }
.logo-text {
  font-size:18px; font-weight:800; letter-spacing:-.5px;
  background:linear-gradient(135deg,#22c55e,#3b82f6);
  -webkit-background-clip:text; -webkit-text-fill-color:transparent;
}
.tagline { font-size:11px; color:#64748b; letter-spacing:.5px; text-transform:uppercase; }

.odds-toggle {
  display:flex; background:rgba(255,255,255,.06); border-radius:6px; overflow:hidden;
}
.toggle-btn {
  background:none; border:none; color:#64748b;
  font-size:11px; font-weight:600; padding:5px 10px;
  cursor:pointer; letter-spacing:.5px; font-family:inherit;
}
.toggle-btn.active { background:rgba(34,197,94,.2); color:#22c55e; }

.refresh-btn {
  background:rgba(255,255,255,.06); border:none; color:#94a3b8;
  font-size:16px; padding:4px 8px; border-radius:6px; cursor:pointer;
}
.refresh-btn:hover { color:#fff; }

/* Tabs */
.tabs {
  display:flex; border-bottom:1px solid rgba(255,255,255,.06); overflow-x:auto;
}
.tab {
  flex:1; background:none; border:none;
  border-bottom:2px solid transparent;
  color:#64748b; font-size:13px; font-weight:600;
  padding:12px 16px; cursor:pointer; white-space:nowrap;
  transition:all .2s; font-family:inherit;
}
.tab:hover { color:#94a3b8; }
.tab-active {
  color:#22c55e; border-bottom-color:#22c55e;
  background:rgba(34,197,94,.05);
}

/* Sections */
.section { margin-bottom:8px; }
.section-header { display:flex; align-items:center; gap:8px; padding:12px 16px 8px; }
.section-title { font-size:11px; font-weight:700; color:#64748b; letter-spacing:1px; }
.section-count {
  font-size:10px; font-weight:600; color:#22c55e;
  background:rgba(34,197,94,.15); padding:1px 6px; border-radius:10px;
}

/* Match Row */
.match-row {
  display:flex; align-items:center; padding:10px 16px; gap:12px;
  border-bottom:1px solid rgba(255,255,255,.04);
  cursor:pointer; text-decoration:none; color:inherit;
  transition:background .15s;
}
.match-row:hover { background:rgba(255,255,255,.06); }
.match-teams { flex:1; min-width:0; }
.team-row { display:flex; align-items:center; padding:2px 0; }
.team-name { font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

.odds-container { display:flex; gap:6px; }
.odds-badge {
  display:flex; flex-direction:column; align-items:center;
  background:rgba(255,255,255,.05); border-radius:6px;
  padding:6px 10px; min-width:52px; gap:2px;
}
.odds-fav {
  background:rgba(34,197,94,.12);
  outline:1px solid rgba(34,197,94,.2);
}
.odds-label { font-size:9px; font-weight:700; color:#64748b; letter-spacing:.5px; }
.odds-value { font-size:14px; font-weight:700; color:#fff; }
.odds-prob  { font-size:10px; color:#64748b; }

.match-meta { display:flex; flex-direction:column; align-items:flex-end; gap:2px; min-width:50px; }
.vol-tag {
  font-size:10px; font-weight:600; color:#64748b;
  background:rgba(255,255,255,.04); padding:2px 6px; border-radius:4px;
}

/* Tournament Block */
.tournament-block { border-bottom:1px solid rgba(255,255,255,.06); padding-bottom:4px; }
.tournament-header {
  display:flex; justify-content:space-between; align-items:center;
  padding:10px 16px 6px; text-decoration:none; color:inherit;
}
.tournament-title { font-size:13px; font-weight:600; color:#e2e8f0; }

.outcomes-grid { padding:0 16px; }
.outcome-row {
  display:flex; justify-content:space-between; align-items:center;
  padding:5px 8px; border-radius:4px; margin-bottom:2px;
}
.outcome-name {
  font-size:12px; flex:1; display:flex; align-items:center; gap:4px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.fav-star { color:#22c55e; font-size:10px; }
.outcome-right { display:flex; align-items:center; gap:8px; flex-shrink:0; }
.prob-bar { width:60px; height:4px; background:rgba(255,255,255,.06); border-radius:2px; overflow:hidden; }
.prob-bar-fill { height:100%; border-radius:2px; transition:width .3s; }
.outcome-odds { font-size:12px; font-weight:700; color:#fff; width:40px; text-align:right; }
.outcome-prob { font-size:11px; color:#64748b; width:40px; text-align:right; }

.show-more {
  background:none; border:none; color:#3b82f6;
  font-size:11px; font-weight:600; padding:6px 16px 10px;
  cursor:pointer; width:100%; text-align:left; font-family:inherit;
}
.show-more:hover { color:#60a5fa; }

/* States */
.state-msg {
  display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:12px; padding:60px 24px;
  color:#64748b; font-size:13px; text-align:center;
}
.state-msg.warn { color:#f59e0b; }
.state-msg p { margin:0; line-height:1.6; }
.state-msg code { background:rgba(255,255,255,.08); padding:1px 5px; border-radius:3px; font-size:11px; }

@keyframes spin { to { transform:rotate(360deg); } }
.spinner {
  width:24px; height:24px;
  border:2px solid rgba(255,255,255,.1);
  border-top-color:#22c55e;
  border-radius:50%;
  animation:spin .8s linear infinite;
}

/* Footer */
.footer {
  display:flex; align-items:center; justify-content:center;
  gap:6px; padding:16px; font-size:10px; color:#475569; flex-wrap:wrap;
}
.footer .dot { color:#334155; }
.footer a { color:#3b82f6; text-decoration:none; }
.footer a:hover { color:#60a5fa; }

/* Mobile */
@media (max-width:480px) {
  .odds-badge { min-width:44px; padding:5px 6px; }
  .odds-value { font-size:12px; }
  .match-row { padding:8px 12px; gap:8px; }
  .prob-bar { width:40px; }
  .tagline { display:none; }
}
`;
