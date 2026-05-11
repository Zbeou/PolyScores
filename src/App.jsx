import { useState, useEffect, useCallback, useMemo, useRef } from "react";

/* ─── CONFIG ─── */
const REF = ""; // your referral param, e.g. "?ref=CODE"
const link = (slug) => `https://polymarket.com/event/${slug}${REF}`;
const isProxy = typeof window !== "undefined" && window.location.hostname !== "localhost";

async function api(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = isProxy
    ? `/api/proxy?path=${encodeURIComponent(path)}${qs ? "&" + qs : ""}`
    : `https://gamma-api.polymarket.com${path}${qs ? "?" + qs : ""}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} on ${path}`);
  return r.json();
}

const TABS = [
  { id: "basketball", label: "🏀 NBA", icon: "🏀",
    trySlugs: ["nba", "basketball", "nba-finals", "nba-playoffs"],
    defaultTournament: "NBA" },
  { id: "soccer", label: "⚽ Football", icon: "⚽",
    trySlugs: ["fifa-world-cup-2026", "fifa-world-cup", "soccer", "football", "world-cup"],
    defaultTournament: "Football" },
  { id: "tennis", label: "🎾 Tennis", icon: "🎾",
    trySlugs: ["tennis", "atp", "wta", "roland-garros", "wimbledon"],
    defaultTournament: "Tennis" },
];

