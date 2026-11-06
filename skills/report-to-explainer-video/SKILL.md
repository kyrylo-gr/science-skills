---
name: "report-to-explainer-video"
description: "Turn a report, paper or notes into a visually rich, animated narrated explainer video (MP4) with kokoro-onnx voice and HyperFrames: asks the target length first, explains through animated diagrams, plots and equations synced to spoken words, and gates every frame with a geometry checker."
---

# Report → animated, narrated explainer video (kokoro-onnx + HyperFrames)

Makes a 1920×1080 explainer in the spirit of 3Blue1Brown: the picture does the explaining, the voice guides the eye, and every visual lands on the word that names it. The voice is the clock: **narration is generated first, its exact timings are written to `assets/cues.js`, and the animation reads them**, so nothing is placed by ear.

Three things are non-negotiable:

1. **Ask the length first** (section 0). Everything else — number of ideas, beats, scenes — is sized from it.
2. **It must look impressive and explain through motion.** Every beat changes the picture. Shapes come from the predefined library `shapes.js` (section 7), never hand-placed arrows.
3. **Every frame passes the geometry gate** `check_layout.py` (section 8) before any snapshot or render: arrows start and end on the edges they claim, are sized to the shapes they join, nothing overlaps by accident.

If the `hyperframes` skill (and `/hyperframes-cli`, `/media-use`) is available, load it too: its contract and work loop apply. The rules below are the subset this workflow depends on, plus what was learned getting it to run in a sandbox.

## 0. Ask before anything else

Use AskUserQuestion (one call) before reading deeply or writing a script — unless the person already said it, or the session is unattended (then pick the default, state it, carry on):

- **Length** — "How long should the video be?" Options: ~30 s teaser · ~1 min (default) · ~2 min · 3–5 min.
- **Register** — only if the source and request don't make it obvious: general audience (popular) · scientific audience (peers, students).

Size the video from the answer. Kokoro at speed 1.0 speaks about 2.6 words/s including pauses (≈150 words per minute of video).

| Target | Words | Beats (≤ 19 words each) | Ideas | Scenes |
|---|---|---|---|---|
| 30 s | ~70 | 4–5 | 1 | 1 |
| 1 min | ~140 | 7–9 | 1 (+ one consequence) | 1–2 |
| 2 min | ~290 | 14–18 | 2–3 | 2–3 |
| 3–5 min | 430–720 | 22–40 | 3–5 | 3–6, one per idea |

After narrate.py prints the total, compare it with the target: more than ±15 % off → cut or add beats, not speed (`--speed` stays within 0.95–1.05).

## 1. Set up (once per session)

```bash
W=$PWD/explainer-work; mkdir -p "$W/tts" && cd "$W/tts"
python3 -m venv venv && ./venv/bin/pip install -q kokoro-onnx soundfile numpy
# Model files come from GitHub releases (works where huggingface.co is blocked). int8 = 88 MB, CPU-fast.
for f in kokoro-v1.0.int8.onnx voices-v1.0.bin; do
  curl -sL -o $f https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/$f; done
which ffmpeg ffprobe node   # Node >= 22 and ffmpeg are required by HyperFrames
python3 -c "import playwright"   # check_layout.py needs Python Playwright + a Chromium
```

