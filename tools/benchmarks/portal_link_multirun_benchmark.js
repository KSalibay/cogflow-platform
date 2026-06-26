#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (err) {
  console.error('[portal-multirun] Missing dependency: playwright');
  console.error('[portal-multirun] Install once with: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const REPEATS = Math.max(1, Number(process.env.BENCH_REPEATS || 6));
const TARGET_FRAME_MS = 1000 / 60;
const OUT_DIR = path.resolve(__dirname, 'output');

const TARGETS = [
  {
    id: 'basic',
    label: 'Basic benchmark study',
    url:
      process.env.BENCH_URL_BASIC ||
      'https://portal.cogflow.app/interpreter/index.html?launch=.eJx1kN1OwzAMhd_Ft6woa6eJ9jm4Q8hyE5dFy0_lJDCEeHdcJtAu4PZ857OO_AGlNveOJbQXmGDmZE-R5NyJi91MxVvYgXBhEntiwVZYEkXWLrnok9KVpHrrV0oV-VI3HtA7bSi0uSWNZgqULCMnmgMrq9J4B3oNl5Df8JXEq19gWigUJZXKGbM4FpieYBgGeL4NsVTxtv7W-bJ6XYmkEfSmP3bm2PXj4_5hGvppf7jvx3E87O-MmYz5nhXXwNXnhMJOVVuxSbhupjlL_SNfJQe_eIs3dsxu-4XjhVqo_5TstaQ0UNMH_1hRFb-9FD6_AOwziK8:1wdBLa:zdSewdZM_SXkA-4Lq_hDvVp8R1fW8-H9snoTo5ph2_o',
  },
  {
    id: 'stress',
    label: 'Stress benchmark study',
    url:
      process.env.BENCH_URL_STRESS ||
      'https://portal.cogflow.app/interpreter/index.html?launch=.eJx1kM1OxDAMhN8lV7aotKVAnoMbQpabuGy0-akcBxYh3h0vK9Ae4GRpvhlrNB-mSvPvUGN7MdYslN0-IR869qmrwlSr2Rk9hOz2xNAqccZEakafQla6IUtwYcMsQEc58QjBq0OhKy2rtGDE7Ago4xJJmXCjndFvsMbyBq_IQfPV2BVjVSJYD1DYExv7ZMZxMs-XImi34OTXTsctaEtAlczQD3PXz93w8Hhzb8fB3o7X8zzdDdNV39u-_66VtkgSSgYmr1En0DieO-NSWP7QNy4xrMHBRToVf9rC04otyj8mdzYpjdh04Z9U0kg4TWo-vwDchYlQ:1wdBMD:kIpt-zG0jyEP-lhpkboPbKlrI8qzF0akEzE3LA5ccz0',
  },
];

const PROFILES = [
  { id: 'lan_baseline', label: 'LAN baseline', network: null },
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
];

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((acc, x) => acc + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[idx];
}

function summarizeSamples(arr) {
  return {
    n: arr.length,
    mean: mean(arr),
    sd: std(arr),
    p50: percentile(arr, 50),
    p95: percentile(arr, 95),
    min: arr.length ? Math.min(...arr) : null,
    max: arr.length ? Math.max(...arr) : null,
  };
}

function ci95(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  const se = std(arr) / Math.sqrt(arr.length);
  const delta = 1.96 * se;
  return { lower: m - delta, upper: m + delta };
}

async function applyNetworkProfile(context, page, profile) {
  if (!profile.network) return;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: profile.network.latency,
    downloadThroughput: Math.floor((profile.network.downloadKbps * 1024) / 8),
    uploadThroughput: Math.floor((profile.network.uploadKbps * 1024) / 8),
    connectionType: profile.network.connectionType,
  });
}

async function runMicrobench(page) {
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
        if (count >= 180) resolve();
        else requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });

    const timeoutDeltas = [];
    const targetInterval = 16;
    let expected = performance.now() + targetInterval;
    for (let i = 0; i < 90; i += 1) {
      await sleep(targetInterval);
      const now = performance.now();
      timeoutDeltas.push(now - expected);
      expected += targetInterval;
    }

    const inputSamples = [];
    let dispatchTs = null;
    const handler = (ev) => {
      if (ev.code === 'Space') {
        const seen = performance.now();
        if (Number.isFinite(dispatchTs) && dispatchTs > 0) inputSamples.push(seen - dispatchTs);
      }
    };
    window.addEventListener('keydown', handler);
    for (let i = 0; i < 40; i += 1) {
      dispatchTs = performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
      await sleep(4);
    }
    window.removeEventListener('keydown', handler);

    return { rafDeltas, timeoutDeltas, inputSamples };
  });
}

function perRunMetrics(raw) {
  const frameMean = mean(raw.rafDeltas);
  const frameBias = (frameMean ?? 0) - TARGET_FRAME_MS;
  return {
    frame_interval_mean_ms: frameMean,
    frame_interval_sd_ms: std(raw.rafDeltas),
    frame_interval_p95_ms: percentile(raw.rafDeltas, 95),
    frame_bias_vs_60hz_ms: frameBias,
    timeout_drift_mean_ms: mean(raw.timeoutDeltas),
    timeout_drift_sd_ms: std(raw.timeoutDeltas),
    timeout_drift_p95_ms: percentile(raw.timeoutDeltas, 95),
    input_reg_mean_ms: mean(raw.inputSamples),
    input_reg_sd_ms: std(raw.inputSamples),
    input_reg_p95_ms: percentile(raw.inputSamples, 95),
  };
}

