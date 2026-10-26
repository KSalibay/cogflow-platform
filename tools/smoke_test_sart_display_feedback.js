#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const context = { window: {}, console };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'frontend/interpreter/src/jspsych-sart.js'), 'utf8'), context);
const Sart = context.window.jsPsychSart;

function runTrial(overrides = {}) {
  const elements = Object.fromEntries(['sart-stim', 'sart-wrap', 'sart-feedback'].map(key => [key, { style: {}, textContent: '' }]));
  const display = { style: { backgroundColor: 'old' }, querySelector: selector => elements[selector.slice(1)] };
  const timers = [];
  let keyboard;
  let result;
  let clock = 0;
  const plugin = new Sart({
    pluginAPI: {
      setTimeout: (callback, delay) => timers.push({ callback, at: clock + delay }),
      getKeyboardResponse: options => { keyboard = options.callback_function; },
      cancelAllKeyboardResponses: () => { keyboard = null; },
    },
    finishTrial: data => { result = data; },
  });
  plugin.trial(display, {
    digit: 1, nogo_digit: 3, go_key: 'space', stimulus_duration_ms: 250,
    mask_duration_ms: 900, trial_duration_ms: 1150, show_feedback: true,
    feedback_duration_ms: 300, background_color: '#123456', ...overrides,
  });
  return {
    display, elements,
    press: (key = ' ') => keyboard?.({ key, rt: 100 }),
    result: () => result,
    advance: target => {
      while (timers.some(timer => timer.at <= target)) {
        timers.sort((first, second) => first.at - second.at);
        const timer = timers.shift();
        clock = timer.at;
        timer.callback();
      }
      clock = target;
    },
  };
}

for (const [digit, press, correct] of [[1, true, true], [1, false, false], [3, false, true], [3, true, false]]) {
  const run = runTrial({ digit, mask_text: '', show_instructions: false });
  assert(!run.display.innerHTML.includes('Press '));
  assert.equal(run.display.style.backgroundColor, '#123456');
  if (press) run.press();
  run.advance(250);
  assert.equal(run.elements['sart-stim'].textContent, '\u00A0');
  run.advance(1150);
  assert.equal(run.result(), undefined, 'Feedback must remain visible before finishing');
  assert.equal(run.elements['sart-feedback'].textContent, correct ? 'Correct' : 'Incorrect');
  assert.equal(run.elements['sart-feedback'].style.color, correct ? '#86efac' : '#fca5a5');
  run.press();
  run.advance(1450);
  assert.equal(run.result().correct, correct);
  assert.equal(run.display.style.backgroundColor, 'old');
}
for (const mask of ['#', '*', '<img>']) {
  const run = runTrial({ mask_text: mask, show_feedback: false });
  assert(run.display.innerHTML.includes('Press space'));
  run.advance(250);
  assert.equal(run.elements['sart-stim'].textContent, mask);
  run.advance(1150);
  assert(run.result());
}
const late = runTrial({ feedback_text_correct: 'Hit', feedback_color_correct: '#00ff00' });
late.advance(1149);
late.press();
late.advance(1150);
assert.equal(late.elements['sart-feedback'].textContent, 'Hit');
assert.equal(late.elements['sart-feedback'].style.color, '#00ff00');
const zero = runTrial({ feedback_duration_ms: 0 });
zero.advance(1150);
assert(zero.result());

global.document = { getElementById: () => null, querySelectorAll: () => [] };
global.window = {};
const JsonBuilder = require('../frontend/builder/src/JsonBuilder.js');
const Schema = require('../frontend/builder/src/schemas/JSPsychSchemas.js');
const builder = new JsonBuilder();
builder.schemaValidator = new Schema();
builder.getComponentDefinitions = () => [];
builder.getExperimentWideLengthCapForBlocks = () => null;
const block = {
  ...builder.getSartDefaultsForNewBlock(), type: 'block', block_length: 2,
  sart_mask_text: '', sart_background_color: '#123456', sart_show_instructions: false,
  sart_show_feedback: true, sart_feedback_text_correct: 'Hit', sart_feedback_text_incorrect: 'Miss',
  sart_feedback_color_correct: '#00ff00', sart_feedback_color_incorrect: '#ff0000',
  sart_feedback_duration_min: 450, sart_feedback_duration_max: 450,
};
const exported = builder.transformBlock(block);
const [imported] = builder.convertImportedTimelineToBuilderComponents([exported], 'sart');
for (const key of ['mask_text', 'background_color', 'show_instructions', 'show_feedback', 'feedback_text_correct', 'feedback_text_incorrect', 'feedback_color_correct', 'feedback_color_incorrect']) {
  assert.equal(exported.parameter_values[key], block[`sart_${key}`], key);
  assert.equal(imported.parameters[`sart_${key}`], block[`sart_${key}`], key);
  assert(builder.schemaValidator.getPluginSchema('sart-trial').parameters[`sart_${key}`], key);
}
assert.equal(imported.parameters.sart_feedback_duration_min, 450);
assert.equal(imported.parameters.sart_feedback_duration_max, 450);
const controls = {
  sartMaskText: { value: '' }, sartBackgroundColor: { value: '#123456' },
  sartShowInstructions: { checked: false }, sartShowFeedback: { checked: true },
  sartFeedbackDurationMs: { value: '450' },
};
global.document.getElementById = identifier => controls[identifier] ?? null;
assert.equal(builder.getCurrentSartDefaults().mask_text, '');
assert.equal(builder.getCurrentSartDefaults().show_feedback, true);
assert.equal(builder.getSartDefaultsForNewBlock().sart_show_instructions, false);
assert.equal(builder.getSartDefaultsForNewBlock().sart_feedback_duration_min, 450);
assert(builder.renderSartDisplaySettings().includes('type="color"'));

context.window.jsPsychHtmlKeyboardResponse = class {};
context.window.location = { href: 'http://localhost/' };
context.window.cogflowState = {};
vm.runInContext(fs.readFileSync(path.join(root, 'frontend/interpreter/src/timelineCompiler.js'), 'utf8'), context);
for (const item of [exported, { ...block, type: 'sart-trial', digit: 1 }]) {
  const compiled = context.window.TimelineCompiler.compileToJsPsychTimeline({
    task_type: 'sart', experiment_type: 'trial-based', timeline: [item],
  });
  const node = compiled.timeline[0];
  const trial = node.timeline ? { ...node.timeline[0] } : node;
  if (trial.on_start) trial.on_start(trial);
  assert.equal(trial.type, Sart);
  assert.equal(trial.mask_text, '');
  assert.equal(trial.background_color, '#123456');
  assert.equal(trial.show_instructions, false);
  assert.equal(trial.show_feedback, true);
  assert.equal(trial.feedback_duration_ms, 450);
  assert.equal(trial.feedback_text_correct, 'Hit');
}
console.log('SART display, feedback outcomes and Builder round-trip smoke test passed');