// Public destinations live here. contactEmail is the address shown wherever a page links to
// the DayBoard team.
const SITE_CONFIG = Object.freeze({
  contactEmail: "support@getdayboard.com",
  // The live billing service's checkout page. Set it to "" to close checkout: buy buttons then
  // stay hidden and pages show their [data-buy-pending] notes instead.
  buyUrl: "https://api.getdayboard.com/buy",
});

const buyUrl = (() => {
  try {
    const url = new URL(SITE_CONFIG.buyUrl);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
})();
// Pages carry the live link in their HTML so buying works without scripts; this keeps them in
// step with the address above, and closes them when it is empty.
for (const link of document.querySelectorAll("a[data-buy]")) {
  if (buyUrl) link.href = buyUrl;
  link.hidden = !buyUrl;
}
for (const note of document.querySelectorAll("[data-buy-pending]")) note.hidden = Boolean(buyUrl);

const contactEmail = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(SITE_CONFIG.contactEmail)
  ? SITE_CONFIG.contactEmail
  : null;
for (const link of document.querySelectorAll("a[data-contact]")) {
  if (!contactEmail) continue;
  link.href = `mailto:${contactEmail}`;
  link.textContent = contactEmail;
}

// Screenshot tabs (e.g. Calendar week/month).
for (const list of document.querySelectorAll('[role="tablist"]')) {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    for (const other of tabs) {
      const selected = other === tab;
      other.setAttribute("aria-selected", String(selected));
      other.tabIndex = selected ? 0 : -1;
      document.getElementById(other.getAttribute("aria-controls")).hidden = !selected;
    }
  };
  for (const tab of tabs) {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  }
}

const header = document.querySelector(".site-header");
const onScroll = () => header?.classList.toggle("is-scrolled", window.scrollY > 8);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

const revealed = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-in");
      revealed.unobserve(entry.target);
    }
  },
  { rootMargin: "0px 0px -12% 0px" },
);
for (const element of document.querySelectorAll("[data-reveal], .merge")) revealed.observe(element);

// Copy buttons ship hidden and appear only where the page can copy for the visitor.
for (const button of document.querySelectorAll("button[data-copy]")) {
  const source = document.getElementById(button.dataset.copy);
  const status = button.closest(".gs-card")?.querySelector('[role="status"]');
  if (!source || !navigator.clipboard?.writeText) continue;
  button.hidden = false;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(source.textContent.trim());
      button.textContent = "Copied";
      if (status) status.textContent = "Copied. Paste it into Terminal and press Return.";
    } catch {
      if (status) status.textContent = "Couldn't copy. Select the command and copy it yourself.";
    }
    setTimeout(() => {
      button.textContent = "Copy";
    }, 2000);
  });
}
