import { FONT_PATH, ICON_PATH } from "./assets.ts";
import { ORDER_ACCESS_DAYS } from "./config.ts";

// The one support address every buyer-facing page links to.
export const SUPPORT_EMAIL = "support@getdayboard.com";
// The public website, for the pricing and refund links when SITE_ORIGIN isn't configured.
export const DEFAULT_SITE_ORIGIN = "https://getdayboard.com";
export const REFUND_DAYS = 14;

export interface PageContext {
  site: string;
  activationLimit: number;
  /** True when this deployment emails each buyer their key (see mail.ts). */
  emailsKey: boolean;
}

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const macs = (count: number) => `${count} Mac${count === 1 ? "" : "s"}`;
// The app's own labels (its menu, Settings tab, field and buttons), as HTML. The receipt page
// and the license email both show them.
export const ACTIVATION_STEPS = [
  "Open DayBoard and choose <strong>DayBoard → Settings…</strong> (or press <kbd>⌘,</kbd>).",
  "Click the <strong>License</strong> tab.",
  "Paste your key into <strong>License key</strong>, then click <strong>Activate</strong>.",
];
export const moveKeyNote = (activationLimit: number) =>
  `Use the same key on up to ${macs(activationLimit)}. To move it, open <strong>Settings → License</strong> on the old Mac and click <strong>Deactivate this device</strong>.`;
const supportLink = `<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>`;

