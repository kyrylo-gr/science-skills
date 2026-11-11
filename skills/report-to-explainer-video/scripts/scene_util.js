/* Scene boilerplate for multi-scene videos: scene-local cues, scene, timeline, title, wrapper fade-in/out.
   Needs window.SCENES (written by build_index.py) and window.CUES. Scene file: const { C, sc, tl, end } = SU.begin("s3", "3 · Title"); ... end(); */
window.SU = {
  begin(id, title) {
    const ids = Object.keys(window.SCENES), st = SCENES[id], i = ids.indexOf(id);
    const end = i + 1 < ids.length ? SCENES[ids[i + 1]] : CUES.total;
    const C = S.cues(st), sc = S.scene("#" + id + "-svg"), tl = gsap.timeline({ paused: true });
    const wrap = document.getElementById(id + "-wrap"), dur = end - st;
    const ttl = sc.text({ x: 960, y: 140, text: title, size: 46, id: id + "-title" });
    if (i) { tl.fromTo(wrap, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out" }, 0); A.in(tl, ttl, 0.15); }
    else tl.fromTo(ttl, { opacity: 1 }, { opacity: 1, duration: 0.01 }, 0);   // first frame = thumbnail: title already up
    return { C, sc, tl, wrap, dur, end: () => {
      if (i + 1 < ids.length) tl.to(wrap, { opacity: 0, duration: 0.3, ease: "power1.in" }, dur - 0.3);
      else tl.set(wrap, { opacity: 1 }, dur - 0.01);   // last scene holds its final frame
      window.__timelines[id] = tl; } };
  },
};
