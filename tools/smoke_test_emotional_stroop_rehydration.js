#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
global.document = { getElementById: () => null, querySelectorAll: () => [] };
class Stroop {}
global.window = {
  location: { href: 'http://localhost/' }, cogflowState: {},
  jsPsychStroop: Stroop, jsPsychHtmlKeyboardResponse: class {},
};
const JsonBuilder = require('../frontend/builder/src/JsonBuilder.js');
const Schema = require('../frontend/builder/src/schemas/JSPsychSchemas.js');
const builder = new JsonBuilder();
builder.schemaValidator = new Schema();
builder.getComponentDefinitions = () => [];
builder.getExperimentWideLengthCapForBlocks = () => null;
eval(fs.readFileSync(require('node:path').join(__dirname, '../frontend/interpreter/src/timelineCompiler.js'), 'utf8'));

const lists = [
  { label: 'Study neutral', words: ['OCEAN', 'CLOUD'] },
  { label: 'Study negative', words: ['THREAT', 'DANGER'] },
  { label: 'Study positive', words: ['JOY', 'HOPE'] },
];
const settings = {
  word_lists: lists, stimuli: [{ name: 'GREEN', color: '#00ff00' }, { name: 'PURPLE', color: '#800080' }],
  response_device: 'mouse', choice_keys: ['f', 'j'], stimulus_font_size_px: 80,
};
const inheritedLists = lists.slice(0, 2).map((list, index) => ({
  label: index === 0 ? 'Neutral' : 'WAR-RELATED',
  words: index === 0 ? ['\u0422\u0415\u0420\u0420\u0418\u0422\u041e\u0420\u0418\u042f', '\u041a\u041e\u0412\u0415\u0420'] : ['\u0428\u0422\u0423\u0420\u041c', '\u041e\u0421\u0410\u0414\u0410'],
}));
const inheritedSettings = { ...settings, word_lists: inheritedLists, word_options: inheritedLists.flatMap(list => list.words) };
const emptyBlock = {
  type: 'block', component_type: 'emotional-stroop-trial', length: 300,
  parameter_values: {
    word_lists: [{ label: 'Neutral', words: [] }, { label: 'Negative', words: [] }],
    ink_color_name: ['GREEN', 'PURPLE'],
  },
  miniblock_structure: { enabled: true, num_blocks: 3, break_escape_keys: 'space', counterbalance_conditions: true },
};
const [inheritedBlock] = builder.convertImportedTimelineToBuilderComponents([emptyBlock], 'emotional-stroop', {}, inheritedSettings);
assert.equal(inheritedBlock.parameters.emostroop_word_list_1_words, inheritedLists[0].words.join(','));
assert.equal(inheritedBlock.parameters.emostroop_word_list_2_words, inheritedLists[1].words.join(','));
assert.equal(inheritedBlock.parameters.emostroop_word_list_2_label, 'WAR-RELATED');
assert.deepEqual(builder.transformBlock({ type: 'block', ...inheritedBlock.parameters }).parameter_values.word_lists, inheritedLists);
const inheritedTrials = compile([emptyBlock], inheritedSettings);
assert.equal(inheritedTrials.length, 300);
assert(new Set(inheritedTrials.map(trial => trial.word)).size > 1, 'Inherited lists must be sampled, not replaced by one repeated word');
for (const trial of inheritedTrials) {
  const list = inheritedLists[trial.data.word_list_index - 1];
  assert(list?.words.includes(trial.word), 'Every trial must use its inherited list');
  assert.equal(trial.data.word_list_label, list.label);
}
const overrideBlock = { ...emptyBlock, parameter_values: { ...emptyBlock.parameter_values, word_lists: lists.slice(0, 2) } };
const [importedOverride] = builder.convertImportedTimelineToBuilderComponents([overrideBlock], 'emotional-stroop', {}, inheritedSettings);
assert.equal(importedOverride.parameters.emostroop_word_list_1_words, lists[0].words.join(','));
assert(compile([overrideBlock], inheritedSettings).every(trial => lists.flatMap(list => list.words).includes(trial.word)), 'Nonempty block words must override defaults');
const [unconfiguredBlock] = builder.convertImportedTimelineToBuilderComponents([emptyBlock], 'emotional-stroop');
assert.equal(unconfiguredBlock.parameters.emostroop_word_list_1_words, '', 'Missing defaults must not introduce example words');
let rehydratedComponents;
const importBuilder = new JsonBuilder();
importBuilder.schemaValidator = builder.schemaValidator;
importBuilder.getComponentDefinitions = () => [];
importBuilder.applyImportedConfigState = () => {};
importBuilder.updateJSON = () => {};
importBuilder.showValidationResult = () => {};
importBuilder.rebuildTimelineDOMFromImportedComponents = components => { rehydratedComponents = components; return components.length; };
importBuilder.rehydrateBuilderFromConfig({ experiment_type: 'trial-based', task_type: 'emotional-stroop', emotional_stroop_settings: inheritedSettings, timeline: [emptyBlock] });
assert.equal(rehydratedComponents[0].parameters.emostroop_word_list_2_words, inheritedLists[1].words.join(','), 'The actual import entry point must pass experiment defaults');
function compile(timeline, defaults = settings) {
  return window.TimelineCompiler.compileToJsPsychTimeline({
    task_type: 'emotional-stroop', experiment_type: 'trial-based',
    emotional_stroop_settings: defaults, timeline,
  }).timeline.filter(trial => trial.type === Stroop);
}
function roundTrip(values) {
  const original = { type: 'block', component_type: 'emotional-stroop-trial', block_length: 60, parameter_values: values };
  const [imported] = builder.convertImportedTimelineToBuilderComponents([original], 'emotional-stroop');
  return { imported, exported: builder.transformBlock({ type: 'block', ...imported.parameters }) };
}

