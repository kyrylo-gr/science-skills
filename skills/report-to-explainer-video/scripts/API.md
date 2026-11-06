### shapes.js v2 — API reference

```js
(() => {                                               // scene script, inside the composition <template>
  const C = S.cues(SCENE_START), sc = S.scene("#x-svg"), tl = gsap.timeline({ paused: true });
  const a = sc.box({ x: 260, y: 420, w: 340, h: 200, label: "Qubit" }), b = sc.circle({ cx: 1300, cy: 520, r: 130, label: "Cavity" });
  const ab = sc.arrow(a, b, { label: "drive" });
  A.in(tl, a, C.qubit); A.in(tl, ab, C.drive - 0.6); A.in(tl, b, C.cavity);
  window.__timelines["x"] = tl;                        // register LAST
})();
```

**Conventions.** Every builder returns the DOM element (`el.geo` = current geometry). Ids are optional: missing ids become `prefix-kind-n` (prefix = svg id minus `-svg`). Everything starts at `opacity:0`. Every animation is `A.x(tl, target, at, opts)`, starts at `at` (seconds, scene-local: use `S.cues(start)`) and returns `tl`. `target` = element, `#id` or an array. A shape/target reference `ref` can be an element, an id, a point `[x,y]` (e.g. `ax.P(x,y)`), or an equation term (`eq.t.key`).
Common shape options: `id, tone, fill (tone name → 16 % tint), stroke (width), dash, label, at, size, italic, labelTone, attrs:{data-container:"", data-touch:"#id"}`.
`at` / sides: `"in"` · `"top" "bottom" "left" "right"` · `"top@0.3"` (30 % along that side) · `"top-right"`… · angle in degrees (0 = right, 90 = up).
Tones: `ink dim line faint accent blue green red violet teal`; `S.theme({...})` before building.

| Shape | Call | For | Checker sees |
|---|---|---|---|
| Box / pill | `sc.box({x,y,w,h,r,label,sub})`, `sc.pill({...})` | labelled things; label auto-fits | rect; `.body[data-edge]` is the geometry |
| Circle | `sc.circle({cx,cy,r,label})` | | circle |
| Dot | `sc.dot({cx,cy,r,glow,label,at:"right"})` | tracers, states | circle = the dot; glow is `data-overlap-ok`, never overlap-flagged |
| Text | `sc.text({x,y,text,size,anchor,italic})` | free labels (targetable) | text |
| Level | `sc.level({x,y,w,label})` | energy levels, ceilings, baselines; label right | thin rect |
| Frame | `sc.frame([refs], {pad,label,dash})` | group container around members | `data-container` |
| Arrow | `sc.arrow(a, b, {fromSide,toSide,gap,bend,route:"elbow",head:"end"\|"both"\|"none",wave,dash,label,labelSide})` | cause → effect; ends computed on the edges | `data-from/to/tail/tip/head/stroke/gap`; a point end is free (not checked) |
| Link | `sc.link(a, b, {dash,label})` | plain/dashed connection | as arrow, head 0 |
| Spring | `sc.spring(a, b, {coils,amp,fromSide,toSide})` | mass–spring; stretches with `move` | shape |
| Callout | `sc.callout(ref, {text, at:45, dist:110})` | note + leader line | `data-overlap-ok`; its text is checked |
| Brace | `sc.brace(ref\|[refs], {side,label,gap,depth})` | "this span is…" | shape; label outside |
| Angle | `sc.angle(p, q, r, {label,right,radius})` | angle arc / right-angle mark at q | `data-overlap-ok` |
| Rod | `sc.rod({x,y,len,r,angle})` | pendulum / rotating rod (pivot = origin) | circle = bob |
| Wave | `sc.wave({x,y,w,amp,lambda,label,at})` | travelling wave in a clip window | rect = window |
| Grid | `sc.grid({x,y,n,cols,cell,filled,tone})` → `.cells` | "N of 100" unit grid | rect |
| Swarm | `sc.swarm({n,seed,box:[x,y,w,h],r})` → `.cells` | seeded particles / gas | `data-overlap-ok` |
| Number | `sc.number({x,y,value,digits,unit,anchor})` | counters, readouts | text |
| Axes | `sc.axes({x,y,w,h,xr,yr,origin:"zero"\|"corner",ticks:{x,y},grid,xlabel,ylabel,fmt})` → `.X(v) .Y(v) .P(x,y)` | plots; `yr:null` = number line; tick = step or `[[v,"label"]]` | rect = plotting area; contained texts OK |
| Plot | `sc.plot(ax, f\|[[x,y]], {dom,n,tone,dash})` → `.pts .f` | curve; split at NaN/∞, clipped exactly to `yr` | `data-obj=curve`: must not cross text |
| Area | `sc.area(ax, f, [a,b], {g, opacity})` | shaded region (between f and g, default axis) | `data-overlap-ok` |
| Mark | `sc.mark(ax, x, f\|curve, {label,xval,yval,guides:"both"\|"x"\|"y"\|"none"})` | point on curve + dashed guides + value | circle = the dot |
| Tangent | `sc.tangent(ax, f, x, {len})` | tangent segment; slide with `A.slide` | `data-overlap-ok` |
| Bars | `sc.bars(ax, [[x, v, "name"]], {tones,values,fmt})` | bar chart from the baseline | each bar `data-touch` the x-axis |
| Vector | `sc.vector(ax, [x0,y0], [x1,y1], {label})` | arrow in data coordinates | free ends |
| Equation | `sc.eq({x,y,size,parts:[[key,html]\|"html"], align})` → `.t[key]` | HTML over the svg, one span per part; leading/trailing spaces become padding | `data-obj=eq`; terms are texts |

