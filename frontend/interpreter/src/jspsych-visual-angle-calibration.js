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
    name: 'visual-angle-calibration',
    version: '1.0.0',
    parameters: {
      title: { type: PT.STRING, default: 'Visual Angle Calibration' },
      instructions: { type: PT.STRING, default: '' },

      object_preset: { type: PT.STRING, default: 'id_card_long' },
      object_length_cm: { type: PT.FLOAT, default: 8.56 },

      distance_mode: { type: PT.STRING, default: 'posture_choice' },

      close_label: { type: PT.STRING, default: 'Close' },
      close_distance_cm: { type: PT.FLOAT, default: 35 },
      normal_label: { type: PT.STRING, default: 'Normal' },
      normal_distance_cm: { type: PT.FLOAT, default: 50 },
      far_label: { type: PT.STRING, default: 'Far' },
      far_distance_cm: { type: PT.FLOAT, default: 65 },

      // Optional UI assets for Step 2 (posture choice cards)
      close_image_url: { type: PT.STRING, default: 'img/criss-cross.png' },
      normal_image_url: { type: PT.STRING, default: 'img/sitting.png' },
      far_image_url: { type: PT.STRING, default: 'img/recline.png' },

      manual_distance_default_cm: { type: PT.FLOAT, default: 50 },

      webcam_enabled: { type: PT.BOOL, default: false },
      webcam_facing_mode: { type: PT.STRING, default: 'user' },

      store_key: { type: PT.STRING, default: '__psy_visual_angle' }
    },
    data: {
      px_per_cm: { type: PT.FLOAT },
      viewing_distance_cm: { type: PT.FLOAT },
      px_per_deg: { type: PT.FLOAT },
      cm_per_deg: { type: PT.FLOAT },
      object_preset: { type: PT.STRING },
      object_length_cm: { type: PT.FLOAT },
      distance_mode: { type: PT.STRING },
      distance_choice: { type: PT.STRING },
      webcam_used: { type: PT.BOOL },
      webcam_width: { type: PT.INT },
      webcam_height: { type: PT.INT },
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

  function clamp(v, lo, hi) {
    const x = Number(v);
    if (!Number.isFinite(x)) return lo;
    return Math.max(lo, Math.min(hi, x));
  }

  function computePxPerDeg(pxPerCm, distanceCm) {
    const pxcm = Number(pxPerCm);
    const d = Number(distanceCm);
    if (!Number.isFinite(pxcm) || pxcm <= 0) return null;
    if (!Number.isFinite(d) || d <= 0) return null;

    // cm per degree at viewing distance d: 2*d*tan(deg/2)
    const cmPerDeg = 2 * d * Math.tan(Math.PI / 360);
    const pxPerDeg = pxcm * cmPerDeg;
    return { cmPerDeg, pxPerDeg };
  }

  function normalizeObjectPreset(preset, fallbackCm) {
    const p = (preset || '').toString().trim().toLowerCase();
    if (p === 'id_card_long' || p === 'credit_card_long') {
      return { preset: 'id_card_long', lengthCm: 8.56 };
    }
    if (p === 'id_card_short' || p === 'credit_card_short') {
      return { preset: 'id_card_short', lengthCm: 5.398 };
    }
    if (p === 'custom') {
      const cm = Number(fallbackCm);
      return { preset: 'custom', lengthCm: Number.isFinite(cm) && cm > 0 ? cm : 8.56 };
    }
    // default
    return { preset: 'id_card_long', lengthCm: 8.56 };
  }

  class JsPsychVisualAngleCalibrationPlugin {
    constructor(jsPsych) {
      this.jsPsych = jsPsych;
    }

    trial(display_element, trial) {
      const startTs = nowMs();

      const storeKey = (trial.store_key || '__psy_visual_angle').toString();
      const object0 = normalizeObjectPreset(trial.object_preset, trial.object_length_cm);

      const distanceMode = (trial.distance_mode || 'posture_choice').toString().trim().toLowerCase();
      const webcamEnabled = trial.webcam_enabled === true;
      const facingMode = (trial.webcam_facing_mode || 'user').toString();

      let step = 1;
      let sliderTouched = false;
      let selectedDistanceChoice = null;
      let webcamStream = null;

      const state = {
        object_preset: object0.preset,
        object_length_cm: object0.lengthCm,
        target_width_px: 320,
        px_per_cm: null,
        distance_mode: distanceMode,
        distance_choice: null,
        viewing_distance_cm: null,
        webcam_used: false,
        webcam_width: null,
        webcam_height: null
      };

      const setGlobal = (payload) => {
        try {
          window[storeKey] = payload;
        } catch {
          // ignore
        }
      };

      const addGlobalDataProps = (payload) => {
        try {
          if (this.jsPsych && this.jsPsych.data && typeof this.jsPsych.data.addProperties === 'function') {
            this.jsPsych.data.addProperties(payload);
          }
        } catch {
          // ignore
        }
      };

      const stopWebcam = () => {
        if (webcamStream) {
          try {
            for (const t of webcamStream.getTracks()) t.stop();
          } catch {
            // ignore
          }
        }
        webcamStream = null;
      };

      const render = () => {
        const title = esc(trial.title || 'Visual Angle Calibration');
        const instructions = (trial.instructions || '').toString().trim();

        const objectHelp = 'Place the object flat against the screen. Adjust the on-screen bar to match its length.';

        const distanceIntro = (distanceMode === 'manual')
          ? 'Enter your approximate viewing distance (eye to screen).'
          : 'Choose the option that best matches how you are sitting right now.';

        const webcamNote = webcamEnabled
          ? `<div class="psy-muted" style="margin-top:10px;">Optional webcam step is enabled for this study. It will only show a live preview to help you keep a consistent position; it does not currently estimate distance.</div>`
          : '';

        const closeImg = esc(trial.close_image_url || 'img/criss-cross.png');
        const normalImg = esc(trial.normal_image_url || 'img/sitting.png');
        const farImg = esc(trial.far_image_url || 'img/recline.png');

        display_element.innerHTML = `
          <div class="psy-wrap">
            <div class="psy-stage">
              <div class="psy-text">
                <h2 style="margin:0 0 8px 0;">${title}</h2>
                ${instructions ? `<div class="psy-muted" style="margin-bottom:12px;">${instructions}</div>` : ''}

                <div id="vac-step-1" style="display:${step === 1 ? 'block' : 'none'};">
                  <h3 style="margin: 10px 0;">Step 1: Screen scale (px/cm)</h3>
                  <div class="psy-muted" style="margin-bottom: 10px;">${esc(objectHelp)}</div>

                  <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end; margin: 10px 0;">
                    <div style="min-width: 240px;">
                      <label style="font-weight:600; display:block; margin-bottom:6px;">Object</label>
                      <select id="vac-object" style="width:100%; padding:10px; border-radius:10px; border:1px solid var(--psy-border); background: transparent; color: inherit;">
                        <option value="id_card_long">Credit/ID card (long edge: 8.56 cm)</option>
                        <option value="id_card_short">Credit/ID card (short edge: 5.398 cm)</option>
                        <option value="custom">Custom length (cm)</option>
                      </select>
                    </div>
                    <div style="width: 200px;">
                      <label style="font-weight:600; display:block; margin-bottom:6px;">Length (cm)</label>
                      <input id="vac-object-cm" type="number" step="0.001" min="0.1" value="${esc(String(state.object_length_cm))}" style="width:100%; padding:10px; border-radius:10px; border:1px solid var(--psy-border); background: transparent; color: inherit;" />
                    </div>
                  </div>

                  <div style="margin: 14px 0; padding: 14px; border-radius: 14px; border:1px solid var(--psy-border); background: var(--psy-surface);">
                    <div style="display:flex; justify-content:center;">
                      <div id="vac-target" style="width:${Math.round(state.target_width_px)}px; height: 54px; border-radius: 12px; border: 2px solid var(--psy-accent); box-sizing: border-box;"></div>
                    </div>

                    <div style="margin-top: 12px;">
                      <label style="font-weight:600; display:block; margin-bottom:6px;">Adjust bar width</label>
                      <input id="vac-slider" type="range" min="60" max="1200" step="1" value="${Math.round(state.target_width_px)}" style="width:100%;" />
                      <div class="psy-muted" style="margin-top: 6px;">Width: <span id="vac-width">${Math.round(state.target_width_px)}</span> px · px/cm: <span id="vac-pxcm">—</span></div>
                    </div>
                  </div>

                  <div class="psy-btn-row">
                    <button id="vac-next" class="psy-btn psy-btn-primary" type="button" disabled>Next</button>
                  </div>
                </div>

                <div id="vac-step-2" style="display:${step === 2 ? 'block' : 'none'};">
                  <h3 style="margin: 10px 0;">Step 2: Viewing distance</h3>
                  <div class="psy-muted" style="margin-bottom: 10px;">${esc(distanceIntro)}</div>

                  <div id="vac-distance-posture" style="display:${distanceMode === 'posture_choice' ? 'block' : 'none'};">
                    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:10px; margin-top:10px;">
                      <label style="display:flex; gap:12px; align-items:center; padding:12px; border-radius:14px; border:1px solid var(--psy-border); background: var(--psy-surface); cursor:pointer;">
                        <input type="radio" name="vac-distance" value="close" style="margin-top:2px;" />
                        <img src="${closeImg}" alt="" style="width:92px; height:70px; object-fit:contain; border-radius:10px; border:1px solid var(--psy-border); background: rgba(255,255,255,0.03);" onerror="this.style.display='none'" />
                        <div>
                          <div style="font-weight:700;">${esc(trial.close_label || 'Close')}</div>
                          <div class="psy-muted">${esc(String(trial.close_distance_cm ?? 35))} cm</div>
                        </div>
                      </label>

                      <label style="display:flex; gap:12px; align-items:center; padding:12px; border-radius:14px; border:1px solid var(--psy-border); background: var(--psy-surface); cursor:pointer;">
                        <input type="radio" name="vac-distance" value="normal" style="margin-top:2px;" />
                        <img src="${normalImg}" alt="" style="width:92px; height:70px; object-fit:contain; border-radius:10px; border:1px solid var(--psy-border); background: rgba(255,255,255,0.03);" onerror="this.style.display='none'" />
                        <div>
                          <div style="font-weight:700;">${esc(trial.normal_label || 'Normal')}</div>
                          <div class="psy-muted">${esc(String(trial.normal_distance_cm ?? 50))} cm</div>
                        </div>
                      </label>

                      <label style="display:flex; gap:12px; align-items:center; padding:12px; border-radius:14px; border:1px solid var(--psy-border); background: var(--psy-surface); cursor:pointer;">
                        <input type="radio" name="vac-distance" value="far" style="margin-top:2px;" />
                        <img src="${farImg}" alt="" style="width:92px; height:70px; object-fit:contain; border-radius:10px; border:1px solid var(--psy-border); background: rgba(255,255,255,0.03);" onerror="this.style.display='none'" />
                        <div>
                          <div style="font-weight:700;">${esc(trial.far_label || 'Far')}</div>
                          <div class="psy-muted">${esc(String(trial.far_distance_cm ?? 65))} cm</div>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div id="vac-distance-manual" style="display:${distanceMode === 'manual' ? 'block' : 'none'};">
                    <label style="font-weight:600; display:block; margin: 10px 0 6px 0;">Distance (cm)</label>
                    <input id="vac-distance-cm" type="number" min="1" step="0.1" value="${esc(String(trial.manual_distance_default_cm ?? 50))}" style="width: 240px; padding:10px; border-radius:10px; border:1px solid var(--psy-border); background: transparent; color: inherit;" />
                  </div>

                  ${webcamNote}

                  <div id="vac-webcam" style="display:${webcamEnabled ? 'block' : 'none'}; margin-top: 12px; padding: 12px; border-radius: 14px; border:1px solid var(--psy-border); background: var(--psy-surface);">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                      <div style="font-weight:600;">Webcam preview (optional)</div>
                      <button id="vac-webcam-toggle" class="psy-btn" type="button">Enable webcam</button>
                    </div>
                    <video id="vac-video" autoplay playsinline style="display:none; margin-top:10px; width: min(520px, 100%); border-radius: 12px; border:1px solid var(--psy-border);"></video>
                    <div id="vac-webcam-msg" class="psy-muted" style="margin-top:8px;">If you choose to enable webcam, you can use it to keep your head position consistent. No video is stored by this step.</div>
                  </div>

                  <div class="psy-btn-row">
                    <button id="vac-back" class="psy-btn" type="button">Back</button>
                    <button id="vac-finish" class="psy-btn psy-btn-primary" type="button" disabled>Finish</button>
                  </div>
                </div>

                <div id="vac-error" style="display:none; margin-top: 12px; padding: 10px; border-radius: 12px; border: 1px solid rgba(255,92,92,0.45); background: rgba(255,92,92,0.10); color: inherit;"></div>
              </div>
            </div>
          </div>
        `;

        wire();
      };

      const showError = (msg) => {
        const el = display_element.querySelector('#vac-error');
        if (!el) return;
        el.textContent = String(msg || '');
        el.style.display = msg ? 'block' : 'none';
      };

      const recalcPxPerCm = () => {
        const widthPx = Number(state.target_width_px);
        const cm = Number(state.object_length_cm);
        if (!Number.isFinite(widthPx) || widthPx <= 0) return null;
        if (!Number.isFinite(cm) || cm <= 0) return null;
        return widthPx / cm;
      };

      const updateStep1UI = () => {
        const target = display_element.querySelector('#vac-target');
        const wLabel = display_element.querySelector('#vac-width');
        const pxcmLabel = display_element.querySelector('#vac-pxcm');
        const nextBtn = display_element.querySelector('#vac-next');

        if (target) target.style.width = `${Math.round(state.target_width_px)}px`;
        if (wLabel) wLabel.textContent = String(Math.round(state.target_width_px));

        const pxcm = recalcPxPerCm();
        state.px_per_cm = pxcm;
        if (pxcmLabel) pxcmLabel.textContent = pxcm ? pxcm.toFixed(3) : '—';
        if (nextBtn) nextBtn.disabled = !(sliderTouched && pxcm);
      };

      const updateStep2UI = () => {
        const finishBtn = display_element.querySelector('#vac-finish');
        if (!finishBtn) return;

        let ok = false;
        if (distanceMode === 'manual') {
          const v = Number(state.viewing_distance_cm);
          ok = Number.isFinite(v) && v > 0;
        } else {
          ok = !!state.distance_choice;
        }

        finishBtn.disabled = !(state.px_per_cm && ok);
      };

      const wire = () => {
        // Step 1
        const objSel = display_element.querySelector('#vac-object');
        const objCm = display_element.querySelector('#vac-object-cm');
        const slider = display_element.querySelector('#vac-slider');
        const nextBtn = display_element.querySelector('#vac-next');

        if (objSel) {
          objSel.value = state.object_preset;
          objSel.addEventListener('change', () => {
            const next = normalizeObjectPreset(objSel.value, objCm ? objCm.value : state.object_length_cm);
            state.object_preset = next.preset;
            state.object_length_cm = next.lengthCm;
            if (objCm) {
              objCm.value = String(state.object_length_cm);
              objCm.disabled = (state.object_preset !== 'custom');
            }
            updateStep1UI();
          });
        }

        if (objCm) {
          objCm.disabled = (state.object_preset !== 'custom');
          objCm.addEventListener('input', () => {
            if (state.object_preset !== 'custom') return;
            const cm = Number(objCm.value);
            if (Number.isFinite(cm) && cm > 0) {
              state.object_length_cm = cm;
              updateStep1UI();
            }
          });
        }

        if (slider) {
          slider.addEventListener('input', () => {
            sliderTouched = true;
            state.target_width_px = clamp(slider.value, 60, 1200);
            updateStep1UI();
          });
        }

        if (nextBtn) {
          nextBtn.addEventListener('click', () => {
            showError('');
            const pxcm = recalcPxPerCm();
            if (!pxcm) {
              showError('Please adjust the bar to match your object.');
              return;
            }
            state.px_per_cm = pxcm;
            step = 2;
            render();
          });
        }

        // Step 2
        const backBtn = display_element.querySelector('#vac-back');
        if (backBtn) {
          backBtn.addEventListener('click', () => {
            showError('');
            step = 1;
            render();
          });
        }

        if (distanceMode === 'posture_choice') {
          display_element.querySelectorAll('input[name="vac-distance"]').forEach((el) => {
            el.addEventListener('change', () => {
              selectedDistanceChoice = el.value;
              state.distance_choice = selectedDistanceChoice;

              const closeCm = Number(trial.close_distance_cm ?? 35);
              const normalCm = Number(trial.normal_distance_cm ?? 50);
              const farCm = Number(trial.far_distance_cm ?? 65);

              if (selectedDistanceChoice === 'close') state.viewing_distance_cm = closeCm;
              else if (selectedDistanceChoice === 'normal') state.viewing_distance_cm = normalCm;
              else if (selectedDistanceChoice === 'far') state.viewing_distance_cm = farCm;

              updateStep2UI();
            });
          });
        }

        if (distanceMode === 'manual') {
          const distEl = display_element.querySelector('#vac-distance-cm');
          if (distEl) {
            distEl.addEventListener('input', () => {
              const v = Number(distEl.value);
              state.viewing_distance_cm = Number.isFinite(v) ? v : null;
              updateStep2UI();
            });
            // init
            const v0 = Number(distEl.value);
            state.viewing_distance_cm = Number.isFinite(v0) ? v0 : null;
          }
        }

        // Webcam toggle
        if (webcamEnabled) {
          const toggleBtn = display_element.querySelector('#vac-webcam-toggle');
          const videoEl = display_element.querySelector('#vac-video');
          const msgEl = display_element.querySelector('#vac-webcam-msg');

          const updateWebcamUI = () => {
            if (!toggleBtn || !videoEl) return;
            const on = !!webcamStream;
            toggleBtn.textContent = on ? 'Disable webcam' : 'Enable webcam';
            videoEl.style.display = on ? 'block' : 'none';
            if (msgEl) {
              msgEl.textContent = on
                ? 'Webcam enabled. Try to keep a consistent position during the task.'
                : 'If you choose to enable webcam, you can use it to keep your head position consistent. No video is stored by this step.';
            }
          };

          if (toggleBtn && videoEl) {
            toggleBtn.addEventListener('click', async () => {
              showError('');
              if (webcamStream) {
                stopWebcam();
                state.webcam_used = false;
                state.webcam_width = null;
                state.webcam_height = null;
                updateWebcamUI();
                return;
              }

              try {
                const constraints = {
                  video: {
                    facingMode,
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                  },
                  audio: false
                };

                webcamStream = await navigator.mediaDevices.getUserMedia(constraints);
                videoEl.srcObject = webcamStream;
                state.webcam_used = true;

                // Capture negotiated dimensions when available
                const track = webcamStream.getVideoTracks()[0];
                const settings = track && typeof track.getSettings === 'function' ? track.getSettings() : {};
                state.webcam_width = Number.isFinite(Number(settings.width)) ? Number(settings.width) : null;
                state.webcam_height = Number.isFinite(Number(settings.height)) ? Number(settings.height) : null;

                updateWebcamUI();
              } catch (e) {
                stopWebcam();
                showError('Webcam permission was denied or unavailable. You can continue without webcam.');
              }
            });
          }

          updateWebcamUI();
        }

        const finishBtn = display_element.querySelector('#vac-finish');
        if (finishBtn) {
          finishBtn.addEventListener('click', () => {
            showError('');
            const pxcm = Number(state.px_per_cm);
            const dist = Number(state.viewing_distance_cm);
            if (!Number.isFinite(pxcm) || pxcm <= 0) {
              showError('Screen scale is missing. Please complete Step 1.');
              return;
            }
            if (!Number.isFinite(dist) || dist <= 0) {
              showError('Viewing distance is missing. Please complete Step 2.');
              return;
            }

            const conv = computePxPerDeg(pxcm, dist);
            if (!conv) {
              showError('Could not compute px/deg. Please review inputs.');
              return;
            }

            const payload = {
              px_per_cm: pxcm,
              viewing_distance_cm: dist,
              cm_per_deg: conv.cmPerDeg,
              px_per_deg: conv.pxPerDeg,
              object_preset: state.object_preset,
              object_length_cm: state.object_length_cm,
              distance_mode: state.distance_mode,
              distance_choice: state.distance_choice,
              webcam_used: state.webcam_used,
              webcam_width: state.webcam_width,
              webcam_height: state.webcam_height,
              calibrated_at_iso: new Date().toISOString(),
              plugin: 'visual-angle-calibration'
            };

            setGlobal(payload);
            addGlobalDataProps({
              visual_angle_px_per_cm: pxcm,
              visual_angle_viewing_distance_cm: dist,
              visual_angle_px_per_deg: conv.pxPerDeg
            });

            stopWebcam();

            const rt = Math.round(nowMs() - startTs);
            this.jsPsych.finishTrial({
              ...payload,
              rt_ms: rt,
              ended_reason: 'completed',
              plugin_version: info.version
            });
          });
        }

        updateStep1UI();
        updateStep2UI();
      };

      // If participant navigates away / trial ends unexpectedly, stop webcam.
      const cleanup = () => {
        stopWebcam();
      };

      try {
        this.jsPsych.pluginAPI && this.jsPsych.pluginAPI.setTimeout && this.jsPsych.pluginAPI.setTimeout(() => {}, 0);
      } catch {
        // ignore
      }

      render();

      // Best-effort cleanup hook.
      this.jsPsych.getDisplayElement && (this.jsPsych.getDisplayElement().onunload = cleanup);
    }
  }

  JsPsychVisualAngleCalibrationPlugin.info = info;

  const root = (typeof window !== 'undefined') ? window : globalThis;
  root.jsPsychVisualAngleCalibration = JsPsychVisualAngleCalibrationPlugin;
})(
  (typeof window !== 'undefined' && (window.jsPsychModule || window.jsPsych))
    ? (window.jsPsychModule || window.jsPsych)
    : null
);
