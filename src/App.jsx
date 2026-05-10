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
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

/* ─── SPORT TABS ─── */
const TABS = [
  { id: "basketball", label: "🏀 NBA", icon: "🏀", sportKey: "basketball" },
  { id: "soccer",     label: "⚽ Football", icon: "⚽", sportKey: "soccer" },
  { id: "tennis",     label: "🎾 Tennis", icon: "🎾", sportKey: "tennis" },
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

/* Build array of dates: yesterday + today + 6 future days */
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

/* ─── PARSE EVENTS ─── */
function parseEvents(rawEvents) {
  const games = [];

  for (const ev of rawEvents) {
    const markets = ev.markets || [];
    if (!markets.length) continue;

    const title = ev.title || "";
    const slug = ev.slug || "";
    const vs = title.match(/^(.+?)\s+(?:vs\.?|v\.?)\s+(.+?)$/i);

    // Find the game start time from the first market that has one
    let startTime = null;
    for (const m of markets) {
      const t = m.gameStartTime || m.eventStartTime || null;
      if (t) { startTime = new Date(t); break; }
    }
    if (!startTime && ev.startTime) startTime = new Date(ev.startTime);

    // Group markets by sportsMarketType
    const moneyline = markets.find((m) => m.sportsMarketType === "moneyline" || (!m.sportsMarketType && vs));
    const spread = markets.filter((m) => m.sportsMarketType === "spread");
    const total = markets.filter((m) => m.sportsMarketType === "total");

    // Parse outcomes from moneyline or first market
    let outcomes = [];
    const src = moneyline || markets[0];
    if (src) {
      const prices = src.outcomePrices ? JSON.parse(src.outcomePrices) : [];
      const labels = src.outcomes ? JSON.parse(src.outcomes) : [];
      outcomes = labels.map((l, i) => ({ label: l, prob: parseFloat(prices[i] || 0) }));
    }

    // If multi-market event (e.g. tournament winner), parse differently
    if (!vs && markets.length > 1) {
      outcomes = markets.filter((m) => m.outcomePrices).map((m) => {
        const p = JSON.parse(m.outcomePrices);
        const l = m.outcomes ? JSON.parse(m.outcomes) : [];
        return { label: l[0] || m.groupItemTitle || "?", prob: parseFloat(p[0] || 0) };
      }).sort((a, b) => b.prob - a.prob);
    }

    if (!outcomes.length) continue;

    games.push({
      id: ev.id,
      title,
      slug,
      isMatch: !!vs,
      team1: vs ? vs[1].trim() : null,
      team2: vs ? vs[2].trim() : null,
      outcomes,
      volume: ev.volume || 0,
      startTime,
      url: link(slug),
      hasSpread: spread.length > 0,
      hasTotal: total.length > 0,
      seriesSlug: ev.seriesSlug || "",
    });
  }

  return games;
}

/* ─── COMPONENTS ─── */

/* Date picker */
function DateBar({ dates, selected, onSelect }) {
  const ref = useRef(null);
  useEffect(() => {
    // scroll to today on mount
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

/* Odds badge */
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

/* Match row */
function GameRow({ g, fmt }) {
  const [exp, setExp] = useState(false);

  // Format game time in local timezone
  const timeStr = g.startTime
    ? g.startTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  if (g.isMatch && g.outcomes.length >= 2) {
    const t1 = g.outcomes[0]?.prob || 0;
    const t2 = g.outcomes[1]?.prob || 0;
    const draw = g.outcomes[2]?.prob || null;

    return (
      <a href={g.url} target="_blank" rel="noopener noreferrer" className="mr">
        <div className="mr-time">{timeStr}</div>
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

  // Outright / future
  const shown = exp ? g.outcomes : g.outcomes.slice(0, 5);
  return (
    <div className="out">
      <a href={g.url} target="_blank" rel="noopener noreferrer" className="out-h">
        <span className="out-t">{g.title}</span>
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

/* ─── MAIN APP ─── */
export default function App() {
  const [tab, setTab] = useState("basketball");
  const [fmt, setFmt] = useState("decimal");
  const [tagMap, setTagMap] = useState(null); // sport -> [tagId, ...]
  const [events, setEvents] = useState({}); // tab -> parsed games
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selDate, setSelDate] = useState(() => { const d = new Date(); d.setHours(0,0,0,0); return d; });
  const dates = useMemo(buildDates, []);

  // Step 1: discover tag IDs via /sports
  useEffect(() => {
    (async () => {
      try {
        const sports = await api("/sports");
        const map = {};
        for (const s of sports) {
          const key = (s.sport || "").toLowerCase();
          const ids = (s.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
          if (key && ids.length) map[key] = ids;
        }
        setTagMap(map);
      } catch (e) {
        console.error("Failed to load /sports:", e);
        // Fallback hardcoded tag IDs (may need updating)
        setTagMap({
          basketball: ["102"],
          soccer: ["101"],
          tennis: ["103"],
        });
      }
    })();
  }, []);

  // Step 2: fetch events for selected sport
  const loadSport = useCallback(async (sportId) => {
    if (!tagMap) return;
    setLoading(true);
    setError(null);

    const cfg = TABS.find((t) => t.id === sportId);
    if (!cfg) return;

    const ids = tagMap[cfg.sportKey] || [];
    if (!ids.length) {
      setError("No tag IDs found for this sport. Check /sports metadata.");
      setLoading(false);
      return;
    }

    try {
      const all = [];
      const seen = new Set();

      for (const tagId of ids) {
        try {
          const data = await api("/events", {
            tag_id: tagId,
            active: "true",
            closed: "false",
            limit: "100",
            order: "volume_24hr",
            ascending: "false",
          });
          for (const ev of data) {
            if (!seen.has(ev.id)) { seen.add(ev.id); all.push(ev); }
          }
        } catch (_) {}
      }

      const parsed = parseEvents(all);
      parsed.sort((a, b) => {
        // Sort by startTime first (nulls at end), then by volume
        if (a.startTime && b.startTime) return a.startTime - b.startTime;
        if (a.startTime) return -1;
        if (b.startTime) return 1;
        return parseFloat(b.volume) - parseFloat(a.volume);
      });

      setEvents((prev) => ({ ...prev, [sportId]: parsed }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [tagMap]);

  useEffect(() => {
    if (tagMap) loadSport(tab);
  }, [tab, tagMap, loadSport]);

  // Filter events by selected date
  const filtered = useMemo(() => {
    const all = events[tab] || [];
    const withDate = all.filter((g) => g.startTime && sameDay(g.startTime, selDate));
    const futures = all.filter((g) => !g.startTime && !g.isMatch); // outrights have no date
    return { matches: withDate, futures };
  }, [events, tab, selDate]);

  const totalForDate = filtered.matches.length;

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        {/* Header */}
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

        {/* Sport tabs */}
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab${tab === t.id ? " tab-a" : ""}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>

        {/* Date picker */}
        <DateBar dates={dates} selected={selDate} onSelect={setSelDate} />

        {/* Content */}
        <main className="ct">
          {loading && (
            <div className="st"><div className="sp" /><span>Loading…</span></div>
          )}

          {error && (
            <div className="st err">⚠️ <p>{error}</p></div>
          )}

          {!loading && !error && totalForDate === 0 && filtered.futures.length === 0 && (
            <div className="st">
              <span style={{ fontSize: 32 }}>{TABS.find((t) => t.id === tab)?.icon}</span>
              <p>No markets for {fmtDay(selDate).toLowerCase()}.</p>
              <p style={{ fontSize: 12, color: "#64748b" }}>Try another date or check Futures below.</p>
            </div>
          )}

          {/* Matches for selected date */}
          {totalForDate > 0 && (
            <section className="sec">
              <div className="sec-h">
                <span className="sec-t">GAMES · {fmtDay(selDate).toUpperCase()}</span>
                <span className="sec-c">{totalForDate}</span>
              </div>
              {filtered.matches.map((g) => (
                <GameRow key={g.id} g={g} fmt={fmt} />
              ))}
            </section>
          )}

          {/* Futures / outrights (always visible) */}
          {filtered.futures.length > 0 && (
            <section className="sec">
              <div className="sec-h">
                <span className="sec-t">FUTURES & OUTRIGHTS</span>
                <span className="sec-c">{filtered.futures.length}</span>
              </div>
              {filtered.futures.map((g) => (
                <GameRow key={g.id} g={g} fmt={fmt} />
              ))}
            </section>
          )}

          {/* Debug info (hidden in prod, toggle with localStorage) */}
          {typeof window !== "undefined" && localStorage.getItem("debug") && tagMap && (
            <div style={{ padding: 16, fontSize: 10, color: "#475569", wordBreak: "break-all" }}>
              <p>Sport: {tab} → tag_ids: {JSON.stringify(tagMap[TABS.find(t=>t.id===tab)?.sportKey])}</p>
              <p>Total events loaded: {(events[tab] || []).length}</p>
              <p>With startTime: {(events[tab] || []).filter(g=>g.startTime).length}</p>
              <p>Matches for date: {totalForDate}</p>
            </div>
          )}
        </main>
      </div>
    </>
  );
}

/* ─── CSS ─── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
*{margin:0;padding:0;box-sizing:border-box}body{background:#0f1116}
::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-thumb{background:#1e293b;border-radius:4px}

.app{font-family:'DM Sans',sans-serif;background:#0f1116;color:#e2e8f0;min-height:100vh;max-width:680px;margin:0 auto}

/* Header */
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

/* Tabs */
.tabs{display:flex;border-bottom:1px solid rgba(255,255,255,.06)}
.tab{flex:1;background:none;border:none;border-bottom:2px solid transparent;color:#64748b;font:600 13px/1 'DM Sans',sans-serif;padding:12px 8px;cursor:pointer;transition:all .2s}
.tab:hover{color:#94a3b8}
.tab-a{color:#22c55e;border-bottom-color:#22c55e;background:rgba(34,197,94,.04)}

/* Date picker */
.dp{display:flex;gap:4px;padding:10px 12px;overflow-x:auto;border-bottom:1px solid rgba(255,255,255,.06);-webkit-overflow-scrolling:touch}
.dp-b{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.02);cursor:pointer;min-width:72px;font-family:inherit;transition:all .15s}
.dp-b:hover{background:rgba(255,255,255,.06)}
.dp-a{background:rgba(34,197,94,.15)!important;border-color:rgba(34,197,94,.3)!important}
.dp-a .dp-d{color:#22c55e}
.dp-a .dp-l{color:#22c55e}
.dp-d{font-size:16px;font-weight:700;color:#e2e8f0}
.dp-l{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap}

/* Sections */
.sec{margin-bottom:4px}
.sec-h{display:flex;align-items:center;gap:8px;padding:10px 16px 6px;background:rgba(255,255,255,.015)}
.sec-t{font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px}
.sec-c{font-size:10px;font-weight:600;color:#22c55e;background:rgba(34,197,94,.15);padding:1px 6px;border-radius:10px}

/* Match row */
.mr{display:flex;align-items:center;padding:10px 16px;gap:10px;border-bottom:1px solid rgba(255,255,255,.04);text-decoration:none;color:inherit;transition:background .15s}
.mr:hover{background:rgba(255,255,255,.05)}
.mr-time{font-size:11px;font-weight:600;color:#64748b;min-width:42px;text-align:center}
.mr-teams{flex:1;display:flex;flex-direction:column;gap:3px;min-width:0}
.mr-tn{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mr-odds{display:flex;gap:5px}
.mr-vol{font-size:10px;font-weight:600;color:#475569;min-width:40px;text-align:right}

/* Odds badge */
.ob{display:flex;flex-direction:column;align-items:center;background:rgba(255,255,255,.05);border-radius:6px;padding:5px 8px;min-width:50px;gap:1px}
.ob-f{background:rgba(34,197,94,.1);outline:1px solid rgba(34,197,94,.2)}
.ob-l{font-size:9px;font-weight:700;color:#64748b;letter-spacing:.5px}
.ob-v{font-size:13px;font-weight:700;color:#fff}
.ob-p{font-size:9px;color:#64748b}

/* Outright */
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

/* States */
.st{display:flex;flex-direction:column;align-items:center;gap:10px;padding:50px 24px;color:#64748b;font-size:13px;text-align:center}
.err{color:#f59e0b}
.st p{margin:0;line-height:1.5}
@keyframes spin{to{transform:rotate(360deg)}}
.sp{width:22px;height:22px;border:2px solid rgba(255,255,255,.1);border-top-color:#22c55e;border-radius:50%;animation:spin .8s linear infinite}

@media(max-width:480px){
  .ob{min-width:42px;padding:4px 6px}.ob-v{font-size:12px}
  .mr{padding:8px 12px;gap:6px}.sub{display:none}
  .dp-b{min-width:60px;padding:5px 8px}
}
`;
