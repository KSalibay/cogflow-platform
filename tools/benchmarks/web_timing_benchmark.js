#!/usr/bin/env node
'use strict';

/**
 * CogFlow web timing benchmark harness (software layer only).
 *
 * Run:
 *   node tools/benchmarks/web_timing_benchmark.js
 *
 * Optional env vars:
 *   BENCH_TARGET_URL=http://localhost:8000/interpreter/index.html
 *   BENCH_OUTPUT=tools/benchmarks/output/latest.json
 */

const fs = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (err) {
  console.error('[benchmark] Missing dependency: playwright');
  console.error('[benchmark] Install once with: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const BENCHMARK_CONFIGS = [
  {
    id: 'lan_baseline',
    label: 'LAN baseline',
    source: 'No emulation; local baseline for software-layer timing',
    network: null,
  },
  {
    id: 'broadband_sim',
    label: 'Broadband simulation',
    source: 'Inspired by practical desktop broadband conditions',
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
    source: 'Comparable to common DevTools "Slow 4G" style conditions',
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
    source: 'Stress test for high-latency / constrained throughput environments',
    network: {
      latency: 300,
      downloadKbps: 700,
      uploadKbps: 300,
      connectionType: 'cellular3g',
    },
  },
];

const CANDIDATE_URLS = [
  process.env.BENCH_TARGET_URL,
  'http://localhost:8000/interpreter/index.html',
  'http://localhost:8000/interpreter/',
  'http://localhost:4177/',
].filter(Boolean);

const OUTPUT_PATH = process.env.BENCH_OUTPUT
  ? path.resolve(process.cwd(), process.env.BENCH_OUTPUT)
  : path.join(__dirname, 'output', 'latest.json');

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

async function pickReachableUrl() {
  for (const url of CANDIDATE_URLS) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok || (res.status >= 300 && res.status < 500)) {
        return url;
      }
    } catch {
      // try next candidate
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

async function runInPageMicrobench(page) {
  return page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // RAF frame jitter benchmark
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

    // setTimeout drift benchmark
    const timeoutDeltas = [];
    const targetInterval = 16;
    let expected = performance.now() + targetInterval;
    for (let i = 0; i < 120; i += 1) {
      await sleep(targetInterval);
      const now = performance.now();
      timeoutDeltas.push(now - expected);
      expected += targetInterval;
    }

    // Synthetic input capture latency benchmark
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

    const target = document.body;
    target.setAttribute('tabindex', '-1');
    target.focus();
    window.addEventListener('keydown', handler);
    for (let i = 0; i < 50; i += 1) {
      const dispatchTs = performance.now();
      lastDispatchTs = dispatchTs;
      const event = new KeyboardEvent('keydown', { code: 'Space', key: ' ' });
      window.dispatchEvent(event);
      await sleep(4);
    }
    window.removeEventListener('keydown', handler);

    // Optional same-origin fetch RTT benchmark
    const fetchSamples = [];
    const candidatePaths = ['/api/v1/auth/csrf', '/'];
    for (let i = 0; i < 8; i += 1) {
      const path = candidatePaths[i % candidatePaths.length];
      const t0 = performance.now();
      try {
        await fetch(path, { credentials: 'include' });
        fetchSamples.push(performance.now() - t0);
      } catch {
        // ignore; keep as sparse metric
      }
    }

    return {
      rafDeltas,
      timeoutDeltas,
      inputSamples,
      fetchSamples,
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency,
    };
  });
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

async function runConfig(targetUrl, cfg) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();

  await applyNetworkProfile(context, page, cfg.network);

  const navStart = Date.now();
  await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 120000 });
  const navMs = Date.now() - navStart;

  const raw = await runInPageMicrobench(page);
  const summary = summarize(raw);

  await context.close();
  await browser.close();

  return {
    config_id: cfg.id,
    config_label: cfg.label,
    config_source: cfg.source,
    network_profile: cfg.network,
    target_url: targetUrl,
    navigation_time_ms: navMs,
    metrics: summary,
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
    console.error('[benchmark] No reachable target URL found.');
    console.error('[benchmark] Tried:', CANDIDATE_URLS.join(', '));
    process.exit(1);
  }

  console.log(`[benchmark] Target URL: ${targetUrl}`);

  const results = [];
  for (const cfg of BENCHMARK_CONFIGS) {
    console.log(`[benchmark] Running: ${cfg.label}`);
    const run = await runConfig(targetUrl, cfg);
    results.push(run);
    console.log(
      `  done: nav=${run.navigation_time_ms}ms, frame_p95=${run.metrics.frame_interval_ms.p95?.toFixed(2)}ms, input_p95=${run.metrics.synthetic_input_registration_ms.p95?.toFixed(2)}ms`
    );
  }

  const payload = {
    generated_at_utc: new Date().toISOString(),
    scope: 'software-layer web timing benchmark only',
    caveat:
      'Does not measure monitor/display-pipeline photon onset latency. Use in-house hardware validation for local/offline monitor-specific claims.',
    benchmark_configs: BENCHMARK_CONFIGS,
    results,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`[benchmark] Wrote results: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('[benchmark] Failed:', err?.stack || err);
  process.exit(1);
});
