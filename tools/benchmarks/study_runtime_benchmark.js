#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (err) {
  console.error('[study-benchmark] Missing dependency: playwright');
  console.error('[study-benchmark] Install once with: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const TEMPLATE_PATH = path.resolve(__dirname, '../../frontend/builder/src/templates/basic_rdm_template.json');
const OUTPUT_PATH = process.env.BENCH_OUTPUT
  ? path.resolve(process.cwd(), process.env.BENCH_OUTPUT)
  : path.join(__dirname, 'output', 'study-runtime-latest.json');

const CANDIDATE_URLS = [
  process.env.BENCH_TARGET_URL,
  'http://localhost:8000/interpreter/index.html',
  'http://localhost:8000/interpreter/',
  'http://localhost:4177/',
].filter(Boolean);

const NETWORK_PROFILES = [
  {
    id: 'lan_baseline',
    label: 'LAN baseline',
    network: null,
  },
  {
    id: 'broadband_sim',
    label: 'Broadband simulation',
    network: {
      latency: 20,
      downloadKbps: 30000,
      uploadKbps: 10000,
      connectionType: 'wifi',
    },
  },
  {
    id: 'slow4g_sim',
    label: 'Slow 4G simulation',
    network: {
      latency: 150,
      downloadKbps: 1600,
      uploadKbps: 750,
      connectionType: 'cellular4g',
    },
  },
  {
    id: 'degraded_link',
    label: 'Degraded link simulation',
    network: {
      latency: 300,
      downloadKbps: 700,
      uploadKbps: 300,
      connectionType: 'cellular3g',
    },
  },
];

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((acc, x) => acc + ((x - m) ** 2), 0) / (arr.length - 1);
  return Math.sqrt(v);
}

function summarize(raw) {
  const raf = raw.rafDeltas || [];
  const timeout = raw.timeoutDeltas || [];
  const input = raw.inputSamples || [];
  const fetch = raw.fetchSamples || [];
  const rafJitter = raf.map((x) => x - (1000 / 60));

  return {
    frame_interval_ms: {
      mean: mean(raf),
      p50: percentile(raf, 50),
      p95: percentile(raf, 95),
      sd: stddev(raf),
      n: raf.length,
    },
    frame_jitter_vs_60hz_ms: {
      mean: mean(rafJitter),
      p50: percentile(rafJitter, 50),
      p95: percentile(rafJitter, 95),
      sd: stddev(rafJitter),
      n: rafJitter.length,
    },
    timeout_drift_ms: {
      mean: mean(timeout),
      p50: percentile(timeout, 50),
      p95: percentile(timeout, 95),
      sd: stddev(timeout),
      n: timeout.length,
    },
    synthetic_input_registration_ms: {
      mean: mean(input),
      p50: percentile(input, 50),
      p95: percentile(input, 95),
      sd: stddev(input),
      n: input.length,
    },
    same_origin_fetch_rtt_ms: {
      mean: mean(fetch),
      p50: percentile(fetch, 50),
      p95: percentile(fetch, 95),
      sd: stddev(fetch),
      n: fetch.length,
    },
  };
}

async function pickReachableUrl() {
  for (const url of CANDIDATE_URLS) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok || (res.status >= 300 && res.status < 500)) return url;
    } catch {
      // try next
    }
  }
  return null;
}

async function applyNetworkProfile(context, page, profile) {
  if (!profile) return null;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: profile.latency,
    downloadThroughput: Math.floor((profile.downloadKbps * 1024) / 8),
    uploadThroughput: Math.floor((profile.uploadKbps * 1024) / 8),
    connectionType: profile.connectionType,
  });
  return cdp;
}

