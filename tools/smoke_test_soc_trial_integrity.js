#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('./benchmarks/node_modules/playwright');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

global.window = { location: { href: 'http://localhost/' }, cogflowState: {} };
const compilerSource = fs.readFileSync(
  path.join(__dirname, '../frontend/interpreter/src/timelineCompiler.js'),
  'utf8'
);
eval(compilerSource);

const authoredTimeline = [
  {
    type: 'block',
    component_type: 'sart-trial',
    block_length: 6,
    parameter_values: { trial_duration_ms: 1000 },
  },
  {
    type: 'mw-probe',
    global_interval_min_ms: 1,
    global_interval_max_ms: 1,
    global_probe_count_per_block: 3,
  },
];

const expanded = window.TimelineCompiler.expandTimeline(authoredTimeline, { taskType: 'soc-dashboard' });
const sartCount = expanded.filter((item) => item?.type === 'sart-trial').length;
const probeIndices = expanded
  .map((item, index) => item?.type === 'mw-probe' ? index : -1)
  .filter((index) => index >= 0);

assert(sartCount === 6, `Expected 6 SART trials after expansion, got ${sartCount}`);
assert(
  probeIndices.length === 1 && probeIndices[0] > 0,
  `Expected one retained SOC probe after SART onset, got indices ${probeIndices}`
);

async function verifyRuntimeFinalization() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main id="display"></main>');
    await page.addScriptTag({
      path: path.join(__dirname, '../frontend/interpreter/src/jspsych-soc-dashboard.js'),
    });

    const result = await page.evaluate(() => new Promise((resolve) => {
      const plugin = new window.jsPsychSocDashboard({ finishTrial: resolve });
      plugin.trial(document.querySelector('#display'), {
        trial_duration_ms: 250,
        end_key: 'escape',
        title: 'SOC integrity smoke test',
        subtasks: [{
          type: 'sart-like',
          title: 'Compressed SART',
          start_at_ms: 0,
          duration_ms: 300,
          min_run_ms: 300,
          max_run_ms: 300,
          subtask_duration_entries: 3,
          scroll_interval_ms: 100,
          visible_entries: 3,
          response_device: 'keyboard',
          go_key: 'space',
          go_condition: 'allow',
          harmful_subdomains: ['blocked.test'],
          benign_subdomains: ['allowed.test'],
          harmful_probability: 0.5,
          benign_probability: 0.5,
          include_neutral_entries: false,
          instructions: '',
        }],
      });
    }));

    const sartEvents = result.events.filter((event) => event?.type === 'sart_trial');
    const summary = result.subtasks_summary?.sart_like?.[0];
    assert(sartEvents.length === 3, `Expected 3 finalized SART events, got ${sartEvents.length}`);
    assert(summary?.presented === 3, `Expected summary presented=3, got ${summary?.presented}`);
    assert(summary?.finalized === 3, `Expected summary finalized=3, got ${summary?.finalized}`);
    assert(
      sartEvents.at(-1)?.ended_reason === 'forced_end',
      `Expected final SART event to be force-finalized, got ${sartEvents.at(-1)?.ended_reason}`
    );
  } finally {
    await browser.close();
  }
}

verifyRuntimeFinalization()
  .then(() => console.log('SOC trial integrity smoke test passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });