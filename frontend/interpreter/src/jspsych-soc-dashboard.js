(function (jspsych) {
  const PT = (jspsych && jspsych.ParameterType)
    || (window.jsPsychModule && window.jsPsychModule.ParameterType)
    || (window.jsPsych && window.jsPsych.ParameterType)
    || {
      BOOL: 'BOOL',
      STRING: 'STRING',
      INT: 'INT',
      FLOAT: 'FLOAT',
      OBJECT: 'OBJECT',
      KEY: 'KEY',
      KEYS: 'KEYS',
      SELECT: 'SELECT',
      HTML_STRING: 'HTML_STRING',
      COMPLEX: 'COMPLEX',
      FUNCTION: 'FUNCTION',
      TIMELINE: 'TIMELINE'
    };

  const info = {
    name: 'soc-dashboard',
    version: '0.6.7',
    parameters: {
      trial_duration_ms: { type: PT.INT, default: 60000 },
      end_key: { type: PT.STRING, default: 'escape' },
      title: { type: PT.STRING, default: 'SOC Dashboard' },
      wallpaper_url: { type: PT.STRING, default: '' },
      background_color: { type: PT.STRING, default: '#0b1220' },
      start_menu_enabled: { type: PT.BOOL, default: true },
      default_app: { type: PT.STRING, default: 'soc' },
      pinned_apps: { type: PT.COMPLEX, default: ['soc', 'email', 'terminal'] },
      num_tasks: { type: PT.INT, default: 1 },
      subtasks: { type: PT.COMPLEX, default: null },
      desktop_icons: { type: PT.COMPLEX, default: null },
      icons_clickable: { type: PT.BOOL, default: true },
      log_icon_clicks: { type: PT.BOOL, default: true },
      icon_clicks_are_distractors: { type: PT.BOOL, default: true }
    },
    data: {
      ended_reason: { type: PT.STRING },
      active_app: { type: PT.STRING },
      events: { type: PT.COMPLEX },
      plugin_version: { type: PT.STRING }
    }
  };

  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function clamp(n, min, max) {
    const x = Number(n);
    if (!Number.isFinite(x)) return min;
    return Math.max(min, Math.min(max, x));
  }

  function parseTokenList(raw) {
    if (Array.isArray(raw)) {
      return raw
        .map(x => (x ?? '').toString().trim())
        .filter(Boolean);
    }
    const text = (raw ?? '').toString();
    return text
      .split(/[\r\n,]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function pickRandom(list) {
    if (!Array.isArray(list) || list.length === 0) return null;
    const idx = Math.floor(Math.random() * list.length);
    return list[idx];
  }

  function randomInt(min, max) {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
  }

  function randomIp() {
    // Use private-ish ranges to avoid looking like real addresses.
    const a = 10;
    const b = randomInt(0, 255);
    const c = randomInt(0, 255);
    const d = randomInt(1, 254);
    return `${a}.${b}.${c}.${d}`;
  }

  function formatClock(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  function normalizeKeyName(raw) {
    const str = (raw ?? '').toString();
    if (str === ' ') return ' ';

    const t = str.trim();
    const lower = t.toLowerCase();
    if (lower === 'space') return ' ';
    if (lower === 'enter') return 'Enter';
    if (lower === 'escape' || lower === 'esc') return 'Escape';
    if (t.length === 1) return t.toLowerCase();
    return t;
  }

  function escHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function getUrlFlag(name) {
    try {
      const params = new URLSearchParams(window.location.search);
      const v = (params.get(name) || '').toString().trim().toLowerCase();
      if (!v) return false;
      if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
      return true;
    } catch {
      return false;
    }
  }

  function makeShellStyle() {
    const style = document.createElement('style');
    style.dataset.socDashboard = 'true';
    style.textContent = `
      .soc-shell { position: relative; width: 100%; height: 100vh; background: #0b1220; color: #e7eefc; overflow: hidden; }
      .soc-wallpaper { position:absolute; inset:0; background: radial-gradient(1200px 600px at 20% 10%, rgba(61,122,255,0.35), transparent 55%), radial-gradient(900px 500px at 70% 60%, rgba(20,200,160,0.25), transparent 55%), linear-gradient(135deg, #0b1220, #070b13); filter: saturate(1.05) contrast(1.02); }
      .soc-shell.has-wallpaper .soc-wallpaper { background-size: cover; background-position: center; }

      .soc-desktop { position:absolute; inset:0; padding: 18px; }
      .soc-desktop-icons { position:absolute; top: 18px; left: 18px; display:flex; flex-direction: column; gap: 10px; z-index: 2; }
      .soc-icon { width: 92px; user-select:none; cursor: default; text-align:center; padding: 6px 6px 10px 6px; border-radius: 10px; }
      .soc-icon.clickable { cursor: pointer; }
      .soc-icon.clickable:hover { background: rgba(255,255,255,0.10); }
      .soc-icon .ico { width: 44px; height: 44px; margin: 0 auto 6px auto; border-radius: 10px; background: rgba(255,255,255,0.10); border: 1px solid rgba(255,255,255,0.16); display:flex; align-items:center; justify-content:center; font-weight: 700; }
      .soc-icon .lbl { font-size: 12px; opacity: 0.95; text-shadow: 0 1px 2px rgba(0,0,0,0.4); }

      .soc-windows { position:absolute; top: 18px; right: 18px; bottom: 18px; left: 140px; display:grid; gap: 12px; grid-auto-rows: 1fr; z-index: 3; }
      .soc-appwin { position: relative; background: rgba(12,16,26,0.88); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; box-shadow: 0 18px 55px rgba(0,0,0,0.50); overflow:hidden; min-height: 0; }
      /* Keep grid position stable when windows hide/show */
      .soc-appwin.soc-win-hidden { visibility: hidden; pointer-events: none; }
      .soc-appwin .titlebar { height: 38px; display:flex; align-items:center; gap: 10px; padding: 0 12px; background: rgba(255,255,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.10); }
      .soc-appwin .titlebar .ttl { font-weight: 600; font-size: 13px; }
      .soc-appwin .titlebar .soc-title-debug { margin-left: auto; font-size: 11px; opacity: 0.85; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
      .soc-appwin .content { padding: 12px; height: calc(100% - 38px); overflow:auto; }

      .soc-card { border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.05); border-radius: 12px; padding: 12px; }
      .soc-card h4 { margin:0 0 6px 0; font-size: 13px; }
      .soc-card .muted { opacity: 0.8; font-size: 12px; }
      .soc-table { width:100%; border-collapse: collapse; font-size: 12px; }
      .soc-table th, .soc-table td { border-bottom: 1px solid rgba(255,255,255,0.08); padding: 6px 6px; text-align:left; }
      .soc-pill { display:inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.06); }
      .soc-pill.high { background: rgba(255,70,70,0.16); border-color: rgba(255,70,70,0.45); }
      .soc-pill.med { background: rgba(255,190,61,0.16); border-color: rgba(255,190,61,0.45); }
      .soc-pill.low { background: rgba(61,214,255,0.14); border-color: rgba(61,214,255,0.40); }

      .soc-log-header { display:flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
      .soc-log-header .hint { font-size: 12px; opacity: 0.85; }
      .soc-log-feed { width:100%; border-collapse: collapse; font-size: 12px; }
      .soc-log-feed th, .soc-log-feed td { border-bottom: 1px solid rgba(255,255,255,0.08); padding: 6px 6px; text-align:left; }
      .soc-log-feed tbody tr { transition: background 120ms ease; }
      .soc-log-feed tbody tr.target { background: rgba(255, 77, 77, 0.12); }
      .soc-log-feed tbody tr.distractor { background: rgba(61, 214, 255, 0.10); }
      .soc-log-feed tbody tr.current { box-shadow: inset 0 0 0 2px rgba(250,204,21,0.55); }
      .soc-log-feed tbody tr.responded { opacity: 0.78; }
      .soc-log-feed tbody tr:hover { background: rgba(255,255,255,0.06); }
      .soc-log-feed tbody tr.clickable { cursor: pointer; }
      .soc-log-tag { display:inline-block; font-size: 10px; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); }
      .soc-log-go-btn { font-size: 11px; padding: 4px 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.08); color: #fff; cursor: pointer; }
      .soc-log-go-btn:hover { background: rgba(255,255,255,0.12); }
      .soc-log-go-btn:disabled { opacity: 0.5; cursor: default; }

      /* Per-subtask instructions overlay */
      .soc-card.soc-subtask-wrap { position: relative; }
      .soc-subtask-overlay { position: absolute; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(2,6,23,0.72); backdrop-filter: blur(6px); }
      .soc-subtask-overlay .panel { max-width: 620px; width: 100%; border-radius: 14px; border: 1px solid rgba(255,255,255,0.14); background: rgba(12,16,26,0.92); box-shadow: 0 20px 70px rgba(0,0,0,0.60); padding: 14px 14px; cursor: pointer; }
      .soc-subtask-overlay .panel h3 { margin: 0 0 8px 0; font-size: 14px; }
      .soc-subtask-overlay .panel .body { font-size: 12px; opacity: 0.95; line-height: 1.45; }
      .soc-subtask-overlay .panel .hint { margin-top: 10px; font-size: 12px; opacity: 0.80; }

      /* PVT-like (alert vigilance) */
      .soc-pvt-shell { display:flex; flex-direction: column; gap: 10px; }
      .soc-pvt-status { font-size: 12px; opacity: 0.85; }
      .soc-pvt-logwrap { border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; overflow: hidden; background: rgba(0,0,0,0.16); }
      .soc-pvt-log { width:100%; border-collapse: collapse; font-size: 12px; }
      .soc-pvt-log th { text-align:left; font-weight: 650; font-size: 11px; opacity: 0.9; background: rgba(255,255,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.10); padding: 7px 8px; }
      .soc-pvt-log td { border-bottom: 1px solid rgba(255,255,255,0.06); padding: 7px 8px; vertical-align: top; }
      .soc-pvt-log tr:last-child td { border-bottom: none; }
      .soc-pvt-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }

      .soc-pvt-alert-overlay { position: absolute; inset: 0; z-index: 56; display:none; align-items:center; justify-content:center; padding: 16px; background: rgba(2,6,23,0.62); backdrop-filter: blur(4px); }
      .soc-pvt-alert-overlay.show { display:flex; }
      .soc-pvt-alert-overlay .panel { position: relative; max-width: 520px; width: 100%; border-radius: 16px; border: 1px solid rgba(255,255,255,0.16); background: rgba(12,16,26,0.94); box-shadow: 0 20px 70px rgba(0,0,0,0.62); padding: 16px; }
      .soc-pvt-alert-overlay .kicker { font-size: 12px; opacity: 0.85; }
      .soc-pvt-alert-overlay .count { margin-top: 10px; font-size: 56px; font-weight: 800; letter-spacing: -0.5px; }
      .soc-pvt-alert-overlay .hint { margin-top: 10px; font-size: 12px; opacity: 0.85; }
      .soc-pvt-flash { position:absolute; inset:0; border-radius: 16px; background: rgba(239,68,68,0.25); box-shadow: inset 0 0 0 1px rgba(239,68,68,0.25); display:block; opacity: 0; transition: opacity 60ms linear; pointer-events: none; }
      .soc-pvt-flash.show { opacity: 1; }

      /* Inline instructions (for scheduled subtasks: non-blocking) */
      .soc-inline-instructions { margin: 0 0 10px; padding: 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.04); }
      .soc-inline-instructions summary { cursor: pointer; font-size: 12px; opacity: 0.9; }
      .soc-inline-instructions .body { margin-top: 8px; font-size: 12px; opacity: 0.95; line-height: 1.45; }

      /* N-back-like (alert correlation) */
      .soc-nback-header { display:flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
      .soc-nback-header .hint { font-size: 12px; opacity: 0.85; }
      .soc-nback-card { border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.05); border-radius: 12px; padding: 12px; }
      .soc-nback-card .top { display:flex; justify-content: space-between; gap: 10px; align-items: baseline; }
      .soc-nback-grid { margin-top: 10px; display:grid; grid-template-columns: 140px 1fr; gap: 6px 12px; font-size: 12px; }
      .soc-nback-k { opacity: 0.78; }
      .soc-nback-v b { font-weight: 650; }
      .soc-nback-pill { display:inline-block; font-size: 10px; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); }
      .soc-nback-flash { animation: socFlash 220ms ease-out; }
      @keyframes socFlash { from { box-shadow: 0 0 0 0 rgba(14,165,233,0.35); } to { box-shadow: 0 0 0 10px rgba(14,165,233,0.0); } }

      /* WCST-like (email sorting) */
      .soc-wcst-header { display:flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
      .soc-wcst-header .hint { font-size: 12px; opacity: 0.85; }
      .soc-wcst-header .actions { display:flex; align-items:center; gap: 8px; }
      .soc-wcst-help-btn { font-size: 11px; padding: 4px 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.08); color: #fff; cursor: pointer; }
      .soc-wcst-help-btn:hover { background: rgba(255,255,255,0.12); }
      .soc-wcst-shell { display: grid; grid-template-columns: 1fr; gap: 10px; }
      .soc-wcst-email { border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.05); border-radius: 12px; padding: 12px; }
      .soc-wcst-email .top { display:flex; justify-content: space-between; gap: 10px; align-items: baseline; }
      .soc-wcst-email .from { font-size: 12px; }
      .soc-wcst-email .subj { margin-top: 8px; font-size: 12px; }
      .soc-wcst-email .prev { margin-top: 6px; font-size: 12px; }
      .soc-wcst-email .meta { margin-top: 10px; display:flex; gap: 6px; flex-wrap: wrap; }
      .soc-wcst-pill { display:inline-block; font-size: 10px; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); }
      .soc-wcst-targets { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .soc-wcst-target { text-align:left; padding: 10px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); color: inherit; cursor: pointer; }
      .soc-wcst-target:hover { background: rgba(255,255,255,0.07); }
      .soc-wcst-target.selected { box-shadow: inset 0 0 0 2px rgba(250,204,21,0.55); }
      .soc-wcst-target.correct { box-shadow: inset 0 0 0 2px rgba(34,197,94,0.55); }
      .soc-wcst-target.incorrect { box-shadow: inset 0 0 0 2px rgba(239,68,68,0.55); }
      .soc-wcst-target-top { display:flex; justify-content: space-between; gap: 10px; align-items: baseline; margin-bottom: 8px; }
      .soc-wcst-kv { display:grid; grid-template-columns: 90px 1fr; gap: 6px 10px; font-size: 12px; }
      .soc-wcst-kv .k { opacity: 0.78; }
      .soc-wcst-footer { font-size: 12px; }

      .soc-wcst-help-overlay { position: absolute; inset: 0; z-index: 55; display: none; align-items: center; justify-content: center; padding: 16px; background: rgba(2,6,23,0.72); backdrop-filter: blur(6px); }
      .soc-wcst-help-overlay.show { display: flex; }
      .soc-wcst-help-overlay .panel { max-width: 720px; width: 100%; border-radius: 14px; border: 1px solid rgba(255,255,255,0.14); background: rgba(12,16,26,0.94); box-shadow: 0 20px 70px rgba(0,0,0,0.60); padding: 14px; cursor: pointer; }
      .soc-wcst-help-overlay .panel h3 { margin: 0 0 8px 0; font-size: 14px; }
      .soc-wcst-help-overlay .panel .body { font-size: 12px; opacity: 0.95; line-height: 1.45; }
      .soc-wcst-help-overlay .panel .hint { margin-top: 10px; font-size: 12px; opacity: 0.80; }
    `;
    return style;
  }

  function defaultDesktopIcons() {
    return [
      { label: 'Documents', app: 'docs', icon_text: 'DOC', distractor: true },
      { label: 'My File', app: 'file', icon_text: 'FILE', distractor: true },
      { label: 'Recycle Bin', app: 'bin', icon_text: 'BIN', distractor: true }
    ];
  }

  function coerceDesktopIcons(raw) {
    if (!Array.isArray(raw)) return defaultDesktopIcons();
    const icons = raw
      .filter(x => x && typeof x === 'object')
      .map((x) => ({
        label: (x.label ?? x.name ?? 'Icon').toString(),
        app: (x.app ?? '').toString(),
        icon_text: (x.icon_text ?? '').toString(),
        distractor: (x.distractor !== undefined) ? !!x.distractor : true
      }));
    return icons.length ? icons : defaultDesktopIcons();
  }

  function makeTaskRows(taskIndex) {
    const rows = [];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const sev = (i % 3 === 0) ? 'high' : (i % 3 === 1 ? 'med' : 'low');
      rows.push({
        id: `EV-${taskIndex + 1}-${String(i + 1).padStart(2, '0')}`,
        service: (i % 2 === 0) ? 'Auth' : 'Payments',
        msg: (i % 2 === 0) ? 'Login spike detected' : 'Latency above threshold',
        sev
      });
    }
    return rows;
  }

  function JsPsychSocDashboardPlugin(jsPsych) {
    this.jsPsych = jsPsych;
  }

  JsPsychSocDashboardPlugin.prototype.trial = function (display_element, trial) {
    const startTs = nowMs();
    const events = [];

    // Optional live debug UI. Enabled by either `?soc_debug=1` or existing `?debug=1`.
    const socDebugEnabled = getUrlFlag('soc_debug') || getUrlFlag('debug');

    const trialMs = Number.isFinite(Number(trial.trial_duration_ms)) ? Number(trial.trial_duration_ms) : null;
    const endKey = normalizeKeyName(trial.end_key ?? 'escape');
    const title = (trial.title ?? 'SOC Dashboard').toString();

    const numTasksRaw = Number(trial.num_tasks);
    const fallbackCount = Number.isFinite(numTasksRaw) ? Math.max(1, Math.min(4, Math.floor(numTasksRaw))) : 1;

    const rawSubtasks = Array.isArray(trial.subtasks) ? trial.subtasks : [];
    const subtasks = rawSubtasks
      .filter(x => x && typeof x === 'object')
      .map((x) => {
        const copy = { ...x };
        copy.type = (x.type ?? x.kind ?? '').toString();
        copy.title = (x.title ?? x.name ?? '').toString();
        return copy;
      })
      .filter(x => x.title || x.type);

    function coerceSchedule(rawSubtask) {
      const o = (rawSubtask && typeof rawSubtask === 'object') ? rawSubtask : {};

      const startAtRaw = Number(o.start_at_ms);
      const startDelayRaw = Number(o.start_delay_ms);
      const durationRaw = Number(o.duration_ms);
      const endAtRaw = Number(o.end_at_ms);

      const hasSchedule = (
        (Number.isFinite(startAtRaw) && startAtRaw > 0)
        || (Number.isFinite(startDelayRaw) && startDelayRaw > 0)
        || (Number.isFinite(durationRaw) && durationRaw > 0)
        || (Number.isFinite(endAtRaw) && endAtRaw > 0)
      );

      if (!hasSchedule) {
        return { has_schedule: false, start_at_ms: 0, end_at_ms: null };
      }

      let startAt = startAtRaw;
      if (!Number.isFinite(startAt)) startAt = startDelayRaw;
      startAt = Number.isFinite(startAt) ? Math.max(0, Math.floor(startAt)) : 0;

      const duration = durationRaw;
      let endAt = endAtRaw;

      if (Number.isFinite(duration) && duration > 0) {
        const dur = Math.max(1, Math.floor(duration));
        endAt = startAt + dur;
      } else if (Number.isFinite(endAt) && endAt > 0) {
        endAt = Math.max(1, Math.floor(endAt));
      } else {
        endAt = null;
      }

      if (Number.isFinite(endAt) && endAt < startAt) {
        endAt = startAt;
      }

      return { has_schedule: true, start_at_ms: startAt, end_at_ms: Number.isFinite(endAt) ? endAt : null };
    }

    const windowsSpec = subtasks.length
      ? subtasks.map((s, idx) => ({
          subtask_type: s.type || null,
          subtask_title: s.title || (s.type ? s.type : `Subtask ${idx + 1}`),
          subtask: s,
          schedule: coerceSchedule(s)
        }))
      : Array.from({ length: fallbackCount }, (_, i) => ({
          subtask_type: null,
          subtask_title: `Task ${i + 1}`,
          subtask: null,
          schedule: { has_schedule: false, start_at_ms: 0, end_at_ms: null }
        }));

    // Auto-sequencing fallback:
    // If the researcher requested multiple tasks (num_tasks > 1) but provided no explicit
    // per-subtask scheduling fields, default to showing exactly one window at a time.
    // This preserves the explicit scheduling/overlap demo behavior when any schedule exists.
    const hasAnySchedule = windowsSpec.some((w) => (w?.schedule?.has_schedule === true));
    if (!hasAnySchedule && fallbackCount > 1 && Number.isFinite(trialMs) && trialMs > 0 && windowsSpec.length > 1) {
      const n = windowsSpec.length;
      for (let i = 0; i < n; i++) {
        const startAt = Math.floor((trialMs * i) / n);
        let endAt = Math.floor((trialMs * (i + 1)) / n);
        if (i === n - 1) endAt = Math.floor(trialMs);
        if (endAt < startAt) endAt = startAt;
        windowsSpec[i].schedule = { has_schedule: true, start_at_ms: startAt, end_at_ms: endAt };
      }
    }

    const subtaskStartTs = new Array(windowsSpec.length).fill(null);
    const markGenericSubtaskStart = (idx) => {
      if (!Number.isFinite(idx) || idx < 0 || idx >= windowsSpec.length) return;
      if (subtaskStartTs[idx] !== null) return;
      subtaskStartTs[idx] = nowMs();
      const wSpec = windowsSpec[idx] || {};
      events.push({
        t_ms: Math.round(nowMs() - startTs),
        type: 'subtask_start',
        subtask_index: idx,
        subtask_title: (wSpec.subtask_title ?? '').toString() || null,
        subtask_type: (wSpec.subtask_type ?? '').toString() || null
      });
    };

    const installInstructionsOverlay = (hostEl, overlayTitle, instructionsHtml, onStart) => {
      const raw = (instructionsHtml ?? '').toString();
      const html = raw.trim();
      if (!html) {
        try { onStart?.(); } catch { /* ignore */ }
        return null;
      }

      const overlay = document.createElement('div');
      overlay.className = 'soc-subtask-overlay';
      overlay.innerHTML = `
        <div class="panel" role="button" tabindex="0" aria-label="Subtask instructions">
          <h3>${escHtml(overlayTitle || 'Instructions')}</h3>
          <div class="body" data-soc-overlay-body="true"></div>
          <div class="hint">Click this popup to begin.</div>
        </div>
      `;

      const body = overlay.querySelector('[data-soc-overlay-body="true"]');
      if (body) {
        // Treat as trusted experiment-authored HTML.
        body.innerHTML = raw;
      }

      const startOnce = () => {
        try { overlay.remove(); } catch { /* ignore */ }
        try { onStart?.(); } catch { /* ignore */ }
      };

      overlay.addEventListener('click', startOnce, { once: true });
      overlay.addEventListener('keydown', (e) => {
        const k = normalizeKeyName(e.key);
        if (k === 'Enter' || k === ' ') {
          e.preventDefault();
          startOnce();
        }
      });

      hostEl.appendChild(overlay);
      return overlay;
    };

    const renderInlineInstructions = (hostEl, overlayTitle, instructionsHtml) => {
      const raw = (instructionsHtml ?? '').toString();
      const html = raw.trim();
      if (!html) return null;

      const details = document.createElement('details');
      details.className = 'soc-inline-instructions';
      details.open = false;
      details.innerHTML = `
        <summary>${escHtml(overlayTitle || 'Instructions')}</summary>
        <div class="body" data-soc-inline-body="true"></div>
      `;

      const body = details.querySelector('[data-soc-inline-body="true"]');
      if (body) {
        // Treat as trusted experiment-authored HTML.
        body.innerHTML = raw;
      }

      try {
        hostEl.insertAdjacentElement('afterbegin', details);
      } catch {
        try { hostEl.prepend(details); } catch { /* ignore */ }
      }
      return details;
    };

    const substitutePlaceholders = (html, map) => {
      let out = (html ?? '').toString();
      for (const [k, v] of Object.entries(map || {})) {
        const safe = escHtml((v ?? '').toString());
        out = out.replaceAll(`{{${k}}}`, safe);
        out = out.replaceAll(`{{${k.toLowerCase()}}}`, safe);
      }
      return out;
    };

    const cols = (windowsSpec.length <= 2) ? windowsSpec.length : 2;

    const logIconClicks = (trial.log_icon_clicks !== undefined) ? !!trial.log_icon_clicks : true;
    const iconsClickable = (trial.icons_clickable !== undefined) ? !!trial.icons_clickable : true;

    let ended = false;
    let activeWindowIndex = 0;

    const scheduledTimeouts = [];
    const scheduledIntervals = [];

    const setSafeTimeout = (fn, ms) => {
      const id = setTimeout(fn, ms);
      scheduledTimeouts.push(id);
      return id;
    };

    const clearAllTimers = () => {
      for (const id of scheduledTimeouts) {
        try { clearTimeout(id); } catch { /* ignore */ }
      }
      for (const id of scheduledIntervals) {
        try { clearInterval(id); } catch { /* ignore */ }
      }
      scheduledTimeouts.length = 0;
      scheduledIntervals.length = 0;
    };

    const windowEls = new Array(windowsSpec.length).fill(null);
    const windowDebugEls = new Array(windowsSpec.length).fill(null);
    const subtaskAutoStart = new Array(windowsSpec.length).fill(null);
    const subtaskForceEnd = new Array(windowsSpec.length).fill(null);
    const windowHasStarted = new Array(windowsSpec.length).fill(false);

    const flankerStates = new Array(windowsSpec.length).fill(null);
    const wcstStates = new Array(windowsSpec.length).fill(null);
    const pvtLikeStates = new Array(windowsSpec.length).fill(null);

    // Per-window instruction popup (click-to-start)
    const windowInstructionsHost = new Array(windowsSpec.length).fill(null);
    const windowInstructionsTitle = new Array(windowsSpec.length).fill(null);
    const windowInstructionsHtml = new Array(windowsSpec.length).fill('');
    const windowInstructionsOverlay = new Array(windowsSpec.length).fill(null);
    const windowStartIsGated = new Array(windowsSpec.length).fill(false);

    const isWindowVisible = (idx) => {
      const el = windowEls[idx];
      if (!el) return false;
      return !el.classList.contains('soc-win-hidden');
    };

    const pickFirstVisibleKeyboardWindow = () => {
      for (let i = 0; i < windowsSpec.length; i++) {
        if (!isWindowVisible(i)) continue;
        const t = (windowsSpec[i]?.subtask_type ?? '').toString().toLowerCase();
        if (t === 'sart-like' || t === 'nback-like' || t === 'flanker-like' || t === 'wcst-like' || t === 'pvt-like') return i;
      }
      for (let i = 0; i < windowsSpec.length; i++) {
        if (isWindowVisible(i)) return i;
      }
      return 0;
    };

    const ensureActiveWindowVisible = () => {
      if (Number.isFinite(activeWindowIndex) && activeWindowIndex >= 0 && activeWindowIndex < windowsSpec.length && isWindowVisible(activeWindowIndex)) {
        return;
      }
      activeWindowIndex = pickFirstVisibleKeyboardWindow();
    };

    const showWindow = (idx) => {
      const el = windowEls[idx];
      if (!el) return;
      const wasHidden = el.classList.contains('soc-win-hidden');
      if (wasHidden) {
        el.classList.remove('soc-win-hidden');
        events.push({
          t_ms: Math.round(nowMs() - startTs),
          type: 'subtask_window_show',
          subtask_index: idx,
          subtask_title: (windowsSpec[idx]?.subtask_title ?? '').toString() || null,
          subtask_type: (windowsSpec[idx]?.subtask_type ?? '').toString() || null
        });
      }
      activeWindowIndex = idx;
      // If this window has instructions, install the popup when the window becomes visible.
      maybeInstallWindowInstructions(idx);
    };

    const hideWindow = (idx) => {
      const el = windowEls[idx];
      if (!el) return;
      if (el.classList.contains('soc-win-hidden')) return;
      el.classList.add('soc-win-hidden');
      events.push({
        t_ms: Math.round(nowMs() - startTs),
        type: 'subtask_window_hide',
        subtask_index: idx,
        subtask_title: (windowsSpec[idx]?.subtask_title ?? '').toString() || null,
        subtask_type: (windowsSpec[idx]?.subtask_type ?? '').toString() || null
      });
      if (activeWindowIndex === idx) {
        ensureActiveWindowVisible();
      }
    };

    const startWindowIfNeeded = (idx) => {
      if (windowHasStarted[idx]) return;
      windowHasStarted[idx] = true;
      try { subtaskAutoStart[idx]?.(); } catch { /* ignore */ }
      ensureActiveWindowVisible();
    };

    const maybeInstallWindowInstructions = (idx) => {
      if (!Number.isFinite(idx) || idx < 0 || idx >= windowsSpec.length) return;
      if (windowHasStarted[idx]) return;
      if (windowInstructionsOverlay[idx]) return;

      const hostEl = windowInstructionsHost[idx];
      if (!hostEl) return;
      if (!isWindowVisible(idx)) return;

      const raw = (windowInstructionsHtml[idx] ?? '').toString();
      const html = raw.trim();

      if (!html) {
        windowStartIsGated[idx] = false;
        // No instructions => start immediately when the window becomes visible.
        startWindowIfNeeded(idx);
        return;
      }

      const titleRaw = (windowInstructionsTitle[idx] ?? windowsSpec[idx]?.subtask_title ?? 'Instructions').toString();
      const overlay = installInstructionsOverlay(hostEl, titleRaw, raw, () => startWindowIfNeeded(idx));
      windowInstructionsOverlay[idx] = overlay;
      windowStartIsGated[idx] = !!overlay;
    };

    const forceEndWindow = (idx, reason = 'scheduled_end') => {
      try { subtaskForceEnd[idx]?.(reason); } catch { /* ignore */ }
    };

    const coerceSartLikeConfig = (raw) => {
      const o = (raw && typeof raw === 'object') ? raw : {};
      let minRun = Number(o.min_run_ms);
      let maxRun = Number(o.max_run_ms);
      minRun = Number.isFinite(minRun) ? Math.max(0, Math.floor(minRun)) : 30000;
      maxRun = Number.isFinite(maxRun) ? Math.max(0, Math.floor(maxRun)) : 60000;
      if (minRun > 0 && maxRun > 0 && maxRun < minRun) {
        const tmp = minRun;
        minRun = maxRun;
        maxRun = tmp;
      }

      const visibleEntries = clamp(o.visible_entries, 3, 25);
      const scrollInterval = clamp(o.scroll_interval_ms, 100, 10000);
      const responseDevice = ((o.response_device ?? 'keyboard').toString().trim().toLowerCase() === 'mouse') ? 'mouse' : 'keyboard';
      const goKey = normalizeKeyName(o.go_key ?? 'space');
      const goButton = ((o.go_button ?? 'action').toString().trim().toLowerCase() === 'change') ? 'change' : 'action';
      const goCondition = ((o.go_condition ?? 'target').toString().trim().toLowerCase() === 'distractor') ? 'distractor' : 'target';

      const showMarkers = (o.show_markers !== undefined) ? !!o.show_markers : false;

      const highlight = (o.highlight_subdomains !== undefined) ? !!o.highlight_subdomains : true;
      const targetColor = (o.target_highlight_color ?? '#ff4d4d').toString();
      const distractorColor = (o.distractor_highlight_color ?? '#3dd6ff').toString();

      const targetList = parseTokenList(o.target_subdomains);
      const distractorList = parseTokenList(o.distractor_subdomains);
      const neutralList = parseTokenList(o.neutral_subdomains);

      const targetProb = clamp(o.target_probability, 0, 1);
      const distractorProb = clamp(o.distractor_probability, 0, 1);

      return {
        visible_entries: visibleEntries,
        scroll_interval_ms: scrollInterval,
        min_run_ms: minRun,
        max_run_ms: maxRun,
        response_device: responseDevice,
        go_key: goKey,
        go_button: goButton,
        go_condition: goCondition,
        show_markers: showMarkers,
        highlight_subdomains: highlight,
        target_highlight_color: targetColor,
        distractor_highlight_color: distractorColor,
        target_subdomains: targetList,
        distractor_subdomains: distractorList,
        neutral_subdomains: neutralList,
        target_probability: targetProb,
        distractor_probability: distractorProb
      };
    };

    const sartStates = [];
    const nbackStates = [];

    const styleEl = makeShellStyle();
    display_element.innerHTML = '';
    display_element.appendChild(styleEl);

    const shell = document.createElement('div');
    shell.className = 'soc-shell';

    const wallpaper = document.createElement('div');
    wallpaper.className = 'soc-wallpaper';
    const wallpaperUrl = (trial.wallpaper_url ?? '').toString().trim();
    if (wallpaperUrl) {
      shell.classList.add('has-wallpaper');
      wallpaper.style.backgroundImage = `url(${JSON.stringify(wallpaperUrl).slice(1, -1)})`;
      wallpaper.style.backgroundSize = 'cover';
      wallpaper.style.backgroundPosition = 'center';
    } else {
      const bg = (trial.background_color ?? '').toString().trim();
      if (bg) {
        wallpaper.style.background = `radial-gradient(1200px 600px at 20% 10%, rgba(61,122,255,0.25), transparent 55%), radial-gradient(900px 500px at 70% 60%, rgba(20,200,160,0.18), transparent 55%), linear-gradient(135deg, ${bg}, #070b13)`;
      }
    }

    const desktop = document.createElement('div');
    desktop.className = 'soc-desktop';

    const iconsHost = document.createElement('div');
    iconsHost.className = 'soc-desktop-icons';
    const desktopIcons = coerceDesktopIcons(trial.desktop_icons);
    iconsHost.innerHTML = desktopIcons.map((ico) => {
      const label = escHtml(ico.label);
      const app = escHtml(ico.app);
      const iconText = escHtml(ico.icon_text || (ico.label || 'I').slice(0, 2).toUpperCase());
      const cls = `soc-icon${iconsClickable ? ' clickable' : ''}`;
      return `
        <div class="${cls}" data-label="${label}" data-app="${app}" role="button" tabindex="0">
          <div class="ico">${iconText}</div>
          <div class="lbl">${label}</div>
        </div>
      `;
    }).join('');

    const windows = document.createElement('div');
    windows.className = 'soc-windows';
    windows.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;

    for (let i = 0; i < windowsSpec.length; i++) {
      const wSpec = windowsSpec[i];
      const w = document.createElement('div');
      w.className = 'soc-appwin';

      windowEls[i] = w;
      const schedule = wSpec.schedule || { has_schedule: false, start_at_ms: 0, end_at_ms: null };
      if (schedule.has_schedule && Number(schedule.start_at_ms) > 0) {
        w.classList.add('soc-win-hidden');
      }

      const isSartLike = (wSpec.subtask_type || '').toString().toLowerCase() === 'sart-like';
      const isNbackLike = (wSpec.subtask_type || '').toString().toLowerCase() === 'nback-like';
      const isFlankerLike = (wSpec.subtask_type || '').toString().toLowerCase() === 'flanker-like';
      const isWcstLike = (wSpec.subtask_type || '').toString().toLowerCase() === 'wcst-like';
      const isPvtLike = (wSpec.subtask_type || '').toString().toLowerCase() === 'pvt-like';
      const winId = `soc_win_${i}`;

      const dbgHtml = socDebugEnabled
        ? `<div class="soc-title-debug" id="soc_dbg_${i}">DBG</div>`
        : '';

      w.innerHTML = `
        <div class="titlebar"><div class="ttl">${escHtml(title)} · ${escHtml(wSpec.subtask_title)}</div>${dbgHtml}</div>
        <div class="content">
          <div class="soc-card" id="${escHtml(winId)}"></div>
        </div>
      `;
      windows.appendChild(w);

      if (socDebugEnabled) {
        windowDebugEls[i] = w.querySelector(`#soc_dbg_${i}`);
      }

      // Initialize subtask content
      const host = w.querySelector(`#${winId}`);
      if (!host) continue;

      host.classList.add('soc-subtask-wrap');

      const subtaskInstructions = (wSpec?.subtask?.instructions ?? '').toString();
      const subtaskInstructionsTitleRaw = (wSpec?.subtask?.instructions_title ?? '').toString();
      const subtaskInstructionsTitle = subtaskInstructionsTitleRaw.trim() ? subtaskInstructionsTitleRaw : null;

      if (isWcstLike) {
        const coerceWcstLikeConfig = (raw) => {
          const o = (raw && typeof raw === 'object') ? raw : {};

          const parseList = (x) => {
            if (x === null || x === undefined) return [];
            return String(x)
              .split(/[\n,]+/g)
              .map(s => s.trim())
              .filter(Boolean);
          };

          const coerceFour = (x, defaults) => {
            const out = parseList(x);
            const d = Array.isArray(defaults) ? defaults : [];
            const arr = out.length ? out : d.slice();
            const trimmed = arr.slice(0, 4);
            while (trimmed.length < 4) trimmed.push(d[trimmed.length] ?? `value${trimmed.length + 1}`);
            return trimmed;
          };

          const parseLines = (x) => {
            if (x === null || x === undefined) return [];
            const s = String(x);
            const lines = s.split(/\r?\n/g).map(v => v.trim()).filter(Boolean);
            if (lines.length >= 1) return lines;
            return parseList(s);
          };

          const responseDevice = ((o.response_device ?? 'keyboard').toString().trim().toLowerCase() === 'mouse') ? 'mouse' : 'keyboard';

          const mouseMode = ((o.mouse_response_mode ?? o.mouse_mode ?? 'click').toString().trim().toLowerCase() === 'drag') ? 'drag' : 'click';

          const keysRaw = (o.choice_keys ?? o.response_keys ?? '1,2,3,4').toString();
          const choiceKeys = keysRaw
            .split(',')
            .map(s => normalizeKeyName(s))
            .filter(Boolean)
            .slice(0, 4);
          while (choiceKeys.length < 4) choiceKeys.push(normalizeKeyName(String(choiceKeys.length + 1)));

          const numTrialsRaw = Number(o.num_trials);
          const numTrials = Number.isFinite(numTrialsRaw) ? Math.max(0, Math.min(5000, Math.floor(numTrialsRaw))) : 24;

          const responseWindowMs = clamp(o.response_window_ms, 200, 20000);
          const itiMs = clamp(o.iti_ms ?? o.trial_interval_ms, 0, 20000);
          const feedbackMs = clamp(o.feedback_ms, 0, 5000);
          const showFeedback = (o.show_feedback !== undefined) ? !!o.show_feedback : true;

          const streakRaw = Number(o.rule_change_correct_streak ?? o.rule_change_after_correct ?? 8);
          const correctStreakToChange = Number.isFinite(streakRaw) ? Math.max(1, Math.min(50, Math.floor(streakRaw))) : 8;

          const rulesRaw = (o.rule_sequence ?? o.rules ?? 'sender_domain,subject_tone,link_style,attachment_type').toString();
          const rules = rulesRaw
            .split(/[\n,]+/g)
            .map(s => s.trim().toLowerCase())
            .filter(Boolean)
            .map((r) => {
              if (r === 'sender' || r === 'sender_domain' || r === 'domain') return 'sender_domain';
              if (r === 'subject' || r === 'subject_tone' || r === 'tone') return 'subject_tone';
              if (r === 'link' || r === 'link_style') return 'link_style';
              if (r === 'attachment' || r === 'attachment_type') return 'attachment_type';
              return r;
            })
            .filter(r => r === 'sender_domain' || r === 'subject_tone' || r === 'link_style' || r === 'attachment_type');

          const uniqueRules = Array.from(new Set(rules));
          const finalRules = uniqueRules.length ? uniqueRules : ['sender_domain', 'subject_tone', 'link_style', 'attachment_type'];

          let minRun = Number(o.min_run_ms);
          let maxRun = Number(o.max_run_ms);
          minRun = Number.isFinite(minRun) ? Math.max(0, Math.floor(minRun)) : 0;
          maxRun = Number.isFinite(maxRun) ? Math.max(0, Math.floor(maxRun)) : 0;
          if (minRun > 0 && maxRun > 0 && maxRun < minRun) {
            const tmp = minRun;
            minRun = maxRun;
            maxRun = tmp;
          }

          const defaultDomains = ['corp.test', 'vendor.test', 'typo.test', 'ip.test'];
          const senderDomains = coerceFour(o.sender_domains ?? o.sender_domain_examples ?? o.domains, defaultDomains);
          const senderNames = coerceFour(o.sender_display_names ?? o.sender_names, ['Operations', 'IT Vendor', 'Support Desk', 'Automated Notice']);

          const subjectNeutral = parseLines(o.subject_lines_neutral) || [];
          const subjectUrgent = parseLines(o.subject_lines_urgent) || [];
          const subjectReward = parseLines(o.subject_lines_reward) || [];
          const subjectThreat = parseLines(o.subject_lines_threat) || [];

          const previewNeutral = parseLines(o.preview_lines_neutral) || [];
          const previewUrgent = parseLines(o.preview_lines_urgent) || [];
          const previewReward = parseLines(o.preview_lines_reward) || [];
          const previewThreat = parseLines(o.preview_lines_threat) || [];

          const linkTextVisible = (o.link_text_visible ?? 'portal.corp.test').toString();
          const linkTextShort = (o.link_text_shortened ?? 'short.test/abc').toString();
          const linkTextMismatch = (o.link_text_mismatch ?? 'portal.corp.test').toString();

          const linkHrefVisible = (o.link_href_visible ?? 'https://portal.corp.test/').toString();
          const linkHrefShort = (o.link_href_shortened ?? 'https://short.test/abc').toString();
          const linkHrefMismatch = (o.link_href_mismatch ?? 'https://vendor.test/portal').toString();

          const attachmentPdf = (o.attachment_label_pdf ?? 'report.pdf').toString();
          const attachmentDocm = (o.attachment_label_docm ?? 'invoice.docm').toString();
          const attachmentZip = (o.attachment_label_zip ?? 'archive.zip').toString();

          const helpEnabled = (o.help_overlay_enabled !== undefined) ? !!o.help_overlay_enabled : true;
          const helpTitle = (o.help_overlay_title ?? 'Quick help').toString();
          const helpHtml = (o.help_overlay_html ?? '').toString();

          return {
            response_device: responseDevice,
            mouse_response_mode: mouseMode,
            choice_keys: choiceKeys,
            num_trials: numTrials,
            response_window_ms: responseWindowMs || 2500,
            iti_ms: itiMs || 300,
            show_feedback: showFeedback,
            feedback_ms: feedbackMs || 450,
            rule_change_correct_streak: correctStreakToChange,
            rules: finalRules,
            min_run_ms: minRun,
            max_run_ms: maxRun,

            sender_domains: senderDomains,
            sender_display_names: senderNames,
            subject_lines: {
              neutral: (subjectNeutral && subjectNeutral.length) ? subjectNeutral : ['Weekly account summary'],
              urgent: (subjectUrgent && subjectUrgent.length) ? subjectUrgent : ['Action required: verify your account'],
              reward: (subjectReward && subjectReward.length) ? subjectReward : ['You have a new benefit available'],
              threat: (subjectThreat && subjectThreat.length) ? subjectThreat : ['Account will be restricted soon']
            },
            preview_lines: {
              neutral: (previewNeutral && previewNeutral.length) ? previewNeutral : ['No action needed. Review recent activity.'],
              urgent: (previewUrgent && previewUrgent.length) ? previewUrgent : ['Please verify your account details to avoid interruption.'],
              reward: (previewReward && previewReward.length) ? previewReward : ['A new item is available. Review details when convenient.'],
              threat: (previewThreat && previewThreat.length) ? previewThreat : ['Failure to act may result in restricted access.']
            },
            link_text: {
              visible: linkTextVisible,
              shortened: linkTextShort,
              mismatch: linkTextMismatch
            },
            link_href: {
              visible: linkHrefVisible,
              shortened: linkHrefShort,
              mismatch: linkHrefMismatch
            },
            attachment_labels: {
              pdf: attachmentPdf,
              docm: attachmentDocm,
              zip: attachmentZip
            },
            help_overlay_enabled: helpEnabled,
            help_overlay_title: helpTitle,
            help_overlay_html: helpHtml
          };
        };

        const cfg = coerceWcstLikeConfig(wSpec.subtask || {});

        const state = {
          idx: i,
          title: wSpec.subtask_title,
          cfg,
          ended: false,
          started: false,
          subtask_start_ts: null,
          presented: 0,
          responded: 0,
          correct: 0,
          incorrect: 0,
          omissions: 0,
          current_rule: cfg.rules[0] || 'sender_domain',
          rule_index: 0,
          correct_streak: 0,
          trial_index: 0,
          current: null,
          current_presented_at: null,
          current_deadline_at: null,
          current_responded: false,
          respond: null
        };

        wcstStates[i] = state;

        const tSubtaskMs = () => {
          const base = (state.subtask_start_ts ?? startTs);
          return Math.round(nowMs() - base);
        };

        const dimLabels = {
          sender_domain: 'Sender',
          subject_tone: 'Subject',
          link_style: 'Link',
          attachment_type: 'Attachment'
        };

        // Safe, non-usable pseudo-stimuli:
        // - Reserved TLDs (.test)
        // - Generic labels
        // - No real brands
        const values = {
          sender_domain: Array.isArray(cfg.sender_domains) ? cfg.sender_domains.slice(0, 4) : ['corp.test', 'vendor.test', 'typo.test', 'ip.test'],
          subject_tone: ['neutral', 'urgent', 'reward', 'threat'],
          link_style: ['none', 'visible', 'shortened', 'mismatch'],
          attachment_type: ['none', 'pdf', 'docm', 'zip']
        };

        const targets = [
          { id: 'A', sender_domain: values.sender_domain[0], subject_tone: values.subject_tone[0], link_style: values.link_style[0], attachment_type: values.attachment_type[0] },
          { id: 'B', sender_domain: values.sender_domain[1], subject_tone: values.subject_tone[1], link_style: values.link_style[1], attachment_type: values.attachment_type[1] },
          { id: 'C', sender_domain: values.sender_domain[2], subject_tone: values.subject_tone[2], link_style: values.link_style[2], attachment_type: values.attachment_type[2] },
          { id: 'D', sender_domain: values.sender_domain[3], subject_tone: values.subject_tone[3], link_style: values.link_style[3], attachment_type: values.attachment_type[3] }
        ];

        const makeStimulus = () => {
          const pickV = (arr) => arr[randomInt(0, arr.length - 1)];
          const senderDomain = pickV(values.sender_domain);
          const subjectTone = pickV(values.subject_tone);
          const linkStyle = pickV(values.link_style);
          const attachmentType = pickV(values.attachment_type);

          const domainIndex = Math.max(0, values.sender_domain.indexOf(senderDomain));
          const senderName = (Array.isArray(cfg.sender_display_names) && cfg.sender_display_names[domainIndex])
            ? cfg.sender_display_names[domainIndex]
            : ((senderDomain === values.sender_domain[0]) ? 'Operations'
              : (senderDomain === values.sender_domain[1]) ? 'IT Vendor'
                : (senderDomain === values.sender_domain[2]) ? 'Support Desk'
                  : 'Automated Notice');
          const senderAddr = `alerts@${senderDomain}`;

          const subjectPool = (cfg.subject_lines && cfg.subject_lines[subjectTone]) ? cfg.subject_lines[subjectTone] : null;
          const subject = (Array.isArray(subjectPool) && subjectPool.length)
            ? subjectPool[randomInt(0, subjectPool.length - 1)]
            : (subjectTone === 'neutral')
              ? 'Weekly account summary'
              : (subjectTone === 'urgent')
                ? 'Action required: verify your account'
                : (subjectTone === 'reward')
                  ? 'You have a new benefit available'
                  : 'Account will be restricted soon';

          const attachmentLabel = (attachmentType === 'none')
            ? null
            : (attachmentType === 'pdf')
              ? (cfg.attachment_labels?.pdf ?? 'report.pdf')
              : (attachmentType === 'docm')
                ? (cfg.attachment_labels?.docm ?? 'invoice.docm')
                : (cfg.attachment_labels?.zip ?? 'archive.zip');

          const linkText = (linkStyle === 'none')
            ? null
            : (linkStyle === 'visible')
              ? (cfg.link_text?.visible ?? 'portal.corp.test')
              : (linkStyle === 'shortened')
                ? (cfg.link_text?.shortened ?? 'short.test/abc')
                : (cfg.link_text?.mismatch ?? 'portal.corp.test');
          const linkHref = (linkStyle === 'none')
            ? null
            : (linkStyle === 'visible')
              ? (cfg.link_href?.visible ?? 'https://portal.corp.test/')
              : (linkStyle === 'shortened')
                ? (cfg.link_href?.shortened ?? 'https://short.test/abc')
                : (cfg.link_href?.mismatch ?? 'https://vendor.test/portal');

          const previewPool = (cfg.preview_lines && cfg.preview_lines[subjectTone]) ? cfg.preview_lines[subjectTone] : null;
          const preview = (Array.isArray(previewPool) && previewPool.length)
            ? previewPool[randomInt(0, previewPool.length - 1)]
            : (subjectTone === 'neutral')
              ? 'No action needed. Review recent activity.'
              : (subjectTone === 'urgent')
                ? 'Please verify your account details to avoid interruption.'
                : (subjectTone === 'reward')
                  ? 'A new item is available. Review details when convenient.'
                  : 'Failure to act may result in restricted access.';

          return {
            id: `MAIL-${i + 1}-${String(state.trial_index + 1).padStart(4, '0')}`,
            sender_name: senderName,
            sender_address: senderAddr,
            subject,
            preview,
            sender_domain: senderDomain,
            subject_tone: subjectTone,
            link_style: linkStyle,
            link_text: linkText,
            link_href: linkHref,
            attachment_type: attachmentType,
            attachment_label: attachmentLabel
          };
        };

        const correctTargetIndexForRule = (stim, rule) => {
          const v = stim ? stim[rule] : null;
          if (!v) return null;
          const idx = targets.findIndex(t => (t && t[rule] === v));
          return (idx >= 0) ? idx : null;
        };

        const humanRule = () => dimLabels[state.current_rule] || state.current_rule;

        const keyLabel = (k) => {
          if (k === ' ') return 'SPACE';
          return String(k || '').toUpperCase();
        };

        const targetLabelForIndex = (idx) => {
          if (cfg.response_device === 'keyboard') {
            return keyLabel(cfg.choice_keys[idx]);
          }
          // Default to A-D style when using mouse
          const t = targets[idx];
          return (t && t.id) ? String(t.id) : String(idx + 1);
        };

        const controlsHint = () => {
          if (cfg.response_device === 'mouse') {
            return (cfg.mouse_response_mode === 'drag')
              ? 'Drag the email onto a target card to sort.'
              : 'Click a target card to sort.';
          }
          return `Press ${keyLabel(cfg.choice_keys[0])}, ${keyLabel(cfg.choice_keys[1])}, ${keyLabel(cfg.choice_keys[2])}, ${keyLabel(cfg.choice_keys[3])} to choose the target cards.`;
        };

        const instructionsTitle = subtaskInstructionsTitle || 'Email sorting (WCST-like)';
        const resolvedInstructionsHtml = substitutePlaceholders(subtaskInstructions, {
          KEYS: `${keyLabel(cfg.choice_keys[0])}, ${keyLabel(cfg.choice_keys[1])}, ${keyLabel(cfg.choice_keys[2])}, ${keyLabel(cfg.choice_keys[3])}`,
          CONTROLS: controlsHint(),
          RULES: cfg.rules.map(r => dimLabels[r] || r).join(', '),
          DOMAINS: values.sender_domain.join(', ')
        });

        const defaultHelpHtml = `
          <p><b>Goal:</b> Sort each email into one of four targets.</p>
          <p><b>How to respond:</b> {{CONTROLS}}</p>
          <p><b>How to decide:</b> each target card shows a <i>prototype</i> (Sender/Subject/Link/Attachment values). The correct target is the one that matches the email on the <i>current rule dimension</i>.</p>
          <p><b>How feedback works:</b> after each sort you’ll see Correct/Incorrect. Use this to infer the current rule; the rule can change.</p>
          <p><b>What the domains mean:</b> these are example sender domains used as stimulus attributes (not real destinations): <b>{{DOMAINS}}</b>.</p>
          <p><b>Possible rules:</b> {{RULES}}</p>
        `;

        const helpEnabled = !!cfg.help_overlay_enabled;
        const helpTitle = (cfg.help_overlay_title || 'Quick help').toString();
        const helpHtmlRaw = (cfg.help_overlay_html || '').toString().trim() ? cfg.help_overlay_html : defaultHelpHtml;
        const resolvedHelpHtml = substitutePlaceholders(helpHtmlRaw, {
          KEYS: `${keyLabel(cfg.choice_keys[0])}, ${keyLabel(cfg.choice_keys[1])}, ${keyLabel(cfg.choice_keys[2])}, ${keyLabel(cfg.choice_keys[3])}`,
          CONTROLS: controlsHint(),
          RULES: cfg.rules.map(r => dimLabels[r] || r).join(', '),
          DOMAINS: values.sender_domain.join(', ')
        });

        host.innerHTML = `
          <div class="soc-wcst-header">
            <div>
              <h4 style="margin:0;">Email sorting (WCST-like)</h4>
              <div class="hint">Sort each email into one of four target cards. Feedback helps you infer the current rule.</div>
            </div>
            <div class="actions">
              ${helpEnabled ? `<button type="button" class="soc-wcst-help-btn" id="soc_wcst_help_btn_${i}">Help</button>` : ''}
              <div class="hint" id="soc_wcst_status_${i}">Ready</div>
            </div>
          </div>

          <div class="soc-wcst-shell" style="margin-top: 10px;">
            <div class="soc-wcst-stim" id="soc_wcst_stim_${i}">
              <div class="soc-wcst-email muted">Waiting…</div>
            </div>

            <div class="soc-wcst-targets" id="soc_wcst_targets_${i}"></div>
            <div class="soc-wcst-footer muted" id="soc_wcst_footer_${i}">${escHtml(controlsHint())}</div>
          </div>

          <div class="soc-wcst-help-overlay" id="soc_wcst_help_${i}">
            <div class="panel" role="button" tabindex="0" aria-label="WCST-like help">
              <h3>${escHtml(helpTitle)}</h3>
              <div class="body" data-soc-wcst-help-body="true"></div>
              <div class="hint">Click to close.</div>
            </div>
          </div>
        `;

        const statusEl = host.querySelector(`#soc_wcst_status_${i}`);
        const stimHost = host.querySelector(`#soc_wcst_stim_${i}`);
        const targetsHost = host.querySelector(`#soc_wcst_targets_${i}`);
        const footerEl = host.querySelector(`#soc_wcst_footer_${i}`);

        const helpOverlay = host.querySelector(`#soc_wcst_help_${i}`);
        const helpBtn = host.querySelector(`#soc_wcst_help_btn_${i}`);
        const helpBody = helpOverlay?.querySelector?.('[data-soc-wcst-help-body="true"]') || null;
        if (helpBody) helpBody.innerHTML = resolvedHelpHtml;

        const showHelp = () => {
          if (!helpOverlay) return;
          try { helpOverlay.classList.add('show'); } catch { /* ignore */ }
        };
        const hideHelp = () => {
          if (!helpOverlay) return;
          try { helpOverlay.classList.remove('show'); } catch { /* ignore */ }
        };

        if (helpBtn) {
          helpBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showHelp();
          });
        }
        if (helpOverlay) {
          helpOverlay.addEventListener('click', (e) => {
            e.preventDefault();
            hideHelp();
          });
          helpOverlay.addEventListener('keydown', (e) => {
            const k = normalizeKeyName(e.key);
            if (k === 'Enter' || k === ' ' || k === 'Escape') {
              e.preventDefault();
              hideHelp();
            }
          });
        }

        // Drag-to-sort: ensure dragstart sets transfer data so drops are allowed.
        if (stimHost && cfg.response_device === 'mouse' && cfg.mouse_response_mode === 'drag') {
          stimHost.addEventListener('dragstart', (e) => {
            try {
              e.dataTransfer && e.dataTransfer.setData('text/plain', 'soc-wcst');
              e.dataTransfer && (e.dataTransfer.effectAllowed = 'move');
            } catch { /* ignore */ }
          });
        }

        const renderTargetCard = (t, idx) => {
          const showProto = (cfg.response_device === 'keyboard');
          const protoId = (t && t.id) ? String(t.id) : String(idx + 1);
          return `
            <button type="button" class="soc-wcst-target" data-idx="${idx}">
              <div class="soc-wcst-target-top">
                <div>
                  <b>Target ${escHtml(targetLabelForIndex(idx))}</b>
                  ${showProto ? ` <span class="muted" style="font-size:11px;">(prototype ${escHtml(protoId)})</span>` : ''}
                </div>
                <div class="muted" style="font-size:11px;">${escHtml(dimLabels.sender_domain)}: ${escHtml(t.sender_domain)}</div>
              </div>
              <div class="soc-wcst-kv">
                <div class="k">${escHtml(dimLabels.subject_tone)}</div><div class="v">${escHtml(t.subject_tone)}</div>
                <div class="k">${escHtml(dimLabels.link_style)}</div><div class="v">${escHtml(t.link_style)}</div>
                <div class="k">${escHtml(dimLabels.attachment_type)}</div><div class="v">${escHtml(t.attachment_type)}</div>
              </div>
            </button>
          `;
        };

        if (targetsHost) {
          targetsHost.innerHTML = targets.map(renderTargetCard).join('');
        }

        const renderEmail = (stim) => {
          if (!stimHost) return;
          const senderLine = `${escHtml(stim.sender_name || 'Sender')} <span class="muted">&lt;${escHtml(stim.sender_address || '')}&gt;</span>`;
          const att = stim.attachment_label ? `<span class="soc-wcst-pill">Attachment: ${escHtml(stim.attachment_label)}</span>` : '';
          const link = stim.link_text ? `<span class="soc-wcst-pill">Link: ${escHtml(stim.link_text)}</span>` : '';
          const dragAttr = (cfg.response_device === 'mouse' && cfg.mouse_response_mode === 'drag') ? 'draggable="true"' : '';
          stimHost.innerHTML = `
            <div class="soc-wcst-email" ${dragAttr}>
              <div class="top">
                <div class="from">${senderLine}</div>
                <div class="muted" style="font-size: 11px;">ID: ${escHtml(stim.id || '')}</div>
              </div>
              <div class="subj"><b>${escHtml(stim.subject || '')}</b></div>
              <div class="prev muted">${escHtml(stim.preview || '')}</div>
              <div class="meta">${att}${link}</div>
            </div>
          `;
        };

        const clearTargetHighlights = () => {
          if (!targetsHost) return;
          targetsHost.querySelectorAll('.soc-wcst-target').forEach((el) => {
            try { el.classList.remove('correct', 'incorrect', 'selected'); } catch { /* ignore */ }
          });
        };

        const flashFeedback = (idx, correct) => {
          if (!cfg.show_feedback) return;
          if (!targetsHost) return;
          const btn = targetsHost.querySelector(`.soc-wcst-target[data-idx="${idx}"]`);
          if (btn) {
            try { btn.classList.add('selected'); } catch { /* ignore */ }
            try { btn.classList.add(correct ? 'correct' : 'incorrect'); } catch { /* ignore */ }
          }
          if (statusEl) statusEl.textContent = correct ? 'Correct' : 'Incorrect';
        };

        const scheduleNextTrial = () => {
          if (state.ended || ended) return;
          if (cfg.num_trials > 0 && state.trial_index >= cfg.num_trials) {
            state.ended = true;
            if (statusEl) statusEl.textContent = 'Complete';
            return;
          }
          setSafeTimeout(() => {
            if (state.ended || ended) return;
            presentTrial();
          }, Math.max(0, cfg.iti_ms));
        };

        const maybeChangeRule = () => {
          if (state.correct_streak < cfg.rule_change_correct_streak) return;
          const prev = state.current_rule;
          state.correct_streak = 0;
          state.rule_index = (state.rule_index + 1) % cfg.rules.length;
          state.current_rule = cfg.rules[state.rule_index] || prev;
          events.push({
            t_ms: Math.round(nowMs() - startTs),
            t_subtask_ms: tSubtaskMs(),
            type: 'wcst_rule_change',
            subtask_index: i,
            subtask_title: state.title,
            prev_rule: prev,
            next_rule: state.current_rule
          });
        };

        const closeTrialAsOmissionIfNeeded = (reason = 'timeout') => {
          if (!state.current) return;
          if (state.current_responded) return;

          const now = nowMs();
          state.omissions += 1;
          state.presented += 1;
          state.trial_index += 1;

          events.push({
            t_ms: Math.round(now - startTs),
            t_subtask_ms: tSubtaskMs(),
            type: 'wcst_omission',
            reason,
            subtask_index: i,
            subtask_title: state.title,
            trial_index: state.trial_index - 1,
            stimulus_id: state.current.id || null,
            rule: state.current_rule,
            prompt_t_ms: state.current_presented_at ? Math.round(state.current_presented_at - startTs) : null,
            deadline_t_ms: state.current_deadline_at ? Math.round(state.current_deadline_at - startTs) : null
          });

          state.current = null;
          state.current_presented_at = null;
          state.current_deadline_at = null;
          state.current_responded = false;
          clearTargetHighlights();
          scheduleNextTrial();
        };

        const presentTrial = () => {
          clearTargetHighlights();
          const stim = makeStimulus();
          state.current = stim;
          state.current_presented_at = nowMs();
          state.current_deadline_at = state.current_presented_at + cfg.response_window_ms;
          state.current_responded = false;

          renderEmail(stim);
          if (statusEl) statusEl.textContent = `Rule: ${escHtml(humanRule())}`;
          if (footerEl) footerEl.textContent = controlsHint();

          const correctIdx = correctTargetIndexForRule(stim, state.current_rule);

          events.push({
            t_ms: Math.round(state.current_presented_at - startTs),
            t_subtask_ms: tSubtaskMs(),
            type: 'wcst_present',
            subtask_index: i,
            subtask_title: state.title,
            trial_index: state.trial_index,
            stimulus_id: stim.id || null,
            rule: state.current_rule,
            correct_target_index: Number.isFinite(correctIdx) ? correctIdx : null,
            sender_domain: stim.sender_domain,
            subject_tone: stim.subject_tone,
            link_style: stim.link_style,
            attachment_type: stim.attachment_type,
            prompt_t_ms: Math.round(state.current_presented_at - startTs),
            deadline_t_ms: Math.round(state.current_deadline_at - startTs)
          });

          // Timeout -> omission
          setSafeTimeout(() => {
            if (state.ended || ended) return;
            // Self-healing: if trial still open after deadline, close as omission.
            const now = nowMs();
            if (state.current && !state.current_responded && Number.isFinite(state.current_deadline_at) && now >= state.current_deadline_at) {
              closeTrialAsOmissionIfNeeded('deadline');
            }
          }, cfg.response_window_ms + 30);
        };

        const respond = (choiceIdx, device, keyOrNull) => {
          if (state.ended || ended) return false;
          if (!state.current) return false;
          if (state.current_responded) return false;

          const stim = state.current;
          const now = nowMs();
          const correctIdx = correctTargetIndexForRule(stim, state.current_rule);
          const correct = (Number.isFinite(correctIdx) && choiceIdx === correctIdx);

          state.current_responded = true;
          state.responded += 1;
          state.presented += 1;
          state.trial_index += 1;

          if (correct) {
            state.correct += 1;
            state.correct_streak += 1;
          } else {
            state.incorrect += 1;
            state.correct_streak = 0;
          }

          const rt = state.current_presented_at ? Math.max(0, Math.round(now - state.current_presented_at)) : null;

          events.push({
            t_ms: Math.round(now - startTs),
            t_subtask_ms: tSubtaskMs(),
            type: 'wcst_response',
            subtask_index: i,
            subtask_title: state.title,
            trial_index: state.trial_index - 1,
            stimulus_id: stim.id || null,
            rule: state.current_rule,
            device: device || null,
            response_key: keyOrNull || null,
            choice_target_index: choiceIdx,
            correct_target_index: Number.isFinite(correctIdx) ? correctIdx : null,
            correct,
            accuracy: correct ? 1 : 0,
            rt_ms: rt,
            prompt_t_ms: state.current_presented_at ? Math.round(state.current_presented_at - startTs) : null,
            deadline_t_ms: state.current_deadline_at ? Math.round(state.current_deadline_at - startTs) : null,
            response_t_ms: Math.round(now - startTs),
            sender_domain: stim.sender_domain,
            subject_tone: stim.subject_tone,
            link_style: stim.link_style,
            attachment_type: stim.attachment_type
          });

          flashFeedback(choiceIdx, correct);

          // Potential rule change after feedback
          maybeChangeRule();

          // Close & next
          setSafeTimeout(() => {
            clearTargetHighlights();
            state.current = null;
            state.current_presented_at = null;
            state.current_deadline_at = null;
            state.current_responded = false;
            if (!state.ended) {
              if (statusEl) statusEl.textContent = `Rule: ${escHtml(humanRule())}`;
              scheduleNextTrial();
            }
          }, cfg.show_feedback ? Math.max(0, cfg.feedback_ms) : 0);

          return true;
        };

        state.respond = respond;

        // Mouse responses
        if (targetsHost) {
          targetsHost.addEventListener('click', (e) => {
            if (cfg.response_device !== 'mouse') return;
            if (cfg.mouse_response_mode === 'drag') return;
            const btn = e.target.closest('.soc-wcst-target');
            if (!btn) return;
            const idxStr = btn.dataset.idx;
            const idxNum = Number(idxStr);
            if (!Number.isFinite(idxNum)) return;
            respond(idxNum, 'mouse', null);
          });

          // Drag-to-sort mode (desktop): drop the email onto a target.
          if (cfg.response_device === 'mouse' && cfg.mouse_response_mode === 'drag') {
            targetsHost.addEventListener('dragover', (e) => {
              const btn = e.target.closest('.soc-wcst-target');
              if (!btn) return;
              e.preventDefault();
            });
            targetsHost.addEventListener('drop', (e) => {
              const btn = e.target.closest('.soc-wcst-target');
              if (!btn) return;
              e.preventDefault();
              const idxStr = btn.dataset.idx;
              const idxNum = Number(idxStr);
              if (!Number.isFinite(idxNum)) return;
              respond(idxNum, 'mouse', null);
            });
          }
        }

        // Start/stop
        const computeStopAt = () => {
          const minR = cfg.min_run_ms;
          const maxR = cfg.max_run_ms;
          if (!minR && !maxR) return Infinity;
          if (minR && !maxR) return minR;
          if (!minR && maxR) return maxR;
          return randomInt(minR, maxR);
        };

        let startWall = null;
        let stopAt = null;

        const startWcstSubtask = () => {
          if (state.ended || state.started) return;
          state.started = true;
          state.subtask_start_ts = nowMs();
          startWall = state.subtask_start_ts;
          stopAt = computeStopAt();

          events.push({
            t_ms: Math.round(state.subtask_start_ts - startTs),
            t_subtask_ms: 0,
            type: 'wcst_subtask_start',
            subtask_index: i,
            subtask_title: state.title,
            response_device: cfg.response_device,
            mouse_response_mode: cfg.mouse_response_mode,
            choice_keys: cfg.choice_keys,
            rules: cfg.rules,
            rule_change_correct_streak: cfg.rule_change_correct_streak,
            num_trials: cfg.num_trials,
            sender_domains: cfg.sender_domains
          });

          // Kick off first trial
          scheduleNextTrial();

          // Show the help overlay once at start (briefly), if enabled.
          if (helpEnabled) {
            showHelp();
            setSafeTimeout(() => {
              if (state.ended || ended) return;
              hideHelp();
            }, 1800);
          }

          // Optional max runtime
          if (Number.isFinite(stopAt) && stopAt !== Infinity) {
            setSafeTimeout(() => {
              if (state.ended || ended) return;
              state.ended = true;
              closeTrialAsOmissionIfNeeded('forced_end');
              if (statusEl) statusEl.textContent = 'Complete';
              events.push({
                t_ms: Math.round(nowMs() - startTs),
                t_subtask_ms: tSubtaskMs(),
                type: 'wcst_subtask_forced_end',
                reason: 'max_run',
                subtask_index: i,
                subtask_title: state.title,
                presented: state.presented,
                responded: state.responded,
                correct: state.correct,
                incorrect: state.incorrect,
                omissions: state.omissions
              });
            }, stopAt);
          }
        };

        subtaskAutoStart[i] = startWcstSubtask;
        subtaskForceEnd[i] = (reason) => {
          if (state.ended) return;
          state.ended = true;
          closeTrialAsOmissionIfNeeded('forced_end');
          if (statusEl) statusEl.textContent = 'Complete';
          events.push({
            t_ms: Math.round(nowMs() - startTs),
            t_subtask_ms: tSubtaskMs(),
            type: 'wcst_subtask_forced_end',
            reason: (reason ?? 'forced').toString(),
            subtask_index: i,
            subtask_title: state.title,
            presented: state.presented,
            responded: state.responded,
            correct: state.correct,
            incorrect: state.incorrect,
            omissions: state.omissions
          });
        };

        // Mount overlays on the full window so they can sit above the titlebar.
        windowInstructionsHost[i] = w;
        windowInstructionsTitle[i] = instructionsTitle;
        windowInstructionsHtml[i] = resolvedInstructionsHtml;
        maybeInstallWindowInstructions(i);
        continue;
      }

      if (isPvtLike) {
        const setWindowDebug = (text) => {
          if (!socDebugEnabled) return;
          const el = windowDebugEls[i];
          if (!el) return;
          el.textContent = (text ?? '').toString();
        };

        const coercePvtLikeConfig = (raw) => {
          const o = (raw && typeof raw === 'object') ? raw : {};

          const responseDevice = ((o.response_device ?? 'keyboard').toString().trim().toLowerCase() === 'mouse') ? 'mouse' : 'keyboard';
          const responseKey = normalizeKeyName(o.response_key ?? 'space');

          const visibleEntries = clamp(o.visible_entries, 3, 30);
          const logInterval = clamp(o.log_scroll_interval_ms ?? o.scroll_interval_ms, 50, 5000);

          let minAlert = Number(o.alert_min_interval_ms);
          let maxAlert = Number(o.alert_max_interval_ms);
          minAlert = Number.isFinite(minAlert) ? Math.max(250, Math.floor(minAlert)) : 2000;
          maxAlert = Number.isFinite(maxAlert) ? Math.max(250, Math.floor(maxAlert)) : 6000;
          if (maxAlert < minAlert) {
            const tmp = minAlert;
            minAlert = maxAlert;
            maxAlert = tmp;
          }

          const countdownSeconds = Number.isFinite(Number(o.countdown_seconds)) ? Math.max(0, Math.min(10, Math.floor(Number(o.countdown_seconds)))) : 3;
          const flashMs = clamp(o.flash_duration_ms, 20, 2000);
          const responseWindowMs = clamp(o.response_window_ms, 100, 20000);

          let minRun = Number(o.min_run_ms);
          let maxRun = Number(o.max_run_ms);
          minRun = Number.isFinite(minRun) ? Math.max(0, Math.floor(minRun)) : 0;
          maxRun = Number.isFinite(maxRun) ? Math.max(0, Math.floor(maxRun)) : 0;
          if (minRun > 0 && maxRun > 0 && maxRun < minRun) {
            const tmp = minRun;
            minRun = maxRun;
            maxRun = tmp;
          }

          const showCountdown = (o.show_countdown !== undefined) ? !!o.show_countdown : true;
          const showRedFlash = (o.show_red_flash !== undefined) ? !!o.show_red_flash : true;

          return {
            response_device: responseDevice,
            response_key: responseKey,
            visible_entries: visibleEntries,
            log_scroll_interval_ms: logInterval,
            alert_min_interval_ms: minAlert,
            alert_max_interval_ms: maxAlert,
            countdown_seconds: countdownSeconds,
            flash_duration_ms: flashMs,
            response_window_ms: responseWindowMs,
            min_run_ms: minRun,
            max_run_ms: maxRun,
            show_countdown: showCountdown,
            show_red_flash: showRedFlash
          };
        };

        const cfg = coercePvtLikeConfig(wSpec.subtask || {});
        const state = {
          idx: i,
          title: wSpec.subtask_title,
          cfg,
          ended: false,
          started: false,
          subtask_start_ts: null,
          statusEl: null,
          tbodyEl: null,
          overlayEl: null,
          overlayCountEl: null,
          flashEl: null,
          lines: [],
          current: null,
          presented: 0,
          responded: 0,
          false_starts: 0,
          timeouts: 0,
          respond: null
        };
        pvtLikeStates[i] = state;

        setWindowDebug('PVT P:0 R:0 FS:0 TO:0');

        const tSubtaskMs = () => {
          const base = (state.subtask_start_ts ?? startTs);
          return Math.round(nowMs() - base);
        };

        const resolvedResponseControl = (cfg.response_device === 'keyboard')
          ? ((cfg.response_key === ' ' ? 'SPACE' : cfg.response_key) || 'SPACE')
          : 'CLICK';

        const instructionsTitleRaw = (wSpec?.subtask?.instructions_title ?? 'Incident alert monitor').toString();
        const instructionsTitle = instructionsTitleRaw.trim() ? instructionsTitleRaw : 'Incident alert monitor';

        const resolvedInstructionsHtml = substitutePlaceholders(subtaskInstructions, {
          RESPONSE_CONTROL: resolvedResponseControl
        });

        host.innerHTML = `
          <div class="soc-log-header">
            <div>
              <h4 style="margin:0;">Incident alerts</h4>
              <div class="hint">Press <b>${escHtml(resolvedResponseControl)}</b> when the <b>red flash</b> appears.</div>
            </div>
            <div class="soc-pvt-status" id="soc_pvt_status_${i}">Ready</div>
          </div>

          <div class="soc-pvt-logwrap">
            <table class="soc-pvt-log" aria-label="Console log feed">
              <thead>
                <tr>
                  <th style="width: 90px;">Time</th>
                  <th style="width: 58px;">Lvl</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody id="soc_pvt_tbody_${i}"></tbody>
            </table>
          </div>
        `;

        const statusEl = host.querySelector(`#soc_pvt_status_${i}`);
        const tbodyEl = host.querySelector(`#soc_pvt_tbody_${i}`);
        state.statusEl = statusEl;
        state.tbodyEl = tbodyEl;

        const overlay = document.createElement('div');
        overlay.className = 'soc-pvt-alert-overlay';
        overlay.innerHTML = `
          <div class="panel" role="button" tabindex="0" aria-label="Alert">
            <div class="kicker">Alert incoming</div>
            <div class="count" id="soc_pvt_count_${i}">—</div>
            <div class="hint">Respond when the red flash appears. (${escHtml(resolvedResponseControl)})</div>
            <div class="soc-pvt-flash" id="soc_pvt_flash_${i}"></div>
          </div>
        `;
        w.appendChild(overlay);
        state.overlayEl = overlay;
        state.overlayCountEl = overlay.querySelector(`#soc_pvt_count_${i}`);
        state.flashEl = overlay.querySelector(`#soc_pvt_flash_${i}`);

        const addLine = (lvl, msg) => {
          const ts = Date.now();
          state.lines.push({ ts, lvl: (lvl || 'INFO').toString(), msg: (msg || '').toString() });
          // Keep memory bounded
          if (state.lines.length > 200) state.lines.splice(0, state.lines.length - 200);
        };

        const renderLines = () => {
          if (!tbodyEl) return;
          const lines = state.lines.slice(-cfg.visible_entries);
          tbodyEl.innerHTML = lines.map((ln) => {
            const t = formatClock(ln.ts);
            const lvl = escHtml(ln.lvl);
            const msg = escHtml(ln.msg);
            return `
              <tr>
                <td>${escHtml(t)}</td>
                <td><span class="soc-log-tag">${lvl}</span></td>
                <td class="soc-pvt-mono">${msg}</td>
              </tr>
            `;
          }).join('');
        };

        const randomLogLine = () => {
          const lvl = (Math.random() < 0.10) ? 'WARN' : 'INFO';
          const svc = pickRandom(['auth-service', 'edge-proxy', 'payments-api', 'ids', 'db', 'monitor', 'vpn-gw']) || 'svc';
          const msg = pickRandom([
            'heartbeat ok',
            'token refresh ok',
            'routing table updated',
            `conn=${randomInt(8, 64)} pool healthy`,
            `p95 latency=${randomInt(40, 220)}ms`,
            `signature set synced`,
            `unexpected login from ${randomIp()}`
          ]) || 'event';
          return { lvl, msg: `${svc}: ${msg}` };
        };

        const hideAlert = (reason) => {
          if (state.overlayEl) state.overlayEl.classList.remove('show');
          try { state.flashEl && state.flashEl.classList.remove('show'); } catch { /* ignore */ }
          if (state.overlayCountEl) state.overlayCountEl.textContent = '—';
          if (state.current) {
            state.current = null;
          }
          if (reason) {
            addLine('INFO', `alert closed (${reason})`);
            renderLines();
          }
        };

        const respond = (device, detail) => {
          if (!state.started || state.ended) return;
          const now = nowMs();

          const current = state.current;
          const isActive = current && current.flash_onset_ts !== null;
          if (!isActive) {
            state.false_starts += 1;
            events.push({
              t_ms: Math.round(now - startTs),
              t_subtask_ms: tSubtaskMs(),
              type: 'pvt_like_false_start',
              subtask_index: i,
              subtask_title: state.title,
              device: (device ?? '').toString() || null,
              detail: (detail ?? '').toString() || null
            });
            addLine('WARN', `false start (${device || 'input'})`);
            renderLines();
            setWindowDebug(`PVT P:${state.presented} R:${state.responded} FS:${state.false_starts} TO:${state.timeouts}`);
            return;
          }

          if (current.responded) return;
          current.responded = true;
          state.responded += 1;

          const rt = Math.max(0, Math.round(now - current.flash_onset_ts));
          events.push({
            t_ms: Math.round(now - startTs),
            t_subtask_ms: tSubtaskMs(),
            type: 'pvt_like_response',
            subtask_index: i,
            subtask_title: state.title,
            device: (device ?? '').toString() || null,
            detail: (detail ?? '').toString() || null,
            stimulus_id: current.id,
            rt_ms: rt
          });
          addLine('INFO', `response rt=${rt}ms`);
          renderLines();
          setWindowDebug(`PVT P:${state.presented} R:${state.responded} FS:${state.false_starts} TO:${state.timeouts}`);
          hideAlert('respond');
          scheduleNextAlert();
        };
        state.respond = respond;

        overlay.addEventListener('click', (e) => {
          try { e.stopPropagation(); } catch { /* ignore */ }
          if (state.cfg.response_device !== 'mouse') return;
          respond('mouse', 'click');
        });
        overlay.addEventListener('keydown', (e) => {
          const k = normalizeKeyName(e.key);
          if (k === 'Enter' || k === ' ') {
            if (state.cfg.response_device !== 'mouse') return;
            e.preventDefault();
            respond('mouse', 'key');
          }
        });

        // Mouse responses: allow clicking anywhere in the window.
        // This ensures mouse false-starts are logged even when the alert overlay is not visible.
        w.addEventListener('click', (e) => {
          if (state.cfg.response_device !== 'mouse') return;
          const t = e && e.target;
          if (t && t.closest && t.closest('.soc-pvt-alert-overlay')) return;
          respond('mouse', 'click');
        });

        const beginAlert = () => {
          if (state.ended || !state.started) return;

          const id = `pvt_${i}_${Date.now()}_${state.presented + 1}`;
          state.presented += 1;
          setWindowDebug(`PVT P:${state.presented} R:${state.responded} FS:${state.false_starts} TO:${state.timeouts}`);

          const countdown = Math.max(0, Math.floor(cfg.countdown_seconds));
          state.current = {
            id,
            countdown_seconds: countdown,
            flash_onset_ts: null,
            responded: false
          };

          events.push({
            t_ms: Math.round(nowMs() - startTs),
            t_subtask_ms: tSubtaskMs(),
            type: 'pvt_like_alert_scheduled',
            subtask_index: i,
            subtask_title: state.title,
            stimulus_id: id,
            countdown_seconds: countdown
          });

          if (state.overlayEl) state.overlayEl.classList.add('show');
          if (state.flashEl) state.flashEl.classList.remove('show');

          const doFlash = () => {
            if (state.ended || !state.started) return;
            const cur = state.current;
            if (!cur || cur.id !== id) return;

            cur.flash_onset_ts = nowMs();

            events.push({
              t_ms: Math.round(cur.flash_onset_ts - startTs),
              t_subtask_ms: tSubtaskMs(),
              type: 'pvt_like_flash_onset',
              subtask_index: i,
              subtask_title: state.title,
              stimulus_id: id
            });

            if (cfg.show_red_flash && state.flashEl) {
              state.flashEl.classList.add('show');
              setSafeTimeout(() => {
                try { state.flashEl && state.flashEl.classList.remove('show'); } catch { /* ignore */ }
              }, cfg.flash_duration_ms);
            }

            if (state.overlayCountEl) state.overlayCountEl.textContent = 'GO';

            setSafeTimeout(() => {
              const cur2 = state.current;
              if (!cur2 || cur2.id !== id) return;
              if (cur2.responded) return;

              state.timeouts += 1;
              events.push({
                t_ms: Math.round(nowMs() - startTs),
                t_subtask_ms: tSubtaskMs(),
                type: 'pvt_like_timeout',
                subtask_index: i,
                subtask_title: state.title,
                stimulus_id: id
              });
              addLine('WARN', 'timeout');
              renderLines();
              setWindowDebug(`PVT P:${state.presented} R:${state.responded} FS:${state.false_starts} TO:${state.timeouts}`);
              hideAlert('timeout');
              scheduleNextAlert();
            }, cfg.response_window_ms);
          };

          if (!cfg.show_countdown || countdown <= 0) {
            if (state.overlayCountEl) state.overlayCountEl.textContent = '…';
            doFlash();
            return;
          }

          let remaining = countdown;
          const tickCountdown = () => {
            if (state.ended || !state.started) return;
            const cur = state.current;
            if (!cur || cur.id !== id) return;

            if (state.overlayCountEl) state.overlayCountEl.textContent = String(Math.max(1, remaining));
            remaining -= 1;
            if (remaining <= 0) {
              doFlash();
              return;
            }
            setSafeTimeout(tickCountdown, 1000);
          };

          events.push({
            t_ms: Math.round(nowMs() - startTs),
            t_subtask_ms: tSubtaskMs(),
            type: 'pvt_like_countdown_start',
            subtask_index: i,
            subtask_title: state.title,
            stimulus_id: id,
            countdown_seconds: countdown
          });
          tickCountdown();
        };

        const scheduleNextAlert = () => {
          if (state.ended || !state.started) return;
          const gap = randomInt(cfg.alert_min_interval_ms, cfg.alert_max_interval_ms);
          setSafeTimeout(() => {
            if (state.ended || !state.started) return;
            beginAlert();
          }, gap);
        };

        const computeStopAt = () => {
          const minR = cfg.min_run_ms;
          const maxR = cfg.max_run_ms;
          if (!minR && !maxR) return Infinity;
          if (minR && !maxR) return minR;
          if (!minR && maxR) return maxR;
          return randomInt(minR, maxR);
        };

        let startWall = null;
        let stopAt = null;

        const tickLog = () => {
          if (state.ended || !state.started) return;
          const { lvl, msg } = randomLogLine();
          addLine(lvl, msg);
          renderLines();

          const elapsed = Math.max(0, nowMs() - startWall);
          if (Number.isFinite(stopAt) && elapsed >= stopAt) {
            state.ended = true;
            if (statusEl) statusEl.textContent = 'Complete';
            hideAlert('stopped');
            events.push({
              t_ms: Math.round(nowMs() - startTs),
              t_subtask_ms: tSubtaskMs(),
              type: 'pvt_like_subtask_auto_end',
              subtask_index: i,
              subtask_title: state.title,
              presented: state.presented,
              responded: state.responded,
              false_starts: state.false_starts,
              timeouts: state.timeouts
            });
            return;
          }

          setSafeTimeout(tickLog, cfg.log_scroll_interval_ms);
        };

        const startPvtLikeSubtask = () => {
          if (state.started) return;
          state.started = true;
          state.subtask_start_ts = nowMs();
          startWall = state.subtask_start_ts;
          stopAt = computeStopAt();

          if (statusEl) statusEl.textContent = 'Running…';
          setWindowDebug(`PVT P:${state.presented} R:${state.responded} FS:${state.false_starts} TO:${state.timeouts}`);

          events.push({
            t_ms: Math.round(nowMs() - startTs),
            t_subtask_ms: 0,
            type: 'pvt_like_subtask_start',
            subtask_index: i,
            subtask_title: state.title
          });

          // Prime a few lines so the window doesn't start empty.
          for (let j = 0; j < 6; j++) {
            const { lvl, msg } = randomLogLine();
            addLine(lvl, msg);
          }
          renderLines();

          scheduleNextAlert();
          setSafeTimeout(tickLog, 0);
        };

        subtaskAutoStart[i] = startPvtLikeSubtask;
        subtaskForceEnd[i] = (reason) => {
          if (state.ended) return;
          state.ended = true;
          if (statusEl) statusEl.textContent = 'Complete';
          hideAlert('forced_end');
          setWindowDebug(`PVT END P:${state.presented} R:${state.responded} FS:${state.false_starts} TO:${state.timeouts}`);
          events.push({
            t_ms: Math.round(nowMs() - startTs),
            t_subtask_ms: tSubtaskMs(),
            type: 'pvt_like_subtask_forced_end',
            reason: (reason ?? 'forced').toString(),
            subtask_index: i,
            subtask_title: state.title,
            presented: state.presented,
            responded: state.responded,
            false_starts: state.false_starts,
            timeouts: state.timeouts
          });
        };

        // Mount overlays on the full window so they can sit above the titlebar.
        windowInstructionsHost[i] = w;
        windowInstructionsTitle[i] = instructionsTitle;
        windowInstructionsHtml[i] = resolvedInstructionsHtml;
        maybeInstallWindowInstructions(i);
        continue;
      }

      if (!isSartLike && !isNbackLike && !isFlankerLike && !isWcstLike && !isPvtLike) {
        host.innerHTML = `
          <h4>Subtask window</h4>
          <div class="muted">Desktop icon clicks are distractors.${wSpec.subtask_type ? ` • Subtask: ${escHtml(wSpec.subtask_type)}` : ''}</div>
          <div class="muted" style="margin-top:12px;">End key: <b>${escHtml((trial.end_key ?? 'escape').toString())}</b>${trialMs ? ` • Auto-end: ${Math.round(trialMs / 1000)}s` : ''}</div>
        `;

        const startGeneric = () => {
          markGenericSubtaskStart(i);
        };

        subtaskAutoStart[i] = startGeneric;
        subtaskForceEnd[i] = () => { /* no-op */ };

        // Mount overlays on the full window so they can sit above the titlebar.
        windowInstructionsHost[i] = w;
        windowInstructionsTitle[i] = wSpec.subtask_title;
        windowInstructionsHtml[i] = subtaskInstructions;
        maybeInstallWindowInstructions(i);
        continue;
      }

        if (isFlankerLike) {
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

          const coerceFlankerLikeConfig = (raw) => {
            const o = (raw && typeof raw === 'object') ? raw : {};

            const allowKey = normalizeKeyName(o.allow_key ?? 'f');
            const rejectKey = normalizeKeyName(o.reject_key ?? 'j');
            const rejectRule = ((o.reject_rule ?? 'high_only').toString().trim().toLowerCase() === 'medium_or_high')
              ? 'medium_or_high'
              : 'high_only';

            const trialIntervalMs = clamp(o.trial_interval_ms, 300, 10000);
            const numTrialsRaw = Number(o.num_trials);
            const numTrials = Number.isFinite(numTrialsRaw) ? Math.max(0, Math.min(5000, Math.floor(numTrialsRaw))) : 0;
            const responseWindowMs = clamp(o.response_window_ms, 150, 10000);
            const flashMs = clamp(o.question_flash_ms, 80, 5000);

            const congruentP = clamp01(o.congruent_probability ?? 0.5);
            const pHigh = clamp01(o.center_high_probability ?? 0.34);
            const pMed = clamp01(o.center_medium_probability ?? 0.33);
            const pLow = clamp01(o.center_low_probability ?? 0.33);

            const speedPxPerS = Math.max(40, Math.min(1200, Number(o.scroll_speed_px_per_s) || 240));
            const jerk = clamp01(o.jerkiness ?? 0.35);
            const spacingPx = clamp(o.point_spacing_px, 4, 24);

            let minRun = Number(o.min_run_ms);
            let maxRun = Number(o.max_run_ms);
            minRun = Number.isFinite(minRun) ? Math.max(0, Math.floor(minRun)) : 0;
            maxRun = Number.isFinite(maxRun) ? Math.max(0, Math.floor(maxRun)) : 0;
            if (minRun > 0 && maxRun > 0 && maxRun < minRun) {
              const tmp = minRun;
              minRun = maxRun;
              maxRun = tmp;
            }

            const showFeedback = (o.show_feedback !== undefined) ? !!o.show_feedback : false;

            return {
              allow_key: allowKey,
              reject_key: rejectKey,
              reject_rule: rejectRule,
              trial_interval_ms: trialIntervalMs,
              num_trials: numTrials,
              response_window_ms: responseWindowMs,
              question_flash_ms: flashMs,
              congruent_probability: congruentP,
              center_high_probability: pHigh,
              center_medium_probability: pMed,
              center_low_probability: pLow,
              scroll_speed_px_per_s: speedPxPerS,
              jerkiness: jerk,
              point_spacing_px: spacingPx,
              min_run_ms: minRun,
              max_run_ms: maxRun,
              show_feedback: showFeedback
            };
          };

          const cfg = coerceFlankerLikeConfig(wSpec.subtask || {});
          const state = {
            idx: i,
            title: wSpec.subtask_title,
            cfg,
            ended: false,
            started: false,
            subtask_start_ts: null,
            statusEl: null,
            promptEl: null,
            trialsById: null,
            presented: 0,
            responded: 0,
            correct: 0,
            incorrect: 0,
            omissions: 0,
            current: null,
            current_responded: false,
            current_prompt_ts: null,
            last_present_ts: null,
            min_onset_gap_ms: null,
            last_closed_trial: null,
            last_closed_at_ts: null,
            late_response_grace_ms: 2000
          };
          flankerStates[i] = state;

          const tSubtaskMs = () => {
            const base = (state.subtask_start_ts ?? startTs);
            return Math.round(nowMs() - base);
          };

          const resolvedAllowKey = (cfg.allow_key === ' ' ? 'SPACE' : cfg.allow_key);
          const resolvedRejectKey = (cfg.reject_key === ' ' ? 'SPACE' : cfg.reject_key);

          const instructionsTitleRaw = (wSpec?.subtask?.instructions_title ?? 'Traffic spikes monitor').toString();
          const instructionsTitle = instructionsTitleRaw.trim() ? instructionsTitleRaw : 'Traffic spikes monitor';
          const resolvedInstructionsHtml = substitutePlaceholders(subtaskInstructions, {
            ALLOW_KEY: resolvedAllowKey,
            REJECT_KEY: resolvedRejectKey
          });

          host.innerHTML = `
            <div class="soc-nback-header">
              <div>
                <h4 style="margin:0;">Traffic spikes monitor</h4>
                <div class="hint">When <b>Reject?</b> flashes, respond to the <b>center</b> spike. Ignore surrounding spikes.</div>
              </div>
              <div class="hint" id="soc_flanker_status_${i}">Ready</div>
            </div>

            <div class="soc-nback-card" id="soc_flanker_card_${i}" style="padding: 10px;">
              <div style="display:flex; align-items:center; justify-content:center; height: 26px; font-weight: 750; letter-spacing: 0.2px; opacity: 0;" id="soc_flanker_prompt_${i}">Reject?</div>
              <div style="position: relative; border-radius: 12px; overflow:hidden; border: 1px solid rgba(255,255,255,0.10); background: rgba(0,0,0,0.18);">
                <canvas id="soc_flanker_canvas_${i}" width="860" height="220" style="width: 100%; height: 200px; display:block;"></canvas>
                <div style="position:absolute; top:0; bottom:0; left:50%; width:0; border-left: 1px dashed rgba(250,204,21,0.75);"></div>
              </div>
              <div class="muted" style="margin-top:10px; font-size: 12px; display:flex; justify-content: space-between; gap: 10px;">
                <div>ALLOW: <b>${escHtml(resolvedAllowKey)}</b></div>
                <div>REJECT: <b>${escHtml(resolvedRejectKey)}</b></div>
                <div style="opacity:0.85;">${escHtml(cfg.reject_rule === 'medium_or_high' ? 'Reject MED/HIGH' : 'Reject HIGH')}</div>
              </div>
            </div>
          `;

          const statusEl = host.querySelector(`#soc_flanker_status_${i}`);
          const promptEl = host.querySelector(`#soc_flanker_prompt_${i}`);
          const canvas = host.querySelector(`#soc_flanker_canvas_${i}`);
          const ctx = canvas ? canvas.getContext('2d') : null;

          state.statusEl = statusEl;
          state.promptEl = promptEl;

          const N = 160;
          const points = Array.from({ length: N }, () => ({ level: 1, trialId: null, isCenter: false }));
          let offset = 0;
          let lastTick = nowMs();
          let animIntervalId = null;
          let trialIntervalId = null;
          let trialSeq = 0;
          const trialsById = new Map();
          const pendingClusters = [];
          let insertedTrials = 0;
          let maxTrialsToInsert = Infinity;
          let insertionIntervalMs = cfg.trial_interval_ms;

          const markerX = (canvas && Number.isFinite(canvas.width)) ? (canvas.width / 2) : 430;
          const approxTailX = (N - 1) * cfg.point_spacing_px;
          const travelMs = Math.max(0, Math.round(((approxTailX - markerX) / Math.max(40, cfg.scroll_speed_px_per_s)) * 1000));

          state.trialsById = trialsById;

          if (promptEl) {
            // Hidden by default; only show during the response window.
            promptEl.style.opacity = '0';
            promptEl.style.color = '';
            promptEl.style.animation = '';
          }

          const rememberClosedTrial = (trial, reason) => {
            if (!trial) return;
            const promptTs = Number.isFinite(trial.prompt_ts) ? trial.prompt_ts : null;
            state.last_closed_trial = {
              stimulus_id: trial.id,
              trial_index: trial.trial_index ?? null,
              prompt_ts: promptTs,
              deadline_ts: (promptTs === null) ? null : (promptTs + cfg.response_window_ms),
              center_level: trial.centerLevel,
              flanker_level: trial.flankerLevel,
              congruent: !!trial.congruent,
              reject_rule: cfg.reject_rule,
              should_reject: !!trial.isRejectCorrect,
              closed_reason: (reason ?? 'closed').toString()
            };
            state.last_closed_at_ts = nowMs();
          };

          const levelToY = (lvl, height) => {
            const base = height - 26;
            if (lvl === 2) return base - 130;
            if (lvl === 1) return base - 86;
            return base - 48;
          };

          const draw = () => {
            if (!ctx || !canvas) return;
            const w2 = canvas.width;
            const h2 = canvas.height;
            ctx.clearRect(0, 0, w2, h2);

            ctx.fillStyle = 'rgba(0,0,0,0.06)';
            ctx.fillRect(0, 0, w2, h2);

            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 1;
            for (let y = 36; y < h2; y += 36) {
              ctx.beginPath();
              ctx.moveTo(0, y);
              ctx.lineTo(w2, y);
              ctx.stroke();
            }

            // Line
            ctx.strokeStyle = 'rgba(147,197,253,0.95)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let j = 0; j < points.length; j++) {
              const x = (j * cfg.point_spacing_px) - offset;
              const y = levelToY(points[j].level, h2);
              if (j === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Spikes
            const base = h2 - 26;
            for (let j = 0; j < points.length; j++) {
              const x = (j * cfg.point_spacing_px) - offset;
              if (x < -10 || x > w2 + 10) continue;
              const y = levelToY(points[j].level, h2);
              const isAnyCenter = !!points[j].isCenter && !!points[j].trialId;
              const isActiveCenter = isAnyCenter && state.current && points[j].trialId === state.current.id;
              const isTrialSpike = !!points[j].trialId;

              if (isActiveCenter) {
                ctx.strokeStyle = 'rgba(250,204,21,0.95)';
                ctx.lineWidth = 3;
              } else if (isAnyCenter) {
                // Make upcoming decision centers visible.
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

            ctx.strokeStyle = 'rgba(255,255,255,0.10)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, base);
            ctx.lineTo(w2, base);
            ctx.stroke();
          };

          const computeStopAt = () => {
            const minR = cfg.min_run_ms;
            const maxR = cfg.max_run_ms;
            if (!minR && !maxR) return Infinity;
            if (minR && !maxR) return minR;
            if (!minR && maxR) return maxR;
            return randomInt(minR, maxR);
          };

          let startWall = null;
          let stopAt = null;

          const enqueueTrialCluster = () => {
            const centerLevel = pickLevel(cfg.center_high_probability, cfg.center_medium_probability, cfg.center_low_probability);
            const isCongruent = Math.random() < cfg.congruent_probability;
            let flankerLevel = centerLevel;
            if (!isCongruent) {
              if (centerLevel === 2) flankerLevel = 0;
              else if (centerLevel === 0) flankerLevel = 2;
              else flankerLevel = (Math.random() < 0.5) ? 0 : 2;
            }

            const id = `fl_${i}_${Date.now()}_${trialSeq++}`;
            const isRejectCorrect = (cfg.reject_rule === 'medium_or_high') ? (centerLevel >= 1) : (centerLevel === 2);
            const trial = { id, centerLevel, flankerLevel, congruent: isCongruent, isRejectCorrect, prompt_ts: null };
            trialsById.set(id, trial);

            const cluster = [flankerLevel, flankerLevel, centerLevel, flankerLevel, flankerLevel];
            pendingClusters.push({ trialId: id, cluster, pos: 0 });
            return trial;
          };

          const stampClusterNearMarker = (trial, cluster, leadMs = 700) => {
            if (!trial || !Array.isArray(cluster) || cluster.length !== 5) return;
            // Place center slightly to the right of the marker so it reaches it soon.
            const leadPx = Math.max(0, Math.round((Math.max(40, cfg.scroll_speed_px_per_s) * leadMs) / 1000));
            const targetX = markerX + leadPx;
            const centerIdx = Math.max(3, Math.min(points.length - 3, Math.round(targetX / cfg.point_spacing_px)));
            const startIdx = centerIdx - 2;
            for (let k = 0; k < 5; k++) {
              const idx2 = startIdx + k;
              if (idx2 < 0 || idx2 >= points.length) continue;
              points[idx2].level = cluster[k];
              points[idx2].trialId = trial.id;
              points[idx2].isCenter = (k === 2);
            }
          };

          const maybeStartTrial = () => {
            if (state.current) return;
            if (!canvas) return;
            if (Number.isFinite(state.min_onset_gap_ms) && Number.isFinite(state.last_present_ts)) {
              const since = Math.max(0, nowMs() - state.last_present_ts);
              if (since < state.min_onset_gap_ms) return;
            }
            const midX = markerX;
            const hitPx = Math.max(10, Math.round(cfg.point_spacing_px * 1.25));
            for (let j = 0; j < points.length; j++) {
              if (!points[j].isCenter || !points[j].trialId) continue;
              const x = (j * cfg.point_spacing_px) - offset;
              if (Math.abs(x - midX) <= hitPx) {
                const trial = trialsById.get(points[j].trialId) || null;
                if (!trial || trial.prompt_ts) continue;
                trial.prompt_ts = nowMs();
                trial.trial_index = (state.presented || 0) + 1;
                state.current = trial;
                state.current_responded = false;
                state.current_prompt_ts = trial.prompt_ts;
                state.last_present_ts = trial.prompt_ts;
                state.presented += 1;

                // Ensure keyboard responses route to this window.
                activeWindowIndex = i;

                if (statusEl) statusEl.textContent = 'Decision…';
                if (promptEl) {
                  promptEl.style.opacity = '1';
                  // Show prompt (no blinking); keep visible for the response window.
                  promptEl.style.animation = '';
                }

                events.push({
                  t_ms: Math.round(nowMs() - startTs),
                  t_subtask_ms: tSubtaskMs(),
                  type: 'flanker_present',
                  subtask_index: i,
                  subtask_title: state.title,
                  stimulus_id: trial.id,
                  trial_index: trial.trial_index,
                  prompt_t_ms: Math.round(trial.prompt_ts - startTs),
                  prompt_t_subtask_ms: Math.round(trial.prompt_ts - (state.subtask_start_ts || startTs)),
                  deadline_t_ms: Math.round((trial.prompt_ts + cfg.response_window_ms) - startTs),
                  deadline_t_subtask_ms: Math.round((trial.prompt_ts + cfg.response_window_ms) - (state.subtask_start_ts || startTs)),
                  center_level: trial.centerLevel,
                  flanker_level: trial.flankerLevel,
                  congruent: !!trial.congruent,
                  reject_rule: cfg.reject_rule,
                  should_reject: !!trial.isRejectCorrect
                });

                // (No flashing; we keep the prompt visible for the response window.)

                setSafeTimeout(() => {
                  if (ended || state.ended) return;
                  if (!state.current || state.current.id !== trial.id) return;
                  if (state.current_responded) return;
                  state.omissions += 1;
                  rememberClosedTrial(trial, 'no_response_timeout');
                  events.push({
                    t_ms: Math.round(nowMs() - startTs),
                    t_subtask_ms: tSubtaskMs(),
                    type: 'flanker_no_response',
                    subtask_index: i,
                    subtask_title: state.title,
                    stimulus_id: trial.id,
                    trial_index: trial.trial_index,
                    prompt_t_ms: Math.round(trial.prompt_ts - startTs),
                    prompt_t_subtask_ms: Math.round(trial.prompt_ts - (state.subtask_start_ts || startTs)),
                    deadline_t_ms: Math.round((trial.prompt_ts + cfg.response_window_ms) - startTs),
                    deadline_t_subtask_ms: Math.round((trial.prompt_ts + cfg.response_window_ms) - (state.subtask_start_ts || startTs)),
                    center_level: trial.centerLevel,
                    flanker_level: trial.flankerLevel,
                    congruent: !!trial.congruent,
                    reject_rule: cfg.reject_rule,
                    should_reject: !!trial.isRejectCorrect
                  });
                  if (statusEl) statusEl.textContent = 'Running…';
                  state.current = null;
                  state.current_prompt_ts = null;
                  if (promptEl) {
                    promptEl.style.opacity = '0';
                    promptEl.style.color = '';
                    promptEl.style.animation = '';
                  }
                  try { trialsById.delete(trial.id); } catch { /* ignore */ }
                }, cfg.response_window_ms);
                return;
              }
            }
          };

          const expireActiveTrialIfNeeded = () => {
            if (!state.current || !state.current.prompt_ts) return;
            const age = Math.max(0, nowMs() - state.current.prompt_ts);

            // Keep prompt visibility in sync with trial age.
            if (promptEl) {
              if (age < cfg.response_window_ms) {
                promptEl.style.opacity = '1';
                promptEl.style.animation = '';
              } else {
                promptEl.style.opacity = '0';
                promptEl.style.animation = '';
                promptEl.style.color = '';
              }
            }

            if (age < cfg.response_window_ms) return;

            // If the participant didn't respond, record omission and clear.
            if (!state.current_responded) {
              state.omissions += 1;
              const trial = state.current;
              rememberClosedTrial(trial, 'no_response_expire');
              events.push({
                t_ms: Math.round(nowMs() - startTs),
                t_subtask_ms: tSubtaskMs(),
                type: 'flanker_no_response',
                subtask_index: i,
                subtask_title: state.title,
                stimulus_id: trial.id,
                trial_index: trial.trial_index ?? null,
                prompt_t_ms: trial.prompt_ts ? Math.round(trial.prompt_ts - startTs) : null,
                prompt_t_subtask_ms: trial.prompt_ts ? Math.round(trial.prompt_ts - (state.subtask_start_ts || startTs)) : null,
                deadline_t_ms: trial.prompt_ts ? Math.round((trial.prompt_ts + cfg.response_window_ms) - startTs) : null,
                deadline_t_subtask_ms: trial.prompt_ts ? Math.round((trial.prompt_ts + cfg.response_window_ms) - (state.subtask_start_ts || startTs)) : null,
                center_level: trial.centerLevel,
                flanker_level: trial.flankerLevel,
                congruent: !!trial.congruent,
                reject_rule: cfg.reject_rule,
                should_reject: !!trial.isRejectCorrect
              });
            }

            try { trialsById.delete(state.current.id); } catch { /* ignore */ }
            state.current = null;
            state.current_prompt_ts = null;
            state.current_responded = false;
            if (statusEl) statusEl.textContent = 'Running…';
          };

          const advanceGraph = (dtSeconds) => {
            const jitter = 1 + ((Math.random() * 2 - 1) * cfg.jerkiness * 0.35);
            offset += (cfg.scroll_speed_px_per_s * jitter) * dtSeconds;
            while (offset >= cfg.point_spacing_px) {
              offset -= cfg.point_spacing_px;
              points.shift();

              const p = { level: pickLevel(cfg.center_high_probability, cfg.center_medium_probability, cfg.center_low_probability), trialId: null, isCenter: false };
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
          };

          const startFlankerSubtask = () => {
            if (state.started) return;
            state.started = true;
            state.subtask_start_ts = nowMs();
            startWall = state.subtask_start_ts;
            stopAt = computeStopAt();

            // If the window has a scheduled duration and num_trials is provided, distribute
            // trial clusters across that visibility window.
            const scheduleDuration = (schedule && schedule.has_schedule && Number.isFinite(Number(schedule.end_at_ms)))
              ? Math.max(0, Math.floor(Number(schedule.end_at_ms) - Number(schedule.start_at_ms)))
              : 0;

            if (cfg.num_trials > 0) {
              maxTrialsToInsert = cfg.num_trials;
              if (scheduleDuration > 0) {
                // Account for the time it takes a cluster injected at the tail to reach the marker.
                const effective = Math.max(0, Math.floor(scheduleDuration - travelMs));
                const derived = Math.floor(effective / Math.max(1, cfg.num_trials));
                insertionIntervalMs = Math.max(250, Math.min(10000, derived || cfg.trial_interval_ms));
              }
            }

            // Rate-limit trial onsets so we don't chew through all trials immediately.
            state.min_onset_gap_ms = Math.max(250, Math.min(10000, insertionIntervalMs || cfg.trial_interval_ms));
            state.last_present_ts = null;

            markGenericSubtaskStart(i);

            events.push({
              t_ms: Math.round(nowMs() - startTs),
              t_subtask_ms: 0,
              type: 'flanker_subtask_start',
              subtask_index: i,
              subtask_title: state.title,
              reject_rule: cfg.reject_rule,
              allow_key: cfg.allow_key,
              reject_key: cfg.reject_key
            });

            if (statusEl) statusEl.textContent = 'Running…';

            // Default keyboard focus to this window once running.
            activeWindowIndex = i;

            // Seed baseline points
            for (let j = 0; j < points.length; j++) {
              points[j].level = pickLevel(cfg.center_high_probability, cfg.center_medium_probability, cfg.center_low_probability);
              points[j].trialId = null;
              points[j].isCenter = false;
            }
            pendingClusters.length = 0;
            try { trialsById.clear(); } catch { /* ignore */ }
            state.current = null;
            state.current_prompt_ts = null;
            if (promptEl) {
              promptEl.style.opacity = '0';
              promptEl.style.color = '';
              promptEl.style.animation = '';
            }
            insertedTrials = 0;
            // Prime exactly one early decision cluster near the marker so the first decision appears quickly
            // without causing a burst of back-to-back trials at the beginning.
            {
              if (insertedTrials < maxTrialsToInsert) {
                const trial = enqueueTrialCluster();
                const cluster = pendingClusters.length ? pendingClusters[pendingClusters.length - 1]?.cluster : null;
                if (trial && cluster) {
                  pendingClusters.pop();
                  stampClusterNearMarker(trial, cluster, 900);
                }
                insertedTrials += 1;
              }
            }

            lastTick = nowMs();
            animIntervalId = setInterval(() => {
              if (ended || state.ended) return;
              const now = nowMs();
              const dt = Math.max(0, Math.min(0.05, (now - lastTick) / 1000));
              lastTick = now;

              advanceGraph(dt);
              draw();
              maybeStartTrial();
              expireActiveTrialIfNeeded();

              if (stopAt !== Infinity && startWall !== null && (now - startWall) >= stopAt) {
                try { subtaskForceEnd[i]?.('scheduled_end'); } catch { /* ignore */ }
              }
            }, 16);
            scheduledIntervals.push(animIntervalId);

            trialIntervalId = setInterval(() => {
              if (ended || state.ended) return;
              if (insertedTrials >= maxTrialsToInsert) return;
              enqueueTrialCluster();
              insertedTrials += 1;
            }, insertionIntervalMs);
            scheduledIntervals.push(trialIntervalId);
          };

          subtaskAutoStart[i] = startFlankerSubtask;
          subtaskForceEnd[i] = (reason) => {
            if (state.ended) return;
            state.ended = true;
            if (statusEl) statusEl.textContent = 'Complete';
            try {
              state.current = null;
              state.current_prompt_ts = null;
              if (promptEl) {
                promptEl.style.opacity = '0';
                promptEl.style.color = '';
                promptEl.style.animation = '';
              }
              if (ctx && canvas) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
              }
            } catch { /* ignore */ }
            events.push({
              t_ms: Math.round(nowMs() - startTs),
              t_subtask_ms: tSubtaskMs(),
              type: 'flanker_subtask_forced_end',
              reason: (reason ?? 'forced').toString(),
              subtask_index: i,
              subtask_title: state.title,
              presented: state.presented,
              responded: state.responded,
              correct: state.correct,
              incorrect: state.incorrect,
              omissions: state.omissions
            });
          };

          // Mount overlays on the full window so they can sit above the titlebar.
          windowInstructionsHost[i] = w;
          windowInstructionsTitle[i] = instructionsTitle;
          windowInstructionsHtml[i] = resolvedInstructionsHtml;
          maybeInstallWindowInstructions(i);
          continue;
        }

      if (isNbackLike) {
        const coerceNbackLikeConfig = (raw) => {
          const o = (raw && typeof raw === 'object') ? raw : {};

          const nRaw = Number(o.n);
          const n = Number.isFinite(nRaw) ? Math.max(1, Math.min(3, Math.floor(nRaw))) : 2;

          const matchField = ((o.match_field ?? 'src_ip').toString().trim().toLowerCase() === 'username') ? 'username' : 'src_ip';
          const paradigm = ((o.response_paradigm ?? 'go_nogo').toString().trim().toLowerCase() === '2afc') ? '2afc' : 'go_nogo';

          const goKey = normalizeKeyName(o.go_key ?? 'space');
          const matchKey = normalizeKeyName(o.match_key ?? 'j');
          const nonMatchKey = normalizeKeyName(o.nonmatch_key ?? 'f');

          const stimInterval = clamp(o.stimulus_interval_ms, 200, 10000);
          const targetProb = clamp(o.target_probability, 0, 1);

          let minRun = Number(o.min_run_ms);
          let maxRun = Number(o.max_run_ms);
          minRun = Number.isFinite(minRun) ? Math.max(0, Math.floor(minRun)) : 30000;
          maxRun = Number.isFinite(maxRun) ? Math.max(0, Math.floor(maxRun)) : 60000;
          if (minRun > 0 && maxRun > 0 && maxRun < minRun) {
            const tmp = minRun;
            minRun = maxRun;
            maxRun = tmp;
          }

          const showFeedback = (o.show_feedback !== undefined) ? !!o.show_feedback : false;

          return {
            n,
            match_field: matchField,
            response_paradigm: paradigm,
            go_key: goKey,
            match_key: matchKey,
            nonmatch_key: nonMatchKey,
            stimulus_interval_ms: stimInterval || 1200,
            target_probability: Number.isFinite(targetProb) ? targetProb : 0.25,
            min_run_ms: minRun,
            max_run_ms: maxRun,
            show_feedback: showFeedback
          };
        };

        const cfg = coerceNbackLikeConfig(wSpec.subtask || {});

        const state = {
          idx: i,
          title: wSpec.subtask_title,
          cfg,
          ended: false,
          started: false,
          subtask_start_ts: null,
          presented: 0,
          hits: 0,
          misses: 0,
          false_alarms: 0,
          correct_rejects: 0,
          omissions: 0,
          omissions_target: 0,
          omissions_nontarget: 0,
          buffer: [],
          current: null,
          current_is_match: false,
          current_presented_at: null,
          current_responded: false,
          current_response: null
        };
        nbackStates[i] = state;

        const tSubtaskMs = () => {
          const base = (state.subtask_start_ts ?? startTs);
          return Math.round(nowMs() - base);
        };

        const resolvedMatchFieldLabel = (cfg.match_field === 'username') ? 'Username' : 'Source IP';
        const resolvedGoControl = (cfg.response_paradigm === 'go_nogo')
          ? (cfg.go_key === ' ' ? 'SPACE' : cfg.go_key)
          : `${cfg.nonmatch_key === ' ' ? 'SPACE' : cfg.nonmatch_key} (NO) / ${cfg.match_key === ' ' ? 'SPACE' : cfg.match_key} (YES)`;
        const resolvedNoGoControl = (cfg.response_paradigm === 'go_nogo')
          ? 'withhold'
          : (cfg.nonmatch_key === ' ' ? 'SPACE' : cfg.nonmatch_key);

        const instructionsTitle = subtaskInstructionsTitle || 'Correlating repeat offenders';
        const resolvedInstructionsHtml = substitutePlaceholders(subtaskInstructions, {
          GO_CONTROL: resolvedGoControl,
          NOGO_CONTROL: resolvedNoGoControl,
          N: String(cfg.n),
          MATCH_FIELD: resolvedMatchFieldLabel
        });

        host.innerHTML = `
          <div class="soc-nback-header">
            <div>
              <h4 style="margin:0;">Alert correlation (${escHtml(String(cfg.n))}-back)</h4>
              <div class="hint">Press ${escHtml(resolvedGoControl)} when ${escHtml(resolvedMatchFieldLabel)} matches ${escHtml(String(cfg.n))}-back.</div>
            </div>
            <div class="hint" id="soc_nback_status_${i}">Ready</div>
          </div>

          <div class="soc-nback-card" id="soc_nback_card_${i}">
            <div class="top">
              <div class="soc-nback-pill" id="soc_nback_time_${i}">--:--:--</div>
              <div class="soc-nback-pill" id="soc_nback_disp_${i}">Disposition: —</div>
            </div>
            <div class="soc-nback-grid">
              <div class="soc-nback-k">Source IP</div><div class="soc-nback-v"><b id="soc_nback_src_${i}">—</b></div>
              <div class="soc-nback-k">Username</div><div class="soc-nback-v"><b id="soc_nback_user_${i}">—</b></div>
              <div class="soc-nback-k">Destination</div><div class="soc-nback-v" id="soc_nback_dest_${i}">—</div>
              <div class="soc-nback-k">Event</div><div class="soc-nback-v" id="soc_nback_evt_${i}">—</div>
              <div class="soc-nback-k">Risk</div><div class="soc-nback-v"><span id="soc_nback_risk_${i}">—</span></div>
              <div class="soc-nback-k">Match field</div><div class="soc-nback-v">${escHtml(resolvedMatchFieldLabel)}</div>
            </div>
          </div>
        `;

        const statusEl = host.querySelector(`#soc_nback_status_${i}`);
        const cardEl = host.querySelector(`#soc_nback_card_${i}`);
        const timeEl = host.querySelector(`#soc_nback_time_${i}`);
        const dispEl = host.querySelector(`#soc_nback_disp_${i}`);
        const srcEl = host.querySelector(`#soc_nback_src_${i}`);
        const userEl = host.querySelector(`#soc_nback_user_${i}`);
        const destEl = host.querySelector(`#soc_nback_dest_${i}`);
        const evtEl = host.querySelector(`#soc_nback_evt_${i}`);
        const riskEl = host.querySelector(`#soc_nback_risk_${i}`);

        const names = ['a.nguyen', 'j.smith', 'm.patel', 'r.garcia', 's.chen', 'k.johnson', 't.kim', 'l.brown'];
        const dests = ['secure-login.example', 'admin-portal.example', 'vpn.example', 'mail.example', 'files.example', 'hr.example'];
        const evts = ['Failed login', 'MFA challenge', 'Password spray suspected', 'Geo anomaly', 'New device', 'Impossible travel'];

        const computeStopAt = () => {
          const minR = cfg.min_run_ms;
          const maxR = cfg.max_run_ms;
          if (!minR && !maxR) return Infinity;
          if (minR && !maxR) return minR;
          if (!minR && maxR) return maxR;
          return randomInt(minR, maxR);
        };

        let startWall = null;
        let stopAt = null;

        const makeEntry = () => {
          const createdAt = nowMs();
          const entry = {
            id: `ALERT-${i + 1}-${String(state.presented + 1).padStart(4, '0')}`,
            createdAt,
            clock: formatClock(Date.now()),
            src_ip: randomIp(),
            username: pickRandom(names) || 'a.nguyen',
            dest: pickRandom(dests) || 'secure-login.example',
            event: pickRandom(evts) || 'Failed login',
            risk: randomInt(20, 95),
            disposition: '—'
          };
          return entry;
        };

        const renderEntry = (entry) => {
          if (!entry) return;
          if (timeEl) timeEl.textContent = entry.clock;
          if (srcEl) srcEl.textContent = entry.src_ip;
          if (userEl) userEl.textContent = entry.username;
          if (destEl) destEl.textContent = entry.dest;
          if (evtEl) evtEl.textContent = entry.event;
          if (riskEl) riskEl.textContent = String(entry.risk);
          if (dispEl) dispEl.textContent = `Disposition: ${entry.disposition || '—'}`;
        };

        const flashFeedback = (text) => {
          if (!cfg.show_feedback) return;
          if (!statusEl) return;
          statusEl.textContent = text;
          if (cardEl) {
            try { cardEl.classList.remove('soc-nback-flash'); } catch { /* ignore */ }
            try { void cardEl.offsetWidth; cardEl.classList.add('soc-nback-flash'); } catch { /* ignore */ }
          }
        };

        const finalizeOmissionIfNeeded = () => {
          if (!state.current) return;
          if (state.current_responded) return;

          state.omissions += 1;
          if (state.current_is_match) state.omissions_target += 1;
          else state.omissions_nontarget += 1;

          if (cfg.response_paradigm === 'go_nogo') {
            if (state.current_is_match) state.misses += 1;
            else state.correct_rejects += 1;
          } else {
            // 2AFC: omission counts as an error (no explicit response).
            if (state.current_is_match) state.misses += 1;
            // non-target omissions do not map cleanly; keep in omissions counts.
          }

          events.push({
            t_ms: Math.round(nowMs() - startTs),
            t_subtask_ms: tSubtaskMs(),
            type: 'nback_no_response',
            subtask_index: i,
            subtask_title: state.title,
            stimulus_id: state.current.id,
            is_match: !!state.current_is_match,
            match_field: cfg.match_field,
            paradigm: cfg.response_paradigm
          });
        };

        const presentNext = () => {
          const canMatch = state.buffer.length >= cfg.n;
          const wantsMatch = canMatch ? (Math.random() < cfg.target_probability) : false;
          const entry = makeEntry();

          let isMatch = false;
          if (wantsMatch) {
            const ref = state.buffer[state.buffer.length - cfg.n];
            if (ref) {
              isMatch = true;
              if (cfg.match_field === 'username') entry.username = ref.username;
              else entry.src_ip = ref.src_ip;
            }
          }

          state.presented += 1;
          state.current = entry;
          state.current_is_match = isMatch;
          state.current_presented_at = nowMs();
          state.current_responded = false;
          state.current_response = null;

          state.buffer.push({
            src_ip: entry.src_ip,
            username: entry.username
          });
          while (state.buffer.length > 50) state.buffer.shift();

          renderEntry(entry);

          events.push({
            t_ms: Math.round(nowMs() - startTs),
            t_subtask_ms: tSubtaskMs(),
            type: 'nback_present',
            subtask_index: i,
            subtask_title: state.title,
            stimulus_id: entry.id,
            is_match: !!isMatch,
            n: cfg.n,
            match_field: cfg.match_field,
            src_ip: entry.src_ip,
            username: entry.username,
            dest: entry.dest,
            event: entry.event,
            risk: entry.risk
          });
        };

        const respond = (responseKind, device, keyName) => {
          if (!state.started || state.ended) return;
          if (!state.current) return;
          if (state.current_responded) return;

          state.current_responded = true;
          state.current_response = responseKind;

          const rt = state.current_presented_at ? Math.round(nowMs() - state.current_presented_at) : null;
          const isMatch = !!state.current_is_match;

          let correct = false;
          if (cfg.response_paradigm === 'go_nogo') {
            // Any response means "match".
            correct = isMatch;
            if (isMatch) state.hits += 1;
            else state.false_alarms += 1;
            state.current.disposition = correct ? 'FLAGGED (repeat)' : 'FLAGGED (error)';
          } else {
            // 2AFC: explicit yes/no.
            const saidMatch = responseKind === 'match';
            correct = (saidMatch === isMatch);

            if (saidMatch) {
              if (isMatch) state.hits += 1;
              else state.false_alarms += 1;
              state.current.disposition = correct ? 'FLAGGED (repeat)' : 'FLAGGED (error)';
            } else {
              if (!isMatch) state.correct_rejects += 1;
              else state.misses += 1;
              state.current.disposition = correct ? 'CLEARED' : 'CLEARED (miss)';
            }
          }

          renderEntry(state.current);

          events.push({
            t_ms: Math.round(nowMs() - startTs),
            t_subtask_ms: tSubtaskMs(),
            type: 'nback_response',
            subtask_index: i,
            subtask_title: state.title,
            device,
            key: keyName || null,
            response: responseKind,
            is_match: isMatch,
            correct,
            rt_ms: rt,
            stimulus_id: state.current.id
          });

          flashFeedback(correct ? 'Correct' : 'Incorrect');
        };

        // Expose for global keyboard handler
        state.respond = respond;

        const tick = () => {
          if (ended || state.ended || !state.started) return;

          const elapsed = nowMs() - startWall;
          if (elapsed >= stopAt) {
            finalizeOmissionIfNeeded();
            state.ended = true;
            if (statusEl) statusEl.textContent = 'Complete';
            events.push({
              t_ms: Math.round(nowMs() - startTs),
              t_subtask_ms: tSubtaskMs(),
              type: 'nback_subtask_end',
              subtask_index: i,
              subtask_title: state.title,
              presented: state.presented,
              hits: state.hits,
              misses: state.misses,
              false_alarms: state.false_alarms,
              correct_rejects: state.correct_rejects,
              omissions: state.omissions,
              omissions_target: state.omissions_target,
              omissions_nontarget: state.omissions_nontarget
            });
            return;
          }

          finalizeOmissionIfNeeded();
          if (statusEl) statusEl.textContent = 'Running…';
          presentNext();
          setSafeTimeout(tick, cfg.stimulus_interval_ms);
        };

        const startNbackSubtask = () => {
          if (state.started) return;
          state.started = true;
          state.subtask_start_ts = nowMs();
          startWall = state.subtask_start_ts;
          stopAt = computeStopAt();

          markGenericSubtaskStart(i);

          events.push({
            t_ms: Math.round(nowMs() - startTs),
            t_subtask_ms: 0,
            type: 'nback_subtask_start',
            subtask_index: i,
            subtask_title: state.title,
            n: cfg.n,
            match_field: cfg.match_field,
            paradigm: cfg.response_paradigm
          });

          setSafeTimeout(tick, 0);
        };

        subtaskAutoStart[i] = startNbackSubtask;
        subtaskForceEnd[i] = (reason) => {
          if (state.ended) return;
          finalizeOmissionIfNeeded();
          state.ended = true;
          if (statusEl) statusEl.textContent = 'Complete';
          events.push({
            t_ms: Math.round(nowMs() - startTs),
            t_subtask_ms: tSubtaskMs(),
            type: 'nback_subtask_forced_end',
            reason: (reason ?? 'forced').toString(),
            subtask_index: i,
            subtask_title: state.title
          });
        };

        // Mount overlays on the full window so they can sit above the titlebar.
        windowInstructionsHost[i] = w;
        windowInstructionsTitle[i] = instructionsTitle;
        windowInstructionsHtml[i] = resolvedInstructionsHtml;
        maybeInstallWindowInstructions(i);
        continue;
      }

      const cfg = coerceSartLikeConfig(wSpec.subtask || {});
      const state = {
        idx: i,
        title: wSpec.subtask_title,
        cfg,
        ended: false,
        started: false,
        subtask_start_ts: null,
        entries: [],
        responded: new Set(),
        presented: 0,
        hits: 0,
        misses: 0,
        false_alarms: 0,
        correct_rejects: 0
      };
      sartStates[i] = state;

      const showMarkers = !!cfg.show_markers;
      const resolvedGoControl = (cfg.response_device === 'keyboard')
        ? (cfg.go_key === ' ' ? 'SPACE' : cfg.go_key)
        : (cfg.go_button === 'change' ? 'Change' : 'Action');

      const instructionsTitleRaw = (wSpec?.subtask?.instructions_title ?? 'Filtering harmful logins').toString();
      const instructionsTitle = instructionsTitleRaw.trim() ? instructionsTitleRaw : 'Filtering harmful logins';

      const resolvedInstructionsHtml = substitutePlaceholders(subtaskInstructions, {
        GO_CONTROL: resolvedGoControl,
        TARGETS: (cfg.target_subdomains.length ? cfg.target_subdomains.join(', ') : '(set target_subdomains)'),
        DISTRACTORS: (cfg.distractor_subdomains.length ? cfg.distractor_subdomains.join(', ') : '(set distractor_subdomains)')
      });

      const goHint = (cfg.response_device === 'keyboard')
        ? `Go key: ${cfg.go_key === ' ' ? 'SPACE' : escHtml(cfg.go_key)}`
        : `Click "${cfg.go_button === 'change' ? 'Change' : 'Action'}" on the highlighted row`;

      const goRule = (cfg.go_condition === 'target')
        ? 'GO on TARGET entries; withhold otherwise.'
        : 'GO on DISTRACTOR entries; withhold otherwise.';

      host.innerHTML = `
        <div class="soc-log-header">
          <div>
            <h4 style="margin:0;">Log triage (Go/No-Go)</h4>
            <div class="hint">${escHtml(goRule)} • ${goHint}</div>
          </div>
          <div class="hint" id="soc_sart_status_${i}">Ready</div>
        </div>
        <div style="margin-top:6px;">
          <table class="soc-log-feed" aria-label="Log feed">
            <thead><tr><th>Time</th><th>Src IP</th><th>Dest</th><th>Event</th><th>Action</th>${showMarkers ? '<th>Tag</th>' : ''}</tr></thead>
            <tbody id="soc_sart_rows_${i}"></tbody>
          </table>
        </div>
      `;

      const rowsEl = host.querySelector(`#soc_sart_rows_${i}`);
      const statusEl = host.querySelector(`#soc_sart_status_${i}`);

      const shouldGoFor = (entryClass) => {
        if (cfg.go_condition === 'target') return entryClass === 'target';
        if (cfg.go_condition === 'distractor') return entryClass === 'distractor';
        return false;
      };

      const classifyEntry = (kind) => {
        if (kind === 'target') return 'target';
        if (kind === 'distractor') return 'distractor';
        return 'neutral';
      };

      const makeNeutralDest = () => {
        const neutral = pickRandom(cfg.neutral_subdomains);
        if (neutral) return neutral;
        const verbs = ['cdn', 'static', 'assets', 'img', 'telemetry', 'updates', 'api'];
        const roots = ['news', 'media', 'shop', 'status', 'docs', 'portal', 'support'];
        const tlds = ['example', 'local', 'test'];
        return `${pickRandom(verbs)}.${pickRandom(roots)}.${pickRandom(tlds)}`;
      };

      const makeEntry = () => {
        const pTarget = cfg.target_probability;
        const pDistractor = cfg.distractor_probability;
        const r = Math.random();

        let kind = 'neutral';
        if (r < pTarget) kind = 'target';
        else if (r < (pTarget + pDistractor)) kind = 'distractor';

        let dest = null;
        if (kind === 'target') dest = pickRandom(cfg.target_subdomains);
        if (kind === 'distractor') dest = pickRandom(cfg.distractor_subdomains);
        if (!dest) {
          // If list empty, degrade gracefully.
          kind = 'neutral';
          dest = makeNeutralDest();
        }

        const id = `LOG-${i + 1}-${String(state.presented + 1).padStart(4, '0')}`;
        const createdAt = nowMs();
        const clock = formatClock(Date.now());

        const actions = ['DNS query', 'TLS handshake', 'HTTP GET', 'HTTP POST', 'Auth attempt', 'File fetch'];
        const action = pickRandom(actions) || 'HTTP GET';

        const entry = {
          id,
          kind,
          cls: classifyEntry(kind),
          t_presented_ms: Math.round(createdAt - (state.subtask_start_ts ?? startTs)),
          createdAt,
          clock,
          src_ip: randomIp(),
          dest,
          action,
          triage_action: '—'
        };
        return entry;
      };

      const actionButtonLabel = () => (cfg.go_button === 'change' ? 'Change' : 'Action');

      const applyTriageAction = (entry) => {
        if (!entry) return;
        // Semantics: GO commits a triage decision.
        // To avoid mixing ALLOW/BLOCK in the same run, bind the action to the configured GO rule:
        // - GO on target  => ALLOW (even if a participant responds on a distractor)
        // - GO on distractor => BLOCK (even if a participant responds on a target)
        entry.triage_action = (cfg.go_condition === 'distractor') ? 'BLOCK' : 'ALLOW';
      };

      const renderRows = () => {
        if (!rowsEl) return;

        const current = state.entries.length ? state.entries[state.entries.length - 1] : null;
        const currentId = current ? current.id : null;

        rowsEl.innerHTML = state.entries.map((e) => {
          const isCurrent = !!(currentId && e.id === currentId);
          const already = state.responded.has(e.id);
          const clickable = (cfg.response_device === 'mouse' && isCurrent && !already) ? ' clickable' : '';

          const rowClass = (cfg.highlight_subdomains && e.cls !== 'neutral') ? e.cls : '';

          const flags = `${isCurrent ? ' current' : ''}${already ? ' responded' : ''}`;

          const tag = (e.cls === 'target')
            ? '<span class="soc-log-tag">TARGET</span>'
            : (e.cls === 'distractor')
              ? '<span class="soc-log-tag">DISTRACTOR</span>'
              : '<span class="soc-log-tag">NEUTRAL</span>';

          // Optional per-class tint overrides
          let style = '';
          if (cfg.highlight_subdomains && e.cls === 'target') {
            style = `style="background: ${escHtml(cfg.target_highlight_color)}22;"`;
          }
          if (cfg.highlight_subdomains && e.cls === 'distractor') {
            style = `style="background: ${escHtml(cfg.distractor_highlight_color)}22;"`;
          }

          const actionCell = (() => {
            const val = escHtml(e.triage_action ?? '—');
            if (cfg.response_device !== 'mouse') {
              return `<span class="soc-log-tag">${val}</span>`;
            }
            if (!isCurrent) {
              return `<span class="soc-log-tag">${val}</span>`;
            }
            return `
              <span class="soc-log-tag" style="margin-right: 6px;">${val}</span>
              <button type="button" class="soc-log-go-btn" data-entry-id="${escHtml(e.id)}" ${already ? 'disabled' : ''}>
                ${escHtml(actionButtonLabel())}
              </button>
            `;
          })();

          return `
            <tr class="${escHtml(rowClass)}${flags}${clickable}" data-entry-id="${escHtml(e.id)}" ${style}>
              <td>${escHtml(e.clock)}</td>
              <td>${escHtml(e.src_ip)}</td>
              <td>${escHtml(e.dest)}</td>
              <td>${escHtml(e.action)}</td>
              <td style="white-space: nowrap;">${actionCell}</td>
              ${showMarkers ? `<td>${tag}</td>` : ''}
            </tr>
          `;
        }).join('');
      };

      // Expose for global keyboard handler (active window)
      state.renderRows = renderRows;

      const tSubtaskMs = () => {
        const base = (state.subtask_start_ts ?? startTs);
        return Math.round(nowMs() - base);
      };

      const recordMissIfNeeded = (entry) => {
        if (!entry) return;
        if (!shouldGoFor(entry.cls)) {
          state.correct_rejects += 1;
          return;
        }

        if (state.responded.has(entry.id)) return;
        state.misses += 1;
        events.push({
          t_ms: Math.round(nowMs() - startTs),
          t_subtask_ms: tSubtaskMs(),
          type: 'sart_miss',
          subtask_index: i,
          subtask_title: state.title,
          entry_id: entry.id,
          entry_class: entry.cls
        });
      };

      const recordResponse = (entry, device) => {
        if (!entry) return;
        if (!state.started) return;
        if (state.responded.has(entry.id)) return;
        state.responded.add(entry.id);

        applyTriageAction(entry);

        const rt = Math.round(nowMs() - entry.createdAt);
        const isGoTarget = shouldGoFor(entry.cls);
        const correct = isGoTarget;

        if (correct) state.hits += 1;
        else state.false_alarms += 1;

        events.push({
          t_ms: Math.round(nowMs() - startTs),
          t_subtask_ms: tSubtaskMs(),
          type: 'sart_response',
          subtask_index: i,
          subtask_title: state.title,
          device,
          entry_id: entry.id,
          entry_class: entry.cls,
          triage_action: entry.triage_action,
          correct,
          rt_ms: rt
        });

        renderRows();
      };

      // Mouse response: click the per-row button responds (current row only).
      if (cfg.response_device === 'mouse' && rowsEl) {
        rowsEl.addEventListener('click', (e) => {
          if (!state.started) return;
          const btn = e.target.closest('button[data-entry-id]');
          if (!btn) return;
          const row = btn.closest('tr[data-entry-id]');
          if (!row) return;
          activeWindowIndex = i;
          const id = (row.dataset.entryId || '').toString();
          const entry = state.entries.find(x => x.id === id);
          recordResponse(entry, 'mouse');
        });
      }

      // Schedule ticks via recursive timeouts (starts when instructions are dismissed).
      let startWall = null;
      let stopAt = null;

      const computeStopAt = () => {
        const minR = cfg.min_run_ms;
        const maxR = cfg.max_run_ms;
        if (!minR && !maxR) return Infinity;
        if (minR && !maxR) return minR;
        if (!minR && maxR) return maxR;
        // Both positive
        return randomInt(minR, maxR);
      };

      const tick = () => {
        if (ended || state.ended || !state.started) return;

        const elapsed = nowMs() - startWall;
        if (elapsed >= stopAt) {
          state.ended = true;
          if (statusEl) statusEl.textContent = 'Complete';
          events.push({
            t_ms: Math.round(nowMs() - startTs),
            t_subtask_ms: tSubtaskMs(),
            type: 'sart_subtask_end',
            subtask_index: i,
            subtask_title: state.title,
            presented: state.presented,
            hits: state.hits,
            misses: state.misses,
            false_alarms: state.false_alarms,
            correct_rejects: state.correct_rejects
          });
          return;
        }

        const entry = makeEntry();
        state.presented += 1;

        events.push({
          t_ms: Math.round(nowMs() - startTs),
          t_subtask_ms: tSubtaskMs(),
          type: 'sart_present',
          subtask_index: i,
          subtask_title: state.title,
          entry_id: entry.id,
          entry_class: entry.cls,
          dest: entry.dest,
          src_ip: entry.src_ip,
          action: entry.action,
          triage_action: entry.triage_action
        });

        state.entries.push(entry);
        while (state.entries.length > cfg.visible_entries) {
          const removed = state.entries.shift();
          recordMissIfNeeded(removed);
        }

        renderRows();
        setSafeTimeout(tick, cfg.scroll_interval_ms);
      };

      const startSartSubtask = () => {
        if (state.started) return;
        state.started = true;
        state.subtask_start_ts = nowMs();
        startWall = state.subtask_start_ts;
        stopAt = computeStopAt();

        if (statusEl) statusEl.textContent = 'Running…';

        events.push({
          t_ms: Math.round(nowMs() - startTs),
          t_subtask_ms: 0,
          type: 'sart_subtask_start',
          subtask_index: i,
          subtask_title: state.title
        });

        renderRows();
        setSafeTimeout(tick, 0);
      };

      subtaskAutoStart[i] = startSartSubtask;
      subtaskForceEnd[i] = (reason) => {
        if (state.ended) return;
        state.ended = true;
        if (statusEl) statusEl.textContent = 'Complete';
        events.push({
          t_ms: Math.round(nowMs() - startTs),
          t_subtask_ms: tSubtaskMs(),
          type: 'sart_subtask_forced_end',
          reason: (reason ?? 'forced').toString(),
          subtask_index: i,
          subtask_title: state.title
        });
      };

      renderRows();

      // Mount overlays on the full window so they can sit above the titlebar.
      windowInstructionsHost[i] = w;
      windowInstructionsTitle[i] = instructionsTitle;
      windowInstructionsHtml[i] = resolvedInstructionsHtml;
      maybeInstallWindowInstructions(i);
    }

    // Default keyboard focus to the first visible keyboard-relevant window.
    activeWindowIndex = pickFirstVisibleKeyboardWindow();

    function recordPointerEvent(e) {
      events.push({
        t_ms: Math.round(nowMs() - startTs),
        type: e.type,
        x: Number.isFinite(e.clientX) ? Math.round(e.clientX) : null,
        y: Number.isFinite(e.clientY) ? Math.round(e.clientY) : null
      });
    }

    function onDesktopClick(e) {
      const icon = e.target.closest('.soc-icon');
      if (!icon) return;
      if (!logIconClicks) return;

      const label = (icon.dataset.label || '').toString();
      const app = (icon.dataset.app || '').toString();
      events.push({
        t_ms: Math.round(nowMs() - startTs),
        type: 'icon_click',
        label: label || null,
        app: app || null,
        distractor: true
      });
    }

    const onKeyDown = (e) => {
      ensureActiveWindowVisible();
      const k = normalizeKeyName(e.key);
      let consumed = false;
      if (k === normalizeKeyName(endKey)) {
        e.preventDefault();
        endTrial('end_key');
        return;
      }

      // SART-like: apply keyboard go response to the active window (if configured for keyboard)
      const st = sartStates[activeWindowIndex];
      if (st && st.started && !st.ended && st.cfg && st.cfg.response_device === 'keyboard') {
        const goKey = normalizeKeyName(st.cfg.go_key);
        if (goKey && k === goKey) {
          e.preventDefault();
          consumed = true;
          const latest = st.entries.length ? st.entries[st.entries.length - 1] : null;
          if (latest) {
            // Inline response logic to avoid cross-closure lookups.
            const shouldGoFor = (entryClass) => {
              if (st.cfg.go_condition === 'target') return entryClass === 'target';
              if (st.cfg.go_condition === 'distractor') return entryClass === 'distractor';
              return false;
            };

            if (!st.responded.has(latest.id)) {
              st.responded.add(latest.id);

              // Apply action update for realism
              latest.triage_action = (st.cfg.go_condition === 'distractor') ? 'BLOCK' : 'ALLOW';

              const rt = Math.round(nowMs() - latest.createdAt);
              const correct = shouldGoFor(latest.cls);
              if (correct) st.hits += 1;
              else st.false_alarms += 1;

              events.push({
                t_ms: Math.round(nowMs() - startTs),
                type: 'sart_response',
                subtask_index: activeWindowIndex,
                subtask_title: st.title,
                device: 'keyboard',
                entry_id: latest.id,
                entry_class: latest.cls,
                triage_action: latest.triage_action,
                correct,
                rt_ms: rt
              });

              try {
                if (typeof st.renderRows === 'function') st.renderRows();
              } catch {
                // ignore
              }
            }
          }
        }
      }

      // N-back-like: apply keyboard response to the active window (keyboard-only)
      const nb = nbackStates[activeWindowIndex];
      if (nb && nb.started && !nb.ended && nb.cfg) {
        const p = nb.cfg.response_paradigm;
        if (p === 'go_nogo') {
          const gk = normalizeKeyName(nb.cfg.go_key);
          if (gk && k === gk) {
            e.preventDefault();
            consumed = true;
            try { nb.respond?.('match', 'keyboard', k); } catch { /* ignore */ }
          }
        } else {
          const mk = normalizeKeyName(nb.cfg.match_key || nb.cfg.go_key);
          const nk = normalizeKeyName(nb.cfg.nonmatch_key);
          if (mk && k === mk) {
            e.preventDefault();
            consumed = true;
            try { nb.respond?.('match', 'keyboard', k); } catch { /* ignore */ }
          } else if (nk && k === nk) {
            e.preventDefault();
            consumed = true;
            try { nb.respond?.('nonmatch', 'keyboard', k); } catch { /* ignore */ }
          }
        }
      }

      // WCST-like: apply keyboard response to the active window (if configured for keyboard)
      const wc = wcstStates[activeWindowIndex];
      if (wc && wc.started && !wc.ended && wc.cfg && wc.cfg.response_device === 'keyboard') {
        const keys = Array.isArray(wc.cfg.choice_keys) ? wc.cfg.choice_keys.map(normalizeKeyName) : [];
        const idx = keys.findIndex(x => x && k === x);
        if (idx >= 0) {
          e.preventDefault();
          consumed = true;
          try { wc.respond?.(idx, 'keyboard', k); } catch { /* ignore */ }
        }
      }

      // Flanker-like: apply keyboard response to the active window (keyboard-only)
      const fl = flankerStates[activeWindowIndex];
      if (fl && fl.started && !fl.ended && fl.cfg) {
        const ak = normalizeKeyName(fl.cfg.allow_key);
        const rk = normalizeKeyName(fl.cfg.reject_key);
        const isAllow = ak && k === ak;
        const isReject = rk && k === rk;

        // Normal in-window response
        if (fl.current && fl.current_prompt_ts && !fl.current_responded && (isAllow || isReject)) {
          consumed = true;
        }

        if (fl.current && fl.current_prompt_ts && !fl.current_responded && isAllow) {
          e.preventDefault();
          fl.current_responded = true;
          fl.responded += 1;

          const choseReject = false;
          const correct = (choseReject === !!fl.current.isRejectCorrect);
          if (correct) fl.correct += 1;
          else fl.incorrect += 1;

          const responseTs = nowMs();
          const promptTs = Number.isFinite(fl.current_prompt_ts) ? fl.current_prompt_ts : null;
          const rt = (promptTs === null) ? null : Math.max(0, Math.round(responseTs - promptTs));
          events.push({
            t_ms: Math.round(nowMs() - startTs),
            t_subtask_ms: tSubtaskMs(),
            type: 'flanker_response',
            subtask_index: activeWindowIndex,
            subtask_title: fl.title,
            stimulus_id: fl.current.id,
            trial_index: fl.current.trial_index ?? null,
            response: 'allow',
            response_key: k,
            correct,
            accuracy: correct ? 1 : 0,
            rt_ms: rt,
            prompt_t_ms: (promptTs === null) ? null : Math.round(promptTs - startTs),
            prompt_t_subtask_ms: (promptTs === null) ? null : Math.round(promptTs - (fl.subtask_start_ts || startTs)),
            response_t_ms: Math.round(responseTs - startTs),
            response_t_subtask_ms: Math.round(responseTs - (fl.subtask_start_ts || startTs)),
            deadline_t_ms: (promptTs === null) ? null : Math.round((promptTs + fl.cfg.response_window_ms) - startTs),
            deadline_t_subtask_ms: (promptTs === null) ? null : Math.round((promptTs + fl.cfg.response_window_ms) - (fl.subtask_start_ts || startTs)),
            center_level: fl.current.centerLevel,
            flanker_level: fl.current.flankerLevel,
            congruent: !!fl.current.congruent
          });

          try {
            if (fl.cfg.show_feedback) {
              const w = windowEls[activeWindowIndex];
              const statusEl = w?.querySelector?.(`#soc_flanker_status_${activeWindowIndex}`);
              if (statusEl) statusEl.textContent = correct ? 'Correct' : 'Incorrect';
            }
          } catch {
            // ignore
          }

          try {
            fl.promptEl && (fl.promptEl.style.opacity = '0');
            fl.promptEl && (fl.promptEl.style.color = '');
            fl.promptEl && (fl.promptEl.style.animation = '');
          } catch { /* ignore */ }

          try { fl.trialsById?.delete?.(fl.current.id); } catch { /* ignore */ }
          fl.current = null;
          fl.current_prompt_ts = null;
        } else if (fl.current && fl.current_prompt_ts && !fl.current_responded && isReject) {
          e.preventDefault();
          fl.current_responded = true;
          fl.responded += 1;

          const choseReject = true;
          const correct = (choseReject === !!fl.current.isRejectCorrect);
          if (correct) fl.correct += 1;
          else fl.incorrect += 1;

          const responseTs = nowMs();
          const promptTs = Number.isFinite(fl.current_prompt_ts) ? fl.current_prompt_ts : null;
          const rt = (promptTs === null) ? null : Math.max(0, Math.round(responseTs - promptTs));
          events.push({
            t_ms: Math.round(nowMs() - startTs),
            t_subtask_ms: tSubtaskMs(),
            type: 'flanker_response',
            subtask_index: activeWindowIndex,
            subtask_title: fl.title,
            stimulus_id: fl.current.id,
            trial_index: fl.current.trial_index ?? null,
            response: 'reject',
            response_key: k,
            correct,
            accuracy: correct ? 1 : 0,
            rt_ms: rt,
            prompt_t_ms: (promptTs === null) ? null : Math.round(promptTs - startTs),
            prompt_t_subtask_ms: (promptTs === null) ? null : Math.round(promptTs - (fl.subtask_start_ts || startTs)),
            response_t_ms: Math.round(responseTs - startTs),
            response_t_subtask_ms: Math.round(responseTs - (fl.subtask_start_ts || startTs)),
            deadline_t_ms: (promptTs === null) ? null : Math.round((promptTs + fl.cfg.response_window_ms) - startTs),
            deadline_t_subtask_ms: (promptTs === null) ? null : Math.round((promptTs + fl.cfg.response_window_ms) - (fl.subtask_start_ts || startTs)),
            center_level: fl.current.centerLevel,
            flanker_level: fl.current.flankerLevel,
            congruent: !!fl.current.congruent
          });

          try {
            if (fl.cfg.show_feedback) {
              const w = windowEls[activeWindowIndex];
              const statusEl = w?.querySelector?.(`#soc_flanker_status_${activeWindowIndex}`);
              if (statusEl) statusEl.textContent = correct ? 'Correct' : 'Incorrect';
            }
          } catch {
            // ignore
          }

          try {
            fl.promptEl && (fl.promptEl.style.opacity = '0');
            fl.promptEl && (fl.promptEl.style.color = '');
            fl.promptEl && (fl.promptEl.style.animation = '');
          } catch { /* ignore */ }

          try { fl.trialsById?.delete?.(fl.current.id); } catch { /* ignore */ }
          fl.current = null;
          fl.current_prompt_ts = null;
        } else if (!fl.current && (isAllow || isReject) && fl.last_closed_trial && Number.isFinite(fl.last_closed_at_ts)) {
          // Late keypress: attach to the most recent flanker trial if it just ended.
          const now = nowMs();
          const sinceClosed = Math.max(0, now - fl.last_closed_at_ts);
          if (sinceClosed <= Math.max(0, Number(fl.late_response_grace_ms) || 0)) {
            e.preventDefault();
            consumed = true;

            const choseReject = !!isReject;
            const shouldReject = !!fl.last_closed_trial.should_reject;
            const correct = (choseReject === shouldReject);

            const promptTs = Number.isFinite(fl.last_closed_trial.prompt_ts) ? fl.last_closed_trial.prompt_ts : null;
            const deadlineTs = Number.isFinite(fl.last_closed_trial.deadline_ts) ? fl.last_closed_trial.deadline_ts : null;

            const rt = (promptTs === null) ? null : Math.max(0, Math.round(now - promptTs));
            const lateness = (deadlineTs === null) ? null : Math.round(now - deadlineTs);

            events.push({
              t_ms: Math.round(now - startTs),
              t_subtask_ms: Math.round(now - (fl.subtask_start_ts || startTs)),
              type: 'flanker_late_response',
              subtask_index: activeWindowIndex,
              subtask_title: fl.title,
              stimulus_id: fl.last_closed_trial.stimulus_id,
              trial_index: fl.last_closed_trial.trial_index,
              response: choseReject ? 'reject' : 'allow',
              response_key: k,
              correct,
              accuracy: correct ? 1 : 0,
              rt_ms: rt,
              lateness_ms: lateness,
              prompt_t_ms: (promptTs === null) ? null : Math.round(promptTs - startTs),
              prompt_t_subtask_ms: (promptTs === null) ? null : Math.round(promptTs - (fl.subtask_start_ts || startTs)),
              response_t_ms: Math.round(now - startTs),
              response_t_subtask_ms: Math.round(now - (fl.subtask_start_ts || startTs)),
              deadline_t_ms: (deadlineTs === null) ? null : Math.round(deadlineTs - startTs),
              deadline_t_subtask_ms: (deadlineTs === null) ? null : Math.round(deadlineTs - (fl.subtask_start_ts || startTs)),
              center_level: fl.last_closed_trial.center_level,
              flanker_level: fl.last_closed_trial.flanker_level,
              congruent: !!fl.last_closed_trial.congruent,
              reject_rule: fl.last_closed_trial.reject_rule,
              should_reject: shouldReject,
              closed_reason: fl.last_closed_trial.closed_reason
            });

            // Prevent multiple late keys from attaching to the same closed trial.
            fl.last_closed_trial = null;
            fl.last_closed_at_ts = null;
          }
        }
      }

      // PVT-like: apply keyboard response to the active window (if configured for keyboard)
      const pv = pvtLikeStates[activeWindowIndex];
      if (pv && pv.started && !pv.ended && pv.cfg && pv.cfg.response_device === 'keyboard') {
        const rkRaw = (pv.cfg.response_key ?? ' ').toString();
        const isAll = rkRaw.trim().toUpperCase() === 'ALL_KEYS';
        const rk = normalizeKeyName(rkRaw);
        if (isAll || (rk && k === rk)) {
          e.preventDefault();
          consumed = true;
          try { pv.respond?.('keyboard', k); } catch { /* ignore */ }
        }
      }

      // Only log raw key events for keys that weren't consumed by a task.
      if (!consumed) {
        events.push({ t_ms: Math.round(nowMs() - startTs), type: 'key', key: k });
      }
    };

    const endTrial = (reason) => {
      if (ended) return;
      ended = true;

      clearAllTimers();

      shell.removeEventListener('click', recordPointerEvent, true);
      shell.removeEventListener('mousedown', recordPointerEvent, true);
      shell.removeEventListener('mouseup', recordPointerEvent, true);
      iconsHost.removeEventListener('click', onDesktopClick);
      document.removeEventListener('keydown', onKeyDown);

      try {
        const styleToRemove = display_element.querySelector('style[data-soc-dashboard="true"]');
        if (styleToRemove) styleToRemove.remove();
      } catch {
        // ignore
      }

      display_element.innerHTML = '';

      this.jsPsych.finishTrial({
        ended_reason: reason,
        active_app: 'tasks',
        events,
        subtasks_summary: {
          flanker_like: flankerStates
            .map((st, idx) => {
              if (!st) return null;
              const rts = events
                .filter((ev) => ev && ev.type === 'flanker_response' && ev.subtask_index === idx)
                .map((ev) => ev.rt_ms)
                .filter((v) => Number.isFinite(v));

              const meanRt = rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : null;
              const presented = Number(st.presented || 0);
              const responded = Number(st.responded || 0);
              const correct = Number(st.correct || 0);
              const incorrect = Number(st.incorrect || 0);
              const omissions = Number(st.omissions || 0);
              const accuracy = presented > 0 ? (correct / presented) : null;

              return {
                subtask_index: idx,
                subtask_title: st.title ?? null,
                started: !!st.started,
                ended: !!st.ended,
                presented,
                responded,
                correct,
                incorrect,
                omissions,
                accuracy,
                mean_rt_ms: meanRt
              };
            })
            .filter(Boolean),
          wcst_like: wcstStates
            .map((st, idx) => {
              if (!st) return null;
              const rts = events
                .filter((ev) => ev && ev.type === 'wcst_response' && ev.subtask_index === idx)
                .map((ev) => ev.rt_ms)
                .filter((v) => Number.isFinite(v));

              const meanRt = rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : null;
              const presented = Number(st.presented || 0);
              const responded = Number(st.responded || 0);
              const correct = Number(st.correct || 0);
              const incorrect = Number(st.incorrect || 0);
              const omissions = Number(st.omissions || 0);
              const accuracy = presented > 0 ? (correct / presented) : null;

              return {
                subtask_index: idx,
                subtask_title: st.title ?? null,
                started: !!st.started,
                ended: !!st.ended,
                presented,
                responded,
                correct,
                incorrect,
                omissions,
                accuracy,
                mean_rt_ms: meanRt,
                rule: st.current_rule ?? null,
                rule_index: Number.isFinite(st.rule_index) ? st.rule_index : null
              };
            })
            .filter(Boolean)
          ,
          pvt_like: pvtLikeStates
            .map((st, idx) => {
              if (!st) return null;
              const rts = events
                .filter((ev) => ev && ev.type === 'pvt_like_response' && ev.subtask_index === idx)
                .map((ev) => ev.rt_ms)
                .filter((v) => Number.isFinite(v));

              const meanRt = rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : null;
              const presented = Number(st.presented || 0);
              const responded = Number(st.responded || 0);
              const falseStarts = Number(st.false_starts || 0);
              const timeouts = Number(st.timeouts || 0);
              const accuracy = presented > 0 ? (responded / presented) : null;

              return {
                subtask_index: idx,
                subtask_title: st.title ?? null,
                started: !!st.started,
                ended: !!st.ended,
                presented,
                responded,
                false_starts: falseStarts,
                timeouts,
                accuracy,
                mean_rt_ms: meanRt
              };
            })
            .filter(Boolean)
        },
        plugin_version: info.version
      });
    };

    shell.appendChild(wallpaper);
    desktop.appendChild(iconsHost);
    desktop.appendChild(windows);
    shell.appendChild(desktop);
    display_element.appendChild(shell);

    // Scheduled windows: auto-show/auto-start and auto-hide/auto-end.
    for (let i = 0; i < windowsSpec.length; i++) {
      const sch = windowsSpec[i]?.schedule || { has_schedule: false, start_at_ms: 0, end_at_ms: null };
      if (!sch.has_schedule) continue;

      const startAt = Math.max(0, Math.floor(Number(sch.start_at_ms) || 0));
      const endAt = (sch.end_at_ms === null || sch.end_at_ms === undefined)
        ? null
        : Math.max(0, Math.floor(Number(sch.end_at_ms)));

      const doStart = () => {
        if (ended) return;
        showWindow(i);
        // If this subtask has instruction text, require the participant to click the popup to start.
        if (!windowStartIsGated[i]) {
          startWindowIfNeeded(i);
        }
      };

      if (startAt > 0) {
        setSafeTimeout(doStart, startAt);
      } else {
        doStart();
      }

      if (Number.isFinite(endAt)) {
        setSafeTimeout(() => {
          if (ended) return;
          forceEndWindow(i, 'scheduled_end');
          hideWindow(i);
        }, endAt);
      }
    }

    // Track last-clicked window for keyboard responses
    windows.addEventListener('mousedown', (e) => {
      const winEl = e.target.closest('.soc-appwin');
      if (!winEl) return;
      const idx = Array.from(windows.children).indexOf(winEl);
      if (idx >= 0) activeWindowIndex = idx;
    }, true);

    shell.addEventListener('click', recordPointerEvent, true);
    shell.addEventListener('mousedown', recordPointerEvent, true);
    shell.addEventListener('mouseup', recordPointerEvent, true);
    iconsHost.addEventListener('click', onDesktopClick);
    document.addEventListener('keydown', onKeyDown);

    if (Number.isFinite(trialMs) && trialMs > 0) {
      this.jsPsych.pluginAPI.setTimeout(() => {
        endTrial('timeout');
      }, trialMs);
    }
  };

  JsPsychSocDashboardPlugin.info = info;
  window.jsPsychSocDashboard = JsPsychSocDashboardPlugin;
})(window.jsPsychModule || window.jsPsych);