function makeStudyConfigs() {
  const base = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));
  const basic = JSON.parse(JSON.stringify(base));

  const normalizeRdmTimeline = (doc) => {
    const globalCoherence = doc.motion_parameters?.coherence;
    const globalDirection = doc.motion_parameters?.direction;
    const globalSpeed = doc.motion_parameters?.speed;
    const globalStimulusDuration = doc.timing_parameters?.stimulus_duration;

    if (!Array.isArray(doc.timeline)) return;

    doc.timeline = doc.timeline.map((trial) => {
      if (!trial || typeof trial !== 'object' || !String(trial.type || '').startsWith('rdm-')) {
        return trial;
      }

      const parameters = trial.parameters || {};
      const normalized = { ...trial };

      if (normalized.coherence === undefined) {
        normalized.coherence = parameters['motion.coherence'] ?? globalCoherence;
      }
      if (normalized.direction === undefined) {
        normalized.direction = parameters['motion.direction'] ?? globalDirection;
      }
      if (normalized.speed === undefined) {
        normalized.speed = parameters['motion.speed'] ?? globalSpeed;
      }
      if (normalized.stimulus_duration === undefined) {
        normalized.stimulus_duration = parameters['timing.stimulus_duration'] ?? globalStimulusDuration;
      }
      if (normalized.dot_color === undefined && parameters['dots.dot_color'] !== undefined) {
        normalized.dot_color = parameters['dots.dot_color'];
      }

      delete normalized.parameters;
      return normalized;
    });
  };

  const normalizeDataCollection = (doc) => {
    const dc = (doc && typeof doc.data_collection === 'object' && doc.data_collection)
      ? doc.data_collection
      : {};

    const toEnabled = (value, fallback = false) => {
      if (typeof value === 'boolean') return value;
      if (value && typeof value === 'object' && typeof value.enabled === 'boolean') return value.enabled;
      return fallback;
    };

    doc.data_collection = {
      'reaction-time': toEnabled(dc['reaction-time'], toEnabled(dc.reaction_time, true)),
      accuracy: toEnabled(dc.accuracy, true),
      correctness: toEnabled(dc.correctness, false),
      'eye-tracking': toEnabled(dc['eye-tracking'], toEnabled(dc.eye_tracking, false)),
      'mouse-tracking': toEnabled(dc['mouse-tracking'], toEnabled(dc.mouse_tracking, false)),
    };
  };

  normalizeRdmTimeline(basic);
  normalizeDataCollection(basic);

  const stress = JSON.parse(JSON.stringify(base));
  stress.experiment_meta = {
    ...(stress.experiment_meta || {}),
    name: 'RDM Stress Benchmark',
    description: 'Dense/high-count RDM benchmark derived from basic template',
  };
  stress.dot_parameters = {
    ...(stress.dot_parameters || {}),
    total_dots: 500,
    lifetime_frames: 3,
  };
  stress.timing_parameters = {
    ...(stress.timing_parameters || {}),
    fixation_duration: 350,
    stimulus_duration: 1200,
    response_deadline: 1800,
    inter_trial_interval: 400,
  };
  const baseTimeline = Array.isArray(stress.timeline) ? stress.timeline : [];
  const expandedTimeline = [];
  for (let i = 0; i < 8; i += 1) {
    for (const item of baseTimeline) {
      const cloned = JSON.parse(JSON.stringify(item));
      cloned.name = `${cloned.name || 'Trial'} #${i + 1}`;
      expandedTimeline.push(cloned);
    }
  }
  stress.timeline = expandedTimeline;
  normalizeRdmTimeline(stress);
  normalizeDataCollection(stress);

  return [
    {
      id: 'basic_rdm_template',
      label: 'Basic RDM Template',
      source: 'frontend/builder/src/templates/basic_rdm_template.json',
      config: basic,
    },
    {
      id: 'rdm_stress_dense',
      label: 'RDM Dense Stress Variant',
      source: 'Derived from basic_rdm_template.json with dense dots and expanded timeline',
      config: stress,
    },
  ];
}

async function waitForStudyReady(page) {
  await page.waitForSelector('#jspsych-target canvas', { timeout: 120000 });
}

