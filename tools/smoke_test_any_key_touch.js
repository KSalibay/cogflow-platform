#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('./benchmarks/node_modules/playwright');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/interpreter/index.html'), 'utf8');
const styles = html.match(/<style>([\s\S]*?)<\/style>/)[1];

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}</style><main id="experiment"></main>`);
    for (const url of ['https://unpkg.com/jspsych@8.2.3/dist/index.browser.min.js', 'https://unpkg.com/@jspsych/plugin-html-keyboard-response@2/dist/index.browser.min.js']) {
      await page.addScriptTag({ url });
    }
    await page.addScriptTag({ path: path.join(root, 'frontend/interpreter/src/timelineCompiler.js') });
    await page.evaluate(() => {
      window.__psy_jsPsych = initJsPsych({ display_element: 'experiment' });
      const compiled = window.TimelineCompiler.compileToJsPsychTimeline({
        task_type: 'custom', experiment_type: 'trial-based', timeline: [
          { type: 'instructions', stimulus: '<h1 id="intro">Welcome</h1><a id="link" href="#details">Details</a><input id="field">', choices: 'ALL_KEYS' },
          { type: 'html-keyboard-response', stimulus: '<p id="space">Space only</p>', choices: 'space' },
          { type: 'html-keyboard-response', stimulus: '<p id="no-response">No keys</p>', choices: 'NO_KEYS' },
          { type: 'debriefing', stimulus: '<h1 id="debrief">Thank you</h1>', choices: 'ALL_KEYS' },
          { type: 'html-keyboard-response', stimulus: '<p id="last">Last screen</p>', choices: 'ALL_KEYS' },
        ],
      });
      window.__psy_jsPsych.run(compiled.timeline);
    });
    await page.locator('#intro').waitFor();
    await page.locator('#link').tap();
    assert.equal(await page.locator('#intro').count(), 1, 'Link taps must not advance');
    await page.locator('#field').tap();
    assert.equal(await page.locator('#intro').count(), 1, 'Input taps must not advance');
    await page.locator('#field').blur();
    await page.locator('#intro').evaluate(element => {
      element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 7, clientX: 40, clientY: 100 }));
      element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 7, clientX: 40, clientY: 150 }));
      element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 7, clientX: 40, clientY: 150 }));
    });
    assert.equal(await page.locator('#intro').count(), 1, 'Swipe must not advance');
    await page.locator('#intro').tap();
    await page.locator('#space').waitFor();
    await page.locator('#space').tap();
    assert.equal(await page.locator('#space').count(), 1, 'Specific-key screen must not accept taps');
    await page.keyboard.press('Space');
    await page.locator('#no-response').waitFor();
    await page.locator('#no-response').tap();
    assert.equal(await page.locator('#no-response').count(), 1, 'NO_KEYS must not accept taps');
    await page.evaluate(() => window.__psy_jsPsych.finishTrial({ response: null }));
    await page.locator('#debrief').waitFor();
    await page.locator('#debrief').tap();
    await page.locator('#last').waitFor();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__psy_jsPsych.data.get().count() === 5);
    const rows = await page.evaluate(() => window.__psy_jsPsych.data.get().values());
    assert.equal(rows[0].response_device, 'touch');
    assert.equal(rows[0].response, null);
    assert(rows[0].rt >= 0);
    assert.equal(rows[1].response, ' ');
    assert.equal(rows[3].response_device, 'touch');
    assert.equal(rows[4].response, 'Enter');
    const coverage = await page.evaluate(() => {
      window.jsPsychRdmContinuous = class {};
      const results = [];
      for (const [taskType, experimentType] of [['custom', 'trial-based'], ['rdm', 'continuous']]) {
        const compiled = window.TimelineCompiler.compileToJsPsychTimeline({
          task_type: taskType, experiment_type: experimentType,
          timeline: [
            { type: 'instructions', stimulus: '<p>Any key</p>', choices: 'ALL_KEYS' },
            { type: 'html-keyboard-response', stimulus: '<p>Timed</p>', choices: 'ALL_KEYS', response_ends_trial: false, trial_duration: 100 },
            { type: 'html-keyboard-response', stimulus: '<p>None</p>', choices: 'NO_KEYS' },
            { type: 'html-keyboard-response', stimulus: '<p>Space</p>', choices: ['space'] },
          ],
        });
        results.push({
          tap: typeof compiled.timeline[0].on_load === 'function',
          timed: typeof compiled.timeline[1].on_load === 'function',
          noKeys: typeof compiled.timeline[2].on_load === 'function',
          restricted: typeof compiled.timeline[3].on_load === 'function',
          space: compiled.timeline[3].choices[0],
        });
      }
      window.jsPsychHtmlButtonResponse = class {};
      const nested = window.TimelineCompiler.compileToJsPsychTimeline({
        task_type: 'custom', experiment_type: 'trial-based', timeline: [
          { type: 'html-button-response', stimulus: '<p>Consent</p>', consent_mode: true },
          { type: 'instructions', stimulus: '<p>After consent</p>', choices: 'ALL_KEYS' },
          { type: 'debriefing', stimulus: '<p>End</p>', choices: 'ALL_KEYS' },
        ],
      });
      if (typeof nested.timeline.find(trial => Array.isArray(trial.timeline))?.timeline[0]?.on_load !== 'function') {
        throw new Error('Any-key screens nested between consent and debriefing must accept taps');
      }
      return results;
    });
    for (const result of coverage) {
      assert.equal(result.tap, true);
      assert.equal(result.timed, false, 'Timed screens must keep their deadline');
      assert.equal(result.noKeys, false);
      assert.equal(result.restricted, false);
      assert.equal(result.space, ' ');
    }
    for (const mode of ['touch', 'keyboard', 'forced']) {
      const eligibility = await page.evaluate(({ mode }) => {
        window.__psy_jsPsych = initJsPsych({ display_element: 'experiment' });
        const compiled = window.TimelineCompiler.compileToJsPsychTimeline({
          task_type: 'custom', experiment_type: 'trial-based', timeline: [{
            type: 'block', component_type: 'html-keyboard-response', length: 4,
            parameter_values: { stimulus: '<p>Block trial</p>', choices: 'NO_KEYS', trial_duration: 1, response_ends_trial: false },
            miniblock_structure: {
              enabled: true, num_blocks: 2, break_escape_keys: 'space',
              break_message: 'Press Space to resume.', force_wait_for_break: mode === 'forced', break_duration_sec: 1,
            },
          }],
        });
        const pause = compiled.timeline.find(trial => trial.data?.plugin_type === 'miniblock-break');
        const acceptsTouch = typeof pause?.on_load === 'function';
        window.__psy_jsPsych.run(compiled.timeline);
        return { acceptsTouch, breakCount: compiled.timeline.filter(trial => trial.data?.plugin_type === 'miniblock-break').length };
      }, { mode });
      assert.equal(eligibility.breakCount, 1, 'Generated mini-break metadata must survive compilation');
      assert.equal(eligibility.acceptsTouch, mode !== 'forced');
      const message = page.getByText('Press Space to resume.', { exact: true });
      await message.waitFor();
      if (mode === 'keyboard') {
        await page.keyboard.press('Space');
      } else {
        await message.tap();
        if (mode === 'forced') {
          assert.equal(await message.count(), 1, 'Forced-wait mini-break must ignore taps');
          await page.keyboard.press('Space');
          assert.equal(await message.count(), 1, 'Forced-wait mini-break must ignore Space too');
        }
      }
      await page.waitForFunction(() => window.__psy_jsPsych.data.get().count() === 5);
      const pause = await page.evaluate(() => window.__psy_jsPsych.data.get().values().find(row => row.plugin_type === 'miniblock-break'));
      assert.equal(pause.miniblock_forced_wait, mode === 'forced');
      if (mode === 'touch') assert.equal(pause.response_device, 'touch');
      if (mode === 'keyboard') assert.equal(pause.response, ' ');
      if (mode === 'forced') assert.equal(pause.response_device, undefined);
    }
    console.log('Mobile taps, mini-block breaks, forced waits and keyboard protections passed');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });