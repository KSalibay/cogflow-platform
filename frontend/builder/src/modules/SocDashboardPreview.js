/**
 * SOC Dashboard preview renderer (isolated)
 * Builder preview is visual-only:
 * - No click->data logging
 * - No icon-click app switching
 * - Tiled windows reflect composed `subtasks[]` (fallback to `num_tasks`)
 */
(function () {
  function escHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function ensureStyle() {
    const existing = document.head?.querySelector('style[data-soc-dashboard-preview="true"]');
    if (existing) return existing;

    const style = document.createElement('style');
    style.dataset.socDashboardPreview = 'true';
    style.textContent = `
      [data-soc-dashboard-preview-host="true"] .soc-preview-shell { position: relative; width: 100%; height: 520px; background: #0b1220; color: #e7eefc; overflow: hidden; border-radius: 10px; }
      [data-soc-dashboard-preview-host="true"] .soc-preview-wallpaper { position:absolute; inset:0; background: radial-gradient(1200px 600px at 20% 10%, rgba(61,122,255,0.35), transparent 55%), radial-gradient(900px 500px at 70% 60%, rgba(20,200,160,0.25), transparent 55%), linear-gradient(135deg, #0b1220, #070b13); }
      [data-soc-dashboard-preview-host="true"] .soc-preview-shell.has-wallpaper .soc-preview-wallpaper { background-size: cover; background-position: center; }

      /* Desktop icons */
      [data-soc-dashboard-preview-host="true"] .soc-preview-desktop-icons { position:absolute; top: 14px; left: 14px; display:flex; flex-direction: column; gap: 8px; z-index: 2; }
      [data-soc-dashboard-preview-host="true"] .soc-preview-icon { width: 84px; height: 98px; display:flex; flex-direction: column; align-items: center; justify-content: center; border-radius: 8px; padding: 6px; user-select:none; cursor: pointer; transition: background 120ms ease, border-color 120ms ease; }
      [data-soc-dashboard-preview-host="true"] .soc-preview-icon:hover { background: rgba(255,255,255,0.10); }
      [data-soc-dashboard-preview-host="true"] .soc-preview-icon.selected { background: rgba(59,130,246,0.28); border: 1px solid rgba(96,165,250,0.45); }
      [data-soc-dashboard-preview-host="true"] .soc-preview-icon .ico { width: 46px; height: 46px; border-radius: 12px; background: rgba(255,255,255,0.10); border: 1px solid rgba(255,255,255,0.16); display:flex; align-items:center; justify-content:center; font-weight: 700; color: #fff; box-shadow: 0 10px 20px rgba(0,0,0,0.25); }
      [data-soc-dashboard-preview-host="true"] .soc-preview-icon .lbl { margin-top: 6px; font-size: 12px; text-align:center; color: #fff; opacity: 0.98; text-shadow: 0 1px 2px rgba(0,0,0,0.85); }

      /* Tiled windows */
      [data-soc-dashboard-preview-host="true"] .soc-preview-windows { position:absolute; top: 14px; right: 14px; bottom: 14px; left: 120px; z-index: 3; display:grid; gap: 10px; grid-auto-rows: 1fr; }
      [data-soc-dashboard-preview-host="true"] .soc-preview-appwin { position: relative; background: rgba(12,16,26,0.88); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; box-shadow: 0 14px 40px rgba(0,0,0,0.45); overflow:hidden; min-height: 0; }
      [data-soc-dashboard-preview-host="true"] .soc-preview-appwin .titlebar { height: 34px; display:flex; align-items:center; padding: 0 12px; background: rgba(255,255,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.10); }
      [data-soc-dashboard-preview-host="true"] .soc-preview-appwin .titlebar .ttl { font-weight: 600; font-size: 12px; }
      [data-soc-dashboard-preview-host="true"] .soc-preview-appwin .content { padding: 10px 12px; height: calc(100% - 34px); overflow:auto; }

      [data-soc-dashboard-preview-host="true"] .soc-preview-card { border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.05); border-radius: 12px; padding: 12px; }
      [data-soc-dashboard-preview-host="true"] .soc-preview-card h4 { margin:0 0 6px 0; font-size: 13px; }
      [data-soc-dashboard-preview-host="true"] .soc-preview-card .muted { opacity: 0.8; font-size: 12px; }

      /* SART-like (log triage) window */
      [data-soc-dashboard-preview-host="true"] .soc-sart-shell { display:flex; flex-direction: column; gap: 10px; }
      [data-soc-dashboard-preview-host="true"] .soc-sart-toolbar { display:flex; align-items:center; justify-content: space-between; gap: 10px; }
      [data-soc-dashboard-preview-host="true"] .soc-sart-toolbar .pill { font-size: 11px; padding: 4px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.06); opacity: 0.95; white-space: nowrap; }
      [data-soc-dashboard-preview-host="true"] .soc-sart-toolbar .meta { display:flex; gap: 6px; flex-wrap: wrap; }
      [data-soc-dashboard-preview-host="true"] .soc-sart-tablewrap { border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; overflow: hidden; background: rgba(0,0,0,0.18); }
      [data-soc-dashboard-preview-host="true"] table.soc-sart-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      [data-soc-dashboard-preview-host="true"] table.soc-sart-table th { text-align:left; font-weight: 600; font-size: 11px; opacity: 0.9; background: rgba(255,255,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.10); padding: 7px 8px; }
      [data-soc-dashboard-preview-host="true"] table.soc-sart-table td { border-bottom: 1px solid rgba(255,255,255,0.06); padding: 7px 8px; vertical-align: top; }
      [data-soc-dashboard-preview-host="true"] table.soc-sart-table tr:last-child td { border-bottom: none; }
      [data-soc-dashboard-preview-host="true"] .soc-sart-badge { display:inline-block; font-size: 10px; padding: 2px 6px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.06); }
      [data-soc-dashboard-preview-host="true"] .soc-sart-highlight { border-radius: 6px; padding: 2px 6px; display:inline-block; }
      [data-soc-dashboard-preview-host="true"] .soc-sart-current { box-shadow: inset 0 0 0 2px rgba(250,204,21,0.65); }
      [data-soc-dashboard-preview-host="true"] .soc-sart-responded { opacity: 0.78; }
      [data-soc-dashboard-preview-host="true"] .soc-sart-go-btn { font-size: 11px; padding: 4px 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.08); color: #fff; cursor: pointer; }
      [data-soc-dashboard-preview-host="true"] .soc-sart-go-btn:hover { background: rgba(255,255,255,0.12); }
      [data-soc-dashboard-preview-host="true"] .soc-sart-go-btn:disabled { opacity: 0.5; cursor: default; }

      /* Per-subtask instructions overlay (preview only) */
      [data-soc-dashboard-preview-host="true"] .soc-sart-overlay { position: absolute; inset: 0; z-index: 50; display:flex; align-items:center; justify-content:center; padding: 14px; background: rgba(2,6,23,0.72); backdrop-filter: blur(6px); }
      [data-soc-dashboard-preview-host="true"] .soc-sart-overlay .panel { max-width: 620px; width: 100%; border-radius: 14px; border: 1px solid rgba(255,255,255,0.14); background: rgba(12,16,26,0.92); box-shadow: 0 20px 70px rgba(0,0,0,0.60); padding: 14px; cursor: pointer; }
      [data-soc-dashboard-preview-host="true"] .soc-sart-overlay .panel h3 { margin: 0 0 8px 0; font-size: 14px; }
      [data-soc-dashboard-preview-host="true"] .soc-sart-overlay .panel .body { font-size: 12px; opacity: 0.95; line-height: 1.45; }
      [data-soc-dashboard-preview-host="true"] .soc-sart-overlay .panel .hint { margin-top: 10px; font-size: 12px; opacity: 0.80; }

      /* PVT-like (preview) */
      [data-soc-dashboard-preview-host="true"] .soc-pvt-status { font-size: 12px; opacity: 0.9; }
      [data-soc-dashboard-preview-host="true"] .soc-pvt-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
      [data-soc-dashboard-preview-host="true"] .soc-pvt-alert-overlay { position: absolute; inset: 0; z-index: 56; display:none; align-items:center; justify-content:center; padding: 14px; background: rgba(2,6,23,0.62); backdrop-filter: blur(4px); }
      [data-soc-dashboard-preview-host="true"] .soc-pvt-alert-overlay.show { display:flex; }
      [data-soc-dashboard-preview-host="true"] .soc-pvt-alert-overlay .panel { position: relative; max-width: 520px; width: 100%; border-radius: 16px; border: 1px solid rgba(255,255,255,0.16); background: rgba(12,16,26,0.94); box-shadow: 0 20px 70px rgba(0,0,0,0.62); padding: 16px; cursor: pointer; }
      [data-soc-dashboard-preview-host="true"] .soc-pvt-alert-overlay .kicker { font-size: 12px; opacity: 0.85; }
      [data-soc-dashboard-preview-host="true"] .soc-pvt-alert-overlay .count { margin-top: 10px; font-size: 56px; font-weight: 800; letter-spacing: -0.5px; }
      [data-soc-dashboard-preview-host="true"] .soc-pvt-alert-overlay .hint { margin-top: 10px; font-size: 12px; opacity: 0.85; }
      [data-soc-dashboard-preview-host="true"] .soc-pvt-flash { position:absolute; inset:0; border-radius: 16px; background: rgba(239,68,68,0.25); box-shadow: inset 0 0 0 1px rgba(239,68,68,0.25); display:block; opacity: 0; transition: opacity 60ms linear; pointer-events: none; }
      [data-soc-dashboard-preview-host="true"] .soc-pvt-flash.show { opacity: 1; }

      /* WCST-like (email sorting) window */
      [data-soc-dashboard-preview-host="true"] .soc-wcst-header { display:flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-header .hint { font-size: 12px; opacity: 0.85; }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-header .actions { display:flex; align-items: center; gap: 10px; }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-help-btn { font-size: 11px; padding: 4px 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.08); color: #fff; cursor: pointer; }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-help-btn:hover { background: rgba(255,255,255,0.12); }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-email { border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.05); border-radius: 12px; padding: 12px; }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-email.draggable { cursor: grab; }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-email.dragging { opacity: 0.72; cursor: grabbing; }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-email .top { display:flex; justify-content: space-between; gap: 10px; align-items: baseline; }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-email .from { font-size: 12px; }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-email .subj { margin-top: 8px; font-size: 12px; }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-email .prev { margin-top: 6px; font-size: 12px; }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-email .meta { margin-top: 10px; display:flex; gap: 6px; flex-wrap: wrap; }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-pill { display:inline-block; font-size: 10px; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-targets { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-target { text-align:left; padding: 10px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); cursor: pointer; transition: background 120ms ease, box-shadow 120ms ease, border-color 120ms ease; user-select: none; }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-target:hover { background: rgba(255,255,255,0.07); }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-target.selected { box-shadow: inset 0 0 0 2px rgba(250,204,21,0.55); }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-target.drag-over { box-shadow: inset 0 0 0 2px rgba(96,165,250,0.70); border-color: rgba(96,165,250,0.60); background: rgba(59,130,246,0.12); }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-target-top { display:flex; justify-content: space-between; gap: 10px; align-items: baseline; margin-bottom: 8px; }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-kv { display:grid; grid-template-columns: 90px 1fr; gap: 6px 10px; font-size: 12px; }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-kv .k { opacity: 0.78; }
      [data-soc-dashboard-preview-host="true"] .soc-wcst-footer { margin-top: 8px; font-size: 12px; opacity: 0.85; }
    `;

    document.head.appendChild(style);
    return style;
  }

  function defaultDesktopIcons() {
    return [
      { label: 'Documents', icon_text: 'DOC' },
      { label: 'My File', icon_text: 'FILE' },
      { label: 'Recycle Bin', icon_text: 'BIN' }
    ];
  }

  function coerceDesktopIcons(raw) {
    if (!Array.isArray(raw)) return defaultDesktopIcons();
    const icons = raw
      .filter(x => x && typeof x === 'object')
      .map((x) => ({
        label: (x.label ?? x.name ?? 'Icon').toString(),
        icon_text: (x.icon_text ?? '').toString()
      }));
    return icons.length ? icons : defaultDesktopIcons();
  }

  function normalizeSubtasks(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(x => x && typeof x === 'object')
      .map(x => ({
        ...x,
        type: (x.type ?? x.kind ?? '').toString(),
        title: (x.title ?? x.name ?? '').toString()
      }))
      .filter(x => x.title || x.type);
  }

  function clamp01(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  function parseList(raw) {
    if (raw === null || raw === undefined) return [];
    const s = String(raw);
    return s
      .split(/[\n,]+/g)
      .map(x => x.trim())
      .filter(Boolean);
  }

  function randInt(min, max) {
    const a = Math.ceil(min);
    const b = Math.floor(max);
    return Math.floor(Math.random() * (b - a + 1)) + a;
  }

  function pick(arr, fallback) {
    if (!Array.isArray(arr) || arr.length === 0) return fallback;
    return arr[randInt(0, arr.length - 1)];
  }

  function formatTime(d) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  function renderNbackLike(containerEl, subtask) {
    if (!containerEl) return { destroy() {} };

    const normalizeKeyName = (raw) => {
      const str = (raw ?? '').toString();
      if (str === ' ') return ' ';
      const t = str.trim();
      const lower = t.toLowerCase();
      if (lower === 'space') return ' ';
      if (lower === 'enter') return 'Enter';
      if (lower === 'escape' || lower === 'esc') return 'Escape';
      if (t.length === 1) return t.toLowerCase();
      return t;
    };

    const nRaw = Number(subtask?.n);
    const n = Number.isFinite(nRaw) ? Math.max(1, Math.min(3, Math.floor(nRaw))) : 2;
    const matchField = ((subtask?.match_field ?? 'src_ip').toString().trim().toLowerCase() === 'username') ? 'username' : 'src_ip';
    const paradigm = ((subtask?.response_paradigm ?? 'go_nogo').toString().trim().toLowerCase() === '2afc') ? '2afc' : 'go_nogo';

    const goKey = normalizeKeyName(subtask?.go_key ?? 'space');
    const matchKey = normalizeKeyName(subtask?.match_key ?? 'j');
    const nonMatchKey = normalizeKeyName(subtask?.nonmatch_key ?? 'f');

    const intervalRaw = Number(subtask?.stimulus_interval_ms);
    const intervalMs = Number.isFinite(intervalRaw) ? Math.max(200, Math.min(5000, Math.floor(intervalRaw))) : 1200;

    const instructionsHtmlRaw = (subtask?.instructions ?? '').toString();
    const hasInstructions = !!instructionsHtmlRaw.trim();
    const instructionsTitle = (subtask?.instructions_title ?? 'Correlating repeat offenders').toString() || 'Correlating repeat offenders';

    const substitutePlaceholders = (html, map) => {
      let out = (html ?? '').toString();
      for (const [k, v] of Object.entries(map || {})) {
        const safe = escHtml((v ?? '').toString());
        out = out.replaceAll(`{{${k}}}`, safe);
        out = out.replaceAll(`{{${k.toLowerCase()}}}`, safe);
      }
      return out;
    };

    const goControl = (paradigm === 'go_nogo')
      ? (goKey === ' ' ? 'SPACE' : goKey)
      : `${nonMatchKey === ' ' ? 'SPACE' : escHtml(nonMatchKey)} (NO) / ${matchKey === ' ' ? 'SPACE' : escHtml(matchKey)} (YES)`;
    const noGoControl = (paradigm === 'go_nogo') ? 'withhold' : (nonMatchKey === ' ' ? 'SPACE' : nonMatchKey);

    const shell = document.createElement('div');
    shell.style.position = 'relative';
    shell.innerHTML = `
      <div class="soc-sart-toolbar" style="margin-bottom: 10px;">
        <div class="meta">
          <span class="pill">${escHtml(String(n))}-back</span>
          <span class="pill">Match: ${escHtml(matchField === 'src_ip' ? 'Source IP' : 'Username')}</span>
          <span class="pill">Mode: ${escHtml(paradigm === 'go_nogo' ? 'Go/No-Go' : '2AFC')}</span>
          <span class="pill">Cadence: ${escHtml(String(intervalMs))}ms</span>
        </div>
        <div class="soc-sart-badge">Preview only</div>
      </div>

      <div class="soc-preview-card" style="border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.18);">
        <div style="display:flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px;">
          <div>
            <h4 style="margin:0 0 4px 0;">Alert correlation (${escHtml(String(n))}-back)</h4>
            <div class="muted">Press ${escHtml(goControl)} when ${escHtml(matchField === 'src_ip' ? 'Source IP' : 'Username')} matches ${escHtml(String(n))}-back.</div>
          </div>
          <div class="soc-sart-badge" id="nback_preview_status" style="opacity:0.85;">Ready</div>
        </div>

        <div id="nback_preview_card" style="border: 1px solid rgba(255,255,255,0.10); border-radius: 12px; padding: 12px; background: rgba(255,255,255,0.05);">
          <div class="muted" style="font-size: 12px;">Waiting…</div>
        </div>
      </div>
    `;

    containerEl.innerHTML = '';
    containerEl.appendChild(shell);

    const cardEl = shell.querySelector('#nback_preview_card');
    const statusEl = shell.querySelector('#nback_preview_status');

    const names = ['a.nguyen', 'j.smith', 'm.patel', 'r.garcia', 's.chen', 'k.johnson'];
    const services = ['secure-login.example', 'admin-portal.example', 'vpn.example', 'mail.example', 'files.example'];
    const events = ['Failed login', 'MFA challenge', 'Password spray suspected', 'Geo anomaly', 'New device'];

    const history = [];
    let tickId = null;
    let started = false;

    const makeIp = () => `10.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}`;

    const renderCard = (entry, isMatch) => {
      if (!cardEl) return;
      const mf = matchField === 'src_ip' ? entry.src_ip : entry.username;
      cardEl.innerHTML = `
        <div style="display:flex; justify-content: space-between; gap: 12px;">
          <div class="muted" style="font-size: 12px;">${escHtml(entry.time)} • Risk ${escHtml(String(entry.risk))}</div>
          <div class="soc-sart-badge" style="opacity: 0.85;">${isMatch ? 'MATCH' : 'NO MATCH'}</div>
        </div>
        <div style="margin-top: 10px; display:grid; grid-template-columns: 140px 1fr; gap: 6px 12px; font-size: 12px;">
          <div class="muted">Source IP</div><div><b>${escHtml(entry.src_ip)}</b></div>
          <div class="muted">Username</div><div><b>${escHtml(entry.username)}</b></div>
          <div class="muted">Destination</div><div>${escHtml(entry.dest)}</div>
          <div class="muted">Event</div><div>${escHtml(entry.event)}</div>
          <div class="muted">Match field</div><div>${escHtml(matchField === 'src_ip' ? 'Source IP' : 'Username')}: <b>${escHtml(mf)}</b></div>
        </div>
      `;
    };

    const tick = () => {
      if (!started) return;
      const canMatch = history.length >= n;
      const isMatch = canMatch ? (Math.random() < 0.25) : false;

      const entry = {
        time: formatTime(new Date()),
        src_ip: makeIp(),
        username: pick(names, 'a.nguyen'),
        dest: pick(services, 'secure-login.example'),
        event: pick(events, 'Failed login'),
        risk: randInt(20, 95)
      };

      if (isMatch) {
        const ref = history[history.length - n];
        if (matchField === 'src_ip') entry.src_ip = ref.src_ip;
        else entry.username = ref.username;
      }

      history.push(entry);
      while (history.length > 12) history.shift();
      if (statusEl) statusEl.textContent = 'Running…';
      renderCard(entry, isMatch);
    };

    const startOnce = () => {
      if (started) return;
      started = true;
      tick();
      tickId = setInterval(tick, intervalMs);
    };

    if (hasInstructions) {
      const overlay = document.createElement('div');
      overlay.className = 'soc-sart-overlay';
      overlay.innerHTML = `
        <div class="panel" role="button" tabindex="0" aria-label="Subtask instructions">
          <h3>${escHtml(instructionsTitle)}</h3>
          <div class="body" data-soc-overlay-body="true"></div>
          <div class="hint">Click this popup to begin.</div>
        </div>
      `;
      const body = overlay.querySelector('[data-soc-overlay-body="true"]');
      if (body) {
        const resolved = substitutePlaceholders(instructionsHtmlRaw, {
          GO_CONTROL: goControl,
          NOGO_CONTROL: noGoControl,
          N: String(n),
          MATCH_FIELD: (matchField === 'src_ip' ? 'Source IP' : 'Username')
        });
        body.innerHTML = resolved;
      }
      const start = () => {
        try { overlay.remove(); } catch { /* ignore */ }
        startOnce();
      };
      overlay.addEventListener('click', start, { once: true });
      overlay.addEventListener('keydown', (e) => {
        const k = normalizeKeyName(e.key);
        if (k === 'Enter' || k === ' ') {
          e.preventDefault();
          start();
        }
      });
      const appWinEl = containerEl.closest?.('.soc-preview-appwin') || null;
      (appWinEl || shell).appendChild(overlay);
    } else {
      startOnce();
    }

    return {
      destroy() {
        try {
          if (tickId) clearInterval(tickId);
        } catch {
          // ignore
        }
        containerEl.innerHTML = '';
      }
    };
  }

  function renderSartLike(containerEl, subtask) {
    if (!containerEl) return { destroy() {} };

    const substitutePlaceholders = (html, map) => {
      let out = (html ?? '').toString();
      for (const [k, v] of Object.entries(map || {})) {
        const safe = escHtml((v ?? '').toString());
        out = out.replaceAll(`{{${k}}}`, safe);
        out = out.replaceAll(`{{${k.toLowerCase()}}}`, safe);
      }
      return out;
    };

    const visibleEntriesRaw = Number(subtask?.visible_entries);
    const visibleEntries = Number.isFinite(visibleEntriesRaw)
      ? Math.max(3, Math.min(30, Math.floor(visibleEntriesRaw)))
      : 10;

    const scrollIntervalRaw = Number(subtask?.scroll_interval_ms);
    const scrollIntervalMs = Number.isFinite(scrollIntervalRaw)
      ? Math.max(80, Math.min(5000, Math.floor(scrollIntervalRaw)))
      : 500;

    const responseDevice = ((subtask?.response_device ?? 'keyboard').toString().trim().toLowerCase() === 'mouse') ? 'mouse' : 'keyboard';
    const goKeyRaw = (subtask?.go_key ?? 'space').toString();
    const goButton = ((subtask?.go_button ?? 'action').toString().trim().toLowerCase() === 'change') ? 'change' : 'action';
    const showMarkers = !!(subtask?.show_markers ?? false);

    const normalizeKeyName = (raw) => {
      const str = (raw ?? '').toString();
      if (str === ' ') return ' ';
      const t = str.trim();
      const lower = t.toLowerCase();
      if (lower === 'space') return ' ';
      if (lower === 'enter') return 'Enter';
      if (lower === 'escape' || lower === 'esc') return 'Escape';
      if (t.length === 1) return t.toLowerCase();
      return t;
    };
    const goKey = normalizeKeyName(goKeyRaw);

    const instructionsHtmlRaw = (subtask?.instructions ?? '').toString();
    const hasInstructions = !!instructionsHtmlRaw.trim();

    const instructionsTitle = (subtask?.instructions_title ?? 'Filtering harmful logins').toString() || 'Filtering harmful logins';

    const highlightSubdomains = !!(subtask?.highlight_subdomains ?? true);
    const targetColor = (subtask?.target_highlight_color ?? '#22c55e').toString();
    const distractorColor = (subtask?.distractor_highlight_color ?? '#ef4444').toString();
    let goCondition = (subtask?.go_condition ?? 'block').toString().trim().toLowerCase();
    // Backward compatibility: map old values (target/distractor) to new (allow/block)
    if (goCondition === 'target') goCondition = 'allow';
    if (goCondition === 'distractor') goCondition = 'block';

    // Keep action outcomes consistent within a run.
    const triageActionOnGo = (goCondition === 'block') ? 'BLOCK' : 'ALLOW';

    const targets = parseList(subtask?.target_subdomains);
    const distractors = parseList(subtask?.distractor_subdomains);
    const neutrals = parseList(subtask?.neutral_subdomains);

    const targetProbability = clamp01(subtask?.target_probability ?? 0.2);
    const distractorProbability = clamp01(subtask?.distractor_probability ?? 0.1);
    const neutralProbability = Math.max(0, 1 - targetProbability - distractorProbability);

    const defaultTargets = ['secure-login.example', 'admin-portal.example', 'alerts.example'];
    const defaultDistractors = ['status.example', 'helpdesk.example', 'cdn.example'];
    const defaultNeutrals = ['mail.example', 'files.example', 'intranet.example'];

    const resolvedGoControl = (responseDevice === 'keyboard')
      ? (goKey === ' ' ? 'SPACE' : goKey)
      : (goButton === 'change' ? 'Change' : 'Action');

    const shell = document.createElement('div');
    shell.className = 'soc-sart-shell';
    shell.style.position = 'relative';
    shell.innerHTML = `
      <div class="soc-sart-toolbar">
        <div class="meta">
          <span class="pill">Visible: ${escHtml(String(visibleEntries))}</span>
          <span class="pill">Scroll: ${escHtml(String(scrollIntervalMs))}ms</span>
          <span class="pill">GO on: ${escHtml(goCondition)}</span>
          <span class="pill">Device: ${escHtml(responseDevice)}</span>
          <span class="pill">${responseDevice === 'keyboard' ? `Key: ${escHtml(goKey === ' ' ? 'SPACE' : goKey)}` : `Button: ${escHtml(goButton)}`}</span>
        </div>
        <div class="soc-sart-badge">Preview only</div>
      </div>

      <div class="soc-sart-tablewrap">
        <table class="soc-sart-table">
          <thead>
            <tr>
              <th style="width: 86px;">Time</th>
              <th style="width: 120px;">Source IP</th>
              <th>Destination</th>
              <th style="width: 110px;">Event</th>
              <th style="width: 120px;">Action</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="muted" style="font-size: 12px; opacity: 0.8;">
        Current entry is highlighted. Responses update Action for realism (still no logging in Builder preview).
      </div>
    `;

    const tbody = shell.querySelector('tbody');
    containerEl.innerHTML = '';
    containerEl.appendChild(shell);

    const now = new Date();
    let tickTime = new Date(now.getTime());
    const rows = [];
    let lastRowId = 0;

    let started = false;

    const eventTypes = ['DNS query', 'TLS handshake', 'HTTP GET', 'HTTP POST', 'Auth attempt', 'File fetch'];

    const getCurrentRow = () => (rows.length ? rows[rows.length - 1] : null);

    const applyResponse = (device) => {
      if (!started) return;
      const current = getCurrentRow();
      if (!current) return;
      if (current.responded) return;

      current.responded = true;
      // Semantics: GO commits a triage decision.
      // Action is bound to the configured GO rule (avoids mixing ALLOW/BLOCK in one run).
      current.triage_action = triageActionOnGo;
      renderRows();
    };

    function makeRow() {
      // Decide class
      const r = Math.random();
      let kind = 'neutral';
      if (r < targetProbability) kind = 'target';
      else if (r < targetProbability + distractorProbability) kind = 'distractor';
      else kind = (neutralProbability > 0 ? 'neutral' : 'target');

      const dst = (kind === 'target')
        ? pick(targets, pick(defaultTargets, 'secure-login.example'))
        : (kind === 'distractor')
          ? pick(distractors, pick(defaultDistractors, 'status.example'))
          : pick(neutrals, pick(defaultNeutrals, 'mail.example'));

      const event = pick(eventTypes, 'HTTP GET');
      const ip = `${randInt(10, 220)}.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}`;

      tickTime = new Date(tickTime.getTime() + randInt(250, 900));

      return {
        id: `p_${++lastRowId}`,
        time: formatTime(tickTime),
        ip,
        dst,
        event,
        triage_action: '—',
        kind,
        responded: false
      };
    }

    function renderRows() {
      if (!tbody) return;
      tbody.innerHTML = '';

      const show = rows.slice(-visibleEntries);
      const currentId = getCurrentRow()?.id || null;
      show.forEach((row) => {
        const tr = document.createElement('tr');

        if (row.id && row.id === currentId) tr.classList.add('soc-sart-current');
        if (row.responded) tr.classList.add('soc-sart-responded');

        const dstText = escHtml(row.dst);
        const shouldHighlight = highlightSubdomains && (row.kind === 'target' || row.kind === 'distractor');
        const color = (row.kind === 'target') ? targetColor : distractorColor;

        const goBtnHtml = (responseDevice === 'mouse')
          ? `<button type="button" class="soc-sart-go-btn" data-row-id="${escHtml(row.id)}" ${row.id !== currentId || row.responded ? 'disabled' : ''}>${escHtml(goButton === 'change' ? 'Change' : 'Action')}</button>`
          : '';

        const triageHtml = escHtml(row.triage_action);

        tr.innerHTML = `
          <td>${escHtml(row.time)}</td>
          <td>${escHtml(row.ip)}</td>
          <td>
            ${shouldHighlight
              ? `<span class="soc-sart-highlight" style="background: ${escHtml(color)}22; border: 1px solid ${escHtml(color)}55; color: #fff;">${dstText}</span>`
              : dstText}
            ${showMarkers && row.kind === 'target' ? ` <span class="soc-sart-badge" style="border-color:${escHtml(targetColor)}55;">target</span>` : ''}
            ${showMarkers && row.kind === 'distractor' ? ` <span class="soc-sart-badge" style="border-color:${escHtml(distractorColor)}55;">distractor</span>` : ''}
          </td>
          <td>${escHtml(row.event)}</td>
          <td style="white-space: nowrap;">
            <span class="soc-sart-badge" style="margin-right: 6px;">${triageHtml}</span>
            ${goBtnHtml}
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    const startSubtask = () => {
      if (started) return;
      started = true;
      // Seed initial rows on start so the overlay truly gates the preview.
      for (let i = 0; i < visibleEntries; i++) rows.push(makeRow());
      renderRows();
    };

    const onKeyDown = (e) => {
      if (!started) return;
      if (responseDevice !== 'keyboard') return;
      const k = normalizeKeyName(e.key);
      if (k && k === goKey) {
        e.preventDefault();
        applyResponse('keyboard');
      }
    };

    const onClick = (e) => {
      if (!started) return;
      if (responseDevice !== 'mouse') return;
      const btn = e.target.closest('button[data-row-id]');
      if (!btn) return;
      const rowId = (btn.dataset.rowId || '').toString();
      const current = getCurrentRow();
      if (!current || current.id !== rowId) return;
      applyResponse('mouse');
    };

    document.addEventListener('keydown', onKeyDown);
    shell.addEventListener('click', onClick);

    const intervalId = window.setInterval(() => {
      if (!started) return;
      rows.push(makeRow());
      // keep bounded (avoid unbounded growth)
      if (rows.length > 200) rows.splice(0, rows.length - 200);
      renderRows();
    }, scrollIntervalMs);

    // Optional instructions overlay.
    if (hasInstructions) {
      const overlay = document.createElement('div');
      overlay.className = 'soc-sart-overlay';
      overlay.innerHTML = `
        <div class="panel" role="button" tabindex="0" aria-label="Subtask instructions">
          <h3>${escHtml(instructionsTitle)}</h3>
          <div class="body" data-soc-overlay-body="true"></div>
          <div class="hint">Click this popup to begin.</div>
        </div>
      `;
      const body = overlay.querySelector('[data-soc-overlay-body="true"]');
      if (body) {
        const resolved = substitutePlaceholders(instructionsHtmlRaw, {
          GO_CONTROL: resolvedGoControl,
          TARGETS: (targets.length ? targets.join(', ') : '(set target_subdomains)'),
          DISTRACTORS: (distractors.length ? distractors.join(', ') : '(set distractor_subdomains)')
        });
        body.innerHTML = resolved;
      }

      const startOnce = () => {
        try { overlay.remove(); } catch { /* ignore */ }
        startSubtask();
      };

      overlay.addEventListener('click', startOnce, { once: true });
      overlay.addEventListener('keydown', (e) => {
        const k = normalizeKeyName(e.key);
        if (k === 'Enter' || k === ' ') {
          e.preventDefault();
          startOnce();
        }
      });

      const appWinEl = containerEl.closest?.('.soc-preview-appwin') || null;
      (appWinEl || shell).appendChild(overlay);
      renderRows();
    } else {
      startSubtask();
    }

    return {
      destroy() {
        try { document.removeEventListener('keydown', onKeyDown); } catch { /* ignore */ }
        try { shell.removeEventListener('click', onClick); } catch { /* ignore */ }
        try { window.clearInterval(intervalId); } catch { /* ignore */ }
      }
    };
  }

  function renderPvtLike(containerEl, subtask) {
    if (!containerEl) return { destroy() {} };

    const normalizeKeyName = (raw) => {
      const str = (raw ?? '').toString();
      if (str === ' ') return ' ';
      const t = str.trim();
      const lower = t.toLowerCase();
      if (lower === 'space') return ' ';
      if (lower === 'enter') return 'Enter';
      if (lower === 'escape' || lower === 'esc') return 'Escape';
      if (t.length === 1) return t.toLowerCase();
      return t;
    };

    const clamp = (x, lo, hi) => {
      const n = Number(x);
      if (!Number.isFinite(n)) return lo;
      return Math.max(lo, Math.min(hi, n));
    };

    const cfg = (() => {
      const o = (subtask && typeof subtask === 'object') ? subtask : {};
      const responseDevice = (o.response_device || 'keyboard').toString().trim().toLowerCase() === 'mouse' ? 'mouse' : 'keyboard';
      const responseKey = normalizeKeyName(o.response_key ?? 'space');
      let minAlert = Number(o.alert_min_interval_ms);
      let maxAlert = Number(o.alert_max_interval_ms);
      minAlert = Number.isFinite(minAlert) ? Math.max(250, Math.floor(minAlert)) : 2000;
      maxAlert = Number.isFinite(maxAlert) ? Math.max(250, Math.floor(maxAlert)) : 6000;
      if (maxAlert < minAlert) {
        const tmp = minAlert;
        minAlert = maxAlert;
        maxAlert = tmp;
      }

      return {
        visible_entries: clamp(o.visible_entries, 3, 30),
        log_scroll_interval_ms: clamp(o.log_scroll_interval_ms ?? o.scroll_interval_ms, 50, 5000),
        response_device: responseDevice,
        response_key: responseKey,
        countdown_seconds: clamp(o.countdown_seconds, 0, 10),
        flash_duration_ms: clamp(o.flash_duration_ms, 20, 2000),
        response_window_ms: clamp(o.response_window_ms, 100, 20000),
        alert_min_interval_ms: minAlert,
        alert_max_interval_ms: maxAlert,
        show_countdown: (o.show_countdown !== undefined) ? !!o.show_countdown : true,
        show_red_flash: (o.show_red_flash !== undefined) ? !!o.show_red_flash : true
      };
    })();

    const fmt = (ts) => {
      const d = new Date(ts);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${hh}:${mm}:${ss}`;
    };

    const randInt = (min, max) => {
      const a = Math.ceil(min);
      const b = Math.floor(max);
      return Math.floor(Math.random() * (b - a + 1)) + a;
    };

    const pick = (arr, fallback) => {
      if (!Array.isArray(arr) || arr.length === 0) return fallback;
      return arr[randInt(0, arr.length - 1)];
    };

    const randomIp = () => `${randInt(10, 199)}.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}`;

    const resolvedControl = (cfg.response_device === 'keyboard')
      ? (cfg.response_key === ' ' ? 'SPACE' : cfg.response_key)
      : 'CLICK';

    containerEl.innerHTML = `
      <div class="soc-sart-shell" id="soc_pvt_shell">
        <div class="soc-sart-toolbar">
          <div>
            <h4 style="margin:0 0 4px 0;">Incident alerts (PVT-like)</h4>
            <div class="muted">Press <b>${escHtml(resolvedControl)}</b> when the <b>red flash</b> appears. Early responses count as false starts.</div>
          </div>
          <div class="meta">
            <span class="pill">Device: <b>${escHtml(cfg.response_device)}</b></span>
            <span class="pill">Key: <b>${escHtml(cfg.response_device === 'keyboard' ? (cfg.response_key === ' ' ? 'space' : cfg.response_key) : 'click')}</b></span>
            <span class="pill">Countdown: <b>${escHtml(String(cfg.countdown_seconds))}s</b></span>
            <span class="pill">Preview</span>
          </div>
        </div>

        <div style="display:flex; align-items:center; justify-content: space-between; gap: 10px;">
          <div class="muted" style="font-size: 12px;">Alerts are randomly scheduled between ${escHtml(String(cfg.alert_min_interval_ms))}–${escHtml(String(cfg.alert_max_interval_ms))}ms.</div>
          <div class="soc-pvt-status" id="soc_pvt_status">Ready</div>
        </div>

        <div class="soc-sart-tablewrap">
          <table class="soc-sart-table">
            <thead>
              <tr><th style="width: 86px;">Time</th><th style="width: 58px;">Lvl</th><th>Message</th></tr>
            </thead>
            <tbody id="soc_pvt_tbody"></tbody>
          </table>
        </div>
      </div>
    `;

    const shellEl = containerEl.querySelector('#soc_pvt_shell');
    const statusEl = containerEl.querySelector('#soc_pvt_status');
    const tbodyEl = containerEl.querySelector('#soc_pvt_tbody');

    const appWinEl = containerEl.closest?.('.soc-preview-appwin') || null;
    const overlayHost = appWinEl || shellEl || containerEl;

    const overlayEl = document.createElement('div');
    overlayEl.className = 'soc-pvt-alert-overlay';
    overlayEl.innerHTML = `
      <div class="panel" role="button" tabindex="0" aria-label="Alert">
        <div class="kicker">Alert incoming</div>
        <div class="count" id="soc_pvt_count">—</div>
        <div class="hint">Respond when the red flash appears. (${escHtml(resolvedControl)})</div>
        <div class="soc-pvt-flash" id="soc_pvt_flash"></div>
      </div>
    `;
    overlayHost.appendChild(overlayEl);

    const overlayCountEl = overlayEl.querySelector('#soc_pvt_count');
    const flashEl = overlayEl.querySelector('#soc_pvt_flash');

    const timeouts = [];
    const intervals = [];
    const clearAll = () => {
      for (const id of timeouts) {
        try { window.clearTimeout(id); } catch { /* ignore */ }
      }
      timeouts.length = 0;
      for (const id of intervals) {
        try { window.clearInterval(id); } catch { /* ignore */ }
      }
      intervals.length = 0;
    };

    const state = {
      started: false,
      ended: false,
      lines: [],
      presented: 0,
      responded: 0,
      false_starts: 0,
      timeouts: 0,
      last_rt_ms: null,
      current: null
    };

    const addLine = (lvl, msg) => {
      state.lines.push({ ts: Date.now(), lvl: (lvl || 'INFO').toString(), msg: (msg || '').toString() });
      if (state.lines.length > 200) state.lines.splice(0, state.lines.length - 200);
    };

    const renderLines = () => {
      if (!tbodyEl) return;
      const lines = state.lines.slice(-cfg.visible_entries);
      tbodyEl.innerHTML = lines.map((ln) => `
        <tr>
          <td>${escHtml(fmt(ln.ts))}</td>
          <td><span class="soc-sart-badge">${escHtml(ln.lvl)}</span></td>
          <td class="soc-pvt-mono">${escHtml(ln.msg)}</td>
        </tr>
      `).join('');
    };

    const randomLogLine = () => {
      const lvl = (Math.random() < 0.10) ? 'WARN' : 'INFO';
      const svc = pick(['auth-service', 'edge-proxy', 'payments-api', 'ids', 'db', 'monitor', 'vpn-gw'], 'svc');
      const msg = pick([
        'heartbeat ok',
        'token refresh ok',
        'routing table updated',
        `conn=${randInt(8, 64)} pool healthy`,
        `p95 latency=${randInt(40, 220)}ms`,
        'signature set synced',
        `unexpected login from ${randomIp()}`
      ], 'event');
      return { lvl, msg: `${svc}: ${msg}` };
    };

    const updateStatus = () => {
      if (!statusEl) return;
      const parts = [
        `P:${state.presented}`,
        `R:${state.responded}`,
        `FS:${state.false_starts}`,
        `TO:${state.timeouts}`
      ];
      if (Number.isFinite(state.last_rt_ms)) parts.push(`RT:${state.last_rt_ms}ms`);
      statusEl.textContent = state.started ? parts.join(' · ') : 'Ready';
    };

    const hideAlert = () => {
      try { overlayEl.classList.remove('show'); } catch { /* ignore */ }
      try { flashEl && flashEl.classList.remove('show'); } catch { /* ignore */ }
      if (overlayCountEl) overlayCountEl.textContent = '—';
      state.current = null;
    };

    const scheduleNextAlert = () => {
      if (!state.started || state.ended) return;
      const gap = randInt(cfg.alert_min_interval_ms, cfg.alert_max_interval_ms);
      const id = window.setTimeout(() => {
        if (!state.started || state.ended) return;
        beginAlert();
      }, gap);
      timeouts.push(id);
    };

    const beginAlert = () => {
      if (!state.started || state.ended) return;

      const id = `preview_${Date.now()}_${state.presented + 1}`;
      state.presented += 1;
      state.current = {
        id,
        flash_onset_ts: null,
        responded: false
      };
      updateStatus();

      overlayEl.classList.add('show');
      if (flashEl) flashEl.classList.remove('show');

      const doFlash = () => {
        const cur = state.current;
        if (!cur || cur.id !== id) return;
        cur.flash_onset_ts = performance.now();

        if (cfg.show_red_flash && flashEl) {
          flashEl.classList.add('show');
          const tid = window.setTimeout(() => {
            try { flashEl.classList.remove('show'); } catch { /* ignore */ }
          }, cfg.flash_duration_ms);
          timeouts.push(tid);
        }

        if (overlayCountEl) overlayCountEl.textContent = 'GO';

        const timeoutId = window.setTimeout(() => {
          const cur2 = state.current;
          if (!cur2 || cur2.id !== id) return;
          if (cur2.responded) return;

          state.timeouts += 1;
          addLine('WARN', 'timeout');
          renderLines();
          updateStatus();
          hideAlert();
          scheduleNextAlert();
        }, cfg.response_window_ms);
        timeouts.push(timeoutId);
      };

      if (!cfg.show_countdown || cfg.countdown_seconds <= 0) {
        if (overlayCountEl) overlayCountEl.textContent = '…';
        doFlash();
        return;
      }

      let remaining = Math.max(0, Math.floor(cfg.countdown_seconds));
      const tick = () => {
        const cur = state.current;
        if (!cur || cur.id !== id) return;

        if (overlayCountEl) overlayCountEl.textContent = String(Math.max(1, remaining));
        remaining -= 1;
        if (remaining <= 0) {
          doFlash();
          return;
        }
        const tid = window.setTimeout(tick, 1000);
        timeouts.push(tid);
      };
      tick();
    };

    const respond = (source) => {
      if (!state.started || state.ended) return;

      const cur = state.current;
      const active = cur && Number.isFinite(cur.flash_onset_ts);
      if (!active) {
        state.false_starts += 1;
        addLine('WARN', `false start (${source})`);
        renderLines();
        updateStatus();
        return;
      }

      if (cur.responded) return;
      cur.responded = true;
      state.responded += 1;

      const rt = Math.max(0, Math.round(performance.now() - cur.flash_onset_ts));
      state.last_rt_ms = rt;

      addLine('INFO', `response rt=${rt}ms`);
      renderLines();
      updateStatus();
      hideAlert();
      scheduleNextAlert();
    };

    const onKeyDown = (e) => {
      if (!state.started || state.ended) return;
      if (cfg.response_device !== 'keyboard') return;
      const k = normalizeKeyName(e.key);
      const rkRaw = (cfg.response_key ?? ' ').toString();
      const isAll = rkRaw.trim().toUpperCase() === 'ALL_KEYS';
      const rk = normalizeKeyName(rkRaw);
      if (!isAll && k !== rk) return;
      e.preventDefault();
      respond('keyboard');
    };

    overlayEl.addEventListener('click', () => {
      if (cfg.response_device !== 'mouse') return;
      respond('mouse');
    });
    overlayEl.addEventListener('keydown', (e) => {
      const k = normalizeKeyName(e.key);
      if (k === 'Enter' || k === ' ') {
        if (cfg.response_device !== 'mouse') return;
        e.preventDefault();
        respond('mouse');
      }
    });

    const start = () => {
      if (state.started) return;
      state.started = true;
      updateStatus();

      // Prime some lines
      for (let i = 0; i < 8; i++) {
        const { lvl, msg } = randomLogLine();
        addLine(lvl, msg);
      }
      renderLines();

      document.addEventListener('keydown', onKeyDown);

      const iid = window.setInterval(() => {
        if (!state.started || state.ended) return;
        const { lvl, msg } = randomLogLine();
        addLine(lvl, msg);
        renderLines();
      }, cfg.log_scroll_interval_ms);
      intervals.push(iid);

      scheduleNextAlert();
    };

    // Instructions overlay gate (consistent with other subtasks)
    const instructionsHtmlRaw = (subtask?.instructions ?? '').toString();
    const hasInstructions = !!instructionsHtmlRaw.trim();
    if (hasInstructions) {
      const title = (subtask?.instructions_title ?? 'Incident alert monitor').toString() || 'Incident alert monitor';
      const overlay = document.createElement('div');
      overlay.className = 'soc-sart-overlay';
      overlay.innerHTML = `
        <div class="panel" role="button" tabindex="0" aria-label="Instructions">
          <h3>${escHtml(title)}</h3>
          <div class="body">${instructionsHtmlRaw}</div>
          <div class="hint">Click to begin</div>
        </div>
      `;

      const startOnce = () => {
        try { overlay.remove(); } catch { /* ignore */ }
        start();
      };

      overlay.addEventListener('click', startOnce, { once: true });
      overlay.addEventListener('keydown', (e) => {
        const k = normalizeKeyName(e.key);
        if (k === 'Enter' || k === ' ') {
          e.preventDefault();
          startOnce();
        }
      });

      (appWinEl || containerEl).appendChild(overlay);
    } else {
      start();
    }

    return {
      destroy() {
        state.ended = true;
        hideAlert();
        clearAll();
        try { document.removeEventListener('keydown', onKeyDown); } catch { /* ignore */ }
        try { overlayEl.remove(); } catch { /* ignore */ }
      }
    };
  }

  function renderFlankerLike(containerEl, subtask) {
    if (!containerEl) return { destroy() {} };

    const normalizeKeyName = (raw) => {
      const str = (raw ?? '').toString();
      if (str === ' ') return ' ';
      const t = str.trim();
      const lower = t.toLowerCase();
      if (lower === 'space') return ' ';
      if (lower === 'enter') return 'Enter';
      if (lower === 'escape' || lower === 'esc') return 'Escape';
      if (t.length === 1) return t.toLowerCase();
      return t;
    };

    const clamp01 = (x) => {
      const n = Number(x);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(1, n));
    };

    const pickLevel = (pHigh, pMed, pLow) => {
      const a = Math.max(0, Number(pHigh) || 0);
      const b = Math.max(0, Number(pMed) || 0);
      const c = Math.max(0, Number(pLow) || 0);
      const sum = a + b + c;
      if (!(sum > 0)) return 1;
      const r = Math.random() * sum;
      if (r < a) return 2;
      if (r < a + b) return 1;
      return 0;
    };

    const rejectRule = ((subtask?.reject_rule ?? 'high_only').toString().trim().toLowerCase() === 'medium_or_high')
      ? 'medium_or_high'
      : 'high_only';

    const allowKey = normalizeKeyName(subtask?.allow_key ?? 'f');
    const rejectKey = normalizeKeyName(subtask?.reject_key ?? 'j');

    const trialIntervalRaw = Number(subtask?.trial_interval_ms);
    const trialIntervalMs = Number.isFinite(trialIntervalRaw) ? Math.max(300, Math.min(10000, Math.floor(trialIntervalRaw))) : 1400;
    const numTrialsRaw = Number(subtask?.num_trials);
    const numTrials = Number.isFinite(numTrialsRaw) ? Math.max(0, Math.min(5000, Math.floor(numTrialsRaw))) : 0;
    const durationRaw = Number(subtask?.duration_ms);
    const durationMs = Number.isFinite(durationRaw) ? Math.max(0, Math.min(3600000, Math.floor(durationRaw))) : 0;
    const insertionIntervalMs = (numTrials > 0 && durationMs > 0)
      ? Math.max(250, Math.min(10000, Math.floor(durationMs / Math.max(1, numTrials))))
      : trialIntervalMs;
    const responseWindowRaw = Number(subtask?.response_window_ms);
    const responseWindowMs = Number.isFinite(responseWindowRaw) ? Math.max(150, Math.min(10000, Math.floor(responseWindowRaw))) : 900;
    const flashRaw = Number(subtask?.question_flash_ms);
    const flashMs = Number.isFinite(flashRaw) ? Math.max(80, Math.min(5000, Math.floor(flashRaw))) : 550;

    const congruentP = clamp01(subtask?.congruent_probability ?? 0.5);
    const pHigh = clamp01(subtask?.center_high_probability ?? 0.34);
    const pMed = clamp01(subtask?.center_medium_probability ?? 0.33);
    const pLow = clamp01(subtask?.center_low_probability ?? 0.33);

    const speedRaw = Number(subtask?.scroll_speed_px_per_s);
    const speedPxPerS = Number.isFinite(speedRaw) ? Math.max(40, Math.min(1200, speedRaw)) : 240;
    const jerk = clamp01(subtask?.jerkiness ?? 0.35);
    const spacingRaw = Number(subtask?.point_spacing_px);
    const spacingPx = Number.isFinite(spacingRaw) ? Math.max(4, Math.min(24, Math.floor(spacingRaw))) : 8;

    const showFeedback = (subtask?.show_feedback !== undefined) ? !!subtask.show_feedback : false;
    const instructionsHtmlRaw = (subtask?.instructions ?? '').toString();
    const hasInstructions = !!instructionsHtmlRaw.trim();
    const instructionsTitle = (subtask?.instructions_title ?? 'Traffic spikes monitor').toString() || 'Traffic spikes monitor';

    const substitutePlaceholders = (html, map) => {
      let out = (html ?? '').toString();
      for (const [k, v] of Object.entries(map || {})) {
        const safe = escHtml((v ?? '').toString());
        out = out.replaceAll(`{{${k}}}`, safe);
        out = out.replaceAll(`{{${k.toLowerCase()}}}`, safe);
      }
      return out;
    };

    const resolvedInstructionsHtml = substitutePlaceholders(instructionsHtmlRaw, {
      ALLOW_KEY: (allowKey === ' ' ? 'SPACE' : allowKey),
      REJECT_KEY: (rejectKey === ' ' ? 'SPACE' : rejectKey)
    });

    const shell = document.createElement('div');
    shell.style.position = 'relative';
    shell.innerHTML = `
      <div style="display:flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px;">
        <div>
          <h4 style="margin:0 0 4px 0;">Traffic spikes monitor</h4>
          <div class="muted">Respond to the <b>center</b> spike when <b>Reject?</b> flashes. Ignore surrounding spikes.</div>
        </div>
        <div class="soc-sart-badge" id="flanker_preview_status" style="opacity:0.85;">Ready</div>
      </div>

      <div class="soc-preview-card" style="border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.18); overflow:hidden;">
        <div id="flanker_prompt" style="position: relative; height: 26px; display:flex; align-items:center; justify-content:center; font-weight: 700; letter-spacing: 0.2px; opacity: 0;">Reject?</div>
        <div style="position: relative;">
          <canvas id="flanker_canvas" width="720" height="190" style="width: 100%; height: 190px; display:block;"></canvas>
          <div style="position:absolute; top: 0; bottom: 0; left: 50%; width: 0; border-left: 1px dashed rgba(250,204,21,0.75);"></div>
        </div>
        <div class="muted" style="margin-top:10px; font-size: 12px; display:flex; justify-content: space-between; gap: 10px;">
          <div>ALLOW: <b>${escHtml(allowKey === ' ' ? 'SPACE' : allowKey)}</b></div>
          <div>REJECT: <b>${escHtml(rejectKey === ' ' ? 'SPACE' : rejectKey)}</b></div>
          <div style="opacity:0.9;">Preview only</div>
        </div>
      </div>
    `;

    containerEl.innerHTML = '';
    containerEl.appendChild(shell);

    const appWinEl = containerEl.closest?.('.soc-preview-appwin') || null;

    const canvas = shell.querySelector('#flanker_canvas');
    const promptEl = shell.querySelector('#flanker_prompt');
    const statusEl = shell.querySelector('#flanker_preview_status');
    if (!canvas) return { destroy() {} };
    const ctx = canvas.getContext('2d');

    let started = false;
    let destroyed = false;

    const N = 140;
    const points = Array.from({ length: N }, () => ({ level: 1, trialId: null, isCenter: false }));
    let offset = 0;
    let lastT = null;
    let trialSeq = 0;
    const trialsById = new Map();
    const pendingClusters = [];
    let activeTrial = null;
    let insertedTrials = 0;
    const maxTrialsToInsert = (numTrials > 0) ? numTrials : Infinity;
    let lastFeedbackUntil = 0;

    const markerX = canvas.width / 2;
    const approxTailX = (N - 1) * spacingPx;
    const travelMs = Math.max(0, Math.round(((approxTailX - markerX) / Math.max(40, speedPxPerS)) * 1000));
    const effectiveDurationMs = (numTrials > 0 && durationMs > 0) ? Math.max(0, Math.floor(durationMs - travelMs)) : 0;
    const insertionIntervalMs2 = (numTrials > 0 && durationMs > 0)
      ? Math.max(250, Math.min(10000, Math.floor(effectiveDurationMs / Math.max(1, numTrials)) || insertionIntervalMs))
      : insertionIntervalMs;

    const levelToY = (h, height) => {
      const base = height - 22;
      if (h === 2) return base - 120;
      if (h === 1) return base - 78;
      return base - 42;
    };

    const draw = () => {
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Background grid
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (let y = 32; y < h; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Line
      ctx.strokeStyle = 'rgba(147,197,253,0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const x = (i * spacingPx) - offset;
        const y = levelToY(points[i].level, h);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Spikes
      const base = h - 22;
      for (let i = 0; i < points.length; i++) {
        const x = (i * spacingPx) - offset;
        if (x < -10 || x > w + 10) continue;
        const y = levelToY(points[i].level, h);
        const isAnyCenter = !!points[i].isCenter && !!points[i].trialId;
        const isActiveCenter = isAnyCenter && activeTrial && points[i].trialId === activeTrial.id;
        const isTrialSpike = !!points[i].trialId;

        if (isActiveCenter) {
          ctx.strokeStyle = 'rgba(250,204,21,0.95)';
          ctx.lineWidth = 3;
        } else if (isAnyCenter) {
          ctx.strokeStyle = 'rgba(250,204,21,0.35)';
          ctx.lineWidth = 2;
        } else if (isTrialSpike) {
          ctx.strokeStyle = 'rgba(255,255,255,0.22)';
          ctx.lineWidth = 1;
        } else {
          ctx.strokeStyle = 'rgba(255,255,255,0.10)';
          ctx.lineWidth = 1;
        }
        ctx.beginPath();
        ctx.moveTo(x, base);
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      // Baseline
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, base);
      ctx.lineTo(w, base);
      ctx.stroke();
    };

    const enqueueTrialCluster = () => {
      const centerLevel = pickLevel(pHigh, pMed, pLow);
      const isCongruent = Math.random() < congruentP;
      let flankerLevel = centerLevel;
      if (!isCongruent) {
        if (centerLevel === 2) flankerLevel = 0;
        else if (centerLevel === 0) flankerLevel = 2;
        else flankerLevel = (Math.random() < 0.5) ? 0 : 2;
      }

      const id = `trial_${Date.now()}_${trialSeq++}`;
      const isRejectCorrect = (rejectRule === 'medium_or_high') ? (centerLevel >= 1) : (centerLevel === 2);
      const trial = { id, centerLevel, flankerLevel, congruent: isCongruent, isRejectCorrect, startedAt: null, responded: false };
      trialsById.set(id, trial);

      const cluster = [flankerLevel, flankerLevel, centerLevel, flankerLevel, flankerLevel];
      pendingClusters.push({ trialId: id, cluster, pos: 0 });
      return trial;
    };

    const stampClusterNearMarker = (trial, cluster) => {
      if (!trial || !Array.isArray(cluster) || cluster.length !== 5) return;
      const leadMs = 700;
      const leadPx = Math.max(0, Math.round((Math.max(40, speedPxPerS) * leadMs) / 1000));
      const targetX = markerX + leadPx;
      const centerIdx = Math.max(3, Math.min(points.length - 3, Math.round(targetX / spacingPx)));
      const startIdx = centerIdx - 2;
      for (let k = 0; k < 5; k++) {
        const idx = startIdx + k;
        if (idx < 0 || idx >= points.length) continue;
        points[idx].level = cluster[k];
        points[idx].trialId = trial.id;
        points[idx].isCenter = (k === 2);
      }
    };

    const maybeStartTrial = () => {
      if (activeTrial) return;
      // Start when the "center" point of a pending trial hits the canvas center.
      const midX = canvas.width / 2;
      for (let i = 0; i < points.length; i++) {
        if (!points[i].isCenter || !points[i].trialId) continue;
        const x = (i * spacingPx) - offset;
        if (Math.abs(x - midX) <= Math.max(4, spacingPx * 0.75)) {
          const trial = trialsById.get(points[i].trialId) || null;
          if (!trial || trial.startedAt) continue;
          activeTrial = trial;
          activeTrial.startedAt = performance.now();
          const trialId = activeTrial.id;
          if (statusEl) statusEl.textContent = 'Decision…';
          if (promptEl) {
            promptEl.style.opacity = '1';
            promptEl.style.color = 'rgba(255,255,255,0.95)';
          }
          window.setTimeout(() => {
            if (destroyed) return;
            if (promptEl) {
              promptEl.style.color = '';
            }
          }, flashMs);
          window.setTimeout(() => {
            if (destroyed) return;
            if (!activeTrial || activeTrial.id !== trialId) return;
            if (activeTrial.responded) return;
            if (statusEl) statusEl.textContent = 'Running…';
            if (promptEl) {
              promptEl.style.opacity = '0';
              promptEl.style.color = '';
            }
            try { trialsById.delete(trialId); } catch { /* ignore */ }
            activeTrial = null;
          }, responseWindowMs);
          return;
        }
      }
    };

    const onKeyDown = (e) => {
      if (!started) return;
      if (!activeTrial || !activeTrial.startedAt || activeTrial.responded) return;
      const k = normalizeKeyName(e.key);
      if (k !== allowKey && k !== rejectKey) return;
      e.preventDefault();
      activeTrial.responded = true;
      if (statusEl) statusEl.textContent = 'Running…';
      if (showFeedback && statusEl) {
        const choseReject = (k === rejectKey);
        const correct = (choseReject === !!activeTrial.isRejectCorrect);
        statusEl.textContent = correct ? 'Correct' : 'Incorrect';
        lastFeedbackUntil = performance.now() + 450;
      }
      if (promptEl) {
        promptEl.style.opacity = '0';
        promptEl.style.color = '';
      }
      try { trialsById.delete(activeTrial.id); } catch { /* ignore */ }
      activeTrial = null;
    };

    const tick = (t) => {
      if (destroyed) return;
      if (!started) return;
      if (!lastT) lastT = t;
      const dt = Math.max(0, Math.min(0.05, (t - lastT) / 1000));
      lastT = t;

      const jitter = 1 + ((Math.random() * 2 - 1) * jerk * 0.35);
      offset += (speedPxPerS * jitter) * dt;
      while (offset >= spacingPx) {
        offset -= spacingPx;
        points.shift();

        const p = { level: pickLevel(pHigh, pMed, pLow), trialId: null, isCenter: false };
        const head = pendingClusters.length ? pendingClusters[0] : null;
        if (head && head.cluster && head.pos < head.cluster.length) {
          const k = head.pos;
          p.level = head.cluster[k];
          p.trialId = head.trialId;
          p.isCenter = (k === 2);
          head.pos += 1;
          if (head.pos >= head.cluster.length) {
            pendingClusters.shift();
          }
        }
        points.push(p);
      }

      if (showFeedback && statusEl && lastFeedbackUntil && performance.now() > lastFeedbackUntil) {
        lastFeedbackUntil = 0;
        statusEl.textContent = activeTrial ? 'Decision…' : 'Running…';
      }

      // Self-healing: ensure the prompt and active trial clear if a timeout is missed.
      if (activeTrial && activeTrial.startedAt) {
        const age = Math.max(0, performance.now() - activeTrial.startedAt);
        if (promptEl) {
          if (age < responseWindowMs) {
            promptEl.style.opacity = '1';
            promptEl.style.color = (age < flashMs) ? 'rgba(255,255,255,0.95)' : '';
          } else {
            promptEl.style.opacity = '0';
            promptEl.style.color = '';
          }
        }
        if (age >= responseWindowMs && !activeTrial.responded) {
          try { trialsById.delete(activeTrial.id); } catch { /* ignore */ }
          activeTrial = null;
          if (statusEl) statusEl.textContent = 'Running…';
        }
      }

      draw();
      maybeStartTrial();
      requestAnimationFrame(tick);
    };

    const startOnce = () => {
      if (started) return;
      started = true;
      if (statusEl) statusEl.textContent = 'Running…';

      // Seed baseline
      for (let i = 0; i < points.length; i++) {
        points[i].level = pickLevel(pHigh, pMed, pLow);
        points[i].trialId = null;
        points[i].isCenter = false;
      }
      pendingClusters.length = 0;
      try { trialsById.clear(); } catch { /* ignore */ }
      if (promptEl) {
        promptEl.style.opacity = '0';
        promptEl.style.color = '';
      }
      insertedTrials = 0;
      {
        const trial = enqueueTrialCluster();
        const cluster = pendingClusters.length ? pendingClusters[pendingClusters.length - 1]?.cluster : null;
        if (trial && cluster) {
          pendingClusters.pop();
          stampClusterNearMarker(trial, cluster);
        }
        insertedTrials += 1;
      }

      const intervalId = window.setInterval(() => {
        if (destroyed) return;
        if (insertedTrials >= maxTrialsToInsert) return;
        enqueueTrialCluster();
        insertedTrials += 1;
      }, insertionIntervalMs2);

      document.addEventListener('keydown', onKeyDown);
      requestAnimationFrame(tick);

      return () => {
        try { window.clearInterval(intervalId); } catch { /* ignore */ }
      };
    };

    let stopInterval = null;

    if (hasInstructions) {
      const overlay = document.createElement('div');
      overlay.className = 'soc-sart-overlay';
      overlay.innerHTML = `
        <div class="panel" role="button" tabindex="0" aria-label="Subtask instructions">
          <h3>${escHtml(instructionsTitle)}</h3>
          <div class="body" data-soc-overlay-body="true"></div>
          <div class="hint">Click this popup to begin.</div>
        </div>
      `;
      const body = overlay.querySelector('[data-soc-overlay-body="true"]');
      if (body) body.innerHTML = resolvedInstructionsHtml;
      const start = () => {
        try { overlay.remove(); } catch { /* ignore */ }
        stopInterval = startOnce();
      };
      overlay.addEventListener('click', start, { once: true });
      overlay.addEventListener('keydown', (e) => {
        const k = normalizeKeyName(e.key);
        if (k === 'Enter' || k === ' ') {
          e.preventDefault();
          start();
        }
      });
      (appWinEl || shell).appendChild(overlay);
    } else {
      stopInterval = startOnce();
    }

    return {
      destroy() {
        destroyed = true;
        try { if (typeof stopInterval === 'function') stopInterval(); } catch { /* ignore */ }
        try { document.removeEventListener('keydown', onKeyDown); } catch { /* ignore */ }
        try { containerEl.innerHTML = ''; } catch { /* ignore */ }
      }
    };
  }

  function renderWcstLike(containerEl, subtask) {
    if (!containerEl) return { destroy() {} };

    const responseDevice = ((subtask?.response_device ?? 'keyboard').toString().trim().toLowerCase() === 'mouse') ? 'mouse' : 'keyboard';
    const mouseMode = ((subtask?.mouse_response_mode ?? 'click').toString().trim().toLowerCase() === 'drag') ? 'drag' : 'click';
    const keys = parseList(subtask?.choice_keys ?? subtask?.response_keys ?? '1,2,3,4').map(s => s.toLowerCase()).slice(0, 4);
    while (keys.length < 4) keys.push(String(keys.length + 1));

    const keyLabel = (k) => {
      if (k === ' ') return 'SPACE';
      return String(k || '').toUpperCase();
    };

    const parseLines = (x) => {
      if (x === null || x === undefined) return [];
      const s = String(x);
      const lines = s.split(/\r?\n/g).map(v => v.trim()).filter(Boolean);
      if (lines.length) return lines;
      return parseList(s);
    };

    const senderDomains = parseList(subtask?.sender_domains ?? subtask?.sender_domain_examples ?? 'corp.test, vendor.test, typo.test, ip.test').slice(0, 4);
    while (senderDomains.length < 4) senderDomains.push(['corp.test', 'vendor.test', 'typo.test', 'ip.test'][senderDomains.length]);
    const senderNames = parseList(subtask?.sender_display_names ?? subtask?.sender_names ?? 'Operations, IT Vendor, Support Desk, Automated Notice').slice(0, 4);
    while (senderNames.length < 4) senderNames.push(['Operations', 'IT Vendor', 'Support Desk', 'Automated Notice'][senderNames.length]);

    const subjectUrgent = parseLines(subtask?.subject_lines_urgent ?? 'Action required: verify your account');
    const previewUrgent = parseLines(subtask?.preview_lines_urgent ?? 'Please verify your account details to avoid interruption.');
    const subject = subjectUrgent[0] || 'Action required: verify your account';
    const preview = previewUrgent[0] || 'Please verify your account details to avoid interruption.';

    const attachmentDocm = (subtask?.attachment_label_docm ?? 'invoice.docm').toString();
    const linkTextShort = (subtask?.link_text_shortened ?? 'short.test/abc').toString();

    const rulesRaw = subtask?.rules ?? subtask?.rule_sequence ?? 'sender_domain,subject_tone,link_style,attachment_type';
    const rules = Array.isArray(rulesRaw) ? rulesRaw.map(String) : parseList(rulesRaw);
    const rulesNice = rules.length ? rules.join(', ') : 'sender_domain, subject_tone, link_style, attachment_type';

    const controls = (responseDevice === 'mouse')
      ? (mouseMode === 'drag' ? 'Drag the email onto a target card to sort.' : 'Click a target card to sort.')
      : `Press ${escHtml(keys.map(keyLabel).join(', '))} to choose the target cards.`;

    const substitutePlaceholders = (html, map) => {
      let out = (html ?? '').toString();
      for (const [k, v] of Object.entries(map || {})) {
        const safe = escHtml((v ?? '').toString());
        out = out.replaceAll(`{{${k}}}`, safe);
        out = out.replaceAll(`{{${k.toLowerCase()}}}`, safe);
      }
      return out;
    };

    const instructionsHtmlRaw = (subtask?.instructions ?? '').toString();
    const hasInstructions = !!instructionsHtmlRaw.trim();
    const instructionsTitle = (subtask?.instructions_title ?? 'Email sorting').toString() || 'Email sorting';
    const resolvedInstructionsHtml = substitutePlaceholders(instructionsHtmlRaw, {
      CONTROLS: controls,
      KEYS: keys.map(keyLabel).join(', '),
      RULES: rulesNice,
      DOMAINS: senderDomains.join(', ')
    });

    const helpEnabled = !!(subtask?.help_overlay_enabled ?? true);
    const helpTitle = (subtask?.help_overlay_title ?? 'Quick help').toString() || 'Quick help';
    const defaultHelpHtml = `
      <p><b>Goal:</b> Sort each email into one of four targets.</p>
      <p><b>How to respond:</b> {{CONTROLS}}</p>
      <p><b>How to decide:</b> Each target card shows a <i>prototype</i>. The correct target is the one that matches the email on the current rule dimension.</p>
      <p><b>What the domains mean:</b> These are example sender domains used as stimulus attributes (not real destinations): <b>{{DOMAINS}}</b>.</p>
      <p><b>Possible rules:</b> {{RULES}}</p>
    `;
    const helpHtmlRaw = (subtask?.help_overlay_html ?? '').toString().trim() ? subtask.help_overlay_html : defaultHelpHtml;
    const resolvedHelpHtml = substitutePlaceholders(helpHtmlRaw, {
      CONTROLS: controls,
      KEYS: keys.map(keyLabel).join(', '),
      RULES: rulesNice,
      DOMAINS: senderDomains.join(', ')
    });

    const shell = document.createElement('div');
    shell.style.position = 'relative';
    shell.tabIndex = 0;

    shell.innerHTML = `
      <div class="soc-wcst-header">
        <div>
          <h4 style="margin:0 0 4px 0;">Email sorting (WCST-like)</h4>
          <div class="muted">Preview only. Current rule is hidden; infer from feedback at runtime.</div>
        </div>
        <div class="actions">
          ${helpEnabled ? `<button type="button" class="soc-wcst-help-btn" data-action="help">Help</button>` : ''}
          <div class="soc-sart-badge" style="opacity:0.85;">${escHtml(responseDevice)}</div>
        </div>
      </div>

      <div class="soc-wcst-email" data-soc-wcst-email="true">
        <div class="top">
          <div class="from">${escHtml(senderNames[0])} <span class="muted">&lt;alerts@${escHtml(senderDomains[0])}&gt;</span></div>
          <div class="muted" style="font-size: 11px;">ID: MAIL-PREVIEW</div>
        </div>
        <div class="subj"><b>${escHtml(subject)}</b></div>
        <div class="prev muted">${escHtml(preview)}</div>
        <div class="meta">
          <span class="soc-wcst-pill">Attachment: ${escHtml(attachmentDocm)}</span>
          <span class="soc-wcst-pill">Link: ${escHtml(linkTextShort)}</span>
        </div>
      </div>

      <div class="soc-wcst-targets" style="margin-top: 10px;">
        ${['A', 'B', 'C', 'D'].map((id, idx) => `
          <div class="soc-wcst-target" data-idx="${idx}" role="button" tabindex="0" aria-label="Target ${escHtml(id)}">
            <div class="soc-wcst-target-top">
              <div>
                <b>Target ${responseDevice === 'keyboard' ? escHtml(keyLabel(keys[idx])) : escHtml(id)}</b>
                ${responseDevice === 'keyboard' ? `<span class="muted" style="font-size:11px;">(prototype ${escHtml(id)})</span>` : ''}
              </div>
              <div class="muted" style="font-size:11px;">Prototype</div>
            </div>
            <div class="soc-wcst-kv">
              <div class="k">Sender</div><div class="v">${escHtml(senderDomains[idx])}</div>
              <div class="k">Subject</div><div class="v">${escHtml(['neutral', 'urgent', 'reward', 'threat'][idx])}</div>
              <div class="k">Link</div><div class="v">${escHtml(['none', 'visible', 'shortened', 'mismatch'][idx])}</div>
              <div class="k">Attachment</div><div class="v">${escHtml(['none', 'pdf', 'docm', 'zip'][idx])}</div>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="soc-wcst-footer" data-soc-wcst-status="true">${controls} • Domains: ${escHtml(senderDomains.join(', '))} • Rules: ${escHtml(rulesNice)}</div>

      ${helpEnabled ? `
        <div class="soc-sart-overlay" data-soc-wcst-help="true" style="display:none;">
          <div class="panel" role="button" tabindex="0" aria-label="WCST-like help">
            <h3>${escHtml(helpTitle)}</h3>
            <div class="body" data-soc-overlay-body="true"></div>
            <div class="hint">Click to close.</div>
          </div>
        </div>
      ` : ''}

      ${hasInstructions ? `
        <div class="soc-sart-overlay" data-soc-wcst-instructions="true">
          <div class="panel" role="button" tabindex="0" aria-label="Subtask instructions">
            <h3>${escHtml(instructionsTitle)}</h3>
            <div class="body" data-soc-overlay-body="true"></div>
            <div class="hint">Click this popup to begin.</div>
          </div>
        </div>
      ` : ''}
    `;

    containerEl.innerHTML = '';
    containerEl.appendChild(shell);

    const emailEl = shell.querySelector('[data-soc-wcst-email="true"]');
    const statusEl = shell.querySelector('[data-soc-wcst-status="true"]');
    const targets = Array.from(shell.querySelectorAll('.soc-wcst-target'));

    let lastTimeout = null;
    const setStatus = (text) => {
      if (!statusEl) return;
      statusEl.textContent = text;
      try {
        if (lastTimeout) window.clearTimeout(lastTimeout);
      } catch { /* ignore */ }
      lastTimeout = window.setTimeout(() => {
        statusEl.textContent = `${controls} • Domains: ${senderDomains.join(', ')} • Rules: ${rulesNice}`;
      }, 900);
    };

    const clearSelected = () => {
      targets.forEach(t => t.classList.remove('selected'));
    };
    const selectIdx = (idx) => {
      clearSelected();
      const el = shell.querySelector(`.soc-wcst-target[data-idx="${idx}"]`);
      if (el) el.classList.add('selected');
      const label = (responseDevice === 'keyboard') ? keyLabel(keys[idx]) : ['A','B','C','D'][idx];
      setStatus(`Preview: sorted to Target ${label}`);
    };

    const onTargetClick = (e) => {
      // Mirror runtime: when drag mode is selected, clicking targets is disabled.
      if (responseDevice === 'mouse' && mouseMode === 'drag') return;
      const t = e.currentTarget;
      const idx = parseInt(t?.getAttribute('data-idx') || '-1', 10);
      if (Number.isFinite(idx) && idx >= 0) selectIdx(idx);
    };

    const onTargetKeyDown = (e) => {
      const k = (e.key || '').toString();
      if (k === 'Enter' || k === ' ') {
        e.preventDefault();
        onTargetClick({ currentTarget: e.currentTarget });
      }
    };

    targets.forEach((t) => {
      t.addEventListener('click', onTargetClick);
      t.addEventListener('keydown', onTargetKeyDown);
    });

    const onShellKeyDown = (e) => {
      if (responseDevice !== 'keyboard') return;
      const key = (e.key || '').toString().toLowerCase();
      const idx = keys.findIndex(k => k === key);
      if (idx >= 0) {
        e.preventDefault();
        selectIdx(idx);
      }
    };

    shell.addEventListener('keydown', onShellKeyDown);

    // Drag-to-sort preview interactivity
    const enableDrag = (responseDevice === 'mouse' && mouseMode === 'drag');
    if (emailEl) {
      if (enableDrag) {
        emailEl.classList.add('draggable');
        emailEl.setAttribute('draggable', 'true');
      } else {
        emailEl.classList.remove('draggable');
        emailEl.removeAttribute('draggable');
      }
    }

    const onDragStart = (e) => {
      try {
        emailEl && emailEl.classList.add('dragging');
        e.dataTransfer && e.dataTransfer.setData('text/plain', 'soc-wcst-preview');
        e.dataTransfer && (e.dataTransfer.effectAllowed = 'move');
      } catch { /* ignore */ }
    };
    const onDragEnd = () => {
      try { emailEl && emailEl.classList.remove('dragging'); } catch { /* ignore */ }
      targets.forEach(t => t.classList.remove('drag-over'));
    };
    const onDragOver = (e) => {
      if (!enableDrag) return;
      e.preventDefault();
      e.currentTarget.classList.add('drag-over');
      try { e.dataTransfer && (e.dataTransfer.dropEffect = 'move'); } catch { /* ignore */ }
    };
    const onDragLeave = (e) => {
      e.currentTarget.classList.remove('drag-over');
    };
    const onDrop = (e) => {
      if (!enableDrag) return;
      e.preventDefault();
      e.currentTarget.classList.remove('drag-over');
      const idx = parseInt(e.currentTarget?.getAttribute('data-idx') || '-1', 10);
      if (Number.isFinite(idx) && idx >= 0) selectIdx(idx);
    };

    if (emailEl && enableDrag) {
      emailEl.addEventListener('dragstart', onDragStart);
      emailEl.addEventListener('dragend', onDragEnd);
    }
    targets.forEach((t) => {
      if (enableDrag) {
        t.addEventListener('dragover', onDragOver);
        t.addEventListener('dragleave', onDragLeave);
        t.addEventListener('drop', onDrop);
      }
    });

    // Help overlay toggle
    const helpOverlay = shell.querySelector('[data-soc-wcst-help="true"]');
    const helpBody = helpOverlay?.querySelector('[data-soc-overlay-body="true"]');
    if (helpBody) helpBody.innerHTML = resolvedHelpHtml;
    const showHelp = () => {
      if (!helpOverlay) return;
      helpOverlay.style.display = 'flex';
    };
    const hideHelp = () => {
      if (!helpOverlay) return;
      helpOverlay.style.display = 'none';
    };
    const helpBtn = shell.querySelector('[data-action="help"]');
    if (helpBtn) helpBtn.addEventListener('click', (e) => { e.preventDefault(); showHelp(); });
    if (helpOverlay) {
      helpOverlay.addEventListener('click', (e) => { e.preventDefault(); hideHelp(); });
      helpOverlay.addEventListener('keydown', (e) => {
        const k = (e.key || '').toString();
        if (k === 'Enter' || k === ' ' || k === 'Escape') {
          e.preventDefault();
          hideHelp();
        }
      });
    }

    // Instructions overlay (preview start gate)
    const instOverlay = shell.querySelector('[data-soc-wcst-instructions="true"]');
    const instBody = instOverlay?.querySelector('[data-soc-overlay-body="true"]');
    if (instBody) instBody.innerHTML = resolvedInstructionsHtml;
    const start = () => {
      try { instOverlay && instOverlay.remove(); } catch { /* ignore */ }
      // Mirror runtime: briefly auto-show help once.
      if (helpEnabled) {
        showHelp();
      }
      try { shell.focus(); } catch { /* ignore */ }
    };
    if (instOverlay) {
      instOverlay.addEventListener('click', start, { once: true });
      instOverlay.addEventListener('keydown', (e) => {
        const k = (e.key || '').toString();
        if (k === 'Enter' || k === ' ') {
          e.preventDefault();
          start();
        }
      });
    } else {
      // If no instructions, still auto-show help once so the overlay is visible in preview.
      if (helpEnabled) {
        showHelp();
      }
    }

    return {
      destroy() {
        try { if (lastTimeout) window.clearTimeout(lastTimeout); } catch { /* ignore */ }
        try { shell.removeEventListener('keydown', onShellKeyDown); } catch { /* ignore */ }
        try {
          targets.forEach(t => {
            t.removeEventListener('click', onTargetClick);
            t.removeEventListener('keydown', onTargetKeyDown);
            t.removeEventListener('dragover', onDragOver);
            t.removeEventListener('dragleave', onDragLeave);
            t.removeEventListener('drop', onDrop);
          });
        } catch { /* ignore */ }
        try {
          if (emailEl) {
            emailEl.removeEventListener('dragstart', onDragStart);
            emailEl.removeEventListener('dragend', onDragEnd);
          }
        } catch { /* ignore */ }
      }
    };
  }

  function render(container, componentData) {
    if (!container) return;
    ensureStyle();
    container.dataset.socDashboardPreviewHost = 'true';

    const sessionTitle = (componentData?.title ?? 'SOC Dashboard').toString();
    const wallpaperUrl = (componentData?.wallpaper_url ?? '').toString().trim();
    const backgroundColor = (componentData?.background_color ?? '').toString().trim();

    const subtasks = normalizeSubtasks(componentData?.subtasks);
    const numTasksRaw = Number(componentData?.num_tasks);
    const fallbackCount = Number.isFinite(numTasksRaw) ? Math.max(1, Math.min(4, Math.floor(numTasksRaw))) : 4;
    const windowsSpec = subtasks.length
      ? subtasks.map((s, idx) => ({
        title: s.title || s.type || `Subtask ${idx + 1}`,
        subtask: s
      }))
      : Array.from({ length: fallbackCount }, (_, i) => ({ title: `Task ${i + 1}`, subtask: null }));

    const root = document.createElement('div');
    root.className = 'soc-preview-shell' + (wallpaperUrl ? ' has-wallpaper' : '');

    const wallpaper = document.createElement('div');
    wallpaper.className = 'soc-preview-wallpaper';
    if (wallpaperUrl) {
      wallpaper.style.backgroundImage = `url(${JSON.stringify(wallpaperUrl).slice(1, -1)})`;
      wallpaper.style.backgroundSize = 'cover';
      wallpaper.style.backgroundPosition = 'center';
    } else if (backgroundColor) {
      wallpaper.style.background = `radial-gradient(1200px 600px at 20% 10%, rgba(61,122,255,0.25), transparent 55%), radial-gradient(900px 500px at 70% 60%, rgba(20,200,160,0.18), transparent 55%), linear-gradient(135deg, ${backgroundColor}, #070b13)`;
    }

    const desktop = document.createElement('div');
    desktop.className = 'soc-preview-desktop-icons';
    const desktopIcons = coerceDesktopIcons(componentData?.desktop_icons);
    let selectedIconIndex = -1;

    function renderDesktopIcons() {
      desktop.innerHTML = '';
      desktopIcons.forEach((ico, idx) => {
        const el = document.createElement('div');
        el.className = 'soc-preview-icon' + (idx === selectedIconIndex ? ' selected' : '');
        el.innerHTML = `
          <div class="ico">${escHtml(ico.icon_text || (ico.label || 'I').slice(0, 2).toUpperCase())}</div>
          <div class="lbl">${escHtml(ico.label || 'Icon')}</div>
        `;
        el.addEventListener('click', () => {
          selectedIconIndex = (selectedIconIndex === idx) ? -1 : idx;
          renderDesktopIcons();
        });
        desktop.appendChild(el);
      });
    }

    const windows = document.createElement('div');
    windows.className = 'soc-preview-windows';
    const cols = (windowsSpec.length <= 2) ? windowsSpec.length : 2;
    windows.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;

    const destroyFns = [];

    windowsSpec.forEach((wSpec) => {
      const w = document.createElement('div');
      w.className = 'soc-preview-appwin';
      w.innerHTML = `
        <div class="titlebar"><div class="ttl">${escHtml(sessionTitle)} · ${escHtml(wSpec.title)}</div></div>
        <div class="content">
          <div class="soc-preview-card" data-soc-subtask-root="true">
            <h4>Subtask window</h4>
            <div class="muted">Preview only (no logging). Configure subtasks in the timeline.</div>
          </div>
        </div>
      `;

      // Replace placeholder content for known subtask types.
      try {
        const subtask = wSpec?.subtask;
        const rootEl = w.querySelector('[data-soc-subtask-root="true"]');
        if (rootEl && subtask && (subtask.type === 'sart-like')) {
          const handle = renderSartLike(rootEl, subtask);
          destroyFns.push(() => handle?.destroy?.());
        }
        if (rootEl && subtask && (subtask.type === 'nback-like')) {
          const handle = renderNbackLike(rootEl, subtask);
          destroyFns.push(() => handle?.destroy?.());
        }
        if (rootEl && subtask && (subtask.type === 'flanker-like')) {
          const handle = renderFlankerLike(rootEl, subtask);
          destroyFns.push(() => handle?.destroy?.());
        }
        if (rootEl && subtask && (subtask.type === 'wcst-like')) {
          const handle = renderWcstLike(rootEl, subtask);
          destroyFns.push(() => handle?.destroy?.());
        }
        if (rootEl && subtask && (subtask.type === 'pvt-like')) {
          const handle = renderPvtLike(rootEl, subtask);
          destroyFns.push(() => handle?.destroy?.());
        }
      } catch {
        // ignore preview errors per-window
      }
      windows.appendChild(w);
    });

    root.appendChild(wallpaper);
    root.appendChild(desktop);
    root.appendChild(windows);

    container.innerHTML = '';
    container.appendChild(root);
    renderDesktopIcons();

    return {
      destroy() {
        try {
          destroyFns.forEach(fn => {
            try { fn(); } catch { /* ignore */ }
          });
        } catch {
          // ignore
        }
        container.innerHTML = '';
      }
    };
  }

  window.SocDashboardPreview = { render };
})();