| Animation | Call | Use |
|---|---|---|
| Entrance | `A.in(tl, e, at, {d, as})` | picks by kind: draw (outline, then fill + labels), grow (arrow: head lands at `at+d`, so pass `cue - d`), reveal (curve, linear), sweep (area), bars, cells (stagger), pop (dot), rise (text, number, eq). `as` overrides |
| Exit | `A.out(tl, [els], at, {d})` | clear the scaffolding |
| Tracer | `A.trace(tl, dot, curve, at, {d, readout, fmt:(x,y)=>s})` | dot rides the curve (arc-length timing) = on the tip of `A.in(curve)` with the same `at`, `d`; readout counts along |
| Count | `A.count(tl, number, at, {to, d, digits})` | animate a value |
| Morph | `A.morph(tl, curve, at, {to, d, steps})` | `to(x)` blends; `to(x, s)` (s 0→1) sweeps a real parameter |
| Slide | `A.slide(tl, tangent, at, {to, d})` | tangent travels along f |
| Move | `A.move(tl, e\|[els], at, {dx, dy, scale, d, ease, repeat, yoyo})` | moves shapes; **attached arrows/links/springs re-route with it** (same timing) |
| Rotate | `A.rotate(tl, e, at, {from, to, d, repeat, yoyo})` | about origin (rod: pivot). Default `sine.inOut` + yoyo + odd repeat = exact pendulum |
| Travel | `A.travel(tl, wave, at, {d: period, cycles, dir})` | travelling wave |
| Jitter | `A.jitter(tl, swarm, at, {d, steps, seed, amp})` | seeded random walk |
| Pulse | `A.pulse(tl, e, at, {s, d})` | bump `[1, s, 1]` (keeps a moved scale). Not on equation terms (grows into neighbours): use `flash` |
| Tint | `A.tint(tl, e, at, {tone, d})` | recolour body/label/heads (SVG) or text (HTML) — link a symbol to its curve |
| Focus | `A.focus(tl, [keep], at, {dim})`; `A.focus(tl, null, at, {scene: sc})` | dim everything else (brightness, not opacity); null = undim |
| Circle | `A.circle(tl, e, at, {tone, hold})` | temporary hand-drawn ellipse |
| Flash | `A.flash(tl, e, at, {tone})` | ring burst ("there!") |
| Zoom | `A.zoom(tl, sc.cam, at, {to: ref\|[x,y,w,h]\|null, pad, d})` | camera frames a target; `null` = full frame |
| Drift | `A.drift(tl, sc.cam, at, {d, scale: 1.04})` | slow push-in from the current view |
| Terms | `A.terms(tl, eq, [[key, at], ...])` | term-by-term reveal; unlisted parts with the first |
| Highlight / underline | `A.highlight(tl, eq.t.k, at, {tone, until})`, `A.underline(...)` | box / line on a term (CSS child, no measuring) |
| Underbrace | `A.underbrace(tl, eq.t.k, at, {label, tone, until})` | brace under a term with a label |
| Swap | `A.swap(tl, eq1, eq2, at, {d, map:{k1:k2}})` | matched keys glide (crossing terms arc above/below), the rest fade; tints carry over |

**Helpers.** `S.cues(start)` scene-local cues · `S.ready(fn)` run the build after fonts load (needed when an eq term is an arrow end, for `A.swap`, and `circle`/`flash` on a term) — register the timeline at the end of `fn` · `S.rng(seed)` mulberry32 · `sc.geo(ref)`, `sc.anchor(ref, where)` → `{p, n}` · `sc.cam` camera group.

**Rules.** Never place arrows by hand; move shapes with `A.move` (a raw `tl.to(shape, {x})` leaves arrows stale, which the checker reports as `arrow_detached`). Draw-on is `pathLength=1` and the dash attribute tween, dashed lines included. Morph/slide/trace/move are keyframed at build: no `onUpdate`, seekable both ways. Equations are measured on an off-screen clone, so they work while a later scene is still hidden; their fonts must be declared in the scene's `<style>` (e.g. `.s-eq{font-family:"EB Garamond"}`) so HyperFrames embeds them. Marks/tangents/areas do not follow a morph: fade them first.
