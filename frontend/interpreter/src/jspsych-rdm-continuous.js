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

  function isRdmDebugEnabled() {
    try {
      if (typeof window !== 'undefined' && window.COGFLOW_RDM_DEBUG === true) return true;
      if (typeof window !== 'undefined' && window.COGFLOW_RDM_DEBUG === false) return false;
      if (typeof window !== 'undefined' && window.localStorage?.getItem('cogflow_rdm_debug_overlay') === '1') return true;
      if (typeof window !== 'undefined' && window.location && typeof window.location.search === 'string') {
        const q = new URLSearchParams(window.location.search);
        const raw = (q.get('rdm_debug') || '').toString().trim().toLowerCase();
        if (raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes') return true;
      }
    } catch {
      // ignore
    }
    return false;
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

  function parseAngleDegrees(raw) {
    return normalizeAngleDeg(raw);
  }

  function computeSideFromUiAngle(rawAngleDeg) {
    const normalized = normalizeAngleDeg(rawAngleDeg);
    return Math.cos((normalized * Math.PI) / 180) >= 0 ? 'right' : 'left';
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

  function angularDistanceDeg(a, b) {
    const aa = normalizeAngleDeg(a);
    const bb = normalizeAngleDeg(b);
    const d = Math.abs(aa - bb);
    return Math.min(d, 360 - d);
  }

  function resolveArrowFeedbackColor(feedback, isCorrect) {
    const fb = feedback && typeof feedback === 'object' ? feedback : {};
    const modeRaw = (fb.arrow_color_mode ?? 'auto').toString().trim().toLowerCase();
    const mode = (modeRaw === 'inherit' || modeRaw === '') ? 'auto' : modeRaw;

    if (mode === 'neutral') return (fb.arrow_neutral_color || '#CBD5E1').toString();
    if (mode === 'custom') return (fb.arrow_custom_color || '#93A3B8').toString();
    return isCorrect
      ? (fb.arrow_correct_color || '#5CFF8A').toString()
      : (fb.arrow_incorrect_color || '#FF5C5C').toString();
  }

  function resolveArrowFeedbackStyle(feedback) {
    const fb = feedback && typeof feedback === 'object' ? feedback : {};
    const sizeRaw = Number(fb.arrow_size_px);
    const lineWidthRaw = Number(fb.arrow_line_width_px);
    return {
      arrowSizePx: (Number.isFinite(sizeRaw) && sizeRaw > 0) ? sizeRaw : null,
      arrowLineWidthPx: (Number.isFinite(lineWidthRaw) && lineWidthRaw > 0) ? lineWidthRaw : null,
    };
  }

  function evaluateMouseCorrectness(meta, activeRdm, response, fallbackSide, fallbackCorrectSide) {
    const mouse = (response && response.mouse_response && typeof response.mouse_response === 'object')
      ? response.mouse_response
      : {};
    const segments = Math.max(2, Number(mouse.segments ?? 2));
    const modeRaw = (mouse.accuracy_mode ?? '').toString().trim().toLowerCase();
    const mode = (modeRaw === 'angular' || modeRaw === 'side')
      ? modeRaw
      : (segments > 2 ? 'angular' : 'side');

    if (mode === 'side' || !meta || !Number.isFinite(meta.raw_angle_deg)) {
      return {
        isCorrect: (fallbackSide !== null && fallbackCorrectSide !== null) ? (fallbackSide === fallbackCorrectSide) : null,
        method: 'side',
        angleErrorDeg: null,
        toleranceDeg: null,
        targetDirectionDeg: null,
      };
    }

    const targetDirectionDeg = getCorrectDirectionDeg(activeRdm || {});
    const responseDirectionDeg = normalizeAngleDeg(meta.raw_angle_deg);
    const angleErrorDeg = angularDistanceDeg(responseDirectionDeg, targetDirectionDeg);

    const toleranceRaw = Number(mouse.accuracy_tolerance_deg);
    const baseToleranceDeg = (Number.isFinite(toleranceRaw) && toleranceRaw > 0)
      ? toleranceRaw
      : (180 / segments);
    const slackRaw = Number(mouse.accuracy_slack_deg);
    const slackDeg = (Number.isFinite(slackRaw) && slackRaw > 0) ? slackRaw : 0;
    const toleranceDeg = Math.max(0, baseToleranceDeg + slackDeg);

    return {
      isCorrect: angleErrorDeg <= toleranceDeg,
      method: 'angular',
      angleErrorDeg,
      toleranceDeg,
      targetDirectionDeg,
    };
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
          <pre id="rdm-debug-panel" style="display:none; margin:0; width:min(980px,95vw); max-height:30vh; overflow:auto; box-sizing:border-box; padding:8px 10px; border:1px solid rgba(255,255,255,0.2); background:rgba(0,0,0,0.58); color:#cfe9ff; font:12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;"></pre>
        </div>
      `;

      const canvas = display_element.querySelector('#rdm-canvas');
      const feedbackEl = display_element.querySelector('#rdm-feedback');
      const debugPanelEl = display_element.querySelector('#rdm-debug-panel');

      const engine = new window.RDMEngine(canvas, firstRdm);
      engine.start();
      let debugPanelEnabled = isRdmDebugEnabled();
      if (typeof engine.setDebugOverlayEnabled === 'function') {
        engine.setDebugOverlayEnabled(debugPanelEnabled, { persist: false });
      }
      if (debugPanelEl) {
        debugPanelEl.style.display = debugPanelEnabled ? 'block' : 'none';
      }

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
      let frameResponseDistanceFromCenterPx = null;
      let frameResponseWithinAperture = null;
      let frameResponseWithinBoundaryBand = null;
      let frameResponseWithinCanvas = null;
      let frameResponseAccuracyMethod = null;
      let frameResponseAngleErrorDeg = null;
      let frameResponseToleranceDeg = null;
      let frameResponseTargetDirectionDeg = null;

      let frameMouseSelectionMode = null;
      let frameMouseRegionPolicy = null;
      let frameMouseBoundaryWidthPx = null;
      let frameMouseApertureRadiusPx = null;
      let frameMousePointerEvents = 0;
      let frameMouseInsideCanvasEvents = 0;
      let frameMouseRejectedOutsideCanvasEvents = 0;
      let frameMouseRejectedOutsideBoundaryBandEvents = 0;
      let frameMouseBoundaryBandEntryEvents = 0;
      let frameMouseClickEvents = 0;
      let frameMouseMoveEvents = 0;
      let frameMouseLastPointerX = null;
      let frameMouseLastPointerY = null;

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
        const color = resolveArrowFeedbackColor(fb, isCorrect);

        if (fb.type === 'corner-text') {
          feedbackEl.innerHTML = `<div style="width:${canvasW}px; display:flex; justify-content:space-between;">
            <span style="color:${color}; font-weight:600;">${isCorrect ? 'Correct' : 'Incorrect'}</span>
            <span style="opacity:0.7"></span>
          </div>`;
        } else if (fb.type === 'arrow') {
          const directionDeg = getCorrectDirectionDeg(frame.rdm || {});
          const arrowStyle = resolveArrowFeedbackStyle(fb);
          if (engine) {
            engine.arrowDirectionDeg = directionDeg;
            engine.arrowColor = color;
            engine.arrowSizePx = arrowStyle.arrowSizePx;
            engine.arrowLineWidthPx = arrowStyle.arrowLineWidthPx;
          }
            feedbackEl.innerHTML = '';
        } else {
          feedbackEl.innerHTML = `<div style="width:${canvasW}px; text-align:center; opacity:0.85;">(custom feedback placeholder)</div>`;
        }

        window.setTimeout(() => {
          feedbackEl.innerHTML = '';
          if (engine) {
            engine.arrowDirectionDeg = null;
            engine.arrowColor = null;
            engine.arrowSizePx = null;
            engine.arrowLineWidthPx = null;
          }
        }, duration);
      };

      const updateDebugPanel = () => {
        if (!debugPanelEl || !debugPanelEnabled) return;

        const frame = getFrame(frameIndex);
        const rdm = (frame && frame.rdm) ? frame.rdm : {};
        const timing = (frame && frame.timing) ? frame.timing : {};
        const response = (frame && frame.response) ? frame.response : {};
        const elapsed = Math.max(0, Math.round(nowMs() - segmentStart));
        const deadline = Math.round(safeNum(timing.response_deadline, safeNum(timing.stimulus_duration, updateInterval)));
        const snap = (engine && typeof engine.getDebugSnapshot === 'function') ? engine.getDebugSnapshot() : null;

        const measuredCohPct = (snap && Number.isFinite(Number(snap.coherent_ratio)))
          ? (Number(snap.coherent_ratio) * 100)
          : null;
        const measuredSpeed = (snap && Number.isFinite(Number(snap.avg_speed)))
          ? Number(snap.avg_speed)
          : null;
        const measuredDir = (snap && Number.isFinite(Number(snap.mean_direction_deg)))
          ? Number(snap.mean_direction_deg)
          : null;
        const targetCohPct = Number.isFinite(Number(rdm.coherence)) ? (Number(rdm.coherence) * 100) : null;
        const targetSpeed = Number.isFinite(Number(rdm.speed)) ? Number(rdm.speed) : null;
        const targetDir = Number.isFinite(Number(rdm.direction ?? rdm.coherent_direction)) ? Number(rdm.direction ?? rdm.coherent_direction) : null;

        const lines = [
          'RDM DEBUG PANEL  (Ctrl+Shift+D toggles, ?rdm_debug=1 enables on load)',
          `frame ${frameIndex + 1}/${frames.length}  elapsed=${elapsed}ms  deadline=${deadline}ms  transition=${transitionType}  transition_ms=${Math.round(transitionDuration)}`,
          `noise=${snap ? snap.noise_type : String(rdm.noise_type || '')}  lifetime=${snap ? snap.lifetime_frames : Number(rdm.lifetime_frames || 0)}  dots=${snap ? snap.total_dots : Number(rdm.total_dots || 0)} coherent=${snap ? snap.coherent_dots : 'n/a'}`,
          `fps=${snap && Number.isFinite(snap.fps) ? snap.fps.toFixed(1) : 'n/a'}  reseeds/s=${snap ? snap.reseeds_per_sec : 'n/a'}  noise-jumps/s=${snap ? snap.noise_jumps_per_sec : 'n/a'}`,
          `coherence target=${targetCohPct !== null ? targetCohPct.toFixed(1) + '%' : 'n/a'} measured=${measuredCohPct !== null ? measuredCohPct.toFixed(1) + '%' : 'n/a'}`,
          `speed target=${targetSpeed !== null ? targetSpeed : 'n/a'} measured=${measuredSpeed !== null ? measuredSpeed.toFixed(2) : 'n/a'}  dir target=${targetDir !== null ? targetDir : 'n/a'} measured=${measuredDir !== null ? measuredDir.toFixed(1) : 'n/a'}`,
          `response_device=${String(response.response_device || 'keyboard')} end_on_response=${response.end_condition_on_response === true}`
        ];
        debugPanelEl.textContent = lines.join('\n');
      };

      const advanceFrame = (reason) => {
        const frame = getFrame(frameIndex);
        const rdm = frame.rdm || {};
        const response = frame.response || {};

        const activeRdm = (engine && engine.params && typeof engine.params === 'object')
          ? { ...rdm, ...engine.params }
          : rdm;

        const correctSide = computeCorrectSide(activeRdm);
        const frameResponseRegistered = respondedThisFrame === true;
        let frameResponseNotRegisteredReason = null;
        if (!frameResponseRegistered) {
          if (response.response_device === 'mouse' || response.response_device === 'touch') {
            const isHoverMode = (frameMouseSelectionMode === 'hover' || frameMouseSelectionMode === 'mousemove');
            if (isHoverMode && frameMouseBoundaryBandEntryEvents <= 0) {
              frameResponseNotRegisteredReason = 'pointer_never_reached_aperture_boundary_band';
            } else if (frameMousePointerEvents <= 0) {
              frameResponseNotRegisteredReason = 'no_pointer_event_captured';
            } else if (frameMouseInsideCanvasEvents <= 0) {
              frameResponseNotRegisteredReason = 'pointer_never_entered_canvas';
            } else {
              frameResponseNotRegisteredReason = 'no_response_before_deadline';
            }
          } else if (response.response_device === 'keyboard') {
            frameResponseNotRegisteredReason = 'no_valid_key_before_deadline';
          } else {
            frameResponseNotRegisteredReason = 'no_response_before_deadline';
          }
        }

        // Record end-of-frame even if no response
        records.push({
          frame_index: frameIndex,
          event: 'frame_end',
          t_ms: Math.round(nowMs() - trialStartTs),
          ended_reason: reason || 'advance',
          rdm: activeRdm,
          response,
          correct_side: correctSide,
          rt_ms: frameRtMs,
          accuracy: frameIsCorrect,
          correctness: frameIsCorrect,
          response_registered: frameResponseRegistered,
          response_not_registered_reason: frameResponseNotRegisteredReason,
          response_side: frameResponseSide,
          response_key: frameResponseKey,
          response_angle_deg: frameResponseAngleDeg,
          response_angle_raw_deg: frameResponseAngleRawDeg,
          response_segment_index: frameResponseSegmentIndex,
          response_distance_from_center_px: frameResponseDistanceFromCenterPx,
          response_within_aperture: frameResponseWithinAperture,
          response_within_boundary_band: frameResponseWithinBoundaryBand,
          response_within_canvas: frameResponseWithinCanvas,
          response_accuracy_method: frameResponseAccuracyMethod,
          response_angle_error_deg: frameResponseAngleErrorDeg,
          response_tolerance_deg: frameResponseToleranceDeg,
          response_target_direction_deg: frameResponseTargetDirectionDeg,
          response_region_policy: frameMouseRegionPolicy,
          response_selection_mode: frameMouseSelectionMode,
          mouse_aperture_radius_px: frameMouseApertureRadiusPx,
          mouse_boundary_width_px: frameMouseBoundaryWidthPx,
          mouse_pointer_events_total: frameMousePointerEvents,
          mouse_inside_canvas_events: frameMouseInsideCanvasEvents,
          mouse_rejected_outside_canvas_events: frameMouseRejectedOutsideCanvasEvents,
          mouse_rejected_outside_boundary_band_events: frameMouseRejectedOutsideBoundaryBandEvents,
          mouse_boundary_band_entry_events: frameMouseBoundaryBandEntryEvents,
          mouse_click_events: frameMouseClickEvents,
          mouse_move_events: frameMouseMoveEvents,
          mouse_last_pointer_x_px: frameMouseLastPointerX,
          mouse_last_pointer_y_px: frameMouseLastPointerY,
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
        frameResponseDistanceFromCenterPx = null;
        frameResponseWithinAperture = null;
        frameResponseWithinBoundaryBand = null;
        frameResponseWithinCanvas = null;
        frameResponseAccuracyMethod = null;
        frameResponseAngleErrorDeg = null;
        frameResponseToleranceDeg = null;
        frameResponseTargetDirectionDeg = null;

        frameMouseSelectionMode = null;
        frameMouseRegionPolicy = null;
        frameMouseBoundaryWidthPx = null;
        frameMouseApertureRadiusPx = null;
        frameMousePointerEvents = 0;
        frameMouseInsideCanvasEvents = 0;
        frameMouseRejectedOutsideCanvasEvents = 0;
        frameMouseRejectedOutsideBoundaryBandEvents = 0;
        frameMouseBoundaryBandEntryEvents = 0;
        frameMouseClickEvents = 0;
        frameMouseMoveEvents = 0;
        frameMouseLastPointerX = null;
        frameMouseLastPointerY = null;

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

        updateDebugPanel();

        requestAnimationFrame(tick);
      };

      // Responses
      let keyListenerId = null;
      let mouseListener = null;
      let mouseListenerEvent = null;
      let debugToggleListener = null;

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

        const activeRdm = (engine && engine.params && typeof engine.params === 'object')
          ? { ...rdm, ...engine.params }
          : rdm;

        const correctSide = computeCorrectSide(activeRdm);
        const mouseEval = evaluateMouseCorrectness(meta, activeRdm, response, side, correctSide);
        const isCorrect = side ? mouseEval.isCorrect : null;

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
          frameResponseDistanceFromCenterPx = (meta && Number.isFinite(meta.distance_from_center_px)) ? meta.distance_from_center_px : null;
          frameResponseWithinAperture = (meta && typeof meta.within_aperture === 'boolean') ? meta.within_aperture : null;
          frameResponseWithinBoundaryBand = (meta && typeof meta.within_boundary_band === 'boolean') ? meta.within_boundary_band : null;
          frameResponseWithinCanvas = (meta && typeof meta.within_canvas === 'boolean') ? meta.within_canvas : null;
          frameResponseAccuracyMethod = mouseEval.method;
          frameResponseAngleErrorDeg = mouseEval.angleErrorDeg;
          frameResponseToleranceDeg = mouseEval.toleranceDeg;
          frameResponseTargetDirectionDeg = mouseEval.targetDirectionDeg;

          // Attach response to the latest record (or create a response record)
          records.push({
            frame_index: frameIndex,
            event: 'response',
            t_ms: Math.round(nowMs() - trialStartTs),
            response_registered: true,
            response_not_registered_reason: null,
            response_side: side,
            response_key: key || null,
            response_angle_deg: frameResponseAngleDeg,
            response_angle_raw_deg: frameResponseAngleRawDeg,
            response_segment_index: frameResponseSegmentIndex,
            response_distance_from_center_px: frameResponseDistanceFromCenterPx,
            response_within_aperture: frameResponseWithinAperture,
            response_within_boundary_band: frameResponseWithinBoundaryBand,
            response_within_canvas: frameResponseWithinCanvas,
            response_region_policy: frameMouseRegionPolicy,
            response_selection_mode: frameMouseSelectionMode,
            mouse_aperture_radius_px: frameMouseApertureRadiusPx,
            mouse_boundary_width_px: frameMouseBoundaryWidthPx,
            mouse_pointer_events_total: frameMousePointerEvents,
            mouse_inside_canvas_events: frameMouseInsideCanvasEvents,
            mouse_rejected_outside_canvas_events: frameMouseRejectedOutsideCanvasEvents,
            mouse_rejected_outside_boundary_band_events: frameMouseRejectedOutsideBoundaryBandEvents,
            mouse_boundary_band_entry_events: frameMouseBoundaryBandEntryEvents,
            mouse_click_events: frameMouseClickEvents,
            mouse_move_events: frameMouseMoveEvents,
            mouse_last_pointer_x_px: frameMouseLastPointerX,
            mouse_last_pointer_y_px: frameMouseLastPointerY,
            rt_ms: rt,
            correct_side: correctSide,
            accuracy: isCorrect,
            correctness: isCorrect,
            response_accuracy_method: mouseEval.method,
            response_angle_error_deg: mouseEval.angleErrorDeg,
            response_tolerance_deg: mouseEval.toleranceDeg,
            response_target_direction_deg: mouseEval.targetDirectionDeg
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

        frameMouseSelectionMode = selectionMode;
        frameMouseRegionPolicy = 'canvas';
        frameMouseBoundaryWidthPx = boundaryWidthPx;
        frameMouseApertureRadiusPx = apertureRadius;

        const computeMouseResponseInfo = (x, y) => {
          const dx = x - apertureCx;
          const dy = y - apertureCy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const rawAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
          const uiAngle = parseAngleDegrees(rawAngle);
          const angleFromStart = (uiAngle - startAngle + 360) % 360;
          const seg = Math.floor((angleFromStart / 360) * segments);
          const side = computeSideFromUiAngle(rawAngle);
          const inner = Math.max(0, apertureRadius - boundaryWidthPx);
          const outer = apertureRadius + boundaryWidthPx;
          return {
            side,
            segment_index: Math.max(0, Math.min(segments - 1, seg)),
            angle_deg: angleFromStart,
            raw_angle_deg: rawAngle,
            distance_from_center_px: dist,
            within_aperture: dist <= apertureRadius,
            within_boundary_band: dist >= inner && dist <= outer,
            within_canvas: true,
            region_policy: 'canvas'
          };
        };

        mouseListener = (e) => {
          // Normalize pointer/mouse events
          const clientX = e && typeof e.clientX === 'number' ? e.clientX : null;
          const clientY = e && typeof e.clientY === 'number' ? e.clientY : null;
          if (clientX === null || clientY === null) return;
          frameMousePointerEvents += 1;
          if (selectionMode === 'hover' || selectionMode === 'mousemove') frameMouseMoveEvents += 1;
          else frameMouseClickEvents += 1;

          const rect = canvas.getBoundingClientRect();
          const x = clientX - rect.left;
          const y = clientY - rect.top;
          frameMouseLastPointerX = x;
          frameMouseLastPointerY = y;

          // Ignore if outside canvas bounds (defensive)
          if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
            frameMouseRejectedOutsideCanvasEvents += 1;
            return;
          }
          frameMouseInsideCanvasEvents += 1;

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
              frameMouseRejectedOutsideBoundaryBandEvents += 1;
              return;
            }
            if (wasInBoundaryBand) {
              frameMouseRejectedOutsideBoundaryBandEvents += 1;
              return;
            }
            if (inBand) {
              wasInBoundaryBand = true;
              frameMouseBoundaryBandEntryEvents += 1;
            } else {
              frameMouseRejectedOutsideBoundaryBandEvents += 1;
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

        debugToggleListener = (e) => {
          if (!e) return;
          const key = (e.key || '').toLowerCase();
          if (key !== 'd' || !e.ctrlKey || !e.shiftKey) return;
          e.preventDefault();
          debugPanelEnabled = !debugPanelEnabled;
          if (typeof engine.setDebugOverlayEnabled === 'function') {
            engine.setDebugOverlayEnabled(debugPanelEnabled, { persist: true });
          }
          if (debugPanelEl) {
            debugPanelEl.style.display = debugPanelEnabled ? 'block' : 'none';
          }
          updateDebugPanel();
        };
        window.addEventListener('keydown', debugToggleListener);
      };

      const cleanupListeners = () => {
        if (keyListenerId) this.jsPsych.pluginAPI.cancelKeyboardResponse(keyListenerId);
        if (mouseListener && mouseListenerEvent) canvas.removeEventListener(mouseListenerEvent, mouseListener);
        if (debugToggleListener) window.removeEventListener('keydown', debugToggleListener);
        keyListenerId = null;
        mouseListener = null;
        mouseListenerEvent = null;
        debugToggleListener = null;
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
      updateDebugPanel();

      requestAnimationFrame(tick);
    }
  }

  JsPsychRdmContinuousPlugin.info = info;
  window.jsPsychRdmContinuous = JsPsychRdmContinuousPlugin;
})(window.jsPsychModule || window.jsPsych);
