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
async function dakLookup(name, tag, region) {
  const base = CONFIG.DAKGG_API.replace(/\/+$/, "");
  const acc = await dakAccount(name, tag);
  if (!acc || !acc.puuid) throw new StatsError("Player not found", 404);
  const pu = enc(acc.puuid);
  const [seasonsR, matchesR] = await Promise.allSettled([
    getJSON(`${base}/accounts/${pu}/seasons`),
    getJSON(`${base}/accounts/${pu}/matches?page=1`),
  ]);
  const seasons = seasonsR.status === "fulfilled" ? (seasonsR.value.seasons || []) : [];
  const perSeason = await Promise.allSettled(seasons.map((s) => getJSON(`${base}/accounts/${pu}/seasons/${enc(s.season)}`)));
  const comp = perSeason.map((r, i) => ({ season: seasons[i], c: r.status === "fulfilled" ? r.value?.stats?.competitive : null }));
  const actLabel = (s) => s ? `${String(s.episode || "").toUpperCase()} ${String(s.act || "").replace(/act/i, "Act ")}`.trim() : "";
  const newest = comp[0];
  const withGames = comp.filter((x) => x.c && (x.c.wins + x.c.losses + (x.c.draws || 0)) > 0);
  const cur = withGames[0];
  let peak = null;
  for (const x of comp) if (x.c && x.c.competitiveTierId > 2 && (!peak || x.c.competitiveTierId > peak.c.competitiveTierId)) peak = x;
  const mmr = {
    tier: newest && newest.c ? newest.c.competitiveTierId : 0,
    rr: newest && newest.c && newest.c.competitiveTierId ? Number(newest.c.rankedRating) : null,
    change: null,
    act: actLabel(newest && newest.season),
    peakTier: peak ? peak.c.competitiveTierId : null,
    peakSeason: peak ? actLabel(peak.season) : null,
    peakNote: seasons.length ? `across ${seasons.length} acts` : "",
  };
  const rawMatches = matchesR.status === "fulfilled" ? (matchesR.value.matches || []) : [];
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
  let summary, topAgents;
  if (cur) {
    const c = cur.c; const shots = c.headshots + c.bodyshots + c.legshots; const games = c.wins + c.losses + (c.draws || 0);
    summary = { label: `Competitive · ${actLabel(cur.season)} · ${games} games`, games,
      kd: c.deaths ? c.kills / c.deaths : c.kills, hs: shots ? 100 * c.headshots / shots : null,
      win: games ? 100 * c.wins / games : null, acs: c.roundsPlayed ? c.score / c.roundsPlayed : null };
    topAgents = (c.characters || []).slice().sort((a, b) => b.roundsPlayed - a.roundsPlayed).slice(0, 4).map((x) => ({
      id: x.characterId, name: "", games: x.wins + x.losses + (x.draws || 0), wins: x.wins, kills: x.kills, deaths: x.deaths }));
  } else {
    summary = aggregate(matches); topAgents = agentsFromMatches(matches);
  }
  return {
    source: "dak.gg",
    account: { name: acc.gameName, tag: acc.tagLine, region: acc.activeShard, level: acc.accountLevel,
      cardImage: acc.playerCard && acc.playerCard.imageUrl, card: null, title: acc.playerTitle && acc.playerTitle.name },
    region: acc.activeShard || region, mmr, matches, summary, topAgents,
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
  const mmr = d && d.current ? { tier: d.current.tier?.id, tierName: d.current.tier?.name, rr: d.current.rr, change: d.current.last_change,
    peakTier: d.peak?.tier?.id, peakName: d.peak?.tier?.name, peakSeason: d.peak?.season?.short } : null;
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
