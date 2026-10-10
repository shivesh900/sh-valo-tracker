// Game data: bundled snapshot first (instant, offline), then live valorant-api.com.
const API = "https://valorant-api.com/v1/";
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const store = { data: null, source: "snapshot", weaponsLive: false, listeners: new Set() };

async function fetchJSON(url, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

export function normAgents(list) {
  return list.slice().sort((a, b) => a.displayName.localeCompare(b.displayName)).map((a) => ({
    uuid: a.uuid, name: a.displayName, slug: slug(a.displayName), desc: a.description,
    icon: a.displayIcon, portrait: a.fullPortrait || a.bustPortrait, bg: a.background,
    colors: a.backgroundGradientColors, killfeed: a.killfeedPortrait,
    role: a.role ? { name: a.role.displayName, icon: a.role.displayIcon, desc: a.role.description } : null,
    abilities: (a.abilities || []).map((x) => ({ slot: x.slot, name: x.displayName, desc: x.description, icon: x.displayIcon })),
  }));
}
export function normMaps(list) {
  const out = [];
  for (const x of list) {
    if (!x.displayIcon && !x.tacticalDescription) continue;
    const mode = x.tacticalDescription ? "standard" : (String(x.mapUrl).includes("HURM") ? "tdm" : "other");
    out.push({
      uuid: x.uuid, name: x.displayName, slug: slug(x.displayName), mode, sites: x.tacticalDescription, coords: x.coordinates,
      splash: x.splash, list: x.listViewIcon, tall: x.listViewIconTall, minimap: x.displayIcon, premier: x.premierBackgroundImage,
      xm: x.xMultiplier, ym: x.yMultiplier, xs: x.xScalarToAdd, ys: x.yScalarToAdd,
      callouts: (x.callouts || []).map((c) => ({ n: c.regionName, r: c.superRegionName, x: c.location.x, y: c.location.y })),
    });
  }
  return out.sort((a, b) => (a.mode !== "standard") - (b.mode !== "standard") || a.name.localeCompare(b.name));
}
export function normWeapons(list) {
  return list.map((w) => {
    const ws = w.weaponStats, sd = w.shopData;
    const skins = [];
    for (const s of w.skins || []) {
      if (s.displayName.includes("Standard") || s.displayName.startsWith("Random Favorite")) continue;
      const icon = s.displayIcon || (s.chromas && s.chromas[0] && s.chromas[0].fullRender) || (s.levels && s.levels[0] && s.levels[0].displayIcon);
      if (!icon) continue;
      skins.push({ n: s.displayName, i: icon, t: s.contentTierUuid });
    }
    skins.sort((a, b) => a.n.localeCompare(b.n));
    return {
      uuid: w.uuid, name: w.displayName, slug: slug(w.displayName), cat: String(w.category).split("::")[1], icon: w.displayIcon,
      shop: sd && sd.newImage, cost: sd ? sd.cost : null,
      stats: ws ? { fireRate: ws.fireRate, mag: ws.magazineSize, reload: ws.reloadTimeSeconds, equip: ws.equipTimeSeconds, run: ws.runSpeedMultiplier,
        fba: ws.firstBulletAccuracy, pellets: ws.shotgunPelletCount, wall: String(ws.wallPenetration || "").split("::").pop(), ads: ws.adsStats, ranges: ws.damageRanges } : null,
      skins,
    };
  });
}
function normTiers(list) {
  const t = list[list.length - 1];
  return { uuid: t.uuid, name: t.assetObjectName, list: t.tiers.filter((x) => !String(x.tierName).startsWith("Unused")).map((x) => ({
    tier: x.tier, name: x.tierName, div: x.divisionName, color: x.color, bg: x.backgroundColor, icon: x.largeIcon, small: x.smallIcon })) };
}

function emit() { for (const fn of store.listeners) fn(); }
export const onData = (fn) => store.listeners.add(fn);

export async function loadData() {
  const snap = await fetchJSON("data/snapshot.json", 15000);
  store.data = snap;
  store.source = "snapshot";
  refreshLive(); // fire and forget
  return snap;
}

async function refreshLive() {
  if (!navigator.onLine) return;
  try {
    const [ag, mp, tr] = await Promise.all([
      fetchJSON(API + "agents?isPlayableCharacter=true"),
      fetchJSON(API + "maps"),
      fetchJSON(API + "competitivetiers"),
    ]);
    const d = { ...store.data };
    if (ag && ag.data && ag.data.length) d.agents = normAgents(ag.data);
    if (mp && mp.data && mp.data.length) d.maps = normMaps(mp.data);
    if (tr && tr.data && tr.data.length) d.tiers = normTiers(tr.data);
    store.data = d;
    store.source = "live";
    emit();
  } catch (e) {
    console.info("[data] live refresh unavailable, using bundled snapshot:", e.message || e);
  }
}

// Weapons payload is large (skins), so fetch it live only when the weapons pages open.
let weaponsPromise = null;
export function ensureLiveWeapons() {
  if (store.weaponsLive || weaponsPromise || !navigator.onLine) return weaponsPromise;
  weaponsPromise = fetchJSON(API + "weapons", 15000).then((j) => {
    if (j && j.data && j.data.length) {
      store.data = { ...store.data, weapons: normWeapons(j.data) };
      store.weaponsLive = true;
      emit();
    }
  }).catch((e) => console.info("[data] live weapons unavailable, using snapshot:", e.message || e));
  return weaponsPromise;
}

export const cardArt = (uuid, kind = "wideart") => uuid ? `https://media.valorant-api.com/playercards/${uuid}/${kind}.png` : "";
