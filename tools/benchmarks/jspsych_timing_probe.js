#!/usr/bin/env node
'use strict';

/**
 * CogFlow jsPsych timing probe — comparable to Bridges et al. (2020) Table 3.
 *
 * Loads jsPsych v8.2.3 (same version as the CogFlow Interpreter) in Playwright
 * Chromium, runs a 300 ms ITI → 200 ms white-square stimulus timeline, fires a
 * real Playwright keypress exactly TARGET_RT_MS after each stimulus onset, and
 * records what jsPsych logs as RT and actual stimulus duration.
 *
 * Usage:  node jspsych_timing_probe.js [--runs N] [--trials N] [--headless]
 * Defaults: 20 runs, 200 trials/run, headed Chrome.
 * Env:     PROBE_RUNS  PROBE_TRIALS  PROBE_HEADLESS=1
 */

const fs   = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('[probe] playwright not found — run: npm install');
  process.exit(1);
}

const argv    = process.argv.slice(2);
const argN    = (flag, env, def) => Number(argv[argv.indexOf(flag) + 1] ?? process.env[env] ?? def);
const N_RUNS   = argN('--runs',   'PROBE_RUNS',   20);
const N_TRIALS = argN('--trials', 'PROBE_TRIALS', 200);
const HEADLESS = argv.includes('--headless') || process.env.PROBE_HEADLESS === '1';

const STIM_MS       = 200;
const ITI_MS        = 300;
const TARGET_RT_MS  = 100;
const WARMUP_TRIALS = 5;

const OUTPUT_DIR  = path.join(__dirname, 'output');
const TS          = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT_FILE    = path.join(OUTPUT_DIR, `jspsych-timing-probe-${TS}.json`);
const LATEST_FILE = path.join(OUTPUT_DIR, 'jspsych-timing-probe-latest.json');

const mean = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
const sd   = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};
const pct = (a, p) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
};
const summarise = (vals) => ({
  n: vals.length, mean: +mean(vals).toFixed(3), sd: +sd(vals).toFixed(3),
  p5: +pct(vals, 5).toFixed(3), p50: +pct(vals, 50).toFixed(3), p95: +pct(vals, 95).toFixed(3),
});

const PROBE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>CogFlow jsPsych timing probe</title>
  <link rel="stylesheet" href="https://unpkg.com/jspsych@8.2.3/css/jspsych.css"/>
  <script src="https://unpkg.com/jspsych@8.2.3/dist/index.browser.min.js"></script>
  <script src="https://unpkg.com/@jspsych/plugin-html-keyboard-response@2.1.0/dist/index.browser.min.js"></script>
  <style>
    body,#probe-target{background:#1a1a1a;margin:0;padding:0;width:100vw;height:100vh;}
    .probe-stim{width:200px;height:200px;background:white;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);}
  </style>
</head>
<body>
  <div id="probe-target"></div>
  <script>
  window.runTimingProbe = function(nTrials, stimMs, itiMs, warmup) {
    return new Promise(function(resolve, reject) {
      var timingData = [];
      var timeline   = [];
      var trialStartTs = 0;
      for (var i = 0; i < nTrials + warmup; i++) {
        (function(idx) {
          var isWarmup = idx < warmup;
          // ITI also serves as the duration-accuracy probe (no response, full itiMs)
          timeline.push({
            type: jsPsychHtmlKeyboardResponse, stimulus: '',
            trial_duration: itiMs, response_ends_trial: false, choices: 'NO_KEYS',
            on_start: function() { trialStartTs = performance.now(); },
            on_finish: function() {
              if (!isWarmup) window.__itiDurError = performance.now() - trialStartTs - itiMs;
            }
          });
          timeline.push({
            type: jsPsychHtmlKeyboardResponse,
            stimulus: '<div class="probe-stim"></div>',
            trial_duration: stimMs + 80,
            response_ends_trial: true,
            choices: [' '],
            on_start: function() {
              trialStartTs = performance.now();
              if (typeof window.notifyTrialStart === 'function') window.notifyTrialStart();
            },
            on_finish: function(data) {
              if (isWarmup) return;
              var rt = (data.rt !== null && data.rt !== undefined) ? Number(data.rt) : null;
              timingData.push({
                trial: idx - warmup, rt: rt,
                rt_error: rt !== null ? rt - 100 : null,
                dur_error: (typeof window.__itiDurError === 'number') ? window.__itiDurError : null,
                responded: data.response !== null && data.response !== undefined
              });
              window.__itiDurError = null;
            }
          });
        })(i);
      }
      try {
        var jsPsych = initJsPsych({ display_element: 'probe-target', on_finish: function() { resolve(timingData); } });
        jsPsych.run(timeline);
      } catch(e) { reject(e); }
    });
  };
  </script>
