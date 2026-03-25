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

  function normalizeNoiseType(raw) {
    const t = (typeof raw === 'string') ? raw.trim().toLowerCase() : '';
    if (t === 'random_position' || t === 'random-position' || t === 'randompos') return 'random_position';
    if (t === 'random_walk' || t === 'random-walk' || t === 'brownian' || t === 'correlated_noise') return 'random_walk';
    return 'random_direction';
  }

  function isGlobalRdmDebugEnabled() {
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
      this.fps = 0;
      this.debugOverlayEnabled = false;
      this._debugFrameReseeds = 0;
      this._debugFrameNoiseJumps = 0;
      this._debugSecReseeds = 0;
      this._debugSecNoiseJumps = 0;
      this._debugAccReseeds = 0;
      this._debugAccNoiseJumps = 0;
      this._debugLastSecTs = 0;

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
      this.noiseType = normalizeNoiseType(p.noise_type);

      const globalDebug = isGlobalRdmDebugEnabled();
      this.debugOverlayEnabled = (p.debug_overlay === true) || globalDebug;

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
        'dot_size'
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
        // Keep motion-definition fields exact per frame for behavioral fidelity.
        // We only interpolate visual/kinematic fields (color/speed), not
        // coherence or direction.
        const g1Coh = bG1Coh;
        const g2Coh = bG2Coh;
        const g1Dir = bG1Dir;
        const g2Dir = bG2Dir;

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
          const dir = d.isCoherent ? Number(d.direction ?? 0) : Number(d.noiseDirection ?? (this.rng() * 360));
          const r = degToRad(dir);
          d.vx = Math.cos(r) * Number(d.speed ?? 0);
          d.vy = Math.sin(r) * Number(d.speed ?? 0);
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
      // Keep coherence/direction exact (no transition blending), so reported
      // and observed motion parameters match compiled frame values.
      const coherence = bCoh;
      const direction = bDir;

      this.params = { ...(this.params || {}), ...(b || {}) };
      this.noiseType = normalizeNoiseType((b.noise_type !== undefined) ? b.noise_type : this.noiseType);

      const nextLifetime = Number.parseInt((b.lifetime_frames !== undefined) ? b.lifetime_frames : this.lifetimeFrames, 10);
      if (Number.isFinite(nextLifetime) && nextLifetime > 0) {
        this.lifetimeFrames = Math.max(1, nextLifetime);
      }

      for (const d of this.dots) {
        d.color = dotColor;
        d.speed = speed;
        d.coherence = coherence;
        d.direction = direction;
        const dir = d.isCoherent ? Number(d.direction ?? 0) : Number(d.noiseDirection ?? (this.rng() * 360));
        const r = degToRad(dir);
        d.vx = Math.cos(r) * Number(d.speed ?? 0);
        d.vy = Math.sin(r) * Number(d.speed ?? 0);
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
      const dot = {
        x: pos.x,
        y: pos.y,
        life: Math.floor(this.rng() * this.lifetimeFrames),
        group: meta.group,
        color: meta.color,
        coherence: meta.coherence,
        direction: meta.direction,
        speed: meta.speed,
        noiseDirection: this.rng() * 360
      };
      this._assignDotMotion(dot);
      return dot;
    }

    _assignDotMotion(dot) {
      dot.isCoherent = this.rng() < clamp(Number(dot.coherence ?? 0.5), 0, 1);
      if (!dot.isCoherent) {
        dot.noiseDirection = this.rng() * 360;
      }
      const dir = dot.isCoherent ? Number(dot.direction ?? 0) : Number(dot.noiseDirection ?? (this.rng() * 360));
      const r = degToRad(dir);
      dot.vx = Math.cos(r) * Number(dot.speed ?? 0);
      dot.vy = Math.sin(r) * Number(dot.speed ?? 0);
    }

    _reseedDot(dot) {
      const pos = this._randomInAperture();
      dot.x = pos.x;
      dot.y = pos.y;
      dot.life = 0;
      this._assignDotMotion(dot);
      this._debugFrameReseeds += 1;
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
      let dtMs = 1000 / 60;
      if (this.lastTs > 0) {
        const dt = ts - this.lastTs;
        if (dt > 0) {
          dtMs = dt;
          const instFps = 1000 / dt;
          this.fps = this.fps > 0 ? (this.fps * 0.85 + instFps * 0.15) : instFps;
        }
      }

      if (!this._debugLastSecTs) {
        this._debugLastSecTs = ts;
      }
      this.lastTs = ts;
      this.step(dtMs);

      // Accumulate after step() so the current frame's counters are included.
      this._debugAccReseeds += this._debugFrameReseeds;
      this._debugAccNoiseJumps += this._debugFrameNoiseJumps;
      if (ts - this._debugLastSecTs >= 1000) {
        this._debugSecReseeds = this._debugAccReseeds;
        this._debugSecNoiseJumps = this._debugAccNoiseJumps;
        this._debugAccReseeds = 0;
        this._debugAccNoiseJumps = 0;
        this._debugLastSecTs = ts;
      }

      this.render();
      this.raf = requestAnimationFrame(this._tick);
    }

    step(dtMs) {
      this._debugFrameReseeds = 0;
      this._debugFrameNoiseJumps = 0;
      const dt = Number.isFinite(Number(dtMs)) && Number(dtMs) > 0 ? Number(dtMs) : (1000 / 60);
      const lifeStep = dt / (1000 / 60);

      for (let i = 0; i < this.dots.length; i++) {
        const d = this.dots[i];
        d.life += lifeStep;
        if (d.life >= this.lifetimeFrames) {
          this._reseedDot(d);
          continue;
        }

        if (!d.isCoherent && this.noiseType === 'random_position') {
          const pos = this._randomInAperture();
          d.x = pos.x;
          d.y = pos.y;
          this._debugFrameNoiseJumps += 1;
          continue;
        }

        if (!d.isCoherent && this.noiseType === 'random_walk') {
          d.noiseDirection = this.rng() * 360;
          const r = degToRad(d.noiseDirection);
          d.vx = Math.cos(r) * Number(d.speed ?? 0);
          d.vy = Math.sin(r) * Number(d.speed ?? 0);
        }

        d.x += d.vx;
        d.y += d.vy;

        // Wrap inside aperture
        if (this.apertureShape === 'circle') {
          if (!pointInCircle(d.x, d.y, this.centerX, this.centerY, this.apertureRadius)) {
            this._reseedDot(d);
          }
        } else {
          const half = this.apertureSize / 2;
          if (
            d.x < this.centerX - half ||
            d.x > this.centerX + half ||
            d.y < this.centerY - half ||
            d.y > this.centerY + half
          ) {
            this._reseedDot(d);
          }
        }
      }
    }

    _renderDebugOverlay() {
      if (!this.debugOverlayEnabled) return;
      const ctx = this.ctx;

      let coherentDots = 0;
      let speedSum = 0;
      let dirX = 0;
      let dirY = 0;
      for (const d of this.dots) {
        if (d.isCoherent) coherentDots += 1;
        const sp = Number(d.speed ?? 0);
        speedSum += sp;
        const a = degToRad(Number(d.direction ?? 0));
        dirX += Math.cos(a);
        dirY += Math.sin(a);
      }
      const total = Math.max(1, this.dots.length);
      const cohRatio = coherentDots / total;
      const avgSpeed = speedSum / total;
      const meanDir = (Math.atan2(dirY, dirX) * 180) / Math.PI;
      const meanDirNorm = (meanDir + 360) % 360;

      const lines = [
        `RDM DEBUG`,
        `fps=${this.fps.toFixed(1)} dots=${this.dots.length} life=${this.lifetimeFrames}`,
        `noise=${this.noiseType} reseed/s=${this._debugSecReseeds} noise-jump/s=${this._debugSecNoiseJumps}`,
        `coherent=${coherentDots}/${this.dots.length} (${(cohRatio * 100).toFixed(1)}%)`,
        `avgSpeed=${avgSpeed.toFixed(2)} px/frame meanDir=${meanDirNorm.toFixed(1)} deg`
      ];
      if (this.lifetimeFrames <= 10) {
        lines.push('WARNING: low lifetime causes jitter (recommend >= 30)');
      }

      const x = 10;
      const y = 10;
      const lineHeight = 14;
      const pad = 8;

      ctx.save();
      ctx.font = '12px monospace';
      let maxWidth = 0;
      for (const line of lines) {
        const w = ctx.measureText(line).width;
        if (w > maxWidth) maxWidth = w;
      }
      const boxW = maxWidth + pad * 2;
      const boxH = lines.length * lineHeight + pad * 2;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
      ctx.fillRect(x, y, boxW, boxH);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, boxW - 1, boxH - 1);

      ctx.fillStyle = '#d9f0ff';
      let cy = y + pad + 11;
      for (const line of lines) {
        ctx.fillText(line, x + pad, cy);
        cy += lineHeight;
      }
      ctx.restore();
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

      this._renderDebugOverlay();
    }

    setDebugOverlayEnabled(enabled, options) {
      const on = enabled === true;
      const persist = !options || options.persist !== false;
      this.debugOverlayEnabled = on;
      try {
        if (typeof window !== 'undefined') {
          window.COGFLOW_RDM_DEBUG = on;
          if (persist && window.localStorage) {
            window.localStorage.setItem('cogflow_rdm_debug_overlay', on ? '1' : '0');
          }
        }
      } catch {
        // ignore
      }
    }

    getDebugSnapshot() {
      let coherentDots = 0;
      let speedSum = 0;
      let meanDirX = 0;
      let meanDirY = 0;
      for (const d of this.dots) {
        if (d && d.isCoherent === true) coherentDots += 1;
        const sp = Number(d && d.speed);
        if (Number.isFinite(sp)) speedSum += sp;
        const dir = Number(d && d.direction);
        if (Number.isFinite(dir)) {
          const r = degToRad(dir);
          meanDirX += Math.cos(r);
          meanDirY += Math.sin(r);
        }
      }
      const nDots = Math.max(1, this.dots.length);
      const meanDirDeg = ((Math.atan2(meanDirY, meanDirX) * 180) / Math.PI + 360) % 360;
      return {
        fps: this.fps,
        noise_type: this.noiseType,
        lifetime_frames: this.lifetimeFrames,
        total_dots: this.dots.length,
        coherent_dots: coherentDots,
        coherent_ratio: coherentDots / nDots,
        avg_speed: speedSum / nDots,
        mean_direction_deg: meanDirDeg,
        reseeds_per_sec: this._debugSecReseeds,
        noise_jumps_per_sec: this._debugSecNoiseJumps,
        debug_overlay_enabled: this.debugOverlayEnabled === true
      };
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
