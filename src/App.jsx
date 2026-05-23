import { useState, useEffect, useCallback, useMemo, useRef } from "react";

/* ─── CONFIG ─── */
const REF = "?r=Pingo";
const SUPPORT_URL = "https://polymarket.com/?r=Pingo";
const FAV_KEY = "polyscores_favorites";

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

const MAX_DURATION = {
  basketball: 3.5 * 3600_000,
  soccer: 3 * 3600_000,
  tennis: 6 * 3600_000,
};

const TABS = [
  { id: "basketball", label: "🏀 NBA", icon: "🏀",
    trySlugs: ["nba", "basketball", "nba-finals", "nba-playoffs"],
    defaultTournament: "NBA" },
  { id: "soccer", label: "⚽ Football", icon: "⚽",
    trySlugs: ["fifa-world-cup-2026", "fifa-world-cup", "soccer", "football", "world-cup"],
    defaultTournament: "Football" },
  { id: "tennis", label: "🎾 Tennis", icon: "🎾",
    trySlugs: ["tennis", "atp", "wta"],
    defaultTournament: "Tennis" },
];

/* ─── Known ATP / WTA tournament name patterns (case-insensitive) ─── */
const ATP_TOURNAMENTS = [
  // Grand Slams (men's draws)
  "australian open men", "us open men", "french open men", "wimbledon men",
  // Masters 1000
  "indian wells", "miami open", "monte.carlo", "madrid open", "italian open", "internazionali bnl",
  "canadian open", "rogers cup", "cincinnati", "shanghai", "paris masters", "atp finals",
  // ATP 500/250 (frequent)
  "geneva open", "gonet geneva", "hamburg open", "lyon open", "open parc",
  "barcelona open", "estoril", "munich", "rotterdam", "marseille", "dubai duty",
  "acapulco", "rio open", "buenos aires", "santiago", "houston", "queens",
  "halle", "stuttgart", "eastbourne men", "newport", "umag", "kitzbuhel",
  "winston-salem", "metz", "sofia", "antwerp", "stockholm", "moscow atp",
  "vienna", "basel", "tokyo atp", "next gen",
];

const WTA_TOURNAMENTS = [
  // Grand Slams (women's draws)
  "australian open women", "us open women", "french open women", "wimbledon women",
  // WTA 1000
  "dubai", "doha", "indian wells women", "miami open women", "madrid open women",
  "italian open women", "internazionali bnl d'italia women", "rome wta",
  // WTA 500/250 (frequent)
  "strasbourg", "internationaux de strasbourg",
  "rabat", "lalla meryem", "morocco open",
  "abu dhabi", "adelaide", "auckland", "hobart",
  "san diego", "merida", "linz", "cluj", "cleveland",
  "guadalajara", "monterrey", "bogota", "charleston",
  "stuttgart wta", "ningbo", "tokyo wta", "osaka wta", "guangzhou", "zhengzhou",
  "tashkent", "seoul wta", "chennai", "hua hin",
];

