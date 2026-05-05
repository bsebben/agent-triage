// public/overlay.js — Shared overlay utility for modals, panels, and drawers

let activeOverlay = null;

function openOverlay(panelEl, { onClose } = {}) {
  if (activeOverlay) activeOverlay.close();

  const backdrop = document.createElement("div");
  backdrop.className = "overlay-backdrop";
  document.body.appendChild(backdrop);
  document.body.appendChild(panelEl);

  const close = () => {
    panelEl.classList.remove("open");
    backdrop.classList.remove("open");
    document.removeEventListener("keydown", keyHandler);
    setTimeout(() => {
      backdrop.remove();
      if (onClose) onClose(panelEl);
    }, 200);
    if (activeOverlay?.close === close) activeOverlay = null;
  };

  const keyHandler = (e) => {
    if (e.key === "Escape") close();
  };

  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", keyHandler);

  requestAnimationFrame(() => {
    backdrop.classList.add("open");
    panelEl.classList.add("open");
  });

  activeOverlay = { close, panelEl };
  return close;
}
