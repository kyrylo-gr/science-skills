#!/usr/bin/env python3
"""check_layout.py — geometry gate for explainer scenes. Run it before every snapshot/render.

Loads each scene (compositions/*.html, or index.html if there are none) in headless Chromium at
1920x1080, seeks every registered GSAP timeline to sample times (each cue + 0.6 s, each beat end,
the end) and measures what is actually on screen:

  ERROR  arrow_detached   arrow tail/tip is not on the edge of the shape it declares (data-from / data-to)
  ERROR  arrow_pierces   arrow tip/tail sits inside its shape
  ERROR  arrow_too_small arrow too short, or stroke/head too thin for the shapes it joins (tiny arrow, huge box)
  ERROR  text_overlap     visible text overlaps other text or a shape it does not belong to
  ERROR  arrow_crosses    an arrow's shaft passes through a shape it does not join
  ERROR  touch            elements declared data-touch="#other" are not flush (gap or overlap > 3 px)
  ERROR  off_canvas       visible object leaves the 1920x1080 frame
  WARN   shape_overlap    two shapes partially overlap (full containment is fine)
  WARN   unsafe_text      text outside the 80% title-safe box
  WARN   small_text       text rendered smaller than 28 px
  WARN   scale_mismatch   shapes joined by an arrow differ in size by more than 6x

Opt-outs (use sparingly, they are visible in review): data-overlap-ok on an element, data-container
on a shape that is meant to enclose others. Arrows drawn by hand (not shapes.js) are checked too if they
carry data-from/data-to; their endpoints are read from the first <path>/<line>.

Usage:  python3 check_layout.py [project_dir] [--times 1.2,3.4] [--annotate snaps/layout] [--json]
Exit code 1 if any ERROR. With --annotate, writes a PNG per failing time with offenders outlined in red.
"""
import argparse, functools, http.server, json, re, socketserver, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

HARNESS_JS = r"""
async (src) => {
  // Mount a scene file the way the runtime does: template content into a 1920x1080 root, scripts re-run in order.
  const html = await (await fetch(src)).text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const tpl = doc.querySelector("template");
  const frag = tpl ? tpl.content : doc.body;
  const host = document.getElementById("hf-host");
  doc.querySelectorAll("head style, head link[rel=stylesheet]").forEach(s => host.appendChild(s.cloneNode(true)));
  // neutralise scripts before import (imported scripts would otherwise run once on insertion), then run each once, in order
  frag.querySelectorAll("script").forEach(s => s.setAttribute("type", "text/x-hold"));
  for (const n of Array.from(frag.childNodes)) host.appendChild(document.importNode(n, true));
  const scripts = Array.from(host.querySelectorAll("script"));
  for (const old of scripts) {
    const s = document.createElement("script");
    for (const at of old.attributes) if (at.name !== "type") s.setAttribute(at.name, at.value);
    if (old.src) {
      const u = old.getAttribute("src");
      if (/gsap|cues|shapes/.test(u) && document.querySelector(`script[data-pre="${u.split('/').pop()}"]`)) { old.remove(); continue; }
      s.src = u; await new Promise(r => { s.onload = s.onerror = r; old.replaceWith(s); });
    } else { s.textContent = old.textContent; old.replaceWith(s); }
  }
  // scenes may build asynchronously (S.ready → document.fonts): wait for fonts, then for the registration (max 8 s)
  if (document.fonts) await document.fonts.ready;
  for (let i = 0; i < 80 && !Object.keys(window.__timelines || {}).length; i++) await new Promise(r => setTimeout(r, 100));
  return Object.keys(window.__timelines || {});
}
"""

