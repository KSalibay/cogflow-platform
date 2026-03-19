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

      choices: { type: PT.KEYS, default: ['f', 'j'] }
    },
    data: {
      response_key: { type: PT.STRING },
      rt_ms: { type: PT.INT },
      responded: { type: PT.BOOL },
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

  let _trialUid = 0;

  class JsPsychContinuousImagePresentationPlugin {
    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element, trial) {
      const uid = (++_trialUid);

      const imageUrl = (trial.image_url ?? '').toString();
      const filename = (trial.asset_filename ?? '').toString();
      const m2iUrl = (trial.mask_to_image_sprite_url ?? '') ? String(trial.mask_to_image_sprite_url) : '';
      const i2mUrl = (trial.image_to_mask_sprite_url ?? '') ? String(trial.image_to_mask_sprite_url) : '';

      const frames = Number.isFinite(Number(trial.transition_frames)) ? Math.max(1, Math.floor(Number(trial.transition_frames))) : 8;
      const imgMs = Number.isFinite(Number(trial.image_duration_ms)) ? Math.max(0, Math.floor(Number(trial.image_duration_ms))) : 750;
      const transMs = Number.isFinite(Number(trial.transition_duration_ms)) ? Math.max(0, Math.floor(Number(trial.transition_duration_ms))) : 200;

      const choices = normalizeChoices(trial.choices);
      const validKeys = Array.from(new Set(choices.flatMap(expandKeyVariants).map(normalizeKeyName).filter(Boolean)));

      let responded = false;
      let responseKey = null;
      let rt = null;
      let endedReason = null;

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
          response_key: responseKey,
          rt_ms: Number.isFinite(rt) ? Math.round(rt) : null,
          responded: responded === true,
          ended_reason: endedReason || (responded ? 'response' : 'timeout'),
          plugin_version: info.version
        });
      };

      const wrapId = `cip-wrap-${uid}`;
      const stageId = `cip-stage-${uid}`;
      const spriteId = `cip-sprite-${uid}`;
      const imgId = `cip-img-${uid}`;
      const promptId = `cip-prompt-${uid}`;

      display_element.innerHTML = `
        <div id="${wrapId}" style="width:100%; min-height:100vh; min-height:100svh; min-height:100dvh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; box-sizing:border-box; padding:24px 12px;">
          <div id="${stageId}" style="position:relative; display:flex; align-items:center; justify-content:center; width:100%;">
            <canvas id="${spriteId}" style="display:none; image-rendering: pixelated;"></canvas>
            <img id="${imgId}" alt="" style="display:none; max-width:90vw; max-height:70vh; object-fit:contain;" />
          </div>
          <div id="${promptId}" style="opacity:0.7; font-size:12px; text-align:center;"></div>
        </div>
      `;

      const wrapEl = display_element.querySelector(`#${wrapId}`);
      const stageEl = display_element.querySelector(`#${stageId}`);
      const spriteEl = display_element.querySelector(`#${spriteId}`);
      const imgEl = display_element.querySelector(`#${imgId}`);
      const promptEl = display_element.querySelector(`#${promptId}`);

      if (!wrapEl || !stageEl || !spriteEl || !imgEl || !promptEl) {
        endedReason = 'render_error';
        endTrial();
        return;
      }

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

      const promptText = `Press ${choices.map(k => (k === ' ' ? 'space' : k)).join(' / ')}`;
      promptEl.textContent = promptText;

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

          const afterResponse = (info) => {
            if (responded) return;
            responded = true;
            responseKey = info && info.key ? normalizeKeyName(info.key) : null;
            rt = info && Number.isFinite(info.rt) ? info.rt : (nowMs() - onset);
            endedReason = 'response';

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

            resolve();
          };

          keyboardListener = this.jsPsych.pluginAPI.getKeyboardResponse({
            callback_function: afterResponse,
            valid_responses: validKeys,
            rt_method: 'performance',
            persist: false,
            allow_held_key: false
          });

          imageTimeoutId = this.jsPsych.pluginAPI.setTimeout(() => {
            endedReason = responded ? 'response' : 'timeout';
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
