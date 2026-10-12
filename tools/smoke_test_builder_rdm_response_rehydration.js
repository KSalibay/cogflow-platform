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

console.log('Builder RDM response rehydration smoke test passed');
