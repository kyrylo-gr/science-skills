/* shapes.js v2 — shapes + animations for narrated explainer scenes (HyperFrames + GSAP 3, core only).
 * One <svg viewBox="0 0 1920 1080"> per scene (1 unit = 1 frame px); built content lives in a camera group <g data-cam>.
 * Geometry is computed, never hand-placed: connectors start/end on shape edges, labels sit beside what they name,
 * and every object carries the data-* attributes check_layout.py measures.
 *
 *   const sc = S.scene("#x-svg"), C = S.cues(0);   // tl: the scene's paused timeline
 *   const a = sc.box({ x: 260, y: 420, w: 340, h: 200, label: "Qubit" }), b = sc.circle({ cx: 1300, cy: 520, r: 130, label: "Cavity" });
 *   const ab = sc.arrow(a, b, { label: "drive" });
 *   A.in(tl, a, C.qubit); A.in(tl, ab, C.drive - 0.6); A.in(tl, b, C.cavity);
 *
 * Rules: deterministic (seeded S.rng, no timers/callbacks), every object starts hidden and is revealed by an A.* call at a cue,
 * every builder returns the DOM element (with .geo), every animation is A.x(tl, target, at, opts) and returns tl.
 */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg", HIDE = "opacity:0";
  const T = { ground: "#0f1117", ink: "#e8eaf0", dim: "#8a90a2", line: "#c9cedb", faint: "rgba(201,206,219,0.16)",
    accent: "#f5b942", blue: "#5aa9ff", green: "#58d68d", red: "#ff6b6b", violet: "#b58cff", teal: "#4fd1c5",
    fill: "rgba(255,255,255,0.04)", font: "Inter", serif: "EB Garamond", mono: "JetBrains Mono" };
  const tone = (t) => T[t] || t || T.line;

  /* ---------- small maths ---------- */
  const r2 = (v) => Math.round(v * 100) / 100, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
  const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]), norm = (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
  const P2 = (p) => r2(p[0]) + "," + r2(p[1]);
  const dpath = (pts, close) => (pts.length ? "M" + pts.map(P2).join(" L") + (close ? " Z" : "") : "");
  const DIRS = { right: [1, 0], left: [-1, 0], top: [0, -1], bottom: [0, 1], "top-right": [1, -1], "top-left": [-1, -1], "bottom-right": [1, 1], "bottom-left": [-1, 1] };
  const dirOf = (w) => (typeof w === "number" ? [Math.cos((w * Math.PI) / 180), -Math.sin((w * Math.PI) / 180)] : norm(DIRS[String(w).split("@")[0]] || [0, -1]));
  /** Seeded PRNG (mulberry32): S.rng(7)() → [0,1). The only randomness allowed in a scene. */
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  /** cumulative arc length of a polyline */
  const cum = (pts) => pts.reduce((c, p, i) => (c.push(i ? c[i - 1] + dist(pts[i - 1], p) : 0), c), []);
  function at(pts, f) { // point + unit tangent at arc fraction f
    const c = cum(pts), L = c[c.length - 1] * f; let i = 1; while (i < c.length - 1 && c[i] < L) i++;
    const u = (L - c[i - 1]) / (c[i] - c[i - 1] || 1), d = norm(sub(pts[i], pts[i - 1]));
    return { p: add(pts[i - 1], mul(sub(pts[i], pts[i - 1]), u)), d };
  }
  function trim(pts, d0, d1) { // shorten a polyline by d0 at the start and d1 at the end (to make room for heads)
    const c = cum(pts), L = c[c.length - 1], out = [];
    const pt = (s) => at(pts, clamp(s / L, 0, 1)).p;
    out.push(pt(d0)); for (let i = 1; i < pts.length - 1; i++) if (c[i] > d0 && c[i] < L - d1) out.push(pts[i]); out.push(pt(L - d1));
    while (out.length < pts.length) out.splice(out.length - 1, 0, out[out.length - 2]); // keep the point count (morphable re-routes)
    return out;
  }
  const longest = (pts) => { let b = 1; for (let i = 2; i < pts.length; i++) if (dist(pts[i - 1], pts[i]) > dist(pts[b - 1], pts[b])) b = i;
    return { p: mul(add(pts[b - 1], pts[b]), 0.5), d: norm(sub(pts[b], pts[b - 1])) }; };
  const strokeFor = (S) => clamp(S * 0.022, 4, 14), headFor = (w, len) => clamp(w * 4, 18, Math.max(18, len * 0.4));
  const dashFor = (L) => { const n = Math.max(1, Math.round(L / 26)), p = 1 / n; // dashes fill pathLength 0..1, then a gap of 1:
    return Array.from({ length: n }, (_, i) => r2(p * 0.58 * 1e4) / 1e4 + " " + (i < n - 1 ? r2(p * 0.42 * 1e4) / 1e4 : 1.5)).join(" "); };
  // → dashoffset 1→0 still reveals tail→tip, so dashed lines draw on like solid ones (and the checker's 1-offset rule holds)

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== false) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  /** stroke-drawable element: pathLength=1, solid "1 1" or dashed pattern, revealed by drawOn */
  function drawable(e, L, dash) { e.setAttribute("pathLength", 1); e.setAttribute("stroke-dasharray", dash ? dashFor(L) : "1 1");
    e.setAttribute("stroke-dashoffset", 0); e.classList.add("draw"); return e; }
  const sk = (col, w, extra) => Object.assign({ fill: "none", stroke: col, "stroke-width": r2(w), "stroke-linecap": "round", "stroke-linejoin": "round", "data-tint": "stroke" }, extra);
  const fillOf = (o) => (o.fill && T[o.fill] ? { fill: T[o.fill], "fill-opacity": 0.16 } : { fill: o.fill || T.fill });
  const textW = (s, size) => String(s).length * size * 0.55;

  function txt(parent, o) {
    const t = el("text", { id: o.id, class: o.cls || "lab", x: r2(o.x), y: r2(o.y), "text-anchor": o.anchor || "middle", "dominant-baseline": "central",
      fill: tone(o.tone || "ink"), "font-family": o.family || (o.italic ? T.serif : T.font), "font-size": r2(o.size || 40),
      "font-weight": o.weight || (o.italic ? 400 : 500), "font-style": o.italic ? "italic" : null, "data-tint": "fill" }, parent);
    t.textContent = o.text;
    return t;
  }
  /** where a text of `size` goes when placed `off` px from point p along outward normal n */
  function place(p, n, off, size) {
    return { x: p[0] + n[0] * off, y: p[1] + n[1] * (off + size * 0.55), anchor: n[0] > 0.35 ? "start" : n[0] < -0.35 ? "end" : "middle" };
  }
  /** Boundary point + outward normal of a geometry. where = side ("top", "left@0.3" = 30 % along), corner ("top-right"),
   *  angle in degrees (0 = right, 90 = up), {toward:[x,y]}, or "center". */
  function anchor(g, where) {
    const c = [g.cx, g.cy];
    if (where === "center" || where === "in") return { p: c, n: [0, 0] };
    const u = where && where.toward ? norm(sub(where.toward, c)) : dirOf(where);
    if (g.kind === "point") return { p: c, n: u };
    if (g.kind === "circle") return { p: add(c, mul(u, g.r)), n: u };
    if (typeof where === "string") {
      const [s, f] = where.split("@"), v = DIRS[s];
      if (v && !(v[0] && v[1])) { const t = f === undefined ? 0.5 : +f; // side, optionally `t` along it
        return { p: v[0] ? [c[0] + (v[0] * g.w) / 2, g.y + t * g.h] : [g.x + t * g.w, c[1] + (v[1] * g.h) / 2], n: v }; }
      if (v) return { p: [c[0] + (v[0] * g.w) / 2, c[1] + (v[1] * g.h) / 2], n: u };
    }
    const t = Math.min(u[0] ? g.w / 2 / Math.abs(u[0]) : Infinity, u[1] ? g.h / 2 / Math.abs(u[1]) : Infinity);
    return { p: add(c, mul(u, t)), n: u };
  }
  const rectGeo = (x, y, w, h) => ({ kind: "rect", x, y, w, h, cx: x + w / 2, cy: y + h / 2 });
  const circGeo = (cx, cy, r) => ({ kind: "circle", cx, cy, r, x: cx - r, y: cy - r, w: 2 * r, h: 2 * r });
  const charSize = (g) => (g.kind === "point" ? 0 : Math.min(g.w, g.h));

  /* ======================================= scene ======================================= */
  function scene(svgSel, opt = {}) {
    const svg = typeof svgSel === "string" ? document.querySelector(svgSel) : svgSel;
    svg.setAttribute("viewBox", "0 0 1920 1080");
    const prefix = opt.prefix || (svg.id || "s").replace(/-?svg$/, "") || "s";
    const defs = el("defs", {}, svg), cam = el("g", { "data-cam": "", id: prefix + "-cam" }, svg);
    cam.st = { x: 0, y: 0, s: 1 }; gsap.set(cam, { svgOrigin: "0 0" });
    const reg = {}, conns = [], count = {};
    const uid = (k) => `${prefix}-${k}${(count[k] = (count[k] || 0) + 1)}`;

    /** normalise id | element | [x,y] | HTML element → {kind: rect|circle|point, x,y,w,h,cx,cy,r,id,el} (current geometry) */
    function geo(ref) {
      if (Array.isArray(ref)) return { kind: "point", cx: ref[0], cy: ref[1], x: ref[0], y: ref[1], w: 0, h: 0 };
      if (typeof ref === "string") ref = reg[ref.replace(/^#/, "")] || document.getElementById(ref.replace(/^#/, ""));
      if (!ref) throw new Error("[shapes] unknown target");
      if (ref.geo) return ref.geo;
      if (ref.kind) return ref;
      if (!(ref instanceof SVGElement)) { // HTML: an equation (term) is measured on an off-screen clone — build inside S.ready()
        const eq = ref.closest(".s-eq");
        if (!ref.id) ref.id = uid("html");
        if (eq) { const b = eqBox(eq), t = ref === eq ? { x: b.x, y: b.y, w: b.w, h: b.h } : b.t[Array.from(eq.children).indexOf(ref)];
          return Object.assign(rectGeo(t.x, t.y, t.w, t.h), { id: ref.id, el: ref, html: true }); }
        const r = ref.getBoundingClientRect(), s = svg.getBoundingClientRect(), k = 1920 / s.width;
        if (!s.width) throw new Error("[shapes] cannot measure HTML while the scene is hidden: use sc.eq terms");
        return Object.assign(rectGeo((r.left - s.left) * k, (r.top - s.top) * k, r.width * k, r.height * k), { id: ref.id, el: ref, html: true });
      }
      const b = ref.getBBox(); return Object.assign(rectGeo(b.x, b.y, b.width, b.height), { id: ref.id, el: ref });
    }

    /** the one shape constructor: <g id data-obj data-shape style=opacity:0>, body drawn by build(), then the label */
    function mk(kind, o, g, build, defAt) {
      const id = o.id || uid(kind);
      const gr = el("g", { id, "data-obj": kind, "data-shape": g.kind === "circle" ? "circle" : "rect", style: HIDE }, o.parent || cam);
      Object.assign(g, { id, el: gr, c0: [g.cx, g.cy], w0: g.w, h0: g.h, r0: g.r, tx: 0, ty: 0, s: 1 });
      gr.geo = g; gr.sc = api; reg[id] = g;
      build(gr, tone(o.tone || "line"));
      label(gr, g, o, defAt);
      for (const k in o.attrs || {}) gr.setAttribute(k, o.attrs[k]);
      gsap.set(gr, { svgOrigin: `${r2(o.origin ? o.origin[0] : g.cx)} ${r2(o.origin ? o.origin[1] : g.cy)}` });
      return gr;
    }
    const body = (tag, attrs, gr) => el(tag, Object.assign({ class: "body", "data-edge": "" }, attrs), gr);
    /** label: o.label + o.at ("in" | side | corner | angle°) + o.size/italic/labelTone; outside labels never touch the body */
    function label(gr, g, o, defAt = "in") {
      if (o.label == null) return;
      const where = o.at || defAt, italic = o.italic, lt = o.labelTone || "ink";
      if (where === "in") {
        const lines = o.sub ? 2 : 1, chars = Math.max(String(o.label).length, 2);
        let size = o.size || clamp((g.kind === "circle" ? g.r * 0.42 : g.h * 0.26) / (lines > 1 ? 1.1 : 1), 30, 64);
        size = Math.max(28, Math.min(size, (0.84 * g.w) / (chars * 0.56)));
        txt(gr, { x: g.cx, y: o.sub ? g.cy - size * 0.38 : g.cy, text: o.label, size, italic, tone: lt });
        if (o.sub) txt(gr, { x: g.cx, y: g.cy + size * 0.72, text: o.sub, size: Math.max(28, size * 0.62), tone: "dim", weight: 400 });
        return;
      }
      const size = o.size || 36, a = anchor(g, where), q = place(a.p, a.n, o.offset ?? 14, size);
      txt(gr, { x: q.x, y: q.y, anchor: q.anchor, text: o.label, size, italic, tone: lt });
    }

    /* ---------- connectors (arrow, link, spring): routed from current geometry, re-routed by sc.move ---------- */
    function ends(c) {
      const o = c.o, A_ = geo(c.a), B_ = geo(c.b);
      let fs = o.fromSide, ts = o.toSide;
      if (o.route === "elbow") { const dx = B_.cx - A_.cx, dy = B_.cy - A_.cy, hz = Math.abs(dx) >= Math.abs(dy);
        fs = fs || (hz ? (dx > 0 ? "right" : "left") : dy > 0 ? "bottom" : "top");
        ts = ts || (hz ? (dy > 0 ? "top" : "bottom") : dx > 0 ? "left" : "right"); }
      const e0 = anchor(A_, fs || { toward: ts ? anchor(B_, ts).p : [B_.cx, B_.cy] });
      const e1 = anchor(B_, ts || { toward: fs ? e0.p : [A_.cx, A_.cy] });
      if (A_.kind === "point" && !fs) e0.n = norm(sub(e1.p, e0.p));
      if (B_.kind === "point" && !ts) e1.n = norm(sub(e0.p, e1.p));
      const gap = o.gap ?? 10;
      return { A_, B_, tail: add(e0.p, mul(e0.n, gap)), tip: add(e1.p, mul(e1.n, gap)), n0: e0.n, n1: e1.n };
    }
    function route(c) {
      const o = c.o, E = ends(c), { tail, tip } = E, len = dist(tail, tip);
      const w = o.stroke || strokeFor(Math.max(charSize(E.A_), charSize(E.B_), 120)), u = norm(sub(tip, tail)), pp = [-u[1], u[0]];
      let pts;
      if (c.kind === "spring") { const n = (o.coils || 8) * 2, lead = len * 0.12, amp = o.amp || 22; pts = [tail, add(tail, mul(u, lead))];
        for (let i = 1; i < n; i++) pts.push(add(add(tail, mul(u, lead + ((len - 2 * lead) * i) / n)), mul(pp, i % 2 ? amp : -amp)));
        pts.push(add(tip, mul(u, -lead)), tip);
        return { tail, tip, len, w, head: 0, d: dpath(pts), heads: [] }; }
      if (o.route === "elbow") {
        const hz0 = Math.abs(E.n0[0]) > Math.abs(E.n0[1]), hz1 = Math.abs(E.n1[0]) > Math.abs(E.n1[1]);
        if (hz0 === hz1) { const m = hz0 ? [(tail[0] + tip[0]) / 2, 0] : [0, (tail[1] + tip[1]) / 2];
          pts = hz0 ? [tail, [m[0], tail[1]], [m[0], tip[1]], tip] : [tail, [tail[0], m[1]], [tip[0], m[1]], tip]; }
        else { const k = hz0 ? [tip[0], tail[1]] : [tail[0], tip[1]]; pts = [tail, k, k, tip]; }
      } else if (o.wave) { const N = 72, lam = len / Math.max(2, Math.round(len / 46));
        pts = Array.from({ length: N + 1 }, (_, i) => { const s = i / N, env = Math.min(1, s / 0.12, (1 - s) / 0.22);
          return add(add(tail, mul(u, s * len)), mul(pp, o.wave * env * Math.sin((2 * Math.PI * s * len) / lam))); });
      } else if (o.bend) { const ctl = add(mul(add(tail, tip), 0.5), mul(pp, o.bend));
        pts = Array.from({ length: 25 }, (_, i) => { const s = i / 24; return add(add(mul(tail, (1 - s) ** 2), mul(ctl, 2 * s * (1 - s))), mul(tip, s * s)); });
      } else pts = [tail, tip];
      const L = cum(pts).pop(), hd = o.head || "end", head = hd === "none" ? 0 : headFor(w, L);
      const shaft = trim(pts, hd === "both" ? head * 0.8 : 0, head * 0.8);
      const hp = (p, d) => { const b = sub(p, mul(d, head)), q = [-d[1], d[0]], wd = head * 0.55; return [p, add(b, mul(q, wd)), sub(b, mul(q, wd))].map(P2).join(" "); };
      const dirEnd = o.wave ? u : norm(sub(tip, at(pts, clamp(1 - head / L, 0, 1)).p));
      const dirStart = o.wave ? mul(u, -1) : norm(sub(tail, at(pts, clamp(head / L, 0, 1)).p));
      const heads = head ? [hp(tip, dirEnd)].concat(hd === "both" ? [hp(tail, dirStart)] : []) : [];
      // label beside the middle, on an absolute side (never flips with direction): above|below|left|right, default away from the bend
      let lab = null;
      if (o.label != null) { const m = o.route === "elbow" ? longest(pts) : at(pts, 0.5), n = [-m.d[1], m.d[0]], want = DIRS[o.labelSide] ||
          (o.bend ? mul(norm(pp), Math.sign(o.bend)) : Math.abs(m.d[0]) >= Math.abs(m.d[1]) ? [0, -1] : [1, 0]);
        const nn = n[0] * want[0] + n[1] * want[1] >= 0 ? n : mul(n, -1), size = o.size || 34;
        lab = place(add(m.p, mul(nn, o.wave || 0)), nn, w / 2 + (o.labelOffset ?? 14), size); lab.size = size; }
      return { tail, tip, len, w, head, d: dpath(shaft), heads, lab };
    }
    function connector(kind, a, b, o) {
      const c = { kind, a, b, o }, R = route(c), id = o.id || uid(kind), A_ = geo(a), B_ = geo(b);
      if (R.len < 48) console.warn(`[shapes] ${id}: only ${R.len.toFixed(0)} px long — move the shapes apart`);
      const gr = el("g", { id, "data-obj": kind, "data-arrow": kind === "spring" ? null : "", style: HIDE,
        "data-from": kind !== "spring" && A_.kind !== "point" ? "#" + A_.id : null, "data-to": kind !== "spring" && B_.kind !== "point" ? "#" + B_.id : null,
        "data-tail": P2(R.tail), "data-tip": P2(R.tip), "data-head": r2(R.head), "data-stroke": r2(R.w), "data-gap": o.gap ?? 10 }, o.parent || cam);
      const col = tone(o.tone || "line");
      c.el = gr; gr.conn = c; gr.sc = api; gr.geo = { kind: "point", cx: R.tip[0], cy: R.tip[1], x: R.tip[0], y: R.tip[1], w: 0, h: 0, id };
      drawable(el("path", sk(col, R.w, { class: "shaft", d: R.d }), gr), R.len, o.dash);
      R.heads.forEach((pts, i) => el("polygon", { class: "head h" + i, points: pts, fill: col, "data-tint": "fill" }, gr));
      if (R.lab) txt(gr, { x: R.lab.x, y: R.lab.y, anchor: R.lab.anchor, text: o.label, size: R.lab.size, tone: o.labelTone || "dim", italic: o.italic });
      conns.push(c); reg[id] = gr.geo;
      return gr;
    }
    /** tween a connector to its route for the current registry geometry (same timing as the move that caused it) */
    function reroute(tl, c, t, tw) {
      const R = route(c), gr = c.el, lab = gr.querySelector(":scope > text");
      tl.to(gr, Object.assign({ attr: { "data-tail": P2(R.tail), "data-tip": P2(R.tip) } }, tw), t);
      tl.to(gr.querySelector(".shaft"), Object.assign({ attr: { d: R.d } }, tw), t);
      gr.querySelectorAll(".head").forEach((h, i) => tl.to(h, Object.assign({ attr: { points: R.heads[i] } }, tw), t));
      if (lab && R.lab) tl.to(lab, Object.assign({ attr: { x: r2(R.lab.x), y: r2(R.lab.y) } }, tw), t);
    }

    const api = {
      svg, cam, defs, reg, geo, anchor: (r, w) => anchor(geo(r), w), id: uid,
      /** Rounded box; label inside (auto-fit), optional sub line. */
      box(o) { return mk("box", o, rectGeo(o.x, o.y, o.w, o.h), (gr, col) =>
        drawable(body("rect", Object.assign(sk(col, o.stroke || 4), { x: o.x, y: o.y, width: o.w, height: o.h, rx: o.r ?? 18, "data-fill": "" }, fillOf(o)), gr), 2 * (o.w + o.h), o.dash)); },
      circle(o) { return mk("circle", o, circGeo(o.cx, o.cy, o.r), (gr, col) =>
        drawable(body("circle", Object.assign(sk(col, o.stroke || 4), { cx: o.cx, cy: o.cy, r: o.r, "data-fill": "" }, fillOf(o)), gr), 2 * Math.PI * o.r, o.dash)); },
      /** Pill = box with fully rounded ends. */
      pill(o) { return api.box(Object.assign({ r: o.h / 2 }, o)); },
      /** Filled dot (tracer, state, particle). glow sits outside .body and is data-overlap-ok, so it never skews edge distances. */
      dot(o) { const r = o.r || 12; return mk("dot", Object.assign({ tone: "accent" }, o), circGeo(o.cx, o.cy, r), (gr, col) => {
        if (o.glow !== false) el("circle", { class: "glow", cx: o.cx, cy: o.cy, r: r * 2.3, fill: col, opacity: 0.2, "data-overlap-ok": "", "data-tint": "fill" }, gr);
        body("circle", { cx: o.cx, cy: o.cy, r, fill: col, "data-tint": "fill" }, gr); }, "right"); },
      /** Free text (registered, so arrows/braces can target it). anchor: start|middle|end. */
      text(o) { const size = o.size || 40, w = textW(o.text, size), x0 = o.x - (o.anchor === "start" ? 0 : o.anchor === "end" ? w : w / 2);
        return mk("text", o, rectGeo(x0, o.y - size * 0.6, w, size * 1.2), (gr) => txt(gr, Object.assign({}, o, { id: null, size, tone: o.tone || "ink" })).setAttribute("data-edge", "")); },
      /** Horizontal level line (energy level, baseline); label to the right by default. */
      level(o) { return mk("level", Object.assign({ tone: "ink", italic: true }, o), rectGeo(o.x, o.y - 3, o.w, 6), (gr, col) =>
        drawable(body("line", sk(col, o.stroke || 6, { x1: o.x, y1: o.y, x2: o.x + o.w, y2: o.y }), gr), o.w, o.dash), "right"); },
      /** Group frame around members (ids/elements/geos): a data-container, label above its top-left corner. */
      frame(members, o = {}) { const gs = members.map(geo), pad = o.pad ?? 36;
        const x0 = Math.min(...gs.map((g) => g.x)) - pad, y0 = Math.min(...gs.map((g) => g.y)) - pad;
        const x1 = Math.max(...gs.map((g) => g.x + g.w)) + pad, y1 = Math.max(...gs.map((g) => g.y + g.h)) + pad;
        const gr = mk("frame", Object.assign({ tone: "dim", attrs: { "data-container": "" } }, o, { label: null }), rectGeo(x0, y0, x1 - x0, y1 - y0), (gr, col) =>
          drawable(body("rect", sk(col, o.stroke || 3, { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 26 }), gr), 2 * (x1 - x0 + y1 - y0), o.dash ?? true));
        if (o.label) txt(gr, { x: x0 + 10, y: y0 - 30, anchor: "start", text: o.label, size: o.size || 32, tone: o.labelTone || "dim" });
        return gr; },
      /** Arrow a→b (shape | id | [x,y] point | HTML term). {fromSide,toSide ("top", "top@0.3", angle°), gap, bend, route:"elbow",
       *  head:"end"|"both"|"none", wave:amp, dash, label, labelSide:"above"|"below"|"left"|"right", tone, stroke} */
      arrow(a, b, o = {}) { return connector(o.head === "none" ? "link" : "arrow", a, b, o); },
      /** Plain (or dashed) connecting line. */
      link(a, b, o = {}) { return connector("link", a, b, Object.assign({}, o, { head: "none" })); },
      /** Spring between two shapes (zig-zag connector); stretches when sc.move moves an end. */
      spring(a, b, o = {}) { return connector("spring", a, b, Object.assign({ gap: 0, tone: "dim" }, o)); },
      /** Callout: text at distance `dist` from the target in direction `at`, joined by a leader line. */
      callout(target, o) { const g = geo(target), a = anchor(g, o.at ?? 45), size = o.size || 34, d = o.dist ?? 110;
        const p0 = add(a.p, mul(a.n, 8)), p1 = add(a.p, mul(a.n, d)), q = place(p1, a.n, 10, size);
        return mk("callout", Object.assign({ tone: "dim", attrs: { "data-overlap-ok": "" } }, o, { label: null }), rectGeo(q.x, q.y, 0, 0), (gr, col) => {
          drawable(el("path", sk(col, 3, { d: dpath([p0, p1]) }), gr), d);
          txt(gr, { x: q.x, y: q.y, anchor: q.anchor, text: o.text, size, tone: o.labelTone || "ink", italic: o.italic }); }); },
      /** Curly brace along a side of a target (or several): label beyond it. */
      brace(target, o = {}) { const gs = [].concat(target).map(geo), side = o.side || "bottom", n = DIRS[side], gap = o.gap ?? 10;
        const x0 = Math.min(...gs.map((g) => g.x)), y0 = Math.min(...gs.map((g) => g.y)), x1 = Math.max(...gs.map((g) => g.x + g.w)), y1 = Math.max(...gs.map((g) => g.y + g.h));
        const hz = !n[0], L = hz ? x1 - x0 : y1 - y0, h = o.depth || clamp(L * 0.08, 16, 30);
        const s0 = side === "bottom" ? [x0, y1 + gap] : side === "top" ? [x0, y0 - gap] : side === "left" ? [x0 - gap, y0] : [x1 + gap, y0];
        const t = hz ? [1, 0] : [0, 1], M = (u, v) => P2(add(add(s0, mul(t, u)), mul(n, v)));
        const d = `M${M(0, 0)} Q${M(0, h / 2)} ${M(h / 2, h / 2)} L${M(L / 2 - h / 2, h / 2)} Q${M(L / 2, h / 2)} ${M(L / 2, h)} Q${M(L / 2, h / 2)} ${M(L / 2 + h / 2, h / 2)} L${M(L - h / 2, h / 2)} Q${M(L, h / 2)} ${M(L, 0)}`;
        const bg = hz ? rectGeo(x0, Math.min(s0[1], s0[1] + n[1] * h), L, h) : rectGeo(Math.min(s0[0], s0[0] + n[0] * h), y0, h, L);
        return mk("brace", Object.assign({ tone: "dim", at: side }, o), bg, (gr, col) => drawable(body("path", sk(col, o.stroke || 4, { d }), gr), L + 2 * h), side); },
      /** Angle mark at vertex q between rays q→p and q→r; right:true draws the square mark. */
      angle(p, q, r, o = {}) { const R = o.radius || 56, a0 = Math.atan2(p[1] - q[1], p[0] - q[0]); let a1 = Math.atan2(r[1] - q[1], r[0] - q[0]);
        let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        const pt = (a, k = R) => [q[0] + k * Math.cos(a), q[1] + k * Math.sin(a)], mid = a0 + da / 2;
        const d = o.right ? dpath([pt(a0, R * 0.6), add(pt(a0, R * 0.6), sub(pt(a0 + da, R * 0.6), q)), pt(a0 + da, R * 0.6)])
          : `M${P2(pt(a0))} A${R},${R} 0 0 ${da > 0 ? 1 : 0} ${P2(pt(a0 + da))}`;
        const gr = mk("angle", Object.assign({ tone: "accent", attrs: { "data-overlap-ok": "" } }, o, { label: null }), circGeo(q[0], q[1], R), (gr, col) =>
          drawable(body("path", sk(col, o.stroke || 4, { d }), gr), R * Math.abs(da) + 1));
        if (o.label) { const lp = pt(mid, R + 14), sz = o.size || 36; const pl = place(lp, [Math.cos(mid), Math.sin(mid)], 4, sz);
          txt(gr, { x: pl.x, y: pl.y, anchor: pl.anchor, text: o.label, size: sz, italic: o.italic ?? true, tone: o.labelTone || "ink" }); }
        return gr; },
      /** Pendulum / rotating rod: pivot (x,y), rod of length len hanging down, bob of radius r. Rotate it with A.rotate. */
      rod(o) { const L = o.len, r = o.r || 34, bob = [o.x, o.y + L + r];
        const gr = mk("rod", Object.assign({ origin: [o.x, o.y] }, o), circGeo(bob[0], bob[1], r), (gr, col) => {
          drawable(el("line", sk(tone("dim"), 5, { x1: o.x, y1: o.y, x2: o.x, y2: o.y + L }), gr), L);
          el("circle", { class: "pop", cx: o.x, cy: o.y, r: 9, fill: tone("dim") }, gr);
          drawable(body("circle", Object.assign(sk(col, 4, { cx: bob[0], cy: bob[1], r, "data-fill": "" }), fillOf(o)), gr), 2 * Math.PI * r); });
        if (o.angle) { gsap.set(gr, { rotation: o.angle }); gr.geo.rot = o.angle; }
        return gr; },
      /** Travelling sine wave in a clip window {x,y,w,amp,lambda}; animate with A.travel. */
      wave(o) { const lam = o.lambda || 240, amp = o.amp || 60, w = o.stroke || 5, id = o.id || uid("wave");
        const clip = el("clipPath", { id: id + "-clip" }, defs); el("rect", { x: o.x, y: o.y - amp - w, width: o.w, height: 2 * (amp + w) }, clip);
        return mk("wave", Object.assign({ tone: "blue" }, o, { id }), rectGeo(o.x, o.y - amp, o.w, 2 * amp), (gr, col) => {
          body("rect", { x: o.x, y: o.y - amp, width: o.w, height: 2 * amp, fill: "none" }, gr);
          const n = Math.ceil(((o.w + lam) / lam) * 32), pts = Array.from({ length: n + 1 }, (_, i) => { const x = o.x - lam + ((o.w + lam) * i) / n;
            return [x, o.y - amp * Math.sin((2 * Math.PI * (x - o.x)) / lam)]; });
          const cg = el("g", { "clip-path": `url(#${id}-clip)` }, gr);
          drawable(el("path", sk(col, w, { class: "carrier", d: dpath(pts) }), cg), cum(pts).pop());
          gr.lambda = lam; }); },
      /** Unit/dot grid: n cells in `cols` columns, the first `filled` in tone; .cells = elements in order. */
      grid(o) { const cols = o.cols || 10, cell = o.cell || 44, rows = Math.ceil(o.n / cols), r = o.r || cell * 0.34;
        const gr = mk("grid", o, rectGeo(o.x, o.y, cols * cell, rows * cell), (gr, col) => {
          body("rect", { x: o.x, y: o.y, width: cols * cell, height: rows * cell, fill: "none" }, gr);
          gr.cells = Array.from({ length: o.n }, (_, i) => el("circle", { class: "cell", cx: o.x + cell * (i % cols + 0.5), cy: o.y + cell * (Math.floor(i / cols) + 0.5), r,
            fill: i < (o.filled || 0) ? tone(o.tone || "accent") : tone("faint"), "data-tint": "fill" }, gr)); });
        return gr; },
      /** Seeded particle swarm in box [x,y,w,h]; A.jitter moves it. */
      swarm(o) { const [x, y, w, h] = o.box, R = rng(o.seed || 1), r = o.r || 8;
        return mk("swarm", Object.assign({ tone: "teal", attrs: { "data-overlap-ok": "" } }, o), rectGeo(x, y, w, h), (gr, col) => {
          body("rect", { x, y, width: w, height: h, fill: "none" }, gr);
          gr.cells = Array.from({ length: o.n }, () => el("circle", { class: "cell", cx: r2(x + r + R() * (w - 2 * r)), cy: r2(y + r + R() * (h - 2 * r)), r, fill: col, "data-tint": "fill" }, gr));
          gr.box = o.box; gr.pr = r; }); },
      /** Number readout: value (tween with A.count) + unit. */
      number(o) { const size = o.size || 48, digits = o.digits ?? 0, s = (+o.value || 0).toFixed(digits) + (o.unit ? " " + o.unit : "");
        const w = textW(s, size), x0 = o.x - (o.anchor === "start" ? 0 : o.anchor === "end" ? w : w / 2);
        const gr = mk("number", o, rectGeo(x0, o.y - size * 0.6, w, size * 1.2), (gr, col) => {
          const t = txt(gr, { x: o.x, y: o.y, anchor: o.anchor, text: "", size, tone: o.tone || "ink", family: T.mono }); t.setAttribute("data-edge", "");
          gr.val = el("tspan", { class: "val" }, t); gr.val.textContent = (+o.value || 0).toFixed(digits);
          if (o.unit) el("tspan", { fill: tone("dim") }, t).textContent = " " + o.unit; });
        gr.value = +o.value || 0; gr.digits = digits; return gr; },

      /* ---------- plotting ---------- */
      /** Axes {x,y,w,h, xr,yr (yr:null → number line), origin:"zero"|"corner", ticks:{x:step|[[v,"s"]..], y:..}, grid, xlabel, ylabel}.
       *  Returns the element with .X(v) .Y(v) .P(x,y) → px. */
      axes(o) {
        const [x0, x1] = o.xr || [0, 1], yr = o.yr === undefined ? [0, 1] : o.yr, oneD = !yr, h = oneD ? 0 : o.h;
        const X = (v) => o.x + ((v - x0) / (x1 - x0)) * o.w, Y = oneD ? () => o.y : (v) => o.y + h - ((v - yr[0]) / (yr[1] - yr[0])) * h;
        const zero = o.origin !== "corner", ax0 = zero ? clamp(0, x0, x1) : x0, ay0 = oneD ? 0 : zero ? clamp(0, yr[0], yr[1]) : yr[0];
        const id = o.id || uid("axes"), fmt = o.fmt || ((v) => String(+v.toFixed(3)).replace("-", "−"));
        const ticks = (spec, lo, hi) => (Array.isArray(spec) ? spec : spec ? Array.from({ length: Math.floor(hi / spec + 1e-9) - Math.ceil(lo / spec - 1e-9) + 1 },
          (_, i) => (Math.ceil(lo / spec - 1e-9) + i) * spec).map((v) => [v, fmt(v)]) : []);
        const tk = o.ticks || {}, xt = ticks(tk.x, x0, x1).filter(([v]) => !(zero && !oneD && Math.abs(v - ax0) < 1e-9 && tk.y)), yt = oneD ? [] : ticks(tk.y, yr[0], yr[1]).filter(([v]) => !(zero && Math.abs(v - ay0) < 1e-9 && tk.x));
        const gr = mk("axes", Object.assign({ tone: "dim" }, o, { id, label: null }), rectGeo(o.x, o.y - (oneD ? 3 : 0), o.w, oneD ? 6 : h), (gr, col) => {
          body("rect", { x: o.x, y: o.y, width: o.w, height: h, fill: "none" }, gr);
          if (o.grid) { const gx = ticks(o.grid.x || tk.x, x0, x1), gy = oneD ? [] : ticks(o.grid.y || tk.y, yr[0], yr[1]);
            gx.forEach(([v]) => drawable(el("line", sk(T.faint, 2, { class: "grid", x1: X(v), y1: o.y, x2: X(v), y2: o.y + h }), gr), h));
            gy.forEach(([v]) => drawable(el("line", sk(T.faint, 2, { class: "grid", x1: o.x, y1: Y(v), x2: o.x + o.w, y2: Y(v) }), gr), o.w)); }
          const yA = Y(ay0), xA = X(ax0), hw = 11;
          drawable(el("line", sk(col, 3, { id: id + "-xaxis", class: "axis", x1: o.x, y1: yA, x2: o.x + o.w + 18, y2: yA, "data-tint": null }), gr), o.w);
          el("polygon", { class: "pop", points: [[o.x + o.w + 30, yA], [o.x + o.w + 12, yA - hw * 0.7], [o.x + o.w + 12, yA + hw * 0.7]].map(P2).join(" "), fill: col }, gr);
          if (!oneD) { drawable(el("line", sk(col, 3, { id: id + "-yaxis", class: "axis", x1: xA, y1: o.y + h, x2: xA, y2: o.y - 18, "data-tint": null }), gr), h);
            el("polygon", { class: "pop", points: [[xA, o.y - 30], [xA - hw * 0.7, o.y - 12], [xA + hw * 0.7, o.y - 12]].map(P2).join(" "), fill: col }, gr); }
          const ts = o.tickSize || 30;
          xt.forEach(([v, s]) => { el("line", sk(col, 3, { class: "pop", x1: X(v), y1: yA - 8, x2: X(v), y2: yA + 8, "data-tint": null }), gr);
            txt(gr, { x: X(v), y: yA + 14 + ts * 0.6, text: s, size: ts, tone: "dim", weight: 400 }); });
          yt.forEach(([v, s]) => { el("line", sk(col, 3, { class: "pop", x1: xA - 8, y1: Y(v), x2: xA + 8, y2: Y(v), "data-tint": null }), gr);
            txt(gr, { x: xA - 18, y: Y(v), anchor: "end", text: s, size: ts, tone: "dim", weight: 400 }); });
          if (o.xlabel) txt(gr, { x: o.x + o.w + 44, y: yA, anchor: "start", text: o.xlabel, size: o.labelSize || 38, tone: "ink", italic: o.italic ?? true });
          if (o.ylabel && !oneD) txt(gr, { x: xA, y: o.y - 62, text: o.ylabel, size: o.labelSize || 38, tone: "ink", italic: o.italic ?? true });
        });
        return Object.assign(gr, { X, Y, P: (x, y = 0) => [X(x), Y(y)], xr: [x0, x1], yr, o });
      },
      /** Curve on axes from f(x) or [[x,y]..]; split at NaN/∞ and clipped exactly to the y-range. .pts = px points (all pieces), .f = f. */
      plot(ax, f, o = {}) {
        const id = o.id || uid("curve"), C = sampleCurve(ax, f, o);
        const p = el("path", sk(tone(o.tone || "accent"), o.stroke || 6, { id, class: "curve", "data-obj": "curve", d: C.d, style: HIDE }), o.parent || cam);
        drawable(p, C.L, o.dash);
        return Object.assign(p, { segs: C.segs, px: C.px, pts: [].concat(...C.px), f, ax, opt: o, sc: api });
      },
      /** Shaded region between f and g (default: the x-axis) over [a,b]; sweeps in left→right. */
      area(ax, f, [a, b], o = {}) { const n = o.n || 160, g = o.g || (() => 0), lo = ax.yr ? ax.yr[0] : -1e9, hi = ax.yr ? ax.yr[1] : 1e9;
        const xs = Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n), c = (v) => clamp(v, lo, hi), id = o.id || uid("area");
        const pts = xs.map((x) => ax.P(x, c(f(x)))).concat(xs.slice().reverse().map((x) => ax.P(x, c(g(x)))));
        const clip = el("clipPath", { id: id + "-clip" }, defs), cr = el("rect", { x: ax.X(a) - 2, y: 0, width: ax.X(b) - ax.X(a) + 4, height: 1080 }, clip);
        const gr = mk("area", Object.assign({ tone: "accent", attrs: { "data-overlap-ok": "" } }, o, { id }), rectGeo(ax.X(a), ax.o.y, ax.X(b) - ax.X(a), ax.o.h), (gr, col) =>
          body("path", { d: dpath(pts, true), fill: col, "fill-opacity": o.opacity || 0.22, "clip-path": `url(#${id}-clip)`, "data-tint": "fill" }, gr));
        gr.sweep = cr; return gr; },
      /** Point on a curve/function at x: dot + dashed guides to both axes + optional label/value labels. o.y overrides f. */
      mark(ax, x, f, o = {}) { const fy = typeof f === "function" ? f : f && f.f ? f.f : () => f, y = o.y ?? fy(x), p = ax.P(x, y);
        const ay = ax.Y(ax.yr ? (ax.o.origin === "corner" ? ax.yr[0] : clamp(0, ...ax.yr)) : 0), axx = ax.X(ax.o.origin === "corner" ? ax.xr[0] : clamp(0, ...ax.xr));
        const r = o.r || 11, lab = o.label === undefined ? `(${+x.toFixed(2)}, ${+y.toFixed(2)})` : o.label;
        return mk("mark", Object.assign({ tone: "accent", at: "top-right", size: 32 }, o, { label: lab }), circGeo(p[0], p[1], r), (gr, col) => {
          const gd = o.guides || "both";
          if (gd !== "none" && gd !== "y" && Math.abs(p[1] - ay) > 4) drawable(el("line", sk(col, 3, { class: "guide", x1: p[0], y1: p[1], x2: p[0], y2: ay, opacity: 0.8 }), gr), Math.abs(ay - p[1]), true);
          if (gd !== "none" && gd !== "x" && Math.abs(p[0] - axx) > 4) drawable(el("line", sk(col, 3, { class: "guide", x1: p[0], y1: p[1], x2: axx, y2: p[1], opacity: 0.8 }), gr), Math.abs(p[0] - axx), true);
          if (o.xval) txt(gr, { x: p[0], y: ay + 34, text: o.xval, size: 32, tone: o.tone || "accent", italic: true });
          if (o.yval) txt(gr, { x: axx - 18, y: p[1], anchor: "end", text: o.yval, size: 32, tone: o.tone || "accent", italic: true });
          el("circle", { class: "glow pop", cx: p[0], cy: p[1], r: r * 2.2, fill: col, opacity: 0.2, "data-tint": "fill" }, gr);
          body("circle", { class: "body pop", cx: p[0], cy: p[1], r, fill: col, "data-tint": "fill" }, gr); }); },
      /** Tangent segment to f at x (slides with A.slide). */
      tangent(ax, f, x, o = {}) { const len = o.len || 300, gr = mk("tangent", Object.assign({ tone: "green", attrs: { "data-overlap-ok": "" } }, o, { label: null }), circGeo(...ax.P(x, f(x)), 10), (gr, col) => {
          const q = tanPts(ax, f, x, len); drawable(el("line", sk(col, o.stroke || 5, { class: "tline", x1: q[0][0], y1: q[0][1], x2: q[1][0], y2: q[1][1] }), gr), len);
          body("circle", { class: "body pop", cx: q[2][0], cy: q[2][1], r: 10, fill: col, "data-tint": "fill" }, gr); });
        return Object.assign(gr, { ax, f, x, len }); },
      /** Bars from the baseline (data-touch on the x-axis): data = [[x, value, "name"?], ..]; grow with A.in. */
      bars(ax, data, o = {}) { const bw = o.bw || (ax.o.w / (ax.xr[1] - ax.xr[0])) * 0.6, base = ax.Y(0);
        return mk("bars", Object.assign({ tone: "blue" }, o, { label: null }), rectGeo(ax.o.x, ax.o.y, ax.o.w, ax.o.h), (gr, col) => {
          body("rect", { x: ax.o.x, y: ax.o.y, width: ax.o.w, height: ax.o.h, fill: "none" }, gr);
          gr.cells = data.map(([x, v, name], i) => { const top = ax.Y(v), y0 = Math.min(top, base);
            const b = el("rect", { id: (o.id || gr.id) + "-b" + i, class: "bar", x: r2(ax.X(x) - bw / 2), y: r2(y0), width: r2(bw), height: r2(Math.abs(top - base)), rx: 4,
              fill: tone(o.tones ? o.tones[i] : o.tone || "blue"), "fill-opacity": 0.85, "data-touch": "#" + ax.id + "-xaxis", "data-tint": "fill" }, gr);
            if (o.values !== false) txt(gr, { x: ax.X(x), y: y0 - 26, text: o.fmt ? o.fmt(v) : String(v), size: 30, tone: "ink" });
            if (name) txt(gr, { x: ax.X(x), y: base + 34, text: name, size: 30, tone: "dim", weight: 400 });
            gsap.set(b, { svgOrigin: `${r2(ax.X(x))} ${r2(base)}` }); return b; }); }); },
      /** Vector in data coordinates (an arrow between two ax.P points). */
      vector(ax, p0, p1, o = {}) { return api.arrow(ax.P(...p0), ax.P(...p1), Object.assign({ gap: 0, tone: "accent", stroke: 6 }, o)); },

      /* ---------- equations: HTML over the svg, one <span data-k> per part ---------- */
      /** eq({x,y,size,parts:[[key,html]|"html",..], align:"center"|"left"}) → div; .t[key] = term span. */
      eq(o) { css(); const id = o.id || uid("eq"), d = document.createElement("div");
        Object.assign(d, { id, className: "s-eq" }); d.setAttribute("data-obj", "eq"); d.setAttribute("data-shape", "rect");
        d.style.cssText = `left:${o.x}px;top:${o.y}px;font-size:${o.size || 64}px;color:${tone(o.tone || "ink")};opacity:0`;
        d.t = {}; d.sc = api;
        (o.parts || []).forEach((p, i) => { const [k, h] = Array.isArray(p) ? p : [null, p], s = document.createElement("span");
          s.className = "t"; s.innerHTML = h.trim(); if (k) { s.dataset.k = k; s.id = `${id}-${k}`; d.t[k] = s; } if (/^\s/.test(h)) s.style.paddingLeft = "0.28em"; if (/\s$/.test(h)) s.style.paddingRight = "0.28em"; d.appendChild(s); }); // " = " → em padding, font-independent
        svg.parentNode.appendChild(d); d.at = [o.x, o.y, o.align === "left" ? 0 : 0.5];
        gsap.set(d, { xPercent: o.align === "left" ? 0 : -50, yPercent: -50 });
        return d; },

      /** Move shapes by {dx,dy,scale} (cumulative); every connector attached to them re-routes with the same timing. */
      move(tl, e, t, o = {}) {
        const els = [].concat(e).map((x) => (typeof x === "string" ? document.getElementById(x.replace(/^#/, "")) : x)), tw = tweenOpts(o, 0.8), back = o.yoyo && (o.repeat || 0) % 2 === 1;
        const saved = els.map((x) => Object.assign({}, x.geo));
        els.forEach((x) => { const g = x.geo; g.tx += o.dx || 0; g.ty += o.dy || 0; g.s *= o.scale || 1;
          tl.to(x, Object.assign({ x: g.tx, y: g.ty, scale: g.s }, tw), t); place2(g); });
        conns.filter((c) => els.some((x) => [c.a, c.b].some((r) => r === x || r === x.id || r === "#" + x.id))).forEach((c) => reroute(tl, c, t, tw));
        if (back) els.forEach((x, i) => Object.assign(x.geo, saved[i]));
        return tl;
      },
    };
    function place2(g) { // registry geometry after a move: centre = c0 + t, size = size0 * s
      g.cx = g.c0[0] + g.tx; g.cy = g.c0[1] + g.ty; g.w = g.w0 * g.s; g.h = g.h0 * g.s; g.x = g.cx - g.w / 2; g.y = g.cy - g.h / 2; if (g.r0) g.r = g.r0 * g.s;
    }
    svg.sc = api;
    return api;
  }

  /** Layout of an equation in frame px, measured once on a hidden clone in <body>: works while the scene host is
   *  still hidden (HyperFrames builds every scene at load) and ignores transforms. Needs fonts loaded (S.ready). */
  function eqBox(eq) {
    if (eq._box) return eq._box;
    const c = eq.cloneNode(true); c.removeAttribute("id"); c.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
    c.style.cssText = eq.style.cssText + ";left:0;top:0;transform:none;visibility:hidden;opacity:0"; document.body.appendChild(c);
    const w = c.offsetWidth, h = c.offsetHeight, x = eq.at[0] - eq.at[2] * w, y = eq.at[1] - h / 2;
    const t = Array.from(c.children).map((s) => ({ x: x + s.offsetLeft, y: y + s.offsetTop, w: s.offsetWidth, h: s.offsetHeight }));
    c.remove(); return (eq._box = { x, y, w, h, t });
  }
  function sampleCurve(ax, f, o) {
    const [x0, x1] = o.dom || ax.xr, n = o.n || 300, [y0, y1] = ax.yr || [-Infinity, Infinity];
    const raw = Array.isArray(f) ? f : Array.from({ length: n + 1 }, (_, i) => { const x = x0 + ((x1 - x0) * i) / n; return [x, f(x)]; });
    const ok = (y) => Number.isFinite(y) && y >= y0 - 1e-9 && y <= y1 + 1e-9;
    const cut = (a, b) => { const yb = b[1] > y1 ? y1 : y0, t = (yb - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), yb]; };
    const segs = []; let cur = null, prev = null;
    for (const p of raw) {
      if (ok(p[1])) { if (!cur) { cur = []; segs.push(cur); if (prev && Number.isFinite(prev[1])) cur.push(cut(p, prev)); } cur.push(p); }
      else { if (cur && Number.isFinite(p[1])) cur.push(cut(prev, p)); cur = null; }
      prev = p;
    }
    const S_ = segs.filter((s) => s.length > 1), px = S_.map((s) => s.map(([x, y]) => [ax.X(x), ax.Y(y)]));
    return { segs: S_, px, d: px.map((s) => dpath(s)).join(" "), L: px.reduce((a, s) => a + cum(s).pop(), 0) };
  }
  function tanPts(ax, f, x, len) { const h = 1e-4 * (ax.xr[1] - ax.xr[0]), p = ax.P(x, f(x)), q = ax.P(x + h, f(x + h)), u = norm(sub(q, p));
    return [sub(p, mul(u, len / 2)), add(p, mul(u, len / 2)), p]; }

  let cssDone = false;
  function css() { if (cssDone) return; cssDone = true; const s = document.createElement("style");
    s.textContent = `.s-eq{position:absolute;white-space:nowrap;font-family:"${T.serif}",serif;font-style:italic;line-height:1.2}
.s-eq .t{display:inline-block;position:relative}.s-eq i.d{position:absolute;pointer-events:none;box-sizing:border-box;font-style:normal}
.s-eq .hl{inset:-0.06em -0.05em;border:0.05em solid currentColor;border-radius:0.16em;background:color-mix(in srgb,currentColor 12%,transparent)}
.s-eq .ul{left:0;right:0;bottom:-0.06em;height:0.06em;border-radius:0.03em;background:currentColor;transform-origin:left center}
.s-eq .ub{left:0;right:0;top:100%;height:.42em;display:flex}.s-eq .ub b{box-sizing:border-box;height:.2em;border:0 solid currentColor}
.s-eq .ub b.l{width:.2em;border-width:0 0 .05em .05em;border-bottom-left-radius:.2em}.s-eq .ub b.m{flex:1;border-bottom-width:.05em}
.s-eq .ub b.r{width:.2em;border-width:0 .05em .05em 0;border-bottom-right-radius:.2em}
.s-eq .ub b.t1,.s-eq .ub b.t2{width:.2em;margin-top:.15em;border-top-width:.05em}.s-eq .ub b.t1{border-right-width:.05em;border-top-right-radius:.2em}
.s-eq .ub b.t2{border-left-width:.05em;border-top-left-radius:.2em}
.s-eq .ub em{position:absolute;top:.55em;left:50%;transform:translateX(-50%);font-size:.55em;white-space:nowrap}`;
    document.head.appendChild(s); }

  /* ======================================= animations: A.x(tl, target, at, opts) → tl ======================================= */
  const tweenOpts = (o, d) => { const r = { duration: o.d ?? d, ease: o.ease || "power2.inOut" }; if (o.repeat) r.repeat = o.repeat; if (o.yoyo) r.yoyo = true; return r; };
  const els = (t) => [].concat(t).map((x) => (typeof x === "string" ? document.querySelector(x) : x)).filter(Boolean);
  const isSvg = (e) => e instanceof SVGElement;
  const sceneOf = (e) => e.sc || (e.closest && (e.closest("svg") || {}).sc) || ((e.closest && e.closest(".s-eq")) || {}).sc;
  /** the single dash-attribute draw-on tween (pathLength=1; CSS strokeDashoffset does not move under pathLength) */
  const drawOn = (tl, targets, t, d, ease) => { const ts = [].concat(targets).filter(Boolean); if (ts.length)
    tl.fromTo(ts, { attr: { "stroke-dashoffset": 1 } }, { attr: { "stroke-dashoffset": 0 }, duration: d, ease: ease || "power2.inOut" }, t); };
  const q = (e, s) => Array.from(e.querySelectorAll(s));
  const sOf = (e) => (e.geo ? e.geo.s : 1);
  const ENTRANCE = { box: "draw", circle: "draw", level: "draw", axes: "draw", frame: "draw", brace: "draw", angle: "draw", spring: "draw", wave: "draw",
    tangent: "draw", mark: "draw", callout: "draw", rod: "draw", arrow: "grow", link: "grow", curve: "reveal", area: "sweep", bars: "bars",
    grid: "cells", swarm: "cells", dot: "pop", number: "rise", text: "rise", eq: "rise" };

  const A = {
    /** Entrance chosen by data-obj (override with {as: draw|grow|reveal|pop|fade|rise|sweep|cells|bars}). */
    in(tl, target, t, o = {}) {
      els(target).forEach((e) => { const how = o.as || ENTRANCE[e.getAttribute("data-obj")] || "fade";
        A["_" + how](tl, e, t, o); });
      return tl;
    },
    _draw(tl, e, t, o) { const d = o.d ?? 0.8, labs = q(e, ".lab"), pops = q(e, ".pop");
      tl.set(e, { opacity: 1 }, t); drawOn(tl, q(e, ".draw"), t, d);
      q(e, "[data-fill]").forEach((f) => tl.fromTo(f, { attr: { "fill-opacity": 0 } }, { attr: { "fill-opacity": +(f.getAttribute("fill-opacity") ?? 1) }, duration: 0.4 }, t + d * 0.6));   // back to the shape's own opacity (0.16 for tone fills), not 1
      if (pops.length) tl.fromTo(pops, { opacity: 0 }, { opacity: 1, duration: 0.3 }, t + d * 0.5);
      if (labs.length) tl.fromTo(labs, { opacity: 0 }, { opacity: 1, duration: 0.35, stagger: Math.min(0.08, 0.6 / labs.length) }, t + d * 0.6); },
    _grow(tl, e, t, o) { const d = o.d ?? 0.6, labs = q(e, ".lab");
      tl.set(e, { opacity: 1 }, t); drawOn(tl, e.querySelector(".shaft"), t, d);
      const tipH = e.querySelector(".h0"), tailH = e.querySelector(".h1"); // tip head lands with the shaft at t+d; a double arrow's tail head shows at t
      if (tipH) tl.fromTo(tipH, { opacity: 0 }, { opacity: 1, duration: 0.2 }, t + d - 0.1);
      if (tailH) tl.fromTo(tailH, { opacity: 0 }, { opacity: 1, duration: 0.15 }, t);
      if (labs.length) tl.fromTo(labs, { opacity: 0 }, { opacity: 1, duration: 0.3 }, t + d * 0.5); },
    _reveal(tl, e, t, o) { tl.set(e, { opacity: 1 }, t); drawOn(tl, e, t, o.d ?? 1.5, o.ease || "none"); },
    _pop(tl, e, t, o) { const s = sOf(e); tl.fromTo(e, { opacity: 0, scale: s * 0.4 }, { opacity: 1, scale: s, duration: o.d ?? 0.5, ease: "back.out(2)" }, t); },
    _fade(tl, e, t, o) { tl.fromTo(e, { opacity: 0 }, { opacity: 1, duration: o.d ?? 0.5, ease: "power1.out" }, t); },
    _rise(tl, e, t, o) { const y = e.geo ? e.geo.ty : 0; tl.fromTo(e, { opacity: 0, y: y + 18 }, { opacity: 1, y, duration: o.d ?? 0.5, ease: "power3.out" }, t); },
    _sweep(tl, e, t, o) { const w = +e.sweep.getAttribute("width"); tl.set(e, { opacity: 1 }, t).fromTo(e.sweep, { attr: { width: 0 } }, { attr: { width: w }, duration: o.d ?? 1, ease: o.ease || "power1.inOut" }, t); },
    _cells(tl, e, t, o) { tl.set(e, { opacity: 1 }, t); const c = e.cells, d = o.d ?? 1;
      tl.fromTo(c, { opacity: 0, scale: 0.2, transformOrigin: "50% 50%" }, { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(2)", stagger: (d - 0.35) / Math.max(1, c.length - 1) }, t); },
    _bars(tl, e, t, o) { const d = o.d ?? 0.7; tl.set(e, { opacity: 1 }, t);
      e.cells.forEach((b, i) => tl.fromTo(b, { scaleY: 0 }, { scaleY: 1, duration: d, ease: "power3.out" }, t + i * 0.15)); // origin = baseline (set at build)
      const labs = q(e, ".lab"); if (labs.length) tl.fromTo(labs, { opacity: 0 }, { opacity: 1, duration: 0.3 }, t + d * 0.7); },

    /** Fade out (end of a beat: clear the scaffolding). */
    out(tl, target, t, o = {}) { tl.to(els(target), { opacity: 0, duration: o.d ?? 0.4, ease: "power1.in" }, t); return tl; },
    /** Dot rides a curve: keyframe durations ∝ arc length, so it stays on the tip of A.in(curve) with the same t and d.
     *  {d, readout: text|number el, fmt: (x,y)=>string, show:true} */
    trace(tl, dot, curve, t, o = {}) {
      const d = o.d ?? 1.5, g = dot.geo, segs = curve.px, L = segs.reduce((a, s) => a + cum(s).pop(), 0), kf = [];
      segs.forEach((s, si) => s.forEach((p, i) => { if (si || i) kf.push({ x: p[0] - g.c0[0], y: p[1] - g.c0[1], duration: i ? (d * dist(s[i - 1], p)) / L : 0, ease: "none" }); }));
      const p0 = segs[0][0];
      tl.set(dot, { x: p0[0] - g.c0[0], y: p0[1] - g.c0[1] }, t);
      if (o.show !== false) tl.fromTo(dot, { opacity: 0 }, { opacity: 1, duration: 0.15 }, t);
      tl.to(dot, { keyframes: kf }, t);
      const end = segs[segs.length - 1].slice(-1)[0]; g.tx = end[0] - g.c0[0]; g.ty = end[1] - g.c0[1]; g.cx = end[0]; g.cy = end[1];
      if (o.readout) { // textContent tweened 0→1 (arc fraction) and formatted by a pure modifier: seekable both ways
        const data = [], c = []; // flattened data points + cumulative px arc length (0 across the jump between pieces)
        segs.forEach((s, si) => s.forEach((p, i) => { c.push(c.length ? c[c.length - 1] + (i ? dist(s[i - 1], p) : 0) : 0); data.push(curve.segs[si][i]); }));
        const fmt = o.fmt || ((x, y) => y.toFixed(2)), val = (s) => { const Ls = s * c[c.length - 1]; let i = 1; while (i < c.length - 1 && c[i] < Ls) i++;
          const u = clamp((Ls - c[i - 1]) / (c[i] - c[i - 1] || 1), 0, 1); return fmt(data[i - 1][0] + u * (data[i][0] - data[i - 1][0]), data[i - 1][1] + u * (data[i][1] - data[i - 1][1])); };
        const r = o.readout.val || o.readout;
        tl.fromTo(r, { textContent: 0 }, { textContent: 1, duration: d, ease: "none", immediateRender: false, modifiers: { textContent: (v) => val(clamp(+v, 0, 1)) } }, t);
      }
      return tl;
    },
    /** Count a number element to a value. {to, d, digits} */
    count(tl, num, t, o) { const dg = o.digits ?? num.digits ?? 0;
      tl.to(num.val, { textContent: o.to, duration: o.d ?? 1.2, ease: o.ease || "power1.inOut", modifiers: { textContent: (v) => (+v).toFixed(dg) } }, t);
      num.value = o.to; return tl; },
    /** Change a curve: to = g(x) (blend) or g(x, s) with s 0→1 (true parameter family, e.g. (x,s)=>Math.sin((1+s)*x)). {d, steps, ease} */
    morph(tl, curve, t, o) {
      const f0 = curve.f, fam = o.to.length >= 2 ? o.to : (x, s) => (1 - s) * f0(x) + s * o.to(x), n = o.steps || 30, D = o.d ?? 1.2, ez = gsap.parseEase(o.ease || "power2.inOut");
      const kf = Array.from({ length: n }, (_, k) => ({ attr: { d: sampleCurve(curve.ax, (x) => fam(x, ez((k + 1) / n)), curve.opt).d }, duration: D / n, ease: "none" }));
      tl.to(curve, { keyframes: kf }, t);
      const C = sampleCurve(curve.ax, (x) => fam(x, 1), curve.opt); Object.assign(curve, { f: (x) => fam(x, 1), segs: C.segs, px: C.px, pts: [].concat(...C.px) });
      return tl; },
    /** Slide a tangent to x = o.to (keyframed line + dot). */
    slide(tl, tg, t, o) { const n = o.steps || 40, D = o.d ?? 2, ez = gsap.parseEase(o.ease || "power1.inOut"), line = tg.querySelector(".tline"), dot = tg.querySelector(".body");
      for (let k = 1; k <= n; k++) { const x = tg.x + (o.to - tg.x) * ez(k / n), P = tanPts(tg.ax, tg.f, x, tg.len);
        tl.to(line, { attr: { x1: r2(P[0][0]), y1: r2(P[0][1]), x2: r2(P[1][0]), y2: r2(P[1][1]) }, duration: D / n, ease: "none" }, t + ((k - 1) * D) / n);
        tl.to(dot, { attr: { cx: r2(P[2][0]), cy: r2(P[2][1]) }, duration: D / n, ease: "none" }, t + ((k - 1) * D) / n); }
      tg.x = o.to; return tl; },
    /** Move (delegates to sc.move, so attached connectors follow). {dx, dy, scale, d, ease, repeat, yoyo} */
    move(tl, e, t, o) { sceneOf(els(e)[0]).move(tl, e, t, o); return tl; },
    /** Rotate about the element's origin (rod: its pivot). sine.inOut + yoyo + odd repeat = exact pendulum θ0·cos(πt/d). {to, from, d, ease, repeat, yoyo} */
    rotate(tl, e, t, o) { const g = e.geo || {}, from = o.from ?? g.rot ?? 0;
      tl.fromTo(e, { rotation: from }, Object.assign({ rotation: o.to }, tweenOpts(Object.assign({ ease: "sine.inOut" }, o), 1)), t);
      g.rot = o.yoyo && (o.repeat || 0) % 2 ? from : o.to; return tl; },
    /** Travelling wave: shifts the carrier by one wavelength per period d, `cycles` times (finite repeat). */
    travel(tl, wave, t, o = {}) { const c = wave.querySelector(".carrier"), dir = o.dir === "left" ? -1 : 1;
      tl.fromTo(c, { x: dir > 0 ? 0 : wave.lambda }, { x: dir > 0 ? wave.lambda : 0, duration: o.d ?? 1, ease: "none", repeat: (o.cycles || 4) - 1 }, t); return tl; },
    /** Seeded random walk of a swarm's particles inside its box. {d, steps, seed, amp} */
    jitter(tl, sw, t, o = {}) { const R = rng(o.seed || 7), n = o.steps || 8, D = o.d ?? 4, amp = o.amp || 60, [x, y, w, h] = sw.box, r = sw.pr;
      sw.cells.forEach((c) => { const cx = +c.getAttribute("cx"), cy = +c.getAttribute("cy"); let px = cx, py = cy;
        const kf = Array.from({ length: n }, () => { px = clamp(px + (R() * 2 - 1) * amp, x + r, x + w - r); py = clamp(py + (R() * 2 - 1) * amp, y + r, y + h - r);
          return { attr: { cx: r2(px), cy: r2(py) }, duration: D / n, ease: "sine.inOut" }; });
        tl.to(c, { keyframes: kf }, t); });
      return tl; },
    /** Brief scale bump [s0, s0·s, s0] (never sticks, keeps a moved shape's scale). */
    pulse(tl, target, t, o = {}) { els(target).forEach((e) => { const s0 = sOf(e);
      tl.to(e, { keyframes: { scale: [s0, s0 * (o.s || 1.15), s0] }, duration: o.d ?? 0.5, ease: "power1.inOut" }, t); }); return tl; },
    /** Recolour: SVG → [data-tint] strokes/fills inside (body, label, heads); HTML → CSS color. {tone, d} */
    tint(tl, target, t, o) { const col = tone(o.tone), tw = { duration: o.d ?? 0.4, ease: "power1.inOut" };
      els(target).forEach((e) => { if (!isSvg(e)) { e._tone = col; return tl.to(e, Object.assign({ color: col }, tw), t); }
        const all = (e.hasAttribute("data-tint") ? [e] : []).concat(q(e, "[data-tint]"));
        const st = all.filter((x) => x.getAttribute("data-tint") === "stroke"), fi = all.filter((x) => x.getAttribute("data-tint") === "fill");
        if (st.length) tl.to(st, Object.assign({ stroke: col }, tw), t);
        if (fi.length) tl.to(fi, Object.assign({ fill: col }, tw), t); });
      return tl; },
    /** Dim everything in the scene except keep[] (null = undim all). Uses CSS brightness, never opacity, so hidden objects stay hidden. */
    focus(tl, keep, t, o = {}) { const ks = els(keep || []), sc = o.scene || sceneOf(ks[0]);
      const all = Array.from(sc.cam.children).concat(Array.from(sc.svg.parentNode.querySelectorAll(":scope > .s-eq"))).filter((e) => e.hasAttribute("data-obj"));
      all.forEach((e) => { const to = !keep || ks.some((k) => k === e || e.contains(k) || k.contains(e)) ? 1 : o.dim ?? 0.3, from = e._dim ?? 1;
        if (e._dim === undefined) gsap.set(e, { filter: "brightness(1)" }); // explicit start ("none" does not interpolate)
        if (to !== from) tl.to(e, { filter: `brightness(${to})`, duration: o.d ?? 0.5, ease: "power1.inOut" }, t);
        e._dim = to; });
      return tl; },
    /** Temporary hand-drawn ellipse around a target: draws on, holds, fades. {tone, pad, hold, d} */
    circle(tl, target, t, o = {}) { const e = els(target)[0], sc = sceneOf(e), g = sc.geo(e), pad = o.pad ?? 18, html = !isSvg(e);
      const ring = el("ellipse", sk(tone(o.tone || "accent"), 5, { cx: g.cx, cy: g.cy, rx: g.w / 2 * 1.18 + pad, ry: g.h / 2 * 1.25 + pad, "data-obj": "ring", "data-overlap-ok": "", style: HIDE }), html ? sc.svg : sc.cam);
      drawable(ring, Math.PI * (g.w + g.h)); const d = o.d ?? 0.6;
      tl.set(ring, { opacity: 1 }, t); drawOn(tl, ring, t, d, "power2.out"); tl.to(ring, { opacity: 0, duration: 0.4 }, t + d + (o.hold ?? 1.2));
      return tl; },
    /** Ring burst from a target's centre ("there!"). {tone, d} */
    flash(tl, target, t, o = {}) { const e = els(target)[0], sc = sceneOf(e), g = sc.geo(e), r = o.r ?? Math.min(Math.max(g.w, g.h) / 2 + 10, 160);   // capped: a plot-sized ring reads as a frame, not a pointer
      const ring = el("circle", sk(tone(o.tone || "accent"), 5, { cx: g.cx, cy: g.cy, r, "data-obj": "ring", "data-overlap-ok": "", style: HIDE }), isSvg(e) ? sc.cam : sc.svg);
      gsap.set(ring, { svgOrigin: `${g.cx} ${g.cy}` });
      tl.set(ring, { opacity: 0.9 }, t).to(ring, { opacity: 0, scale: 1.7, duration: o.d ?? 0.7, ease: "power2.out" }, t);
      return tl; },
    /** Camera: frame a target (element/id/[x,y,w,h]) with padding, or {to:null} to return to the full frame. {to, pad, scale, d, ease} */
    zoom(tl, cam, t, o = {}) { const st = cam.st; let s = 1, x = 0, y = 0;
      if (o.to) { const g = Array.isArray(o.to) ? { cx: o.to[0] + o.to[2] / 2, cy: o.to[1] + o.to[3] / 2, w: o.to[2], h: o.to[3] } : cam.parentNode.sc.geo(o.to), pad = o.pad ?? 120;
        s = o.scale || Math.min(1920 / (g.w + 2 * pad), 1080 / (g.h + 2 * pad)); x = 960 - s * g.cx; y = 540 - s * g.cy; }
      tl.to(cam, { x, y, scale: s, duration: o.d ?? 1.2, ease: o.ease || "power2.inOut" }, t);
      Object.assign(st, { x, y, s }); return tl; },
    /** Slow push-in about the current view centre, continuing from the current camera scale. {d, scale: factor} */
    drift(tl, cam, t, o = {}) { const st = cam.st, k = o.scale || 1.04, cx = (960 - st.x) / st.s, cy = (540 - st.y) / st.s, s = st.s * k;
      tl.to(cam, { x: 960 - s * cx, y: 540 - s * cy, scale: s, duration: o.d ?? 3, ease: "none" }, t);
      Object.assign(st, { x: 960 - s * cx, y: 540 - s * cy, s }); return tl; },

    /* ---------- equations ---------- */
    /** Reveal an equation term by term: schedule = [[key, at], ..]; unlisted parts appear with the first. */
    terms(tl, eq, schedule, o = {}) { schedule.forEach(([k]) => { if (!eq.t[k]) throw new Error(`A.terms: equation has no term "${k}" (keys: ${Object.keys(eq.t)})`); });
      const t0 = Math.min(...schedule.map((s) => s[1])), listed = new Set(schedule.map((s) => s[0]));
      tl.set(eq, { opacity: 1 }, t0);
      const dy = parseFloat(eq.style.fontSize) * 0.25, rise = (e, t) => tl.fromTo(e, { opacity: 0, y: dy }, { opacity: 1, y: 0, duration: o.d ?? 0.45, ease: "power3.out" }, t);
      Array.from(eq.children).forEach((s) => { if (!listed.has(s.dataset.k)) rise(s, t0); });
      schedule.forEach(([k, t]) => rise(eq.t[k], t));
      return tl; },
    /** Box around a term (CSS child of the term span — no measuring). {tone} */
    highlight(tl, term, t, o = {}) { const i = deco(term, "hl", o); tl.fromTo(i, { opacity: 0, scale: 1.25 }, { opacity: 1, scale: 1, duration: o.d ?? 0.45, ease: "power3.out" }, t);
      return o.until ? tl.to(i, { opacity: 0, duration: 0.3 }, o.until) : tl; },
    underline(tl, term, t, o = {}) { const i = deco(term, "ul", o); tl.fromTo(i, { opacity: 1, scaleX: 0 }, { scaleX: 1, duration: o.d ?? 0.5, ease: "power2.out" }, t);
      return o.until ? tl.to(i, { opacity: 0, duration: 0.3 }, o.until) : tl; },
    /** Curly brace under a term with a label: {label, tone}. */
    underbrace(tl, term, t, o = {}) { const i = deco(term, "ub", o); i.innerHTML = '<b class="l"></b><b class="m"></b><b class="t1"></b><b class="t2"></b><b class="m"></b><b class="r"></b>';
      if (o.label) { const em = document.createElement("em"); em.textContent = o.label; i.appendChild(em); }
      tl.fromTo(i, { opacity: 0, scaleX: 0.2 }, { opacity: 1, scaleX: 1, duration: o.d ?? 0.5, ease: "power3.out" }, t);
      return o.until ? tl.to(i, { opacity: 0, duration: 0.3 }, o.until) : tl; },
    /** Transform eq1 into eq2: terms with the same key (or o.map {k1:k2}) glide to their new place; the rest fade out / in.
     *  Positions are measured at build: build inside S.ready() so web fonts are loaded. {d} */
    swap(tl, eq1, eq2, t, o = {}) { const d = o.d ?? 1.2, map = o.map || {};
      const size = (e) => parseFloat(e.style.fontSize), ratio = size(eq2) / size(eq1), used = new Set(), moved = [], em = size(eq1);
      const ctr = (e) => { const q = eqBox(e.parentNode).t[Array.from(e.parentNode.children).indexOf(e)]; return [q.x + q.w / 2, q.y + q.h / 2]; };
      Array.from(eq1.children).forEach((s) => { const k2 = map[s.dataset.k] || s.dataset.k, s2 = k2 && eq2.t[k2];
        if (s2 && !used.has(k2)) { used.add(k2); const a = ctr(s), b = ctr(s2);
          const dx = b[0] - a[0], dy = b[1] - a[1], arc = Math.abs(dx) > em * 0.2 ? Math.sign(dx) * em * 0.75 : 0; // crossing terms pass above/below each other
          tl.to(s, { x: dx, scale: ratio, duration: d, ease: "power2.inOut" }, t);
          tl.to(s, { keyframes: [{ y: dy / 2 + arc, duration: d / 2, ease: "sine.out" }, { y: dy, duration: d / 2, ease: "sine.in" }] }, t); moved.push(s2); if (s._tone) { s2._tone = s._tone; tl.set(s2, { color: s._tone }, t); } }
        else tl.to(s, { opacity: 0, duration: d * 0.25, ease: "power1.in" }, t); });
      tl.set(eq2, { opacity: 1 }, t); [eq1, eq2].forEach((e) => e.setAttribute("data-overlap-ok", "")); // terms travel over the other box by design
      Array.from(eq2.children).forEach((s) => { if (moved.includes(s)) tl.fromTo(s, { opacity: 0 }, { opacity: 1, duration: 0.01 }, t + d);
        else tl.fromTo(s, { opacity: 0 }, { opacity: 1, duration: d * 0.5, ease: "power1.out" }, t + d * 0.5); });
      tl.set(eq1, { opacity: 0 }, t + d + 0.01);
      return tl; },
  };
  function deco(term, cls, o) { const i = document.createElement("i"); i.className = "d " + cls; i.style.color = tone(o.tone || "accent"); i.style.opacity = 0; term.appendChild(i); return i; }

  /** Run a scene builder once fonts are loaded (HTML measurement: eq terms as arrow ends, A.swap). Register the timeline at its END. */
  function ready(fn) { const f = document.fonts; if (!f) return fn();
    const fams = [`40px "${T.font}"`, `italic 40px "${T.serif}"`, `40px "${T.serif}"`, `40px "${T.mono}"`];
    Promise.all(fams.map((s) => f.load(s).catch(() => 0))).then(() => f.ready).then(fn); }

  /** Cue times local to a scene whose host has data-start = start (window.CUES is in root seconds). */
  const cues = (start = 0) => Object.fromEntries(Object.entries(window.CUES || {}).map(([k, v]) => [k, v - start]));

  window.S = { scene, theme: (o) => Object.assign(T, o), T, tone, rng, ready, cues, anchor, dpath };
  window.A = A;
})();
