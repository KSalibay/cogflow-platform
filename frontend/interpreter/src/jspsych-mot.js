/**
 * jspsych-mot.js — Multiple Object Tracking trial plugin for CogFlow
 * Phase sequence: cue → tracking → probe → [feedback] → iti → finishTrial
 */
(function (jspsych) {
  'use strict';

  const PT = (jspsych && jspsych.ParameterType)
    || (window.jsPsychModule && window.jsPsychModule.ParameterType)
    || (window.jsPsych && window.jsPsych.ParameterType)
    || {
      BOOL: 'BOOL', STRING: 'STRING', INT: 'INT', FLOAT: 'FLOAT',
      OBJECT: 'OBJECT', KEY: 'KEY', KEYS: 'KEYS', SELECT: 'SELECT',
      HTML_STRING: 'HTML_STRING', COMPLEX: 'COMPLEX',
      FUNCTION: 'FUNCTION', TIMELINE: 'TIMELINE'
    };

  const info = {
    name: 'mot',
    version: '1.0.0',
    parameters: {
      num_objects:          { type: PT.INT,    default: 8 },
      num_targets:          { type: PT.INT,    default: 4 },
      object_radius_px:     { type: PT.INT,    default: 22 },
      object_color:         { type: PT.STRING, default: '#FFFFFF' },
      target_cue_color:     { type: PT.STRING, default: '#FF9900' },
      background_color:     { type: PT.STRING, default: '#111111' },
      arena_width_px:       { type: PT.INT,    default: 700 },
      arena_height_px:      { type: PT.INT,    default: 500 },
      aperture_shape:       { type: PT.SELECT, default: 'rectangle', options: ['rectangle', 'circle'] },
      aperture_border_enabled: { type: PT.BOOL, default: true },
      aperture_border_color: { type: PT.STRING, default: '#444444' },
      aperture_border_width_px: { type: PT.INT, default: 2 },
      boundary_behavior:    { type: PT.SELECT, default: 'bounce', options: ['bounce', 'wrap'] },
      min_separation_px:    { type: PT.INT,    default: 50 },
      speed_px_per_s:       { type: PT.FLOAT,  default: 150 },
      speed_variability:    { type: PT.FLOAT,  default: 0.0 },
      motion_type:          { type: PT.SELECT, default: 'linear', options: ['linear', 'curved'] },
      curve_strength:       { type: PT.FLOAT,  default: 0.3 },
      cue_duration_ms:      { type: PT.INT,    default: 2000 },
      cue_flash_rate_hz:    { type: PT.FLOAT,  default: 3 },
      tracking_duration_ms: { type: PT.INT,    default: 8000 },
      iti_ms:               { type: PT.INT,    default: 1000 },
      probe_mode:           { type: PT.SELECT, default: 'click', options: ['click', 'number_entry'] },
      probe_timeout_ms:     { type: PT.INT,    default: 0 },
      show_feedback:        { type: PT.BOOL,   default: false },
      feedback_duration_ms: { type: PT.INT,    default: 1500 }
    },
    data: {
      num_objects:          { type: PT.INT },
      num_targets:          { type: PT.INT },
      num_correct:          { type: PT.INT },
      num_false_alarms:     { type: PT.INT },
      num_missed:           { type: PT.INT },
      rt_first_response_ms: { type: PT.FLOAT },
      selected_objects:     { type: PT.STRING },
      clicks:               { type: PT.STRING },
      ended_reason:         { type: PT.STRING },
      plugin_version:       { type: PT.STRING }
    }
  };

  // ── small utilities ───────────────────────────────────────────────────────

  function randRange(min, max) { return min + Math.random() * (max - min); }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ── plugin class ──────────────────────────────────────────────────────────

  class JsPsychMotPlugin {
    constructor(jsPsych) { this.jsPsych = jsPsych; }

    trial(display_element, trial) {
      const jsPsych = this.jsPsych;

      const {
        num_objects, num_targets, object_radius_px,
        object_color, target_cue_color, background_color,
        arena_width_px: W, arena_height_px: H,
        aperture_shape, aperture_border_enabled, aperture_border_color, aperture_border_width_px,
        boundary_behavior, min_separation_px,
        speed_px_per_s, speed_variability, motion_type, curve_strength,
        cue_duration_ms, cue_flash_rate_hz, tracking_duration_ms, iti_ms,
        probe_mode, probe_timeout_ms, show_feedback, feedback_duration_ms
      } = trial;

      const r = object_radius_px;

      // ── DOM ──────────────────────────────────────────────────────────────
      display_element.innerHTML = `
        <div id="mot-container" style="display:flex;flex-direction:column;align-items:center;
             justify-content:center;background:${background_color};width:100%;
             min-height:100vh;box-sizing:border-box;padding:20px;">
          <canvas id="mot-canvas" width="${W}" height="${H}"
            style="display:block;background:${background_color};
                   border:none;max-width:100%;cursor:default;"></canvas>
          <div id="mot-instr" style="color:#ccc;font-family:sans-serif;font-size:14px;
               margin-top:8px;height:24px;text-align:center;"></div>
          <div id="mot-input-row" style="display:none;margin-top:8px;
               font-family:sans-serif;color:#ccc;align-items:center;gap:8px;"></div>
        </div>`;

      const canvas   = document.getElementById('mot-canvas');
      const ctx      = canvas.getContext('2d');
      const instrEl  = document.getElementById('mot-instr');
      const inputRow = document.getElementById('mot-input-row');

      const isCircularAperture = String(aperture_shape || 'rectangle').toLowerCase() === 'circle';
      const borderWidth = Number.isFinite(Number(aperture_border_width_px))
        ? Math.max(0, Number(aperture_border_width_px))
        : 0;
      const borderEnabled = aperture_border_enabled !== false && borderWidth > 0;
      const cx = W / 2;
      const cy = H / 2;
      const circleBorderRadius = Math.max(0, (Math.min(W, H) / 2) - (borderEnabled ? borderWidth / 2 : 0));
      const circleClipRadius = Math.max(r, circleBorderRadius);
      const circleMaxCenterRadius = Math.max(r, circleClipRadius - r);

      function randomPointInArena() {
        if (!isCircularAperture) {
          return { x: randRange(r, W - r), y: randRange(r, H - r) };
        }
        const theta = randRange(0, 2 * Math.PI);
        const rad = Math.sqrt(Math.random()) * circleMaxCenterRadius;
        return { x: cx + Math.cos(theta) * rad, y: cy + Math.sin(theta) * rad };
      }

      // ── object placement ─────────────────────────────────────────────────
      function placeObjects() {
        const objs = [];
        const minDist = Math.max(min_separation_px, 2 * r + 4);
        for (let i = 0; i < num_objects; i++) {
          let placed = false;
          for (let attempt = 0; attempt < 1000; attempt++) {
            const pt = randomPointInArena();
            const x = pt.x;
            const y = pt.y;
            let ok = true;
            for (const o of objs) {
              const dx = o.x - x, dy = o.y - y;
              if (Math.sqrt(dx * dx + dy * dy) < minDist) { ok = false; break; }
            }
            if (ok) {
              const angle = randRange(0, 2 * Math.PI);
              const spd   = speed_px_per_s * (1 + speed_variability * (Math.random() * 2 - 1));
              objs.push({ x, y, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd });
              placed = true;
              break;
            }
          }
          if (!placed) {
            // fallback: ignore separation constraint
            const angle = randRange(0, 2 * Math.PI);
            const spd   = speed_px_per_s * (1 + speed_variability * (Math.random() * 2 - 1));
            const pt = randomPointInArena();
            objs.push({ x: pt.x, y: pt.y,
                        vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd });
          }
        }
        return objs;
      }

      const objects   = placeObjects();
      const targetSet = new Set(shuffle(objects.map((_, i) => i)).slice(0, num_targets));

      // ── simulation state ─────────────────────────────────────────────────
      let phase            = 'cue';
      let phaseStart       = performance.now();
      let rafId            = null;
      let lastT            = phaseStart;
      let probeStartMs     = 0;
      let firstResponseMs  = null;
      let selectedObjects  = new Set();
      let clickLog         = [];
      let endedReason      = 'selection_complete';
      let probeTimerHandle = null;

      // ── physics ──────────────────────────────────────────────────────────
      const MAX_TURN_RAD_S = 3.0;   // max turning speed for curved mode

      function updateObjects(dtSec) {
        for (const o of objects) {
          if (motion_type === 'curved') {
            const turn = (Math.random() - 0.5) * 2 * MAX_TURN_RAD_S * curve_strength * dtSec;
            const cos  = Math.cos(turn), sin = Math.sin(turn);
            const nvx  = o.vx * cos - o.vy * sin;
            const nvy  = o.vx * sin + o.vy * cos;
            o.vx = nvx; o.vy = nvy;
          }
          o.x += o.vx * dtSec;
          o.y += o.vy * dtSec;

          if (isCircularAperture) {
            const dx = o.x - cx;
            const dy = o.y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.000001;

            if (boundary_behavior === 'bounce') {
              if (dist > circleMaxCenterRadius) {
                const nx = dx / dist;
                const ny = dy / dist;

                o.x = cx + nx * circleMaxCenterRadius;
                o.y = cy + ny * circleMaxCenterRadius;

                const vDotN = o.vx * nx + o.vy * ny;
                if (vDotN > 0) {
                  o.vx -= 2 * vDotN * nx;
                  o.vy -= 2 * vDotN * ny;
                }
              }
            } else {
              if (dist > circleMaxCenterRadius) {
                const nx = dx / dist;
                const ny = dy / dist;
                o.x = cx - nx * circleMaxCenterRadius;
                o.y = cy - ny * circleMaxCenterRadius;
              }
            }
            continue;
          }

          if (boundary_behavior === 'bounce') {
            if (o.x < r)     { o.x = r;     o.vx =  Math.abs(o.vx); }
            if (o.x > W - r) { o.x = W - r; o.vx = -Math.abs(o.vx); }
            if (o.y < r)     { o.y = r;     o.vy =  Math.abs(o.vy); }
            if (o.y > H - r) { o.y = H - r; o.vy = -Math.abs(o.vy); }
          } else {
            if (o.x < -r)  o.x = W + r;
            if (o.x > W + r) o.x = -r;
            if (o.y < -r)  o.y = H + r;
            if (o.y > H + r) o.y = -r;
          }
        }
      }

      // ── rendering ────────────────────────────────────────────────────────
      function clearCanvas() {
        ctx.fillStyle = background_color;
        ctx.fillRect(0, 0, W, H);
      }

      function beginApertureClip() {
        if (!isCircularAperture) return;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, circleClipRadius, 0, 2 * Math.PI);
        ctx.clip();
      }

      function endApertureClip() {
        if (!isCircularAperture) return;
        ctx.restore();
      }

      function drawApertureBorder() {
        if (!borderEnabled) return;
        ctx.save();
        ctx.strokeStyle = aperture_border_color || '#444444';
        ctx.lineWidth = borderWidth;

        if (isCircularAperture) {
          ctx.beginPath();
          ctx.arc(cx, cy, circleBorderRadius, 0, 2 * Math.PI);
          ctx.stroke();
        } else {
          const inset = borderWidth / 2;
          const w = Math.max(0, W - borderWidth);
          const h = Math.max(0, H - borderWidth);
          ctx.strokeRect(inset, inset, w, h);
        }

        ctx.restore();
      }

      function drawObjects(flashOn) {
        for (let i = 0; i < objects.length; i++) {
          const o       = objects[i];
          const isTgt   = targetSet.has(i);
          const isSel   = selectedObjects.has(i);

          // fill color
          let fillColor = object_color;
          if (phase === 'cue' && isTgt && flashOn) fillColor = target_cue_color;
          if ((phase === 'probe' || phase === 'feedback') && isSel) fillColor = target_cue_color;

          ctx.beginPath();
          ctx.arc(o.x, o.y, r, 0, 2 * Math.PI);
          ctx.fillStyle   = fillColor;
          ctx.fill();
          ctx.strokeStyle = 'rgba(136,136,136,0.6)';
          ctx.lineWidth   = 1.5;
          ctx.stroke();

          // number labels for number_entry probe
          if (phase === 'probe' && probe_mode === 'number_entry') {
            const fontSize = Math.max(10, Math.floor(r * 0.75));
            ctx.font        = `bold ${fontSize}px sans-serif`;
            ctx.textAlign   = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle   = (fillColor === object_color) ? background_color : '#111';
            ctx.fillText(String(i + 1), o.x, o.y);
          }

          // feedback rings
          if (phase === 'feedback') {
            let ringColor = null;
            if (isTgt && isSel)   ringColor = '#00cc44';  // correct hit
            if (isTgt && !isSel)  ringColor = '#cc0000';  // missed
            if (!isTgt && isSel)  ringColor = '#ff8800';  // false alarm
            if (ringColor) {
              ctx.beginPath();
              ctx.arc(o.x, o.y, r + 6, 0, 2 * Math.PI);
              ctx.strokeStyle = ringColor;
              ctx.lineWidth   = 4;
              ctx.stroke();
            }
          }
        }
      }

      // ── end trial ────────────────────────────────────────────────────────
      function endTrial() {
        if (rafId)            cancelAnimationFrame(rafId);
        if (probeTimerHandle) clearTimeout(probeTimerHandle);
        canvas.removeEventListener('click', handleCanvasClick);
        document.removeEventListener('keydown', handleEnterKey);

        const selArr = Array.from(selectedObjects);
        let numCorrect = 0, numFalseAlarms = 0;
        for (const idx of selArr) {
          if (targetSet.has(idx)) numCorrect++;
          else                    numFalseAlarms++;
        }

        display_element.innerHTML = '';
        jsPsych.finishTrial({
          num_objects,
          num_targets,
          num_correct:          numCorrect,
          num_false_alarms:     numFalseAlarms,
          num_missed:           num_targets - numCorrect,
          rt_first_response_ms: firstResponseMs,
          selected_objects:     JSON.stringify(selArr),
          clicks:               JSON.stringify(clickLog),
          ended_reason:         endedReason,
          plugin_version:       '1.0.0'
        });
      }

      // ── probe: click mode ─────────────────────────────────────────────────
      function handleCanvasClick(evt) {
        if (phase !== 'probe') return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = W / rect.width;
        const scaleY = H / rect.height;
        const mx  = (evt.clientX - rect.left) * scaleX;
        const my  = (evt.clientY - rect.top)  * scaleY;
        const now = performance.now();

        if (firstResponseMs === null) firstResponseMs = now - probeStartMs;

        let hitIdx = -1;
        for (let i = 0; i < objects.length; i++) {
          const o = objects[i];
          const dx = o.x - mx, dy = o.y - my;
          if (Math.sqrt(dx * dx + dy * dy) <= r) { hitIdx = i; break; }
        }

        clickLog.push({ x: mx, y: my, t_ms: now - probeStartMs,
                        object_hit: hitIdx >= 0, object_idx: hitIdx });

        if (hitIdx >= 0) {
          if (selectedObjects.has(hitIdx)) selectedObjects.delete(hitIdx);
          else                             selectedObjects.add(hitIdx);

          if (selectedObjects.size >= num_targets) {
            endedReason = 'selection_complete';
            beginFeedbackOrIti();
          }
        }
      }

      // ── probe: number_entry mode ──────────────────────────────────────────
      function handleEnterKey(evt) {
        if (phase !== 'probe' || probe_mode !== 'number_entry') return;
        if (evt.key === 'Enter') submitNumberEntry();
      }

      function parseNumbers(str) {
        return str.split(/[\s,;]+/)
          .map(s => parseInt(s, 10))
          .filter(n => Number.isFinite(n) && n >= 1 && n <= num_objects)
          .filter((n, idx, arr) => arr.indexOf(n) === idx)  // unique
          .map(n => n - 1);                                  // 0-indexed
      }

      function submitNumberEntry() {
        if (phase !== 'probe') return;
        if (firstResponseMs === null) firstResponseMs = performance.now() - probeStartMs;
        endedReason = 'keypress_complete';
        beginFeedbackOrIti();
      }

      // ── probe start ──────────────────────────────────────────────────────
      function startProbe() {
        phase        = 'probe';
        probeStartMs = performance.now();
        canvas.style.cursor = probe_mode === 'click' ? 'pointer' : 'default';

        if (probe_mode === 'click') {
          instrEl.textContent = `Click the ${num_targets} object(s) you were tracking.`;
          canvas.addEventListener('click', handleCanvasClick);
        } else {
          instrEl.textContent = `Type the number(s) of the object(s) you tracked, then press Enter.`;
          document.addEventListener('keydown', handleEnterKey);
          inputRow.style.display = 'flex';
          inputRow.innerHTML = `
            <span>Objects (1–${num_objects}):</span>
            <input id="mot-num-in" type="text" autocomplete="off"
              style="width:180px;font-size:16px;text-align:center;
                     background:#222;color:#eee;border:1px solid #555;padding:4px 8px;border-radius:3px;"
              placeholder="e.g. 2, 5, 7" />
            <button id="mot-submit-btn"
              style="padding:4px 14px;font-size:14px;background:#444;color:#eee;
                     border:1px solid #666;border-radius:3px;cursor:pointer;">
              Submit
            </button>`;

          const numInput  = document.getElementById('mot-num-in');
          const submitBtn = document.getElementById('mot-submit-btn');
          numInput.focus();

          numInput.addEventListener('input', () => {
            const parsed = parseNumbers(numInput.value);
            selectedObjects = new Set(parsed);
            if (firstResponseMs === null && parsed.length > 0) {
              firstResponseMs = performance.now() - probeStartMs;
            }
            if (selectedObjects.size >= num_targets) {
              endedReason = 'keypress_complete';
              beginFeedbackOrIti();
            }
          });

          submitBtn.addEventListener('click', submitNumberEntry);
        }

        if (probe_timeout_ms > 0) {
          probeTimerHandle = setTimeout(() => {
            if (phase === 'probe') {
              endedReason = 'timeout';
              beginFeedbackOrIti();
            }
          }, probe_timeout_ms);
        }
      }

      function beginFeedbackOrIti() {
        if (probeTimerHandle) { clearTimeout(probeTimerHandle); probeTimerHandle = null; }
        canvas.removeEventListener('click', handleCanvasClick);
        document.removeEventListener('keydown', handleEnterKey);
        inputRow.style.display = 'none';
        instrEl.textContent    = '';
        canvas.style.cursor    = 'default';

        if (show_feedback) {
          phase      = 'feedback';
          phaseStart = performance.now();
        } else {
          phase      = 'iti';
          phaseStart = performance.now();
        }
      }

      // ── animation loop ───────────────────────────────────────────────────
      function loop(t) {
        const dtSec  = Math.min((t - lastT) / 1000, 0.05);
        lastT        = t;
        const elapsed = t - phaseStart;

        clearCanvas();
        beginApertureClip();

        if (phase === 'cue') {
          const flashOn = Math.floor(elapsed / (500 / cue_flash_rate_hz)) % 2 === 0;
          updateObjects(dtSec);
          drawObjects(flashOn);
          instrEl.textContent = 'Remember the highlighted objects!';
          if (elapsed >= cue_duration_ms) {
            phase      = 'tracking';
            phaseStart = t;
          }

        } else if (phase === 'tracking') {
          updateObjects(dtSec);
          drawObjects(false);
          instrEl.textContent = 'Keep tracking...';
          if (elapsed >= tracking_duration_ms) {
            startProbe();          // changes phase → 'probe'
          }

        } else if (phase === 'probe') {
          drawObjects(false);      // objects frozen; selection highlighted in drawObjects

        } else if (phase === 'feedback') {
          drawObjects(false);      // rings drawn inside drawObjects
          if (elapsed >= feedback_duration_ms) {
            phase      = 'iti';
            phaseStart = performance.now();
          }

        } else if (phase === 'iti') {
          // canvas already cleared (blank)
          if (elapsed >= Math.max(iti_ms, 0)) {
            endApertureClip();
            endTrial();
            return;               // skip scheduling next frame
          }
        }

        endApertureClip();
        drawApertureBorder();
        rafId = requestAnimationFrame(loop);
      }

      lastT  = performance.now();
      phaseStart = lastT;
      rafId  = requestAnimationFrame(loop);
    }
  }

  JsPsychMotPlugin.info = info;
  window.jsPsychMot = JsPsychMotPlugin;

})(window.jsPsychModule || window.jsPsych);
