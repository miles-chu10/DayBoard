// Public destinations live here. contactEmail is the address shown wherever a page links to
// the DayBoard team.
const SITE_CONFIG = Object.freeze({
  contactEmail: "support@getdayboard.com",
  // The live billing service's checkout page. Set it to "" to close checkout: buy buttons then
  // stay hidden and pages show their [data-buy-pending] notes instead.
  buyUrl: "https://api.getdayboard.com/buy",
  // The billing service's signup for release emails. Set it to "" to close the signup forms.
  updatesUrl: "https://api.getdayboard.com/v1/updates/subscribe",
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
// step with the address above, and closes them when it is empty. data-buy="<tag>" names where
// the link sits; checkout keeps it with the sale (?from=) so sales can be counted per link.
for (const link of document.querySelectorAll("a[data-buy]")) {
  if (buyUrl) {
    const url = new URL(buyUrl);
    const from = link.dataset?.buy ?? "";
    if (/^[a-z0-9-]{1,32}$/.test(from)) url.searchParams.set("from", from);
    link.href = url.href;
  }
  link.hidden = !buyUrl;
}
for (const note of document.querySelectorAll("[data-buy-pending]")) note.hidden = Boolean(buyUrl);

// The launch price ends December 31, 2026 at 11:59 PM PST. Until then, say how many days are left.
const launchPriceEnds = Date.UTC(2027, 0, 1, 7, 59);
const launchDaysLeft = Math.ceil((launchPriceEnds - Date.now()) / 86_400_000);
if (launchDaysLeft > 0 && launchDaysLeft <= 60) {
  for (const note of document.querySelectorAll("[data-launch-countdown]")) {
    note.textContent =
      launchDaysLeft === 1
        ? "Last day at the $5 launch price, then $9."
        : `$5 launch price for ${launchDaysLeft} more days, then $9.`;
  }
}

// A download button first opens the thanks page, which starts the download. That page view is how
// started downloads are counted (Cloudflare Web Analytics, no cookies), because GitHub's own
// download count also includes the Terminal installer, release checks and bots. Only the version
// travels, in the URL fragment, so the thanks page can only ever fetch a DayBoard release DMG.
const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/;
const dmgUrl = (version) =>
  `https://github.com/miles-chu10/DayBoard/releases/download/v${version}/DayBoard-${version}-arm64.dmg`;
for (const link of document.querySelectorAll("a[data-download]")) {
  link.addEventListener("click", (event) => {
    const version = /\/releases\/download\/v([^/]+)\//.exec(link.href ?? "")?.[1] ?? "";
    const plain = !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    if (plain && RELEASE_VERSION.test(version) && link.href === dmgUrl(version)) {
      event.preventDefault();
      location.assign(`thanks.html#${version}`);
      return;
    }
    // Otherwise the browser downloads the file directly: show the next step beside the button.
    let scope = link.parentElement;
    while (scope && !scope.querySelector("[data-download-started]")) scope = scope.parentElement;
    const note = scope?.querySelector("[data-download-started]");
    if (note) note.hidden = false;
  });
}
const downloadStart = document.querySelector("[data-download-start]");
if (downloadStart) {
  const version = (location.hash ?? "").slice(1);
  if (RELEASE_VERSION.test(version)) {
    const url = dmgUrl(version);
    const link = downloadStart.querySelector("[data-download-link]");
    if (link) link.href = url;
    downloadStart.hidden = false;
    const idle = document.querySelector("[data-download-idle]");
    if (idle) idle.hidden = true;
    // The response is a file, so the page stays put while the download begins.
    setTimeout(() => location.assign(url), 1000);
  }
}

const contactEmail = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(SITE_CONFIG.contactEmail)
  ? SITE_CONFIG.contactEmail
  : null;
for (const link of document.querySelectorAll("a[data-contact]")) {
  if (!contactEmail) continue;
  link.href = `mailto:${contactEmail}`;
  link.textContent = contactEmail;
}

// Release email signup. Forms ship disabled and open only when the signup address is set.
const SIGNUP_MESSAGES = {
  invalid: "Enter a valid email address.",
  invalid_email: "That email address doesn't look right.",
  rate_limited: "Too many tries from this network. Wait a minute and try again.",
  failed: "Something went wrong on our side. Try again in a moment.",
  offline: "Couldn't reach DayBoard. Check your connection and try again.",
  timeout: "DayBoard didn't answer in time. Check your connection and try again.",
};
// A stalled request is abandoned after this long, so the form never stays stuck.
const SIGNUP_TIMEOUT_MS = 15000;

const signupUrl = (() => {
  try {
    const url = new URL(SITE_CONFIG.updatesUrl);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
})();

function markSubscribed(form) {
  const done = document.createElement("div");
  done.className = "signup-done";
  done.tabIndex = -1;
  done.innerHTML =
    '<span class="check" aria-hidden="true">✓</span>' +
    "<div><strong>You're on the list.</strong>" +
    "<p>We'll email this address when the next DayBoard version is out. Every email has an" +
    " unsubscribe link.</p></div>";
  form.replaceChildren(done);
  form.removeAttribute("aria-busy");
  return done;
}

// Resolves to "ok" only for the service's exact {"ok": true}; anything else is a message key.
async function postSignup(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SIGNUP_TIMEOUT_MS);
  try {
    const response = await fetch(signupUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (controller.signal.aborted) return "timeout";
    if (response.ok && body?.ok === true) return "ok";
    return Object.hasOwn(SIGNUP_MESSAGES, body?.error) ? body.error : "failed";
  } catch {
    return controller.signal.aborted ? "timeout" : "offline";
  } finally {
    clearTimeout(timer);
  }
}

for (const form of document.querySelectorAll("form[data-signup]")) {
  const input = form.querySelector('input[type="email"]');
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector(".signup-status");
  if (!signupUrl) {
    form.querySelector(".signup-note").textContent = "Signups for release emails are closed.";
    continue;
  }
  input.disabled = false;
  button.disabled = false;
  button.dataset.label = button.textContent;

  // Every failure re-enables the form and keeps the address, so trying again is one step.
  const fail = (message) => {
    status.dataset.tone = "error";
    status.textContent = message;
    button.disabled = false;
    button.textContent = button.dataset.label;
    form.removeAttribute("aria-busy");
    input.focus();
  };

  let busy = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!input.checkValidity()) {
      fail(SIGNUP_MESSAGES.invalid);
      return;
    }
    busy = true;
    button.disabled = true;
    button.textContent = "Signing up…";
    form.setAttribute("aria-busy", "true");
    status.textContent = "";
    const outcome = await postSignup({
      email: input.value.trim(),
      company: form.elements.company.value,
    });
    busy = false;
    if (outcome !== "ok") {
      fail(SIGNUP_MESSAGES[outcome]);
      return;
    }
    const forms = document.querySelectorAll("form[data-signup]");
    const done = markSubscribed(form);
    for (const other of forms) if (other !== form) markSubscribed(other);
    done.focus();
  });
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
