(function () {
  function degToRad(deg) {
    return (Number(deg) * Math.PI) / 180;
  }

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  function isFiniteNumber(x) {
    return Number.isFinite(x);
  }

  function pickColor(v, fallback) {
    return (typeof v === 'string' && v.trim() !== '') ? v : fallback;
  }

  function parseColorToRgb(raw, fallbackRgb) {
    const s = (typeof raw === 'string') ? raw.trim() : '';
    if (!s) return fallbackRgb;

    // #RRGGBB
    if (s[0] === '#' && s.length === 7) {
      const r = Number.parseInt(s.slice(1, 3), 16);
      const g = Number.parseInt(s.slice(3, 5), 16);
      const b = Number.parseInt(s.slice(5, 7), 16);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b };
    }

    // rgb(r,g,b)
    const m = s.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (m) {
      const r = Number(m[1]);
      const g = Number(m[2]);
      const b = Number(m[3]);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255) };
      }
    }

    return fallbackRgb;
  }

  function rgbToCss(rgb) {
    const r = clamp(Math.round(rgb.r), 0, 255);
    const g = clamp(Math.round(rgb.g), 0, 255);
    const b = clamp(Math.round(rgb.b), 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpRgb(a, b, t) {
    return {
      r: lerp(a.r, b.r, t),
      g: lerp(a.g, b.g, t),
      b: lerp(a.b, b.b, t)
    };
  }

  function lerpAngleDeg(a, b, t) {
    const aN = Number(a);
    const bN = Number(b);
    if (!Number.isFinite(aN) || !Number.isFinite(bN)) return bN;
    let delta = ((bN - aN + 540) % 360) - 180;
    return aN + delta * t;
  }

  function pointInCircle(x, y, cx, cy, r) {
    const dx = x - cx;
    const dy = y - cy;
    return (dx * dx + dy * dy) <= (r * r);
  }

  function randomPointInCircle(cx, cy, r, rng) {
    // Rejection sampling is fine at our scale.
    while (true) {
      const x = cx + (rng() * 2 - 1) * r;
      const y = cy + (rng() * 2 - 1) * r;
      if (pointInCircle(x, y, cx, cy, r)) return { x, y };
    }
  }

  class RDMEngine {
    constructor(canvas, params) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.params = params || {};
      this.running = false;
      this.raf = null;
      this.lastTs = 0;
      this.frameCount = 0;
      this.dots = [];
      this.rng = Math.random;
      this.arrowDirectionDeg = null;
      this.arrowColor = null;

      this._init();
    }

    _init() {
      const p = this.params;
      const w = Number(p.canvas_width ?? this.canvas.width ?? 600);
      const h = Number(p.canvas_height ?? this.canvas.height ?? 600);
      this.canvas.width = w;
      this.canvas.height = h;

      this.centerX = w / 2;
      this.centerY = h / 2;

      this.background = pickColor(p.background_color, '#000000');
      this.dotSize = Number(p.dot_size ?? 4);
      this.totalDots = Math.max(1, Number.parseInt(p.total_dots ?? 150, 10) || 150);

      this.apertureShape = (p.aperture_shape === 'square') ? 'square' : 'circle';
      this.apertureSize = Number(p.aperture_size ?? Math.min(w, h) / 2);
      this.apertureRadius = this.apertureShape === 'circle' ? (this.apertureSize / 2) : null;

      this.lifetimeFrames = Math.max(1, Number.parseInt(p.lifetime_frames ?? 60, 10) || 60);

      this._initDots();
    }

    updateParams(next) {
      this.params = { ...(this.params || {}), ...(next || {}) };
      this._init();
    }

    needsReinitFor(fromParams, toParams) {
      const a = fromParams || {};
      const b = toParams || {};

      const keys = [
        'canvas_width',
        'canvas_height',
        'aperture_shape',
        'aperture_size',
        'total_dots',
        'dot_size',
        'lifetime_frames'
      ];

      for (const k of keys) {
        if (a[k] !== undefined || b[k] !== undefined) {
          if (String(a[k]) !== String(b[k])) return true;
        }
      }

      // dot-groups structural changes
      const isGroupsA = (a.type === 'rdm-dot-groups') || a.enable_groups === true || a.group_1_percentage !== undefined;
      const isGroupsB = (b.type === 'rdm-dot-groups') || b.enable_groups === true || b.group_1_percentage !== undefined;
      if (isGroupsA !== isGroupsB) return true;

      // NOTE: group_1_percentage changes are handled dynamically during continuous rendering
      // (we reassign dot groups without reinitializing the canvas).

      return false;
    }

    applyDynamicsFromParams(params) {
      // Apply immediate (non-interpolated) speed+color changes without resetting dots.
      this._applyInterpolated(params, params, 1, 'none');
    }

    applyInterpolatedDynamics(fromParams, toParams, t, transitionType) {
      this._applyInterpolated(fromParams, toParams, t, transitionType);
    }

    _applyInterpolated(fromParams, toParams, t, transitionType) {
      const a = fromParams || {};
      const b = toParams || {};
      const type = (typeof transitionType === 'string' ? transitionType : 'none');

      const doColor = (type === 'both' || type === 'color');
      const doSpeed = (type === 'both' || type === 'speed');

      const isGroups = (b.type === 'rdm-dot-groups') || b.enable_groups === true || b.group_1_percentage !== undefined;

      if (isGroups) {
        // Support smooth/dynamic group percentage changes without a full re-init.
        const aPctRaw = Number(a.group_1_percentage ?? 50);
        const bPctRaw = Number(b.group_1_percentage ?? aPctRaw);
        const pct = clamp(lerp(aPctRaw, bPctRaw, t), 0, 100);
        const desiredG1 = Math.round((pct / 100) * this.totalDots);
        const desiredG2 = Math.max(0, this.totalDots - desiredG1);

        const aG1Color = parseColorToRgb(a.group_1_color, { r: 255, g: 0, b: 102 });
        const bG1Color = parseColorToRgb(b.group_1_color, aG1Color);
        const aG2Color = parseColorToRgb(a.group_2_color, { r: 0, g: 102, b: 255 });
        const bG2Color = parseColorToRgb(b.group_2_color, aG2Color);

        const aG1Speed = Number(a.group_1_speed ?? a.speed ?? 5);
        const bG1Speed = Number(b.group_1_speed ?? b.speed ?? aG1Speed);
        const aG2Speed = Number(a.group_2_speed ?? a.speed ?? 5);
        const bG2Speed = Number(b.group_2_speed ?? b.speed ?? aG2Speed);

        const aG1Coh = clamp(Number(a.group_1_coherence ?? a.coherence ?? 0.5), 0, 1);
        const bG1Coh = clamp(Number(b.group_1_coherence ?? b.coherence ?? aG1Coh), 0, 1);
        const aG2Coh = clamp(Number(a.group_2_coherence ?? a.coherence ?? 0.5), 0, 1);
        const bG2Coh = clamp(Number(b.group_2_coherence ?? b.coherence ?? aG2Coh), 0, 1);

        const aG1Dir = Number(a.group_1_direction ?? a.direction ?? 0);
        const bG1Dir = Number(b.group_1_direction ?? b.direction ?? aG1Dir);
        const aG2Dir = Number(a.group_2_direction ?? a.direction ?? 180);
        const bG2Dir = Number(b.group_2_direction ?? b.direction ?? aG2Dir);

        const g1Color = doColor ? rgbToCss(lerpRgb(aG1Color, bG1Color, t)) : pickColor(b.group_1_color, pickColor(a.group_1_color, '#FF0066'));
        const g2Color = doColor ? rgbToCss(lerpRgb(aG2Color, bG2Color, t)) : pickColor(b.group_2_color, pickColor(a.group_2_color, '#0066FF'));
        const g1Speed = doSpeed ? lerp(Number(aG1Speed), Number(bG1Speed), t) : Number(bG1Speed);
        const g2Speed = doSpeed ? lerp(Number(aG2Speed), Number(bG2Speed), t) : Number(bG2Speed);
        const g1Coh = doSpeed ? lerp(aG1Coh, bG1Coh, t) : bG1Coh;
        const g2Coh = doSpeed ? lerp(aG2Coh, bG2Coh, t) : bG2Coh;
        const g1Dir = doSpeed ? lerpAngleDeg(aG1Dir, bG1Dir, t) : bG1Dir;
        const g2Dir = doSpeed ? lerpAngleDeg(aG2Dir, bG2Dir, t) : bG2Dir;

        // keep cue border behavior current
        this.params = { ...(this.params || {}), ...(b || {}) };

        // Adjust group membership counts without wiping the canvas (avoids white flash).
        // We keep positions/lifetimes; only update group + per-dot parameters.
        let currentG1 = 0;
        let currentG2 = 0;
        for (const d of this.dots) {
          if (d.group === 1) currentG1++;
          else if (d.group === 2) currentG2++;
        }

        if (currentG1 !== desiredG1 || currentG2 !== desiredG2) {
          if (currentG1 < desiredG1) {
            let need = desiredG1 - currentG1;
            for (const d of this.dots) {
              if (need <= 0) break;
              if (d.group === 2) {
                d.group = 1;
                need--;
              }
            }
          } else if (currentG1 > desiredG1) {
            let need = currentG1 - desiredG1;
            for (const d of this.dots) {
              if (need <= 0) break;
              if (d.group === 1) {
                d.group = 2;
                need--;
              }
            }
          }
        }

        for (const d of this.dots) {
          if (d.group === 1) {
            d.color = g1Color;
            d.speed = g1Speed;
            d.coherence = g1Coh;
            d.direction = g1Dir;
          } else if (d.group === 2) {
            d.color = g2Color;
            d.speed = g2Speed;
            d.coherence = g2Coh;
            d.direction = g2Dir;
          }
        }
        return;
      }

      const aColor = parseColorToRgb(a.dot_color, { r: 255, g: 255, b: 255 });
      const bColor = parseColorToRgb(b.dot_color, aColor);
      const aSpeed = Number(a.speed ?? 5);
      const bSpeed = Number(b.speed ?? aSpeed);

      const aCoh = clamp(Number(a.coherence ?? 0.5), 0, 1);
      const bCoh = clamp(Number(b.coherence ?? aCoh), 0, 1);
      const aDir = Number(a.direction ?? a.coherent_direction ?? 0);
      const bDir = Number(b.direction ?? b.coherent_direction ?? aDir);

      const dotColor = doColor ? rgbToCss(lerpRgb(aColor, bColor, t)) : pickColor(b.dot_color, pickColor(a.dot_color, '#ffffff'));
      const speed = doSpeed ? lerp(Number(aSpeed), Number(bSpeed), t) : Number(bSpeed);
      const coherence = doSpeed ? lerp(aCoh, bCoh, t) : bCoh;
      const direction = doSpeed ? lerpAngleDeg(aDir, bDir, t) : bDir;

      this.params = { ...(this.params || {}), ...(b || {}) };

      for (const d of this.dots) {
        d.color = dotColor;
        d.speed = speed;
        d.coherence = coherence;
        d.direction = direction;
      }
    }

    _initDots() {
      const p = this.params;

      // Dot-groups mode (flat schema)
      const isGroups = (typeof p.type === 'string' && p.type === 'rdm-dot-groups') || p.enable_groups === true || p.group_1_percentage !== undefined;

      this.dots = [];

      if (isGroups) {
        const g1Pct = clamp(Number(p.group_1_percentage ?? 50), 0, 100);
        const g2Pct = clamp(Number(p.group_2_percentage ?? (100 - g1Pct)), 0, 100);
        const total = this.totalDots;
        const g1N = Math.round((g1Pct / 100) * total);
        const g2N = Math.max(0, total - g1N);

        this._pushGroupDots(1, g1N, {
          coherence: clamp(Number(p.group_1_coherence ?? 0.5), 0, 1),
          direction: Number(p.group_1_direction ?? 0),
          speed: Number(p.group_1_speed ?? p.speed ?? 5),
          color: pickColor(p.group_1_color, '#FF0066')
        });

        this._pushGroupDots(2, g2N, {
          coherence: clamp(Number(p.group_2_coherence ?? 0.5), 0, 1),
          direction: Number(p.group_2_direction ?? 180),
          speed: Number(p.group_2_speed ?? p.speed ?? 5),
          color: pickColor(p.group_2_color, '#0066FF')
        });

        return;
      }

      const dotColor = pickColor(p.dot_color, '#ffffff');
      const coherence = clamp(Number(p.coherence ?? 0.5), 0, 1);
      const direction = Number(p.direction ?? p.coherent_direction ?? 0);
      const speed = Number(p.speed ?? 5);

      for (let i = 0; i < this.totalDots; i++) {
        this.dots.push(this._newDot({
          group: 0,
          color: dotColor,
          coherence,
          direction,
          speed
        }));
      }
    }

    _pushGroupDots(groupId, n, groupParams) {
      for (let i = 0; i < n; i++) {
        this.dots.push(this._newDot({
          group: groupId,
          color: groupParams.color,
          coherence: groupParams.coherence,
          direction: groupParams.direction,
          speed: groupParams.speed
        }));
      }
    }

    _newDot(meta) {
      const pos = this._randomInAperture();
      return {
        x: pos.x,
        y: pos.y,
        life: Math.floor(Math.random() * this.lifetimeFrames),
        group: meta.group,
        color: meta.color,
        coherence: meta.coherence,
        direction: meta.direction,
        speed: meta.speed
      };
    }

    _randomInAperture() {
      if (this.apertureShape === 'circle') {
        return randomPointInCircle(this.centerX, this.centerY, this.apertureRadius, this.rng);
      }

      // square
      const half = this.apertureSize / 2;
      return {
        x: this.centerX + (this.rng() * 2 - 1) * half,
        y: this.centerY + (this.rng() * 2 - 1) * half
      };
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.lastTs = 0;
      this.frameCount = 0;
      this._tick = this._tick.bind(this);
      this.raf = requestAnimationFrame(this._tick);
    }

    stop() {
      this.running = false;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
    }

    clear() {
      const ctx = this.ctx;
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    _tick(ts) {
      if (!this.running) return;
      this.frameCount++;
      this.lastTs = ts;
      this.step();
      this.render();
      this.raf = requestAnimationFrame(this._tick);
    }

    step() {
      for (let i = 0; i < this.dots.length; i++) {
        const d = this.dots[i];
        d.life++;
        if (d.life >= this.lifetimeFrames) {
          const pos = this._randomInAperture();
          d.x = pos.x;
          d.y = pos.y;
          d.life = 0;
          continue;
        }

        // Decide coherent vs noise
        const coherent = this.rng() < d.coherence;

        const dir = coherent ? d.direction : (this.rng() * 360);
        const r = degToRad(dir);
        const vx = Math.cos(r) * d.speed;
        const vy = Math.sin(r) * d.speed;

        d.x += vx;
        d.y += vy;

        // Wrap inside aperture
        if (this.apertureShape === 'circle') {
          if (!pointInCircle(d.x, d.y, this.centerX, this.centerY, this.apertureRadius)) {
            const pos = this._randomInAperture();
            d.x = pos.x;
            d.y = pos.y;
            d.life = 0;
          }
        } else {
          const half = this.apertureSize / 2;
          if (
            d.x < this.centerX - half ||
            d.x > this.centerX + half ||
            d.y < this.centerY - half ||
            d.y > this.centerY + half
          ) {
            const pos = this._randomInAperture();
            d.x = pos.x;
            d.y = pos.y;
            d.life = 0;
          }
        }
      }
    }

    render() {
      const ctx = this.ctx;
      const p = this.params;
      this.clear();

      // Aperture outline (optional)
      if (p.show_aperture_outline) {
        ctx.save();
        ctx.strokeStyle = pickColor(p.aperture_outline_color, 'rgba(255,255,255,0.2)');
        ctx.lineWidth = Number(p.aperture_outline_width ?? 1);
        if (this.apertureShape === 'circle') {
          ctx.beginPath();
          ctx.arc(this.centerX, this.centerY, this.apertureRadius, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          const half = this.apertureSize / 2;
          ctx.strokeRect(this.centerX - half, this.centerY - half, this.apertureSize, this.apertureSize);
        }
        ctx.restore();
      }

      // Cue border (dot-groups)
      if (p.cue_border_mode && p.cue_border_mode !== 'off') {
        const width = Number(p.cue_border_width ?? 3);
        let color = null;
        if (p.cue_border_mode === 'target-group-color') {
          const g = Number(p.response_target_group);
          color = (g === 1) ? pickColor(p.group_1_color, null) : (g === 2) ? pickColor(p.group_2_color, null) : null;
        }
        if (!color) color = pickColor(p.cue_border_color, 'rgba(255,255,255,0.7)');

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        if (this.apertureShape === 'circle') {
          ctx.beginPath();
          ctx.arc(this.centerX, this.centerY, this.apertureRadius, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          const half = this.apertureSize / 2;
          ctx.strokeRect(this.centerX - half, this.centerY - half, this.apertureSize, this.apertureSize);
        }
        ctx.restore();
      }

      // Dots
      ctx.save();
      for (const d of this.dots) {
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.arc(d.x, d.y, this.dotSize / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Fixation cross (optional)
      if (p.show_fixation) {
        const size = Number(p.fixation_size ?? 10);
        ctx.save();
        ctx.strokeStyle = pickColor(p.fixation_color, '#ffffff');
        ctx.lineWidth = Number(p.fixation_width ?? 2);
        ctx.beginPath();
        ctx.moveTo(this.centerX - size, this.centerY);
        ctx.lineTo(this.centerX + size, this.centerY);
        ctx.moveTo(this.centerX, this.centerY - size);
        ctx.lineTo(this.centerX, this.centerY + size);
        ctx.stroke();
        ctx.restore();
      }

      // Feedback arrow (optional)
      if (this.arrowDirectionDeg !== null && this.arrowColor !== null) {
        this._drawFeedbackArrow();
      }
    }

    _drawFeedbackArrow() {
      const ctx = this.ctx;
      const angle = this.arrowDirectionDeg;
      const theta = (angle * Math.PI) / 180;

      ctx.save();
      ctx.strokeStyle = this.arrowColor;
      ctx.fillStyle = this.arrowColor;
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const apertureR = this.apertureShape === 'circle' ? this.apertureRadius : (this.apertureSize / 2);
      const outerOffset = 18;
      const innerInset = 6;

      // Direction unit vector
      const ux = Math.cos(theta);
      const uy = Math.sin(theta);

      // Outer point (outside aperture) and inner point (inside aperture)
      const x1 = this.centerX - ux * (apertureR + outerOffset);
      const y1 = this.centerY - uy * (apertureR + outerOffset);
      const x2 = this.centerX - ux * (apertureR - innerInset);
      const y2 = this.centerY - uy * (apertureR - innerInset);

      // Draw arrow line
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Draw arrowhead at x2,y2
      const arrowSize = 8;
      const anglePerp = theta + Math.PI / 2;
      const uperp = Math.cos(anglePerp);
      const vperp = Math.sin(anglePerp);

      const ax = x2 - ux * arrowSize;
      const ay = y2 - uy * arrowSize;

      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(ax + uperp * (arrowSize * 0.5), ay + vperp * (arrowSize * 0.5));
      ctx.lineTo(ax - uperp * (arrowSize * 0.5), ay - vperp * (arrowSize * 0.5));
      ctx.closePath();
      ctx.fill();

      ctx.restore();

      // Clear arrow after rendering (one-shot)
      this.arrowDirectionDeg = null;
      this.arrowColor = null;
    }

    static computeCorrectSide(rdmParams) {
      const p = rdmParams || {};

      // dot-groups: prefer explicit response_target_group
      if ((p.type === 'rdm-dot-groups') || p.group_1_direction !== undefined || p.group_2_direction !== undefined) {
        let group = Number(p.response_target_group);
        if (group !== 1 && group !== 2) {
          const c1 = Number(p.group_1_coherence ?? 0);
          const c2 = Number(p.group_2_coherence ?? 0);
          group = (c1 >= c2) ? 1 : 2;
        }
        const dir = (group === 1) ? Number(p.group_1_direction ?? 0) : Number(p.group_2_direction ?? 180);
        const vx = Math.cos(degToRad(dir));
        return vx >= 0 ? 'right' : 'left';
      }

      const dir = Number(p.direction ?? p.coherent_direction ?? 0);
      const vx = Math.cos(degToRad(dir));
      return vx >= 0 ? 'right' : 'left';
    }
  }

  window.RDMEngine = RDMEngine;
})();