async function runInPageMicrobench(page) {
  return page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const rafDeltas = [];
    await new Promise((resolve) => {
      let prev = performance.now();
      let count = 0;
      const loop = (now) => {
        rafDeltas.push(now - prev);
        prev = now;
        count += 1;
        if (count >= 240) resolve();
        else requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });

    const timeoutDeltas = [];
    const targetInterval = 16;
    let expected = performance.now() + targetInterval;
    for (let i = 0; i < 120; i += 1) {
      await sleep(targetInterval);
      const now = performance.now();
      timeoutDeltas.push(now - expected);
      expected += targetInterval;
    }

    const inputSamples = [];
    let lastDispatchTs = null;
    const handler = (ev) => {
      if (ev.code === 'Space') {
        const tSeen = performance.now();
        const tDispatched = Number(lastDispatchTs || 0);
        if (Number.isFinite(tDispatched) && tDispatched > 0) {
          inputSamples.push(tSeen - tDispatched);
        }
      }
    };

    document.body.setAttribute('tabindex', '-1');
    document.body.focus();
    window.addEventListener('keydown', handler);
    for (let i = 0; i < 50; i += 1) {
      lastDispatchTs = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
      await sleep(4);
    }
    window.removeEventListener('keydown', handler);

    const fetchSamples = [];
    const candidatePaths = ['/api/v1/auth/csrf', '/'];
    for (let i = 0; i < 8; i += 1) {
      const path = candidatePaths[i % candidatePaths.length];
      const t0 = performance.now();
      try {
        await fetch(path, { credentials: 'include' });
        fetchSamples.push(performance.now() - t0);
      } catch {
        // ignore
      }
    }

    return {
      rafDeltas,
      timeoutDeltas,
      inputSamples,
      fetchSamples,
      benchMarks: window.__cogflowBench || {},
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency,
    };
  });
}

async function runStudyConfig(targetUrl, studyConfig, networkConfig) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();

  await context.addInitScript((cfg) => {
    window.COGFLOW_COMPONENT_CONFIG = cfg;
    window.COGFLOW_DISABLE_URL_ID = true;
    window.__cogflowBench = {
      navStartTs: performance.now(),
    };
  }, studyConfig.config);

  await applyNetworkProfile(context, page, networkConfig.network);

  const navStart = Date.now();
  await page.goto(targetUrl, { waitUntil: 'load', timeout: 120000 });
  const navigationTimeMs = Date.now() - navStart;

  await waitForStudyReady(page);
  const raw = await runInPageMicrobench(page);
  const startupMs = await page.evaluate(() => {
    const navStartTs = Number(window.__cogflowBench?.navStartTs || 0);
    const now = performance.now();
    if (!Number.isFinite(navStartTs) || navStartTs <= 0) return null;
    return now - navStartTs;
  });

  await context.close();
  await browser.close();

  return {
    study_config_id: studyConfig.id,
    study_config_label: studyConfig.label,
    study_config_source: studyConfig.source,
    network_profile_id: networkConfig.id,
    network_profile: networkConfig.network,
    target_url: targetUrl,
    navigation_time_ms: navigationTimeMs,
    first_trial_visible_ms_from_nav_start: startupMs,
    metrics: summarize(raw),
    environment: {
      user_agent: raw.userAgent,
      device_pixel_ratio: raw.devicePixelRatio,
      hardware_concurrency: raw.hardwareConcurrency,
    },
  };
}

async function main() {
  const targetUrl = await pickReachableUrl();
  if (!targetUrl) {
    console.error('[study-benchmark] No reachable target URL found.');
    console.error('[study-benchmark] Tried:', CANDIDATE_URLS.join(', '));
    process.exit(1);
  }

  const studyConfigs = makeStudyConfigs();
  const results = [];

  console.log(`[study-benchmark] Target URL: ${targetUrl}`);
  for (const studyConfig of studyConfigs) {
    for (const networkConfig of NETWORK_PROFILES) {
      console.log(`[study-benchmark] Running ${studyConfig.id} on ${networkConfig.id}`);
      const run = await runStudyConfig(targetUrl, studyConfig, networkConfig);
      results.push(run);
      console.log(
        `  done: startup=${run.first_trial_visible_ms_from_nav_start?.toFixed(0)}ms, input_p95=${run.metrics.synthetic_input_registration_ms.p95?.toFixed(2)}ms, frame_p95=${run.metrics.frame_interval_ms.p95?.toFixed(2)}ms`
      );
    }
  }

  const payload = {
    generated_at_utc: new Date().toISOString(),
    scope: 'Interpreter study runtime benchmark with inline sample configs and emulated network conditions',
    caveat: 'Software-layer benchmark only. Does not measure display photon onset or device-specific keyboard hardware latency.',
    target_url: targetUrl,
    network_profiles: NETWORK_PROFILES,
    study_configs: studyConfigs.map((cfg) => ({
      id: cfg.id,
      label: cfg.label,
      source: cfg.source,
    })),
    results,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[study-benchmark] Wrote results: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('[study-benchmark] Failed:', err?.stack || err);
  process.exit(1);
});