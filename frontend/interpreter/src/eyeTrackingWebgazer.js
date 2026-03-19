(function () {
  function isObject(x) {
    return !!x && typeof x === 'object' && !Array.isArray(x);
  }

  async function requestCameraPermissionOnce(camConstraints) {
    try {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        return { ok: false, reason: 'getUserMedia_unavailable', name: 'NotSupportedError', message: 'navigator.mediaDevices.getUserMedia is not available' };
      }

      const stream = await navigator.mediaDevices.getUserMedia(camConstraints || { video: true });
      return { ok: true, stream };
    } catch (e) {
      return {
        ok: false,
        reason: e && e.name ? e.name : (e && e.message ? e.message : String(e)),
        name: e && e.name ? e.name : null,
        message: e && e.message ? e.message : null
      };
    }
  }

  function asEnabledFlag(v) {
    if (v === true) return true;
    if (v === false) return false;
    if (isObject(v) && typeof v.enabled === 'boolean') return v.enabled;
    // If the user provided an object for eye-tracking without an explicit enabled flag,
    // assume they intended to enable it.
    if (isObject(v)) return true;
    return false;
  }

  function getEyeTrackingConfig(config) {
    const c = isObject(config) ? config : {};
    const dc = isObject(c.data_collection) ? c.data_collection : {};

    // Support multiple naming conventions (Builder historically used hyphenated keys).
    const candidates = [
      dc['eye-tracking'],
      dc.eye_tracking,
      dc.eyeTracking,
      c.eye_tracking,
      c.eyeTracking
    ];

    const enabled = candidates.some(asEnabledFlag);

    // Optional settings (keep conservative defaults)
    const settingsRaw = isObject(dc.eye_tracking)
      ? dc.eye_tracking
      : (isObject(dc['eye-tracking'])
        ? dc['eye-tracking']
        : (isObject(c.eye_tracking) ? c.eye_tracking : {}));

    return {
      enabled,
      // Throttle stored samples so payload stays reasonable.
      // Prefer explicit interval; otherwise support Builder-style sample_rate (Hz).
      sample_interval_ms: (() => {
        if (Number.isFinite(Number(settingsRaw.sample_interval_ms))) {
          return Math.max(5, Number(settingsRaw.sample_interval_ms));
        }
        if (Number.isFinite(Number(settingsRaw.sample_rate))) {
          const hz = Math.max(1, Number(settingsRaw.sample_rate));
          return Math.max(5, Math.round(1000 / hz));
        }
        return 33;
      })(),
      // Where to load WebGazer from.
      // - Prefer vendored local copy when available (recommended for reliability in labs / offline / firewall).
      // - Fall back to CDN.
      // Config can override with either:
      //   - webgazer_src: string
      //   - webgazer_srcs: string[]
      webgazer_srcs: (() => {
        if (Array.isArray(settingsRaw.webgazer_srcs) && settingsRaw.webgazer_srcs.length) {
          return settingsRaw.webgazer_srcs.map((s) => String(s || '').trim()).filter(Boolean);
        }

        if (typeof settingsRaw.webgazer_src === 'string' && settingsRaw.webgazer_src.trim()) {
          return [settingsRaw.webgazer_src.trim()];
        }

        return [
          // If you vendor WebGazer, drop it here (or update this path).
          'vendor/webgazer.min.js',
          // CDN fallback (pinned to the same upstream tag as our vendored copy)
          'https://cdn.jsdelivr.net/gh/brownhci/WebGazer@3.4.0/www/webgazer.js'
        ];
      })(),
      // Whether to show the webcam preview box.
      show_video: settingsRaw.show_video === true,

      // Calibration (WebGazer often returns null predictions until trained)
      calibration_enabled: settingsRaw.calibration_enabled !== false,
      calibration_points: Number.isFinite(Number(settingsRaw.calibration_points))
        ? Math.max(0, Math.floor(Number(settingsRaw.calibration_points)))
        : 9,
      calibration_key: (typeof settingsRaw.calibration_key === 'string' && settingsRaw.calibration_key.trim())
        ? settingsRaw.calibration_key
        : ' ',
      // Force a camera permission prompt on a user gesture before calling webgazer.begin().
      // This increases the odds that browsers will actually show the permission prompt.
      force_permission_request: settingsRaw.force_permission_request !== false,
      // Optional constraints to pass to getUserMedia when forcing the prompt.
      cam_constraints: isObject(settingsRaw.cam_constraints) ? settingsRaw.cam_constraints : null
    };
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      if (typeof window.webgazer !== 'undefined' && window.webgazer) {
        resolve(true);
        return;
      }

      const existing = Array.from(document.querySelectorAll('script[src]'))
        .find((s) => typeof s.src === 'string' && s.src === src);
      if (existing) {
        existing.addEventListener('load', () => resolve(true));
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  async function loadScriptWithFallback(srcs) {
    const list = Array.isArray(srcs) ? srcs : [srcs];
    const errors = [];

    for (const src of list) {
      if (typeof window.webgazer !== 'undefined' && window.webgazer) {
        return { ok: true, src: null, errors };
      }

      if (typeof src !== 'string' || !src.trim()) continue;
      try {
        await loadScriptOnce(src.trim());
        if (typeof window.webgazer !== 'undefined' && window.webgazer) {
          return { ok: true, src: src.trim(), errors };
        }
      } catch (e) {
        errors.push({ src: src.trim(), error: e && e.message ? e.message : String(e) });
      }
    }

    return { ok: false, src: null, errors };
  }

  class WebGazerEyeTracker {
    constructor() {
      this._active = false;
      this._samples = [];
      this._lastSampleT = -Infinity;
      this._listener = null;
      this._settings = null;
      this._forcedStream = null;

      this._listener_calls_total = 0;
      this._listener_calls_null = 0;
      this._listener_calls_nonnull = 0;
      this._last_listener_elapsed = null;
      this._last_nonnull_t = null;
      this._ready_after_begin = null;
      this._begin_src = null;
    }

    isActive() {
      return this._active;
    }

    getSamples() {
      return this._samples;
    }

    clear() {
      this._samples = [];
      this._lastSampleT = -Infinity;

      this._listener_calls_total = 0;
      this._listener_calls_null = 0;
      this._listener_calls_nonnull = 0;
      this._last_listener_elapsed = null;
      this._last_nonnull_t = null;
    }

    getStats() {
      return {
        active: this._active,
        sample_count: this._samples.length,
        listener_calls_total: this._listener_calls_total,
        listener_calls_null: this._listener_calls_null,
        listener_calls_nonnull: this._listener_calls_nonnull,
        last_listener_elapsed: this._last_listener_elapsed,
        last_nonnull_t: this._last_nonnull_t,
        ready_after_begin: this._ready_after_begin,
        begin_src: this._begin_src
      };
    }

    async _waitForReady(timeoutMs) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        try {
          if (window.webgazer && typeof window.webgazer.isReady === 'function' && window.webgazer.isReady()) {
            return true;
          }
        } catch {
          // ignore
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    }

    async start(config) {
      const settings = getEyeTrackingConfig(config);
      this._settings = settings;

      if (!settings.enabled) {
        return { ok: true, started: false, reason: 'disabled' };
      }

      // WebGazer uses webcam; most browsers require HTTPS or a secure localhost context.
      // Some setups can report isSecureContext=false even on local dev, so allow common localhost hosts.
      if (!window.isSecureContext) {
        const host = (window.location && window.location.hostname) ? String(window.location.hostname) : '';
        const proto = (window.location && window.location.protocol) ? String(window.location.protocol) : '';
        const localOk = proto === 'http:' && (host === 'localhost' || host === '127.0.0.1' || host === '::1');
        if (!localOk) {
          return { ok: false, started: false, reason: 'insecure_context' };
        }
      }

      const loaded = await loadScriptWithFallback(settings.webgazer_srcs);
      if (!loaded.ok) {
        return { ok: false, started: false, reason: 'webgazer_load_failed', detail: loaded.errors };
      }

      this._begin_src = loaded.src;

      if (typeof window.webgazer === 'undefined' || !window.webgazer) {
        return { ok: false, started: false, reason: 'webgazer_missing' };
      }

      // Avoid stacking multiple listeners.
      if (this._active) {
        return { ok: true, started: true, reason: 'already_active' };
      }

      const interval = settings.sample_interval_ms;

      // Listener signature: (data, elapsedTime)
      this._listener = (data, elapsedTime) => {
        this._listener_calls_total++;
        if (Number.isFinite(Number(elapsedTime))) this._last_listener_elapsed = Number(elapsedTime);
        if (!data) {
          this._listener_calls_null++;
          return;
        }

        this._listener_calls_nonnull++;
        const t = Number.isFinite(Number(elapsedTime)) ? Number(elapsedTime) : Date.now();
        if (t - this._lastSampleT < interval) return;
        this._lastSampleT = t;

        const x = Number(data.x);
        const y = Number(data.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;

        this._samples.push({ t, x, y });
        this._last_nonnull_t = t;
      };

      try {
        // Optional: explicitly request camera permission first.
        // Doing this inside a user gesture (e.g., keypress) improves reliability.
        if (settings.force_permission_request) {
          const constraints = settings.cam_constraints || { video: true };

          // Some browsers intermittently throw AbortError (e.g., device busy / transient failure).
          // Retry once before giving up.
          let permRes = await requestCameraPermissionOnce(constraints);
          if (permRes && permRes.ok === false && permRes.name === 'AbortError') {
            await new Promise((r) => setTimeout(r, 500));
            permRes = await requestCameraPermissionOnce(constraints);
          }

          if (permRes && permRes.ok === false) {
            // If the explicit permission request fails, do NOT necessarily abort eye tracking.
            // WebGazer may still succeed when it calls getUserMedia itself.
            // However, for hard-deny cases, returning early gives a clearer failure.
            const hardDeny = permRes.name === 'NotAllowedError' || permRes.name === 'SecurityError';
            if (hardDeny) {
              this._active = false;
              return { ok: false, started: false, reason: 'camera_permission_failed', detail: permRes };
            }

            console.warn('EyeTrackingWebGazer: forced permission request failed; continuing to webgazer.begin()', permRes);
          }

          // Keep the stream alive and let WebGazer use it, so the camera doesn't flicker off.
          if (permRes && permRes.ok === true && permRes.stream) {
            this._forcedStream = permRes.stream;
            try {
              if (typeof window.webgazer.setStaticVideo === 'function') {
                window.webgazer.setStaticVideo(this._forcedStream);
              }
            } catch {
              // ignore
            }
          }
        }

        // Configure UI
        try {
          window.webgazer.showVideoPreview(!!settings.show_video);
          window.webgazer.showPredictionPoints(false);
          window.webgazer.applyKalmanFilter(true);
        } catch {
          // Some builds may not support all UI toggles.
        }

        window.webgazer.setGazeListener(this._listener);

        // Begin capturing (prompts for camera permission)
        await window.webgazer.begin();

        // Some WebGazer builds use internal mouse listeners to help collect training points.
        // Safe no-op if unavailable.
        try {
          if (typeof window.webgazer.addMouseEventListeners === 'function') {
            window.webgazer.addMouseEventListeners();
          }
        } catch {
          // ignore
        }

        // Give WebGazer a moment to initialize its internal canvases.
        this._ready_after_begin = await this._waitForReady(5000);

        this._active = true;

        return { ok: true, started: true };
      } catch (e) {
        this._active = false;
        return { ok: false, started: false, reason: e && e.message ? e.message : String(e) };
      }
    }

    async stop() {
      if (typeof window.webgazer === 'undefined' || !window.webgazer) {
        this._active = false;
        return { ok: true, stopped: true, reason: 'webgazer_missing' };
      }

      try {
        // Remove listener to stop buffering.
        // IMPORTANT: WebGazer expects mB to remain a function; setting it to null will crash its loop.
        try {
          if (typeof window.webgazer.clearGazeListener === 'function') {
            window.webgazer.clearGazeListener();
          } else if (typeof window.webgazer.setGazeListener === 'function') {
            window.webgazer.setGazeListener(() => {});
          }
        } catch {
          // ignore
        }

        // End webcam stream if supported.
        if (typeof window.webgazer.end === 'function') {
          await window.webgazer.end();
        } else if (typeof window.webgazer.pause === 'function') {
          window.webgazer.pause();
        }

        // If we forced a permission stream, ensure it is stopped.
        if (this._forcedStream) {
          try {
            for (const track of this._forcedStream.getTracks()) track.stop();
          } catch {
            // ignore
          }
          this._forcedStream = null;
        }

        this._active = false;
        return { ok: true, stopped: true };
      } catch (e) {
        // Best-effort: stop forced stream even if WebGazer cleanup fails.
        if (this._forcedStream) {
          try {
            for (const track of this._forcedStream.getTracks()) track.stop();
          } catch {
            // ignore
          }
          this._forcedStream = null;
        }
        this._active = false;
        return { ok: false, stopped: false, reason: e && e.message ? e.message : String(e) };
      }
    }
  }

  // Singleton manager
  const instance = new WebGazerEyeTracker();

  window.EyeTrackingWebGazer = {
    getEyeTrackingConfig,
    start: (config) => instance.start(config),
    stop: () => instance.stop(),
    isActive: () => instance.isActive(),
    getSamples: () => instance.getSamples(),
    getStats: () => instance.getStats(),
    clear: () => instance.clear()
  };
})();
