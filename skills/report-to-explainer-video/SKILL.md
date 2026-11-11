---
name: "report-to-explainer-video"
description: "Turn a report, paper or notes into a visually rich, animated narrated explainer video (MP4) with kokoro-onnx voice and HyperFrames: asks the target length first, storyboards narration and on-screen explanation together, has a scientific reviewer subagent check the storyboard, explains through animated diagrams, plots and equations synced to spoken words, and gates every frame with a geometry checker."
---

# Report → animated, narrated explainer video (kokoro-onnx + HyperFrames)

Makes a 1920×1080 explainer in the spirit of 3Blue1Brown: the picture does the explaining, the voice guides the eye, and every visual lands on the word that names it. The voice is the clock: **narration is generated first, its exact timings are written to `assets/cues.js`, and the animation reads them**, so nothing is placed by ear.

Three things are non-negotiable:

1. **Ask the length first** (section 0). Everything else — number of ideas, beats, scenes — is sized from it.
2. **It is organised like a good conference talk and explains through plots** (section 3). It covers every idea in the report, with no hooks: context first, one conclusion per scene, explicit links or explicit changes of part, scaling laws and magnitudes on the plots, each scene introduced from the previous picture, and motion only where something changes. Shapes come from the predefined library `shapes.js` (section 7), never hand-placed arrows.
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

The Ideas column is how many ideas get full treatment at that length. The video still covers every idea in the report (section 3, rule 1): the others get one or two beats each. If even that cannot fit, keep every idea, exceed the target, and say so in the delivery note.

After narrate.py prints the total, compare it with the target: more than ±15 % off → cut or add beats, not speed (`--speed` stays within 0.95–1.05).

## 1. Set up (once per session)

**Dependencies: check, never install by default.** This skill does not install packages or download models on its own, and never creates a virtualenv or `node_modules` per work folder. Check what is there:

```bash
python3 -c "import kokoro_onnx, soundfile, numpy" ; python3 -c "import playwright"   # or the project's own interpreter
which ffmpeg ffprobe node                                  # Node >= 22 and ffmpeg are required by HyperFrames
ls ~/.cache/explainer-tts/*.onnx ~/.cache/explainer-tts/voices-*.bin 2>/dev/null   # kokoro model + voices, if already downloaded
```

Needed: `kokoro-onnx`, `soundfile`, `numpy` (narrate.py); Python `playwright` with a Chromium (check_layout.py); `ffmpeg`, `node`; the kokoro model `kokoro-v1.0.int8.onnx` (88 MB) and `voices-v1.0.bin`; `hyperframes` and `gsap` (npm, per `video/` project). Use what is found and record the interpreter and model paths as `PY`, `MODEL`, `VOICES`.

If something is missing, list it to the person and decide where it belongs from the project hierarchy: an existing venv, conda env, `requirements`/`pyproject`/`package.json` of the repo or a parent folder, or a shared user-level cache such as `~/.cache/explainer-tts`. Prefer extending what the project already uses over creating something new, and install into one shared location, never into the work folder. If the right place is not clear, or the install is large or system-wide, ask the person before installing. Builders (sub-agents) never install or upgrade packages: the lead resolves dependencies once before launching them.

Only after the person agrees (or the project clearly already installs this way), the commands are: `pip install kokoro-onnx soundfile numpy playwright` into the chosen environment, then `python3 -m playwright install chromium-headless-shell`; the model files come from GitHub releases (works where huggingface.co is blocked):

```bash
for f in kokoro-v1.0.int8.onnx voices-v1.0.bin; do
  curl -sL -o ~/.cache/explainer-tts/$f https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/$f; done
```

Then create the work folder:

```bash
W=$PWD/explainer-work; mkdir -p "$W/tts"       # place $W as described next
git check-ignore -q "$W" && echo IGNORED        # if printed, pick another place
```

