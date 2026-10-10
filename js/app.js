import { store, loadData, onData, ensureLiveWeapons, cardArt } from "./data.js";
import { drawCrosshair, parseCode, LIBRARY } from "./crosshair.js";
import { CONFIG } from "./config.js";
import { statsEnabled, parseRiotId, lookup } from "./stats.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const main = $("#main");
const ROLE_ORDER = ["Duelist", "Initiator", "Controller", "Sentinel"];
const KEYS = { Ability1: "Q", Ability2: "E", Grenade: "C", Ultimate: "X", Passive: "P" };
const SLOT_ORDER = { Grenade: 0, Ability1: 1, Ability2: 2, Ultimate: 3, Passive: 4 };
const hex = (c) => "#" + String(c || "").slice(0, 6);
const ls = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 1800);
}
async function copy(text, label = "Copied") {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch {} ta.remove();
  }
  toast(label);
}
const D = () => store.data;
const agentBy = (key) => D().agents.find((a) => a.slug === key || a.uuid === key || a.name.toLowerCase() === String(key).toLowerCase());
const tierBy = (n) => D().tiers.list.find((t) => t.tier === Number(n));
const roleIcon = (name) => { const a = D().agents.find((x) => x.role && x.role.name === name); return a ? a.role.icon : ""; };

/* ---------------- router ---------------- */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, qs] = h.split("?");
  return { parts: path.split("/").filter(Boolean), q: new URLSearchParams(qs || "") };
}
let currentRender = null;
function route() {
  if (!D()) return;
  const { parts, q } = parseHash();
  const [a, b] = parts;
  const views = { "": home, agents: b ? agentDetail : agents, maps: b ? mapDetail : maps, weapons: b ? weaponDetail : weapons,
    comp, crosshairs, ranks, more, stats: home };
  const view = views[a || ""] || notFound;
  currentRender = () => view(b, q);
  currentRender();
  const nav = a === "stats" ? "" : (a || "");
  const navKey = nav === "" ? "home" : (["comp", "crosshairs", "ranks"].includes(nav) ? nav : nav);
  $$("[data-nav]").forEach((el) => {
    const k = el.dataset.nav;
    const on = k === navKey || (k === "more" && ["comp", "crosshairs", "ranks", "more"].includes(nav));
    el.classList.toggle("active", on);
    if (on) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
  });
}
function setTitle(t) { document.title = t ? `${t} · SH VALO TRACKER` : "SH VALO TRACKER · Valorant stats, agents, maps & comps"; }
function render(html, title) {
  main.innerHTML = html;
  setTitle(title);
}
window.addEventListener("hashchange", () => { route(); window.scrollTo(0, 0); });
onData(() => {
  $("#dataSource").textContent = store.source === "live" ? "live data" : "offline snapshot";
  // re-render list pages quietly when live data lands (not mid-typing on forms)
  const { parts } = parseHash();
  if (["agents", "maps", "ranks", "weapons"].includes(parts[0]) && !document.activeElement.matches("input,textarea,select")) currentRender && currentRender();
});

/* ---------------- home / player lookup ---------------- */
function regionOptions(sel) {
  return CONFIG.REGIONS.map(([v, n]) => `<option value="${v}" ${v === sel ? "selected" : ""}>${v.toUpperCase()}</option>`).join("");
}
function recentHTML() {
  const rec = ls.get("shv.recent", []);
  if (!rec.length) return "";
  return `<div class="recents"><span class="lbl">Recent</span>${rec.map((r) =>
    `<button class="recent" data-id="${esc(r.id)}" data-r="${esc(r.r)}">${esc(r.id)} <small>${esc(r.r)}</small></button>`).join("")}
    <button class="recent-x" id="clearRecent">clear</button></div>`;
}
function home() {
  const sp = new URLSearchParams(location.search);
  const id = sp.get("id") || "";
  const r = (sp.get("r") || ls.get("shv.region", CONFIG.DEFAULT_REGION)).toLowerCase();
  const d = D();
  const pick = d.agents[(new Date().getDate() * 7) % d.agents.length];
  const std = d.maps.filter((m) => m.mode === "standard");
  const mapPick = std[new Date().getDate() % std.length];
  render(`
  <section class="hero">
    <p class="eyebrow">Player lookup</p>
    <h1>Track any <span>Riot ID</span></h1>
    <p class="lead">Type a name#tag and pick a region to see rank, RR, recent matches, K/D, headshot % and most-played agents.</p>
    <form class="lookup" id="lookupForm" autocomplete="off">
      <div class="row">
        <div><label for="rid">Riot ID</label><input class="search" id="rid" name="id" placeholder="Name#TAG" value="${esc(id)}" required inputmode="text" autocapitalize="off" spellcheck="false" aria-describedby="ridHelp"></div>
        <div><label for="reg">Region</label><select id="reg" name="r" aria-label="Region">${regionOptions(r)}</select></div>
      </div>
      <button class="btn primary" type="submit">Search</button>
    </form>
    <p id="ridHelp" class="dim" style="font-size:.8rem;margin:.4rem 0 0">Example: <i>YourName#1234</i>. Region AP covers India and most of Asia.</p>
    ${recentHTML()}
    <div class="result" id="result" aria-live="polite"></div>
  </section>
  <div class="section-title"><h2>Explore</h2></div>
  <div class="tiles">
    <a class="tile" href="#/agents" style="background-image:url('${esc(pick.bg || "")}')"><span class="n">${d.agents.length}</span><b>Agents</b><small>Roles, abilities, lore</small></a>
    <a class="tile" href="#/maps" style="background-image:url('${esc(mapPick.splash)}')"><span class="n">${std.length}</span><b>Maps</b><small>Callouts &amp; minimaps</small></a>
    <a class="tile" href="#/weapons" style="background-image:url('${esc(d.weapons.find((w) => w.slug === "vandal")?.shop || "")}');background-size:contain;background-position:center 30%"><span class="n">${d.weapons.length}</span><b>Weapons</b><small>Damage, fire rate, skins</small></a>
    <a class="tile" href="#/comp"><span class="n">5v5</span><b>Comp Builder</b><small>Balance roles, share link</small></a>
    <a class="tile" href="#/crosshairs"><span class="n">+</span><b>Crosshairs</b><small>Preview &amp; copy codes</small></a>
    <a class="tile" href="#/ranks" style="background-image:url('${esc(tierBy(27)?.icon || "")}');background-size:90px;background-position:right 14px top 14px"><span class="n"></span><b>Ranks</b><small>Iron to Radiant</small></a>
  </div>
  <div class="section-title"><h2>Agent of the day</h2><a class="btn small" href="#/agents/${pick.slug}">Open</a></div>
  <a class="agent-hero" href="#/agents/${pick.slug}" style="text-decoration:none">
    <div class="art" style="min-height:260px"><div class="bgw" style="background-image:url('${esc(pick.bg || "")}')"></div><img src="${esc(pick.portrait)}" alt="${esc(pick.name)}" style="height:280px" loading="lazy"></div>
    <div class="info"><span class="role"><img src="${esc(pick.role?.icon)}" alt="">${esc(pick.role?.name)}</span><h2>${esc(pick.name)}</h2><p class="muted">${esc(pick.desc)}</p></div>
  </a>`, "");
  const form = $("#lookupForm");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const idv = $("#rid").value.trim(); const rv = $("#reg").value;
    runLookup(idv, rv, true);
  });
  $$(".recent").forEach((b) => b.addEventListener("click", () => { $("#rid").value = b.dataset.id; $("#reg").value = b.dataset.r; runLookup(b.dataset.id, b.dataset.r, true); }));
  $("#clearRecent")?.addEventListener("click", () => { ls.set("shv.recent", []); $(".recents").remove(); });
  if (id) runLookup(id, r, false);
}

