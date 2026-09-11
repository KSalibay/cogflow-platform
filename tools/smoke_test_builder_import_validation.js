#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// The schema module is a browser class definition; evaluate it and grab the class.
const source = fs.readFileSync(
  path.join(__dirname, '../frontend/builder/src/schemas/JSPsychSchemas.js'),
  'utf8'
);

global.window = {};
eval(source);

// The browser module assigns itself to module.exports when one is available.
const SchemaClass = module.exports;
assert(typeof SchemaClass === 'function', 'Could not load JSPsychSchemas');

const schemas = new SchemaClass();

function validateTrial(trial) {
  const schema = schemas.getPluginSchema(trial.type);
  assert(schema, `No schema found for ${trial.type}`);
  return schemas.validateTrialAgainstSchema(trial, schema, 1);
}

// Regression: exported HTML + Button configs carry null timing fields and a
// comma-separated `choices` string. Both are valid at runtime and must import cleanly.
{
  const result = validateTrial({
    type: 'html-button-response',
    stimulus: '<p>Informed consent form</p>',
    choices: 'Option 1, Option 2',
    stimulus_duration: null,
    trial_duration: null,
    grid_columns: null,
  });

  assert(
    result.errors.length === 0,
    `Exported HTML + Button config must validate, got: ${result.errors.join(' | ')}`
  );
}

// Consent-mode exports omit `choices` entirely.
{
  const result = validateTrial({
    type: 'html-button-response',
    stimulus: '<p>Informed consent form</p>',
    consent_mode: true,
    consent_decline_message: '<p>Thanks anyway.</p>',
    stimulus_duration: null,
    trial_duration: null,
  });

  assert(
    result.errors.length === 0,
    `Consent-mode config must validate, got: ${result.errors.join(' | ')}`
  );
}

// Debriefing screens export the same null timing fields.
{
  const result = validateTrial({
    type: 'debriefing',
    stimulus: '<p>Thank you for taking part.</p>',
    choices: 'ALL_KEYS',
    stimulus_duration: null,
    trial_duration: null,
  });

  assert(
    result.errors.length === 0,
    `Debriefing config must validate, got: ${result.errors.join(' | ')}`
  );
}

// Genuinely wrong types must still be rejected.
{
  const result = validateTrial({
    type: 'html-button-response',
    stimulus: '<p>x</p>',
    choices: ['a', 'b'],
    trial_duration: 'not-a-number',
  });

  assert(
    result.errors.some((e) => e.includes('trial_duration')),
    'A non-numeric trial_duration must still fail validation'
  );
}

// A required parameter explicitly set to null must still be rejected.
{
  const result = validateTrial({
    type: 'html-button-response',
    stimulus: null,
    choices: ['a', 'b'],
  });

  assert(
    result.errors.some((e) => e.includes('stimulus')),
    'A null required stimulus must still fail validation'
  );
}

console.log('Builder import validation smoke test passed');
