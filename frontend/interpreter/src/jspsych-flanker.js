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
    name: 'flanker',
    version: '1.0.0',
    parameters: {
      stimulus_type: { type: PT.STRING, default: 'arrows' },
      target_direction: { type: PT.STRING, default: 'left' },
      congruency: { type: PT.STRING, default: 'congruent' },

      target_stimulus: { type: PT.STRING, default: 'H' },
      distractor_stimulus: { type: PT.STRING, default: 'S' },
      neutral_stimulus: { type: PT.STRING, default: '–' },

      left_key: { type: PT.STRING, default: 'f' },
      right_key: { type: PT.STRING, default: 'j' },

      stimulus_duration_ms: { type: PT.INT, default: 800 },
      trial_duration_ms: { type: PT.INT, default: 1500 },

      show_fixation_dot: { type: PT.BOOL, default: false },
      show_fixation_cross_between_trials: { type: PT.BOOL, default: false },

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

  function buildArrowString(targetDir, congruency) {
    const t = (targetDir === 'right') ? '→' : '←';
    const o = (targetDir === 'right') ? '←' : '→';
    const n = '–';

    let flank;
    if (congruency === 'congruent') flank = t;
    else if (congruency === 'incongruent') flank = o;
    else flank = n;

    return `${flank}${flank}${t}${flank}${flank}`;
  }

  function buildCharString(target, distractor, neutral, congruency) {
    let flank;
    if (congruency === 'congruent') flank = target;
    else if (congruency === 'incongruent') flank = distractor;
    else flank = neutral;

    return `${flank}${flank}${target}${flank}${flank}`;
  }

  class JsPsychFlankerPlugin {
    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element, trial) {
      const stimulusType = (trial.stimulus_type || 'arrows').toString().trim().toLowerCase();
      const targetDirection = (trial.target_direction || 'left').toString().trim().toLowerCase();
      const congruency = (trial.congruency || 'congruent').toString().trim().toLowerCase();

      const leftKey = normalizeKeyName(trial.left_key || 'f');
      const rightKey = normalizeKeyName(trial.right_key || 'j');
      const correctKey = (targetDirection === 'right') ? rightKey : leftKey;

      const stimMs = Number.isFinite(Number(trial.stimulus_duration_ms)) ? Number(trial.stimulus_duration_ms) : 800;
      const trialMs = Number.isFinite(Number(trial.trial_duration_ms)) ? Number(trial.trial_duration_ms) : 1500;

      const drtEnabled = trial.detection_response_task_enabled === true;
      const drtKey = ' ';
      let drtShown = false;
      let drtOnsetTs = null;
      let drtRt = null;

      const startTs = nowMs();
      let responded = false;
      let rt = null;
      let responseKey = null;

      const stimText = (() => {
        if (stimulusType === 'arrows') {
          return buildArrowString(targetDirection, congruency);
        }

        const target = (trial.target_stimulus ?? 'H').toString();
        const distractor = (trial.distractor_stimulus ?? 'S').toString();
        const neutral = (trial.neutral_stimulus ?? '–').toString();
        return buildCharString(target, distractor, neutral, congruency);
      })();

      const fixationHtml = (trial.show_fixation_dot || trial.show_fixation_cross_between_trials)
        ? `<div style="height:40px; display:flex; align-items:center; justify-content:center; opacity:0.9;">${trial.show_fixation_dot ? '•' : '+'}</div>`
        : '';

      display_element.innerHTML = `
        <div id="flanker-wrap" style="position:relative; width:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px;">
          ${fixationHtml}
          <div id="flanker-stim" style="font-size:64px; letter-spacing: 0.2em; font-weight:700;">${esc(stimText)}</div>
          <div style="opacity:0.65; font-size: 12px;">${esc(String(leftKey))} = left, ${esc(String(rightKey))} = right</div>
        </div>
      `;

      const stimEl = display_element.querySelector('#flanker-stim');
      const wrapEl = display_element.querySelector('#flanker-wrap');

      const endTrial = (reason) => {
        this.jsPsych.pluginAPI.cancelAllKeyboardResponses();

        const accuracy = responded ? (responseKey === correctKey) : null;

        this.jsPsych.finishTrial({
          plugin_type: 'flanker-trial',
          end_reason: reason || (responded ? 'response' : 'deadline'),
          target_direction: targetDirection,
          congruency,
          response_key: responseKey,
          correct_key: correctKey,
          rt_ms: rt,
          accuracy,
          correctness: accuracy,
          ...(drtEnabled ? { drt_enabled: true, drt_shown: drtShown, drt_rt_ms: drtRt } : {})
        });
      };

      const afterResponse = (info) => {
        if (responded) return;

        const rawKey = info && info.key !== undefined ? info.key : null;
        const k = normalizeKeyName(rawKey);

        // DRT capture should not count as a primary response.
        if (drtEnabled && k === drtKey) {
          if (drtShown && drtRt === null && drtOnsetTs) {
            drtRt = Math.round(nowMs() - drtOnsetTs);
          }
          return;
        }

        responded = true;
        responseKey = k;
        rt = Math.round(info.rt);
        endTrial('response');
      };

      // Stimulus offset
      if (Number.isFinite(stimMs) && stimMs > 0) {
        this.jsPsych.pluginAPI.setTimeout(() => {
          if (stimEl) stimEl.style.visibility = 'hidden';
        }, stimMs);
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
        ...expandKeyVariants(leftKey),
        ...expandKeyVariants(rightKey)
      ]));
      this.jsPsych.pluginAPI.getKeyboardResponse({
        callback_function: afterResponse,
        valid_responses: validKeys.concat(drtEnabled ? [drtKey] : []),
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
    }
  }

  JsPsychFlankerPlugin.info = info;
  window.jsPsychFlanker = JsPsychFlankerPlugin;
})(window.jsPsychModule || window.jsPsych);
