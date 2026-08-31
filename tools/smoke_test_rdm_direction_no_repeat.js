#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

global.window = { location: { href: 'http://localhost/' }, cogflowState: {} };
const compilerSource = fs.readFileSync(
  path.join(__dirname, '../frontend/interpreter/src/timelineCompiler.js'),
  'utf8'
);
eval(compilerSource);

function directionsFor(directionTransitionMode) {
  const block = {
    type: 'block',
    component_type: 'rdm-trial',
    block_length: 400,
    parameter_values: {
      direction: [0, 90, 180, 270],
      ...(directionTransitionMode ? { direction_transition_mode: directionTransitionMode } : {}),
      coherence_min: 0.2,
      coherence_max: 0.8,
      speed_min: 4,
      speed_max: 10,
    },
  };

  const expanded = window.TimelineCompiler.expandTimeline([block], {
    taskType: 'rdm',
    experimentType: 'trial-based',
  });
  return expanded.filter((t) => t.type === 'rdm-trial').map((t) => t.direction);
}

function countConsecutiveRepeats(directions) {
  let repeats = 0;
  for (let i = 1; i < directions.length; i++) {
    if (directions[i] === directions[i - 1]) repeats++;
  }
  return repeats;
}

// no_repeat_each_trial: random sampling from the full configured set, but never
// the same direction as the immediately preceding trial (Sachi Lardner, CRDM pilot feedback).
const noRepeatDirections = directionsFor('no_repeat_each_trial');
assert(
  countConsecutiveRepeats(noRepeatDirections) === 0,
  `Expected zero consecutive repeats with no_repeat_each_trial, found ${countConsecutiveRepeats(noRepeatDirections)}`
);
assert(
  new Set(noRepeatDirections).size === 4,
  `Expected all 4 configured directions to be used, got ${new Set(noRepeatDirections).size}`
);

// Default mode is unchanged: consecutive repeats remain possible.
const defaultDirections = directionsFor(null);
assert(
  countConsecutiveRepeats(defaultDirections) > 0,
  'Expected default random_each_trial mode to still allow consecutive repeats (unchanged behavior)'
);

console.log('RDM direction no-repeat smoke test passed');