// The website's look (website/assets/site.css and clean.css): its colours in light and dark, its
// typeface and its buttons. The four source colours appear once, as the stripe on the license card.
const styles = `<style>
@font-face{font-family:"Hanken Grotesk";src:url("${FONT_PATH}") format("woff2");font-weight:100 900;font-style:normal;font-display:swap}
:root{color-scheme:light;--paper:#fbfbfa;--raised:#fff;--sunk:#f3f3f1;--ink:#1d1c1a;--soft:#55534f;--faint:#6f6d68;--rule:#e7e6e2;--rule-strong:#d6d4cf;--button:#1d1c1a;--button-text:#fff;--focus:#0060c9;--calendar:#22a23f;--tasks:#007aff;--reminders:#d07900;--mail:#ff3b30;--note:#fdf6e3;--note-rule:#ead9a8;--note-ink:#5c4a12;--shadow:0 1px 2px rgb(0 0 0/.04),0 18px 40px -18px rgb(0 0 0/.16),0 48px 96px -48px rgb(0 0 0/.18);--lift:0 1px 2px rgb(0 0 0/.05),0 8px 20px -12px rgb(0 0 0/.14);--text:"Hanken Grotesk",-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--paper:#111110;--raised:#1a1a19;--sunk:#0b0b0a;--ink:#f2f1ee;--soft:#b1afa9;--faint:#8f8d87;--rule:#272725;--rule-strong:#383734;--button:#f2f1ee;--button-text:#111110;--focus:#75baff;--calendar:#30d158;--tasks:#0a84ff;--reminders:#ff9f0a;--mail:#ff453a;--note:#221d10;--note-rule:#4a3f1f;--note-ink:#ecd9a0;--shadow:0 0 0 1px rgb(255 255 255/.06),0 30px 70px -24px rgb(0 0 0/.75);--lift:0 0 0 1px rgb(255 255 255/.04),0 12px 28px -14px rgb(0 0 0/.6)}}
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;background:var(--paper);color:var(--ink);font:17px/1.6 var(--text);-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration-thickness:1px;text-underline-offset:3px}
a:hover{text-decoration-thickness:2px}
:focus-visible{outline:3px solid var(--focus);outline-offset:3px;border-radius:4px}
h1{margin:0;font-size:clamp(2.5rem,6.2vw,4.1rem);font-weight:680;letter-spacing:-.03em;line-height:1.05}
h2{margin:0;font-size:1.45rem;font-weight:680;letter-spacing:-.02em;line-height:1.2}
p{margin:0;color:var(--soft)}
strong{color:var(--ink);font-weight:650}
small{display:block;color:var(--faint);font-size:.86rem;line-height:1.55}
kbd{padding:1px 6px;border:1px solid var(--rule-strong);border-radius:6px;background:var(--sunk);font:inherit}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;max-width:1080px;margin:0 auto;padding:18px 24px}
.brand{display:inline-flex;align-items:center;gap:10px;font-size:1.3rem;font-weight:600;letter-spacing:-.01em;text-decoration:none}
.brand img{width:34px;height:34px;border-radius:9px;box-shadow:var(--lift)}
.top nav a{color:var(--soft);font-size:.95rem;text-decoration:none}
.top nav a:hover{color:var(--ink)}
main{max-width:1080px;margin:0 auto;padding:48px 24px 88px}
button,.button{display:inline-flex;align-items:center;justify-content:center;min-height:50px;padding:0 22px;border:1px solid transparent;border-radius:12px;background:var(--button);color:var(--button-text);font:600 1rem/1 var(--text);text-decoration:none;cursor:pointer;transition:transform .15s,box-shadow .15s}
button:hover,.button:hover{box-shadow:var(--lift)}
button:active,.button:active{transform:translateY(1px)}
button:disabled{opacity:.6;cursor:wait;box-shadow:none;transform:none}
.secondary{border-color:var(--rule-strong);background:var(--raised);color:var(--ink)}
.buy{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:72px;align-items:start}
.price{margin-top:18px;color:var(--ink);font-size:1.5rem;font-weight:620;letter-spacing:-.015em;line-height:1.3}
.lede{max-width:34em;margin-top:14px;font-size:1.08rem}
.facts{max-width:34em;margin:32px 0 0;padding:0;color:var(--soft);list-style:none}
.facts li{padding:14px 0;border-top:1px solid var(--rule)}
.facts li:last-child{border-bottom:1px solid var(--rule)}
.links{margin-top:20px;font-size:.98rem}
.card{position:sticky;top:28px;padding:26px;border:1px solid var(--rule);border-radius:24px;background:var(--raised);box-shadow:var(--shadow)}
.card button{width:100%}
.card #message{min-height:1.6em;margin:8px 0 2px;font-size:.95rem}
.total{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:20px 2px 16px}
.total b{color:var(--ink);font-size:1.5rem;font-weight:680;letter-spacing:-.02em}
.ticket{position:relative;overflow:hidden;padding:24px 20px 18px;border:1px solid var(--rule);border-radius:16px;background:var(--sunk)}
.ticket::before{content:"";position:absolute;inset:0 0 auto;height:4px;background:linear-gradient(90deg,var(--calendar) 0 25%,var(--tasks) 25% 50%,var(--reminders) 50% 75%,var(--mail) 75%)}
.ticket-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;color:var(--soft);font-size:.92rem}
.ticket-head b{color:var(--ink);font-weight:650}
.ticket-foot{margin-top:10px;color:var(--faint);font-size:.88rem}
.key{display:block;margin-top:14px;color:var(--ink);font:500 1.02rem/1.5 ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere}
.ghost{color:var(--faint);letter-spacing:.06em;white-space:nowrap}
.receipt{max-width:760px}
.hero{text-align:center}
.hero h1{font-size:clamp(2.2rem,5.4vw,3.3rem);text-wrap:balance}
.hero p{max-width:32em;margin:16px auto 0;font-size:1.12rem}
.hero .button{margin-top:26px}
.wait{display:inline-flex;gap:8px;margin-bottom:26px}
.wait i{width:10px;height:10px;border-radius:50%;background:var(--calendar)}
.wait i:nth-child(2){background:var(--tasks)}
.wait i:nth-child(3){background:var(--reminders)}
.panel{margin-top:40px}
.receipt .ticket{padding:30px 26px 12px;border-radius:20px;background:var(--raised);box-shadow:var(--shadow)}
.receipt .key{margin-top:16px;padding:14px 16px;border:1px dashed var(--rule-strong);border-radius:10px;background:var(--sunk);font-size:clamp(.98rem,2.5vw,1.22rem);user-select:all;-webkit-user-select:all}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
#copied{min-height:1.6em;margin-top:10px;font-size:.95rem}
.warn{margin-top:20px;padding:14px 16px;border:1px solid var(--note-rule);border-radius:12px;background:var(--note);color:var(--note-ink);font-size:.98rem}
.warn strong{color:inherit}
#emailed{margin-top:16px}
.panel h2{margin-top:48px}
.steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;margin:20px 0 0;padding:0;color:var(--soft);font-size:.98rem;list-style:none;counter-reset:step}
.steps li{padding-top:14px;border-top:1px solid var(--rule-strong);counter-increment:step}
.steps li::before{content:counter(step);display:block;margin-bottom:6px;color:var(--ink);font-size:1.25rem;font-weight:680}
.move{margin-top:22px}
.receipt>small{margin-top:48px;padding-top:20px;border-top:1px solid var(--rule)}
@keyframes rise{from{opacity:0;transform:translateY(14px)}}
@keyframes pulse{0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}
@media (prefers-reduced-motion:no-preference){.rise,.panel{animation:rise .6s cubic-bezier(.2,.7,.2,1) both}.late{animation-delay:.12s}.wait i{animation:pulse 1.2s ease-in-out infinite}.wait i:nth-child(2){animation-delay:.15s}.wait i:nth-child(3){animation-delay:.3s}}
@media (max-width:860px){main{padding:28px 20px 64px}.top{padding:14px 20px}.buy{grid-template-columns:minmax(0,1fr);gap:36px}.card{position:static;padding:20px}.steps{grid-template-columns:minmax(0,1fr);gap:16px}.receipt .ticket{padding:26px 18px 10px}.actions button{flex:1 1 auto}}
</style>`;

