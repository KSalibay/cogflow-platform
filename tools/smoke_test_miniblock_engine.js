#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

global.window = {
  location: { href: 'http://localhost/' },
  cogflowState: {},
};

const compilerSource = fs.readFileSync(
  path.join(__dirname, '../frontend/interpreter/src/timelineCompiler.js'),
  'utf8'
);
eval(compilerSource);

const { expandTimeline } = global.window.TimelineCompiler;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeBlock(condition, counterbalance) {
  return {
    type: 'block',
    component_type: 'rdm-trial',
    block_length: 4,
    parameter_values: { condition },
    miniblock_structure: {
      enabled: true,
      trials_per_block: 4,
      num_blocks: 2,
      counterbalance_conditions: counterbalance,
      seed: 'miniblock-smoke-test',
      show_total_points_at_break: true,
      show_current_block_points_at_break: true,
    },
  };
}

function expandConditionPool(counterbalance) {
  return expandTimeline([{
    type: 'randomize-group',
    randomizable_across_markers: false,
    items: [makeBlock('A', counterbalance), makeBlock('B', counterbalance)],
  }], {});
}

const counterbalanced = expandConditionPool(true);
const breakTrials = counterbalanced.filter((trial) => trial?.data?.plugin_type === 'miniblock-break');
assert(breakTrials.length === 1, `Expected one shared break, got ${breakTrials.length}`);

const miniblocks = [[], []];
let miniblockIndex = 0;
for (const trial of counterbalanced) {
  if (trial?.data?.plugin_type === 'miniblock-break') {
    miniblockIndex += 1;
  } else {
    miniblocks[miniblockIndex].push(trial.condition);
  }
}

for (const [index, conditions] of miniblocks.entries()) {
  const aCount = conditions.filter((value) => value === 'A').length;
  const bCount = conditions.filter((value) => value === 'B').length;
  assert(
    conditions.length === 4 && aCount === 2 && bCount === 2,
    `Mini-block ${index + 1} is not balanced: ${conditions.join(',')}`
  );
}

assert(
  miniblocks.flat().sort().join('') === 'AAAABBBB',
  'Counterbalancing changed the generated trial multiset'
);

const disabledOrder = expandConditionPool(false)
  .filter((trial) => trial?.data?.plugin_type !== 'miniblock-break')
  .map((trial) => trial.condition)
  .join('');
assert(disabledOrder === 'AAAABBBB', `Disabled counterbalancing changed order: ${disabledOrder}`);

global.window.jsPsych = {
  data: {
    get: () => ({
      values: () => [
        { reward_points_awarded: null, reward_points: 5 },
        {
          reward_points_awarded: '',
          reward_total_points_before_trial: 5,
          reward_total_points_after_trial: 7,
        },
        { plugin_type: 'miniblock-break' },
        { reward_points_awarded: 3 },
      ],
    }),
  },
};

const firstBreak = breakTrials[0];
const breakHtml = firstBreak.stimulus();
for (const expected of [
  'Current block: 1 / 2',
  'Total points: 10',
  'Current block points: 3',
]) {
  assert(breakHtml.includes(expected), `Break stimulus is missing: ${expected}`);
}
assert(firstBreak.data.miniblock_block_index === 1, 'Break metadata should identify completed block 1');

console.log('Mini-block engine smoke test passed');