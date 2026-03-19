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
    name: 'nback-continuous',
    version: '1.0.0',
    parameters: {
      n: { type: PT.INT, default: 2 },
      length: { type: PT.INT, default: 30 },
      seed: { type: PT.STRING, default: '' },

      stimulus_mode: { type: PT.STRING, default: 'letters' },
      stimulus_pool: { type: PT.STRING, default: 'A,B,C,D,E,F,G,H' },
      target_probability: { type: PT.FLOAT, default: 0.25 },

      render_mode: { type: PT.STRING, default: 'token' },
      stimulus_template_html: { type: PT.HTML_STRING, default: '<div style="font-size:72px; font-weight:700; text-align:center;">{{TOKEN}}</div>' },

      stimulus_duration_ms: { type: PT.INT, default: 500 },
      isi_duration_ms: { type: PT.INT, default: 500 },
      trial_duration_ms: { type: PT.INT, default: 0 },

      response_paradigm: { type: PT.STRING, default: 'go_nogo' },
      response_device: { type: PT.STRING, default: 'keyboard' },
      go_key: { type: PT.STRING, default: 'space' },
      match_key: { type: PT.STRING, default: 'j' },
      nonmatch_key: { type: PT.STRING, default: 'f' },
      show_buttons: { type: PT.BOOL, default: false },

      show_feedback: { type: PT.BOOL, default: false },
      feedback_duration_ms: { type: PT.INT, default: 250 },

      show_fixation_cross_between_trials: { type: PT.BOOL, default: false },

      detection_response_task_enabled: { type: PT.BOOL, default: false }
    },
    data: {
      plugin_type: { type: PT.STRING },
      n: { type: PT.INT },
      length: { type: PT.INT },
      events: { type: PT.OBJECT },
      correct_count: { type: PT.INT },
      incorrect_count: { type: PT.INT },
      responded_count: { type: PT.INT },
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

  function hashSeedToUint32(seedStr) {
    let h = 2166136261;
    const s = (seedStr ?? 'default').toString();
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seedUint32) {
    let a = seedUint32 >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function parseTokenPool(raw, stimulusMode) {
    const parts = (raw ?? '')
      .toString()
      .split(/[\n,]/g)
      .map(s => s.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts;

    const mode = (stimulusMode ?? 'letters').toString().trim().toLowerCase();
    if (mode === 'numbers') return ['1','2','3','4','5','6','7','8','9'];
    if (mode === 'shapes') return ['●','■','▲','◆','★','⬟'];
    if (mode === 'custom') return ['A','B','C'];
    return ['A','B','C','D','E','F','G','H'];
  }

  class JsPsychNbackContinuousPlugin {
    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element, trial) {
      const n = Number.isFinite(Number(trial.n)) ? Math.max(1, Math.floor(Number(trial.n))) : 2;
      const length = Number.isFinite(Number(trial.length)) ? Math.max(1, Math.floor(Number(trial.length))) : 30;
      const seedStr = (trial.seed ?? '').toString();

      const stimulusMode = (trial.stimulus_mode ?? 'letters').toString();
      const pool = parseTokenPool(trial.stimulus_pool, stimulusMode);
      const targetProbRaw = Number(trial.target_probability);
      const targetProb = Number.isFinite(targetProbRaw) ? Math.max(0, Math.min(1, targetProbRaw)) : 0.25;

      const renderMode = (trial.render_mode || 'token').toString().trim().toLowerCase();
      const templateHtml = (trial.stimulus_template_html ?? '<div style="font-size:72px; font-weight:700; text-align:center;">{{TOKEN}}</div>').toString();

      const stimMs = Number.isFinite(Number(trial.stimulus_duration_ms)) ? Math.max(0, Number(trial.stimulus_duration_ms)) : 500;
      const isiMs = Number.isFinite(Number(trial.isi_duration_ms)) ? Math.max(0, Number(trial.isi_duration_ms)) : 500;
      const trialMsRaw = Number(trial.trial_duration_ms);
      const trialMs = (Number.isFinite(trialMsRaw) && trialMsRaw > 0) ? Math.max(1, Math.floor(trialMsRaw)) : null;

      const stimMsClamped = (trialMs !== null) ? Math.min(stimMs, trialMs) : stimMs;
      const cadenceMs = (trialMs !== null) ? trialMs : (stimMsClamped + isiMs);

      const responseParadigm = (trial.response_paradigm || 'go_nogo').toString().trim().toLowerCase();
      const responseDevice = (trial.response_device || 'keyboard').toString().trim().toLowerCase();
      const goKey = normalizeKeyName(trial.go_key || 'space');
      const matchKey = normalizeKeyName((trial.match_key ?? '').toString().trim() || 'j');
      const nonmatchKey = normalizeKeyName((trial.nonmatch_key ?? '').toString().trim() || 'f');
      const showButtons = trial.show_buttons === true;

      const showFeedback = trial.show_feedback === true;
      const feedbackMs = Number.isFinite(Number(trial.feedback_duration_ms)) ? Math.max(0, Number(trial.feedback_duration_ms)) : 0;

      const showFixationCrossBetweenTrials = trial.show_fixation_cross_between_trials === true;

      const rng = mulberry32(hashSeedToUint32(seedStr || 'default'));

      const pickFromPool = (avoidToken) => {
        if (!Array.isArray(pool) || pool.length === 0) return 'A';
        if (!avoidToken || pool.length === 1) return pool[Math.floor(rng() * pool.length)];
        let token = pool[Math.floor(rng() * pool.length)];
        let guard = 0;
        while (token === avoidToken && guard < 10) {
          token = pool[Math.floor(rng() * pool.length)];
          guard++;
        }
        return token;
      };

      const seq = [];
      const isMatch = [];
      for (let i = 0; i < length; i++) {
        if (i >= n && rng() < targetProb) {
          seq[i] = seq[i - n];
          isMatch[i] = true;
        } else {
          const avoid = (i >= n) ? seq[i - n] : null;
          seq[i] = pickFromPool(avoid);
          isMatch[i] = (i >= n) ? (seq[i] === seq[i - n]) : false;
        }
      }

      const stimulusHtmlFor = (token) => {
        if (renderMode === 'custom_html') {
          const safeToken = esc(token);
          if (templateHtml.includes('{{TOKEN}}')) return templateHtml.split('{{TOKEN}}').join(safeToken);
          return `${templateHtml}${safeToken}`;
        }
        return `<div style="font-size:72px; font-weight:700; text-align:center;">${esc(token)}</div>`;
      };

      const hintHtml = (() => {
        if (responseDevice === 'mouse') {
          if (!showButtons) return '<div style="opacity:0.7; font-size:12px;">Mouse response (buttons hidden)</div>';
          if (responseParadigm === '2afc') return '<div style="opacity:0.7; font-size:12px;">Click MATCH or NO MATCH</div>';
          return '<div style="opacity:0.7; font-size:12px;">Click GO for matches</div>';
        }
        if (responseParadigm === '2afc') {
          const mk = (trial.match_key ?? '').toString().trim() ? matchKey : goKey;
          return `<div style="opacity:0.7; font-size:12px;">${esc(String(mk))} = match, ${esc(String(nonmatchKey))} = no match</div>`;
        }
        return `<div style="opacity:0.7; font-size:12px;">${esc(String(goKey))} = go (matches only)</div>`;
      })();

      const buttonsHtml = (() => {
        if (responseDevice !== 'mouse' || !showButtons) return '';
        if (responseParadigm === '2afc') {
          return `
            <div style="display:flex; gap:10px; justify-content:center; margin-top:14px;">
              <button id="nbackc-btn-match" type="button" class="psy-btn">Match</button>
              <button id="nbackc-btn-nonmatch" type="button" class="psy-btn">No match</button>
            </div>
          `;
        }
        return `
          <div style="display:flex; gap:10px; justify-content:center; margin-top:14px;">
            <button id="nbackc-btn-go" type="button" class="psy-btn">Go</button>
          </div>
        `;
      })();

      display_element.innerHTML = `
        <div class="psy-wrap">
          <div class="psy-stage">
            <div style="width:min(900px, 100%); min-height:min(72vh, 680px); position:relative; text-align:center;">
              <div style="position:absolute; inset:0; display:grid; place-items:center; pointer-events:none;">
                <div style="text-align:center;">
                  <div id="nbackc-stim"></div>
                  <div id="nbackc-fix" style="visibility:hidden;"><div style="font-size:56px; font-weight:700; line-height:1;">+</div></div>
                </div>
              </div>
              <div style="position:absolute; left:0; right:0; bottom:0; padding:10px 0 0 0;">
                <div class="psy-muted" style="font-size:12px; margin-bottom:6px;">N-back stream · n=${esc(n)} · length=${esc(length)}</div>
                <div>${hintHtml}</div>
                ${buttonsHtml}
                <div id="nbackc-feedback" style="margin-top:12px; min-height:22px; font-weight:650;"></div>
                <div id="nbackc-progress" style="margin-top:10px; opacity:0.6; font-size:12px;"></div>
              </div>
            </div>
          </div>
        </div>
      `;

      const stimEl = display_element.querySelector('#nbackc-stim');
      const fixEl = display_element.querySelector('#nbackc-fix');
      const feedbackEl = display_element.querySelector('#nbackc-feedback');
      const progressEl = display_element.querySelector('#nbackc-progress');

      const startTs = nowMs();
      const events = [];

      let currentIndex = 0;
      let itemOnsetTs = null;
      let itemResponseKey = null;
      let itemRt = null;
      let itemResponded = false;

      const computeCorrectness = (idx) => {
        const m = isMatch[idx] === true;
        if (responseParadigm === '2afc') {
          if (!itemResponded) return false;
          const mk = (trial.match_key ?? '').toString().trim() ? matchKey : goKey;
          const correctKey = m ? mk : nonmatchKey;
          return itemResponseKey === correctKey;
        }

        // go_nogo
        if (m) return itemResponded && itemResponseKey === goKey;
        return !itemResponded;
      };

      const clearFeedback = () => {
        if (feedbackEl) feedbackEl.textContent = '';
      };

      const showItem = (idx) => {
        currentIndex = idx;
        itemOnsetTs = nowMs();
        itemResponseKey = null;
        itemRt = null;
        itemResponded = false;
        // Do not clear feedback here.
        // Feedback is shown at the end of each item and (when enabled) is responsible for
        // clearing itself before the next item begins.

        if (progressEl) {
          progressEl.textContent = `Item ${idx + 1} / ${length} · ${isMatch[idx] ? 'MATCH' : 'NO MATCH'}`;
        }

        if (stimEl) {
          stimEl.style.visibility = 'visible';
          stimEl.innerHTML = stimulusHtmlFor(seq[idx]);
        }

        if (fixEl) {
          fixEl.style.visibility = 'hidden';
        }

        // Hide stimulus after stimMs
        if (Number.isFinite(stimMsClamped) && stimMsClamped > 0) {
          this.jsPsych.pluginAPI.setTimeout(() => {
            if (stimEl) stimEl.style.visibility = 'hidden';

            if (showFixationCrossBetweenTrials && fixEl) {
              fixEl.style.visibility = 'visible';
            }
          }, stimMsClamped);
        }

        // End item after cadence
        this.jsPsych.pluginAPI.setTimeout(() => {
          const correctness = computeCorrectness(idx);
          events.push({
            index: idx,
            token: seq[idx],
            is_match: isMatch[idx] === true,
            onset_ms: Math.round(itemOnsetTs - startTs),
            response_key: itemResponseKey,
            rt_ms: itemRt,
            correctness
          });

          const next = idx + 1;
          const advance = () => {
            clearFeedback();
            if (next >= length) {
              endTrial();
            } else {
              showItem(next);
            }
          };

          if (showFeedback && feedbackEl && feedbackMs > 0) {
            feedbackEl.textContent = correctness ? 'Correct' : 'Incorrect';
            feedbackEl.style.color = correctness ? '#86efac' : '#fca5a5';
            this.jsPsych.pluginAPI.setTimeout(() => {
              advance();
            }, feedbackMs);
            return;
          }

          advance();
        }, Math.max(1, cadenceMs));
      };

      const recordResponse = (rawKey) => {
        if (itemResponded) return;

        const k = normalizeKeyName(rawKey);
        if (responseParadigm === '2afc') {
          const mk = (trial.match_key ?? '').toString().trim() ? matchKey : goKey;
          if (![mk, nonmatchKey].includes(k)) return;
        } else {
          if (k !== goKey) return;
        }

        itemResponded = true;
        itemResponseKey = k;
        itemRt = itemOnsetTs ? Math.round(nowMs() - itemOnsetTs) : null;
      };

      // Keyboard listener (persist across entire stream)
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
          callback_function: (infoKbd) => {
            const k = infoKbd && infoKbd.key !== undefined ? infoKbd.key : null;
            recordResponse(k);
          },
          valid_responses: keys,
          rt_method: 'performance',
          persist: true,
          allow_held_key: false
        });
      }

      // Mouse buttons
      if (responseDevice === 'mouse' && showButtons) {
        const btnGo = display_element.querySelector('#nbackc-btn-go');
        const btnMatch = display_element.querySelector('#nbackc-btn-match');
        const btnNonmatch = display_element.querySelector('#nbackc-btn-nonmatch');
        if (btnGo) btnGo.onclick = () => recordResponse(goKey);
        if (btnMatch) {
          btnMatch.onclick = () => {
            const mk = (trial.match_key ?? '').toString().trim() ? matchKey : goKey;
            recordResponse(mk);
          };
        }
        if (btnNonmatch) btnNonmatch.onclick = () => recordResponse(nonmatchKey);
      }

      const endTrial = () => {
        this.jsPsych.pluginAPI.cancelAllKeyboardResponses();

        const correctCount = events.reduce((a, e) => a + (e.correctness === true ? 1 : 0), 0);
        const incorrectCount = events.reduce((a, e) => a + (e.correctness === false ? 1 : 0), 0);
        const respondedCount = events.reduce((a, e) => a + (e.response_key ? 1 : 0), 0);

        this.jsPsych.finishTrial({
          plugin_type: 'nback-continuous',
          plugin_version: info.version,
          n,
          length,
          events,
          correct_count: correctCount,
          incorrect_count: incorrectCount,
          responded_count: respondedCount
        });
      };

      // Start stream
      showItem(0);
    }
  }

  JsPsychNbackContinuousPlugin.info = info;
  window.jsPsychNbackContinuous = JsPsychNbackContinuousPlugin;
})(window.jsPsychModule || window.jsPsych);