**Get the toolkit.** The code ships with this skill in its `scripts/` folder (`narrate.py`, `shapes.js`, `check_layout.py`, `API.md`, `example_scene.html`); copy that folder to `$W/toolkit`. If the folder is missing, read the same files from the *Explainer Video Toolkit* artifact (https://claude.ai/artifact/9ppFu6e9HSXbNn7sL5enTM) with the Artifact tool — `action: "read"`, that `url`, `paths: ["narrate.py", "shapes.js", "check_layout.py", "API.md", "example_scene.html"]`, `out_dir: "$W/toolkit"`. If neither works, stop and tell the person; do not rewrite the scripts from memory.

Copy `narrate.py` into `$W/tts/`. Then create the project and drop in the two helpers:

```bash
export HYPERFRAMES_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1      # HyperFrames sends telemetry by default
cd "$W" && npx -y hyperframes@latest init video --example blank --non-interactive
cd video && npm i gsap && mkdir -p assets compositions && cp node_modules/gsap/dist/gsap.min.js assets/
cp "$W/toolkit/shapes.js" assets/ && cp "$W/toolkit/check_layout.py" . && cp "$W/toolkit/example_scene.html" compositions/explain.html
```

Sandbox fixes (Claude Cowork cloud workspace and similar locked-down machines):

- **CDN blocked** (cdn.jsdelivr.net): templates load GSAP from it and the render fails with `Cannot read properties of null (reading 'timeline')`. Vendor it (above) and point the `<script>` at `assets/gsap.min.js`. Same for KaTeX or any other library; never fetch at render time.
- **No Chrome found**: `export HYPERFRAMES_BROWSER_PATH=$(ls -d /opt/pw-browsers/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell | head -1)`.
- **Hugging Face / ElevenLabs blocked**: kokoro-onnx from GitHub releases is the working natural voice. `espeak-ng` (apt) is a robotic last resort. HyperFrames' Whisper transcription also needs Hugging Face; this workflow does not need it.
- Bash `while read` loops that call Python or ffmpeg lose lines because the child reads stdin: use `</dev/null` / `-nostdin`, or drive everything from Python (narrate.py does).
- No GPU is needed. A 25 s video renders in about 1 min on 2 CPUs.

## 2. Read the source, pick the ideas, choose the register

- Read the report (`pdftotext -layout file.pdf -` for PDFs, or the Read tool). Pick as many ideas as the length table allows — the one result or mechanism a newcomer should leave with first.
- Every claim, number and equation must trace to the report. Do not invent values; mark anything illustrative as illustrative. Check the science of each step before animating it: a beautiful wrong diagram is worse than none.

**Popular register** (general audience): illustrations first. Concrete objects (a drawn atom, a pendulum, a coin, a city map), metaphors made visible, at most one equation in the whole video and only if it is famous or very short. Numbers appear as comparisons ("as long as a football pitch"), not units.

**Scientific register** (peers, students): equations first. Put the **main equation(s)** of the report on screen — one to three, not every line of derivation — typeset properly. **Every equation shown must be given intuition in the same beat or the next**, by one of:

- **a plot of what it says**: draw the curve the equation describes, then tie each symbol to a visual feature (colour the symbol and the feature the same, `A.tint`; pulse both on the word that names them). E.g. P(t)=sin²(Ωt/2): the curve, Ω as the speed of the swing, the peak as the π-pulse.
- **a well-known analogy**: a pendulum for Rabi oscillation, a spinning top for precession, springs for coupled modes, water in pipes for current, a ball in a bowl for a potential. Draw the analogy next to the equation and move them together (same start, duration, ease), so the viewer sees they are the same motion.
- **a limiting case** animated: set a parameter to 0 or ∞ and show the plot collapse to something obvious.

Mixed audiences: scientific structure, popular pictures — keep the main equation, lead with the analogy.

## 3. Visual direction: make it impressive, explain with motion

Choose the picture before writing the script. Per scene: one diagram that grows (one part per beat), a worked example travelling through the steps, or a continuous transformation. Never bullet slides, icon rows, or a whole diagram dropped at once.

- **Something meaningful moves in every beat**; no stretch longer than ~3 s with nothing moving. If a beat is pure narration, use `A.drift` (slow push-in) or a pulse on what is being discussed.
- **Motion carries meaning**: arrows grow in the direction of cause → effect; curves draw left→right with a tracer dot riding the tip; quantities that change are animated, not swapped; a transformation morphs (move/scale), not cut.
- **Build up, then clear**: a scene accumulates at most ~7 objects; then fade the scaffolding (`A.out`) and keep only what the next idea needs. Scene changes are motivated transitions (zoom into a part, slide the diagram aside), not hard cuts.
- **Hierarchy**: one focal element per beat, in the accent colour; the rest in `line`/`dim`. One colour per concept for the whole video (the same quantity is always the same colour in the plot, the diagram and the equation).
- **Composition**: use the frame — the main diagram fills about 60 % of it; generous spacing between shapes (an arrow between two shapes needs at least ~120 px of room); align to a grid (multiples of 20 px); joined shapes of similar size.
- **Polish**: dark ground, soft glow on tracer dots, rounded strokes, eased entrances (`power3.out`, `back.out` for pops), staggered labels. Text is minimal: labels and the equation, never narration sentences.
- **Longer videos** (≥ 2 min): give each idea its own scene composition, open with a 3–5 s visual hook (the most striking frame of the video, animated), and close with a recap frame that reassembles the key pictures together.

## 4. Write the beat script with cue markers

`script.txt`, one beat per line, `id|text`. Each beat is one or two sentences, about 19 spoken words or fewer. Number of beats from the length table. End on the one idea in one line.

Put a `[cue]` marker immediately **before the word the picture should land on**:

```text
# id|narration
vo1|Drive a qubit with a [drive]resonant microwave, and it does [jump]not simply [cross]jump to the excited state.
vo2|Instead, it [osc]swings back and forth between ground and excited, like a [pend]pendulum.
vo3|The [ylabel]chance of finding it excited follows [eq]sine squared of omega t over two.
vo4|Stop the drive at the [peak]first peak. That is a [pilabel]pi pulse: a [flip]perfect flip.
```

- Cue names are letters, digits, `_` or `-`, unique across the script. For multi-scene videos prefix them with the scene (`s2_peak`).
- Aim for one cue every 3–5 s of speech: every cue is a visual event.
- Write maths the way it should be spoken ("sine squared of omega t over two"); put the typeset form on screen.
- The narrator should not read the on-screen text word for word.
- **Show the script to the person — with a one-line description of the picture for each beat — and get approval before building visuals**, unless they asked for no stops.

## 5. Generate the narration and cues

```bash
cd "$W/video" && "$W/tts/venv/bin/python" -I "$W/tts/narrate.py" script.txt --project . \
  --model "$W/tts/kokoro-v1.0.int8.onnx" --voices "$W/tts/voices-v1.0.bin" --voice af_heart
```

How it syncs: each beat is synthesised in fragments split at the markers. Fragments are trimmed of edge silence and joined, with a natural pause only where the text has punctuation. A cue's time is the exact length of the audio before it, so no aligner model is needed. Each beat becomes one loudness-normalised clip (−16 LUFS, −1.5 dBTP). Beats are laid end to end with a 0.45 s gap starting at 0.6 s.

It writes `assets/voice/<id>.wav`, `assets/cues.js` (`window.CUES = {vo1_start, vo1_end, drive, …, total}`, all in root seconds) and `narration.json`. It prints the `<audio>` tags and the total duration — **compare the total with the target length now** (section 0).

Options: `--voice` (e.g. `af_heart`, `af_bella`, `am_michael`, `bf_emma`, `bm_george`), `--speed 0.95–1.05`, `--gap`, `--start`, `--tail` (hold after the last word, default 2.8 s so the closing line can be read).

Re-run it whenever the script changes. The animation follows automatically because it only reads `window.CUES`.

## 6. Build the composition

`index.html` (root): load GSAP, the cues and shapes.js before any scene, mount one scene host per scene, and paste the printed `<audio>` tags. Set the root's `data-duration` to `CUES.total`; each scene host gets its own `data-start`/`data-duration` (one scene: 0 and `CUES.total`).

```html
<head>
  <script src="assets/gsap.min.js"></script>
  <script src="assets/cues.js"></script>
  <script src="assets/shapes.js"></script>
  ...
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="24.58" data-width="1920" data-height="1080">
    <div id="explain" data-composition-id="explain" data-composition-src="compositions/explain.html"
         data-start="0" data-duration="24.58" data-track-index="1" data-track-kind="graphics"
         data-width="1920" data-height="1080"></div>
    <!-- pasted from narrate.py -->
    <audio id="vo1" class="clip" src="assets/voice/vo1.wav" data-start="0.6" data-duration="5.524" data-track-index="2" data-volume="1"></audio>
    ...
  </div>
  <script>window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body>
```

Scene file `compositions/explain.html`: everything inside `<template>`, one `<svg>` per scene (its id gives the auto-id prefix), equations via `sc.eq`. For several scenes, pass each host's `data-start` to `S.cues(start)` so cue times become scene-local. **Every time position is a cue, never a typed number**:

```html
<template id="explain-template">
<div data-composition-id="explain" data-width="1920" data-height="1080"
     style="width:1920px;height:1080px;background:#0f1117;position:relative;font-family:Inter">
  <style>.s-eq{font-family:"EB Garamond",serif}</style>  <!-- name equation fonts here so HyperFrames embeds them -->
  <svg id="x-svg" width="1920" height="1080" style="position:absolute;inset:0"></svg>
  <script>
  (() => {                                       // IIFE: scenes must not leak consts into each other
    const C = S.cues(0), sc = S.scene("#x-svg"), tl = gsap.timeline({ paused: true });   // S.cues(host data-start)
    const q  = sc.box({ x: 240, y: 200, w: 520, h: 300, label: "Qubit", sub: "two levels" });
    const d  = sc.circle({ cx: 1380, cy: 350, r: 140, label: "Drive", tone: "blue" });
    const ar = sc.arrow(d, q, { label: "microwave", wave: true, tone: "blue" });   // edge to edge, sized to the shapes
    const ax = sc.axes({ x: 300, y: 600, w: 760, h: 300, xr: [0, 4 * Math.PI], yr: [0, 1.4], ticks: { y: 0.5 }, xlabel: "t", ylabel: "P" });
    const cu = sc.plot(ax, (t) => Math.sin(t / 2) ** 2, { tone: "line" });        // exact maths
    const dot = sc.dot({ cx: cu.pts[0][0], cy: cu.pts[0][1] });
    const pk = sc.mark(ax, Math.PI, cu, { label: "π pulse", guides: "x" });
    const eq = sc.eq({ x: 1320, y: 760, size: 64, parts: [["P", "P(t)"], " = ", ["s", "sin²"], "(", ["om", "Ω"], "t/2)"] });

    A.in(tl, q, C.qubit);                        // outline draws on, then fill + label
    A.in(tl, d, C.drive - 0.9);
    A.in(tl, ar, C.drive - 0.6);                 // head lands ON the word "drive"
    A.in(tl, ax, C.osc - 0.5);
    A.in(tl, cu, C.osc, { d: C.vo3_end - C.osc });        // curve and tracer share at + d → dot rides the tip
    A.trace(tl, dot, cu, C.osc, { d: C.vo3_end - C.osc });
    A.terms(tl, eq, [["P", C.eq], ["s", C.eq + 0.5], ["om", C.eq + 1]]);
    A.tint(tl, [eq.t.om, cu], C.eq + 1.4, { tone: "accent" });   // same colour = same idea
    A.in(tl, pk, C.peak);
    A.flash(tl, pk, C.peak + 0.4);
    window.__timelines["explain"] = tl;          // register LAST
  })();
  </script>
</div>
</template>
```

HyperFrames rules that bite here:

- One paused timeline per composition, registered last, keyed by the same id as the host and the scene root. A mismatched id makes each render wait 45 s and show static frames.
- Use `fromTo` (not `from`) for entrances. Later changes to the same element use `to`. shapes.js objects start hidden (`opacity:0`) and `A.in` (or another entrance) reveals them at their cue.
- Deterministic only: no `Date.now()`, unseeded `Math.random()`, timers, network fetches, `repeat: -1`, or `onUpdate` callbacks for layout. Seeking may skip callbacks, so animate properties directly.
- Animate transforms and opacity, not `left`/`top`/`width`. Never tween `display`/`visibility` on a `.clip`.
- **Stroke draw-on**: give the element `pathLength="1"` and tween the *attributes* `stroke-dasharray: "1 1"`, `stroke-dashoffset: 1 → 0` (`{attr: {...}}`). GSAP's CSS `strokeDashoffset` tween does not move under `pathLength` — the line stays hidden then pops in. shapes.js already does this.
- Every `<audio>` needs an `id`. Asset paths are root-relative (`assets/...`).
- Bundled fonts resolve by name (Inter, EB Garamond, JetBrains Mono, IBM Plex Mono, …); others need `@font-face` to a file in `assets/fonts/`.
- Keep text inside the 80 % title-safe box; minimum text size about 30 px at 1080p.

## 7. Predefined shapes and animations (shapes.js)

Use these instead of drawing raw SVG or writing raw tweens: they cover the recurring vocabulary of explainer videos (connectors, labels, plots, equations, physics and popular-science illustrations, camera, emphasis). GSAP core only, no plugins. All coordinates are frame pixels (`viewBox="0 0 1920 1080"`). If a scene needs something the library lacks, add it to the project's `shapes.js` through the shared internals (`mk`, `label`, `anchor`, `drawOn`) rather than inlining it in the scene, and tell the person, so the toolkit artifact can be updated for every future video.

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

Exact-maths tricks:

- GSAP `sine.inOut` is exactly (1 − cos πp)/2, i.e. sin²(πp/2), so a `yoyo` tween with `sine.inOut` traces sin² (Rabi oscillation; `A.rotate` on a `sc.rod` is an exact pendulum). Use `repeat: n` with an odd n for full cycles, never `-1`.
- Two views of one quantity (an analogy and a plot, a level diagram and a curve) share the same start, duration and ease, so they cannot disagree.
- Equations: `sc.eq` parts take HTML (`<sub>`, `²`, italics), one key per term you will reveal, tint, highlight or swap. For real LaTeX, render SVG offline (e.g. `latex` + `dvisvgm`, or vendored KaTeX) into `assets/` and place it as an image. The local checker has no EB Garamond, so equation positions there are approximate; trust the HyperFrames snapshot for them.

## 8. Verify, then render

**Gate 1 — geometry (mandatory, every time the scene or script changes):**

```bash
python3 check_layout.py . --annotate snaps/layout     # samples every cue + 0.6 s, each beat end, the end
```

Fix **every ERROR** before going further: `arrow_detached`/`arrow_pierces` (move the shape or use `fromSide`/`toSide`, never nudge the arrow by hand; a shape moved with a raw `tl.to` instead of `A.move` leaves its arrows stale), `arrow_too_small` (shapes too close or a hand-drawn hairline: move shapes apart or rebuild with `sc.arrow`), `text_overlap`, `arrow_crosses` (re-route with `bend` or move the obstacle), `touch`, `off_canvas`. Look at the annotated PNGs in `snaps/layout/` — offenders are outlined in red. Weigh each WARN (`shape_overlap`, `scale_mismatch`, `unsafe_text`, `small_text`). Re-run until it exits 0.

**Gate 2 — HyperFrames:**

```bash
npx -y hyperframes check --json                                 # fix every error; weigh each warning
npx -y hyperframes snapshot --at <cue times + 0.3 s, comma-separated> -o snaps --no-end
```

- Look at `snaps/contact-sheet.jpg` as a viewer would: is each frame beautiful and does it say what the narration says at that moment? Labels next to what they name, equation readable, dot on the curve, focal element obvious, the last line held at least 2.6 s.
- A `line_unread` warning means the closing line needs a longer hold: raise `--tail` and re-run narrate.py.
- Then render and measure:

```bash
npx -y hyperframes render -o renders/explainer.mp4
npx -y hyperframes audio renders/explainer.mp4 --json   # loudness about -16..-13 LUFS, no clipping, silences only between beats
ffmpeg -nostdin -v error -ss <t> -i renders/explainer.mp4 -frames:v 1 frame.png   # spot-check frames of the final file
```

Deliver the MP4 and a tarball of the project without `node_modules` and `renders`, plus `script.txt`. Say what was checked (geometry gate result, HyperFrames check, loudness, final length vs target): sync is measured, not heard, so ask the person to watch once. The agent cannot judge motion smoothness or the voice's prosody at split points. If a split sounds choppy, move the marker one word earlier or later, or drop it, and re-run narrate.py.

No music by default. If the person wants a bed, add an `<audio id="music">` at about 0.14 volume under the voice.