function remember(id, r) {
  const rec = ls.get("shv.recent", []).filter((x) => x.id.toLowerCase() !== id.toLowerCase());
  rec.unshift({ id, r }); ls.set("shv.recent", rec.slice(0, 8)); ls.set("shv.region", r);
}

async function runLookup(id, r, push) {
  const out = $("#result");
  const rid = parseRiotId(id);
  if (!rid) { out.innerHTML = `<div class="panel"><b>That doesn't look like a Riot ID.</b><p class="muted" style="margin:.3rem 0 0">Use the full name and tag with a #, like <i>Name#1234</i>.</p></div>`; return; }
  const full = `${rid.name}#${rid.tag}`;
  if (push) history.replaceState(null, "", `?id=${encodeURIComponent(full)}&r=${encodeURIComponent(r)}#/`);
  remember(full, r);
  setTitle(full);
  if (!statsEnabled()) {
    out.innerHTML = `
    <div class="soon">
      <div><span class="pill">Coming soon</span></div>
      <div class="who">${esc(rid.name)}<span>#${esc(rid.tag)}</span> <small class="muted" style="font-size:.9rem">· ${esc(r.toUpperCase())}</small></div>
      <p style="margin:0">Live player stats are being connected. Once the stats service is switched on, this card fills in with rank, RR, recent matches, K/D, headshot % and top agents for any Riot ID.</p>
      <div class="statgrid">${["Current rank", "K/D", "Headshot %", "Win rate"].map((k) => `<div class="stat"><b class="dim">—</b><span>${k}</span></div>`).join("")}</div>
      <div class="comp-actions"><button class="btn small" id="shareLookup">Copy share link</button></div>
    </div>`;
    $("#shareLookup").addEventListener("click", () => copy(location.href, "Link copied"));
    return;
  }
  out.innerHTML = `<div class="panel" style="display:flex;gap:12px;align-items:center"><div class="boot-mark" style="width:28px;height:28px"></div><span>Looking up <b>${esc(full)}</b> on ${esc(r.toUpperCase())}…</span></div>`;
  try {
    const res = await lookup(rid.name, rid.tag, r);
    out.innerHTML = playerHTML(res, full);
    $("#shareLookup")?.addEventListener("click", () => share(location.href, `${full} on SH VALO TRACKER`));
  } catch (e) {
    const nf = e.status === 404;
    const rl = e.status === 429;
    out.innerHTML = `<div class="panel"><b>${nf ? "Player not found." : rl ? "Too many lookups right now." : "Couldn't load stats."}</b>
      <p class="muted" style="margin:.3rem 0 0">${nf ? "Check the spelling, the #tag and the region." : rl ? "The stats service is rate limited. Try again in a minute." : esc(e.message || "Try again in a moment.")}</p></div>`;
  }
}

const fmt = (n, d = 1) => (n == null || isNaN(n)) ? "—" : Number(n).toFixed(d);
function ago(ts) {
  if (!ts) return "";
  const s = (Date.now() - ts) / 1000;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}
