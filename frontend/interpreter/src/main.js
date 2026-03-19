(function () {
  try {
    window.__COGFLOW_INTERPRETER_VERSION = '20260223-16';
      console.log('[Interpreter] main.js loaded', '20260224-1');
  } catch {
    // ignore
  }

  function getJatosApi() {
    // JATOS' jatos.js defines `const jatos = {}` in the global lexical scope.
    // That does NOT become `window.jatos`, so we must detect it via `typeof jatos`.
    try {
      // eslint-disable-next-line no-undef
      if (typeof jatos !== 'undefined' && jatos) {
        // eslint-disable-next-line no-undef
        return jatos;
      }
    } catch {
      // ignore
    }
    try {
      if (typeof window.jatos !== 'undefined' && window.jatos) return window.jatos;
    } catch {
      // ignore
    }
    try {
      if (window.parent && window.parent !== window && typeof window.parent.jatos !== 'undefined' && window.parent.jatos) return window.parent.jatos;
    } catch {
      // ignore
    }
    try {
      if (window.top && window.top !== window && typeof window.top.jatos !== 'undefined' && window.top.jatos) return window.top.jatos;
    } catch {
      // ignore
    }
    return null;
  }

  const els = {
    jatosStatus: document.getElementById('jatosStatus'),
    statusBox: document.getElementById('statusBox'),
    jspsychTarget: document.getElementById('jspsych-target')
  };

  function getQuickDebugFlag() {
    // We can't rely on getDebugMode() yet (declared later), so do a minimal query check here.
    try {
      const v = new URLSearchParams(window.location.search).get('debug');
      const s = (v === null || v === undefined) ? '' : String(v).trim().toLowerCase();
      return s === '1' || s === 'true' || s === 'yes' || s === 'csv' || s === 'json';
    } catch {
      return false;
    }
  }

  try {
    const p = (window.location && typeof window.location.pathname === 'string') ? window.location.pathname : '';
    if (p.includes('/publix/')) {
      const host = els.jspsychTarget || document.getElementById('jspsych-target');
      if (host && !host.innerHTML && getQuickDebugFlag()) {
        host.innerHTML = '<div style="padding:16px;opacity:0.85;font-family:system-ui;">Initializing interpreter…</div>';
      }
    }
  } catch {
    // ignore
  }

  function getUiThemeFromConfig(config) {
    try {
      const t = config && config.ui_settings && typeof config.ui_settings === 'object' ? config.ui_settings.theme : null;
      const v = (t === null || t === undefined) ? '' : String(t).trim().toLowerCase();
      return v === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  }

  function applyUiTheme(theme) {
    const t = (theme || '').toString().trim().toLowerCase() === 'light' ? 'light' : 'dark';
    try {
      document.documentElement.setAttribute('data-psy-theme', t);
    } catch {
      // ignore
    }
  }

  function wrapPsyScreenHtml(stimulusHtml, promptHtml) {
    const stim = (stimulusHtml === null || stimulusHtml === undefined) ? '' : String(stimulusHtml);
    const prm = (promptHtml === null || promptHtml === undefined) ? '' : String(promptHtml);
    return `
      <div class="psy-wrap">
        <div class="psy-stage">
          <div class="psy-text">
            ${stim}
            ${prm ? `<div class="psy-prompt">${prm}</div>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  function getInlineConfigJson() {
    // Allows running without JATOS API access: paste the full config JSON into the component HTML.
    try {
      if (typeof window !== 'undefined') {
        if (window.COGFLOW_COMPONENT_CONFIG && typeof window.COGFLOW_COMPONENT_CONFIG === 'object') {
          return window.COGFLOW_COMPONENT_CONFIG;
        }
        if (typeof window.COGFLOW_COMPONENT_CONFIG_JSON === 'string' && window.COGFLOW_COMPONENT_CONFIG_JSON.trim()) {
          try {
            return JSON.parse(window.COGFLOW_COMPONENT_CONFIG_JSON);
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }

    try {
      const el = document.getElementById('cogflow_component_config_json');
      if (!el) return null;
      const txt = (el.textContent || '').trim();
      if (!txt) return null;
      return JSON.parse(txt);
    } catch {
      return null;
    }
  }

  function renderBlockingStatus(title, message) {
    try {
      const host = els.jspsychTarget || document.getElementById('jspsych-target') || document.body;
      if (!host) return;
      const t = escapeHtml(String(title || 'Interpreter'));
      const m = escapeHtml(String(message || ''));
      host.innerHTML = wrapPsyScreenHtml(
        `<h2>${t}</h2><div class="psy-muted" style="margin-top: 10px;">${m}</div>`,
        null
      );
    } catch {
      // ignore
    }
  }

  function collectCipAssetUrlsFromTimeline(jsPsychTimeline) {
    const timeline = Array.isArray(jsPsychTimeline) ? jsPsychTimeline : [];
    const urls = new Set();

    const maybeAdd = (raw) => {
      const s = (raw === undefined || raw === null) ? '' : String(raw).trim();
      if (!s) return;
      const lower = s.toLowerCase();
      if (lower === 'none' || lower === 'null' || lower === 'undefined') return;
      // Accept absolute URLs, root-relative paths (e.g. /publix/..), relative paths, and data URLs.
      if (!/^(https?:\/\/|\/|\.?\.\/|data:image\/)/i.test(s)) return;
      urls.add(s);
    };

    for (const t of timeline) {
      const pluginType = (t && t.data && typeof t.data === 'object') ? t.data.plugin_type : null;
      if (pluginType !== 'continuous-image-presentation') continue;
      maybeAdd(t.image_url);
      maybeAdd(t.mask_to_image_sprite_url);
      maybeAdd(t.image_to_mask_sprite_url);

      // Back-compat / alternative key names (defensive)
      maybeAdd(t.stimulus_image_url);
      maybeAdd(t.maskToImageSpriteUrl);
      maybeAdd(t.imageToMaskSpriteUrl);
    }

    return Array.from(urls);
  }

  function preloadImageUrl(url, { timeoutMs = 20000 } = {}) {
    return new Promise((resolve) => {
      const u = (url === undefined || url === null) ? '' : String(url).trim();
      if (!u) return resolve({ ok: false, url: u, reason: 'empty_url' });

      let done = false;
      const finish = (ok, reason) => {
        if (done) return;
        done = true;
        try {
          if (timer) clearTimeout(timer);
        } catch {
          // ignore
        }
        resolve({ ok: !!ok, url: u, reason: reason || null });
      };

      let timer = null;
      try {
        timer = setTimeout(() => finish(false, 'timeout'), Math.max(0, Number(timeoutMs) || 0));
      } catch {
        timer = null;
      }

      try {
        const img = new Image();
        // Prefer anonymous CORS so the plugin can draw into canvas when the server permits it.
        // If the server doesn't send CORS headers, the onerror path will handle it.
        try { img.crossOrigin = 'anonymous'; } catch { /* ignore */ }
        img.onload = () => finish(true, null);
        img.onerror = () => finish(false, 'error');
        img.src = u;
      } catch {
        finish(false, 'exception');
      }
    });
  }

  async function preloadImageUrls(urls, {
    concurrency = 6,
    timeoutMs = 20000,
    onProgress = null
  } = {}) {
    const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
    if (list.length === 0) return { ok: true, total: 0, loaded: 0, failed: 0 };

    const limit = Math.max(1, Math.min(12, Number(concurrency) || 6));
    let idx = 0;
    let loaded = 0;
    let failed = 0;

    const worker = async () => {
      while (true) {
        const i = idx;
        idx += 1;
        if (i >= list.length) return;
        const res = await preloadImageUrl(list[i], { timeoutMs });
        if (res && res.ok) loaded += 1;
        else failed += 1;
        try {
          if (typeof onProgress === 'function') onProgress({ done: loaded + failed, total: list.length, loaded, failed });
        } catch {
          // ignore
        }
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(limit, list.length); i++) workers.push(worker());
    await Promise.all(workers);
    return { ok: failed === 0, total: list.length, loaded, failed };
  }

  function listJatosTokenStoreKeys() {
    const interesting = (k) => {
      const s = (k ?? '').toString().toLowerCase();
      return s.startsWith('config_store_') || s.startsWith('token_store_')
        || s === 'config_store_base_url' || s === 'token_store_base_url'
        || s === 'config_store_configs' || s === 'token_store_configs'
        || s === 'config_store_configs_json' || s === 'token_store_configs_json';
    };

    const out = { urlQuery: [], studySessionData: [], componentProperties: [], componentJsonInput: [] };

    try {
      const qp = getJatosUrlQueryParameters();
      if (qp && typeof qp === 'object') {
        out.urlQuery = Object.keys(qp).filter(interesting).sort();
      }
    } catch {
      // ignore
    }

    try {
      const j = getJatosApi();
      if (j && j.studySessionData && typeof j.studySessionData === 'object') {
        out.studySessionData = Object.keys(j.studySessionData).filter(interesting).sort();
      }
      if (j && j.componentProperties && typeof j.componentProperties === 'object') {
        out.componentProperties = Object.keys(j.componentProperties).filter(interesting).sort();
      }
      const input = j ? j.componentJsonInput : null;
      if (typeof input === 'string' && input.trim()) {
        try {
          const parsed = JSON.parse(input);
          if (parsed && typeof parsed === 'object') {
            out.componentJsonInput = Object.keys(parsed).filter(interesting).sort();
          }
        } catch {
          // ignore
        }
      } else if (input && typeof input === 'object') {
        out.componentJsonInput = Object.keys(input).filter(interesting).sort();
      }
    } catch {
      // ignore
    }

    return out;
  }

  async function submitToJatosAndContinue(dataJson) {
    const j = getJatosApi();
    if (!j || typeof j.submitResultData !== 'function') return false;

    try {
      await j.submitResultData(dataJson);

      // Prefer advancing the study; fall back to ending it.
      if (typeof j.startNextComponent === 'function') {
        j.startNextComponent();
      } else if (typeof j.endStudyAjax === 'function') {
        j.endStudyAjax(true);
      } else if (typeof j.endStudy === 'function') {
        j.endStudy(true);
      }
      return true;
    } catch (e) {
      console.error('JATOS submit failed:', e);
      setStatus(`JATOS submit failed: ${e && e.message ? e.message : String(e)}`);
      renderBlockingStatus('JATOS submit failed', e && e.message ? e.message : String(e));
      return true;
    }
  }

  function sanitizeFilenamePart(x) {
    return String(x || '')
      .replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);
  }

  function buildResultFilename({ configId, code }) {
    const stamp = formatTimestampForFilename(new Date());
    const tag = sanitizeFilenamePart(code || configId || 'run') || 'run';
    return `cogflow-results-${tag}-${stamp}.json`;
  }

  async function tryUploadResultFileToJatos({ filename, jsonText }) {
    const j = getJatosApi();
    if (!j || typeof j.uploadResultFile !== 'function') return { ok: false, reason: 'uploadResultFile_unavailable' };

    const safeName = sanitizeFilenamePart(filename);
    const outName = safeName.toLowerCase().endsWith('.json') ? safeName : `${safeName}.json`;
    const text = (jsonText || '').toString();

    let fileObj = null;
    try {
      fileObj = new File([text], outName, { type: 'application/json' });
    } catch {
      // Older browsers may not support File constructor; Blob should still work with JATOS.
      try {
        const blob = new Blob([text], { type: 'application/json' });
        blob.name = outName;
        fileObj = blob;
      } catch {
        fileObj = null;
      }
    }

    if (!fileObj) return { ok: false, reason: 'file_construct_failed' };

    try {
      // JATOS supports uploadResultFile(file, filename)
      const res = await j.uploadResultFile(fileObj, outName);
      return { ok: true, result: res, filename: outName, size: text.length };
    } catch (e) {
      console.warn('JATOS uploadResultFile failed:', e);
      return { ok: false, reason: e && e.message ? e.message : String(e) };
    }
  }

  function buildResultPayload({ values, config, compiled, configId, code }) {
    const trials = Array.isArray(values) ? values : [];
    const cfgId = (typeof configId === 'string' && configId.trim()) ? configId.trim() : null;
    const taskType = (config && config.task_type) ? String(config.task_type) : (compiled && compiled.taskType ? String(compiled.taskType) : null);
    const experimentType = (config && config.experiment_type)
      ? String(config.experiment_type)
      : (compiled && compiled.experimentType ? String(compiled.experimentType) : null);

    return {
      format: 'cogflow-jatos-result-v1',
      created_at: new Date().toISOString(),
      export_code: (code === undefined || code === null) ? null : String(code),
      config_id: cfgId,
      task_type: taskType,
      experiment_type: experimentType,
      trial_count: trials.length,
      trials
    };
  }

  function buildResultSummary({ payload, uploadedFile }) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const f = uploadedFile && uploadedFile.ok === true ? uploadedFile : null;
    return {
      format: 'cogflow-jatos-result-summary-v1',
      created_at: p.created_at || new Date().toISOString(),
      export_code: p.export_code ?? null,
      config_id: p.config_id ?? null,
      task_type: p.task_type ?? null,
      experiment_type: p.experiment_type ?? null,
      trial_count: p.trial_count ?? null,
      result_file: f ? {
        filename: f.filename || null,
        mime: 'application/json'
      } : null
    };
  }

  function getJatosUrlQueryParameters() {
    try {
      const j = getJatosApi();
      const qp = j && j.urlQueryParameters;
      if (qp && typeof qp === 'object') return qp;
    } catch {
      // ignore
    }
    return null;
  }

  function getJatosParam(name) {
    const key = (name ?? '').toString();
    if (!key) return null;

    try {
      const qp = getJatosUrlQueryParameters();
      if (qp && Object.prototype.hasOwnProperty.call(qp, key)) {
        const v = qp[key];
        return (v === undefined || v === null) ? null : String(v);
      }
    } catch {
      // ignore
    }

    try {
      const j = getJatosApi();
      if (!j) return null;

      const readFromObj = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        if (!Object.prototype.hasOwnProperty.call(obj, key)) return null;
        const v = obj[key];
        return (v === undefined || v === null) ? null : String(v);
      };

      // Persisted per-study-run values.
      const fromSession = readFromObj(j.studySessionData);
      if (fromSession != null) return fromSession;

      // Configured per component in the JATOS GUI.
      const fromProps = readFromObj(j.componentProperties);
      if (fromProps != null) return fromProps;

      // JSON input can be a string or an object.
      const input = j.componentJsonInput;
      if (typeof input === 'string' && input.trim()) {
        try {
          const parsed = JSON.parse(input);
          const fromInput = readFromObj(parsed);
          if (fromInput != null) return fromInput;
        } catch {
          // ignore
        }
      } else if (input && typeof input === 'object') {
        const fromInput = readFromObj(input);
        if (fromInput != null) return fromInput;
      }
    } catch {
      // ignore
    }

    return null;
  }

  function getJatosParamRaw(name) {
    const key = (name ?? '').toString();
    if (!key) return null;

    try {
      const qp = getJatosUrlQueryParameters();
      if (qp && Object.prototype.hasOwnProperty.call(qp, key)) {
        const v = qp[key];
        return (v === undefined || v === null) ? null : v;
      }
    } catch {
      // ignore
    }

    try {
      const j = getJatosApi();
      if (!j) return null;

      const readFromObj = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        if (!Object.prototype.hasOwnProperty.call(obj, key)) return null;
        const v = obj[key];
        return (v === undefined || v === null) ? null : v;
      };

      const fromSession = readFromObj(j.studySessionData);
      if (fromSession != null) return fromSession;

      const fromProps = readFromObj(j.componentProperties);
      if (fromProps != null) return fromProps;

      const input = j.componentJsonInput;
      if (typeof input === 'string' && input.trim()) {
        try {
          const parsed = JSON.parse(input);
          const fromInput = readFromObj(parsed);
          if (fromInput != null) return fromInput;
        } catch {
          // ignore
        }
      } else if (input && typeof input === 'object') {
        const fromInput = readFromObj(input);
        if (fromInput != null) return fromInput;
      }
    } catch {
      // ignore
    }

    return null;
  }

  function getQueryParam(name) {
    const key = (name ?? '').toString();
    if (!key) return null;

    // Prefer JATOS sources (works even when URL params are stripped by redirects).
    try {
      const v = getJatosParam(key);
      if (v != null) return v;
    } catch {
      // ignore
    }

    // Fallback: normal URL query string.
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has(key)) return params.get(key);
    } catch {
      // ignore
    }

    // Fallback: hash query (e.g. #/route?foo=bar)
    try {
      const h = (window.location && typeof window.location.hash === 'string') ? window.location.hash : '';
      const idx = h.indexOf('?');
      if (idx >= 0) {
        const params = new URLSearchParams(h.slice(idx + 1));
        if (params.has(key)) return params.get(key);
      }
    } catch {
      // ignore
    }

    return null;
  }

  function getDebugMode() {
    try {
      const v = (getQueryParam('debug') || '').toString().trim().toLowerCase();
      return v === '1' || v === 'true' || v === 'yes' || v === 'csv' || v === 'json';
    } catch {
      return false;
    }
  }

  function getDebugFormat() {
    try {
      const v = (getQueryParam('debug') || '').toString().trim().toLowerCase();
      if (v === 'csv') return 'csv';
      if (v === 'json' || v === '1' || v === 'true' || v === 'yes') return 'json';
      // Default to JSON when debug is enabled (best for nested fields like events[]).
      return 'json';
    } catch {
      return 'json';
    }
  }

  function getValidateMode() {
    try {
      const v = (getQueryParam('validate') || '').toString().trim().toLowerCase();
      if (!v) return false;
      if (v === 'only') return 'only';
      return v === '1' || v === 'true' || v === 'yes' ? true : false;
    } catch {
      return false;
    }
  }

  function formatNum(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return x;
    return Number(n.toFixed(6));
  }

  function runAdaptiveValidation(timeline) {
    const tl = Array.isArray(timeline) ? timeline : [];

    const rows = [];
    let adaptiveIndex = 0;

    for (let i = 0; i < tl.length; i++) {
      const t = tl[i];
      if (!t || typeof t !== 'object') continue;
      if (typeof t.on_start !== 'function' || typeof t.on_finish !== 'function') continue;

      try {
        // jsPsych passes the trial object into on_start.
        t.on_start(t);
      } catch (e) {
        console.warn('Adaptive validate: on_start failed for index', i, e);
      }

      // Alternate correctness to force staircase updates.
      const isCorrect = adaptiveIndex % 2 === 0;
      adaptiveIndex++;

      const data = { correctness: isCorrect };
      try {
        t.on_finish(data);
      } catch (e) {
        console.warn('Adaptive validate: on_finish failed for index', i, e);
      }

      rows.push({
        index: i,
        plugin_type: (t.data && typeof t.data === 'object') ? t.data.plugin_type : null,
        adaptive_mode: data.adaptive_mode,
        adaptive_parameter: data.adaptive_parameter,
        adaptive_value: formatNum(data.adaptive_value),
        correctness: data.correctness
      });
    }

    console.groupCollapsed(`[Interpreter] Adaptive validate: ${rows.length} adaptive trial(s)`);
    if (rows.length) {
      try {
        console.table(rows.slice(0, 30));
      } catch {
        console.log(rows.slice(0, 30));
      }

      const byKey = new Map();
      for (const r of rows) {
        const k = `${r.plugin_type}::${r.adaptive_mode}::${r.adaptive_parameter}`;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(r.adaptive_value);
      }

      let ok = true;
      for (const [k, vals] of byKey.entries()) {
        const uniq = new Set(vals.map((v) => String(v))).size;
        if (uniq <= 1) {
          ok = false;
          console.warn('Adaptive validate WARNING: values did not change for', k, '(unique=', uniq, ')');
        } else {
          console.log('Adaptive validate OK:', k, 'unique=', uniq);
        }
      }

      if (ok) console.log('Adaptive validate PASS');
      else console.warn('Adaptive validate had warnings (see above)');
    }

    // Quick Gabor parameter check (helps catch unit mistakes).
    const firstGabor = tl.find((t) => t && t.data && typeof t.data === 'object' && t.data.plugin_type === 'gabor');
    if (firstGabor) {
      console.log('Gabor param check:', {
        spatial_frequency_cyc_per_px: formatNum(firstGabor.spatial_frequency_cyc_per_px),
        grating_waveform: firstGabor.grating_waveform
      });
    }

    console.groupEnd();
  }

  function validateTimelinePlugins(timeline, label) {
    const problems = [];
    const unwrapped = [];

    const walk = (maybeTimeline, path) => {
      const tl = Array.isArray(maybeTimeline) ? maybeTimeline : [];
      for (let i = 0; i < tl.length; i++) {
        const node = tl[i];
        if (!node || typeof node !== 'object') continue;

        const nodePath = path ? `${path}[${i}]` : `[${i}]`;

        // jsPsych timeline nodes can be wrappers like:
        // { timeline: [...], conditional_function, loop_function, repetitions, ... }
        // These nodes are valid even without a `type`. Validate their children instead.
        if (Array.isArray(node.timeline)) {
          walk(node.timeline, `${nodePath}.timeline`);
        }

        // Only validate nodes that explicitly declare a plugin `type`.
        // (Wrapper nodes, variable definitions, etc. may omit it.)
        if (!Object.prototype.hasOwnProperty.call(node, 'type')) continue;

        let t = node.type;

        // Some UMD builds expose plugins as { default: PluginClass }.
        if (t && typeof t === 'object' && typeof t.default === 'function') {
          node.type = t.default;
          t = node.type;
          unwrapped.push({ path: nodePath, from: 'object.default', name: t && t.name ? t.name : null });
        }

        // jsPsych's runtime requirement is essentially that `type` is a function/class.
        const ok = typeof t === 'function';
        if (ok) continue;

        problems.push({
          path: nodePath,
          type_kind: typeof t,
          type_value: (typeof t === 'string') ? t : (t === null ? 'null' : (t === undefined ? 'undefined' : (t && t.name ? t.name : 'non-string'))),
          has_info: !!(t && t.info),
          data_plugin_type: (node.data && typeof node.data === 'object') ? node.data.plugin_type : null,
          data_task_type: (node.data && typeof node.data === 'object') ? node.data.task_type : null
        });
      }
    };

    walk(timeline, '');

    if (unwrapped.length > 0) {
      console.groupCollapsed(`[Interpreter] Unwrapped plugin defaults (${label || 'timeline'})`);
      try {
        console.table(unwrapped.slice(0, 50));
      } catch {
        console.log(unwrapped.slice(0, 50));
      }
      console.groupEnd();
    }

    if (problems.length > 0) {
      const first = problems[0];
      console.group(`[Interpreter] Invalid jsPsych trial.type detected (${label || 'timeline'})`);
      try {
        console.table(problems.slice(0, 50));
      } catch {
        console.log(problems.slice(0, 50));
      }

      try {
        // Try to show the offending node (best effort; path may be nested).
        const getByPath = (root, p) => {
          const parts = (p || '').split('.').filter(Boolean);
          let cur = root;
          for (const part of parts) {
            const m = /^(.*)\[(\d+)\]$/.exec(part);
            if (m) {
              const key = m[1];
              const idx = Number(m[2]);
              cur = key ? (cur && cur[key]) : cur;
              cur = Array.isArray(cur) ? cur[idx] : undefined;
              continue;
            }
            cur = cur ? cur[part] : undefined;
          }
          return cur;
        };

        const badNode = getByPath({ timeline: Array.isArray(timeline) ? timeline : [] }, `timeline${first.path || ''}`);
        const safe = JSON.parse(JSON.stringify(badNode, (k, v) => (typeof v === 'function' ? `[Function ${v.name || 'anonymous'}]` : v)));
        console.log('Offending node (safe json):', safe);
      } catch (e) {
        console.log('Failed to serialize offending node:', e);
      }

      console.groupEnd();

      setStatus(`Invalid plugin type at ${first.path || '(unknown path)'} (typeof=${first.type_kind}, value=${String(first.type_value)}). See console for details.`);
      throw new Error(`Invalid jsPsych plugin type in compiled timeline at ${first.path || '(unknown path)'}`);
    }
  }

  function logPluginGlobals() {
    const isPluginFn = (ref) => typeof ref === 'function' || (ref && typeof ref === 'object' && typeof ref.default === 'function');
    const getInfo = (ref) => {
      const r = (ref && typeof ref === 'object' && typeof ref.default === 'function') ? ref.default : ref;
      return r && r.info && typeof r.info === 'object' ? r.info : null;
    };

    const jsPsychModulePresent = typeof window.jsPsychModule !== 'undefined' && window.jsPsychModule;
    const jsPsychPresent = typeof window.jsPsych !== 'undefined' && window.jsPsych;
    const parameterTypePresent = !!((jsPsychModulePresent && window.jsPsychModule.ParameterType) || (jsPsychPresent && window.jsPsych.ParameterType));

    const scriptPresent = (srcSuffix) => {
      try {
        const scripts = Array.from(document.querySelectorAll('script[src]'));
        return scripts.some((s) => typeof s.src === 'string' && s.src.replace(/\\/g, '/').endsWith(srcSuffix));
      } catch {
        return false;
      }
    };

    const items = [
      ['jsPsychHtmlKeyboardResponse', typeof jsPsychHtmlKeyboardResponse !== 'undefined' ? jsPsychHtmlKeyboardResponse : undefined],
      ['window.jsPsychRdm', window.jsPsychRdm],
      ['window.jsPsychRdmContinuous', window.jsPsychRdmContinuous],
      ['window.jsPsychGabor', window.jsPsychGabor],
      ['window.jsPsychFlanker', window.jsPsychFlanker],
      ['window.jsPsychSart', window.jsPsychSart],
      ['window.jsPsychContinuousImagePresentation', window.jsPsychContinuousImagePresentation],
      ['window.jsPsychSurveyResponse', window.jsPsychSurveyResponse]
    ];

    const rows = items.map(([name, ref]) => ({
      name,
      present: isPluginFn(ref),
      info_name: (() => {
        const info = getInfo(ref);
        return info && typeof info.name === 'string' ? info.name : null;
      })(),
      info_version: (() => {
        const info = getInfo(ref);
        return info && typeof info.version === 'string' ? info.version : null;
      })()
    }));

    console.groupCollapsed('[Interpreter] Plugin globals');
    console.log('jsPsych globals:', {
      has_jsPsychModule: !!jsPsychModulePresent,
      has_jsPsych: !!jsPsychPresent,
      has_ParameterType: parameterTypePresent
    });
    console.log('Script tags present:', {
      'src/rdmEngine.js': scriptPresent('src/rdmEngine.js'),
      'src/jspsych-rdm.js': scriptPresent('src/jspsych-rdm.js'),
      'src/jspsych-rdm-continuous.js': scriptPresent('src/jspsych-rdm-continuous.js')
    });
    try {
      console.table(rows);
    } catch {
      console.log(rows);
    }
    console.groupEnd();
  }

  function formatTimestampForFilename(d) {
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
  }

  function downloadTextFile(text, filename, mimeType) {
    try {
      const blob = new Blob([text], { type: mimeType || 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch (e) {
      console.warn('Failed to download debug data file:', e);
      return false;
    }
  }

  function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (/[\r\n,\"]/g.test(s)) {
      return `"${s.replaceAll('"', '""')}"`;
    }
    return s;
  }

  function rowsToCsv(rows) {
    const dataRows = Array.isArray(rows) ? rows : [];

    const keySet = new Set();
    for (const r of dataRows) {
      if (!r || typeof r !== 'object') continue;
      for (const k of Object.keys(r)) keySet.add(k);
    }

    const preferred = [
      'code',
      'task_type',
      'config_id',
      'plugin_type',
      'trial_type',
      'experiment_type',
      'frame_index',
      'event',
      'ended_reason',
      'response_side',
      'response_key',
      'correct_side',
      'rt_ms',
      'accuracy',
      'correctness'
    ];

    const remaining = Array.from(keySet)
      .filter((k) => !preferred.includes(k))
      .sort((a, b) => a.localeCompare(b));

    const headers = preferred.filter((k) => keySet.has(k)).concat(remaining);

    const lines = [];
    lines.push(headers.map(csvEscape).join(','));

    for (const r of dataRows) {
      const line = headers.map((k) => {
        const v = r && typeof r === 'object' ? r[k] : undefined;
        if (v && typeof v === 'object') {
          try {
            return csvEscape(JSON.stringify(v));
          } catch {
            return csvEscape(String(v));
          }
        }
        return csvEscape(v);
      }).join(',');
      lines.push(line);
    }

    return lines.join('\r\n') + '\r\n';
  }

  function expandJsPsychRowsForCsv(values) {
    const inRows = Array.isArray(values) ? values : [];
    const out = [];

    for (const row of inRows) {
      if (!row || typeof row !== 'object') continue;

      const records = Array.isArray(row.records) ? row.records : null;
      if (!records) {
        out.push(row);
        continue;
      }

      const { records: _omit, ...base } = row;

      // On expanded per-record rows, jsPsych's time_elapsed refers to the END of the parent trial.
      // That looks like a "frozen" timestamp across all records, so preserve it under a clearer name.
      if (Object.prototype.hasOwnProperty.call(base, 'time_elapsed')) {
        base.trial_time_elapsed_end = base.time_elapsed;
        delete base.time_elapsed;
      }

      for (let i = 0; i < records.length; i++) {
        const rec = records[i] && typeof records[i] === 'object' ? records[i] : { value: records[i] };
        const merged = { ...base, ...rec, record_index: i };

        // Reduce nested objects to JSON strings to keep CSV readable.
        if (merged.rdm && typeof merged.rdm === 'object') {
          merged.rdm_json = JSON.stringify(merged.rdm);
          delete merged.rdm;
        }
        if (merged.response && typeof merged.response === 'object') {
          merged.response_json = JSON.stringify(merged.response);
          delete merged.response;
        }

        out.push(merged);
      }
    }

    return out;
  }

  function getJsPsychValues(jsPsych) {
    try {
      if (!jsPsych || !jsPsych.data || typeof jsPsych.data.get !== 'function') return [];
      const vals = jsPsych.data.get().values();
      return Array.isArray(vals) ? vals : [];
    } catch {
      return [];
    }
  }

  function consumeBufferedDrtRows() {
    try {
      const rows = Array.isArray(window.__psy_drt_rows) ? window.__psy_drt_rows.slice() : [];
      window.__psy_drt_rows = [];
      return rows;
    } catch {
      return [];
    }
  }

  function stampExportRow(row, config, compiled, configId) {
    if (!row || typeof row !== 'object') return row;

    try {
      const taskType = (config && config.task_type ? String(config.task_type) : 'task');
      const experimentType = (config && config.experiment_type ? String(config.experiment_type) : (compiled && compiled.experimentType ? String(compiled.experimentType) : 'trial-based'));
      const cfgId = (typeof configId === 'string' && configId.trim()) ? configId.trim() : null;

      // Only add fields if missing to avoid clobbering values.
      if (row.task_type == null) row.task_type = taskType;
      if (row.experiment_type == null) row.experiment_type = experimentType;
      if (row.config_id == null) row.config_id = cfgId;
    } catch {
      // ignore
    }

    return row;
  }

  function tryPersistEyeTrackingToJsPsych(jsPsych, eyePayload) {
    // jsPsych v8 doesn't support writing arbitrary rows via data.write.
    // Some versions expose addToLast on the DataCollection returned by data.get().
    try {
      if (!jsPsych || !jsPsych.data) return { ok: false, reason: 'no_jspsych' };

      if (typeof jsPsych.data.get === 'function') {
        const dc = jsPsych.data.get();
        if (dc && typeof dc.addToLast === 'function') {
          dc.addToLast(eyePayload);
          return { ok: true, method: 'data.get().addToLast' };
        }
      }

      // Older patterns (rare)
      if (typeof jsPsych.data.addToLast === 'function') {
        jsPsych.data.addToLast(eyePayload);
        return { ok: true, method: 'data.addToLast' };
      }

      return { ok: false, reason: 'no_addToLast' };
    } catch (e) {
      return { ok: false, reason: e && e.message ? e.message : String(e) };
    }
  }

  function downloadDebugData(jsPsych, idForName, overrideValues) {
    const stamp = formatTimestampForFilename(new Date());
    const safeId = String(idForName || 'local').trim() || 'local';
    const fmt = getDebugFormat();

    let delayedEyeDownload = null;

    // If eye tracking is enabled and we appended an eye-tracking row (or attached fields to a trial),
    // also export it separately.
    // This keeps the main CSV/JSON intact while providing a clean gaze-only file.
    try {
      const values = Array.isArray(overrideValues) ? overrideValues : getJsPsychValues(jsPsych);
      const eyeRow = Array.isArray(values)
        ? (
          values.find((r) => r && typeof r === 'object' && r.plugin_type === 'eye-tracking' && r.eye_tracking_provider === 'webgazer')
          || values.find((r) => r && typeof r === 'object' && typeof r.eye_tracking_samples_json === 'string')
        )
        : null;

      if (eyeRow && typeof eyeRow.eye_tracking_samples_json === 'string' && eyeRow.eye_tracking_samples_json.trim()) {
        // Keep this resilient: if parsing fails, still save the raw string.
        let parsed = null;
        try {
          parsed = JSON.parse(eyeRow.eye_tracking_samples_json);
        } catch {
          parsed = null;
        }

        const payload = {
          provider: 'webgazer',
          sample_count: Number(eyeRow.eye_tracking_sample_count) || (Array.isArray(parsed) ? parsed.length : null),
          samples: Array.isArray(parsed) ? parsed : null,
          samples_json: Array.isArray(parsed) ? undefined : eyeRow.eye_tracking_samples_json
        };

        delayedEyeDownload = () => downloadTextFile(
          JSON.stringify(payload, null, 2),
          `cogflow-eye-tracking-${safeId}-${stamp}.json`,
          'application/json'
        );
      }
    } catch (e) {
      console.warn('Failed to download eye-tracking debug file:', e);
    }

    if (fmt === 'json') {
      const values = Array.isArray(overrideValues) ? overrideValues : getJsPsychValues(jsPsych);
      const dataJson = JSON.stringify(values, null, 2);
      const ok = downloadTextFile(dataJson, `cogflow-data-${safeId}-${stamp}.json`, 'application/json');
      if (typeof delayedEyeDownload === 'function') setTimeout(delayedEyeDownload, 250);
      return ok;
    }

    // Default: CSV
    // jsPsych's csv() doesn't expand nested arrays (like continuous RDM 'records'),
    // so we expand those into one row per record.
    const values = Array.isArray(overrideValues) ? overrideValues : getJsPsychValues(jsPsych);
    const expanded = expandJsPsychRowsForCsv(values);
    const dataCsv = rowsToCsv(expanded);
    const ok = downloadTextFile(dataCsv, `cogflow-data-${safeId}-${stamp}.csv`, 'text/csv');
    if (typeof delayedEyeDownload === 'function') setTimeout(delayedEyeDownload, 250);
    return ok;
  }

  function renderLocalCompletionScreen(idForName, values, debugWasEnabled) {
    try {
      const host = els.jspsychTarget;
      if (!host) return;

      const safeId = escapeHtml(String(idForName || 'local').trim() || 'local');
      const rows = Array.isArray(values) ? values : [];
      const rowCount = rows.length;

      let socTrialCount = 0;
      let socEventCount = 0;
      for (const r of rows) {
        if (!r || typeof r !== 'object') continue;
        if (r.plugin_type === 'soc-dashboard' && Array.isArray(r.events)) {
          socTrialCount += 1;
          socEventCount += r.events.length;
        }
      }

      const hint = debugWasEnabled
        ? 'If your browser blocked automatic downloads, use the button below to download again.'
        : 'Tip: add <code>&debug=1</code> to auto-download data at the end.';

      host.innerHTML = wrapPsyScreenHtml(
        `
          <h2>Experiment finished</h2>
          <div class="psy-muted" style="margin-bottom: 18px;">Config: <b>${safeId}</b></div>

          <div style="border: 1px solid var(--psy-border); border-radius: 12px; padding: 14px 16px; background: var(--psy-surface);">
            <div><b>Rows:</b> ${rowCount}</div>
            <div><b>SOC trials:</b> ${socTrialCount} • <b>SOC events:</b> ${socEventCount}</div>
          </div>

          <div class="psy-btn-row">
            <button id="dl_debug_data" class="psy-btn psy-btn-primary">Download data (JSON)</button>
            <button id="run_again" class="psy-btn">Run again</button>
          </div>

          <div style="margin-top: 14px; opacity: 0.85;">${hint}</div>
        `,
        null
      );

      const dlBtn = host.querySelector('#dl_debug_data');
      if (dlBtn) {
        dlBtn.addEventListener('click', () => {
          try {
            const params = new URLSearchParams(window.location.search);
            // Force JSON download from this button regardless of debug param.
            params.set('debug', 'json');
            const newUrl = `${window.location.pathname}?${params.toString()}`;
            window.history.replaceState({}, '', newUrl);
          } catch {
            // ignore
          }
          downloadDebugData(null, idForName, rows);
        });
      }

      const runBtn = host.querySelector('#run_again');
      if (runBtn) {
        runBtn.addEventListener('click', () => {
          try {
            window.location.reload();
          } catch {
            // ignore
          }
        });
      }
    } catch (e) {
      console.warn('Failed to render local completion screen:', e);
    }
  }

  function setStatus(msg) {
    try {
      if (els.statusBox) {
        els.statusBox.textContent = msg;
      } else {
        console.log('[Interpreter]', msg);
      }
    } catch {
      // ignore
    }
  }

  // Make silent failures visible (especially in local static hosting).
  try {
    window.addEventListener('error', (e) => {
      const errObj = (e && e.error) ? e.error : null;
      const m = (e && e.message)
        ? e.message
        : ((errObj && errObj.message) ? errObj.message : 'Unknown error');
      const stack = (errObj && errObj.stack) ? String(errObj.stack) : null;
      setStatus(`Runtime error: ${m}`);
      renderBlockingStatus('Runtime error', stack ? `${m}\n\n${stack}` : m);
    });
    window.addEventListener('unhandledrejection', (e) => {
      const r = e && e.reason;
      const m = (r && r.message) ? r.message : String(r || 'Unhandled promise rejection');
      const stack = (r && r.stack) ? String(r.stack) : null;
      setStatus(`Unhandled rejection: ${m}`);
      renderBlockingStatus('Unhandled rejection', stack ? `${m}\n\n${stack}` : m);
    });
  } catch {
    // ignore
  }

  function detectJatos() {
    const ok = !!getJatosApi();
    if (els.jatosStatus) {
      els.jatosStatus.textContent = ok ? 'JATOS: detected' : 'JATOS: not detected (local mode)';
    }
    return ok;
  }

  async function ensureJatosLoaded() {
    const isJatosPresent = () => {
      try {
        return !!getJatosApi();
      } catch {
        return false;
      }
    };

    const isJatosReady = () => {
      try {
        const j = getJatosApi();
        if (!j) return false;
        if (typeof j.onLoad === 'function') return true;
        // Some builds expose the API without onLoad; treat it as ready enough.
        if (j.componentProperties && typeof j.componentProperties === 'object') return true;
        if (j.studySessionData && typeof j.studySessionData === 'object') return true;
        if (j.urlQueryParameters && typeof j.urlQueryParameters === 'object') return true;
        return false;
      } catch {
        return false;
      }
    };

    const probablyPublix = (() => {
      try {
        return typeof window.location?.pathname === 'string' && window.location.pathname.includes('/publix/');
      } catch {
        return false;
      }
    })();

    if (isJatosReady()) return true;

    const waitForJatos = async (ms) => {
      const deadline = Date.now() + Math.max(0, Number(ms) || 0);
      while (Date.now() < deadline) {
        try {
          if (isJatosReady()) return true;
        } catch {
          // ignore
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      try {
        return isJatosReady();
      } catch {
        return false;
      }
    };

    // If JATOS already injected the script tag, don't add another one.
    try {
      const existing = document.querySelector('script[src*="jatos.js"]');
      if (existing) {
        // If a script tag exists (ours or JATOS'), wait a bit for it to execute.
        const ok = await waitForJatos(probablyPublix ? 15000 : 3000);
        return ok;
      }
    } catch {
      // ignore
    }

    // Try to inject JATOS API script (some setups do not auto-inject it into component HTML).
    const tryInject = async (src) => {
      try {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        const loaded = await new Promise((resolve) => {
          script.onload = () => resolve(true);
          script.onerror = () => resolve(false);
          document.head.appendChild(script);
        });
        if (!loaded) return false;
        return await waitForJatos(probablyPublix ? 8000 : 2000);
      } catch {
        return false;
      }
    };

    const injectCandidates = [
      '/assets/javascripts/jatos.js',
      '/jatos.js',
      '/jatos/assets/javascripts/jatos.js',
      '/jatos/jatos.js'
    ];
    for (const src of injectCandidates) {
      if (await tryInject(src)) return true;
      // If the API became present but isn't "ready" by our heuristic yet, keep waiting.
      if (isJatosPresent()) {
        const ok = await waitForJatos(probablyPublix ? 8000 : 1500);
        if (ok) return true;
      }
    }

    // Last resort: wait briefly in case something else injects it.
    return await waitForJatos(probablyPublix ? 8000 : 1500);
  }

  function generateCalibrationPoints(count) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    if (n <= 0) return [];

    const margin = 0.12;
    const pts = [];

    // Common defaults
    if (n === 1) return [{ x: 0.5, y: 0.5 }];
    if (n === 5) {
      return [
        { x: margin, y: margin },
        { x: 1 - margin, y: margin },
        { x: 0.5, y: 0.5 },
        { x: margin, y: 1 - margin },
        { x: 1 - margin, y: 1 - margin }
      ];
    }
    if (n === 9) {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          pts.push({
            x: (margin + (1 - 2 * margin) * c / 2),
            y: (margin + (1 - 2 * margin) * r / 2)
          });
        }
      }
      return pts;
    }

    // Fallback: sample a grid, then take first n points
    const grid = Math.ceil(Math.sqrt(n));
    const denom = Math.max(1, grid - 1);
    for (let r = 0; r < grid; r++) {
      for (let c = 0; c < grid; c++) {
        pts.push({
          x: (margin + (1 - 2 * margin) * c / denom),
          y: (margin + (1 - 2 * margin) * r / denom)
        });
      }
    }
    return pts.slice(0, n);
  }

  function safeRecordWebgazerScreenPosition(x, y) {
    try {
      if (!window.webgazer || typeof window.webgazer.recordScreenPosition !== 'function') return { ok: false, reason: 'recordScreenPosition_missing' };
      try {
        window.webgazer.recordScreenPosition(x, y, 'click');
      } catch {
        window.webgazer.recordScreenPosition(x, y);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e && e.message ? e.message : String(e) };
    }
  }

  function maybeCreateEyeTrackingDebugHud(enabled) {
    if (!enabled) return null;
    if (!getDebugMode()) return null;

    try {
      const hud = document.createElement('div');
      hud.id = 'eye-tracking-debug-hud';
      hud.style.position = 'fixed';
      hud.style.top = '8px';
      hud.style.right = '8px';
      hud.style.zIndex = '99999';
      hud.style.background = 'rgba(0,0,0,0.72)';
      hud.style.color = '#fff';
      hud.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
      hud.style.fontSize = '12px';
      hud.style.padding = '10px 12px';
      hud.style.borderRadius = '8px';
      hud.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
      hud.style.pointerEvents = 'none';
      hud.style.maxWidth = '420px';
      hud.style.whiteSpace = 'pre';
      hud.textContent = 'Eye tracking HUD: initializing...';
      document.body.appendChild(hud);

      const formatBool = (v) => (v ? 'true' : 'false');
      const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const startedAt = now();

      const tick = () => {
        try {
          const mgr = window.EyeTrackingWebGazer;
          const stats = (mgr && typeof mgr.getStats === 'function') ? mgr.getStats() : null;
          const samplesLen = (mgr && typeof mgr.getSamples === 'function' && Array.isArray(mgr.getSamples())) ? mgr.getSamples().length : null;

          const lines = [];
          lines.push('Eye tracking (debug)');
          lines.push(`t=${Math.round(now() - startedAt)}ms`);
          if (!stats) {
            lines.push('stats: unavailable');
          } else {
            lines.push(`active=${formatBool(stats.active)} ready_after_begin=${formatBool(stats.ready_after_begin)}`);
            lines.push(`samples=${samplesLen !== null ? samplesLen : stats.sample_count}`);
            lines.push(`listener_total=${stats.listener_calls_total} null=${stats.listener_calls_null} nonnull=${stats.listener_calls_nonnull}`);
            lines.push(`last_elapsed=${stats.last_listener_elapsed !== null ? Math.round(stats.last_listener_elapsed) : 'null'}`);
            lines.push(`last_nonnull_t=${stats.last_nonnull_t !== null ? Math.round(stats.last_nonnull_t) : 'null'}`);
            lines.push(`src=${stats.begin_src || 'unknown'}`);
          }

          hud.textContent = lines.join('\n');
        } catch {
          // ignore
        }
      };

      tick();
      const intervalId = setInterval(tick, 250);

      return {
        stop: () => {
          try { clearInterval(intervalId); } catch { /* ignore */ }
          try { hud.remove(); } catch { /* ignore */ }
        }
      };
    } catch {
      return null;
    }
  }

  function buildEyeTrackingCalibrationTimeline(eyeCfg, calibrationEvents, dataStamp) {
    const enabled = !!(eyeCfg && eyeCfg.enabled && eyeCfg.calibration_enabled !== false);
    // Be defensive: older cached builds of EyeTrackingWebGazer may not include calibration_points.
    // Default to 9 points unless explicitly set to 0.
    let pointCount = 9;
    try {
      if (eyeCfg && Object.prototype.hasOwnProperty.call(eyeCfg, 'calibration_points')) {
        const v = Number(eyeCfg.calibration_points);
        pointCount = Number.isFinite(v) ? v : 9;
      }
    } catch {
      pointCount = 9;
    }

    const pts = enabled ? generateCalibrationPoints(pointCount) : [];
    if (!pts.length) return [];

    const key = (eyeCfg && typeof eyeCfg.calibration_key === 'string') ? eyeCfg.calibration_key : ' ';
    const keyLabel = (key === ' ') ? 'SPACE' : key;

    const trials = [];
    trials.push({
      type: jsPsychHtmlKeyboardResponse,
      stimulus: wrapPsyScreenHtml(
        `
          <h3>Eye tracking calibration</h3>
          <p>You will see ${pts.length} dot(s). For each dot:</p>
          <ol>
            <li>Look directly at the dot.</li>
            <li>Press <b>${escapeHtml(keyLabel)}</b> while looking at it.</li>
          </ol>
          <p class="psy-muted">This helps WebGazer start producing gaze estimates.</p>
        `,
        `Press <b>${escapeHtml(keyLabel)}</b> to begin calibration.`
      ),
      choices: [key],
      data: { ...(dataStamp || {}), plugin_type: 'eye-tracking-calibration-intro' }
    });

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const px = Math.round(p.x * window.innerWidth);
      const py = Math.round(p.y * window.innerHeight);

      trials.push({
        type: jsPsychHtmlKeyboardResponse,
        stimulus: `<div class="psy-fullscreen">
          <div class="psy-calibration-dot" style="left:${(p.x * 100).toFixed(3)}%;top:${(p.y * 100).toFixed(3)}%;"></div>
          <div class="psy-bottom-hint">Point ${i + 1}/${pts.length} — Look at the dot and press <b>${escapeHtml(keyLabel)}</b></div>
        </div>`,
        choices: [key],
        data: { ...(dataStamp || {}), plugin_type: 'eye-tracking-calibration', calibration_index: i },
        on_finish: () => {
          const res = safeRecordWebgazerScreenPosition(px, py);
          if (Array.isArray(calibrationEvents)) {
            calibrationEvents.push({
              index: i,
              x: px,
              y: py,
              x_norm: p.x,
              y_norm: p.y,
              t: (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(),
              record_result: res
            });
          }
        }
      });
    }

    trials.push({
      type: jsPsychHtmlKeyboardResponse,
      stimulus: wrapPsyScreenHtml(
        `<h3>Calibration complete</h3><p>Calibration data recorded.</p>`,
        'Press any key to continue to the task.'
      ),
      choices: 'ALL_KEYS',
      data: { ...(dataStamp || {}), plugin_type: 'eye-tracking-calibration-complete' }
    });

    return trials;
  }

  function extractCalibrationPrefaceTrials(jsPsychTimeline) {
    const timeline = Array.isArray(jsPsychTimeline) ? jsPsychTimeline : [];
    const preface = [];
    const kept = [];

    for (const t of timeline) {
      const pluginType = (t && t.data && typeof t.data === 'object') ? t.data.plugin_type : null;
      if (pluginType === 'eye-tracking-calibration-instructions') {
        preface.push(t);
      } else {
        kept.push(t);
      }
    }

    return { preface, timeline: kept };
  }

  async function startExperiment(config, configId) {
    const validateMode = getValidateMode();

    // Apply experiment-wide UI theme (from Builder export: ui_settings.theme)
    applyUiTheme(getUiThemeFromConfig(config));

    let compiled = window.TimelineCompiler.compileToJsPsychTimeline(config);

    // If the researcher added a calibration-instructions screen in the Builder,
    // move it to occur before the auto calibration dots.
    let calibrationPrefaceTrials = [];
    try {
      const ex = extractCalibrationPrefaceTrials(compiled.timeline);
      calibrationPrefaceTrials = ex.preface;
      compiled.timeline = ex.timeline;
    } catch {
      calibrationPrefaceTrials = [];
    }

    // Optional: Eye tracking via WebGazer (enabled in Builder data_collection)
    let eyeTrackingEnabled = false;
    let eyeTrackingStartResult = null;
    const eyeTrackingCalibrationEvents = [];
    let eyeTrackingCfg = null;
    try {
      eyeTrackingCfg = (window.EyeTrackingWebGazer && window.EyeTrackingWebGazer.getEyeTrackingConfig)
        ? window.EyeTrackingWebGazer.getEyeTrackingConfig(config)
        : null;
      eyeTrackingEnabled = !!(eyeTrackingCfg && eyeTrackingCfg.enabled);
    } catch {
      eyeTrackingEnabled = false;
      eyeTrackingCfg = null;
    }

    const eyeHud = maybeCreateEyeTrackingDebugHud(eyeTrackingEnabled);

    if (eyeTrackingEnabled) {
      // Insert a short permission prompt so camera access is tied to a user gesture.
      try {
        compiled.timeline = [
          {
            type: jsPsychHtmlKeyboardResponse,
            stimulus: wrapPsyScreenHtml(
              `
                <h3>Eye tracking enabled</h3>
                <p>This study will request access to your camera for gaze estimation (WebGazer).</p>
                <p>If prompted, please allow camera access.</p>
                <p class="psy-muted">Note: camera-based eye tracking typically requires HTTPS or localhost.</p>
              `,
              'Press any key to begin.'
            ),
            choices: 'ALL_KEYS',
            data: { plugin_type: 'eye-tracking-permission' },
            on_finish: async () => {
              // IMPORTANT: start on_finish so it happens right after the keypress (user gesture).
              try {
                if (window.EyeTrackingWebGazer && typeof window.EyeTrackingWebGazer.start === 'function') {
                  eyeTrackingStartResult = await window.EyeTrackingWebGazer.start(config);
                  if (!eyeTrackingStartResult || eyeTrackingStartResult.ok !== true || eyeTrackingStartResult.started !== true) {
                    console.warn('EyeTrackingWebGazer start failed:', eyeTrackingStartResult);
                  }
                } else {
                  eyeTrackingStartResult = { ok: false, started: false, reason: 'EyeTrackingWebGazer_missing' };
                }
              } catch (e) {
                eyeTrackingStartResult = { ok: false, started: false, reason: e && e.message ? e.message : String(e) };
                console.warn('EyeTrackingWebGazer start threw:', e);
              }
            }
          },
          ...(() => {
            // Stamp identifiers (config_id) for consistency.
            const cfgId = (typeof configId === 'string' && configId.trim()) ? configId.trim() : null;
            for (const t of calibrationPrefaceTrials) {
              const baseData = (t && typeof t.data === 'object' && t.data) ? t.data : {};
              t.data = { ...baseData, config_id: cfgId };
            }
            return calibrationPrefaceTrials;
          })(),
          ...buildEyeTrackingCalibrationTimeline(
            eyeTrackingCfg,
            eyeTrackingCalibrationEvents,
            { plugin_type: 'eye-tracking-calibration-meta', config_id: (configId || null) }
          ),
          ...compiled.timeline
        ];
      } catch (e) {
        console.warn('Failed to inject eye-tracking permission trial:', e);
      }
    }

    // Helpful when debugging plugin-load issues.
    logPluginGlobals();
    validateTimelinePlugins(compiled.timeline, configId || 'single');

    if (validateMode) {
      try {
        // IMPORTANT: running adaptive hooks mutates staircase state.
        // Compile a fresh timeline for validation, then recompile for the real run.
        runAdaptiveValidation(compiled.timeline);
      } catch (e) {
        console.warn('Adaptive validate failed:', e);
      }

      if (validateMode === 'only') {
        setStatus('Validation complete (validate=only). Not starting the experiment.');
        return;
      }

      compiled = window.TimelineCompiler.compileToJsPsychTimeline(config);
    }

    // Sanity-check: if config contains CIP blocks but compilation produced zero CIP trials,
    // the study can appear to "end" right after instructions. Surface a clear diagnostic.
    try {
      const pluginCounts = (() => {
        const counts = {};
        for (const t of (Array.isArray(compiled.timeline) ? compiled.timeline : [])) {
          const pt = (t && t.data && typeof t.data === 'object') ? t.data.plugin_type : null;
          const k = pt ? String(pt) : '(missing plugin_type)';
          counts[k] = (counts[k] || 0) + 1;
        }
        return counts;
      })();

      const cipTrialCount = Number(pluginCounts['continuous-image-presentation'] || 0);
      const hasCipBlocks = (() => {
        try {
          const seen = new Set();
          const stack = [config];
          while (stack.length) {
            const cur = stack.pop();
            if (!cur || typeof cur !== 'object') continue;
            if (seen.has(cur)) continue;
            seen.add(cur);
            const t = (cur.block_component_type ?? cur.type ?? '').toString().trim().toLowerCase();
            if (t === 'continuous-image-presentation') return true;
            for (const v of Object.values(cur)) stack.push(v);
          }
        } catch {
          // ignore
        }
        return false;
      })();

      if (hasCipBlocks && cipTrialCount === 0) {
        const diag = {
          config_id: configId || null,
          source_url: (config && typeof config === 'object') ? (config.__source_url ?? null) : null,
          plugin_counts: pluginCounts
        };
        console.error('[Interpreter] CIP compile issue: config contains CIP blocks, but compiled timeline has 0 CIP trials.', diag);

        const msg =
          'Config contains Continuous Image Presentation blocks, but compiled timeline has 0 CIP trials.\n' +
          'Most common cause: the CIP block is missing/empty cip_image_urls because assets were not generated/applied in the Builder before export.\n\n' +
          JSON.stringify(diag, null, 2);

        setStatus('CIP compile issue: 0 CIP trials.');
        renderBlockingStatus('Interpreter error', msg);
        return;
      }
    } catch {
      // ignore
    }

    // Preload CIP assets (images + transition sprites) before starting.
    // This prevents the CIP plugin from falling back to placeholder behavior while assets stream in.
    try {
      const cipUrls = collectCipAssetUrlsFromTimeline(compiled.timeline);
      if (cipUrls.length > 0) {
        renderBlockingStatus('Loading', 'Experiment loading, please wait...');

        let lastTick = 0;
        const res = await preloadImageUrls(cipUrls, {
          concurrency: 6,
          timeoutMs: 25000,
          onProgress: ({ done, total }) => {
            // Avoid over-rendering the splash; update at most a few times per second.
            const now = Date.now();
            if (now - lastTick < 250 && done < total) return;
            lastTick = now;
            renderBlockingStatus('Loading', `Experiment loading, please wait... (${done}/${total})`);
          }
        });

        if (res && res.failed > 0) {
          console.warn('[Interpreter] CIP asset preload had failures:', res);
        }
      }
    } catch (e) {
      console.warn('[Interpreter] CIP asset preload failed (continuing anyway):', e);
    }

    setStatus(`Compiled timeline: ${compiled.timeline.length} items (${compiled.experimentType}). Starting...`);

    const displayEl = els.jspsychTarget || document.getElementById('jspsych-target') || document.body;

    // Clear any bootstrap/loading UI so it can't overlap task presentation.
    try {
      if (displayEl) displayEl.innerHTML = '';
    } catch {
      // ignore
    }

    // Ensure the mount container is actually visible and viewport-sized.
    try {
      displayEl.style.display = 'block';
      displayEl.style.width = '100%';
      displayEl.style.minHeight = '100vh';
      displayEl.style.position = displayEl.style.position || 'relative';
    } catch {
      // ignore
    }

    const jsPsych = initJsPsych({
      display_element: displayEl,
      on_finish: async () => {
        try {
          if (window.DrtEngine && typeof window.DrtEngine.stop === 'function') {
            window.DrtEngine.stop();
          }
        } catch {
          // ignore
        }

        try {
          if (eyeHud && typeof eyeHud.stop === 'function') eyeHud.stop();
        } catch {
          // ignore
        }

        let eyeTrackingExtraRow = null;

        // Stop eye tracking and attach samples before exporting/submitting.
        try {
          if (eyeTrackingEnabled && window.EyeTrackingWebGazer) {
            const stopRes = await window.EyeTrackingWebGazer.stop();
            const samples = window.EyeTrackingWebGazer.getSamples ? window.EyeTrackingWebGazer.getSamples() : [];

            const safeSamples = Array.isArray(samples) ? samples : [];
            const stats = (window.EyeTrackingWebGazer && typeof window.EyeTrackingWebGazer.getStats === 'function')
              ? window.EyeTrackingWebGazer.getStats()
              : null;
            const eyePayload = {
              plugin_type: 'eye-tracking',
              eye_tracking_provider: 'webgazer',
              eye_tracking_enabled: true,
              eye_tracking_started: !!(eyeTrackingStartResult && eyeTrackingStartResult.ok === true && eyeTrackingStartResult.started === true),
              eye_tracking_start_result: eyeTrackingStartResult,
              eye_tracking_stop_result: stopRes,
              eye_tracking_calibration_json: JSON.stringify(Array.isArray(eyeTrackingCalibrationEvents) ? eyeTrackingCalibrationEvents : []),
              eye_tracking_sample_count: safeSamples.length,
              eye_tracking_samples_json: JSON.stringify(safeSamples),
              eye_tracking_stats: stats
            };

            const persisted = tryPersistEyeTrackingToJsPsych(jsPsych, eyePayload);
            if (!persisted || persisted.ok !== true) {
              // Fallback: include it at export time even if we can't mutate jsPsych's store.
              eyeTrackingExtraRow = eyePayload;
              console.warn('Could not persist eye tracking payload (single) (no addToLast); will append at export time');
            }

            // Clear buffer after writing to jsPsych data so memory doesn't linger.
            if (window.EyeTrackingWebGazer.clear) window.EyeTrackingWebGazer.clear();
            if (stopRes && stopRes.ok === false) {
              console.warn('EyeTrackingWebGazer stop returned error:', stopRes);
            }
          }
        } catch (e) {
          console.warn('Eye tracking finalize failed:', e);

          // Even if finalize throws, still write a row so the payload reflects the issue.
          try {
            if (eyeTrackingEnabled && jsPsych && jsPsych.data) {
              const eyePayload = {
                plugin_type: 'eye-tracking',
                eye_tracking_provider: 'webgazer',
                eye_tracking_enabled: true,
                eye_tracking_started: false,
                eye_tracking_start_result: eyeTrackingStartResult,
                eye_tracking_finalize_error: e && e.message ? e.message : String(e),
                eye_tracking_calibration_json: JSON.stringify(Array.isArray(eyeTrackingCalibrationEvents) ? eyeTrackingCalibrationEvents : []),
                eye_tracking_sample_count: 0,
                eye_tracking_samples_json: '[]'
              };

              const persisted = tryPersistEyeTrackingToJsPsych(jsPsych, eyePayload);
              if (!persisted || persisted.ok !== true) {
                eyeTrackingExtraRow = eyePayload;
                console.warn('Could not persist eye tracking error payload (single); will append at export time');
              }
            }
          } catch {
            // ignore
          }
        }

        const baseValues = getJsPsychValues(jsPsych);
        const bufferedDrt = consumeBufferedDrtRows().map((r) => stampExportRow(r, config, compiled, configId));

        let finalValues = baseValues;
        if (bufferedDrt.length) finalValues = finalValues.concat(bufferedDrt);
        if (eyeTrackingExtraRow) finalValues = finalValues.concat([stampExportRow(eyeTrackingExtraRow, config, compiled, configId)]);

        const payload = buildResultPayload({ values: finalValues, config, compiled, configId, code: null });
        const payloadJson = JSON.stringify(payload, null, 2);

        // Prefer uploading a result file so researchers/students don't need to copy/paste large JSON.
        const uploadAttempt = await tryUploadResultFileToJatos({
          filename: buildResultFilename({ configId, code: null }),
          jsonText: payloadJson
        });

        const dataJson = (uploadAttempt && uploadAttempt.ok === true)
          ? JSON.stringify(buildResultSummary({ payload, uploadedFile: uploadAttempt }), null, 2)
          : payloadJson;

        // Day 4: Platform backend (enabled when window.COGFLOW_PLATFORM_URL is set).
        // Feature-flagged: falls through to JATOS path when not configured.
        if (window.DjangoRuntimeBackend && window.DjangoRuntimeBackend.isEnabled()) {
          try {
            const studySlug = (
              (typeof window.COGFLOW_STUDY_SLUG === 'string' && window.COGFLOW_STUDY_SLUG.trim()) ||
              (typeof configId === 'string' && configId.trim()) ||
              'unknown'
            );
            const participantId = (
              (typeof window.COGFLOW_PARTICIPANT_ID === 'string' && window.COGFLOW_PARTICIPANT_ID.trim()) ||
              getQueryParam('code') ||
              null
            );
            await window.DjangoRuntimeBackend.startRun(studySlug, participantId);
            await window.DjangoRuntimeBackend.submitResult(payload);
            renderBlockingStatus('Submitted to Platform', 'Results saved to CogFlow Platform.');
          } catch (e) {
            console.error('[DjangoRuntimeBackend]', e);
            renderBlockingStatus('Platform submit failed', e && e.message ? e.message : String(e));
          }
          return;
        }

        if (await submitToJatosAndContinue(dataJson)) return;

        // Local debug: optionally auto-download the exact payload that would be sent to JATOS.
        if (getDebugMode()) {
          const id = (getQueryParam('id') || 'local').toString().trim() || 'local';
          downloadDebugData(jsPsych, id, finalValues);
        }

        // Only show the local download/completion UI in debug mode.
        if (getDebugMode()) {
          try {
            const id = (getQueryParam('id') || 'local').toString().trim() || 'local';
            renderLocalCompletionScreen(id, finalValues, true);
          } catch {
            // ignore
          }
        } else {
          renderBlockingStatus('Experiment finished', 'Run completed. Add ?debug=1 to download data locally.');
        }

        // Local fallback: dump to console
        console.log('Experiment finished. Data:', jsPsych.data.get().values());
        setStatus('Experiment finished (local mode). Data logged to console.');
      }
    });

    // Make the instance accessible to background helpers (e.g., DRT, eye tracking fallbacks).
    try {
      window.__psy_jsPsych = jsPsych;
    } catch {
      // ignore
    }

    // Ensure core identifiers are present on *every* row (useful for debug CSV/JSON).
    // Multi-config mode already stamps these per trial since they change by config.
    try {
      const taskType = (config && config.task_type ? String(config.task_type) : 'task');
      const experimentType = (config && config.experiment_type ? String(config.experiment_type) : (compiled.experimentType || 'trial-based'));
      const cfgId = (typeof configId === 'string' && configId.trim()) ? configId.trim() : null;
      jsPsych.data.addProperties({
        task_type: taskType,
        experiment_type: experimentType,
        config_id: cfgId
      });
    } catch (e) {
      console.warn('Failed to add global data properties:', e);
    }

    Promise.resolve(jsPsych.run(compiled.timeline)).catch((e) => {
      console.error('jsPsych.run failed:', e);
      setStatus(e && e.message ? e.message : String(e));
    });
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  async function startExperimentFromConfigs(configs, code) {
    const seq = Array.isArray(configs) ? [...configs] : [];
    shuffleInPlace(seq);

    // Apply UI theme from the first config that specifies it (default dark).
    try {
      const firstCfg = seq.map((c) => (c && c.config ? c.config : null)).find((cfg) => !!cfg) || null;
      applyUiTheme(getUiThemeFromConfig(firstCfg));
    } catch {
      applyUiTheme('dark');
    }

    // Optional: Eye tracking via WebGazer (enabled per-config in Builder data_collection)
    let eyeTrackingEnabledAny = false;
    let eyeTrackingStartResult = null;
    const eyeTrackingCalibrationEvents = [];
    let eyeTrackingCfg = null;
    try {
      eyeTrackingEnabledAny = seq.some((c) => {
        const cfg = c && c.config ? c.config : null;
        if (!cfg) return false;
        return !!(window.EyeTrackingWebGazer && window.EyeTrackingWebGazer.getEyeTrackingConfig && window.EyeTrackingWebGazer.getEyeTrackingConfig(cfg).enabled);
      });
    } catch {
      eyeTrackingEnabledAny = false;
    }

    const eyeHud = maybeCreateEyeTrackingDebugHud(eyeTrackingEnabledAny);

    // Compile each config up front so we can:
    // 1) extract a single calibration preface screen (if present), and
    // 2) ensure it occurs before auto-injected calibration dots.
    const compiledSeq = [];
    let calibrationPrefaceTrials = [];

    // Precompute the first config that enabled eye tracking (used for start + calibration settings).
    const firstEnabledCfg = (() => {
      try {
        return seq.map((c) => (c && c.config ? c.config : null)).find((cfg) => {
          try {
            return !!(cfg && window.EyeTrackingWebGazer && window.EyeTrackingWebGazer.getEyeTrackingConfig && window.EyeTrackingWebGazer.getEyeTrackingConfig(cfg).enabled);
          } catch {
            return false;
          }
        }) || null;
      } catch {
        return null;
      }
    })();

    // Compute calibration/settings snapshot now, so the calibration trials can be injected immediately.
    try {
      eyeTrackingCfg = (firstEnabledCfg && window.EyeTrackingWebGazer && window.EyeTrackingWebGazer.getEyeTrackingConfig)
        ? window.EyeTrackingWebGazer.getEyeTrackingConfig(firstEnabledCfg)
        : null;
    } catch {
      eyeTrackingCfg = null;
    }

    for (const c of seq) {
      const cfg = c && c.config ? c.config : null;
      if (!cfg) continue;

      // Allow relative asset resolution during compilation.
      try {
        if (c && c.sourceUrl && !cfg.__source_url) {
          cfg.__source_url = c.sourceUrl;
        }
      } catch {
        // ignore
      }

      const taskType = (cfg.task_type || 'task').toString();
      const compiled = window.TimelineCompiler.compileToJsPsychTimeline(cfg);

      // Remove any calibration-instructions screens from the task timeline; we show it once globally.
      try {
        const ex = extractCalibrationPrefaceTrials(compiled.timeline);
        if (ex.preface && ex.preface.length && calibrationPrefaceTrials.length === 0) {
          calibrationPrefaceTrials = ex.preface;
        }
        compiled.timeline = ex.timeline;
      } catch {
        // ignore
      }

      compiledSeq.push({
        id: c.id || null,
        taskType,
        timeline: compiled.timeline
      });
    }

    const timeline = [];

    if (eyeTrackingEnabledAny) {
      // Insert a short permission prompt so camera access is tied to a user gesture.
      timeline.push({
        type: jsPsychHtmlKeyboardResponse,
        stimulus: wrapPsyScreenHtml(
          `
            <h3>Eye tracking enabled</h3>
            <p>This study will request access to your camera for gaze estimation (WebGazer).</p>
            <p>If prompted, please allow camera access.</p>
            <p class="psy-muted">Note: camera-based eye tracking typically requires HTTPS or localhost.</p>
          `,
          'Press any key to begin.'
        ),
        choices: 'ALL_KEYS',
        data: { plugin_type: 'eye-tracking-permission', code, task_type: null, config_id: null },
        on_finish: async () => {
          // Start on_finish so it happens right after the keypress (user gesture).
          try {
            if (window.EyeTrackingWebGazer && typeof window.EyeTrackingWebGazer.start === 'function') {
              eyeTrackingStartResult = await window.EyeTrackingWebGazer.start(firstEnabledCfg || {});
              if (!eyeTrackingStartResult || eyeTrackingStartResult.ok !== true || eyeTrackingStartResult.started !== true) {
                console.warn('EyeTrackingWebGazer start failed (multi):', eyeTrackingStartResult);
              }
            } else {
              eyeTrackingStartResult = { ok: false, started: false, reason: 'EyeTrackingWebGazer_missing' };
            }
          } catch (e) {
            eyeTrackingStartResult = { ok: false, started: false, reason: e && e.message ? e.message : String(e) };
            console.warn('EyeTrackingWebGazer start threw (multi):', e);
          }
        }
      });

      // If any config included a calibration-instructions screen, insert it here (before calibration dots).
      try {
        for (const t of calibrationPrefaceTrials) {
          const baseData = (t && typeof t.data === 'object' && t.data) ? t.data : {};
          t.data = { ...baseData, code, task_type: null, config_id: null };
          timeline.push(t);
        }
      } catch {
        // ignore
      }

      for (const t of buildEyeTrackingCalibrationTimeline(
        eyeTrackingCfg,
        eyeTrackingCalibrationEvents,
        { plugin_type: 'eye-tracking-calibration-meta', code, task_type: null, config_id: null }
      )) {
        timeline.push(t);
      }
    }

    for (const c of compiledSeq) {
      timeline.push({
        type: jsPsychHtmlKeyboardResponse,
        stimulus: wrapPsyScreenHtml(
          `
            <h3>Next task: ${escapeHtml(c.taskType)}</h3>
            <div class="psy-muted">Code: ${escapeHtml(code)} • Config: ${escapeHtml(c.id || '')}</div>
          `,
          'Press any key to begin.'
        ),
        choices: 'ALL_KEYS',
        data: { plugin_type: 'task-break', code, task_type: c.taskType, config_id: c.id || null }
      });

      for (const t of c.timeline) {
        const baseData = (t && typeof t.data === 'object' && t.data) ? t.data : {};
        t.data = { ...baseData, code, task_type: c.taskType, config_id: c.id || null };
        timeline.push(t);
      }
    }

    // Helpful when debugging plugin-load issues.
    logPluginGlobals();
    validateTimelinePlugins(timeline, code || 'multi');

    setStatus(`Loaded ${seq.length} config(s) for code ${code}. Timeline length: ${timeline.length}. Starting...`);

    const displayEl = els.jspsychTarget || document.getElementById('jspsych-target') || document.body;

    // Clear any bootstrap/loading UI so it can't overlap task presentation.
    try {
      if (displayEl) displayEl.innerHTML = '';
    } catch {
      // ignore
    }

    // Ensure the mount container is actually visible and viewport-sized.
    try {
      displayEl.style.display = 'block';
      displayEl.style.width = '100%';
      displayEl.style.minHeight = '100vh';
      displayEl.style.position = displayEl.style.position || 'relative';
    } catch {
      // ignore
    }

    const jsPsych = initJsPsych({
      display_element: displayEl,
      on_finish: async () => {
        try {
          if (eyeHud && typeof eyeHud.stop === 'function') eyeHud.stop();
        } catch {
          // ignore
        }

        let eyeTrackingExtraRow = null;

        // Multi-config mode: if any config enabled eye tracking, we try to stop and attach samples.
        // (If not started, stop() is a no-op.)
        try {
          if (eyeTrackingEnabledAny && window.EyeTrackingWebGazer && typeof window.EyeTrackingWebGazer.stop === 'function') {
            const stopRes = await window.EyeTrackingWebGazer.stop();
            const samples = window.EyeTrackingWebGazer.getSamples ? window.EyeTrackingWebGazer.getSamples() : [];

            const safeSamples = Array.isArray(samples) ? samples : [];
            const stats = (window.EyeTrackingWebGazer && typeof window.EyeTrackingWebGazer.getStats === 'function')
              ? window.EyeTrackingWebGazer.getStats()
              : null;
            const eyePayload = {
              plugin_type: 'eye-tracking',
              eye_tracking_provider: 'webgazer',
              eye_tracking_enabled: true,
              eye_tracking_started: !!(eyeTrackingStartResult && eyeTrackingStartResult.ok === true && eyeTrackingStartResult.started === true),
              eye_tracking_start_result: eyeTrackingStartResult,
              eye_tracking_stop_result: stopRes,
              eye_tracking_calibration_json: JSON.stringify(Array.isArray(eyeTrackingCalibrationEvents) ? eyeTrackingCalibrationEvents : []),
              eye_tracking_sample_count: safeSamples.length,
              eye_tracking_samples_json: JSON.stringify(safeSamples),
              eye_tracking_stats: stats
            };

            const persisted = tryPersistEyeTrackingToJsPsych(jsPsych, eyePayload);
            if (!persisted || persisted.ok !== true) {
              eyeTrackingExtraRow = eyePayload;
              console.warn('Could not persist eye tracking payload (multi) (no addToLast); will append at export time');
            }

            if (window.EyeTrackingWebGazer.clear) window.EyeTrackingWebGazer.clear();
            if (stopRes && stopRes.ok === false) {
              console.warn('EyeTrackingWebGazer stop returned error (multi):', stopRes);
            }
          } else if (eyeTrackingEnabledAny && jsPsych && jsPsych.data) {
            // Eye tracking enabled but WebGazer manager missing.
            const eyePayload = {
              plugin_type: 'eye-tracking',
              eye_tracking_provider: 'webgazer',
              eye_tracking_enabled: true,
              eye_tracking_started: false,
              eye_tracking_start_result: eyeTrackingStartResult || { ok: false, started: false, reason: 'EyeTrackingWebGazer_missing' },
              eye_tracking_calibration_json: JSON.stringify(Array.isArray(eyeTrackingCalibrationEvents) ? eyeTrackingCalibrationEvents : []),
              eye_tracking_sample_count: 0,
              eye_tracking_samples_json: '[]'
            };

            const persisted = tryPersistEyeTrackingToJsPsych(jsPsych, eyePayload);
            if (!persisted || persisted.ok !== true) {
              eyeTrackingExtraRow = eyePayload;
              console.warn('Could not persist eye tracking payload (multi missing manager); will append at export time');
            }
          }
        } catch (e) {
          console.warn('Eye tracking finalize failed (multi):', e);

          // Still write a row so the payload reflects the issue.
          try {
            if (eyeTrackingEnabledAny && jsPsych && jsPsych.data) {
              const eyePayload = {
                plugin_type: 'eye-tracking',
                eye_tracking_provider: 'webgazer',
                eye_tracking_enabled: true,
                eye_tracking_started: false,
                eye_tracking_start_result: eyeTrackingStartResult,
                eye_tracking_finalize_error: e && e.message ? e.message : String(e),
                eye_tracking_calibration_json: JSON.stringify(Array.isArray(eyeTrackingCalibrationEvents) ? eyeTrackingCalibrationEvents : []),
                eye_tracking_sample_count: 0,
                eye_tracking_samples_json: '[]'
              };

              const persisted = tryPersistEyeTrackingToJsPsych(jsPsych, eyePayload);
              if (!persisted || persisted.ok !== true) {
                eyeTrackingExtraRow = eyePayload;
                console.warn('Could not persist eye tracking error payload (multi); will append at export time');
              }
            }
          } catch {
            // ignore
          }
        }

        // Multi-config mode doesn't have a single canonical {config, compiled, configId}.
        // Trials are already stamped with {code, task_type, config_id} as they are added.
        const baseValues = getJsPsychValues(jsPsych);
        const bufferedDrt = consumeBufferedDrtRows().map((r) => {
          const stamped = stampExportRow(r, null, null, null);
          try {
            if (stamped && typeof stamped === 'object' && stamped.code == null) stamped.code = code;
          } catch {
            // ignore
          }
          return stamped;
        });

        let finalValues = baseValues;
        if (bufferedDrt.length) finalValues = finalValues.concat(bufferedDrt);
        if (eyeTrackingExtraRow) {
          const stampedEye = stampExportRow(eyeTrackingExtraRow, null, null, null);
          try {
            if (stampedEye && typeof stampedEye === 'object' && stampedEye.code == null) stampedEye.code = code;
          } catch {
            // ignore
          }
          finalValues = finalValues.concat([stampedEye]);
        }

        const payload = buildResultPayload({ values: finalValues, config: null, compiled: null, configId: null, code });
        const payloadJson = JSON.stringify(payload, null, 2);

        const uploadAttempt = await tryUploadResultFileToJatos({
          filename: buildResultFilename({ configId: null, code }),
          jsonText: payloadJson
        });

        const dataJson = (uploadAttempt && uploadAttempt.ok === true)
          ? JSON.stringify(buildResultSummary({ payload, uploadedFile: uploadAttempt }), null, 2)
          : payloadJson;

        // Day 4: Platform backend (enabled when window.COGFLOW_PLATFORM_URL is set).
        // Feature-flagged: falls through to JATOS path when not configured.
        if (window.DjangoRuntimeBackend && window.DjangoRuntimeBackend.isEnabled()) {
          try {
            const studySlug = (
              (typeof window.COGFLOW_STUDY_SLUG === 'string' && window.COGFLOW_STUDY_SLUG.trim()) ||
              (typeof code === 'string' && code.trim()) ||
              'unknown'
            );
            const participantId = (
              (typeof window.COGFLOW_PARTICIPANT_ID === 'string' && window.COGFLOW_PARTICIPANT_ID.trim()) ||
              getQueryParam('code') ||
              null
            );
            await window.DjangoRuntimeBackend.startRun(studySlug, participantId);
            await window.DjangoRuntimeBackend.submitResult(payload);
            renderBlockingStatus('Submitted to Platform', 'Results saved to CogFlow Platform.');
          } catch (e) {
            console.error('[DjangoRuntimeBackend]', e);
            renderBlockingStatus('Platform submit failed', e && e.message ? e.message : String(e));
          }
          return;
        }

        if (await submitToJatosAndContinue(dataJson)) return;

        if (getDebugMode()) {
          downloadDebugData(jsPsych, String(code || 'multi'), finalValues);
        }

        // Only show the local download/completion UI in debug mode.
        if (getDebugMode()) {
          try {
            renderLocalCompletionScreen(String(code || 'multi'), finalValues, true);
          } catch {
            // ignore
          }
        } else {
          renderBlockingStatus('Experiment finished', 'Run completed. Add ?debug=1 to download data locally.');
        }

        console.log('Experiment finished. Data:', jsPsych.data.get().values());
        setStatus('Experiment finished (local mode). Data logged to console.');
      }
    });

    Promise.resolve(jsPsych.run(timeline)).catch((e) => {
      console.error('jsPsych.run failed:', e);
      setStatus(e && e.message ? e.message : String(e));
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function bootstrap() {
    if (bootstrap.__didRun) return;
    bootstrap.__didRun = true;
    try {
      console.log('[Interpreter] bootstrap starting');
    } catch {
      // ignore
    }

    try {
      const host = els.jspsychTarget || document.getElementById('jspsych-target');
      if (!host) {
        // ignore
      } else if (getDebugMode() && (!host.innerHTML || /Initializing interpreter/i.test(host.textContent || ''))) {
        host.innerHTML = '<div style="padding:16px;opacity:0.85;font-family:system-ui;">Bootstrap started…</div>';
      } else if (!getDebugMode() && /^(\s*(Initializing interpreter|Bootstrap started)\b)/i.test((host.textContent || '').trim())) {
        // If a cached build left some boot text around, wipe it for non-debug runs.
        host.innerHTML = '';
      }
    } catch {
      // ignore
    }

    detectJatos();

    const inJatos = (() => {
      try { return !!getJatosApi(); } catch { return false; }
    })();

    const disableLegacyIdMechanism = (() => {
      // Default: disable URL-param id in JATOS/publix runs (opt-in only).
      try {
        if (typeof window !== 'undefined' && window.COGFLOW_DISABLE_URL_ID === true) return true;
      } catch {
        // ignore
      }
      try {
        // If JATOS API is available, allow overriding via component properties.
        const v = (getJatosParam('disable_url_id') || '').toString().trim().toLowerCase();
        if (v === '1' || v === 'true' || v === 'yes') return true;
        if (v === '0' || v === 'false' || v === 'no') return false;
      } catch {
        // ignore
      }
      try {
        const p = (window.location && typeof window.location.pathname === 'string') ? window.location.pathname : '';
        if (p.includes('/publix/')) return true;
      } catch {
        // ignore
      }
      return false;
    })();

    async function maybeLoadInlineConfig() {
      const cfg = getInlineConfigJson();
      if (!cfg || typeof cfg !== 'object') return false;
      try {
        cfg.__source_url = 'inline:component';
      } catch {
        // ignore
      }
      setStatus('Loaded inline config from component HTML. Starting...');
      renderBlockingStatus('Starting', 'Loaded inline config from component HTML. Starting...');
      await startExperiment(cfg, 'inline');
      return true;
    }

    async function maybeLoadConfigFromTokenStore() {
      if (!inJatos) return false;

      const pickFirst = (...vals) => {
        for (const v of vals) {
          const s = (v === null || v === undefined) ? '' : String(v).trim();
          if (s) return s;
        }
        return '';
      };

      const normalizeTokenStoreBaseUrl = (raw) => {
        let s = (raw === null || raw === undefined) ? '' : String(raw).trim();
        s = s.replace(/\/+$/, '');

        // Common copy/paste mistakes: people paste the API path or a specific config URL.
        // Normalize these back to the worker base.
        const m = /^(https?:\/\/[^?#]+?)\/v1\/configs\/[^/]+$/i.exec(s);
        if (m) return m[1];
        s = s.replace(/\/v1\/configs$/i, '');
        s = s.replace(/\/v1$/i, '');
        s = s.replace(/\/+$/, '');
        return s;
      };

      const baseUrlRaw = pickFirst(
        getJatosParam('config_store_base_url'),
        getJatosParam('token_store_base_url'),
        getJatosParam('config_store_url'),
        getJatosParam('token_store_url'),
        (typeof window !== 'undefined' && typeof window.COGFLOW_TOKEN_STORE_BASE_URL === 'string') ? window.COGFLOW_TOKEN_STORE_BASE_URL : ''
      );

      const baseUrl = normalizeTokenStoreBaseUrl(baseUrlRaw);

      // Optional: multi-config mode (JATOS-first). Accept either:
      // - config_store_configs: array/object in Component Properties, OR
      // - config_store_configs_json: JSON string
      const multiConfigsVal = (() => {
        try {
          const raw = getJatosParamRaw('config_store_configs');
          if (raw != null) return raw;
        } catch {
          // ignore
        }
        try {
          const raw = getJatosParamRaw('token_store_configs');
          if (raw != null) return raw;
        } catch {
          // ignore
        }

        const txt = pickFirst(
          getJatosParam('config_store_configs_json'),
          getJatosParam('token_store_configs_json')
        );
        return txt || null;
      })();

      const configId = pickFirst(
        getJatosParam('config_store_config_id'),
        getJatosParam('token_store_config_id'),
        getJatosParam('config_store_id'),
        getJatosParam('token_store_id'),
        (typeof window !== 'undefined' && typeof window.COGFLOW_TOKEN_STORE_CONFIG_ID === 'string') ? window.COGFLOW_TOKEN_STORE_CONFIG_ID : '',
        (typeof window !== 'undefined' && typeof window.COGFLOW_CONFIG_STORE_CONFIG_ID === 'string') ? window.COGFLOW_CONFIG_STORE_CONFIG_ID : ''
      );

      const readToken = pickFirst(
        getJatosParam('config_store_read_token'),
        getJatosParam('token_store_read_token'),
        getJatosParam('config_store_token'),
        getJatosParam('token_store_token'),
        (typeof window !== 'undefined' && typeof window.COGFLOW_TOKEN_STORE_READ_TOKEN === 'string') ? window.COGFLOW_TOKEN_STORE_READ_TOKEN : '',
        (typeof window !== 'undefined' && typeof window.COGFLOW_CONFIG_STORE_READ_TOKEN === 'string') ? window.COGFLOW_CONFIG_STORE_READ_TOKEN : ''
      );

      const exportCode = pickFirst(
        getJatosParam('config_store_code'),
        getJatosParam('token_store_code'),
        getJatosParam('export_code'),
        getJatosParam('code')
      );

      const parseMultiConfigs = (val) => {
        if (!val) return null;
        if (Array.isArray(val)) return val;

        if (typeof val === 'string') {
          const t = val.trim();
          if (!t) return null;
          try {
            const parsed = JSON.parse(t);
            if (Array.isArray(parsed)) return parsed;
            if (parsed && typeof parsed === 'object' && Array.isArray(parsed.configs)) return parsed.configs;
          } catch {
            return null;
          }
          return null;
        }

        if (val && typeof val === 'object') {
          if (Array.isArray(val.configs)) return val.configs;
        }

        return null;
      };

      const multiConfigs = parseMultiConfigs(multiConfigsVal);

      // If multi-config keys are present, handle this path even if single-config fields are missing.
      if (multiConfigs && Array.isArray(multiConfigs) && multiConfigs.length > 0) {
        if (!baseUrl) {
          setStatus('Missing token store base URL in JATOS component properties.');
          renderBlockingStatus('Interpreter setup', 'Missing token store base URL in JATOS component properties.');
          return true;
        }
        if (!/^https?:\/\//i.test(baseUrl) || /^(javascript:|data:|file:)/i.test(baseUrl)) {
          setStatus('Invalid token store base URL in JATOS component properties.');
          renderBlockingStatus('Interpreter setup', 'Invalid token store base URL in JATOS component properties.');
          return true;
        }

        const entries = [];
        for (const item of multiConfigs) {
          if (!item) continue;
          if (typeof item === 'string') {
            const cid = item.trim();
            if (!cid) continue;
            if (!readToken) {
              setStatus('Multi-config mode requires per-config read_token (or a global config_store_read_token).');
              renderBlockingStatus('Interpreter setup', 'Multi-config mode requires per-config read_token (or a global config_store_read_token).');
              return true;
            }
            entries.push({ config_id: cid, read_token: readToken, task_type: null, filename: null });
            continue;
          }
          if (typeof item === 'object') {
            const cid = (item.config_id || item.configId || item.id || '').toString().trim();
            const tok = (item.read_token || item.readToken || item.token || '').toString().trim() || readToken;
            if (!cid || !tok) {
              continue;
            }
            entries.push({
              config_id: cid,
              read_token: tok,
              task_type: (item.task_type || item.taskType || '').toString().trim() || null,
              filename: (item.filename || '').toString().trim() || null
            });
          }
        }

        if (entries.length === 0) {
          setStatus('No valid multi-config entries found in JATOS component properties.');
          renderBlockingStatus('Interpreter setup', 'No valid multi-config entries found in JATOS component properties.');
          return true;
        }

        if (getDebugMode()) {
          setStatus(`Loading ${entries.length} configs from token store...`);
          renderBlockingStatus('Loading', `Loading ${entries.length} configs from token store...`);
        }

        try {
          const out = [];
          for (const e of entries) {
            const url = `${baseUrl}/v1/configs/${encodeURIComponent(e.config_id)}`;
            const res = await fetch(url, {
              method: 'GET',
              cache: 'no-store',
              headers: {
                'Authorization': `Bearer ${e.read_token}`
              }
            });
            if (!res.ok) throw new Error(`Token store fetch failed (${res.status}) at ${url}`);
            const cfg = await res.json();
            try {
              if (cfg && typeof cfg === 'object') cfg.__source_url = url;
            } catch {
              // ignore
            }
            out.push({ id: (e.filename || e.task_type || e.config_id || null), sourceUrl: url, config: cfg });
          }

          await startExperimentFromConfigs(out, exportCode || null);
          return true;
        } catch (e) {
          console.error('Token store multi-config load failed:', e);
          setStatus(`Token store load failed: ${e && e.message ? e.message : String(e)}`);
          renderBlockingStatus('Token store load failed', e && e.message ? e.message : String(e));
          return true;
        }
      }

      if (!baseUrl || !configId || !readToken) {
        try {
          const present = listJatosTokenStoreKeys();
          const msg = {
            hasBaseUrl: !!baseUrl,
            hasConfigId: !!configId,
            hasReadToken: !!readToken,
            keys: present
          };
          console.log('[Interpreter] Token-store settings not found in JATOS. Diagnostics:', msg);
        } catch {
          // ignore
        }
        return false;
      }
      if (!/^https?:\/\//i.test(baseUrl) || /^(javascript:|data:|file:)/i.test(baseUrl)) {
        setStatus('Invalid token store base URL in JATOS component properties.');
        renderBlockingStatus('Interpreter setup', 'Invalid token store base URL in JATOS component properties.');
        return true;
      }

      const url = `${baseUrl}/v1/configs/${encodeURIComponent(configId)}`;
      if (getDebugMode()) {
        setStatus('Loading config from token store...');
        renderBlockingStatus('Loading', 'Loading config from token store...');
      }

      let cfg = null;

      try {
        const res = await fetch(url, {
          method: 'GET',
          cache: 'no-store',
          headers: {
            'Authorization': `Bearer ${readToken}`
          }
        });

        if (!res.ok) {
          throw new Error(`Token store fetch failed (${res.status}) at ${url}`);
        }

        cfg = await res.json();
        try {
          if (cfg && typeof cfg === 'object') {
            cfg.__source_url = url;
          }
        } catch {
          // ignore
        }
      } catch (e) {
        console.error('Token store load failed:', e);
        setStatus(`Token store load failed: ${e && e.message ? e.message : String(e)}`);
        renderBlockingStatus('Token store load failed', e && e.message ? e.message : String(e));
        return true;
      }

      try {
        await startExperiment(cfg, configId);
        return true;
      } catch (e) {
        console.error('Interpreter error after token-store load:', e);
        const msg = e && e.message ? e.message : String(e);
        setStatus(`Interpreter error: ${msg}`);
        renderBlockingStatus('Interpreter error', msg);
        return true;
      }
    }

    // If JATOS component properties include token-store settings, prefer them and skip URL params entirely.
    // This avoids relying on query-string propagation through redirects.
    try {
      const p = maybeLoadConfigFromTokenStore();
      if (p && typeof p.then === 'function') {
        p.then((handled) => {
          if (handled) return;
          // Next preference: inline config embedded in component HTML.
          maybeLoadInlineConfig().then((handledInline) => {
            if (handledInline) return;
            // Optional: legacy URL-param id mechanism.
            if (disableLegacyIdMechanism) {
              setStatus('No config source found. (Legacy ?id disabled)');
              renderBlockingStatus(
                'Interpreter setup',
                'No config source found. Provide token-store settings via JATOS Component Properties (config_store_base_url, config_store_config_id, config_store_read_token) OR embed a full config JSON in this component HTML (id="cogflow_component_config_json").'
              );
              return;
            }
            continueLegacyBootstrap();
          });
        });
        return;
      }
    } catch {
      // ignore
    }

    // Non-promise path: try inline config next.
    try {
      const p2 = maybeLoadInlineConfig();
      if (p2 && typeof p2.then === 'function') {
        p2.then((handledInline) => {
          if (handledInline) return;
          if (disableLegacyIdMechanism) {
            setStatus('No config source found. (Legacy ?id disabled)');
            renderBlockingStatus(
              'Interpreter setup',
              'No config source found. Provide token-store settings via JATOS Component Properties (config_store_base_url, config_store_config_id, config_store_read_token) OR embed a full config JSON in this component HTML (id="cogflow_component_config_json").'
            );
            return;
          }
          continueLegacyBootstrap();
        });
        return;
      }
    } catch {
      // ignore
    }

    function continueLegacyBootstrap() {

    let id = getQueryParam('id');
    // Automation fallback for JATOS: if no ?id survived redirects, use workerId when it matches our code pattern.
    if (!id && inJatos) {
      try {
        const j = getJatosApi();
        const wid = (j && j.workerId) ? String(j.workerId).trim() : '';
        if (/^[A-Za-z0-9]{7}$/.test(wid)) {
          id = wid;
          if (getDebugMode()) {
            console.log('[Interpreter] Using jatos.workerId as id:', wid);
          }
        }
      } catch {
        // ignore
      }
    }
    const baseParam = getQueryParam('base');
    const manifestParam = getQueryParam('manifest');
    const loaderOpts = {
      baseUrl: (typeof window.ConfigLoader.normalizeBaseUrl === 'function')
        ? window.ConfigLoader.normalizeBaseUrl(baseParam, 'configs')
        : (baseParam || 'configs'),
      manifestUrl: manifestParam
    };

    // Helpful for diagnosing JATOS param propagation.
    if (getDebugMode()) {
      try {
        console.groupCollapsed('[Interpreter] Query params diagnostics');
        console.log('location.href:', window.location && window.location.href ? window.location.href : null);
        console.log('location.search:', window.location && window.location.search ? window.location.search : null);
        console.log('location.hash:', window.location && window.location.hash ? window.location.hash : null);
        console.log('jatos.urlQueryParameters:', getJatosUrlQueryParameters());
        console.groupEnd();
      } catch {
        // ignore
      }
    }

    if (id) {
      const trimmed = String(id).trim();
      const looksLikeCode = /^[A-Za-z0-9]{7}$/.test(trimmed);

      if (looksLikeCode && typeof window.ConfigLoader.loadConfigsByCode === 'function') {
        setStatus(`Loading configs for code: ${trimmed} ...`);
        window.ConfigLoader.loadConfigsByCode(trimmed, loaderOpts)
          .then((configs) => {
            // Stamp sourceUrl onto each config (used to resolve relative asset paths).
            try {
              for (const c of (Array.isArray(configs) ? configs : [])) {
                if (c && c.config && c.sourceUrl) {
                  c.config.__source_url = c.sourceUrl;
                }
              }
            } catch {
              // ignore
            }
            return startExperimentFromConfigs(configs, trimmed);
          })
          .catch((e) => {
            console.error(e);
            const msg = e && e.message ? e.message : String(e);
            setStatus(msg);
            renderBlockingStatus('Interpreter error', msg);
          });
        return;
      }

      setStatus(`Loading config: ${id} ...`);
      window.ConfigLoader.loadConfigById(id, loaderOpts)
        .then(({ config, id: loadedId, sourceUrl }) => {
          try {
            if (config && sourceUrl) {
              config.__source_url = sourceUrl;
            }
          } catch {
            // ignore
          }
          return startExperiment(config, loadedId || id);
        })
        .catch((e) => {
          console.error(e);
          const msg = e && e.message ? e.message : String(e);
          setStatus(msg);
          renderBlockingStatus('Interpreter error', msg);
        });
    } else {
      if (inJatos) {
        setStatus('Missing required param: id. Add it to the Study Link (?id=...) or provide a 7-char workerId (Personal Single link) or set it via Component Properties / Component JSON input / Study Session Data.');
        renderBlockingStatus(
          'Interpreter setup',
          disableLegacyIdMechanism
            ? 'No config source found. Legacy ?id is disabled. Set config_store_base_url, config_store_config_id, and config_store_read_token in JATOS Component Properties (or embed config JSON in the component HTML).'
            : 'No config source found. Set config_store_base_url, config_store_config_id, and config_store_read_token in JATOS Component Properties (or provide ?id=... in the Study Link).'
        );
      } else {
        setStatus('Missing required URL param: ?id=...');
        renderBlockingStatus('Interpreter setup', 'Missing required URL param: ?id=...');
      }
    }
    }
  }

  ensureJatosLoaded().then((hasJatos) => {
    try {
      console.log('[Interpreter] ensureJatosLoaded:', hasJatos, {
        hasGlobalJatos: (() => {
          try {
            // eslint-disable-next-line no-undef
            return typeof jatos !== 'undefined' && !!jatos;
          } catch {
            return false;
          }
        })(),
        hasWindowJatos: (() => { try { return typeof window.jatos !== 'undefined' && !!window.jatos; } catch { return false; } })(),
        hasParentJatos: (() => { try { return !!(window.parent && window.parent !== window && window.parent.jatos); } catch { return false; } })(),
        hasTopJatos: (() => { try { return !!(window.top && window.top !== window && window.top.jatos); } catch { return false; } })(),
        hasOnLoad: (() => { try { const j = getJatosApi(); return !!(j && typeof j.onLoad === 'function'); } catch { return false; } })()
      });
    } catch {
      // ignore
    }

    const j = getJatosApi();
    if (hasJatos && j && typeof j.onLoad === 'function') {
      let fired = false;
      try {
        j.onLoad(() => {
          fired = true;
          try { console.log('[Interpreter] jatos.onLoad fired'); } catch { /* ignore */ }
          bootstrap();
        });
      } catch {
        // ignore
      }

      // Safety net: if onLoad never fires, don't stay stuck forever.
      setTimeout(() => {
        if (bootstrap.__didRun) return;
        if (fired) return;
        try { console.warn('[Interpreter] jatos.onLoad did not fire; falling back to direct bootstrap'); } catch { /* ignore */ }
        bootstrap();
      }, 6000);
      return;
    }

    bootstrap();
  });
})();