MEASURE_JS = r"""
(t) => {
  for (const tl of Object.values(window.__timelines || {})) { try { tl.seek(t, false); } catch (e) {} }
  const W = 1920, H = 1080, out = { objs: [], arrows: [], texts: [], touches: [] };
  const vis = (e) => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentNode) {
      const cs = getComputedStyle(n); if (cs.display === "none" || cs.visibility === "hidden") return 0; o *= parseFloat(cs.opacity); }
    return o; };
  const rect = (e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
  const edge = (e) => (e.matches("[data-edge]") ? e : e.querySelector("[data-edge]")) || e;   // shape body, not its labels/glow
  const cam = (e) => { const c = e.closest("[data-cam]"); if (!c) return 0; const m = c.getCTM(); const s = c.ownerSVGElement.getCTM();
    return (Math.abs(m.a - s.a) > 1e-3 || Math.abs(m.e - s.e) > 0.5 || Math.abs(m.f - s.f) > 0.5) ? 2 : 1; };  // 2 = camera moved
  const sel = (e) => e.id ? "#" + e.id : e.tagName.toLowerCase() + (e.getAttribute("class") ? "." + e.getAttribute("class").split(" ")[0] : "");
  const toScreen = (e, x, y) => { const m = e.getScreenCTM(); const p = new DOMPoint(x, y).matrixTransform(m); return [p.x, p.y]; };
  const shape = (e) => { const k = e.getAttribute("data-shape") || ({circle:"circle", ellipse:"circle"})[e.tagName.toLowerCase()] || "rect"; return k; };
  const desc = (e) => ({ sel: sel(e), r: rect(edge(e)), op: vis(e), kind: shape(e), obj: e.getAttribute("data-obj") || "",
      ok: e.hasAttribute("data-overlap-ok"), container: e.hasAttribute("data-container"),
      inArrow: !!e.closest("[data-arrow]"), cam: cam(e),
      anc: (() => { const a = []; for (let n = e.parentElement; n; n = n.parentElement) if (n.matches("[data-obj], .obj")) a.push(sel(n)); return a; })() });
  // shapes = data-obj groups that are not arrows/text, plus hand-tagged .obj
  document.querySelectorAll("[data-obj]:not([data-obj=text]):not([data-obj=arrow]):not([data-arrow]):not([data-obj=curve]), .obj").forEach(e => {
    const d = desc(e); d.parentObj = e.parentElement && e.parentElement.closest("[data-obj], .obj") ? sel(e.parentElement.closest("[data-obj], .obj")) : null;
    if (d.op > 0.05) out.objs.push(d); });
  // text = leaf elements with own text
  document.querySelectorAll("#hf-host *").forEach(e => {
    if (["SCRIPT","STYLE","TEMPLATE"].includes(e.tagName)) return;
    const own = Array.from(e.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own) return; const d = desc(e); if (d.op <= 0.05) return;
    const owner = e.closest("[data-obj]:not([data-obj=text]), .obj"); d.owner = owner && owner !== e ? sel(owner) : null;
    d.text = e.textContent.trim().slice(0, 40); d.h = d.r[3] - d.r[1];
    d.tpar = []; for (let n = e.parentElement; n && n.id !== "hf-host"; n = n.parentElement)  // inline spans inside a text line
      if (Array.from(n.childNodes).some(c => c.nodeType === 3 && c.textContent.trim())) d.tpar.push(sel(n));
    d.fs = parseFloat(getComputedStyle(e).fontSize) * (e.getScreenCTM ? Math.hypot(e.getScreenCTM().a, e.getScreenCTM().b) : 1);
    out.texts.push(d); });
  document.querySelectorAll("[data-from], [data-to]").forEach(e => {
    const op = vis(e); if (op <= 0.05) return;
    let tail, tip, head = 0, stroke = 0;
    if (e.hasAttribute("data-tip")) {
      const p = (a) => e.getAttribute(a).split(",").map(Number);
      const m = e.getScreenCTM(), s = Math.hypot(m.a, m.b);
      tail = toScreen(e, ...p("data-tail")); tip = toScreen(e, ...p("data-tip"));
      head = +e.getAttribute("data-head") * s; stroke = +e.getAttribute("data-stroke") * s;
    } else {
      const g = e.matches("path,line,polyline") ? e : e.querySelector("path,line,polyline"); if (!g) return;
      const L = g.getTotalLength(), a = g.getPointAtLength(0), b = g.getPointAtLength(L);
      tail = toScreen(g, a.x, a.y); tip = toScreen(g, b.x, b.y);
      stroke = parseFloat(getComputedStyle(g).strokeWidth) * Math.hypot(g.getScreenCTM().a, g.getScreenCTM().b); head = stroke * 3;
    }
    // sample the visible shaft for crossing tests
    const sh = e.querySelector(".shaft") || (e.matches("path,line") ? e : e.querySelector("path,line"));
    const samples = []; if (sh) { const L = sh.getTotalLength(); const da = parseFloat(getComputedStyle(sh).strokeDashoffset) || 0;
      const shown = Math.max(0, Math.min(1, 1 - da)); // pathLength=1 dash reveal
      for (let i = 1; i < 20; i++) { const f = i / 20; if (sh.hasAttribute("pathLength") && f > shown) break;
        const q = sh.getPointAtLength(L * f); samples.push(toScreen(sh, q.x, q.y)); } }
    const q = (a) => e.getAttribute(a) ? document.querySelector(e.getAttribute(a)) : null, f = q("data-from"), to = q("data-to");
    out.arrows.push({ sel: sel(e), tail, tip, head, stroke, op, samples, gap: +(e.getAttribute("data-gap") || 10),
      from: f ? desc(f) : null, to: to ? desc(to) : null, fromSel: e.getAttribute("data-from"), toSel: e.getAttribute("data-to"), r: rect(e) });
  });
  out.curves = [];
  document.querySelectorAll("[data-obj=curve], path.curve").forEach(c => { if (vis(c) <= 0.05) return;
    const L = c.getTotalLength(), shown = c.hasAttribute("pathLength") ? Math.max(0, Math.min(1, 1 - (parseFloat(getComputedStyle(c).strokeDashoffset) || 0))) : 1;
    const pts = []; for (let i = 0; i <= 80 * shown; i++) { const q = c.getPointAtLength(L * i / 80); pts.push(toScreen(c, q.x, q.y)); }
    out.curves.push({ sel: sel(c), pts }); });
  document.querySelectorAll("[data-touch]").forEach(e => {
    const o = document.querySelector(e.getAttribute("data-touch")); if (!o || vis(e) <= 0.05 || vis(o) <= 0.05) return;
    out.touches.push({ a: desc(e), b: desc(o) }); });
  return out;
}
"""


