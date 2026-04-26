import { useState } from "react";

const TOPIC_KEYWORDS = {
  all:          "ballot initiative OR ballot measure OR ballot proposition OR ballot question",
  economic:     "ballot initiative minimum wage workers labor gig economy economic justice",
  housing:      "ballot initiative housing rent control tenant eviction affordable",
  environment:  "ballot initiative environment climate energy carbon emissions renewable",
  datacenter:   "ballot initiative data center AI artificial intelligence technology regulation",
  voting:       "ballot initiative voting rights election reform redistricting ranked choice",
  reproductive: "ballot initiative abortion reproductive rights contraception",
  process:      "ballot initiative process signature petition rules legislature preemption restrict",
  cannabis:     "ballot initiative cannabis marijuana legalization drug policy",
  tax:          "ballot initiative tax revenue fiscal bond property income",
  education:    "ballot initiative education school funding charter voucher",
  criminal:     "ballot initiative criminal justice police reform sentencing",
  healthcare:   "ballot initiative healthcare Medicaid insurance prescription drug",
  immigration:  "ballot initiative immigration sanctuary local enforcement",
  guns:         "ballot initiative gun control firearm background check",
};

const TOPIC_LABELS = {
  all: "All topics",
  economic: "Economic justice & labor",
  housing: "Housing & rent control",
  environment: "Environment & energy",
  datacenter: "Data centers & AI",
  voting: "Voting rights & elections",
  reproductive: "Reproductive rights",
  process: "Ballot initiative process (meta)",
  cannabis: "Cannabis & drug policy",
  tax: "Tax & fiscal",
  education: "Education",
  criminal: "Criminal justice",
  healthcare: "Healthcare",
  immigration: "Immigration",
  guns: "Gun policy",
};

const GEO_STATES = {
  all: ["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"],
  flipseats: ["Wisconsin","Arizona","Michigan","Pennsylvania","North Carolina","Kansas"],
};

const GEO_LABELS = {
  all: "All 50 states + 100 cities",
  flipseats: "Flip Seats states (WI, AZ, MI, PA, NC, KS)",
};

const SIG_OPTIONS = [
  { id: "news",   label: "News coverage",       apiLabel: "News" },
  { id: "filing", label: "Signature filings",   apiLabel: "Filing" },
  { id: "cert",   label: "Certifications",      apiLabel: "Certification" },
  { id: "govt",   label: "Govt decisions",      apiLabel: "Govt decision" },
  { id: "legal",  label: "Legal filings",       apiLabel: "Legal" },
  { id: "legis",  label: "Legislative moves",   apiLabel: "Legislative" },
];

const SIG_STYLE = {
  "News":           { bg: "#1a2a40", color: "#5b9cf6" },
  "Filing":         { bg: "#0f2a1e", color: "#3dd68c" },
  "Certification":  { bg: "#1a2a0a", color: "#8bc34a" },
  "Govt decision":  { bg: "#2a1e00", color: "#f0a500" },
  "Legal":          { bg: "#2a0f0f", color: "#ff5f5f" },
  "Legislative":    { bg: "#1e1530", color: "#b07ef8" },
};

const URGENCY_BORDER = { high: "#ff5f5f", medium: "#f0a500", low: "#2a2a2a" };

const BP_PAGES = [
  ["Recent measures",        "https://ballotpedia.org/Recent_ballot_measures"],
  ["2025 measures",          "https://ballotpedia.org/2025_ballot_measures"],
  ["2026 measures",          "https://ballotpedia.org/2026_ballot_measures"],
  ["Initiatives in progress","https://ballotpedia.org/Initiatives_in_progress_in_the_United_States"],
  ["Local 2025",             "https://ballotpedia.org/Local_ballot_measures,_2025"],
];

const mono = "'IBM Plex Mono', 'Courier New', monospace";
const sans = "'IBM Plex Sans', system-ui, sans-serif";

function Spinner() {
  return (
    <span style={{
      display: "inline-block", width: 10, height: 10, flexShrink: 0,
      border: "1.5px solid #333", borderTopColor: "#c8f04a",
      borderRadius: "50%", animation: "bmspin 0.6s linear infinite",
    }} />
  );
}

async function callClaude(system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.content.filter(b => b.type === "text").map(b => b.text).join("");
}

