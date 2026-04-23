(function () {
  function isObject(x) {
    return !!x && typeof x === 'object' && !Array.isArray(x);
  }

  function clamp(x, lo, hi) {
    const n = Number(x);
    if (!Number.isFinite(n)) return lo;
    return Math.max(lo, Math.min(hi, n));
  }

  function logit(p) {
    const pp = clamp(p, 1e-6, 1 - 1e-6);
    return Math.log(pp / (1 - pp));
  }

  function normalPdf(x, mu, sigma) {
    const s = Number(sigma);
    if (!Number.isFinite(s) || s <= 0) return 0;
    const z = (Number(x) - Number(mu)) / s;
    return Math.exp(-0.5 * z * z) / (s * Math.sqrt(2 * Math.PI));
  }

  class QuestStaircase {
    constructor(cfg) {
      const c = isObject(cfg) ? cfg : {};

      this.parameter = (c.parameter || 'coherence').toString();
      this.target = Number.isFinite(Number(c.target_performance)) ? Number(c.target_performance) : 0.82;
      this.beta = Number.isFinite(Number(c.beta)) ? Number(c.beta) : 3.5;
      this.delta = Number.isFinite(Number(c.delta)) ? Number(c.delta) : 0.01;
      this.gamma = Number.isFinite(Number(c.gamma)) ? Number(c.gamma) : 0.5;
      this.minValue = Number.isFinite(Number(c.min_value)) ? Number(c.min_value) : -Infinity;
      this.maxValue = Number.isFinite(Number(c.max_value)) ? Number(c.max_value) : Infinity;

      const startValue = Number.isFinite(Number(c.start_value)) ? Number(c.start_value) : 0;
      const startSd = Number.isFinite(Number(c.start_sd)) ? Math.max(1e-6, Number(c.start_sd)) : 0.2;

      // Discrete posterior over threshold T.
      const span = 5 * startSd;
      const lo = clamp(startValue - span, this.minValue, this.maxValue);
      const hi = clamp(startValue + span, this.minValue, this.maxValue);
      const steps = 200;
      const grid = [];
      const post = [];
      for (let i = 0; i < steps; i++) {
        const t = (steps === 1) ? lo : (lo + (hi - lo) * (i / (steps - 1)));
        grid.push(t);
        post.push(normalPdf(t, startValue, startSd));
      }

      this.grid = grid;
      this.posterior = post;
      this._normalize();

      // Offset from threshold to target performance for our logistic psychometric.
      // p = gamma + (1-gamma-delta) * sigmoid(beta*(x - T))
      const denom = (1 - this.gamma - this.delta);
      const scaled = denom > 1e-6 ? (this.target - this.gamma) / denom : 0.5;
      const safeScaled = clamp(scaled, 1e-6, 1 - 1e-6);
      this.offset = logit(safeScaled) / (Number.isFinite(this.beta) && this.beta !== 0 ? this.beta : 1);

      this.lastX = null;
      this.trialIndex = 0;
    }

    _normalize() {
      const s = this.posterior.reduce((a, b) => a + b, 0);
      if (!(s > 0)) {
        const n = this.posterior.length || 1;
        for (let i = 0; i < this.posterior.length; i++) this.posterior[i] = 1 / n;
        return;
      }
      for (let i = 0; i < this.posterior.length; i++) this.posterior[i] /= s;
    }

    meanThreshold() {
      let m = 0;
      for (let i = 0; i < this.grid.length; i++) {
        m += this.grid[i] * this.posterior[i];
      }
      return m;
    }

    next() {
      const tMean = this.meanThreshold();
      const x = clamp(tMean + this.offset, this.minValue, this.maxValue);
      this.lastX = x;
      this.trialIndex++;
      return x;
    }

    psychometric(x, threshold) {
      const beta = Number.isFinite(this.beta) ? this.beta : 1;
      const z = beta * (Number(x) - Number(threshold));
      const sig = 1 / (1 + Math.exp(-z));
      const p = this.gamma + (1 - this.gamma - this.delta) * sig;
      return clamp(p, 1e-6, 1 - 1e-6);
    }

    update(isCorrect) {
      if (!Number.isFinite(this.lastX)) return;
      const r = isCorrect === true ? 1 : 0;
      const x = this.lastX;

      for (let i = 0; i < this.grid.length; i++) {
        const t = this.grid[i];
        const p = this.psychometric(x, t);
        const like = r ? p : (1 - p);
        this.posterior[i] *= like;
      }
      this._normalize();
    }
  }

  class WeightedUpDownStaircase {
    constructor(cfg) {
      const c = isObject(cfg) ? cfg : {};
      this.parameter = (c.parameter || 'coherence').toString();
      this.mode = (c.mode || 'simple').toString();
      this.target = Number.isFinite(Number(c.target_performance)) ? Number(c.target_performance) : 0.82;
      this.step = Number.isFinite(Number(c.step_size)) ? Math.abs(Number(c.step_size)) : 0.05;
      this.minValue = Number.isFinite(Number(c.min_value)) ? Number(c.min_value) : -Infinity;
      this.maxValue = Number.isFinite(Number(c.max_value)) ? Number(c.max_value) : Infinity;
      this.value = Number.isFinite(Number(c.start_value)) ? Number(c.start_value) : 0;
      this.lastX = null;
      this.trialIndex = 0;
    }

    next() {
      const x = clamp(this.value, this.minValue, this.maxValue);
      this.lastX = x;
      this.trialIndex++;
      return x;
    }

    update(isCorrect) {
      const correct = isCorrect === true;
      if (this.mode === 'staircase') {
        // Weighted step-down to converge near target performance:
        // E[Δ] = p*(-k*step) + (1-p)*(+step) = 0 => k = (1-p)/p
        const p = clamp(this.target, 1e-3, 1 - 1e-3);
        const k = (1 - p) / p;
        if (correct) this.value -= this.step * k;
        else this.value += this.step;
      } else {
        // simple: symmetric 1-up-1-down
        if (correct) this.value -= this.step;
        else this.value += this.step;
      }
      this.value = clamp(this.value, this.minValue, this.maxValue);
    }
  }

  function deepMerge(base, override) {
    const out = isObject(base) ? { ...base } : {};
    if (!isObject(override)) return out;
    for (const [k, v] of Object.entries(override)) {
      if (isObject(v) && isObject(out[k])) out[k] = deepMerge(out[k], v);
      else out[k] = v;
    }
    return out;
  }

  function mulberry32(seedUint32) {
    let a = seedUint32 >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashSeedToUint32(seedStr) {
    let h = 2166136261;
    const s = (seedStr ?? 'default').toString();
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function parseNbackTokenPool(rawPool, stimulusMode) {
    const raw = (rawPool ?? '').toString();
    const parts = raw
      .split(/[\n,]/g)
      .map(s => s.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts;

    const mode = (stimulusMode ?? 'letters').toString().trim().toLowerCase();
    if (mode === 'numbers') return ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    if (mode === 'shapes') return ['●', '■', '▲', '◆', '★', '⬟'];
    if (mode === 'custom') return ['A', 'B', 'C'];
    return ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  }

  function expandNbackTrialSequence(seq, opts) {
    const s = isObject(seq) ? seq : {};

    const nbackDefaults = (opts && isObject(opts.nbackDefaults)) ? opts.nbackDefaults : {};
    const pick = (k, fallback) => {
      if (s[k] !== undefined && s[k] !== null) return s[k];
      if (nbackDefaults && nbackDefaults[k] !== undefined && nbackDefaults[k] !== null) return nbackDefaults[k];
      return fallback;
    };
    const resolveDevice = (raw) => {
      const d = (raw ?? 'inherit').toString().trim().toLowerCase();
      if (!d || d === 'inherit') {
        const def = (nbackDefaults.response_device ?? 'keyboard').toString().trim().toLowerCase();
        return (def === 'mouse' || def === 'keyboard') ? def : 'keyboard';
      }
      return (d === 'mouse' || d === 'keyboard') ? d : 'keyboard';
    };

    const n = Number.isFinite(Number(pick('n', 2))) ? Math.max(1, Math.floor(Number(pick('n', 2)))) : 2;
    const length = Number.isFinite(Number(pick('length', 30))) ? Math.max(1, Math.floor(Number(pick('length', 30)))) : 30;

    const seedStr = (typeof pick('seed', '') === 'string') ? pick('seed', '') : '';
    const seed = hashSeedToUint32(seedStr || 'default');
    const rng = mulberry32(seed);

    const pool = parseNbackTokenPool(pick('stimulus_pool', ''), pick('stimulus_mode', 'letters'));
    const targetProb = clamp(pick('target_probability', 0.25), 0, 1);

    const responseParadigm = (pick('response_paradigm', 'go_nogo') || 'go_nogo').toString().trim().toLowerCase();
    const responseDevice = resolveDevice(pick('response_device', 'inherit'));
    const goKey = (pick('go_key', 'space') || 'space').toString();
    const matchKey = (pick('match_key', 'j') || 'j').toString();
    const nonmatchKey = (pick('nonmatch_key', 'f') || 'f').toString();
    const showButtons = pick('show_buttons', false) === true;

    const renderMode = (pick('render_mode', 'token') || 'token').toString().trim().toLowerCase();
    const templateHtml = (renderMode === 'custom_html') ? (pick('stimulus_template_html', null) ?? null) : null;

    const stimMs = pick('stimulus_duration_ms', undefined);
    const isiMs = pick('isi_duration_ms', undefined);
    const trialMs = pick('trial_duration_ms', undefined);

    const showFeedback = pick('show_feedback', false) === true;
    const feedbackMs = pick('feedback_duration_ms', undefined);

    const showFixationCrossBetweenTrials = pick('show_fixation_cross_between_trials', false) === true;

    const pickFromPool = (avoidToken) => {
      if (!Array.isArray(pool) || pool.length === 0) return 'A';
      if (!avoidToken || pool.length === 1) return pool[Math.floor(rng() * pool.length)];
      let token = pool[Math.floor(rng() * pool.length)];
      let guard = 0;
      while (token === avoidToken && guard < 10) {
        token = pool[Math.floor(rng() * pool.length)];
        guard++;
      }
      return token;
    };

    const tokens = [];
    const isMatch = [];
    for (let i = 0; i < length; i++) {
      if (i >= n && rng() < targetProb) {
        tokens[i] = tokens[i - n];
        isMatch[i] = true;
      } else {
        const avoid = (i >= n) ? tokens[i - n] : null;
        tokens[i] = pickFromPool(avoid);
        isMatch[i] = (i >= n) ? (tokens[i] === tokens[i - n]) : false;
      }
    }

    const out = [];
    for (let i = 0; i < length; i++) {
      const m = isMatch[i] === true;

      const correctResponse = (() => {
        if (responseParadigm === '2afc') {
          const mk = (s.match_key ?? '').toString().trim() ? matchKey : goKey;
          return m ? mk : nonmatchKey;
        }
        return m ? goKey : null;
      })();

      out.push({
        type: 'nback-block',
        n,
        token: tokens[i],
        is_match: m,
        correct_response: correctResponse,

        response_paradigm: responseParadigm,
        response_device: responseDevice,
        go_key: goKey,
        match_key: matchKey,
        nonmatch_key: nonmatchKey,
        show_buttons: showButtons,

        render_mode: renderMode,
        ...(templateHtml !== null && templateHtml !== undefined ? { stimulus_template_html: templateHtml } : {}),
        ...(stimMs !== undefined ? { stimulus_duration_ms: stimMs } : {}),
        ...(isiMs !== undefined ? { isi_duration_ms: isiMs } : {}),
        ...(trialMs !== undefined ? { trial_duration_ms: trialMs } : {}),

        ...(showFeedback ? { show_feedback: true } : {}),
        ...(feedbackMs !== undefined ? { feedback_duration_ms: feedbackMs } : {}),

        ...(showFixationCrossBetweenTrials ? { show_fixation_cross_between_trials: true } : {}),

        _generated_from_nback_sequence: true,
        _sequence_seed: seed,
        _sequence_index: i
      });
    }

    return out;
  }

  function resolveBlockLength(block, opts, fallbackLength) {
    const fallback = Number.isFinite(Number(fallbackLength)) ? Math.max(1, Number.parseInt(fallbackLength, 10)) : 1;
    let length = Math.max(1, Number.parseInt(block?.block_length ?? block?.length ?? fallback, 10) || fallback);

    const sizingMode = (block?.block_sizing_mode ?? block?.sizing_mode ?? '').toString().trim().toLowerCase();
    const experimentType = (opts?.experimentType ?? '').toString().trim().toLowerCase();
    if (experimentType !== 'continuous' || sizingMode !== 'by_duration') {
      return length;
    }

    const frameRate = Number(opts?.frameRate);
    const durationSecRaw = Number(block?.block_duration_seconds ?? block?.duration_seconds);
    if (!Number.isFinite(frameRate) || frameRate <= 0) return length;
    if (!Number.isFinite(durationSecRaw) || durationSecRaw <= 0) return length;

    let durationSec = durationSecRaw;
    const durationCap = Number(opts?.experimentDurationSeconds);
    if (Number.isFinite(durationCap) && durationCap > 0) {
      durationSec = Math.min(durationSec, durationCap);
    }

    length = Math.max(1, Math.round(durationSec * frameRate));
    return length;
  }

  function expandBlock(block, opts) {
    const length = resolveBlockLength(block, opts, 1);
    const baseType = (typeof block.block_component_type === 'string' && block.block_component_type.trim())
      ? block.block_component_type.trim()
      : (typeof block.component_type === 'string' && block.component_type.trim())
        ? block.component_type.trim()
        : 'rdm-trial';

    // N-back: treat Block as the generator (Builder UX).
    // Support legacy `nback-block`, the public alias `nback`, and the older name `nback-trial-sequence`.
    if (baseType === 'nback-block' || baseType === 'nback' || baseType === 'nback-trial-sequence') {
      const src = (block && typeof block === 'object' && block.parameter_values && typeof block.parameter_values === 'object')
        ? { ...block, ...block.parameter_values }
        : (block || {});

      const nbackDefaults = (opts && isObject(opts.nbackDefaults)) ? opts.nbackDefaults : {};
      const pickFromDefaults = (raw, defKey, fallback) => {
        if (raw !== undefined && raw !== null) return raw;
        if (nbackDefaults && nbackDefaults[defKey] !== undefined && nbackDefaults[defKey] !== null) return nbackDefaults[defKey];
        return fallback;
      };
      const resolveDevice = (raw) => {
        const d = (raw ?? 'inherit').toString().trim().toLowerCase();
        if (!d || d === 'inherit') {
          const def = (nbackDefaults.response_device ?? 'keyboard').toString().trim().toLowerCase();
          return (def === 'mouse' || def === 'keyboard') ? def : 'keyboard';
        }
        return (d === 'mouse' || d === 'keyboard') ? d : 'keyboard';
      };

      const renderMode = (pickFromDefaults(src.nback_render_mode, 'render_mode', 'token') ?? 'token').toString().trim().toLowerCase();

      return expandNbackTrialSequence({
        n: pickFromDefaults(src.nback_n, 'n', 2),
        length,
        seed: (pickFromDefaults(src.seed, 'seed', '') ?? '').toString(),
        stimulus_mode: pickFromDefaults(src.nback_stimulus_mode, 'stimulus_mode', 'letters'),
        stimulus_pool: pickFromDefaults(src.nback_stimulus_pool, 'stimulus_pool', ''),
        target_probability: pickFromDefaults(src.nback_target_probability, 'target_probability', 0.25),

        render_mode: renderMode,
        stimulus_template_html: (renderMode === 'custom_html')
          ? pickFromDefaults(src.nback_stimulus_template_html, 'stimulus_template_html', null)
          : null,

        stimulus_duration_ms: pickFromDefaults(src.nback_stimulus_duration_ms, 'stimulus_duration_ms', 500),
        isi_duration_ms: pickFromDefaults(src.nback_isi_duration_ms, 'isi_duration_ms', 700),
        trial_duration_ms: pickFromDefaults(src.nback_trial_duration_ms, 'trial_duration_ms', 1200),

        show_fixation_cross_between_trials: (src.nback_show_fixation_cross_between_trials !== undefined && src.nback_show_fixation_cross_between_trials !== null)
          ? (src.nback_show_fixation_cross_between_trials === true)
          : (nbackDefaults.show_fixation_cross_between_trials === true),

        response_paradigm: pickFromDefaults(src.nback_response_paradigm, 'response_paradigm', 'go_nogo'),
        response_device: resolveDevice(pickFromDefaults(src.nback_response_device, 'response_device', 'inherit')),
        go_key: pickFromDefaults(src.nback_go_key, 'go_key', 'space'),
        match_key: pickFromDefaults(src.nback_match_key, 'match_key', 'j'),
        nonmatch_key: pickFromDefaults(src.nback_nonmatch_key, 'nonmatch_key', 'f'),
        show_buttons: (src.nback_show_buttons !== undefined && src.nback_show_buttons !== null)
          ? src.nback_show_buttons
          : (nbackDefaults.show_buttons ?? false),

        show_feedback: (src.nback_show_feedback !== undefined && src.nback_show_feedback !== null)
          ? src.nback_show_feedback
          : (nbackDefaults.show_feedback ?? false),
        feedback_duration_ms: pickFromDefaults(src.nback_feedback_duration_ms, 'feedback_duration_ms', 250)
      });
    }

    // Clone so we can safely delete block-level-only fields.
    // Builder exports parameter_windows as an array of { parameter, min, max }.
    // Support both object-map and array forms.
    const windows = (() => {
      if (isObject(block.parameter_windows)) return { ...block.parameter_windows };
      if (Array.isArray(block.parameter_windows)) {
        const out = {};
        for (const w of block.parameter_windows) {
          if (!isObject(w)) continue;
          const p = (w.parameter ?? '').toString().trim();
          if (!p) continue;
          out[p] = { min: w.min, max: w.max };
        }
        return out;
      }
      return {};
    })();
    const topLevelValues = (() => {
      if (!isObject(block)) return {};

      const reserved = new Set([
        'id',
        'type',
        'component_type',
        'block_component_type',
        'length',
        'block_length',
        'sizing_mode',
        'block_sizing_mode',
        'duration_seconds',
        'block_duration_seconds',
        'parameter_values',
        'parameter_windows',
        'children',
        'child_timeline',
        'timeline',
        'group',
        'group_id',
        'group_name',
        'pool_mode',
        'repeat',
        'weight',
        'seed'
      ]);

      const out = {};
      for (const [key, value] of Object.entries(block)) {
        if (reserved.has(key)) continue;
        if (key.startsWith('_')) continue;
        out[key] = value;
      }
      return out;
    })();

    const values = {
      ...topLevelValues,
      ...(isObject(block.parameter_values) ? { ...block.parameter_values } : {})
    };

    // Image list helper for image-keyboard-response Blocks.
    // Builder can export a comma/newline-separated string under `stimulus_images`.
    // We convert it into an array and feed it through the existing array-sampling path.
    if (baseType === 'image-keyboard-response') {
      const parseStringList = (raw) => {
        const s = (raw === undefined || raw === null) ? '' : String(raw);
        return s
          .split(/\r?\n|,/g)
          .map(x => x.trim())
          .filter(Boolean);
      };

      if (typeof values.stimulus_images === 'string' && values.stimulus_images.trim() !== '') {
        const list = parseStringList(values.stimulus_images);
        if (list.length > 0) {
          values.stimulus_image = list;
        }
        delete values.stimulus_images;
      }
    }

    // Continuous Image Presentation: treat Block as the generator.
    // Builder stores the resolved URLs directly in block.parameter_values so the interpreter does not
    // need to query the Token Store at runtime.
    if (baseType === 'continuous-image-presentation') {
      const src = (block && typeof block === 'object' && block.parameter_values && typeof block.parameter_values === 'object')
        ? { ...block, ...block.parameter_values }
        : (block || {});

      const parseStringList = (raw) => {
        const s = (raw === undefined || raw === null) ? '' : String(raw);
        return s
          .split(/\r?\n|,/g)
          .map(x => x.trim())
          .filter(Boolean);
      };

      const imageUrls = parseStringList(src.cip_image_urls);
      const filenames = parseStringList(src.cip_asset_filenames);
      const m2iUrls = parseStringList(src.cip_mask_to_image_sprite_urls);
      const i2mUrls = parseStringList(src.cip_image_to_mask_sprite_urls);

      if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
        const diag = {
          block_component_type: (block && typeof block === 'object') ? (block.block_component_type ?? null) : null,
          cip_asset_code: src.cip_asset_code ?? null,
          cip_mask_type: src.cip_mask_type ?? null,
          cip_mask_block_size: src.cip_mask_block_size ?? null,
          cip_mask_noise_amp: src.cip_mask_noise_amp ?? null,
          cip_images_per_block: src.cip_images_per_block ?? null,
          cip_asset_filenames_count: Array.isArray(filenames) ? filenames.length : null,
          cip_mask_to_image_sprite_urls_count: Array.isArray(m2iUrls) ? m2iUrls.length : null,
          cip_image_to_mask_sprite_urls_count: Array.isArray(i2mUrls) ? i2mUrls.length : null
        };

        console.error('[TimelineCompiler] CIP block has no images (cip_image_urls empty). Diagnostics:', diag);
        throw new Error(
          'Continuous Image Presentation block is missing image URLs (cip_image_urls is empty). ' +
          'This usually means CIP assets were not generated/applied in the Builder before export.'
        );
      }

      const requestedCount = (() => {
        const n = Number.parseInt(src.cip_images_per_block, 10);
        if (Number.isFinite(n) && n > 0) return n;
        return length;
      })();

      if (!Number.isFinite(requestedCount) || requestedCount <= 0) {
        const diag = {
          block_component_type: (block && typeof block === 'object') ? (block.block_component_type ?? null) : null,
          block_length: Number.isFinite(length) ? length : null,
          cip_images_per_block: src.cip_images_per_block ?? null,
          cip_image_urls_count: Array.isArray(imageUrls) ? imageUrls.length : null
        };
        console.error('[TimelineCompiler] CIP block expanded to 0 trials (requestedCount <= 0). Diagnostics:', diag);
        throw new Error(
          'Continuous Image Presentation block would generate 0 trials (cip_images_per_block / block length resolves to 0).'
        );
      }

      const repeatMode = (src.cip_repeat_mode ?? 'no_repeats').toString().trim().toLowerCase();
      const repeatToFill = repeatMode === 'repeat_to_fill';

      const seedParsed = Number.parseInt((block.seed ?? src.seed ?? '').toString(), 10);
      const seed = Number.isFinite(seedParsed) ? (seedParsed >>> 0) : null;
      const rng = seed === null ? Math.random : mulberry32(seed);

      const shuffleInPlace = (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          const tmp = arr[i];
          arr[i] = arr[j];
          arr[j] = tmp;
        }
        return arr;
      };

      const baseIndices = Array.from({ length: imageUrls.length }, (_, i) => i);
      const chosenIndices = [];
      if (!repeatToFill) {
        const shuffled = shuffleInPlace(baseIndices.slice());
        const n = Math.min(requestedCount, shuffled.length);
        for (let i = 0; i < n; i++) chosenIndices.push(shuffled[i]);
      } else {
        while (chosenIndices.length < requestedCount) {
          const cycle = shuffleInPlace(baseIndices.slice());
          for (const idx of cycle) {
            chosenIndices.push(idx);
            if (chosenIndices.length >= requestedCount) break;
          }
        }
      }

      if (chosenIndices.length === 0) {
        const diag = {
          requestedCount,
          repeatMode,
          cip_image_urls_count: Array.isArray(imageUrls) ? imageUrls.length : null
        };
        console.error('[TimelineCompiler] CIP block expanded to 0 trials (chosenIndices empty). Diagnostics:', diag);
        throw new Error('Continuous Image Presentation block expanded to 0 trials (no images selected).');
      }

      const transitionFrames = (() => {
        const n = Number.parseInt(src.cip_transition_frames, 10);
        if (Number.isFinite(n) && n > 0) return n;
        return 8;
      })();

      const imageDurationMs = (() => {
        const n = Number.parseInt(src.cip_image_duration_ms, 10);
        if (Number.isFinite(n) && n >= 0) return n;
        return 750;
      })();

      const transitionDurationMs = (() => {
        const n = Number.parseInt(src.cip_transition_duration_ms, 10);
        if (Number.isFinite(n) && n >= 0) return n;
        return 200;
      })();

      const choiceKeysRaw = (src.cip_choice_keys ?? src.choices ?? 'f,j').toString();
      const choices = choiceKeysRaw
        .split(/[\n,]/g)
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => (s.length === 1 ? s.toLowerCase() : s));

      const out = [];
      for (let i = 0; i < chosenIndices.length; i++) {
        const idx = chosenIndices[i];

        const pickSpriteUrl = (list) => {
          if (!Array.isArray(list) || list.length === 0) return null;
          if (list.length === 1) return list[0] || null;
          // If Builder exported sprites per *source asset* (aligned with imageUrls order)
          if (list.length === imageUrls.length) return list[idx] || null;
          // If Builder exported sprites per *generated trial* (aligned with chosenIndices order)
          if (list.length === chosenIndices.length) return list[i] || null;
          // Fallback: prefer trial index if available, otherwise source index.
          if (i >= 0 && i < list.length) return list[i] || null;
          if (idx >= 0 && idx < list.length) return list[idx] || null;
          return null;
        };

        out.push({
          type: 'continuous-image-presentation',
          image_url: imageUrls[idx] || '',
          asset_filename: filenames[idx] || '',
          mask_to_image_sprite_url: pickSpriteUrl(m2iUrls),
          image_to_mask_sprite_url: pickSpriteUrl(i2mUrls),
          transition_frames: transitionFrames,
          image_duration_ms: imageDurationMs,
          transition_duration_ms: transitionDurationMs,
          choices,
          _generated_from_block: true,
          _block_index: i,
          _block_source_index: idx
        });
      }

      return out;
    }

    const seedParsed = Number.parseInt((block.seed ?? '').toString(), 10);
    const seed = Number.isFinite(seedParsed) ? (seedParsed >>> 0) : null;
    const rng = seed === null ? Math.random : mulberry32(seed);

    const sampleNumber = (min, max) => {
      const a = Number(min);
      const b = Number(max);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      return lo + (hi - lo) * rng();
    };

    const parseNumericListWithRanges = (raw) => {
      if (raw === undefined || raw === null) return [];

      const source = Array.isArray(raw)
        ? raw.map(x => (x === undefined || x === null) ? '' : String(x))
        : String(raw).split(',');

      const expanded = [];
      for (const chunk of source) {
        const token = String(chunk).trim();
        if (!token) continue;

        const m = token.match(/^(-?\d+)\s*-\s*(-?\d+)$/);
        if (!m) {
          expanded.push(token);
          continue;
        }

        const start = Number.parseInt(m[1], 10);
        const end = Number.parseInt(m[2], 10);
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
          expanded.push(token);
          continue;
        }

        const step = start <= end ? 1 : -1;
        for (let n = start; step > 0 ? n <= end : n >= end; n += step) {
          expanded.push(String(n));
        }
      }

      const nums = [];
      for (const token of expanded) {
        const n = Number(token);
        if (!Number.isFinite(n)) return [];
        nums.push(n);
      }
      return nums;
    };

    const parseDelimitedStringOptions = (raw) => {
      if (raw === undefined || raw === null) return [];
      if (typeof raw !== 'string') return [];
      if (!/[\n,]/.test(raw)) return [];

      return raw
        .split(/[\n,]/g)
        .map(v => v.trim())
        .filter(Boolean);
    };

    const sampleFromValues = (v) => {
      if (Array.isArray(v)) {
        if (v.length === 0) return null;
        const idx = Math.floor(rng() * v.length);
        return v[Math.max(0, Math.min(v.length - 1, idx))];
      }

      // Back-compat/robustness: allow numeric list shorthand strings (e.g., "1-4", "0,90,180").
      if (typeof v === 'string') {
        const delimited = parseDelimitedStringOptions(v);
        if (delimited.length > 0) {
          const idx = Math.floor(rng() * delimited.length);
          return delimited[Math.max(0, Math.min(delimited.length - 1, idx))];
        }

        const parsed = parseNumericListWithRanges(v);
        if (parsed.length > 0) {
          const idx = Math.floor(rng() * parsed.length);
          return parsed[Math.max(0, Math.min(parsed.length - 1, idx))];
        }
      }

      return v;
    };

    const normalizeOptions = (raw) => {
      if (raw === undefined || raw === null) return [];
      if (Array.isArray(raw)) return raw;
      if (typeof raw === 'string') {
        const delimited = parseDelimitedStringOptions(raw);
        if (delimited.length > 0) return delimited;

        const parsed = parseNumericListWithRanges(raw);
        if (parsed.length > 0) return parsed;
      }
      return [raw];
    };

    // Backward compatibility: some block exports provide raw block fields
    // instead of JsonBuilder-normalized `values.direction` / `parameter_windows`.
    const promoteWindow = (windowKey, minKey, maxKey) => {
      if (isObject(windows[windowKey])) return;
      const minNum = Number(values[minKey]);
      const maxNum = Number(values[maxKey]);
      if (!Number.isFinite(minNum) || !Number.isFinite(maxNum)) return;
      windows[windowKey] = { min: minNum, max: maxNum };
      delete values[minKey];
      delete values[maxKey];
    };

    const toFiniteNumericOptions = (raw) => {
      const opts = normalizeOptions(raw)
        .map(v => Number(v))
        .filter(v => Number.isFinite(v));
      return Array.from(new Set(opts));
    };

    if (baseType === 'rdm-practice') {
      if (!Object.prototype.hasOwnProperty.call(values, 'direction')
        && Object.prototype.hasOwnProperty.call(values, 'practice_direction_options')) {
        const dirs = toFiniteNumericOptions(values.practice_direction_options);
        if (dirs.length > 0) values.direction = dirs;
      }

      promoteWindow('coherence', 'practice_coherence_min', 'practice_coherence_max');
      promoteWindow('feedback_duration', 'practice_feedback_duration_min', 'practice_feedback_duration_max');
      promoteWindow('lifetime_frames', 'lifetime_frames_min', 'lifetime_frames_max');
      promoteWindow('stimulus_duration', 'stimulus_duration_min', 'stimulus_duration_max');
      promoteWindow('response_deadline', 'response_deadline_min', 'response_deadline_max');
      promoteWindow('inter_trial_interval', 'inter_trial_interval_min', 'inter_trial_interval_max');
    }

    const sampleFromOptions = (opts) => {
      const arr = Array.isArray(opts) ? opts : [];
      if (arr.length === 0) return null;
      const idx = Math.floor(rng() * arr.length);
      return arr[Math.max(0, Math.min(arr.length - 1, idx))];
    };

    const dependentDotGroupDirectionsEnabled = (
      baseType === 'rdm-dot-groups'
      && (values.dependent_direction_of_movement_enabled === true
        || values.dependent_direction_of_movement_enabled === 'true'
        || values.dependent_direction_of_movement_enabled === 1
        || values.dependent_direction_of_movement_enabled === '1')
    );

    const directionTransitionMode = (values.direction_transition_mode ?? 'random_each_trial').toString().trim().toLowerCase();
    const directionTransitionEveryNRaw = Number.parseInt(values.direction_transition_every_n_trials, 10);
    const directionTransitionEveryN = Number.isFinite(directionTransitionEveryNRaw)
      ? Math.max(1, directionTransitionEveryNRaw)
      : 1;
    const directionTransitionCountRaw = Number.parseInt(values.direction_transition_count, 10);
    const directionTransitionCount = Number.isFinite(directionTransitionCountRaw)
      ? Math.max(0, directionTransitionCountRaw)
      : 0;

    delete values.direction_transition_mode;
    delete values.direction_transition_every_n_trials;
    delete values.direction_transition_count;

    const shouldScheduleDirectionTransitions =
      directionTransitionMode === 'every_n_trials' || directionTransitionMode === 'exact_count';

    const directionKeysForType = (type) => {
      if (type === 'rdm-trial' || type === 'rdm-practice') return ['direction'];
      if (type === 'rdm-dot-groups') {
        return dependentDotGroupDirectionsEnabled
          ? ['dependent_group_1_direction', 'dependent_group_direction_difference']
          : ['group_1_direction', 'group_2_direction'];
      }
      return [];
    };

    const buildSwitchIndices = (totalTrials, mode, everyN, count) => {
      const maxSwitches = Math.max(0, totalTrials - 1);
      const out = new Set();
      if (!(maxSwitches > 0)) return out;

      if (mode === 'every_n_trials') {
        for (let idx = Math.max(1, everyN); idx < totalTrials; idx += Math.max(1, everyN)) {
          out.add(idx);
        }
        return out;
      }

      if (mode === 'exact_count') {
        const target = Math.max(0, Math.min(maxSwitches, count));
        if (target === 0) return out;
        if (target === maxSwitches) {
          for (let idx = 1; idx < totalTrials; idx++) out.add(idx);
          return out;
        }

        const candidates = Array.from({ length: maxSwitches }, (_, i) => i + 1);
        for (let i = candidates.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          const tmp = candidates[i];
          candidates[i] = candidates[j];
          candidates[j] = tmp;
        }
        const selected = candidates.slice(0, target).sort((a, b) => a - b);
        for (const idx of selected) out.add(idx);
      }

      return out;
    };

    const pickDifferentOption = (current, options) => {
      if (!Array.isArray(options) || options.length === 0) return current;
      if (options.length === 1) return options[0];
      const filtered = options.filter(o => o !== current);
      const source = filtered.length > 0 ? filtered : options;
      const idx = Math.floor(rng() * source.length);
      return source[Math.max(0, Math.min(source.length - 1, idx))];
    };

    const directionSequences = (() => {
      if (!shouldScheduleDirectionTransitions) return {};

      const keys = directionKeysForType(baseType);
      if (!Array.isArray(keys) || keys.length === 0) return {};

      const switchIndices = buildSwitchIndices(length, directionTransitionMode, directionTransitionEveryN, directionTransitionCount);
      const seqMap = {};

      for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(values, key)) continue;

        const options = normalizeOptions(values[key])
          .map(v => (v === undefined || v === null) ? null : v)
          .filter(v => v !== null);

        if (options.length === 0) continue;

        const seq = new Array(length);
        let current = sampleFromOptions(options);
        seq[0] = current;

        for (let i = 1; i < length; i++) {
          if (switchIndices.has(i)) {
            current = pickDifferentOption(current, options);
          }
          seq[i] = current;
        }

        seqMap[key] = seq;
      }

      return seqMap;
    })();

    // Adaptive / staircase support (trial-based). In continuous mode this isn't supported yet.
    let staircase = null;
    let adaptiveMeta = null;
    const useStoredGaborThresholds = (
      values.use_stored_thresholds === true
      || values.use_stored_thresholds === 'true'
      || values.use_stored_thresholds === 1
      || values.use_stored_thresholds === '1'
    );

    const normalizeStoredThresholdParameter = (raw) => {
      const param = (raw ?? '').toString().trim();
      if (param === 'target_tilt_deg' || param === 'contrast' || param === 'spatial_frequency_cyc_per_px') {
        return param;
      }
      return null;
    };

    const getStoredGaborThresholdEntry = () => {
      try {
        const thresholdState = window?.cogflowState?.gabor_thresholds;
        if (!isObject(thresholdState)) return null;

        const byParameter = isObject(thresholdState.by_parameter) ? thresholdState.by_parameter : null;
        const directParameter = normalizeStoredThresholdParameter(thresholdState.parameter);
        if (directParameter) {
          const entry = (byParameter && isObject(byParameter[directParameter]))
            ? byParameter[directParameter]
            : thresholdState;
          return isObject(entry) ? { parameter: directParameter, entry } : null;
        }

        if (byParameter) {
          let best = null;
          for (const [parameterName, candidate] of Object.entries(byParameter)) {
            const normalizedParameter = normalizeStoredThresholdParameter(parameterName);
            if (!normalizedParameter || !isObject(candidate)) continue;
            const stamp = Number(candidate.updated_at ?? 0);
            if (!best || stamp >= best.updatedAt) {
              best = { parameter: normalizedParameter, entry: candidate, updatedAt: stamp };
            }
          }
          if (best) return { parameter: best.parameter, entry: best.entry };
        }
      } catch {
        return null;
      }
      return null;
    };

    const resolveStoredGaborThreshold = (targetLocation, randomFn = rng) => {
      if (!useStoredGaborThresholds) return null;
      if (adaptiveMeta && adaptiveMeta.mode === 'quest') return null;

      const stored = getStoredGaborThresholdEntry();
      if (!stored || !isObject(stored.entry)) return null;

      const side = (targetLocation ?? '').toString().trim().toLowerCase();
      const entry = stored.entry;

      let rawValue = null;
      let source = 'combined';

      if (side === 'left' && Number.isFinite(Number(entry.left))) {
        rawValue = Number(entry.left);
        source = 'left';
      } else if (side === 'right' && Number.isFinite(Number(entry.right))) {
        rawValue = Number(entry.right);
        source = 'right';
      } else if (Number.isFinite(Number(entry.combined))) {
        rawValue = Number(entry.combined);
        source = 'combined';
      } else if (Number.isFinite(Number(entry.left))) {
        rawValue = Number(entry.left);
        source = 'left';
      } else if (Number.isFinite(Number(entry.right))) {
        rawValue = Number(entry.right);
        source = 'right';
      }

      if (!Number.isFinite(rawValue)) return null;

      let value = rawValue;
      if (stored.parameter === 'target_tilt_deg') {
        const magnitude = Math.abs(rawValue);
        value = (randomFn() < 0.5 ? -1 : 1) * magnitude;
      }

      return {
        parameter: stored.parameter,
        source,
        value
      };
    };

    const applyStoredGaborThreshold = (trial, randomFn = rng) => {
      const resolved = resolveStoredGaborThreshold(trial?.target_location, randomFn);
      if (!resolved) return null;

      trial[resolved.parameter] = resolved.value;
      trial.data = isObject(trial.data) ? trial.data : {};
      trial.data.reused_stored_threshold = true;
      trial.data.stored_threshold_parameter = resolved.parameter;
      trial.data.stored_threshold_source = resolved.source;
      trial.data.stored_threshold_value = resolved.value;
      return resolved;
    };

    // Gabor QUEST blocks export values.adaptive = { mode:'quest', parameter: ... }
    if (baseType === 'gabor-trial' && isObject(values.adaptive) && (values.adaptive.mode || '').toString() === 'quest') {
      const a = values.adaptive;
      const questParam = (a.parameter || 'target_tilt_deg').toString();
      adaptiveMeta = {
        mode: 'quest',
        parameter: questParam
      };

      // Contrast is inherently bounded 0-1; tilt defaults stay as-is.
      if (questParam === 'contrast') {
        adaptiveMeta.minValue = Number.isFinite(Number(a.min_value)) ? Number(a.min_value) : 0;
        adaptiveMeta.maxValue = Number.isFinite(Number(a.max_value)) ? Number(a.max_value) : 1;
      }

      // If min/max not provided, try to infer from block windows.
      const inferredMin = (questParam in windows && isObject(windows[questParam])) ? Number(windows[questParam].min) : undefined;
      const inferredMax = (questParam in windows && isObject(windows[questParam])) ? Number(windows[questParam].max) : undefined;

      const questOpts = {
        ...a,
        parameter: questParam,
        ...(Number.isFinite(inferredMin) && a.min_value === undefined ? { min_value: inferredMin } : {}),
        ...(Number.isFinite(inferredMax) && a.max_value === undefined ? { max_value: inferredMax } : {})
      };

      // Coarse/fine phase support
      const trialsCoarse = Number.isFinite(Number(a.quest_trials_coarse ?? values.quest_trials_coarse))
        ? Math.max(0, Math.round(Number(a.quest_trials_coarse ?? values.quest_trials_coarse)))
        : 0;
      const trialsFine = Number.isFinite(Number(a.quest_trials_fine ?? values.quest_trials_fine))
        ? Math.max(0, Math.round(Number(a.quest_trials_fine ?? values.quest_trials_fine)))
        : 0;
      adaptiveMeta.trialsCoarse = trialsCoarse;
      adaptiveMeta.trialsFine = trialsFine;

      // Per-location staircase support
      const perLocation = !!(a.staircase_per_location ?? values.quest_staircase_per_location);
      adaptiveMeta.perLocation = perLocation;

      // Store thresholds to window.cogflowState
      const storeThreshold = !!(a.store_location_threshold ?? values.quest_store_location_threshold);
      adaptiveMeta.storeThreshold = storeThreshold;

      if (perLocation) {
        adaptiveMeta.staircaseLeft = new QuestStaircase(questOpts);
        adaptiveMeta.staircaseRight = new QuestStaircase(questOpts);
        adaptiveMeta.phaseTrialCounts = { left: 0, right: 0 };
        staircase = adaptiveMeta.staircaseLeft; // default; on_start will pick per trial
      } else {
        staircase = new QuestStaircase(questOpts);
        adaptiveMeta.phaseTrialCount = 0;
      }

      adaptiveMeta.totalTrialCount = 0;
    }

    // RDM adaptive blocks (builder exports: windows.initial_coherence, windows.step_size, values.algorithm)
    if (baseType === 'rdm-adaptive') {
      const algo = (values.algorithm || 'quest').toString();
      const target = Number.isFinite(Number(values.target_performance)) ? Number(values.target_performance) : 0.82;

      const initW = isObject(windows.initial_coherence) ? windows.initial_coherence : {};
      const stepW = isObject(windows.step_size) ? windows.step_size : {};
      const startValue = sampleNumber(initW.min, initW.max);
      const stepSize = sampleNumber(stepW.min, stepW.max);

      delete windows.initial_coherence;
      delete windows.step_size;

      adaptiveMeta = { mode: algo, parameter: 'coherence' };

      if (algo === 'quest') {
        staircase = new QuestStaircase({
          parameter: 'coherence',
          target_performance: target,
          start_value: Number.isFinite(startValue) ? startValue : 0.1,
          start_sd: Number.isFinite(stepSize) ? Math.max(0.02, stepSize) : 0.08,
          // Coherence is bounded.
          min_value: 0,
          max_value: 1,
          // For 2AFC-like left/right decisions.
          gamma: 0.5,
          delta: 0.01,
          beta: 5
        });
      } else {
        staircase = new WeightedUpDownStaircase({
          mode: algo,
          parameter: 'coherence',
          target_performance: target,
          start_value: Number.isFinite(startValue) ? startValue : 0.1,
          step_size: Number.isFinite(stepSize) ? stepSize : 0.05,
          min_value: 0,
          max_value: 1
        });
      }
    }

    const tsDefaults = (opts && isObject(opts.taskSwitchingDefaults)) ? opts.taskSwitchingDefaults : {};
    const tsMode = (tsDefaults.stimulus_set_mode ?? 'letters_numbers').toString().trim().toLowerCase() === 'custom'
      ? 'custom'
      : 'letters_numbers';
    const tsTasks = Array.isArray(tsDefaults.tasks) ? tsDefaults.tasks : [];
    const tsLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const tsDigits = '123456789'.split('');
    const tsGetCustomPool = (taskIndex) => {
      const idx = (taskIndex === 2) ? 1 : 0;
      const t = (tsTasks[idx] && typeof tsTasks[idx] === 'object') ? tsTasks[idx] : {};
      const a = Array.isArray(t.category_a_tokens) ? t.category_a_tokens : [];
      const b = Array.isArray(t.category_b_tokens) ? t.category_b_tokens : [];
      const pool = [...a, ...b]
        .map(x => (x ?? '').toString().trim())
        .filter(Boolean);
      return pool;
    };
    const tsPick = (arr, fallback) => {
      const a = Array.isArray(arr) ? arr : [];
      if (a.length === 0) return fallback;
      const idx = Math.floor(rng() * a.length);
      return a[Math.max(0, Math.min(a.length - 1, idx))];
    };

    const normalizeTsTrialType = (raw) => {
      const s = (raw ?? '').toString().trim().toLowerCase();
      if (s === 'single' || s === 'one' || s === 'one_task' || s === 'single_task') return 'single';
      if (s === 'switch' || s === 'two' || s === 'switching' || s === 'task_switching') return 'switch';
      return 'switch';
    };
    const normalizeTsTaskIndex = (raw, fallback) => {
      const n = Number.parseInt(raw, 10);
      if (n === 2) return 2;
      if (n === 1) return 1;
      return fallback;
    };

    const shuffleWithRng = (arr, randomFn = rng) => {
      const out = Array.isArray(arr) ? arr.slice() : [];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(randomFn() * (i + 1));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
      return out;
    };

    const buildBalancedBoolSchedule = (total, pTrue, randomFn = rng) => {
      const n = Math.max(0, Number.parseInt(total, 10) || 0);
      if (n <= 0) return [];
      const p = clamp(pTrue, 0, 1);
      const nTrue = Math.max(0, Math.min(n, Math.round(n * p)));
      const schedule = [];
      for (let i = 0; i < nTrue; i++) schedule.push(true);
      for (let i = nTrue; i < n; i++) schedule.push(false);
      return shuffleWithRng(schedule, randomFn);
    };

    const toUniqueFiniteNumbers = (raw) => {
      const out = [];
      const seen = new Set();
      const opts = normalizeOptions(raw);
      for (const v of opts) {
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        const key = String(n);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(n);
      }
      return out;
    };

    const buildBalancedPairSchedule = (total, aVals, bVals, randomFn = rng) => {
      const n = Math.max(0, Number.parseInt(total, 10) || 0);
      const a = Array.isArray(aVals) ? aVals : [];
      const b = Array.isArray(bVals) ? bVals : [];
      if (n <= 0 || a.length === 0 || b.length === 0) return [];

      const combos = [];
      for (const av of a) {
        for (const bv of b) {
          combos.push({ a: av, b: bv });
        }
      }
      if (combos.length === 0) return [];

      const out = [];
      while (out.length < n) {
        const cycle = shuffleWithRng(combos, randomFn);
        for (const c of cycle) {
          out.push(c);
          if (out.length >= n) break;
        }
      }
      return out;
    };

    const applyGaborBlockCounterbalance = (generatedTrials) => {
      if (!Array.isArray(generatedTrials) || generatedTrials.length === 0) return;

      const targetLocationOpts = normalizeOptions(values.target_location).map(v => (v ?? '').toString().trim().toLowerCase());
      const hasBothTargetSides = targetLocationOpts.includes('left') && targetLocationOpts.includes('right');
      const pTargetLeftRaw = Number(values.target_left_probability);
      const targetPlan = (Number.isFinite(pTargetLeftRaw) && hasBothTargetSides)
        ? buildBalancedBoolSchedule(generatedTrials.length, clamp(pTargetLeftRaw, 0, 1), rng)
        : null;

      const spatialCueTargetMode = (values.spatial_cue_target_mode ?? 'couple_target_to_cue').toString().trim().toLowerCase();
      const pCueValidRaw = Number(values.spatial_cue_validity_probability);

      if (Number.isFinite(pCueValidRaw) && spatialCueTargetMode !== 'preserve_target_distribution') {
        const pValid = clamp(pCueValidRaw, 0, 1);
        for (const cueSide of ['left', 'right']) {
          const indices = [];
          for (let i = 0; i < generatedTrials.length; i++) {
            const cue = (generatedTrials[i].spatial_cue ?? 'none').toString().trim().toLowerCase();
            if (cue === cueSide) indices.push(i);
          }
          const validity = buildBalancedBoolSchedule(indices.length, pValid, rng);
          for (let j = 0; j < indices.length; j++) {
            const idx = indices[j];
            const isValid = validity[j] === true;
            generatedTrials[idx].spatial_cue_valid = isValid;
            generatedTrials[idx].target_location = isValid
              ? cueSide
              : (cueSide === 'left' ? 'right' : 'left');
          }
        }
      }

      if (targetPlan) {
        for (let i = 0; i < generatedTrials.length; i++) {
          const cue = (generatedTrials[i].spatial_cue ?? 'none').toString().trim().toLowerCase();
          const unilateralCoupled = Number.isFinite(pCueValidRaw)
            && spatialCueTargetMode !== 'preserve_target_distribution'
            && (cue === 'left' || cue === 'right');
          if (!unilateralCoupled) {
            generatedTrials[i].target_location = targetPlan[i] ? 'left' : 'right';
          }
        }
      }

      const valueTarget = (values.value_target_value ?? 'any').toString().trim().toLowerCase();
      const valueNonTarget = (values.value_non_target_value ?? 'any').toString().trim().toLowerCase();
      if (valueTarget === 'high' || valueTarget === 'low' || valueTarget === 'neutral') {
        for (let i = 0; i < generatedTrials.length; i++) {
          const trial = generatedTrials[i];
          const desired = targetPlan
            ? (targetPlan[i] ? 'left' : 'right')
            : (((trial.target_location ?? '').toString().trim().toLowerCase() === 'right') ? 'right' : 'left');

          const chosen = desired;

          trial.target_location = chosen;
          trial.value_target_value = valueTarget;
          if (chosen === 'left') {
            trial.left_value = valueTarget;
            if (valueNonTarget === 'high' || valueNonTarget === 'low' || valueNonTarget === 'neutral') {
              trial.right_value = valueNonTarget;
            }
          } else if (chosen === 'right') {
            trial.right_value = valueTarget;
            if (valueNonTarget === 'high' || valueNonTarget === 'low' || valueNonTarget === 'neutral') {
              trial.left_value = valueNonTarget;
            }
          }
        }
      }

      if (adaptiveMeta && adaptiveMeta.mode === 'quest') return;

      const targetTiltOptions = toUniqueFiniteNumbers(values.target_tilt_deg);
      const distractorOptions = toUniqueFiniteNumbers(values.distractor_orientation_deg);
      if (targetTiltOptions.length === 0 || distractorOptions.length === 0) return;

      for (const side of ['left', 'right']) {
        const indices = [];
        for (let i = 0; i < generatedTrials.length; i++) {
          const loc = (generatedTrials[i].target_location ?? '').toString().trim().toLowerCase();
          if (loc === side) indices.push(i);
        }

        const comboPlan = buildBalancedPairSchedule(indices.length, targetTiltOptions, distractorOptions, rng);
        for (let j = 0; j < indices.length; j++) {
          const idx = indices[j];
          const pair = comboPlan[j];
          if (!pair) continue;
          generatedTrials[idx].target_tilt_deg = pair.a;
          generatedTrials[idx].distractor_orientation_deg = pair.b;
        }
      }
    };

    const trials = [];
    for (let i = 0; i < length; i++) {
      const t = { type: baseType, _generated_from_block: true, _block_index: i };

      // Apply fixed values
      for (const [k, v] of Object.entries(values)) {
        t[k] = sampleFromValues(v);
      }

      for (const [k, seq] of Object.entries(directionSequences)) {
        if (Array.isArray(seq) && i < seq.length) {
          t[k] = seq[i];
        }
      }

      if (baseType === 'sart-trial') {
        const digitOptions = Array.isArray(values.digit)
          ? values.digit
              .map(v => Number.parseInt(v, 10))
              .filter(v => Number.isFinite(v))
          : [];
        const nogoDigit = Number.parseInt(t.nogo_digit, 10);
        const nogoProbability = Number(t.nogo_probability);
        const useWeighted = digitOptions.length > 0
          && Number.isFinite(nogoDigit)
          && Number.isFinite(nogoProbability)
          && nogoProbability > 0
          && nogoProbability < 1;

        if (useWeighted) {
          const goDigits = digitOptions.filter(d => d !== nogoDigit);
          if (goDigits.length > 0 && rng() < nogoProbability) {
            t.digit = nogoDigit;
          } else if (goDigits.length > 0) {
            const idx = Math.floor(rng() * goDigits.length);
            t.digit = goDigits[Math.max(0, Math.min(goDigits.length - 1, idx))];
          } else {
            t.digit = nogoDigit;
          }
        }
      }

      // Apply sampled windows
      for (const [k, w] of Object.entries(windows)) {
        if (!isObject(w)) continue;
        const s = sampleNumber(w.min, w.max);
        if (s === null) continue;
        // Many windowed parameters are intended to be integer-ish (ms, px, counts).
        // However, some parameters *end with* `_px` but are continuous-valued, e.g.
        // `spatial_frequency_cyc_per_px` for Gabor. Rounding those to integers
        // collapses values like 0.06 -> 0, which makes the stimulus invisible.
        const isCyclesPerPx = /cyc_per_px$/i.test(k);
        const shouldRound = !isCyclesPerPx && /(_ms|_px|_deg|_count|_trials|_repetitions)$/i.test(k);
        t[k] = shouldRound ? Math.round(s) : s;
      }

      // Task Switching Block generation: fill task_index + stimulus if not explicitly provided.
      // This is done here (inside the normal Block sampling loop) so all block parameters
      // in `values`/`windows` propagate into the generated trials.
      if (baseType === 'task-switching-trial') {
        const trialType = normalizeTsTrialType(t.trial_type);
        const fixedTask = normalizeTsTaskIndex(t.single_task_index, 1);
        const computedTaskIndex = (trialType === 'single') ? fixedTask : ((i % 2) + 1);

        if (t.task_index === undefined || t.task_index === null || t.task_index === '') {
          t.task_index = computedTaskIndex;
        } else {
          t.task_index = normalizeTsTaskIndex(t.task_index, computedTaskIndex);
        }

        const pickToken = (taskIndex) => {
          const idx = (taskIndex === 2) ? 2 : 1;
          if (tsMode === 'custom') {
            const pool = tsGetCustomPool(idx);
            return tsPick(pool, (idx === 2 ? '1' : 'A'));
          }
          return (idx === 2) ? tsPick(tsDigits, '1') : tsPick(tsLetters, 'A');
        };

        const stim1Raw = (t.stimulus_task_1 ?? '').toString().trim();
        const stim2Raw = (t.stimulus_task_2 ?? '').toString().trim();
        const stim1 = stim1Raw || pickToken(1);
        const stim2 = stim2Raw || pickToken(2);

        t.stimulus_task_1 = stim1;
        t.stimulus_task_2 = stim2;
        t.stimulus = `${stim1} ${stim2}`;

        // Minimal fallbacks for cue-related fields so the plugin has predictable inputs.
        const cueType = (t.cue_type ?? '').toString().trim().toLowerCase();
        if (cueType === 'position') {
          if (!t.task_1_position) t.task_1_position = 'left';
          if (!t.task_2_position) t.task_2_position = 'right';
        }
        if (cueType === 'explicit') {
          if (!t.task_1_cue_text) t.task_1_cue_text = 'LETTERS';
          if (!t.task_2_cue_text) t.task_2_cue_text = 'NUMBERS';
        }
      }

      // Gabor cue presence gating (optional): jointly sample spatial/value cue presence per trial.
      // This is applied only when the Builder exports *enabled/probability fields*.
      if (baseType === 'gabor-trial' || baseType === 'gabor-quest') {
        const targetLocationOpts = normalizeOptions(values.target_location).map(v => (v ?? '').toString().trim().toLowerCase());
        const pTargetLeftRaw = Number(values.target_left_probability);
        if (Number.isFinite(pTargetLeftRaw) && targetLocationOpts.includes('left') && targetLocationOpts.includes('right')) {
          const pLeft = clamp(pTargetLeftRaw, 0, 1);
          t.target_location = (rng() < pLeft) ? 'left' : 'right';
        }

        const hasSpatialGate = (Object.prototype.hasOwnProperty.call(values, 'spatial_cue_enabled') || Object.prototype.hasOwnProperty.call(values, 'spatial_cue_probability'));
        const hasValueGate = (Object.prototype.hasOwnProperty.call(values, 'value_cue_enabled') || Object.prototype.hasOwnProperty.call(values, 'value_cue_probability'));

        if (hasSpatialGate || hasValueGate) {
          const spatialEnabled = Object.prototype.hasOwnProperty.call(values, 'spatial_cue_enabled') ? (values.spatial_cue_enabled === true) : true;
          const valueEnabled = Object.prototype.hasOwnProperty.call(values, 'value_cue_enabled') ? (values.value_cue_enabled === true) : true;

          const pSpatial = Object.prototype.hasOwnProperty.call(values, 'spatial_cue_probability') ? clamp(values.spatial_cue_probability, 0, 1) : 1;
          const pValue = Object.prototype.hasOwnProperty.call(values, 'value_cue_probability') ? clamp(values.value_cue_probability, 0, 1) : 1;

          const spatialPresent = spatialEnabled && rng() < pSpatial;
          const valuePresent = valueEnabled && rng() < pValue;

          if (!spatialPresent) {
            t.spatial_cue = 'none';
          } else {
            const opts = normalizeOptions(values.spatial_cue);
            const filtered = opts.filter(x => (x ?? '').toString().trim().toLowerCase() !== 'none');
            const picked = sampleFromOptions(filtered.length > 0 ? filtered : opts);
            t.spatial_cue = picked === null ? (t.spatial_cue ?? 'none') : picked;
          }

          if (!valuePresent) {
            t.left_value = 'neutral';
            t.right_value = 'neutral';
          } else {
            const lvOpts = normalizeOptions(values.left_value);
            const rvOpts = normalizeOptions(values.right_value);
            const lvFiltered = lvOpts.filter(x => (x ?? '').toString().trim().toLowerCase() !== 'neutral');
            const rvFiltered = rvOpts.filter(x => (x ?? '').toString().trim().toLowerCase() !== 'neutral');

            const leftPicked = sampleFromOptions(lvFiltered.length > 0 ? lvFiltered : lvOpts);
            const rightPicked = sampleFromOptions(rvFiltered.length > 0 ? rvFiltered : rvOpts);

            if (leftPicked !== null) t.left_value = leftPicked;
            if (rightPicked !== null) t.right_value = rightPicked;
          }

          // Don't leak gating config into per-trial parameters.
          delete t.spatial_cue_enabled;
          delete t.spatial_cue_probability;
          delete t.spatial_cue_target_mode;
          delete t.target_left_probability;
          delete t.value_cue_enabled;
          delete t.value_cue_probability;
          delete t.value_non_target_value;
        }

        // Spatial cue validity coupling (for unilateral cues):
        // - left/right cues are valid with p=spatial_cue_validity_probability
        // - both/none leave target side untouched.
        const spatialCueTargetMode = (values.spatial_cue_target_mode ?? 'couple_target_to_cue').toString().trim().toLowerCase();
        const pCueValid = Number(values.spatial_cue_validity_probability);
        if (Number.isFinite(pCueValid)) {
          const pValid = clamp(pCueValid, 0, 1);
          const cue = (t.spatial_cue ?? 'none').toString().trim().toLowerCase();
          const currentTarget = (t.target_location ?? 'left').toString().trim().toLowerCase();

          let nextTarget = currentTarget;
          let cueValid = null;

          if (cue === 'left' || cue === 'right') {
            if (spatialCueTargetMode === 'preserve_target_distribution') {
              cueValid = (currentTarget === cue);
            } else {
              cueValid = rng() < pValid;
              nextTarget = cueValid ? cue : (cue === 'left' ? 'right' : 'left');
            }
          }

          if (spatialCueTargetMode !== 'preserve_target_distribution' && (nextTarget === 'left' || nextTarget === 'right')) {
            t.target_location = nextTarget;
          }
          if (cueValid !== null) {
            t.spatial_cue_valid = cueValid;
          }
        }

        // Value cue target coupling: optionally force target to whichever side
        // currently carries the selected value cue.
        const valueTarget = (values.value_target_value ?? 'any').toString().trim().toLowerCase();
        const valueNonTarget = (values.value_non_target_value ?? 'any').toString().trim().toLowerCase();
        if (valueTarget === 'high' || valueTarget === 'low' || valueTarget === 'neutral') {
          const lv = (t.left_value ?? 'neutral').toString().trim().toLowerCase();
          const rv = (t.right_value ?? 'neutral').toString().trim().toLowerCase();

          const candidates = [];
          if (lv === valueTarget) candidates.push('left');
          if (rv === valueTarget) candidates.push('right');

          let chosen = null;
          if (candidates.length === 1) {
            chosen = candidates[0];
          } else if (candidates.length > 1) {
            chosen = rng() < 0.5 ? 'left' : 'right';
          } else {
            // Ensure the selected target cue exists in the trial so learning blocks
            // can enforce cue-target coupling consistently.
            chosen = rng() < 0.5 ? 'left' : 'right';
            if (chosen === 'left') t.left_value = valueTarget;
            if (chosen === 'right') t.right_value = valueTarget;
          }

          if (chosen) {
            t.target_location = chosen;
            t.value_target_value = valueTarget;
            if (chosen === 'left') {
              t.left_value = valueTarget;
              if (valueNonTarget === 'high' || valueNonTarget === 'low' || valueNonTarget === 'neutral') {
                t.right_value = valueNonTarget;
              }
            } else if (chosen === 'right') {
              t.right_value = valueTarget;
              if (valueNonTarget === 'high' || valueNonTarget === 'low' || valueNonTarget === 'neutral') {
                t.left_value = valueNonTarget;
              }
            }
          }
        }

        delete t.spatial_cue_target_mode;
        delete t.target_left_probability;
        delete t.use_stored_thresholds;
        delete t.value_non_target_value;

        // Optional reward-availability tagging by cue value at target location.
        // This does not grant points by itself; it exposes trial metadata so
        // reward logic can condition on cue-specific availability.
        const availByValue = {
          high: Number(values.reward_availability_high),
          low: Number(values.reward_availability_low),
          neutral: Number(values.reward_availability_neutral)
        };

        const targetSide = (t.target_location ?? '').toString().trim().toLowerCase();
        const targetCue = (targetSide === 'right' ? t.right_value : t.left_value);
        const cueKey = (targetCue ?? '').toString().trim().toLowerCase();
        const pAvailRaw = availByValue[cueKey];
        if (Number.isFinite(pAvailRaw)) {
          const pAvail = clamp(pAvailRaw, 0, 1);
          t.reward_availability_probability = pAvail;
          t.reward_available = (rng() < pAvail);
        }

        if (useStoredGaborThresholds && (!adaptiveMeta || adaptiveMeta.mode !== 'quest')) {
          const priorOnStart = t.on_start;
          t.on_start = (trial) => {
            if (typeof priorOnStart === 'function') priorOnStart(trial);
            applyStoredGaborThreshold(trial, rng);
          };
        }
      }

      // Stroop helper: ensure congruency labels match the sampled word/ink.
      // Builder Blocks can request congruent vs incongruent trials via `congruency`, but the
      // generic block sampler applies arrays independently. Enforce consistency here so the
      // compiled trial is coherent and scoring is correct.
      if (baseType === 'stroop-trial') {
        const normLower = (v) => (v ?? '').toString().trim().toLowerCase();
        const requested = normLower(t.congruency || 'auto');

        const wordOptsRaw = normalizeOptions(values.word);
        const inkOptsRaw = normalizeOptions(values.ink_color_name);
        const wordOpts = wordOptsRaw.map(x => (x ?? '').toString()).filter(s => s.trim() !== '');
        const inkOpts = inkOptsRaw.map(x => (x ?? '').toString()).filter(s => s.trim() !== '');

        const currentWord = (t.word ?? '').toString();
        const currentInk = (t.ink_color_name ?? '').toString();

        if (requested === 'congruent') {
          // Prefer picking from the intersection of word and ink options.
          const wordMap = new Map(wordOpts.map(s => [normLower(s), s]));
          const inkSet = new Set(inkOpts.map(s => normLower(s)));
          const intersection = [];
          for (const [k, v] of wordMap.entries()) {
            if (k && inkSet.has(k)) intersection.push(v);
          }

          const chosen = sampleFromOptions(intersection.length > 0
            ? intersection
            : (wordOpts.length > 0 ? wordOpts : (currentWord ? [currentWord] : []))
          );

          if (chosen !== null && chosen !== undefined && String(chosen).trim() !== '') {
            t.word = chosen;
            t.ink_color_name = chosen;
          } else if (currentWord.trim() !== '') {
            t.ink_color_name = currentWord;
          } else if (currentInk.trim() !== '') {
            t.word = currentInk;
          }
        } else if (requested === 'incongruent') {
          // Try to pick a (word, ink) pair that differ (case-insensitive).
          const wList = (wordOpts.length > 0) ? wordOpts : (currentWord ? [currentWord] : []);
          const iList = (inkOpts.length > 0) ? inkOpts : (currentInk ? [currentInk] : []);

          let w = currentWord;
          let ink = currentInk;
          for (let tries = 0; tries < 25; tries++) {
            const wTry = sampleFromOptions(wList);
            const iTry = sampleFromOptions(iList);
            if (wTry === null || iTry === null) break;
            if (normLower(wTry) && normLower(iTry) && normLower(wTry) !== normLower(iTry)) {
              w = String(wTry);
              ink = String(iTry);
              break;
            }
          }

          // If we couldn't find a mismatch by independent sampling, force a mismatch when possible.
          if (normLower(w) === normLower(ink)) {
            if (wList.length > 1) {
              const filtered = wList.filter(x => normLower(x) !== normLower(ink));
              const picked = sampleFromOptions(filtered.length > 0 ? filtered : wList);
              if (picked !== null) w = String(picked);
            }
            if (normLower(w) === normLower(ink) && iList.length > 1) {
              const filtered = iList.filter(x => normLower(x) !== normLower(w));
              const picked = sampleFromOptions(filtered.length > 0 ? filtered : iList);
              if (picked !== null) ink = String(picked);
            }
          }

          if (w && w.trim() !== '') t.word = w;
          if (ink && ink.trim() !== '') t.ink_color_name = ink;
        }

        // Always keep the per-trial label consistent with the realized values.
        const wFinal = normLower(t.word);
        const iFinal = normLower(t.ink_color_name);
        if (wFinal && iFinal) {
          t.congruency = (wFinal === iFinal) ? 'congruent' : 'incongruent';
        } else {
          t.congruency = 'auto';
        }
      }

      // Emotional Stroop helper: couple list→word sampling so the recorded metadata stays coherent.
      // Builder Blocks export structured `word_lists`, but the generic block sampler applies arrays
      // independently. Choose a list first, then a word from that list.
      if (baseType === 'emotional-stroop-trial') {
        const rawLists = Array.isArray(values.word_lists) ? values.word_lists : [];

        const normalizeWord = (v) => (v ?? '').toString().trim();
        const normalizeLabel = (v) => (v ?? '').toString().trim();

        const lists = rawLists.map((raw) => {
          if (!raw) return null;
          if (Array.isArray(raw)) {
            const words = raw.map(normalizeWord).filter(Boolean);
            return { label: '', words };
          }
          if (typeof raw === 'object') {
            const label = normalizeLabel(raw.label ?? raw.name ?? '');
            const wordsRaw = Array.isArray(raw.words) ? raw.words : [];
            const words = wordsRaw.map(normalizeWord).filter(Boolean);
            return { label, words };
          }
          return null;
        }).filter((x) => x && Array.isArray(x.words) && x.words.length > 0);

        if (lists.length > 0) {
          const idx = Math.min(lists.length - 1, Math.max(0, Math.floor(rng() * lists.length)));
          const chosenList = lists[idx];
          const chosenWord = sampleFromOptions(chosenList.words);
          if (chosenWord !== null && chosenWord !== undefined && normalizeWord(chosenWord) !== '') {
            t.word = normalizeWord(chosenWord);
            t.word_list_index = idx + 1;
            if (chosenList.label) t.word_list_label = chosenList.label;
          }
        }
      }

      // Adaptive override for the selected parameter.
      if (staircase && adaptiveMeta && typeof adaptiveMeta.parameter === 'string') {
        const p = adaptiveMeta.parameter;

        // NOTE: adaptive values must be chosen at runtime (on_start) so updates from
        // previous trials can influence the next trial. Precomputing values here would
        // freeze the staircase.
        let realizedAdaptiveValue = null;
        let activeStaircase = staircase;

        // Attach hooks (compiler will carry these into jsPsych trials).
        t.on_start = (trial) => {
          // Per-location: pick the right staircase for this trial's target side.
          if (adaptiveMeta.perLocation && adaptiveMeta.staircaseLeft && adaptiveMeta.staircaseRight) {
            const loc = (trial.target_location || '').toString().toLowerCase();
            activeStaircase = (loc === 'right') ? adaptiveMeta.staircaseRight : adaptiveMeta.staircaseLeft;
          } else {
            activeStaircase = staircase;
          }

          // If the parameter was already set by values/windows, adaptive should win.
          // For target_tilt_deg, QUEST adapts magnitude but we randomize sign for discriminate_tilt.
          let val;
          if (p === 'target_tilt_deg') {
            const mag = Math.abs(Number(activeStaircase.next()));
            const sign = rng() < 0.5 ? -1 : 1;
            val = sign * mag;
          } else {
            val = activeStaircase.next();
          }

          realizedAdaptiveValue = val;

          // Keep it on the expanded item too (useful for debugging / introspection).
          t[p] = val;

          if (isObject(trial.rdm)) {
            trial.rdm[p] = val;
          } else {
            trial[p] = val;
          }

          trial.data = isObject(trial.data) ? trial.data : {};
          trial.data.adaptive_mode = adaptiveMeta.mode;
          trial.data.adaptive_parameter = p;
          trial.data.adaptive_value = val;
        };

        t.on_finish = (data) => {
          // Determine correctness from plugin outputs.
          let isCorrect = false;

          if (data && typeof data.correctness === 'boolean') {
            isCorrect = data.correctness;
          } else if (data && typeof data.correct === 'boolean') {
            isCorrect = data.correct;
          } else if (data && data.response_side !== undefined && data.correct_side !== undefined) {
            isCorrect = (data.response_side !== null && data.response_side === data.correct_side);
          }

          activeStaircase.update(isCorrect);
          adaptiveMeta.totalTrialCount += 1;

          const finishedTargetLocation = (data && data.target_location !== undefined ? data.target_location : t.target_location);
          const finishedSide = (finishedTargetLocation ?? '').toString().trim().toLowerCase() === 'right' ? 'right' : 'left';

          const reinit = (sc) => {
            const currentMean = sc.meanThreshold();
            const origSd = Number.isFinite(Number(questOpts.start_sd)) ? Number(questOpts.start_sd) : 20;
            return new QuestStaircase({
              ...questOpts,
              start_value: currentMean,
              start_sd: Math.max(0.5, origSd * 0.4)
            });
          };

          // Coarse → fine phase transition: reinitialize with tighter SD around current mean.
          if (adaptiveMeta.perLocation) {
            adaptiveMeta.phaseTrialCounts = adaptiveMeta.phaseTrialCounts || { left: 0, right: 0 };
            adaptiveMeta.phaseTrialCounts[finishedSide] = (adaptiveMeta.phaseTrialCounts[finishedSide] || 0) + 1;
            if (adaptiveMeta.trialsCoarse > 0 && adaptiveMeta.phaseTrialCounts[finishedSide] === adaptiveMeta.trialsCoarse) {
              if (finishedSide === 'right') {
                adaptiveMeta.staircaseRight = reinit(adaptiveMeta.staircaseRight);
              } else {
                adaptiveMeta.staircaseLeft = reinit(adaptiveMeta.staircaseLeft);
                staircase = adaptiveMeta.staircaseLeft;
              }
            }
          } else {
            adaptiveMeta.phaseTrialCount += 1;
            if (adaptiveMeta.trialsCoarse > 0 && adaptiveMeta.phaseTrialCount === adaptiveMeta.trialsCoarse) {
              staircase = reinit(staircase);
            }
          }

          // Store per-location thresholds to window.cogflowState when storeThreshold is set.
          if (adaptiveMeta.storeThreshold) {
            try {
              window.cogflowState = window.cogflowState || {};
              window.cogflowState.gabor_thresholds = window.cogflowState.gabor_thresholds || {};
              const thresholdState = window.cogflowState.gabor_thresholds;
              thresholdState.parameter = p;
              thresholdState.per_location = !!adaptiveMeta.perLocation;
              thresholdState.updated_at = Date.now();
              thresholdState.by_parameter = isObject(thresholdState.by_parameter) ? thresholdState.by_parameter : {};
              const parameterEntry = {
                parameter: p,
                per_location: !!adaptiveMeta.perLocation,
                updated_at: thresholdState.updated_at
              };
              if (adaptiveMeta.perLocation) {
                thresholdState.left = adaptiveMeta.staircaseLeft.meanThreshold();
                thresholdState.right = adaptiveMeta.staircaseRight.meanThreshold();
                delete thresholdState.combined;
                parameterEntry.left = thresholdState.left;
                parameterEntry.right = thresholdState.right;
              } else {
                thresholdState.combined = staircase.meanThreshold();
                delete thresholdState.left;
                delete thresholdState.right;
                parameterEntry.combined = thresholdState.combined;
              }
              thresholdState.by_parameter[p] = parameterEntry;
            } catch { /* ignore */ }
          }

          // Keep the realized adaptive value on the data for analysis.
          if (data && typeof data === 'object') {
            data.adaptive_mode = adaptiveMeta.mode;
            data.adaptive_parameter = p;
            data.adaptive_value = realizedAdaptiveValue;
          }
        };
      }

      // dot-groups helpers
      if (baseType === 'rdm-dot-groups') {
        if (Number.isFinite(t.group_1_percentage)) {
          const g1 = Math.max(0, Math.min(100, Math.round(t.group_1_percentage)));
          t.group_1_percentage = g1;
          t.group_2_percentage = 100 - g1;
        }

        if (dependentDotGroupDirectionsEnabled) {
          const normalizeDirection = (raw) => {
            const n = Number(raw);
            if (!Number.isFinite(n)) return null;
            return ((n % 360) + 360) % 360;
          };

          const sampledBaseDirection = normalizeDirection(
            t.dependent_group_1_direction !== undefined ? t.dependent_group_1_direction : sampleFromValues(values.dependent_group_1_direction)
          );
          const sampledDifference = normalizeDirection(
            t.dependent_group_direction_difference !== undefined ? t.dependent_group_direction_difference : sampleFromValues(values.dependent_group_direction_difference)
          );

          if (sampledBaseDirection !== null) {
            t.group_1_direction = sampledBaseDirection;
          }
          if (sampledBaseDirection !== null && sampledDifference !== null) {
            t.group_2_direction = (sampledBaseDirection + sampledDifference) % 360;
          }

          delete t.dependent_group_1_direction;
          delete t.dependent_group_direction_difference;
          delete t.dependent_direction_of_movement_enabled;
        }
      }

      // Per-block response override
      if (isObject(block.response_parameters_override)) {
        t.response_parameters_override = { ...block.response_parameters_override };
      }

      // Per-trial transition info (continuous mode)
      if (Number.isFinite(values.transition_duration)) {
        t.transition_duration = values.transition_duration;
      }
      if (typeof values.transition_type === 'string') {
        t.transition_type = values.transition_type;
      }

      trials.push(t);
    }

    if (baseType === 'gabor-trial' || baseType === 'gabor-quest') {
      applyGaborBlockCounterbalance(trials);
    }

    return trials;
  }

  function expandTimeline(rawTimeline, opts, level = 0) {
    const inTl = Array.isArray(rawTimeline) ? rawTimeline : [];
    const out = [];

    const shuffleInPlace = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };

    const normalizeLoopIterations = (raw) => {
      const n = Number.parseInt(raw ?? '', 10);
      if (!Number.isFinite(n)) return 1;
      return Math.max(1, Math.min(10000, n));
    };

    const normalizeLoopTreeFromMarkers = (list) => {
      const src = Array.isArray(list) ? list : [];
      const root = [];
      const stack = [{ items: root, markerType: null, markerId: null }];

      const toMarkerId = (raw) => (raw ?? '').toString().trim();

      const closeMarker = (markerType, markerId) => {
        if (stack.length <= 1) return;

        if (!markerId) {
          for (let i = stack.length - 1; i >= 1; i--) {
            if ((stack[i].markerType || '') === markerType) {
              while (stack.length - 1 >= i) stack.pop();
              return;
            }
          }
          return;
        }

        let matchedIndex = -1;
        for (let i = stack.length - 1; i >= 1; i--) {
          if ((stack[i].markerType || '') === markerType && (stack[i].markerId || '') === markerId) {
            matchedIndex = i;
            break;
          }
        }
        if (matchedIndex === -1) return;
        while (stack.length - 1 >= matchedIndex) {
          stack.pop();
        }
      };

      for (const item of src) {
        if (!isObject(item)) continue;
        const t = (item.type ?? '').toString();

        if (t === 'loop-start') {
          const loopId = toMarkerId(item.loop_id);
          const loopNode = {
            type: 'loop',
            ...(loopId ? { loop_id: loopId } : {}),
            iterations: normalizeLoopIterations(item.iterations ?? item.loop_iterations ?? 1),
            items: []
          };
          if (item.label !== undefined && item.label !== null && item.label !== '') {
            loopNode.label = item.label;
          }
          stack[stack.length - 1].items.push(loopNode);
          stack.push({ items: loopNode.items, markerType: 'loop', markerId: loopId });
          continue;
        }

        if (t === 'loop-end') {
          closeMarker('loop', toMarkerId(item.loop_id));
          continue;
        }

        if (t === 'randomize-start') {
          const randomId = toMarkerId(item.random_group_id ?? item.group_id ?? item.loop_id);
          const randomNode = {
            type: 'randomize-group',
            randomizable_across_markers: item.randomizable_across_markers !== false,
            ...(randomId ? { random_group_id: randomId } : {}),
            items: []
          };
          stack[stack.length - 1].items.push(randomNode);
          stack.push({ items: randomNode.items, markerType: 'randomize', markerId: randomId });
          continue;
        }

        if (t === 'randomize-end') {
          closeMarker('randomize', toMarkerId(item.random_group_id ?? item.group_id ?? item.loop_id));
          continue;
        }

        stack[stack.length - 1].items.push(item);
      }

      return root;
    };

    const inTlNormalized = normalizeLoopTreeFromMarkers(inTl);

    const preserveFor = (() => {
      const list = (opts && Array.isArray(opts.preserveBlocksForComponentTypes)) ? opts.preserveBlocksForComponentTypes : [];
      return new Set(list.map(x => (x ?? '').toString().trim()).filter(Boolean));
    })();

    const sampleMwProbeIntervalMs = (probeItem) => {
      const minRaw = Number(probeItem && probeItem.min_interval_ms);
      const maxRaw = Number(probeItem && probeItem.max_interval_ms);
      const minMs = Number.isFinite(minRaw) ? Math.max(0, minRaw) : 0;
      const maxMs = Number.isFinite(maxRaw) ? Math.max(0, maxRaw) : minMs;
      const lo = Math.min(minMs, maxMs);
      const hi = Math.max(minMs, maxMs);
      return Math.round(lo + Math.random() * (hi - lo));
    };

    const estimateTrialDurationMs = (trial) => {
      if (!isObject(trial)) return 0;

      const candidates = [
        trial.trial_duration_ms,
        trial.trial_duration,
        trial.duration_ms,
        trial.stimulus_duration_ms,
        trial.stimulus_duration
      ];

      for (const raw of candidates) {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) return n;
      }

      const stimMs = Number(trial.stimulus_duration_ms);
      const isiMs = Number(trial.isi_duration_ms);
      if (Number.isFinite(stimMs) && stimMs > 0 && Number.isFinite(isiMs) && isiMs >= 0) {
        return stimMs + isiMs;
      }

      const fallback = Number(opts && opts.defaultGeneratedTrialDurationMs);
      if (Number.isFinite(fallback) && fallback > 0) return fallback;

      return 0;
    };

    const chunkItemsForShuffle = (items) => {
      const src = Array.isArray(items) ? items : [];
      const chunks = [];

      for (let i = 0; i < src.length;) {
        const current = src[i];
        const currentType = isObject(current) ? String(current.type || '') : '';

        // Keep explicit DRT segments atomic when randomizing. This prevents
        // start/stop controls from being separated by shuffle operations.
        if (currentType === 'detection-response-task-start') {
          const chunk = [current];
          let j = i + 1;
          for (; j < src.length; j++) {
            const candidate = src[j];
            chunk.push(candidate);
            const candidateType = isObject(candidate) ? String(candidate.type || '') : '';
            if (candidateType === 'detection-response-task-stop') {
              j += 1;
              break;
            }
          }
          chunks.push(chunk);
          i = j;
          continue;
        }

        chunks.push([current]);
        i += 1;
      }

      return chunks;
    };

    const isInstructionLikeItem = (item) => {
      if (!isObject(item)) return false;
      const type = String(item.type || '').trim().toLowerCase();
      if (type === 'instructions') return true;
      if (type === 'html-keyboard-response') {
        const pluginType = String(item?.data?.plugin_type || '').trim().toLowerCase();
        if (pluginType === 'instructions' || pluginType === 'eye-tracking-calibration-instructions') return true;

        // Builder "Instructions" components are emitted as html-keyboard-response
        // and may only carry the auto-generated flag (without plugin_type).
        if (item?.auto_generated === true || item?.data?.auto_generated === true) return true;
      }
      return false;
    };

    const isInstructionLikeChunk = (chunk) => {
      const items = Array.isArray(chunk) ? chunk : [];
      if (!items.length) return false;
      return items.some((it) => isInstructionLikeItem(it));
    };

    const shuffleChunksPreservingInstructionLike = (chunks) => {
      const src = Array.isArray(chunks) ? chunks : [];
      const outChunks = [];
      let run = [];

      const flushRun = () => {
        if (!run.length) return;
        outChunks.push(...shuffleInPlace(run.slice()));
        run = [];
      };

      for (const chunk of src) {
        if (isInstructionLikeChunk(chunk)) {
          flushRun();
          outChunks.push(chunk);
        } else {
          run.push(chunk);
        }
      }
      flushRun();
      return outChunks;
    };

    const globalRandomizeOrder = (opts && opts.globalRandomizeOrder === true && level === 0);
    const topLevelChunks = chunkItemsForShuffle(inTlNormalized);
    const orderedTopLevelChunks = globalRandomizeOrder
      ? shuffleChunksPreservingInstructionLike(topLevelChunks)
      : topLevelChunks;

    const isPoolableSiblingRandomizeGroup = (node) => {
      if (!isObject(node)) return false;
      const t = String(node.type || '');
      if (t !== 'randomize-group' && t !== 'randomize-across-markers') return false;
      return node.randomizable_across_markers !== false;
    };

    const expandSingleItem = (item) => {
      if (!isObject(item)) return;

      if (item.type === 'loop') {
        const iterations = normalizeLoopIterations(item.iterations ?? item.loop_iterations ?? 1);
        const childItems = Array.isArray(item.items)
          ? item.items
          : (Array.isArray(item.timeline)
            ? item.timeline
            : (Array.isArray(item.components) ? item.components : []));

        for (let i = 0; i < iterations; i++) {
          out.push(...expandTimeline(childItems, opts, level + 1));
        }
        return;
      }

      if (item.type === 'randomize-group' || item.type === 'randomize-across-markers') {
        const childItems = Array.isArray(item.items)
          ? item.items
          : (Array.isArray(item.timeline)
            ? item.timeline
            : (Array.isArray(item.components) ? item.components : []));

        const childChunks = chunkItemsForShuffle(childItems).map((chunk) => expandTimeline(chunk, opts, level + 1));
        const shouldShuffle = item.randomizable_across_markers !== false;
        const orderedChildChunks = shouldShuffle
          ? shuffleChunksPreservingInstructionLike(childChunks)
          : childChunks;
        for (const expandedChunk of orderedChildChunks) {
          out.push(...expandedChunk);
        }
        return;
      }

      if (item.type === 'nback-trial-sequence') {
        const expandNback = opts && opts.expandNbackSequences === true;
        if (expandNback) {
          out.push(...expandNbackTrialSequence(item, opts));
        } else {
          out.push(item);
        }
        return;
      }

      if (item.type === 'block') {
        const baseType = (typeof item.component_type === 'string' && item.component_type.trim())
          ? item.component_type.trim()
          : (typeof item.block_component_type === 'string' && item.block_component_type.trim())
            ? item.block_component_type.trim()
            : 'rdm-trial';

        if (preserveFor.has(baseType)) {
          out.push(item);
        } else {
          out.push(...expandBlock(item, opts));
        }
        return;
      }

      out.push(item);
    };

    const orderedSiblingItems = [];
    for (const topChunk of orderedTopLevelChunks) {
      for (const item of topChunk) orderedSiblingItems.push(item);
    }

    for (let i = 0; i < orderedSiblingItems.length; i++) {
      const item = orderedSiblingItems[i];
      if (!isPoolableSiblingRandomizeGroup(item)) {
        expandSingleItem(item);
        continue;
      }

      const pooledExpandedChunks = [];
      let j = i;
      for (; j < orderedSiblingItems.length && isPoolableSiblingRandomizeGroup(orderedSiblingItems[j]); j++) {
        const groupNode = orderedSiblingItems[j];
        const groupChildItems = Array.isArray(groupNode.items)
          ? groupNode.items
          : (Array.isArray(groupNode.timeline)
            ? groupNode.timeline
            : (Array.isArray(groupNode.components) ? groupNode.components : []));
        const groupChunks = chunkItemsForShuffle(groupChildItems).map((chunk) => expandTimeline(chunk, opts, level + 1));
        for (const expandedChunk of groupChunks) {
          pooledExpandedChunks.push(expandedChunk);
        }
      }

      const shuffledPool = shuffleChunksPreservingInstructionLike(pooledExpandedChunks);
      for (const expandedChunk of shuffledPool) {
        out.push(...expandedChunk);
      }

      i = j - 1;
    }

    // mw-probe jitter scheduling:
    // Place probes inside surrounding generated block trials (before and/or after
    // the marker position), so each loop iteration can sample a fresh interruption point.
    for (let i = 0; i < out.length; i++) {
      const probe = out[i];
      if (!isObject(probe) || probe.type !== 'mw-probe') continue;

      const maxRaw = Number(probe.max_interval_ms);
      const minRaw = Number(probe.min_interval_ms);
      const maxMs = Number.isFinite(maxRaw) ? Math.max(0, maxRaw) : (Number.isFinite(minRaw) ? Math.max(0, minRaw) : 0);

      // Anchor each probe to ONE neighboring generated run so probes are not
      // pooled across two blocks when the marker sits at a boundary.
      const prevIdx = [];
      for (let k = i - 1; k >= 0; k--) {
        const candidate = out[k];
        if (!isObject(candidate) || candidate._generated_from_block !== true) break;
        prevIdx.push(k);
      }
      prevIdx.reverse();

      const nextIdx = [];
      for (let k = i + 1; k < out.length; k++) {
        const candidate = out[k];
        if (!isObject(candidate) || candidate._generated_from_block !== true) break;
        nextIdx.push(k);
      }

      // When a probe marker sits between two generated runs (common with looped
      // "probe -> block" patterns), prefer anchoring to the following run so
      // each iteration keeps its own probe instead of drifting into the previous loop.
      const generatedIdx = nextIdx.length > 0 ? nextIdx : prevIdx;
      let totalDurationMs = 0;
      for (const k of generatedIdx) {
        const trial = out[k];
        if (!isObject(trial)) continue;
        totalDurationMs += estimateTrialDurationMs(trial);
      }

      if (!generatedIdx.length) continue;

      let targetMs;
      if (maxMs > 0) {
        targetMs = sampleMwProbeIntervalMs(probe);
      } else if (totalDurationMs > 0) {
        // Default behavior when min/max are 0: sample around the middle half
        // of the surrounding generated run to avoid edge-biased probe placement.
        const lo = totalDurationMs * 0.25;
        const hi = totalDurationMs * 0.75;
        targetMs = Math.round(lo + Math.random() * Math.max(0, hi - lo));
      } else {
        targetMs = null;
      }

      let insertAt;
      if (targetMs === null) {
        const pick = generatedIdx[Math.floor(Math.random() * generatedIdx.length)];
        insertAt = Number.isFinite(pick) ? pick : generatedIdx[generatedIdx.length - 1];
      } else {
        let accMs = 0;
        insertAt = generatedIdx[generatedIdx.length - 1];
        for (const k of generatedIdx) {
          accMs += estimateTrialDurationMs(out[k]);
          if (accMs >= targetMs) {
            insertAt = k;
            break;
          }
        }
      }

      out.splice(i, 1);
      if (insertAt > i) insertAt -= 1;
      out.splice(insertAt, 0, probe);

      i = insertAt;
    }

    // If an MW probe lands inside an active DRT segment, auto-bracket it with
    // DRT stop/start so researchers do not need to manually split every segment.
    // The restarted DRT start inherits parameters from the active start marker.
    const withAutoDrtMwBracketing = [];
    let drtActive = false;
    let activeDrtStart = null;
    for (const item of out) {
      if (!isObject(item)) {
        withAutoDrtMwBracketing.push(item);
        continue;
      }

      const t = (item.type ?? '').toString();

      if (t === 'detection-response-task-start') {
        drtActive = true;
        activeDrtStart = { ...item };
        withAutoDrtMwBracketing.push(item);
        continue;
      }

      if (t === 'detection-response-task-stop') {
        drtActive = false;
        withAutoDrtMwBracketing.push(item);
        continue;
      }

      if (t === 'mw-probe' && drtActive && activeDrtStart) {
        withAutoDrtMwBracketing.push({
          type: 'detection-response-task-stop',
          _auto_inserted_for_mw_probe: true
        });

        withAutoDrtMwBracketing.push(item);

        withAutoDrtMwBracketing.push({
          ...activeDrtStart,
          type: 'detection-response-task-start',
          _auto_inserted_for_mw_probe: true
        });

        drtActive = true;
        continue;
      }

      withAutoDrtMwBracketing.push(item);
    }

    return withAutoDrtMwBracketing;
  }

  function compileToJsPsychTimeline(config) {
    if (!isObject(config)) throw new Error('Config must be an object');

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

    function wrapMaybeFunctionStimulus(stimulus, prompt) {
      const stimIsFn = typeof stimulus === 'function';
      const promptIsFn = typeof prompt === 'function';
      if (!stimIsFn && !promptIsFn) {
        const s = (stimulus === null || stimulus === undefined) ? '' : stimulus;
        const p = (prompt === undefined ? null : prompt);
        return wrapPsyScreenHtml(s, p);
      }

      return function () {
        let s = stimulus;
        let p = prompt;
        try { if (typeof s === 'function') s = s(); } catch { /* ignore */ }
        try { if (typeof p === 'function') p = p(); } catch { /* ignore */ }
        const ss = (s === null || s === undefined) ? '' : s;
        const pp = (p === undefined ? null : p);
        return wrapPsyScreenHtml(ss, pp);
      };
    }

    function normalizeKeyChoices(raw) {
      if (raw === undefined || raw === null) return 'ALL_KEYS';
      if (Array.isArray(raw)) return raw;
      const s = String(raw).trim();
      if (!s) return 'ALL_KEYS';
      const upper = s.toUpperCase();
      if (upper === 'ALL_KEYS' || upper === 'NO_KEYS') return upper;
      const parts = s
        .split(/[\s,]+/)
        .map(x => x.trim())
        .filter(Boolean);
      return parts.length > 0 ? parts : 'ALL_KEYS';
    }

    function normalizeButtonChoices(raw) {
      if (raw === undefined || raw === null) return [];
      if (Array.isArray(raw)) return raw.map(x => String(x));
      const s = String(raw);
      return s
        .split(/[\n,]+/)
        .map(x => x.trim())
        .filter(Boolean);
    }

    function buildMwProbeOnStartHook() {
      return (trial) => {
        let drtRunningAtProbeStart = false;
        try {
          drtRunningAtProbeStart = !!(
            window.DrtEngine
            && typeof window.DrtEngine.isRunning === 'function'
            && window.DrtEngine.isRunning()
          );
        } catch {
          drtRunningAtProbeStart = false;
        }

        if (drtRunningAtProbeStart) {
          console.warn('[TimelineCompiler] MW probe started while DRT is active. Prefer explicit DRT stop/start around MW probes for deterministic behavior.');
        }

        if (trial && typeof trial === 'object') {
          trial.data = isObject(trial.data) ? trial.data : {};
          trial.data.drt_running_at_probe_start = drtRunningAtProbeStart;
        }
      };
    }

    function resolveMaybeRelativeUrl(rawUrl) {
      const u = (rawUrl === null || rawUrl === undefined) ? '' : String(rawUrl).trim();
      if (!u) return '';
      // asset:// refs are Builder-only; they must be rewritten at export time.
      if (/^asset:\/\//i.test(u)) return '';
      if (/^(https?:|data:|blob:)/i.test(u)) return u;

      const src = (config && typeof config.__source_url === 'string') ? config.__source_url : '';
      if (!src) return u;

      try {
        // src can be relative (e.g., "configs/ABC1234.json"), so first make it absolute.
        const absSrc = new URL(src, window.location.href).toString();
        return new URL(u, absSrc).toString();
      } catch {
        return u;
      }
    }

    function resolvePlugin(p) {
      if (typeof p === 'function') return p;
      if (p && typeof p === 'object' && typeof p.default === 'function') return p.default;
      return null;
    }

    function requirePlugin(name, maybePlugin) {
      const resolved = resolvePlugin(maybePlugin);
      if (!resolved) {
        throw new Error(`Missing required plugin: ${name}`);
      }
      return resolved;
    }

    // html-keyboard-response comes from an external jsPsych plugin package.
    // Depending on bundling, it may be a function or an object with a `default` export.
    const HtmlKeyboardResponsePlugin = resolvePlugin(
      (typeof jsPsychHtmlKeyboardResponse !== 'undefined') ? jsPsychHtmlKeyboardResponse : null
    ) || resolvePlugin(window.jsPsychHtmlKeyboardResponse);

    const HtmlKeyboard = requirePlugin('html-keyboard-response (jsPsychHtmlKeyboardResponse)', HtmlKeyboardResponsePlugin);

    const HtmlButtonResponsePlugin = resolvePlugin(
      (typeof jsPsychHtmlButtonResponse !== 'undefined') ? jsPsychHtmlButtonResponse : null
    ) || resolvePlugin(window.jsPsychHtmlButtonResponse);

    const experimentType = config.experiment_type || 'trial-based';
    const taskType = config.task_type || 'rdm';

    const baseRdmParams = normalizeRdmParams({
      ...(isObject(config.display_settings) ? config.display_settings : {}),
      ...(isObject(config.display_parameters) ? config.display_parameters : {}),
      ...(isObject(config.aperture_parameters) ? config.aperture_parameters : {}),
      ...(isObject(config.dot_parameters) ? config.dot_parameters : {}),
      ...(isObject(config.motion_parameters) ? config.motion_parameters : {}),
      ...(isObject(config.timing_parameters) ? config.timing_parameters : {}),

      // Continuous-mode meta (not all runtimes will use these yet, but keep them available)
      ...(Number.isFinite(config.frame_rate) ? { frame_rate: config.frame_rate } : {}),
      ...(Number.isFinite(config.duration) ? { duration: config.duration } : {}),
      ...(Number.isFinite(config.update_interval) ? { update_interval: config.update_interval } : {})
    });

    const responseDefaults = isObject(config.response_parameters) ? config.response_parameters : {};
    const dataCollection = normalizeDataCollection(config.data_collection);

    const defaultTransition = isObject(config.transition_settings) ? config.transition_settings : { duration_ms: 0, type: 'both' };

    const gaborDefaults = isObject(config.gabor_settings) ? config.gabor_settings : {};
    const stroopDefaults = isObject(config.stroop_settings) ? config.stroop_settings : {};
    const emotionalStroopDefaults = isObject(config.emotional_stroop_settings) ? config.emotional_stroop_settings : {};
    const simonDefaults = isObject(config.simon_settings) ? config.simon_settings : {};
    const taskSwitchingDefaults = isObject(config.task_switching_settings) ? config.task_switching_settings : {};
    const pvtDefaults = isObject(config.pvt_settings) ? config.pvt_settings : {};
    const nbackDefaults = isObject(config.nback_settings) ? config.nback_settings : {};

    const resolveNbackResponseDevice = (raw) => {
      const d = (raw ?? 'inherit').toString().trim().toLowerCase();
      if (!d || d === 'inherit') {
        const def = (nbackDefaults.response_device ?? 'keyboard').toString().trim().toLowerCase();
        return (def === 'mouse' || def === 'keyboard') ? def : 'keyboard';
      }
      return (d === 'mouse' || d === 'keyboard') ? d : 'keyboard';
    };

    const baseIti = (() => {
      const tp = isObject(config.timing_parameters) ? config.timing_parameters : {};
      const iti = Number(tp.inter_trial_interval ?? config.default_iti ?? 0);
      return Number.isFinite(iti) ? iti : 0;
    })();

    const preservePvtBlocks = (pvtDefaults && pvtDefaults.add_trial_per_false_start === true);
    const preserveNbackBlocks = (experimentType === 'continuous' && taskType === 'nback');
    const preserveBlocksFor = [
      ...(preservePvtBlocks ? ['pvt-trial'] : []),
      ...(preserveNbackBlocks ? ['nback-block', 'nback', 'nback-trial-sequence'] : []),
      'gabor-learning'
    ];

    const defaultGeneratedTrialDurationMs = (() => {
      const tp = isObject(config.timing_parameters) ? config.timing_parameters : {};
      const candidates = [
        tp.response_deadline,
        tp.stimulus_duration,
        tp.trial_duration,
        config.default_trial_duration,
        config.update_interval
      ];
      for (const raw of candidates) {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) return n;
      }
      return 1000;
    })();

    const blockLengthOpts = {
      experimentType,
      frameRate: Number(config.frame_rate),
      experimentDurationSeconds: Number(config.duration)
    };

    const expandedRaw = expandTimeline(config.timeline, {
      preserveBlocksForComponentTypes: preserveBlocksFor,
      expandNbackSequences: experimentType === 'trial-based',
      defaultGeneratedTrialDurationMs,
      globalRandomizeOrder: config.randomize_order === true,
      nbackDefaults,
      taskSwitchingDefaults,
      ...blockLengthOpts
    });

    // SOC Dashboard: the Builder has "helper" component types (`soc-subtask-*`, `soc-dashboard-icon`) that are
    // intended to be composed into a single `soc-dashboard` session at export time.
    // If a config reaches the Interpreter without an explicit `soc-dashboard` session container, running the
    // helper items as separate timeline trials will always look sequential (one SOC desktop per trial).
    //
    // To be resilient to such exports, auto-compose these helper items into one `soc-dashboard` trial.
    const socDefaultsGlobal = isObject(config.soc_dashboard_settings) ? config.soc_dashboard_settings : null;

    let expanded = (() => {
      if (taskType !== 'soc-dashboard') return expandedRaw;
      const tl = Array.isArray(expandedRaw) ? expandedRaw : [];
      const hasSession = tl.some((it) => it && typeof it === 'object' && it.type === 'soc-dashboard');
      if (hasSession) return tl;

      const isSocSubtaskType = (t) => {
        return t === 'soc-subtask-sart-like'
          || t === 'soc-subtask-nback-like'
          || t === 'soc-subtask-flanker-like'
          || t === 'soc-subtask-wcst-like'
          || t === 'soc-subtask-pvt-like'
          || t === 'mw-probe';
      };

      const mapSocSubtaskKind = (t) => {
        switch (t) {
          case 'soc-subtask-sart-like': return 'sart-like';
          case 'soc-subtask-nback-like': return 'nback-like';
          case 'soc-subtask-flanker-like': return 'flanker-like';
          case 'soc-subtask-wcst-like': return 'wcst-like';
          case 'soc-subtask-pvt-like': return 'pvt-like';
          case 'mw-probe': return 'mw-probe';
          default: return 'unknown';
        }
      };

      const extractSubtaskParams = (rawItem) => {
        const o = (rawItem && typeof rawItem === 'object') ? rawItem : {};
        const out = {};
        for (const [k, v] of Object.entries(o)) {
          if (k === 'type' || k === 'name' || k === 'title' || k === 'parameters' || k === 'data') continue;
          out[k] = v;
        }
        return out;
      };

      const subtasks = [];
      const icons = [];
      let insertAt = -1;

      for (let i = 0; i < tl.length; i++) {
        const item = tl[i];
        if (!item || typeof item !== 'object') continue;
        const t = item.type;
        if (t === 'soc-dashboard-icon') {
          if (insertAt < 0) insertAt = i;
          icons.push({
            label: (item.label || item.name || 'Icon').toString(),
            app: (item.app || 'soc').toString(),
            icon_text: (item.icon_text || '').toString(),
            row: Number.isFinite(Number(item.row)) ? parseInt(item.row, 10) : 0,
            col: Number.isFinite(Number(item.col)) ? parseInt(item.col, 10) : 0,
            distractor: (item.distractor !== undefined) ? !!item.distractor : true
          });
          continue;
        }
        if (isSocSubtaskType(t)) {
          if (insertAt < 0) insertAt = i;
          subtasks.push({
            type: mapSocSubtaskKind(t),
            title: (item.title || item.name || mapSocSubtaskKind(t) || 'Subtask').toString(),
            ...extractSubtaskParams(item)
          });
        }
      }

      if (insertAt < 0 || (subtasks.length === 0 && icons.length === 0)) return tl;

      // If the SOC defaults don't specify duration, infer it from the scheduled subtasks.
      const inferSessionDurationMs = () => {
        let maxEnd = 0;
        for (const s of subtasks) {
          const start = Number.isFinite(Number(s.start_at_ms)) ? Number(s.start_at_ms)
            : (Number.isFinite(Number(s.start_delay_ms)) ? Number(s.start_delay_ms) : 0);
          let end = null;
          if (Number.isFinite(Number(s.duration_ms)) && Number(s.duration_ms) > 0) {
            end = start + Number(s.duration_ms);
          } else if (Number.isFinite(Number(s.end_at_ms)) && Number(s.end_at_ms) > 0) {
            end = Number(s.end_at_ms);
          }
          if (Number.isFinite(end) && end > maxEnd) maxEnd = end;
        }
        return maxEnd > 0 ? Math.ceil(maxEnd) : null;
      };

      const inferredDuration = inferSessionDurationMs();
      const session = {
        type: 'soc-dashboard',
        // Leave most fields to socDefaultsGlobal merge at compile time.
        ...(inferredDuration !== null ? { trial_duration_ms: inferredDuration } : {}),
        ...(subtasks.length ? { subtasks } : {}),
        ...(icons.length ? { desktop_icons: icons } : {}),
        ...(socDefaultsGlobal && socDefaultsGlobal.num_tasks === undefined ? { num_tasks: subtasks.length || icons.length || 1 } : {})
      };

      const out = [];
      for (let i = 0; i < tl.length; i++) {
        if (i === insertAt) out.push(session);

        const item = tl[i];
        if (!item || typeof item !== 'object') {
          out.push(item);
          continue;
        }

        const t = item.type;
        if (t === 'soc-dashboard-icon' || isSocSubtaskType(t)) {
          continue; // absorbed into session
        }

        out.push(item);
      }

      return out;
    })();

    // Rewards activation normalization:
    // - Builder exports a top-level `reward_settings.enabled` flag.
    // - Rewards policy is defined by a `reward-settings` timeline component.
    // To be resilient to hand-edited / legacy configs, treat `reward_settings.enabled` as a master switch:
    //   - enabled === true  => ensure a reward-settings component exists and runs first
    //   - enabled === false => ignore/remove any reward-settings components
    const rewardSettingsCfg = isObject(config.reward_settings) ? config.reward_settings : null;
    const rewardsEnabledFlag = (rewardSettingsCfg && typeof rewardSettingsCfg.enabled === 'boolean') ? rewardSettingsCfg.enabled : null;
    const rewardSettingsOverrides = (() => {
      if (!rewardSettingsCfg) return null;
      const o = { ...rewardSettingsCfg };
      delete o.enabled;
      return Object.keys(o).length ? o : null;
    })();

    if (rewardsEnabledFlag !== null) {
      const tl = Array.isArray(expanded) ? expanded : [];
      const isRewardSettingsItem = (it) => it && typeof it === 'object' && it.type === 'reward-settings';
      const firstRewardSettings = tl.find(isRewardSettingsItem) || null;
      const rest = tl.filter((it) => !isRewardSettingsItem(it));

      if (rewardsEnabledFlag === true) {
        const base = firstRewardSettings ? { ...firstRewardSettings } : { type: 'reward-settings' };
        expanded = [{ ...base, ...(rewardSettingsOverrides ? rewardSettingsOverrides : {}) }, ...rest];
      } else {
        expanded = rest;
      }
    }

    const timeline = [];

    // Rewards (optional): configured by a reward-settings timeline component.
    let rewardsPolicy = null;
    let rewardsStoreKey = '__psy_rewards';

    const normBoolFromData = (v) => {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v > 0;
      if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === 'true' || s === '1' || s === 'yes') return true;
        if (s === 'false' || s === '0' || s === 'no') return false;
      }
      return null;
    };

    const getRtMsFromData = (data) => {
      if (!data || typeof data !== 'object') return null;
      const a = Number(data.rt_ms);
      if (Number.isFinite(a) && a >= 0) return a;
      const b = Number(data.rt);
      if (Number.isFinite(b) && b >= 0) return b;
      return null;
    };

    const getCorrectFromData = (data) => {
      if (!data || typeof data !== 'object') return null;
      if (Object.prototype.hasOwnProperty.call(data, 'correctness')) return normBoolFromData(data.correctness);
      if (Object.prototype.hasOwnProperty.call(data, 'correct')) return normBoolFromData(data.correct);
      if (Object.prototype.hasOwnProperty.call(data, 'accuracy')) return normBoolFromData(data.accuracy);
      return null;
    };

    const scoringBasisLabel = (basis) => {
      const b = (basis || '').toString().trim().toLowerCase();
      if (b === 'reaction_time') return 'Reaction time';
      if (b === 'accuracy') return 'Accuracy';
      if (b === 'both') return 'Accuracy + reaction time';
      return basis || 'both';
    };

    const continueKeyLabel = (k) => {
      const key = (k || 'space').toString();
      if (key === ' ') return 'SPACE';
      if (key.toLowerCase() === 'space') return 'SPACE';
      if (key.toLowerCase() === 'enter') return 'ENTER';
      if (key === 'ALL_KEYS') return 'ANY KEY';
      return key.toUpperCase();
    };

    const renderTemplate = (tpl, vars) => {
      const raw = (tpl ?? '').toString();
      return raw.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
        const v = Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : '';
        return (v === null || v === undefined) ? '' : String(v);
      });
    };

    const normalizeRewardScreen = (raw, legacyTitle, legacyTpl) => {
      const s = (raw && typeof raw === 'object') ? raw : {};
      return {
        title: ((s.title ?? legacyTitle ?? '') || '').toString(),
        template_html: ((s.template_html ?? s.html ?? legacyTpl ?? '') || '').toString(),
        image_url: ((s.image_url ?? '') || '').toString(),
        audio_url: ((s.audio_url ?? '') || '').toString()
      };
    };

    const resolveRewardMediaUrl = (maybeUrl) => {
      const u = (maybeUrl ?? '').toString().trim();
      if (!u) return '';
      return resolveMaybeRelativeUrl(u) || u;
    };

    const playRewardAudio = (maybeUrl) => {
      const u = resolveRewardMediaUrl(maybeUrl);
      if (!u) return;
      try {
        const a = new Audio(u);
        a.preload = 'auto';
        // Autoplay may be blocked; ignore failures.
        a.play().catch(() => {});
      } catch {
        // ignore
      }
    };

    const renderRewardScreenHtml = (screen, vars, { titleFallback } = {}) => {
      const scr = (screen && typeof screen === 'object') ? screen : {};
      const title = (scr.title || titleFallback || 'Rewards').toString();
      const tpl = (scr.template_html || '').toString();
      const body = tpl ? renderTemplate(tpl, vars) : '';
      const imageUrl = resolveRewardMediaUrl(scr.image_url);
      const audioUrl = resolveRewardMediaUrl(scr.audio_url);

      const imgHtml = imageUrl
        ? `<div style="margin: 12px 0;"><img src="${escapeHtml(imageUrl)}" alt="reward media" style="max-width:100%; max-height: 45vh; object-fit: contain;" /></div>`
        : '';

      const audioHtml = audioUrl
        ? `<div style="margin: 12px 0;"><audio controls src="${escapeHtml(audioUrl)}" style="width: 100%;"></audio></div>`
        : '';

      return `
        <div class="psy-wrap">
          <div class="psy-stage">
            <div class="psy-text">
              <h2 style="margin:0 0 8px 0;">${escapeHtml(title)}</h2>
              ${imgHtml}
              <div>${body}</div>
              ${audioHtml}
            </div>
          </div>
        </div>
      `;
    };

    const isRewardSuccess = (event, policy) => {
      const p = (policy && typeof policy === 'object') ? policy : {};
      // If the trial explicitly marked reward as unavailable (e.g. Gabor value-cue
      // learning where the cue on the target side has 0% reward probability on this
      // trial), no points are awarded regardless of accuracy or RT.
      if (event.reward_available === false) return false;
      const basis = (p.scoring_basis || 'both').toString().trim().toLowerCase();
      const rtThresh = Number(p.rt_threshold_ms);

      const rtOk = Number.isFinite(rtThresh)
        ? (event.rt_ms !== null && event.rt_ms !== undefined && Number(event.rt_ms) <= rtThresh)
        : true;

      const correctOk = (event.correct === true);
      const correctKnown = (event.correct === true || event.correct === false);
      const requireCorrectForRt = p.require_correct_for_rt === true;

      if (basis === 'accuracy') {
        return correctOk;
      }
      if (basis === 'reaction_time') {
        return rtOk && (!requireCorrectForRt || !correctKnown || correctOk);
      }
      // both
      return correctOk && rtOk;
    };

    const computeRewardPoints = (event, policy) => {
      const p = (policy && typeof policy === 'object') ? policy : {};
      const points = Number(p.points_per_success);
      if (!isRewardSuccess(event, p)) return 0;
      return Number.isFinite(points) ? points : 0;
    };

    const recordRewardEvent = (data, pluginType) => {
      if (!rewardsPolicy) return null;
      const storeKey = rewardsStoreKey;
      try {
        const bag = window[storeKey];
        if (!bag || bag.enabled !== true) return null;
        const policy = (bag.policy && typeof bag.policy === 'object') ? bag.policy : rewardsPolicy;
        const state = (bag.state && typeof bag.state === 'object') ? bag.state : (bag.state = {});
        const events = Array.isArray(state.events) ? state.events : (state.events = []);

        const evt = {
          plugin_type: pluginType || null,
          rt_ms: getRtMsFromData(data),
          correct: getCorrectFromData(data),
          // If the trial tagged reward_available (Gabor cue-learning), carry it through
          // so isRewardSuccess can gate points on whether the cue offered a reward.
          reward_available: (typeof data.reward_available === 'boolean') ? data.reward_available : undefined
        };

        events.push(evt);
        state.eligible_trials = events.length;

        // Keep state updated every trial (needed for milestone triggers).
        const pts = computeRewardPoints(evt, policy);
        const success = isRewardSuccess(evt, policy);

        state.total_points = Number.isFinite(Number(state.total_points)) ? Number(state.total_points) : 0;
        state.rewarded_trials = Number.isFinite(Number(state.rewarded_trials)) ? Number(state.rewarded_trials) : 0;
        state.success_streak = Number.isFinite(Number(state.success_streak)) ? Number(state.success_streak) : 0;

        state.total_points += pts;
        if (pts > 0) state.rewarded_trials += 1;
        state.success_streak = success ? (state.success_streak + 1) : 0;
        evt.reward_points = pts;

        // Milestone queueing
        const queue = Array.isArray(state.screen_queue) ? state.screen_queue : (state.screen_queue = []);
        const shown = (state.milestones_shown && typeof state.milestones_shown === 'object')
          ? state.milestones_shown
          : (state.milestones_shown = {});

        const ms = Array.isArray(policy.milestones) ? policy.milestones : [];
        for (let i = 0; i < ms.length; i++) {
          const m0 = ms[i];
          if (!m0 || typeof m0 !== 'object') continue;
          const id = (m0.id ?? `m${i + 1}`).toString();
          if (shown[id]) continue;

          const trigger = (m0.trigger_type ?? m0.trigger ?? 'trial_count').toString();
          const threshold = Number(m0.threshold ?? m0.value);
          if (!Number.isFinite(threshold) || threshold <= 0) continue;

          let achieved = false;
          if (trigger === 'trial_count') achieved = state.eligible_trials >= threshold;
          else if (trigger === 'total_points') achieved = state.total_points >= threshold;
          else if (trigger === 'success_streak') achieved = state.success_streak >= threshold;

          if (achieved) {
            shown[id] = true;
            const scr = (m0.screen && typeof m0.screen === 'object') ? m0.screen : m0;
            queue.push(normalizeRewardScreen(scr, 'Rewards', scr.template_html ?? scr.html ?? ''));
          }
        }

        const calcOnFly = policy.calculate_on_the_fly === true;
        if (calcOnFly) {
          return {
            pts,
            total: state.total_points,
            rewarded_trials: state.rewarded_trials,
            eligible_trials: state.eligible_trials,
            success_streak: state.success_streak
          };
        }
        return {
          pts: null,
          total: null,
          rewarded_trials: null,
          eligible_trials: state.eligible_trials,
          success_streak: state.success_streak
        };
      } catch {
        return null;
      }
    };

    const maybeWrapOnFinishWithRewards = (originalOnFinish, pluginType) => {
      if (!rewardsPolicy) return originalOnFinish;
      return (data) => {
        const res = recordRewardEvent(data, pluginType);
        if (res && res.pts !== null) {
          try {
            data.reward_points = res.pts;
            data.reward_total_points = res.total;
            data.reward_rewarded_trials = res.rewarded_trials;
            data.reward_eligible_trials = res.eligible_trials;
            data.reward_success_streak = res.success_streak;
          } catch {
            // ignore
          }
        }
        if (typeof originalOnFinish === 'function') {
          try { originalOnFinish(data); } catch { /* ignore */ }
        }
      };
    };

    const maybeWrapTrialWithRewardPopups = (trial, pluginType) => {
      if (!rewardsPolicy) return trial;
      const ms = Array.isArray(rewardsPolicy.milestones) ? rewardsPolicy.milestones : [];
      if (!ms.length) return trial;

      const storeKey = rewardsStoreKey;

      const queueNotEmpty = () => {
        try {
          const bag = window[storeKey];
          const q = bag && bag.state && Array.isArray(bag.state.screen_queue) ? bag.state.screen_queue : [];
          return q.length > 0;
        } catch {
          return false;
        }
      };

      const contChoices = rewardsPolicy.continue_key === 'ALL_KEYS'
        ? 'ALL_KEYS'
        : (rewardsPolicy.continue_key === 'enter' ? ['Enter'] : [' ']);

      const rewardPopupTrial = {
        type: HtmlKeyboard,
        stimulus: () => {
          try {
            const bag = window[storeKey];
            const policy = bag && bag.policy ? bag.policy : rewardsPolicy;
            const state = (bag && bag.state && typeof bag.state === 'object') ? bag.state : {};
            const q = Array.isArray(state.screen_queue) ? state.screen_queue : [];
            const next = q.shift();

            const vars = {
              currency_label: (policy.currency_label || 'points').toString(),
              scoring_basis: policy.scoring_basis,
              scoring_basis_label: scoringBasisLabel(policy.scoring_basis),
              rt_threshold_ms: Number.isFinite(Number(policy.rt_threshold_ms)) ? Number(policy.rt_threshold_ms) : 0,
              points_per_success: Number.isFinite(Number(policy.points_per_success)) ? Number(policy.points_per_success) : 0,
              continue_key: policy.continue_key,
              continue_key_label: continueKeyLabel(policy.continue_key),
              total_points: Number.isFinite(Number(state.total_points)) ? Number(state.total_points) : 0,
              rewarded_trials: Number.isFinite(Number(state.rewarded_trials)) ? Number(state.rewarded_trials) : 0,
              eligible_trials: Number.isFinite(Number(state.eligible_trials)) ? Number(state.eligible_trials) : 0,
              success_streak: Number.isFinite(Number(state.success_streak)) ? Number(state.success_streak) : 0,
              badge_level: (state.badge_level ?? '')
            };

            const screen = normalizeRewardScreen(next, 'Rewards', '');
            return renderRewardScreenHtml(screen, vars, { titleFallback: screen.title || 'Rewards' });
          } catch {
            return `<div class="psy-wrap"><div class="psy-stage"><div class="psy-text"><h2>Rewards</h2><p>Could not render milestone.</p></div></div></div>`;
          }
        },
        choices: contChoices,
        on_start: () => {
          try {
            const bag = window[storeKey];
            const state = (bag && bag.state && typeof bag.state === 'object') ? bag.state : {};
            const q = Array.isArray(state.screen_queue) ? state.screen_queue : [];
            const next = q[0];
            if (next && typeof next === 'object' && next.audio_url) {
              playRewardAudio(next.audio_url);
            }
          } catch {
            // ignore
          }
        },
        data: { plugin_type: 'reward-milestone' }
      };

      const popups = {
        timeline: [rewardPopupTrial],
        conditional_function: queueNotEmpty,
        loop_function: queueNotEmpty
      };

      return { timeline: [trial, popups] };
    };

    // Continuous mode (RDM only): run the entire expanded sequence inside one plugin trial
    // so we don't re-render the DOM between frames.
    //
    // Other task types (e.g., soc-dashboard prototype) compile as normal trials even if
    // experiment_type is set to "continuous".
    if (experimentType === 'continuous' && taskType === 'rdm') {
      const RdmContinuous = requirePlugin('rdm-continuous (window.jsPsychRdmContinuous)', window.jsPsychRdmContinuous);
      const ui = isObject(config) ? config : {};
      const frameRate = Number(config.frame_rate);
      const derivedFrameIntervalMs = (Number.isFinite(frameRate) && frameRate > 0)
        ? Math.max(1, Math.round(1000 / frameRate))
        : 100;
      const updateIntervalRaw = Number(ui.update_interval_ms ?? ui.update_interval);
      const updateInterval = Number.isFinite(updateIntervalRaw) && updateIntervalRaw > 0
        ? updateIntervalRaw
        : derivedFrameIntervalMs;

      let segmentIndex = 0;
      let frames = [];

      const pushRdmContinuousSegment = () => {
        if (!frames.length) return;
        segmentIndex += 1;
        const segFrames = frames;
        frames = [];

        timeline.push({
          type: RdmContinuous,
          frames: segFrames,
          update_interval_ms: Number.isFinite(updateInterval) ? updateInterval : 100,
          default_transition: defaultTransition,
          dataCollection,
          data: { plugin_type: 'rdm-continuous', segment_index: segmentIndex }
        });
      };

      for (const item of expanded) {
        const type = item.type;

        if (type === 'detection-response-task-start') {
          // Ensure prior RDM frames run before starting a new DRT segment.
          pushRdmContinuousSegment();
          timeline.push({
            type: HtmlKeyboard,
            stimulus: '',
            prompt: null,
            choices: 'NO_KEYS',
            trial_duration: 1,
            response_ends_trial: false,
            on_start: () => {
              try {
                if (window.DrtEngine && typeof window.DrtEngine.start === 'function') {
                  window.DrtEngine.start(item);
                }
              } catch {
                // ignore
              }
            },
            data: { plugin_type: 'drt-start', task_type: 'drt' }
          });
          continue;
        }

        if (type === 'detection-response-task-stop') {
          // Ensure prior RDM frames run before stopping DRT.
          pushRdmContinuousSegment();
          timeline.push({
            type: HtmlKeyboard,
            stimulus: '',
            prompt: null,
            choices: 'NO_KEYS',
            trial_duration: 1,
            response_ends_trial: false,
            on_start: () => {
              try {
                if (window.DrtEngine && typeof window.DrtEngine.stop === 'function') {
                  window.DrtEngine.stop();
                }
              } catch {
                // ignore
              }
            },
            data: { plugin_type: 'drt-stop', task_type: 'drt' }
          });
          continue;
        }

        if (type === 'html-keyboard-response' || type === 'instructions') {
          // Keep instructions as their own trial.
          pushRdmContinuousSegment();
          const stimulus = (item.stimulus !== undefined && item.stimulus !== null) ? item.stimulus : item.stimulus_html;
          timeline.push({
            type: HtmlKeyboard,
            stimulus: wrapMaybeFunctionStimulus(stimulus, item.prompt),
            prompt: null,
            choices: normalizeKeyChoices(item.choices),
            stimulus_duration: (item.stimulus_duration === undefined ? null : item.stimulus_duration),
            trial_duration: (item.trial_duration === undefined ? null : item.trial_duration),
            response_ends_trial: (item.response_ends_trial === undefined ? true : item.response_ends_trial),
            data: { plugin_type: type }
          });
          continue;
        }

        if (type === 'html-button-response') {
          pushRdmContinuousSegment();
          const HtmlButton = requirePlugin('html-button-response (jsPsychHtmlButtonResponse)', HtmlButtonResponsePlugin);
          const stimulus = (item.stimulus !== undefined && item.stimulus !== null) ? item.stimulus : item.stimulus_html;
          const choices = normalizeButtonChoices(item.choices !== undefined ? item.choices : item.button_choices);
          timeline.push({
            type: HtmlButton,
            stimulus: wrapMaybeFunctionStimulus(stimulus, item.prompt),
            prompt: null,
            choices,
            ...(item.button_html !== undefined ? { button_html: item.button_html } : {}),
            stimulus_duration: (item.stimulus_duration === undefined ? null : item.stimulus_duration),
            trial_duration: (item.trial_duration === undefined ? null : item.trial_duration),
            ...(item.button_layout !== undefined ? { button_layout: item.button_layout } : {}),
            ...(item.grid_rows !== undefined ? { grid_rows: item.grid_rows } : {}),
            ...(item.grid_columns !== undefined ? { grid_columns: item.grid_columns } : {}),
            response_ends_trial: (item.response_ends_trial === undefined ? true : item.response_ends_trial),
            data: { plugin_type: type }
          });
          continue;
        }

        if (type === 'image-keyboard-response') {
          pushRdmContinuousSegment();
          const rawStimulus = (item.stimulus !== undefined && item.stimulus !== null) ? item.stimulus : item.stimulus_image;
          const src = resolveMaybeRelativeUrl(rawStimulus);
          const w = Number.isFinite(Number(item.stimulus_width)) ? Number(item.stimulus_width) : null;
          const h = Number.isFinite(Number(item.stimulus_height)) ? Number(item.stimulus_height) : null;
          const keep = (item.maintain_aspect_ratio !== undefined) ? (item.maintain_aspect_ratio === true) : true;

          const style = [
            'max-width:100%;',
            'max-height:55vh;',
            'object-fit:contain;'
          ];
          if (w !== null) style.push(`width:${w}px;`);
          if (h !== null) style.push(`height:${h}px;`);
          if (!keep) style.push('object-fit:fill;');

          const stimulusHtml = src
            ? `<div style="display:flex; justify-content:center;"><img src="${escapeHtml(src)}" alt="stimulus" style="${style.join(' ')}" /></div>`
            : `<div class="psy-muted">(Missing image stimulus)</div>`;

          timeline.push({
            type: HtmlKeyboard,
            stimulus: wrapMaybeFunctionStimulus(stimulusHtml, item.prompt),
            prompt: null,
            choices: normalizeKeyChoices(item.choices),
            stimulus_duration: (item.stimulus_duration === undefined ? null : item.stimulus_duration),
            trial_duration: (item.trial_duration === undefined ? null : item.trial_duration),
            response_ends_trial: (item.response_ends_trial === undefined ? true : item.response_ends_trial),
            data: { plugin_type: type }
          });
          continue;
        }

        if (type === 'survey-response') {
          pushRdmContinuousSegment();
          const SurveyResponse = requirePlugin('survey-response (window.jsPsychSurveyResponse)', window.jsPsychSurveyResponse);
          timeline.push({
            type: SurveyResponse,
            title: item.title || 'Survey',
            instructions: item.instructions || '',
            submit_label: item.submit_label || 'Continue',
            allow_empty_on_timeout: item.allow_empty_on_timeout === true,
            timeout_ms: (item.timeout_ms === null || item.timeout_ms === undefined) ? null : Number(item.timeout_ms),
            questions: Array.isArray(item.questions) ? item.questions : [],
            data: { plugin_type: type }
          });
          continue;
        }

        if (type === 'mw-probe') {
          pushRdmContinuousSegment();
          const SurveyResponse = requirePlugin('survey-response (window.jsPsychSurveyResponse)', window.jsPsychSurveyResponse);
          timeline.push({
            type: SurveyResponse,
            on_start: buildMwProbeOnStartHook(),
            title: item.title || 'Thought Probe',
            instructions: item.instructions || '',
            submit_label: item.submit_label || 'Continue',
            allow_empty_on_timeout: item.allow_empty_on_timeout !== false,
            timeout_ms: (item.timeout_ms === null || item.timeout_ms === undefined) ? null : Number(item.timeout_ms),
            questions: Array.isArray(item.questions) ? item.questions : [],
            data: { plugin_type: 'mw-probe' }
          });
          continue;
        }

        if (typeof type === 'string' && type.startsWith('rdm-')) {
          const itemCopy = { ...item };
          delete itemCopy.response_parameters_override;
          delete itemCopy.transition_duration;
          delete itemCopy.transition_type;

          const responseOverride = isObject(item.response_parameters_override) ? item.response_parameters_override : null;
          const response = responseOverride ? deepMerge(responseDefaults, responseOverride) : { ...responseDefaults };

          const transition = {
            duration_ms: Number.isFinite(item.transition_duration) ? Number(item.transition_duration) : (Number(defaultTransition.duration_ms) || 0),
            type: (typeof item.transition_type === 'string' && item.transition_type.trim()) ? item.transition_type : (defaultTransition.type || 'both')
          };

          const rdm = applyResponseDerivedRdmFields(normalizeRdmParams({
            ...baseRdmParams,
            ...itemCopy,
            experiment_type: 'continuous'
          }), response);

          frames.push({
            rdm,
            response,
            timing: isObject(config.timing_parameters) ? config.timing_parameters : {},
            transition
          });
          continue;
        }

        // Unsupported components in continuous mode: treat as a segment boundary.
        pushRdmContinuousSegment();
      }

      // Flush trailing RDM frames.
      pushRdmContinuousSegment();

      return { experimentType, timeline };
    }

    for (const item of expanded) {
      const type = item.type;

      // Backward compatibility: some Builder exports include eye-tracking as a
      // timeline component instead of under data_collection. This is config-only
      // and should not create a visible trial.
      if (type === 'eye-tracking' || type === 'eye_tracking') {
        try {
          const dc = isObject(config.data_collection) ? { ...config.data_collection } : {};
          const existing = isObject(dc.eye_tracking)
            ? dc.eye_tracking
            : (isObject(dc['eye-tracking']) ? dc['eye-tracking'] : {});

          const merged = {
            ...existing,
            enabled: true,
            ...(isObject(item) ? item : {})
          };
          delete merged.type;

          dc.eye_tracking = merged;
          config.data_collection = dc;
        } catch {
          // ignore
        }
        continue;
      }

      if (type === 'detection-response-task-start') {
        timeline.push({
          type: HtmlKeyboard,
          stimulus: '',
          prompt: null,
          choices: 'NO_KEYS',
          trial_duration: 1,
          response_ends_trial: false,
          on_start: () => {
            try {
              if (window.DrtEngine && typeof window.DrtEngine.start === 'function') {
                window.DrtEngine.start(item);
              }
            } catch {
              // ignore
            }
          },
          data: { plugin_type: 'drt-start', task_type: 'drt' }
        });
        continue;
      }

      if (type === 'detection-response-task-stop') {
        timeline.push({
          type: HtmlKeyboard,
          stimulus: '',
          prompt: null,
          choices: 'NO_KEYS',
          trial_duration: 1,
          response_ends_trial: false,
          on_start: () => {
            try {
              if (window.DrtEngine && typeof window.DrtEngine.stop === 'function') {
                window.DrtEngine.stop();
              }
            } catch {
              // ignore
            }
          },
          data: { plugin_type: 'drt-stop', task_type: 'drt' }
        });
        continue;
      }

      // PVT blocks (special handling): optionally extend by one trial per false start
      // to preserve the target number of valid (non-false-start) trials.
      if (type === 'block') {
        const baseType = (typeof item.component_type === 'string' && item.component_type.trim())
          ? item.component_type.trim()
          : (typeof item.block_component_type === 'string' && item.block_component_type.trim())
            ? item.block_component_type.trim()
            : '';

        // N-back continuous: Block is the generator.
        // Support legacy `nback-block`, the public alias `nback`, and the older name `nback-trial-sequence`.
        if ((baseType === 'nback-block' || baseType === 'nback' || baseType === 'nback-trial-sequence') && experimentType === 'continuous') {
          const NbackContinuous = requirePlugin('nback-continuous (window.jsPsychNbackContinuous)', window.jsPsychNbackContinuous);
          const onFinish = maybeWrapOnFinishWithRewards(typeof item.on_finish === 'function' ? item.on_finish : null, 'nback-continuous');

          const src = (item && typeof item === 'object' && item.parameter_values && typeof item.parameter_values === 'object')
            ? { ...item, ...item.parameter_values }
            : item;

          const len = resolveBlockLength(src, blockLengthOpts, 30);

          const pickFromDefaults = (raw, defKey, fallback) => {
            if (raw !== undefined && raw !== null) return raw;
            if (nbackDefaults && nbackDefaults[defKey] !== undefined && nbackDefaults[defKey] !== null) return nbackDefaults[defKey];
            return fallback;
          };

          const renderMode = (pickFromDefaults(src.nback_render_mode, 'render_mode', 'token') ?? 'token').toString().trim().toLowerCase();
          const responseDevice = resolveNbackResponseDevice(pickFromDefaults(src.nback_response_device, 'response_device', 'inherit'));

          timeline.push({
            type: NbackContinuous,

            n: pickFromDefaults(src.nback_n, 'n', 2),
            length: len,
            seed: (pickFromDefaults(src.seed, 'seed', '') ?? '').toString(),

            stimulus_mode: pickFromDefaults(src.nback_stimulus_mode, 'stimulus_mode', 'letters'),
            stimulus_pool: pickFromDefaults(src.nback_stimulus_pool, 'stimulus_pool', ''),
            target_probability: pickFromDefaults(src.nback_target_probability, 'target_probability', 0.25),

            render_mode: renderMode,
            stimulus_template_html: (renderMode === 'custom_html')
              ? pickFromDefaults(src.nback_stimulus_template_html, 'stimulus_template_html', null)
              : null,

            stimulus_duration_ms: pickFromDefaults(src.nback_stimulus_duration_ms, 'stimulus_duration_ms', 500),
            isi_duration_ms: pickFromDefaults(src.nback_isi_duration_ms, 'isi_duration_ms', 700),
            trial_duration_ms: pickFromDefaults(src.nback_trial_duration_ms, 'trial_duration_ms', 1200),

            show_fixation_cross_between_trials: (src.nback_show_fixation_cross_between_trials !== undefined && src.nback_show_fixation_cross_between_trials !== null)
              ? (src.nback_show_fixation_cross_between_trials === true)
              : (nbackDefaults.show_fixation_cross_between_trials === true),

            response_paradigm: pickFromDefaults(src.nback_response_paradigm, 'response_paradigm', 'go_nogo'),
            response_device: responseDevice,
            go_key: pickFromDefaults(src.nback_go_key, 'go_key', 'space'),
            match_key: pickFromDefaults(src.nback_match_key, 'match_key', 'j'),
            nonmatch_key: pickFromDefaults(src.nback_nonmatch_key, 'nonmatch_key', 'f'),
            show_buttons: (src.nback_show_buttons !== undefined && src.nback_show_buttons !== null)
              ? (src.nback_show_buttons === true)
              : (nbackDefaults.show_buttons === true),

            show_feedback: (src.nback_show_feedback !== undefined && src.nback_show_feedback !== null)
              ? (src.nback_show_feedback === true)
              : (nbackDefaults.show_feedback === true),
            feedback_duration_ms: pickFromDefaults(src.nback_feedback_duration_ms, 'feedback_duration_ms', 250),

            ...(onFinish ? { on_finish: onFinish } : {}),
            data: { plugin_type: 'nback-continuous', task_type: 'nback', original_type: type }
          });
          continue;
        }

        if (baseType === 'pvt-trial' && pvtDefaults && pvtDefaults.add_trial_per_false_start === true) {
          const Pvt = requirePlugin('pvt (window.jsPsychPvt)', window.jsPsychPvt);

          const targetValidTrials = resolveBlockLength(item, blockLengthOpts, 1);

          // Builder exports parameter_windows as an array of { parameter, min, max }.
          // Support both object-map and array forms.
          const windows = (() => {
            if (isObject(item.parameter_windows)) return { ...item.parameter_windows };
            if (Array.isArray(item.parameter_windows)) {
              const out = {};
              for (const w of item.parameter_windows) {
                if (!isObject(w)) continue;
                const p = (w.parameter ?? '').toString().trim();
                if (!p) continue;
                out[p] = { min: w.min, max: w.max };
              }
              return out;
            }
            return {};
          })();

          const values = isObject(item.parameter_values) ? { ...item.parameter_values } : {};
          const seed = Number.isFinite(item.seed) ? (item.seed >>> 0) : null;
          const rng = seed === null ? Math.random : mulberry32(seed);

          const sampleNumber = (min, max) => {
            const a = Number(min);
            const b = Number(max);
            if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
            const lo = Math.min(a, b);
            const hi = Math.max(a, b);
            return lo + (hi - lo) * rng();
          };

          const sampleFromValues = (v) => {
            if (Array.isArray(v)) {
              if (v.length === 0) return null;
              const idx = Math.floor(rng() * v.length);
              return v[Math.max(0, Math.min(v.length - 1, idx))];
            }
            return v;
          };

          const toStr = (v) => (v === undefined || v === null) ? '' : v.toString();
          const norm = (v) => toStr(v).trim();

          const resolveDevice = (v, fallback) => {
            const s = norm(v).toLowerCase();
            if (s === 'keyboard' || s === 'mouse' || s === 'both') return s;
            const fb = norm(fallback).toLowerCase();
            if (fb === 'mouse' || fb === 'both') return fb;
            return 'keyboard';
          };

          const parseBool = (v) => {
            if (typeof v === 'boolean') return v;
            if (typeof v === 'number') return v > 0;
            if (typeof v === 'string') {
              const s = v.trim().toLowerCase();
              if (s === '' || s === 'inherit') return null;
              if (s === 'true' || s === '1' || s === 'yes' || s === 'on' || s === 'enabled') return true;
              if (s === 'false' || s === '0' || s === 'no' || s === 'off' || s === 'disabled') return false;
            }
            return null;
          };

          const state = {
            target_valid_trials: targetValidTrials,
            valid_done: 0,
            total_done: 0
          };

          const internalOnFinish = (data) => {
            state.total_done += 1;
            const fs = (data && typeof data === 'object') ? (data.false_start === true) : false;
            if (!fs) state.valid_done += 1;
          };

          const onFinish = maybeWrapOnFinishWithRewards(internalOnFinish, 'pvt-trial');

          const trialTemplate = {
            type: Pvt,

            on_start: (trial) => {
              // Sample parameters for this trial at runtime.
              const sampled = {};

              for (const [k, v] of Object.entries(values)) {
                sampled[k] = sampleFromValues(v);
              }

              for (const [k, w] of Object.entries(windows)) {
                if (!isObject(w)) continue;
                const s = sampleNumber(w.min, w.max);
                if (s === null) continue;
                const shouldRound = /(_ms|_px|_deg|_count|_trials|_repetitions)$/i.test(k);
                sampled[k] = shouldRound ? Math.round(s) : s;
              }

              // Resolve inheritance against experiment defaults.
              trial.response_device = resolveDevice(
                (sampled.response_device && sampled.response_device !== 'inherit') ? sampled.response_device : null,
                pvtDefaults.response_device || 'keyboard'
              );

              trial.response_key = (typeof sampled.response_key === 'string' && sampled.response_key.trim() !== '' && sampled.response_key !== 'inherit')
                ? sampled.response_key
                : (typeof pvtDefaults.response_key === 'string' && pvtDefaults.response_key.trim() !== '' ? pvtDefaults.response_key : 'space');

              trial.foreperiod_ms = Number.isFinite(Number(sampled.foreperiod_ms))
                ? Number(sampled.foreperiod_ms)
                : (Number.isFinite(Number(pvtDefaults.foreperiod_ms)) ? Number(pvtDefaults.foreperiod_ms) : 4000);

              trial.trial_duration_ms = Number.isFinite(Number(sampled.trial_duration_ms))
                ? Number(sampled.trial_duration_ms)
                : (Number.isFinite(Number(pvtDefaults.trial_duration_ms)) ? Number(pvtDefaults.trial_duration_ms) : 10000);

              const itiMs = Number.isFinite(Number(sampled.iti_ms))
                ? Number(sampled.iti_ms)
                : (Number.isFinite(Number(pvtDefaults.iti_ms)) ? Number(pvtDefaults.iti_ms) : baseIti);
              trial.iti_ms = itiMs;
              trial.post_trial_gap = itiMs;

              const fbEnabled = (() => {
                const a = parseBool(sampled.feedback_enabled);
                if (a !== null) return a;
                const b = parseBool(pvtDefaults.feedback_enabled);
                if (b !== null) return b;
                return false;
              })();

              const fbMessage = (typeof sampled.feedback_message === 'string' && sampled.feedback_message.trim() !== '' && sampled.feedback_message !== 'inherit')
                ? sampled.feedback_message
                : (typeof pvtDefaults.feedback_message === 'string' ? pvtDefaults.feedback_message : '');

              trial.feedback_enabled = fbEnabled;
              trial.feedback_message = fbMessage;

              // Data fields
              trial.data = {
                plugin_type: 'pvt-trial',
                task_type: 'pvt',
                _generated_from_block: true,
                _block_index: state.total_done,
                pvt_target_valid_trials: state.target_valid_trials,
                pvt_valid_trials_completed_before: state.valid_done,
                pvt_total_trials_completed_before: state.total_done
              };
            },

            on_finish: onFinish
          };

          timeline.push({
            timeline: [maybeWrapTrialWithRewardPopups(trialTemplate, 'pvt-trial')],
            loop_function: () => {
              return state.valid_done < state.target_valid_trials;
            }
          });

          continue;
        }
      }

      const socDefaults = (type === 'soc-dashboard' && isObject(config?.soc_dashboard_settings))
        ? config.soc_dashboard_settings
        : null;

        if (type === 'html-keyboard-response' || type === 'instructions') {
        timeline.push({
          type: HtmlKeyboard,
          stimulus: wrapMaybeFunctionStimulus(item.stimulus, item.prompt),
          prompt: null,
          choices: item.choices === 'ALL_KEYS' ? 'ALL_KEYS' : (Array.isArray(item.choices) ? item.choices : 'ALL_KEYS'),
          stimulus_duration: (item.stimulus_duration === undefined ? null : item.stimulus_duration),
          trial_duration: (item.trial_duration === undefined ? null : item.trial_duration),
          response_ends_trial: (item.response_ends_trial === undefined ? true : item.response_ends_trial),
          data: { plugin_type: type }
        });
        continue;
      }

      if (type === 'image-keyboard-response') {
        const src = resolveMaybeRelativeUrl(item.stimulus);
        const w = Number.isFinite(Number(item.stimulus_width)) ? Number(item.stimulus_width) : null;
        const h = Number.isFinite(Number(item.stimulus_height)) ? Number(item.stimulus_height) : null;
        const keep = (item.maintain_aspect_ratio !== undefined) ? (item.maintain_aspect_ratio === true) : true;

        const style = [
          'max-width:100%;',
          'max-height:55vh;',
          'object-fit:contain;'
        ];
        if (w !== null) style.push(`width:${w}px;`);
        if (h !== null) style.push(`height:${h}px;`);
        if (!keep) style.push('object-fit:fill;');

        const stimulusHtml = src
          ? `<div style="display:flex; justify-content:center;"><img src="${escapeHtml(src)}" alt="stimulus" style="${style.join(' ')}" /></div>`
          : `<div class="psy-muted">(Missing image stimulus)</div>`;

        timeline.push({
          type: HtmlKeyboard,
          stimulus: wrapMaybeFunctionStimulus(stimulusHtml, item.prompt),
          prompt: null,
          choices: item.choices === 'ALL_KEYS' ? 'ALL_KEYS' : (Array.isArray(item.choices) ? item.choices : 'ALL_KEYS'),
          stimulus_duration: (item.stimulus_duration === undefined ? null : item.stimulus_duration),
          trial_duration: (item.trial_duration === undefined ? null : item.trial_duration),
          response_ends_trial: (item.response_ends_trial === undefined ? true : item.response_ends_trial),
          data: { plugin_type: type }
        });
        continue;
      }

      if (type === 'survey-response') {
        const SurveyResponse = requirePlugin('survey-response (window.jsPsychSurveyResponse)', window.jsPsychSurveyResponse);
        timeline.push({
          type: SurveyResponse,
          title: item.title || 'Survey',
          instructions: item.instructions || '',
          submit_label: item.submit_label || 'Continue',
          allow_empty_on_timeout: item.allow_empty_on_timeout === true,
          timeout_ms: (item.timeout_ms === null || item.timeout_ms === undefined) ? null : Number(item.timeout_ms),
          questions: Array.isArray(item.questions) ? item.questions : [],
          data: { plugin_type: type }
        });
        continue;
      }

      if (type === 'mw-probe') {
        const SurveyResponse = requirePlugin('survey-response (window.jsPsychSurveyResponse)', window.jsPsychSurveyResponse);
        timeline.push({
          type: SurveyResponse,
          on_start: buildMwProbeOnStartHook(),
          title: item.title || 'Thought Probe',
          instructions: item.instructions || '',
          submit_label: item.submit_label || 'Continue',
          allow_empty_on_timeout: item.allow_empty_on_timeout !== false,
          timeout_ms: (item.timeout_ms === null || item.timeout_ms === undefined) ? null : Number(item.timeout_ms),
          questions: Array.isArray(item.questions) ? item.questions : [],
          data: { plugin_type: 'mw-probe' }
        });
        continue;
      }

      if (type === 'visual-angle-calibration') {
        const Vac = requirePlugin('visual-angle-calibration (window.jsPsychVisualAngleCalibration)', window.jsPsychVisualAngleCalibration);
        const itemCopy = { ...item };
        delete itemCopy.type;
        timeline.push({
          type: Vac,
          ...itemCopy,
          data: { plugin_type: type }
        });
        continue;
      }

      if (type === 'reward-settings') {
        // Store policy globally + show participant-facing reward instructions.
        const itemCopy = { ...item };
        delete itemCopy.type;

        rewardsStoreKey = (itemCopy.store_key || '__psy_rewards').toString();
        const continueKey = (itemCopy.continue_key || 'space').toString();

        const instructionsScreen = normalizeRewardScreen(
          itemCopy.instructions_screen,
          itemCopy.instructions_title || 'Rewards',
          itemCopy.instructions_template_html || ''
        );

        const summaryScreen = normalizeRewardScreen(
          itemCopy.summary_screen,
          itemCopy.summary_title || 'Rewards Summary',
          itemCopy.summary_template_html || ''
        );

        const intermediateScreens = Array.isArray(itemCopy.intermediate_screens)
          ? itemCopy.intermediate_screens.map((s) => normalizeRewardScreen(s, 'Rewards', s && (s.template_html ?? s.html) ? (s.template_html ?? s.html) : ''))
          : (Array.isArray(itemCopy.extra_screens)
              ? itemCopy.extra_screens.map((s) => normalizeRewardScreen(s, 'Rewards', s && (s.template_html ?? s.html) ? (s.template_html ?? s.html) : ''))
              : []);

        const milestones = Array.isArray(itemCopy.milestones)
          ? itemCopy.milestones.map((m, idx) => {
              const mm = (m && typeof m === 'object') ? m : {};
              const scr = (mm.screen && typeof mm.screen === 'object') ? mm.screen : mm;
              return {
                id: (mm.id ?? `m${idx + 1}`).toString(),
                trigger_type: (mm.trigger_type ?? mm.trigger ?? 'trial_count').toString(),
                threshold: Number(mm.threshold ?? mm.value ?? 0),
                screen: normalizeRewardScreen(scr, 'Rewards', scr && (scr.template_html ?? scr.html) ? (scr.template_html ?? scr.html) : '')
              };
            })
          : [];

        rewardsPolicy = {
          store_key: rewardsStoreKey,
          currency_label: (itemCopy.currency_label || 'points').toString(),
          scoring_basis: (itemCopy.scoring_basis || 'both').toString(),
          rt_threshold_ms: Number.isFinite(Number(itemCopy.rt_threshold_ms)) ? Number(itemCopy.rt_threshold_ms) : 600,
          points_per_success: Number.isFinite(Number(itemCopy.points_per_success)) ? Number(itemCopy.points_per_success) : 1,
          require_correct_for_rt: itemCopy.require_correct_for_rt === true,
          calculate_on_the_fly: itemCopy.calculate_on_the_fly !== false,
          show_summary_at_end: itemCopy.show_summary_at_end !== false,
          continue_key: continueKey,

          // v2 screen model
          instructions_screen: instructionsScreen,
          intermediate_screens: intermediateScreens,
          milestones,
          summary_screen: summaryScreen,

          // legacy flat fields (kept for compatibility)
          instructions_title: (itemCopy.instructions_title || instructionsScreen.title || 'Rewards').toString(),
          instructions_template_html: (itemCopy.instructions_template_html || instructionsScreen.template_html || '').toString(),
          summary_title: (itemCopy.summary_title || summaryScreen.title || 'Rewards Summary').toString(),
          summary_template_html: (itemCopy.summary_template_html || summaryScreen.template_html || '').toString()
        };

        const basisLabel = scoringBasisLabel(rewardsPolicy.scoring_basis);
        const contLabel = continueKeyLabel(rewardsPolicy.continue_key);
        const contChoices = rewardsPolicy.continue_key === 'ALL_KEYS'
          ? 'ALL_KEYS'
          : (rewardsPolicy.continue_key === 'enter' ? ['Enter'] : [' ']);

        const vars = {
          currency_label: rewardsPolicy.currency_label,
          scoring_basis: rewardsPolicy.scoring_basis,
          scoring_basis_label: basisLabel,
          rt_threshold_ms: rewardsPolicy.rt_threshold_ms,
          points_per_success: rewardsPolicy.points_per_success,
          continue_key: rewardsPolicy.continue_key,
          continue_key_label: contLabel
        };

        const html = renderRewardScreenHtml(rewardsPolicy.instructions_screen, vars, { titleFallback: rewardsPolicy.instructions_title || 'Rewards' });

        timeline.push({
          type: HtmlKeyboard,
          stimulus: html,
          choices: contChoices,
          on_start: () => {
            try {
              window[rewardsStoreKey] = {
                enabled: true,
                policy: { ...rewardsPolicy },
                state: {
                  total_points: 0,
                  rewarded_trials: 0,
                  eligible_trials: 0,
                  success_streak: 0,
                  badge_level: '',
                  events: [],
                  computed_at_end: false,
                  screen_queue: [],
                  milestones_shown: {}
                }
              };

              if (rewardsPolicy.instructions_screen && rewardsPolicy.instructions_screen.audio_url) {
                playRewardAudio(rewardsPolicy.instructions_screen.audio_url);
              }
            } catch {
              // ignore
            }
          },
          data: { plugin_type: type }
        });

        // Additional screens shown once between instructions and first task trial.
        if (Array.isArray(rewardsPolicy.intermediate_screens) && rewardsPolicy.intermediate_screens.length) {
          for (let i = 0; i < rewardsPolicy.intermediate_screens.length; i++) {
            const scr = rewardsPolicy.intermediate_screens[i];
            timeline.push({
              type: HtmlKeyboard,
              stimulus: () => {
                try {
                  const bag = window[rewardsStoreKey];
                  const policy = bag && bag.policy ? bag.policy : rewardsPolicy;
                  const vars2 = {
                    currency_label: (policy.currency_label || 'points').toString(),
                    scoring_basis: policy.scoring_basis,
                    scoring_basis_label: scoringBasisLabel(policy.scoring_basis),
                    rt_threshold_ms: Number.isFinite(Number(policy.rt_threshold_ms)) ? Number(policy.rt_threshold_ms) : 0,
                    points_per_success: Number.isFinite(Number(policy.points_per_success)) ? Number(policy.points_per_success) : 0,
                    continue_key: policy.continue_key,
                    continue_key_label: continueKeyLabel(policy.continue_key),
                    total_points: 0,
                    rewarded_trials: 0,
                    eligible_trials: 0,
                    success_streak: 0,
                    badge_level: ''
                  };
                  return renderRewardScreenHtml(scr, vars2, { titleFallback: scr.title || 'Rewards' });
                } catch {
                  return renderRewardScreenHtml(scr, vars, { titleFallback: scr.title || 'Rewards' });
                }
              },
              choices: contChoices,
              on_start: () => {
                try {
                  if (scr && scr.audio_url) playRewardAudio(scr.audio_url);
                } catch {
                  // ignore
                }
              },
              data: { plugin_type: 'reward-intermediate', index: i }
            });
          }
        }
        continue;
      }

      if (type === 'soc-dashboard') {
        const SocDashboard = requirePlugin('soc-dashboard (window.jsPsychSocDashboard)', window.jsPsychSocDashboard);
        const itemCopy = { ...item };
        delete itemCopy.type;
        timeline.push({
          type: SocDashboard,
          ...(socDefaults ? { ...socDefaults } : {}),
          ...itemCopy,
          data: { plugin_type: type, task_type: 'soc-dashboard' }
        });
        continue;
      }

      // Builder-only helper components: allow running a single SOC subtask directly by
      // wrapping it in a one-window SOC Dashboard session.
      if (
        type === 'soc-subtask-sart-like'
        || type === 'soc-subtask-nback-like'
        || type === 'soc-subtask-flanker-like'
        || type === 'soc-subtask-wcst-like'
        || type === 'soc-subtask-pvt-like'
        || type === 'mw-probe'
      ) {
        const SocDashboard = requirePlugin('soc-dashboard (window.jsPsychSocDashboard)', window.jsPsychSocDashboard);

        const kind = (t) => {
          switch (t) {
            case 'soc-subtask-sart-like': return 'sart-like';
            case 'soc-subtask-nback-like': return 'nback-like';
            case 'soc-subtask-flanker-like': return 'flanker-like';
            case 'soc-subtask-wcst-like': return 'wcst-like';
            case 'soc-subtask-pvt-like': return 'pvt-like';
            case 'mw-probe': return 'mw-probe';
            default: return 'unknown';
          }
        };

        const itemCopy = { ...item };
        delete itemCopy.type;

        const subtaskTitle = (itemCopy.title ?? itemCopy.name ?? kind(type) ?? 'Subtask').toString();
        const startAt = Number.isFinite(Number(itemCopy.start_at_ms)) ? Number(itemCopy.start_at_ms) : 0;
        const duration = Number.isFinite(Number(itemCopy.duration_ms)) ? Number(itemCopy.duration_ms) : null;
        const sessionDuration = (duration !== null && duration > 0)
          ? Math.max(1, Math.floor(startAt + duration))
          : null;

        const subtaskParams = { ...itemCopy };
        delete subtaskParams.title;
        delete subtaskParams.name;
        delete subtaskParams.parameters;
        delete subtaskParams.data;

        timeline.push({
          type: SocDashboard,
          ...(socDefaults ? { ...socDefaults } : {}),
          title: 'SOC Dashboard',
          ...(sessionDuration !== null ? { trial_duration_ms: sessionDuration } : {}),
          subtasks: [{ type: kind(type), title: subtaskTitle, ...subtaskParams }],
          data: { plugin_type: 'soc-dashboard', task_type: 'soc-dashboard', original_type: type }
        });
        continue;
      }

      if (typeof type === 'string' && type.startsWith('rdm-')) {
        const Rdm = requirePlugin('rdm (window.jsPsychRdm)', window.jsPsychRdm);
        const onStart = typeof item.on_start === 'function' ? item.on_start : null;
        const onFinish0 = typeof item.on_finish === 'function' ? item.on_finish : null;
        const onFinish = maybeWrapOnFinishWithRewards(onFinish0, type);

        const itemCopy = { ...item };
        delete itemCopy.response_parameters_override;
        delete itemCopy.transition_duration;
        delete itemCopy.transition_type;
        delete itemCopy.on_start;
        delete itemCopy.on_finish;

        const responseOverride = isObject(item.response_parameters_override) ? item.response_parameters_override : null;
        const response = responseOverride ? deepMerge(responseDefaults, responseOverride) : { ...responseDefaults };

        // Practice trials should, by default, run through the configured timing
        // window rather than ending immediately on first response.
        if (type === 'rdm-practice' && response.end_trial_on_response === undefined) {
          response.end_trial_on_response = false;
        }

        const timing = isObject(config.timing_parameters) ? config.timing_parameters : {};

        const transition = (experimentType === 'continuous')
          ? {
              duration_ms: Number.isFinite(item.transition_duration) ? Number(item.transition_duration) : (Number(defaultTransition.duration_ms) || 0),
              type: (typeof item.transition_type === 'string' && item.transition_type.trim()) ? item.transition_type : (defaultTransition.type || 'both')
            }
          : { duration_ms: 0, type: 'none' };

        const rdm = applyResponseDerivedRdmFields(normalizeRdmParams({
          ...baseRdmParams,
          ...itemCopy,
          experiment_type: experimentType
        }), response);

        const trial = {
          type: Rdm,
          rdm,
          response,
          timing,
          transition,
          dataCollection,
          ...(experimentType === 'trial-based' && baseIti > 0 ? { post_trial_gap: baseIti } : {}),
          ...(onStart ? { on_start: onStart } : {}),
          ...(onFinish ? { on_finish: onFinish } : {}),
          data: {
            plugin_type: type,
            _generated_from_block: !!item._generated_from_block,
            _block_index: Number.isFinite(item._block_index) ? item._block_index : null
          }
        };
        timeline.push(maybeWrapTrialWithRewardPopups(trial, type));
        continue;
      }

      // Flanker task
      if (type === 'flanker-trial') {
        const Flanker = requirePlugin('flanker (window.jsPsychFlanker)', window.jsPsychFlanker);
        const onFinish = maybeWrapOnFinishWithRewards(typeof item.on_finish === 'function' ? item.on_finish : null, type);
        const trial = {
          ...item,
          type: Flanker,
          post_trial_gap: Number.isFinite(Number(item.iti_ms)) ? Number(item.iti_ms) : 0,
          ...(onFinish ? { on_finish: onFinish } : {}),
          data: { plugin_type: type, task_type: 'flanker' }
        };
        timeline.push(maybeWrapTrialWithRewardPopups(trial, type));
        continue;
      }

      // SART task
      if (type === 'sart-trial') {
        const Sart = requirePlugin('sart (window.jsPsychSart)', window.jsPsychSart);
        const onFinish = maybeWrapOnFinishWithRewards(typeof item.on_finish === 'function' ? item.on_finish : null, type);
        const trial = {
          ...item,
          type: Sart,
          post_trial_gap: Number.isFinite(Number(item.iti_ms)) ? Number(item.iti_ms) : 0,
          ...(onFinish ? { on_finish: onFinish } : {}),
          data: { plugin_type: type, task_type: 'sart' }
        };
        timeline.push(maybeWrapTrialWithRewardPopups(trial, type));
        continue;
      }

      // MOT task
      if (type === 'mot-trial') {
        const Mot = requirePlugin('mot (window.jsPsychMot)', window.jsPsychMot);
        const onFinish = maybeWrapOnFinishWithRewards(typeof item.on_finish === 'function' ? item.on_finish : null, type);
        const trial = {
          ...item,
          type: Mot,
          ...(onFinish ? { on_finish: onFinish } : {}),
          data: { plugin_type: type, task_type: 'mot' }
        };
        timeline.push(maybeWrapTrialWithRewardPopups(trial, type));
        continue;
      }

      // Continuous Image Presentation (one data row per image)
      if (type === 'continuous-image-presentation') {
        const Cip = requirePlugin(
          'continuous-image-presentation (window.jsPsychContinuousImagePresentation)',
          window.jsPsychContinuousImagePresentation
        );
        const onFinish = maybeWrapOnFinishWithRewards(typeof item.on_finish === 'function' ? item.on_finish : null, type);

        const trial = {
          ...item,
          type: Cip,
          ...(onFinish ? { on_finish: onFinish } : {}),
          data: {
            plugin_type: type,
            task_type: 'continuous-image',
            stimulus_image_url: item.image_url ?? null,
            stimulus_filename: item.asset_filename ?? null,
            _generated_from_block: !!item._generated_from_block,
            _block_index: Number.isFinite(item._block_index) ? item._block_index : null,
            _block_source_index: Number.isFinite(item._block_source_index) ? item._block_source_index : null
          }
        };

        timeline.push(maybeWrapTrialWithRewardPopups(trial, type));
        continue;
      }

      // N-back task (trial-based)
      if (type === 'nback-block') {
        const Nback = requirePlugin('nback (window.jsPsychNback)', window.jsPsychNback);
        const onFinish = maybeWrapOnFinishWithRewards(typeof item.on_finish === 'function' ? item.on_finish : null, type);

        const itemCopy = { ...item };
        if ('response_device' in itemCopy) itemCopy.response_device = resolveNbackResponseDevice(itemCopy.response_device);
        const rm = (itemCopy.render_mode ?? 'token').toString().trim().toLowerCase();
        itemCopy.render_mode = rm;
        if (rm !== 'custom_html') delete itemCopy.stimulus_template_html;

        const trial = {
          ...itemCopy,
          type: Nback,
          ...(onFinish ? { on_finish: onFinish } : {}),
          data: {
            plugin_type: type,
            task_type: 'nback',
            _generated_from_nback_sequence: item._generated_from_nback_sequence === true,
            _sequence_seed: Number.isFinite(item._sequence_seed) ? item._sequence_seed : null,
            _sequence_index: Number.isFinite(item._sequence_index) ? item._sequence_index : null
          }
        };
        timeline.push(maybeWrapTrialWithRewardPopups(trial, type));
        continue;
      }

      // N-back task (continuous stream)
      if (type === 'nback-trial-sequence' && experimentType === 'continuous') {
        const NbackContinuous = requirePlugin('nback-continuous (window.jsPsychNbackContinuous)', window.jsPsychNbackContinuous);
        const onFinish = maybeWrapOnFinishWithRewards(typeof item.on_finish === 'function' ? item.on_finish : null, 'nback-continuous');

        const itemCopy = { ...item };
        delete itemCopy.type;
        delete itemCopy.on_start;
        delete itemCopy.on_finish;

        // Apply experiment-wide N-back defaults when fields are missing.
        for (const [k, v] of Object.entries(nbackDefaults || {})) {
          if (itemCopy[k] === undefined || itemCopy[k] === null) itemCopy[k] = v;
        }

        itemCopy.response_device = resolveNbackResponseDevice(itemCopy.response_device);
        const renderMode = (itemCopy.render_mode ?? 'token').toString().trim().toLowerCase();
        itemCopy.render_mode = renderMode;
        if (renderMode !== 'custom_html') delete itemCopy.stimulus_template_html;

        const trial = {
          type: NbackContinuous,
          ...itemCopy,
          ...(onFinish ? { on_finish: onFinish } : {}),
          data: { plugin_type: 'nback-continuous', task_type: 'nback', original_type: type }
        };
        timeline.push(maybeWrapTrialWithRewardPopups(trial, 'nback-continuous'));
        continue;
      }

      // Gabor learning block (loop until accuracy criterion met)
      if (type === 'block' && (() => {
        const bt = (typeof item.component_type === 'string' && item.component_type.trim())
          ? item.component_type.trim()
          : (typeof item.block_component_type === 'string' && item.block_component_type.trim())
            ? item.block_component_type.trim()
            : '';
        return bt === 'gabor-learning';
      })()) {
        const Gabor = requirePlugin('gabor (window.jsPsychGabor)', window.jsPsychGabor);

        const src = (item && typeof item === 'object' && item.parameter_values && typeof item.parameter_values === 'object')
          ? { ...item, ...item.parameter_values }
          : (item || {});

        const learningWindows = (() => {
          if (isObject(item?.parameter_windows)) return { ...item.parameter_windows };
          if (Array.isArray(item?.parameter_windows)) {
            const out = {};
            for (const w of item.parameter_windows) {
              if (!isObject(w)) continue;
              const p = (w.parameter ?? '').toString().trim();
              if (!p) continue;
              out[p] = { min: w.min, max: w.max };
            }
            return out;
          }
          return {};
        })();

        const learningSeed = Number.isFinite(Number(src.seed)) ? (Number(src.seed) >>> 0) : null;
        const learningRng = (learningSeed === null) ? Math.random : mulberry32(learningSeed);

        const pickOne = (v) => {
          if (Array.isArray(v)) {
            if (v.length === 0) return null;
            const idx = Math.floor(learningRng() * v.length);
            return v[Math.max(0, Math.min(v.length - 1, idx))];
          }
          return v;
        };

        const sampleWindowValue = (min, max, paramName) => {
          const a = Number(min);
          const b = Number(max);
          if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          const s = lo + (hi - lo) * learningRng();
          const isCyclesPerPx = /cyc_per_px$/i.test(paramName || '');
          const shouldRound = !isCyclesPerPx && /(_ms|_px|_deg|_count|_trials|_repetitions)$/i.test(paramName || '');
          return shouldRound ? Math.round(s) : s;
        };

        const normalizeLearningOptions = (raw) => {
          if (raw === undefined || raw === null) return [];
          return Array.isArray(raw) ? raw : [raw];
        };

        const sampleLearningOption = (opts) => {
          const arr = Array.isArray(opts) ? opts : [];
          if (arr.length === 0) return null;
          const idx = Math.floor(learningRng() * arr.length);
          return arr[Math.max(0, Math.min(arr.length - 1, idx))];
        };

        const shuffleLearning = (arr) => {
          const out = Array.isArray(arr) ? arr.slice() : [];
          for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(learningRng() * (i + 1));
            const tmp = out[i];
            out[i] = out[j];
            out[j] = tmp;
          }
          return out;
        };

        const buildLearningBoolPlan = (total, pTrue) => {
          const n = Math.max(0, Number.parseInt(total, 10) || 0);
          if (n <= 0) return [];
          const p = clamp(pTrue, 0, 1);
          const nTrue = Math.max(0, Math.min(n, Math.round(n * p)));
          const out = [];
          for (let i = 0; i < nTrue; i++) out.push(true);
          for (let i = nTrue; i < n; i++) out.push(false);
          return shuffleLearning(out);
        };

        const learningNumberOptions = (raw) => {
          const out = [];
          const seen = new Set();
          const arr = normalizeLearningOptions(raw);
          for (const v of arr) {
            const n = Number(v);
            if (!Number.isFinite(n)) continue;
            const key = String(n);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(n);
          }
          return out;
        };

        const buildLearningPairPlan = (total, aVals, bVals) => {
          const n = Math.max(0, Number.parseInt(total, 10) || 0);
          const a = Array.isArray(aVals) ? aVals : [];
          const b = Array.isArray(bVals) ? bVals : [];
          if (n <= 0 || a.length === 0 || b.length === 0) return [];

          const combos = [];
          for (const av of a) {
            for (const bv of b) combos.push({ a: av, b: bv });
          }
          if (combos.length === 0) return [];

          const out = [];
          while (out.length < n) {
            const cycle = shuffleLearning(combos);
            for (const c of cycle) {
              out.push(c);
              if (out.length >= n) break;
            }
          }
          return out;
        };

        const learningTargetLocationOpts = normalizeLearningOptions(src.target_location).map(v => (v ?? '').toString().trim().toLowerCase());
        const learningHasBothTargetSides = learningTargetLocationOpts.includes('left') && learningTargetLocationOpts.includes('right');
        const learningPTargetLeft = Number(src.target_left_probability);
        const learningTargetPlan = (Number.isFinite(learningPTargetLeft) && learningHasBothTargetSides)
          ? buildLearningBoolPlan(Math.max(1, Number.parseInt(src.learning_max_trials ?? 200, 10) || 200), clamp(learningPTargetLeft, 0, 1))
          : [];

        const learningPCueValid = Number(src.spatial_cue_validity_probability);
        const learningCueValidityPlan = {
          left: Number.isFinite(learningPCueValid)
            ? buildLearningBoolPlan(Math.max(1, Number.parseInt(src.learning_max_trials ?? 200, 10) || 200), clamp(learningPCueValid, 0, 1))
            : [],
          right: Number.isFinite(learningPCueValid)
            ? buildLearningBoolPlan(Math.max(1, Number.parseInt(src.learning_max_trials ?? 200, 10) || 200), clamp(learningPCueValid, 0, 1))
            : []
        };

        const learningTargetTiltOptions = learningNumberOptions(src.target_tilt_deg);
        const learningDistractorOptions = learningNumberOptions(src.distractor_orientation_deg);
        const learningTiltDistrPlan = {
          left: buildLearningPairPlan(Math.max(1, Number.parseInt(src.learning_max_trials ?? 200, 10) || 200), learningTargetTiltOptions, learningDistractorOptions),
          right: buildLearningPairPlan(Math.max(1, Number.parseInt(src.learning_max_trials ?? 200, 10) || 200), learningTargetTiltOptions, learningDistractorOptions)
        };

        const applyCueLearningPolicies = (trial, learningIndex, gState) => {
          const hasSpatialGate = (
            Object.prototype.hasOwnProperty.call(src, 'spatial_cue_enabled')
            || Object.prototype.hasOwnProperty.call(src, 'spatial_cue_probability')
          );
          const hasValueGate = (
            Object.prototype.hasOwnProperty.call(src, 'value_cue_enabled')
            || Object.prototype.hasOwnProperty.call(src, 'value_cue_probability')
          );

          let valuePresentForTrial = true;

          if (hasSpatialGate || hasValueGate) {
            const spatialEnabled = Object.prototype.hasOwnProperty.call(src, 'spatial_cue_enabled') ? (src.spatial_cue_enabled === true) : true;
            const valueEnabled = Object.prototype.hasOwnProperty.call(src, 'value_cue_enabled') ? (src.value_cue_enabled === true) : true;

            const pSpatial = Object.prototype.hasOwnProperty.call(src, 'spatial_cue_probability') ? clamp(src.spatial_cue_probability, 0, 1) : 1;
            const pValue = Object.prototype.hasOwnProperty.call(src, 'value_cue_probability') ? clamp(src.value_cue_probability, 0, 1) : 1;

            const spatialPresent = spatialEnabled && learningRng() < pSpatial;
            const valuePresent = valueEnabled && learningRng() < pValue;
            valuePresentForTrial = valuePresent;

            if (!spatialPresent) {
              trial.spatial_cue = 'none';
            } else {
              const opts = normalizeLearningOptions(trial.spatial_cue ?? src.spatial_cue);
              const filtered = opts.filter(x => (x ?? '').toString().trim().toLowerCase() !== 'none');
              const picked = sampleLearningOption(filtered.length > 0 ? filtered : opts);
              trial.spatial_cue = picked === null ? (trial.spatial_cue ?? 'none') : picked;
            }

            if (!valuePresent) {
              trial.left_value = 'neutral';
              trial.right_value = 'neutral';
            } else {
              const lvOpts = normalizeLearningOptions(trial.left_value ?? src.left_value);
              const rvOpts = normalizeLearningOptions(trial.right_value ?? src.right_value);
              const lvFiltered = lvOpts.filter(x => (x ?? '').toString().trim().toLowerCase() !== 'neutral');
              const rvFiltered = rvOpts.filter(x => (x ?? '').toString().trim().toLowerCase() !== 'neutral');

              const leftPicked = sampleLearningOption(lvFiltered.length > 0 ? lvFiltered : lvOpts);
              const rightPicked = sampleLearningOption(rvFiltered.length > 0 ? rvFiltered : rvOpts);

              if (leftPicked !== null) trial.left_value = leftPicked;
              if (rightPicked !== null) trial.right_value = rightPicked;
            }
          }

          if (learningTargetPlan.length > 0) {
            const idx = Math.max(0, Math.min(learningTargetPlan.length - 1, learningIndex));
            trial.target_location = learningTargetPlan[idx] ? 'left' : 'right';
          }

          const spatialCueTargetMode = (src.spatial_cue_target_mode ?? 'couple_target_to_cue').toString().trim().toLowerCase();
          if (Number.isFinite(learningPCueValid)) {
            const cue = (trial.spatial_cue ?? 'none').toString().trim().toLowerCase();
            const currentTarget = (trial.target_location ?? 'left').toString().trim().toLowerCase();

            let nextTarget = currentTarget;
            let cueValid = null;

            if (cue === 'left' || cue === 'right') {
              if (spatialCueTargetMode === 'preserve_target_distribution') {
                cueValid = (currentTarget === cue);
              } else {
                const cursor = (cue === 'right') ? gState.cueValidityCursorRight : gState.cueValidityCursorLeft;
                const plan = (cue === 'right') ? learningCueValidityPlan.right : learningCueValidityPlan.left;
                const safeIdx = Math.max(0, Math.min(plan.length - 1, cursor));
                cueValid = plan.length > 0 ? (plan[safeIdx] === true) : (learningRng() < clamp(learningPCueValid, 0, 1));
                if (cue === 'right') gState.cueValidityCursorRight += 1;
                else gState.cueValidityCursorLeft += 1;
                nextTarget = cueValid ? cue : (cue === 'left' ? 'right' : 'left');
              }
            }

            if (spatialCueTargetMode !== 'preserve_target_distribution' && (nextTarget === 'left' || nextTarget === 'right')) {
              trial.target_location = nextTarget;
            }
            if (cueValid !== null) {
              trial.spatial_cue_valid = cueValid;
            }
          }

          const valueTarget = (src.value_target_value ?? 'any').toString().trim().toLowerCase();
          const valueNonTarget = (src.value_non_target_value ?? 'any').toString().trim().toLowerCase();
          const shouldApplyValueTarget = (!hasValueGate || valuePresentForTrial);
          if (shouldApplyValueTarget && (valueTarget === 'high' || valueTarget === 'low' || valueTarget === 'neutral')) {
            const chosen = learningTargetPlan.length > 0
              ? (learningTargetPlan[Math.max(0, Math.min(learningTargetPlan.length - 1, learningIndex))] ? 'left' : 'right')
              : ((trial.target_location ?? '').toString().trim().toLowerCase() === 'right' ? 'right' : 'left');

            if (chosen) {
              trial.target_location = chosen;
              trial.value_target_value = valueTarget;
              if (chosen === 'left') {
                trial.left_value = valueTarget;
                if (valueNonTarget === 'high' || valueNonTarget === 'low' || valueNonTarget === 'neutral') {
                  trial.right_value = valueNonTarget;
                }
              } else if (chosen === 'right') {
                trial.right_value = valueTarget;
                if (valueNonTarget === 'high' || valueNonTarget === 'low' || valueNonTarget === 'neutral') {
                  trial.left_value = valueNonTarget;
                }
              }
            }
          }

          const availByValue = {
            high: Number(src.reward_availability_high),
            low: Number(src.reward_availability_low),
            neutral: Number(src.reward_availability_neutral)
          };
          const targetSide = (trial.target_location ?? '').toString().trim().toLowerCase();
          const targetCue = (targetSide === 'right' ? trial.right_value : trial.left_value);
          const cueKey = (targetCue ?? '').toString().trim().toLowerCase();
          const pAvailRaw = availByValue[cueKey];
          if (Number.isFinite(pAvailRaw)) {
            const pAvail = clamp(pAvailRaw, 0, 1);
            trial.reward_availability_probability = pAvail;
            trial.reward_available = (learningRng() < pAvail);
          }

          const side = ((trial.target_location ?? '').toString().trim().toLowerCase() === 'right') ? 'right' : 'left';
          const plan = side === 'right' ? learningTiltDistrPlan.right : learningTiltDistrPlan.left;
          const cursor = side === 'right' ? gState.tiltDistrCursorRight : gState.tiltDistrCursorLeft;
          const safeIdx = Math.max(0, Math.min(plan.length - 1, cursor));
          const pair = plan.length > 0 ? plan[safeIdx] : null;
          if (side === 'right') gState.tiltDistrCursorRight += 1;
          else gState.tiltDistrCursorLeft += 1;

          if (pair) {
            trial.target_tilt_deg = pair.a;
            trial.distractor_orientation_deg = pair.b;
          }
        };

        const streakLength = Math.max(1, Number.parseInt(src.learning_streak_length ?? 20, 10) || 20);
        const targetAccuracy = Number.isFinite(Number(src.learning_target_accuracy)) ? Number(src.learning_target_accuracy) : 0.9;
        const maxTrials = Math.max(1, Number.parseInt(src.learning_max_trials ?? 200, 10) || 200);
        const accuracyStartTrial = Math.max(1, Number.parseInt(src.learning_accuracy_start_trial ?? streakLength, 10) || streakLength);
        const showFeedback = src.show_feedback !== false;
        const feedbackDurationMs = Math.max(0, Number(src.feedback_duration_ms ?? 800) || 0);
        const useStoredThresholdsForLearning = (
          src.use_stored_thresholds === true
          || src.use_stored_thresholds === 'true'
          || src.use_stored_thresholds === 1
          || src.use_stored_thresholds === '1'
        );

        const applyStoredThresholdForLearning = (trial) => {
          if (!useStoredThresholdsForLearning) return;
          try {
            const state = window?.cogflowState?.gabor_thresholds;
            if (!isObject(state)) return;

            const byParameter = isObject(state.by_parameter) ? state.by_parameter : null;
            const param = (state.parameter ?? '').toString().trim();
            const allowed = (param === 'target_tilt_deg' || param === 'contrast' || param === 'spatial_frequency_cyc_per_px');
            if (!allowed) return;

            const entry = (byParameter && isObject(byParameter[param])) ? byParameter[param] : state;
            if (!isObject(entry)) return;

            const side = (trial.target_location ?? '').toString().trim().toLowerCase();
            let raw = null;
            if (side === 'left' && Number.isFinite(Number(entry.left))) raw = Number(entry.left);
            else if (side === 'right' && Number.isFinite(Number(entry.right))) raw = Number(entry.right);
            else if (Number.isFinite(Number(entry.combined))) raw = Number(entry.combined);
            else if (Number.isFinite(Number(entry.left))) raw = Number(entry.left);
            else if (Number.isFinite(Number(entry.right))) raw = Number(entry.right);
            if (!Number.isFinite(raw)) return;

            const value = (param === 'target_tilt_deg')
              ? ((learningRng() < 0.5 ? -1 : 1) * Math.abs(raw))
              : raw;
            trial[param] = value;
          } catch {
            // ignore
          }
        };

        const gLearningState = {
          trialCount: 0,
          history: [],
          cueValidityCursorLeft: 0,
          cueValidityCursorRight: 0,
          tiltDistrCursorLeft: 0,
          tiltDistrCursorRight: 0,
        };

        const trialTemplate = {
          type: Gabor,
          ...gaborDefaults,

          on_start: (trial) => {
            // Apply all block param values at runtime; allow fall-through to gaborDefaults above.
            for (const [k, v] of Object.entries(src)) {
              if (
                k === 'learning_streak_length' || k === 'learning_target_accuracy' ||
                k === 'learning_max_trials' || k === 'learning_accuracy_start_trial' || k === 'show_feedback' ||
                k === 'feedback_duration_ms' || k === 'block_component_type' ||
                k === 'component_type' || k === 'block_length' || k === 'type' ||
                k === 'parameter_values' || k === 'parameter_windows' ||
                k === 'use_stored_thresholds' ||
                k === 'spatial_cue_enabled' || k === 'spatial_cue_probability' ||
                k === 'value_cue_enabled' || k === 'value_cue_probability' ||
                k === 'spatial_cue_validity_probability' || k === 'spatial_cue_target_mode' ||
                k === 'target_left_probability' || k === 'value_target_value' ||
                k === 'value_non_target_value' ||
                k === 'reward_availability_high' || k === 'reward_availability_low' ||
                k === 'reward_availability_neutral'
              ) continue;
              if (trial[k] === undefined) trial[k] = pickOne(v);
            }

            for (const [k, w] of Object.entries(learningWindows)) {
              if (!isObject(w)) continue;
              const sampled = sampleWindowValue(w.min, w.max, k);
              if (sampled === null) continue;
              trial[k] = sampled;
            }

            const learningIndex = Math.max(0, gLearningState.trialCount);
            applyCueLearningPolicies(trial, learningIndex, gLearningState);
            applyStoredThresholdForLearning(trial);

            trial.show_feedback = showFeedback;
            trial.feedback_duration_ms = feedbackDurationMs;
            trial.data = {
              plugin_type: 'gabor-trial',
              task_type: 'gabor',
              gabor_learning_block: true,
              gabor_learning_trial: gLearningState.trialCount,
              ...(typeof trial.spatial_cue_valid === 'boolean' ? { spatial_cue_valid: trial.spatial_cue_valid } : {}),
              ...(typeof trial.reward_available === 'boolean' ? { reward_available: trial.reward_available } : {}),
              ...(Number.isFinite(Number(trial.reward_availability_probability)) ? { reward_availability_probability: Number(trial.reward_availability_probability) } : {})
            };
          },

          on_finish: (data) => {
            gLearningState.trialCount += 1;
            const correct = (data && (data.correctness === true || data.correct === true));
            gLearningState.history.push(correct ? 1 : 0);
            if (gLearningState.history.length > streakLength) {
              gLearningState.history.shift();
            }
          }
        };

        timeline.push({
          timeline: [trialTemplate],
          loop_function: () => {
            if (gLearningState.trialCount >= maxTrials) return false;
            if (gLearningState.trialCount < accuracyStartTrial) return true;
            if (gLearningState.history.length < streakLength) return true;
            const acc = gLearningState.history.reduce((a, b) => a + b, 0) / streakLength;
            return acc < targetAccuracy;
          },
          data: { plugin_type: 'gabor-learning', task_type: 'gabor' }
        });
        continue;
      }

      // Gabor task
      if (type === 'gabor-trial') {
        const Gabor = requirePlugin('gabor (window.jsPsychGabor)', window.jsPsychGabor);
        const onStart = typeof item.on_start === 'function' ? item.on_start : null;
        const onFinish0 = typeof item.on_finish === 'function' ? item.on_finish : null;
        const onFinish = maybeWrapOnFinishWithRewards(onFinish0, type);

        const itemCopy = { ...item };
        delete itemCopy.type;
        delete itemCopy.on_start;
        delete itemCopy.on_finish;

        const trial = {
          type: Gabor,

          // Inherit experiment-wide gabor settings by default.
          ...gaborDefaults,

          // Allow per-trial overrides.
          ...itemCopy,

          ...(onStart ? { on_start: onStart } : {}),
          ...(onFinish ? { on_finish: onFinish } : {}),

          data: {
            plugin_type: type,
            task_type: 'gabor',
            _generated_from_block: !!item._generated_from_block,
            _block_index: Number.isFinite(item._block_index) ? item._block_index : null
          }
        };
        timeline.push(maybeWrapTrialWithRewardPopups(trial, type));
        continue;
      }

      // Stroop task
      if (type === 'stroop-trial') {
        const Stroop = requirePlugin('stroop (window.jsPsychStroop)', window.jsPsychStroop);
        const onFinish = maybeWrapOnFinishWithRewards(typeof item.on_finish === 'function' ? item.on_finish : null, type);

        const itemCopy = { ...item };
        delete itemCopy.type;
        delete itemCopy.on_start;
        delete itemCopy.on_finish;

        const stimuli = Array.isArray(stroopDefaults.stimuli) ? stroopDefaults.stimuli : [];

        const toStr = (v) => (v === undefined || v === null) ? '' : v.toString();
        const norm = (v) => toStr(v).trim();

        const findInkHex = (inkName, fallbackHex) => {
          const needle = norm(inkName).toLowerCase();
          for (const s of stimuli) {
            const n = norm(s && s.name).toLowerCase();
            if (n && n === needle) {
              const c = norm(s && (s.color || s.hex || s.color_hex));
              if (c) return c;
            }
          }
          return norm(fallbackHex) || '#ffffff';
        };

        const computeCongruency = (word, inkName) => {
          const w = norm(word).toLowerCase();
          const i = norm(inkName).toLowerCase();
          if (!w || !i) return 'auto';
          return (w === i) ? 'congruent' : 'incongruent';
        };

        const responseMode = (item.response_mode && item.response_mode !== 'inherit')
          ? item.response_mode
          : (stroopDefaults.response_mode || 'color_naming');

        const responseDevice = (item.response_device && item.response_device !== 'inherit')
          ? item.response_device
          : (stroopDefaults.response_device || 'keyboard');

        const choiceKeys = (Array.isArray(item.choice_keys) && item.choice_keys.length > 0)
          ? item.choice_keys
          : (Array.isArray(stroopDefaults.choice_keys) ? stroopDefaults.choice_keys : []);

        const congruentKey = (typeof item.congruent_key === 'string' && item.congruent_key.trim() !== '')
          ? item.congruent_key
          : (typeof stroopDefaults.congruent_key === 'string' ? stroopDefaults.congruent_key : 'f');

        const incongruentKey = (typeof item.incongruent_key === 'string' && item.incongruent_key.trim() !== '')
          ? item.incongruent_key
          : (typeof stroopDefaults.incongruent_key === 'string' ? stroopDefaults.incongruent_key : 'j');

        const fontSizePx = Number.isFinite(Number(item.stimulus_font_size_px))
          ? Number(item.stimulus_font_size_px)
          : (Number.isFinite(Number(stroopDefaults.stimulus_font_size_px)) ? Number(stroopDefaults.stimulus_font_size_px) : 72);

        const stimMs = Number.isFinite(Number(item.stimulus_duration_ms))
          ? Number(item.stimulus_duration_ms)
          : (Number.isFinite(Number(stroopDefaults.stimulus_duration_ms)) ? Number(stroopDefaults.stimulus_duration_ms) : 0);

        const trialMs = Number.isFinite(Number(item.trial_duration_ms))
          ? Number(item.trial_duration_ms)
          : (Number.isFinite(Number(stroopDefaults.trial_duration_ms)) ? Number(stroopDefaults.trial_duration_ms) : 2000);

        const itiMs = Number.isFinite(Number(item.iti_ms))
          ? Number(item.iti_ms)
          : (Number.isFinite(Number(stroopDefaults.iti_ms)) ? Number(stroopDefaults.iti_ms) : 0);

        // If a trial omits word/ink, fall back to experiment-wide stimuli rather than
        // letting the plugin defaults (RED/BLUE) leak into customized experiments.
        const stimulusNames = stimuli.map((s) => norm(s && s.name)).filter(Boolean);

        const word = (() => {
          const w = norm(item.word || '');
          return w || (stimulusNames[0] || 'RED');
        })();

        const inkName = (() => {
          const n = norm(item.ink_color_name || '');
          return n || (stimulusNames[1] || stimulusNames[0] || 'BLUE');
        })();

        // Always compute congruency from the realized word/ink values.
        // (Block generation and/or manual edits can otherwise leave a stale label that breaks scoring.)
        const congruency = computeCongruency(word, inkName);

        const inkHex = findInkHex(inkName, item.ink_color_hex);

        const trial = {
          type: Stroop,

          ...itemCopy,

          // Effective defaults (compiler resolves inheritance)
          stimuli,
          response_mode: responseMode,
          response_device: responseDevice,
          choice_keys: choiceKeys,
          congruent_key: congruentKey,
          incongruent_key: incongruentKey,
          stimulus_font_size_px: fontSizePx,
          stimulus_duration_ms: stimMs,
          trial_duration_ms: trialMs,
          ink_color_hex: inkHex,
          congruency,

          post_trial_gap: itiMs,
          ...(onFinish ? { on_finish: onFinish } : {}),

          data: {
            plugin_type: type,
            task_type: 'stroop',
            _generated_from_block: !!item._generated_from_block,
            _block_index: Number.isFinite(item._block_index) ? item._block_index : null
          }
        };
        timeline.push(maybeWrapTrialWithRewardPopups(trial, type));
        continue;
      }

      // Emotional Stroop task (color naming only; uses the same Stroop plugin)
      if (type === 'emotional-stroop-trial') {
        const Stroop = requirePlugin('stroop (window.jsPsychStroop)', window.jsPsychStroop);
        const onFinish = maybeWrapOnFinishWithRewards(typeof item.on_finish === 'function' ? item.on_finish : null, type);

        const itemCopy = { ...item };
        delete itemCopy.type;
        delete itemCopy.on_start;
        delete itemCopy.on_finish;

        const stimuli = Array.isArray(emotionalStroopDefaults.stimuli) ? emotionalStroopDefaults.stimuli : [];
        const wordOptions = Array.isArray(emotionalStroopDefaults.word_options) ? emotionalStroopDefaults.word_options : [];
        const wordListsDefaults = Array.isArray(emotionalStroopDefaults.word_lists) ? emotionalStroopDefaults.word_lists : [];

        const toStr = (v) => (v === undefined || v === null) ? '' : v.toString();
        const norm = (v) => toStr(v).trim();

        const findInkHex = (inkName, fallbackHex) => {
          const needle = norm(inkName).toLowerCase();
          for (const s of stimuli) {
            const n = norm(s && s.name).toLowerCase();
            if (n && n === needle) {
              const c = norm(s && (s.color || s.hex || s.color_hex));
              if (c) return c;
            }
          }
          return norm(fallbackHex) || '#ffffff';
        };

        const computeCongruency = (word, inkName) => {
          const w = norm(word).toLowerCase();
          const i = norm(inkName).toLowerCase();
          if (!w || !i) return 'auto';
          return (w === i) ? 'congruent' : 'incongruent';
        };

        const responseMode = 'color_naming';

        const responseDevice = (item.response_device && item.response_device !== 'inherit')
          ? item.response_device
          : (emotionalStroopDefaults.response_device || 'keyboard');

        const choiceKeys = (Array.isArray(item.choice_keys) && item.choice_keys.length > 0)
          ? item.choice_keys
          : (Array.isArray(emotionalStroopDefaults.choice_keys) ? emotionalStroopDefaults.choice_keys : []);

        const fontSizePx = Number.isFinite(Number(item.stimulus_font_size_px))
          ? Number(item.stimulus_font_size_px)
          : (Number.isFinite(Number(emotionalStroopDefaults.stimulus_font_size_px)) ? Number(emotionalStroopDefaults.stimulus_font_size_px) : 72);

        const stimMs = Number.isFinite(Number(item.stimulus_duration_ms))
          ? Number(item.stimulus_duration_ms)
          : (Number.isFinite(Number(emotionalStroopDefaults.stimulus_duration_ms)) ? Number(emotionalStroopDefaults.stimulus_duration_ms) : 0);

        const trialMs = Number.isFinite(Number(item.trial_duration_ms))
          ? Number(item.trial_duration_ms)
          : (Number.isFinite(Number(emotionalStroopDefaults.trial_duration_ms)) ? Number(emotionalStroopDefaults.trial_duration_ms) : 2000);

        const itiMs = Number.isFinite(Number(item.iti_ms))
          ? Number(item.iti_ms)
          : (Number.isFinite(Number(emotionalStroopDefaults.iti_ms)) ? Number(emotionalStroopDefaults.iti_ms) : 0);

        const stimulusNames = stimuli.map((s) => norm(s && s.name)).filter(Boolean);

        const wordListIndex = (() => {
          const n = Number(item.word_list_index);
          return Number.isFinite(n) ? parseInt(n, 10) : null;
        })();

        const wordListLabel = (() => {
          const direct = norm(item.word_list_label || '');
          if (direct) return direct;
          if (!wordListIndex || wordListIndex < 1) return '';
          const def = wordListsDefaults[wordListIndex - 1];
          if (def && typeof def === 'object' && !Array.isArray(def)) {
            const lbl = norm(def.label ?? def.name ?? '');
            if (lbl) return lbl;
          }
          return '';
        })();

        const word = (() => {
          const w = norm(item.word || '');
          if (w) return w;
          const opt0 = norm(wordOptions[0] || '');
          return opt0 || 'HAPPY';
        })();

        const inkName = (() => {
          const n = norm(item.ink_color_name || '');
          return n || (stimulusNames[0] || 'BLUE');
        })();

        const congruency = computeCongruency(word, inkName);
        const inkHex = findInkHex(inkName, item.ink_color_hex);

        const trial = {
          type: Stroop,

          ...itemCopy,

          stimuli,
          response_mode: responseMode,
          response_device: responseDevice,
          choice_keys: choiceKeys,
          stimulus_font_size_px: fontSizePx,
          stimulus_duration_ms: stimMs,
          trial_duration_ms: trialMs,
          ink_color_hex: inkHex,
          congruency,

          post_trial_gap: itiMs,
          ...(onFinish ? { on_finish: onFinish } : {}),

          data: {
            plugin_type: type,
            task_type: 'emotional-stroop',
            original_type: type,
            word_list_label: wordListLabel || null,
            word_list_index: wordListIndex,
            _generated_from_block: !!item._generated_from_block,
            _block_index: Number.isFinite(item._block_index) ? item._block_index : null
          }
        };
        timeline.push(maybeWrapTrialWithRewardPopups(trial, type));
        continue;
      }

      // Simon task
      if (type === 'simon-trial') {
        const Simon = requirePlugin('simon (window.jsPsychSimon)', window.jsPsychSimon);
        const onFinish = maybeWrapOnFinishWithRewards(typeof item.on_finish === 'function' ? item.on_finish : null, type);

        const itemCopy = { ...item };
        delete itemCopy.type;
        delete itemCopy.on_start;
        delete itemCopy.on_finish;

        const stimuli = Array.isArray(simonDefaults.stimuli) ? simonDefaults.stimuli : [];

        const toStr = (v) => (v === undefined || v === null) ? '' : v.toString();
        const norm = (v) => toStr(v).trim();

        const coerceSide = (v, fallback) => {
          const s = norm(v).toLowerCase();
          if (s === 'left' || s === 'right') return s;
          return fallback;
        };

        const findStimulusHex = (colorName, fallbackHex) => {
          const needle = norm(colorName).toLowerCase();
          for (const s of stimuli) {
            const n = norm(s && s.name).toLowerCase();
            if (n && n === needle) {
              const c = norm(s && (s.color || s.hex || s.color_hex));
              if (c) return c;
            }
          }
          return norm(fallbackHex) || '#ffffff';
        };

        const resolveDevice = (v, fallback) => {
          const s = norm(v).toLowerCase();
          if (s === 'keyboard' || s === 'mouse') return s;
          return (fallback || 'keyboard').toString().trim().toLowerCase() === 'mouse' ? 'mouse' : 'keyboard';
        };

        const responseDevice = resolveDevice(
          (item.response_device && item.response_device !== 'inherit') ? item.response_device : null,
          simonDefaults.response_device || 'keyboard'
        );

        const leftKey = (typeof item.left_key === 'string' && item.left_key.trim() !== '' && item.left_key !== 'inherit')
          ? item.left_key
          : (typeof simonDefaults.left_key === 'string' ? simonDefaults.left_key : 'f');

        const rightKey = (typeof item.right_key === 'string' && item.right_key.trim() !== '' && item.right_key !== 'inherit')
          ? item.right_key
          : (typeof simonDefaults.right_key === 'string' ? simonDefaults.right_key : 'j');

        const diameterPx = Number.isFinite(Number(item.circle_diameter_px))
          ? Number(item.circle_diameter_px)
          : (Number.isFinite(Number(simonDefaults.circle_diameter_px)) ? Number(simonDefaults.circle_diameter_px) : 140);

        const stimMs = Number.isFinite(Number(item.stimulus_duration_ms))
          ? Number(item.stimulus_duration_ms)
          : (Number.isFinite(Number(simonDefaults.stimulus_duration_ms)) ? Number(simonDefaults.stimulus_duration_ms) : 0);

        const trialMs = Number.isFinite(Number(item.trial_duration_ms))
          ? Number(item.trial_duration_ms)
          : (Number.isFinite(Number(simonDefaults.trial_duration_ms)) ? Number(simonDefaults.trial_duration_ms) : 1500);

        const itiMs = Number.isFinite(Number(item.iti_ms))
          ? Number(item.iti_ms)
          : (Number.isFinite(Number(simonDefaults.iti_ms)) ? Number(simonDefaults.iti_ms) : 0);

        const stimulusSide = coerceSide(item.stimulus_side, 'left');
        const stimulusColorName = norm(item.stimulus_color_name || '')
          || norm(stimuli[0] && stimuli[0].name)
          || 'BLUE';

        const providedCorrectSide = coerceSide(item.correct_response_side, '');
        const derivedCorrectSide = (() => {
          const needle = stimulusColorName.toLowerCase();
          const first = norm(stimuli[0] && stimuli[0].name).toLowerCase();
          const second = norm(stimuli[1] && stimuli[1].name).toLowerCase();
          if (needle && first && needle === first) return 'left';
          if (needle && second && needle === second) return 'right';
          return 'left';
        })();

        const correctSide = (providedCorrectSide === 'left' || providedCorrectSide === 'right')
          ? providedCorrectSide
          : derivedCorrectSide;

        const congruency = (stimulusSide === correctSide) ? 'congruent' : 'incongruent';
        const stimulusHex = findStimulusHex(stimulusColorName, item.stimulus_color_hex);

        const trial = {
          type: Simon,

          ...itemCopy,

          // Effective defaults (compiler resolves inheritance)
          stimuli,
          response_device: responseDevice,
          left_key: leftKey,
          right_key: rightKey,
          circle_diameter_px: diameterPx,
          stimulus_duration_ms: stimMs,
          trial_duration_ms: trialMs,

          stimulus_side: stimulusSide,
          stimulus_color_name: stimulusColorName,
          stimulus_color_hex: stimulusHex,
          correct_response_side: correctSide,
          congruency,

          iti_ms: itiMs,
          post_trial_gap: itiMs,
          ...(onFinish ? { on_finish: onFinish } : {}),

          data: {
            plugin_type: type,
            task_type: 'simon',
            _generated_from_block: !!item._generated_from_block,
            _block_index: Number.isFinite(item._block_index) ? item._block_index : null
          }
        };
        timeline.push(maybeWrapTrialWithRewardPopups(trial, type));
        continue;
      }

      // Task Switching
      if (type === 'task-switching-trial') {
        const TaskSwitching = requirePlugin('task-switching (window.jsPsychTaskSwitching)', window.jsPsychTaskSwitching);
        const onFinish = maybeWrapOnFinishWithRewards(typeof item.on_finish === 'function' ? item.on_finish : null, type);

        const itemCopy = { ...item };
        delete itemCopy.type;
        delete itemCopy.on_start;
        delete itemCopy.on_finish;

        const toStr = (v) => (v === undefined || v === null) ? '' : v.toString();
        const norm = (v) => toStr(v).trim();

        const parseBool = (v) => {
          if (typeof v === 'boolean') return v;
          if (typeof v === 'number') return v > 0;
          if (typeof v === 'string') {
            const s = v.trim().toLowerCase();
            if (s === '' || s === 'inherit') return null;
            if (s === 'true' || s === '1' || s === 'yes' || s === 'on' || s === 'enabled') return true;
            if (s === 'false' || s === '0' || s === 'no' || s === 'off' || s === 'disabled') return false;
          }
          return null;
        };

        const coerceTaskIndex = (v, fallback) => {
          const n = Number.parseInt(v, 10);
          if (n === 2) return 2;
          if (n === 1) return 1;
          return fallback;
        };

        const coercePosition = (v, fallback) => {
          const s = norm(v).toLowerCase();
          if (s === 'left' || s === 'right' || s === 'top' || s === 'bottom') return s;
          return fallback;
        };

        const coerceMode = (v, fallback) => {
          const s = norm(v).toLowerCase();
          if (s === 'custom') return 'custom';
          if (s === 'letters_numbers') return 'letters_numbers';
          return fallback;
        };

        const mode = coerceMode(
          (item.stimulus_set_mode && item.stimulus_set_mode !== 'inherit') ? item.stimulus_set_mode : null,
          coerceMode(taskSwitchingDefaults.stimulus_set_mode, 'letters_numbers')
        );

        const tasks = Array.isArray(taskSwitchingDefaults.tasks) ? taskSwitchingDefaults.tasks : [];

        const taskIndex = coerceTaskIndex(item.task_index, 1);

        const stimParts = (() => {
          const raw = norm(item.stimulus);
          if (!raw) return [];
          return raw.split(/\s+/).map(s => s.trim()).filter(Boolean);
        })();

        let stimulusTask1 = norm(item.stimulus_task_1);
        let stimulusTask2 = norm(item.stimulus_task_2);

        if ((!stimulusTask1 || !stimulusTask2) && stimParts.length >= 2) {
          if (!stimulusTask1) stimulusTask1 = stimParts[0];
          if (!stimulusTask2) stimulusTask2 = stimParts[1];
        }

        const legacyStimulus = norm(item.stimulus);
        if (!stimulusTask1) {
          stimulusTask1 = (taskIndex === 1 && legacyStimulus) ? legacyStimulus : 'A';
        }
        if (!stimulusTask2) {
          stimulusTask2 = (taskIndex === 2 && legacyStimulus) ? legacyStimulus : '1';
        }

        const stimulus = `${stimulusTask1} ${stimulusTask2}`;

        const position = coercePosition(
          (item.stimulus_position && item.stimulus_position !== 'inherit') ? item.stimulus_position : null,
          coercePosition(taskSwitchingDefaults.stimulus_position, 'top')
        );

        const borderEnabled = (() => {
          const a = parseBool(item.border_enabled);
          if (a !== null) return a;
          const b = parseBool(taskSwitchingDefaults.border_enabled);
          if (b !== null) return b;
          return false;
        })();

        const leftKey = (typeof item.left_key === 'string' && item.left_key.trim() !== '' && item.left_key !== 'inherit')
          ? item.left_key
          : (typeof taskSwitchingDefaults.left_key === 'string' && taskSwitchingDefaults.left_key.trim() !== '' ? taskSwitchingDefaults.left_key : 'f');

        const rightKey = (typeof item.right_key === 'string' && item.right_key.trim() !== '' && item.right_key !== 'inherit')
          ? item.right_key
          : (typeof taskSwitchingDefaults.right_key === 'string' && taskSwitchingDefaults.right_key.trim() !== '' ? taskSwitchingDefaults.right_key : 'j');

        const stimMs = Number.isFinite(Number(item.stimulus_duration_ms))
          ? Number(item.stimulus_duration_ms)
          : (Number.isFinite(Number(taskSwitchingDefaults.stimulus_duration_ms)) ? Number(taskSwitchingDefaults.stimulus_duration_ms) : 0);

        const trialMs = Number.isFinite(Number(item.trial_duration_ms))
          ? Number(item.trial_duration_ms)
          : (Number.isFinite(Number(taskSwitchingDefaults.trial_duration_ms)) ? Number(taskSwitchingDefaults.trial_duration_ms) : 2000);

        const itiMs = Number.isFinite(Number(item.iti_ms))
          ? Number(item.iti_ms)
          : (Number.isFinite(Number(taskSwitchingDefaults.iti_ms)) ? Number(taskSwitchingDefaults.iti_ms) : baseIti);

        const trial = {
          type: TaskSwitching,

          ...itemCopy,

          task_index: taskIndex,
          stimulus,
          stimulus_task_1: stimulusTask1,
          stimulus_task_2: stimulusTask2,
          stimulus_position: position,
          border_enabled: borderEnabled,
          left_key: leftKey,
          right_key: rightKey,
          stimulus_set_mode: mode,
          tasks,

          stimulus_duration_ms: stimMs,
          trial_duration_ms: trialMs,

          iti_ms: itiMs,
          post_trial_gap: itiMs,
          ...(onFinish ? { on_finish: onFinish } : {}),

          data: {
            plugin_type: type,
            task_type: 'task-switching',
            _generated_from_block: !!item._generated_from_block,
            _block_index: Number.isFinite(item._block_index) ? item._block_index : null
          }
        };

        timeline.push(maybeWrapTrialWithRewardPopups(trial, type));
        continue;
      }

      // Psychomotor Vigilance Task (PVT)
      if (type === 'pvt-trial') {
        const Pvt = requirePlugin('pvt (window.jsPsychPvt)', window.jsPsychPvt);
        const onFinish = maybeWrapOnFinishWithRewards(typeof item.on_finish === 'function' ? item.on_finish : null, type);

        const itemCopy = { ...item };
        delete itemCopy.type;
        delete itemCopy.on_start;
        delete itemCopy.on_finish;

        const toStr = (v) => (v === undefined || v === null) ? '' : v.toString();
        const norm = (v) => toStr(v).trim();

        const resolveDevice = (v, fallback) => {
          const s = norm(v).toLowerCase();
          if (s === 'keyboard' || s === 'mouse' || s === 'both') return s;
          const fb = norm(fallback).toLowerCase();
          if (fb === 'mouse' || fb === 'both') return fb;
          return 'keyboard';
        };

        const responseDevice = resolveDevice(
          (item.response_device && item.response_device !== 'inherit') ? item.response_device : null,
          pvtDefaults.response_device || 'keyboard'
        );

        const parseBool = (v) => {
          if (typeof v === 'boolean') return v;
          if (typeof v === 'number') return v > 0;
          if (typeof v === 'string') {
            const s = v.trim().toLowerCase();
            if (s === '' || s === 'inherit') return null;
            if (s === 'true' || s === '1' || s === 'yes' || s === 'on' || s === 'enabled') return true;
            if (s === 'false' || s === '0' || s === 'no' || s === 'off' || s === 'disabled') return false;
          }
          return null;
        };

        const feedbackEnabled = (() => {
          const a = parseBool(item.feedback_enabled);
          if (a !== null) return a;
          const b = parseBool(pvtDefaults.feedback_enabled);
          if (b !== null) return b;
          return false;
        })();

        const feedbackMessage = (typeof item.feedback_message === 'string' && item.feedback_message.trim() !== '' && item.feedback_message !== 'inherit')
          ? item.feedback_message
          : (typeof pvtDefaults.feedback_message === 'string' ? pvtDefaults.feedback_message : '');

        const responseKey = (typeof item.response_key === 'string' && item.response_key.trim() !== '' && item.response_key !== 'inherit')
          ? item.response_key
          : (typeof pvtDefaults.response_key === 'string' && pvtDefaults.response_key.trim() !== '' ? pvtDefaults.response_key : 'space');

        const foreperiodMs = Number.isFinite(Number(item.foreperiod_ms))
          ? Number(item.foreperiod_ms)
          : (Number.isFinite(Number(pvtDefaults.foreperiod_ms)) ? Number(pvtDefaults.foreperiod_ms) : 4000);

        const trialMs = Number.isFinite(Number(item.trial_duration_ms))
          ? Number(item.trial_duration_ms)
          : (Number.isFinite(Number(pvtDefaults.trial_duration_ms)) ? Number(pvtDefaults.trial_duration_ms) : 10000);

        const itiMs = Number.isFinite(Number(item.iti_ms))
          ? Number(item.iti_ms)
          : (Number.isFinite(Number(pvtDefaults.iti_ms)) ? Number(pvtDefaults.iti_ms) : baseIti);

        const trial = {
          type: Pvt,

          ...itemCopy,

          response_device: responseDevice,
          response_key: responseKey,
          foreperiod_ms: foreperiodMs,
          trial_duration_ms: trialMs,

          feedback_enabled: feedbackEnabled,
          feedback_message: feedbackMessage,

          iti_ms: itiMs,
          post_trial_gap: itiMs,
          ...(onFinish ? { on_finish: onFinish } : {}),

          data: {
            plugin_type: type,
            task_type: 'pvt',
            _generated_from_block: !!item._generated_from_block,
            _block_index: Number.isFinite(item._block_index) ? item._block_index : null
          }
        };
        timeline.push(maybeWrapTrialWithRewardPopups(trial, type));
        continue;
      }

      // Unknown component types: show as a debug screen.
      timeline.push({
        type: HtmlKeyboard,
        stimulus: `<div style="max-width: 900px; margin: 0 auto; text-align:left;">
          <h3>Unsupported component</h3>
          <div><b>type</b>: ${String(type)}</div>
          <pre style="white-space: pre-wrap;">${escapeHtml(JSON.stringify(item, null, 2))}</pre>
          <div style="opacity:0.7">Press any key to continue.</div>
        </div>`,
        choices: 'ALL_KEYS',
        data: { plugin_type: 'unsupported', original_type: type }
      });
    }

    // Optional end-of-experiment reward summary screen.
    if (rewardsPolicy && rewardsPolicy.show_summary_at_end === true) {
      const storeKey = rewardsStoreKey;
      const contChoices = rewardsPolicy.continue_key === 'ALL_KEYS'
        ? 'ALL_KEYS'
        : (rewardsPolicy.continue_key === 'enter' ? ['Enter'] : [' ']);

      timeline.push({
        type: HtmlKeyboard,
        stimulus: () => {
          try {
            const bag = window[storeKey];
            const policy = bag && bag.policy ? bag.policy : rewardsPolicy;
            const state = (bag && bag.state && typeof bag.state === 'object') ? bag.state : {};
            const events = Array.isArray(state.events) ? state.events : [];

            if (policy && policy.calculate_on_the_fly !== true) {
              // Compute totals at summary time from recorded outcomes.
              let total = 0;
              let rewarded = 0;
              for (const evt of events) {
                const pts = computeRewardPoints(evt, policy);
                total += pts;
                if (pts > 0) rewarded += 1;
              }
              state.total_points = total;
              state.rewarded_trials = rewarded;
              state.eligible_trials = events.length;
              state.computed_at_end = true;
              if (bag && bag.state) bag.state = state;
            }

            const vars = {
              currency_label: (policy.currency_label || 'points').toString(),
              scoring_basis: policy.scoring_basis,
              scoring_basis_label: scoringBasisLabel(policy.scoring_basis),
              rt_threshold_ms: Number.isFinite(Number(policy.rt_threshold_ms)) ? Number(policy.rt_threshold_ms) : 0,
              points_per_success: Number.isFinite(Number(policy.points_per_success)) ? Number(policy.points_per_success) : 0,
              continue_key: policy.continue_key,
              continue_key_label: continueKeyLabel(policy.continue_key),
              total_points: Number.isFinite(Number(state.total_points)) ? Number(state.total_points) : 0,
              rewarded_trials: Number.isFinite(Number(state.rewarded_trials)) ? Number(state.rewarded_trials) : 0,
              eligible_trials: Number.isFinite(Number(state.eligible_trials)) ? Number(state.eligible_trials) : events.length,
              success_streak: Number.isFinite(Number(state.success_streak)) ? Number(state.success_streak) : 0,
              badge_level: (state.badge_level ?? '')
            };

            const summaryScreen = normalizeRewardScreen(
              policy.summary_screen,
              policy.summary_title || 'Rewards Summary',
              policy.summary_template_html || ''
            );

            // If template is still empty, provide a minimal fallback.
            if (!summaryScreen.template_html) {
              summaryScreen.template_html = '<p><b>Total earned</b>: {{total_points}} {{currency_label}}</p>\n<p><b>Rewarded trials</b>: {{rewarded_trials}} / {{eligible_trials}}</p>\n<p>Press {{continue_key_label}} to finish.</p>';
            }

            return renderRewardScreenHtml(summaryScreen, vars, { titleFallback: summaryScreen.title || 'Rewards Summary' });
          } catch (e) {
            return `<div class="psy-wrap"><div class="psy-stage"><div class="psy-text"><h2>Rewards Summary</h2><p>Could not compute rewards.</p></div></div></div>`;
          }
        },
        choices: contChoices,
        on_start: () => {
          try {
            const bag = window[storeKey];
            const policy = bag && bag.policy ? bag.policy : rewardsPolicy;
            const summaryScreen = normalizeRewardScreen(
              policy.summary_screen,
              policy.summary_title || 'Rewards Summary',
              policy.summary_template_html || ''
            );
            if (summaryScreen.audio_url) playRewardAudio(summaryScreen.audio_url);
          } catch {
            // ignore
          }
        },
        data: { plugin_type: 'reward-summary' }
      });
    }

    return { experimentType, timeline };
  }

  function normalizeDataCollection(raw) {
    // RDM builder exports booleans under keys like 'reaction-time'.
    // Some example schemas use nested { reaction_time: { enabled: true } }.
    if (!isObject(raw)) return {};

    // If it already looks like the hyphenated boolean map, keep it.
    if (
      typeof raw['reaction-time'] === 'boolean' ||
      typeof raw['accuracy'] === 'boolean' ||
      typeof raw['correctness'] === 'boolean'
    ) {
      return raw;
    }

    const out = {};
    if (isObject(raw.reaction_time) && typeof raw.reaction_time.enabled === 'boolean') out['reaction-time'] = raw.reaction_time.enabled;
    if (isObject(raw.accuracy) && typeof raw.accuracy.enabled === 'boolean') out['accuracy'] = raw.accuracy.enabled;
    if (isObject(raw.correctness) && typeof raw.correctness.enabled === 'boolean') out['correctness'] = raw.correctness.enabled;
    if (isObject(raw['eye-tracking']) && typeof raw['eye-tracking'].enabled === 'boolean') out['eye-tracking'] = raw['eye-tracking'].enabled;
    if (isObject(raw.eye_tracking) && typeof raw.eye_tracking.enabled === 'boolean') out['eye-tracking'] = raw.eye_tracking.enabled;
    return out;
  }

  function normalizeRdmParams(params) {
    const p = isObject(params) ? { ...params } : {};

    const parseBoolish = (v) => {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v > 0;
      if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === 'true' || s === '1' || s === 'yes' || s === 'on' || s === 'enabled') return true;
        if (s === 'false' || s === '0' || s === 'no' || s === 'off' || s === 'disabled') return false;
      }
      return false;
    };

    const parseFrameRange = (raw) => {
      const s = (raw ?? '').toString().trim();
      if (!s) return null;

      const single = s.match(/^(\d+)$/);
      if (single) {
        const n = Number.parseInt(single[1], 10);
        return Number.isFinite(n) && n > 0 ? { min: n, max: n } : null;
      }

      const span = s.match(/^(\d+)\s*-\s*(\d+)$/);
      if (!span) return null;

      let min = Number.parseInt(span[1], 10);
      let max = Number.parseInt(span[2], 10);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max < 1) return null;
      if (max < min) {
        const t = min;
        min = max;
        max = t;
      }
      return { min, max };
    };

    const parseDirectionExpression = (raw) => {
      const s = (raw ?? '').toString().trim();
      if (!s) return null;

      const tokens = s
        .split(/[\n,]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (tokens.length === 0) return null;

      const items = [];
      for (const token of tokens) {
        const n = Number(token);
        if (Number.isFinite(n)) {
          items.push({ kind: 'value', value: n });
          continue;
        }

        const m = /^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/.exec(token);
        if (!m) return null;

        const a = Number(m[1]);
        const b = Number(m[2]);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

        items.push({ kind: 'range', min: Math.min(a, b), max: Math.max(a, b) });
      }

      if (items.length === 0) return null;
      return items;
    };

    const sampleDirectionExpression = (raw) => {
      const spec = parseDirectionExpression(raw);
      if (!spec) return null;

      const pick = spec[Math.floor(Math.random() * spec.length)];
      if (!pick) return null;

      if (pick.kind === 'value') return pick.value;

      const min = Number(pick.min);
      const max = Number(pick.max);
      if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
      if (Math.floor(min) === min && Math.floor(max) === max) {
        const lo = Math.trunc(min);
        const hi = Math.trunc(max);
        return lo + Math.floor(Math.random() * (hi - lo + 1));
      }
      return min + (max - min) * Math.random();
    };

    // Allow nested config style: per-trial overrides may provide aperture fields under
    // `aperture_parameters: { ... }`. Flatten any missing keys for convenience.
    if (isObject(p.aperture_parameters)) {
      for (const [k, v] of Object.entries(p.aperture_parameters)) {
        if (p[k] === undefined) p[k] = v;
      }
    }

    // Builder commonly exports aperture parameters as { shape, diameter }.
    if (p.aperture_shape === undefined && p.shape !== undefined) {
      const s = String(p.shape).toLowerCase();
      if (s === 'circle') p.aperture_shape = 'circle';
      else if (s === 'square' || s === 'rectangle') p.aperture_shape = 'square';
      else p.aperture_shape = 'circle';
    }

    // Use diameter as our "aperture_size" (engine interprets circle size as diameter).
    if (p.aperture_size === undefined) {
      if (p.aperture_diameter !== undefined) p.aperture_size = p.aperture_diameter;
      else if (p.diameter !== undefined) p.aperture_size = p.diameter;
    }

    if (p.dynamic_target_group_switch_enabled !== undefined || p.dynamic_target_group_every_n_frames !== undefined) {
      const enabled = parseBoolish(p.dynamic_target_group_switch_enabled);
      p.dynamic_target_group_switch_enabled = enabled;

      const parsedRange = parseFrameRange(p.dynamic_target_group_every_n_frames);
      if (enabled) {
        const range = parsedRange || { min: 120, max: 240 };
        p.dynamic_target_group_every_n_frames = `${range.min}-${range.max}`;
        p.dynamic_target_group_every_n_frames_min = range.min;
        p.dynamic_target_group_every_n_frames_max = range.max;
      } else {
        delete p.dynamic_target_group_every_n_frames_min;
        delete p.dynamic_target_group_every_n_frames_max;
      }
    }

    if (typeof p.direction === 'string') {
      const sampledDirection = sampleDirectionExpression(p.direction);
      if (Number.isFinite(sampledDirection)) {
        p.direction = sampledDirection;
      }
    }

    return p;
  }

  function applyResponseDerivedRdmFields(rdm, response) {
    const out = isObject(rdm) ? { ...rdm } : {};
    const resp = isObject(response) ? response : {};

    // Map response-target-group (builder uses group_1/group_2 strings in overrides).
    if (out.response_target_group === undefined && resp.response_target_group !== undefined) {
      const raw = resp.response_target_group;
      if (raw === 'group_1') out.response_target_group = 1;
      else if (raw === 'group_2') out.response_target_group = 2;
      else if (Number.isFinite(Number(raw))) out.response_target_group = Number(raw);
    }

    // Cue border: builder may export as response.cue_border = { enabled, mode, target_group, color, width }.
    if (isObject(resp.cue_border) && resp.cue_border.enabled) {
      const cue = resp.cue_border;
      const width = Number(cue.width ?? cue.border_width ?? 3);

      // The engine currently expects flat fields. We map any enabled cue to a custom border with explicit color.
      out.cue_border_mode = 'custom';
      if (Number.isFinite(width)) out.cue_border_width = width;
      if (typeof cue.color === 'string') out.cue_border_color = cue.color;

      if (out.response_target_group === undefined) {
        if (cue.target_group === 'group_1') out.response_target_group = 1;
        else if (cue.target_group === 'group_2') out.response_target_group = 2;
      }
    }

    return out;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  window.TimelineCompiler = {
    expandTimeline,
    compileToJsPsychTimeline
  };
})();