def inter(a, b):
    w = min(a[2], b[2]) - max(a[0], b[0]); h = min(a[3], b[3]) - max(a[1], b[1])
    return max(0, w), max(0, h)


def contains(a, b, tol=2):
    return a[0] - tol <= b[0] and a[1] - tol <= b[1] and a[2] + tol >= b[2] and a[3] + tol >= b[3]


def edge_dist(p, d):
    """Signed distance from point p to the boundary of shape d: >0 outside, <0 inside (px)."""
    x0, y0, x1, y1 = d["r"]
    if d["kind"] == "circle":
        cx, cy, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
        rho = ((p[0] - cx) / rx) ** 2 + ((p[1] - cy) / ry) ** 2
        return (rho ** 0.5 - 1) * min(rx, ry)
    dx = max(x0 - p[0], 0, p[0] - x1); dy = max(y0 - p[1], 0, p[1] - y1)
    if dx or dy:
        return (dx * dx + dy * dy) ** 0.5
    return -min(p[0] - x0, x1 - p[0], p[1] - y0, y1 - p[1])


def inside(p, r, pad=3):
    return r[0] + pad < p[0] < r[2] - pad and r[1] + pad < p[1] < r[3] - pad


def size(d):
    r = d["r"]; return min(r[2] - r[0], r[3] - r[1])


def camera_ok(d, W=1920, H=1080):
    """inside [data-cam]: cropped while the camera is zoomed/panned, or entirely outside the frame (invisible) → not an error"""
    r = d["r"]
    return d.get("cam") == 2 or (d.get("cam") == 1 and (r[2] <= 0 or r[0] >= W or r[3] <= 0 or r[1] >= H))