for (const count of [2, 3]) {
  const selected = lists.slice(0, count);
  const pool = selected.flatMap(list => list.words);
  const { imported, exported } = roundTrip({
    word_lists: selected, word: pool, ink_color_name: ['GREEN', 'PURPLE'], response_device: 'mouse',
  });
  assert.equal(imported.parameters.emostroop_word_list_count, count);
  assert.deepEqual(exported.parameter_values.word_lists, selected);
  assert.deepEqual(exported.parameter_values.word, pool);
  const trials = compile([exported]);
  assert.equal(trials.length, 60);
  for (const trial of trials) {
    assert(pool.includes(trial.word), `Unexpected default word: ${trial.word}`);
    const list = selected[trial.data.word_list_index - 1];
    assert(list.words.includes(trial.word), 'Word must belong to its recorded list');
    assert.equal(trial.data.word_list_label, list.label);
    assert.deepEqual(trial.stimuli, settings.stimuli);
    assert.equal(trial.response_device, 'mouse');
    assert(['GREEN', 'PURPLE'].includes(trial.ink_color_name));
  }
}
for (const word of [['LEGACY', 'CUSTOM'], 'SINGLE']) {
  const pool = Array.isArray(word) ? word : [word];
  const { imported, exported } = roundTrip({ word, ink_color_name: ['GREEN'] });
  assert.equal(imported.parameters.emostroop_word_list_1_words, pool.join(','));
  assert.equal(imported.parameters.emostroop_word_list_2_words, '');
  assert.deepEqual(exported.parameter_values.word, pool);
  assert(compile([exported]).every(trial => pool.includes(trial.word)));
}
const direct = compile([{ type: 'emotional-stroop-trial' }])[0];
assert.equal(direct.word, 'OCEAN', 'Structured JSON defaults must reach the plugin');
assert.equal(direct.ink_color_name, 'GREEN');
const explicit = compile([{ type: 'emotional-stroop-trial', word: 'AUTHORED', ink_color_name: 'PURPLE' }])[0];
assert.equal(explicit.word, 'AUTHORED');
assert.equal(explicit.ink_color_name, 'PURPLE');
const legacyDefault = compile([{ type: 'emotional-stroop-trial' }], { ...settings, word_lists: [], word_options: ['CUSTOM DEFAULT'] })[0];
assert.equal(legacyDefault.word, 'CUSTOM DEFAULT');

const controls = new Map();
global.document.getElementById = identifier => {
  if (!controls.has(identifier)) controls.set(identifier, { value: '', checked: false });
  return controls.get(identifier);
};
builder.renderStroopStimuliRows = () => {};
builder.applyStroopResponseVisibility = () => {};
builder.applyEmotionalStroopWordListVisibility = () => {};
builder.applyTaskDefaultsFromImportedConfig({ emotional_stroop_settings: settings }, 'emotional-stroop');
assert.deepEqual(builder.parseEmotionalStroopWordListsFromUI().word_lists, lists);
assert.equal(controls.get('stroopStimulusName_1').value, 'GREEN');
builder.applyTaskDefaultsFromImportedConfig({
  emotional_stroop_settings: { ...settings, word_lists: [], word_options: ['OLDER', 'STUDY'] },
}, 'emotional-stroop');
assert.deepEqual(builder.parseEmotionalStroopWordListsFromUI().word_options, ['OLDER', 'STUDY']);
console.log('Emotional Stroop word-list import/export, sampling metadata and compiler handoff passed');