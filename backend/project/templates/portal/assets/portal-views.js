    // ── Refresh ────────────────────────────────────────────────
    document.getElementById("refreshBtn").addEventListener("click", loadStudies);
    document.getElementById("refreshResultsBtn")?.addEventListener("click", loadStudies);
    document.getElementById("analysisRefreshBtn")?.addEventListener("click", async () => {
      await loadStudies();
      const studySlug = String(document.getElementById("analysisStudySelect")?.value || "").trim();
      if (studySlug) await loadAnalysisJobs(studySlug);
    });
    document.getElementById("analysisRunBtn")?.addEventListener("click", runAnalysisReport);
    document.getElementById("adminRefreshBtn")?.addEventListener("click", () => loadAdminUsers(true));

    // ── Studies ────────────────────────────────────────────────
    function refreshStudiesUiFromCache() {
      renderStudyManagementRows(studiesList);
      renderStudyResultsRows(studiesList);
      populatePreviewSelect(studiesList);
      populateAnalysisStudySelect(studiesList);
      populateIntegrationsStudySelect(studiesList);
    }

    async function loadStudies() {
      if (studiesLoadInFlight) {
        studiesLoadQueued = true;
        return;
      }

      const statusEl  = document.getElementById("studiesStatus");
      const resultsStatusEl = document.getElementById("studiesResultsStatus");
      const refreshBtn = document.getElementById("refreshBtn");
      const refreshResultsBtn = document.getElementById("refreshResultsBtn");
      studiesLoadInFlight = true;
      refreshBtn.disabled = true;
      if (refreshResultsBtn) refreshResultsBtn.disabled = true;
      statusEl.className = "status-bar";
      statusEl.textContent = "Refreshing…";
      if (resultsStatusEl) {
        resultsStatusEl.className = "status-bar";
        resultsStatusEl.textContent = "Refreshing…";
      }
      try {
        const r = await fetch(`${API}/api/v1/studies`, { credentials: "include" });
        if (r.status === 401) {
          currentUser = null;
          showLogin("Your session expired. Please sign in again.");
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        studiesList = d.studies || [];
        invalidateLatestConfigCache();
        refreshStudiesUiFromCache();
        statusEl.className = "status-bar ok";
        statusEl.textContent = `${studiesList.length} ${studiesList.length === 1 ? "study" : "studies"} — refreshed ${new Date().toLocaleTimeString()}.`;
        if (resultsStatusEl) {
          resultsStatusEl.className = "status-bar ok";
          resultsStatusEl.textContent = `${studiesList.length} ${studiesList.length === 1 ? "study" : "studies"} — refreshed ${new Date().toLocaleTimeString()}.`;
        }
      } catch (err) {
        statusEl.className = "status-bar error";
        statusEl.textContent = `Failed to load studies: ${err?.message || err}`;
        if (resultsStatusEl) {
          resultsStatusEl.className = "status-bar error";
          resultsStatusEl.textContent = `Failed to load studies: ${err?.message || err}`;
        }
      } finally {
        studiesLoadInFlight = false;
        refreshBtn.disabled = false;
        if (refreshResultsBtn) refreshResultsBtn.disabled = false;
        if (studiesLoadQueued) {
          studiesLoadQueued = false;
          loadStudies();
        }
      }
    }

    function populatePreviewSelect(studies) {
      const sel  = document.getElementById("previewStudySelect");
      const prev = sel.value;
      sel.innerHTML = '<option value="">— Select study —</option>';
      for (const s of studies) {
        const o = document.createElement("option");
        o.value = s.study_slug; o.textContent = s.study_name || s.study_slug;
        sel.appendChild(o);
      }
      if (prev) sel.value = prev;
      populatePreviewTaskSelect(sel.value || "");
    }

    async function fetchStudyLatestConfig(slug) {
      const key = String(slug || "").trim();
      if (!key) return null;
      if (latestConfigCache[key]) return latestConfigCache[key];
      const r = await fetch(`${API}/api/v1/studies/${encodeURIComponent(key)}/latest-config?_ts=${Date.now()}`, { credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) {
        await checkSession();
        showLogin("Your session expired. Please sign in again.");
        throw new Error("Authentication required");
      }
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      latestConfigCache[key] = d;
      return d;
    }

    function invalidateLatestConfigCache() {
      Object.keys(latestConfigCache).forEach((k) => delete latestConfigCache[k]);
    }

    async function populatePreviewTaskSelect(slug, preferredTaskType = "") {
      const taskSel = document.getElementById("previewTaskSelect");
      if (!taskSel) return;

      const pref = String(preferredTaskType || "").trim().toLowerCase();
      taskSel.innerHTML = '<option value="">All subtasks</option>';

      const key = String(slug || "").trim();
      if (!key) return;

      try {
        const payload = await fetchStudyLatestConfig(key);
        const cfgs = Array.isArray(payload?.configs) ? payload.configs : [];
        const st = getStudyState(key);
        const profile = normalizeTaskProfileForConfigs(st.taskProfile || loadStudyTaskProfile(key), cfgs);
        st.taskProfile = profile;

        const cfgById = new Map(cfgs.map((c) => [String(c?.config_version_id || "").trim(), c]));
        const subtasks = [];
        profile.items.forEach((item) => {
          if (item.enabled === false) return;
          const cfg = cfgById.get(item.config_version_id);
          const t = (cfg?.task_type || item.task_type || '').toString().trim().toLowerCase();
          if (t && !subtasks.includes(t)) subtasks.push(t);
        });

        for (const t of subtasks) {
          const o = document.createElement("option");
          o.value = t;
          o.textContent = t;
          taskSel.appendChild(o);
        }
        if (pref && subtasks.includes(pref)) {
          taskSel.value = pref;
        }
      } catch {
        // Keep fallback option only when latest-config can't be loaded.
      }
    }

    function populateIntegrationsStudySelect(studies) {
      const sel = document.getElementById("integrationStudySelect");
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
    }

    // ── Study tables ───────────────────────────────────────────
    function bindStudyTableActions(tbody) {
      tbody.querySelectorAll("[data-action='gen-link']").forEach(b =>
        b.addEventListener("click", () => openGenerateLinksModal(b.getAttribute("data-slug")))
      );
      tbody.querySelectorAll("[data-action='toggle-details']").forEach(b =>
        b.addEventListener("click", () => toggleDetails(b.getAttribute("data-slug")))
      );
      tbody.querySelectorAll("[data-action='study-properties']").forEach(b =>
        b.addEventListener("click", () => openStudyPropertiesModal(b.getAttribute("data-slug")))
      );
      tbody.querySelectorAll("[data-action='share-study']").forEach(b =>
        b.addEventListener("click", () => openShareStudyModal(b.getAttribute("data-slug")))
      );
      tbody.querySelectorAll("[data-action='remove-study-user']").forEach(b =>
        b.addEventListener("click", () => {
          const username = window.prompt("Remove access for username:", "") || "";
          if (!username.trim()) return;
          const slug = b.getAttribute("data-slug");
          const confirmed = window.confirm(
            `Remove ${username.trim()} from study ${slug}?\n\nThey will lose collaborator access immediately.`
          );
          if (!confirmed) return;
          removeStudyUser(slug, username.trim());
        })
      );
      tbody.querySelectorAll("[data-action='duplicate-study']").forEach(b =>
        b.addEventListener("click", async () => {
          const sourceSlug = (b.getAttribute("data-slug") || "").toString().trim();
          const sourceName = (b.getAttribute("data-study-name") || sourceSlug).toString().trim();
          const now = new Date();
          const pad = (n) => String(n).padStart(2, "0");
          const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
          const suggestedName = `${sourceName} - copy ${stamp}`;
          const duplicateName = window.prompt("Name for duplicated study:", suggestedName) || "";
          if (!duplicateName.trim()) return;
          await duplicateStudy(sourceSlug, duplicateName.trim());
        })
      );
      tbody.querySelectorAll("[data-action='open-preview']").forEach(b =>
        b.addEventListener("click", () => {
          const slug = b.getAttribute("data-slug");
          const taskType = (b.getAttribute("data-task-type") || '').toString().trim().toLowerCase();
          document.getElementById("previewStudySelect").value = slug;
          populatePreviewTaskSelect(slug, taskType);
          activateView("preview");
        })
      );
      tbody.querySelectorAll("[data-action='delete-study']").forEach(b =>
        b.addEventListener("click", async () => {
          const slug = (b.getAttribute("data-slug") || "").toString().trim();
          if (!slug) return;
          const confirmed = confirm(
            `Delete study \"${slug}\" from My Studies?\n\nThis will deactivate it and remove it from active lists.\nAll configs, runs, results, and audit history will be retained.`
          );
          if (!confirmed) return;
          await deleteStudy(slug);
        })
      );
      tbody.querySelectorAll("[data-action='reassign']").forEach(b =>
        b.addEventListener("click", () => {
          const owner = window.prompt("New owner username (admin only):", "");
          if (owner?.trim()) reassignOwner(b.getAttribute("data-slug"), owner.trim());
        })
      );
      tbody.querySelectorAll("[data-action='collapse']").forEach(b =>
        b.addEventListener("click", () => {
          getStudyState(b.getAttribute("data-slug")).expanded = false;
          refreshStudiesUiFromCache();
        })
      );
      tbody.querySelectorAll("[data-action='export-json']").forEach(b =>
        b.addEventListener("click", () => exportRun(b.getAttribute("data-slug"), b.getAttribute("data-run"), "json"))
      );
      tbody.querySelectorAll("[data-action='export-csv']").forEach(b =>
        b.addEventListener("click", () => exportRun(b.getAttribute("data-slug"), b.getAttribute("data-run"), "csv"))
      );
      tbody.querySelectorAll("[data-action='export-all-json']").forEach(b =>
        b.addEventListener("click", () => exportAll(b.getAttribute("data-slug"), "json"))
      );
      tbody.querySelectorAll("[data-action='export-all-csv']").forEach(b =>
        b.addEventListener("click", () => exportAll(b.getAttribute("data-slug"), "csv"))
      );
      tbody.querySelectorAll("[data-action='copy-run-id']").forEach(b =>
        b.addEventListener("click", () => copyText(b.getAttribute("data-run"), b))
      );
      tbody.querySelectorAll("[data-copy]").forEach(b =>
        b.addEventListener("click", () => copyText(b.getAttribute("data-copy"), b))
      );
    }

    function renderStudyManagementRows(studies) {
      const tbody = document.getElementById("studyManagementRows");
      if (!tbody) return;
      tbody.innerHTML = "";

      if (!studies.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="color:var(--muted);text-align:center;padding:32px;">No studies yet. Use the Builder to create and publish a study.</td></tr>';
        return;
      }

      for (const s of studies) {
        const ownersText = Array.isArray(s.owner_usernames) && s.owner_usernames.length
          ? s.owner_usernames.join(", ")
          : (s.owner_username || "—");
        const reassignBtn = currentUser?.role === "platform_admin"
          ? `<button class="btn btn-ghost btn-xs" data-action="reassign" data-slug="${esc(s.study_slug)}">Reassign</button>`
          : "";
        const canManageStudy = !!(s?.permissions?.can_manage_sharing || s?.permissions?.can_remove_users);
        const lockAttrs = canManageStudy
          ? 'class="btn btn-ghost btn-xs"'
          : 'disabled class="btn btn-ghost btn-xs btn-locked" title="Unavailable for your study permissions."';
        const lockDeleteAttrs = canManageStudy
          ? 'class="btn btn-danger btn-xs"'
          : 'disabled class="btn btn-danger btn-xs btn-locked" title="Unavailable for your study permissions."';
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>
            <div><strong>${esc(s.study_name || s.study_slug || "—")}</strong></div>
            <div class="mono" style="color:var(--muted);font-size:.78em;">${esc(s.study_slug || "")}</div>
          </td>
          <td>${esc(ownersText)}</td>
          <td><span class="pill">${esc(s.runtime_mode || "—")}</span></td>
          <td class="mono">${esc(s.latest_config_version || "—")}</td>
          <td>${typeof s.run_count === "number" ? s.run_count : "—"}</td>
          <td style="font-size:.82rem;color:var(--muted);">${fmt(s.last_result_at)}</td>
          <td>
            <div style="display:flex;gap:5px;flex-wrap:wrap;">
              <button ${lockAttrs} data-action="gen-link"       data-slug="${esc(s.study_slug)}">Generate Links</button>
              <button ${lockAttrs} data-action="study-properties" data-slug="${esc(s.study_slug)}">Properties</button>
              <button ${lockAttrs} data-action="share-study"    data-slug="${esc(s.study_slug)}">Share</button>
              <button ${lockAttrs} data-action="duplicate-study" data-slug="${esc(s.study_slug)}" data-study-name="${esc(s.study_name || s.study_slug)}">Duplicate</button>
              <button ${lockAttrs} data-action="remove-study-user" data-slug="${esc(s.study_slug)}">Remove User</button>
              <button ${lockAttrs} data-action="open-preview"   data-slug="${esc(s.study_slug)}">Preview ▶</button>
              <button ${lockDeleteAttrs} data-action="delete-study"  data-slug="${esc(s.study_slug)}">Delete</button>
              ${reassignBtn}
            </div>
          </td>`;
        tbody.appendChild(tr);
      }

      bindStudyTableActions(tbody);
    }

    function renderStudyResultsRows(studies) {
      const tbody = document.getElementById("studyResultsRows");
      if (!tbody) return;
      tbody.innerHTML = "";
      const isAnalyst = String(currentUser?.role || "").trim().toLowerCase() === "analyst";
      const analystPreviewAttrs = isAnalyst ? 'disabled class="btn btn-ghost btn-xs btn-locked" title="Unavailable for analyst role."' : 'class="btn btn-ghost btn-xs"';

      if (!studies.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:32px;">No studies yet. Publish from Builder to start collecting results.</td></tr>';
        return;
      }

      for (const s of studies) {
        const state = getStudyState(s.study_slug);
        const ownersText = Array.isArray(s.owner_usernames) && s.owner_usernames.length
          ? s.owner_usernames.join(", ")
          : (s.owner_username || "—");

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>
            <div><strong>${esc(s.study_name || s.study_slug || "—")}</strong></div>
            <div class="mono" style="color:var(--muted);font-size:.78em;">${esc(s.study_slug || "")}</div>
          </td>
          <td>${esc(ownersText)}</td>
          <td>${typeof s.run_count === "number" ? s.run_count : "—"}</td>
          <td style="font-size:.82rem;color:var(--muted);">${fmt(s.last_result_at)}</td>
          <td>
            <div style="display:flex;gap:5px;flex-wrap:wrap;">
              <button class="btn btn-ghost btn-xs" data-action="toggle-details" data-slug="${esc(s.study_slug)}">${state.expanded ? "Hide" : "Open Results"}</button>
              <button ${analystPreviewAttrs} data-action="open-preview"   data-slug="${esc(s.study_slug)}">Preview ▶</button>
            </div>
          </td>`;
        tbody.appendChild(tr);

        if (state.expanded) {
          const w = document.createElement("tbody");
          w.innerHTML = buildDetailRow(s, { resultsOnly: true });
          tbody.appendChild(w.firstElementChild);
        }
      }

      bindStudyTableActions(tbody);
    }

    // ── Detail row ─────────────────────────────────────────────
    function rfRow(label, val) {
      const sv = esc(String(val || "—"));
      return `<div class="rollout-field">
        <span class="rollout-field-label">${esc(label)}</span>
        <div class="rollout-field-row">
          <input type="text" readonly value="${sv}" />
          <button class="btn btn-ghost btn-xs" data-copy="${sv}">Copy</button>
        </div>
      </div>`;
    }

    function metaB(label, val) {
      return `<div class="result-meta-block">
        <div class="result-meta-label">${esc(label)}</div>
        <div class="result-meta-value">${esc(val || "—")}</div>
      </div>`;
    }

    function buildDetailRow(study, opts = {}) {
      const resultsOnly = !!opts.resultsOnly;
      const state = getStudyState(study.study_slug);
      const slug  = esc(study.study_slug);

      let rolloutCard;
      if (state.rollout) {
        const opts   = state.rollout.launch_options || {};
        const multi  = opts.multi_use  || {};
        const single = opts.single_use || {};
        const completionRedirect = state.rollout.completion_redirect_url || multi.completion_redirect_url || "";
        const abortRedirect = state.rollout.abort_redirect_url || multi.abort_redirect_url || "";
        rolloutCard = `<article class="detail-card"><h3>Launch rollout</h3>
          <div class="detail-grid">
            <div>
              ${rfRow("Multi-use URL",   absUrl(multi.launch_url  || state.rollout.launch_url || ""))}
              ${rfRow("Multi-use token", multi.launch_token  || state.rollout.launch_token || "")}
              <p class="rollout-meta">Reusable while valid. Expires ${esc(fmt(state.rollout.expires_at))}.</p>
            </div>
            <div>
              ${rfRow("Single-use URL",   absUrl(single.launch_url   || ""))}
              ${rfRow("Single-use token", single.launch_token || "")}
              <p class="rollout-meta">Single-use launch. Owner: ${esc(state.rollout.owner_username || "—")}.</p>
            </div>
          </div>
          ${completionRedirect ? rfRow("Completion redirect URL", completionRedirect) : ""}
          ${abortRedirect ? rfRow("Abort redirect URL", abortRedirect) : ""}
        </article>`;
      } else {
        rolloutCard = `<article class="detail-card"><h3>Launch rollout</h3>
          <p class="result-message">Click "Generate Links" to create rollout URLs and tokens.</p>
        </article>`;
      }

      let resultsCard;
      if (state.runsLoading) {
        resultsCard = `<article class="detail-card"><h3>Results</h3><div class="result-message"><span class="spinner"></span> Loading…</div></article>`;
      } else if (state.runsError) {
        resultsCard = `<article class="detail-card"><h3>Results</h3><div class="result-message error">${esc(state.runsError)}</div></article>`;
      } else if (state.runsLoaded && !state.runs.length) {
        resultsCard = `<article class="detail-card"><h3>Results</h3><div class="result-message">No runs recorded yet.</div></article>`;
      } else if (state.runsLoaded) {
        const completedCount = (state.runs || []).filter((run) => {
          const s = (run?.status || "").toString().trim().toLowerCase();
          return s === "completed";
        }).length;
        const groups = new Map();
        for (const run of state.runs) {
          const k = (run.task_type || 'untyped').toString().trim().toLowerCase() || 'untyped';
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push(run);
        }

        const groupedHtml = Array.from(groups.entries()).map(([taskType, taskRuns]) => {
          const taskLabel = taskType === 'untyped' ? 'untyped' : taskType;
          return `
            <div class="result-task-group">
              <div style="font-size:.82rem;color:var(--muted);margin:8px 0 6px;"><strong style="color:var(--ink);">Subtask:</strong> ${esc(taskLabel)} <span style="opacity:.8;">(${taskRuns.length})</span></div>
              ${taskRuns.map(run => {
                const ds = state.decryptions[run.run_session_id] || {};
                return `<section class="result-item">
                  <div class="result-meta">
                    ${metaB("Run ID",      run.run_session_id)}
                    ${metaB("Status",      run.status)}
                    ${metaB("Started",     fmt(run.started_at))}
                    ${metaB("Completed",   fmt(run.completed_at))}
                    ${metaB("Trials",      String(run.trial_count || 0))}
                    ${metaB("Participant", run.participant_key_preview || "—")}
                  </div>
                  <div class="result-actions">
                    <button class="btn btn-ghost btn-xs" data-action="export-json"  data-slug="${slug}" data-run="${esc(run.run_session_id)}" ${run.has_result ? "" : "disabled"}>Export JSON</button>
                    <button class="btn btn-ghost btn-xs" data-action="export-csv"   data-slug="${slug}" data-run="${esc(run.run_session_id)}" ${run.has_result ? "" : "disabled"}>Export CSV</button>
                    <button class="btn btn-ghost btn-xs" data-action="copy-run-id" data-run="${esc(run.run_session_id)}">Copy ID</button>
                  </div>
                  ${ds.error   ? `<div class="result-message error">${esc(ds.error)}</div>` : ""}
                  ${!run.has_result ? `<div class="result-message">No result envelope for this run yet.</div>` : ""}
                </section>`;
              }).join("")}
            </div>
          `;
        }).join("");

        const busy = state.exportBusy;
        resultsCard = `<article class="detail-card">
          <div class="detail-header" style="margin-bottom:10px;">
            <h3 style="margin:0;">Results <span style="font-size:.78rem;color:var(--muted);font-weight:400;">(${state.runs.length} total, ${completedCount} completed)</span></h3>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button class="btn btn-ghost btn-xs" data-action="export-all-json" data-slug="${slug}" ${busy ? "disabled" : ""}>Export All JSON ZIP</button>
              <button class="btn btn-ghost btn-xs" data-action="export-all-csv"  data-slug="${slug}" ${busy ? "disabled" : ""}>Export All CSV ZIP</button>
            </div>
          </div>
          <div class="result-list">
            ${groupedHtml}
          </div>
        </article>`;
      } else {
        resultsCard = `<article class="detail-card"><h3>Results</h3><div class="result-message">Use "Open Results" to load recent runs.</div></article>`;
      }

      const detailContent = resultsOnly
        ? `<div class="detail-grid">${resultsCard}</div>`
        : `<div class="detail-grid">${rolloutCard}${resultsCard}</div>`;

      const colSpan = resultsOnly ? 5 : 7;

      return `<tr class="detail-row"><td colspan="${colSpan}">
        <div class="detail-panel">
          <div class="detail-header">
            <div>
              <h3 class="detail-title">${esc(study.study_name || study.study_slug || "Study")}</h3>
              <p class="detail-subtitle">${esc(study.study_slug || "")} · ${esc((Array.isArray(study.owner_usernames) && study.owner_usernames.length) ? study.owner_usernames.join(", ") : (study.owner_username || ""))} · ${esc(study.runtime_mode || "")}</p>
            </div>
            <button class="btn btn-ghost btn-xs" data-action="collapse" data-slug="${slug}">Close ✕</button>
          </div>
          ${detailContent}
        </div>
      </td></tr>`;
    }

    // ── Study actions ──────────────────────────────────────────
    async function toggleDetails(slug) {
      const st = getStudyState(slug);
      st.expanded = !st.expanded;
      if (st.expanded && !st.runsLoaded && !st.runsLoading) { await loadRuns(slug); return; }
      refreshStudiesUiFromCache();
    }

    async function loadRuns(slug) {
      const st = getStudyState(slug);
      st.expanded = true; st.runsLoading = true; st.runsError = null;
      refreshStudiesUiFromCache();
      try {
        const r = await fetch(`${API}/api/v1/studies/${encodeURIComponent(slug)}/runs`, { credentials: "include" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        st.runs = Array.isArray(d.runs) ? d.runs : [];
        st.runsLoaded = true; st.runsError = null;
      } catch (err) {
        st.runs = []; st.runsLoaded = false; st.runsError = err?.message || String(err);
      } finally {
        st.runsLoading = false; refreshStudiesUiFromCache();
      }
    }

    async function generateLink(slug, pid, completionRedirect, abortRedirect, options) {
      const st = getStudyState(slug);
      st.expanded = true;
      const sb = document.getElementById("studiesStatus");
      sb.className = "status-bar"; sb.textContent = `Generating links for ${slug}…`;
      try {
        const opts = (options && typeof options === "object") ? options : {};
        const r = await fetch(`${API}/api/v1/studies/${encodeURIComponent(slug)}/participant-links`,
          postOpts({
            participant_external_id: pid || null,
            counterbalance_enabled: Object.prototype.hasOwnProperty.call(opts, "counterbalance_enabled") ? !!opts.counterbalance_enabled : true,
            task_order: Array.isArray(opts.task_order) ? opts.task_order : [],
            task_order_strict: !!opts.task_order_strict,
            expires_in_hours: 72,
            completion_redirect_url: completionRedirect || null,
            abort_redirect_url: abortRedirect || null,
          }));
        const d = await r.json().catch(() => ({}));
        await handleParticipantLinkAuthErrors(r, d);
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        st.rollout = d;
        sb.className = "status-bar ok"; sb.textContent = `Links generated for ${slug}.`;
        if (!st.runsLoaded && !st.runsLoading) { await loadRuns(slug); return; }
        loadStudies();
      } catch (err) {
        sb.className = "status-bar error"; sb.textContent = `Link generation failed: ${err?.message || err}`;
        loadStudies();
      }
    }

    async function handleParticipantLinkAuthErrors(response, payload) {
      if (response.status === 401) {
        await checkSession();
        showLogin("Your session expired. Please sign in again.");
        throw new Error("Authentication required");
      }
      if (response.status === 403) {
        const role = (payload && payload.current_role) ? ` (${payload.current_role})` : "";
        throw new Error(payload?.error || `Insufficient permissions${role}`);
      }
    }

    function renderIntegrationsRollout(rollout) {
      const out = document.getElementById("integrationsOutput");
      if (!out) return;

      if (!rollout) {
        out.innerHTML = '<p class="result-message" style="margin:0;">No SONA links generated yet.</p>';
        return;
      }

      const opts = rollout.launch_options || {};
      const multi = opts.multi_use || {};
      const single = opts.single_use || {};
      const completionRedirect = rollout.completion_redirect_url || multi.completion_redirect_url || "";
      const abortRedirect = rollout.abort_redirect_url || multi.abort_redirect_url || "";

      out.innerHTML = `
        <div class="detail-grid">
          <article class="detail-card">
            <h3 style="margin:0 0 12px;">Multi-use launch</h3>
            ${rfRow("Launch URL", absUrl(multi.launch_url || rollout.launch_url || ""))}
            ${rfRow("Launch token", multi.launch_token || rollout.launch_token || "")}
          </article>
          <article class="detail-card">
            <h3 style="margin:0 0 12px;">Single-use launch</h3>
            ${rfRow("Launch URL", absUrl(single.launch_url || ""))}
            ${rfRow("Launch token", single.launch_token || "")}
          </article>
        </div>
        <article class="detail-card" style="margin-top:12px;">
          <h3 style="margin:0 0 12px;">Redirects</h3>
          ${completionRedirect ? rfRow("Completion redirect", completionRedirect) : '<p class="result-message" style="margin:0 0 8px;">No completion redirect set.</p>'}
          ${abortRedirect ? rfRow("Abort redirect", abortRedirect) : '<p class="result-message" style="margin:0;">No abort redirect set.</p>'}
          <p class="rollout-meta" style="margin-top:10px;">Expires ${esc(fmt(rollout.expires_at))}.</p>
        </article>`;

      out.querySelectorAll("[data-copy]").forEach(b =>
        b.addEventListener("click", () => copyText(b.getAttribute("data-copy"), b))
      );
    }

    function buildProlificExternalStudyUrl(baseLaunchUrl) {
      const base = absUrl(baseLaunchUrl || "");
      if (!base || base === "-") return "";

      const placeholders = {
        PROLIFIC_PID: "{% templatetag openvariable %}%PROLIFIC_PID%{% templatetag closevariable %}",
        STUDY_ID: "{% templatetag openvariable %}%STUDY_ID%{% templatetag closevariable %}",
        SESSION_ID: "{% templatetag openvariable %}%SESSION_ID%{% templatetag closevariable %}",
      };

      try {
        const u = new URL(base, location.origin);
        Object.entries(placeholders).forEach(([k, v]) => u.searchParams.set(k, v));
        return u.toString();
      } catch {
        const qp = Object.entries(placeholders)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join("&");
        return `${base}${base.includes("?") ? "&" : "?"}${qp}`;
      }
    }

    function renderProlificOutput(payload) {
      const out = document.getElementById("prolificOutput");
      if (!out) return;

      if (!payload) {
        out.innerHTML = '<p class="result-message" style="margin:0;">No Prolific link generated yet.</p>';
        return;
      }

      out.innerHTML = `
        <article class="detail-card" style="margin-top:12px;">
          <h3 style="margin:0 0 12px;">Prolific</h3>
          ${rfRow("Completion behavior", payload.completionMethodLabel || "Auto-redirect to Prolific")}
          ${rfRow("External Study URL", payload.externalStudyUrl || "")}
          ${rfRow("Base launch URL", payload.baseLaunchUrl || "")}
          ${payload.completionCode ? rfRow("Completion code", payload.completionCode) : '<p class="result-message" style="margin:0 0 8px;">No completion code set.</p>'}
          ${payload.completionRedirect ? rfRow("Completion redirect", payload.completionRedirect) : '<p class="result-message" style="margin:0 0 8px;">No completion redirect set (completion-code screen mode).</p>'}
          <p class="rollout-meta" style="margin-top:10px;">Paste the External Study URL into Prolific. Placeholders will be resolved by Prolific at runtime.</p>
        </article>`;

      out.querySelectorAll("[data-copy]").forEach(b =>
        b.addEventListener("click", () => copyText(b.getAttribute("data-copy"), b))
      );
    }

    async function generateSonaLinksFromIntegrations() {
      const statusEl = document.getElementById("integrationsStatus");
      const btn = document.getElementById("generateSonaLinksBtn");
      const slug = (document.getElementById("integrationStudySelect")?.value || "").trim();
      const pid = (document.getElementById("integrationParticipantId")?.value || "").trim();
      const completionUrl = (document.getElementById("integrationCompletionUrl")?.value || "").trim();
      const abortUrl = (document.getElementById("integrationAbortUrl")?.value || "").trim();

      if (!slug) {
        statusEl.className = "status-bar error";
        statusEl.textContent = "Choose a study first.";
        return;
      }
      if (!completionUrl) {
        statusEl.className = "status-bar error";
        statusEl.textContent = "Completion URL is required for SONA link generation.";
        return;
      }

      btn.disabled = true;
      statusEl.className = "status-bar";
      statusEl.textContent = `Generating SONA links for ${slug}…`;

      try {
        const r = await fetch(`${API}/api/v1/studies/${encodeURIComponent(slug)}/participant-links`, postOpts({
          participant_external_id: pid || null,
          expires_in_hours: 72,
          completion_redirect_url: completionUrl,
          abort_redirect_url: abortUrl || null,
        }));
        const d = await r.json().catch(() => ({}));
        await handleParticipantLinkAuthErrors(r, d);
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);

        integrationsRollout = d;
        renderIntegrationsRollout(integrationsRollout);

        const st = getStudyState(slug);
        st.rollout = d;

        statusEl.className = "status-bar ok";
        statusEl.textContent = `SONA links generated for ${slug}.`;
      } catch (err) {
        statusEl.className = "status-bar error";
        statusEl.textContent = `SONA link generation failed: ${err?.message || err}`;
      } finally {
        btn.disabled = false;
      }
    }

    async function generateProlificLinkFromIntegrations() {
      const statusEl = document.getElementById("integrationsStatus");
      const btn = document.getElementById("generateProlificLinkBtn");
      const slug = (document.getElementById("integrationStudySelect")?.value || "").trim();
      const completionCode = (document.getElementById("prolificCompletionCode")?.value || "").trim();
      const completionMethod = (document.getElementById("prolificCompletionMethod")?.value || "redirect").trim().toLowerCase();

      if (!slug) {
        statusEl.className = "status-bar error";
        statusEl.textContent = "Choose a study first.";
        return;
      }

      if (!completionCode) {
        statusEl.className = "status-bar error";
        statusEl.textContent = "Completion code is required for Prolific links.";
        return;
      }

      const completionRedirect = completionMethod === "redirect"
        ? `https://app.prolific.com/submissions/complete?cc=${encodeURIComponent(completionCode)}`
        : null;

      btn.disabled = true;
      statusEl.className = "status-bar";
      statusEl.textContent = `Generating Prolific link for ${slug}…`;

      try {
        const r = await fetch(`${API}/api/v1/studies/${encodeURIComponent(slug)}/participant-links`, postOpts({
          participant_external_id: "{% templatetag openvariable %}%PROLIFIC_PID%{% templatetag closevariable %}",
          expires_in_hours: 72,
          completion_redirect_url: completionRedirect,
          abort_redirect_url: null,
          prolific_completion_mode: completionMethod,
          prolific_completion_code: completionCode,
        }));
        const d = await r.json().catch(() => ({}));
        await handleParticipantLinkAuthErrors(r, d);
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);

        const multi = d.launch_options?.multi_use || {};
        const baseLaunchUrl = absUrl(multi.launch_url || d.launch_url || "");
        const externalStudyUrl = buildProlificExternalStudyUrl(baseLaunchUrl);

        renderProlificOutput({
          externalStudyUrl,
          baseLaunchUrl,
          completionRedirect: completionRedirect || "",
          completionCode,
          completionMethodLabel: completionMethod === "show_code"
            ? "Show completion code screen inside CogFlow"
            : "Auto-redirect to Prolific",
        });

        statusEl.className = "status-bar ok";
        statusEl.textContent = `Prolific link generated for ${slug}.`;
      } catch (err) {
        statusEl.className = "status-bar error";
        statusEl.textContent = `Prolific link generation failed: ${err?.message || err}`;
      } finally {
        btn.disabled = false;
      }
    }

    async function reassignOwner(slug, owner) {
      const sb = document.getElementById("studiesStatus");
      sb.className = "status-bar"; sb.textContent = `Reassigning ${slug} → ${owner}…`;
      try {
        const r = await fetch(`${API}/api/v1/studies/${encodeURIComponent(slug)}/owner`, postOpts({ owner_username: owner }));
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        sb.className = "status-bar ok"; sb.textContent = `Owner reassigned: ${slug} → ${d.owner_username || owner}`;
        loadStudies();
      } catch (err) {
        sb.className = "status-bar error"; sb.textContent = `Reassign failed: ${err?.message || err}`;
      }
    }

    function ensureShareStudyModal() {
      let modalEl = document.getElementById("shareStudyModal");
      if (modalEl) return modalEl;

      const host = document.createElement("div");
      host.innerHTML = `
        <div class="modal fade" id="shareStudyModal" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog modal-lg modal-dialog-scrollable">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">Share Study Access</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
              </div>
              <div class="modal-body">
                <div id="shareStudyError" class="alert alert-danger py-2 d-none" role="alert"></div>
                <div class="account-field" style="margin-bottom:10px;">
                  <label for="shareStudyUsername">Username</label>
                  <input type="text" id="shareStudyUsername" placeholder="Exact username" autocomplete="off" />
                  <div id="shareStudyValidation" class="inline-note" style="margin-top:8px;display:none;"></div>
                </div>
                <h6 style="margin:12px 0 8px;">Permissions</h6>
                <div style="display:grid;gap:8px;">
                  <label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" id="shareCanRunAnalysis" checked /> Can run analysis</label>
                  <label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" id="shareCanDownloadAggregate" checked /> Can download aggregate outputs</label>
                  <label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" id="shareCanViewRunRows" /> Can view run-level rows</label>
                  <label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" id="shareCanViewPseudonyms" /> Can view participant pseudonyms</label>
                  <label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" id="shareCanViewFullPayload" /> Can view full payload</label>
                  <label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" id="shareCanManageSharing" /> Can manage sharing</label>
                  <label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" id="shareCanRemoveUsers" /> Can remove users</label>
                </div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                <button type="button" class="btn btn-primary" id="shareStudyConfirmBtn">Share</button>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(host.firstElementChild);
      modalEl = document.getElementById("shareStudyModal");

      modalEl.querySelectorAll('[data-bs-dismiss="modal"]').forEach((btn) => {
        btn.addEventListener("click", () => hideShareStudyModal(modalEl));
      });
      modalEl.addEventListener("click", (e) => {
        if (e.target === modalEl) hideShareStudyModal(modalEl);
      });
      return modalEl;
    }

    function showShareStudyModal(modalEl) {
      if (!modalEl) return;
      if (window.bootstrap && window.bootstrap.Modal) {
        window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
        return;
      }
      let backdrop = document.getElementById("shareStudyModalBackdrop");
      if (!backdrop) {
        backdrop = document.createElement("div");
        backdrop.id = "shareStudyModalBackdrop";
        backdrop.className = "modal-backdrop";
        backdrop.addEventListener("click", () => hideShareStudyModal(modalEl));
        document.body.appendChild(backdrop);
      }
      modalEl.classList.add("show");
      modalEl.setAttribute("aria-modal", "true");
      modalEl.removeAttribute("aria-hidden");
      document.body.style.overflow = "hidden";
    }

    function hideShareStudyModal(modalEl) {
      if (!modalEl) return;
      if (window.bootstrap && window.bootstrap.Modal) {
        window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        return;
      }
      modalEl.classList.remove("show");
      modalEl.setAttribute("aria-hidden", "true");
      modalEl.removeAttribute("aria-modal");
      const backdrop = document.getElementById("shareStudyModalBackdrop");
      if (backdrop) backdrop.remove();
      document.body.style.overflow = "";
    }

    async function validateShareUsername(slug, username) {
      const trimmed = (username || "").trim();
      if (!trimmed) return { ok: false, message: "Username is required." };
      const r = await fetch(
        `${API}/api/v1/studies/${encodeURIComponent(slug)}/share/validate-user`,
        postOpts({ username: trimmed })
      );
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      if (!d.exists) return { ok: false, message: "User does not exist." };
      if (!d.eligible) return { ok: false, message: "User is not eligible for study sharing." };
      if (d.is_owner) return { ok: false, message: "User is already the study owner." };
      return { ok: true, role: d.role || "unknown", message: `Valid user (${d.role || "unknown"}).` };
    }

    async function openShareStudyModal(slug) {
      const modalEl = ensureShareStudyModal();
      const usernameEl = document.getElementById("shareStudyUsername");
      const errEl = document.getElementById("shareStudyError");
      const validationEl = document.getElementById("shareStudyValidation");
      const confirmBtn = document.getElementById("shareStudyConfirmBtn");

      const canRunAnalysisEl = document.getElementById("shareCanRunAnalysis");
      const canDownloadAggregateEl = document.getElementById("shareCanDownloadAggregate");
      const canViewRunRowsEl = document.getElementById("shareCanViewRunRows");
      const canViewPseudonymsEl = document.getElementById("shareCanViewPseudonyms");
      const canViewFullPayloadEl = document.getElementById("shareCanViewFullPayload");
      const canManageSharingEl = document.getElementById("shareCanManageSharing");
      const canRemoveUsersEl = document.getElementById("shareCanRemoveUsers");

      let currentValidation = { ok: false, message: "" };

      const setError = (message) => {
        const msg = String(message || "").trim();
        errEl.textContent = msg;
        errEl.classList.toggle("d-none", !msg);
      };

      const setValidation = (result) => {
        currentValidation = result || { ok: false, message: "" };
        const msg = String(currentValidation.message || "").trim();
        validationEl.textContent = msg;
        validationEl.style.display = msg ? "" : "none";
        validationEl.className = `inline-note ${currentValidation.ok ? "ok-note" : "err-note"}`;
      };

      const syncPermissionDependencies = () => {
        if (canViewFullPayloadEl.checked) canViewRunRowsEl.checked = true;
        if (canViewPseudonymsEl.checked) canViewRunRowsEl.checked = true;
        if (!canRunAnalysisEl.checked) {
          canDownloadAggregateEl.checked = false;
          canViewRunRowsEl.checked = false;
          canViewPseudonymsEl.checked = false;
          canViewFullPayloadEl.checked = false;
        }
      };

      usernameEl.value = "";
      canRunAnalysisEl.checked = true;
      canDownloadAggregateEl.checked = true;
      canViewRunRowsEl.checked = false;
      canViewPseudonymsEl.checked = false;
      canViewFullPayloadEl.checked = false;
      canManageSharingEl.checked = false;
      canRemoveUsersEl.checked = false;
      setError("");
      setValidation({ ok: false, message: "Enter a username to validate share target." });

      canRunAnalysisEl.onchange = syncPermissionDependencies;
      canViewRunRowsEl.onchange = syncPermissionDependencies;
      canViewPseudonymsEl.onchange = syncPermissionDependencies;
      canViewFullPayloadEl.onchange = syncPermissionDependencies;

      const runValidation = async () => {
        setError("");
        try {
          const result = await validateShareUsername(slug, usernameEl.value);
          setValidation(result);
          return result;
        } catch (err) {
          setValidation({ ok: false, message: err?.message || String(err) });
          return { ok: false, message: err?.message || String(err) };
        }
      };

      usernameEl.onblur = runValidation;

      confirmBtn.onclick = async () => {
        confirmBtn.disabled = true;
        setError("");
        try {
          const result = await runValidation();
          if (!result.ok) throw new Error(result.message || "Please provide a valid username.");
          syncPermissionDependencies();
          await shareStudy(slug, (usernameEl.value || "").trim(), {
            can_remove_users: !!canRemoveUsersEl.checked,
            can_manage_sharing: !!canManageSharingEl.checked,
            can_run_analysis: !!canRunAnalysisEl.checked,
            can_download_aggregate: !!canDownloadAggregateEl.checked,
            can_view_run_rows: !!canViewRunRowsEl.checked,
            can_view_pseudonyms: !!canViewPseudonymsEl.checked,
            can_view_full_payload: !!canViewFullPayloadEl.checked,
          });
          hideShareStudyModal(modalEl);
        } catch (err) {
          setError(err?.message || String(err));
        } finally {
          confirmBtn.disabled = false;
        }
      };

      showShareStudyModal(modalEl);
      usernameEl.focus();
    }

    async function shareStudy(slug, username, permissions) {
      const sb = document.getElementById("studiesStatus");
      sb.className = "status-bar"; sb.textContent = `Sharing ${slug} with ${username}…`;
      try {
        const r = await fetch(
          `${API}/api/v1/studies/${encodeURIComponent(slug)}/share`,
          postOpts({
            username,
            can_remove_users: !!permissions?.can_remove_users,
            can_manage_sharing: !!permissions?.can_manage_sharing,
            can_run_analysis: !!permissions?.can_run_analysis,
            can_download_aggregate: !!permissions?.can_download_aggregate,
            can_view_run_rows: !!permissions?.can_view_run_rows,
            can_view_pseudonyms: !!permissions?.can_view_pseudonyms,
            can_view_full_payload: !!permissions?.can_view_full_payload,
          })
        );
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        const owners = Array.isArray(d.owner_usernames) && d.owner_usernames.length
          ? d.owner_usernames.join(", ")
          : username;
        sb.className = "status-bar ok";
        if (d.already_shared) {
          if (d.permission_updated) {
            sb.textContent = `Updated ${username}'s permissions. Owners: ${owners}`;
          } else {
            sb.textContent = `${username} already has access. Owners: ${owners}`;
          }
        } else {
          sb.textContent = `Study shared with ${username}. Owners: ${owners}`;
        }
        loadStudies();
      } catch (err) {
        sb.className = "status-bar error";
        sb.textContent = `Share failed: ${err?.message || err}`;
      }
    }

    async function removeStudyUser(slug, username) {
      const sb = document.getElementById("studiesStatus");
      sb.className = "status-bar";
      sb.textContent = `Removing ${username} from ${slug}…`;
      try {
        const r = await fetch(
          `${API}/api/v1/studies/${encodeURIComponent(slug)}/share/remove`,
          postOpts({ username })
        );
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);

        const owners = Array.isArray(d.owner_usernames) && d.owner_usernames.length
          ? d.owner_usernames.join(", ")
          : "—";
        sb.className = "status-bar ok";
        sb.textContent = `Removed ${username} from ${slug}. Owners: ${owners}`;
        loadStudies();
      } catch (err) {
        sb.className = "status-bar error";
        sb.textContent = `Remove access failed: ${err?.message || err}`;
      }
    }

    async function duplicateStudy(sourceSlug, duplicateName) {
      const sb = document.getElementById("studiesStatus");
      sb.className = "status-bar";
      sb.textContent = `Duplicating ${sourceSlug}…`;
      try {
        const r = await fetch(
          `${API}/api/v1/studies/${encodeURIComponent(sourceSlug)}/duplicate`,
          postOpts({ study_name: duplicateName })
        );
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);

        const newSlug = (d.study_slug || "").toString().trim();
        sb.className = "status-bar ok";
        sb.textContent = `Duplicated ${sourceSlug} → ${newSlug}. Open Builder when ready to edit the copy.`;

        invalidateLatestConfigCache();
        await loadStudies();
      } catch (err) {
        sb.className = "status-bar error";
        sb.textContent = `Duplicate failed: ${err?.message || err}`;
      }
    }

    async function deleteStudy(slug) {
      const sb = document.getElementById("studiesStatus");
      sb.className = "status-bar";
      sb.textContent = `Deleting ${slug}…`;
      try {
        const r = await fetch(`${API}/api/v1/studies/${encodeURIComponent(slug)}/delete`, postOpts({}));
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);

        // Drop local state so stale rollout/results are not shown if the study reappears later.
        delete studyState[slug];
        invalidateLatestConfigCache();

        sb.className = "status-bar ok";
        sb.textContent = `Deleted ${slug} from active studies. Historical configs/results/audit logs were retained.`;
        await loadStudies(true);
      } catch (err) {
        sb.className = "status-bar error";
        sb.textContent = `Delete failed: ${err?.message || err}`;
      }
    }

    // ── Decrypt / export ───────────────────────────────────────
    async function decryptRun(slug, runId) {
      const st = getStudyState(slug);
      st.decryptions[runId] = { loading: true, error: null, payload: null };
      loadStudies();
      try {
        const d = await fetchDec(runId);
        st.decryptions[runId] = { loading: false, error: null, payload: d.result_payload || {} };
      } catch (err) {
        const msg = err?.message || String(err);
        st.decryptions[runId] = { loading: false, error: msg, payload: null };
        if (/MFA/i.test(msg) && currentUser) currentUser.mfa_verified = false;
      }
      loadStudies();
    }

    async function exportRun(slug, runId, format) {
      const st  = getStudyState(slug);
      try {
        const dec  = await fetchDec(runId);
        const run  = (st.runs || []).find(r => r.run_session_id === runId)
                  || { run_session_id: runId, status: "—", started_at: null, completed_at: null, trial_count: 0, participant_key_preview: null };
        const b    = mkBundle(run, dec);
        if (format === "csv") dlCsv(`cogflow-run-${runId}.csv`, bundleRows(b));
        else                  dlJson(`cogflow-run-${runId}.json`, dec);
        st.decryptions[runId] = { loading: false, error: null, payload: dec.result_payload || {} };
      } catch (err) {
        const msg = err?.message || String(err);
        st.decryptions[runId] = { loading: false, error: msg, payload: null };
        if (/MFA/i.test(msg) && currentUser) currentUser.mfa_verified = false;
      }
      loadStudies();
    }

    async function exportAll(slug, format) {
      const st   = getStudyState(slug);
      const runs = (st.runs || []).filter(r => r.has_result);
      if (!runs.length) return;
      st.exportBusy = true; loadStudies();
      const exported = [], failures = [];
      const files = [];
      for (const run of runs) {
        try {
          const dec = await fetchDec(run.run_session_id);
          const bundle = mkBundle(run, dec);
          exported.push(bundle);
          if (format === "csv") {
            files.push({
              name: `${slug}/run-${run.run_session_id}.csv`,
              content: toCsv(bundleRows(bundle)),
            });
          } else {
            files.push({
              name: `${slug}/run-${run.run_session_id}.json`,
              content: JSON.stringify({
                exported_at: new Date().toISOString(),
                study_slug: slug,
                run: bundle,
                decrypted_result: dec,
              }, null, 2),
            });
          }
          st.decryptions[run.run_session_id] = { loading: false, error: null, payload: dec.result_payload || {} };
        } catch (err) {
          const msg = err?.message || String(err);
          failures.push({ run_session_id: run.run_session_id, error: msg });
          st.decryptions[run.run_session_id] = { loading: false, error: msg, payload: null };
          if (/MFA/i.test(msg) && currentUser) currentUser.mfa_verified = false;
          break;
        }
      }
      try {
        if (exported.length) {
          files.push({
            name: `${slug}/manifest.json`,
            content: JSON.stringify({
              exported_at: new Date().toISOString(),
              study_slug: slug,
              format,
              exported_count: exported.length,
              failed_count: failures.length,
              run_session_ids: exported.map((b) => b.run_session_id),
            }, null, 2),
          });
          if (failures.length) {
            files.push({
              name: `${slug}/failures.json`,
              content: JSON.stringify(failures, null, 2),
            });
          }
          await dlZip(`cogflow-${slug}-${format}-results.zip`, files);
        }
      } finally {
        st.exportBusy = false;
        loadStudies();
      }
    }

    // ── Admin users ───────────────────────────────────────────
    function maskEmailForSpoiler(rawEmail) {
      const email = String(rawEmail || "").trim();
      if (!email) return "—";

      const at = email.indexOf("@");
      if (at <= 0 || at >= email.length - 1) {
        return "******";
      }

      const local = email.slice(0, at);
      const domain = email.slice(at + 1);
      const domainParts = domain.split(".");
      const domainRoot = domainParts[0] || "";
      const domainTail = domainParts.length > 1 ? `.${domainParts.slice(1).join(".")}` : "";

      const localMasked = `${local[0]}${"*".repeat(Math.max(2, Math.min(8, local.length - 1)))}`;
      const domainMasked = domainRoot
        ? `${domainRoot[0]}${"*".repeat(Math.max(2, Math.min(8, domainRoot.length - 1)))}`
        : "**";

      return `${localMasked}@${domainMasked}${domainTail}`;
    }

    function renderAdminRows() {
      const tbody = document.getElementById("adminUserRows");
      if (!tbody) return;
      tbody.innerHTML = "";

      if (!adminUsers.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="color:var(--muted);text-align:center;padding:24px;">No users found.</td></tr>';
        return;
      }

      for (const u of adminUsers) {
        const tr = document.createElement("tr");
        const disabledSelfDelete = currentUser && u.id === currentUser.id;
        const disabledSelfToggle = currentUser && u.id === currentUser.id;
        const toggleLabel = u.is_active ? "Deactivate" : "Activate";
        const emailRaw = String(u.email || "").trim();
        const emailMasked = maskEmailForSpoiler(emailRaw);
        const emailCell = emailRaw
          ? `<div class="email-spoiler" data-email-spoiler="true">
               <span class="email-spoiler-text" data-email-text="true">${esc(emailMasked)}</span>
               <button class="btn btn-ghost btn-xs" type="button" data-action="admin-toggle-email" data-email="${esc(emailRaw)}" data-email-masked="${esc(emailMasked)}" data-revealed="0" aria-label="Reveal email for ${esc(u.username || "user")}">Reveal</button>
             </div>`
          : "—";
        tr.innerHTML = `
          <td><strong>${esc(u.username || "—")}</strong></td>
          <td>${emailCell}</td>
          <td>
            <select class="admin-role-select" data-user-id="${Number(u.id)}" style="border:1.5px solid var(--line);border-radius:8px;padding:4px 8px;font-size:.8rem;font-family:inherit;outline:none;background:var(--bg);color:var(--ink);max-width:180px;">
              <option value="researcher" ${u.role === "researcher" ? "selected" : ""}>researcher</option>
              <option value="analyst" ${u.role === "analyst" ? "selected" : ""}>analyst</option>
              <option value="participant" ${u.role === "participant" ? "selected" : ""}>participant</option>
              <option value="platform_admin" ${u.role === "platform_admin" ? "selected" : ""}>platform_admin</option>
            </select>
          </td>
          <td>${u.is_active ? "Yes" : "No"}</td>
          <td>${u.mfa_enabled ? "Enabled" : "Off"}</td>
          <td>${esc(fmt(u.last_login))}</td>
          <td>
            <div style="display:flex;gap:5px;flex-wrap:wrap;">
              <button class="btn btn-ghost btn-xs" data-action="admin-save-role" data-user-id="${Number(u.id)}">Save Role</button>
              <button class="btn btn-ghost btn-xs" data-action="admin-set-password" data-user-id="${Number(u.id)}">Set Temp Password</button>
              <button class="btn btn-ghost btn-xs" data-action="admin-toggle-active" data-user-id="${Number(u.id)}" ${disabledSelfToggle ? "disabled" : ""}>${toggleLabel}</button>
              <button class="btn btn-danger btn-xs" data-action="admin-delete-user" data-user-id="${Number(u.id)}" ${disabledSelfDelete ? "disabled" : ""}>Delete</button>
            </div>
          </td>`;
        tbody.appendChild(tr);
      }

      tbody.querySelectorAll('[data-action="admin-toggle-email"]').forEach(btn => {
        btn.addEventListener("click", () => {
          const wrapper = btn.closest('[data-email-spoiler="true"]');
          const textEl = wrapper?.querySelector('[data-email-text="true"]');
          if (!textEl) return;

          const email = btn.getAttribute("data-email") || "";
          const masked = btn.getAttribute("data-email-masked") || "******";
          const revealed = btn.getAttribute("data-revealed") === "1";

          if (revealed) {
            textEl.textContent = masked;
            btn.textContent = "Reveal";
            btn.setAttribute("data-revealed", "0");
          } else {
            textEl.textContent = email;
            btn.textContent = "Hide";
            btn.setAttribute("data-revealed", "1");
          }
        });
      });

      tbody.querySelectorAll('[data-action="admin-save-role"]').forEach(btn => {
        btn.addEventListener("click", async () => {
          const userId = btn.getAttribute("data-user-id");
          const sel = tbody.querySelector(`select.admin-role-select[data-user-id="${String(userId)}"]`);
          const role = sel?.value || "";
          if (!role) return;
          const msgEl = document.getElementById("adminMsg");
          btn.disabled = true;
          try {
            const r = await fetch(`${API}/api/v1/admin/users/${encodeURIComponent(userId)}/role`, postOpts({ role }));
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
            inlineMsg(msgEl, `Role updated for user #${userId}.`, "ok");
            await loadAdminUsers(true);
          } catch (err) {
            inlineMsg(msgEl, `Role update failed: ${err?.message || err}`, "err");
          } finally {
            btn.disabled = false;
          }
        });
      });

      tbody.querySelectorAll('[data-action="admin-delete-user"]').forEach(btn => {
        btn.addEventListener("click", async () => {
          const userId = btn.getAttribute("data-user-id");
          const rowUser = adminUsers.find(x => String(x.id) === String(userId));
          if (!rowUser) return;
          if (!confirm(`Delete user ${rowUser.username}? This cannot be undone.`)) return;
          const msgEl = document.getElementById("adminMsg");
          btn.disabled = true;
          try {
            const r = await fetch(`${API}/api/v1/admin/users/${encodeURIComponent(userId)}/delete`, postOpts({}));
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
            inlineMsg(msgEl, `Deleted ${rowUser.username}.`, "ok");
            await loadAdminUsers(true);
          } catch (err) {
            inlineMsg(msgEl, `Delete failed: ${err?.message || err}`, "err");
          } finally {
            btn.disabled = false;
          }
        });
      });

      tbody.querySelectorAll('[data-action="admin-toggle-active"]').forEach(btn => {
        btn.addEventListener("click", async () => {
          const userId = btn.getAttribute("data-user-id");
          const rowUser = adminUsers.find(x => String(x.id) === String(userId));
          if (!rowUser) return;
          const nextIsActive = !rowUser.is_active;
          const verb = nextIsActive ? "activate" : "deactivate";
          if (!confirm(`Are you sure you want to ${verb} ${rowUser.username}?`)) return;

          const msgEl = document.getElementById("adminMsg");
          btn.disabled = true;
          try {
            const r = await fetch(`${API}/api/v1/admin/users/${encodeURIComponent(userId)}/activation`, postOpts({ is_active: nextIsActive }));
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
            inlineMsg(msgEl, `${rowUser.username} is now ${nextIsActive ? "active" : "inactive"}.`, "ok");
            await loadAdminUsers(true);
          } catch (err) {
            inlineMsg(msgEl, `Activation update failed: ${err?.message || err}`, "err");
          } finally {
            btn.disabled = false;
          }
        });
      });

      tbody.querySelectorAll('[data-action="admin-set-password"]').forEach(btn => {
        btn.addEventListener("click", async () => {
          const userId = btn.getAttribute("data-user-id");
          const username = adminUsers.find(u => String(u.id) === String(userId))?.username || "this user";
          const newPassword = window.prompt(`Set a new temporary password for ${username}:`, "");
          if (newPassword === null) return;
          if (String(newPassword).length < 8) {
            inlineMsg(document.getElementById("adminMsg"), "Temporary password must be at least 8 characters.", "err");
            return;
          }

          const msgEl = document.getElementById("adminMsg");
          btn.disabled = true;
          try {
            const r = await fetch(`${API}/api/v1/admin/users/${encodeURIComponent(userId)}/password`, postOpts({ new_password: String(newPassword) }));
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
            inlineMsg(msgEl, `Temporary password updated for ${username}.`, "ok");
          } catch (err) {
            inlineMsg(msgEl, `Password reset failed: ${err?.message || err}`, "err");
          } finally {
            btn.disabled = false;
          }
        });
      });
    }

    async function loadAdminUsers(force = false) {
      if (currentUser?.role !== "platform_admin") return;
      if (!force && adminUsersLoaded && adminUsers.length) {
        renderAdminRows();
        return;
      }
      const statusEl = document.getElementById("adminStatus");
      if (statusEl) {
        statusEl.className = "status-bar";
        statusEl.textContent = "Loading users…";
      }
      try {
        const r = await fetch(`${API}/api/v1/admin/users`, { credentials: "include" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        adminUsers = Array.isArray(d.users) ? d.users : [];
        adminUsersLoaded = true;
        renderAdminRows();
        if (statusEl) {
          statusEl.className = "status-bar ok";
          statusEl.textContent = `${adminUsers.length} ${adminUsers.length === 1 ? "user" : "users"} loaded.`;
        }
      } catch (err) {
        adminUsers = [];
        adminUsersLoaded = false;
        renderAdminRows();
        if (statusEl) {
          statusEl.className = "status-bar error";
          statusEl.textContent = `Failed to load users: ${err?.message || err}`;
        }
      }
    }

    document.getElementById("adminCreateUserBtn")?.addEventListener("click", async () => {
      const username = (document.getElementById("adminNewUsername")?.value || "").trim();
      const email = (document.getElementById("adminNewEmail")?.value || "").trim();
      const password = document.getElementById("adminNewPassword")?.value || "";
      const role = document.getElementById("adminNewRole")?.value || "researcher";
      const msgEl = document.getElementById("adminMsg");

      if (!username || !password) {
        inlineMsg(msgEl, "Username and temporary password are required.", "err");
        return;
      }
      if (password.length < 8) {
        inlineMsg(msgEl, "Temporary password must be at least 8 characters.", "err");
        return;
      }

      const btn = document.getElementById("adminCreateUserBtn");
      btn.disabled = true;
      btn.textContent = "Creating…";
      try {
        const r = await fetch(`${API}/api/v1/admin/users`, postOpts({ username, email, password, role, is_active: true }));
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        inlineMsg(msgEl, `User ${username} created successfully.`, "ok");
        ["adminNewUsername", "adminNewEmail", "adminNewPassword"].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        });
        await loadAdminUsers(true);
      } catch (err) {
        inlineMsg(msgEl, `Create user failed: ${err?.message || err}`, "err");
      } finally {
        btn.disabled = false;
        btn.textContent = "Create User";
      }
    });

    // ── Preview launch ─────────────────────────────────────────
    document.getElementById("previewLaunchBtn").addEventListener("click", async () => {
      const slug = document.getElementById("previewStudySelect").value;
      const taskType = (document.getElementById("previewTaskSelect")?.value || '').toString().trim().toLowerCase();
      if (!slug) return;
      const btn = document.getElementById("previewLaunchBtn");
      btn.disabled = true; btn.textContent = "Generating…";
      try {
        const previewParticipantId = `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const launchPayload = { participant_external_id: previewParticipantId, expires_in_hours: 1 };
        const latest = await fetchStudyLatestConfig(slug);
        const cfgs = Array.isArray(latest?.configs) ? latest.configs : [];
        const st = getStudyState(slug);
        const profile = normalizeTaskProfileForConfigs(st.taskProfile || loadStudyTaskProfile(slug), cfgs);
        st.taskProfile = profile;

        const cfgById = new Map(cfgs.map((c) => [String(c?.config_version_id || '').trim(), c]));
        let selectedIds = profile.items
          .filter((item) => item.enabled !== false)
          .map((item) => item.config_version_id)
          .filter((id) => cfgById.has(id));

        if (taskType) {
          selectedIds = selectedIds.filter((id) => {
            const c = cfgById.get(id);
            const t = (c?.task_type || '').toString().trim().toLowerCase();
            return t === taskType;
          });
          if (!selectedIds.length) {
            throw new Error(`No enabled published config found for subtask: ${taskType}`);
          }
        }

        const allIds = cfgs
          .map((c) => (c?.config_version_id || '').toString().trim())
          .filter(Boolean);
        const strictNeeded = selectedIds.length > 0 && (
          selectedIds.length !== allIds.length || selectedIds.some((id, idx) => allIds[idx] !== id)
        );
        if (strictNeeded || taskType) {
          launchPayload.counterbalance_enabled = false;
          launchPayload.task_order = selectedIds;
          launchPayload.task_order_strict = true;
        }
        const r = await fetch(`${API}/api/v1/studies/${encodeURIComponent(slug)}/participant-links`,
          postOpts(launchPayload));
        const d = await r.json().catch(() => ({}));
        await handleParticipantLinkAuthErrors(r, d);
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        const token = d.launch_options?.single_use?.launch_token || d.launch_token || "";
        if (!token) {
          document.getElementById("previewFrame").src = "/interpreter/";
        } else {
          const qp = new URLSearchParams({ launch_token: token });
          document.getElementById("previewFrame").src = `/interpreter/?${qp.toString()}`;
        }
      } catch (err) {
        alert(`Preview launch failed: ${err?.message || err}`);
      } finally {
        btn.disabled = false; btn.textContent = "Launch Preview";
      }
    });

    document.getElementById("previewStudySelect").addEventListener("change", (e) => {
      const slug = (e.target?.value || '').toString().trim();
      populatePreviewTaskSelect(slug);
    });

    document.getElementById("analysisStudySelect")?.addEventListener("change", async (e) => {
      const slug = (e.target?.value || '').toString().trim();
      await loadAnalysisJobs(slug);
    });

    document.getElementById("generateSonaLinksBtn")?.addEventListener("click", generateSonaLinksFromIntegrations);
    document.getElementById("generateProlificLinkBtn")?.addEventListener("click", generateProlificLinkFromIntegrations);

    document.getElementById("sendFeedbackBtn")?.addEventListener("click", async () => {
      const category = (document.getElementById("feedbackCategory")?.value || "other").trim();
      const subject = (document.getElementById("feedbackSubject")?.value || "").trim();
      const message = (document.getElementById("feedbackMessage")?.value || "").trim();
      const contact = (document.getElementById("feedbackContact")?.value || "").trim();
      const msgEl = document.getElementById("feedbackMsg");
      const btn = document.getElementById("sendFeedbackBtn");

      if (!message) {
        inlineMsg(msgEl, "Please enter a feedback message.", "err");
        return;
      }

      btn.disabled = true;
      btn.textContent = "Sending…";
      try {
        const r = await fetch(`${API}/api/v1/feedback/submit`, postOpts({
          category,
          subject,
          message,
          contact_email: contact || null,
        }));
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        inlineMsg(msgEl, "Feedback sent. Thank you.", "ok");
        const msgBox = document.getElementById("feedbackMessage");
        const subjBox = document.getElementById("feedbackSubject");
        if (msgBox) msgBox.value = "";
        if (subjBox) subjBox.value = "";
      } catch (err) {
        inlineMsg(msgEl, `Feedback failed: ${err?.message || err}`, "err");
      } finally {
        btn.disabled = false;
        btn.textContent = "Send Feedback";
      }
    });

    // ── Account: change password ───────────────────────────────
    document.getElementById("changePwdBtn").addEventListener("click", async () => {
      const current = document.getElementById("pwdCurrent").value;
      const fresh   = document.getElementById("pwdNew").value;
      const confirm = document.getElementById("pwdConfirm").value;
      const msgEl   = document.getElementById("pwdMsg");
      if (!current || !fresh)   { inlineMsg(msgEl, "Enter current and new password.", "err"); return; }
      if (fresh !== confirm)    { inlineMsg(msgEl, "New passwords do not match.", "err");     return; }
      if (fresh.length < 8)     { inlineMsg(msgEl, "Password must be at least 8 characters.", "err"); return; }
      const btn = document.getElementById("changePwdBtn");
      btn.disabled = true; btn.textContent = "Updating…";
      try {
        const r = await fetch(`${API}/api/v1/auth/password/change`, postOpts({ current_password: current, new_password: fresh }));
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.ok) {
          inlineMsg(msgEl, "Password updated successfully.", "ok");
          ["pwdCurrent","pwdNew","pwdConfirm"].forEach(id => document.getElementById(id).value = "");
        } else {
          inlineMsg(msgEl, d.error || "Password change failed.", "err");
        }
      } catch { inlineMsg(msgEl, "Network error.", "err"); }
      finally  { btn.disabled = false; btn.textContent = "Update Password"; }
    });

    function inlineMsg(el, msg, type) {
      el.textContent = msg;
      el.className   = `inline-note ${type === "ok" ? "ok-note" : "err-note"}`;
      el.style.display = "";
    }

    // ── Account: MFA settings ──────────────────────────────────
    function renderMfaStatusBlock() {
      const block = document.getElementById("mfaStatusBlock");
      const msgEl = document.getElementById("mfaAccountMsg");
      const u = currentUser;
      if (!u || !block) return;

      if (u.mfa_enabled && !mfaSetupState) {
        block.innerHTML = `
          <p class="inline-note ok-note" style="margin-bottom:12px;">
            ✓ TOTP enabled.${u.mfa_verified_at ? ` Last verified: ${fmt(u.mfa_verified_at)}.` : ""}
          </p>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px;">
            <input type="text" id="acctMfaCode" placeholder="Enter code to re-verify"
                   inputmode="numeric" autocomplete="one-time-code" maxlength="12"
                   style="border:1.5px solid var(--line);border-radius:8px;padding:7px 11px;font-size:.88rem;outline:none;background:var(--bg);max-width:220px;" />
            <button class="btn btn-ghost btn-sm" id="acctMfaVerifyBtn">Verify</button>
          </div>
          <button class="btn btn-danger btn-sm" id="mfaDisableBtn">Remove MFA</button>`;
        document.getElementById("acctMfaVerifyBtn").addEventListener("click", doMfaVerify);
        document.getElementById("acctMfaCode").addEventListener("keydown", e => e.key === "Enter" && doMfaVerify());
        document.getElementById("mfaDisableBtn").addEventListener("click", doMfaDisable);

      } else if (mfaSetupState) {
        block.innerHTML = `
          <p class="inline-note" style="margin-bottom:12px;">Scan the QR code in any TOTP-compatible authenticator app, then enter the code to activate.</p>
          <div class="mfa-qr-wrap" id="mfaQrWrap"></div><br/>
          <div style="margin:8px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <span class="auth-secret">${esc(mfaSetupState.secret)}</span>
            <button class="btn btn-ghost btn-xs" id="copyMfaSecretBtn">Copy secret</button>
            <button class="btn btn-ghost btn-xs" id="copyMfaUriBtn">Copy URI</button>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px;">
            <input type="text" id="acctMfaCode" placeholder="6-digit code"
                   inputmode="numeric" autocomplete="one-time-code" maxlength="12"
                   style="border:1.5px solid var(--line);border-radius:8px;padding:7px 11px;font-size:.88rem;outline:none;background:var(--bg);max-width:180px;" />
            <button class="btn btn-primary btn-sm" id="acctMfaActivateBtn">Activate MFA</button>
            <button class="btn btn-ghost btn-sm"   id="mfaCancelBtn">Cancel</button>
          </div>`;
        renderMfaQr();
        document.getElementById("copyMfaSecretBtn").addEventListener("click", e => copyText(mfaSetupState.secret, e.currentTarget));
        document.getElementById("copyMfaUriBtn").addEventListener("click", e => copyText(mfaSetupState.otpauth_uri, e.currentTarget));
        document.getElementById("acctMfaActivateBtn").addEventListener("click", doMfaActivate);
        document.getElementById("acctMfaCode").addEventListener("keydown", e => e.key === "Enter" && doMfaActivate());
        document.getElementById("mfaCancelBtn").addEventListener("click", () => { mfaSetupState = null; renderMfaStatusBlock(); });

      } else {
        block.innerHTML = `
          <p class="inline-note" style="margin-bottom:12px;">MFA is not enabled. Add a TOTP authenticator to protect your account and unlock decryption.</p>
          <button class="btn btn-primary btn-sm" id="mfaEnableBtn">Set up MFA</button>`;
        document.getElementById("mfaEnableBtn").addEventListener("click", doMfaSetup);
      }
      msgEl.style.display = "none";
    }

    function renderMfaQr() {
      const uri  = (mfaSetupState?.otpauth_uri || "").trim();
      const host = document.getElementById("mfaQrWrap");
      if (!uri || !host) return;
      const fallback = () => {
        host.innerHTML = `<img alt="MFA QR" src="https://api.qrserver.com/v1/create-qr-code/?size=132x132&data=${encodeURIComponent(uri)}" />`;
      };
      try {
        if (window.QRCode?.toDataURL) {
          window.QRCode.toDataURL(uri, { width: 132, margin: 1 }, (err, url) => {
            if (err || !url) { fallback(); } else { host.innerHTML = `<img alt="MFA QR" src="${url}" />`; }
          });
          return;
        }
      } catch { /* fall through */ }
      fallback();
    }

    async function doMfaSetup() {
      const msgEl = document.getElementById("mfaAccountMsg");
      try {
        const r = await fetch(`${API}/api/v1/auth/mfa/setup`, postOpts({ regenerate: false }));
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.ok) { inlineMsg(msgEl, d.error || "MFA setup failed", "err"); return; }
        mfaSetupState = { secret: d.totp_secret || "", otpauth_uri: d.otpauth_uri || "" };
        renderMfaStatusBlock();
      } catch { inlineMsg(msgEl, "Network error", "err"); }
    }

    async function doMfaVerify() {
      const code  = (document.getElementById("acctMfaCode")?.value || "").trim();
      const msgEl = document.getElementById("mfaAccountMsg");
      if (!code) return;
      try {
        const r = await fetch(`${API}/api/v1/auth/mfa/verify`, postOpts({ code }));
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.ok) {
          currentUser = { ...currentUser, mfa_verified: true, mfa_verified_at: d.mfa_verified_at || new Date().toISOString() };
          inlineMsg(msgEl, "MFA verified.", "ok");
          renderMfaStatusBlock();
        } else { inlineMsg(msgEl, d.error || "Invalid code", "err"); }
      } catch { inlineMsg(msgEl, "Network error", "err"); }
    }

    async function doMfaActivate() {
      const code  = (document.getElementById("acctMfaCode")?.value || "").trim();
      const msgEl = document.getElementById("mfaAccountMsg");
      if (!code) return;
      try {
        const r = await fetch(`${API}/api/v1/auth/mfa/verify`, postOpts({ code }));
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.ok) {
          mfaSetupState = null;
          currentUser = { ...currentUser, mfa_enabled: true, mfa_verified: true, mfa_verified_at: d.mfa_verified_at || new Date().toISOString() };
          inlineMsg(msgEl, "MFA enabled and verified.", "ok");
          renderMfaStatusBlock();
        } else { inlineMsg(msgEl, d.error || "Activation failed — check your code", "err"); }
      } catch { inlineMsg(msgEl, "Network error", "err"); }
    }

    async function doMfaDisable() {
      if (!confirm("Remove MFA from your account? Decrypt actions will be blocked until MFA is re-enabled.")) return;
      const msgEl = document.getElementById("mfaAccountMsg");
      try {
        const r = await fetch(`${API}/api/v1/auth/mfa/disable`, postOpts({}));
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.ok) {
          currentUser = { ...currentUser, mfa_enabled: false, mfa_verified: false, mfa_verified_at: null };
          inlineMsg(msgEl, "MFA removed.", "ok");
          renderMfaStatusBlock();
        } else { inlineMsg(msgEl, d.error || "Disable failed", "err"); }
      } catch { inlineMsg(msgEl, "Network error", "err"); }
    }

    // ── Ethics block copy ──────────────────────────────────────
    function copyEthicsBlock(blockId, btn) {
      const el   = document.getElementById(blockId);
      const fromSpan = el?.querySelector(".ethics-copy-text")?.textContent?.trim() || "";
      const text = fromSpan || Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent).join("").trim();
      copyText(text, btn);
    }

    function applyAuthMessageFromQuery() {
      const params = new URLSearchParams(window.location.search || "");
      const msg = (params.get("auth_msg") || "").trim();
      const mode = (params.get("auth_mode") || "login").trim();
      const token = (params.get("token") || "").trim();
      if (mode === "reset" && token) {
        showResetConfirm(token, msg || "");
      } else if (mode === "reset_request") {
        showResetRequest(msg || "");
      } else if (mode === "register") {
        if (!msg) return;
        showRegister(msg);
      } else {
        if (!msg) return;
        showLogin(msg);
      }

      try {
        const clean = `${window.location.pathname}${window.location.hash || ""}`;
        window.history.replaceState({}, "", clean);
      } catch {
        // no-op
      }
    }

    // ── Bootstrap ──────────────────────────────────────────────
    (async () => {
      await checkSession();
      if (!currentUser) applyAuthMessageFromQuery();
    })();