interface Layout {
  title: string;
  site: string;
  /** The one link beside the logo, as HTML. */
  nav: string;
  /** Class of <main>: "buy" for the two-column checkout page, "receipt" for the centred pages. */
  page: "buy" | "receipt";
  script?: string;
}
const layout = (body: string, { title, site, nav, page, script }: Layout) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#fbfbfa" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#111110" media="(prefers-color-scheme: dark)"><title>${title}</title><link rel="icon" href="${ICON_PATH}">${styles}${script ? `<script src="${script}" defer></script>` : ""}</head><body><header class="top"><a class="brand" href="${site}/"><img src="${ICON_PATH}" alt="" width="34" height="34">DayBoard</a><nav aria-label="DayBoard website">${nav}</nav></header><main class="${page}">${body}</main></body></html>`;

export const buyPage = (orderId: string, { site, activationLimit, emailsKey }: PageContext) => {
  const origin = escapeHtml(site);
  return layout(
    `<div class="rise"><h1>DayBoard Pro</h1><p class="price">$5 once (launch price). No subscription.</p><p class="lede">The launch price ends December 31, 2026 at 11:59 PM PST. After that, DayBoard Pro is $9. If you buy at $5, you keep your license and all future updates.</p><ul class="facts"><li><strong>Unlocks DayBoard's AI features.</strong> Everything else in DayBoard stays free. You bring your own AI provider; Pro doesn't include AI usage.</li><li><strong>Use on up to ${macs(activationLimit)}</strong> with one license key.</li><li><strong>${REFUND_DAYS}-day refunds.</strong> Ask within ${REFUND_DAYS} days of buying for a full refund.</li></ul><p class="links">See <a href="${origin}/pricing">pricing</a> and the <a href="${origin}/refund">refund policy</a>. Questions? Email ${supportLink}.</p></div><div class="card rise late"><div class="ticket" aria-hidden="true"><div class="ticket-head"><b>DayBoard Pro</b><span>License key</span></div><span class="key ghost">DAYB_ •••• •••• ••••</span><p class="ticket-foot">${emailsKey ? "Shown right after you pay, and emailed to you." : "Shown right after you pay."}</p></div><p class="total"><span>One-time payment</span><b>$5</b></p><button id="buy" type="button" data-order-id="${escapeHtml(orderId)}">Continue to checkout</button><p id="message" role="status" aria-live="polite"></p><small>Checkout opens securely with Stripe. Link, Stripe's checkout service, is the seller of record and emails your receipt. After you pay, your license key appears on the receipt page in this browser.${emailsKey ? " We also email the key to the address you use at checkout." : ""}</small></div>`,
    {
      title: "Get DayBoard Pro",
      site: origin,
      nav: `<a href="${origin}/pricing">Back to pricing</a>`,
      page: "buy",
      script: "/buy.js",
    },
  );
};
export const receiptPage = ({ site, activationLimit }: PageContext) => {
  const origin = escapeHtml(site);
  return layout(
    `<div class="hero"><div id="wait" class="wait" aria-hidden="true"><i></i><i></i><i></i></div><h1 id="title">Checking your order</h1><p id="message" role="status" aria-live="polite">Your payment may take a moment to confirm.</p><a id="retry" href="/buy" class="button" hidden>Start a new checkout</a></div><div id="license" class="panel" hidden><div class="ticket"><div class="ticket-head"><b>DayBoard Pro</b><span>License key</span></div><code id="key" class="key"></code><div class="actions"><button id="copy" type="button">Copy license</button><button id="download" class="secondary" type="button">Download license</button></div><p id="copied" role="status" aria-live="polite"></p></div><p class="warn"><strong>Copy or download your license key now.</strong> This page works only in this browser, and only for ${ORDER_ACCESS_DAYS} days after you started checkout. After that, it can't show your key again.</p><p id="emailed" hidden>We're also emailing this key to the address you used at checkout. It can take a few minutes. If you don't see it, check your spam folder.</p><h2>Activate DayBoard Pro</h2><ol class="steps">${ACTIVATION_STEPS.map((step) => `<li>${step}</li>`).join("")}</ol><p class="move">${moveKeyNote(activationLimit)}</p></div><small>Lost your key or need help? Email ${supportLink} with your Stripe receipt. Never send your card number. Refunds within ${REFUND_DAYS} days: see the <a href="${origin}/refund">refund policy</a>.</small>`,
    {
      title: "Your DayBoard Pro order",
      site: origin,
      nav: `<a href="${origin}/download">Download DayBoard</a>`,
      page: "receipt",
      script: "/receipt.js",
    },
  );
};
// GET /buy is rate limited per network; a shared address can hit the limit without abuse.
export const busyPage = ({ site }: Pick<PageContext, "site">) => {
  const origin = escapeHtml(site);
  return layout(
    `<div class="hero"><h1>Too many checkout attempts</h1><p>Wait a minute, then reload this page. If this keeps happening, email ${supportLink}.</p></div>`,
    {
      title: "DayBoard Pro",
      site: origin,
      nav: `<a href="${origin}/pricing">Back to pricing</a>`,
      page: "receipt",
    },
  );
};
export const buyScript = `const button=document.getElementById('buy'),message=document.getElementById('message'),orderId=button.dataset.orderId;button.onclick=async()=>{button.disabled=true;message.textContent='Opening checkout…';try{const response=await fetch('/v1/checkout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId})});const data=await response.json();if(!response.ok||!data.url)throw new Error();location.assign(data.url)}catch{message.textContent='Checkout could not open. Reload this page and try again, or email support.';button.disabled=false}};`;
// show() ends the wait; checking() keeps the three dots moving and polls again. Copy feedback goes
// to #copied beside the buttons, never to the page's status line above the key.
export const receiptScript =
  `const title=document.getElementById('title'),message=document.getElementById('message'),wait=document.getElementById('wait'),box=document.getElementById('license'),key=document.getElementById('key'),copyButton=document.getElementById('copy'),copied=document.getElementById('copied'),orderId=new URL(location.href).searchParams.get('order');let licenseKey='';const show=(heading,text)=>{title.textContent=heading;message.textContent=text;wait.hidden=true};const checking=(heading,text,delay)=>{show(heading,text);wait.hidden=false;setTimeout(poll,delay)};async function poll(){if(!orderId||!%ORDER_PATTERN%.test(orderId)){show('Order access unavailable','Open the return link from your checkout in the browser you paid with, or email support with your Stripe receipt.');return}try{const response=await fetch('/v1/checkout/status?order='+encodeURIComponent(orderId),{credentials:'same-origin',cache:'no-store'});if(response.status===401){show('Order access unavailable','This page works only in the browser you used for checkout, for ${ORDER_ACCESS_DAYS} days. Email support with your Stripe receipt to recover your key.');return}if(!response.ok)throw new Error();const status=await response.json();if(status.state==='pending'){checking('Checking your order','Your payment may take a moment to confirm.',2500);return}if(status.state==='revoked'){show('License unavailable','This payment was refunded or disputed, so the license is turned off. Email support if you need help.');return}if(status.state==='failed'){show('Payment incomplete','No license was issued. Start a new checkout, or email support.');document.getElementById('retry').hidden=false;return}const claim=await fetch('/v1/checkout/claim',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId})});if(!claim.ok)throw new Error();const claimed=await claim.json();licenseKey=claimed.licenseKey;key.textContent=licenseKey;document.getElementById('emailed').hidden=!claimed.email;box.hidden=false;document.title='Your DayBoard Pro license';show('Your DayBoard Pro license','Payment confirmed. Your license key is below.')}catch{checking('Still checking','The order could not be checked right now. Retrying…',4000)}}poll();const selectKey=()=>{const range=document.createRange();range.selectNodeContents(key);const selection=getSelection();selection.removeAllRanges();selection.addRange(range)};copyButton.onclick=async()=>{let done=false;try{await navigator.clipboard.writeText(licenseKey);done=true}catch{selectKey();try{done=document.execCommand('copy')}catch{}}if(done){copied.textContent='License copied.';copyButton.textContent='Copied';setTimeout(()=>{copyButton.textContent='Copy license'},2000)}else copied.textContent='This browser blocked copying. Your key is selected: press ⌘C to copy it, or use Download license.'};document.getElementById('download').onclick=()=>{const url=URL.createObjectURL(new Blob([licenseKey+'\\n'],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download='dayboard-license.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};`.replace(
    "%ORDER_PATTERN%",
    "/^[A-Za-z0-9_-]{32}$/",
  );