**Where the work folder goes.** Put `$W` where it survives and can be committed: next to the source report (for a repo with per-study `reports/`, use `<study>/reports/<report-name>_video/` or the repo's equivalent), never in a scratch, temp or gitignored folder. Check with `git check-ignore -q "$W" && echo IGNORED` before writing anything; if it is ignored, pick another place. Large regenerable files stay out of git: add `node_modules/`, `renders/`, `assets/voice/` and `.hyperframes/` to a `.gitignore` inside `$W`. Never put a venv or model files in `$W`: they live in the shared environment and cache from the dependencies step.

**Get the toolkit.** The code ships with this skill in its `scripts/` folder (`narrate.py`, `shapes.js`, `check_layout.py`, `build_index.py`, `scene_util.js`, `API.md`, `example_scene.html`); copy that folder to `$W/toolkit`. If the folder is missing, read the same files from the *Explainer Video Toolkit* artifact (https://claude.ai/artifact/9ppFu6e9HSXbNn7sL5enTM) with the Artifact tool — `action: "read"`, that `url`, `paths: ["narrate.py", "shapes.js", "check_layout.py", "build_index.py", "scene_util.js", "API.md", "example_scene.html"]`, `out_dir: "$W/toolkit"`. If neither works, stop and tell the person; do not rewrite the scripts from memory.

Copy `narrate.py` into `$W/tts/` (script only). Then create the project and drop in the two helpers:

```bash
export HYPERFRAMES_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1      # HyperFrames sends telemetry by default
cd "$W" && npx -y hyperframes@latest init video --example blank --non-interactive
cd video && npm i gsap && mkdir -p assets compositions && cp node_modules/gsap/dist/gsap.min.js assets/
cp "$W/toolkit/shapes.js" assets/ && cp "$W/toolkit/check_layout.py" . && cp "$W/toolkit/example_scene.html" compositions/explain.html
cp "$W/toolkit/build_index.py" . && cp "$W/toolkit/scene_util.js" assets/     # multi-scene videos only (section 6)
```

Sandbox fixes (Claude Cowork cloud workspace and similar locked-down machines):

- **CDN blocked** (cdn.jsdelivr.net): templates load GSAP from it and the render fails with `Cannot read properties of null (reading 'timeline')`. Vendor it (above) and point the `<script>` at `assets/gsap.min.js`. Same for KaTeX or any other library; never fetch at render time.
- **No Chrome found**: `export HYPERFRAMES_BROWSER_PATH=$(ls -d /opt/pw-browsers/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell | head -1)`.
- **Hugging Face / ElevenLabs blocked**: kokoro-onnx from GitHub releases is the working natural voice. `espeak-ng` (apt) is a robotic last resort. HyperFrames' Whisper transcription also needs Hugging Face; this workflow does not need it.
- Bash `while read` loops that call Python or ffmpeg lose lines because the child reads stdin: use `</dev/null` / `-nostdin`, or drive everything from Python (narrate.py does).
- No GPU is needed. A 25 s video renders in about 1 min on 2 CPUs.

## 2. Read the source, pick the ideas, choose the register

- Read the report (`pdftotext -layout file.pdf -` for PDFs, or the Read tool). List every idea in the report: each section, result, mechanism and conclusion. All of them go into the video; you may reorder, merge and reword them, but not drop any (section 3, rule 1). The length table only decides how deep each one goes.
- Every claim, number and equation must trace to the report. Do not invent values; mark anything illustrative as illustrative. Check the science of each step before animating it: a beautiful wrong diagram is worse than none.

**Popular register** (general audience): illustrations first. Concrete objects (a drawn atom, a pendulum, a coin, a city map), metaphors made visible, at most one equation in the whole video and only if it is famous or very short. Numbers appear as comparisons ("as long as a football pitch"), not units.

**Scientific register** (peers, students): equations first. Put the **main equation(s)** of the report on screen — one to three, not every line of derivation — typeset properly. **Every equation shown must be given intuition in the same beat or the next**, by one of:

- **a plot of what it says**: draw the curve the equation describes, then tie each symbol to a visual feature (colour the symbol and the feature the same, `A.tint`; pulse both on the word that names them). E.g. P(t)=sin²(Ωt/2): the curve, Ω as the speed of the swing, the peak as the π-pulse.
- **a well-known analogy**: a pendulum for Rabi oscillation, a spinning top for precession, springs for coupled modes, water in pipes for current, a ball in a bowl for a potential. Draw the analogy next to the equation and move them together (same start, duration, ease), so the viewer sees they are the same motion.
- **a limiting case** animated: set a parameter to 0 or ∞ and show the plot collapse to something obvious.

Mixed audiences: scientific structure, popular pictures — keep the main equation, lead with the analogy.

## 3. Narrative and visual explanation

The video is organised like a good talk at a physics conference, given to people in the same research community: not a popular-science video and not a TED talk. There are no hooks, teasers or rhetorical questions, neither at the start nor at the start of a section. The audience should get the intuition, always know where the talk is going, follow the flow, and understand each conclusion. Pacing is calm and deliberate.

Two bodies of advice are used, for different things:

- **The narrative** (order, conclusions, links between scenes) follows advice on conference talks and seminars: Alon, Mermin, Halmos, Peyton Jones, Doumont, Alley's assertion–evidence slides, and APS guidance for contributed talks.
- **The visual explanation** (what to draw, which plot, how it moves) follows explanation-first channels such as 3Blue1Brown, Welch Labs and Mathologer, and Mayer's research on learning from narrated animation. Their narrative devices, such as hooks, question-and-answer loops and cliffhangers, are not used.

Design the narrative and the pictures together with the words (section 4). The reviewer checks the storyboard against every numbered rule.

### Narrative: organised like a conference talk

1. **Cover the whole report.** The storyboard header lists every idea in the report: each section, result, mechanism and conclusion. Every one of them is explained in some scene. Ideas may be reordered, merged or reworded for clarity, but none is dropped. The target length decides how deep each idea goes, not whether it appears.
2. **Context first, for the right audience.** Assume the audience knows the general field but not the specific physics or details of this report. The first scene therefore gives that context briefly: the physical system, the problem the report addresses, and what is needed to follow it. No hook, teaser, anecdote or rhetorical question: the first beat names the system, and the picture starts explaining from that beat.
3. **A plan for reports with several parts.** When the report has several parts, a compact plan of them (short labels, or a small version of each part's key picture) appears on screen after the context. A short spoken preview is welcome while the plan is on screen. The general rule: nothing is ever spoken without the relevant picture on screen.
4. **Short methods.** Only what is needed to trust the results: at most one scene in videos under about 3 min.
5. **One conclusion per scene.** The scene's conclusion line is a declarative physics claim of about 25 words or fewer, never a label such as "Results" or "Setup". It is spoken in the scene, by the last beat at the latest, while the picture shows its evidence. Two conclusions mean two scenes.
6. **Conclusion or lead.** Each scene's last beat either states the scene's conclusion, or, when the conclusion needs the next scene, says explicitly what that next step is and why it is needed.
7. **Link only what is linked.** When a scene follows logically from an earlier conclusion, its first beat says how: therefore, but, to test this, this implies, this constrains. When the report moves to an unrelated part, do not invent a link: say plainly that this part is done and the talk moves to the next one, and bring the plan back with that part highlighted. "Next" alone is never a logical link, but a plain, explicit change of part is fine.
8. **Summary test.** Read in order, the conclusion lines alone summarise the whole report, with no idea missing and no gap within a part.
9. **Tell, show, restate.** Each result is said, shown with its evidence, and restated in the conclusion line.
10. **Level.** Scientific register: no beat explains general textbook material of the field, but the report-specific physics is explained in full. Popular register: same structure, but name and picture the key background before it is used. In both, every term is defined when it is first spoken, and at most one new idea enters per beat.
11. **Close on the conclusions.** The last scene restates the conclusions of every part, in words that match the earlier conclusion lines, adds no new data, and gives the report's outlook briefly if it has one. The last frame shows the conclusions and holds long enough to read them.
12. **Plain spoken style.** Say "we", use short sentences, never read like a paper abstract, no hype, and claim nothing beyond the report.

### Visual explanation: what to draw and how

13. **Prefer plots.** Any claim that one quantity depends on another, or that one thing exceeds another, is shown as a plot, not only said or written as an equation. Otherwise use one diagram that grows, a worked example travelling through the steps, or a continuous transformation. Never bullet slides, icon rows, or a whole diagram dropped at once. Redraw figures from the report for the screen; never paste them.
14. **Read the plot before using it.** In the beat where a plot appears, the narration names both axes, with quantity and scale. The next beat points to the one feature that matters (a peak, a slope, a crossing, a scaling), and the last storyboard column names it.
15. **Build plots in steps**, one beat each: axes, then one curve, then the feature or comparison the scene's conclusion is about.
16. **Compare on shared axes.** Theory and experiment, or two conditions, share axes in one panel with direct labels, uncertainty is shown or mentioned, and agreement or deviation is stated in numbers. To vary a parameter, morph one curve on fixed axes (`A.morph`) or use small multiples with shared scales.
17. **Give the scaling and the orders of magnitude.** Whenever a claim says that changing x changes y, show how y depends on x: the simplified dependence on screen next to the plot (y ∝ x², y ≈ a/x, y ∝ e^(−x/x₀)), and the orders of magnitude of x and y in the report's regime, as real values on the axis ticks or as short labels such as "~10 µs". Values come from the report; simplified forms are marked with ∝ or ≈.
18. **Picture before formalism.** An equation comes after its physical picture, at most one per scene, and its simplified form is preferred unless the full expression is itself a main result of the report. Each symbol is defined in speech and coloured like its visual counterpart (`A.tint`), and the equation's meaning is said in words. No derivation chains on screen.
19. **Sanity check.** Each model or derived result gets a limiting case, toy model or known regime, animated on its plot, in videos of 2 min and longer, and in shorter ones when the result is central.
20. **Show a thing when it is named.** An object or quantity appears or is highlighted on the cue of the word that names it, not before or after.
21. **Every motion represents something.** Arrows grow from cause to effect; curves draw left to right with a tracer dot on the tip; changing quantities are animated, not swapped; transformations morph instead of cutting. No decorative motion: no drift, pulse or glow that does not point at what is being explained.
22. **One thing moves at a time, then holds.** Within a beat only the element being explained moves. Once a scene's conclusion has been spoken, nothing new enters before the next beat begins, so the evidence stays still and readable. A still picture under explaining narration is fine.
23. **Fixed visual vocabulary.** The storyboard header fixes a colour and symbol for each quantity, and they never change between plot, diagram and equation. One focal element per beat in its colour, the rest in `line`/`dim`.
24. **Minimal text.** On screen only labels, the equation, scaling laws and magnitudes, the plan, and at a scene's conclusion an optional caption of the claim, about 8 words or fewer, next to its evidence. Never the narration.
25. **Carry the picture into the next scene.** As in a slide talk, a scene's last picture normally stays on screen while the next scene starts, and the next scene is introduced from it: the element that continues is moved, zoomed into or transformed, the rest is dimmed and fades once the new picture has taken over. This is a strong preference, not an absolute rule: when the talk clearly moves to another section of the report, the new scene may start from an empty frame, provided its first picture appears as the narration begins. Within a scene keep at most ~7 objects, and fade scaffolding (`A.out`) once it is no longer needed.

**Craft**

- **Composition**: the main plot or diagram fills about 60 % of the frame; generous spacing between shapes (an arrow between two shapes needs at least ~120 px of room); align to a grid (multiples of 20 px); joined shapes of similar size.
- **Finish**: dark ground, soft glow on tracer dots, rounded strokes, eased entrances (`power3.out`), staggered labels.
- **Longer videos** (2 min and longer): one scene per finding, and a final scene that brings the key plots back beside the conclusions.

## 4. Write the storyboard: words and pictures together

The explanation is carried as much by the picture as by the voice, so both are written together, beat by beat, in one file: `storyboard.md`. Never write the narration first and decorate it afterwards. For every beat, decide at the same time what is said, what happens on screen, and how that picture explains the idea.

The file starts with a header that lists every idea in the report with the scene that covers it, the plan, and the visual vocabulary. Then comes one Markdown table per scene, one row per beat, four columns. Before its table, each scene states its conclusion line and its link: how it follows from an earlier conclusion, or that it starts a new part of the report:

```markdown
Audience: scientific; knows the general field, not this report's physics. Target: about 1 min.
Report ideas, all covered:
1. Under resonant drive the excitation probability oscillates in time (scene 1).
2. The Rabi frequency Ω is proportional to the drive amplitude (scene 1).
3. A pulse lasting π/Ω, a π pulse, flips the qubit completely (scene 1).
Plan: one part, so no plan on screen.
Colours: excitation probability P and the state dot = accent; drive and Ω = blue; levels = line.

## Scene 1: Rabi oscillation

Conclusion: under resonant drive the excitation probability follows sin²(Ωt/2), with Ω proportional to the drive amplitude, so a pulse lasting π/Ω flips the qubit.
Link: first scene; it sets the context, a two-level qubit under resonant drive.

| id | Spoken (with [cue] markers) | On screen | How the picture explains it |
|---|---|---|---|
| vo1 | We drive a superconducting qubit with a [drive]resonant microwave and record the [ylabel]probability of finding it excited, versus [xlabel]drive time. | Qubit box at left with two levels, state dot on the lower one. `drive`: drive circle at right, wavy arrow grows into the qubit. `ylabel`: axes draw below, P label in the accent colour. `xlabel`: t label appears. | The arrow shows what acts on what. Naming both axes before any data lets the viewer read the plot the moment the curve appears. |
| vo2 | As the drive continues, this probability [osc]swings between zero and one, the way a [pend]pendulum swings between its turning points. | `osc`: P(t) draws left to right with a tracer dot on its tip, and the state dot in the qubit box rises and falls in step. `pend`: a pendulum beside the plot swings with the same timing. | Plot, level diagram and pendulum share one start, duration and ease, so the curve is seen as one continuous rotation, not a jump. |
| vo3 | The swing follows [eq]sine squared of omega t over two, and the Rabi frequency [om]omega is proportional to the drive amplitude. | `eq`: P(t) = sin²(Ωt/2) builds term by term at right. `om`: Ω ∝ A appears beneath it; Ω and the drive arrow tint blue together, and the period 2π/Ω is marked on the time axis. | The shared colour ties Ω to the drive and to the period on the plot. The scaling law says how to change the swing: double the amplitude and the period halves. |
| vo4 | So stopping at the [peak]first maximum, a [pilabel]pi pulse, leaves the qubit [flip]fully excited. | `peak`: the tracer stops, a mark with guides on the first maximum. `pilabel`: label "π pulse" under the mark, with its duration π/Ω on the axis. `flip`: ring flash on the state dot, now on the upper level; then everything holds still. | Stopping the dot at the maximum shows that the pulse length is chosen, not given. The dot on the upper level is the evidence for the conclusion line. |
```

Column rules:

- **Spoken**: one or two sentences, about 19 words or fewer. Put a `[cue]` marker immediately **before the word the picture should land on**. Write maths the way it is spoken ("sine squared of omega t over two"); the typeset form goes on screen. Do not read the on-screen text word for word.
- **On screen**: the objects present and what moves, organised by cue. Every cue in the Spoken cell appears here with the event that lands on it, and no visual event happens without a cue or a stated offset from one. Say what is faded out. Name shapes.js builders and animations (section 7) where it helps. Something meaningful moves in every beat.
- **How the picture explains it**: what a viewer would understand from the picture with the sound off, and how it completes the sentence: cause and effect from an arrow's direction, a symbol tied to its curve by a shared colour, an analogy moving in step, a limiting case collapsing. If this cell only says that the picture "illustrates" the sentence, the beat has no visual explanation yet: redesign it.
- No `|` character inside any cell.

Other rules:

- Number of beats from the length table (section 0). Follow the narrative rules of section 3: every idea in the header is covered, the first beat names the system, each scene states its conclusion or leads explicitly into the next, and the last scene restates the conclusions of every part.
- Cue names are letters, digits, `_` or `-`, unique across the storyboard. For multi-scene videos prefix them with the scene (`s2_peak`).
- Aim for one cue every 3–5 s of speech: every cue is a visual event.

The voice tool reads only the id and Spoken columns. Extract them into `script.txt` after every storyboard edit:

```bash
awk -F'|' '$2 ~ /^ *[A-Za-z][A-Za-z0-9_-]* *$/ && $2 !~ /^ *id *$/ { gsub(/^ +| +$/, "", $2); gsub(/^ +| +$/, "", $3); print $2 "|" $3 }' storyboard.md > script.txt
```

The On screen column is the build plan for section 6, and the last column is what the snapshots are judged against in section 8.

### Scientific review by a subagent

Do not ask the person to approve the storyboard. Have an independent reviewer subagent check it instead, then fix and carry on without stopping.

Start the reviewer with the Agent tool. Give it only the path of the source report, `storyboard.md`, the target length, the register, and the numbered rules of section 3 copied into the brief. Do not pass your own summary or reasoning, so the review is not anchored on it. Brief it as a referee with these competences:

- **Domain expertise** in the report's field, at the report's level (for a superconducting-qubit report, a quantum-information physicist): every statement, number, unit, sign, regime of validity and causal claim is correct.
- **Source fidelity**, as a journal referee would check it: every claim, value and equation traces to the report, nothing is overclaimed or generalised beyond it, and illustrative values are marked as illustrative.
- **Mathematical rigour**: the equations shown are the report's main ones and are transcribed correctly, the spoken form matches the typeset form, every symbol is defined when it first appears, and notation and colour per quantity stay consistent.
- **Analogies and limiting cases**: each analogy holds in the regime shown and does not suggest something false where it breaks down, and each limiting case is worked out correctly.
- **Visual accuracy**: each planned plot has the right shape and features (period, maxima, asymptotes, scales), axes name the right quantities, and no diagram is physically misleading.
- **Coverage**: every idea in the report, each section, result, mechanism and conclusion, appears in the storyboard, and the header's list of ideas is complete. Reordering and rewording are fine; an omission is an `error`.
- **Talk structure**, as a session chair in the field would judge it: the storyboard follows each numbered rule of section 3. Context comes first with no hook, nothing is spoken without the relevant picture on screen, every scene has one assertion as its conclusion line, links between scenes are stated where they exist and never invented between unrelated parts, plots are used wherever a dependence or comparison is claimed, axes are named before data is read, dependences come with their scaling and orders of magnitude, every equation follows its picture, each scene is introduced from the previous picture except at a clear change of section, and there is no decorative motion. Each issue names the rule it breaks.
- **Pedagogy**: ideas build in order with prerequisites first, each beat's picture and sentence say the same thing, the last column holds a real visual explanation, and the level suits the register.
- **Timing**: total words against the target length (about 150 words per minute), about 19 words or fewer per beat, a cue every 3–5 s, and every Spoken cue present in On screen.

Ask for a verdict, PASS or REVISE, and a list of issues. Each issue gives the beat id, a severity and a concrete fix. Severity is `error` for scientifically wrong or unsupported by the report, `major` for misleading or confusing, and `minor` for style.

Fix every error and major, extract `script.txt` again, and send the revised storyboard to a fresh reviewer. Stop at PASS or after three rounds. If a point is still disputed after three rounds, keep the scientifically safer version and list the point in the delivery note. Minor issues are at your judgement.

If no subagent tool is available, run the same review yourself as a separate pass: reread the source rather than relying on memory, follow the checklist above, and say in the delivery note that the review was not independent.

## 5. Generate the narration and cues

```bash
cd "$W/video" && "$PY" -I "$W/tts/narrate.py" script.txt --project . \
  --model "$MODEL" --voices "$VOICES" --voice af_heart
```

How it syncs: each beat is synthesised in fragments split at the markers. Fragments are trimmed of edge silence and joined, with a natural pause only where the text has punctuation. A cue's time is the exact length of the audio before it, so no aligner model is needed. Each beat becomes one loudness-normalised clip (−16 LUFS, −1.5 dBTP). Beats are laid end to end with a 0.45 s gap starting at 0.6 s.

It writes `assets/voice/<id>.wav`, `assets/cues.js` (`window.CUES = {vo1_start, vo1_end, drive, …, total}`, all in root seconds) and `narration.json`. It prints the `<audio>` tags and the total duration — **compare the total with the target length now** (section 0).

Options: `--voice` (e.g. `af_heart`, `af_bella`, `am_michael`, `bf_emma`, `bm_george`), `--speed 0.95–1.05`, `--gap`, `--start`, `--tail` (hold after the last word, default 2.8 s so the closing line can be read).

Re-run it whenever the storyboard changes, after extracting `script.txt` again. The animation follows automatically because it only reads `window.CUES`.

## 6. Build the composition

Build from the storyboard's On screen column: each cue there becomes an animation call at that cue, in the order written.

`index.html` (root): load GSAP, the cues and shapes.js before any scene, mount the scene hosts, and paste the printed `<audio>` tags. Prefer one composition holding all scenes in one timeline (`S.cues(0)`), so a scene's last picture can stay on screen while the next scene starts (section 3, rule 25). Split into several hosts only for long videos, and then let the earlier host's `data-duration` run into the first beat of the next one. Set the root's `data-duration` to `CUES.total`; each scene host gets its own `data-start`/`data-duration` (one scene: 0 and `CUES.total`).

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

**Several scenes.** Beat ids are `s<N><letter>` (`s1a`, `s1b`, …, `s2a`, …): scene N starts with beat `s<N>a`. After narrate.py, run `python3 build_index.py` in `video/`: it writes `index.html` (one host per scene, scene N from 0.4 s before its first beat to the next scene, all narration clips, every `assets/*.js` loaded) and `assets/scenes.js`. Each scene is `compositions/s<N>.html`: a `<template id="s<N>-template">` with `div#s<N>-root` (data-composition-id `s<N>`, 1920×1080), `div#s<N>-wrap`, `svg#s<N>-svg`, and a script `const { C, sc, tl, end } = SU.begin("s<N>", "<N> · Title"); … end();`. `C` holds scene-local cue times. Plot data computed by the study goes in `assets/data.js` (`window.DATA = {…}`), written by a small export script from the study's stored results, never typed by hand; build_index.py loads it automatically.

**Splitting scenes among builders.** Give each sub-agent two consecutive scenes and one shared brief file. Before launching, write `assets/layout.js` (`window.LAYOUT = { plan: { x0, dx, y, w, h }, … }`) with the positions of every picture that appears in more than one scene: the plan cards, and the final picture of any scene that the next scene starts from (rule 25). Builders read positions from `LAYOUT`, never choose their own for these, and do not edit shared files (`index.html`, `build_index.py`, `cues.js`, `data.js`, `shapes.js`, `scene_util.js`, `layout.js`); missing features are built inside the scene file and reported. Each builder uses its own scratch folder (`<scratch>/s<N>/`). After all return, check the scene joins yourself: snapshot each boundary (last frame of scene N, frames 0.5 s and 1.5 s into scene N+1) and compare.

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

**Moving a composite.** `A.move(tl, [els], t, { scale })` scales each element about its own centre, so a circuit or a plot cannot be shrunk or slid as one picture (links and equation labels also do not follow). Build the picture in a group — `const g = document.createElementNS("http://www.w3.org/2000/svg", "g"); sc.cam.appendChild(g);` — pass `parent: g` to every `sc.*` call of that picture, then tween the group: `tl.to(g, { x, y, scale, svgOrigin: "0 0", duration: 0.8, ease: "power3.inOut" }, t)`. `check_layout.py` measures screen coordinates, so arrows inside stay checked. `A.flash` on a member of a scaled group draws its ring in unscaled coordinates: flash the group, or append the ring to the group.

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

- Look at `snaps/contact-sheet.jpg` as a viewer would: is each frame beautiful, does it show what the storyboard's On screen column promises at that cue, and does it explain what its last column says it explains? Labels next to what they name, equation readable, dot on the curve, focal element obvious, the last line held at least 2.6 s.
- A `line_unread` warning means the closing line needs a longer hold: raise `--tail` and re-run narrate.py.
- Then render and measure:

```bash
npx -y hyperframes render -o renders/explainer.mp4
npx -y hyperframes audio renders/explainer.mp4 --json   # loudness about -16..-13 LUFS, no clipping, silences only between beats
ffmpeg -nostdin -v error -ss <t> -i renders/explainer.mp4 -frames:v 1 frame.png   # spot-check frames of the final file
```

Deliver, next to the source report: the MP4, `storyboard.md` and `script.txt` (narration with cue markers), and the project sources (`$W` without `node_modules`, `renders`, `assets/voice`, `.hyperframes`) either as the folder itself or as a tarball. Never leave any deliverable only in a scratch or gitignored folder. Name the files after the report (`<report>.mp4`, `<report>_video_script.txt`, `<report>_video_project.tgz`) and add a link line to the README that indexes the report. Say what was checked (scientific review verdict, number of rounds and any disputed points, geometry gate result, HyperFrames check, loudness, final length vs target): sync is measured, not heard, so ask the person to watch once. The agent cannot judge motion smoothness or the voice's prosody at split points. If a split sounds choppy, move the marker one word earlier or later, or drop it, and re-run narrate.py.

Smaller notes:

- `hyperframes check --json` reports runtime warnings against `index.html` only, with no scene or line. To find the source, run `check_layout.py --scene` with a `console.warn` hook that prints the stack (run each scene; the stack names the `shapes.js` call). A wrong `A.terms` key, the commonest cause, now throws at the scene gate instead.
- After rendering, a contact sheet of frames at `cue + 1.5 s` for about 25 key cues (ffmpeg `-ss` + `tile=4x7`) is a fast last look; empty axes there are normal when the storyboard draws the curve in the next beat.
- Length: kokoro at speed 1.04 gave about 2.57 words/s including pauses (1291 words → 502 s).

No music by default. If the person wants a bed, add an `<audio id="music">` at about 0.14 volume under the voice.
