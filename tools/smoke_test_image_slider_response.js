#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class FakeImageSliderPlugin {}
class FakeHtmlKeyboardPlugin {}
class FakeHtmlButtonPlugin {}
class FakeSurveyResponsePlugin {}

global.window = {
  location: { href: 'http://localhost/' },
  cogflowState: {},
  jsPsychImageSliderResponse: FakeImageSliderPlugin,
  jsPsychHtmlKeyboardResponse: FakeHtmlKeyboardPlugin,
  jsPsychHtmlButtonResponse: FakeHtmlButtonPlugin,
  jsPsychSurveyResponse: FakeSurveyResponsePlugin,
};

const compilerSource = fs.readFileSync(
  path.join(__dirname, '../frontend/interpreter/src/timelineCompiler.js'),
  'utf8'
);
eval(compilerSource);

function compileSliderTrials(timeline, experimentType = 'trial-based') {
  const compiled = window.TimelineCompiler.compileToJsPsychTimeline({
    task_type: 'custom',
    experiment_type: experimentType,
    timeline,
  });
  const tl = compiled.timeline || compiled;
  return tl.filter((t) => t && t.type === FakeImageSliderPlugin);
}

// Standalone component: %category% is substituted using stimulus_category.
{
  const trials = compileSliderTrials([{
    type: 'image-slider-response',
    stimulus: 'img/happy1.png',
    stimulus_category: 'happy',
    prompt: 'How %category% is this face?',
    min: 1,
    max: 10,
    step: 1,
    slider_start: 5,
  }]);
  assert(trials.length === 1, `Expected 1 image-slider-response trial, got ${trials.length}`);
  const t = trials[0];
  assert(t.stimulus === 'img/happy1.png', `Unexpected stimulus: ${t.stimulus}`);
  assert(t.min === 1 && t.max === 10 && t.step === 1, 'Slider range must be passed through');
  assert(t.prompt === 'How happy is this face?', `Expected category substitution, got: ${t.prompt}`);
  assert(t.data.stimulus_category === 'happy', 'Category must be recorded in trial data');
}

// Standalone component without a category: prompt is left untouched (no %category% token to fill).
{
  const trials = compileSliderTrials([{
    type: 'image-slider-response',
    stimulus: 'img/plain.png',
    prompt: 'Rate this image.',
  }]);
  assert(trials[0].prompt === 'Rate this image.', 'Prompt must be unchanged when there is no category');
  assert(trials[0].data.stimulus_category === undefined, 'No category should be recorded when none is set');
}

// Block usage: "category:path" lines pair each sampled image with its category, and
// every generated trial gets a substituted prompt.
{
  const block = {
    type: 'block',
    component_type: 'image-slider-response',
    block_length: 200,
    parameter_values: {
      stimulus_images: 'happy:img/happy1.png\nsad:img/sad1.png\nneutral:img/neutral1.png',
      prompt: 'How %category% does this face look?',
      min: 1,
      max: 10,
      step: 1,
    },
  };

  const trials = compileSliderTrials([block]);
  assert(trials.length === 200, `Expected 200 generated trials, got ${trials.length}`);

  const seenCategories = new Set();
  const seenPaths = new Set();
  for (const t of trials) {
    seenPaths.add(t.stimulus);
    if (t.stimulus === 'img/happy1.png') {
      assert(t.data.stimulus_category === 'happy', 'happy image must carry the happy category');
      assert(t.prompt === 'How happy does this face look?', `Unexpected prompt: ${t.prompt}`);
    } else if (t.stimulus === 'img/sad1.png') {
      assert(t.data.stimulus_category === 'sad', 'sad image must carry the sad category');
      assert(t.prompt === 'How sad does this face look?', `Unexpected prompt: ${t.prompt}`);
    } else if (t.stimulus === 'img/neutral1.png') {
      assert(t.data.stimulus_category === 'neutral', 'neutral image must carry the neutral category');
    } else {
      throw new Error(`Unexpected stimulus path sampled: ${t.stimulus}`);
    }
    seenCategories.add(t.data.stimulus_category);
  }
  assert(seenCategories.size === 3, `Expected all 3 categories to appear, got ${seenCategories.size}`);
  assert(seenPaths.size === 3, `Expected all 3 image paths to appear, got ${seenPaths.size}`);
}

// Legacy configs with the two prompts reversed are normalized at compile time.
{
  const compiled = window.TimelineCompiler.compileToJsPsychTimeline({
    task_type: 'image-categorization',
    experiment_type: 'trial-based',
    timeline: [{
      type: 'block',
      block_component_type: 'image-slider-response',
      block_length: 1,
      parameter_values: {
        stimulus_images: 'happy:img/happy1.png',
        prompt: 'What is the emotion shown?',
        slider_accuracy_question_enabled: true,
        slider_accuracy_question_text: 'How %category% is the face?',
        slider_enabled: true,
        slider_accuracy_question_first: false,
      },
    }],
  });
  const [accuracyTrial, sliderTrial] = compiled.timeline[0].timeline;
  assert(sliderTrial.prompt.includes('How happy is the face?'), 'Legacy intensity prompt must move to the slider');
  assert(accuracyTrial.questions[0].prompt === 'What is the emotion shown?', 'Legacy accuracy prompt must move to the radio question');
}

