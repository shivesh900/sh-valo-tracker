// Valorant crosshair code parser + canvas renderer.
// Codes look like "0;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0". Sections: P = primary, A = ADS, S = sniper.
const COLORS = ["#ffffff", "#00ff00", "#7fff00", "#dfff00", "#ffff00", "#00ffff", "#ff00ff", "#ff0000"];
const DEFAULTS = {
  c: 0, u: "FFFFFFFF", h: 1, t: 1, o: 0.5, d: 0, z: 2, a: 1,
  "0b": 1, "0t": 2, "0l": 6, "0v": 6, "0g": 0, "0o": 3, "0a": 0.8,
  "1b": 1, "1t": 2, "1l": 2, "1v": 2, "1g": 0, "1o": 10, "1a": 0.35,
};

export function parseCode(code) {
  const parts = String(code || "").trim().split(";").map((s) => s.trim());
  const primary = {};
  let section = null;
  let ok = parts.length > 0 && parts[0] !== "";
  for (let i = 1; i < parts.length; i++) {
    const k = parts[i];
    if (k === "P" || k === "A" || k === "S") { section = k; continue; }
    if (k === "" ) continue;
    const v = parts[i + 1];
    i++;
    if (v === undefined) { ok = false; break; }
    if (section === "P") primary[k] = v;
  }
  const s = { ...DEFAULTS };
  for (const [k, v] of Object.entries(primary)) s[k] = k === "u" ? v : Number(v);
  if (!s["0g"]) s["0v"] = s["0l"];
  if (!s["1g"]) s["1v"] = s["1l"];
  if (primary["0l"] !== undefined && primary["0v"] === undefined) s["0v"] = s["0l"];
  if (primary["1l"] !== undefined && primary["1v"] === undefined) s["1v"] = s["1l"];
  s.color = s.c === 8 ? "#" + String(s.u).slice(0, 6) : (COLORS[s.c] || COLORS[0]);
  s.valid = ok && /^\d/.test(parts[0] || "");
  return s;
}

function rect(ctx, x, y, w, h, color, alpha) {
  ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
}

export function drawCrosshair(canvas, code, { scale = 3, background = null } = {}) {
  const s = typeof code === "string" ? parseCode(code) : code;
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const w = canvas.clientWidth || 300, h = canvas.clientHeight || 170;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  const k = scale * dpr;
  const cx = Math.round(canvas.width / 2), cy = Math.round(canvas.height / 2);
  const ot = s.h ? s.t * k : 0;
  const shapes = [];
  const line = (len, vlen, thick, off, alpha) => {
    if (len <= 0 && vlen <= 0) return;
    const T = thick * k, O = off * k, L = len * k, V = vlen * k;
    if (L > 0) {
      shapes.push([cx + O, cy - T / 2, L, T, alpha]);           // right
      shapes.push([cx - O - L, cy - T / 2, L, T, alpha]);       // left
    }
    if (V > 0) {
      shapes.push([cx - T / 2, cy - O - V, T, V, alpha]);       // top
      shapes.push([cx - T / 2, cy + O, T, V, alpha]);           // bottom
    }
  };
  if (s["1b"] && s["1t"] > 0) line(s["1l"], s["1v"], s["1t"], s["1o"], s["1a"]);
  if (s["0b"] && s["0t"] > 0) line(s["0l"], s["0v"], s["0t"], s["0o"], s["0a"]);
  if (s.d && s.z > 0) { const Z = s.z * k; shapes.push([cx - Z / 2, cy - Z / 2, Z, Z, s.a]); }
  if (ot) for (const [x, y, ww, hh, al] of shapes) rect(ctx, x - ot, y - ot, ww + 2 * ot, hh + 2 * ot, "#000", s.o * Math.min(1, al + 0.2));
  for (const [x, y, ww, hh, al] of shapes) rect(ctx, x, y, ww, hh, s.color, al);
  ctx.globalAlpha = 1;
  return s;
}

export const LIBRARY = [
  { name: "Cyan Mini Cross", style: "Pro-style", note: "Small, no outlines, inner lines only. The classic look a lot of pros run.", code: "0;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0" },
  { name: "Green Dot", style: "Pro-style", note: "Just a dot. Clean for Operator and Sheriff players who track heads.", code: "0;P;c;1;h;0;d;1;z;3;a;1;0b;0;1b;0" },
  { name: "White Outlined Tight", style: "Pro-style", note: "Thin white lines with a black outline so it stays visible on bright walls.", code: "0;P;h;1;t;1;o;1;0t;1;0l;3;0o;2;0a;1;0f;0;1b;0" },
  { name: "Yellow Plus", style: "Pro-style", note: "Chunky yellow plus with a 1px gap. Easy to see on every map.", code: "0;P;c;4;h;0;0t;2;0l;5;0o;1;0a;1;0f;0;1b;0" },
  { name: "Pink Gap Dot", style: "Pro-style", note: "Dot in the middle with a wide gap. Good for spray control.", code: "0;P;c;6;h;0;d;1;z;2;0t;1;0l;3;0o;4;0a;1;0f;0;1b;0" },
  { name: "SH Red", style: "Custom", note: "Valorant red (#FF4655) with a soft outline. Made for this app.", code: "0;P;c;8;u;FF4655FF;h;1;o;0.6;0t;2;0l;4;0o;3;0a;1;0f;0;1b;0" },
  { name: "Default", style: "Game default", note: "Valorant's default crosshair, with inner and outer lines.", code: "0" },
];
