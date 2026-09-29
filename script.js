/* LegalEase frontend. Each page sets <body data-page="..."> and the matching init function runs.
   All server text is rendered with textContent / .value (never innerHTML) to avoid XSS. */
const API_BASE = "http://localhost:8000/api"; // change if your backend runs elsewhere
const DISCLAIMER =
  "LegalEase provides AI-generated document drafts for informational and drafting assistance. " +
  "It does not constitute legal advice and should not replace consultation with a qualified legal professional.";

const $ = (selector) => document.querySelector(selector);
const getToken = () => localStorage.getItem("le_token");

function el(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function say(target, text, kind = "error") {
  target.textContent = text;
  target.className = "msg " + kind;
  target.hidden = !text;
}

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";

function logout() {
  localStorage.removeItem("le_token");
  localStorage.removeItem("le_name");
  location.href = "login.html";
}

function requireLogin() {
  if (getToken()) return true;
  const here = location.pathname.split("/").pop() + location.search;
  location.href = "login.html?next=" + encodeURIComponent(here);
  return false;
}

/* One wrapper for every backend call: token, timeout, and friendly errors. */
async function api(path, { method = "GET", body, blob = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000); // real timeout for slow AI responses
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (getToken()) headers.Authorization = "Bearer " + getToken();

  let response;
  try {
    response = await fetch(API_BASE + path, {
      method, headers, signal: controller.signal, body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(
      err.name === "AbortError"
        ? "The request timed out. Please try again."
        : "Cannot reach the server. Check your internet connection and that the backend is running."
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 && !path.startsWith("/auth/")) {
    logout();
    throw new Error("Please log in again.");
  }
  if (!response.ok) {
    let message = "Something went wrong. Please try again.";
    try {
      const detail = (await response.json()).detail;
      message = Array.isArray(detail) ? detail.map((d) => d.msg).join(" ") : detail || message;
    } catch (_) { /* response was not JSON */ }
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return blob ? response.blob() : response.json();
}

/* Header for app pages + disclaimer text on every page. */
function renderChrome(page) {
  document.querySelectorAll("[data-disclaimer]").forEach((node) => (node.textContent = DISCLAIMER));
  if (page === "home") return;
  const links = getToken() ? '<a href="dashboard.html">Dashboard</a><a href="#" id="logout-link">Logout</a>' : "";
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<header class="nav"><div class="wrap"><a class="logo" href="../index.html">⚖ LegalEase</a><nav aria-label="Main">${links}</nav></div></header>`
  );
  const logoutLink = $("#logout-link");
  if (logoutLink) logoutLink.addEventListener("click", (e) => { e.preventDefault(); logout(); });
}

/* ---------- Login / Register ---------- */
function initLogin() {
  let registering = false;
  const msg = $("#form-msg");

  $("#switch-link").addEventListener("click", (e) => {
    e.preventDefault();
    registering = !registering;
    $("#name-row").hidden = !registering;
    $("#auth-title").textContent = registering ? "Create your account" : "Welcome back";
    $("#auth-submit").textContent = registering ? "Register" : "Login";
    $("#switch-text").textContent = registering ? "Already registered?" : "New to LegalEase?";
    $("#switch-link").textContent = registering ? "Login" : "Register";
    say(msg, "");
  });

  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const full_name = $("#full_name").value.trim();
    const email = $("#email").value.trim();
    const password = $("#password").value;
    if (!email || !password || (registering && !full_name)) return say(msg, "Please fill in all fields.");
    if (registering && password.length < 8) return say(msg, "Password must be at least 8 characters.");

    const button = $("#auth-submit");
    button.disabled = true;
    say(msg, "");
    try {
      if (registering) await api("/auth/register", { method: "POST", body: { full_name, email, password } });
      const data = await api("/auth/login", { method: "POST", body: { email, password } });
      localStorage.setItem("le_token", data.access_token);
      localStorage.setItem("le_name", data.full_name);
      const next = new URLSearchParams(location.search).get("next") || "";
      location.href = /^[\w-]+\.html(\?[\w=&-]*)?$/.test(next) ? next : "dashboard.html"; // only same-folder pages
    } catch (err) {
      say(msg, err.message);
    } finally {
      button.disabled = false;
    }
  });
}

/* ---------- Dashboard ---------- */
async function initDashboard() {
  if (!requireLogin()) return;
  const rows = $("#doc-rows");
  const msg = $("#page-msg");

  function buildRow(doc) {
    const row = document.createElement("tr");
    const open = el("a", "Open");
    open.href = "document-preview.html?id=" + encodeURIComponent(doc.id);
    const remove = el("button", "Delete", "btn ghost small");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
      try { await api("/documents/" + doc.id, { method: "DELETE" }); load(); } catch (err) { say(msg, err.message); }
    });
    const status = el("td");
    status.append(el("span", doc.status, "badge " + doc.status));
    const actions = el("td");
    actions.append(open, " ", remove);
    row.append(el("td", doc.title), el("td", doc.type_label), status, el("td", fmtDate(doc.created_at)), actions);
    return row;
  }

  async function load() {
    try {
      const docs = await api("/documents?q=" + encodeURIComponent($("#search").value.trim()));
      say(msg, "");
      rows.replaceChildren(...docs.map(buildRow));
      $("#empty").hidden = docs.length > 0;
    } catch (err) {
      say(msg, err.message);
    }
  }

  $("#search").addEventListener("input", load);
  load();
}

/* ---------- Create document (form is built from GET /documents/types) ---------- */
async function initCreate() {
  if (!requireLogin()) return;
  const typesBox = $("#types"), form = $("#doc-form"), msg = $("#form-msg"), overlay = $("#overlay");
  let current = null;

  let types;
  try { types = await api("/documents/types"); } catch (err) { return say($("#page-msg"), err.message); }

  function selectType(type, button) {
    current = type;
    say(msg, "");
    typesBox.querySelectorAll(".type-card").forEach((b) => b.classList.toggle("active", b === button));
    $("#form-title").textContent = type.label;
    const box = $("#fields");
    box.replaceChildren();
    type.fields.forEach((field) => {
      const wrap = el("div");
      const label = el("label", field.label + (field.required ? " *" : ""));
      label.htmlFor = "f_" + field.name;
      const input = document.createElement(field.type === "textarea" ? "textarea" : "input");
      if (field.type === "textarea") input.rows = 3; else input.type = field.type;
      if (field.type === "number") { input.min = "0"; input.step = "0.01"; }
      input.id = "f_" + field.name;
      input.maxLength = 2000;
      const error = el("p", "", "err");
      error.id = "e_" + field.name;
      input.setAttribute("aria-describedby", error.id);
      wrap.append(label, input);
      if (field.help) wrap.append(el("p", field.help, "help"));
      wrap.append(error);
      box.append(wrap);
    });
    form.hidden = false;
    form.scrollIntoView({ behavior: "smooth" });
  }

  types.forEach((type) => {
    const button = el("button", type.label, "card type-card");
    button.type = "button";
    button.addEventListener("click", () => selectType(type, button));
    typesBox.append(button);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const requirements = {};
    let valid = true;
    current.fields.forEach((field) => {
      const value = $("#f_" + field.name).value.trim();
      requirements[field.name] = value;
      const missing = field.required && !value;
      $("#e_" + field.name).textContent = missing ? `${field.label} is required.` : "";
      if (missing) valid = false;
    });
    if (!valid) return say(msg, "Please complete the required fields.");

    say(msg, "");
    overlay.hidden = false; // shown for exactly as long as the real request takes
    try {
      const doc = await api("/documents/generate", { method: "POST", body: { document_type: current.key, requirements } });
      location.href = "document-preview.html?id=" + encodeURIComponent(doc.id);
    } catch (err) {
      overlay.hidden = true;
      say(msg, err.message);
    }
  });
}

/* ---------- Preview / edit / sign / PDF ---------- */
async function initPreview() {
  if (!requireLogin()) return;
  const id = new URLSearchParams(location.search).get("id");
  const msg = $("#page-msg"), text = $("#doc-content"), overlay = $("#overlay");
  const saveBtn = $("#save-btn");
  if (!id) return say(msg, "No document selected. Open one from your dashboard.");

  let doc;
  function show(data) {
    doc = data;
    $("#doc-title").textContent = data.title;
    $("#doc-status").textContent = data.status;
    $("#doc-status").className = "badge " + data.status;
    text.value = data.content;
    text.readOnly = true;
    saveBtn.disabled = true;
    $("#sig-box").hidden = !data.signature;
    if (data.signature) {
      $("#sig-img").src = data.signature;
      $("#sig-caption").textContent = "Demonstration e-signature · " + fmtDate(data.signed_at);
    }
  }

  // Runs an async task behind the loading overlay and reports errors.
  async function run(label, task) {
    say(msg, "");
    $("#overlay-text").textContent = label;
    overlay.hidden = false;
    try { await task(); } catch (err) { say(msg, err.message); } finally { overlay.hidden = true; }
  }
  const isDirty = () => text.value !== doc.content;
  const save = async () => show(await api("/documents/" + id, { method: "PUT", body: { content: text.value } }));

  try { show(await api("/documents/" + id)); } catch (err) { return say(msg, err.message); }

  $("#edit-btn").addEventListener("click", () => {
    if (doc.signature && !confirm("Editing will remove the current signature. Continue?")) return;
    text.readOnly = false;
    saveBtn.disabled = false;
    text.focus();
  });

  saveBtn.addEventListener("click", () => run("Saving…", async () => { await save(); say(msg, "Saved.", "ok"); }));

  $("#regen-btn").addEventListener("click", () => {
    if (!confirm("Regenerate the draft? Your current text and signature will be replaced.")) return;
    run("🤖 LegalEase is preparing your document…", async () =>
      show(await api(`/documents/${id}/regenerate`, { method: "POST" })));
  });

  $("#pdf-btn").addEventListener("click", () =>
    run("Creating your PDF…", async () => {
      if (isDirty()) await save(); // make sure the PDF matches what is on screen
      const blob = await api(`/documents/${id}/pdf`, { blob: true });
      const url = URL.createObjectURL(blob);
      const link = el("a");
      link.href = url;
      link.download = doc.title.replace(/[^\w-]+/g, "_") + ".pdf";
      link.click();
      URL.revokeObjectURL(url);
    }));

  /* Signature pad: pointer events cover mouse, pen and touch. */
  const canvas = $("#sig-canvas"), ctx = canvas.getContext("2d"), dialog = $("#sig-dialog"), sigMsg = $("#sig-msg");
  let drawing = false, hasInk = false;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#2B124C";

  const pointOf = (e) => {
    const rect = canvas.getBoundingClientRect(); // canvas is scaled by CSS, so convert coordinates
    return [(e.clientX - rect.left) * (canvas.width / rect.width), (e.clientY - rect.top) * (canvas.height / rect.height)];
  };
  const clearPad = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); hasInk = false; say(sigMsg, ""); };

  canvas.addEventListener("pointerdown", (e) => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    ctx.beginPath();
    ctx.moveTo(...pointOf(e));
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    ctx.lineTo(...pointOf(e));
    ctx.stroke();
    hasInk = true;
  });
  ["pointerup", "pointercancel"].forEach((name) => canvas.addEventListener(name, () => (drawing = false)));

  $("#sign-btn").addEventListener("click", () => { clearPad(); dialog.showModal(); });
  $("#sig-clear").addEventListener("click", clearPad);
  $("#sig-cancel").addEventListener("click", () => dialog.close());
  $("#sig-save").addEventListener("click", () => {
    if (!hasInk) return say(sigMsg, "Please draw your signature first.");
    const signature = canvas.toDataURL("image/png");
    dialog.close();
    run("Saving signature…", async () => {
      if (isDirty()) await save();
      show(await api(`/documents/${id}/sign`, { method: "POST", body: { signature } }));
      say(msg, "Signature added (demonstration only).", "ok");
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  renderChrome(page);
  const inits = { login: initLogin, dashboard: initDashboard, create: initCreate, preview: initPreview };
  if (inits[page]) inits[page]();
});