/* Generic markers that strongly suggest WTA or ATP */
const WTA_HINTS = [/\bwta\b/i, /\bwomen'?s?\b/i, /lalla meryem/i, /strasbourg/i, /\bladies\b/i];
const ATP_HINTS = [/\batp\b/i, /\bmen'?s?\b/i, /geneva open/i, /hamburg open/i, /\bgents\b/i];

/* Known ITF / Challenger markers — for exclusion when filtering */
const ITF_HINTS = [/\bitf\b/i, /\bchallenger\b/i, /\bm15\b/i, /\bm25\b/i, /\bw15\b/i, /\bw25\b/i, /\bw35\b/i, /\bm50\b/i, /\bw50\b/i];

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

function stripPrefix(label, prefix) {
  if (!label || !prefix) return label;
  const p = `${prefix}:`;
  if (label.toLowerCase().startsWith(p.toLowerCase())) {
    return label.slice(p.length).trim();
  }
  return label;
}

function extractTournament(fullTitle, sportDefault) {
  const m = fullTitle.match(/^([^:]+?):\s+(.+)$/);
  if (m) {
    const candidate = m[1].trim();
    if (candidate.length < 80 && !/\bvs?\.?\b/i.test(candidate)) {
      return { tournament: candidate, matchTitle: m[2].trim() };
    }
  }
  return { tournament: sportDefault, matchTitle: fullTitle };
}

/* ─── ATP / WTA detection — multi-signal ─── */
function detectTour(rawEvent, parsedTags, tournament) {
  const tagsLower = parsedTags.map((t) => (t || "").toLowerCase());
  const title = (rawEvent.title || "").toLowerCase();
  const series = (rawEvent.seriesSlug || "").toLowerCase();
  const tour = (tournament || "").toLowerCase();
  const haystack = `${tour} ${title} ${series}`;

  // 1. Explicit ATP/WTA tag
  if (tagsLower.some((t) => t === "atp" || t.startsWith("atp-") || t.endsWith("-atp"))) return "atp";
  if (tagsLower.some((t) => t === "wta" || t.startsWith("wta-") || t.endsWith("-wta"))) return "wta";

  // 2. Known tournament name match (most reliable for finals)
  for (const t of WTA_TOURNAMENTS) {
    if (haystack.includes(t)) return "wta";
  }
  for (const t of ATP_TOURNAMENTS) {
    if (haystack.includes(t)) return "atp";
  }

  // 3. Generic hints
  if (WTA_HINTS.some((re) => re.test(haystack))) return "wta";
  if (ATP_HINTS.some((re) => re.test(haystack))) return "atp";

  return "unknown";
}

function isITF(rawEvent, tournament) {
  const haystack = `${(tournament || "").toLowerCase()} ${(rawEvent.title || "").toLowerCase()}`;
  return ITF_HINTS.some((re) => re.test(haystack));
}

/* ─── PARSE EVENTS ─── */
function parseEvent(ev, sportDefault, sportId) {
  const markets = ev.markets || [];
  if (!markets.length) return null;
  const fullTitle = ev.title || "";
  const slug = ev.slug || "";
  const { tournament, matchTitle } = extractTournament(fullTitle, sportDefault);
  const vs = matchTitle.match(/^(.+?)\s+(?:vs\.?|v\.?)\s+(.+?)$/i);

  let startTime = null;
  for (const m of markets) {
    const t = m.gameStartTime || m.eventStartTime || null;
    if (t) { startTime = new Date(t); break; }
  }
  if (!startTime && ev.startTime) startTime = new Date(ev.startTime);
  if (!startTime && ev.startDate) startTime = new Date(ev.startDate);

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

  const tagSlugs = [
    ...(ev.tags || []).map((t) => t.slug || t.label || ""),
    ...markets.flatMap((m) => (m.tags || []).map((t) => t.slug || t.label || "")),
  ].filter(Boolean);

  const tour = sportId === "tennis" ? detectTour(ev, tagSlugs, tournament) : null;
  const itf = sportId === "tennis" ? isITF(ev, tournament) : false;

  return {
    id: ev.id, title: fullTitle, matchTitle, tournament, slug,
    isMatch: !!vs,
    team1: vs ? stripPrefix(vs[1].trim(), tournament) : null,
    team2: vs ? vs[2].trim() : null,
    outcomes,
    volume: ev.volume || 0,
    startTime, tour, itf, tagSlugs,
    sportId,
    url: link(slug),
  };
}

function computeStatus(ev, sportId, now) {
  if (!ev.startTime) return "future";
  const maxDur = MAX_DURATION[sportId] || 4 * 3600_000;
  const start = ev.startTime.getTime();
  const end = start + maxDur;
  const nowT = now.getTime();
  if (nowT < start) return "upcoming";
  if (nowT >= start && nowT <= end) return "live";
  return "finished";
}

function groupByTournament(events, chronological = true) {
  const map = new Map();
  for (const ev of events) {
    const key = ev.tournament || "Other";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(ev);
  }
  for (const [, evs] of map) {
    evs.sort((a, b) => {
      if (chronological && a.startTime && b.startTime) return a.startTime - b.startTime;
      if (a.startTime && !b.startTime) return -1;
      if (!a.startTime && b.startTime) return 1;
      return parseFloat(b.volume) - parseFloat(a.volume);
    });
  }
  return Array.from(map.entries())
    .map(([name, evs]) => ({
      name, events: evs,
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

function OB({ label, prob, fmt, fav, dim }) {
  const v = fmt === "decimal" ? d2o(prob) : d2us(prob);
  return (
    <div className={`ob${fav ? " ob-f" : ""}${dim ? " ob-dim" : ""}`}>
      <span className="ob-l">{label}</span>
      <span className="ob-v">{v}</span>
      <span className="ob-p">{(prob * 100).toFixed(0)}%</span>
    </div>
  );
}

function LiveDot() {
  return <span className="live-dot" title="Live">●</span>;
}

function FavBtn({ active, onClick }) {
  return (
    <button
      className={`fav-btn${active ? " fav-btn-a" : ""}`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      title={active ? "Remove from favorites" : "Add to favorites"}
    >
      {active ? "★" : "☆"}
    </button>
  );
}

function GameRow({ g, fmt, status, isFav, onToggleFav }) {
  const [exp, setExp] = useState(false);
  const timeStr = g.startTime
    ? g.startTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  const isFinished = status === "finished";
  const isLive = status === "live";

  if (g.isMatch && g.outcomes.length >= 2) {
    const t1 = g.outcomes[0]?.prob || 0;
    const t2 = g.outcomes[1]?.prob || 0;
    const draw = g.outcomes[2]?.prob || null;
    return (
      <a
        href={g.url} target="_blank" rel="noopener noreferrer"
        className={`mr${isLive ? " mr-live" : ""}${isFinished ? " mr-fin" : ""}`}
      >
        <div className="mr-time">
          {isLive ? <LiveDot /> : isFinished ? <span className="ft">FT</span> : (timeStr || "—")}
        </div>
        <div className="mr-teams">
          <span className="mr-tn" style={{ fontWeight: t1 >= t2 ? 700 : 400, color: t1 >= t2 ? (isFinished ? "#cbd5e1" : "#fff") : "#8896a8" }}>{g.team1}</span>
          <span className="mr-tn" style={{ fontWeight: t2 > t1 ? 700 : 400, color: t2 > t1 ? (isFinished ? "#cbd5e1" : "#fff") : "#8896a8" }}>{g.team2}</span>
        </div>
        <div className="mr-odds">
          <OB label="1" prob={t1} fmt={fmt} fav={t1 >= t2} dim={isFinished} />
          {draw !== null && <OB label="X" prob={draw} fmt={fmt} dim={isFinished} />}
          <OB label="2" prob={t2} fmt={fmt} fav={t2 > t1} dim={isFinished} />
        </div>
        <div className="mr-right">
          <FavBtn active={isFav} onClick={onToggleFav} />
          <span className="mr-vol">{fv(g.volume)}</span>
        </div>
      </a>
    );
  }

  const shown = exp ? g.outcomes : g.outcomes.slice(0, 5);
  return (
    <div className="out">
      <a href={g.url} target="_blank" rel="noopener noreferrer" className="out-h">
        <span className="out-t">{g.matchTitle}</span>
        <div className="out-h-r">
          <FavBtn active={isFav} onClick={onToggleFav} />
          <span className="vt">{fv(g.volume)}</span>
        </div>
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

function TournamentSection({ group, fmt, statusMap, favorites, onToggleFav }) {
  return (
    <section className="sec">
      <div className="sec-h">
        <span className="sec-t">{group.name}</span>
        <span className="sec-c">{group.events.length}</span>
      </div>
      {group.events.map((ev) => (
        <GameRow
          key={ev.id} g={ev} fmt={fmt}
          status={statusMap[ev.id]}
          isFav={favorites.has(ev.id)}
          onToggleFav={() => onToggleFav(ev.id)}
        />
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
  const [selDate, setSelDate] = useState(() => { const d = new Date(); d.setHours(0,0,0,0); return d; });
  const [statusFilter, setStatusFilter] = useState("all");
  const [tourFilter, setTourFilter] = useState("all");
  const [now, setNow] = useState(new Date());
  const [favoritesView, setFavoritesView] = useState(false);
  const [favorites, setFavorites] = useState(() => {
    if (typeof window === "undefined") return new Set();
    try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]")); }
    catch { return new Set(); }
  });

  const dates = useMemo(buildDates, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(FAV_KEY, JSON.stringify([...favorites]));
  }, [favorites]);

  const toggleFav = useCallback((id) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  /* ─── PAGINATED FETCH ─── */
  const fetchSlugPaginated = useCallback(async (slug, options) => {
    const pageSize = 200;
    const maxPages = 5; // up to 1000 events per slug
    const collected = [];
    for (let page = 0; page < maxPages; page++) {
      try {
        const data = await api("/events", {
          ...options,
          tag_slug: slug,
          related_tags: "true",
          limit: String(pageSize),
          offset: String(page * pageSize),
        });
        if (!Array.isArray(data) || data.length === 0) break;
        collected.push(...data);
        if (data.length < pageSize) break;
      } catch (_) { break; }
    }
    return collected;
  }, []);

  const loadSport = useCallback(async (sportId) => {
    setLoading(true); setError(null);
    const cfg = TABS.find((t) => t.id === sportId);
    if (!cfg) return;
    try {
      const seen = new Set();
      const rawEvents = [];

      // 1) Open events sorted by startDate ascending (gets imminent matches first)
      for (const slug of cfg.trySlugs) {
        const arr = await fetchSlugPaginated(slug, {
          active: "true",
          closed: "false",
          order: "startDate",
          ascending: "true",
        });
        for (const ev of arr) {
          if (!seen.has(ev.id)) { seen.add(ev.id); rawEvents.push(ev); }
        }
      }

      // 2) Recently closed events (for finished matches display)
      for (const slug of cfg.trySlugs) {
        const arr = await fetchSlugPaginated(slug, {
          closed: "true",
          archived: "false",
          order: "endDate",
          ascending: "false",
        });
        // Only keep the first 50 most recent per slug
        for (const ev of arr.slice(0, 50)) {
          if (!seen.has(ev.id)) { seen.add(ev.id); rawEvents.push(ev); }
        }
      }

      if (rawEvents.length === 0) {
        setError(`No events returned for ${cfg.label}.`);
        setEvents((p) => ({ ...p, [sportId]: [] }));
        return;
      }

      const parsed = rawEvents
        .map((ev) => parseEvent(ev, cfg.defaultTournament, sportId))
        .filter(Boolean);

      // Filter out very old events
      const cutoff = Date.now() - 2.5 * 86400_000;
      const cleaned = parsed.filter((e) =>
        !e.startTime || e.startTime.getTime() >= cutoff || !e.isMatch
      );

      setEvents((prev) => ({ ...prev, [sportId]: cleaned }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [fetchSlugPaginated]);

  useEffect(() => {
    loadSport(tab);
    setTourFilter("all");
  }, [tab, loadSport]);

  useEffect(() => {
    if (!favoritesView) return;
    for (const t of TABS) {
      if (!events[t.id]) loadSport(t.id);
    }
  }, [favoritesView, events, loadSport]);

  const statusMap = useMemo(() => {
    const all = favoritesView
      ? Object.values(events).flat()
      : (events[tab] || []);
    const map = {};
    for (const ev of all) map[ev.id] = computeStatus(ev, ev.sportId || tab, now);
    return map;
  }, [events, tab, now, favoritesView]);

  const { matchGroups, futureGroups, liveCount } = useMemo(() => {
    if (favoritesView) {
      const allEvents = Object.values(events).flat();
      const favEvents = allEvents.filter((e) => favorites.has(e.id));
      const matches = favEvents.filter((e) => e.isMatch);
      const futures = favEvents.filter((e) => !e.startTime && !e.isMatch);
      return {
        matchGroups: groupByTournament(matches, true),
        futureGroups: groupByTournament(futures, false),
        liveCount: matches.filter((e) => statusMap[e.id] === "live").length,
      };
    }

    const all = events[tab] || [];
    const tourFiltered = tab === "tennis" && tourFilter !== "all"
      ? all.filter((g) => g.tour === tourFilter)
      : all;
    const liveAll = tourFiltered.filter((g) => statusMap[g.id] === "live");

    let matches = [];
    let futures = [];

    if (statusFilter === "live") {
      matches = liveAll;
    } else if (statusFilter === "upcoming") {
      matches = tourFiltered.filter((g) =>
        g.startTime && sameDay(g.startTime, selDate) && statusMap[g.id] === "upcoming"
      );
    } else {
      matches = tourFiltered.filter((g) =>
        g.startTime && sameDay(g.startTime, selDate)
      );
      futures = tourFiltered.filter((g) => !g.startTime && !g.isMatch);
    }

    return {
      matchGroups: groupByTournament(matches, true),
      futureGroups: groupByTournament(futures, false),
      liveCount: liveAll.length,
    };
  }, [events, tab, statusMap, statusFilter, tourFilter, selDate, favoritesView, favorites]);

  const totalMatches = matchGroups.reduce((s, g) => s + g.events.length, 0);
  const totalFutures = futureGroups.reduce((s, g) => s + g.events.length, 0);

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <header className="hdr">
          <div className="hdr-l">
            <span style={{ fontSize: 22 }}>📊</span>
            <span className="logo">PolyScores</span>
          </div>
          <div className="hdr-r">
            <button
              className={`hdr-btn${favoritesView ? " hdr-btn-a" : ""}`}
              onClick={() => setFavoritesView(!favoritesView)}
              title="My favorites"
            >
              ★ <span className="hdr-lbl">Favorites</span>
              {favorites.size > 0 && <span className="hdr-cnt">{favorites.size}</span>}
            </button>
            <a
              className="hdr-btn hdr-support"
              href={SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              title="Support PolyScores"
            >
              ❤ <span className="hdr-lbl">Support</span>
            </a>
            <div className="tog">
              <button className={`tog-b${fmt === "decimal" ? " tog-a" : ""}`} onClick={() => setFmt("decimal")}>DEC</button>
              <button className={`tog-b${fmt === "american" ? " tog-a" : ""}`} onClick={() => setFmt("american")}>US</button>
            </div>
            <button className="ref" onClick={() => loadSport(tab)}>↻</button>
          </div>
        </header>

        {!favoritesView && (
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={`tab${tab === t.id ? " tab-a" : ""}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        )}

        {!favoritesView && tab === "tennis" && (
          <div className="subtabs">
            {[{ id: "all", label: "All" }, { id: "atp", label: "ATP" }, { id: "wta", label: "WTA" }].map((s) => (
              <button key={s.id} className={`subtab${tourFilter === s.id ? " subtab-a" : ""}`} onClick={() => setTourFilter(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        )}

        {!favoritesView && (
          <div className="status-bar">
            <button className={`pill${statusFilter === "all" ? " pill-a" : ""}`} onClick={() => setStatusFilter("all")}>All</button>
            <button className={`pill${statusFilter === "live" ? " pill-a pill-live" : ""}`} onClick={() => setStatusFilter("live")}>
              <span className="pill-dot">●</span> Live {liveCount > 0 && <span className="pill-c">{liveCount}</span>}
            </button>
            <button className={`pill${statusFilter === "upcoming" ? " pill-a" : ""}`} onClick={() => setStatusFilter("upcoming")}>Upcoming</button>
          </div>
        )}

        {!favoritesView && statusFilter !== "live" && (
          <DateBar dates={dates} selected={selDate} onSelect={setSelDate} />
        )}

        {favoritesView && (
          <div className="fav-banner">
            <span>★ Your favorite matches</span>
            <button className="fav-back" onClick={() => setFavoritesView(false)}>← Back to all</button>
          </div>
        )}

        <main className="ct">
          {loading && <div className="st"><div className="sp" /><span>Loading…</span></div>}
          {error && <div className="st err">⚠️<p>{error}</p></div>}

          {!loading && !error && totalMatches === 0 && totalFutures === 0 && (
            <div className="st">
              <span style={{ fontSize: 32 }}>{favoritesView ? "☆" : TABS.find((t) => t.id === tab)?.icon}</span>
              <p>
                {favoritesView
                  ? "No favorites yet. Tap ☆ on any match to add it."
                  : statusFilter === "live"
                  ? "No matches live right now."
                  : statusFilter === "upcoming"
                  ? `No upcoming matches on ${fmtDay(selDate).toLowerCase()}.`
                  : `No matches on ${fmtDay(selDate).toLowerCase()}.`}
              </p>
            </div>
          )}

          {matchGroups.map((g) => (
            <TournamentSection
              key={"m-" + g.name} group={g} fmt={fmt}
              statusMap={statusMap} favorites={favorites} onToggleFav={toggleFav}
            />
          ))}

          {futureGroups.length > 0 && <div className="div">FUTURES & OUTRIGHTS</div>}
          {futureGroups.map((g) => (
            <TournamentSection
              key={"f-" + g.name} group={g} fmt={fmt}
              statusMap={statusMap} favorites={favorites} onToggleFav={toggleFav}
            />
          ))}
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

.hdr{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.06);gap:10px;flex-wrap:wrap}
.hdr-l{display:flex;align-items:center;gap:8px;flex-shrink:0}
.hdr-r{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.logo{font-size:18px;font-weight:800;letter-spacing:-.5px;background:linear-gradient(135deg,#22c55e,#3b82f6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}

.hdr-btn{display:flex;align-items:center;gap:4px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#cbd5e1;font:600 11px/1 'DM Sans',sans-serif;padding:6px 10px;border-radius:6px;cursor:pointer;letter-spacing:.3px;text-decoration:none;transition:all .15s}
.hdr-btn:hover{background:rgba(255,255,255,.1);color:#fff}
.hdr-btn-a{background:rgba(234,179,8,.15);border-color:rgba(234,179,8,.35);color:#fbbf24}
.hdr-support{color:#f87171}
.hdr-support:hover{background:rgba(239,68,68,.12);color:#fca5a5;border-color:rgba(239,68,68,.3)}
.hdr-cnt{background:rgba(255,255,255,.15);font-size:9px;padding:1px 5px;border-radius:8px;margin-left:2px}
.hdr-btn-a .hdr-cnt{background:rgba(234,179,8,.3);color:#fbbf24}

.tog{display:flex;background:rgba(255,255,255,.06);border-radius:6px;overflow:hidden}
.tog-b{background:none;border:none;color:#64748b;font:600 11px/1 'DM Sans',sans-serif;padding:5px 10px;cursor:pointer;letter-spacing:.5px}
.tog-a{background:rgba(34,197,94,.2);color:#22c55e}
.ref{background:rgba(255,255,255,.06);border:none;color:#94a3b8;font-size:16px;padding:4px 8px;border-radius:6px;cursor:pointer}
.ref:hover{color:#fff}

.tabs{display:flex;border-bottom:1px solid rgba(255,255,255,.06)}
.tab{flex:1;background:none;border:none;border-bottom:2px solid transparent;color:#64748b;font:600 13px/1 'DM Sans',sans-serif;padding:12px 8px;cursor:pointer;transition:all .2s}
.tab:hover{color:#94a3b8}
.tab-a{color:#22c55e;border-bottom-color:#22c55e;background:rgba(34,197,94,.04)}

.subtabs{display:flex;gap:6px;padding:10px 16px;border-bottom:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.015)}
.subtab{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);color:#94a3b8;font:600 11px/1 'DM Sans',sans-serif;padding:6px 14px;border-radius:14px;cursor:pointer;letter-spacing:.5px;transition:all .15s}
.subtab:hover{background:rgba(255,255,255,.08);color:#e2e8f0}
.subtab-a{background:rgba(59,130,246,.18);border-color:rgba(59,130,246,.35);color:#60a5fa}

.status-bar{display:flex;gap:6px;padding:10px 16px;border-bottom:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.01)}
.pill{display:flex;align-items:center;gap:5px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);color:#94a3b8;font:600 11px/1 'DM Sans',sans-serif;padding:6px 12px;border-radius:14px;cursor:pointer;letter-spacing:.5px;transition:all .15s}
.pill:hover{background:rgba(255,255,255,.08);color:#e2e8f0}
.pill-a{background:rgba(34,197,94,.18);border-color:rgba(34,197,94,.35);color:#22c55e}
.pill-live.pill-a{background:rgba(239,68,68,.18);border-color:rgba(239,68,68,.35);color:#f87171}
.pill-dot{font-size:8px;color:#ef4444;animation:pulse 1.6s ease-in-out infinite}
.pill-c{background:rgba(255,255,255,.1);color:#e2e8f0;font-size:9px;padding:1px 5px;border-radius:8px;margin-left:2px}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

.dp{display:flex;gap:4px;padding:10px 12px;overflow-x:auto;border-bottom:1px solid rgba(255,255,255,.06);-webkit-overflow-scrolling:touch}
.dp-b{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.02);cursor:pointer;min-width:72px;font-family:inherit;transition:all .15s}
.dp-b:hover{background:rgba(255,255,255,.06)}
.dp-a{background:rgba(34,197,94,.15)!important;border-color:rgba(34,197,94,.3)!important}
.dp-a .dp-d{color:#22c55e}
.dp-a .dp-l{color:#22c55e}
.dp-d{font-size:16px;font-weight:700;color:#e2e8f0}
.dp-l{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap}

.fav-banner{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:linear-gradient(180deg,rgba(234,179,8,.08),rgba(255,255,255,.015));border-bottom:1px solid rgba(234,179,8,.2)}
.fav-banner span{font:700 13px/1 'DM Sans',sans-serif;color:#fbbf24;letter-spacing:.3px}
.fav-back{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);color:#cbd5e1;font:600 11px/1 'DM Sans',sans-serif;padding:6px 10px;border-radius:6px;cursor:pointer}
.fav-back:hover{background:rgba(255,255,255,.1);color:#fff}

.sec{margin-bottom:2px}
.sec-h{display:flex;align-items:center;gap:8px;padding:10px 16px 6px;background:linear-gradient(180deg,rgba(34,197,94,.06),rgba(255,255,255,.015));border-bottom:1px solid rgba(34,197,94,.15);border-top:1px solid rgba(255,255,255,.04)}
.sec-t{font-size:12px;font-weight:700;color:#e2e8f0;letter-spacing:.3px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sec-c{font-size:10px;font-weight:600;color:#22c55e;background:rgba(34,197,94,.15);padding:1px 6px;border-radius:10px}

.div{padding:14px 16px 8px;font-size:10px;font-weight:700;color:#475569;letter-spacing:1.5px;background:#0a0c12;border-top:1px solid rgba(255,255,255,.06)}

.mr{display:flex;align-items:center;padding:10px 16px;gap:10px;border-bottom:1px solid rgba(255,255,255,.04);text-decoration:none;color:inherit;transition:background .15s;position:relative}
.mr:hover{background:rgba(255,255,255,.05)}
.mr-live{background:rgba(239,68,68,.04)}
.mr-live:hover{background:rgba(239,68,68,.08)}
.mr-fin{opacity:.65}
.mr-fin:hover{opacity:.85;background:rgba(255,255,255,.04)}
.mr-time{font-size:11px;font-weight:600;color:#64748b;min-width:42px;text-align:center}
.live-dot{color:#ef4444;font-size:12px;animation:pulse 1.6s ease-in-out infinite}
.ft{font-size:10px;font-weight:700;color:#64748b;background:rgba(255,255,255,.05);padding:2px 6px;border-radius:4px;letter-spacing:.5px}
.mr-teams{flex:1;display:flex;flex-direction:column;gap:3px;min-width:0}
.mr-tn{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mr-odds{display:flex;gap:5px}
.mr-right{display:flex;flex-direction:column;align-items:flex-end;gap:3px;min-width:40px}
.mr-vol{font-size:10px;font-weight:600;color:#475569}

.fav-btn{background:none;border:none;color:#475569;font-size:16px;line-height:1;cursor:pointer;padding:2px 4px;border-radius:4px;transition:all .15s}
.fav-btn:hover{color:#fbbf24;background:rgba(234,179,8,.1)}
.fav-btn-a{color:#fbbf24}
.fav-btn-a:hover{color:#fcd34d}

.ob{display:flex;flex-direction:column;align-items:center;background:rgba(255,255,255,.05);border-radius:6px;padding:5px 8px;min-width:50px;gap:1px}
.ob-f{background:rgba(34,197,94,.1);outline:1px solid rgba(34,197,94,.2)}
.ob-dim{opacity:.75}
.ob-l{font-size:9px;font-weight:700;color:#64748b;letter-spacing:.5px}
.ob-v{font-size:13px;font-weight:700;color:#fff}
.ob-p{font-size:9px;color:#64748b}

.out{border-bottom:1px solid rgba(255,255,255,.04);padding-bottom:4px}
.out-h{display:flex;justify-content:space-between;align-items:center;padding:10px 16px 6px;text-decoration:none;color:inherit;gap:10px}
.out-t{font-size:13px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.out-h-r{display:flex;align-items:center;gap:6px;flex-shrink:0}
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

@media(max-width:540px){
  .hdr-lbl{display:none}
  .hdr-btn{padding:6px 8px}
}
@media(max-width:480px){
  .ob{min-width:42px;padding:4px 6px}.ob-v{font-size:12px}
  .mr{padding:8px 12px;gap:6px}
  .dp-b{min-width:60px;padding:5px 8px}
}
`;