// Block usage without categories: plain filename list behaves like image-keyboard-response
// (random per-trial sampling, no stimulus_category set).
{
  const block = {
    type: 'block',
    component_type: 'image-slider-response',
    block_length: 50,
    parameter_values: {
      stimulus_images: 'img/a.png, img/b.png, img/c.png',
      min: 0,
      max: 100,
    },
  };

  const trials = compileSliderTrials([block]);
  assert(trials.length === 50, `Expected 50 trials, got ${trials.length}`);
  const paths = new Set(trials.map((t) => t.stimulus));
  for (const t of trials) {
    assert(t.data.stimulus_category === undefined, 'No category should be set when the list has no prefixes');
  }
  assert(paths.size === 3, `Expected all 3 plain image paths to be sampled, got ${paths.size}`);
}

// Regression: image-keyboard-response Blocks with an unprefixed image list must be
// unaffected by the category-parsing changes.
{
  class FakeHtmlKeyboard2 {}
  global.window.jsPsychHtmlKeyboardResponse = FakeHtmlKeyboard2;
  const source2 = fs.readFileSync(
    path.join(__dirname, '../frontend/interpreter/src/timelineCompiler.js'),
    'utf8'
  );
  eval(source2);

  const block = {
    type: 'block',
    component_type: 'image-keyboard-response',
    block_length: 30,
    parameter_values: {
      stimulus_images: 'img/x.png\nimg/y.png',
      choices: 'ALL_KEYS',
    },
  };

  const compiled = window.TimelineCompiler.compileToJsPsychTimeline({
    task_type: 'custom',
    experiment_type: 'trial-based',
    timeline: [block],
  });
  const tl = compiled.timeline || compiled;
  const keyboardTrials = tl.filter((t) => t && t.type === FakeHtmlKeyboard2);
  assert(keyboardTrials.length === 30, `Expected 30 image-keyboard-response trials, got ${keyboardTrials.length}`);
  const paths = new Set(keyboardTrials.map((t) => t.data.plugin_type === 'image-keyboard-response' ? true : false));
  assert(paths.has(true), 'image-keyboard-response Block trials must still compile with plugin_type set');
}

console.log('Rating Image + Slider smoke test passed');

// --- Accuracy question ---

function compileTopLevelNodes(timeline, experimentType = 'trial-based') {
  const compiled = window.TimelineCompiler.compileToJsPsychTimeline({
    task_type: 'custom',
    experiment_type: experimentType,
    timeline,
  });
  return compiled.timeline || compiled;
}

// Block usage: accuracy question offers every category parsed from stimulus_images.
{
  const block = {
    type: 'block',
    component_type: 'image-slider-response',
    block_length: 60,
    parameter_values: {
      stimulus_images: 'happy:img/happy1.png\nsad:img/sad1.png\nneutral:img/neutral1.png',
      accuracy_question_enabled: true,
      accuracy_question_text: 'What is the emotion shown?',
      min: 1,
      max: 10,
    },
  };

  const nodes = compileTopLevelNodes([block]);
  const wrapped = nodes.filter((n) => Array.isArray(n?.timeline) && n.timeline.length === 2);
  assert(wrapped.length === 60, `Expected 60 slider+accuracy pairs, got ${wrapped.length}`);

  for (const node of wrapped) {
    const [accuracyTrial, sliderTrial] = node.timeline;
    assert(accuracyTrial.type === FakeSurveyResponsePlugin, 'First node must be the accuracy question');
    assert(sliderTrial.type === FakeImageSliderPlugin, 'Second node must be the intensity slider');
    assert(accuracyTrial.questions.length === 1, 'Accuracy question must ask exactly one question');
    const q = accuracyTrial.questions[0];
    assert(q.type === 'radio', 'Accuracy question must be a radio question');
    assert(q.prompt === 'What is the emotion shown?', `Unexpected question prompt: ${q.prompt}`);
    assert(
      new Set(q.options).size === 3 && ['happy', 'sad', 'neutral'].every((c) => q.options.includes(c)),
      `Expected all 3 categories as options, got ${JSON.stringify(q.options)}`
    );

    const correctCategory = sliderTrial.data.stimulus_category;
    const correctData = { responses: { category: correctCategory } };
    accuracyTrial.on_finish(correctData);
    assert(correctData.accuracy_question_is_correct === true, 'Choosing the correct category must score as correct');

    const wrongCategory = ['happy', 'sad', 'neutral'].find((c) => c !== correctCategory);
    const wrongData = { responses: { category: wrongCategory } };
    accuracyTrial.on_finish(wrongData);
    assert(wrongData.accuracy_question_is_correct === false, 'Choosing a different category must score as incorrect');
  }
}