const cap = (s) => String(s || "").replace(/(^|[\s_-])(\w)/g, (m, p, c) => p + c.toUpperCase()).replace(/_/g, " ");
function playerHTML(res, full) {
  const a = res.account || {};
  if (!a.card && a.cardImage) { const mm = String(a.cardImage).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i); if (mm) a.card = mm[0]; }
  const m = res.mmr || {};
  const icon = (t) => t ? (t.icon || tierBy(t.tierId)?.icon || "") : "";
  const cur = m.current, last = m.last, peak = m.peak;
  const [nm, tg] = [a.name || full.split("#")[0], a.tag || full.split("#")[1]];
  const s = res.summary;
  const matches = res.matches.map((x) => {
    const ag = agentBy(x.agentId || x.agent);
    const cls = x.won === true ? "win" : x.won === false ? "loss" : "";
    const label = x.won === true ? "Win" : x.won === false ? "Loss" : x.won === "draw" ? "Draw" : "";
    return `<div class="match ${cls}">
      <img src="${esc(ag?.icon || "")}" alt="${esc(ag?.name || x.agent)}" loading="lazy">
      <div><div class="m1">${esc(ag?.name || cap(x.agent))} · ${esc(cap(x.map))}</div><div class="m2">${esc(cap(x.mode))}${x.started ? " · " + ago(x.started) : ""} · K/D/A ${x.kills}/${x.deaths}/${x.assists}${x.shots ? " · HS " + Math.round(100 * x.headshots / x.shots) + "%" : ""}</div></div>
      <div class="sc"><b>${x.myRounds != null ? `${x.myRounds}–${x.theirRounds}` : "—"}</b><small class="muted">${label}${x.score && x.rounds ? " · ACS " + Math.round(x.score / x.rounds) : ""}</small></div>
    </div>`;
  }).join("");
  const tops = res.topAgents.map((t) => { const ag = agentBy(t.id || t.name);
    return `<div class="topagent"><img src="${esc(ag?.icon || "")}" alt="" loading="lazy"><div><b style="font-family:var(--display);text-transform:uppercase">${esc(ag?.name || cap(t.name))}</b><div class="muted" style="font-size:.8rem">${t.games} game${t.games > 1 ? "s" : ""} · ${t.deaths ? (t.kills / t.deaths).toFixed(2) : t.kills} K/D</div></div></div>`; }).join("");
  return `
  <div class="playerbanner" style="background-image:url('${esc(cardArt(a.card, "wideart"))}')">
    ${a.card ? `<img class="pc" src="${esc(cardArt(a.card, "smallart"))}" alt="">` : (a.cardImage ? `<img class="pc" src="${esc(a.cardImage)}" alt="">` : "")}
    <div><h2>${esc(nm)}<span>#${esc(tg)}</span></h2>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${a.level != null ? `<span class="lvl">LVL ${esc(a.level)}</span>` : ""}<span class="muted" style="font-size:.85rem">${esc((res.region || "").toUpperCase())}${a.title ? " · " + esc(a.title) : ""}</span>
    <button class="btn small" id="shareLookup">Share</button></div></div>
  </div>
  ${res.limited ? `<div class="limited" role="note"><b>Limited data</b><span>${esc(res.limited.replace(/^Limited data:\s*(.)/, (_, c) => c.toUpperCase()))}</span></div>` : ""}
  <div class="rankrow">
    <div class="rankcard">${cur ? `<img src="${esc(icon(cur))}" alt="">` : last ? `<img class="faded" src="${esc(icon(last))}" alt="">` : ""}<div><div class="k">Current rank${m.currentAct ? ` · ${esc(m.currentAct)}` : ""}</div>
      <div class="v">${cur ? esc(cur.name) : res.mmrError ? "Unavailable" : "Unranked this act"}</div>
      ${cur && cur.rr != null && !isNaN(cur.rr) ? `<div class="muted" style="font-size:.9rem">${cur.rr} RR${cur.change != null ? ` · last game ${cur.change > 0 ? "+" : ""}${cur.change}` : ""}</div><div class="rrbar"><i style="width:${Math.max(0, Math.min(100, cur.rr))}%"></i></div>` : ""}
      ${!cur && m.playedThisAct ? `<div class="muted" style="font-size:.85rem">${m.playedThisAct} game${m.playedThisAct > 1 ? "s" : ""} this act, no rank yet</div>` : ""}
      ${!cur && last ? `<div class="muted" style="font-size:.85rem">Last seen: ${esc(last.name)} · ${esc(last.act)}</div>` : ""}</div></div>
    <div class="rankcard">${peak ? `<img src="${esc(icon(peak))}" alt="">` : ""}<div><div class="k">Highest act rank we can see</div><div class="v">${esc(peak?.name || "—")}</div>${peak?.act ? `<div class="muted" style="font-size:.85rem">${esc(peak.act)}${m.actsSeen ? ` · from ${m.actsSeen} act${m.actsSeen > 1 ? "s" : ""} on record` : ""}</div>` : ""}</div></div>
  </div>
  <div class="section-title"><h2>Performance</h2><span class="${s.stale ? "stale-label" : "muted"}" style="font-size:.85rem">${esc(s.label || "")}</span></div>
  <div class="statgrid${s.stale ? " stale" : ""}">
    <div class="stat"><b>${s.kd == null ? "—" : s.kd.toFixed(2)}</b><span>K/D</span></div>
    <div class="stat"><b>${fmt(s.hs)}${s.hs == null ? "" : "%"}</b><span>Headshot %</span></div>
    <div class="stat"><b>${fmt(s.win, 0)}${s.win == null ? "" : "%"}</b><span>Win rate</span></div>
    <div class="stat"><b>${fmt(s.acs, 0)}</b><span>Avg combat score</span></div>
  </div>
  ${tops ? `<div class="section-title"><h2>Most played</h2>${res.topLabel ? `<span class="${s.stale ? "stale-label" : "muted"}" style="font-size:.85rem">${esc(res.topLabel)}</span>` : ""}</div><div class="topagents">${tops}</div>` : ""}
  <div class="section-title"><h2>Recent matches</h2></div>
  <div class="matches">${matches || `<div class="empty">${res.matchError ? "Match history is unavailable right now." : res.limited ? "No match history we can see. It may be private or not synced yet." : "No recent matches found."}</div>`}</div>
  <p class="dim" style="font-size:.78rem;margin-top:10px">Stats via ${esc(res.source || "")}. Unofficial data, may lag a few minutes behind the game.</p>`;
}

async function share(url, title) {
  if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === "AbortError") return; } }
  copy(url, "Link copied");
}

