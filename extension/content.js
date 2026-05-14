// content.js — injected into every ky2help site.php page (including iframes)
// Detects ticket detail pages, reads subject + description via ControlCaption
// selectors, queries the local FastAPI /search endpoint, and renders a sidebar.

const API_URL = "http://localhost:8000/search";
const TOP_N   = 5;

// ── Only run on incident register pages (any uid containing "Incident") ──────
// Covers RegIncident (detail/edit), IncidentEditSP, and other per-status views.
// The waitForContent gate (Betreff field) is the real guard against non-tickets.
const _uid = new URLSearchParams(location.search).get("uid") || "";
if (!_uid.toLowerCase().includes("incident")) {
  throw new Error("carlito: not an incident page, skipping");
}

// ── Read field value by ControlCaption label ──────────────────────────────────
// Works in both detail mode (td.ControlOutput) and edit mode (input/textarea).
function getField(labelPrefix) {
  for (const cap of document.querySelectorAll("td.ControlCaption, td.ControlCaptionMand")) {
    if (cap.textContent.trim().startsWith(labelPrefix)) {
      const row = cap.parentElement;
      // Detail view: read-only td
      const out = row.querySelector("td.ControlOutput");
      if (out) return out.innerText.replace(/\s+/g, " ").trim();
      // Edit view: input or textarea
      const input = row.querySelector("input[type='text'], input:not([type]), textarea");
      if (input) return (input.value || input.innerText || "").replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

// ── Wait until the ticket fields are rendered ─────────────────────────────────
function waitForContent(callback, attempts = 30) {
  const subject = getField("Betreff");
  if (subject.length > 3) {
    callback();
  } else if (attempts > 0) {
    setTimeout(() => waitForContent(callback, attempts - 1), 200);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scoreColor(score) {
  if (score >= 0.80) return "#27ae60";
  if (score >= 0.65) return "#e67e22";
  return "#95a5a6";
}

function buildTicketUrl(id) {
  return `https://helpdesk.gvcc.net/site/site.php?type=register&uid=RegIncident&id=${encodeURIComponent(id)}&regpuid=Incident_Detail&showType=detail`;
}

// ── Drag support ──────────────────────────────────────────────────────────────
function makeDraggable(panel) {
  const header = document.getElementById("ky2-header");
  let dragStartX, dragStartY, panelStartLeft, panelStartTop;

  header.addEventListener("mousedown", e => {
    if (e.target.tagName === "BUTTON") return;
    const rect = panel.getBoundingClientRect();
    // Switch from right-anchored to left-anchored so translate works simply
    panel.style.right = "auto";
    panel.style.left  = rect.left + "px";
    panel.style.top   = rect.top  + "px";
    dragStartX    = e.clientX;
    dragStartY    = e.clientY;
    panelStartLeft = rect.left;
    panelStartTop  = rect.top;
    header.style.cursor = "grabbing";
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup",   onDragEnd);
    e.preventDefault();
  });

  function onDragMove(e) {
    panel.style.left = (panelStartLeft + e.clientX - dragStartX) + "px";
    panel.style.top  = (panelStartTop  + e.clientY - dragStartY) + "px";
  }

  function onDragEnd() {
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup",   onDragEnd);
    header.style.cursor = "grab";
  }
}

// ── Build sidebar ─────────────────────────────────────────────────────────────
function injectPanel() {
  if (document.getElementById("ky2-ai-panel")) return;

  const panel = document.createElement("div");
  panel.id = "ky2-ai-panel";
  panel.innerHTML = `
    <div id="ky2-inner">
      <div id="ky2-header">
        <span id="ky2-title">⚡ KI-Lösungsvorschläge</span>
        <div style="display:flex;gap:8px;align-items:center">
          <button id="ky2-minimize" title="Minimieren">▼</button>
          <button id="ky2-refresh"  title="Neu suchen">↻</button>
          <button id="ky2-close"    title="Schließen">×</button>
        </div>
      </div>
      <div id="ky2-body">
        <div id="ky2-status">Analysiere Ticket …</div>
        <div id="ky2-results"></div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  let minimized = false;
  document.getElementById("ky2-minimize").onclick = () => {
    minimized = !minimized;
    document.getElementById("ky2-body").style.display     = minimized ? "none" : "";
    document.getElementById("ky2-minimize").textContent   = minimized ? "▲" : "▼";
  };

  document.getElementById("ky2-close").onclick   = () => panel.remove();
  document.getElementById("ky2-refresh").onclick = () => {
    document.getElementById("ky2-status").style.display = "block";
    document.getElementById("ky2-status").textContent   = "Analysiere Ticket …";
    document.getElementById("ky2-results").innerHTML    = "";
    fetchAndRender();
  };

  makeDraggable(panel);
  fetchAndRender();
}

async function fetchAndRender() {
  const currentId   = new URLSearchParams(location.search).get("id") || "";
  const subject     = getField("Betreff");
  const description = getField("Beschreibung");
  const query       = [subject, description].filter(Boolean).join(" ");

  const statusEl  = document.getElementById("ky2-status");
  const resultsEl = document.getElementById("ky2-results");

  if (query.length < 5) {
    statusEl.textContent = "Zu wenig Text — bitte Betreff ausfüllen.";
    return;
  }

  try {
    const res = await fetch(API_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ query, n: TOP_N }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    statusEl.style.display = "none";

    const results = (data.results || []).filter(r => r.id !== currentId);

    if (results.length === 0) {
      resultsEl.innerHTML =
        `<p class="ky2-empty">Keine ähnlichen Tickets gefunden.</p>`;
      return;
    }

    resultsEl.innerHTML = results.map((r, i) => `
      <div class="ky2-card ${i === 0 ? "ky2-card-top" : ""}">
        <div class="ky2-card-header">
          <span class="ky2-subject">${escapeHtml(r.subject)}</span>
          <span class="ky2-score" style="background:${scoreColor(r.score)}">
            ${Math.round(r.score * 100)}%
          </span>
        </div>
        ${r.category
          ? `<div class="ky2-category">${escapeHtml(r.category)}</div>`
          : ""}
        <div class="ky2-solution">${escapeHtml(r.solution)}</div>
        <a class="ky2-link" href="${escapeHtml(r.url || buildTicketUrl(r.id))}" target="_blank">
          Ticket #${escapeHtml(r.id)} ansehen →
        </a>
      </div>
    `).join("");

  } catch (err) {
    statusEl.style.display = "block";
    statusEl.innerHTML =
      `<span class="ky2-error">
        API nicht erreichbar.<br>
        Bitte <code>uvicorn main:app --port 8000</code> starten.
      </span>`;
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
waitForContent(injectPanel);
