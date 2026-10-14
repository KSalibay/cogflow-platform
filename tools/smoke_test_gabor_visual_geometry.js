#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'frontend/interpreter/src/jspsych-gabor.js'), 'utf8');
const context = { window: {}, console };
vm.createContext(context);
vm.runInContext(source.replace('  const info = {', '  window.geometryTest = { resolveVisualGeometry, resolveVisualSize, renderGaborScene, drawCueDiamond };\n  const info = {'), context);
const { resolveVisualGeometry, resolveVisualSize, renderGaborScene, drawCueDiamond } = context.window.geometryTest;
const params = {
  patch_horizontal_offset_deg: 6, patch_vertical_offset_deg: -2,
  value_ring_width_deg: 0.15, patch_border_width_deg: 0.06,
  cue_diamond_size_deg: 2, cue_indicator_size_deg: 1.5,
  cue_diamond_line_width_deg: 0.06,
  normal_viewing_distance_cm: 50, fallback_px_per_cm: 40,
};
const normal = resolveVisualGeometry(params);
context.window.__psy_visual_angle = { px_per_cm: 40 };
assert.equal(resolveVisualGeometry(params).pxPerDeg, normal.pxPerDeg, 'Screen-only calibration must use normal fallback distance');
context.window.__psy_visual_angle = { px_per_cm: 40, viewing_distance_cm: 100 };
const far = resolveVisualGeometry(params);
for (const key of Object.keys(normal)) assert(Math.abs(far[key] - normal[key] * 2) < 1e-8, key);
context.window.__psy_visual_angle = { px_per_deg: normal.pxPerDeg };
assert.equal(resolveVisualGeometry(params).horizontalOffsetPx, normal.horizontalOffsetPx);
const presetParams = {
  ...params, patch_diameter_px: 175, fixation_size_px: 22,
  cue_diamond_size_px: 55, cue_indicator_size_px: 35, prefer_visual_angle: true,
};
delete context.window.__psy_visual_angle;
assert.equal(resolveVisualSize(6, presetParams.patch_diameter_px, presetParams), 175);
assert.equal(resolveVisualSize(0.5, presetParams.fixation_size_px, presetParams), 22);
assert.equal(resolveVisualGeometry(presetParams).diamondSizePx, 55);
context.window.__psy_visual_angle = { px_per_deg: 60 };
assert.equal(resolveVisualSize(6, 175, presetParams), 360);
assert.equal(resolveVisualSize(0.5, 22, presetParams), 30);
assert.equal(resolveVisualGeometry(presetParams).diamondSizePx, 120);
assert.equal(resolveVisualSize(6, 175, { ...presetParams, prefer_visual_angle: false }), 175);
assert.equal(resolveVisualGeometry({ ...presetParams, prefer_visual_angle: false }).diamondSizePx, 55);
assert.equal(resolveVisualSize(6, 175, { ...presetParams, visual_angle_px_per_deg: 40 }), 240);
delete context.window.__psy_visual_angle;
assert.equal(resolveVisualSize(6, 175, { ...presetParams, visual_angle_px_per_deg: 40 }), 240);
assert.equal(resolveVisualSize(6, 175, presetParams), 175);
context.window.__psy_visual_angle = { px_per_deg: normal.pxPerDeg };

const arcs = [];
const lines = [];
const ctx = new Proxy({
  arc: (...args) => arcs.push(args),
  moveTo: (...args) => lines.push(args),
  lineTo: (...args) => lines.push(args),
}, { get: (target, key) => key in target ? target[key] : () => {} });
renderGaborScene({ width: 1200, height: 800, getContext: () => ctx }, {
  patchDiameterPx: normal.pxPerDeg * 6,
  visualGeometry: normal,
  ringMode: 'neutral',
});
assert.equal(arcs.length, 4);
assert(Math.abs((arcs[0][0] + arcs[2][0]) / 2 - 600) < 1e-8);
assert(Math.abs(arcs[0][1] - (400 + normal.verticalOffsetPx)) < 1e-8);
assert(Math.abs(arcs[0][2] - arcs[1][2] - normal.ringWidthPx) < 1e-8);
arcs.length = 0;
renderGaborScene({ width: 1200, height: 800, getContext: () => ctx }, {
  patchDiameterPx: 20, ringMode: 'neutral',
});
assert.equal((arcs[0][2] + arcs[1][2]) / 2 + 1, 10, 'Preset patch diameter must not be enlarged by a minimum-size clamp');
lines.length = 0;
drawCueDiamond(ctx, 600, 400, {
  spatialCue: 'left', sizePx: 80, indicatorSizePx: 40,
  fixationHalfSizePx: 7, fixationLineWidthPx: 1.5,
});
assert(lines.some(([horizontal, vertical]) => horizontal === 560 && vertical === 400));
assert(lines.some(([horizontal, vertical]) => horizontal === 580 && vertical === 400));
assert(lines.some(([horizontal, vertical]) => horizontal === 593 && vertical === 400));

global.document = { getElementById: () => null, querySelectorAll: () => [] };
global.window = {};
const JsonBuilder = require('../frontend/builder/src/JsonBuilder.js');
const Schema = require('../frontend/builder/src/schemas/JSPsychSchemas.js');
const builder = new JsonBuilder();
builder.schemaValidator = new Schema();
builder.getComponentDefinitions = () => [];
builder.getExperimentWideLengthCapForBlocks = () => null;
const block = builder.getGaborDefaultsForNewBlock();
block.type = 'block';
block.block_component_type = 'gabor-trial';
block.block_length = 2;
const exported = builder.transformBlock(block);
const [imported] = builder.convertImportedTimelineToBuilderComponents([exported], 'gabor');
for (const key of Object.keys(builder.getGaborGeometryFields())) {
  assert.equal(exported.parameter_values[key], block[`gabor_${key}`] ?? undefined, key);
  assert.equal(imported.parameters[`gabor_${key}`], block[`gabor_${key}`] ?? undefined, key);
  assert(builder.schemaValidator.getPluginSchema('gabor-trial').parameters[key], key);
}
class FakeKeyboard {}
context.window.jsPsychHtmlKeyboardResponse = FakeKeyboard;
context.window.location = { href: 'http://localhost/' };
context.window.cogflowState = {};
vm.runInContext(fs.readFileSync(path.join(root, 'frontend/interpreter/src/timelineCompiler.js'), 'utf8'), context);
for (const componentType of ['gabor-trial', 'gabor-quest', 'gabor-learning']) {
  const compiled = context.window.TimelineCompiler.compileToJsPsychTimeline({
    task_type: 'gabor', experiment_type: 'trial-based',
    gabor_settings: { patch_horizontal_offset_deg: 1, fixation_size_deg: 1, prefer_visual_angle: false, visual_angle_px_per_deg: 80 },
    timeline: [{ ...exported, component_type: componentType }],
  });
  const node = compiled.timeline[0];
  const trial = node.timeline ? { ...node.timeline[0] } : node;
  if (trial.on_start) trial.on_start(trial);
  assert.equal(trial.patch_horizontal_offset_deg, exported.parameter_values.patch_horizontal_offset_deg, componentType);
  assert.equal(trial.fixation_size_deg, exported.parameter_values.fixation_size_deg, componentType);
  assert.equal(trial.prefer_visual_angle, false, componentType);
  assert.equal(trial.visual_angle_px_per_deg, 80, componentType);
  assert.equal(resolveVisualSize(trial.fixation_size_deg, trial.fixation_size_px, trial), trial.fixation_size_px, componentType);
}
console.log('Gabor visual-angle geometry and Builder round-trip smoke test passed');