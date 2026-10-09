#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class FakeHtmlButtonPlugin {}
class FakeHtmlKeyboardPlugin {}
class FakeRdmContinuousPlugin {}

global.window = {
  location: { href: 'http://localhost/' },
  cogflowState: {},
  jsPsychHtmlButtonResponse: FakeHtmlButtonPlugin,
  jsPsychHtmlKeyboardResponse: FakeHtmlKeyboardPlugin,
  jsPsychRdmContinuous: FakeRdmContinuousPlugin,
};

const compilerSource = fs.readFileSync(
  path.join(__dirname, '../frontend/interpreter/src/timelineCompiler.js'),
  'utf8'
);
const interpreterHtml = fs.readFileSync(
  path.join(__dirname, '../frontend/interpreter/index.html'),
  'utf8'
);
eval(compilerSource);

function compileOne(item) {
  const compiled = window.TimelineCompiler.compileToJsPsychTimeline({
    task_type: 'custom',
    experiment_type: 'trial-based',
    timeline: [item],
  });
  const trials = (compiled.timeline || compiled).filter(
    (t) => t && t.type === FakeHtmlButtonPlugin
  );
  assert(trials.length === 1, `Expected 1 html-button trial, got ${trials.length}`);
  return trials[0];
}

// Consent mode forces the Agree / Don't agree pair regardless of authored choices.
const consentTrial = compileOne({
  type: 'html-button-response',
  stimulus: '<p>Consent text</p>',
  choices: ['Something', 'Else', 'Third'],
  button_html: '',
  consent_mode: true,
  consent_decline_message: '<p>No thanks.</p>',
});

assert(
  JSON.stringify(consentTrial.choices) === JSON.stringify(['Agree', "Don't agree"]),
  `Expected fixed consent labels, got ${JSON.stringify(consentTrial.choices)}`
);
assert(consentTrial.response_ends_trial === true, 'Consent trial must end on response');
assert(typeof consentTrial.on_finish === 'function', 'Consent trial must attach an on_finish hook');
assert(consentTrial.data?.consent_mode === true, 'Consent trial data must flag consent_mode');
assert(consentTrial.button_html === undefined, 'Blank custom button HTML must not suppress jsPsych default buttons');
assert(interpreterHtml.includes('#jspsych-content:has(.psy-wrap--buttons)'), 'Consent layout override must target the button trial content');
assert(interpreterHtml.includes('overflow-y: auto;'), 'Consent layout must remain scrollable on short viewports');
assert(interpreterHtml.includes('flex-wrap: wrap;'), 'Consent buttons must wrap inside narrow viewports');

// Legacy Builder configs may describe consent clearly but omit the consent flag and choices.
const legacyConsentTrial = compileOne({
  type: 'html-button-response',
  stimulus: '<p>This is an informed consent form</p>',
  prompt: '<p>Click Agree to agree</p>',
  choices: [],
});
assert(
  JSON.stringify(legacyConsentTrial.choices) === JSON.stringify(['Agree', "Don't agree"]),
  'Legacy informed-consent text without choices must recover the fixed consent buttons'
);
assert(legacyConsentTrial.data?.consent_mode === true, 'Recovered legacy consent must use consent behavior');

// Declining ends the study and is recorded in the trial data.
let abortedWith = null;
window.__psy_jsPsych = {
  abortExperiment: (msg) => { abortedWith = msg; },
};

const declineData = { response: 1 };
consentTrial.on_finish(declineData);
assert(declineData.consent_declined === true, 'Decline must be recorded as consent_declined=true');
assert(abortedWith === '<p>No thanks.</p>', `Decline must end the study with the configured message, got ${abortedWith}`);

// Agreeing continues the study.
abortedWith = null;
const agreeData = { response: 0 };
consentTrial.on_finish(agreeData);
assert(agreeData.consent_declined === false, 'Agree must be recorded as consent_declined=false');
assert(abortedWith === null, 'Agreeing must not end the study');

// Consent mode falls back to a default decline message.
const defaultMsgTrial = compileOne({
  type: 'html-button-response',
  stimulus: '<p>Consent text</p>',
  consent_mode: true,
});
abortedWith = null;
defaultMsgTrial.on_finish({ response: 1 });
assert(
  typeof abortedWith === 'string' && abortedWith.trim() !== '',
  'Consent decline must show a non-empty default message'
);

// Normal (non-consent) buttons are untouched.
const plainTrial = compileOne({
  type: 'html-button-response',
  stimulus: '<p>Pick one</p>',
  choices: ['Option 1', 'Option 2'],
  trial_duration: 5000,
});
assert(
  JSON.stringify(plainTrial.choices) === JSON.stringify(['Option 1', 'Option 2']),
  `Expected authored choices to be preserved, got ${JSON.stringify(plainTrial.choices)}`
);
assert(plainTrial.on_finish === undefined, 'Non-consent trials must not attach a consent hook');
assert(plainTrial.trial_duration === 5000, 'Non-consent trials must keep their trial_duration');
assert(plainTrial.data?.consent_mode === undefined, 'Non-consent trials must not flag consent_mode');

