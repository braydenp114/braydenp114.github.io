(() => {
  const canvas = document.getElementById("g-canvas");
  if (!canvas) return;

  // Online leaderboard. Paste your Supabase project URL and anon (public) key
  // here to share scores between visitors; see leaderboard.sql for the table.
  // Left empty, scores are kept in this browser only.
  const ONLINE = { url: "", anonKey: "" };

  /* ---------- Court geometry, in canvas units (110 units = 1 metre) ---------- */

  // The canvas is taller than the court needs so high, arcing shots stay in view
  const W = 960;
  const H = 680;
  const M = 110;
  const FLOOR = 640;
  const GRAVITY = 9.81 * M;
  const BOARD = { x: 900, top: FLOOR - 437, bottom: FLOOR - 319 };
  const RIM = { y: FLOOR - 335, front: 834, back: 884 };
  const RIM_CX = (RIM.front + RIM.back) / 2;
  const BALL_R = 13;
  const RIM_R = 3;
  const RELEASE_Y = FLOOR - 2.1 * M;
  const FT_X = 390;
  const THREE_X = RIM_CX - 6.75 * M;
  // Spots after a make, as distances from the rim in metres
  const SPOTS = [2.8, 3.6, 5.2, 6.0, 7.0, 7.3].map((d) => RIM_CX - d * M);
  const ROUND_SECONDS = 45;
  const AIM_SECONDS = 0.28; // the aim line stops well short of the hoop
  const MIN_ANGLE = (12 * Math.PI) / 180;
  const MAX_ANGLE = (82 * Math.PI) / 180;
  const MIN_POWER = 420;
  const MAX_POWER = 1250;

  const $ = (id) => document.getElementById(id);
  const ui = {
    stage: $("g-stage"),
    start: $("g-start"),
    play: $("g-play"),
    score: $("g-score"),
    time: $("g-time"),
    spot: $("g-spot"),
    status: $("g-status"),
    end: $("g-end"),
    final: $("g-final"),
    form: $("g-form"),
    initials: $("g-initials"),
    save: $("g-save"),
    msg: $("g-msg"),
    list: $("lb-list"),
    note: $("lb-note"),
  };

  const ctx = canvas.getContext("2d");
  const css = getComputedStyle(document.documentElement);
  const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const C = {
    paper: token("--paper", "#fcfcfb"),
    surface: token("--surface", "#f4f4f2"),
    surface2: token("--surface-2", "#ececea"),
    ink: token("--ink", "#141414"),
    ink2: token("--ink-2", "#55555a"),
    ink3: token("--ink-3", "#8b8b8f"),
    line: token("--line", "#e5e5e2"),
    line2: token("--line-2", "#d0d0cc"),
    ball: token("--ball", "#e0742a"),
    iris: [token("--iris-g", "#7fe3bc"), token("--iris-b", "#8db4ff"), token("--iris-v", "#bba2ff"), token("--iris-r", "#ffa3b5")],
  };

  const state = {
    mode: "idle", // idle, playing, over
    score: 0,
    time: ROUND_SECONDS,
    spotX: FT_X,
    angle: (45 * Math.PI) / 180,
    power: 700,
    ball: null,
    shot: null,
    resetIn: 0,
    netSwing: 0,
    flash: 0,
    lastScore: null,
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const spotValue = (x) => (x <= THREE_X ? 3 : 2);
  const spotName = (x) => (x === FT_X ? "Free throw" : x <= THREE_X ? "Three" : "Mid-range");

  const placeBall = () => {
    state.ball = { x: state.spotX, y: RELEASE_Y, vx: 0, vy: 0, spin: 0 };
    state.shot = null;
  };

  const updateHud = () => {
    ui.score.value = String(state.score);
    ui.time.value = String(Math.ceil(state.time));
    ui.spot.value = `${spotName(state.spotX)}, ${spotValue(state.spotX)} pts`;
  };

  /* ---------- Shooting and physics ---------- */

  const shoot = () => {
    if (state.mode !== "playing" || state.shot || state.resetIn > 0) return;
    state.ball.vx = state.power * Math.cos(state.angle);
    state.ball.vy = -state.power * Math.sin(state.angle);
    state.shot = { t: 0, touched: false, scored: false, bounces: 0 };
    ui.status.textContent = "";
  };

  const bounceOffPoint = (b, px, py) => {
    const dx = b.x - px;
    const dy = b.y - py;
    const dist = Math.hypot(dx, dy);
    const min = BALL_R + RIM_R;
    if (dist >= min || dist === 0) return false;
    const nx = dx / dist;
    const ny = dy / dist;
    b.x = px + nx * min;
    b.y = py + ny * min;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= 1.6 * vn * nx;
      b.vy -= 1.6 * vn * ny;
      b.vx *= 0.9;
      b.vy *= 0.9;
    }
    return true;
  };

  const physicsStep = (h) => {
    const b = state.ball;
    const s = state.shot;
    const prevY = b.y;
    b.vy += GRAVITY * h;
    b.x += b.vx * h;
    b.y += b.vy * h;
    b.spin += (b.vx * h) / BALL_R;

    if (bounceOffPoint(b, RIM.front, RIM.y) || bounceOffPoint(b, RIM.back, RIM.y)) s.touched = true;

    // Backboard face
    if (b.vx > 0 && b.x + BALL_R > BOARD.x && b.x < BOARD.x + 6 && b.y > BOARD.top - BALL_R && b.y < BOARD.bottom + BALL_R) {
      b.x = BOARD.x - BALL_R;
      b.vx = -b.vx * 0.55;
      s.touched = true;
    }

    // Through the hoop: crossing the rim plane downwards, between the rim edges
    if (!s.scored && b.vy > 0 && prevY < RIM.y && b.y >= RIM.y && b.x > RIM.front + RIM_R && b.x < RIM.back - RIM_R) {
      s.scored = true;
      state.netSwing = 1;
      state.flash = 1;
    }

    // Floor
    if (b.y + BALL_R > FLOOR) {
      b.y = FLOOR - BALL_R;
      b.vy = -b.vy * 0.55;
      b.vx *= 0.8;
      s.bounces += 1;
    }
  };

  const finishShot = () => {
    const s = state.shot;
    if (s.scored) {
      const swish = !s.touched;
      const pts = spotValue(state.spotX) + (swish ? 1 : 0);
      state.score += pts;
      ui.status.textContent = swish ? `Swish. +${pts}` : `Good. +${pts}`;
      const options = SPOTS.filter((x) => x !== state.spotX);
      state.spotX = options[Math.floor(Math.random() * options.length)];
    } else {
      ui.status.textContent = s.touched ? "Off the rim. Same spot." : "Missed. Same spot.";
    }
    state.shot = null;
    state.resetIn = 0.45;
    updateHud();
  };

  const update = (dt) => {
    if (state.mode === "playing") {
      state.time = Math.max(0, state.time - dt);
      ui.time.value = String(Math.ceil(state.time));
    }

    if (state.shot) {
      const steps = Math.ceil(dt / (1 / 240));
      const h = dt / steps;
      for (let i = 0; i < steps && state.shot; i++) physicsStep(h);
      const b = state.ball;
      const s = state.shot;
      s.t += dt;
      const gone = b.x > W + BALL_R * 2 || b.x < -BALL_R * 2;
      const settled = s.bounces >= 2 || s.t > 4;
      const dropped = s.scored && b.y > RIM.y + 70;
      if (gone || settled || dropped) finishShot();
    } else if (state.resetIn > 0) {
      state.resetIn -= dt;
      if (state.resetIn <= 0) {
        state.resetIn = 0;
        placeBall();
      }
    }

    state.netSwing = Math.max(0, state.netSwing - dt * 1.6);
    state.flash = Math.max(0, state.flash - dt * 1.4);

    // The round ends once time is up and the last shot has landed
    if (state.mode === "playing" && state.time === 0 && !state.shot) endRound();
  };

  /* ---------- Drawing ---------- */

  const draw = () => {
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, W, H);

    // Floor, with the paint from the free throw line to the baseline
    ctx.fillStyle = C.surface;
    ctx.fillRect(0, FLOOR, W, H - FLOOR);
    ctx.fillStyle = C.surface2;
    ctx.fillRect(FT_X, FLOOR, W - FT_X, H - FLOOR);
    ctx.fillStyle = C.ink;
    ctx.fillRect(0, FLOOR - 1, W, 2);

    // Court markings on the floor (their labels are HTML, placed once below)
    ctx.fillStyle = C.ink;
    [FT_X, THREE_X].forEach((x) => ctx.fillRect(x - 1, FLOOR, 2, 16));

    // Where the shooter stands
    ctx.fillStyle = C.line2;
    ctx.beginPath();
    ctx.ellipse(state.spotX, FLOOR + 3, 20, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Pole and arm
    ctx.fillStyle = C.line2;
    ctx.fillRect(930, FLOOR - 390, 8, 390);
    ctx.fillRect(906, FLOOR - 382, 28, 6);

    // Backboard, side on
    ctx.fillStyle = C.paper;
    ctx.fillRect(BOARD.x, BOARD.top, 6, BOARD.bottom - BOARD.top);
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(BOARD.x, BOARD.top, 6, BOARD.bottom - BOARD.top);

    drawHoopBack();
    drawAim();
    drawBall();
    drawHoopFront();
  };

  const drawAim = () => {
    if (state.mode !== "playing" || state.shot || state.resetIn > 0) return;
    const vx = state.power * Math.cos(state.angle);
    const vy = -state.power * Math.sin(state.angle);
    for (let t = 0.035; t <= AIM_SECONDS; t += 0.028) {
      const x = state.ball.x + vx * t;
      const y = state.ball.y + vy * t + 0.5 * GRAVITY * t * t;
      ctx.globalAlpha = 0.85 * (1 - t / AIM_SECONDS) + 0.1;
      ctx.fillStyle = C.ink2;
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  const drawBall = () => {
    const b = state.ball;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.spin);
    ctx.fillStyle = C.ball;
    ctx.beginPath();
    ctx.arc(0, 0, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(20, 20, 20, 0.55)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-BALL_R, 0);
    ctx.lineTo(BALL_R, 0);
    ctx.moveTo(0, -BALL_R);
    ctx.lineTo(0, BALL_R);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-BALL_R * 1.15, 0, BALL_R * 0.8, -0.9, 0.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(BALL_R * 1.15, 0, BALL_R * 0.8, Math.PI - 0.9, Math.PI + 0.9);
    ctx.stroke();
    ctx.restore();
  };

  /* The hoop, seen slightly from above: the rim is a flat ellipse and the net
     is a tapered diamond mesh. Strands on the far side are drawn before the
     ball and the near side after it, so the ball drops through the net. */
  const NET = { strands: 14, rows: 5, depth: 58, rimRy: 5, bottomRx: 13, bulge: 3 };
  const RIM_RX = (RIM.back - RIM.front) / 2;

  // A point on strand angle a, a fraction t of the way down the net
  const netPoint = (a, t, sway, lift) => {
    const rx = RIM_RX + (NET.bottomRx - RIM_RX) * t + NET.bulge * Math.sin(Math.PI * t);
    const ry = NET.rimRy * (1 - 0.45 * t);
    const drop = NET.depth * t * (1 - lift * 0.35);
    return { x: RIM_CX + Math.cos(a) * rx + sway * t, y: RIM.y + drop + Math.sin(a) * ry };
  };

  const netMotion = () => ({
    sway: Math.sin(performance.now() / 70) * 6 * state.netSwing,
    lift: state.netSwing * Math.abs(Math.sin(performance.now() / 110)),
  });

  const drawNet = (near) => {
    const { sway, lift } = netMotion();
    const angles = Array.from({ length: NET.strands }, (_, i) => (i / NET.strands) * Math.PI * 2);
    const facing = (a) => Math.sin(a) >= 0; // positive y in the ellipse is the near side
    let colour = near ? C.ink2 : C.line2;
    if (near && state.flash > 0) {
      const g = ctx.createLinearGradient(RIM.front, RIM.y, RIM.back, RIM.y + NET.depth);
      C.iris.forEach((c, i) => g.addColorStop(i / (C.iris.length - 1), c));
      colour = g;
    }
    ctx.strokeStyle = colour;
    ctx.lineWidth = near ? 1.1 : 0.9;
    ctx.lineCap = "round";
    ctx.beginPath();
    angles.forEach((a, i) => {
      const b = angles[(i + 1) % angles.length];
      if (facing(a) !== near && facing(b) !== near) return;
      // Diamond mesh: each row crosses to the neighbouring strand on the next row
      for (let r = 0; r < NET.rows; r++) {
        const t0 = r / NET.rows;
        const t1 = (r + 1) / NET.rows;
        const p = netPoint(a, t0, sway, lift);
        const q = netPoint(b, t1, sway, lift);
        const p2 = netPoint(b, t0, sway, lift);
        const q2 = netPoint(a, t1, sway, lift);
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.moveTo(p2.x, p2.y);
        ctx.lineTo(q2.x, q2.y);
      }
    });
    ctx.stroke();
  };

  const drawRim = (near) => {
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(RIM_CX, RIM.y, RIM_RX, NET.rimRy, 0, near ? 0 : Math.PI, near ? Math.PI : Math.PI * 2);
    ctx.stroke();
    if (near) return;
    // Bracket from the back of the rim to the board
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(RIM.back, RIM.y);
    ctx.lineTo(BOARD.x, RIM.y);
    ctx.moveTo(RIM.back - 4, RIM.y + 2);
    ctx.lineTo(BOARD.x, RIM.y + 12);
    ctx.stroke();
  };

  const drawHoopBack = () => {
    drawNet(false);
    drawRim(false);
  };

  const drawHoopFront = () => {
    drawNet(true);
    drawRim(true);
  };

  [
    [FT_X, "FREE THROW"],
    [THREE_X, "3PT"],
  ].forEach(([x, text]) => {
    const label = document.createElement("span");
    label.className = "court-label";
    label.setAttribute("aria-hidden", "true");
    label.textContent = text;
    label.style.left = `${(x / W) * 100}%`;
    label.style.top = `${(FLOOR / H) * 100}%`;
    ui.stage.insertBefore(label, ui.start);
  });

  /* ---------- Canvas sizing ---------- */

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    draw();
  };

  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener("resize", resize);

  /* ---------- Loop ---------- */

  let last = 0;
  let running = false;
  const frame = (now) => {
    // A frame's timestamp can land just before the time run() recorded
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000) || 0);
    last = now;
    update(dt);
    draw();
    const animating = state.shot || state.resetIn > 0 || state.netSwing > 0 || state.flash > 0;
    if (state.mode === "playing" || animating) requestAnimationFrame(frame);
    else running = false;
  };
  const run = () => {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  };

  /* ---------- Rounds ---------- */

  const startRound = () => {
    state.mode = "playing";
    state.score = 0;
    state.time = ROUND_SECONDS;
    state.spotX = FT_X;
    state.resetIn = 0;
    placeBall();
    updateHud();
    ui.start.hidden = true;
    ui.end.hidden = true;
    ui.stage.classList.add("is-playing");
    ui.status.textContent = "Round started. Move to aim, click to shoot.";
    canvas.tabIndex = 0;
    canvas.focus({ preventScroll: true });
    run();
  };

  const endRound = () => {
    state.mode = "over";
    ui.stage.classList.remove("is-playing");
    canvas.tabIndex = -1;
    ui.final.textContent = String(state.score);
    ui.status.textContent = `Time. You scored ${state.score}.`;
    ui.end.hidden = false;
    ui.initials.value = "";
    ui.initials.removeAttribute("aria-invalid");
    ui.save.disabled = false;
    setMsg("Three letters, A to Z.");
    ui.start.hidden = false;
    ui.play.textContent = "Play again";
    ui.initials.focus({ preventScroll: true });
  };

  ui.play.addEventListener("click", startRound);

  /* ---------- Controls ---------- */

  const toCanvas = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
  };

  const aimAt = (e) => {
    if (state.mode !== "playing" || !state.ball) return;
    const p = toCanvas(e);
    const dx = p.x - state.ball.x;
    const dy = state.ball.y - p.y;
    state.angle = clamp(Math.atan2(dy, dx), MIN_ANGLE, MAX_ANGLE);
    state.power = clamp(380 + Math.hypot(dx, dy) * 1.5, MIN_POWER, MAX_POWER);
  };

  // Mouse aims on move and shoots on click; touch aims while dragging and shoots on release
  let touchAiming = false;
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse" || touchAiming) aimAt(e);
  });
  canvas.addEventListener("pointerdown", (e) => {
    if (state.mode !== "playing") return;
    if (e.pointerType === "mouse") {
      aimAt(e);
      shoot();
    } else {
      touchAiming = true;
      aimAt(e);
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener("pointerup", () => {
    if (!touchAiming) return;
    touchAiming = false;
    shoot();
  });
  canvas.addEventListener("pointercancel", () => (touchAiming = false));

  canvas.addEventListener("keydown", (e) => {
    if (state.mode !== "playing") return;
    const step = (Math.PI / 180) * (e.shiftKey ? 5 : 1);
    const keys = {
      ArrowUp: () => (state.angle = clamp(state.angle + step, MIN_ANGLE, MAX_ANGLE)),
      ArrowDown: () => (state.angle = clamp(state.angle - step, MIN_ANGLE, MAX_ANGLE)),
      ArrowRight: () => (state.power = clamp(state.power + (e.shiftKey ? 50 : 10), MIN_POWER, MAX_POWER)),
      ArrowLeft: () => (state.power = clamp(state.power - (e.shiftKey ? 50 : 10), MIN_POWER, MAX_POWER)),
      " ": shoot,
      Enter: shoot,
    };
    if (keys[e.key]) {
      e.preventDefault();
      keys[e.key]();
    }
  });

  /* ---------- Leaderboard ---------- */

  // Three capital letters, minus a short list of obvious slurs and swears.
  // The same rule is enforced by the database (leaderboard.sql).
  const BLOCKED = new Set(["ASS", "CNT", "CUM", "DIC", "DIK", "FAG", "FCK", "FUC", "FUK", "KKK", "KYS", "NAZ", "NGR", "NIG", "PIS", "SEX", "SHT", "TIT", "WTF", "XXX"]);
  const validInitials = (s) => /^[A-Z]{3}$/.test(s) && !BLOCKED.has(s);
  const validEntry = (e) => e && validInitials(e.initials) && Number.isInteger(e.score) && e.score >= 0 && e.score <= 200;
  const rank = (list) => list.filter(validEntry).sort((a, b) => b.score - a.score || a.at - b.at).slice(0, 10);

  const localBoard = {
    key: "bp-free-throws",
    async top() {
      try {
        return rank(JSON.parse(localStorage.getItem(this.key) || "[]"));
      } catch {
        return [];
      }
    },
    async add(entry) {
      const list = await this.top();
      list.push(entry);
      try {
        localStorage.setItem(this.key, JSON.stringify(rank(list)));
      } catch {
        throw new Error("storage");
      }
    },
  };

  const onlineBoard = {
    headers: { apikey: ONLINE.anonKey, Authorization: `Bearer ${ONLINE.anonKey}`, "Content-Type": "application/json" },
    async top() {
      const res = await fetch(`${ONLINE.url}/rest/v1/scores?select=initials,score,created_at&order=score.desc,created_at.asc&limit=10`, { headers: this.headers });
      if (!res.ok) throw new Error(String(res.status));
      const rows = await res.json();
      return rank(rows.map((r) => ({ initials: r.initials, score: r.score, at: Date.parse(r.created_at) })));
    },
    async add(entry) {
      const res = await fetch(`${ONLINE.url}/rest/v1/scores`, {
        method: "POST",
        headers: { ...this.headers, Prefer: "return=minimal" },
        body: JSON.stringify({ initials: entry.initials, score: entry.score }),
      });
      if (!res.ok) throw new Error(String(res.status));
    },
  };

  const board = ONLINE.url && ONLINE.anonKey ? onlineBoard : localBoard;
  ui.note.textContent = board === onlineBoard ? "Top 10 from everyone who has played." : "Your best rounds on this device.";

  // Built with textContent only, so nothing from storage is ever read as HTML
  const renderBoard = (entries) => {
    ui.list.replaceChildren();
    if (!entries.length) {
      const li = document.createElement("li");
      li.className = "is-empty";
      li.textContent = "No scores yet. Play a round to set the first one.";
      ui.list.append(li);
      return;
    }
    entries.forEach((e) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      const score = document.createElement("span");
      name.className = "lb-initials";
      score.className = "lb-score";
      name.textContent = e.initials;
      score.textContent = String(e.score);
      if (state.lastScore && e.initials === state.lastScore.initials && e.score === state.lastScore.score) li.className = "is-you";
      li.append(name, score);
      ui.list.append(li);
    });
  };

  const refreshBoard = async () => {
    try {
      renderBoard(await board.top());
    } catch {
      ui.list.replaceChildren();
      const li = document.createElement("li");
      li.className = "is-empty";
      li.textContent = "The leaderboard could not load. Refresh the page to try again.";
      ui.list.append(li);
    }
  };

  const setMsg = (text, isError = false) => {
    ui.msg.textContent = text;
    ui.msg.classList.toggle("is-error", isError);
  };

  // Letters only, upper case, three at most, as the player types
  ui.initials.addEventListener("input", () => {
    ui.initials.value = ui.initials.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    ui.initials.removeAttribute("aria-invalid");
    setMsg("Three letters, A to Z.");
  });

  ui.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const initials = ui.initials.value.toUpperCase();
    if (!/^[A-Z]{3}$/.test(initials)) {
      ui.initials.setAttribute("aria-invalid", "true");
      setMsg("Enter exactly three letters, A to Z.", true);
      ui.initials.focus();
      return;
    }
    if (BLOCKED.has(initials)) {
      ui.initials.setAttribute("aria-invalid", "true");
      setMsg("Those initials are not allowed. Try another three letters.", true);
      ui.initials.focus();
      return;
    }
    ui.save.disabled = true;
    setMsg("Saving…");
    const entry = { initials, score: state.score, at: Date.now() };
    try {
      await board.add(entry);
      state.lastScore = entry;
      setMsg(`Saved. ${initials} is on the board with ${state.score}.`);
      await refreshBoard();
    } catch {
      ui.save.disabled = false;
      setMsg("Your score could not be saved. Check your connection and try again.", true);
    }
  });

  /* ---------- First paint: the court at rest, waiting for Play ---------- */

  placeBall();
  updateHud();
  resize();
  refreshBoard();
})();
