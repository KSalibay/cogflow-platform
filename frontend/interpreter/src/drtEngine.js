(function () {
  function isObject(x) {
    return !!x && typeof x === 'object' && !Array.isArray(x);
  }

  function clamp(x, lo, hi) {
    const n = Number(x);
    if (!Number.isFinite(n)) return lo;
    return Math.max(lo, Math.min(hi, n));
  }

  function nowMs() {
    // Prefer high-res timers for RT.
    return (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
  }

  function safeKeyLabel(raw) {
    const s = (raw ?? '').toString().trim();
    if (!s) return 'space';
    return s;
  }

  function safeColor(raw) {
    const s = (raw ?? '').toString().trim();
    return s ? s : '#ff3b3b';
  }

  function normalizeConfig(raw) {
    const c = isObject(raw) ? raw : {};

    const minIti = clamp(c.min_iti_ms ?? c.min_interval_ms ?? 3000, 50, 600000);
    const maxIti = clamp(c.max_iti_ms ?? c.max_interval_ms ?? 5000, 50, 600000);
    const minItiMs = Math.min(minIti, maxIti);
    const maxItiMs = Math.max(minIti, maxIti);

    const stimulusDurationMs = clamp(c.stimulus_duration_ms ?? 1000, 10, 60000);

    // Response acceptance bounds (ms after onset). Defaults match the Builder.
    // Backwards-compat: if legacy response_window_ms exists, treat it as max_rt_ms.
    const minRt = clamp(c.min_rt_ms ?? 100, 0, 60000);
    const maxRtCandidate = c.max_rt_ms ?? c.response_window_ms ?? 2500;
    const maxRt = clamp(maxRtCandidate, 10, 60000);
    const minRtMs = Math.min(minRt, maxRt);
    const maxRtMs = Math.max(minRt, maxRt);

    const stimulusTypeRaw = (c.stimulus_type ?? 'square').toString().trim().toLowerCase();
    const stimulusType = (stimulusTypeRaw === 'circle' || stimulusTypeRaw === 'square') ? stimulusTypeRaw : 'square';
    const stimulusColor = safeColor(c.stimulus_color);

    const location = (c.location ?? 'top-right').toString().trim().toLowerCase();
    const allowedLocations = new Set(['top-right', 'top-left', 'bottom-right', 'bottom-left']);
    const loc = allowedLocations.has(location) ? location : 'top-right';

    const sizePx = clamp(c.size_px ?? 18, 6, 80);

    return {
      segment_label: (c.segment_label ?? '').toString(),
      response_key: safeKeyLabel(c.response_key ?? 'space'),
      min_iti_ms: minItiMs,
      max_iti_ms: maxItiMs,
      stimulus_duration_ms: stimulusDurationMs,
      min_rt_ms: minRtMs,
      max_rt_ms: maxRtMs,
      stimulus_type: stimulusType,
      stimulus_color: stimulusColor,
      location: loc,
      size_px: sizePx
    };
  }

  function ensureOverlay() {
    const id = 'psy-drt-overlay';
    let el = document.getElementById(id);
    if (el) return el;

    el = document.createElement('div');
    el.id = id;
    el.style.position = 'fixed';
    el.style.zIndex = '2147483647';
    el.style.pointerEvents = 'none';
    el.style.width = '0px';
    el.style.height = '0px';

    const dot = document.createElement('div');
    dot.id = 'psy-drt-dot';
    dot.style.width = '18px';
    dot.style.height = '18px';
    dot.style.borderRadius = '0px';
    dot.style.background = '#ff3b3b';
    dot.style.boxShadow = '0 0 0 6px rgba(255,255,255,0.08)';
    dot.style.opacity = '0';
    dot.style.transition = 'opacity 50ms linear';

    el.appendChild(dot);
    document.body.appendChild(el);
    return el;
  }

  function positionOverlay(container, location, sizePx) {
    const dot = container && container.querySelector ? container.querySelector('#psy-drt-dot') : null;
    if (!dot) return;

    dot.style.width = `${sizePx}px`;
    dot.style.height = `${sizePx}px`;

    const margin = 18;
    container.style.left = '';
    container.style.right = '';
    container.style.top = '';
    container.style.bottom = '';

    if (location === 'top-left') {
      container.style.left = `${margin}px`;
      container.style.top = `${margin}px`;
    } else if (location === 'bottom-left') {
      container.style.left = `${margin}px`;
      container.style.bottom = `${margin}px`;
    } else if (location === 'bottom-right') {
      container.style.right = `${margin}px`;
      container.style.bottom = `${margin}px`;
    } else {
      container.style.right = `${margin}px`;
      container.style.top = `${margin}px`;
    }
  }

  function styleStimulus(container, stimulusType, stimulusColor) {
    const dot = container && container.querySelector ? container.querySelector('#psy-drt-dot') : null;
    if (!dot) return;

    dot.style.borderRadius = (stimulusType === 'circle') ? '999px' : '0px';
    dot.style.background = safeColor(stimulusColor);
  }

  function tryWriteJsPsychRow(row) {
    // jsPsych v8 does not reliably support injecting *new* arbitrary rows into its
    // DataCollection. To guarantee DRT rows are exportable, we buffer them.
    try {
      if (!Array.isArray(window.__psy_drt_rows)) window.__psy_drt_rows = [];
      window.__psy_drt_rows.push(row);
      return true;
    } catch {
      return false;
    }
  }

  const state = {
    running: false,
    cfg: null,
    segment_index: 0,
    segment_id: null,
    overlay: null,

    nextTimer: null,
    offTimer: null,
    missTimer: null,

    stimulus_index: 0,
    stimulus_onset_ms: null,
    stimulus_visible: false,
    responded: false,

    trial: null,

    keyListener: null
  };

  function clearTimers() {
    if (state.nextTimer) { clearTimeout(state.nextTimer); state.nextTimer = null; }
    if (state.offTimer) { clearTimeout(state.offTimer); state.offTimer = null; }
    if (state.missTimer) { clearTimeout(state.missTimer); state.missTimer = null; }
  }

  function clearOffTimer() {
    if (state.offTimer) { clearTimeout(state.offTimer); state.offTimer = null; }
  }

  function finalizeTrial({ scheduleNextIfNeeded = false } = {}) {
    if (!state.trial) return;

    // Prevent this finalize from firing again.
    if (state.missTimer) {
      clearTimeout(state.missTimer);
      state.missTimer = null;
    }

    const minRtMs = Number(state.cfg?.min_rt_ms) || 0;
    const maxRtMs = Number(state.cfg?.max_rt_ms) || 0;

    const responded = (state.trial.response_count || 0) > 0;
    const rt = (state.trial.rt_ms === undefined) ? null : state.trial.rt_ms;
    const withinBounds = responded && Number.isFinite(rt) && rt >= minRtMs && rt <= maxRtMs;
    const correct = responded && withinBounds && (state.trial.response_count === 1);

    const row = {
      plugin_type: 'drt',
      task_type: 'drt',
      drt_segment_id: state.segment_id,
      drt_segment_label: state.cfg ? (state.cfg.segment_label || null) : null,

      // Trial identifiers
      drt_trial_number: state.trial.trial_number,
      drt_stimulus_index: state.trial.trial_number,

      // Timing
      drt_onset_ms: state.trial.onset_ms,
      drt_onset_unix_ms: state.trial.onset_unix_ms,
      drt_onset_iso: state.trial.onset_iso,

      // Response summary
      drt_response_key: state.cfg ? state.cfg.response_key : null,
      drt_response_count: state.trial.response_count,
      drt_key: state.trial.key || null,
      drt_responded: responded,
      drt_rt_ms: responded ? (Number.isFinite(rt) ? rt : null) : null,
      drt_correct: correct
    };

    tryWriteJsPsychRow(row);

    state.trial = null;
    state.stimulus_onset_ms = null;

    if (scheduleNextIfNeeded && !state.nextTimer) {
      scheduleNextStimulus();
    }
  }

  function hideStimulus() {
    const dot = state.overlay ? state.overlay.querySelector('#psy-drt-dot') : null;
    if (dot) dot.style.opacity = '0';
    state.stimulus_visible = false;
  }

  function scheduleNextStimulus() {
    if (!state.running) return;
    const cfg = state.cfg;

    const span = Math.max(0, Number(cfg.max_iti_ms) - Number(cfg.min_iti_ms));
    const u = Math.random();
    const delay = Number(cfg.min_iti_ms) + span * u;

    state.nextTimer = setTimeout(() => {
      presentStimulus();
    }, Math.max(0, Math.round(delay)));
  }

  function presentStimulus() {
    if (!state.running) return;

    // If a prior trial is still open (possible if ITI < max_rt_ms), finalize it.
    finalizeTrial({ scheduleNextIfNeeded: false });
    clearTimers();

    state.stimulus_index += 1;
    state.responded = false;
    const onsetMs = nowMs();
    const onsetUnixMs = Date.now();
    const onsetIso = new Date(onsetUnixMs).toISOString();

    state.stimulus_onset_ms = onsetMs;
    state.trial = {
      trial_number: state.stimulus_index,
      onset_ms: onsetMs,
      onset_unix_ms: onsetUnixMs,
      onset_iso: onsetIso,
      response_count: 0,
      rt_ms: null,
      key: null
    };
    state.stimulus_visible = true;

    const dot = state.overlay ? state.overlay.querySelector('#psy-drt-dot') : null;
    if (dot) dot.style.opacity = '1';

    // Hide stimulus after stimulus_duration_ms.
    state.offTimer = setTimeout(() => {
      hideStimulus();
    }, Math.max(0, Math.round(Number(state.cfg.stimulus_duration_ms) || 0)));

    // Finalize trial after max_rt_ms (miss if no response).
    state.missTimer = setTimeout(() => {
      if (!state.running) return;
      hideStimulus();
      // If the trial ended with no response, schedule next stimulus now.
      finalizeTrial({ scheduleNextIfNeeded: true });
    }, Math.max(0, Math.round(Number(state.cfg.max_rt_ms) || 0)));
  }

  function onKeyDown(ev) {
    if (!state.running) return;
    if (!state.trial) return;

    const key = (ev && typeof ev.key === 'string') ? ev.key : '';

    // Map common labels.
    const expected = (state.cfg.response_key || 'space').toString().trim().toLowerCase();
    const k = (key || '').toString();

    const isSpace = (expected === 'space' || expected === ' ');
    const match = isSpace ? (k === ' ' || k.toLowerCase() === 'spacebar') : (k.toLowerCase() === expected);
    if (!match) return;

    const t = nowMs();
    const rt = t - state.trial.onset_ms;

    // Only count responses during the acceptance window.
    const maxRtMs = Number(state.cfg.max_rt_ms) || 0;
    if (!Number.isFinite(rt) || rt < 0 || rt > maxRtMs) {
      return;
    }

    state.trial.response_count = (state.trial.response_count || 0) + 1;

    // First response: store RT + key, hide stimulus, and schedule next stimulus.
    if (!state.responded) {
      state.responded = true;
      state.trial.rt_ms = Number.isFinite(rt) ? rt : null;
      state.trial.key = k;

      clearOffTimer();
      hideStimulus();
      scheduleNextStimulus();
    }
  }

  function start(rawCfg) {
    const cfg = normalizeConfig(rawCfg);

    // If already running, stop and restart (keeps segments clean).
    if (state.running) {
      stop();
    }

    state.segment_index += 1;
    state.segment_id = `drt_${state.segment_index}`;

    state.cfg = cfg;
    state.overlay = ensureOverlay();
    positionOverlay(state.overlay, cfg.location, cfg.size_px);
    styleStimulus(state.overlay, cfg.stimulus_type, cfg.stimulus_color);
    hideStimulus();

    state.running = true;
    state.stimulus_index = 0;
    state.stimulus_onset_ms = null;
    state.responded = false;
    state.trial = null;

    state.keyListener = onKeyDown;
    window.addEventListener('keydown', state.keyListener, { capture: true });

    tryWriteJsPsychRow({
      plugin_type: 'drt',
      task_type: 'drt',
      drt_event: 'start',
      drt_segment_id: state.segment_id,
      drt_segment_label: cfg.segment_label || null,
      drt_settings: cfg
    });

    scheduleNextStimulus();

    return { ok: true, segment_id: state.segment_id, settings: cfg };
  }

  function stop() {
    if (!state.running) {
      return { ok: true, stopped: false };
    }

    state.running = false;
    finalizeTrial({ scheduleNextIfNeeded: false });
    clearTimers();
    hideStimulus();
    state.stimulus_onset_ms = null;

    if (state.keyListener) {
      try { window.removeEventListener('keydown', state.keyListener, { capture: true }); } catch { /* ignore */ }
      // Fallback (some browsers treat listener options object identity specially)
      try { window.removeEventListener('keydown', state.keyListener, true); } catch { /* ignore */ }
      state.keyListener = null;
    }

    const segId = state.segment_id;
    const label = state.cfg ? state.cfg.segment_label : null;

    tryWriteJsPsychRow({
      plugin_type: 'drt',
      task_type: 'drt',
      drt_event: 'stop',
      drt_segment_id: segId,
      drt_segment_label: label || null
    });

    state.cfg = null;
    state.segment_id = null;

    return { ok: true, stopped: true, segment_id: segId };
  }

  window.DrtEngine = {
    start,
    stop,
    isRunning: () => state.running === true
  };
})();
