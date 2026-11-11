"""Write index.html for a multi-scene video: one host per scene, narration clips from narr.log.

Scenes are found from the cues: beat ids s1a, s2a, ... give cue keys "s1a_start", "s2a_start", ...
Scene N starts 0.4 s before its first beat (scene 1 at 0) and ends where the next starts (last: CUES.total).
Every assets/*.js is loaded: gsap first, then cues.js and data*.js, then shapes.js, scenes.js, scene_util.js,
then any other file. Run from the video/ folder after narrate.py: python3 build_index.py
"""
import json
import re
from pathlib import Path

C = json.loads(re.search(r"window.CUES = (\{.*\});", Path("assets/cues.js").read_text(), re.S).group(1))
names = sorted({m.group(1) for k in C if (m := re.fullmatch(r"(s\d+)a_start", k))}, key=lambda n: int(n[1:]))
missing = [n for n in names if not Path(f"compositions/{n}.html").exists()]
assert names, "no s<N>a_start cues: beat ids must be s1a, s2a, ..."
starts = [0.0] + [round(C[n + "a_start"] - 0.4, 3) for n in names[1:]]
ends = starts[1:] + [C["total"]]
Path("assets/scenes.js").write_text("window.SCENES = " + json.dumps(dict(zip(names, starts))) + ";\n")

order = ["gsap.min.js", "cues.js", "data.js", "shapes.js", "layout.js", "scenes.js", "scene_util.js"]
js = sorted((p.name for p in Path("assets").glob("*.js")), key=lambda f: (order.index(f) if f in order else len(order), f))
scripts = "\n".join(f'  <script src="assets/{f}"></script>' for f in js)
hosts = "\n".join(
    f'    <div id="{n}" data-composition-id="{n}" data-composition-src="compositions/{n}.html" data-start="{s}" '
    f'data-duration="{round(e - s, 3)}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080"></div>'
    for n, s, e in zip(names, starts, ends))
audio = "\n".join("    " + line for line in Path("narr.log").read_text().splitlines() if line.startswith("<audio"))
Path("index.html").write_text(f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=1920, height=1080" />
{scripts}
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    html, body {{ width: 1920px; height: 1080px; overflow: hidden; background: #0f1117; }}
    #root {{ position: relative; width: 100%; height: 100%; background: #0f1117; }}
  </style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="{C['total']}" data-width="1920" data-height="1080">
{hosts}
{audio}
  </div>
  <script>window.__timelines = window.__timelines || {{}}; window.__timelines["main"] = gsap.timeline({{ paused: true }});</script>
</body>
</html>
""")
print({n: (s, e) for n, s, e in zip(names, starts, ends)})
if missing:
    print("not written yet:", ", ".join(f"compositions/{n}.html" for n in missing))
