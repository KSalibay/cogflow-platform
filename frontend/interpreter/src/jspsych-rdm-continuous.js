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
    name: 'rdm-continuous',
    version: '1.0.0',
    parameters: {
      frames: { type: PT.OBJECT, array: true, default: [] },
      update_interval_ms: { type: PT.INT, default: 100 },
      default_transition: { type: PT.OBJECT, default: { duration_ms: 150, type: 'both' } },
      dataCollection: { type: PT.OBJECT, default: {} }
    },
    data: {
      records: { type: PT.OBJECT, array: true },
      ended_reason: { type: PT.STRING },
      plugin_version: { type: PT.STRING }
    }
  };

  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function safeNum(x, fallback) {
    const n = Number(x);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeTransitionType(raw) {
    const t = (typeof raw === 'string' ? raw.trim().toLowerCase() : '');
    // Builder historically used: both|mask|fixation. We reinterpret these as smooth blending controls.
    if (t === 'none' || t === 'off') return 'none';
    if (t === 'speed') return 'speed';
    if (t === 'color') return 'color';
    if (t === 'mask') return 'speed';
    if (t === 'fixation') return 'color';
    return 'both';
  }

  function computeCorrectSide(rdmParams) {
    return window.RDMEngine.computeCorrectSide(rdmParams);
  }

  function buildKeyMapping(response) {
    const km = response && typeof response.key_mapping === 'object' ? response.key_mapping : null;
    if (km) return km;

    const choices = Array.isArray(response.choices) ? response.choices : [];
    return {
      [choices[0] || 'f']: 'left',
      [choices[1] || 'j']: 'right'
    };
  }

  function normalizeChoices(response) {
    if (!response) return [];
    if (response.choices === 'ALL_KEYS') return 'ALL_KEYS';
    if (Array.isArray(response.choices)) return response.choices;
    return [];
  }

  function expandKeyVariants(key) {
    const k = (key || '').toString();
    if (k.length === 1 && /[a-z]/i.test(k)) {
      return [k.toLowerCase(), k.toUpperCase()];
    }
    return [k];
  }

  function normalizeAngleDeg(raw) {
    const a = Number(raw);
    if (!Number.isFinite(a)) return 0;
    return ((a % 360) + 360) % 360;
  }

  function getCorrectDirectionDeg(rdmParams) {
    const p = rdmParams || {};

    if ((p.type === 'rdm-dot-groups') || p.group_1_direction !== undefined || p.group_2_direction !== undefined) {
      let group = Number(p.response_target_group);
      if (group !== 1 && group !== 2) {
        const c1 = Number(p.group_1_coherence ?? 0);
        const c2 = Number(p.group_2_coherence ?? 0);
        group = (c1 >= c2) ? 1 : 2;
      }
      const dir = (group === 1) ? Number(p.group_1_direction ?? 0) : Number(p.group_2_direction ?? 180);
      return normalizeAngleDeg(dir);
    }

    return normalizeAngleDeg(Number(p.direction ?? p.coherent_direction ?? 0));
  }

  class JsPsychRdmContinuousPlugin {
    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element, trial) {
      const frames = Array.isArray(trial.frames) ? trial.frames : [];
      const updateInterval = Math.max(1, safeNum(trial.update_interval_ms, 100));
      const dataCollection = trial.dataCollection || {};

      if (frames.length === 0) {
        display_element.innerHTML = '<div style="padding:24px;">No frames to run.</div>';
        this.jsPsych.finishTrial({ error: 'no_frames' });
        return;
      }

      // First frame determines canvas sizing.
      const first = frames[0] || {};
      const firstRdm = first.rdm || {};
      const canvasW = safeNum(firstRdm.canvas_width, 600);
      const canvasH = safeNum(firstRdm.canvas_height, 600);

      display_element.innerHTML = `
        <div id="rdm-wrap" style="width:100%; display:flex; justify-content:center; align-items:center; flex-direction:column; gap:10px;">
          <canvas id="rdm-canvas" width="${canvasW}" height="${canvasH}" style="border: 1px solid rgba(255,255,255,0.15);"></canvas>
          <div id="rdm-feedback" style="min-height: 24px;"></div>
        </div>
      `;

      const canvas = display_element.querySelector('#rdm-canvas');
      const feedbackEl = display_element.querySelector('#rdm-feedback');

      const engine = new window.RDMEngine(canvas, firstRdm);
      engine.start();

      let frameIndex = 0;
      let segmentStart = nowMs();
      let lastAdvance = segmentStart;

      // Transition interpolation state
      let fromRdm = firstRdm;
      let toRdm = firstRdm;
      let transitionStart = segmentStart;
      let transitionDuration = 0;
      let transitionType = 'none';

      // Response state
      let respondedThisFrame = false;
      let startTs = nowMs();
      let ended = false;

      const trialStartTs = nowMs();

      // Per-frame summary fields (so CSV has one row per frame with these columns)
      let frameResponseSide = null;
      let frameResponseKey = null;
      let frameRtMs = null;
      let frameIsCorrect = null;
      let frameResponseAngleDeg = null;
      let frameResponseAngleRawDeg = null;
      let frameResponseSegmentIndex = null;

      // Detection Response Task (DRT) state (per-frame)
      const drtKey = ' ';
      let drtActive = false;
      let drtShown = false;
      let drtOnsetTs = null;
      let drtRt = null;
      let drtTimeoutId = null;

      const clearDrt = () => {
        drtActive = false;
        drtShown = false;
        drtOnsetTs = null;
        drtRt = null;
        if (drtTimeoutId) {
          window.clearTimeout(drtTimeoutId);
          drtTimeoutId = null;
        }
        const existing = display_element.querySelector('#drt-dot');
        if (existing && existing.parentNode) existing.remove();
      };

      const scheduleDrtForCurrentFrame = () => {
        clearDrt();

        const frame = getFrame(frameIndex);
        const rdm = frame.rdm || {};
        if (rdm.detection_response_task_enabled !== true) return;

        drtActive = true;

        const timing = frame.timing || {};
        const deadline = safeNum(timing.response_deadline, safeNum(timing.stimulus_duration, updateInterval));

        const minDelay = 300;
        const maxDelay = Math.max(minDelay, Math.floor(Math.max(1, deadline) * 0.75));
        const delay = minDelay + Math.floor(Math.random() * Math.max(1, (maxDelay - minDelay)));

        drtTimeoutId = window.setTimeout(() => {
          if (ended || !drtActive) return;

          drtShown = true;
          drtOnsetTs = nowMs();

          const el = document.createElement('div');
          el.id = 'drt-dot';
          el.style.cssText = 'position:absolute; top: 18px; left: 18px; width: 14px; height: 14px; border-radius: 50%; background: #FFD23F; box-shadow: 0 0 0 3px rgba(0,0,0,0.3);';

          const wrap = display_element.querySelector('#rdm-wrap');
          if (wrap) {
            wrap.style.position = 'relative';
            wrap.appendChild(el);
            window.setTimeout(() => {
              if (el && el.parentNode) el.remove();
            }, 200);
          }
        }, delay);
      };

      const records = [];

      const getFrame = (idx) => frames[Math.max(0, Math.min(frames.length - 1, idx))];

      const showFeedback = (frame, isCorrect) => {
        const resp = frame.response || {};
        const fb = resp && resp.feedback && resp.feedback.enabled ? resp.feedback : null;
        if (!fb || !feedbackEl) return;

        const duration = safeNum((frame.rdm || {}).feedback_duration ?? fb.duration_ms, 150);
        const color = isCorrect ? '#5CFF8A' : '#FF5C5C';

        if (fb.type === 'corner-text') {
          feedbackEl.innerHTML = `<div style="width:${canvasW}px; display:flex; justify-content:space-between;">
            <span style="color:${color}; font-weight:600;">${isCorrect ? 'Correct' : 'Incorrect'}</span>
            <span style="opacity:0.7"></span>
          </div>`;
        } else if (fb.type === 'arrow') {
          const directionDeg = getCorrectDirectionDeg(frame.rdm || {});
          if (engine) {
            engine.arrowDirectionDeg = directionDeg;
            engine.arrowColor = color;
          }
          feedbackEl.innerHTML = `<div style="width:${canvasW}px; text-align:center; opacity:0.85; font-size:12px;">Arrow: ${Math.round(directionDeg)}°</div>`;
        } else {
          feedbackEl.innerHTML = `<div style="width:${canvasW}px; text-align:center; opacity:0.85;">(custom feedback placeholder)</div>`;
        }

        window.setTimeout(() => {
          feedbackEl.innerHTML = '';
        }, duration);
      };

      const advanceFrame = (reason) => {
        const frame = getFrame(frameIndex);
        const rdm = frame.rdm || {};
        const response = frame.response || {};

        const correctSide = computeCorrectSide(rdm);

        // Record end-of-frame even if no response
        records.push({
          frame_index: frameIndex,
          event: 'frame_end',
          t_ms: Math.round(nowMs() - trialStartTs),
          ended_reason: reason || 'advance',
          rdm,
          response,
          correct_side: correctSide,
          rt_ms: frameRtMs,
          accuracy: frameIsCorrect,
          correctness: frameIsCorrect,
          response_side: frameResponseSide,
          response_key: frameResponseKey,
          response_angle_deg: frameResponseAngleDeg,
          response_angle_raw_deg: frameResponseAngleRawDeg,
          response_segment_index: frameResponseSegmentIndex,
          ...(rdm.detection_response_task_enabled ? {
            drt_enabled: true,
            drt_shown: drtShown,
            drt_rt_ms: drtRt
          } : {})
        });

        frameIndex++;
        respondedThisFrame = false;
        startTs = nowMs();

        frameResponseSide = null;
        frameResponseKey = null;
        frameRtMs = null;
        frameIsCorrect = null;
        frameResponseAngleDeg = null;
        frameResponseAngleRawDeg = null;
        frameResponseSegmentIndex = null;

        clearDrt();

        if (frameIndex >= frames.length) {
          finish('completed');
          return;
        }

        // Setup interpolation to next
        const next = getFrame(frameIndex);
        fromRdm = rdm;
        toRdm = next.rdm || {};

        const nextTransition = next.transition || {};
        const defaultTransition = trial.default_transition || { duration_ms: 150, type: 'both' };

        transitionDuration = Math.max(0, safeNum(nextTransition.duration_ms, safeNum(defaultTransition.duration_ms, 150)));
        transitionType = normalizeTransitionType(nextTransition.type ?? defaultTransition.type);
        transitionStart = nowMs();

        // If structural params changed, re-init engine immediately (rare).
        if (typeof engine.needsReinitFor === 'function' && engine.needsReinitFor(fromRdm, toRdm)) {
          engine.updateParams(toRdm);
          // After a structural reinit, treat interpolation as done.
          transitionDuration = 0;
          transitionType = 'none';
          fromRdm = toRdm;
        }

        segmentStart = nowMs();
        lastAdvance = segmentStart;

        scheduleDrtForCurrentFrame();

        // New frame => restart keyboard mapping/choices.
        setKeyboardListenerForCurrentFrame();

        // New frame => ensure pointer listener mode/device matches.
        setPointerListenerForCurrentFrame();
      };

      const finish = (reason) => {
        if (ended) return;
        ended = true;
        engine.stop();
        cleanupListeners();

        this.jsPsych.finishTrial({
          experiment_type: 'continuous',
          frames_count: frames.length,
          ended_reason: reason,
          records,
          ...(dataCollection['correctness'] ? { correctness_enabled: true } : {})
        });
      };

      const maybeApplyInterpolation = () => {
        if (transitionDuration <= 0 || transitionType === 'none') {
          // Hard switch at the start of the segment.
          engine.applyDynamicsFromParams(toRdm);
          return;
        }

        const t = Math.max(0, Math.min(1, (nowMs() - transitionStart) / transitionDuration));
        engine.applyInterpolatedDynamics(fromRdm, toRdm, t, transitionType);
      };

      // Run loop: keep presentation continuous; only update parameters.
      const tick = () => {
        if (ended) return;

        maybeApplyInterpolation();

        const frame = getFrame(frameIndex);
        const timing = frame.timing || {};
        const deadline = safeNum(timing.response_deadline, safeNum(timing.stimulus_duration, updateInterval));

        const resp = frame.response || {};
        const endOnResponse = resp.end_condition_on_response === true;

        const elapsed = nowMs() - segmentStart;

        // Auto-advance on deadline (or on end-on-response when response arrives).
        if (elapsed >= deadline) {
          advanceFrame('deadline');
        } else {
          // Maintain update cadence too (helps align with exported update_interval semantics)
          const stepElapsed = nowMs() - lastAdvance;
          if (stepElapsed >= updateInterval) {
            lastAdvance = nowMs();
            // no-op; the visual engine is continuous via RAF
          }
        }

        requestAnimationFrame(tick);
      };

      // Responses
      let keyListenerId = null;
      let mouseListener = null;
      let mouseListenerEvent = null;

      const handleResponse = (side, key, meta) => {
        if (ended) return;

        // DRT capture should not affect the main response.
        if (drtActive && key === drtKey) {
          if (drtShown && drtRt === null && drtOnsetTs) {
            drtRt = Math.round(nowMs() - drtOnsetTs);
          }
          return;
        }

        const frame = getFrame(frameIndex);
        const rdm = frame.rdm || {};
        const response = frame.response || {};

        const correctSide = computeCorrectSide(rdm);
        const isCorrect = side ? side === correctSide : null;

        if (!respondedThisFrame) {
          respondedThisFrame = true;
          const rt = Math.round(nowMs() - startTs);

          frameResponseSide = side;
          frameResponseKey = key || null;
          frameRtMs = rt;
          frameIsCorrect = isCorrect;
          frameResponseAngleDeg = (meta && Number.isFinite(meta.angle_deg)) ? meta.angle_deg : null;
          frameResponseAngleRawDeg = (meta && Number.isFinite(meta.raw_angle_deg)) ? meta.raw_angle_deg : null;
          frameResponseSegmentIndex = (meta && Number.isFinite(meta.segment_index)) ? meta.segment_index : null;

          // Attach response to the latest record (or create a response record)
          records.push({
            frame_index: frameIndex,
            event: 'response',
            t_ms: Math.round(nowMs() - trialStartTs),
            response_side: side,
            response_key: key || null,
            response_angle_deg: frameResponseAngleDeg,
            response_angle_raw_deg: frameResponseAngleRawDeg,
            response_segment_index: frameResponseSegmentIndex,
            rt_ms: rt,
            correct_side: correctSide,
            accuracy: isCorrect,
            correctness: isCorrect
          });

          if (isCorrect !== null) showFeedback(frame, isCorrect);

          // Continuous-only: end condition advances immediately.
          if (response.end_condition_on_response === true) {
            advanceFrame('response_end_condition');
          }
        }
      };

      const setKeyboardListenerForCurrentFrame = () => {
        if (keyListenerId) {
          this.jsPsych.pluginAPI.cancelKeyboardResponse(keyListenerId);
          keyListenerId = null;
        }

        const frame = getFrame(frameIndex);
        const response = frame.response || {};
        const responseDevice = response.response_device || 'keyboard';
        if (responseDevice !== 'keyboard') return;

        const choices = normalizeChoices(response);
        const keyMapping = buildKeyMapping(response);

        const normalizedKeyMapping = (() => {
          const out = {};
          if (keyMapping && typeof keyMapping === 'object') {
            for (const [k, v] of Object.entries(keyMapping)) {
              if (typeof k === 'string') {
                out[k] = v;
                out[k.toLowerCase()] = v;
              }
            }
          }
          return out;
        })();

        const validResponses = (() => {
          if (choices === 'ALL_KEYS') return 'ALL_KEYS';
          const base = Array.isArray(choices)
            ? Array.from(new Set(choices.flatMap(expandKeyVariants)))
            : [];
          return Array.from(new Set(base.concat([drtKey])));
        })();

        keyListenerId = this.jsPsych.pluginAPI.getKeyboardResponse({
          callback_function: (info) => {
            const rawKey = info && info.key !== undefined ? info.key : null;
            const k = (typeof rawKey === 'string') ? rawKey : null;
            const kLower = (typeof k === 'string') ? k.toLowerCase() : null;

            // DRT capture should not affect the main response.
            if (drtActive && k === drtKey) {
              if (drtShown && drtRt === null && drtOnsetTs) {
                drtRt = Math.round(nowMs() - drtOnsetTs);
              }
              return;
            }

            if (choices === 'ALL_KEYS') {
              const side = (k && normalizedKeyMapping && normalizedKeyMapping[k])
                ? normalizedKeyMapping[k]
                : (kLower && normalizedKeyMapping && normalizedKeyMapping[kLower])
                  ? normalizedKeyMapping[kLower]
                  : null;
              const rtOverride = (info && Number.isFinite(info.rt)) ? Math.round(info.rt) : null;
              if (rtOverride !== null) startTs = nowMs() - rtOverride;
              handleResponse(side, kLower || k, null);
              return;
            }

            if (Array.isArray(choices) && k) {
              const ok = choices.includes(k) || (kLower && choices.includes(kLower));
              if (!ok) return;
              const side = (normalizedKeyMapping && normalizedKeyMapping[k])
                ? normalizedKeyMapping[k]
                : (kLower && normalizedKeyMapping && normalizedKeyMapping[kLower])
                  ? normalizedKeyMapping[kLower]
                  : null;
              const rtOverride = (info && Number.isFinite(info.rt)) ? Math.round(info.rt) : null;
              if (rtOverride !== null) startTs = nowMs() - rtOverride;
              handleResponse(side, kLower || k, null);
            }
          },
          valid_responses: validResponses,
          rt_method: 'performance',
          persist: true,
          allow_held_key: false
        });
      };

      const setPointerListenerForCurrentFrame = () => {
        // Always clear existing pointer listener so per-frame response_device/selection_mode changes work.
        if (mouseListener && mouseListenerEvent) {
          canvas.removeEventListener(mouseListenerEvent, mouseListener);
        }
        mouseListener = null;
        mouseListenerEvent = null;

        const frame = getFrame(frameIndex);
        const response = frame.response || {};
        const responseDevice = response.response_device || 'keyboard';

        if (!(responseDevice === 'mouse' || responseDevice === 'touch')) return;

        const mr = response.mouse_response || {};
        const segments = Math.max(2, safeNum(mr.segments, 2));
        const startAngle = safeNum(mr.start_angle_deg, 0);
        const selectionModeRaw = (mr.selection_mode ?? mr.mode ?? 'click');
        const selectionMode = (typeof selectionModeRaw === 'string' ? selectionModeRaw.trim().toLowerCase() : 'click');

        const frameRdm = (getFrame(frameIndex).rdm || {});
        const apertureCx = safeNum(
          frameRdm.aperture_center_x ?? frameRdm.center_x ?? (frameRdm.aperture_parameters && frameRdm.aperture_parameters.center_x),
          canvas.width / 2
        );
        const apertureCy = safeNum(
          frameRdm.aperture_center_y ?? frameRdm.center_y ?? (frameRdm.aperture_parameters && frameRdm.aperture_parameters.center_y),
          canvas.height / 2
        );
        const apertureDiameter = Number(
          frameRdm.aperture_diameter ??
          frameRdm.apertureDiameter ??
          (frameRdm.aperture_parameters && frameRdm.aperture_parameters.diameter) ??
          (frameRdm.aperture_parameters && frameRdm.aperture_parameters.diameter_px) ??
          NaN
        );
        const apertureRadius = Number.isFinite(apertureDiameter)
          ? (apertureDiameter / 2)
          : (Math.min(canvas.width, canvas.height) / 2);

        const boundaryWidthPx = Math.max(1, safeNum(mr.boundary_width_px, 16));
        let wasInBoundaryBand = false;

        const computeMouseResponseInfo = (x, y) => {
          const dx = x - apertureCx;
          const dy = y - apertureCy;
          const rawAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
          const angleFromStart = (rawAngle - startAngle + 360) % 360;
          const seg = Math.floor((angleFromStart / 360) * segments);
          const side = (segments === 2) ? (seg === 0 ? 'right' : 'left') : (seg < segments / 2 ? 'right' : 'left');
          return {
            side,
            segment_index: Math.max(0, Math.min(segments - 1, seg)),
            angle_deg: angleFromStart,
            raw_angle_deg: rawAngle
          };
        };

        mouseListener = (e) => {
          // Normalize pointer/mouse events
          const clientX = e && typeof e.clientX === 'number' ? e.clientX : null;
          const clientY = e && typeof e.clientY === 'number' ? e.clientY : null;
          if (clientX === null || clientY === null) return;

          const rect = canvas.getBoundingClientRect();
          const x = clientX - rect.left;
          const y = clientY - rect.top;

          // Ignore if outside canvas bounds (defensive)
          if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;

          // For hover selection, only accept when entering the boundary band around the aperture edge.
          if (selectionMode === 'hover' || selectionMode === 'mousemove') {
            const dxBand = x - apertureCx;
            const dyBand = y - apertureCy;
            const dist = Math.sqrt(dxBand * dxBand + dyBand * dyBand);
            const inner = Math.max(0, apertureRadius - boundaryWidthPx);
            const outer = apertureRadius + boundaryWidthPx;
            const inBand = (dist >= inner && dist <= outer);

            // Trigger on first entry into the band (works for inward and outward crossings).
            if (!wasInBoundaryBand && !inBand) {
              wasInBoundaryBand = false;
              return;
            }
            if (wasInBoundaryBand) {
              return;
            }
            if (inBand) {
              wasInBoundaryBand = true;
            } else {
              return;
            }
          }

          const info = computeMouseResponseInfo(x, y);
          handleResponse(info.side, null, info);
        };

        // click = explicit click/tap; hover = continuous selection via pointer movement
        if (selectionMode === 'hover' || selectionMode === 'mousemove') {
          mouseListenerEvent = 'mousemove';
        } else {
          mouseListenerEvent = 'click';
        }

        canvas.addEventListener(mouseListenerEvent, mouseListener);
      };

      const setupListeners = () => {
        // Always call both; each function cancels its previous listener and
        // only re-attaches if the current frame uses that device.
        setKeyboardListenerForCurrentFrame();
        setPointerListenerForCurrentFrame();
      };

      const cleanupListeners = () => {
        if (keyListenerId) this.jsPsych.pluginAPI.cancelKeyboardResponse(keyListenerId);
        if (mouseListener && mouseListenerEvent) canvas.removeEventListener(mouseListenerEvent, mouseListener);
        keyListenerId = null;
        mouseListener = null;
        mouseListenerEvent = null;
      };

      // Kick off
      setupListeners();
      // Initialize interpolation state to first frame
      fromRdm = firstRdm;
      toRdm = firstRdm;
      engine.applyDynamicsFromParams(firstRdm);

      scheduleDrtForCurrentFrame();

      // Ensure keyboard listener exists for first frame, and refresh it as frames advance.
      setKeyboardListenerForCurrentFrame();

      // Ensure pointer listener matches the first frame.
      setPointerListenerForCurrentFrame();

      requestAnimationFrame(tick);
    }
  }

  JsPsychRdmContinuousPlugin.info = info;
  window.jsPsychRdmContinuous = JsPsychRdmContinuousPlugin;
})(window.jsPsychModule || window.jsPsych);
