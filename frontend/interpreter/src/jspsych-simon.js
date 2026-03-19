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
    name: 'simon',
    version: '1.0.0',
    parameters: {
      stimulus_side: {
        type: PT.SELECT,
        options: ['left', 'right'],
        default: 'left'
      },
      stimulus_color_name: { type: PT.STRING, default: 'BLUE' },
      stimulus_color_hex: { type: PT.STRING, default: '#0066ff' },

      // Optional context: list of {name, color}
      stimuli: { type: PT.COMPLEX, default: [] },

      correct_response_side: {
        type: PT.SELECT,
        options: ['left', 'right'],
        default: 'left'
      },

      response_device: {
        type: PT.SELECT,
        options: ['keyboard', 'mouse'],
        default: 'keyboard'
      },
      left_key: { type: PT.KEY, default: 'f' },
      right_key: { type: PT.KEY, default: 'j' },

      circle_diameter_px: { type: PT.INT, default: 140 },

      stimulus_duration_ms: { type: PT.INT, default: 0 },
      trial_duration_ms: { type: PT.INT, default: 1500 },

      detection_response_task_enabled: { type: PT.BOOL, default: false }
    },
    data: {
      stimulus_side: { type: PT.STRING },
      stimulus_color_name: { type: PT.STRING },
      stimulus_color_hex: { type: PT.STRING },
      correct_response_side: { type: PT.STRING },
      congruency: { type: PT.STRING },

      response_device: { type: PT.STRING },
      response_key: { type: PT.STRING },
      response_side: { type: PT.STRING },
      rt_ms: { type: PT.INT },
      correctness: { type: PT.BOOL },
      ended_reason: { type: PT.STRING },
      plugin_version: { type: PT.STRING }
    }
  };

  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function esc(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function norm(s) {
    return (s ?? '').toString().trim();
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

  function findStimulusColorHex(stimuli, name, fallbackHex) {
    const needle = norm(name).toLowerCase();
    const list = Array.isArray(stimuli) ? stimuli : [];
    for (const s of list) {
      const n = norm(s && s.name).toLowerCase();
      if (n && n === needle) {
        const c = norm(s && (s.color || s.hex || s.color_hex));
        if (c) return c;
      }
    }
    return norm(fallbackHex) || '#ffffff';
  }

  function coerceSide(raw, fallback) {
    const s = norm(raw).toLowerCase();
    if (s === 'left' || s === 'right') return s;
    return fallback;
  }

  class JsPsychSimonPlugin {
    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element, trial) {
      const startTs = nowMs();
      let responded = false;
      let responseKey = null;
      let responseSide = null;
      let rt = null;

      const stimuli = Array.isArray(trial.stimuli) ? trial.stimuli : [];

      const stimulusSide = coerceSide(trial.stimulus_side, 'left');
      const correctSide = coerceSide(trial.correct_response_side, 'left');
      const congruency = (stimulusSide === correctSide) ? 'congruent' : 'incongruent';

      const responseDevice = norm(trial.response_device || 'keyboard').toLowerCase() === 'mouse' ? 'mouse' : 'keyboard';

      const stimulusColorName = norm(trial.stimulus_color_name || '');
      const stimulusColorHex = findStimulusColorHex(stimuli, stimulusColorName, trial.stimulus_color_hex);

      const leftKey = normalizeKeyName(trial.left_key || 'f');
      const rightKey = normalizeKeyName(trial.right_key || 'j');

      const diameterPx = Number.isFinite(Number(trial.circle_diameter_px)) ? Math.max(10, Number(trial.circle_diameter_px)) : 140;
      const stimMs = Number.isFinite(Number(trial.stimulus_duration_ms)) ? Number(trial.stimulus_duration_ms) : 0;
      const trialMs = Number.isFinite(Number(trial.trial_duration_ms)) ? Number(trial.trial_duration_ms) : 1500;

      const endTrial = (reason) => {
        this.jsPsych.pluginAPI.cancelAllKeyboardResponses();
        if (cleanupClickHandlers) cleanupClickHandlers();

        const correctness = responded ? (responseSide === correctSide) : null;

        this.jsPsych.finishTrial({
          plugin_type: 'simon-trial',
          plugin_version: info.version,

          stimulus_side: stimulusSide,
          stimulus_color_name: stimulusColorName,
          stimulus_color_hex: stimulusColorHex,
          correct_response_side: correctSide,
          congruency,

          response_device: responseDevice,
          response_key: responseKey,
          response_side: responseSide,
          rt_ms: rt,
          correctness,

          ended_reason: reason || (responded ? 'response' : 'deadline')
        });
      };

      const recordResponse = (side, key) => {
        if (responded) return;
        responded = true;
        responseSide = side;
        responseKey = key !== null && key !== undefined ? normalizeKeyName(key) : null;
        rt = Math.round(nowMs() - startTs);
        endTrial('response');
      };

      const circleStyle = `width:${diameterPx}px; height:${diameterPx}px; border-radius:999px; border:2px solid rgba(255,255,255,0.35); background:rgba(255,255,255,0.08);`;
      const leftBg = stimulusSide === 'left' ? stimulusColorHex : 'rgba(255,255,255,0.08)';
      const rightBg = stimulusSide === 'right' ? stimulusColorHex : 'rgba(255,255,255,0.08)';

      const hintHtml = (responseDevice === 'keyboard')
        ? `<div style="opacity:0.65; font-size: 12px; text-align:center;">${esc(leftKey)} = LEFT, ${esc(rightKey)} = RIGHT</div>`
        : `<div style="opacity:0.65; font-size: 12px; text-align:center;">Click LEFT or RIGHT</div>`;

      display_element.innerHTML = `
        <div id="simon-wrap" style="position:relative; width:100%; min-height:100vh; padding:24px 12px; box-sizing:border-box; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px; text-align:center;">
          <div id="simon-stage" style="display:flex; align-items:center; justify-content:center; gap:64px;">
            <div id="simon-left" data-simon-side="left" style="${circleStyle} background:${esc(leftBg)};"></div>
            <div id="simon-right" data-simon-side="right" style="${circleStyle} background:${esc(rightBg)};"></div>
          </div>
          ${hintHtml}
        </div>
      `;

      const leftEl = display_element.querySelector('#simon-left');
      const rightEl = display_element.querySelector('#simon-right');
      const stageEl = display_element.querySelector('#simon-stage');

      // Stimulus offset
      if (Number.isFinite(stimMs) && stimMs > 0) {
        this.jsPsych.pluginAPI.setTimeout(() => {
          try {
            if (leftEl) leftEl.style.background = 'rgba(255,255,255,0.08)';
            if (rightEl) rightEl.style.background = 'rgba(255,255,255,0.08)';
          } catch {
            // ignore
          }
        }, stimMs);
      }

      // Mouse clicks
      let cleanupClickHandlers = null;
      if (responseDevice === 'mouse' && stageEl) {
        stageEl.style.cursor = 'pointer';
        const onClick = (ev) => {
          const t = ev && ev.target;
          if (!t) return;
          const hit = t.closest && t.closest('[data-simon-side]');
          if (!hit) return;
          const side = hit.getAttribute('data-simon-side');
          if (side !== 'left' && side !== 'right') return;
          recordResponse(side, null);
        };
        stageEl.addEventListener('click', onClick);
        cleanupClickHandlers = () => {
          try { stageEl.removeEventListener('click', onClick); } catch { /* ignore */ }
        };
      }

      // Keyboard response
      if (responseDevice === 'keyboard') {
        const validKeys = Array.from(new Set([
          ...expandKeyVariants(leftKey),
          ...expandKeyVariants(rightKey)
        ]));

        this.jsPsych.pluginAPI.getKeyboardResponse({
          callback_function: (info) => {
            const k = normalizeKeyName(info && info.key);
            const side = (k === leftKey) ? 'left' : (k === rightKey ? 'right' : null);
            if (!side) return;
            recordResponse(side, k);
          },
          valid_responses: validKeys,
          rt_method: 'performance',
          persist: false,
          allow_held_key: false
        });
      }

      // Deadline
      if (Number.isFinite(trialMs) && trialMs > 0) {
        this.jsPsych.pluginAPI.setTimeout(() => {
          endTrial('deadline');
        }, trialMs);
      }
    }
  }

  JsPsychSimonPlugin.info = info;
  window.jsPsychSimon = JsPsychSimonPlugin;
})(window.jsPsychModule || window.jsPsych);
