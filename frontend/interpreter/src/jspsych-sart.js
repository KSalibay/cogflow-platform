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
    name: 'sart',
    version: '1.0.0',
    parameters: {
      digit: { type: PT.INT, default: 1 },
      nogo_digit: { type: PT.INT, default: 3 },
      go_key: { type: PT.STRING, default: 'space' },

      stimulus_duration_ms: { type: PT.INT, default: 250 },
      mask_duration_ms: { type: PT.INT, default: 900 },
      trial_duration_ms: { type: PT.INT, default: 1150 },

      show_fixation_dot: { type: PT.BOOL, default: false },
      show_fixation_cross_between_trials: { type: PT.BOOL, default: false },

      detection_response_task_enabled: { type: PT.BOOL, default: false }
    },
    data: {
      response_key: { type: PT.STRING },
      rt_ms: { type: PT.INT },
      correct: { type: PT.BOOL },
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

  function normalizeKeyName(raw) {
    const str = (raw ?? '').toString();
    // IMPORTANT: jsPsych reports the spacebar as the literal single-space character.
    // Never trim it, or it becomes '' and breaks comparisons.
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

  class JsPsychSartPlugin {
    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element, trial) {
      const digit = Number.isFinite(Number(trial.digit)) ? Number(trial.digit) : 1;
      const nogoDigit = Number.isFinite(Number(trial.nogo_digit)) ? Number(trial.nogo_digit) : 3;
      const isNoGo = digit === nogoDigit;

      const goKey = normalizeKeyName(trial.go_key || 'space');
      const drtEnabled = trial.detection_response_task_enabled === true;
      const drtKey = ' ';

      const stimMs = Number.isFinite(Number(trial.stimulus_duration_ms)) ? Number(trial.stimulus_duration_ms) : 250;
      const maskMs = Number.isFinite(Number(trial.mask_duration_ms)) ? Number(trial.mask_duration_ms) : 900;
      const trialMs = Number.isFinite(Number(trial.trial_duration_ms)) ? Number(trial.trial_duration_ms) : (stimMs + maskMs);

      const fixationHtml = (trial.show_fixation_dot || trial.show_fixation_cross_between_trials)
        ? `<div style="height:40px; display:flex; align-items:center; justify-content:center; opacity:0.9;">${trial.show_fixation_dot ? '•' : '+'}</div>`
        : '';

      display_element.innerHTML = `
        <div id="sart-wrap" style="position:relative; width:100%; min-height:100vh; padding:24px 12px; box-sizing:border-box; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; text-align:center;">
          ${fixationHtml}
          <div style="height:88px; display:flex; align-items:center; justify-content:center;">
            <div id="sart-stim" style="font-size:72px; line-height:1; width:1.2ch; min-width:1.2ch; min-height:1em; font-weight:800; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-variant-numeric: tabular-nums; text-align:center;">${esc(String(digit))}</div>
          </div>
          <div style="opacity:0.65; font-size: 12px;">Press ${esc(goKey === ' ' ? 'space' : goKey)} for GO (do not press for ${esc(String(nogoDigit))})</div>
        </div>
      `;

      const stimEl = display_element.querySelector('#sart-stim');
      const wrapEl = display_element.querySelector('#sart-wrap');

      let responded = false;
      let responseKey = null;
      let rt = null;

      let drtShown = false;
      let drtOnsetTs = null;
      let drtRt = null;

      const endTrial = (reason) => {
        this.jsPsych.pluginAPI.cancelAllKeyboardResponses();

        const correct = (() => {
          if (!responded) {
            return isNoGo ? true : false;
          }
          // responded
          if (isNoGo) return false;
          return responseKey === goKey;
        })();

        this.jsPsych.finishTrial({
          plugin_type: 'sart-trial',
          plugin_version: info.version,
          ended_reason: reason || (responded ? 'response' : 'deadline'),
          digit,
          nogo_digit: nogoDigit,
          is_nogo: isNoGo,
          response_key: responseKey,
          correct,
          rt_ms: rt,
          ...(drtEnabled ? { drt_enabled: true, drt_shown: drtShown, drt_rt_ms: drtRt } : {})
        });
      };

      const afterResponse = (info) => {
        const rawKey = info && info.key !== undefined ? info.key : null;
        const k = normalizeKeyName(rawKey);

        // If DRT is enabled and uses the same key as GO (often space), record DRT RT *and*
        // still treat it as a main-task response (we cannot disambiguate).
        if (drtEnabled && k === drtKey) {
          if (drtShown && drtRt === null && drtOnsetTs) {
            drtRt = Math.round(nowMs() - drtOnsetTs);
          }
          if (k !== goKey) return;
        }

        // Only treat the configured GO key as a response. Other keys are ignored.
        if (k !== goKey) return;

        if (responded) return;
        responded = true;
        responseKey = k;
        rt = Number.isFinite(info && info.rt) ? Math.round(info.rt) : null;
      };

      // Stimulus -> mask transition
      if (Number.isFinite(stimMs) && stimMs > 0) {
        this.jsPsych.pluginAPI.setTimeout(() => {
          if (stimEl) stimEl.textContent = '#';
        }, stimMs);
      }

      // Mask -> blank (optional)
      if (Number.isFinite(maskMs) && maskMs > 0) {
        this.jsPsych.pluginAPI.setTimeout(() => {
          if (stimEl) stimEl.textContent = '\u00A0';
        }, stimMs + maskMs);
      }

      // DRT schedule
      if (drtEnabled) {
        const minDelay = 300;
        const maxDelay = Math.max(minDelay, Math.floor(Math.max(1, trialMs) * 0.75));
        const delay = minDelay + Math.floor(Math.random() * Math.max(1, (maxDelay - minDelay)));

        this.jsPsych.pluginAPI.setTimeout(() => {
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

      // Keyboard response
      const validKeys = Array.from(new Set([
        ...expandKeyVariants(goKey).map(normalizeKeyName),
        ...(drtEnabled && drtKey !== goKey ? expandKeyVariants(drtKey).map(normalizeKeyName) : [])
      ]));

      this.jsPsych.pluginAPI.getKeyboardResponse({
        callback_function: afterResponse,
        valid_responses: validKeys,
        rt_method: 'performance',
        persist: true,
        allow_held_key: false
      });

      // Deadline
      if (Number.isFinite(trialMs) && trialMs > 0) {
        this.jsPsych.pluginAPI.setTimeout(() => {
          endTrial('deadline');
        }, trialMs);
      }

      // For go trials, we *still* wait to deadline to allow late responses; end condition is deadline.
      // If you want response-ends-trial behavior later, we can add a flag.
    }
  }

  JsPsychSartPlugin.info = info;
  window.jsPsychSart = JsPsychSartPlugin;
})(window.jsPsychModule || window.jsPsych);
