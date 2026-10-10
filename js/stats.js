// Player lookup. Two interchangeable sources normalised to one shape:
//   dak.gg (keyless, browser-direct) and HenrikDev (key held by a proxy).
import { CONFIG } from "./config.js";

export function statsSource() {
  const s = CONFIG.STATS_SOURCE;
  if (s === "off") return null;
  if (s === "henrik" || (s === "auto" && CONFIG.HENRIK_PROXY)) return CONFIG.HENRIK_PROXY ? "henrik" : null;
  return CONFIG.DAKGG_API ? "dakgg" : null;
}
export const statsEnabled = () => !!statsSource();

export function parseRiotId(s) {
  const m = String(s || "").trim().match(/^(.{2,16})#([^\s#]{2,5})$/u);
  return m ? { name: m[1].trim(), tag: m[2].trim() } : null;
}

export class StatsError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
const enc = encodeURIComponent;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, ms = 15000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: "application/json" } });
    let j = null; try { j = await r.json(); } catch {}
    if (!r.ok) {
      const e = j && (j.error || (j.errors && j.errors[0]));
      throw new StatsError((e && (e.message || e.details)) || "HTTP " + r.status, r.status);
    }
    return j;
  } catch (e) {
    if (e.name === "AbortError") throw new StatsError("The stats service took too long to answer.", 0);
    if (e instanceof StatsError) throw e;
    throw new StatsError("Couldn't reach the stats service. Check your connection.", 0);
  } finally { clearTimeout(t); }
}

function aggregate(matches) {
  const agg = { kills: 0, deaths: 0, assists: 0, hs: 0, shots: 0, wins: 0, decided: 0, score: 0, rounds: 0 };
  for (const m of matches) {
    agg.kills += m.kills; agg.deaths += m.deaths; agg.assists += m.assists; agg.hs += m.headshots; agg.shots += m.shots;
    if (m.won === true || m.won === false) { agg.decided++; if (m.won) agg.wins++; }
    if (m.rounds) { agg.score += m.score; agg.rounds += m.rounds; }
  }
  return {
    label: `Last ${matches.length} matches`, games: matches.length,
    kd: agg.deaths ? agg.kills / agg.deaths : (agg.kills || null),
    hs: agg.shots ? (100 * agg.hs) / agg.shots : null,
    win: agg.decided ? (100 * agg.wins) / agg.decided : null,
    acs: agg.rounds ? agg.score / agg.rounds : null,
  };
}
function agentsFromMatches(matches) {
  const agents = {};
  for (const m of matches) {
    const a = agents[m.agentId || m.agent] || (agents[m.agentId || m.agent] = { name: m.agent, id: m.agentId, games: 0, wins: 0, kills: 0, deaths: 0 });
    a.games++; if (m.won === true) a.wins++; a.kills += m.kills; a.deaths += m.deaths;
  }
  return Object.values(agents).sort((a, b) => b.games - a.games || b.kills - a.kills).slice(0, 4);
}

/* ---------------- dak.gg (keyless) ---------------- */
async function dakAccount(name, tag) {
  const base = CONFIG.DAKGG_API.replace(/\/+$/, "");
  const url = `${base}/accounts/${enc(name)}-${enc(tag)}`;
  try { return (await getJSON(url)).account; }
  catch (e) {
    if (e.status !== 404) throw e;
    // Not indexed yet: ask dak.gg to sync this Riot ID, then poll.
    for (let i = 0; i < 8; i++) {
      let j;
      try { j = await getJSON(`${base}/rpc/account-sync/by-riot-id/${enc(name)}/${enc(tag)}`); }
      catch (e2) { if (e2.status === 404) throw new StatsError("Player not found", 404); throw e2; }
      if (j && j.puuid) break;
      await sleep(Math.min(3000, (j && j.retryAfter) || 1200));
    }
    try { return (await getJSON(url)).account; }
    catch (e3) { if (e3.status === 404) throw new StatsError("Player not found", 404); throw e3; }
  }
}
/* ---------------- Acts + per-act rank tables ----------------
   Rank tier ids changed when Ascendant arrived (E5 A1): before it, 21-23 were
   Immortal and 24 Radiant. Every act therefore maps its tier id through the
   competitive-tier table that was live for that act (data/acts.json, built from
   valorant-api.com seasons + seasons/competitive + competitivetiers). Acts that
   start after the bundle was built are read live from valorant-api.com. */
