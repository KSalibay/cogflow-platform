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
    name: 'pvt',
    version: '1.0.0',
    parameters: {
      response_device: {
        type: PT.SELECT,
        options: ['keyboard', 'mouse', 'both'],
        default: 'keyboard'
      },
      response_key: { type: PT.KEY, default: ' ' },

      foreperiod_ms: { type: PT.INT, default: 4000 },
      trial_duration_ms: { type: PT.INT, default: 10000 },
      iti_ms: { type: PT.INT, default: 0 },

      feedback_enabled: { type: PT.BOOL, default: false },
      feedback_message: { type: PT.HTML_STRING, default: '' }
    },
    data: {
      response_device: { type: PT.STRING },
      response_key: { type: PT.STRING },
      response_source: { type: PT.STRING },
      rt_ms: { type: PT.INT },
      timer_stop_ms: { type: PT.INT },

      foreperiod_ms: { type: PT.INT },
      trial_duration_ms: { type: PT.INT },

      false_start: { type: PT.BOOL },
      false_start_rt_ms: { type: PT.INT },

      feedback_enabled: { type: PT.BOOL },
      feedback_message: { type: PT.STRING },
      feedback_shown: { type: PT.BOOL },

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

  function norm(v) {
    return (v ?? '').toString().trim();
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

  function coerceDevice(raw, fallback) {
    const s = norm(raw).toLowerCase();
    if (s === 'keyboard' || s === 'mouse' || s === 'both') return s;
    const fb = norm(fallback).toLowerCase();
    if (fb === 'mouse' || fb === 'both') return fb;
    return 'keyboard';
  }

  function format4(n) {
    const x = Math.max(0, Math.min(9999, Math.floor(Number(n) || 0)));
    return x.toString().padStart(4, '0');
  }

  class JsPsychPvtPlugin {
    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element, trial) {
      const trialStartTs = nowMs();

      const responseDevice = coerceDevice(trial.response_device, 'keyboard');
      const responseKey = normalizeKeyName(trial.response_key || ' ');

      const foreperiodMs = Number.isFinite(Number(trial.foreperiod_ms)) ? Math.max(0, Number(trial.foreperiod_ms)) : 4000;
      const trialMs = Number.isFinite(Number(trial.trial_duration_ms)) ? Math.max(0, Number(trial.trial_duration_ms)) : 10000;

      const feedbackEnabled = (trial && trial.feedback_enabled === true);
      const feedbackMessage = (trial && trial.feedback_message !== undefined && trial.feedback_message !== null)
        ? String(trial.feedback_message)
        : '';

      let hasTarget = false;
      let targetOnsetTs = null;

      let responded = false;
      let responseSource = null;
      let rtMs = null;
      let timerStopMs = null;

      let falseStart = false;
      let falseStartRtMs = null;

      let rafId = null;
      let timeoutIds = [];
      let cleanupClickHandlers = null;

      const clearTimers = () => {
        for (const id of timeoutIds) {
          try { this.jsPsych.pluginAPI.clearTimeout(id); } catch { /* ignore */ }
        }
        timeoutIds = [];
        if (rafId !== null) {
          try { cancelAnimationFrame(rafId); } catch { /* ignore */ }
          rafId = null;
        }
      };

      const endTrial = (reason) => {
        clearTimers();
        this.jsPsych.pluginAPI.cancelAllKeyboardResponses();
        if (cleanupClickHandlers) cleanupClickHandlers();

        // Feedback is only shown for false starts (i.e., responses during the foreperiod).
        const shouldShowFeedback = feedbackEnabled && falseStart && feedbackMessage.trim() !== '';

        const payload = {
          plugin_type: 'pvt-trial',
          plugin_version: info.version,

          response_device: responseDevice,
          response_key: responseKey === ' ' ? 'space' : responseKey,
          response_source: responseSource,
          rt_ms: rtMs,
          timer_stop_ms: timerStopMs,

          foreperiod_ms: Math.round(foreperiodMs),
          trial_duration_ms: Math.round(trialMs),

          false_start: falseStart,
          false_start_rt_ms: falseStartRtMs,

          feedback_enabled: feedbackEnabled,
          feedback_message: feedbackMessage,
          feedback_shown: shouldShowFeedback,

          ended_reason: reason || (responded ? 'response' : 'deadline')
        };

        if (!shouldShowFeedback) {
          this.jsPsych.finishTrial(payload);
          return;
        }

        // Feedback screen. Keep it short to avoid changing ITI semantics.
        display_element.innerHTML = `
          <div style="position:relative; width:100%; min-height:100vh; padding:24px 12px; box-sizing:border-box; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;">
            <div style="max-width: 900px; font-size: 28px; line-height: 1.25; white-space: pre-wrap;">${feedbackMessage}</div>
          </div>
        `;

        const id = this.jsPsych.pluginAPI.setTimeout(() => {
          this.jsPsych.finishTrial(payload);
        }, 750);
        timeoutIds.push(id);
      };

      const recordResponse = (source) => {
        if (responded) return;
        responded = true;
        responseSource = source;

        if (!hasTarget) {
          falseStart = true;
          falseStartRtMs = Math.round(nowMs() - trialStartTs);
          rtMs = null;
          timerStopMs = null;
          endTrial('false_start');
          return;
        }

        const t = nowMs();
        rtMs = Math.round(t - targetOnsetTs);
        timerStopMs = Math.max(0, Math.min(9999, Math.floor(rtMs)));
        endTrial('response');
      };

      const wrapStyle = 'position:relative; width:100%; min-height:100vh; padding:24px 12px; box-sizing:border-box; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px; text-align:center;';
      const timerStyle = 'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 96px; letter-spacing: 0.08em; font-weight: 700;';
      const hintStyle = 'opacity:0.65; font-size: 12px;';

      const hintHtml = (() => {
        if (responseDevice === 'mouse') return '<div style="' + hintStyle + '">Click when the timer starts</div>';
        if (responseDevice === 'both') {
          return `<div style="${hintStyle}">Press ${esc(responseKey === ' ' ? 'SPACE' : responseKey.toUpperCase())} or click when the timer starts</div>`;
        }
        return `<div style="${hintStyle}">Press ${esc(responseKey === ' ' ? 'SPACE' : responseKey.toUpperCase())} when the timer starts</div>`;
      })();

      display_element.innerHTML = `
        <div id="pvt-wrap" style="${wrapStyle}">
          <div id="pvt-status" style="opacity:0.7; font-size:14px;">Get ready…</div>
          <div id="pvt-timer" style="${timerStyle}">0000</div>
          ${hintHtml}
        </div>
      `;

      const wrapEl = display_element.querySelector('#pvt-wrap');
      const statusEl = display_element.querySelector('#pvt-status');
      const timerEl = display_element.querySelector('#pvt-timer');

      // Mouse
      if ((responseDevice === 'mouse' || responseDevice === 'both') && wrapEl) {
        wrapEl.style.cursor = 'pointer';
        const onClick = () => recordResponse('mouse');
        wrapEl.addEventListener('click', onClick);
        cleanupClickHandlers = () => {
          try { wrapEl.removeEventListener('click', onClick); } catch { /* ignore */ }
        };
      }

      // Keyboard
      if (responseDevice === 'keyboard' || responseDevice === 'both') {
        const validKey = responseKey;
        const validKeys = Array.from(new Set(expandKeyVariants(validKey).map(normalizeKeyName)));

        this.jsPsych.pluginAPI.getKeyboardResponse({
          callback_function: (info) => {
            const k = normalizeKeyName(info && info.key);
            if (k !== validKey) return;
            recordResponse('keyboard');
          },
          valid_responses: validKeys,
          rt_method: 'performance',
          persist: true,
          allow_held_key: false
        });
      }

      const startTarget = () => {
        if (responded) return;
        hasTarget = true;
        targetOnsetTs = nowMs();
        if (statusEl) statusEl.textContent = 'Respond now';

        const updateLoop = () => {
          if (responded) return;
          const elapsed = nowMs() - targetOnsetTs;
          if (timerEl) timerEl.textContent = format4(elapsed);
          rafId = requestAnimationFrame(updateLoop);
        };

        rafId = requestAnimationFrame(updateLoop);

        // Deadline measured from target onset
        if (Number.isFinite(trialMs) && trialMs > 0) {
          const id = this.jsPsych.pluginAPI.setTimeout(() => {
            if (responded) return;
            // Show frozen timer at deadline
            const elapsed = nowMs() - targetOnsetTs;
            if (timerEl) timerEl.textContent = format4(elapsed);
            endTrial('deadline');
          }, trialMs);
          timeoutIds.push(id);
        }
      };

      // Foreperiod delay
      const foreId = this.jsPsych.pluginAPI.setTimeout(() => {
        if (responded) return;
        if (statusEl) statusEl.textContent = '';
        startTarget();
      }, foreperiodMs);
      timeoutIds.push(foreId);
    }
  }

  JsPsychPvtPlugin.info = info;
  window.jsPsychPvt = JsPsychPvtPlugin;
})(window.jsPsychModule || window.jsPsych);
