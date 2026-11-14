// Runs inside the calibration window. The user drags one rectangle over the five Radiant portraits
// (left of the clock), then one over the five Dire portraits. Rectangles are saved as fractions of the
// screen so a resolution change keeps them roughly right.
(() => {
  const shot = /** @type {HTMLImageElement} */ (document.getElementById("shot"));
  const msg = /** @type {HTMLElement} */ (document.getElementById("msg"));
  const save = /** @type {HTMLButtonElement} */ (document.getElementById("save"));
  const STEPS = [
    { side: "radiant", text: "Drag a box over the <b>five Radiant hero portraits</b> on the top bar (left of the clock)." },
    { side: "dire", text: "Now drag a box over the <b>five Dire hero portraits</b> (right of the clock)." },
  ];
  /** @type {Record<string, {x:number,y:number,w:number,h:number}>} */
  let rects = {};
  let step = 0;
  /** @type {{x:number,y:number}|null} */
  let start = null;
  /** @type {HTMLDivElement|null} */
  let live = null;

  const api = /** @type {any} */ (window).calib;

  function render() {
    document.querySelectorAll(".rect").forEach((e) => e.remove());
    for (const [side, r] of Object.entries(rects)) draw(side, r);
    msg.innerHTML = step < STEPS.length
      ? STEPS[step].text
      : "Both rows set. The dashed lines should split each box into the five portraits. <b>Save</b> if they line up.";
    save.disabled = step < STEPS.length;
  }

  /** @param {string} side @param {{x:number,y:number,w:number,h:number}} r */
  function draw(side, r) {
    const el = document.createElement("div");
    el.className = `rect ${side}`;
    Object.assign(el.style, { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });
    for (let i = 1; i < 5; i++) {
      const line = document.createElement("i");
      line.style.left = `${i * 20}%`;
      el.appendChild(line);
    }
    document.body.appendChild(el);
    return el;
  }

  /** @param {MouseEvent} e */
  const frac = (e) => ({ x: e.clientX / innerWidth, y: e.clientY / innerHeight });

  addEventListener("mousedown", (e) => {
    if (step >= STEPS.length || /** @type {HTMLElement} */ (e.target).closest("#panel")) return;
    start = frac(e);
  });
  addEventListener("mousemove", (e) => {
    if (!start) return;
    const p = frac(e);
    const r = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
    live?.remove();
    live = draw(STEPS[step].side, r);
  });
  addEventListener("mouseup", (e) => {
    if (!start) return;
    const p = frac(e);
    const r = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
    start = null;
    live?.remove();
    live = null;
    if (r.w < 0.02 || r.h < 0.005) return; // a click, not a drag
    rects[STEPS[step].side] = r;
    step++;
    render();
  });

  document.getElementById("redo")?.addEventListener("click", () => { rects = {}; step = 0; render(); });
  document.getElementById("cancel")?.addEventListener("click", () => api.cancel());
  save.addEventListener("click", () => api.save(rects));
  addEventListener("keydown", (e) => { if (e.key === "Escape") api.cancel(); });

  api.onImage((/** @type {string} */ dataUrl) => { shot.src = dataUrl; render(); });
})();
