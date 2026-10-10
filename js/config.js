// SH VALO TRACKER configuration.
// ---------------------------------------------------------------------------
// Player stats sources
//  - "dakgg":  keyless. Calls dak.gg's public stats backend straight from the
//              browser (CORS open, no key). Undocumented, so it can change.
//  - "henrik": the HenrikDev unofficial Valorant API. It needs an API key,
//              and a key must NEVER sit in this public repo. Deploy the tiny
//              proxy in /proxy (Cloudflare Worker), store the key there as a
//              secret, and put the worker URL in HENRIK_PROXY.
// STATS_SOURCE "auto" uses HenrikDev when HENRIK_PROXY is set, otherwise dak.gg.
// Set STATS_SOURCE to "off" to show the "stats coming soon" state.
// ---------------------------------------------------------------------------
export const CONFIG = {
  STATS_SOURCE: "auto",
  DAKGG_API: "https://val.dakgg.io/api/v1",
  HENRIK_PROXY: "", // e.g. "https://sh-valo-proxy.yourname.workers.dev"
  DEFAULT_REGION: "ap",
  REGIONS: [
    ["ap", "Asia Pacific"],
    ["eu", "Europe"],
    ["na", "North America"],
    ["kr", "Korea"],
    ["latam", "LATAM"],
    ["br", "Brazil"],
  ],
  MATCH_COUNT: 10,
};
