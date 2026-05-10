import { useState, useEffect, useCallback, useMemo } from "react";

/* ── CONFIG ── */
const REFERRAL_TAG = ""; // e.g. "?ref=YOUR_CODE"
const polyLink = (slug) => `https://polymarket.com/event/${slug}${REFERRAL_TAG}`;

const useProxy =
  typeof window !== "undefined" && window.location.hostname !== "localhost";

const gammaFetch = async (path, params = {}) => {
  const qs = new URLSearchParams(params).toString();
  const url = useProxy
    ? `/api/proxy?path=${encodeURIComponent(path)}${qs ? `&${qs}` : ""}`
    : `https://gamma-api.polymarket.com${path}${qs ? `?${qs}` : ""}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
};

const SPORTS = [
  {
    id: "soccer", label: "⚽ World Cup", icon: "⚽",
    tagSlugs: ["fifa-world-cup", "world-cup-2026", "soccer", "football"],
    filterTerms: ["world cup","fifa","soccer","football","fc ","fc\n"," fc","united","city","real ","barcelona","premier league","la liga","serie a","bundesliga","ligue 1","champions league"],
    grouper: (ev) => {
      const t = ev.title;
      if (/world cup/i.test(t)) return "🏆 FIFA World Cup 2026";
      if (/champions league/i.test(t)) return "⭐ Champions League";
      if (/premier league|epl/i.test(t)) return "🏴 Premier League";
      if (/la liga/i.test(t)) return "🇪🇸 La Liga";
      if (/serie a/i.test(t)) return "🇮🇹 Serie A";
      if (/bundesliga/i.test(t)) return "🇩🇪 Bundesliga";
      if (/ligue 1/i.test(t)) return "🇫🇷 Ligue 1";
      return "⚽ Football";
    },
  },
  {
    id: "tennis", label: "🎾 Tennis", icon: "🎾",
    tagSlugs: ["tennis","roland-garros","french-open","wimbledon","us-open","australian-open","atp","wta"],
    filterTerms: ["tennis","roland garros","french open","wimbledon","us open","australian open","atp","wta","grand slam"],
    grouper: (ev) => {
      const t = (ev.title + " " + ev.seriesSlug).toLowerCase();
      if (/roland.garros|french.open/.test(t)) return "🇫🇷 Roland Garros";
      if (/wimbledon/.test(t)) return "🇬🇧 Wimbledon";
      if (/us.open/.test(t)) return "🇺🇸 US Open";
      if (/australian.open/.test(t)) return "🇦🇺 Australian Open";
      if (/atp/.test(t)) return "🎾 ATP Tour";
      if (/wta/.test(t)) return "🎾 WTA Tour";
      return "🎾 Tennis";
    },
  },
  {
    id: "basketball", label: "🏀 NBA", icon: "🏀",
    tagSlugs: ["nba","basketball","nba-finals","nba-playoffs"],
    filterTerms: ["nba","basketball","lakers","celtics","knicks","warriors","76ers","bucks","nuggets","heat","thunder","timberwolves","cavaliers","pacers","nets","hawks","bulls","rockets","spurs","suns","clippers","mavericks","grizzlies","pelicans","kings","magic","raptors","blazers","jazz","hornets","wizards"],
    grouper: (ev) => {
      const t = ev.title;
      if (/final/i.test(t)) return "🏆 NBA Finals";
      if (/playoff/i.test(t)) return "🔥 NBA Playoffs";
      if (/mvp|award/i.test(t)) return "⭐ NBA Awards";
      if (/champion/i.test(t)) return "🏆 NBA Championship";
      if (/vs\.?|v\.\s/i.test(t)) return "📅 NBA Games";
      return "🏀 NBA";
    },
  },
];

/* ── HELPERS ── */
const prob2dec = (p) => (!p || p <= 0 ? "-" : (1 / p).toFixed(2));
const prob2us = (p) => {
  if (!p || p <= 0) return "-";
  return p >= 0.5 ? `-${Math.round((p / (1 - p)) * 100)}` : `+${Math.round(((1 - p) / p) * 100)}`;
};
const fmtVol = (v) => { const n = parseFloat(v || 0); if (n >= 1e6) return `$${(n/1e6).toFixed(1)}M`; if (n >= 1e3) return `$${(n/1e3).toFixed(0)}K`; return `$${n.toFixed(0)}`; };

/* ── PARSE ── */
const parseEvent = (raw) => {
  const markets = raw.markets || [];
  const title = raw.title || "";
  const slug = raw.slug || "";
  const vsMatch = title.match(/^(.+?)\s+(?:vs\.?|v\.?)\s+(.+?)$/i);
  let outcomes = [];

  if (markets.length > 1) {
    outcomes = markets.filter((m) => m.outcomePrices).map((m) => {
      const p = JSON.parse(m.outcomePrices);
      const l = m.outcomes ? JSON.parse(m.outcomes) : [];
      return { label: l[0] || m.groupItemTitle || m.question || "?", prob: parseFloat(p[0] || 0) };
    }).sort((a, b) => b.prob - a.prob);
  } else if (markets.length === 1) {
    const m = markets[0];
    const p = m.outcomePrices ? JSON.parse(m.outcomePrices) : [];
    const l = m.outcomes ? JSON.parse(m.outcomes) : [];
    outcomes = l.map((lb, i) => ({ label: lb, prob: parseFloat(p[i] || 0) }));
  }

  const allTags = [
    ...(raw.tags || []).map((t) => (t.label || t.slug || "").toLowerCase()),
    ...markets.flatMap((m) => (m.tags || []).map((t) => (t.label || t.slug || "").toLowerCase())),
  ];

  return {
    id: raw.id, title, slug, isMatch: !!vsMatch,
    team1: vsMatch ? vsMatch[1].trim() : null,
    team2: vsMatch ? vsMatch[2].trim() : null,
    outcomes, volume: raw.volume || 0, volume24hr: raw.volume24hr || 0,
    polymarketUrl: polyLink(slug), allTags,
    seriesSlug: raw.seriesSlug || "",
  };
};

/* ── COMPONENTS ── */
const Badge = ({ label, prob, getOdds, fav }) => (
  <div className={`ob${fav ? " ob-f" : ""}`}>
    <span className="ob-l">{label}</span>
    <span className="ob-v">{getOdds(prob)}</span>
    <span className="ob-p">{(prob * 100).toFixed(0)}%</span>
  </div>
);

const MatchRow = ({ event, fmt }) => {
  const [exp, setExp] = useState(false);
  const odds = (p) => (fmt === "decimal" ? prob2dec(p) : prob2us(p));

  if (event.isMatch && event.outcomes.length >= 2) {
    const t1 = event.outcomes[0]?.prob || 0;
    const t2 = event.outcomes[1]?.prob || 0;
    const draw = event.outcomes[2]?.prob || null;
    return (
      <a href={event.polymarketUrl} target="_blank" rel="noopener noreferrer" className="mr">
        <div className="mt">
          <div className="tr"><span className="tn" style={{ fontWeight: t1 > t2 ? 700 : 400, color: t1 > t2 ? "#fff" : "#94a3b8" }}>{event.team1}</span></div>
          <div className="tr"><span className="tn" style={{ fontWeight: t2 > t1 ? 700 : 400, color: t2 > t1 ? "#fff" : "#94a3b8" }}>{event.team2}</span></div>
        </div>
        <div className="oc">
          <Badge label="1" prob={t1} getOdds={odds} fav={t1 > t2} />
          {draw !== null && <Badge label="X" prob={draw} getOdds={odds} />}
          <Badge label="2" prob={t2} getOdds={odds} fav={t2 > t1} />
        </div>
        <div className="mm"><span className="vt">{fmtVol(event.volume)}</span></div>
      </a>
    );
  }

  const shown = exp ? event.outcomes : event.outcomes.slice(0, 5);
  return (
    <div className="tb">
      <a href={event.polymarketUrl} target="_blank" rel="noopener noreferrer" className="th">
        <span className="tt">{event.title}</span>
        <span className="vt">{fmtVol(event.volume)}</span>
      </a>
      <div className="og">
        {shown.map((o, i) => (
          <div key={i} className="or" style={i === 0 ? { borderLeft: "2px solid #22c55e" } : {}}>
            <span className="on" style={{ color: i === 0 ? "#fff" : "#94a3b8", fontWeight: i === 0 ? 600 : 400 }}>
              {i === 0 && <span style={{ color: "#22c55e", fontSize: 10, marginRight: 4 }}>★</span>}{o.label}
            </span>
            <div className="oright">
              <div className="pb"><div className="pbf" style={{ width: `${Math.min(o.prob * 100, 100)}%`, background: i === 0 ? "#22c55e" : "rgba(99,102,241,0.5)" }} /></div>
              <span className="oo">{odds(o.prob)}</span>
              <span className="op">{(o.prob * 100).toFixed(1)}%</span>
            </div>
          </div>
        ))}
      </div>
      {event.outcomes.length > 5 && (
        <button className="sm" onClick={() => setExp(!exp)}>
          {exp ? "Show less ▲" : `All ${event.outcomes.length} outcomes ▼`}
        </button>
      )}
    </div>
  );
};

/* ── APP ── */
export default function App() {
  const [sport, setSport] = useState("soccer");
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fmt, setFmt] = useState("decimal");
  const [ts, setTs] = useState(null);

  const load = useCallback(async (id) => {
    setLoading(true); setError(null);
    const cfg = SPORTS.find((s) => s.id === id);
    if (!cfg) return;
    try {
      const raw = []; const seen = new Set();
      const add = (arr) => { for (const e of arr) if (!seen.has(e.id)) { seen.add(e.id); raw.push(e); } };

      for (const sl of cfg.tagSlugs) {
        try { add(await gammaFetch("/events", { tag_slug: sl, related_tags: "true", active: "true", closed: "false", limit: "100", order: "volume_24hr", ascending: "false" })); } catch (_) {}
      }

      const parsed = raw.map(parseEvent).filter((e) => e.outcomes.length > 0);
      const filtered = parsed.filter((e) => {
        const t = e.title.toLowerCase();
        return cfg.filterTerms.some((f) => t.includes(f)) ||
          e.allTags.some((tag) => cfg.tagSlugs.some((s) => tag.includes(s.replace(/-/g, " ")) || tag.includes(s)));
      });
      filtered.sort((a, b) => parseFloat(b.volume) - parseFloat(a.volume));
      setData((p) => ({ ...p, [id]: filtered }));
      setTs(new Date());
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(sport); }, [sport, load]);

  const groups = useMemo(() => {
    const evts = data[sport] || [];
    const cfg = SPORTS.find((s) => s.id === sport);
    if (!cfg || !evts.length) return [];
    const m = {};
    for (const e of evts) { const g = cfg.grouper(e); (m[g] ||= []).push(e); }
    return Object.entries(m).map(([n, es]) => ({ n, es }))
      .sort((a, b) => b.es.reduce((s, e) => s + parseFloat(e.volume), 0) - a.es.reduce((s, e) => s + parseFloat(e.volume), 0));
  }, [data, sport]);

  const total = (data[sport] || []).length;

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <header className="hdr">
          <div className="hl">
            <div className="logo"><span style={{ fontSize: 22 }}>📊</span><span className="lt">PolyScores</span></div>
            <span className="tg">Polymarket Odds · Live</span>
          </div>
          <div className="hr">
            <div className="ot">
              <button className={`tb2${fmt === "decimal" ? " a" : ""}`} onClick={() => setFmt("decimal")}>DEC</button>
              <button className={`tb2${fmt === "american" ? " a" : ""}`} onClick={() => setFmt("american")}>US</button>
            </div>
            <button className="rb" onClick={() => load(sport)}>↻</button>
          </div>
        </header>

        <nav className="tabs">
          {SPORTS.map((s) => (
            <button key={s.id} className={`tab${sport === s.id ? " ta" : ""}`} onClick={() => setSport(s.id)}>{s.label}</button>
          ))}
        </nav>

        <main className="ct">
          {loading && <div className="st"><div className="sp" /><span>Loading {SPORTS.find((s) => s.id === sport)?.label}…</span></div>}
          {error && <div className="st wn">⚠️<p>API error ({error}). Make sure <code>/api/proxy</code> is deployed.</p></div>}
          {!loading && !error && total === 0 && (
            <div className="st">
              <span style={{ fontSize: 32 }}>{SPORTS.find((s) => s.id === sport)?.icon}</span>
              <p style={{ color: "#94a3b8" }}>No active markets found.</p>
              <p style={{ color: "#64748b", fontSize: 12 }}>Markets appear as events approach.</p>
            </div>
          )}

          {groups.map((g) => (
            <div key={g.n} className="grp">
              <div className="gh">
                <span className="gn">{g.n}</span>
                <span className="gc">{g.es.length}</span>
              </div>
              {g.es.map((e) => <MatchRow key={e.id} event={e} fmt={fmt} />)}
            </div>
          ))}

          {ts && !loading && total > 0 && (
            <footer className="ft">
              <span>{total} markets</span><span className="dot">·</span>
              <span>Updated {ts.toLocaleTimeString()}</span><span className="dot">·</span>
              <a href="https://polymarket.com/sports" target="_blank" rel="noopener noreferrer">Trade on Polymarket →</a>
            </footer>
          )}
        </main>
      </div>
    </>
  );
}

/* ── CSS ── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f1116}
::-webkit-scrollbar{width:4px}
::-webkit-scrollbar-thumb{background:#1e293b;border-radius:4px}

.app{font-family:'DM Sans',sans-serif;background:#0f1116;color:#e2e8f0;min-height:100vh;max-width:680px;margin:0 auto}

.hdr{display:flex;justify-content:space-between;align-items:center;padding:16px 16px 12px;border-bottom:1px solid rgba(255,255,255,.06)}
.hl{display:flex;align-items:center;gap:12px}
.hr{display:flex;align-items:center;gap:8px}
.logo{display:flex;align-items:center;gap:6px}
.lt{font-size:18px;font-weight:800;letter-spacing:-.5px;background:linear-gradient(135deg,#22c55e,#3b82f6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.tg{font-size:11px;color:#64748b;letter-spacing:.5px;text-transform:uppercase}

.ot{display:flex;background:rgba(255,255,255,.06);border-radius:6px;overflow:hidden}
.tb2{background:none;border:none;color:#64748b;font-size:11px;font-weight:600;padding:5px 10px;cursor:pointer;letter-spacing:.5px;font-family:inherit}
.tb2.a{background:rgba(34,197,94,.2);color:#22c55e}
.rb{background:rgba(255,255,255,.06);border:none;color:#94a3b8;font-size:16px;padding:4px 8px;border-radius:6px;cursor:pointer}
.rb:hover{color:#fff}

.tabs{display:flex;border-bottom:1px solid rgba(255,255,255,.06);overflow-x:auto}
.tab{flex:1;background:none;border:none;border-bottom:2px solid transparent;color:#64748b;font-size:13px;font-weight:600;padding:12px 16px;cursor:pointer;white-space:nowrap;transition:all .2s;font-family:inherit}
.tab:hover{color:#94a3b8}
.ta{color:#22c55e;border-bottom-color:#22c55e;background:rgba(34,197,94,.05)}

.grp{margin-bottom:4px}
.gh{display:flex;align-items:center;gap:8px;padding:10px 16px 6px;background:rgba(255,255,255,.02);border-bottom:1px solid rgba(255,255,255,.06)}
.gn{font-size:12px;font-weight:700;color:#cbd5e1;letter-spacing:.3px}
.gc{font-size:10px;font-weight:600;color:#22c55e;background:rgba(34,197,94,.15);padding:1px 6px;border-radius:10px}

.mr{display:flex;align-items:center;padding:10px 16px;gap:12px;border-bottom:1px solid rgba(255,255,255,.04);cursor:pointer;text-decoration:none;color:inherit;transition:background .15s}
.mr:hover{background:rgba(255,255,255,.06)}
.mt{flex:1;min-width:0}
.tr{display:flex;align-items:center;padding:2px 0}
.tn{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.oc{display:flex;gap:6px}
.ob{display:flex;flex-direction:column;align-items:center;background:rgba(255,255,255,.05);border-radius:6px;padding:6px 10px;min-width:52px;gap:2px}
.ob-f{background:rgba(34,197,94,.12);outline:1px solid rgba(34,197,94,.2)}
.ob-l{font-size:9px;font-weight:700;color:#64748b;letter-spacing:.5px}
.ob-v{font-size:14px;font-weight:700;color:#fff}
.ob-p{font-size:10px;color:#64748b}

.mm{display:flex;flex-direction:column;align-items:flex-end;gap:2px;min-width:50px}
.vt{font-size:10px;font-weight:600;color:#64748b;background:rgba(255,255,255,.04);padding:2px 6px;border-radius:4px}

.tb{border-bottom:1px solid rgba(255,255,255,.04);padding-bottom:4px}
.th{display:flex;justify-content:space-between;align-items:center;padding:10px 16px 6px;text-decoration:none;color:inherit}
.tt{font-size:13px;font-weight:600;color:#e2e8f0}

.og{padding:0 16px}
.or{display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border-radius:4px;margin-bottom:2px}
.on{font-size:12px;flex:1;display:flex;align-items:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oright{display:flex;align-items:center;gap:8px;flex-shrink:0}
.pb{width:60px;height:4px;background:rgba(255,255,255,.06);border-radius:2px;overflow:hidden}
.pbf{height:100%;border-radius:2px;transition:width .3s}
.oo{font-size:12px;font-weight:700;color:#fff;width:40px;text-align:right}
.op{font-size:11px;color:#64748b;width:40px;text-align:right}

.sm{background:none;border:none;color:#3b82f6;font-size:11px;font-weight:600;padding:6px 16px 10px;cursor:pointer;width:100%;text-align:left;font-family:inherit}
.sm:hover{color:#60a5fa}

.st{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:60px 24px;color:#64748b;font-size:13px;text-align:center}
.wn{color:#f59e0b}
.st p{margin:0;line-height:1.6}
.st code{background:rgba(255,255,255,.08);padding:1px 5px;border-radius:3px;font-size:11px}

@keyframes spin{to{transform:rotate(360deg)}}
.sp{width:24px;height:24px;border:2px solid rgba(255,255,255,.1);border-top-color:#22c55e;border-radius:50%;animation:spin .8s linear infinite}

.ft{display:flex;align-items:center;justify-content:center;gap:6px;padding:16px;font-size:10px;color:#475569;flex-wrap:wrap}
.ft .dot{color:#334155}
.ft a{color:#3b82f6;text-decoration:none}
.ft a:hover{color:#60a5fa}

@media(max-width:480px){
  .ob{min-width:44px;padding:5px 6px}
  .ob-v{font-size:12px}
  .mr{padding:8px 12px;gap:8px}
  .pb{width:40px}
  .tg{display:none}
}
`;