// Regression: html-button-response previously compiled only in the continuous-RDM
// path and fell through to the "unsupported component" screen everywhere else.
for (const taskType of ['custom', 'rdm', 'sart']) {
  for (const experimentType of ['trial-based', 'continuous']) {
    const compiled = window.TimelineCompiler.compileToJsPsychTimeline({
      task_type: taskType,
      experiment_type: experimentType,
      timeline: [{ type: 'html-button-response', stimulus: '<p>x</p>', choices: ['a', 'b'] }],
    });
    const trials = (compiled.timeline || compiled);
    const unsupported = trials.filter((t) => t?.data?.plugin_type === 'unsupported');
    const buttons = trials.filter((t) => t?.type === FakeHtmlButtonPlugin);
    assert(
      unsupported.length === 0,
      `html-button-response must be supported for ${taskType}/${experimentType}`
    );
    assert(
      buttons.length === 1,
      `Expected a button trial for ${taskType}/${experimentType}, got ${buttons.length}`
    );
  }
}

// Declining jumps to the Debriefing screen when one is authored, instead of
// ending the run outright.
{
  const compiled = window.TimelineCompiler.compileToJsPsychTimeline({
    task_type: 'custom',
    experiment_type: 'trial-based',
    timeline: [
      { type: 'html-button-response', stimulus: '<p>Consent</p>', consent_mode: true },
      { type: 'html-keyboard-response', stimulus: '<p>Task A</p>' },
      { type: 'html-keyboard-response', stimulus: '<p>Task B</p>' },
      { type: 'debriefing', stimulus: '<p>Thanks!</p>' },
    ],
  });
  const tl = compiled.timeline;

  const consentIdx = tl.findIndex((t) => t?.data?.consent_mode === true);
  const debriefIdx = tl.findIndex((t) => t?.data?.plugin_type === 'debriefing');
  assert(consentIdx === 0, `Consent trial should be first, got index ${consentIdx}`);
  assert(debriefIdx > consentIdx, 'Debriefing must come after consent');

  const skipNode = tl[consentIdx + 1];
  assert(
    Array.isArray(skipNode?.timeline) && skipNode.timeline.length === 2,
    'Trials between consent and debriefing must be grouped into a skippable timeline'
  );
  assert(
    typeof skipNode.name === 'string' && skipNode.name.length > 0,
    'Skippable timeline must be named so it can be aborted by name'
  );

  let abortedTimeline = null;
  let endedStudy = false;
  window.__psy_jsPsych = {
    abortTimelineByName: (name) => { abortedTimeline = name; },
    abortExperiment: () => { endedStudy = true; },
  };

  tl[consentIdx].on_finish({ response: 1 });
  assert(
    abortedTimeline === skipNode.name,
    `Decline must skip the main body timeline, got ${abortedTimeline}`
  );
  assert(endedStudy === false, 'Decline must not end the study when a debriefing exists');

  // Agreeing leaves the timeline alone.
  abortedTimeline = null;
  tl[consentIdx].on_finish({ response: 0 });
  assert(abortedTimeline === null, 'Agreeing must not skip the study body');
}

// Without a debriefing, declining still ends the run.
{
  const compiled = window.TimelineCompiler.compileToJsPsychTimeline({
    task_type: 'custom',
    experiment_type: 'trial-based',
    timeline: [
      { type: 'html-button-response', stimulus: '<p>Consent</p>', consent_mode: true },
      { type: 'html-keyboard-response', stimulus: '<p>Task A</p>' },
    ],
  });
  const tl = compiled.timeline;
  const consent = tl.find((t) => t?.data?.consent_mode === true);

  let endedStudy = false;
  window.__psy_jsPsych = {
    abortTimelineByName: () => { throw new Error('should not skip without a debriefing'); },
    abortExperiment: () => { endedStudy = true; },
  };

  consent.on_finish({ response: 1 });
  assert(endedStudy === true, 'Without a debriefing, declining must end the study');
}

// Compiling a second config must not disturb an earlier config's skip target,
// which matters for multi-config (platform launch) studies.
{
  const withDebrief = window.TimelineCompiler.compileToJsPsychTimeline({
    task_type: 'custom',
    experiment_type: 'trial-based',
    timeline: [
      { type: 'html-button-response', stimulus: '<p>Consent</p>', consent_mode: true },
      { type: 'html-keyboard-response', stimulus: '<p>Task</p>' },
      { type: 'debriefing', stimulus: '<p>Thanks!</p>' },
    ],
  });

  window.TimelineCompiler.compileToJsPsychTimeline({
    task_type: 'custom',
    experiment_type: 'trial-based',
    timeline: [{ type: 'html-keyboard-response', stimulus: '<p>Unrelated config</p>' }],
  });

  const tl = withDebrief.timeline;
  const consent = tl.find((t) => t?.data?.consent_mode === true);
  const skipNode = tl.find((t) => Array.isArray(t?.timeline));

  let abortedTimeline = null;
  let endedStudy = false;
  window.__psy_jsPsych = {
    abortTimelineByName: (name) => { abortedTimeline = name; },
    abortExperiment: () => { endedStudy = true; },
  };

  consent.on_finish({ response: 1 });
  assert(
    abortedTimeline === skipNode.name,
    'Skip target must survive a later unrelated compile'
  );
  assert(endedStudy === false, 'Later compiles must not turn the skip into a full stop');
}

console.log('HTML+Button consent mode smoke test passed');