async function runOne(target, profile, iteration) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  await applyNetworkProfile(context, page, profile);

  const t0 = Date.now();
  await page.goto(target.url, { waitUntil: 'load', timeout: 180000 });
  const navLoaded = Date.now();
  await page.waitForFunction(() => !!document.querySelector('canvas'), { timeout: 180000 });
  const ready = Date.now();

  const raw = await runMicrobench(page);
  await context.close();
  await browser.close();

  return {
    target: target.id,
    profile: profile.id,
    iteration,
    navigation_ms: navLoaded - t0,
    study_ready_ms: ready - t0,
    ...perRunMetrics(raw),
    raw_counts: {
      raf_n: raw.rafDeltas.length,
      timeout_n: raw.timeoutDeltas.length,
      input_n: raw.inputSamples.length,
    },
  };
}

function aggregate(allRuns) {
  const grouped = new Map();
  for (const row of allRuns) {
    const key = `${row.target}::${row.profile}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  const summaries = [];
  for (const [key, rows] of grouped.entries()) {
    const [target, profile] = key.split('::');
    const nav = rows.map((r) => r.navigation_ms);
    const ready = rows.map((r) => r.study_ready_ms);
    const frameP95 = rows.map((r) => r.frame_interval_p95_ms);
    const timeoutP95 = rows.map((r) => r.timeout_drift_p95_ms);
    const inputP95 = rows.map((r) => r.input_reg_p95_ms);

    const frameVar = rows.map((r) => r.frame_interval_sd_ms);
    const timeoutVar = rows.map((r) => r.timeout_drift_sd_ms);
    const inputVar = rows.map((r) => r.input_reg_sd_ms);

    const frameBias = rows.map((r) => r.frame_bias_vs_60hz_ms);
    const timeoutBias = rows.map((r) => r.timeout_drift_mean_ms);
    const inputBias = rows.map((r) => r.input_reg_mean_ms);

    const meanPrecision = mean([
      mean(frameVar) ?? 0,
      mean(timeoutVar) ?? 0,
      mean(inputVar) ?? 0,
    ]);

    summaries.push({
      target,
      profile,
      repeats: rows.length,
      navigation_ms: { ...summarizeSamples(nav), ci95: ci95(nav) },
      study_ready_ms: { ...summarizeSamples(ready), ci95: ci95(ready) },
      frame_p95_ms: { ...summarizeSamples(frameP95), ci95: ci95(frameP95) },
      timeout_p95_ms: { ...summarizeSamples(timeoutP95), ci95: ci95(timeoutP95) },
      input_p95_ms: { ...summarizeSamples(inputP95), ci95: ci95(inputP95) },
      precision_variability_ms: {
        mean_precision: meanPrecision,
        frame_var_sd: mean(frameVar),
        timeout_var_sd: mean(timeoutVar),
        input_var_sd: mean(inputVar),
      },
      lag_bias_ms: {
        startup_bias_mean: mean(ready),
        frame_bias_mean: mean(frameBias),
        timeout_bias_mean: mean(timeoutBias),
        input_bias_mean: mean(inputBias),
      },
    });
  }

  summaries.sort((a, b) => a.precision_variability_ms.mean_precision - b.precision_variability_ms.mean_precision);
  return summaries;
}

async function main() {
  const startedAt = new Date().toISOString();
  const runRows = [];

  for (const target of TARGETS) {
    for (const profile of PROFILES) {
      for (let i = 1; i <= REPEATS; i += 1) {
        console.log(`[portal-multirun] ${target.id}/${profile.id} run ${i}/${REPEATS}`);
        const row = await runOne(target, profile, i);
        runRows.push(row);
      }
    }
  }

  const summaries = aggregate(runRows);
  const finishedAt = new Date().toISOString();

  const report = {
    started_at: startedAt,
    finished_at: finishedAt,
    repeats_per_condition: REPEATS,
    targets: TARGETS,
    profiles: PROFILES,
    run_level_data: runRows,
    condition_summaries: summaries,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(OUT_DIR, `portal-link-benchmark-multirun-${stamp}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const latestPath = path.join(OUT_DIR, 'portal-link-benchmark-multirun-latest.json');
  fs.writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[portal-multirun] Wrote report: ${outPath}`);
  console.log(`[portal-multirun] Updated latest: ${latestPath}`);
  for (const s of summaries) {
    console.log(
      `[portal-multirun] ${s.target}/${s.profile} mean_precision=${s.precision_variability_ms.mean_precision.toFixed(3)}ms ready_mean=${s.study_ready_ms.mean.toFixed(1)}ms`
    );
  }
}

main().catch((err) => {
  console.error('[portal-multirun] Failed:', err?.stack || err);
  process.exit(1);
});
