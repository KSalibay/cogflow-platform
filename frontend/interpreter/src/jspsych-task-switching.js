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
    name: 'task-switching',
    version: '1.0.0',
    parameters: {
      task_index: { type: PT.INT, default: 1 },
      stimulus: { type: PT.STRING, default: 'A' },
      stimulus_task_1: { type: PT.STRING, default: '' },
      stimulus_task_2: { type: PT.STRING, default: '' },

      trial_type: {
        type: PT.SELECT,
        options: ['single', 'switch'],
        default: 'switch'
      },
      single_task_index: { type: PT.INT, default: 1 },

      cue_type: {
        type: PT.SELECT,
        options: ['position', 'color', 'explicit'],
        default: 'explicit'
      },
      cue_text: { type: PT.STRING, default: '' },
      cue_font_size_px: { type: PT.INT, default: 28 },
      cue_duration_ms: { type: PT.INT, default: 0 },
      cue_gap_ms: { type: PT.INT, default: 0 },
      cue_color_hex: { type: PT.STRING, default: '#FFFFFF' },

      task_1_cue_text: { type: PT.STRING, default: 'LETTERS' },
      task_2_cue_text: { type: PT.STRING, default: 'NUMBERS' },
      task_1_position: {
        type: PT.SELECT,
        options: ['left', 'right', 'top', 'bottom'],
        default: 'top'
      },
      task_2_position: {
        type: PT.SELECT,
        options: ['left', 'right', 'top', 'bottom'],
        default: 'bottom'
      },
      task_1_color_hex: { type: PT.STRING, default: '#FFFFFF' },
      task_2_color_hex: { type: PT.STRING, default: '#FFFFFF' },
      stimulus_color_hex: { type: PT.STRING, default: '#FFFFFF' },

      stimulus_position: {
        type: PT.SELECT,
        options: ['left', 'right', 'top', 'bottom'],
        default: 'top'
      },
      border_enabled: { type: PT.BOOL, default: false },

      left_key: { type: PT.KEY, default: 'f' },
      right_key: { type: PT.KEY, default: 'j' },

      stimulus_set_mode: {
        type: PT.SELECT,
        options: ['letters_numbers', 'custom'],
        default: 'letters_numbers'
      },

      // Custom mode: tasks[0] and tasks[1] each have category_a_tokens/category_b_tokens arrays
      tasks: { type: PT.COMPLEX, default: [] },

      stimulus_duration_ms: { type: PT.INT, default: 0 },
      trial_duration_ms: { type: PT.INT, default: 2000 }
    },
    data: {
      task_index: { type: PT.INT },
      stimulus: { type: PT.STRING },
      stimulus_task_1: { type: PT.STRING },
      stimulus_task_2: { type: PT.STRING },
      stimulus_position: { type: PT.STRING },
      cue_type: { type: PT.STRING },
      cue_text: { type: PT.STRING },
      stimulus_color_hex: { type: PT.STRING },
      border_enabled: { type: PT.BOOL },
      stimulus_set_mode: { type: PT.STRING },

      left_key: { type: PT.STRING },
      right_key: { type: PT.STRING },

      correct_response: { type: PT.STRING },
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
      .replaceAll("'", '&#39;');
  }

  function normalizeKey(k, fallback) {
    const s = (k ?? '').toString().trim();
    return s !== '' ? s : fallback;
  }

  function normalizeTaskIndex(v) {
    const n = Number.parseInt(v, 10);
    if (n === 2) return 2;
    return 1;
  }

  function normalizePosition(v) {
    const s = (v ?? '').toString().trim().toLowerCase();
    if (s === 'left' || s === 'right' || s === 'top' || s === 'bottom') return s;
    return 'top';
  }

  function normalizeCueType(v) {
    const s = (v ?? '').toString().trim().toLowerCase();
    if (s === 'position') return 'position';
    if (s === 'color' || s === 'colour') return 'color';
    if (s === 'explicit' || s === 'text') return 'explicit';
    return 'explicit';
  }

  function normalizeHexColor(v, fallback) {
    const s = (v ?? '').toString().trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
    if (/^#[0-9a-fA-F]{3}$/.test(s)) return s;
    return fallback;
  }

  function normalizeMode(v) {
    const s = (v ?? '').toString().trim().toLowerCase();
    return s === 'custom' ? 'custom' : 'letters_numbers';
  }

  function parseTokenSet(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map(x => (x ?? '').toString().trim())
      .filter(Boolean);
  }

  function resolveCorrectResponse({ mode, taskIndex, stimulus, leftKey, rightKey, tasks }) {
    const stimRaw = (stimulus ?? '').toString().trim();

    if (mode === 'custom') {
      const t = Array.isArray(tasks) ? tasks : [];
      const idx = (taskIndex === 2) ? 1 : 0;
      const task = (t[idx] && typeof t[idx] === 'object') ? t[idx] : {};

      const a = parseTokenSet(task.category_a_tokens);
      const b = parseTokenSet(task.category_b_tokens);

      if (a.includes(stimRaw)) return leftKey;
      if (b.includes(stimRaw)) return rightKey;
      return null;
    }

    // letters_numbers
    if (taskIndex === 1) {
      const ch = stimRaw.toUpperCase().slice(0, 1);
      const vowels = new Set(['A', 'E', 'I', 'O', 'U']);
      if (!ch) return null;
      return vowels.has(ch) ? leftKey : rightKey;
    }

    // taskIndex === 2 => numbers
    const n = Number.parseInt(stimRaw, 10);
    if (!Number.isFinite(n)) return null;
    return (Math.abs(n) % 2 === 1) ? leftKey : rightKey;
  }

  class TaskSwitchingPlugin {
    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element, trial) {
      const taskIndex = normalizeTaskIndex(trial.task_index);
      const stimulusRaw = (trial.stimulus ?? 'A').toString();
      const stimulusTask1 = (trial.stimulus_task_1 ?? '').toString().trim();
      const stimulusTask2 = (trial.stimulus_task_2 ?? '').toString().trim();
      const stimulus = (stimulusTask1 && stimulusTask2)
        ? `${stimulusTask1} ${stimulusTask2}`
        : stimulusRaw;
      const cueType = normalizeCueType(trial.cue_type);

      const position = (() => {
        if (cueType === 'position') {
          return normalizePosition(taskIndex === 2 ? trial.task_2_position : trial.task_1_position);
        }
        return normalizePosition(trial.stimulus_position);
      })();

      const stimulusColorHex = (() => {
        if (cueType === 'color') {
          return normalizeHexColor(taskIndex === 2 ? trial.task_2_color_hex : trial.task_1_color_hex, '#FFFFFF');
        }
        return normalizeHexColor(trial.stimulus_color_hex, '#FFFFFF');
      })();

      const cueText = (() => {
        const direct = (trial.cue_text ?? '').toString();
        if (direct.trim()) return direct;
        return ((taskIndex === 2 ? trial.task_2_cue_text : trial.task_1_cue_text) ?? '').toString();
      })();

      const cueFontSizePx = Number.isFinite(Number(trial.cue_font_size_px)) ? Number(trial.cue_font_size_px) : 28;
      const cueDurationMs = Number.isFinite(Number(trial.cue_duration_ms)) ? Number(trial.cue_duration_ms) : 0;
      const cueGapMs = Number.isFinite(Number(trial.cue_gap_ms)) ? Number(trial.cue_gap_ms) : 0;
      const cueColorHex = normalizeHexColor(trial.cue_color_hex, '#FFFFFF');

      const borderEnabled = trial.border_enabled === true;
      const leftKey = normalizeKey(trial.left_key, 'f');
      const rightKey = normalizeKey(trial.right_key, 'j');
      const mode = normalizeMode(trial.stimulus_set_mode);
      const tasks = Array.isArray(trial.tasks) ? trial.tasks : [];

      const stimMs = Number.isFinite(Number(trial.stimulus_duration_ms)) ? Number(trial.stimulus_duration_ms) : 0;
      const trialMs = Number.isFinite(Number(trial.trial_duration_ms)) ? Number(trial.trial_duration_ms) : 2000;

      const correctResponse = resolveCorrectResponse({
        mode,
        taskIndex,
        stimulus: (taskIndex === 2 ? (stimulusTask2 || stimulus) : (stimulusTask1 || stimulus)),
        leftKey,
        rightKey,
        tasks
      });

      const marginPx = 18;
      const topShiftPx = 100;
      const posCss = (() => {
        if (position === 'left') return `left:${marginPx}px; top:50%; transform:translateY(-50%);`;
        if (position === 'right') return `right:${marginPx}px; top:50%; transform:translateY(-50%);`;
        if (position === 'bottom') return `left:50%; bottom:${marginPx}px; transform:translateX(-50%);`;
        return `left:50%; top:${marginPx + topShiftPx}px; transform:translateX(-50%);`;
      })();

      const borderCss = borderEnabled
        ? 'border:2px solid rgba(255,255,255,0.35); border-radius:12px; padding:8px 12px;'
        : '';

      const cueHtml = (cueType === 'explicit')
        ? `
          <div id="ts-cue" style="position:absolute; left:50%; top:50px; transform:translateX(-50%); font-size:${cueFontSizePx}px; font-weight:700; color:${esc(cueColorHex)};">
            ${esc(cueText)}
          </div>
        `
        : '';

      display_element.innerHTML = `
        <div class="cf-task-switching" style="position:relative; width:100%; height:100vh; min-height:360px; background:#000; color:#fff;">
          <div style="position:absolute; inset:0;">
            ${cueHtml}
            <div style="position:absolute; ${posCss}">
              <div id="ts-stim" style="min-width:72px; min-height:72px; display:flex; align-items:center; justify-content:center; font-size:64px; font-weight:700; color:${esc(stimulusColorHex)}; ${borderCss}">
                ${esc(stimulus)}
              </div>
            </div>
          </div>
        </div>
      `;

      let ended = false;
      let endedReason = null;
      let responseKey = null;
      let rtMs = null;

      const start = nowMs();

      const endTrial = () => {
        if (ended) return;
        ended = true;

        // Cleanup
        this.jsPsych.pluginAPI.clearAllTimeouts();
        if (keyboardListener) this.jsPsych.pluginAPI.cancelKeyboardResponse(keyboardListener);

        const correctness = (correctResponse === null)
          ? null
          : (responseKey !== null && responseKey === correctResponse);

        const data = {
          task_index: taskIndex,
          stimulus,
          stimulus_task_1: stimulusTask1 || null,
          stimulus_task_2: stimulusTask2 || null,
          stimulus_position: position,
          cue_type: cueType,
          cue_text: cueText,
          stimulus_color_hex: stimulusColorHex,
          border_enabled: borderEnabled,
          stimulus_set_mode: mode,

          left_key: leftKey,
          right_key: rightKey,

          correct_response: correctResponse,
          response_key: responseKey,
          rt_ms: rtMs,
          correctness,

          ended_reason: endedReason || 'unknown',
          plugin_version: info.version
        };

        display_element.innerHTML = '';
        this.jsPsych.finishTrial(data);
      };

      // Optional cue-only phase for explicit cues.
      if (cueType === 'explicit' && cueDurationMs > 0) {
        this.jsPsych.pluginAPI.setTimeout(() => {
          const cueEl = display_element.querySelector('#ts-cue');
          if (cueEl) cueEl.style.display = 'none';
        }, cueDurationMs);
      }

      // Hide stimulus after stimMs (if requested)
      if (Number.isFinite(stimMs) && stimMs > 0) {
        this.jsPsych.pluginAPI.setTimeout(() => {
          const el = display_element.querySelector('#ts-stim');
          if (el) el.style.visibility = 'hidden';
        }, stimMs);
      }

      // Trial timeout
      if (Number.isFinite(trialMs) && trialMs > 0) {
        this.jsPsych.pluginAPI.setTimeout(() => {
          endedReason = 'timeout';
          endTrial();
        }, trialMs);
      }

      let keyboardListener = null;
      const startKeyboard = () => {
        keyboardListener = this.jsPsych.pluginAPI.getKeyboardResponse({
          callback_function: (info) => {
            if (ended) return;
            responseKey = info.key;
            rtMs = Number.isFinite(info.rt) ? Math.round(info.rt) : Math.round(nowMs() - start);
            endedReason = 'response';
            endTrial();
          },
          valid_responses: [leftKey, rightKey],
          rt_method: 'performance',
          persist: false,
          allow_held_key: false
        });
      };

      const responseDelayMs = (cueType === 'explicit') ? (Math.max(0, cueDurationMs) + Math.max(0, cueGapMs)) : 0;
      if (responseDelayMs > 0) {
        this.jsPsych.pluginAPI.setTimeout(() => {
          startKeyboard();
        }, responseDelayMs);
      } else {
        startKeyboard();
      }
    }
  }

  TaskSwitchingPlugin.info = info;
  window.jsPsychTaskSwitching = TaskSwitchingPlugin;
})(window.jsPsychModule || window.jsPsych);
