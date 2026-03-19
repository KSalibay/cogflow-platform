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
    name: 'gabor',
    version: '1.0.0',
    parameters: {
      // Task / response
      response_task: { type: PT.STRING, default: 'discriminate_tilt' },
      left_key: { type: PT.STRING, default: 'f' },
      right_key: { type: PT.STRING, default: 'j' },
      yes_key: { type: PT.STRING, default: 'f' },
      no_key: { type: PT.STRING, default: 'j' },

      // Stimulus definition
      target_location: { type: PT.STRING, default: 'left' }, // left|right|none
      target_tilt_deg: { type: PT.FLOAT, default: 45 },
      distractor_orientation_deg: { type: PT.FLOAT, default: 0 },
      spatial_cue: { type: PT.STRING, default: 'none' }, // none|left|right|both
      left_value: { type: PT.STRING, default: 'neutral' }, // neutral|high|low
      right_value: { type: PT.STRING, default: 'neutral' }, // neutral|high|low

      // Timings (defaults usually come from config.gabor_settings)
      fixation_ms: { type: PT.INT, default: 1000 },
      placeholders_ms: { type: PT.INT, default: 400 },
      cue_ms: { type: PT.INT, default: 300 },
      cue_delay_min_ms: { type: PT.INT, default: 100 },
      cue_delay_max_ms: { type: PT.INT, default: 200 },
      stimulus_duration_ms: { type: PT.INT, default: 67 },
      mask_duration_ms: { type: PT.INT, default: 67 },
      response_window_ms: { type: PT.INT, default: 1500 },

      // Gabor grating parameters
      spatial_frequency_cyc_per_px: { type: PT.FLOAT, default: 0.06 },
      grating_waveform: { type: PT.STRING, default: 'sinusoidal' },

      // Value cue colors
      high_value_color: { type: PT.STRING, default: '#00aa00' },
      low_value_color: { type: PT.STRING, default: '#0066ff' },
      neutral_value_color: { type: PT.STRING, default: '#666666' },

      // Patch border (circle around stimulus/mask + placeholders)
      patch_border_enabled: { type: PT.BOOL, default: true },
      patch_border_width_px: { type: PT.INT, default: 2 },
      patch_border_color: { type: PT.STRING, default: '#ffffff' },
      patch_border_opacity: { type: PT.FLOAT, default: 0.22 },

      // Grating contrast (0–1)
      contrast: { type: PT.FLOAT, default: 0.95 },

      // Post-trial feedback
      show_feedback: { type: PT.BOOL, default: false },
      feedback_duration_ms: { type: PT.INT, default: 800 },
      feedback_text_correct: { type: PT.STRING, default: 'Correct' },
      feedback_text_incorrect: { type: PT.STRING, default: 'Incorrect' },

      detection_response_task_enabled: { type: PT.BOOL, default: false }
    },
    data: {
      response_key: { type: PT.STRING },
      response_side: { type: PT.STRING },
      correct_side: { type: PT.STRING },
      rt_ms: { type: PT.INT },
      accuracy: { type: PT.FLOAT },
      correctness: { type: PT.BOOL },
      ended_reason: { type: PT.STRING },
      adaptive_mode: { type: PT.STRING },
      adaptive_parameter: { type: PT.STRING },
      adaptive_value: { type: PT.FLOAT },
      plugin_version: { type: PT.STRING }
    }
  };

  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
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

  function expandKeyVariants(key) {
    const k = (key || '').toString();
    if (k.length === 1 && /[a-z]/i.test(k)) {
      return [k.toLowerCase(), k.toUpperCase()];
    }
    return [k];
  }

  function clamp(n, lo, hi) {
    const x = Number(n);
    if (!Number.isFinite(x)) return lo;
    return Math.max(lo, Math.min(hi, x));
  }

  function getVisualAnglePxPerDeg() {
    try {
      const v = window.__psy_visual_angle;
      const pxPerDeg = v && Number.isFinite(Number(v.px_per_deg)) ? Number(v.px_per_deg) : null;
      return (pxPerDeg && pxPerDeg > 0) ? pxPerDeg : null;
    } catch {
      return null;
    }
  }

  function degToPx(deg) {
    const d = Number(deg);
    if (!Number.isFinite(d) || d <= 0) return null;
    const pxPerDeg = getVisualAnglePxPerDeg();
    if (!pxPerDeg) return null;
    return d * pxPerDeg;
  }

  function parseRgbLikeColor(color) {
    const s = (color || '').toString().trim();
    // rgb(r,g,b) or rgba(r,g,b,a)
    const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+)\s*)?\)\s*$/i.exec(s);
    if (!m) return null;
    const r = clamp(Number(m[1]), 0, 255);
    const g = clamp(Number(m[2]), 0, 255);
    const b = clamp(Number(m[3]), 0, 255);
    return { r, g, b };
  }

  function parseHexColor(color) {
    const s = (color || '').toString().trim();
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (!m) return null;
    const hex = m[1].toLowerCase();
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return { r, g, b };
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return { r, g, b };
  }

  function toRgba(color, alpha, fallback = { r: 255, g: 255, b: 255 }) {
    const a = clamp(alpha, 0, 1);
    const rgb = parseHexColor(color) || parseRgbLikeColor(color) || fallback;
    return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
  }

  function valueToFrameColor(value, highColor, lowColor, neutralColor) {
    if (value === 'high') return highColor;
    if (value === 'low') return lowColor;
    return neutralColor;
  }

  function drawRoundedRectStroke(ctx, x, y, width, height, radius, strokeStyle, lineWidth) {
    const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
    ctx.save();
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function drawFixation(ctx, x, y) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 10, y);
    ctx.lineTo(x + 10, y);
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x, y + 10);
    ctx.stroke();
    ctx.restore();
  }

  function drawCueDiamond(ctx, x, y, spatialCue) {
    if (!spatialCue || spatialCue === 'none') return;

    const size = 64;
    const half = size / 2;

    ctx.save();

    // Clip all fill variants to the diamond silhouette.
    ctx.beginPath();
    ctx.moveTo(x, y - half);
    ctx.lineTo(x + half, y);
    ctx.lineTo(x, y + half);
    ctx.lineTo(x - half, y);
    ctx.closePath();
    ctx.clip();

    // Fill left/right/both regions.
    if (spatialCue === 'left') {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(x - half, y - half, half, size);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x, y - half, half, size);
    } else if (spatialCue === 'right') {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x - half, y - half, half, size);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(x, y - half, half, size);
    } else if (spatialCue === 'both') {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(x - half, y - half, size, size);
    }

    ctx.restore();

    // Diamond border
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y - half);
    ctx.lineTo(x + half, y);
    ctx.lineTo(x, y + half);
    ctx.lineTo(x - half, y);
    ctx.closePath();
    ctx.stroke();

    // Fixation cross inside the cue
    ctx.strokeStyle = 'rgba(16,16,16,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 8, y);
    ctx.lineTo(x + 8, y);
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x, y + 8);
    ctx.stroke();
    ctx.restore();
  }

  function gratingValue(phaseRad, waveform) {
    const w = (waveform || 'sinusoidal').toString().trim().toLowerCase();
    if (w === 'square') {
      const s = Math.sin(phaseRad);
      return s >= 0 ? 1 : -1;
    }
    if (w === 'triangle') {
      // Triangle wave in [-1, 1]
      return (2 / Math.PI) * Math.asin(Math.sin(phaseRad));
    }
    // Default: sinusoidal
    return Math.cos(phaseRad);
  }

  function makeGaborImageData(ctx, sizePx, orientationDeg, {
    freq = 0.06,
    waveform = 'sinusoidal',
    sigmaFrac = 6,
    contrast = 0.95,
    phase = 0,
    debugStats = false
  } = {}) {
    const w = Math.max(8, Math.floor(sizePx));
    const h = w;
    const r = Math.floor(w / 2);
    const theta = (Number.isFinite(orientationDeg) ? orientationDeg : 0) * Math.PI / 180;

    // Nyquist-ish clamp: cycles/px must be <= 0.5 to avoid strong aliasing.
    const safeFreq = Math.max(0, Math.min(0.5, Number(freq) || 0));

    const sigma = w / sigmaFrac;
    const img = ctx.createImageData(w, h);
    const data = img.data;

    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const twoSigma2 = 2 * sigma * sigma;

    let minV = 255;
    let maxV = 0;
    let insideCount = 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - r;
        const dy = y - r;
        const rr = dx * dx + dy * dy;
        const idx = (y * w + x) * 4;

        if (rr > r * r) {
          data[idx + 0] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 0;
          continue;
        }

        const xRot = dx * cosT + dy * sinT;
        const envelope = Math.exp(-(rr) / twoSigma2);
        const grating = gratingValue(2 * Math.PI * safeFreq * xRot + phase, waveform);
        const val = 127.5 + 127.5 * contrast * envelope * grating;
        const v = Math.max(0, Math.min(255, Math.round(val)));

        data[idx + 0] = v;
        data[idx + 1] = v;
        data[idx + 2] = v;
        data[idx + 3] = 255;

        if (debugStats) {
          insideCount += 1;
          if (Number.isFinite(v)) {
            if (v < minV) minV = v;
            if (v > maxV) maxV = v;
          }
        }
      }
    }

    const stats = debugStats
      ? {
          safe_freq_cyc_per_px: safeFreq,
          min_v: (insideCount > 0 ? minV : null),
          max_v: (insideCount > 0 ? maxV : null),
          range_v: (insideCount > 0 ? (maxV - minV) : null),
          inside_px: insideCount
        }
      : null;

    return { img, r, stats };
  }

  function drawGaborPatch(ctx, centerX, centerY, sizePx, orientationDeg, { spatialFrequency, gratingWaveform, patchBorder, contrast, debug } = {}) {
    const { img, r, stats } = makeGaborImageData(ctx, sizePx, orientationDeg, {
      freq: spatialFrequency,
      waveform: gratingWaveform,
      contrast: (Number.isFinite(Number(contrast)) ? Number(contrast) : 0.95),
      debugStats: debug === true
    });
    ctx.putImageData(img, Math.round(centerX - r), Math.round(centerY - r));

    if (debug === true && stats) {
      const txt = `freq=${Number.isFinite(stats.safe_freq_cyc_per_px) ? stats.safe_freq_cyc_per_px.toFixed(4) : 'na'} cyc/px  range=${stats.range_v}`;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(Math.round(centerX - r) + 6, Math.round(centerY + r) - 28, 240, 22);
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.font = '14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
      ctx.textAlign = 'left';
      ctx.fillText(txt, Math.round(centerX - r) + 10, Math.round(centerY + r) - 12);
      ctx.restore();
    }

    const enabled = patchBorder?.enabled !== false;
    const lineWidth = clamp(patchBorder?.widthPx ?? 2, 0, 50);
    const opacity = clamp(patchBorder?.opacity ?? 0.22, 0, 1);
    const color = (patchBorder?.color ?? '#ffffff').toString();
    if (enabled && lineWidth > 0 && opacity > 0) {
      ctx.save();
      ctx.strokeStyle = toRgba(color, opacity);
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.arc(centerX, centerY, r - 1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawNoiseMask(ctx, centerX, centerY, sizePx, { patchBorder } = {}) {
    const w = Math.max(8, Math.floor(sizePx));
    const h = w;
    const r = Math.floor(w / 2);

    const img = ctx.createImageData(w, h);
    const data = img.data;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - r;
        const dy = y - r;
        const rr = dx * dx + dy * dy;
        const idx = (y * w + x) * 4;

        if (rr > r * r) {
          data[idx + 3] = 0;
          continue;
        }

        const v = Math.floor(Math.random() * 255);
        data[idx + 0] = v;
        data[idx + 1] = v;
        data[idx + 2] = v;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(img, Math.round(centerX - r), Math.round(centerY - r));

    const enabled = patchBorder?.enabled !== false;
    const lineWidth = clamp(patchBorder?.widthPx ?? 2, 0, 50);
    const opacity = clamp(patchBorder?.opacity ?? 0.18, 0, 1);
    const color = (patchBorder?.color ?? '#ffffff').toString();
    if (enabled && lineWidth > 0 && opacity > 0) {
      ctx.save();
      ctx.strokeStyle = toRgba(color, opacity);
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.arc(centerX, centerY, r - 1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function renderGaborScene(canvas, {
    phase,
    patchDiameterPx,
    spatialCue,
    leftFrameColor,
    rightFrameColor,
    leftAngle,
    rightAngle,
    spatialFrequency,
    gratingWaveform,
    patchBorder,
    contrast,
    showCue,
    showStimulus,
    showMask,
    debug
  }) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(0, 0, w, h);

    // Responsive layout
    const pad = 24;
    const minDim = Math.max(1, Math.min(w, h));
    const defaultPatchSize = clamp(Math.floor(minDim * 0.34), 160, 420);
    const provided = Number.isFinite(Number(patchDiameterPx)) ? Number(patchDiameterPx) : null;

    // Use researcher-controlled diameter when available; clamp to keep it on-screen.
    const patchSize = (provided && provided > 0)
      ? clamp(Math.round(provided), 40, Math.max(60, Math.floor(minDim * 0.85)))
      : defaultPatchSize;
    // Center stimulus vertically within the canvas.
    const cy = Math.floor(h / 2);
    const leftCx = Math.floor(w * 0.30);
    const rightCx = Math.floor(w * 0.70);

    // Circular value outlines directly around each patch (no padded square frame).
    const outlineRadius = Math.floor(patchSize / 2) - 1;
    ctx.save();
    ctx.lineWidth = 7;
    ctx.strokeStyle = leftFrameColor;
    ctx.beginPath();
    ctx.arc(leftCx, cy, outlineRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = rightFrameColor;
    ctx.beginPath();
    ctx.arc(rightCx, cy, outlineRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Cue
    if (showCue) {
      drawCueDiamond(ctx, Math.floor(w / 2), cy, spatialCue);
    }

    // Stimulus / mask
    if (showStimulus) {
      drawGaborPatch(ctx, leftCx, cy, patchSize, leftAngle, { spatialFrequency, gratingWaveform, patchBorder, contrast, debug });
      drawGaborPatch(ctx, rightCx, cy, patchSize, rightAngle, { spatialFrequency, gratingWaveform, patchBorder, contrast, debug });
    } else if (showMask) {
      drawNoiseMask(ctx, leftCx, cy, patchSize, { patchBorder });
      drawNoiseMask(ctx, rightCx, cy, patchSize, { patchBorder });
    }

    // Optional subtle label for debugging stages (off by default; can be enabled by CSS later)
    if (phase) {
      ctx.save();
      const isDebug = debug === true;
      ctx.fillStyle = isDebug ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.12)';
      ctx.font = isDebug
        ? '18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial'
        : '12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
      ctx.textAlign = 'left';
      ctx.fillText(String(phase), 10, h - 10);
      ctx.restore();
    }
  }

  function getGaborDebugEnabled(trial) {
    try {
      if (trial && trial.gabor_debug_enabled === true) return true;
      const qs = (window && window.location && typeof window.location.search === 'string') ? window.location.search : '';
      // `debug=1` is already used by the Interpreter for local data-download; it also
      // makes sense to slow Gabor down in that mode for visual inspection.
      return /[?&](?:debug|gabor_debug|debug_gabor)=1(?:&|$)/i.test(qs);
    } catch {
      return false;
    }
  }

  class JsPsychGaborPlugin {
    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element, trial) {
      const debugGabor = getGaborDebugEnabled(trial);

      const responseTask = (trial.response_task || 'discriminate_tilt').toString();
      const leftKey = normalizeKeyName(trial.left_key || 'f');
      const rightKey = normalizeKeyName(trial.right_key || 'j');
      const yesKey = normalizeKeyName(trial.yes_key || 'f');
      const noKey = normalizeKeyName(trial.no_key || 'j');

      const targetLocation = (trial.target_location ?? 'left').toString();
      const targetTilt = Number(trial.target_tilt_deg);
      const distractorOrientation = Number(trial.distractor_orientation_deg);
      const spatialCue = (trial.spatial_cue ?? 'none').toString();
      const leftValue = (trial.left_value ?? 'neutral').toString();
      const rightValue = (trial.right_value ?? 'neutral').toString();

      const spatialFrequency = Number.isFinite(Number(trial.spatial_frequency_cyc_per_px))
        ? Number(trial.spatial_frequency_cyc_per_px)
        : 0.06;
      const gratingWaveform = (trial.grating_waveform ?? 'sinusoidal').toString();

      const patchBorder = {
        enabled: (trial.patch_border_enabled !== undefined) ? !!trial.patch_border_enabled : true,
        widthPx: clamp(trial.patch_border_width_px ?? 2, 0, 50),
        color: (trial.patch_border_color ?? '#ffffff').toString(),
        opacity: clamp(trial.patch_border_opacity ?? 0.22, 0, 1)
      };

      const contrast = Number.isFinite(Number(trial.contrast)) ? clamp(Number(trial.contrast), 0, 1) : 0.95;
      const showFeedback = trial.show_feedback === true;
      const feedbackDurationMs = Math.max(0, Number(trial.feedback_duration_ms ?? 800) || 0);
      const fbTextCorrect = (trial.feedback_text_correct ?? 'Correct').toString();
      const fbTextIncorrect = (trial.feedback_text_incorrect ?? 'Incorrect').toString();

      // Optional researcher-controlled patch diameter.
      // Preferred: degrees-of-visual-angle via trial.patch_diameter_deg + prior visual-angle calibration.
      // Fallback: pixel diameter via trial.patch_diameter_px.
      const patchDiameterDeg = Number(trial.patch_diameter_deg);
      const patchDiameterPxDirect = Number(trial.patch_diameter_px);
      const patchDiameterPx = Number.isFinite(patchDiameterDeg)
        ? degToPx(patchDiameterDeg)
        : (Number.isFinite(patchDiameterPxDirect) ? patchDiameterPxDirect : null);

      const fixationMs = Math.max(0, Number(trial.fixation_ms ?? 1000) || 0);
      const placeholdersMs = Math.max(0, Number(trial.placeholders_ms ?? 400) || 0);
      const cueMs = Math.max(0, Number(trial.cue_ms ?? 300) || 0);
      const cueDelayMin = Math.max(0, Number(trial.cue_delay_min_ms ?? 100) || 0);
      const cueDelayMax = Math.max(0, Number(trial.cue_delay_max_ms ?? 200) || 0);

      // Default stimulus/mask durations are intentionally brief.
      // In debug mode, enforce a minimum so it's perceptually obvious whether the patch renders.
      const stimMs0 = Math.max(0, Number(trial.stimulus_duration_ms ?? 67) || 0);
      const maskMs0 = Math.max(0, Number(trial.mask_duration_ms ?? 67) || 0);
      const responseWindowMs0 = Math.max(0, Number(trial.response_window_ms ?? 1500) || 0);

      const stimMs = debugGabor ? Math.max(stimMs0, 350) : stimMs0;
      const maskMs = debugGabor ? Math.max(maskMs0, 250) : maskMs0;
      const responseWindowMs = debugGabor ? Math.max(responseWindowMs0, 2000) : responseWindowMs0;

      const highColor = (trial.high_value_color ?? '#00aa00').toString();
      const lowColor = (trial.low_value_color ?? '#0066ff').toString();
      const neutralColor = (trial.neutral_value_color ?? '#666666').toString();

      const leftFrameColor = valueToFrameColor(leftValue, highColor, lowColor, neutralColor);
      const rightFrameColor = valueToFrameColor(rightValue, highColor, lowColor, neutralColor);

      // Determine which angle goes on which side
      const leftAngle = (targetLocation === 'left') ? targetTilt : distractorOrientation;
      const rightAngle = (targetLocation === 'right') ? targetTilt : distractorOrientation;

      // Target-present inference (for detect_target). Allows future catch trials via JSON edit.
      const explicitPresent = (typeof trial.target_present === 'boolean') ? trial.target_present : null;
      const inferredPresent = (targetLocation === 'left' || targetLocation === 'right') && Number.isFinite(targetTilt);
      const targetPresent = (explicitPresent === null) ? inferredPresent : explicitPresent;

      const cueDelay = (() => {
        if (!Number.isFinite(cueDelayMin) || !Number.isFinite(cueDelayMax)) return 0;
        const lo = Math.min(cueDelayMin, cueDelayMax);
        const hi = Math.max(cueDelayMin, cueDelayMax);
        if (hi <= lo) return lo;
        return lo + Math.floor(Math.random() * (hi - lo + 1));
      })();

      const drtEnabled = trial.detection_response_task_enabled === true;
      const drtKey = ' ';
      let drtShown = false;
      let drtOnsetTs = null;
      let drtRt = null;

      let responded = false;
      let responseKey = null;
      let rt = null;

      let stimulusOnsetTs = null;
      let responseListenerStarted = false;

      let currentPhase = 'fixation';
      let currentRenderOpts = { showCue: false, showStimulus: false, showMask: false };

      const timeouts = [];
      const safeSetTimeout = (fn, ms) => {
        const id = this.jsPsych.pluginAPI.setTimeout(fn, ms);
        timeouts.push(id);
        return id;
      };

      let resizeHandler = null;

      const endTrial = (reason) => {
        this.jsPsych.pluginAPI.cancelAllKeyboardResponses();

        if (resizeHandler) {
          try { window.removeEventListener('resize', resizeHandler); } catch { /* ignore */ }
          resizeHandler = null;
        }

        // Best effort: clear pending timeouts
        if (typeof this.jsPsych.pluginAPI.clearAllTimeouts === 'function') {
          this.jsPsych.pluginAPI.clearAllTimeouts();
        } else {
          for (const id of timeouts) {
            try { clearTimeout(id); } catch { /* ignore */ }
          }
        }

        const correctness = (() => {
          if (!responded) return null;

          if (responseTask === 'detect_target') {
            const correctKey = targetPresent ? yesKey : noKey;
            return responseKey === correctKey;
          }

          // discriminate_tilt: map tilt sign to left/right key
          if (!Number.isFinite(targetTilt) || targetTilt === 0) return null;
          const correctKey = (targetTilt < 0) ? leftKey : rightKey;
          return responseKey === correctKey;
        })();

        const correctKeyOut = (() => {
          if (responseTask === 'detect_target') {
            return targetPresent ? yesKey : noKey;
          }
          if (!Number.isFinite(targetTilt) || targetTilt === 0) return null;
          return (targetTilt < 0) ? leftKey : rightKey;
        })();

        const trialData = {
          plugin_type: 'gabor-trial',
          end_reason: reason || (responded ? 'response' : 'deadline'),

          response_task: responseTask,
          target_location: targetLocation,
          target_present: targetPresent,
          target_tilt_deg: Number.isFinite(targetTilt) ? targetTilt : null,
          distractor_orientation_deg: Number.isFinite(distractorOrientation) ? distractorOrientation : null,
          spatial_cue: spatialCue,
          left_value: leftValue,
          right_value: rightValue,

          cue_delay_ms: cueDelay,

          response_key: responseKey,
          correct_key: correctKeyOut,
          rt_ms: rt,
          correct: correctness,
          accuracy: correctness,
          correctness,

          ...(typeof trial.spatial_cue_valid === 'boolean' ? { spatial_cue_valid: trial.spatial_cue_valid } : {}),
          ...(typeof trial.reward_available === 'boolean' ? { reward_available: trial.reward_available } : {}),
          ...(Number.isFinite(Number(trial.reward_availability_probability)) ? { reward_availability_probability: Number(trial.reward_availability_probability) } : {}),
          ...(typeof trial.value_target_value === 'string' && trial.value_target_value.trim() !== '' ? { value_target_value: trial.value_target_value } : {}),

          ...(drtEnabled ? { drt_enabled: true, drt_shown: drtShown, drt_rt_ms: drtRt } : {})
        };

        if (showFeedback && feedbackDurationMs > 0 && canvas) {
          const fbCtx = canvas.getContext('2d');
          if (fbCtx) {
            const fbText = (correctness === true) ? fbTextCorrect : (correctness === false) ? fbTextIncorrect : '';
            if (fbText) {
              const cw = canvas.width;
              const ch = canvas.height;
              const fbColor = (correctness === true) ? '#4caf50' : '#f44336';
              fbCtx.save();
              fbCtx.fillStyle = 'rgba(11,11,11,0.72)';
              fbCtx.fillRect(0, 0, cw, ch);
              fbCtx.font = `bold ${Math.round(clamp(ch * 0.10, 28, 72))}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
              fbCtx.fillStyle = fbColor;
              fbCtx.textAlign = 'center';
              fbCtx.textBaseline = 'middle';
              fbCtx.fillText(fbText, Math.floor(cw / 2), Math.floor(ch / 2));
              fbCtx.restore();
            }
          }
          window.setTimeout(() => { this.jsPsych.finishTrial(trialData); }, feedbackDurationMs);
        } else {
          this.jsPsych.finishTrial(trialData);
        }
      };

      // DOM
      display_element.innerHTML = `
        <div id="gabor-wrap" class="gabor-wrap">
          <div class="gabor-stage">
            <canvas id="gabor-canvas"></canvas>
            <div class="gabor-hint" id="gabor-hint"></div>
          </div>
        </div>
      `;

      const wrapEl = display_element.querySelector('#gabor-wrap');
      const canvas = display_element.querySelector('#gabor-canvas');

      const hintEl = display_element.querySelector('#gabor-hint');
      if (hintEl) {
        if (responseTask === 'detect_target') {
          hintEl.textContent = `${String(yesKey)} = yes, ${String(noKey)} = no`;
        } else {
          hintEl.textContent = `${String(leftKey)} = left tilt, ${String(rightKey)} = right tilt`;
        }
      }

      const fitCanvasToViewport = () => {
        if (!canvas) return;

        const vw = Math.max(1, window.innerWidth || 1);
        const vh = Math.max(1, window.innerHeight || 1);

        // Keep a 2:1 aspect ratio, but fill a meaningful portion of the viewport.
        const maxCssW = Math.min(1120, Math.floor(vw * 0.96));
        const maxCssH = Math.floor(vh * 0.80);

        let cssW = maxCssW;
        let cssH = Math.floor(cssW / 2);
        if (cssH > maxCssH) {
          cssH = maxCssH;
          cssW = Math.floor(cssH * 2);
        }

        cssW = clamp(cssW, 520, 2000);
        cssH = clamp(cssH, 260, 1400);

        canvas.style.width = `${Math.round(cssW)}px`;
        canvas.style.height = `${Math.round(cssH)}px`;
        canvas.width = Math.round(cssW);
        canvas.height = Math.round(cssH);
      };

      const render = (phase, opts) => {
        if (!canvas) return;

        currentPhase = phase || currentPhase;
        currentRenderOpts = opts || currentRenderOpts;

        renderGaborScene(canvas, {
          phase,
          patchDiameterPx,
          spatialCue,
          leftFrameColor,
          rightFrameColor,
          leftAngle,
          rightAngle,
          spatialFrequency,
          gratingWaveform,
          patchBorder,
          contrast,
          showCue: !!opts?.showCue,
          showStimulus: !!opts?.showStimulus,
          showMask: !!opts?.showMask,
          debug: debugGabor
        });
      };

      // Ensure the canvas fills the viewport nicely and stays centered.
      fitCanvasToViewport();
      resizeHandler = () => {
        fitCanvasToViewport();
        render(currentPhase, currentRenderOpts);
      };
      try { window.addEventListener('resize', resizeHandler); } catch { /* ignore */ }

      // Keyboard response handler (starts at stimulus onset)
      const startResponseListener = () => {
        if (responseListenerStarted) return;
        responseListenerStarted = true;

        const validKeys = (() => {
          if (responseTask === 'detect_target') {
            return Array.from(new Set([...expandKeyVariants(yesKey), ...expandKeyVariants(noKey)]));
          }
          return Array.from(new Set([...expandKeyVariants(leftKey), ...expandKeyVariants(rightKey)]));
        })();

        this.jsPsych.pluginAPI.getKeyboardResponse({
          callback_function: (info) => {
            const rawKey = info && info.key !== undefined ? info.key : null;
            const k = normalizeKeyName(rawKey);

            // DRT capture should not count as a primary response.
            if (drtEnabled && k === drtKey) {
              if (drtShown && drtRt === null && drtOnsetTs) {
                drtRt = Math.round(nowMs() - drtOnsetTs);
              }
              return;
            }

            if (responded) return;
            responded = true;
            responseKey = k;
            rt = stimulusOnsetTs ? Math.round(nowMs() - stimulusOnsetTs) : (Number.isFinite(info && info.rt) ? Math.round(info.rt) : null);
            endTrial('response');
          },
          valid_responses: validKeys.concat(drtEnabled ? [drtKey] : []),
          rt_method: 'performance',
          persist: true,
          allow_held_key: false
        });
      };

      // Phase schedule
      render('fixation', { showCue: false, showStimulus: false, showMask: false });

      // DRT schedule (during the post-stimulus response window by default)
      if (drtEnabled) {
        // Schedule after cue onset so it doesn't always overlap fixation.
        const totalPreStim = fixationMs + placeholdersMs + cueMs + cueDelay;
        const minDelay = totalPreStim + 150;
        const maxDelay = totalPreStim + Math.max(150, Math.floor((stimMs + maskMs + responseWindowMs) * 0.75));
        const delay = minDelay + Math.floor(Math.random() * Math.max(1, (maxDelay - minDelay)));

        safeSetTimeout(() => {
          drtShown = true;
          drtOnsetTs = nowMs();

          const el = document.createElement('div');
          el.id = 'drt-dot';
          el.style.cssText = 'position:absolute; top: 18px; left: 18px; width: 14px; height: 14px; border-radius: 50%; background: #FFD23F; box-shadow: 0 0 0 3px rgba(0,0,0,0.3);';

          if (wrapEl) {
            wrapEl.appendChild(el);
            window.setTimeout(() => {
              if (el && el.parentNode) el.remove();
            }, 200);
          }
        }, delay);
      }

      // Placeholders
      safeSetTimeout(() => {
        render('placeholders', { showCue: false, showStimulus: false, showMask: false });
      }, fixationMs);

      // Cue
      safeSetTimeout(() => {
        render('cue', { showCue: true, showStimulus: false, showMask: false });
      }, fixationMs + placeholdersMs);

      // Cue delay (cue off)
      safeSetTimeout(() => {
        render('cue-delay', { showCue: false, showStimulus: false, showMask: false });
      }, fixationMs + placeholdersMs + cueMs);

      // Stimulus
      safeSetTimeout(() => {
        stimulusOnsetTs = nowMs();
        render('stimulus', { showCue: false, showStimulus: true, showMask: false });
        startResponseListener();
      }, fixationMs + placeholdersMs + cueMs + cueDelay);

      // Mask
      safeSetTimeout(() => {
        render('mask', { showCue: false, showStimulus: false, showMask: true });
      }, fixationMs + placeholdersMs + cueMs + cueDelay + stimMs);

      // Post-mask response window (blank placeholders)
      safeSetTimeout(() => {
        render('response', { showCue: false, showStimulus: false, showMask: false });
      }, fixationMs + placeholdersMs + cueMs + cueDelay + stimMs + maskMs);

      // Deadline
      const deadlineMs = fixationMs + placeholdersMs + cueMs + cueDelay + stimMs + maskMs + responseWindowMs;
      if (deadlineMs > 0) {
        safeSetTimeout(() => {
          endTrial('deadline');
        }, deadlineMs);
      }
    }
  }

  JsPsychGaborPlugin.info = info;
  window.jsPsychGabor = JsPsychGaborPlugin;
})(window.jsPsychModule || window.jsPsych);