/* ─── HELPERS ─── */
const d2o = (p) => (!p || p <= 0 ? "-" : (1 / p).toFixed(2));
const d2us = (p) => {
  if (!p || p <= 0) return "-";
  return p >= 0.5 ? `-${Math.round((p / (1 - p)) * 100)}` : `+${Math.round(((1 - p) / p) * 100)}`;
};
const fv = (v) => {
  const n = parseFloat(v || 0);
  return n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n.toFixed(0)}`;
};

function buildDates() {
  const dates = [];
  const now = new Date();
  for (let i = -1; i <= 6; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    dates.push(d);
  }
  return dates;
}

function fmtDay(d) {
  const now = new Date(); now.setHours(0,0,0,0);
  const diff = Math.round((d - now) / 86400000);
  if (diff === -1) return "Yesterday";
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function sameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

/* Strip "Tournament: " prefix from a label if present */
function stripPrefix(label, prefix) {
  if (!label || !prefix) return label;
  const p = `${prefix}:`;
  if (label.toLowerCase().startsWith(p.toLowerCase())) {
    return label.slice(p.length).trim();
  }
  return label;
}

/* Extract tournament and match title from full event title */
function extractTournament(fullTitle, sportDefault) {
  // Look for "Tournament Name: rest of title" pattern
  const m = fullTitle.match(/^([^:]+?):\s+(.+)$/);
  if (m) {
    const candidate = m[1].trim();
    // Sanity check: tournament name should be relatively short and not contain "vs"
    if (candidate.length < 80 && !/\bvs?\.?\b/i.test(candidate)) {
      return { tournament: candidate, matchTitle: m[2].trim() };
    }
  }
  return { tournament: sportDefault, matchTitle: fullTitle };
}

/* ─── PARSE EVENTS ─── */
function parseEvent(ev, sportDefault) {
  const markets = ev.markets || [];
  if (!markets.length) return null;

  const fullTitle = ev.title || "";
  const slug = ev.slug || "";

  // Extract tournament & cleaned match title
  const { tournament, matchTitle } = extractTournament(fullTitle, sportDefault);

  // Detect "Team1 vs Team2" within the cleaned match title
  const vs = matchTitle.match(/^(.+?)\s+(?:vs\.?|v\.?)\s+(.+?)$/i);

  // Game start time
  let startTime = null;
  for (const m of markets) {
    const t = m.gameStartTime || m.eventStartTime || null;
    if (t) { startTime = new Date(t); break; }
  }
  if (!startTime && ev.startTime) startTime = new Date(ev.startTime);
  if (!startTime && ev.startDate) startTime = new Date(ev.startDate);

  // Parse outcomes (cleaning labels of tournament prefix)
  const moneyline = markets.find((m) => m.sportsMarketType === "moneyline" || (!m.sportsMarketType && vs));
  let outcomes = [];
  const src = moneyline || markets[0];
  if (src) {
    try {
      const prices = src.outcomePrices ? JSON.parse(src.outcomePrices) : [];
      const labels = src.outcomes ? JSON.parse(src.outcomes) : [];
      outcomes = labels.map((l, i) => ({
        label: stripPrefix(l, tournament),
        prob: parseFloat(prices[i] || 0),
      }));
    } catch (_) {}
  }

  if (!vs && markets.length > 1) {
    outcomes = markets.filter((m) => m.outcomePrices).map((m) => {
      try {
        const p = JSON.parse(m.outcomePrices);
        const l = m.outcomes ? JSON.parse(m.outcomes) : [];
        return {
          label: stripPrefix(l[0] || m.groupItemTitle || "?", tournament),
          prob: parseFloat(p[0] || 0),
        };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => b.prob - a.prob);
  }

  if (!outcomes.length) return null;

  return {
    id: ev.id,
    title: fullTitle,
    matchTitle,
    tournament,
    slug,
    isMatch: !!vs,
    team1: vs ? stripPrefix(vs[1].trim(), tournament) : null,
    team2: vs ? vs[2].trim() : null,
    outcomes,
    volume: ev.volume || 0,
    startTime,
    url: link(slug),
  };
}

/* Group events by tournament. Sort groups by total volume desc, events within by startTime asc */
function groupByTournament(events, chronological = true) {
  const map = new Map();
  for (const ev of events) {
    const key = ev.tournament || "Other";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(ev);
  }

  // Sort each group
  for (const [, evs] of map) {
    evs.sort((a, b) => {
      if (chronological && a.startTime && b.startTime) return a.startTime - b.startTime;
      if (a.startTime && !b.startTime) return -1;
      if (!a.startTime && b.startTime) return 1;
      return parseFloat(b.volume) - parseFloat(a.volume);
    });
  }

  // Sort groups by total volume desc
  return Array.from(map.entries())
    .map(([name, evs]) => ({
      name,
      events: evs,
      totalVolume: evs.reduce((s, e) => s + parseFloat(e.volume || 0), 0),
    }))
    .sort((a, b) => b.totalVolume - a.totalVolume);
}

/* ─── COMPONENTS ─── */

function DateBar({ dates, selected, onSelect }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current?.querySelector(".dp-a");
    if (el) el.scrollIntoView({ inline: "center", block: "nearest" });
  }, []);
  return (
    <div className="dp" ref={ref}>
      {dates.map((d, i) => {
        const sel = sameDay(d, selected);
        return (
          <button key={i} className={`dp-b${sel ? " dp-a" : ""}`} onClick={() => onSelect(d)}>
            <span className="dp-d">{d.getDate()}</span>
            <span className="dp-l">{fmtDay(d)}</span>
          </button>
        );
      })}
    </div>
  );
}

function OB({ label, prob, fmt, fav }) {
  const v = fmt === "decimal" ? d2o(prob) : d2us(prob);
  return (
    <div className={`ob${fav ? " ob-f" : ""}`}>
      <span className="ob-l">{label}</span>
      <span className="ob-v">{v}</span>
      <span className="ob-p">{(prob * 100).toFixed(0)}%</span>
    </div>
  );
}

function GameRow({ g, fmt }) {
  const [exp, setExp] = useState(false);
  const timeStr = g.startTime
    ? g.startTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  if (g.isMatch && g.outcomes.length >= 2) {
    const t1 = g.outcomes[0]?.prob || 0;
    const t2 = g.outcomes[1]?.prob || 0;
    const draw = g.outcomes[2]?.prob || null;
    return (
      <a href={g.url} target="_blank" rel="noopener noreferrer" className="mr">
        <div className="mr-time">{timeStr || "—"}</div>
        <div className="mr-teams">
          <span className="mr-tn" style={{ fontWeight: t1 >= t2 ? 700 : 400, color: t1 >= t2 ? "#fff" : "#8896a8" }}>{g.team1}</span>
          <span className="mr-tn" style={{ fontWeight: t2 > t1 ? 700 : 400, color: t2 > t1 ? "#fff" : "#8896a8" }}>{g.team2}</span>
        </div>
        <div className="mr-odds">
          <OB label="1" prob={t1} fmt={fmt} fav={t1 >= t2} />
          {draw !== null && <OB label="X" prob={draw} fmt={fmt} />}
          <OB label="2" prob={t2} fmt={fmt} fav={t2 > t1} />
        </div>
        <div className="mr-vol">{fv(g.volume)}</div>
      </a>
    );
  }

  // Outright / future — display matchTitle (without tournament prefix since shown in group header)
  const shown = exp ? g.outcomes : g.outcomes.slice(0, 5);
  return (
    <div className="out">
      <a href={g.url} target="_blank" rel="noopener noreferrer" className="out-h">
        <span className="out-t">{g.matchTitle}</span>
        <span className="vt">{fv(g.volume)}</span>
      </a>
      <div className="out-g">
        {shown.map((o, i) => (
          <div key={i} className="out-r" style={i === 0 ? { borderLeft: "2px solid #22c55e" } : {}}>
            <span className="out-n" style={{ color: i === 0 ? "#fff" : "#8896a8", fontWeight: i === 0 ? 600 : 400 }}>
              {i === 0 && <span style={{ color: "#22c55e", fontSize: 10, marginRight: 4 }}>★</span>}
              {o.label}
            </span>
            <div className="out-ri">
              <div className="bar"><div className="bar-f" style={{ width: `${Math.min(o.prob * 100, 100)}%`, background: i === 0 ? "#22c55e" : "rgba(99,102,241,.5)" }} /></div>
              <span className="out-o">{fmt === "decimal" ? d2o(o.prob) : d2us(o.prob)}</span>
              <span className="out-p">{(o.prob * 100).toFixed(1)}%</span>
            </div>
          </div>
        ))}
      </div>
      {g.outcomes.length > 5 && (
        <button className="sm" onClick={() => setExp(!exp)}>
          {exp ? "Less ▲" : `All ${g.outcomes.length} ▼`}
        </button>
      )}
    </div>
  );
}

function TournamentSection({ group, fmt }) {
  return (
    <section className="sec">
      <div className="sec-h">
        <span className="sec-t">{group.name}</span>
        <span className="sec-c">{group.events.length}</span>
      </div>
      {group.events.map((ev) => (
        <GameRow key={ev.id} g={ev} fmt={fmt} />
      ))}
    </section>
  );
}

/* ─── MAIN APP ─── */
export default function App() {
  const [tab, setTab] = useState("basketball");
  const [fmt, setFmt] = useState("decimal");
  const [events, setEvents] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [debug, setDebug] = useState({});
  const [selDate, setSelDate] = useState(() => { const d = new Date(); d.setHours(0,0,0,0); return d; });
  const dates = useMemo(buildDates, []);

  const loadSport = useCallback(async (sportId) => {
    setLoading(true); setError(null);
    const cfg = TABS.find((t) => t.id === sportId);
    if (!cfg) return;

    const debugInfo = { triedSlugs: [], successSlug: null, eventCount: 0 };

    try {
      let rawEvents = [];
      const seen = new Set();

      for (const slug of cfg.trySlugs) {
        debugInfo.triedSlugs.push(slug);
        try {
          const data = await api("/events", {
            tag_slug: slug,
            related_tags: "true",
            active: "true",
            closed: "false",
            limit: "200",
            order: "volume_24hr",
            ascending: "false",
          });
          if (Array.isArray(data) && data.length > 0) {
            for (const ev of data) {
              if (!seen.has(ev.id)) { seen.add(ev.id); rawEvents.push(ev); }
            }
            if (!debugInfo.successSlug) debugInfo.successSlug = slug;
          }
        } catch (e) {
          debugInfo[`err_${slug}`] = e.message;
        }
      }

      debugInfo.eventCount = rawEvents.length;
      setDebug((prev) => ({ ...prev, [sportId]: debugInfo }));

      if (rawEvents.length === 0) {
        setError(`No events returned for ${cfg.label}.`);
        setEvents((p) => ({ ...p, [sportId]: [] }));
        return;
      }

      const parsed = rawEvents
        .map((ev) => parseEvent(ev, cfg.defaultTournament))
        .filter(Boolean);

      setEvents((prev) => ({ ...prev, [sportId]: parsed }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSport(tab);
  }, [tab, loadSport]);

  /* Filter by date, then group by tournament */
  const { matchGroups, futureGroups } = useMemo(() => {
    const all = events[tab] || [];
    const matchesForDate = all.filter((g) => g.startTime && sameDay(g.startTime, selDate));
    const futures = all.filter((g) => !g.startTime && !g.isMatch);
    return {
      matchGroups: groupByTournament(matchesForDate, true),
      futureGroups: groupByTournament(futures, false),
    };
  }, [events, tab, selDate]);

  const totalMatches = matchGroups.reduce((s, g) => s + g.events.length, 0);
  const totalFutures = futureGroups.reduce((s, g) => s + g.events.length, 0);
  const showDebug = typeof window !== "undefined" && localStorage.getItem("debug");

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <header className="hdr">
          <div className="hdr-l">
            <span style={{ fontSize: 22 }}>📊</span>
            <span className="logo">PolyScores</span>
            <span className="sub">Live Odds</span>
          </div>
          <div className="hdr-r">
            <div className="tog">
              <button className={`tog-b${fmt === "decimal" ? " tog-a" : ""}`} onClick={() => setFmt("decimal")}>DEC</button>
              <button className={`tog-b${fmt === "american" ? " tog-a" : ""}`} onClick={() => setFmt("american")}>US</button>
            </div>
            <button className="ref" onClick={() => loadSport(tab)}>↻</button>
          </div>
        </header>

        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab${tab === t.id ? " tab-a" : ""}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>

        <DateBar dates={dates} selected={selDate} onSelect={setSelDate} />

        <main className="ct">
          {loading && (
            <div className="st"><div className="sp" /><span>Loading…</span></div>
          )}

          {error && (
            <div className="st err">⚠️<p>{error}</p></div>
          )}

          {!loading && !error && totalMatches === 0 && totalFutures === 0 && (
            <div className="st">
              <span style={{ fontSize: 32 }}>{TABS.find((t) => t.id === tab)?.icon}</span>
              <p>No markets for {fmtDay(selDate).toLowerCase()}.</p>
              <p style={{ fontSize: 12, color: "#64748b" }}>Total loaded: {(events[tab] || []).length} events</p>
            </div>
          )}

          {/* Matches: grouped by tournament, chronological within */}
          {matchGroups.map((g) => (
            <TournamentSection key={"m-" + g.name} group={g} fmt={fmt} />
          ))}

          {/* Futures: separated by a divider, then grouped by tournament */}
          {futureGroups.length > 0 && (
            <div className="div">FUTURES & OUTRIGHTS</div>
          )}
          {futureGroups.map((g) => (
            <TournamentSection key={"f-" + g.name} group={g} fmt={fmt} />
          ))}

          {showDebug && debug[tab] && (
            <div className="dbg">
              <div><b>DEBUG</b></div>
              <div>Tab: {tab}</div>
              <div>Tried slugs: {debug[tab].triedSlugs.join(", ")}</div>
              <div>Success slug: {debug[tab].successSlug || "none"}</div>
              <div>Raw events: {debug[tab].eventCount}</div>
              <div>Parsed: {(events[tab] || []).length}</div>
              <div>With startTime: {(events[tab] || []).filter(g => g.startTime).length}</div>
              <div>Matches today: {totalMatches}</div>
              <div>Futures: {totalFutures}</div>
              <details><summary>Tournaments found</summary>
                {[...new Set((events[tab] || []).map(g => g.tournament))].map((t, i) =>
                  <div key={i} style={{ fontSize: 10 }}>· {t}</div>)}
              </details>
            </div>
          )}
        </main>
      </div>
    </>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
*{margin:0;padding:0;box-sizing:border-box}body{background:#0f1116}
::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-thumb{background:#1e293b;border-radius:4px}
.app{font-family:'DM Sans',sans-serif;background:#0f1116;color:#e2e8f0;min-height:100vh;max-width:680px;margin:0 auto}
.hdr{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.06)}
.hdr-l{display:flex;align-items:center;gap:8px}
.hdr-r{display:flex;align-items:center;gap:8px}
.logo{font-size:18px;font-weight:800;letter-spacing:-.5px;background:linear-gradient(135deg,#22c55e,#3b82f6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.sub{font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:1px}
.tog{display:flex;background:rgba(255,255,255,.06);border-radius:6px;overflow:hidden}
.tog-b{background:none;border:none;color:#64748b;font:600 11px/1 'DM Sans',sans-serif;padding:5px 10px;cursor:pointer;letter-spacing:.5px}
.tog-a{background:rgba(34,197,94,.2);color:#22c55e}
.ref{background:rgba(255,255,255,.06);border:none;color:#94a3b8;font-size:16px;padding:4px 8px;border-radius:6px;cursor:pointer}
.ref:hover{color:#fff}
.tabs{display:flex;border-bottom:1px solid rgba(255,255,255,.06)}
.tab{flex:1;background:none;border:none;border-bottom:2px solid transparent;color:#64748b;font:600 13px/1 'DM Sans',sans-serif;padding:12px 8px;cursor:pointer;transition:all .2s}
.tab:hover{color:#94a3b8}
.tab-a{color:#22c55e;border-bottom-color:#22c55e;background:rgba(34,197,94,.04)}
.dp{display:flex;gap:4px;padding:10px 12px;overflow-x:auto;border-bottom:1px solid rgba(255,255,255,.06);-webkit-overflow-scrolling:touch}
.dp-b{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.02);cursor:pointer;min-width:72px;font-family:inherit;transition:all .15s}
.dp-b:hover{background:rgba(255,255,255,.06)}
.dp-a{background:rgba(34,197,94,.15)!important;border-color:rgba(34,197,94,.3)!important}
.dp-a .dp-d{color:#22c55e}
.dp-a .dp-l{color:#22c55e}
.dp-d{font-size:16px;font-weight:700;color:#e2e8f0}
.dp-l{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap}

/* Tournament section header — Flashscore style */
.sec{margin-bottom:2px}
.sec-h{display:flex;align-items:center;gap:8px;padding:10px 16px 6px;background:linear-gradient(180deg,rgba(34,197,94,.06),rgba(255,255,255,.015));border-bottom:1px solid rgba(34,197,94,.15);border-top:1px solid rgba(255,255,255,.04)}
.sec-t{font-size:12px;font-weight:700;color:#e2e8f0;letter-spacing:.3px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sec-c{font-size:10px;font-weight:600;color:#22c55e;background:rgba(34,197,94,.15);padding:1px 6px;border-radius:10px}

/* Big divider between Matches and Futures */
.div{padding:14px 16px 8px;font-size:10px;font-weight:700;color:#475569;letter-spacing:1.5px;background:#0a0c12;border-top:1px solid rgba(255,255,255,.06)}

.mr{display:flex;align-items:center;padding:10px 16px;gap:10px;border-bottom:1px solid rgba(255,255,255,.04);text-decoration:none;color:inherit;transition:background .15s}
.mr:hover{background:rgba(255,255,255,.05)}
.mr-time{font-size:11px;font-weight:600;color:#64748b;min-width:42px;text-align:center}
.mr-teams{flex:1;display:flex;flex-direction:column;gap:3px;min-width:0}
.mr-tn{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mr-odds{display:flex;gap:5px}
.mr-vol{font-size:10px;font-weight:600;color:#475569;min-width:40px;text-align:right}
.ob{display:flex;flex-direction:column;align-items:center;background:rgba(255,255,255,.05);border-radius:6px;padding:5px 8px;min-width:50px;gap:1px}
.ob-f{background:rgba(34,197,94,.1);outline:1px solid rgba(34,197,94,.2)}
.ob-l{font-size:9px;font-weight:700;color:#64748b;letter-spacing:.5px}
.ob-v{font-size:13px;font-weight:700;color:#fff}
.ob-p{font-size:9px;color:#64748b}
.out{border-bottom:1px solid rgba(255,255,255,.04);padding-bottom:4px}
.out-h{display:flex;justify-content:space-between;align-items:center;padding:10px 16px 6px;text-decoration:none;color:inherit}
.out-t{font-size:13px;font-weight:600}
.vt{font-size:10px;font-weight:600;color:#64748b;background:rgba(255,255,255,.04);padding:2px 6px;border-radius:4px}
.out-g{padding:0 16px}
.out-r{display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border-radius:4px;margin-bottom:2px}
.out-n{font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center}
.out-ri{display:flex;align-items:center;gap:8px;flex-shrink:0}
.bar{width:56px;height:4px;background:rgba(255,255,255,.06);border-radius:2px;overflow:hidden}
.bar-f{height:100%;border-radius:2px}
.out-o{font-size:12px;font-weight:700;color:#fff;width:38px;text-align:right}
.out-p{font-size:11px;color:#64748b;width:38px;text-align:right}
.sm{background:none;border:none;color:#3b82f6;font:600 11px/1 'DM Sans',sans-serif;padding:6px 16px 10px;cursor:pointer;width:100%;text-align:left}
.sm:hover{color:#60a5fa}
.st{display:flex;flex-direction:column;align-items:center;gap:10px;padding:50px 24px;color:#64748b;font-size:13px;text-align:center}
.err{color:#f59e0b}
.st p{margin:0;line-height:1.5}
@keyframes spin{to{transform:rotate(360deg)}}
.sp{width:22px;height:22px;border:2px solid rgba(255,255,255,.1);border-top-color:#22c55e;border-radius:50%;animation:spin .8s linear infinite}
.dbg{padding:16px;font-size:11px;color:#64748b;background:rgba(255,255,255,.02);margin-top:20px;line-height:1.6;font-family:monospace}
.dbg b{color:#22c55e}
@media(max-width:480px){
  .ob{min-width:42px;padding:4px 6px}.ob-v{font-size:12px}
  .mr{padding:8px 12px;gap:6px}.sub{display:none}
  .dp-b{min-width:60px;padding:5px 8px}
}
`;