// Block usage without accuracy_question_enabled: no follow-up question is attached.
{
  const block = {
    type: 'block',
    component_type: 'image-slider-response',
    block_length: 10,
    parameter_values: {
      stimulus_images: 'happy:img/happy1.png\nsad:img/sad1.png',
      min: 1,
      max: 10,
    },
  };

  const nodes = compileTopLevelNodes([block]);
  const wrapped = nodes.filter((n) => Array.isArray(n?.timeline));
  assert(wrapped.length === 0, 'Accuracy question must not be attached when the checkbox is off');
  const plain = nodes.filter((n) => n?.type === FakeImageSliderPlugin);
  assert(plain.length === 10, `Expected 10 plain slider trials, got ${plain.length}`);
}

// Standalone usage: accuracy_question_categories overrides the single stimulus_category.
{
  const nodes = compileTopLevelNodes([{
    type: 'image-slider-response',
    stimulus: 'img/happy1.png',
    stimulus_category: 'happy',
    accuracy_question_enabled: true,
    accuracy_question_categories: 'happy, sad, neutral',
  }]);

  const wrapped = nodes.find((n) => Array.isArray(n?.timeline));
  assert(wrapped, 'Expected the standalone slider trial to be wrapped with an accuracy question');
  const q = wrapped.timeline[0].questions[0];
  assert(
    JSON.stringify(q.options) === JSON.stringify(['happy', 'sad', 'neutral']),
    `Expected explicit category list, got ${JSON.stringify(q.options)}`
  );
}

// Compact Builder Block fields: categorization is first and the optional slider is disabled.
{
  const nodes = compileTopLevelNodes([{
    type: 'block',
    block_component_type: 'image-slider-response',
    block_length: 12,
    parameter_values: {
      stimulus_images: 'happy:img/happy1.png\nsad:img/sad1.png',
      slider_accuracy_question_enabled: true,
      slider_accuracy_question_text: 'Choose the emotion.',
      slider_enabled: false,
      slider_accuracy_question_first: true,
    },
  }]);

  assert(nodes.length === 12, `Expected 12 category-only trials, got ${nodes.length}`);
  assert(nodes.every((n) => n.type === FakeSurveyResponsePlugin), 'Category-only mode must compile to survey trials');
  assert(nodes.every((n) => n.questions[0].prompt === 'Choose the emotion.'), 'Compact question text must be preserved');
  assert(nodes.every((n) => /img\/(happy|sad)1\.png/.test(n.instructions)), 'Category question must display the sampled image');
}

// Experiment-wide task settings fill an otherwise empty image Block.
{
  const config = window.TimelineCompiler.compileToJsPsychTimeline({
    task_type: 'image-categorization',
    experiment_type: 'trial-based',
    image_categorization_settings: {
      stimulus_images: 'happy:img/happy1.png\nsad:img/sad1.png',
      accuracy_question_enabled: true,
      accuracy_question_text: 'Task-level question',
      slider_enabled: false,
      slider_accuracy_question_first: true,
    },
    timeline: [{
      type: 'block',
      block_component_type: 'image-slider-response',
      block_length: 4,
      parameter_values: {},
    }],
  });
  const inherited = config.timeline || config;
  assert(inherited.length === 4, 'Task settings must populate the empty starter Block');
  assert(inherited.every((n) => n.type === FakeSurveyResponsePlugin), 'Inherited category-only Block must use survey trials');
  assert(inherited[0].questions[0].prompt === 'Task-level question', 'Task-level question text must be inherited');
}

// Category sampling can shuffle the asset list once, then repeat the permutation.
{
  const compiled = window.TimelineCompiler.compileToJsPsychTimeline({
    task_type: 'image-categorization',
    experiment_type: 'trial-based',
    timeline: [{
      type: 'block',
      block_component_type: 'image-slider-response',
      block_length: 5,
      seed: '42',
      parameter_values: {
        stimulus_images: 'a:img/a.png\nb:img/b.png\nc:img/c.png\nd:img/d.png\ne:img/e.png',
        category_sampling_mode: 'shuffle-once',
        slider_accuracy_question_enabled: true,
        slider_enabled: false,
      },
    }],
  });
  const shuffled = compiled.timeline || compiled;
  assert(shuffled.length === 5, 'Shuffle-once Block must preserve its requested length');
  assert(new Set(shuffled.map((trial) => trial.questions[0].options[0])).size > 0, 'Shuffle-once trials must compile');
  assert(new Set(shuffled.map((trial) => trial.data.stimulus_category)).size === 5, 'Shuffle-once must produce five distinct sampled categories');
}

// Standalone usage without any category source: accuracy question is skipped entirely
// (nothing meaningful to offer as options), leaving the plain slider trial untouched.
{
  const nodes = compileTopLevelNodes([{
    type: 'image-slider-response',
    stimulus: 'img/plain.png',
    accuracy_question_enabled: true,
  }]);

  assert(nodes.length === 1, `Expected 1 top-level node, got ${nodes.length}`);
  assert(nodes[0].type === FakeImageSliderPlugin, 'Slider trial must not be wrapped when there are no categories to offer');
}

console.log('Rating Image + Slider accuracy question smoke test passed');