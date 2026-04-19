var jsPsychRdm = (function (jspsych) {
  try {
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
      name: 'rdm',
      version: '1.0.0',
      parameters: {
        rdm: { type: PT.OBJECT, default: {} },
        response: { type: PT.OBJECT, default: {} },
        timing: { type: PT.OBJECT, default: {} },
        transition: { type: PT.OBJECT, default: { duration_ms: 0, type: 'none' } },
        dataCollection: { type: PT.OBJECT, default: {} }
      },
      data: {
        response_side: { type: PT.STRING },
        response_key: { type: PT.STRING },
        response_angle_deg: { type: PT.FLOAT },
        response_angle_raw_deg: { type: PT.FLOAT },
        response_segment_index: { type: PT.INT },
        correct_side: { type: PT.STRING },
        rt_ms: { type: PT.INT },
        accuracy: { type: PT.FLOAT },
        correctness: { type: PT.BOOL },
        ended_reason: { type: PT.STRING },
        rdm: { type: PT.OBJECT },
        response: { type: PT.OBJECT },
        adaptive_mode: { type: PT.STRING },
        adaptive_parameter: { type: PT.STRING },
        adaptive_value: { type: PT.FLOAT },
        plugin_version: { type: PT.STRING }
      }
    };

  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function merge(a, b) {
    const out = { ...(a || {}) };
    for (const [k, v] of Object.entries(b || {})) out[k] = v;
    return out;
  }

  function normalizeChoices(response) {
    if (!response) return [];
    if (response.choices === 'ALL_KEYS') return 'ALL_KEYS';
    if (Array.isArray(response.choices)) return response.choices;
    return [];
  }

  function buildKeyMapping(response) {
    const km = response && typeof response.key_mapping === 'object' ? response.key_mapping : null;
    if (km) return km;

    // Fallback mapping: first two choices
    const choices = Array.isArray(response.choices) ? response.choices : [];
    return {
      [choices[0] || 'f']: 'left',
      [choices[1] || 'j']: 'right'
    };
  }

  function expandKeyVariants(key) {
    const k = (key || '').toString();
    if (k.length === 1 && /[a-z]/i.test(k)) {
      return [k.toLowerCase(), k.toUpperCase()];
    }
    return [k];
  }

  function computeMouseSide(x, y, cx, cy, startAngleDeg, segments) {
    const dx = x - cx;
    const dy = y - cy;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI; // -180..180, 0=right
    const norm = (angle - startAngleDeg + 360) % 360;
    const seg = Math.floor((norm / 360) * segments);

    // For 2 segments, seg 0 = right half, seg 1 = left half.
    if (segments === 2) return seg === 0 ? 'right' : 'left';

    // Generic: treat segments in [0..segments/2) as right-ish
    return seg < segments / 2 ? 'right' : 'left';
  }

  function computeMouseResponseInfo(x, y, cx, cy, startAngleDeg, segments) {
    const dx = x - cx;
    const dy = y - cy;
    const rawAngle = (Math.atan2(dy, dx) * 180) / Math.PI; // -180..180, 0=right
    const angleFromStart = (rawAngle - startAngleDeg + 360) % 360; // 0..360
    const seg = Math.floor((angleFromStart / 360) * segments);

    const side = (segments === 2)
      ? (seg === 0 ? 'right' : 'left')
      : (seg < segments / 2 ? 'right' : 'left');

    return {
      side,
      segment_index: Math.max(0, Math.min(segments - 1, seg)),
      angle_deg: angleFromStart,
      raw_angle_deg: rawAngle
    };
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

  class JsPsychRdmPlugin {
    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element, trial) {
      const rdm = trial.rdm || {};
      const timing = trial.timing || {};
      const response = trial.response || {};
      const transition = trial.transition || { duration_ms: 0, type: 'none' };
      const dataCollection = trial.dataCollection || {};

      const experimentType = rdm.experiment_type || 'trial-based';

      const fixationDuration = Number(timing.fixation_duration ?? rdm.fixation_duration ?? 0);
      const stimulusDuration = Number(timing.stimulus_duration ?? rdm.stimulus_duration ?? 1500);
      const responseDeadline = Number(timing.response_deadline ?? rdm.response_deadline ?? stimulusDuration);

      const requireResponse = response.require_response !== false;
      const responseDevice = response.response_device || 'keyboard';

      // Continuous-only
      const endOnResponse = experimentType === 'continuous' && response.end_condition_on_response === true;

      const choices = normalizeChoices(response);
      const keyMapping = buildKeyMapping(response);

      const canvasW = Number(rdm.canvas_width ?? 600);
      const canvasH = Number(rdm.canvas_height ?? 600);

      display_element.innerHTML = `
        <div id="rdm-wrap" style="width:100%; display:flex; justify-content:center; align-items:center; flex-direction:column; gap:10px;">
          <canvas id="rdm-canvas" width="${canvasW}" height="${canvasH}" style="border: 1px solid rgba(255,255,255,0.15);"></canvas>
          <div id="rdm-feedback" style="min-height: 24px;"></div>
        </div>
      `;

      const canvas = display_element.querySelector('#rdm-canvas');
      const ctx = canvas.getContext('2d');

      // Fixation phase: draw cross on blank bg
      const bg = (typeof rdm.background_color === 'string' && rdm.background_color.trim() !== '') ? rdm.background_color : '#000000';

      const showFixation = () => {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        ctx.strokeStyle = (typeof rdm.fixation_color === 'string' && rdm.fixation_color.trim() !== '') ? rdm.fixation_color : '#ffffff';
        ctx.lineWidth = Number(rdm.fixation_width ?? 2);
        const size = Number(rdm.fixation_size ?? 10);
        ctx.beginPath();
        ctx.moveTo(cx - size, cy);
        ctx.lineTo(cx + size, cy);
        ctx.moveTo(cx, cy - size);
        ctx.lineTo(cx, cy + size);
        ctx.stroke();
      };

      let engine = null;
      let responded = false;
      let ended = false;
      let responseKey = null;
      let responseSide = null;
      let rt = null;
      let responseTs = null;
      let startTs = null;

      let responseAngleDeg = null;
      let responseAngleRawDeg = null;
      let responseSegmentIndex = null;
      let responseDistanceFromCenterPx = null;
      let responseWithinAperture = null;
      let responseWithinBoundaryBand = null;
      let responseWithinCanvas = null;

      let mouseSelectionMode = null;
      let mouseRegionPolicy = null;
      let mouseBoundaryWidthPx = null;
      let mouseApertureRadiusPx = null;
      let mousePointerEvents = 0;
      let mouseInsideCanvasEvents = 0;
      let mouseRejectedOutsideCanvasEvents = 0;
      let mouseRejectedOutsideBoundaryBandEvents = 0;
      let mouseBoundaryBandEntryEvents = 0;
      let mouseClickEvents = 0;
      let mouseMoveEvents = 0;
      let mouseLastPointerX = null;
      let mouseLastPointerY = null;
      let feedbackEndAt = null;
      let stimulusStopped = false;

      const stopStimulusPhase = () => {
        if (stimulusStopped) return;
        stimulusStopped = true;
        if (engine) engine.stop();
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      };

      const getActiveRdmParams = () => {
        const live = (engine && engine.params && typeof engine.params === 'object') ? engine.params : null;
        return live ? { ...rdm, ...live } : rdm;
      };

      const getCurrentCorrectSide = () => window.RDMEngine.computeCorrectSide(getActiveRdmParams());

      // Detection Response Task (DRT) overlay (builder flag: detection_response_task_enabled)
      const drtEnabled = rdm.detection_response_task_enabled === true;
      const drtKey = ' ';
      let drtShown = false;
      let drtOnsetTs = null;
      let drtRt = null;

      const endTrial = async (reason) => {
        if (ended) return;
        ended = true;
        if (engine) engine.stop();
        cleanupListeners();

        // Transition screen (continuous only)
        if (experimentType === 'continuous') {
          const ms = Number(transition.duration_ms ?? 0);
          if (ms > 0) {
            await showTransition(ms, transition.type || 'both', rdm);
          }
        }

        const includeRt = dataCollection['reaction-time'] === true;
        const includeAccuracy = dataCollection['accuracy'] === true;
        const includeCorrectness = dataCollection['correctness'] === true;

        const activeRdm = getActiveRdmParams();
        const correctSide = getCurrentCorrectSide();
        const isCorrect = (responseSide !== null) ? (responseSide === correctSide) : null;
        const responseRegistered = responded === true;

        let responseNotRegisteredReason = null;
        if (!responseRegistered) {
          if (responseDevice === 'mouse' || responseDevice === 'touch') {
            const isHoverMode = (mouseSelectionMode === 'hover' || mouseSelectionMode === 'mousemove');
            if (isHoverMode && mouseBoundaryBandEntryEvents <= 0) {
              responseNotRegisteredReason = 'pointer_never_reached_aperture_boundary_band';
            } else if (mousePointerEvents <= 0) {
              responseNotRegisteredReason = 'no_pointer_event_captured';
            } else if (mouseInsideCanvasEvents <= 0) {
              responseNotRegisteredReason = 'pointer_never_entered_canvas';
            } else {
              responseNotRegisteredReason = 'no_response_before_deadline';
            }
          } else if (responseDevice === 'keyboard') {
            responseNotRegisteredReason = 'no_valid_key_before_deadline';
          } else {
            responseNotRegisteredReason = 'no_response_before_deadline';
          }
        }

        const data = {
          experiment_type: experimentType,
          stimulus_type: rdm.type,
          response_device: responseDevice,
          response_registered: responseRegistered,
          response_not_registered_reason: responseNotRegisteredReason,
          correct_side: correctSide,
          response_side: responseSide,
          response_key: responseKey,
          response_angle_deg: responseAngleDeg,
          response_angle_raw_deg: responseAngleRawDeg,
          response_segment_index: responseSegmentIndex,
          response_distance_from_center_px: responseDistanceFromCenterPx,
          response_within_aperture: responseWithinAperture,
          response_within_boundary_band: responseWithinBoundaryBand,
          response_within_canvas: responseWithinCanvas,
          response_region_policy: mouseRegionPolicy,
          response_selection_mode: mouseSelectionMode,
          mouse_aperture_radius_px: mouseApertureRadiusPx,
          mouse_boundary_width_px: mouseBoundaryWidthPx,
          mouse_pointer_events_total: mousePointerEvents,
          mouse_inside_canvas_events: mouseInsideCanvasEvents,
          mouse_rejected_outside_canvas_events: mouseRejectedOutsideCanvasEvents,
          mouse_rejected_outside_boundary_band_events: mouseRejectedOutsideBoundaryBandEvents,
          mouse_boundary_band_entry_events: mouseBoundaryBandEntryEvents,
          mouse_click_events: mouseClickEvents,
          mouse_move_events: mouseMoveEvents,
          mouse_last_pointer_x_px: mouseLastPointerX,
          mouse_last_pointer_y_px: mouseLastPointerY,
          end_reason: reason || null,
          ...(includeRt ? { rt_ms: rt } : {}),
          ...(includeAccuracy ? { accuracy: isCorrect } : {}),
          ...(includeCorrectness ? { correctness: isCorrect } : {}),

          ...(drtEnabled ? {
            drt_enabled: true,
            drt_shown: drtShown,
            drt_rt_ms: drtRt
          } : {})
        };

        // Keep the trial params for analysis/debugging
        data.rdm_parameters = activeRdm;
        data.rdm_coherence = Number(rdm.coherence);
        data.rdm_speed = Number(rdm.speed);
        data.response_parameters = response;
        data.timing_parameters = { fixationDuration, stimulusDuration, responseDeadline };
        data.transition = transition;

        this.jsPsych.finishTrial(data);
      };

      const showFeedback = (isCorrect) => {
        const fb = response && response.feedback && response.feedback.enabled ? response.feedback : null;
        if (!fb) return 0;

        const el = display_element.querySelector('#rdm-feedback');
        if (!el) return 0;

        const duration = Number(rdm.feedback_duration ?? fb.duration_ms ?? 500);
        const feedbackMs = Number.isFinite(duration) && duration > 0 ? duration : 500;

        if (fb.type === 'corner-text') {
          el.innerHTML = `<div style="width: ${canvasW}px; display:flex; justify-content:space-between;">
            <span style="color:${isCorrect ? '#5CFF8A' : '#FF5C5C'}; font-weight:600;">${isCorrect ? 'Correct' : 'Incorrect'}</span>
            <span style="opacity:0.7">${responseSide || ''}</span>
          </div>`;
        } else if (fb.type === 'arrow') {
          const directionDeg = getCorrectDirectionDeg(getActiveRdmParams());
          const arrowColor = isCorrect ? '#5CFF8A' : '#FF5C5C';
          if (engine) {
            engine.arrowDirectionDeg = directionDeg;
            engine.arrowColor = arrowColor;
          }
          el.innerHTML = '';
        } else if (fb.type === 'custom') {
          el.innerHTML = `<div style="width: ${canvasW}px; text-align:center; opacity:0.85;">(custom feedback placeholder)</div>`;
        }

        window.setTimeout(() => {
          el.innerHTML = '';
          if (engine) {
            engine.arrowDirectionDeg = null;
            engine.arrowColor = null;
          }
        }, feedbackMs);

        return feedbackMs;
      };

      const showTransition = (ms, type, rdmParams) => {
        return new Promise((resolve) => {
          const cx = canvas.width / 2;
          const cy = canvas.height / 2;

          ctx.save();
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          if (type === 'fixation' || type === 'both') {
            ctx.strokeStyle = (typeof rdmParams.fixation_color === 'string' && rdmParams.fixation_color.trim() !== '') ? rdmParams.fixation_color : '#ffffff';
            ctx.lineWidth = Number(rdmParams.fixation_width ?? 2);
            const size = Number(rdmParams.fixation_size ?? 10);
            ctx.beginPath();
            ctx.moveTo(cx - size, cy);
            ctx.lineTo(cx + size, cy);
            ctx.moveTo(cx, cy - size);
            ctx.lineTo(cx, cy + size);
            ctx.stroke();
          }

          // mask/both: just blank bg; already drawn
          ctx.restore();

          this.jsPsych.pluginAPI.setTimeout(resolve, ms);
        });
      };

      const onResponse = (payload) => {
        if (responded) return;
        responded = true;

        responseKey = payload.key || null;
        responseSide = payload.side || null;
        if (payload && Number.isFinite(payload.angle_deg)) responseAngleDeg = payload.angle_deg;
        if (payload && Number.isFinite(payload.raw_angle_deg)) responseAngleRawDeg = payload.raw_angle_deg;
        if (payload && Number.isFinite(payload.segment_index)) responseSegmentIndex = payload.segment_index;
        if (payload && Number.isFinite(payload.distance_from_center_px)) responseDistanceFromCenterPx = payload.distance_from_center_px;
        if (payload && typeof payload.within_aperture === 'boolean') responseWithinAperture = payload.within_aperture;
        if (payload && typeof payload.within_boundary_band === 'boolean') responseWithinBoundaryBand = payload.within_boundary_band;
        if (payload && typeof payload.within_canvas === 'boolean') responseWithinCanvas = payload.within_canvas;
        responseTs = nowMs();
        rt = startTs ? Math.round(responseTs - startTs) : null;

        const isCorrect = responseSide !== null ? responseSide === getCurrentCorrectSide() : null;
        const feedbackMs = (isCorrect !== null) ? showFeedback(isCorrect) : 0;

        if (experimentType === 'trial-based') {
          if (feedbackMs > 0) {
            feedbackEndAt = nowMs() + feedbackMs;
            this.jsPsych.pluginAPI.setTimeout(() => endTrial('response'), feedbackMs);
          } else {
            endTrial('response');
          }
          return;
        }

        // continuous
        if (endOnResponse) {
          if (feedbackMs > 0) {
            feedbackEndAt = nowMs() + feedbackMs;
            this.jsPsych.pluginAPI.setTimeout(() => endTrial('response_end_condition'), feedbackMs);
          } else {
            endTrial('response_end_condition');
          }
        }
      };

      let keyListener = null;
      let keyListenerId = null;
      let mouseListener = null;
      let mouseListenerEvent = null;

      const setupListeners = () => {
        if (responseDevice === 'keyboard') {
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
            return Array.from(new Set(base.concat(drtEnabled ? [drtKey] : [])));
          })();

          keyListenerId = this.jsPsych.pluginAPI.getKeyboardResponse({
            callback_function: (info) => {
              const rawKey = info && info.key !== undefined ? info.key : null;
              const k = (typeof rawKey === 'string') ? rawKey : null;
              const kLower = (typeof k === 'string') ? k.toLowerCase() : null;

              // DRT uses spacebar and should not interfere with primary response keys.
              if (drtEnabled && k === drtKey) {
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
                onResponse({ key: kLower || k, side });
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
                onResponse({ key: kLower || k, side });
              }
            },
            valid_responses: validResponses,
            rt_method: 'performance',
            persist: false,
            allow_held_key: false
          });
        } else if (responseDevice === 'mouse' || responseDevice === 'touch') {
          const mr = response.mouse_response || {};
          const segments = Math.max(2, Number(mr.segments ?? 2));
          const startAngle = Number(mr.start_angle_deg ?? 0);
          const selectionModeRaw = (mr.selection_mode ?? mr.mode ?? 'click');
          const selectionMode = (typeof selectionModeRaw === 'string' ? selectionModeRaw.trim().toLowerCase() : 'click');

          // Hover semantics: capture the first time the pointer reaches the *aperture edge*.
          // This matches typical instructions (“move to the side of the circle”) and prevents
          // accidental early capture when the cursor moves near the center.
          const apertureCx = Number(
            rdm.aperture_center_x ??
            rdm.center_x ??
            (rdm.aperture_parameters && rdm.aperture_parameters.center_x) ??
            (canvas.width / 2)
          );
          const apertureCy = Number(
            rdm.aperture_center_y ??
            rdm.center_y ??
            (rdm.aperture_parameters && rdm.aperture_parameters.center_y) ??
            (canvas.height / 2)
          );
          const apertureDiameter = Number(
            rdm.aperture_diameter ??
            rdm.apertureDiameter ??
            (rdm.aperture_parameters && rdm.aperture_parameters.diameter) ??
            (rdm.aperture_parameters && rdm.aperture_parameters.diameter_px) ??
            NaN
          );
          const apertureRadius = Number.isFinite(apertureDiameter)
            ? (apertureDiameter / 2)
            : (Math.min(canvas.width, canvas.height) / 2);

          const boundaryWidthPx = Math.max(1, Number(mr.boundary_width_px ?? 16));
          let wasInBoundaryBand = false;

          mouseSelectionMode = selectionMode;
          mouseRegionPolicy = 'canvas';
          mouseBoundaryWidthPx = boundaryWidthPx;
          mouseApertureRadiusPx = apertureRadius;

          mouseListener = (e) => {
            const rect = canvas.getBoundingClientRect();
            const clientX = e && typeof e.clientX === 'number' ? e.clientX : null;
            const clientY = e && typeof e.clientY === 'number' ? e.clientY : null;
            if (clientX === null || clientY === null) return;
            mousePointerEvents += 1;
            if (selectionMode === 'hover' || selectionMode === 'mousemove') mouseMoveEvents += 1;
            else mouseClickEvents += 1;
            const x = clientX - rect.left;
            const y = clientY - rect.top;
            mouseLastPointerX = x;
            mouseLastPointerY = y;

            // Ignore if outside canvas bounds (defensive)
            if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
              mouseRejectedOutsideCanvasEvents += 1;
              return;
            }
            mouseInsideCanvasEvents += 1;

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
                mouseRejectedOutsideBoundaryBandEvents += 1;
                return;
              }
              if (wasInBoundaryBand) {
                // Already in band; do not keep re-triggering.
                mouseRejectedOutsideBoundaryBandEvents += 1;
                return;
              }
              if (inBand) {
                wasInBoundaryBand = true;
                mouseBoundaryBandEntryEvents += 1;
              } else {
                mouseRejectedOutsideBoundaryBandEvents += 1;
                return;
              }
            }

            const info = (() => {
              const base = computeMouseResponseInfo(x, y, apertureCx, apertureCy, startAngle, segments);
              const dx = x - apertureCx;
              const dy = y - apertureCy;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const inner = Math.max(0, apertureRadius - boundaryWidthPx);
              const outer = apertureRadius + boundaryWidthPx;
              return {
                ...base,
                distance_from_center_px: dist,
                within_aperture: dist <= apertureRadius,
                within_boundary_band: dist >= inner && dist <= outer,
                within_canvas: true,
                region_policy: 'canvas'
              };
            })();
            onResponse({
              key: null,
              side: info.side,
              angle_deg: info.angle_deg,
              raw_angle_deg: info.raw_angle_deg,
              segment_index: info.segment_index,
              distance_from_center_px: info.distance_from_center_px,
              within_aperture: info.within_aperture,
              within_boundary_band: info.within_boundary_band,
              within_canvas: info.within_canvas,
              region_policy: info.region_policy
            });
          };

          mouseListenerEvent = (selectionMode === 'hover' || selectionMode === 'mousemove') ? 'mousemove' : 'click';
          canvas.addEventListener(mouseListenerEvent, mouseListener);
        } else if (responseDevice === 'voice') {
          // Not implemented
        }
      };

      const cleanupListeners = () => {
        if (keyListenerId) this.jsPsych.pluginAPI.cancelKeyboardResponse(keyListenerId);
        if (mouseListener && canvas && mouseListenerEvent) canvas.removeEventListener(mouseListenerEvent, mouseListener);
        keyListener = null;
        keyListenerId = null;
        mouseListener = null;
        mouseListenerEvent = null;
      };

      const startStimulus = () => {
        engine = new window.RDMEngine(canvas, merge(rdm, { show_fixation: false }));
        engine.start();
        startTs = nowMs();
        setupListeners();

        // Schedule a single DRT event within the stimulus window.
        if (drtEnabled) {
          const minDelay = 300;
          const maxDelay = Math.max(minDelay, Math.floor(stimulusDuration * 0.75));
          const delay = minDelay + Math.floor(Math.random() * Math.max(1, (maxDelay - minDelay)));
          this.jsPsych.pluginAPI.setTimeout(() => {
            if (ended) return;
            drtShown = true;
            drtOnsetTs = nowMs();

            const el = document.createElement('div');
            el.id = 'drt-dot';
            el.style.cssText = 'position:absolute; top: 18px; left: 18px; width: 14px; height: 14px; border-radius: 50%; background: #FFD23F; box-shadow: 0 0 0 3px rgba(0,0,0,0.3);';

            const wrap = display_element.querySelector('#rdm-wrap');
            if (wrap) {
              wrap.style.position = 'relative';
              wrap.appendChild(el);
              this.jsPsych.pluginAPI.setTimeout(() => {
                if (el && el.parentNode) el.remove();
              }, 200);
            }
          }, delay);
        }

        // stimulus phase
        if (Number.isFinite(stimulusDuration) && stimulusDuration > 0) {
          this.jsPsych.pluginAPI.setTimeout(() => {
            if (ended || stimulusStopped) return;

            // Keep the stimulus visible while feedback is active so arrow feedback
            // can remain on-screen for the full configured duration.
            if (feedbackEndAt && nowMs() < feedbackEndAt) {
              const remaining = Math.max(1, Math.round(feedbackEndAt - nowMs()));
              this.jsPsych.pluginAPI.setTimeout(() => {
                if (ended || stimulusStopped) return;
                if (feedbackEndAt && nowMs() < feedbackEndAt) return;
                stopStimulusPhase();
              }, remaining);
              return;
            }

            // Stop stimulus, keep response window (blank bg)
            stopStimulusPhase();
          }, stimulusDuration);
        }

        // deadline
        if (Number.isFinite(responseDeadline) && responseDeadline > 0) {
          this.jsPsych.pluginAPI.setTimeout(() => {
            if (ended) return;

            if (feedbackEndAt && nowMs() < feedbackEndAt) {
              const remaining = Math.max(1, Math.round(feedbackEndAt - nowMs()));
              this.jsPsych.pluginAPI.setTimeout(() => {
                if (ended) return;
                if (requireResponse && !responded) {
                  endTrial('timeout');
                  return;
                }
                endTrial('deadline');
              }, remaining);
              return;
            }

            // trial-based usually ends earlier on response; if not, treat as deadline/timeout
            if (requireResponse && !responded) {
              endTrial('timeout');
              return;
            }

            endTrial('deadline');
          }, responseDeadline);
        }
      };

      // Start
      if (Number.isFinite(fixationDuration) && fixationDuration > 0) {
        showFixation();
        this.jsPsych.pluginAPI.setTimeout(() => {
          startStimulus();
        }, fixationDuration);
      } else {
        startStimulus();
      }
    }
  }

    JsPsychRdmPlugin.info = info;
    window.jsPsychRdm = JsPsychRdmPlugin;
    return JsPsychRdmPlugin;
  } catch (e) {
    console.error('[jspsych-rdm] Failed to initialize plugin:', e);
    return null;
  }
})(window.jsPsychModule || window.jsPsych);