/* ---------------- agents ---------------- */
let agentRole = "All", agentQuery = "";
function agents() {
  const d = D();
  const roles = ["All", ...ROLE_ORDER];
  render(`
  <div class="page-head"><div><p class="eyebrow">Roster</p><h1>Agents</h1></div><p>${d.agents.length} agents. Tap one for abilities and details.</p></div>
  <div class="toolbar">
    <input class="search" id="agentSearch" type="search" placeholder="Search agents" value="${esc(agentQuery)}" aria-label="Search agents">
    <div class="chips" role="group" aria-label="Filter by role">${roles.map((r) => `<button class="chip" data-role="${r}" aria-pressed="${r === agentRole}">${r !== "All" ? `<img src="${esc(roleIcon(r))}" alt="">` : ""}${r}</button>`).join("")}</div>
  </div>
  <div class="agent-grid" id="agentGrid"></div>`, "Agents");
  const draw = () => {
    const q = agentQuery.toLowerCase();
    const list = d.agents.filter((a) => (agentRole === "All" || a.role?.name === agentRole) && (!q || a.name.toLowerCase().includes(q)));
    $("#agentGrid").innerHTML = list.map((a) => `
      <a class="agent-card" href="#/agents/${a.slug}">
        <div class="bgc" style="background:linear-gradient(160deg,${hex(a.colors?.[0])},${hex(a.colors?.[2])})"></div>
        <img class="por" src="${esc(a.portrait)}" alt="" loading="lazy">
        <div class="meta"><b>${esc(a.name)}</b><small><img src="${esc(a.role?.icon)}" alt="">${esc(a.role?.name)}</small></div>
      </a>`).join("") || `<div class="empty">No agents match.</div>`;
  };
  draw();
  $$("[data-role]").forEach((b) => b.addEventListener("click", () => { agentRole = b.dataset.role; $$("[data-role]").forEach((x) => x.setAttribute("aria-pressed", x === b)); draw(); }));
  $("#agentSearch").addEventListener("input", (e) => { agentQuery = e.target.value; draw(); });
}
function agentDetail(key) {
  const a = agentBy(key);
  if (!a) return notFound();
  const abil = a.abilities.slice().sort((x, y) => (SLOT_ORDER[x.slot] ?? 9) - (SLOT_ORDER[y.slot] ?? 9));
  render(`
  <a class="back" href="#/agents">All agents</a>
  <section class="agent-hero" style="background:linear-gradient(135deg,${hex(a.colors?.[0])}55,${hex(a.colors?.[1])}aa)">
    <div class="art"><div class="bgw" style="background-image:url('${esc(a.bg || "")}')"></div><img src="${esc(a.portrait)}" alt="${esc(a.name)} portrait"></div>
    <div class="info">
      <span class="role"><img src="${esc(a.role?.icon)}" alt="">${esc(a.role?.name)}</span>
      <h1>${esc(a.name)}</h1>
      <p>${esc(a.desc)}</p>
      <p class="muted" style="font-size:.9rem">${esc(a.role?.desc)}</p>
      <div class="comp-actions"><a class="btn primary" href="#/comp?a=${a.slug}">Add to a comp</a></div>
    </div>
  </section>
  <h2>Abilities</h2>
  <div class="abilities">${abil.map((x) => `
    <div class="ability"><div class="ico">${x.icon ? `<img src="${esc(x.icon)}" alt="" loading="lazy">` : ""}<span class="key">${KEYS[x.slot] || ""}</span></div>
    <div><h3>${esc(x.name)}</h3><p>${esc(x.desc)}</p></div></div>`).join("")}</div>`, a.name);
}