def analyse(m, t):
    issues = []
    add = lambda lvl, code, msg, *sels: issues.append({"t": t, "level": lvl, "code": code, "msg": msg, "sels": list(sels)})
    W, H = 1920, 1080
    for a in m["arrows"]:
        L = ((a["tip"][0] - a["tail"][0]) ** 2 + (a["tip"][1] - a["tail"][1]) ** 2) ** 0.5
        for end, p, d, s in (("tail", a["tail"], a["from"], a["fromSel"]), ("tip", a["tip"], a["to"], a["toSel"])):
            if not s:      # free end (a point, e.g. a feature on a plot): nothing to attach to
                continue
            if not d:
                add("ERROR", "arrow_detached", f"{a['sel']} {end}: target {s} not found", a["sel"]); continue
            if d["op"] <= 0.05:
                add("ERROR", "arrow_detached", f"{a['sel']} {end} points at {s}, which is not visible", a["sel"], s); continue
            e = edge_dist(p, d)
            if e < -3:
                add("ERROR", "arrow_pierces", f"{a['sel']} {end} is {-e:.0f} px inside {s}", a["sel"], s)
            elif e > a["gap"] + 14:
                add("ERROR", "arrow_detached", f"{a['sel']} {end} stops {e:.0f} px from {s} (expected ~{a['gap']} px)", a["sel"], s)
        joined = [d for d in (a["from"], a["to"]) if d]
        S = max([size(d) for d in joined] or [0])
        if L < 48:
            add("ERROR", "arrow_too_small", f"{a['sel']} is only {L:.0f} px long: move the shapes apart or drop the arrow", a["sel"])
        if S and (a["stroke"] < max(3, 0.015 * S) or (a["head"] and a["head"] < max(14, 0.05 * S))):   # head 0 = link
            add("ERROR", "arrow_too_small", f"{a['sel']} stroke {a['stroke']:.1f}px / head {a['head']:.0f}px is too thin for shapes of {S:.0f}px "
                f"(need stroke >= {max(3, 0.015 * S):.1f}, head >= {max(14, 0.05 * S):.0f})", a["sel"])
        if len(joined) == 2 and min(size(joined[0]), size(joined[1])) > 0:
            ratio = max(size(joined[0]), size(joined[1])) / min(size(joined[0]), size(joined[1]))
            if ratio > 6:
                add("WARN", "scale_mismatch", f"{a['fromSel']} and {a['toSel']} differ {ratio:.1f}x in size", a["fromSel"], a["toSel"])
        for o in m["objs"]:
            if o["sel"] in (a["fromSel"], a["toSel"]) or o["ok"] or o["inArrow"] or o["obj"] == "dot":
                continue
            if o["parentObj"] in (a["fromSel"], a["toSel"]):
                continue
            if any(d and o["sel"] in d["anc"] for d in (a["from"], a["to"])):   # the object holding the target (eq around a term)
                continue
            if any(inside(p, o["r"], 6) for p in a["samples"]) and not o["container"]:
                add("ERROR", "arrow_crosses", f"{a['sel']} passes through {o['sel']}", a["sel"], o["sel"])
        for tx in m["texts"]:
            if tx["inArrow"] or tx["ok"]:
                continue
            if any(inside(p, tx["r"], 2) for p in a["samples"] + [a["tip"]]):
                add("ERROR", "text_overlap", f"{a['sel']} runs through text '{tx['text']}'", a["sel"], tx["sel"])
    texts = m["texts"]
    for c in m.get("curves", []):
        for tx in texts:
            if not tx["ok"] and any(inside(p, tx["r"], 1) for p in c["pts"]):
                add("ERROR", "text_overlap", f"curve {c['sel']} runs through text '{tx['text']}'", c["sel"], tx["sel"])
    for i, x in enumerate(texts):
        if x["ok"]:
            continue
        r = x["r"]
        if (r[0] < 0 or r[1] < 0 or r[2] > W or r[3] > H) and not camera_ok(x):
            add("ERROR", "off_canvas", f"text '{x['text']}' leaves the frame", x["sel"])
        elif (r[0] < 0.1 * W or r[2] > 0.9 * W or r[1] < 0.1 * H or r[3] > 0.9 * H) and not camera_ok(x):
            add("WARN", "unsafe_text", f"text '{x['text']}' outside the 80% title-safe box", x["sel"])
        if x["fs"] and x["fs"] < 28:
            add("WARN", "small_text", f"text '{x['text']}' renders at {x['fs']:.0f}px", x["sel"])
        for y in texts[i + 1:]:
            if y["ok"] or x["sel"] in y["tpar"] or y["sel"] in x["tpar"]:
                continue
            w, h = inter(r, y["r"])
            if w > 3 and h > 3:
                add("ERROR", "text_overlap", f"text '{x['text']}' overlaps text '{y['text']}'", x["sel"], y["sel"])
        for o in m["objs"]:
            if o["ok"] or o["container"] or x["owner"] == o["sel"] or o["sel"] == x["sel"] or (x["owner"] and o["parentObj"] == x["owner"]):
                continue
            if o["obj"] in ("axes",) and contains(o["r"], r):
                continue
            w, h = inter(r, o["r"])
            if w > 4 and h > 4 and not (x["owner"] and o["sel"] == x["owner"]):
                # label of a shape sitting inside another container is fine only if the container is declared
                add("ERROR", "text_overlap", f"text '{x['text']}' overlaps {o['sel']}", x["sel"], o["sel"])
    objs = [o for o in m["objs"] if not o["inArrow"]]
    for i, a in enumerate(objs):
        r = a["r"]
        if (r[0] < -2 or r[1] < -2 or r[2] > W + 2 or r[3] > H + 2) and not a["ok"] and not camera_ok(a):
            add("ERROR", "off_canvas", f"{a['sel']} leaves the frame", a["sel"])
        for b in objs[i + 1:]:
            if a["ok"] or b["ok"] or a["parentObj"] == b["sel"] or b["parentObj"] == a["sel"] or "dot" in (a["obj"], b["obj"]):
                continue
            w, h = inter(r, b["r"])
            if w > 4 and h > 4 and not (contains(r, b["r"]) or contains(b["r"], r)):
                add("WARN", "shape_overlap", f"{a['sel']} and {b['sel']} partially overlap ({w:.0f}x{h:.0f} px)", a["sel"], b["sel"])
    for tch in m["touches"]:
        a, b = tch["a"]["r"], tch["b"]["r"]
        gx = max(b[0] - a[2], a[0] - b[2]); gy = max(b[1] - a[3], a[1] - b[3])
        gap = max(gx, gy)
        if abs(gap) > 3:
            what = f"{gap:.0f} px gap" if gap > 0 else f"{-gap:.0f} px overlap"
            add("ERROR", "touch", f"{tch['a']['sel']} should touch {tch['b']['sel']}: {what}", tch["a"]["sel"], tch["b"]["sel"])
    return issues


