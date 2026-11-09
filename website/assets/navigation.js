for (const menu of document.querySelectorAll(".mobile-menu")) {
  const trigger = menu.querySelector("summary");
  const close = (restoreFocus = false) => {
    menu.open = false;
    if (restoreFocus) trigger.focus();
  };
  menu.addEventListener("toggle", () => {
    trigger.setAttribute("aria-label", menu.open ? "Close navigation" : "Open navigation");
  });
  menu.addEventListener("click", (event) => {
    if (event.target.closest("a")) close();
  });
  document.addEventListener("click", (event) => {
    if (menu.open && !menu.contains(event.target)) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.open) {
      event.preventDefault();
      close(true);
    }
  });
  window.matchMedia("(min-width: 1024px)").addEventListener("change", (event) => {
    if (event.matches) close();
  });
}

// Header menus (Product, Resources): open on click, Enter or Space, and on hover with a mouse.
// Escape or a click elsewhere closes them; only one is open at a time.
const headerMenus = [...document.querySelectorAll("[data-nav-menu]")];
const hoverable = window.matchMedia("(hover: hover) and (pointer: fine)");

for (const menu of headerMenus) {
  const trigger = menu.querySelector(".nav-trigger");
  let timer;
  const setOpen = (open) => {
    clearTimeout(timer);
    if (open)
      for (const other of headerMenus)
        if (other !== menu) other.dispatchEvent(new Event("nav:close"));
    menu.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", String(open));
  };
  menu.addEventListener("nav:close", () => setOpen(false));
  trigger.addEventListener("click", () => setOpen(!menu.classList.contains("is-open")));
  menu.addEventListener("mouseenter", () => {
    if (hoverable.matches) setOpen(true);
  });
  menu.addEventListener("mouseleave", () => {
    if (!hoverable.matches) return;
    clearTimeout(timer);
    timer = setTimeout(() => setOpen(false), 120);
  });
  menu.addEventListener("focusout", (event) => {
    if (!menu.contains(event.relatedTarget)) setOpen(false);
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.classList.contains("is-open")) {
      event.preventDefault();
      setOpen(false);
      trigger.focus();
    }
  });
  menu.addEventListener("click", (event) => {
    if (event.target.closest("a")) setOpen(false);
  });
}

document.addEventListener("click", (event) => {
  for (const menu of headerMenus)
    if (menu.classList.contains("is-open") && !menu.contains(event.target))
      menu.dispatchEvent(new Event("nav:close"));
});