/* ---------------- maps ---------------- */
let mapMode = "standard";
function maps() {
  const d = D();
  const modes = [["standard", "Competitive"], ["tdm", "Team Deathmatch"]];
  render(`
  <div class="page-head"><div><p class="eyebrow">Battlegrounds</p><h1>Maps</h1></div><p>Splash art, sites and callout minimaps.</p></div>
  <div class="toolbar"><div class="chips" role="group" aria-label="Map type">${modes.map(([k, n]) => `<button class="chip" data-mode="${k}" aria-pressed="${k === mapMode}">${n}</button>`).join("")}</div></div>
  <div class="map-grid" id="mapGrid"></div>`, "Maps");
  const draw = () => {
    $("#mapGrid").innerHTML = d.maps.filter((m) => m.mode === mapMode).map((m) => `
      <a class="map-card" href="#/maps/${m.slug}" style="background-image:url('${esc(m.list || m.splash)}')">
        <div><b>${esc(m.name)}</b><small>${esc(m.sites || "Team Deathmatch")}${m.callouts.length ? ` · ${m.callouts.length} callouts` : ""}</small></div></a>`).join("");
  };
  draw();
  $$("[data-mode]").forEach((b) => b.addEventListener("click", () => { mapMode = b.dataset.mode; $$("[data-mode]").forEach((x) => x.setAttribute("aria-pressed", x === b)); draw(); }));
}
function mapDetail(key) {
  const m = D().maps.find((x) => x.slug === key);
  if (!m) return notFound();
  const groups = {};
  for (const c of m.callouts) (groups[c.r] ||= []).push(c.n);
  const hasXY = m.minimap && m.callouts.length && m.xm;
  const pins = hasXY ? m.callouts.map((c) => {
    const x = (c.y * m.xm + m.xs) * 100, y = (c.x * m.ym + m.ys) * 100;
    return `<span class="callout ${esc(c.r)}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%">${esc(c.n)}</span>`;
  }).join("") : "";
  render(`
  <a class="back" href="#/maps">All maps</a>
  <section class="map-hero" style="background-image:url('${esc(m.splash)}')">
    <div><p class="eyebrow">${esc(m.sites || "Team Deathmatch")}</p><h1>${esc(m.name)}</h1>${m.coords ? `<p class="muted" style="margin:0">${esc(m.coords)}</p>` : ""}</div>
  </section>
  <div class="map-body">
    <div>
      ${m.minimap ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px"><h2 style="margin:0">Minimap</h2>${pins ? `<button class="btn small" id="toggleLabels" aria-pressed="true">Hide callouts</button>` : ""}</div>
      <div class="minimap-wrap" id="mm"><div class="minimap"><img src="${esc(m.minimap)}" alt="${esc(m.name)} minimap">${pins}</div></div>` : `<p class="muted">No minimap for this map.</p>`}
    </div>
    <div class="panel">
      <h2>Callouts</h2>
      ${Object.keys(groups).length ? `<div class="callout-list">${Object.entries(groups).sort().map(([g, list]) => `<h4>${esc(g)}</h4>${list.sort().map((n) => `<div>${esc(n)}</div>`).join("")}`).join("")}</div>` : `<p class="muted">No callout data for this map.</p>`}
      ${m.mode === "standard" ? `<div class="comp-actions" style="margin-top:14px"><a class="btn primary" href="#/comp?m=${m.slug}">Build a comp for ${esc(m.name)}</a></div>` : ""}
    </div>
  </div>`, m.name);
  $("#toggleLabels")?.addEventListener("click", (e) => {
    const w = $("#mm"); const hidden = w.classList.toggle("hide-labels");
    e.target.textContent = hidden ? "Show callouts" : "Hide callouts"; e.target.setAttribute("aria-pressed", String(!hidden));
  });
}

/* ---------------- weapons ---------------- */
const CAT_ORDER = ["Sidearm", "SMG", "Shotgun", "Rifle", "Sniper", "Heavy", "Melee"];
const CAT_NAME = { Sidearm: "Sidearms", SMG: "SMGs", Shotgun: "Shotguns", Rifle: "Rifles", Sniper: "Snipers", Heavy: "Machine guns", Melee: "Melee" };
let wSort = { key: "cat", dir: 1 }, wCat = "All";
function dmgCell(w, band) {
  const r = w.stats?.ranges?.[band];
  if (!r) return `<td class="dmg dim">—</td>`;
  return `<td class="dmg"><span class="h">${Math.round(r.headDamage)}</span> / ${Math.round(r.bodyDamage)} / ${Math.round(r.legDamage)}<br><small class="dim">${r.rangeStartMeters}–${r.rangeEndMeters}m</small></td>`;
}
function weapons() {
  ensureLiveWeapons();
  const d = D();
  const cats = ["All", ...CAT_ORDER.filter((c) => c !== "Melee")];
  render(`
  <div class="page-head"><div><p class="eyebrow">Arsenal</p><h1>Weapons</h1></div><p>Damage is head / body / legs for each range band. Tap a column to sort, tap a gun for its skins.</p></div>
  <div class="toolbar"><div class="chips" role="group" aria-label="Weapon type">${cats.map((c) => `<button class="chip" data-cat="${c}" aria-pressed="${c === wCat}">${CAT_NAME[c] || c}</button>`).join("")}</div></div>
  <div class="table-wrap"><table class="wtable"><thead><tr>
    <th data-k="name" scope="col">Weapon</th><th data-k="cost" scope="col">Cost</th><th data-k="fireRate" scope="col">Fire rate</th><th data-k="mag" scope="col">Mag</th>
    <th data-k="d0" scope="col">Close</th><th data-k="d1" scope="col">Mid</th><th data-k="d2" scope="col">Long</th><th data-k="wall" scope="col">Wall pen</th><th data-k="skins" scope="col">Skins</th>
  </tr></thead><tbody id="wbody"></tbody></table></div>
  <p class="dim" style="font-size:.8rem">Swipe the table sideways on your phone. Fire rate is rounds per second.</p>`, "Weapons");
  const val = (w, k) => k === "name" ? w.name : k === "cost" ? (w.cost ?? -1) : k === "fireRate" ? (w.stats?.fireRate ?? -1) : k === "mag" ? (w.stats?.mag ?? -1)
    : k.startsWith("d") ? (w.stats?.ranges?.[+k[1]]?.headDamage ?? -1) : k === "wall" ? (w.stats?.wall || "") : k === "skins" ? w.skins.length : CAT_ORDER.indexOf(w.cat) * 10000 + (w.cost ?? 0);
  const draw = () => {
    const list = D().weapons.filter((w) => w.cat !== "Melee" && (wCat === "All" || w.cat === wCat))
      .sort((a, b) => { const x = val(a, wSort.key), y = val(b, wSort.key); return (x > y ? 1 : x < y ? -1 : 0) * wSort.dir; });
    $("#wbody").innerHTML = list.map((w) => `<tr>
      <td><a href="#/weapons/${w.slug}"><img src="${esc(w.icon)}" alt="" loading="lazy">${esc(w.name)}</a></td>
      <td>${w.cost ? "¤ " + w.cost : "Free"}</td><td>${w.stats ? +w.stats.fireRate.toFixed(2) : "—"}</td><td>${w.stats ? w.stats.mag : "—"}</td>
      ${dmgCell(w, 0)}${dmgCell(w, 1)}${dmgCell(w, 2)}<td>${esc(w.stats?.wall || "—")}</td><td>${w.skins.length}</td></tr>`).join("");
    $$(".wtable th").forEach((th) => th.setAttribute("aria-sort", th.dataset.k === wSort.key ? (wSort.dir > 0 ? "ascending" : "descending") : "none"));
  };
  draw();
  $$(".wtable th").forEach((th) => th.addEventListener("click", () => { const k = th.dataset.k; wSort = { key: k, dir: wSort.key === k ? -wSort.dir : (k === "name" || k === "wall" ? 1 : -1) }; draw(); }));
  $$("[data-cat]").forEach((b) => b.addEventListener("click", () => { wCat = b.dataset.cat; $$("[data-cat]").forEach((x) => x.setAttribute("aria-pressed", x === b)); draw(); }));
}
let skinTier = "All", skinQ = "", skinLimit = 48;
function weaponDetail(key) {
  ensureLiveWeapons();
  const w = D().weapons.find((x) => x.slug === key);
  if (!w) return notFound();
  const st = w.stats;
  const tiers = D().contentTiers || {};
  const tierList = Object.entries(tiers).sort((a, b) => a[1].rank - b[1].rank);
  render(`
  <a class="back" href="#/weapons">All weapons</a>
  <section class="weapon-hero">
    <div class="gun"><img src="${esc(w.shop || w.icon)}" alt="${esc(w.name)}"></div>
    <div><p class="eyebrow">${esc(CAT_NAME[w.cat] || w.cat)}</p><h1>${esc(w.name)}</h1>
      ${st ? `<div class="kv">
        <div class="stat"><b>${w.cost ? "¤" + w.cost : "Free"}</b><span>Cost</span></div>
        <div class="stat"><b>${+st.fireRate.toFixed(2)}</b><span>Rounds / sec</span></div>
        <div class="stat"><b>${st.mag}</b><span>Magazine</span></div>
        <div class="stat"><b>${st.reload}s</b><span>Reload</span></div>
        <div class="stat"><b>${st.equip}s</b><span>Equip</span></div>
        <div class="stat"><b>${esc(st.wall)}</b><span>Wall pen</span></div>
      </div>` : `<p class="muted">Melee: no stats.</p>`}
    </div>
  </section>
  ${st?.ranges?.length ? `<h2>Damage by range</h2><div class="ranges">${st.ranges.map((r) => `<div class="range"><div><span>Range</span><b style="font-size:1rem">${r.rangeStartMeters}–${r.rangeEndMeters}m</b></div>
    <div><span>Head</span><b style="color:var(--red)">${+r.headDamage.toFixed(1)}</b></div><div><span>Body</span><b>${+r.bodyDamage.toFixed(1)}</b></div><div><span>Legs</span><b>${+r.legDamage.toFixed(1)}</b></div></div>`).join("")}</div>
    ${st.pellets > 1 ? `<p class="muted" style="font-size:.9rem">Per pellet; ${st.pellets} pellets per shot.</p>` : ""}` : ""}
  <div class="section-title"><h2>Skins <span class="muted" style="font-size:1rem" id="skinCount"></span></h2></div>
  <div class="toolbar">
    <input class="search" id="skinSearch" type="search" placeholder="Search skins" value="${esc(skinQ)}" aria-label="Search skins">
    <div class="chips" role="group" aria-label="Skin tier"><button class="chip" data-tier="All" aria-pressed="${skinTier === "All"}">All</button>${tierList.map(([u, t]) => `<button class="chip" data-tier="${u}" aria-pressed="${skinTier === u}"><img src="${esc(t.icon)}" alt="">${esc(t.name)}</button>`).join("")}</div>
  </div>
  <div class="skin-grid" id="skins"></div>
  <div style="text-align:center;margin-top:14px"><button class="btn" id="moreSkins" hidden>Show more</button></div>`, w.name);
  const draw = () => {
    const ww = D().weapons.find((x) => x.slug === key) || w;
    const q = skinQ.toLowerCase();
    const list = ww.skins.filter((s) => (skinTier === "All" || s.t === skinTier) && (!q || s.n.toLowerCase().includes(q)));
    $("#skinCount").textContent = `(${list.length})`;
    $("#skins").innerHTML = list.slice(0, skinLimit).map((s) => { const t = tiers[s.t];
      return `<div class="skin" style="--tier:${t ? hex(t.color) : "var(--line)"}"><div class="im"><img src="${esc(s.i)}" alt="" loading="lazy"></div><b>${esc(s.n)}</b>${t ? `<small><img src="${esc(t.icon)}" alt="">${esc(t.name)}</small>` : ""}</div>`; }).join("") || `<div class="empty">No skins match.</div>`;
    $("#moreSkins").hidden = list.length <= skinLimit;
  };
  skinLimit = 48; draw();
  $("#skinSearch").addEventListener("input", (e) => { skinQ = e.target.value; skinLimit = 48; draw(); });
  $$("[data-tier]").forEach((b) => b.addEventListener("click", () => { skinTier = b.dataset.tier; skinLimit = 48; $$("[data-tier]").forEach((x) => x.setAttribute("aria-pressed", x === b)); draw(); }));
  $("#moreSkins").addEventListener("click", () => { skinLimit += 48; draw(); });
}

/* ---------------- comp builder ---------------- */
let compRole = "All";
function compHints(team, map) {
  const counts = Object.fromEntries(ROLE_ORDER.map((r) => [r, 0]));
  team.forEach((a) => { if (a?.role) counts[a.role.name]++; });
  const n = team.filter(Boolean).length;
  const hints = [];
  if (n === 0) return { counts, hints: [{ t: "Pick a map, then tap agents to fill the five slots.", c: "" }] };
  if (!counts.Controller) hints.push({ t: "No Controller: nobody can smoke off sightlines. Add one (Omen, Brimstone, Astra…).", c: "bad" });
  if (!counts.Initiator) hints.push({ t: "No Initiator: no recon, flashes or stuns to help your team take space.", c: "bad" });
  if (!counts.Sentinel) hints.push({ t: "No Sentinel: flanks and retakes are wide open. A Sentinel locks down a site.", c: "" });
  if (!counts.Duelist) hints.push({ t: "No Duelist: someone has to entry. A Duelist makes taking sites easier.", c: "" });
  if (counts.Duelist > 2) hints.push({ t: `${counts.Duelist} Duelists is a lot of entry and not much utility.`, c: "" });
  if (counts.Controller > 2) hints.push({ t: `${counts.Controller} Controllers: plenty of smokes, light on info and entry.`, c: "" });
  if (counts.Sentinel > 2) hints.push({ t: `${counts.Sentinel} Sentinels: strong on defence, slow on attack.`, c: "" });
  if (map && /C/.test(map.sites || "") && counts.Sentinel === 0) hints.push({ t: `${map.name} has three sites: a Sentinel or a second Initiator helps cover rotations.`, c: "" });
  if (n === 5 && ROLE_ORDER.every((r) => counts[r] > 0) && counts.Duelist <= 2) hints.unshift({ t: "Balanced: every role is covered.", c: "ok" });
  if (n < 5) hints.push({ t: `${5 - n} slot${5 - n > 1 ? "s" : ""} left.`, c: "" });
  return { counts, hints };
}
function comp(_, q) {
  const d = D();
  const std = d.maps.filter((m) => m.mode === "standard");
  const state = { map: std.find((m) => m.slug === q.get("m"))?.slug || null, team: [] };
  for (const s of (q.get("a") || "").split(",").filter(Boolean)) { const a = agentBy(s); if (a && !state.team.includes(a) && state.team.length < 5) state.team.push(a); }
  render(`
  <div class="page-head"><div><p class="eyebrow">Strategy</p><h1>Comp builder</h1></div><p>Pick a map and five agents. Role hints update as you go, and the link saves your comp.</p></div>
  <div class="comp-layout">
    <div>
      <h3>Map</h3>
      <div class="map-select" role="group" aria-label="Map">${std.map((m) => `<button class="mapopt" data-map="${m.slug}" aria-pressed="${state.map === m.slug}" style="background-image:url('${esc(m.list)}')"><span>${esc(m.name)}</span></button>`).join("")}</div>
      <h3 style="margin-top:14px">Agents</h3>
      <div class="chips" role="group" aria-label="Filter by role" style="margin-bottom:10px">${["All", ...ROLE_ORDER].map((r) => `<button class="chip" data-crole="${r}" aria-pressed="${r === compRole}">${r !== "All" ? `<img src="${esc(roleIcon(r))}" alt="">` : ""}${r}</button>`).join("")}</div>
      <div class="pool" id="pool"></div>
    </div>
    <aside class="comp-side panel">
      <div id="compMapName" class="eyebrow">No map</div>
      <div class="comp-slots" id="slots"></div>
      <div class="balance" id="balance"></div>
      <ul class="hints" id="hints"></ul>
      <div class="comp-actions">
        <button class="btn primary" id="shareComp">Share</button>
        <button class="btn" id="saveComp">Save</button>
        <button class="btn" id="clearComp">Clear</button>
      </div>
      <div class="saved" id="saved"></div>
    </aside>
  </div>`, "Comp builder");
  const url = () => {
    const p = new URLSearchParams();
    if (state.map) p.set("m", state.map);
    if (state.team.length) p.set("a", state.team.map((a) => a.slug).join(","));
    return `#/comp${p.toString() ? "?" + p.toString().replace(/%2C/g, ",") : ""}`;
  };
  const sync = () => history.replaceState(null, "", location.pathname + location.search + url());
  const draw = () => {
    const map = std.find((m) => m.slug === state.map);
    $("#compMapName").textContent = map ? `${map.name} · ${map.sites}` : "Pick a map";
    $("#slots").innerHTML = [0, 1, 2, 3, 4].map((i) => { const a = state.team[i];
      return a ? `<button class="slot filled" data-rm="${i}" aria-label="Remove ${esc(a.name)}"><img class="rl" src="${esc(a.role?.icon)}" alt=""><img class="ic" src="${esc(a.icon)}" alt=""><span class="x">✕</span><span class="nm">${esc(a.name)}</span></button>`
        : `<div class="slot" aria-label="Empty slot">${i + 1}</div>`; }).join("");
    const { counts, hints } = compHints(state.team, map);
    $("#balance").innerHTML = ROLE_ORDER.map((r) => `<div class="bal ${counts[r] ? "" : "zero"}"><img src="${esc(roleIcon(r))}" alt=""><b>${counts[r]}</b><span>${r}</span></div>`).join("");
    $("#hints").innerHTML = hints.map((h) => `<li class="${h.c}">${esc(h.t)}</li>`).join("");
    $("#pool").innerHTML = d.agents.filter((a) => compRole === "All" || a.role?.name === compRole).map((a) =>
      `<button class="pick" data-add="${a.slug}" aria-pressed="${state.team.includes(a)}" aria-label="${esc(a.name)}, ${esc(a.role?.name)}"><img src="${esc(a.icon)}" alt="" loading="lazy">${esc(a.name)}</button>`).join("");
    $$("[data-map]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.map === state.map));
    drawSaved();
  };
  const drawSaved = () => {
    const saved = ls.get("shv.comps", []);
    $("#saved").innerHTML = saved.length ? `<h3 style="margin:8px 0 0;font-size:.95rem">Saved comps</h3>` + saved.map((c, i) => {
      const m = std.find((x) => x.slug === c.m);
      return `<div class="saved-row"><a href="${esc(c.url)}">${c.a.map((s) => { const a = agentBy(s); return a ? `<img src="${esc(a.icon)}" alt="${esc(a.name)}">` : ""; }).join("")}<span>${esc(m ? m.name : "Any map")}</span></a><button data-del="${i}" aria-label="Delete saved comp">✕</button></div>`; }).join("") : "";
    $$("[data-del]").forEach((b) => b.addEventListener("click", () => { const s = ls.get("shv.comps", []); s.splice(+b.dataset.del, 1); ls.set("shv.comps", s); drawSaved(); }));
  };
  main.addEventListener("click", function handler(e) {
    if (!$("#pool")) return main.removeEventListener("click", handler);
    const add = e.target.closest("[data-add]"), rm = e.target.closest("[data-rm]"), mp = e.target.closest("[data-map]"), cr = e.target.closest("[data-crole]");
    if (add) { const a = agentBy(add.dataset.add); const i = state.team.indexOf(a);
      if (i >= 0) state.team.splice(i, 1); else if (state.team.length < 5) state.team.push(a); else toast("Team is full. Remove someone first.");
      draw(); sync(); }
    else if (rm) { state.team.splice(+rm.dataset.rm, 1); draw(); sync(); }
    else if (mp) { state.map = state.map === mp.dataset.map ? null : mp.dataset.map; draw(); sync(); }
    else if (cr) { compRole = cr.dataset.crole; $$("[data-crole]").forEach((x) => x.setAttribute("aria-pressed", x === cr)); draw(); }
  });
  $("#shareComp").addEventListener("click", () => { sync(); share(location.href, "My Valorant comp · SH VALO TRACKER"); });
  $("#saveComp").addEventListener("click", () => {
    if (!state.team.length) return toast("Add some agents first");
    const s = ls.get("shv.comps", []); s.unshift({ m: state.map, a: state.team.map((a) => a.slug), url: url() }); ls.set("shv.comps", s.slice(0, 20));
    drawSaved(); toast("Comp saved");
  });
  $("#clearComp").addEventListener("click", () => { state.team = []; draw(); sync(); });
  draw();
}