export default function BallotMonitor() {
  const [geo, setGeo] = useState("all");
  const [topic, setTopic] = useState("all");
  const [sigs, setSigs] = useState({ news: true, filing: true, cert: true, govt: true, legal: true, legis: true });
  const [results, setResults] = useState([]);
  const [runDate, setRunDate] = useState(null);
  const [bpHtml, setBpHtml] = useState(null);
  const [bpDate, setBpDate] = useState(null);
  const [bpOpen, setBpOpen] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [bpRunning, setBpRunning] = useState(false);
  const [statusMsg, setStatusMsg] = useState("Ready — configure scope and run a sweep");
  const [statusState, setStatusState] = useState("idle");

  const status = (msg, state = "idle") => { setStatusMsg(msg); setStatusState(state); };

  const activeSigLabels = SIG_OPTIONS.filter(s => sigs[s.id]).map(s => s.apiLabel);

  const metrics = {
    results: results.length || "—",
    states: results.length ? [...new Set(results.map(i => i.state).filter(Boolean))].length : "—",
    high: results.length ? results.filter(i => i.urgency === "high").length : "—",
    last: runDate ? runDate.split(",")[0] : "—",
  };

  async function runSweep() {
    if (!activeSigLabels.length) { status("Select at least one signal type.", "error"); return; }
    const states = GEO_STATES[geo] || GEO_STATES.all;
    const stateList = states.slice(0, 15).join(", ") + (states.length > 15 ? ` and ${states.length - 15} more` : "");
    const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

    setSweeping(true);
    setResults([]);
    status(`Sweeping ${states.length} states...`, "running");

    const system = `You are a ballot initiative monitoring agent. Search the web for CURRENT, REAL ballot initiative developments across US states and cities. Only return items that are genuinely recent and newsworthy.

Return a JSON array of 10-15 objects. Each object must have EXACTLY these fields:
- title: string (max 15 words)
- state: full US state name (e.g. "California")
- city: string or null
- signal_type: exactly one of: News | Filing | Certification | Govt decision | Legal | Legislative
- topic: exactly one of: economic | housing | environment | datacenter | voting | reproductive | process | cannabis | tax | education | criminal | healthcare | immigration | guns | other
- urgency: exactly one of: high | medium | low
- summary: string (1-2 sentences)
- source: string
- url: string or null
- date_mentioned: string or null

Return ONLY the raw JSON array. No markdown. No backticks. No explanation.`;

    const user = `Today is ${today}. Search for current ballot initiative news and developments.
Geography: ${stateList}
Topic: ${TOPIC_KEYWORDS[topic]}
Signal types needed: ${activeSigLabels.join(", ")}

Prioritize: certification decisions, court orders, AG rulings, signature deadlines, newly qualified/rejected measures, legislative preemption. Return 10-15 results as a JSON array.`;

    try {
      const text = await callClaude(system, user);
      const match = text.replace(/```json|```/g, "").match(/\[[\s\S]*\]/);
      const items = match ? JSON.parse(match[0]) : [];
      if (!items.length) throw new Error("No results parsed — try again or broaden scope");
      const rd = new Date().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      setResults(items);
      setRunDate(rd);
      status(`✓ ${items.length} results — ${rd}`);
    } catch (e) {
      status("Error: " + (e.message || "unknown"), "error");
    }
    setSweeping(false);
  }

  async function runBP() {
    const states = GEO_STATES[geo] || GEO_STATES.all;
    const stateList = states.slice(0, 10).join(", ");
    const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

    setBpRunning(true);
    status("Fetching Ballotpedia briefing...", "running");

    const system = `You are a ballot initiative analyst. Search Ballotpedia and summarize current ballot initiative activity.
Write your response as plain HTML using only <p>, <ul>, <li>, <strong>. No headers, no divs, no inline styles.
Be specific — name actual measures and states. Under 350 words.`;

    const user = `Today is ${today}. Search these Ballotpedia pages for current ballot initiative activity (focus on states: ${stateList}):
- ballotpedia.org/Recent_ballot_measures
- ballotpedia.org/2026_ballot_measures
- ballotpedia.org/Initiatives_in_progress_in_the_United_States
- ballotpedia.org/Local_ballot_measures,_2025

Summarize the most significant current developments. Name specific measures and states.`;

    try {
      const text = await callClaude(system, user);
      setBpHtml(text);
      setBpDate(today);
      setBpOpen(true);
      status("✓ Ballotpedia briefing complete");
    } catch (e) {
      status("Ballotpedia error: " + (e.message || "unknown"), "error");
    }
    setBpRunning(false);
  }

  const sorted = [...results].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.urgency] ?? 2) - ({ high: 0, medium: 1, low: 2 }[b.urgency] ?? 2));

  const c = {
    shell: { background: "#0f0f0f", color: "#e8e4dc", fontFamily: sans, fontSize: 14, borderRadius: 12, padding: "22px 18px 36px" },
    eyebrow: { fontFamily: mono, fontSize: 10, letterSpacing: "0.15em", color: "#c8f04a", textTransform: "uppercase", marginBottom: 4 },
    title: { fontSize: 21, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.15 },
    subtitle: { fontFamily: mono, fontSize: 11, color: "#444", marginTop: 4, marginBottom: 18 },
    metrics: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, background: "#222", border: "1px solid #222", borderRadius: 8, overflow: "hidden", marginBottom: 18 },
    metric: { background: "#141414", padding: "11px 12px", textAlign: "center" },
    metricVal: { fontFamily: mono, fontSize: 19, fontWeight: 600, color: "#c8f04a" },
    metricLabel: { fontFamily: mono, fontSize: 9, color: "#444", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2 },
    panel: { background: "#141414", border: "1px solid #222", borderRadius: 10, padding: 16, marginBottom: 18 },
    grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11, marginBottom: 13 },
    label: { fontFamily: mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "#444", marginBottom: 5, display: "block" },
    select: { width: "100%", background: "#1c1c1c", border: "1px solid #2a2a2a", color: "#e8e4dc", fontFamily: sans, fontSize: 13, padding: "7px 9px", borderRadius: 6, cursor: "pointer", outline: "none" },
    sigGrid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4, marginBottom: 13 },
    sigLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#777", cursor: "pointer", padding: "5px 6px", borderRadius: 5 },
    btnRow: { display: "flex", gap: 7 },
    btnPrimary: { flex: 1, padding: "9px 14px", borderRadius: 6, fontFamily: mono, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", cursor: "pointer", border: "none", background: "#c8f04a", color: "#0f0f0f" },
    btnSec: { flex: 1, padding: "9px 14px", borderRadius: 6, fontFamily: mono, fontSize: 11, cursor: "pointer", background: "transparent", color: "#777", border: "1px solid #2a2a2a" },
    btnX: { padding: "9px 11px", borderRadius: 6, fontFamily: mono, fontSize: 11, cursor: "pointer", background: "transparent", color: "#444", border: "1px solid #1f1f1f" },
    statusBar: { fontFamily: mono, fontSize: 11, paddingTop: 9, marginTop: 9, borderTop: "1px solid #1f1f1f", display: "flex", alignItems: "center", gap: 6 },
    bpWrap: { background: "#141414", border: "1px solid #222", borderRadius: 10, marginBottom: 18, overflow: "hidden" },
    bpHead: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 15px", cursor: "pointer", borderBottom: bpOpen ? "1px solid #222" : "none" },
    bpBody: { padding: "13px 15px" },
    bpSummary: { fontSize: 13, color: "#888", lineHeight: 1.65 },
    bpLinks: { display: "flex", flexWrap: "wrap", gap: 5, marginTop: 11, paddingTop: 11, borderTop: "1px solid #1f1f1f" },
    bpLink: { fontFamily: mono, fontSize: 10, color: "#5b9cf6", textDecoration: "none", padding: "3px 7px", border: "1px solid #2a2a2a", borderRadius: 4, letterSpacing: "0.03em" },
    rHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 },
    rLabel: { fontFamily: mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "#444" },
    rMeta: { fontFamily: mono, fontSize: 10, color: "#444" },
    empty: { background: "#141414", border: "1px dashed #222", borderRadius: 10, padding: "34px 16px", textAlign: "center", color: "#444", fontFamily: mono, fontSize: 12, lineHeight: 1.7 },
    card: (urg) => ({ background: "#141414", border: "1px solid #222", borderLeft: `2px solid ${URGENCY_BORDER[urg] || "#222"}`, borderRadius: 8, padding: "12px 14px", marginBottom: 7 }),
    cardTitle: { fontSize: 14, fontWeight: 500, color: "#e8e4dc", lineHeight: 1.4, marginBottom: 5 },
    cardMeta: { fontFamily: mono, fontSize: 11, color: "#444", marginBottom: 5 },
    cardSummary: { fontSize: 13, color: "#777", lineHeight: 1.55 },
    cardTags: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 },
    tag: (bg, color) => ({ fontFamily: mono, fontSize: 10, fontWeight: 500, padding: "2px 6px", borderRadius: 3, letterSpacing: "0.04em", textTransform: "uppercase", background: bg, color }),
  };

  return (
    <div style={c.shell}>
      <style>{`@keyframes bmspin{to{transform:rotate(360deg)}} select option{background:#1c1c1c;color:#e8e4dc}`}</style>

      <div style={c.eyebrow}>Progress Report · Flip Seats</div>
      <div style={c.title}>Ballot Initiative Monitor</div>
      <div style={c.subtitle}>50 states · 100 cities · live web search</div>

      <div style={c.metrics}>
        {[["Results", metrics.results], ["States", metrics.states], ["High urgency", metrics.high], ["Last run", metrics.last]].map(([l, v]) => (
          <div key={l} style={c.metric}>
            <div style={c.metricVal}>{v}</div>
            <div style={c.metricLabel}>{l}</div>
          </div>
        ))}
      </div>

      <div style={c.panel}>
        <div style={c.grid2}>
          <div>
            <label style={c.label}>Geography</label>
            <select style={c.select} value={geo} onChange={e => setGeo(e.target.value)}>
              {Object.entries(GEO_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label style={c.label}>Topic filter</label>
            <select style={c.select} value={topic} onChange={e => setTopic(e.target.value)}>
              {Object.entries(TOPIC_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>

        <label style={c.label}>Signal types</label>
        <div style={c.sigGrid}>
          {SIG_OPTIONS.map(opt => (
            <label key={opt.id} style={c.sigLabel}>
              <input type="checkbox" checked={sigs[opt.id]}
                onChange={e => setSigs(p => ({ ...p, [opt.id]: e.target.checked }))}
                style={{ accentColor: "#c8f04a", width: 12, height: 12, cursor: "pointer" }} />
              {opt.label}
            </label>
          ))}
        </div>

        <div style={c.btnRow}>
          <button style={{ ...c.btnPrimary, opacity: sweeping || bpRunning ? 0.5 : 1 }}
            onClick={runSweep} disabled={sweeping || bpRunning}>
            {sweeping ? "Sweeping..." : "▶ Run sweep"}
          </button>
          <button style={{ ...c.btnSec, opacity: sweeping || bpRunning ? 0.5 : 1 }}
            onClick={runBP} disabled={sweeping || bpRunning}>
            {bpRunning ? "Fetching..." : "⊕ Ballotpedia"}
          </button>
          <button style={c.btnX} onClick={() => { setResults([]); setRunDate(null); setBpHtml(null); setBpDate(null); setBpOpen(false); status("Cleared."); }}>✕</button>
        </div>

        <div style={{ ...c.statusBar, color: statusState === "running" ? "#c8f04a" : statusState === "error" ? "#ff5f5f" : "#555" }}>
          {statusState === "running" && <Spinner />}
          {statusMsg}
        </div>
      </div>

      {bpHtml && (
        <div style={c.bpWrap}>
          <div style={c.bpHead} onClick={() => setBpOpen(o => !o)}>
            <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "#777", display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#3dd68c", display: "inline-block" }} />
              Ballotpedia briefing
              {bpDate && <span style={{ color: "#444", marginLeft: 4 }}>{bpDate}</span>}
            </div>
            <span style={{ fontFamily: mono, fontSize: 10, color: "#444" }}>{bpOpen ? "▴ hide" : "▾ show"}</span>
          </div>
          {bpOpen && (
            <div style={c.bpBody}>
              <div style={c.bpSummary} dangerouslySetInnerHTML={{ __html: bpHtml }} />
              <div style={c.bpLinks}>
                {BP_PAGES.map(([label, url]) => (
                  <a key={url} href={url} target="_blank" rel="noopener" style={c.bpLink}>{label}</a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={c.rHeader}>
        <div style={c.rLabel}>Search results</div>
        {runDate && <div style={c.rMeta}>{runDate}</div>}
      </div>

      {sorted.length === 0 ? (
        <div style={c.empty}>No results yet.<br />Run a sweep or check Ballotpedia to get started.</div>
      ) : (
        sorted.map((item, i) => {
          const sig = item.signal_type || "News";
          const ss = SIG_STYLE[sig] || { bg: "#1f1f1f", color: "#555" };
          const loc = [item.city, item.state].filter(Boolean).join(", ");
          const meta = [loc, item.source, item.date_mentioned].filter(Boolean).join(" · ");
          return (
            <div key={i} style={c.card(item.urgency)}>
              <div style={c.cardTitle}>
                {item.url
                  ? <a href={item.url} target="_blank" rel="noopener" style={{ color: "#e8e4dc", textDecoration: "none", borderBottom: "1px solid #2a2a2a" }}>{item.title}</a>
                  : item.title}
              </div>
              {meta && <div style={c.cardMeta}>{meta}</div>}
              <div style={c.cardSummary}>{item.summary}</div>
              <div style={c.cardTags}>
                <span style={c.tag(ss.bg, ss.color)}>{sig}</span>
                {item.topic && <span style={c.tag("#1c1c1c", "#555")}>{item.topic.replace(/_/g, " ")}</span>}
                {item.urgency === "high" && <span style={c.tag("#2a0f0f", "#ff5f5f")}>● high urgency</span>}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
