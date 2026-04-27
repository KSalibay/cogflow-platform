    "use strict";
    const API = "";

    // ── CSRF ──────────────────────────────────────────────────
    function getCsrf() {
      const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : "";
    }

    function postOpts(body) {
      return {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrf() },
        body: JSON.stringify(body),
      };
    }

    async function ensureCsrfReady() {
      if (getCsrf()) return true;
      try {
        await fetch(`${API}/api/v1/auth/csrf`, { credentials: "include" });
      } catch {
        return false;
      }
      return !!getCsrf();
    }

    // ── State ─────────────────────────────────────────────────
    let currentUser   = null;
    let mfaSetupState = null;
    let studiesList   = [];
    let studiesLoadInFlight = false;
    let studiesLoadQueued = false;
    let integrationsRollout = null;
    const latestConfigCache = {};
    const studyUiState = {};
    let studiesRefreshTimer = null;
    let analysisJobsRefreshTimer = null;
    let activeView = "studiesManagement";

    function getStudyState(slug) {
      const k = String(slug || "");
      if (!studyUiState[k]) {
        studyUiState[k] = {
          expanded: false, rollout: null,
          runs: [], runsLoaded: false, runsLoading: false, runsError: null,
          decryptions: {}, exportBusy: false,
          taskProfile: null,
        };
      }
      return studyUiState[k];
    }

    function studyTaskProfileStorageKey(slug) {
      return `cogflow_study_task_profile::${String(slug || "").trim().toLowerCase()}`;
    }

    function loadStudyTaskProfile(slug) {
      const key = studyTaskProfileStorageKey(slug);
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.items)) return null;
        return parsed;
      } catch {
        return null;
      }
    }

    function saveStudyTaskProfile(slug, profile) {
      const key = studyTaskProfileStorageKey(slug);
      try {
        localStorage.setItem(key, JSON.stringify(profile || { items: [] }));
      } catch {
        // ignore localStorage failures
      }
    }

    function taskDisplayNameForConfig(cfg) {
      const j = (cfg && typeof cfg === "object") ? (cfg.config || {}) : {};
      const fromJson = (j.task_name || j.task_label || j.name || "").toString().trim();
      if (fromJson) return fromJson;
      const taskType = (cfg?.task_type || "task").toString().trim().toLowerCase() || "task";
      const ver = (cfg?.config_version_label || "").toString().trim();
      return ver ? `${taskType} · ${ver}` : taskType;
    }

    function buildDefaultTaskProfile(configs) {
      return {
        items: (Array.isArray(configs) ? configs : []).map((cfg) => ({
          config_version_id: String(cfg?.config_version_id || "").trim(),
          task_type: (cfg?.task_type || "").toString().trim().toLowerCase(),
          label: taskDisplayNameForConfig(cfg),
          enabled: true,
        })).filter((x) => !!x.config_version_id),
      };
    }

    function normalizeTaskProfileForConfigs(profile, configs) {
      const cfgs = Array.isArray(configs) ? configs : [];
      const defaults = buildDefaultTaskProfile(cfgs);
      const byId = new Map(defaults.items.map((x) => [x.config_version_id, { ...x }]));
      const out = [];

      if (profile && Array.isArray(profile.items)) {
        for (const item of profile.items) {
          const id = String(item?.config_version_id || "").trim();
          if (!id || !byId.has(id)) continue;
          const base = byId.get(id);
          out.push({
            ...base,
            label: (item?.label || base.label || "").toString(),
            enabled: item?.enabled !== false,
          });
          byId.delete(id);
        }
      }

      for (const x of byId.values()) out.push(x);
      return { items: out };
    }

    // ── Utilities ─────────────────────────────────────────────
    function esc(v) {
      return String(v ?? "")
        .replaceAll("&","&amp;").replaceAll("<","&lt;")
        .replaceAll(">","&gt;").replaceAll('"',"&quot;");
    }

    function fmt(iso) {
      if (!iso) return "—";
      const d = new Date(iso);
      return isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
    }

    function absUrl(raw) {
      const s = (raw || "").toString().trim();
      if (!s || s === "-") return s;
      if (/^https?:\/\//i.test(s)) return s;
      try { return new URL(s, location.origin).toString(); } catch { return s; }
    }

    function ensureGenerateLinksModal() {
      let modalEl = document.getElementById("generateLinksModal");
      if (modalEl) return modalEl;

      const host = document.createElement("div");
      host.innerHTML = `
        <div class="modal fade" id="generateLinksModal" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog modal-lg modal-dialog-scrollable">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">Generate Participant Links</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
              </div>
              <div class="modal-body">
                <div id="generateLinksError" class="alert alert-danger py-2 d-none" role="alert"></div>
                <div class="account-field" style="margin-bottom:10px;">
                  <label for="generateLinksParticipantId">Participant ID (optional)</label>
                  <input type="text" id="generateLinksParticipantId" placeholder="leave blank for anonymous/preview-style launch" />
                </div>
                <div class="form-check" style="margin-bottom:12px;">
                  <input class="form-check-input" type="checkbox" id="generateLinksCounterbalance" checked>
                  <label class="form-check-label" for="generateLinksCounterbalance">Enable automatic counterbalancing</label>
                </div>
                <div id="generateLinksOrderWrap">
                  <label class="form-label" style="font-weight:600;">Task order (used when counterbalancing is OFF)</label>
                  <div class="text-muted" style="font-size:.84rem;margin-bottom:8px;">Drag to reorder tasks.</div>
                  <ul id="generateLinksTaskOrder" class="list-group"></ul>
                </div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                <button type="button" class="btn btn-primary" id="generateLinksConfirmBtn">Generate</button>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(host.firstElementChild);
      modalEl = document.getElementById("generateLinksModal");
      modalEl.querySelectorAll('[data-bs-dismiss="modal"]').forEach((btn) => {
        btn.addEventListener("click", () => hideGeneratedModal(modalEl));
      });
      modalEl.addEventListener("click", (e) => {
        if (e.target === modalEl) hideGeneratedModal(modalEl);
      });
      return modalEl;
    }

    function showGeneratedModal(modalEl) {
      if (!modalEl) return;
      if (window.bootstrap && window.bootstrap.Modal) {
        window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
        return;
      }

      let backdrop = document.getElementById("generateLinksModalBackdrop");
      if (!backdrop) {
        backdrop = document.createElement("div");
        backdrop.id = "generateLinksModalBackdrop";
        backdrop.className = "modal-backdrop";
        backdrop.addEventListener("click", () => hideGeneratedModal(modalEl));
        document.body.appendChild(backdrop);
      }
      modalEl.classList.add("show");
      modalEl.setAttribute("aria-modal", "true");
      modalEl.removeAttribute("aria-hidden");
      document.body.style.overflow = "hidden";
    }

    function hideGeneratedModal(modalEl) {
      if (!modalEl) return;
      if (window.bootstrap && window.bootstrap.Modal) {
        window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        return;
      }

      modalEl.classList.remove("show");
      modalEl.setAttribute("aria-hidden", "true");
      modalEl.removeAttribute("aria-modal");
      const backdrop = document.getElementById("generateLinksModalBackdrop");
      if (backdrop) backdrop.remove();
      document.body.style.overflow = "";
    }

    function ensureStudyPropertiesModal() {
      let modalEl = document.getElementById("studyPropertiesModal");
      if (modalEl) return modalEl;

      const host = document.createElement("div");
      host.innerHTML = `
        <div class="modal fade" id="studyPropertiesModal" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog modal-lg modal-dialog-scrollable">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">Study Properties</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
              </div>
              <div class="modal-body">
                <div id="studyPropertiesError" class="alert alert-danger py-2 d-none" role="alert"></div>
                <p style="margin:0 0 10px;color:var(--muted);font-size:.84rem;">Select which tasks are active for this study, rename display labels, and drag to change launch order.</p>
                <ul id="studyPropertiesTaskList" class="list-group"></ul>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                <button type="button" class="btn btn-primary" id="studyPropertiesSaveBtn">Save Properties</button>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(host.firstElementChild);
      modalEl = document.getElementById("studyPropertiesModal");
      modalEl.querySelectorAll('[data-bs-dismiss="modal"]').forEach((btn) => {
        btn.addEventListener("click", () => hideStudyPropertiesModal(modalEl));
      });
      modalEl.addEventListener("click", (e) => {
        if (e.target === modalEl) hideStudyPropertiesModal(modalEl);
      });
      return modalEl;
    }

    function showStudyPropertiesModal(modalEl) {
      if (!modalEl) return;
      if (window.bootstrap && window.bootstrap.Modal) {
        window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
        return;
      }

      let backdrop = document.getElementById("studyPropertiesModalBackdrop");
      if (!backdrop) {
        backdrop = document.createElement("div");
        backdrop.id = "studyPropertiesModalBackdrop";
        backdrop.className = "modal-backdrop";
        backdrop.addEventListener("click", () => hideStudyPropertiesModal(modalEl));
        document.body.appendChild(backdrop);
      }
      modalEl.classList.add("show");
      modalEl.setAttribute("aria-modal", "true");
      modalEl.removeAttribute("aria-hidden");
      document.body.style.overflow = "hidden";
    }

    function hideStudyPropertiesModal(modalEl) {
      if (!modalEl) return;
      if (window.bootstrap && window.bootstrap.Modal) {
        window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        return;
      }

      modalEl.classList.remove("show");
      modalEl.setAttribute("aria-hidden", "true");
      modalEl.removeAttribute("aria-modal");
      const backdrop = document.getElementById("studyPropertiesModalBackdrop");
      if (backdrop) backdrop.remove();
      document.body.style.overflow = "";
    }

    function buildTaskProfileFromList(listEl) {
      const items = Array.from(listEl?.querySelectorAll("li") || []).map((li) => ({
        config_version_id: String(li.dataset.configId || "").trim(),
        task_type: String(li.dataset.taskType || "").trim().toLowerCase(),
        label: (li.querySelector("input[data-role='task-label']")?.value || "").toString().trim(),
        enabled: !!li.querySelector("input[data-role='task-enabled']")?.checked,
      })).filter((x) => !!x.config_version_id);
      return { items };
    }

    async function openStudyPropertiesModal(slug) {
      const modalEl = ensureStudyPropertiesModal();
      const errEl = document.getElementById("studyPropertiesError");
      const listEl = document.getElementById("studyPropertiesTaskList");
      const saveBtn = document.getElementById("studyPropertiesSaveBtn");
      const st = getStudyState(slug);

      const setErr = (msg) => {
        const s = (msg || "").toString().trim();
        errEl.textContent = s;
        errEl.classList.toggle("d-none", !s);
      };

      setErr("");
      listEl.innerHTML = "";

      try {
        const payload = await fetchStudyLatestConfig(slug);
        const cfgs = Array.isArray(payload?.configs) ? payload.configs : [];
        const stored = st.taskProfile || loadStudyTaskProfile(slug);
        const profile = normalizeTaskProfileForConfigs(stored, cfgs);
        st.taskProfile = profile;

        profile.items.forEach((item) => {
          const li = document.createElement("li");
          li.className = "list-group-item";
          li.dataset.configId = item.config_version_id;
          li.dataset.taskType = item.task_type || "";
          li.innerHTML = `
            <div class="study-prop-row">
              <label style="display:inline-flex;align-items:center;gap:7px;cursor:pointer;">
                <input type="checkbox" data-role="task-enabled" ${item.enabled ? "checked" : ""} />
                <span style="font-size:.82rem;color:var(--muted);">Include</span>
              </label>
              <input type="text" data-role="task-label" value="${esc(item.label || item.task_type || "task")}" />
              <span class="task-order-grip" aria-hidden="true">⋮⋮</span>
            </div>
          `;
          listEl.appendChild(li);
        });
        setupDragList(listEl);
      } catch (err) {
        setErr(err?.message || String(err));
      }

      saveBtn.onclick = () => {
        const profile = buildTaskProfileFromList(listEl);
        if (!profile.items.some((x) => x.enabled !== false)) {
          setErr("At least one task must remain enabled.");
          return;
        }
        st.taskProfile = profile;
        saveStudyTaskProfile(slug, profile);
        hideStudyPropertiesModal(modalEl);
        refreshStudiesUiFromCache();
      };

      showStudyPropertiesModal(modalEl);
    }

    function setupDragList(listEl) {
      if (!listEl) return;
      let dragEl = null;

      listEl.querySelectorAll("li").forEach((li) => {
        li.draggable = true;
        li.addEventListener("dragstart", () => {
          dragEl = li;
          li.classList.add("dragging");
        });
        li.addEventListener("dragend", () => {
          li.classList.remove("dragging");
          dragEl = null;
        });
        li.addEventListener("dragover", (e) => {
          e.preventDefault();
        });
        li.addEventListener("drop", (e) => {
          e.preventDefault();
          if (!dragEl || dragEl === li) return;
          const rect = li.getBoundingClientRect();
          const before = (e.clientY - rect.top) < rect.height / 2;
          if (before) listEl.insertBefore(dragEl, li);
          else listEl.insertBefore(dragEl, li.nextSibling);
        });
      });
    }

    async function openGenerateLinksModal(slug) {
      const modalEl = ensureGenerateLinksModal();
      const errEl = document.getElementById("generateLinksError");
      const pidEl = document.getElementById("generateLinksParticipantId");
      const cbEl = document.getElementById("generateLinksCounterbalance");
      const wrapEl = document.getElementById("generateLinksOrderWrap");
      const listEl = document.getElementById("generateLinksTaskOrder");
      const confirmBtn = document.getElementById("generateLinksConfirmBtn");

      const setErr = (msg) => {
        const s = (msg || "").toString().trim();
        errEl.textContent = s;
        errEl.classList.toggle("d-none", !s);
      };

      setErr("");
      pidEl.value = "";
      cbEl.checked = true;
      listEl.innerHTML = "";
      wrapEl.style.opacity = "0.55";
      wrapEl.style.pointerEvents = "none";

      cbEl.onchange = () => {
        const on = !!cbEl.checked;
        wrapEl.style.opacity = on ? "0.55" : "1";
        wrapEl.style.pointerEvents = on ? "none" : "auto";
      };

      try {
        const payload = await fetchStudyLatestConfig(slug);
        const cfgs = Array.isArray(payload?.configs) ? payload.configs : [];
        const st = getStudyState(slug);
        const profile = normalizeTaskProfileForConfigs(st.taskProfile || loadStudyTaskProfile(slug), cfgs);
        st.taskProfile = profile;

        const cfgById = new Map(cfgs.map((c) => [String(c?.config_version_id || "").trim(), c]));
        profile.items.forEach((item) => {
          const c = cfgById.get(item.config_version_id);
          if (!c) return;
          const li = document.createElement("li");
          li.className = "list-group-item";
          li.dataset.configId = (c?.config_version_id || "").toString();
          const task = (c?.task_type || "task").toString();
          const ver = (c?.config_version_label || "").toString();
          li.innerHTML = `
            <div class="task-order-item">
              <span style="display:inline-flex;align-items:center;gap:7px;">
                <input type="checkbox" data-role="task-enabled" ${item.enabled ? "checked" : ""} />
                <span><strong>${esc(item.label || task)}</strong> <span class="text-muted" style="font-size:.8rem;">${esc(ver)}</span></span>
              </span>
              <span class="task-order-grip" aria-hidden="true">⋮⋮</span>
            </div>
          `;
          listEl.appendChild(li);
        });
        setupDragList(listEl);
      } catch (e) {
        setErr(e?.message || String(e));
      }

      confirmBtn.onclick = async () => {
        confirmBtn.disabled = true;
        setErr("");
        try {
          const taskRows = Array.from(listEl.querySelectorAll("li"));
          const taskOrder = taskRows
            .filter((li) => !!li.querySelector("input[data-role='task-enabled']")?.checked)
            .map((li) => (li.dataset.configId || "").toString().trim())
            .filter(Boolean);

          if (!taskOrder.length) {
            throw new Error("Select at least one task to include in generated links.");
          }

          const profile = buildTaskProfileFromList(listEl);
          const st = getStudyState(slug);
          st.taskProfile = profile;
          saveStudyTaskProfile(slug, profile);

          const hasDisabledTasks = taskOrder.length !== taskRows.length;
          const strictOrder = hasDisabledTasks || !cbEl.checked;

          await generateLink(slug, pidEl.value || "", null, null, {
            counterbalance_enabled: strictOrder ? false : !!cbEl.checked,
            task_order: taskOrder,
            task_order_strict: strictOrder,
          });
          hideGeneratedModal(modalEl);
        } catch (e) {
          setErr(e?.message || String(e));
        } finally {
          confirmBtn.disabled = false;
        }
      };

      showGeneratedModal(modalEl);
    }

    async function copyText(text, btn) {
      const orig = btn?.textContent;
      try {
        await navigator.clipboard.writeText(String(text || ""));
        if (btn) { btn.textContent = "Copied!"; setTimeout(() => btn.textContent = orig, 1400); }
      } catch {
        if (btn) { btn.textContent = "Failed";  setTimeout(() => btn.textContent = orig, 1400); }
      }
    }

    // ── Download helpers ───────────────────────────────────────
    function dlJson(name, obj) {
      const b = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(b), download: name });
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
    }

    function csvEsc(v) {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    }

    function flatCsv(obj, prefix = "") {
      const out = {};
      for (const [k, v] of Object.entries(obj && typeof obj === "object" ? obj : {})) {
        const key = prefix ? `${prefix}_${k}` : k;
        if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flatCsv(v, key));
        else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
      }
      return out;
    }

    function toCsv(rows) {
      const hs = [];
      for (const r of rows) for (const k of Object.keys(r || {})) if (!hs.includes(k)) hs.push(k);
      if (!hs.length) return "";
      return [hs.map(csvEsc).join(","), ...rows.map(r => hs.map(h => csvEsc((r || {})[h])).join(","))].join("\n");
    }

    function dlCsv(name, rows) {
      const b = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(b), download: name });
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
    }

    async function dlZip(name, files) {
      if (!window.JSZip) throw new Error("ZIP export library unavailable");
      const zip = new window.JSZip();
      for (const f of files || []) {
        const fileName = String(f?.name || "").trim();
        if (!fileName) continue;
        zip.file(fileName, String(f?.content ?? ""));
      }
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
    }

    function mkBundle(run, dec) {
      return { run_session_id: run.run_session_id, status: run.status,
               started_at: run.started_at, completed_at: run.completed_at,
               trial_count: run.trial_count, participant_key_preview: run.participant_key_preview,
               result_payload: dec.result_payload || {} };
    }

    function bundleRows(bundle) {
      const trials = Array.isArray(bundle?.result_payload?.trials) ? bundle.result_payload.trials : [];
      const base = { run_session_id: bundle.run_session_id, status: bundle.status,
                     started_at: bundle.started_at, completed_at: bundle.completed_at,
                     participant_key_preview: bundle.participant_key_preview, trial_count: bundle.trial_count };
      if (!trials.length) return [base];
      return trials.map((t, i) => ({ ...base, trial_row_index: i, ...flatCsv(t, "trial") }));
    }

    async function fetchDec(runId) {
      const r = await fetch(`${API}/api/v1/results/decrypt`, postOpts({ run_session_id: runId }));
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      return d;
    }

    // ── Navigation ─────────────────────────────────────────────
    const VIEWS = ["studiesManagement","studiesResults","builder","preview","analysis","integrations","ethics","credits","feedback","admin","account"];
    let builderLoaded = false;
    let adminUsersLoaded = false;
    let adminUsers = [];
    let creditsEntries = [];
    let creditsTaskScopes = [];
    let creditsRoles = [];
    let creditsUsernames = [];
    let creditsDraftRows = [];
    let creditsLoaded = false;
    let creditsEditMode = false;

    function normalizeTheme(theme) {
      return theme === "dark" ? "dark" : "light";
    }

    function normalizeA11yMode(mode) {
      const m = (mode || "").toString().trim().toLowerCase();
      if (m === "contrast" || m === "large" || m === "contrast-large") return m;
      return "standard";
    }

    function getPortalA11yStorageKey() {
      const username = (currentUser?.username || "default").toString().trim() || "default";
      return `cogflow_portal_a11y::${username}`;
    }

    function getStoredPortalTheme() {
      try {
        return normalizeTheme(localStorage.getItem("cogflow_portal_theme") || "light");
      } catch {
        return "light";
      }
    }

    let currentTheme = getStoredPortalTheme();
    let currentA11yMode = "standard";

    function builderThemeUrl(theme) {
      const t = normalizeTheme(theme);
      const user = (currentUser?.username || "").toString().trim();
      const userPart = user ? `&builder_user=${encodeURIComponent(user)}` : "";
      const a11yPart = `&a11y_mode=${encodeURIComponent(normalizeA11yMode(currentA11yMode))}`;
      return `/builder/?theme=${encodeURIComponent(t)}${userPart}${a11yPart}&v=20260402-3`;
    }

    function notifyBuilderTheme(theme) {
      const frame = document.getElementById("builderFrame");
      if (!frame || !frame.contentWindow) return;
      try {
        frame.contentWindow.postMessage({ type: "cogflow:set-theme", theme: normalizeTheme(theme) }, location.origin);
      } catch {
        // ignore
      }
    }

    function notifyBuilderA11y(mode) {
      const frame = document.getElementById("builderFrame");
      if (!frame || !frame.contentWindow) return;
      try {
        frame.contentWindow.postMessage({ type: "cogflow:set-a11y", mode: normalizeA11yMode(mode) }, location.origin);
      } catch {
        // ignore
      }
    }

    function applyPortalTheme(theme, persist = true) {
      currentTheme = normalizeTheme(theme);
      document.documentElement.setAttribute("data-cf-theme", currentTheme);
      const btn = document.getElementById("portalThemeToggle");
      if (btn) btn.textContent = `Theme: ${currentTheme === "dark" ? "Dark" : "Light"}`;
      if (persist) {
        try {
          localStorage.setItem("cogflow_portal_theme", currentTheme);
          // Keep Builder consistent when opened directly as well.
          localStorage.setItem("cogflow_builder_theme", currentTheme);
        } catch {
          // ignore
        }
      }
      if (builderLoaded) notifyBuilderTheme(currentTheme);
    }

    function applyPortalA11y(mode, persist = true) {
      currentA11yMode = normalizeA11yMode(mode);
      const html = document.documentElement;
      html.classList.remove("cf-a11y-contrast", "cf-a11y-large");
      if (currentA11yMode === "contrast") html.classList.add("cf-a11y-contrast");
      if (currentA11yMode === "large") html.classList.add("cf-a11y-large");
      if (currentA11yMode === "contrast-large") {
        html.classList.add("cf-a11y-contrast");
        html.classList.add("cf-a11y-large");
      }

      const sel = document.getElementById("portalA11ySelect");
      if (sel) sel.value = currentA11yMode;

      if (persist) {
        try {
          localStorage.setItem(getPortalA11yStorageKey(), currentA11yMode);
        } catch {
          // ignore
        }
      }

      if (builderLoaded) notifyBuilderA11y(currentA11yMode);
    }

    function loadPortalA11yPreference() {
      let mode = "standard";
      try {
        mode = normalizeA11yMode(localStorage.getItem(getPortalA11yStorageKey()) || "standard");
      } catch {
        mode = "standard";
      }
      applyPortalA11y(mode, false);
    }

    applyPortalTheme(currentTheme, false);
    applyPortalA11y("standard", false);

    function isAnalystRole() {
      return String(currentUser?.role || "").trim().toLowerCase() === "analyst";
    }

    function canAccessView(id) {
      if (!currentUser) return true;
      if (isAnalystRole() && (id === "builder" || id === "preview")) return false;
      return true;
    }

    function setNavLockState(el, locked, reason) {
      if (!el) return;
      el.classList.toggle("nav-locked", !!locked);
      if (locked && reason) {
        el.setAttribute("title", reason);
      } else {
        el.removeAttribute("title");
      }
      el.setAttribute("aria-disabled", locked ? "true" : "false");
    }

    function applyRoleBasedUiLocks() {
      const analystLocked = isAnalystRole();
      const reason = "Unavailable for analyst role.";
      setNavLockState(document.getElementById("navBuilder"), analystLocked, reason);
      setNavLockState(document.getElementById("navPreview"), analystLocked, reason);

      const previewStudy = document.getElementById("previewStudySelect");
      const previewTask = document.getElementById("previewTaskSelect");
      const previewLaunch = document.getElementById("previewLaunchBtn");
      if (previewStudy) previewStudy.disabled = analystLocked;
      if (previewTask) previewTask.disabled = analystLocked;
      if (previewLaunch) {
        previewLaunch.classList.toggle("btn-locked", analystLocked);
        previewLaunch.setAttribute("aria-disabled", analystLocked ? "true" : "false");
        if (analystLocked) {
          previewLaunch.setAttribute("title", reason);
        } else {
          previewLaunch.removeAttribute("title");
        }
      }
    }

    function activateView(id) {
      if (!canAccessView(id)) {
        const statusEl = document.getElementById("studiesStatus") || document.getElementById("studiesResultsStatus");
        if (statusEl) {
          statusEl.className = "status-bar";
          statusEl.textContent = "This section is unavailable for analyst role.";
        }
        return;
      }
      activeView = id;
      VIEWS.forEach(v => {
        document.getElementById(`view${v[0].toUpperCase()}${v.slice(1)}`)?.classList.toggle("active", v === id);
        const navEl = document.getElementById(`nav${v[0].toUpperCase()}${v.slice(1)}`);
        if (navEl) navEl.classList.toggle("active", v === id);
      });

      const isStudiesView = (id === "studiesManagement" || id === "studiesResults");
      if (isStudiesView) {
        document.getElementById("navStudies")?.classList.add("active");
      }
      document.getElementById("navStudiesManagement")?.classList.toggle("active", id === "studiesManagement");
      document.getElementById("navStudiesResults")?.classList.toggle("active", id === "studiesResults");
      document.getElementById("subNavStudies")?.classList.toggle("hidden", !isStudiesView);

      if (id === "builder" && !builderLoaded) {
        document.getElementById("builderFrame").src = builderThemeUrl(currentTheme);
        builderLoaded = true;
      }
      if (id === "admin" && currentUser?.role === "platform_admin" && !adminUsersLoaded) {
        loadAdminUsers();
      }
      if (id === "credits") {
        if (!creditsLoaded) {
          loadCredits();
        } else {
          renderCreditsView();
        }
      }

      if (id === "analysis") {
        const out = document.getElementById("analysisReportOutput");
        if (out && !out.value.trim()) {
          out.value = "# Analysis report\n\nNo report generated yet.";
        }
        const selectedStudy = String(document.getElementById("analysisStudySelect")?.value || "").trim();
        if (selectedStudy) loadAnalysisJobs(selectedStudy);
      }

      // Keep study-dependent views fresh without requiring full-page reload.
      if (isStudiesView || id === "preview" || id === "analysis" || id === "integrations") {
        loadStudies();
      }
    }

    function getAnalysisRequestPayload() {
      const studySlug = String(document.getElementById("analysisStudySelect")?.value || "").trim();
      const engine = String(document.getElementById("analysisEngineSelect")?.value || "python").trim().toLowerCase();
      const maxVarsRaw = Number(document.getElementById("analysisMaxVarsInput")?.value || 20);
      const maxVariables = Math.max(1, Math.min(200, Number.isFinite(maxVarsRaw) ? Math.round(maxVarsRaw) : 20));
      const includeCompletedOnly = !!document.getElementById("analysisCompletedOnly")?.checked;
      const includeOverview = !!document.getElementById("analysisIncludeOverview")?.checked;
      const includeFieldCoverage = !!document.getElementById("analysisIncludeCoverage")?.checked;
      const includeNumericSummary = !!document.getElementById("analysisIncludeSummary")?.checked;
      const includeConfigFields = !!document.getElementById("analysisIncludeConfigFields")?.checked;
      const fieldsOfInterestRaw = String(document.getElementById("analysisFieldsOfInterestInput")?.value || "");
      const fieldsOfInterest = fieldsOfInterestRaw
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
      const requestedFormats = ["markdown", "html", "pdf", "snapshot"];
      if (engine === "r") requestedFormats.push("rmd");
      return {
        study_slug: studySlug,
        engine,
        include_completed_only: includeCompletedOnly,
        requested_formats: requestedFormats,
        options: {
          include_overview: includeOverview,
          include_field_coverage: includeFieldCoverage,
          include_numeric_summary: includeNumericSummary,
          include_config_fields: includeConfigFields,
          fields_of_interest: fieldsOfInterest,
          max_variables: maxVariables,
        },
      };
    }

    function renderAnalysisJobs(jobs) {
      const listEl = document.getElementById("analysisJobsList");
      if (!listEl) return;
      const rows = Array.isArray(jobs) ? jobs : [];
      if (!rows.length) {
        listEl.innerHTML = '<div style="color:var(--muted);">No report jobs yet for this study.</div>';
        return;
      }
      listEl.innerHTML = rows.map((job) => {
        const artifacts = Array.isArray(job.artifacts) ? job.artifacts : [];
        const artifactLinks = artifacts.length
          ? artifacts.map((artifact) => `<a class="btn btn-ghost btn-xs" href="${esc(artifact.download_url || "")}" target="_blank" rel="noopener">${esc((artifact.format || "file").toUpperCase())}</a>`).join(" ")
          : '<span style="color:var(--muted);">No artifacts yet</span>';
        const statusTone = job.status === "succeeded" ? "var(--ok)" : (job.status === "failed" ? "var(--warn)" : "var(--muted)");
        const cancelBtn = job.status === "queued"
          ? `<button class="btn btn-ghost btn-xs" style="color:var(--warn);" onclick="cancelAnalysisJob(${Number(job.id)})">Cancel</button>`
          : "";
        const workerLogId = `workerLog_${Number(job.id)}`;
        const workerLogSection = job.worker_log
          ? `<details style="margin-top:6px;font-size:.78rem;">
               <summary style="cursor:pointer;color:var(--muted);">Worker log</summary>
               <pre style="margin:4px 0 0;padding:6px 8px;background:var(--surface2,#f7f8fb);border-radius:6px;white-space:pre-wrap;word-break:break-all;max-height:160px;overflow-y:auto;" id="${workerLogId}">${esc(job.worker_log)}</pre>
             </details>`
          : "";
        return `
          <div data-analysis-job-id="${Number(job.id)}" style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-top:8px;">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;">
              <div>
                <strong>Job #${Number(job.id)}</strong>
                <div style="font-size:.82rem;color:${statusTone};text-transform:capitalize;">${esc(job.status || "unknown")}</div>
                <div style="font-size:.78rem;color:var(--muted);">${esc((job.engine || "python").toUpperCase())} · created ${esc(fmt(job.created_at))}</div>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">${artifactLinks}${cancelBtn}</div>
            </div>
            ${job.error_message ? `<div style="margin-top:8px;color:var(--warn);font-size:.82rem;">${esc(job.error_message)}</div>` : ""}
            ${workerLogSection}
          </div>`;
      }).join("");
    }

    async function cancelAnalysisJob(jobId) {
      const studySlug = String(document.getElementById("analysisStudySelect")?.value || "").trim();
      try {
        const r = await fetch(`${API}/api/v1/studies/analysis/jobs/${jobId}/cancel`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrf() },
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        if (studySlug) await loadAnalysisJobs(studySlug);
      } catch (err) {
        const statusEl = document.getElementById("analysisStatus");
        if (statusEl) {
          statusEl.className = "status-bar error";
          statusEl.textContent = `Cancel failed: ${err?.message || err}`;
        }
      }
    }

    async function loadAnalysisPreview(job) {
      const outputEl = document.getElementById("analysisReportOutput");
      if (!outputEl || !job) return;
      const artifacts = Array.isArray(job.artifacts) ? job.artifacts : [];
      const preferred = artifacts.find((artifact) => artifact.format === "markdown") || artifacts.find((artifact) => artifact.format === "html");
      if (!preferred?.download_url) return;
      try {
        const r = await fetch(preferred.download_url, { credentials: "include" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        outputEl.value = await r.text();
      } catch {
        // Keep current output when preview fetch fails.
      }
    }

    function scheduleAnalysisJobsRefresh(studySlug, jobs) {
      if (analysisJobsRefreshTimer) {
        clearTimeout(analysisJobsRefreshTimer);
        analysisJobsRefreshTimer = null;
      }
      const pending = (jobs || []).some((job) => ["queued", "running"].includes(String(job?.status || "").trim().toLowerCase()));
      if (!pending || !studySlug) return;
      analysisJobsRefreshTimer = window.setTimeout(() => {
        loadAnalysisJobs(studySlug);
      }, 2000);
    }

    async function loadAnalysisJobs(studySlug) {
      const statusEl = document.getElementById("analysisStatus");
      const slug = String(studySlug || document.getElementById("analysisStudySelect")?.value || "").trim();
      renderAnalysisJobs([]);
      if (!slug) {
        if (statusEl) {
          statusEl.className = "status-bar";
          statusEl.textContent = "Pick a study and generate a report.";
        }
        return;
      }
      try {
        const r = await fetch(`${API}/api/v1/studies/analysis/jobs?study_slug=${encodeURIComponent(slug)}`, { credentials: "include" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        const jobs = Array.isArray(d.jobs) ? d.jobs : [];
        renderAnalysisJobs(jobs);
        const latestSucceeded = jobs.find((job) => String(job?.status || "") === "succeeded");
        if (latestSucceeded) await loadAnalysisPreview(latestSucceeded);
        scheduleAnalysisJobsRefresh(slug, jobs);
      } catch (err) {
        if (statusEl) {
          statusEl.className = "status-bar error";
          statusEl.textContent = `Failed to load report jobs: ${err?.message || err}`;
        }
      }
    }

    async function runAnalysisReport() {
      const statusEl = document.getElementById("analysisStatus");
      const payload = getAnalysisRequestPayload();
      if (!payload.study_slug) {
        if (statusEl) {
          statusEl.className = "status-bar error";
          statusEl.textContent = "Please select a study first.";
        }
        return;
      }

      if (statusEl) {
        statusEl.className = "status-bar";
        statusEl.textContent = "Queueing analysis report job…";
      }

      try {
        const r = await fetch(`${API}/api/v1/studies/analysis/jobs`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrf() },
          body: JSON.stringify(payload),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        const job = d?.job || {};
        if (statusEl) {
          statusEl.className = "status-bar ok";
          statusEl.textContent = `Queued report job #${job.id} (${String(payload.engine || "python").toUpperCase()}). HTML and PDF artifacts will appear when rendering finishes.`;
        }
        await loadAnalysisJobs(payload.study_slug);
      } catch (err) {
        if (statusEl) {
          statusEl.className = "status-bar error";
          statusEl.textContent = `Analysis failed: ${err?.message || err}`;
        }
      }
    }

    function populateAnalysisStudySelect(studies) {
      const sel = document.getElementById("analysisStudySelect");
      if (!sel) return;
      const prev = sel.value;
      sel.innerHTML = '<option value="">— Select study —</option>';
      for (const s of studies) {
        const o = document.createElement("option");
        o.value = s.study_slug;
        o.textContent = s.study_name || s.study_slug;
        sel.appendChild(o);
      }
      if (prev) sel.value = prev;
      if (activeView === "analysis" && sel.value) loadAnalysisJobs(sel.value);
    }

    function getCreditsTaskScopeMap() {
      const map = new Map();
      (Array.isArray(creditsTaskScopes) ? creditsTaskScopes : []).forEach((s) => {
        const task = String(s?.task_type || "").trim();
        if (!task) return;
        const components = Array.isArray(s?.components) ? s.components.map((x) => String(x || "").trim()).filter(Boolean) : [];
        map.set(task, components);
      });
      return map;
    }

    function uniqList(items) {
      return Array.from(new Set((items || []).map((x) => String(x || "").trim()).filter(Boolean)));
    }

    function groupCreditsEntriesForUi(entries) {
      const grouped = new Map();
      (Array.isArray(entries) ? entries : []).forEach((e) => {
        const role = String(e?.credit_role || "").trim();
        const username = String(e?.contributor_username || "").trim();
        const taskType = String(e?.task_type || "").trim();
        const componentType = String(e?.component_type || "").trim();
        const notes = String(e?.notes || "").trim();
        const key = `${taskType}||${componentType}||${username}||${notes}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            id: e?.id ?? null,
            task_type: taskType,
            component_type: componentType,
            notes,
            credit_roles: [],
            contributor_usernames: username ? [username] : [],
          });
        }
        const row = grouped.get(key);
        if (role) row.credit_roles.push(role);
      });

      return Array.from(grouped.values()).map((row) => ({
        ...row,
        credit_roles: uniqList(row.credit_roles || []),
        contributor_usernames: uniqList(row.contributor_usernames || []),
      }));
    }

    function makeCreditsRowDraft() {
      const scopeMap = getCreditsTaskScopeMap();
      const firstTask = creditsTaskScopes?.[0]?.task_type || "";
      const components = scopeMap.get(firstTask) || [];
      return {
        id: null,
        task_type: firstTask,
        component_type: components[0] || "",
        credit_roles: creditsRoles?.length ? [creditsRoles[0]] : [],
        contributor_usernames: creditsUsernames?.length ? [creditsUsernames[0]] : [],
        notes: "",
      };
    }

    async function loadCredits(force = false) {
      const msg = document.getElementById("creditsMsg");
      if (msg) {
        msg.className = "status-bar";
        msg.textContent = "Loading credits…";
      }
      try {
        if (!force && creditsLoaded) {
          renderCreditsView();
          if (msg) {
            msg.className = "status-bar ok";
            msg.textContent = `Loaded ${creditsEntries.length} schema components.`;
          }
          return;
        }

        const r = await fetch(`${API}/api/v1/credits`, { credentials: "include" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        creditsEntries = Array.isArray(d.entries) ? d.entries : [];
        creditsTaskScopes = Array.isArray(d.task_scopes) ? d.task_scopes : [];
        creditsRoles = Array.isArray(d.credit_roles) ? d.credit_roles : [];
        creditsUsernames = Array.isArray(d.usernames) ? d.usernames : [];
        creditsDraftRows = [];
        creditsLoaded = true;
        renderCreditsView();
        if (msg) {
          msg.className = "status-bar ok";
          msg.textContent = `Loaded ${creditsEntries.length} credits rows across ${creditsTaskScopes.length} task scopes.`;
        }
      } catch (err) {
        creditsLoaded = false;
        const body = document.getElementById("creditsTaskRows");
        if (body) {
          body.innerHTML = `<tr><td colspan="6" style="color:var(--warn);">Failed to load credits: ${esc(err?.message || String(err))}</td></tr>`;
        }
        if (msg) {
          msg.className = "status-bar error";
          msg.textContent = `Failed to load credits: ${err?.message || err}`;
        }
      }
    }

    async function saveCreditsFromUi() {
      const rows = Array.isArray(creditsDraftRows) ? creditsDraftRows : [];
      const entries = [];
      rows.forEach((row) => {
        const roles = uniqList(row?.credit_roles || []);
        const username = uniqList(row?.contributor_usernames || [])[0] || "";
        const task_type = String(row?.task_type || "").trim();
        const component_type = String(row?.component_type || "").trim();
        const notes = String(row?.notes || "").trim();
        if (!task_type || !component_type || !username) return;
        roles.forEach((role) => {
          if (!role) return;
          entries.push({ task_type, component_type, credit_role: role, contributor_username: username, notes });
        });
      });

      const msg = document.getElementById("creditsMsg");
      if (msg) {
        msg.className = "status-bar";
        msg.textContent = "Saving credits…";
      }

      const r = await fetch(`${API}/api/v1/credits`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrf() },
        body: JSON.stringify({ entries }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    }

    function renderCreditsView() {
      const body = document.getElementById("creditsTaskRows");
      const scopesBody = document.getElementById("creditsScopeRows");
      if (!body || !scopesBody) return;
      const isAdmin = currentUser?.role === "platform_admin";
      const scopeMap = getCreditsTaskScopeMap();
      const adminActions = document.getElementById("creditsAdminActions");
      const editBtn = document.getElementById("creditsEditBtn");
      const addRowBtn = document.getElementById("creditsAddRowBtn");
      const saveBtn = document.getElementById("creditsSaveBtn");
      const cancelBtn = document.getElementById("creditsCancelBtn");
      if (adminActions) adminActions.style.display = isAdmin ? "" : "none";
      if (editBtn) editBtn.style.display = isAdmin && !creditsEditMode ? "" : "none";
      if (addRowBtn) addRowBtn.style.display = isAdmin && creditsEditMode ? "" : "none";
      if (saveBtn) saveBtn.style.display = isAdmin && creditsEditMode ? "" : "none";
      if (cancelBtn) cancelBtn.style.display = isAdmin && creditsEditMode ? "" : "none";

      scopesBody.innerHTML = (Array.isArray(creditsTaskScopes) ? creditsTaskScopes : []).map((scope) => {
        const taskType = String(scope?.task_type || "");
        const comps = Array.isArray(scope?.components) ? scope.components : [];
        const chips = comps.length
          ? comps.map((x) => `<span class="credit-role-chip">${esc(String(x || ""))}</span>`).join(" ")
          : "—";
        return `<tr>
          <td><span class="mono">${esc(taskType || "—")}</span></td>
          <td>${chips}</td>
        </tr>`;
      }).join("");

      if (!scopesBody.innerHTML.trim()) {
        scopesBody.innerHTML = '<tr><td colspan="2" style="color:var(--muted);">No task scopes found.</td></tr>';
      }

      const rowsForUi = creditsEditMode
        ? (Array.isArray(creditsDraftRows) ? creditsDraftRows : [])
        : groupCreditsEntriesForUi(creditsEntries);

      const optionHtml = (items, selected) => (items || [])
        .map((x) => `<option value="${esc(String(x || ""))}" ${String(x || "") === String(selected || "") ? "selected" : ""}>${esc(String(x || ""))}</option>`)
        .join("");

      const chipListHtml = (items, chipKind, rowIndex, editable) => {
        const list = uniqList(items || []);
        if (!list.length) return '<span style="color:var(--muted);">—</span>';
        return `<div class="credit-chip-list">${list.map((x) => {
          const remove = editable
            ? `<button class="credit-chip-remove" data-action="remove-chip" data-chip-kind="${esc(chipKind)}" data-chip-value="${esc(x)}" data-row-index="${rowIndex}" aria-label="Remove">×</button>`
            : "";
          return `<span class="credit-chip">${esc(x)}${remove}</span>`;
        }).join("")}</div>`;
      };

      body.innerHTML = rowsForUi.map((row, rowIndex) => {
        const taskType = String(row.task_type || "");
        const componentType = String(row.component_type || "");
        const creditRoles = uniqList(row.credit_roles || []);
        const contributors = uniqList(row.contributor_usernames || []);
        const validComponents = scopeMap.get(taskType) || [];
        const componentOptions = validComponents.length ? validComponents : [componentType].filter(Boolean);

        if (isAdmin && creditsEditMode) {
          return `<tr data-credit-row="1" data-row-index="${rowIndex}">
            <td>
              <select data-field="task_type" data-row-index="${rowIndex}" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--bg);color:var(--ink);">
                ${optionHtml((creditsTaskScopes || []).map((x) => x.task_type), taskType)}
              </select>
            </td>
            <td>
              <select data-field="component_type" data-row-index="${rowIndex}" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--bg);color:var(--ink);">
                ${optionHtml(componentOptions, componentType)}
              </select>
            </td>
            <td>
              ${chipListHtml(creditRoles, "role", rowIndex, true)}
              <div class="credit-chip-controls">
                <select data-field="role_picker" data-row-index="${rowIndex}">${optionHtml(creditsRoles, creditsRoles[0] || "")}</select>
                <button class="btn btn-ghost btn-xs" data-action="add-chip" data-chip-kind="role" data-row-index="${rowIndex}">Add</button>
              </div>
            </td>
            <td>
              ${chipListHtml(contributors, "user", rowIndex, true)}
              <div class="credit-chip-controls">
                <select data-field="user_picker" data-row-index="${rowIndex}">${optionHtml(creditsUsernames, creditsUsernames[0] || "")}</select>
                <button class="btn btn-ghost btn-xs" data-action="add-chip" data-chip-kind="user" data-row-index="${rowIndex}">Add</button>
              </div>
            </td>
            <td><textarea data-field="notes" data-row-index="${rowIndex}" rows="2" style="width:100%;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--bg);color:var(--ink);">${esc(row.notes || "")}</textarea></td>
            <td><button class="btn btn-danger btn-xs" data-action="remove-credit-row">Remove</button></td>
          </tr>`;
        }
        return `<tr>
          <td><span class="mono">${esc(taskType || "—")}</span></td>
          <td><span class="mono">${esc(componentType || "—")}</span></td>
          <td>${chipListHtml(creditRoles, "role", rowIndex, false)}</td>
          <td>${chipListHtml(contributors, "user", rowIndex, false)}</td>
          <td>${esc(row.notes || "")}</td>
          <td>—</td>
        </tr>`;
      }).join("");

      if (!body.innerHTML.trim()) {
        body.innerHTML = '<tr><td colspan="6" style="color:var(--muted);">No credits assignments found.</td></tr>';
      }
    }

    // Listen for postMessage from Builder (study published)
    window.addEventListener("message", e => {
      if (e.origin !== location.origin) return;
      if (e.data?.type === "cogflow:study-published") {
        invalidateLatestConfigCache();
        loadStudies();
      }
      if (e.data?.type === "cogflow:builder-ready") {
        notifyBuilderTheme(currentTheme);
        notifyBuilderA11y(currentA11yMode);
      }
    });

    function startStudiesAutoRefresh() {
      if (studiesRefreshTimer) return;
      studiesRefreshTimer = window.setInterval(() => {
        if (!currentUser) return;
        if (document.hidden) return;
        if (!["studiesManagement", "studiesResults", "preview", "analysis", "integrations"].includes(activeView)) return;
        loadStudies();
      }, 15000);
    }

    function stopStudiesAutoRefresh() {
      if (!studiesRefreshTimer) return;
      clearInterval(studiesRefreshTimer);
      studiesRefreshTimer = null;
    }

    window.addEventListener("focus", () => {
      if (currentUser && ["studiesManagement", "studiesResults", "preview", "analysis", "integrations"].includes(activeView)) {
        loadStudies();
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      if (currentUser && ["studiesManagement", "studiesResults", "preview", "analysis", "integrations"].includes(activeView)) {
        loadStudies();
      }
    });

    // Sidebar collapse toggle
    let sidebarCollapsed = false;
    document.getElementById("sidebarToggle").addEventListener("click", () => {
      sidebarCollapsed = !sidebarCollapsed;
      document.getElementById("sidebar").classList.toggle("collapsed", sidebarCollapsed);
    });

    // Nav click wiring
    document.querySelectorAll(".nav-item[data-view]").forEach(btn => {
      btn.addEventListener("click", () => activateView(btn.getAttribute("data-view")));
    });

    document.getElementById("portalThemeToggle")?.addEventListener("click", () => {
      applyPortalTheme(currentTheme === "dark" ? "light" : "dark", true);
      if (builderLoaded) {
        notifyBuilderTheme(currentTheme);
      }
    });

    document.getElementById("portalA11ySelect")?.addEventListener("change", (e) => {
      applyPortalA11y(e.target?.value || "standard", true);
    });

    document.getElementById("creditsRefreshBtn")?.addEventListener("click", async () => {
      creditsEditMode = false;
      await loadCredits(true);
    });

    document.getElementById("creditsEditBtn")?.addEventListener("click", () => {
      if (currentUser?.role !== "platform_admin") return;
      creditsEditMode = true;
      creditsDraftRows = groupCreditsEntriesForUi(creditsEntries);
      if (!creditsDraftRows.length) {
        creditsDraftRows = [makeCreditsRowDraft()];
      }
      renderCreditsView();
      const msg = document.getElementById("creditsMsg");
      if (msg) {
        msg.className = "status-bar";
        msg.textContent = "Editing mode enabled. Use dropdowns to assign task/component, CRediT role, and contributor.";
      }
    });

    document.getElementById("creditsAddRowBtn")?.addEventListener("click", () => {
      if (currentUser?.role !== "platform_admin" || !creditsEditMode) return;
      creditsDraftRows = Array.isArray(creditsDraftRows) ? creditsDraftRows : [];
      creditsDraftRows.push(makeCreditsRowDraft());
      renderCreditsView();
      const msg = document.getElementById("creditsMsg");
      if (msg) {
        msg.className = "status-bar";
        msg.textContent = `Added row. Total editable rows: ${creditsDraftRows.length}.`;
      }
    });

    document.getElementById("creditsTaskRows")?.addEventListener("click", (e) => {
      const scopeMap = getCreditsTaskScopeMap();
      const btn = e.target?.closest?.("[data-action='remove-credit-row']");
      if (btn && currentUser?.role === "platform_admin" && creditsEditMode) {
        const tr = btn.closest("tr[data-credit-row]");
        if (!tr) return;
        const idx = Number(tr.getAttribute("data-row-index") || -1);
        if (idx < 0) return;
        creditsDraftRows.splice(idx, 1);
        if (!creditsDraftRows.length) creditsDraftRows.push(makeCreditsRowDraft());
        renderCreditsView();
        return;
      }

      const addChipBtn = e.target?.closest?.("[data-action='add-chip']");
      if (addChipBtn && currentUser?.role === "platform_admin" && creditsEditMode) {
        const idx = Number(addChipBtn.getAttribute("data-row-index") || -1);
        const kind = String(addChipBtn.getAttribute("data-chip-kind") || "");
        const row = creditsDraftRows[idx];
        if (!row) return;
        if (kind === "role") {
          const picker = document.querySelector(`select[data-field='role_picker'][data-row-index='${idx}']`);
          const value = String(picker?.value || "").trim();
          if (!value) return;
          row.credit_roles = uniqList([...(row.credit_roles || []), value]);
        } else if (kind === "user") {
          const picker = document.querySelector(`select[data-field='user_picker'][data-row-index='${idx}']`);
          const value = String(picker?.value || "").trim();
          if (!value) return;
          const currentUser = uniqList(row.contributor_usernames || [])[0] || "";
          if (!currentUser) {
            row.contributor_usernames = [value];
          } else if (currentUser !== value) {
            creditsDraftRows.splice(idx + 1, 0, {
              ...row,
              id: null,
              credit_roles: uniqList(row.credit_roles || []),
              contributor_usernames: [value],
            });
          }
        }
        renderCreditsView();
        return;
      }

      const removeChipBtn = e.target?.closest?.("[data-action='remove-chip']");
      if (removeChipBtn && currentUser?.role === "platform_admin" && creditsEditMode) {
        const idx = Number(removeChipBtn.getAttribute("data-row-index") || -1);
        const kind = String(removeChipBtn.getAttribute("data-chip-kind") || "");
        const value = String(removeChipBtn.getAttribute("data-chip-value") || "").trim();
        const row = creditsDraftRows[idx];
        if (!row) return;
        if (kind === "role") {
          row.credit_roles = (row.credit_roles || []).filter((x) => String(x || "").trim() !== value);
        } else if (kind === "user") {
          row.contributor_usernames = (row.contributor_usernames || []).filter((x) => String(x || "").trim() !== value);
        }
        renderCreditsView();
      }
    });

    document.getElementById("creditsTaskRows")?.addEventListener("change", (e) => {
      if (currentUser?.role !== "platform_admin" || !creditsEditMode) return;
      const scopeMap = getCreditsTaskScopeMap();
      const target = e.target;
      const field = String(target?.getAttribute?.("data-field") || "").trim();
      const idx = Number(target?.getAttribute?.("data-row-index") || -1);
      const row = creditsDraftRows[idx];
      if (!row) return;

      if (field === "task_type") {
        row.task_type = String(target.value || "").trim();
        const validComponents = scopeMap.get(row.task_type) || [];
        row.component_type = validComponents.includes(row.component_type) ? row.component_type : (validComponents[0] || "");
        renderCreditsView();
        return;
      }

      if (field === "component_type") {
        row.component_type = String(target.value || "").trim();
        return;
      }

      if (field === "notes") {
        row.notes = String(target.value || "");
      }
    });

    document.getElementById("creditsCancelBtn")?.addEventListener("click", () => {
      creditsEditMode = false;
      creditsDraftRows = [];
      renderCreditsView();
      const msg = document.getElementById("creditsMsg");
      if (msg) {
        msg.className = "status-bar";
        msg.textContent = "Edit canceled.";
      }
    });

    document.getElementById("creditsSaveBtn")?.addEventListener("click", async () => {
      try {
        await saveCreditsFromUi();
        creditsEditMode = false;
        creditsDraftRows = [];
        await loadCredits(true);
        const msg = document.getElementById("creditsMsg");
        if (msg) {
          msg.className = "status-bar ok";
          msg.textContent = "Credits updated successfully.";
        }
      } catch (err) {
        const msg = document.getElementById("creditsMsg");
        if (msg) {
          msg.className = "status-bar error";
          msg.textContent = `Failed to save credits: ${err?.message || err}`;
        }
      }
    });

    // ── Session check ──────────────────────────────────────────
    async function checkSession() {
      try {
        const r = await fetch(`${API}/api/v1/auth/me`, { credentials: "include" });
        if (r.ok) {
          const d = await r.json();
          currentUser = { username: d.username, role: d.role, email: d.email || "",
                          mfa_enabled: !!d.mfa_enabled,
                          mfa_verified: !!(d.mfa_enabled && d.mfa_verified_at),
                          mfa_verified_at: d.mfa_verified_at || null };
          showApp();
        } else {
          currentUser = null; showLogin();
        }
      } catch { currentUser = null; showLogin(); }
    }

    function showLogin(msg) {
      document.getElementById("appShell").classList.add("hidden");
      document.getElementById("loginOverlay").classList.remove("hidden");
      applyPortalA11y("standard", false);
      document.getElementById("loginStep1").style.display = "";
      document.getElementById("loginStepRegister").style.display = "none";
      document.getElementById("loginStepResetRequest").style.display = "none";
      document.getElementById("loginStepResetConfirm").style.display = "none";
      document.getElementById("loginStep2").style.display = "none";
      const el = document.getElementById("loginError");
      if (msg) { el.textContent = msg; el.classList.remove("hidden"); }
      else       el.classList.add("hidden");
    }

    function showRegister(msg) {
      document.getElementById("appShell").classList.add("hidden");
      document.getElementById("loginOverlay").classList.remove("hidden");
      document.getElementById("loginStep1").style.display = "none";
      document.getElementById("loginStepRegister").style.display = "";
      document.getElementById("loginStepResetRequest").style.display = "none";
      document.getElementById("loginStepResetConfirm").style.display = "none";
      document.getElementById("loginStep2").style.display = "none";
      const el = document.getElementById("loginError");
      if (msg) { el.textContent = msg; el.classList.remove("hidden"); }
      else       el.classList.add("hidden");
    }

    function showResetRequest(msg) {
      document.getElementById("appShell").classList.add("hidden");
      document.getElementById("loginOverlay").classList.remove("hidden");
      document.getElementById("loginStep1").style.display = "none";
      document.getElementById("loginStepRegister").style.display = "none";
      document.getElementById("loginStepResetRequest").style.display = "";
      document.getElementById("loginStepResetConfirm").style.display = "none";
      document.getElementById("loginStep2").style.display = "none";
      const el = document.getElementById("loginError");
      if (msg) { el.textContent = msg; el.classList.remove("hidden"); }
      else       el.classList.add("hidden");
    }

    function showResetConfirm(token, msg) {
      document.getElementById("appShell").classList.add("hidden");
      document.getElementById("loginOverlay").classList.remove("hidden");
      document.getElementById("loginStep1").style.display = "none";
      document.getElementById("loginStepRegister").style.display = "none";
      document.getElementById("loginStepResetRequest").style.display = "none";
      document.getElementById("loginStepResetConfirm").style.display = "";
      document.getElementById("loginStep2").style.display = "none";
      document.getElementById("resetToken").value = token || "";
      const el = document.getElementById("loginError");
      if (msg) { el.textContent = msg; el.classList.remove("hidden"); }
      else       el.classList.add("hidden");
    }

    function showApp() {
      document.getElementById("loginOverlay").classList.add("hidden");
      document.getElementById("appShell").classList.remove("hidden");
      const u = currentUser;
      const isAdmin = u.role === "platform_admin";
      document.getElementById("topbarUsername").textContent  = u.username;
      document.getElementById("topbarRole").textContent      = u.role || "";
      document.getElementById("sidebarUsername").textContent = u.username;
      document.getElementById("sidebarRole").textContent     = u.role || "";
      document.getElementById("sidebarAvatar").textContent   = (u.username || "?")[0].toUpperCase();
      document.getElementById("dbAdminBtn").style.display    = isAdmin ? "" : "none";
      document.getElementById("navAdmin").style.display      = isAdmin ? "" : "none";
      applyRoleBasedUiLocks();
      const feedbackContact = document.getElementById("feedbackContact");
      if (feedbackContact) feedbackContact.value = (u.email || "").toString().trim();
      loadPortalA11yPreference();
      creditsEntries = [];
      creditsTaskScopes = [];
      creditsRoles = [];
      creditsUsernames = [];
      creditsDraftRows = [];
      creditsLoaded = false;
      creditsEditMode = false;
      loadCredits(true);
      renderMfaStatusBlock();
      loadStudies();
      startStudiesAutoRefresh();
      if (isAdmin) {
        loadAdminUsers();
      } else {
        adminUsersLoaded = false;
        adminUsers = [];
      }

      if (!canAccessView(activeView)) {
        activateView("studiesManagement");
      }
    }

    // ── Login: step 1 (credentials) ────────────────────────────
    async function doLogin() {
      const username = (document.getElementById("authUsername")?.value || "").trim();
      const password = document.getElementById("authPassword")?.value || "";
      if (!username) return;
      if (!(await ensureCsrfReady())) {
        showLogin("Security cookie was not set. Reload and try again.");
        return;
      }
      const btn = document.getElementById("loginBtn");
      btn.disabled = true; btn.textContent = "Signing in…";
      try {
        const r = await fetch(`${API}/api/v1/auth/login`, postOpts({ username, password }));
        const d = await r.json().catch(() => ({}));
        btn.disabled = false; btn.textContent = "Sign In";
        if (r.ok && d.ok) {
          currentUser = { username: d.username, role: null,
                          mfa_enabled: !!d.mfa_enabled, mfa_verified: false, mfa_verified_at: null };
          if (d.mfa_enabled) {
            document.getElementById("loginStep1").style.display = "none";
            document.getElementById("loginStep2").style.display = "";
            document.getElementById("loginError").classList.add("hidden");
            document.getElementById("loginMfaCode").focus();
          } else {
            await checkSession();
          }
        } else {
          showLogin(d.error || "Invalid credentials");
        }
      } catch {
        btn.disabled = false; btn.textContent = "Sign In";
        showLogin("Network error — is the server running?");
      }
    }

    // ── Login: step 2 (MFA) ────────────────────────────────────
    async function doLoginMfa() {
      const code = (document.getElementById("loginMfaCode")?.value || "").trim();
      if (!code) return;
      if (!(await ensureCsrfReady())) {
        document.getElementById("loginError").textContent = "Security cookie was not set. Reload and try again.";
        document.getElementById("loginError").classList.remove("hidden");
        return;
      }
      const btn = document.getElementById("loginMfaBtn");
      btn.disabled = true; btn.textContent = "Verifying…";
      try {
        const r = await fetch(`${API}/api/v1/auth/mfa/verify`, postOpts({ code }));
        const d = await r.json().catch(() => ({}));
        btn.disabled = false; btn.textContent = "Verify & Sign In";
        if (r.ok && d.ok) { await checkSession(); }
        else {
          document.getElementById("loginError").textContent = d.error || "Invalid code — try again";
          document.getElementById("loginError").classList.remove("hidden");
        }
      } catch {
        btn.disabled = false; btn.textContent = "Verify & Sign In";
        document.getElementById("loginError").textContent = "Network error";
        document.getElementById("loginError").classList.remove("hidden");
      }
    }

    async function doRegister() {
      const username = (document.getElementById("regUsername")?.value || "").trim();
      const email = (document.getElementById("regEmail")?.value || "").trim();
      const requestedRole = (document.getElementById("regRequestedRole")?.value || "researcher").trim().toLowerCase();
      const password = document.getElementById("regPassword")?.value || "";
      const password2 = document.getElementById("regPassword2")?.value || "";
      if (!username || !email || !password) {
        showRegister("Username, email, and password are required.");
        return;
      }
      if (password !== password2) {
        showRegister("Passwords do not match.");
        return;
      }
      if (password.length < 8) {
        showRegister("Password must be at least 8 characters.");
        return;
      }
      if (!(await ensureCsrfReady())) {
        showRegister("Security cookie was not set. Reload and try again.");
        return;
      }

      const btn = document.getElementById("registerBtn");
      btn.disabled = true;
      btn.textContent = "Submitting…";
      try {
        const r = await fetch(`${API}/api/v1/auth/register`, postOpts({ username, email, password, requested_role: requestedRole }));
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);

        document.getElementById("authUsername").value = username;
        ["regUsername", "regEmail", "regPassword", "regPassword2"].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        });
        const roleSel = document.getElementById("regRequestedRole");
        if (roleSel) roleSel.value = "researcher";
        showLogin(d.message || "Registration submitted. Check email for your verification link, then sign in.");
      } catch (err) {
        showRegister(err?.message || "Registration failed");
      } finally {
        btn.disabled = false;
        btn.textContent = "Submit Registration";
      }
    }

    async function doPasswordResetRequest() {
      const identity = (document.getElementById("resetIdentity")?.value || "").trim();
      if (!identity) {
        showResetRequest("Enter your username or email.");
        return;
      }
      if (!(await ensureCsrfReady())) {
        showResetRequest("Security cookie was not set. Reload and try again.");
        return;
      }

      const btn = document.getElementById("requestResetBtn");
      btn.disabled = true;
      btn.textContent = "Sending…";
      try {
        const r = await fetch(`${API}/api/v1/auth/password/reset/request`, postOpts({ identity }));
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        document.getElementById("resetIdentity").value = "";
        showLogin(d.message || "If that account exists and has an email address, a password reset link has been sent.");
      } catch (err) {
        showResetRequest(err?.message || "Password reset request failed.");
      } finally {
        btn.disabled = false;
        btn.textContent = "Send Reset Link";
      }
    }

    async function doPasswordResetConfirm() {
      const token = (document.getElementById("resetToken")?.value || "").trim();
      const password1 = document.getElementById("resetPassword1")?.value || "";
      const password2 = document.getElementById("resetPassword2")?.value || "";
      if (!token) {
        showLogin("Password reset link is missing or invalid.");
        return;
      }
      if (!password1) {
        showResetConfirm(token, "Enter a new password.");
        return;
      }
      if (password1 !== password2) {
        showResetConfirm(token, "Passwords do not match.");
        return;
      }
      if (password1.length < 8) {
        showResetConfirm(token, "Password must be at least 8 characters.");
        return;
      }
      if (!(await ensureCsrfReady())) {
        showResetConfirm(token, "Security cookie was not set. Reload and try again.");
        return;
      }

      const btn = document.getElementById("confirmResetBtn");
      btn.disabled = true;
      btn.textContent = "Updating…";
      try {
        const r = await fetch(`${API}/api/v1/auth/password/reset/confirm`, postOpts({ token, new_password: password1 }));
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        ["resetToken","resetPassword1","resetPassword2"].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        });
        showLogin(d.message || "Password reset. You can now sign in.");
      } catch (err) {
        showResetConfirm(token, err?.message || "Password reset failed.");
      } finally {
        btn.disabled = false;
        btn.textContent = "Set New Password";
      }
    }

    document.getElementById("loginBtn").addEventListener("click", doLogin);
    document.getElementById("authPassword").addEventListener("keydown", e => e.key === "Enter" && doLogin());
    document.getElementById("loginMfaBtn").addEventListener("click", doLoginMfa);
    document.getElementById("loginMfaCode").addEventListener("keydown", e => e.key === "Enter" && doLoginMfa());
    document.getElementById("registerBtn").addEventListener("click", doRegister);
    document.getElementById("regPassword2").addEventListener("keydown", e => e.key === "Enter" && doRegister());
    document.getElementById("showRegisterBtn").addEventListener("click", () => showRegister());
    document.getElementById("showSignInBtn").addEventListener("click", () => showLogin());
    document.getElementById("showResetRequestBtn").addEventListener("click", () => showResetRequest());
    document.getElementById("showSignInFromResetBtn").addEventListener("click", () => showLogin());
    document.getElementById("showSignInFromResetConfirmBtn").addEventListener("click", () => showLogin());
    document.getElementById("requestResetBtn").addEventListener("click", doPasswordResetRequest);
    document.getElementById("resetIdentity").addEventListener("keydown", e => e.key === "Enter" && doPasswordResetRequest());
    document.getElementById("confirmResetBtn").addEventListener("click", doPasswordResetConfirm);
    document.getElementById("resetPassword2").addEventListener("keydown", e => e.key === "Enter" && doPasswordResetConfirm());

    // ── Sign out ───────────────────────────────────────────────
    document.getElementById("signOutBtn").addEventListener("click", async () => {
      await fetch(`${API}/api/v1/auth/logout`, postOpts({}));
      currentUser = null; mfaSetupState = null;
      creditsEntries = [];
      creditsTaskScopes = [];
      creditsRoles = [];
      creditsUsernames = [];
      creditsDraftRows = [];
      creditsLoaded = false;
      creditsEditMode = false;
      stopStudiesAutoRefresh();
      invalidateLatestConfigCache();
      builderLoaded = false;
      document.getElementById("builderFrame").src = "about:blank";
      document.getElementById("previewFrame").src  = "about:blank";
      showLogin();
    });