def sample_times(proj, extra):
    if extra:
        return sorted({round(float(x), 3) for x in extra.split(",")})
    cj = proj / "assets" / "cues.js"
    if not cj.exists():
        return [0.5, 2, 4, 6, 8]
    cues = json.loads(re.search(r"=\s*(\{.*\})\s*;", cj.read_text(), re.S).group(1))
    total = cues.pop("total", max(cues.values()) + 1)
    ts = set()
    for k, v in cues.items():
        ts.add(round(v + (-0.15 if k.endswith("_end") else 0.6), 3))
    ts.add(round(total - 0.3, 3))
    return sorted(x for x in ts if 0 <= x <= total)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project", nargs="?", default=".")
    ap.add_argument("--times", help="comma-separated seconds (default: every cue + 0.6 s, beat ends, end)")
    ap.add_argument("--scene", help="only this file (relative to project)")
    ap.add_argument("--annotate", help="dir for PNGs of failing frames with offenders outlined")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    proj = Path(a.project).resolve()
    scenes = [proj / a.scene] if a.scene else sorted((proj / "compositions").glob("*.html")) or [proj / "index.html"]
    times = sample_times(proj, a.times)
    # scene hosts in index.html: a scene's timeline is local, so root time t is seeked as t - data-start
    span = {}
    if (proj / "index.html").exists():
        for tag in re.findall(r'<[^>]*data-composition-src="[^"]+"[^>]*>', (proj / "index.html").read_text()):
            g = lambda k: (re.search(k + r'="([^"]+)"', tag) or [None, None])[1]
            st, du = float(g("data-start") or 0), float(g("data-duration") or 1e9)
            span[g("data-composition-src")] = (st, st + du)

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *x): pass
    handler = functools.partial(Quiet, directory=str(proj))
    srv = socketserver.TCPServer(("127.0.0.1", 0), handler); port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    pre = [p for p in ("assets/gsap.min.js", "assets/cues.js", "assets/shapes.js") if (proj / p).exists()]
    if (proj / "index.html").exists():  # also preload any vendored libs index.html loads (katex, fonts css...)
        for src in re.findall(r'<script[^>]+src="(assets/[^"]+)"', (proj / "index.html").read_text()):
            if src not in pre: pre.append(src)
    shell = ("<!doctype html><html><head><meta charset=utf-8><style>html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#000}"
             "#hf-host{position:relative;width:1920px;height:1080px}</style>"
             + "".join(f'<script data-pre="{Path(p).name}" src="/{p}"></script>' for p in pre)
             + "</head><body><div id=hf-host></div></body></html>")
    (proj / ".layout_harness.html").write_text(shell)

    all_issues = []
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch()
            for sc in scenes:
                pg = br.new_page(viewport={"width": 1920, "height": 1080})
                errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
                pg.add_init_script("window.__timelines = window.__timelines || {}; window.__hyperframes = window.__hyperframes || {getVariables: () => ({})};")
                pg.goto(f"http://127.0.0.1:{port}/.layout_harness.html")
                rel = sc.relative_to(proj).as_posix()
                tls = pg.evaluate(HARNESS_JS, f"/{rel}")
                pg.wait_for_timeout(300)
                for e in errs:
                    all_issues.append({"t": None, "level": "ERROR", "code": "js_error", "msg": f"{rel}: {e}", "sels": [], "scene": rel})
                if not tls:
                    all_issues.append({"t": None, "level": "ERROR", "code": "no_timeline", "msg": f"{rel}: no window.__timelines registered", "sels": [], "scene": rel})
                t0, t1 = span.get(rel, (0, 1e9))
                for t in [x for x in times if t0 <= x <= t1]:
                    m = pg.evaluate(MEASURE_JS, t - t0)
                    iss = analyse(m, t)
                    for i in iss: i["scene"] = rel
                    all_issues += iss
                    if a.annotate and any(i["level"] == "ERROR" for i in iss):
                        Path(a.annotate).mkdir(parents=True, exist_ok=True)
                        sels = sorted({s for i in iss if i["level"] == "ERROR" for s in i["sels"] if s and s.startswith("#")})
                        pg.evaluate("""(sels) => { document.querySelectorAll('.__lay').forEach(n => n.remove());
                          for (const s of sels) { const e = document.querySelector(s); if (!e) continue; const r = e.getBoundingClientRect();
                            const d = document.createElement('div'); d.className = '__lay';
                            Object.assign(d.style, {position:'fixed', left:r.left-4+'px', top:r.top-4+'px', width:r.width+8+'px', height:r.height+8+'px',
                              outline:'3px solid #ff2d2d', zIndex:99999, pointerEvents:'none', font:'20px monospace', color:'#ff2d2d'});
                            d.textContent = s; document.body.appendChild(d); } }""", sels)
                        pg.screenshot(path=str(Path(a.annotate) / f"{Path(rel).stem}_{t:07.3f}.png"))
                        pg.evaluate("() => document.querySelectorAll('.__lay').forEach(n => n.remove())")
                pg.close()
            br.close()
    finally:
        srv.shutdown(); (proj / ".layout_harness.html").unlink(missing_ok=True)

    # collapse repeats of the same issue across times
    seen, rows = {}, []
    for i in all_issues:
        k = (i["scene"], i["code"], i["msg"])
        if k in seen: seen[k]["times"].append(i["t"]); continue
        i["times"] = [i["t"]]; seen[k] = i; rows.append(i)
    nerr = sum(r["level"] == "ERROR" for r in rows)
    if a.json:
        print(json.dumps({"errors": nerr, "warnings": len(rows) - nerr, "times": times, "issues": rows}, indent=2))
    else:
        print(f"checked {len(scenes)} scene(s) at {len(times)} times: {nerr} error(s), {len(rows) - nerr} warning(s)")
        for r in sorted(rows, key=lambda r: (r["level"] != "ERROR", r["scene"])):
            ts = ",".join(f"{t:.2f}" for t in r["times"] if t is not None)
            print(f"  {r['level']:5} {r['code']:16} {r['scene']} @ {ts or '-'}  {r['msg']}")
    sys.exit(1 if nerr else 0)


if __name__ == "__main__":
    main()
