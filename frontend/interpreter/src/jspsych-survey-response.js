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
    name: 'survey-response',
    version: '1.0.0',
    parameters: {
      title: { type: PT.STRING, default: 'Survey' },
      instructions: { type: PT.STRING, default: '' },
      submit_label: { type: PT.STRING, default: 'Continue' },
      allow_empty_on_timeout: { type: PT.BOOL, default: false },
      timeout_ms: { type: PT.INT, default: null },
      questions: { type: PT.OBJECT, array: true, default: [] },
      detection_response_task_enabled: { type: PT.BOOL, default: false }
    },
    data: {
      responses: { type: PT.OBJECT },
      rt_ms: { type: PT.INT },
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

  function coerceQuestions(raw) {
    return Array.isArray(raw) ? raw.filter((q) => q && typeof q === 'object') : [];
  }

  function getFormData(formEl, questions) {
    const out = {};

    for (const q of questions) {
      const id = (q && typeof q.id === 'string' && q.id.trim()) ? q.id.trim() : null;
      if (!id) continue;

      const type = (q.type || 'text').toLowerCase();

      if (type === 'likert' || type === 'radio') {
        const checked = formEl.querySelector(`input[name="${CSS.escape(id)}"]:checked`);
        out[id] = checked ? checked.value : null;
        continue;
      }

      if (type === 'slider') {
        const el = formEl.querySelector(`input[name="${CSS.escape(id)}"]`);
        out[id] = el ? Number(el.value) : null;
        continue;
      }

      if (type === 'number') {
        const el = formEl.querySelector(`input[name="${CSS.escape(id)}"]`);
        if (!el) {
          out[id] = null;
        } else {
          const v = el.value;
          out[id] = v === '' ? null : Number(v);
        }
        continue;
      }

      // text
      const el = formEl.querySelector(`[name="${CSS.escape(id)}"]`);
      out[id] = el ? (String(el.value || '')) : null;
    }

    return out;
  }

  function hasAnyResponse(responses) {
    for (const v of Object.values(responses || {})) {
      if (v === null) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      return true;
    }
    return false;
  }

  function validateRequired(questions, responses) {
    const missing = [];
    for (const q of questions) {
      const id = (q && typeof q.id === 'string' && q.id.trim()) ? q.id.trim() : null;
      if (!id) continue;
      const required = q.required === true;
      if (!required) continue;

      const v = responses[id];
      const ok = !(v === null || v === undefined || (typeof v === 'string' && v.trim() === ''));
      if (!ok) missing.push(id);
    }
    return missing;
  }

  class JsPsychSurveyResponsePlugin {
    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element, trial) {
      const startTs = nowMs();
      const questions = coerceQuestions(trial.questions);
      const timeoutMs = (trial.timeout_ms === null || trial.timeout_ms === undefined) ? null : Number(trial.timeout_ms);
      const allowEmptyOnTimeout = trial.allow_empty_on_timeout === true;

      const renderQuestion = (q) => {
        const id = (q && typeof q.id === 'string') ? q.id.trim() : '';
        const type = (q.type || 'text').toLowerCase();
        const prompt = esc(q.prompt || '');
        const required = q.required === true;

        const requiredMark = required ? '<span style="color:#FF5C5C">*</span>' : '';

        if (type === 'likert' || type === 'radio') {
          const options = Array.isArray(q.options) ? q.options : [];
          const inputs = options.map((opt, idx) => {
            const v = esc(opt);
            const inputId = `q_${esc(id)}_${idx}`;
            return `
              <label for="${inputId}" style="display:flex; gap:10px; align-items:flex-start; margin:6px 0;">
                <input id="${inputId}" type="radio" name="${esc(id)}" value="${v}" ${required ? 'required' : ''} />
                <span>${v}</span>
              </label>
            `;
          }).join('');

          return `
            <div class="sr-q" style="margin: 14px 0;">
              <div style="font-weight:600; margin-bottom:6px;">${prompt} ${requiredMark}</div>
              <div>${inputs}</div>
            </div>
          `;
        }

        if (type === 'slider') {
          const min = Number.isFinite(Number(q.min)) ? Number(q.min) : 0;
          const max = Number.isFinite(Number(q.max)) ? Number(q.max) : 100;
          const step = Number.isFinite(Number(q.step)) ? Number(q.step) : 1;
          const minLabel = esc(q.min_label ?? String(min));
          const maxLabel = esc(q.max_label ?? String(max));
          const initValue = Number.isFinite(Number(q.value)) ? Number(q.value) : min;

          return `
            <div class="sr-q" style="margin: 14px 0;">
              <div style="font-weight:600; margin-bottom:6px;">${prompt} ${requiredMark}</div>
              <div style="display:flex; gap:10px; align-items:center;">
                <span style="opacity:0.8; min-width: 32px;">${minLabel}</span>
                <input type="range" name="${esc(id)}" min="${min}" max="${max}" step="${step}" value="${initValue}" style="flex:1;" ${required ? 'required' : ''} />
                <span class="sr-slider-value" data-slider-for="${esc(id)}" style="opacity:0.85; min-width: 44px; text-align:right; font-variant-numeric: tabular-nums;">${esc(initValue)}</span>
                <span style="opacity:0.8; min-width: 32px; text-align:right;">${maxLabel}</span>
              </div>
            </div>
          `;
        }

        if (type === 'number') {
          const minAttr = (q.min === null || q.min === undefined || q.min === '') ? '' : `min="${esc(q.min)}"`;
          const maxAttr = (q.max === null || q.max === undefined || q.max === '') ? '' : `max="${esc(q.max)}"`;
          const stepAttr = (q.step === null || q.step === undefined || q.step === '') ? '' : `step="${esc(q.step)}"`;
          const placeholder = esc(q.placeholder || '');

          return `
            <div class="sr-q" style="margin: 14px 0;">
              <div style="font-weight:600; margin-bottom:6px;">${prompt} ${requiredMark}</div>
              <input type="number" name="${esc(id)}" class="sr-input" placeholder="${placeholder}" ${minAttr} ${maxAttr} ${stepAttr} ${required ? 'required' : ''}
                style="width:100%; padding:10px; border-radius:10px; border:1px solid rgba(255,255,255,0.15); background: rgba(0,0,0,0.2); color: inherit;" />
            </div>
          `;
        }

        // text
        const multiline = q.multiline === true;
        const rows = Number.isFinite(Number(q.rows)) ? Number(q.rows) : 4;
        const placeholder = esc(q.placeholder || '');

        return `
          <div class="sr-q" style="margin: 14px 0;">
            <div style="font-weight:600; margin-bottom:6px;">${prompt} ${requiredMark}</div>
            ${multiline
              ? `<textarea name="${esc(id)}" rows="${rows}" placeholder="${placeholder}" ${required ? 'required' : ''}
                    style="width:100%; padding:10px; border-radius:10px; border:1px solid rgba(255,255,255,0.15); background: rgba(0,0,0,0.2); color: inherit;"></textarea>`
              : `<input type="text" name="${esc(id)}" placeholder="${placeholder}" ${required ? 'required' : ''}
                    style="width:100%; padding:10px; border-radius:10px; border:1px solid rgba(255,255,255,0.15); background: rgba(0,0,0,0.2); color: inherit;" />`
            }
          </div>
        `;
      };

      display_element.innerHTML = `
        <div style="max-width: 900px; margin: 0 auto; text-align:left;">
          <h2 style="margin: 0 0 8px 0;">${esc(trial.title || 'Survey')}</h2>
          ${trial.instructions ? `<div style="opacity:0.85; margin-bottom: 14px;">${esc(trial.instructions)}</div>` : ''}
          <div id="sr-error" style="display:none; margin: 10px 0; padding: 10px; border-radius: 10px; border: 1px solid rgba(255,92,92,0.45); color: #ffd2d2; background: rgba(255,92,92,0.12);"></div>
          <form id="sr-form">
            ${questions.map(renderQuestion).join('')}
            <div style="margin-top: 18px; display:flex; justify-content:flex-end;">
              <button type="submit" class="btn btn-primary">${esc(trial.submit_label || 'Continue')}</button>
            </div>
          </form>
          <div style="margin-top: 10px; opacity:0.7; font-size: 12px;">Fields marked * are required.</div>
        </div>
      `;

      const formEl = display_element.querySelector('#sr-form');
      const errorEl = display_element.querySelector('#sr-error');

      let ended = false;

      const finish = (reason) => {
        if (ended) return;
        ended = true;

        const responses = getFormData(formEl, questions);

        this.jsPsych.finishTrial({
          plugin_type: 'survey-response',
          plugin_version: info.version,
          ended_reason: reason || 'submit',
          rt_ms: Math.round(nowMs() - startTs),
          responses
        });
      };

      const onSubmit = (e) => {
        e.preventDefault();
        const responses = getFormData(formEl, questions);
        const missing = validateRequired(questions, responses);

        if (missing.length > 0) {
          if (errorEl) {
            errorEl.style.display = '';
            errorEl.textContent = `Please answer required question(s): ${missing.join(', ')}`;
          }
          return;
        }

        finish('submit');
      };

      formEl.addEventListener('submit', onSubmit);

      // Slider live value labels
      try {
        const sliders = display_element.querySelectorAll('input[type="range"][name]');
        sliders.forEach((sliderEl) => {
          const name = sliderEl.getAttribute('name') || '';
          if (!name) return;
          const labelEl = display_element.querySelector(`.sr-slider-value[data-slider-for="${CSS.escape(name)}"]`);
          if (!labelEl) return;

          const sync = () => {
            labelEl.textContent = String(sliderEl.value);
          };

          sliderEl.addEventListener('input', sync);
          sliderEl.addEventListener('change', sync);
          sync();
        });
      } catch {
        // ignore
      }

      // Timeout handling
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        this.jsPsych.pluginAPI.setTimeout(() => {
          if (ended) return;
          const responses = getFormData(formEl, questions);
          const any = hasAnyResponse(responses);

          if (!any && !allowEmptyOnTimeout) {
            if (errorEl) {
              errorEl.style.display = '';
              errorEl.textContent = 'Time is up. Please provide at least one response to continue.';
            }
            return;
          }

          finish('timeout');
        }, timeoutMs);
      }
    }
  }

  JsPsychSurveyResponsePlugin.info = info;
  window.jsPsychSurveyResponse = JsPsychSurveyResponsePlugin;
})(window.jsPsychModule || window.jsPsych);
