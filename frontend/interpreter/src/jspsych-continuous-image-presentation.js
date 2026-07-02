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
    name: 'continuous-image-presentation',
    version: '1.0.0',
    parameters: {
      image_url: { type: PT.STRING, default: '' },
      asset_filename: { type: PT.STRING, default: '' },

      mask_to_image_sprite_url: { type: PT.STRING, default: null },
      image_to_mask_sprite_url: { type: PT.STRING, default: null },
      transition_frames: { type: PT.INT, default: 8 },

      image_duration_ms: { type: PT.INT, default: 750 },
      transition_duration_ms: { type: PT.INT, default: 200 },

      choices: { type: PT.KEYS, default: ['f', 'j'] },

      cip_response_paradigm: { type: PT.STRING, default: 'categorization' },
      cip_categories: { type: PT.OBJECT, default: [] },
      cip_show_category_buttons: { type: PT.BOOL, default: false },
      cip_target_category_index: { type: PT.INT, default: null },
      cip_target_category_label: { type: PT.STRING, default: null },

      // N-back-in-CIP fields (used when cip_response_paradigm="nback")
      nback_n: { type: PT.INT, default: 2 },
      nback_is_match: { type: PT.BOOL, default: false },
      nback_token: { type: PT.STRING, default: '' },
      correct_response: { type: PT.STRING, default: null },
      response_paradigm: { type: PT.STRING, default: 'go_nogo' },
      response_device: { type: PT.STRING, default: 'keyboard' },
      go_key: { type: PT.STRING, default: 'space' },
      match_key: { type: PT.STRING, default: 'j' },
      nonmatch_key: { type: PT.STRING, default: 'f' },
      show_buttons: { type: PT.BOOL, default: false },
      show_feedback: { type: PT.BOOL, default: false },
      feedback_duration_ms: { type: PT.INT, default: 250 }
    },
    data: {
      cip_response_paradigm: { type: PT.STRING },
      response_key: { type: PT.STRING },
      rt_ms: { type: PT.INT },
      responded: { type: PT.BOOL },
      cip_category_index: { type: PT.INT },
      cip_category_label: { type: PT.STRING },
      cip_target_category_index: { type: PT.INT },
      cip_target_category_label: { type: PT.STRING },
      nback_n: { type: PT.INT },
      nback_is_match: { type: PT.BOOL },
      nback_token: { type: PT.STRING },
      nback_response_paradigm: { type: PT.STRING },
      nback_response_device: { type: PT.STRING },
      correctness: { type: PT.BOOL },
      correct_response: { type: PT.STRING },
      ended_reason: { type: PT.STRING },
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
    if (k.length === 1 && /[a-z]/i.test(k)) return [k.toLowerCase(), k.toUpperCase()];
    return [k];
  }

  function normalizeChoices(raw) {
    if (raw === undefined || raw === null) return ['f', 'j'];
    if (Array.isArray(raw)) {
      return raw.map(normalizeKeyName).filter(Boolean);
    }
    const s = String(raw);
    const parts = s
      .split(/[\n,]/g)
      .map(x => normalizeKeyName(x))
      .filter(Boolean);
    return parts.length > 0 ? parts : ['f', 'j'];
  }

  function normalizeCipParadigm(raw) {
    const s = (raw ?? 'categorization').toString().trim().toLowerCase();
    return (s === 'nback') ? 'nback' : 'categorization';
  }

  function preloadImage(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      try { img.crossOrigin = 'anonymous'; } catch { /* ignore */ }
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  class JsPsychContinuousImagePresentationPlugin {
    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element, trial) {
      const imageUrl = (trial.image_url ?? '').toString();
      const filename = (trial.asset_filename ?? '').toString();
      const m2iUrl = (trial.mask_to_image_sprite_url ?? '') ? String(trial.mask_to_image_sprite_url) : '';
      const i2mUrl = (trial.image_to_mask_sprite_url ?? '') ? String(trial.image_to_mask_sprite_url) : '';

      const frames = Number.isFinite(Number(trial.transition_frames)) ? Math.max(1, Math.floor(Number(trial.transition_frames))) : 8;
      const imgMs = Number.isFinite(Number(trial.image_duration_ms)) ? Math.max(0, Math.floor(Number(trial.image_duration_ms))) : 750;
      const transMs = Number.isFinite(Number(trial.transition_duration_ms)) ? Math.max(0, Math.floor(Number(trial.transition_duration_ms))) : 200;

      const cipParadigm = normalizeCipParadigm(trial.cip_response_paradigm);

      const categorizationCategories = (() => {
        const raw = Array.isArray(trial.cip_categories) ? trial.cip_categories : [];
        const out = [];
        for (let i = 0; i < raw.length; i++) {
          const item = raw[i] || {};
          const index = Number.isFinite(Number(item.index)) ? Math.max(1, Math.floor(Number(item.index))) : (i + 1);
          const label = (item.label ?? `Category ${index}`).toString().trim() || `Category ${index}`;
          const key = normalizeKeyName(item.key ?? '');
          if (!key) continue;
          out.push({ index, label, key });
        }

        if (out.length >= 2) return out;

        const fallbackChoices = normalizeChoices(trial.choices);
        const fallback = [];
        for (let i = 0; i < Math.min(2, fallbackChoices.length); i++) {
          fallback.push({ index: i + 1, label: `Category ${i + 1}`, key: normalizeKeyName(fallbackChoices[i]) });
        }
        if (fallback.length < 2) {
          fallback.push({ index: 1, label: 'Category 1', key: 'f' });
          fallback.push({ index: 2, label: 'Category 2', key: 'j' });
        }
        return fallback;
      })();
      const showCategoryButtons = trial.cip_show_category_buttons === true;

      const nbackResponseParadigm = ((trial.response_paradigm || 'go_nogo').toString().trim().toLowerCase() === '2afc') ? '2afc' : 'go_nogo';
      const nbackResponseDevice = (trial.response_device || 'keyboard').toString().trim().toLowerCase() === 'mouse' ? 'mouse' : 'keyboard';
      const nbackGoKey = normalizeKeyName(trial.go_key || 'space');
      const nbackMatchKey = normalizeKeyName((trial.match_key ?? '').toString().trim() || 'j');
      const nbackNonmatchKey = normalizeKeyName((trial.nonmatch_key ?? '').toString().trim() || 'f');
      const nbackShowButtons = trial.show_buttons === true;
      const nbackShowFeedback = trial.show_feedback === true;
      const nbackFeedbackMs = Number.isFinite(Number(trial.feedback_duration_ms)) ? Math.max(0, Math.floor(Number(trial.feedback_duration_ms))) : 250;
      const nbackN = Number.isFinite(Number(trial.nback_n)) ? Math.max(1, Math.floor(Number(trial.nback_n))) : 2;
      const nbackIsMatch = trial.nback_is_match === true;
      const nbackToken = (trial.nback_token ?? '').toString();
      const nbackCorrectResponse = (() => {
        if (typeof trial.correct_response === 'string' && trial.correct_response.trim()) {
          return normalizeKeyName(trial.correct_response);
        }
        if (nbackResponseParadigm === '2afc') {
          return nbackIsMatch ? nbackMatchKey : nbackNonmatchKey;
        }
        return nbackIsMatch ? nbackGoKey : null;
      })();

      const validKeys = (() => {
        if (cipParadigm === 'categorization') {
          return Array.from(new Set(categorizationCategories.flatMap((c) => expandKeyVariants(c.key)).map(normalizeKeyName).filter(Boolean)));
        }
        if (nbackResponseParadigm === '2afc') {
          return Array.from(new Set([
            ...expandKeyVariants(nbackMatchKey),
            ...expandKeyVariants(nbackNonmatchKey)
          ].map(normalizeKeyName).filter(Boolean)));
        }
        return Array.from(new Set(expandKeyVariants(nbackGoKey).map(normalizeKeyName).filter(Boolean)));
      })();

      let responded = false;
      let responseKey = null;
      let rt = null;
      let endedReason = null;
      let respondedCategory = null;
      let correctness = null;

      const targetCategory = (() => {
        const idxRaw = Number.parseInt((trial.cip_target_category_index ?? '').toString(), 10);
        const idx = Number.isFinite(idxRaw) ? idxRaw : null;
        const byIndex = Number.isFinite(idx)
          ? (categorizationCategories.find((c) => Number(c.index) === Number(idx)) || null)
          : null;

        const labelRaw = (trial.cip_target_category_label ?? '').toString().trim();
        const byLabel = (!byIndex && labelRaw)
          ? (categorizationCategories.find((c) => (c.label || '').toString().trim().toLowerCase() === labelRaw.toLowerCase()) || null)
          : null;

        return byIndex || byLabel || null;
      })();

      let keyboardListener = null;
      let imageTimeoutId = null;
      let ended = false;

      const endTrial = () => {
        if (ended) return;
        ended = true;

        try {
          if (keyboardListener) this.jsPsych.pluginAPI.cancelKeyboardResponse(keyboardListener);
        } catch {
          // ignore
        }
        try {
          if (imageTimeoutId) this.jsPsych.pluginAPI.clearTimeout(imageTimeoutId);
        } catch {
          // ignore
        }

        // Intentionally do NOT clear the display element.
        // The final frame of image->mask should remain visible between trials,
        // so the block sequence is continuous: mask -> transition -> image -> transition -> mask -> ...
        try {
          if (promptEl) promptEl.style.opacity = '0';
        } catch {
          // ignore
        }

        this.jsPsych.finishTrial({
          cip_response_paradigm: cipParadigm,
          response_key: responseKey,
          rt_ms: Number.isFinite(rt) ? Math.round(rt) : null,
          responded: responded === true,
          cip_category_index: respondedCategory ? respondedCategory.index : null,
          cip_category_label: respondedCategory ? respondedCategory.label : null,
          cip_target_category_index: targetCategory ? targetCategory.index : null,
          cip_target_category_label: targetCategory ? targetCategory.label : null,
          nback_n: cipParadigm === 'nback' ? nbackN : null,
          nback_is_match: cipParadigm === 'nback' ? nbackIsMatch : null,
          nback_token: cipParadigm === 'nback' ? nbackToken : null,
          nback_response_paradigm: cipParadigm === 'nback' ? nbackResponseParadigm : null,
          nback_response_device: cipParadigm === 'nback' ? nbackResponseDevice : null,
          correctness: correctness,
          correct_response: (cipParadigm === 'nback')
            ? nbackCorrectResponse
            : (targetCategory ? normalizeKeyName(targetCategory.key) : null),
          ended_reason: endedReason || (responded ? 'response' : 'timeout'),
          plugin_version: info.version
        });
      };

      const wrapId = 'cip-wrap-persistent';
      const stageId = 'cip-stage-persistent';
      const spriteId = 'cip-sprite-persistent';
      const imgId = 'cip-img-persistent';
      const promptId = 'cip-prompt-persistent';
      const controlsId = 'cip-controls-persistent';

      let wrapEl = display_element.querySelector(`#${wrapId}`);
      let stageEl = display_element.querySelector(`#${stageId}`);
      let spriteEl = display_element.querySelector(`#${spriteId}`);
      let imgEl = display_element.querySelector(`#${imgId}`);
      let promptEl = display_element.querySelector(`#${promptId}`);
      let controlsEl = display_element.querySelector(`#${controlsId}`);

      if (!wrapEl || !stageEl || !spriteEl || !imgEl || !promptEl || !controlsEl) {
        display_element.innerHTML = `
          <div id="${wrapId}" style="width:100%; min-height:100vh; min-height:100svh; min-height:100dvh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; box-sizing:border-box; padding:24px 12px;">
            <div id="${stageId}" style="position:relative; display:flex; align-items:center; justify-content:center; width:100%;">
              <canvas id="${spriteId}" style="display:none; image-rendering: pixelated;"></canvas>
              <img id="${imgId}" alt="" style="display:none; max-width:90vw; max-height:70vh; object-fit:contain;" />
            </div>
            <div id="${promptId}" style="opacity:0.7; font-size:12px; text-align:center;"></div>
            <div id="${controlsId}" style="display:flex; flex-wrap:wrap; gap:8px; justify-content:center;"></div>
          </div>
        `;

        wrapEl = display_element.querySelector(`#${wrapId}`);
        stageEl = display_element.querySelector(`#${stageId}`);
        spriteEl = display_element.querySelector(`#${spriteId}`);
        imgEl = display_element.querySelector(`#${imgId}`);
        promptEl = display_element.querySelector(`#${promptId}`);
        controlsEl = display_element.querySelector(`#${controlsId}`);
      }

      if (!wrapEl || !stageEl || !spriteEl || !imgEl || !promptEl || !controlsEl) {
        endedReason = 'render_error';
        endTrial();
        return;
      }

      // Reset per-trial UI state while keeping the previous final frame visible.
      controlsEl.innerHTML = '';
      promptEl.textContent = '';

      const spriteCanvas = spriteEl;
      const spriteCtx = (spriteCanvas && spriteCanvas.getContext) ? spriteCanvas.getContext('2d') : null;

      const getStageBgColor = () => {
        try {
          const root = document.documentElement;
          const cs = getComputedStyle(root);
          const v = (cs.getPropertyValue('--psy-task-bg') || cs.getPropertyValue('--psy-bg') || '').trim();
          if (v) return v;
        } catch {
          // ignore
        }
        try {
          return getComputedStyle(document.body).backgroundColor || 'transparent';
        } catch {
          return 'transparent';
        }
      };

      const stageBgColor = getStageBgColor();

      const drawFill = () => {
        if (!spriteCtx) return;
        try {
          spriteCtx.save();
          spriteCtx.setTransform(1, 0, 0, 1, 0, 0);
          spriteCtx.globalCompositeOperation = 'source-over';
          spriteCtx.fillStyle = stageBgColor;
          spriteCtx.fillRect(0, 0, spriteCanvas.width, spriteCanvas.height);
          spriteCtx.restore();
        } catch {
          // ignore
        }
      };

      const drawContain = (img) => {
        if (!spriteCtx || !img) return;
        const cw = spriteCanvas.width || 0;
        const ch = spriteCanvas.height || 0;
        const iw = img.naturalWidth || img.width || 0;
        const ih = img.naturalHeight || img.height || 0;
        if (!(cw > 0) || !(ch > 0) || !(iw > 0) || !(ih > 0)) return;

        const s = Math.min(cw / iw, ch / ih);
        const dw = Math.max(1, Math.round(iw * s));
        const dh = Math.max(1, Math.round(ih * s));
        const dx = Math.round((cw - dw) / 2);
        const dy = Math.round((ch - dh) / 2);

        try {
          drawFill();
          spriteCtx.drawImage(img, 0, 0, iw, ih, dx, dy, dw, dh);
        } catch {
          // ignore
        }
      };

      const promptText = (() => {
        if (cipParadigm === 'categorization') {
          const parts = categorizationCategories.map((c) => `${c.key === ' ' ? 'space' : c.key}=${c.label}`);
          return `Categorize: ${parts.join(' | ')}`;
        }
        if (nbackResponseDevice === 'mouse' && nbackShowButtons) {
          if (nbackResponseParadigm === '2afc') return 'N-back: click Match / No match';
          return 'N-back: click Go for matches';
        }
        if (nbackResponseParadigm === '2afc') {
          return `N-back: ${nbackMatchKey === ' ' ? 'space' : nbackMatchKey}=match, ${nbackNonmatchKey === ' ' ? 'space' : nbackNonmatchKey}=no match`;
        }
        return `N-back: ${nbackGoKey === ' ' ? 'space' : nbackGoKey}=go (matches)`;
      })();
      promptEl.textContent = promptText;

      if (cipParadigm === 'categorization' && showCategoryButtons) {
        controlsEl.innerHTML = categorizationCategories
          .map((c) => `<button type="button" class="psy-btn" data-cip-category-key="${String(c.key).replace(/"/g, '&quot;')}" data-cip-category-index="${c.index}">${c.label}</button>`)
          .join('');
      } else if (cipParadigm === 'nback' && nbackResponseDevice === 'mouse' && nbackShowButtons) {
        controlsEl.innerHTML = (nbackResponseParadigm === '2afc')
          ? '<button type="button" class="psy-btn" data-cip-nback-action="match">Match</button><button type="button" class="psy-btn" data-cip-nback-action="nonmatch">No match</button>'
          : '<button type="button" class="psy-btn" data-cip-nback-action="go">Go</button>';
      }

      const cleanupStyle = () => { };

      const setStageSizeFromDims = (w, h) => {
        const width = Number(w);
        const height = Number(h);
        if (!(width > 0) || !(height > 0)) return;

        const maxW = Math.max(50, Math.floor(window.innerWidth * 0.9));
        const maxH = Math.max(50, Math.floor(window.innerHeight * 0.7));
        const scale = Math.min(maxW / width, maxH / height, 1);

        const dispW = Math.max(1, Math.floor(width * scale));
        const dispH = Math.max(1, Math.floor(height * scale));

        // Canvas: keep drawing buffer at native frame size; scale with CSS.
        try {
          spriteCanvas.width = Math.max(1, Math.floor(width));
          spriteCanvas.height = Math.max(1, Math.floor(height));
        } catch {
          // ignore
        }
        spriteCanvas.style.width = `${dispW}px`;
        spriteCanvas.style.height = `${dispH}px`;
        imgEl.style.width = `${dispW}px`;
        imgEl.style.height = `${dispH}px`;
      };

      const inferSpriteLayout = (spriteW, spriteH, frames, targetW, targetH) => {
        const fw = Number(spriteW);
        const fh = Number(spriteH);
        const fr = Number(frames);
        const tw = Number(targetW);
        const th = Number(targetH);

        const canH = (fr > 0) && (fw > 0) && (fh > 0) && (fw % fr === 0);
        const canV = (fr > 0) && (fw > 0) && (fh > 0) && (fh % fr === 0);

        const horiz = canH ? { layout: 'h', frameW: Math.floor(fw / fr), frameH: fh } : null;
        const vert = canV ? { layout: 'v', frameW: fw, frameH: Math.floor(fh / fr) } : null;

        if (horiz && vert && (tw > 0) && (th > 0)) {
          const errH = Math.abs(horiz.frameW - tw) + Math.abs(horiz.frameH - th);
          const errV = Math.abs(vert.frameW - tw) + Math.abs(vert.frameH - th);
          return errV < errH ? vert : horiz;
        }

        if (horiz && !vert) return horiz;
        if (vert && !horiz) return vert;
        if (horiz && vert) {
          // Heuristic: choose the one with the larger frame area.
          return (horiz.frameW * horiz.frameH) >= (vert.frameW * vert.frameH) ? horiz : vert;
        }

        // Fallback: assume horizontal (existing behavior)
        if (fw > 0 && fh > 0 && fr > 0) return { layout: 'h', frameW: Math.max(1, Math.floor(fw / fr)), frameH: fh };
        return { layout: 'h', frameW: null, frameH: null };
      };

      const playSprite = (spriteImg, layout) => {
        return new Promise((resolve) => {
          if (!spriteImg || transMs <= 0 || frames <= 1) {
            resolve();
            return;
          }

          if (!spriteCtx) {
            resolve();
            return;
          }

          spriteCanvas.style.display = 'block';
          imgEl.style.display = 'none';

          const isVert = layout === 'v';
          const sw = spriteImg.naturalWidth || spriteImg.width || 0;
          const sh = spriteImg.naturalHeight || spriteImg.height || 0;
          const frameW = isVert ? sw : Math.floor(sw / frames);
          const frameH = isVert ? Math.floor(sh / frames) : sh;
          if (!(frameW > 0) || !(frameH > 0)) {
            resolve();
            return;
          }

          // Ensure stage is sized to this sprite's frame geometry.
          setStageSizeFromDims(frameW, frameH);

          const drawFrame = (k) => {
            const i = Math.max(0, Math.min(frames - 1, k));
            const sx = isVert ? 0 : (i * frameW);
            const sy = isVert ? (i * frameH) : 0;
            try {
              drawFill();
              spriteCtx.drawImage(spriteImg, sx, sy, frameW, frameH, 0, 0, spriteCanvas.width, spriteCanvas.height);
            } catch {
              // ignore
            }
          };

          const t0 = nowMs();
          const tick = () => {
            if (ended) {
              resolve();
              return;
            }
            const t = nowMs() - t0;
            const frac = transMs > 0 ? Math.min(1, Math.max(0, t / transMs)) : 1;
            const k = Math.min(frames - 1, Math.floor(frac * frames));
            drawFrame(k);
            if (t >= transMs) {
              drawFrame(frames - 1);
              resolve();
              return;
            }
            requestAnimationFrame(tick);
          };

          drawFrame(0);
          requestAnimationFrame(tick);
        });
      };

      const showImageAndCollect = (imageImg) => {
        return new Promise((resolve) => {
          spriteCanvas.style.display = 'block';
          imgEl.style.display = 'none';

          if (imageImg) {
            if (!(spriteCanvas.width > 0) || !(spriteCanvas.height > 0)) {
              const iw = imageImg.naturalWidth || imageImg.width || 0;
              const ih = imageImg.naturalHeight || imageImg.height || 0;
              if (iw > 0 && ih > 0) setStageSizeFromDims(iw, ih);
            }
            drawContain(imageImg);
          }

          if (!(imgMs > 0)) {
            endedReason = responded ? 'response' : 'timeout';
            resolve();
            return;
          }

          const onset = nowMs();

          const selectCategoryByKey = (rawKey) => {
            const k = normalizeKeyName(rawKey);
            const found = categorizationCategories.find((c) => normalizeKeyName(c.key) === k);
            if (!found) return null;
            return found;
          };

          const computeNbackCorrectness = (key) => {
            if (nbackResponseParadigm === '2afc') {
              if (!key) return false;
              return normalizeKeyName(key) === nbackCorrectResponse;
            }
            if (nbackIsMatch) {
              return normalizeKeyName(key) === nbackGoKey;
            }
            return false;
          };

          const afterResponseByKey = (rawKey, rawRt) => {
            if (responded) return;

            const key = normalizeKeyName(rawKey);
            if (!validKeys.includes(key)) return;

            responded = true;
            responseKey = key;
            rt = Number.isFinite(rawRt) ? rawRt : (nowMs() - onset);
            endedReason = 'response';

            if (cipParadigm === 'categorization') {
              respondedCategory = selectCategoryByKey(key);
              if (targetCategory) {
                correctness = !!(respondedCategory && Number(respondedCategory.index) === Number(targetCategory.index));
              } else {
                correctness = null;
              }
            } else {
              correctness = computeNbackCorrectness(key);
            }

            try {
              if (keyboardListener) this.jsPsych.pluginAPI.cancelKeyboardResponse(keyboardListener);
              keyboardListener = null;
            } catch {
              // ignore
            }
            try {
              if (imageTimeoutId) this.jsPsych.pluginAPI.clearTimeout(imageTimeoutId);
              imageTimeoutId = null;
            } catch {
              // ignore
            }

            const finishNow = () => resolve();
            if (cipParadigm === 'nback' && nbackShowFeedback && nbackFeedbackMs > 0) {
              try {
                if (promptEl) {
                  promptEl.textContent = correctness ? 'Correct' : 'Incorrect';
                  promptEl.style.opacity = '0.95';
                }
              } catch {
                // ignore
              }
              this.jsPsych.pluginAPI.setTimeout(() => finishNow(), nbackFeedbackMs);
              return;
            }

            finishNow();
          };

          const afterResponse = (info) => {
            afterResponseByKey(info && info.key, info && Number.isFinite(info.rt) ? info.rt : null);
          };

          if (cipParadigm === 'categorization' && showCategoryButtons) {
            controlsEl.querySelectorAll('[data-cip-category-key]').forEach((btn) => {
              btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-cip-category-key') || '';
                afterResponseByKey(key, nowMs() - onset);
              });
            });
          }

          if (cipParadigm === 'nback' && nbackResponseDevice === 'mouse' && nbackShowButtons) {
            controlsEl.querySelectorAll('[data-cip-nback-action]').forEach((btn) => {
              btn.addEventListener('click', () => {
                const action = (btn.getAttribute('data-cip-nback-action') || '').toString();
                if (action === 'match') afterResponseByKey(nbackMatchKey, nowMs() - onset);
                else if (action === 'nonmatch') afterResponseByKey(nbackNonmatchKey, nowMs() - onset);
                else if (action === 'go') afterResponseByKey(nbackGoKey, nowMs() - onset);
              });
            });
          }

          keyboardListener = this.jsPsych.pluginAPI.getKeyboardResponse({
            callback_function: afterResponse,
            valid_responses: validKeys,
            rt_method: 'performance',
            persist: false,
            allow_held_key: false
          });

          imageTimeoutId = this.jsPsych.pluginAPI.setTimeout(() => {
            endedReason = responded ? 'response' : 'timeout';
            if (cipParadigm === 'nback' && !responded) {
              if (nbackResponseParadigm === 'go_nogo' && nbackIsMatch) correctness = false;
              if (nbackResponseParadigm === '2afc') correctness = false;
              if (nbackResponseParadigm === 'go_nogo' && !nbackIsMatch) correctness = true;
            }
            try {
              if (keyboardListener) this.jsPsych.pluginAPI.cancelKeyboardResponse(keyboardListener);
              keyboardListener = null;
            } catch {
              // ignore
            }
            resolve();
          }, imgMs);
        });
      };

      const run = async () => {
        try {
          // Preload sprites first so we can set a stable stage size even if stimulus images have
          // varying dimensions (wide panoramas would otherwise shrink the stage into a strip).
          let spriteLayout = 'h';
          let spriteFrameW = null;
          let spriteFrameH = null;

          const m2iImg = m2iUrl ? await preloadImage(m2iUrl) : null;
          const i2mImg = i2mUrl ? await preloadImage(i2mUrl) : null;

          const primarySpriteImg = m2iImg || i2mImg;
          if (primarySpriteImg && primarySpriteImg.naturalWidth && primarySpriteImg.naturalHeight && frames > 0) {
            const inferred = inferSpriteLayout(primarySpriteImg.naturalWidth, primarySpriteImg.naturalHeight, frames, null, null);
            spriteLayout = inferred.layout || 'h';
            spriteFrameW = inferred.frameW || null;
            spriteFrameH = inferred.frameH || null;
            if (spriteFrameW && spriteFrameH) {
              setStageSizeFromDims(spriteFrameW, spriteFrameH);
            }
          }

          // Preload stimulus image to reduce flicker. If we don't have sprite dims, fall back to
          // the stimulus image dimensions for stage sizing.
          const img0 = await preloadImage(imageUrl);
          if ((!spriteFrameW || !spriteFrameH) && img0 && img0.naturalWidth && img0.naturalHeight) {
            setStageSizeFromDims(img0.naturalWidth, img0.naturalHeight);
          }

          await playSprite(m2iImg, spriteLayout);
          await showImageAndCollect(img0);
          await playSprite(i2mImg, spriteLayout);

          cleanupStyle();
          endTrial();
        } catch (e) {
          try {
            console.warn('[CIP] Trial failed', { imageUrl, filename, error: e });
          } catch {
            // ignore
          }
          endedReason = 'error';
          cleanupStyle();
          endTrial();
        }
      };

      run();
    }
  }

  JsPsychContinuousImagePresentationPlugin.info = info;
  window.jsPsychContinuousImagePresentation = JsPsychContinuousImagePresentationPlugin;
})(window.jsPsychModule || window.jsPsych);
