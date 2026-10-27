(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const header = document.querySelector(".site-header");
  const nav = document.querySelector(".nav");
  const toggle = document.querySelector(".menu-toggle");
  const ring = document.querySelector(".nav-ring");

  // Header hairline appears once the page has moved
  const onScroll = () => header && header.classList.toggle("is-scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  // Mobile menu
  if (toggle && nav) {
    const label = toggle.querySelector("span");
    const setOpen = (open) => {
      toggle.setAttribute("aria-expanded", String(open));
      nav.classList.toggle("is-open", open);
      label.textContent = open ? "Close" : "Menu";
    };
    toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
    nav.addEventListener("click", (e) => {
      if (e.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && nav.classList.contains("is-open")) {
        setOpen(false);
        toggle.focus();
      }
    });
    window.matchMedia("(min-width: 961px)").addEventListener("change", () => setOpen(false));
  }

  // Active-section ring
  const moveRing = (link) => {
    if (!ring) return;
    if (!link) {
      ring.style.opacity = "0";
      return;
    }
    // First placement lands in place; later moves glide between links
    const first = ring.style.opacity !== "1";
    if (first) ring.style.transition = "none";
    ring.style.width = `${link.offsetWidth}px`;
    ring.style.height = `${link.offsetHeight}px`;
    ring.style.transform = `translate(${link.offsetLeft}px, ${link.offsetTop}px)`;
    if (first) {
      void ring.offsetWidth;
      ring.style.transition = "";
    }
    ring.style.opacity = "1";
  };

  const sectionLinks = [...document.querySelectorAll('.nav a[href^="#"]')];
  let active = document.querySelector(".nav a[aria-current]");

  const setActive = (link) => {
    if (link === active) return;
    sectionLinks.forEach((a) => a.removeAttribute("aria-current"));
    if (link) link.setAttribute("aria-current", "true");
    active = link;
    moveRing(link);
  };

  if (sectionLinks.length) {
    const targets = sectionLinks
      .map((link) => ({ link, section: document.getElementById(link.hash.slice(1)) }))
      .filter((t) => t.section);

    // While a clicked link is scrolling into place, it keeps the ring
    let lockedUntil = 0;
    let settleTimer;

    // The active section is the last one whose top has passed a line a third
    // of the way down the screen. At the very bottom the last link wins, since
    // short closing sections can never scroll up to that line.
    const sync = () => {
      if (Date.now() < lockedUntil) return;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) return setActive(targets[targets.length - 1].link);
      const line = window.innerHeight * 0.33;
      let current = null;
      for (const t of targets) {
        if (t.section.getBoundingClientRect().top <= line) current = t.link;
      }
      setActive(current);
    };

    window.addEventListener(
      "scroll",
      () => {
        if (Date.now() < lockedUntil) {
          // Release the lock shortly after the smooth scroll stops moving
          clearTimeout(settleTimer);
          settleTimer = setTimeout(() => (lockedUntil = 0), 150);
          return;
        }
        sync();
      },
      { passive: true }
    );

    sectionLinks.forEach((link) =>
      link.addEventListener("click", () => {
        setActive(link);
        lockedUntil = Date.now() + 1500;
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => (lockedUntil = 0), 1500);
      })
    );

    sync();
  }

  // Inner pages mark their own link; place the ring once fonts settle
  const placeRing = () => moveRing(active);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeRing);
  window.addEventListener("resize", placeRing);
  placeRing();

  // Gentle entrances, only for content that starts below the fold
  if (!reduceMotion && "IntersectionObserver" in window) {
    const pending = [...document.querySelectorAll(".reveal")].filter(
      (el) => el.getBoundingClientRect().top > window.innerHeight
    );
    pending.forEach((el) => el.classList.add("is-pending"));
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          en.target.classList.remove("is-pending");
          io.unobserve(en.target);
        }),
      { rootMargin: "0px 0px -8% 0px" }
    );
    pending.forEach((el) => io.observe(el));
  }

  // Diagram pulses stay still for reduced motion
  if (reduceMotion) {
    document.querySelectorAll("svg.diagram").forEach((svg) => svg.pauseAnimations && svg.pauseAnimations());
  }

  // Copy email address
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    const label = btn.querySelector(".copy-label");
    let timer;
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        label.textContent = "Copied";
      } catch {
        const target = document.querySelector(btn.dataset.target);
        const range = document.createRange();
        range.selectNodeContents(target);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        label.textContent = "Selected, press Ctrl+C";
      }
      btn.classList.add("is-done");
      clearTimeout(timer);
      timer = setTimeout(() => {
        label.textContent = "Copy address";
        btn.classList.remove("is-done");
      }, 2400);
    });
  });
})();