let actsPromise = null;
const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9 };
function epLabel(name) {
  const m = String(name || "").match(/EPISODE\s+(\d+)/i); if (m) return "E" + m[1];
  const v = String(name || "").match(/^(V\d+)/i); return v ? v[1].toUpperCase() : String(name || "");
}
async function liveActs(bundle) {
  const V = "https://valorant-api.com/v1/";
  const [s, sc] = await Promise.all([getJSON(V + "seasons", 8000), getJSON(V + "seasons/competitive", 8000)]);
  const by = Object.fromEntries((s.data || []).map((x) => [x.uuid, x]));
  const tiersOf = Object.fromEntries((sc.data || []).map((x) => [x.seasonUuid, x.competitiveTiersUuid]));
  const acts = [];
  for (const x of s.data || []) {
    if (x.type !== "EAresSeasonType::Act") continue;
    const p = by[x.parentUuid]; if (!p || /beta/i.test(p.displayName || "")) continue;
    const n = String(x.displayName || "").split(/\s+/).pop().toUpperCase();
    acts.push({ id: x.uuid, ep: epLabel(p.displayName), act: "A" + (ROMAN[n] || n), start: x.startTime, end: x.endTime, tiers: tiersOf[x.uuid] || tiersOf[x.parentUuid] });
  }
  const tables = { ...bundle.tables };
  for (const id of new Set(acts.map((a) => a.tiers).filter((t) => t && !tables[t]))) {
    const t = (await getJSON(V + "competitivetiers/" + id, 8000)).data;
    const list = {};
    for (const x of t.tiers || []) if (x.tier > 2 && !/unused/i.test(x.tierName)) list[x.tier] = { n: cap(x.tierName), i: x.largeIcon || x.smallIcon };
    tables[id] = { legacy: !(t.tiers || []).some((x) => /ascendant/i.test(x.tierName)), list };
  }
  return { acts, tables };
}
const cap = (s) => String(s || "").toLowerCase().replace(/(^|\s)(\w)/g, (m, p, c) => p + c.toUpperCase());
export function loadActs() {
  if (actsPromise) return actsPromise;
  actsPromise = (async () => {
    let bundle = { acts: [], tables: {} };
    try { const r = await fetch(new URL("../data/acts.json", import.meta.url)); if (r.ok) bundle = await r.json(); } catch {}
    const now = Date.now();
    const covers = (d) => d.acts.some((a) => Date.parse(a.start) <= now && now < Date.parse(a.end));
    if (!covers(bundle)) { try { const live = await liveActs(bundle); if (live.acts.length) bundle = live; } catch {} }
    return bundle;
  })();
  return actsPromise;
}
export function currentAct(meta, now = Date.now()) {
  return meta.acts.find((a) => Date.parse(a.start) <= now && now < Date.parse(a.end)) || null;
}
const actName = (a) => a ? `${a.ep} ${a.act}` : "";
const actYear = (a) => a ? new Date(a.start).getUTCFullYear() : "";
// Resolve a tier id in the table that was valid for that act. `rank` is comparable across tables.
export function tierFor(meta, act, tierId) {
  const t = act && meta.tables[act.tiers]; const id = Number(tierId);
  if (!t || !(id > 2)) return null;
  const e = t.list[id]; if (!e) return null;
  return { tierId: id, name: e.n, icon: e.i, rank: t.legacy && id >= 21 ? id + 3 : id };
}

