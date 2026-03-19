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
    name: 'stroop',
    version: '1.0.0',
    parameters: {
      word: { type: PT.STRING, default: 'RED' },
      ink_color_name: { type: PT.STRING, default: 'BLUE' },
      ink_color_hex: { type: PT.STRING, default: '#0066ff' },

      // Optional context: list of {name, color}
      stimuli: { type: PT.COMPLEX, default: [] },

      response_mode: {
        type: PT.SELECT,
        options: ['color_naming', 'congruency'],
        default: 'color_naming'
      },
      response_device: {
        type: PT.SELECT,
        options: ['keyboard', 'mouse'],
        default: 'keyboard'
      },

      // color-naming keyboard mapping (same order as stimuli)
      choice_keys: { type: PT.KEYS, default: [] },

      // congruency keyboard mapping
      congruent_key: { type: PT.KEY, default: 'f' },
      incongruent_key: { type: PT.KEY, default: 'j' },

      congruency: { type: PT.STRING, default: 'auto' },

      stimulus_font_size_px: { type: PT.INT, default: 72 },
      stimulus_duration_ms: { type: PT.INT, default: 0 },
      trial_duration_ms: { type: PT.INT, default: 2000 },

      detection_response_task_enabled: { type: PT.BOOL, default: false }
    },
    data: {
      response_device: { type: PT.STRING },
      response_mode: { type: PT.STRING },
      word: { type: PT.STRING },
      ink_color_name: { type: PT.STRING },
      ink_color_hex: { type: PT.STRING },
      congruency: { type: PT.STRING },

      response_key: { type: PT.STRING },
      response_label: { type: PT.STRING },
      response_choice_index: { type: PT.INT },
      response_choice_name: { type: PT.STRING },
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

  function findStimulusColorHex(stimuli, inkName, fallbackHex) {
    const needle = norm(inkName).toLowerCase();
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

  function computeCongruency(word, inkName) {
    const w = norm(word).toLowerCase();
    const i = norm(inkName).toLowerCase();
    if (!w || !i) return 'auto';
    return (w === i) ? 'congruent' : 'incongruent';
  }

  class JsPsychStroopPlugin {
    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element, trial) {
      const startTs = nowMs();
      let responded = false;
      let responseKey = null;
      let responseLabel = null;
      let responseChoiceIndex = null;
      let responseChoiceName = null;
      let rt = null;

      const stimuli = Array.isArray(trial.stimuli) ? trial.stimuli : [];

      const responseMode = norm(trial.response_mode || 'color_naming').toLowerCase();
      const responseDevice = norm(trial.response_device || 'keyboard').toLowerCase();

      // If a trial omits word/ink, prefer the provided stimuli list over built-in defaults.
      const stimulusNames = stimuli.map((s) => norm(s && s.name)).filter(Boolean);

      const word = norm(trial.word || '') || (stimulusNames[0] || 'RED');
      const inkColorName = norm(trial.ink_color_name || '') || (stimulusNames[1] || stimulusNames[0] || 'BLUE');
      const inkColorHex = findStimulusColorHex(stimuli, inkColorName, trial.ink_color_hex);

      // Always compute congruency from the realized word/ink values.
      // (Configs or Block generation can otherwise carry a stale label that breaks scoring.)
      const congruency = computeCongruency(word, inkColorName);

      const fontSizePx = Number.isFinite(Number(trial.stimulus_font_size_px)) ? Number(trial.stimulus_font_size_px) : 72;
      const stimMs = Number.isFinite(Number(trial.stimulus_duration_ms)) ? Number(trial.stimulus_duration_ms) : 0;
      const trialMs = Number.isFinite(Number(trial.trial_duration_ms)) ? Number(trial.trial_duration_ms) : 2000;

      const endTrial = (reason) => {
        this.jsPsych.pluginAPI.cancelAllKeyboardResponses();

        const correctness = (() => {
          if (!responded) return null;

          if (responseMode === 'congruency') {
            if (responseLabel !== 'congruent' && responseLabel !== 'incongruent') return null;
            return responseLabel === congruency;
          }

          // color_naming
          const inkNeedle = inkColorName.toLowerCase();
          const choice = (responseChoiceName || '').toString().trim().toLowerCase();
          if (!inkNeedle || !choice) return null;
          return choice === inkNeedle;
        })();

        this.jsPsych.finishTrial({
          plugin_type: 'stroop-trial',
          plugin_version: info.version,

          response_device: responseDevice,
          response_mode: responseMode,

          word,
          ink_color_name: inkColorName,
          ink_color_hex: inkColorHex,
          congruency,

          response_key: responseKey,
          response_label: responseLabel,
          response_choice_index: responseChoiceIndex,
          response_choice_name: responseChoiceName,
          rt_ms: rt,
          correctness,

          ended_reason: reason || (responded ? 'response' : 'deadline')
        });
      };

      const recordResponse = ({ key = null, label = null, choiceIndex = null, choiceName = null }) => {
        if (responded) return;

        responded = true;
        responseKey = key !== null ? normalizeKeyName(key) : null;
        responseLabel = label;
        responseChoiceIndex = Number.isFinite(Number(choiceIndex)) ? Number(choiceIndex) : null;
        responseChoiceName = (choiceName !== null && choiceName !== undefined) ? String(choiceName) : null;
        rt = Math.round(nowMs() - startTs);
        endTrial('response');
      };

      const buttonsHtml = (() => {
        if (responseDevice !== 'mouse') return '';

        if (responseMode === 'congruency') {
          return `
            <div id="stroop-buttons" style="display:flex; gap:12px; flex-wrap:wrap; justify-content:center;">
              <button class="btn btn-outline-light" data-stroop-label="congruent" style="min-width: 160px;">Congruent</button>
              <button class="btn btn-outline-light" data-stroop-label="incongruent" style="min-width: 160px;">Incongruent</button>
            </div>
          `;
        }

        // color_naming
        const safeStimuli = Array.isArray(stimuli) ? stimuli : [];
        const btns = safeStimuli.map((s, idx) => {
          const label = norm(s && s.name) || `Choice ${idx + 1}`;
          const color = norm(s && (s.color || s.hex || s.color_hex)) || '#666666';
          return `
            <button class="btn btn-outline-light" data-stroop-choice-index="${idx}" data-stroop-choice-name="${esc(label)}"
              style="min-width: 140px; border-color: rgba(255,255,255,0.35);">
              <span style="display:inline-block; width: 12px; height: 12px; border-radius: 50%; background:${esc(color)}; margin-right:8px; vertical-align:middle;"></span>
              <span>${esc(label)}</span>
            </button>
          `;
        }).join('');

        return `<div id="stroop-buttons" style="display:flex; gap:10px; flex-wrap:wrap; justify-content:center;">${btns}</div>`;
      })();

      const keyboardHintHtml = (() => {
        if (responseDevice !== 'keyboard') return '';

        if (responseMode === 'congruency') {
          const ck = normalizeKeyName(trial.congruent_key || 'f');
          const ik = normalizeKeyName(trial.incongruent_key || 'j');
          return `<div style="opacity:0.65; font-size: 12px;">${esc(String(ck))} = congruent, ${esc(String(ik))} = incongruent</div>`;
        }

        const keys = Array.isArray(trial.choice_keys) ? trial.choice_keys : [];
        const mapped = keys.map((k, idx) => `${esc(String(normalizeKeyName(k)))} → ${esc(norm(stimuli[idx] && stimuli[idx].name) || `#${idx + 1}`)}`);
        return mapped.length > 0
          ? `<div style="opacity:0.65; font-size: 12px; text-align:center;">${mapped.join(' &nbsp;&nbsp; ')} </div>`
          : `<div style="opacity:0.65; font-size: 12px;">Respond using the keyboard.</div>`;
      })();

      display_element.innerHTML = `
        <div id="stroop-wrap" style="position:relative; width:100%; min-height:100vh; padding:24px 12px; box-sizing:border-box; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px; text-align:center;">
          <div id="stroop-stim" style="font-size:${Math.max(10, fontSizePx)}px; font-weight:800; letter-spacing: 0.08em; color:${esc(inkColorHex)};">${esc(word)}</div>
          ${buttonsHtml}
          ${keyboardHintHtml}
        </div>
      `;

      const stimEl = display_element.querySelector('#stroop-stim');

      // Stimulus offset
      if (Number.isFinite(stimMs) && stimMs > 0) {
        this.jsPsych.pluginAPI.setTimeout(() => {
          if (stimEl) stimEl.style.visibility = 'hidden';
        }, stimMs);
      }

      // Mouse clicks
      if (responseDevice === 'mouse') {
        const btnWrap = display_element.querySelector('#stroop-buttons');
        if (btnWrap) {
          btnWrap.addEventListener('click', (ev) => {
            const t = ev && ev.target;
            if (!t) return;

            const btn = t.closest && t.closest('button');
            if (!btn) return;

            const label = btn.getAttribute('data-stroop-label');
            const idxRaw = btn.getAttribute('data-stroop-choice-index');
            const name = btn.getAttribute('data-stroop-choice-name');

            if (label) {
              recordResponse({ label });
              return;
            }

            if (idxRaw !== null && idxRaw !== undefined) {
              const idx = Number.parseInt(idxRaw, 10);
              const choiceName = name || (stimuli[idx] && stimuli[idx].name) || null;
              recordResponse({ choiceIndex: idx, choiceName });
            }
          });
        }
      }

      // Keyboard response
      if (responseDevice === 'keyboard') {
        if (responseMode === 'congruency') {
          const ck = normalizeKeyName(trial.congruent_key || 'f');
          const ik = normalizeKeyName(trial.incongruent_key || 'j');
          const validKeys = Array.from(new Set([
            ...expandKeyVariants(ck),
            ...expandKeyVariants(ik)
          ]));

          this.jsPsych.pluginAPI.getKeyboardResponse({
            callback_function: (info) => {
              const k = normalizeKeyName(info && info.key);
              const label = (k === ck) ? 'congruent' : (k === ik ? 'incongruent' : null);
              recordResponse({ key: k, label });
            },
            valid_responses: validKeys,
            rt_method: 'performance',
            persist: false,
            allow_held_key: false
          });
        } else {
          const keys = Array.isArray(trial.choice_keys) ? trial.choice_keys : [];
          const normalizedKeys = keys.map(k => normalizeKeyName(k));
          const validKeys = Array.from(new Set(normalizedKeys.flatMap(expandKeyVariants)));

          this.jsPsych.pluginAPI.getKeyboardResponse({
            callback_function: (info) => {
              const k = normalizeKeyName(info && info.key);
              const idx = normalizedKeys.findIndex(x => x === k);
              const choiceName = idx >= 0 ? ((stimuli[idx] && stimuli[idx].name) || null) : null;
              recordResponse({ key: k, choiceIndex: idx >= 0 ? idx : null, choiceName });
            },
            valid_responses: validKeys,
            rt_method: 'performance',
            persist: false,
            allow_held_key: false
          });
        }
      }

      // Deadline
      if (Number.isFinite(trialMs) && trialMs > 0) {
        this.jsPsych.pluginAPI.setTimeout(() => {
          endTrial('deadline');
        }, trialMs);
      }
    }
  }

  JsPsychStroopPlugin.info = info;
  window.jsPsychStroop = JsPsychStroopPlugin;
})(window.jsPsychModule || window.jsPsych);
