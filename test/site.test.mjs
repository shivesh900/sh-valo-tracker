import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(SITE, p), "utf8");

test("index has title, viewport, manifest, disclaimer", () => {
  const h = read("index.html");
  assert.match(h, /<title>SH VALO TRACKER/);
  assert.match(h, /name="viewport" content="width=device-width/);
  assert.match(h, /rel="manifest" href="manifest.webmanifest"/);
  assert.match(h, /not endorsed by Riot Games/);
  for (const m of h.matchAll(/(?:src|href)="([^"#:]+)"/g)) assert.ok(existsSync(join(SITE, m[1].split("?")[0])), "missing " + m[1]);
});
test("manifest is installable", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.equal(m.name, "SH VALO TRACKER"); assert.equal(m.short_name, "SH VALO");
  assert.equal(m.display, "standalone"); assert.ok(m.start_url && m.scope);
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes("192x192") && sizes.includes("512x512"));
  assert.ok(m.icons.some((i) => i.purpose === "maskable"));
  for (const i of m.icons) assert.ok(existsSync(join(SITE, i.src)), i.src);
});
test("service worker precaches files that exist", () => {
  const sw = read("sw.js");
  const list = [...sw.matchAll(/"\.\/([^"]*)"/g)].map((x) => x[1]).filter(Boolean);
  assert.ok(list.length > 10);
  for (const f of list) assert.ok(existsSync(join(SITE, f)), "precache missing " + f);
});
test("snapshot has core data", () => {
  const s = JSON.parse(read("data/snapshot.json"));
  assert.ok(s.agents.length >= 25 && s.agents.every((a) => a.abilities.length >= 4));
  assert.ok(s.maps.filter((m) => m.mode === "standard").length >= 10);
  assert.ok(s.weapons.length >= 18 && s.tiers.list.length >= 25);
});
test("no API keys or placeholders shipped", () => {
  for (const f of ["js/app.js", "js/config.js", "js/stats.js", "js/data.js", "index.html"]) {
    const t = read(f);
    assert.doesNotMatch(t, /HDEV-[0-9a-f-]{20,}/i);
    assert.doesNotMatch(t, /lorem ipsum|TODO/i);
  }
});