async function dakLookup(name, tag, region) {
  const base = CONFIG.DAKGG_API.replace(/\/+$/, "");
  const [acc, meta] = await Promise.all([dakAccount(name, tag), loadActs()]);
  if (!acc || !acc.puuid) throw new StatsError("Player not found", 404);
  const pu = enc(acc.puuid);
  const [seasonsR, matchesR] = await Promise.allSettled([
    getJSON(`${base}/accounts/${pu}/seasons`),
    getJSON(`${base}/accounts/${pu}/matches?page=1`),
  ]);
  const seasons = seasonsR.status === "fulfilled" ? (seasonsR.value.seasons || []) : [];
  const perSeason = await Promise.allSettled(seasons.map((s) => getJSON(`${base}/accounts/${pu}/seasons/${enc(s.season)}`)));
  const actById = Object.fromEntries(meta.acts.map((a) => [a.id, a]));
  const fallbackAct = (s) => ({ id: s.season, ep: String(s.episode || "").replace(/^episode/i, "E").toUpperCase(), act: String(s.act || "").replace(/^act/i, "A").toUpperCase(), start: null, end: null, tiers: null });
  // One row per act we can see, newest first, matched to valorant-api acts by season uuid.
  const rows = perSeason.map((r, i) => {
    const s = seasons[i]; const act = actById[s.season] || fallbackAct(s);
    const c = r.status === "fulfilled" ? r.value?.stats?.competitive : null;
    const games = c ? c.wins + c.losses + (c.draws || 0) : 0;
    return { act, c, games, tier: c ? tierFor(meta, act, c.competitiveTierId) : null };
  }).sort((a, b) => (Date.parse(b.act.start) || 0) - (Date.parse(a.act.start) || 0));
  const nowAct = currentAct(meta);
  const curRow = nowAct ? rows.find((x) => x.act.id === nowAct.id) : null;
  const ranked = rows.filter((x) => x.tier);
  const lastRow = ranked.find((x) => x !== curRow) || null;
  let peakRow = null;
  for (const x of ranked) if (!peakRow || x.tier.rank > peakRow.tier.rank) peakRow = x;
  const label = (x) => x ? `${actName(x.act)}${x.act.start ? ` (${actYear(x.act)})` : ""}` : "";
  const mmr = {
    currentAct: nowAct ? actName(nowAct) : "",
    current: curRow && curRow.tier ? { ...curRow.tier, rr: curRow.c.rankedRating != null && curRow.c.rankedRating !== "" ? Number(curRow.c.rankedRating) : null } : null,
    unrankedThisAct: !(curRow && curRow.tier),
    playedThisAct: curRow ? curRow.games : 0,
    last: lastRow && !(curRow && curRow.tier) ? { ...lastRow.tier, act: label(lastRow) } : null,
    peak: peakRow ? { ...peakRow.tier, act: label(peakRow) } : null,
    actsSeen: rows.length,
  };
  const rawMatches = matchesR.status === "fulfilled" ? (matchesR.value.matches || []) : [];
  const totalMatches = matchesR.status === "fulfilled" ? Number(matchesR.value.meta?.totalCount ?? rawMatches.length) : null;
  const matches = rawMatches.slice(0, CONFIG.MATCH_COUNT).map((m) => {
    const st = m.stat || {}; const me = m.player || {};
    const mine = (m.teams || []).find((t) => t.teamId === me.teamId);
    const other = (m.teams || []).find((t) => t !== mine);
    const shots = (st.headshots || 0) + (st.bodyshots || 0) + (st.legshots || 0);
    let won = mine ? mine.won : null;
    if (mine && other && !mine.won && !other.won && m.teams.length === 2) won = "draw";
    return {
      id: m.matchInfo?.matchId, map: m.matchInfo?.mapName || "", mapCode: m.matchInfo?.mapCode,
      mode: m.matchInfo?.queueId || "", started: m.matchInfo?.gameStartMillis || null,
      agent: st.characterName || me.characterName || "", agentId: st.character || me.characterId,
      kills: st.kills || 0, deaths: st.deaths || 0, assists: st.assists || 0, score: st.score || 0,
      headshots: st.headshots || 0, shots, rounds: st.roundsPlayed || null,
      won: (m.teams || []).length === 2 ? won : null,
      myRounds: mine && other && m.teams.length === 2 ? mine.roundsWon : null, theirRounds: mine && other && m.teams.length === 2 ? other.roundsWon : null,
    };
  });
  // Performance: this act's competitive stats if he played it; else his recent matches;
  // else the newest act we can see, clearly labelled as old.
  const statRow = curRow && curRow.games > 0 ? curRow : null;
  const oldRow = rows.find((x) => x.games > 0) || null;
  const fromAct = (x, stale) => {
    const c = x.c; const shots = c.headshots + c.bodyshots + c.legshots;
    return {
      summary: { label: stale ? `From ${label(x)} · not this act · ${x.games} games` : `Competitive · ${actName(x.act)} (this act) · ${x.games} games`, stale, games: x.games,
        kd: c.deaths ? c.kills / c.deaths : c.kills, hs: shots ? 100 * c.headshots / shots : null,
        win: x.games ? 100 * c.wins / x.games : null, acs: c.roundsPlayed ? c.score / c.roundsPlayed : null },
      topAgents: (c.characters || []).slice().sort((a, b) => b.roundsPlayed - a.roundsPlayed).slice(0, 4).map((y) => ({
        id: y.characterId, name: "", games: y.wins + y.losses + (y.draws || 0), wins: y.wins, kills: y.kills, deaths: y.deaths })),
      topLabel: stale ? `From ${label(x)}` : `This act`,
    };
  };
  let perf;
  if (statRow) perf = fromAct(statRow, false);
  else if (matches.length) perf = { summary: aggregate(matches), topAgents: agentsFromMatches(matches), topLabel: `Last ${matches.length} matches` };
  else if (oldRow) perf = fromAct(oldRow, true);
  else perf = { summary: { label: "No games we can see", stale: true }, topAgents: [], topLabel: "" };
  const limited = (matchesR.status === "rejected" || totalMatches === 0 || (acc.isPrivate && !curRow))
    ? "Limited data: this profile's match history is private or not synced. Stats may be incomplete." : null;
  return {
    source: "dak.gg",
    account: { name: acc.gameName, tag: acc.tagLine, region: acc.activeShard, level: acc.accountLevel,
      cardImage: acc.playerCard && acc.playerCard.imageUrl, card: null, title: acc.playerTitle && acc.playerTitle.name },
    region: acc.activeShard || region, mmr, matches, summary: perf.summary, topAgents: perf.topAgents, topLabel: perf.topLabel, limited,
    matchError: matchesR.status === "rejected" ? matchesR.reason.message : null,
    mmrError: seasonsR.status === "rejected" ? seasonsR.reason.message : null,
  };
}

