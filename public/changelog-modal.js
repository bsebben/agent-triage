// public/changelog-modal.js — modal that displays CHANGELOG.md, opened by clicking the header version

function escapeChangelogHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderChangelogInline(text) {
  let out = escapeChangelogHtml(text);
  out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const safeUrl = url.replace(/"/g, "%22");
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return out;
}

function parseChangelog(md) {
  const lines = md.split("\n");
  const html = [];
  let bullets = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    html.push("<ul>" + bullets.map((b) => `<li>${renderChangelogInline(b)}</li>`).join("") + "</ul>");
    bullets = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      flushBullets();
      html.push(`<h3>${renderChangelogInline(line.slice(3))}</h3>`);
    } else if (line.startsWith("### ")) {
      flushBullets();
      html.push(`<h4>${renderChangelogInline(line.slice(4))}</h4>`);
    } else if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
    } else if (line.trim() === "") {
      flushBullets();
    } else if (line.startsWith("# ")) {
      flushBullets();
      html.push(`<h2>${renderChangelogInline(line.slice(2))}</h2>`);
    } else {
      flushBullets();
      html.push(`<p>${renderChangelogInline(line)}</p>`);
    }
  }
  flushBullets();
  return html.join("\n");
}

function closeChangelogModal() {
  const backdrop = document.querySelector(".modal-backdrop");
  if (!backdrop) return;
  backdrop.classList.remove("visible");
  document.removeEventListener("keydown", changelogKeyHandler);
  setTimeout(() => backdrop.remove(), 200);
}

function changelogKeyHandler(e) {
  if (e.key === "Escape") closeChangelogModal();
}

async function openChangelogModal() {
  if (document.querySelector(".modal-backdrop")) return;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeChangelogModal();
  });

  const panel = document.createElement("div");
  panel.className = "modal-panel";
  panel.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Changelog</span>
      <button class="modal-close" type="button" aria-label="Close">&times;</button>
    </div>
    <div class="modal-body">Loading…</div>
  `;
  panel.querySelector(".modal-close").addEventListener("click", closeChangelogModal);

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add("visible"));
  document.addEventListener("keydown", changelogKeyHandler);

  const body = panel.querySelector(".modal-body");
  try {
    const res = await fetch("/api/changelog");
    if (!res.ok) throw new Error(`status ${res.status}`);
    const text = await res.text();
    body.innerHTML = parseChangelog(text);
  } catch {
    body.textContent = "Could not load changelog";
  }
}
