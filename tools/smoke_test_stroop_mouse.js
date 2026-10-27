#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('./benchmarks/node_modules/playwright');
const root = path.join(__dirname, '..');
const interpreterHtml = fs.readFileSync(path.join(root, 'frontend/interpreter/index.html'), 'utf8');
const styles = interpreterHtml.match(/<style>([\s\S]*?)<\/style>/)[1];

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      await page.setContent(`<style>${styles}</style><div class="jspsych-display-element"><div class="jspsych-content-wrapper"><div id="jspsych-content"></div></div></div>`);
      await page.addScriptTag({ path: path.join(root, 'frontend/interpreter/src/jspsych-stroop.js') });
      for (const [mode, choice, correct] of [['color_naming', 'BLUE', true], ['color_naming', 'RED', false], ['congruency', 'incongruent', true]]) {
        await page.evaluate(({ mode }) => {
          window.result = null;
          const plugin = new window.jsPsychStroop({
            pluginAPI: { setTimeout: () => {}, cancelAllKeyboardResponses: () => {}, getKeyboardResponse: () => {} },
            finishTrial: data => { window.result = data; },
          });
          plugin.trial(document.querySelector('#jspsych-content'), {
            word: 'ANTICIPATION', ink_color_name: 'BLUE', response_device: 'mouse', response_mode: mode,
            stimulus_font_size_px: 96, trial_duration_ms: 10000,
            stimuli: [{ name: 'RED', color: '#ff0000' }, { name: 'BLUE', color: '#0000ff' }, { name: 'GREEN', color: '#00ff00' }, { name: 'YELLOW', color: '#ffff00' }],
          });
        }, { mode });
        const layout = await page.evaluate(() => {
          const stimulus = document.querySelector('#stroop-stim').getBoundingClientRect();
          const buttons = document.querySelector('#stroop-buttons').getBoundingClientRect();
          const swatches = [...document.querySelectorAll('#stroop-buttons span')].filter(element => getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)');
          return { gap: buttons.top - stimulus.bottom, swatches: swatches.length, overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert(layout.gap >= 40, `Buttons must stay below stimulus: ${JSON.stringify(layout)}`);
        assert.equal(layout.swatches, 0, 'Response buttons must not reveal ink colors');
        assert.equal(layout.overflow, false, 'Mouse layout must fit narrow screens');
        if (mode === 'color_naming' && correct) await page.screenshot({ path: `/tmp/cogflow-stroop-mouse-${viewport.width}.png` });
        const selector = mode === 'congruency' ? `[data-stroop-label="${choice}"]` : `[data-stroop-choice-name="${choice}"]`;
        await page.locator(selector).click();
        const result = await page.evaluate(() => window.result);
        assert.equal(result.correctness, correct);
        assert.equal(result.response_device, 'mouse');
        assert.equal(result.ended_reason, 'response');
      }
      await page.close();
    }
    console.log('Stroop mouse controls, scoring and desktop/mobile layout smoke test passed');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });