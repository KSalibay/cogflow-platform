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
    name: 'nback',
    version: '1.0.0',
    parameters: {
      n: { type: PT.INT, default: 2 },
      token: { type: PT.STRING, default: 'A' },
      is_match: { type: PT.BOOL, default: false },

      render_mode: { type: PT.STRING, default: 'token' },
      stimulus_template_html: { type: PT.HTML_STRING, default: '<div style="font-size:72px; font-weight:700; text-align:center;">{{TOKEN}}</div>' },

      stimulus_duration_ms: { type: PT.INT, default: 500 },
      isi_duration_ms: { type: PT.INT, default: 500 },
      trial_duration_ms: { type: PT.INT, default: 1000 },

      response_paradigm: { type: PT.STRING, default: 'go_nogo' },
      response_device: { type: PT.STRING, default: 'keyboard' },

      go_key: { type: PT.STRING, default: 'space' },
      match_key: { type: PT.STRING, default: 'j' },
      nonmatch_key: { type: PT.STRING, default: 'f' },
      show_buttons: { type: PT.BOOL, default: false },

      // Optional override (primarily for compiler-generated correctness)
      correct_response: { type: PT.STRING, default: null },

      show_feedback: { type: PT.BOOL, default: false },
      feedback_duration_ms: { type: PT.INT, default: 300 },

      show_fixation_cross_between_trials: { type: PT.BOOL, default: false },

      detection_response_task_enabled: { type: PT.BOOL, default: false }
    },
    data: {
      plugin_type: { type: PT.STRING },
      token: { type: PT.STRING },
      n: { type: PT.INT },
      is_match: { type: PT.BOOL },
      response_paradigm: { type: PT.STRING },
      response_device: { type: PT.STRING },
      response_key: { type: PT.STRING },
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

  class JsPsychNbackPlugin {
    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element, trial) {
      const n = Number.isFinite(Number(trial.n)) ? Math.max(1, Math.floor(Number(trial.n))) : 2;
      const token = (trial.token ?? '').toString() || 'A';
      const isMatch = trial.is_match === true;

      const renderMode = (trial.render_mode || 'token').toString().trim().toLowerCase();
      const templateHtml = (trial.stimulus_template_html ?? '<div style="font-size:72px; font-weight:700; text-align:center;">{{TOKEN}}</div>').toString();

      const stimMs = Number.isFinite(Number(trial.stimulus_duration_ms)) ? Number(trial.stimulus_duration_ms) : 500;
      const isiMs = Number.isFinite(Number(trial.isi_duration_ms)) ? Number(trial.isi_duration_ms) : 500;
      const derivedTrialMs = (Number.isFinite(stimMs) ? Math.max(0, stimMs) : 0) + (Number.isFinite(isiMs) ? Math.max(0, isiMs) : 0);
      const trialMsRaw = Number(trial.trial_duration_ms);
      const trialMs = Number.isFinite(trialMsRaw)
        ? trialMsRaw
        : derivedTrialMs;

      const responseParadigm = (trial.response_paradigm || 'go_nogo').toString().trim().toLowerCase();
      const responseDevice = (trial.response_device || 'keyboard').toString().trim().toLowerCase();

      const goKey = normalizeKeyName(trial.go_key || 'space');
      const matchKey = normalizeKeyName((trial.match_key ?? '').toString().trim() || 'j');
      const nonmatchKey = normalizeKeyName((trial.nonmatch_key ?? '').toString().trim() || 'f');

      const showButtons = trial.show_buttons === true;
      const showFeedback = trial.show_feedback === true;
      const feedbackMs = Number.isFinite(Number(trial.feedback_duration_ms)) ? Math.max(0, Number(trial.feedback_duration_ms)) : 0;

      const showFixationCrossBetweenTrials = trial.show_fixation_cross_between_trials === true;

      const computedCorrectResponse = (() => {
        if (typeof trial.correct_response === 'string' && trial.correct_response.trim()) {
          return normalizeKeyName(trial.correct_response);
        }

        if (responseParadigm === '2afc') {
          const mk = (trial.match_key ?? '').toString().trim() ? matchKey : goKey;
          return isMatch ? mk : nonmatchKey;
        }

        // go_nogo
        return isMatch ? goKey : null;
      })();

      const startTs = nowMs();
      let responded = false;
      let rt = null;
      let responseKey = null;
      let endedReason = null;

      const stimulusHtml = (() => {
        if (renderMode === 'custom_html') {
          const safeToken = esc(token);
          if (templateHtml.includes('{{TOKEN}}')) {
            return templateHtml.split('{{TOKEN}}').join(safeToken);
          }
          return `${templateHtml}${safeToken}`;
        }
        return `<div style="font-size:72px; font-weight:700; text-align:center;">${esc(token)}</div>`;
      })();

      const hintHtml = (() => {
        if (responseDevice === 'mouse') {
          if (!showButtons) return '<div style="opacity:0.7; font-size:12px;">Mouse response (buttons hidden)</div>';
          if (responseParadigm === '2afc') {
            return '<div style="opacity:0.7; font-size:12px;">Click MATCH or NO MATCH</div>';
          }
          return '<div style="opacity:0.7; font-size:12px;">Click GO</div>';
        }

        if (responseParadigm === '2afc') {
          const mk = (trial.match_key ?? '').toString().trim() ? matchKey : goKey;
          return `<div style="opacity:0.7; font-size:12px;">${esc(String(mk))} = match, ${esc(String(nonmatchKey))} = no match</div>`;
        }
        return `<div style="opacity:0.7; font-size:12px;">${esc(String(goKey))} = go</div>`;
      })();

      const buttonsHtml = (() => {
        if (responseDevice !== 'mouse' || !showButtons) return '';
        if (responseParadigm === '2afc') {
          return `
            <div style="display:flex; gap:10px; justify-content:center; margin-top:14px;">
              <button id="nback-btn-match" type="button" class="psy-btn">Match</button>
              <button id="nback-btn-nonmatch" type="button" class="psy-btn">No match</button>
            </div>
          `;
        }
        return `
          <div style="display:flex; gap:10px; justify-content:center; margin-top:14px;">
            <button id="nback-btn-go" type="button" class="psy-btn">Go</button>
          </div>
        `;
      })();

      display_element.innerHTML = `
        <div class="psy-wrap">
          <div class="psy-stage">
            <div style="width:min(900px, 100%); text-align:center;">
              <div id="nback-stim">${stimulusHtml}</div>
              <div id="nback-fix" style="visibility:hidden;"><div style="font-size:56px; font-weight:700; line-height:1;">+</div></div>
              <div style="margin-top:10px;">${hintHtml}</div>
              ${buttonsHtml}
              <div id="nback-feedback" style="margin-top:12px; min-height:22px; font-weight:650;"></div>
              <div style="margin-top:10px; opacity:0.6; font-size:12px;">n=${esc(n)} · ${isMatch ? 'MATCH' : 'NO MATCH'}</div>
            </div>
          </div>
        </div>
      `;

      const stimEl = display_element.querySelector('#nback-stim');
      const fixEl = display_element.querySelector('#nback-fix');
      const feedbackEl = display_element.querySelector('#nback-feedback');

      const computeCorrectness = () => {
        if (responseParadigm === '2afc') {
          if (!responded) return false;
          return responseKey === computedCorrectResponse;
        }

        // go_nogo
        if (isMatch) {
          return responded && responseKey === goKey;
        }
        return !responded;
      };

      const finish = (reason) => {
        const correctness = computeCorrectness();
        this.jsPsych.finishTrial({
          plugin_type: 'nback-block',
          plugin_version: info.version,
          token,
          n,
          is_match: isMatch,
          response_paradigm: responseParadigm,
          response_device: responseDevice,
          response_key: responseKey,
          rt_ms: rt,
          correctness,
          ended_reason: reason || endedReason || (responded ? 'response' : 'deadline')
        });
      };

      const endTrial = (reason) => {
        this.jsPsych.pluginAPI.cancelAllKeyboardResponses();

        const doFinish = () => finish(reason);

        if (showFeedback && feedbackEl && feedbackMs > 0) {
          const correctness = computeCorrectness();
          feedbackEl.textContent = correctness ? 'Correct' : 'Incorrect';
          feedbackEl.style.color = correctness ? '#86efac' : '#fca5a5';
          this.jsPsych.pluginAPI.setTimeout(() => {
            doFinish();
          }, feedbackMs);
          return;
        }

        doFinish();
      };

      const recordResponse = (rawKey, rawRtMs) => {
        if (responded) return;
        responded = true;
        responseKey = normalizeKeyName(rawKey);
        rt = Number.isFinite(Number(rawRtMs)) ? Math.round(Number(rawRtMs)) : null;
      };

      const afterKeyboard = (infoKbd) => {
        const k = normalizeKeyName(infoKbd && infoKbd.key !== undefined ? infoKbd.key : null);

        // Ignore keys that aren't part of this task.
        if (responseParadigm === '2afc') {
          const mk = (trial.match_key ?? '').toString().trim() ? matchKey : goKey;
          const ok = [mk, nonmatchKey].includes(k);
          if (!ok) return;
        } else {
          if (k !== goKey) return;
        }

        recordResponse(k, infoKbd && infoKbd.rt);
        endedReason = 'response';

        // If no deadline, end on response.
        if (!Number.isFinite(trialMs) || trialMs <= 0) {
          endTrial('response');
        }
      };

      // Mouse buttons
      if (responseDevice === 'mouse' && showButtons) {
        const btnGo = display_element.querySelector('#nback-btn-go');
        const btnMatch = display_element.querySelector('#nback-btn-match');
        const btnNonmatch = display_element.querySelector('#nback-btn-nonmatch');

        if (btnGo) {
          btnGo.onclick = () => {
            recordResponse(goKey, nowMs() - startTs);
            endedReason = 'response';
            if (!Number.isFinite(trialMs) || trialMs <= 0) endTrial('response');
          };
        }
        if (btnMatch) {
          btnMatch.onclick = () => {
            const mk = (trial.match_key ?? '').toString().trim() ? matchKey : goKey;
            recordResponse(mk, nowMs() - startTs);
            endedReason = 'response';
            if (!Number.isFinite(trialMs) || trialMs <= 0) endTrial('response');
          };
        }
        if (btnNonmatch) {
          btnNonmatch.onclick = () => {
            recordResponse(nonmatchKey, nowMs() - startTs);
            endedReason = 'response';
            if (!Number.isFinite(trialMs) || trialMs <= 0) endTrial('response');
          };
        }
      }

      // Stimulus offset
      if (Number.isFinite(stimMs) && stimMs > 0) {
        this.jsPsych.pluginAPI.setTimeout(() => {
          if (stimEl) stimEl.style.visibility = 'hidden';

          // Optional fixation cross during ISI/ITI
          if (showFixationCrossBetweenTrials && fixEl) {
            fixEl.style.visibility = 'visible';
          }
        }, stimMs);
      }

      // Keyboard listener
      if (responseDevice === 'keyboard') {
        const keys = (() => {
          if (responseParadigm === '2afc') {
            const mk = (trial.match_key ?? '').toString().trim() ? matchKey : goKey;
            return Array.from(new Set([
              ...expandKeyVariants(mk),
              ...expandKeyVariants(nonmatchKey)
            ]));
          }
          return Array.from(new Set(expandKeyVariants(goKey)));
        })();

        this.jsPsych.pluginAPI.getKeyboardResponse({
          callback_function: afterKeyboard,
          valid_responses: keys,
          rt_method: 'performance',
          persist: true,
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

  JsPsychNbackPlugin.info = info;
  window.jsPsychNback = JsPsychNbackPlugin;
})(window.jsPsychModule || window.jsPsych);
