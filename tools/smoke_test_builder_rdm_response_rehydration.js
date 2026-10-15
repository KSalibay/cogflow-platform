#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

global.window = {};
global.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
};

const source = fs.readFileSync(path.join(__dirname, '../frontend/builder/src/JsonBuilder.js'), 'utf8');
const sandboxModule = { exports: {} };
new Function('module', 'window', 'document', `${source}\nreturn module.exports;`)(sandboxModule, global.window, global.document);
const JsonBuilder = sandboxModule.exports;
const builder = new JsonBuilder();

const experimentDefaults = {
  require_response: true,
  response_device: 'keyboard',
  choices: ['f', 'j'],
  feedback: { enabled: true, type: 'corner-text', duration_ms: 500 },
};
builder.getRDMResponseParameters = () => JSON.parse(JSON.stringify(experimentDefaults));
builder.getComponentDefinitions = () => [];

const edited = {
  response_device: 'mouse',
  require_response_mode: 'false',
  feedback_mode: 'arrow',
  feedback_duration_ms: 700,
  feedback_arrow_color_mode: 'custom',
  feedback_arrow_neutral_color: '#111111',
  feedback_arrow_custom_color: '#222222',
  feedback_arrow_correct_color: '#333333',
  feedback_arrow_incorrect_color: '#444444',
  feedback_arrow_size_px: 14,
  feedback_arrow_line_width_px: 6,
  mouse_accuracy_mode: 'angular',
};

const override = builder.buildRDMResponseParametersOverride(edited);
const [trial, block] = builder.convertImportedTimelineToBuilderComponents([
  { type: 'rdm-trial', response_parameters_override: override },
  { type: 'block', component_type: 'rdm-trial', response_parameters_override: override },
], 'rdm', experimentDefaults);

for (const component of [trial, block]) {
  for (const [key, value] of Object.entries(edited)) {
    assert(component.parameters[key] === value, `${component.type}.${key} expected ${value}, got ${component.parameters[key]}`);
  }
  assert(component.parameters.response_parameters_override === undefined, 'Import must expand response overrides into editor fields');
}

const onlyDevice = builder.buildRDMResponseParametersOverride({ response_device: 'mouse' });
const [inheritedFeedback] = builder.convertImportedTimelineToBuilderComponents([
  { type: 'rdm-trial', response_parameters_override: onlyDevice },
], 'rdm', experimentDefaults);
assert(inheritedFeedback.parameters.response_device === 'mouse', 'Explicit device override must restore');
assert(inheritedFeedback.parameters.feedback_mode === undefined, 'Feedback matching experiment defaults must remain inherit');
assert(inheritedFeedback.parameters.require_response_mode === undefined, 'Require-response matching experiment defaults must remain inherit');

const mouseDefaults = {
  response_device: 'mouse',
  require_response: false,
  feedback: {
    enabled: true, type: 'arrow', duration_ms: 850, arrow_color_mode: 'neutral',
    arrow_neutral_color: '#123456', arrow_custom_color: '#234567',
    arrow_correct_color: '#345678', arrow_incorrect_color: '#456789',
    arrow_size_px: 17, arrow_line_width_px: 5.5,
  },
  mouse_response: {
    enabled: true, mode: 'aperture-segments', segments: 4, start_angle_deg: 30,
    selection_mode: 'click', accuracy_mode: 'angular', accuracy_tolerance_deg: 12, accuracy_slack_deg: 3,
  },
};
builder.getRDMResponseParameters = () => JSON.parse(JSON.stringify(mouseDefaults));
const inheritedMouse = builder.buildRDMResponseParametersOverride({
  response_device: 'inherit', mouse_accuracy_mode: 'inherit', feedback_arrow_size_px: 21,
});
assert(inheritedMouse.mouse_response.accuracy_mode === 'angular', 'An unchanged editor save must resolve inherit to the experiment mouse accuracy mode');

const timelineSource = fs.readFileSync(path.join(__dirname, '../frontend/builder/src/modules/TimelineBuilder.js'), 'utf8');
const TimelineBuilder = new Function('window', `${timelineSource}\nreturn TimelineBuilder;`)(global.window);
const editor = Object.create(TimelineBuilder.prototype);
editor.jsonBuilder = builder;
global.document.getElementById = (id) => id === 'taskType' ? { value: 'rdm' } : null;
for (const [field, key] of Object.entries({
  feedback_duration_ms: 'duration_ms',
  feedback_arrow_neutral_color: 'arrow_neutral_color',
  feedback_arrow_custom_color: 'arrow_custom_color',
  feedback_arrow_correct_color: 'arrow_correct_color',
  feedback_arrow_incorrect_color: 'arrow_incorrect_color',
  feedback_arrow_size_px: 'arrow_size_px',
  feedback_arrow_line_width_px: 'arrow_line_width_px',
})) {
  assert(editor.getExperimentDefault(field) === mouseDefaults.feedback[key], `${field} must inherit the loaded experiment value`);
}
assert(editor.getExperimentDefault('mouse_segments') === 4, 'Mouse segment count must inherit the loaded experiment');
assert(editor.getExperimentDefault('mouse_accuracy_tolerance_deg') === 12, 'Mouse tolerance must inherit the loaded experiment');

const [fixedBlock] = builder.convertImportedTimelineToBuilderComponents([{
  type: 'block', component_type: 'rdm-trial', length: 3,
  parameter_values: { coherence: 0.37, speed: 2, lifetime_frames: 60, stimulus_duration: 777, direction: 90 },
}], 'rdm', mouseDefaults);
for (const [key, value] of Object.entries({ coherence: 0.37, speed: 2, lifetime_frames: 60, stimulus_duration: 777 })) {
  assert(fixedBlock.parameters[`${key}_min`] === value && fixedBlock.parameters[`${key}_max`] === value, `Fixed ${key} must populate equal editor limits`);
}
assert(fixedBlock.parameters.direction_options === '90', 'Scalar direction must restore as an editable option');
const reexported = builder.transformBlock({ type: 'block', ...fixedBlock.parameters });
assert(reexported.parameter_windows.coherence.min === 0.37, 'Fixed coherence must survive block re-export');
assert(reexported.parameter_windows.stimulus_duration.max === 777, 'Fixed timing must survive block re-export');

console.log('Builder RDM response rehydration smoke test passed');