/* ---------------- crosshairs ---------------- */
let xhLight = false;
function crosshairs() {
  const custom = ls.get("shv.xh", []);
  const all = [...custom.map((c) => ({ ...c, mine: true })), ...LIBRARY];
  render(`
  <div class="page-head"><div><p class="eyebrow">Aim</p><h1>Crosshairs</h1></div><p>Previews are drawn from each code at 3× zoom. In Valorant: Settings → Crosshair → Import profile code.</p></div>
  <section class="xh-try panel">
    <div><label for="xhInput" class="eyebrow">Preview any code</label>
      <textarea id="xhInput" placeholder="Paste a crosshair code, e.g. 0;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0" spellcheck="false"></textarea>
      <div class="comp-actions" style="margin-top:8px"><button class="btn small primary" id="xhSave">Save to my list</button><button class="btn small" id="xhCopy">Copy</button><span id="xhState" class="muted" style="font-size:.85rem;align-self:center"></span></div></div>
    <canvas id="xhTry" aria-label="Crosshair preview"></canvas>
  </section>
  <div class="toolbar"><div class="bgtoggle chips" role="group" aria-label="Preview background"><button class="chip" data-bg="dark" aria-pressed="${!xhLight}">Dark wall</button><button class="chip" data-bg="light" aria-pressed="${xhLight}">Bright wall</button></div></div>
  <div class="xh-grid">${all.map((c, i) => `
    <article class="xh"><canvas class="${xhLight ? "light" : ""}" data-code="${esc(c.code)}" aria-label="Preview of ${esc(c.name)}"></canvas>
      <div class="bd"><h3>${esc(c.name)} ${c.mine ? `<span class="pill">Mine</span>` : `<small class="muted" style="font-size:.75rem;font-family:var(--body);text-transform:none">${esc(c.style)}</small>`}</h3>
      ${c.note ? `<p>${esc(c.note)}</p>` : ""}<code>${esc(c.code)}</code>
      <div class="acts"><button class="btn small primary" data-copy="${esc(c.code)}">Copy code</button>${c.mine ? `<button class="btn small" data-delxh="${i}">Remove</button>` : ""}</div></div></article>`).join("")}</div>`, "Crosshairs");
  const drawAll = () => $$(".xh canvas").forEach((cv) => drawCrosshair(cv, cv.dataset.code));
  requestAnimationFrame(drawAll);
  const inp = $("#xhInput"), tryCv = $("#xhTry");
  const drawTry = () => { const code = inp.value.trim() || "0"; const s = drawCrosshair(tryCv, code, { scale: 4 });
    $("#xhState").textContent = inp.value.trim() ? (s.valid ? "Looks valid" : "Can't read that code") : ""; };
  requestAnimationFrame(drawTry);
  inp.addEventListener("input", drawTry);
  $("#xhCopy").addEventListener("click", () => inp.value.trim() && copy(inp.value.trim(), "Code copied"));
  $("#xhSave").addEventListener("click", () => {
    const code = inp.value.trim(); if (!code || !parseCode(code).valid) return toast("Paste a valid code first");
    const s = ls.get("shv.xh", []); s.unshift({ name: "My crosshair " + (s.length + 1), code, note: "" }); ls.set("shv.xh", s.slice(0, 30)); crosshairs(); toast("Saved");
  });
  $$("[data-copy]").forEach((b) => b.addEventListener("click", () => copy(b.dataset.copy, "Code copied. Import it in Valorant")));
  $$("[data-delxh]").forEach((b) => b.addEventListener("click", () => { const s = ls.get("shv.xh", []); s.splice(+b.dataset.delxh, 1); ls.set("shv.xh", s); crosshairs(); }));
  $$("[data-bg]").forEach((b) => b.addEventListener("click", () => { xhLight = b.dataset.bg === "light"; $$("[data-bg]").forEach((x) => x.setAttribute("aria-pressed", x === b)); $$(".xh canvas").forEach((c) => c.classList.toggle("light", xhLight)); }));
  clearTimeout(crosshairs._r);
  window.onresize = () => { clearTimeout(crosshairs._r); crosshairs._r = setTimeout(() => { if ($("#xhTry")) { drawAll(); drawTry(); } }, 150); };
}

