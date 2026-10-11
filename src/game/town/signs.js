// One DynamicTexture atlas holds every hand-painted sign in town (shop
// boards, street names, the clock face...), so all signs render in a single
// draw call. Each painter returns a uv rect [u0, v0, u1, v1] for Frame.quad().
import { DynamicTexture, Texture } from "@babylonjs/core";

const FONT_FAMILY = "Fredoka, 'Arial Rounded MT Bold', Arial, sans-serif";
const font = (px, weight = 700) => `${weight} ${Math.round(px)}px ${FONT_FAMILY}`;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ------------------------------------------------------------------ icons --
// Tiny vector icons drawn around (0,0) in a 100x100 box.
const ICONS = {
  bread(ctx) {
    ctx.fillStyle = "#e0a050";
    ctx.beginPath();
    ctx.ellipse(0, 6, 44, 26, 0, Math.PI, 0);
    ctx.lineTo(44, 22);
    ctx.lineTo(-44, 22);
    ctx.fill();
    ctx.strokeStyle = "#a8662a";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    for (const x of [-20, 0, 20]) {
      ctx.beginPath();
      ctx.moveTo(x - 8, -8);
      ctx.lineTo(x + 8, 6);
      ctx.stroke();
    }
  },
  cup(ctx) {
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, -30, -10, 50, 46, 10);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(24, 10, 13, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    for (const x of [-16, 0]) {
      ctx.beginPath();
      ctx.moveTo(x, -18);
      ctx.bezierCurveTo(x - 10, -28, x + 10, -36, x, -46);
      ctx.stroke();
    }
  },
  bear(ctx) {
    ctx.fillStyle = "#c98a4b";
    for (const x of [-26, 26]) {
      ctx.beginPath();
      ctx.arc(x, -26, 15, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 4, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f3d2a2";
    ctx.beginPath();
    ctx.ellipse(0, 18, 18, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3b2414";
    for (const x of [-13, 13]) {
      ctx.beginPath();
      ctx.arc(x, -4, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 13, 6, 0, Math.PI * 2);
    ctx.fill();
  },
  book(ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.quadraticCurveTo(-24, -32, -46, -24);
    ctx.lineTo(-46, 26);
    ctx.quadraticCurveTo(-24, 18, 0, 30);
    ctx.quadraticCurveTo(24, 18, 46, 26);
    ctx.lineTo(46, -24);
    ctx.quadraticCurveTo(24, -32, 0, -20);
    ctx.fill();
    ctx.strokeStyle = "#9aa3b0";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(0, 30);
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-38, -10 + i * 10);
      ctx.lineTo(-8, -6 + i * 10);
      ctx.moveTo(38, -10 + i * 10);
      ctx.lineTo(8, -6 + i * 10);
      ctx.stroke();
    }
  },
  flower(ctx) {
    ctx.fillStyle = "#ff6b9d";
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(Math.sin(a) * 22, -Math.cos(a) * 22, 17, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ffd93d";
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();
  },
  cone(ctx) {
    ctx.fillStyle = "#e8b06a";
    ctx.beginPath();
    ctx.moveTo(-24, -2);
    ctx.lineTo(24, -2);
    ctx.lineTo(0, 46);
    ctx.fill();
    ctx.fillStyle = "#ffd1e8";
    ctx.beginPath();
    ctx.arc(0, -16, 25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ff3b5c";
    ctx.beginPath();
    ctx.arc(4, -42, 8, 0, Math.PI * 2);
    ctx.fill();
  },
  letter(ctx) {
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, -40, -26, 80, 52, 6);
    ctx.fill();
    ctx.strokeStyle = "#e05d5d";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-38, -22);
    ctx.lineTo(0, 6);
    ctx.lineTo(38, -22);
    ctx.stroke();
  },
  apple(ctx) {
    ctx.fillStyle = "#ff5d5d";
    ctx.beginPath();
    ctx.arc(-12, 6, 26, 0, Math.PI * 2);
    ctx.arc(12, 6, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#6bcb77";
    ctx.beginPath();
    ctx.ellipse(12, -28, 14, 7, -0.5, 0, Math.PI * 2);
    ctx.fill();
  },
  star(ctx) {
    ctx.fillStyle = "#ffd93d";
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 18 : 42;
      const a = (i / 10) * Math.PI * 2;
      ctx.lineTo(Math.sin(a) * r, -Math.cos(a) * r);
    }
    ctx.fill();
  },
  leaf(ctx) {
    ctx.fillStyle = "#e8743b";
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 16 : 40;
      const a = (i / 10) * Math.PI * 2 + 0.1;
      ctx.lineTo(Math.sin(a) * r, -Math.cos(a) * r + 2);
    }
    ctx.fill();
    ctx.strokeStyle = "#8b5a2b";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.lineTo(0, 44);
    ctx.stroke();
  },
  basket(ctx) {
    ctx.fillStyle = "#c8a26b";
    ctx.beginPath();
    ctx.moveTo(-40, -4);
    ctx.lineTo(40, -4);
    ctx.lineTo(30, 34);
    ctx.lineTo(-30, 34);
    ctx.fill();
    ctx.strokeStyle = "#c8a26b";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(0, -4, 28, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = "#ff5d5d";
    ctx.beginPath();
    ctx.arc(-14, -8, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffd93d";
    ctx.beginPath();
    ctx.arc(10, -10, 11, 0, Math.PI * 2);
    ctx.fill();
  },
  bus(ctx) {
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, -34, -34, 68, 60, 12);
    ctx.fill();
    ctx.fillStyle = "#4d96ff";
    roundRect(ctx, -26, -26, 52, 22, 4);
    ctx.fill();
    ctx.fillStyle = "#1d2b3a";
    for (const x of [-20, 20]) {
      ctx.beginPath();
      ctx.arc(x, 30, 9, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

/**
 * @param {import("@babylonjs/core").Scene} scene
 * @param {number} size atlas size in px (2048 on desktop, 1024 on low)
 */
export function createSignAtlas(scene, size = 2048) {
  const tex = new DynamicTexture("town_signAtlas", { width: size, height: size }, scene, true);
  tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  const ctx = tex.getContext();
  const k = size / 2048; // all layout below is authored at 2048
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);

  // simple shelf packer (slot sizes below are chosen so 2 boards / 4 street
  // blades fit per 2048 px row including padding)
  let px = 0;
  let py = 0;
  let rowH = 0;
  const pad = 4 * k;
  let overflowWarned = false;
  function alloc(w, h) {
    w *= k;
    h *= k;
    if (px + w > size + 0.5) {
      px = 0;
      py += rowH + pad;
      rowH = 0;
    }
    const r = { x: px, y: py, w, h };
    px += w + pad;
    rowH = Math.max(rowH, h);
    if (py + h > size && !overflowWarned) {
      overflowWarned = true;
      console.warn("[town] sign atlas overflow — some signs will be blank");
    }
    return r;
  }
  // identical requests (e.g. the same street name) share one atlas slot
  const cache = new Map();
  const cached = (key, fn) => {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key);
  };
  // half-texel inset avoids bleeding between neighbours under mipmapping
  const uvOf = (r) => {
    const i = 2;
    return [(r.x + i) / size, 1 - (r.y + r.h - i) / size, (r.x + r.w - i) / size, 1 - (r.y + i) / size];
  };

  function fitText(text, maxW, maxPx, weight = 700) {
    let px2 = maxPx;
    ctx.font = font(px2, weight);
    const w = ctx.measureText(text).width;
    if (w > maxW) px2 = Math.max(10, (px2 * maxW) / w);
    return px2;
  }

  function drawIcon(name, cx, cy, s) {
    const fn = ICONS[name];
    if (!fn) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s / 100, s / 100);
    fn(ctx);
    ctx.restore();
  }

  /**
   * Shop board: coloured panel, cream inner border, bold rounded lettering
   * with a soft shadow, icons either side. Aspect 4:1.
   */
  function shopSign(text, opts = {}) {
    return cached(`shop|${text}|${JSON.stringify(opts)}`, () => paintBoard(text, opts));
  }
  function paintBoard(text, { bg = "#4d96ff", fg = "#ffffff", border = "#fff4dc", icon = null, w = 1018, h = 240 } = {}) {
    const r = alloc(w, h);
    const { x, y } = r;
    const W = r.w;
    const H = r.h;
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, W, H);
    ctx.strokeStyle = border;
    ctx.lineWidth = 12 * k;
    roundRect(ctx, x + 16 * k, y + 16 * k, W - 32 * k, H - 32 * k, 26 * k);
    ctx.stroke();
    const iconS = H * 0.52;
    const textW = W - (icon ? iconS * 2.6 : 0) - 80 * k;
    const fpx = fitText(text, textW, H * 0.5);
    ctx.font = font(fpx);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillText(text, x + W / 2 + 5 * k, y + H / 2 + 9 * k);
    ctx.fillStyle = fg;
    ctx.fillText(text, x + W / 2, y + H / 2 + 4 * k);
    if (icon) {
      drawIcon(icon, x + iconS * 0.95, y + H / 2, iconS);
      drawIcon(icon, x + W - iconS * 0.95, y + H / 2, iconS);
    }
    return uvOf(r);
  }

  /** Green street-name blade. */
  function streetSign(text) {
    return cached(`street|${text}`, () => paintStreet(text));
  }
  function paintStreet(text) {
    const r = alloc(506, 126);
    ctx.fillStyle = "#2e8b57";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 6 * k;
    roundRect(ctx, r.x + 8 * k, r.y + 8 * k, r.w - 16 * k, r.h - 16 * k, 12 * k);
    ctx.stroke();
    const fpx = fitText(text, r.w - 60 * k, r.h * 0.55);
    ctx.font = font(fpx);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2 + 3 * k);
    return uvOf(r);
  }

  /** Round icon badge (bus stop etc.), square slot. */
  function badge(icon, bg) {
    return cached(`badge|${icon}|${bg}`, () => paintBadge(icon, bg));
  }
  function paintBadge(icon, bg) {
    const r = alloc(160, 160);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(r.x + r.w / 2, r.y + r.h / 2, r.w * 0.46, 0, Math.PI * 2);
    ctx.fill();
    drawIcon(icon, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.62);
    return uvOf(r);
  }

  /** Clock face (square slot, circle inscribed). */
  function clockFace() {
    return cached("clock", paintClock);
  }
  function paintClock() {
    const r = alloc(252, 252);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const R = r.w / 2;
    ctx.fillStyle = "#3c4a63";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = "#fffaf0";
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.94, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#d4a017";
    ctx.lineWidth = R * 0.06;
    ctx.stroke();
    ctx.fillStyle = "#2b2b35";
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const big = i % 3 === 0;
      ctx.save();
      ctx.translate(cx + Math.sin(a) * R * 0.76, cy - Math.cos(a) * R * 0.76);
      ctx.rotate(a);
      ctx.fillRect(-R * (big ? 0.035 : 0.02), -R * (big ? 0.1 : 0.06), R * (big ? 0.07 : 0.04), R * (big ? 0.2 : 0.12));
      ctx.restore();
    }
    return uvOf(r);
  }

  /** Big banner for arches and the water tower. */
  function banner(text, { bg = "#e05d5d", fg = "#ffffff", w = 1018, h = 190, icon = null } = {}) {
    return shopSign(text, { bg, fg, w: Math.min(w, 1018), h, icon });
  }

  return {
    texture: tex,
    shopSign,
    streetSign,
    badge,
    clockFace,
    banner,
    /** Upload the painted canvas. Call once after every sign is painted. */
    finish() {
      tex.update(true);
    },
  };
}