/* ---------------- HenrikDev via proxy ---------------- */
async function henrikLookup(name, tag, region) {
  const base = CONFIG.HENRIK_PROXY.replace(/\/+$/, "");
  const acc = (await getJSON(`${base}/valorant/v2/account/${enc(name)}/${enc(tag)}`)).data || {};
  const reg = region || acc.region || CONFIG.DEFAULT_REGION;
  const [mmrR, matchR] = await Promise.allSettled([
    getJSON(`${base}/valorant/v3/mmr/${enc(reg)}/pc/${enc(name)}/${enc(tag)}`),
    getJSON(`${base}/valorant/v4/matches/${enc(reg)}/pc/${enc(name)}/${enc(tag)}?size=${CONFIG.MATCH_COUNT}`),
  ]);
  const d = mmrR.status === "fulfilled" ? mmrR.value.data : null;
  const mmr = d && d.current ? {
    currentAct: d.current?.season?.short || "",
    current: d.current.tier?.id > 2 ? { tierId: d.current.tier.id, name: d.current.tier.name, rr: d.current.rr, change: d.current.last_change } : null,
    unrankedThisAct: !(d.current.tier?.id > 2), last: null,
    peak: d.peak?.tier?.id > 2 ? { tierId: d.peak.tier.id, name: d.peak.tier.name, act: d.peak.season?.short || "" } : null,
  } : null;
  const raw = matchR.status === "fulfilled" ? (matchR.value.data || []) : [];
  const matches = raw.map((m) => {
    const me = (m.players || []).find((p) => p.puuid === acc.puuid) || (m.players || []).find((p) => `${p.name}#${p.tag}`.toLowerCase() === `${name}#${tag}`.toLowerCase());
    if (!me) return null;
    const st = me.stats || {}; const shots = (st.headshots || 0) + (st.bodyshots || 0) + (st.legshots || 0);
    const mine = (m.teams || []).find((t) => t.team_id === me.team_id);
    return { id: m.metadata?.match_id, map: m.metadata?.map?.name || "", mode: m.metadata?.queue?.name || "", started: m.metadata?.started_at ? Date.parse(m.metadata.started_at) : null,
      agent: me.agent?.name || "", agentId: me.agent?.id, kills: st.kills || 0, deaths: st.deaths || 0, assists: st.assists || 0, score: st.score || 0,
      headshots: st.headshots || 0, shots, rounds: mine?.rounds ? mine.rounds.won + mine.rounds.lost : null,
      won: mine ? mine.won : null, myRounds: mine?.rounds?.won ?? null, theirRounds: mine?.rounds?.lost ?? null };
  }).filter(Boolean);
  return { source: "HenrikDev", account: { name: acc.name, tag: acc.tag, region: acc.region, level: acc.account_level, card: acc.card, title: acc.title },
    region: reg, mmr, matches, summary: aggregate(matches), topAgents: agentsFromMatches(matches),
    mmrError: mmrR.status === "rejected" ? mmrR.reason.message : null, matchError: matchR.status === "rejected" ? matchR.reason.message : null };
}

export function lookup(name, tag, region) {
  const src = statsSource();
  if (src === "henrik") return henrikLookup(name, tag, region);
  return dakLookup(name, tag, region);
}