/* ---------------- ranks ---------------- */
function ranks() {
  const t = D().tiers.list.filter((x) => x.tier > 0);
  const divs = [];
  for (const x of t) { let g = divs.find((d) => d.div === x.div); if (!g) divs.push(g = { div: x.div, list: [] }); g.list.push(x); }
  render(`
  <div class="page-head"><div><p class="eyebrow">Competitive</p><h1>Rank tiers</h1></div><p>Every competitive rank from Iron 1 to Radiant. Each tier has three divisions until Radiant.</p></div>
  ${divs.map((g) => `<section class="rank-div"><h3>${esc(g.div)} <i></i></h3><div class="rank-row">${g.list.map((x) => `
    <div class="rank ${g.list.length === 1 ? "solo" : ""}" style="--rc:${hex(x.color)}"><img src="${esc(x.icon)}" alt="" loading="lazy"><b>${esc(x.name)}</b></div>`).join("")}</div></section>`).join("")}`, "Ranks");
}

/* ---------------- more ---------------- */
function more() {
  render(`
  <div class="page-head"><div><p class="eyebrow">Menu</p><h1>More</h1></div></div>
  <div class="more-list">
    <a href="#/comp"><span>Comp builder<small>Five agents, role hints, share link</small></span></a>
    <a href="#/crosshairs"><span>Crosshairs<small>Preview and copy codes</small></span></a>
    <a href="#/ranks"><span>Rank tiers<small>Iron to Radiant</small></span></a>
    <a href="downloads/SH-VALO-TRACKER.apk" download><span>Android app (APK)<small>Download and install SH VALO TRACKER, 1.2 MB</small></span></a>
    <button id="moreInstall" ${deferredPrompt ? "" : "hidden"}><span>Install app<small>Add SH VALO TRACKER to your home screen</small></span></button>
  </div>
  <div class="panel" style="margin-top:16px">
    <h3>Install on your phone</h3>
    <p class="ios-note"><b>Android:</b> download the APK above and allow "Install unknown apps" when asked, or in Chrome tap ⋮ → Install app.<br><b>iPhone (Safari):</b> tap Share → Add to Home Screen.</p>
    <p class="ios-note" style="margin-bottom:0">Once installed it opens full screen and works offline with the last data it loaded.</p>
  </div>`, "More");
  $("#moreInstall")?.addEventListener("click", doInstall);
}
function notFound() { render(`<div class="empty"><h2>Not found</h2><p>That page doesn't exist.</p><a class="btn primary" href="#/">Go home</a></div>`, "Not found"); }

/* ---------------- install + service worker ---------------- */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; $("#installBtn").hidden = false; const mi = $("#moreInstall"); if (mi) mi.hidden = false; });
window.addEventListener("appinstalled", () => { deferredPrompt = null; $("#installBtn").hidden = true; toast("Installed"); });
async function doInstall() { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice.catch(() => {}); deferredPrompt = null; $("#installBtn").hidden = true; }
$("#installBtn").addEventListener("click", doInstall);
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW registration failed", e)));
}

/* ---------------- boot ---------------- */
loadData().then(() => { $("#dataSource").textContent = "offline snapshot"; route(); }).catch((e) => {
  main.innerHTML = `<div class="empty"><h2>Couldn't load game data</h2><p>${esc(e.message || e)}</p><button class="btn primary" onclick="location.reload()">Retry</button></div>`;
});