</body>
</html>`;

async function executeRun(browser, runIdx) {
  process.stdout.write(`  run ${String(runIdx + 1).padStart(2)}/${N_RUNS} … `);
  const t0  = Date.now();
  const ctx  = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.warn(`\n  [page err run ${runIdx+1}] ${e.message}`));

  await page.exposeFunction('notifyTrialStart', async () => {
    await new Promise(r => setTimeout(r, TARGET_RT_MS));
    await page.keyboard.press(' ');
  });

  await page.setContent(PROBE_HTML, { waitUntil: 'networkidle', timeout: 60_000 });

  const evalTimeoutMs = (ITI_MS + STIM_MS + 150) * (N_TRIALS + WARMUP_TRIALS) + 20_000;
  page.setDefaultTimeout(evalTimeoutMs);
  const rawData = await page.evaluate(
    ({ n, stim, iti, warmup }) => window.runTimingProbe(n, stim, iti, warmup),
    { n: N_TRIALS, stim: STIM_MS, iti: ITI_MS, warmup: WARMUP_TRIALS }
  );
  await ctx.close();

  const responded  = rawData.filter(d => d.responded);
  const rtErrors   = responded.map(d => d.rt_error).filter(v => v !== null);
  const durErrors  = rawData.map(d => d.dur_error);
  const wallMs     = Date.now() - t0;

  const rtStats  = summarise(rtErrors);
  const durStats = summarise(durErrors);
  const run = {
    run: runIdx + 1, n_trials: N_TRIALS, n_responded: responded.length,
    response_rate: +(responded.length / N_TRIALS).toFixed(4),
    rt_error: rtStats, duration_error: durStats,
    mean_precision: +((rtStats.sd + durStats.sd) / 2).toFixed(3), wall_ms: wallMs,
  };

  console.log(
    `RT prec ${rtStats.sd.toFixed(2)} ms (lag ${rtStats.mean >= 0 ? '+' : ''}${rtStats.mean.toFixed(1)}) | ` +
    `dur prec ${durStats.sd.toFixed(2)} ms | responded ${responded.length}/${N_TRIALS} | ${(wallMs/1000).toFixed(1)} s`
  );
  return run;
}

function aggregate(runs) {
  const valid = runs.filter(r => !r.error && r.n_responded > 0);
  if (!valid.length) return { error: 'all runs failed', per_run: runs };
  const rtSDs  = valid.map(r => r.rt_error.sd);
  const durSDs = valid.map(r => r.duration_error.sd);
  const rtLags = valid.map(r => r.rt_error.mean);
  const durLags= valid.map(r => r.duration_error.mean);
  const precs  = valid.map(r => r.mean_precision);
  return {
    n_runs: N_RUNS, n_valid_runs: valid.length, n_trials_per_run: N_TRIALS,
    warmup_trials: WARMUP_TRIALS, target_rt_ms: TARGET_RT_MS,
    stim_duration_ms: STIM_MS, iti_ms: ITI_MS,
    jspsych_version: '8.2.3', plugin: 'html-keyboard-response@2.1.0',
    mode: HEADLESS ? 'headless' : 'headed',
    rt_precision:       { mean_sd: +mean(rtSDs).toFixed(3), sd_sd: +sd(rtSDs).toFixed(3), min: +Math.min(...rtSDs).toFixed(3), max: +Math.max(...rtSDs).toFixed(3) },
    rt_lag:             { mean: +mean(rtLags).toFixed(3), sd: +sd(rtLags).toFixed(3) },
    duration_precision: { mean_sd: +mean(durSDs).toFixed(3), sd_sd: +sd(durSDs).toFixed(3), min: +Math.min(...durSDs).toFixed(3), max: +Math.max(...durSDs).toFixed(3) },
    duration_lag:       { mean: +mean(durLags).toFixed(3), sd: +sd(durLags).toFixed(3) },
    mean_precision:     { mean: +mean(precs).toFixed(3), sd: +sd(precs).toFixed(3) },
    per_run: runs,
  };
}

(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log('CogFlow jsPsych timing probe');
  console.log(`  jsPsych v8.2.3 · html-keyboard-response@2.1.0`);
  console.log(`  ${N_RUNS} runs × ${N_TRIALS} trials (${WARMUP_TRIALS} warmup discarded) · ${HEADLESS ? 'headless' : 'headed'} Chrome`);
  console.log(`  Stimulus ${STIM_MS} ms white square · ITI ${ITI_MS} ms · target RT ${TARGET_RT_MS} ms\n`);

  const browser = await chromium.launch({ headless: HEADLESS });
  const runs = [];

  for (let i = 0; i < N_RUNS; i++) {
    try {
      runs.push(await executeRun(browser, i));
    } catch (err) {
      console.error(`  [run ${i+1} failed] ${err.message}`);
      runs.push({ run: i+1, error: err.message, n_responded: 0, rt_error: summarise([]), duration_error: summarise([]), mean_precision: 0 });
    }
  }

  await browser.close();

  const result = aggregate(runs);
  if (result.error) { console.error('\nAll runs failed:', result.error); process.exit(1); }

  console.log('\n── Aggregate across runs ───────────────────────────────────────');
  console.log(`RT precision (Var SD):     ${result.rt_precision.mean_sd} ± ${result.rt_precision.sd_sd} ms  [range ${result.rt_precision.min}–${result.rt_precision.max}]`);
  console.log(`RT lag (mean error):       ${result.rt_lag.mean} ± ${result.rt_lag.sd} ms`);
  console.log(`Duration precision (Var):  ${result.duration_precision.mean_sd} ± ${result.duration_precision.sd_sd} ms`);
  console.log(`Duration lag:              ${result.duration_lag.mean} ± ${result.duration_lag.sd} ms`);
  console.log(`Mean precision index:      ${result.mean_precision.mean} ± ${result.mean_precision.sd} ms`);
  console.log('\n  Bridges et al. (2020) jsPsych: RT precision 0.66–8.37 ms, mean precision 3.4–7.4 ms');

  fs.writeFileSync(OUT_FILE,    JSON.stringify(result, null, 2));
  fs.writeFileSync(LATEST_FILE, JSON.stringify(result, null, 2));
  console.log(`\nSaved → ${OUT_FILE}`);
})().catch(err => { console.error('[fatal]', err); process.exit(1); });
