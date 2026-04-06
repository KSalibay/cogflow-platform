# CogFlow Builder & Interpreter Changelog

## April 7, 2026

### CRDM Mouse Diagnostics + MOT/DRT Choice-Phase Gating

- CRDM mouse-response exports now include explicit response-region metadata to support null-response auditing while keeping full-canvas click behavior unchanged.
  - Added response flags/metrics such as:
    - `response_registered`, `response_not_registered_reason`
    - `response_within_canvas`, `response_within_aperture`, `response_within_boundary_band`
    - `response_distance_from_center_px`, selection mode, and pointer-event counters
  - Applies to both single-trial RDM and continuous RDM frame records.
- MOT now auto-pauses DRT during the probe/choice phase and auto-resumes DRT immediately after probe completion.
  - This mirrors the existing MW-probe DRT stop/start behavior and requires no Builder schema/UI changes.
  - Goal: keep DRT active during tracking but suppress DRT overlays while participants are making MOT choices.
- Added MOT yes/no recognition probe mode (`yes_no_recognition`) across authoring and runtime.
  - Builder: mode available in MOT defaults, component modal, and MOT block settings.
  - Builder Preview: MOT preview now reflects recognition mode and yes/no keys.
  - Interpreter: MOT runtime now supports yes/no recognition responses with configurable `yes_key` / `no_key` and emits recognition-specific trial fields.
- Added MOT recognition probe-count control to run multiple yes/no probes per trial before advancing.
  - Builder: new `recognition_probe_count` / `mot_recognition_probe_count` parameter wiring in defaults, schema, export, and block settings.
  - Builder Preview: yes/no probe hint now includes probes-per-trial count.
  - Interpreter: yes/no recognition now asks `N` probes sequentially (without replacement), aggregates scoring across probes, and exports per-probe response details.
- Added conditional visibility for `survey-response` / `mw-probe` questions.
  - Builder question editor now supports optional per-question `visible_if` rules (`question_id` + expected value).
  - Interpreter survey runtime now applies conditional show/hide live as answers change, validates required fields only for visible questions, and remains backward compatible with legacy `show_if_*` keys.

## April 2, 2026

### Builder Import Rehydration + SOC/DRT/MOT Alignment

- Added single-file JSON import rehydration in Builder:
  - Importing one local JSON file can now rebuild Builder task/experiment state and timeline rows.
  - Rebuild is validation-gated; invalid configs are rejected before timeline mutation.
  - Rehydration reconstructs nested timeline structures (loops, randomize groups) and de-composes SOC composed timelines back into Builder helper rows.
- SOC authoring/export alignment updates:
  - SOC MW-probe helper rows are preserved through export/compile paths.
  - SOC SART-like export preserves explicit `go_condition` semantics (`block` / `allow`).
- DRT authoring path is now explicitly componentized:
  - Timeline components `detection-response-task-start` and `detection-response-task-stop` are used instead of legacy inline toggles.
- MOT defaults/export controls expanded:
  - Added aperture-shape and aperture-border controls in Builder defaults and block/task export paths.

## March 27, 2026

### RDM Block Direction Transition Scheduling

- Added new RDM Block controls so researchers can define how often direction changes happen within generated block trials:
  - `direction_transition_mode`: `random_each_trial` | `every_n_trials` | `exact_count`
  - `direction_transition_every_n_trials`
  - `direction_transition_count`
- Added these controls to Builder block modal/schema for:
  - `rdm-trial`
  - `rdm-practice`
  - `rdm-dot-groups`
- Export now preserves these controls in block `parameter_values` so the Interpreter can apply scheduling at runtime.

#### Deployment / Sync

- Synced Builder changes to active local JATOS Builder paths:
  - `/study_assets_root/cogflow/builder/`
  - `/study_assets_root/cogflow_clone/builder/`
  - plus clone mirror builder paths under `/study_assets_root/cogflow_clone/cogflow-builder-app/`

## March 25, 2026

### Cross-Team Follow-up (Sachi, Tariq, Guy)

#### Guy: Loop + Probe Authoring
- Added loop marker components (`loop-start`, `loop-end`) and nested loop expansion support in Builder/Interpreter.
- Added loop bracket UI in timeline editing and hid loop marker components from the normal library picker (markers are now timeline-structure controls).
- Added `mw-probe` as a first-class component with the same full question editor flow as `survey-response`.
- Added probe interval fields (`min_interval_ms`, `max_interval_ms`) to support interruption-style probe placement in looped block runs.

#### Sachi: RDM Lifetime Clarification
- Added explicit runtime diagnostics for RDM continuous mode (debug overlay + debug panel) to expose effective coherence, speed, direction, reseed rate, and lifetime behavior.
- Aligned continuous lifetime handling with refresh-rate-independent timing so `lifetime_frames` behaves consistently across displays.

#### Documentation / Sync
- Synced latest loop + mw-probe + RDM diagnostic/lifetime updates to platform and JATOS interpreter copies, including cache-busted loader references.

### Builder Updates

#### Tariq Follow-up Fixes
- Fixed instruction alignment export for Builder-authored rich text:
  - `instructions` and `html-keyboard-response` now expose a `text_align` control in the Builder UI.
  - Export now converts Quill alignment classes (for example `ql-align-center`) into inline HTML styles so alignment renders correctly in the Interpreter without Quill CSS.
- Prevented accidental mouse-wheel changes on focused number inputs in the Builder.
- Fixed timeline template save/load:
  - Templates are now serialized from the live timeline DOM instead of the stale internal `timeline` array.
  - Loading a saved template restores the timeline cards correctly.
- Fixed SART block seeding from experiment defaults:
  - New SART Blocks now inherit the current experiment-level no-go digit, go key, and timing defaults.
- Added SART no-go probability authoring support:
  - Builder block editor now exposes `sart_nogo_probability`.
  - Export preserves the full configured SART digit set and the explicit `nogo_probability` value.
  - Builder preview and Interpreter block expansion now apply the configured no-go probability during trial sampling rather than shrinking the exported digit list.

#### SOC SART Copy Adjustment
- Replaced the SOC SART default instructions with more neutral wording to avoid hard-coding harmful/benign response semantics while `go_condition` naming remains under review.

#### SOC SART Field Rename and Backward Compatibility
- **Renamed field**: `go_condition` values changed from `['target', 'distractor']` to `['block', 'allow']` for clearer semantics.
  - `'block'` mode: GO on distractor entries (responds to harmful/distracted state)
  - `'allow'` mode: GO on target entries (responds to normal/benign state)
  - Default changed from `'distractor'` to `'block'`
- **Backward compatibility**: Both Builder preview and runtime Interpreter accept old values (`'target'`, `'distractor'`) and automatically normalize them to the new scheme.
  - Old `'distractor'` → new `'block'` (GO on distractors)
  - Old `'target'` → new `'allow'` (GO on targets)
  - Existing experiment configs with old field values continue to work without modification.
- Updated Builder schema description to clarify the GO rule semantics for each mode.
- Updated Interpreter runtime mapping (`goRule` display and `shouldGoFor()` logic) to use new field values while transparently handling legacy configs.

#### Deployment / Sync
- Synced the above Builder changes (alignment export, wheel prevention, template save/load, SART defaults, SART probability) to platform and JATOS Builder copies (6 instances total).
- Synced the SART probability sampling and SOC SART copy adjustments to platform and JATOS Interpreter copies (6 instances total).
- Synced the SOC SART field rename (`go_condition: target|distractor` → `go_condition: block|allow`) with full backward compatibility to all platform and JATOS copies (12 deployed copies verified).

#### Remaining Follow-ups
- JATOS template storage remains browser-local for now; server-backed template persistence is deferred.

## March 20, 2026

### Builder Updates

#### Timeline Authoring UX
- Added **Duplicate Below** action for timeline components in the Builder UI.
- Added timeline layout stabilization styles in `css/style.css`:
  - Full-width card row alignment (drag handle left, text center, actions right)
  - Improved truncation/overflow handling for long card titles and labels

#### Gabor Preview and Block Support
- `ComponentPreview` now routes `gabor-learning` through Gabor preview rendering.
- Preview sampling now respects cue-enabled toggles:
  - `gabor_spatial_cue_enabled=false` forces spatial cue to `none`
  - `gabor_value_cue_enabled=false` forces left/right values to `neutral`
- Gabor preview ring layering updated so cue rings are drawn after patch pixels.

#### Gabor Schema Expansion
- Extended many Gabor block parameters to target `gabor-learning` in addition to `gabor-trial` and `gabor-quest`.
- Added new cue/value learning parameters in `src/schemas/JSPsychSchemas.js`:
  - `gabor_spatial_cue_validity_probability`
  - `gabor_value_target_value`
  - `gabor_reward_availability_high`
  - `gabor_reward_availability_low`
  - `gabor_reward_availability_neutral`

#### Documentation
- Regenerated `docs/reference/plugins/plugin_schema_reference.md` from current schema definitions.

## March 19, 2026

### Visual & UX Improvements

#### Gabor Patch Rendering
- **Diamond cue redesign**: Replaced Unicode arrow (`←`/`→`/`↔`) with custom diamond shape rendered on canvas
  - Diamond is now centered between patches (at patch-center vertical position)
  - Removed separate fixation cross from top of canvas (integrated into diamond as internal cross)
  - Applies to both Builder preview and Interpreter runtime rendering
  - Implementation: `drawCueDiamond()` function mirrored in ComponentPreview.js and jspsych-gabor.js

- **Patch layout improvements**:
  - Increased horizontal separation: patch centers now at 0.30/0.70 of canvas width (previously 0.32/0.68)
  - Replaced padded square frames with true circular stroke outlines at patch radius
  - Results in cleaner, more compact stimuli with improved visual clarity

#### Manual Theme Toggle System (Builder)
- Replaced OS-driven `prefers-color-scheme` detection with manual user control
- Light/dark toggle button added to navbar (both `index.html` and `index_jatos.html`)
- Theme preference persists via localStorage (`cogflow_builder_theme` key)
- Color palette: CogFlow palette-driven tokens for both themes
  - Light: ash-grey, lilac-ash, olive-wood backgrounds with twilight-indigo text
  - Dark: space-indigo base (#262c41) with ash-grey foreground (#dfe8e1)
- Applies to all UI components: cards, forms, timeline, JSON preview, buttons, modals
- Early bootstrap script prevents flash on page load
- Added debug remnant cleaner (MutationObserver removes bottom-left artifacts)

### Feature Completions

#### Gabor-Learning Block Type
- Full end-to-end implementation of accuracy-driven learning loops
- Learning parameters exported and visible in Builder UI:
  - `learning_streak_length` (default 20): number of consecutive correct responses for criterion
  - `learning_target_accuracy` (default 0.9): accuracy threshold to exit loop
  - `learning_max_trials` (default 200): maximum trials per learning block
  - `show_feedback` (toggle): display "Correct"/"Incorrect" post-trial
  - `feedback_duration_ms` (default 800): feedback display duration

- **Builder side** (JsonBuilder.js):
  - Added `gabor-learning` to allowed block types (line 5031)
  - Extended export mapping to handle learning blocks (lines 8954–9110)
  - All learning parameters exported to `parameter_values`

- **Builder UI** (TimelineBuilder.js):
  - Fixed visibility condition to include `gabor-learning` in Gabor parameter updates (line 2330)
  - Learning parameters now properly shown in parameter modal

- **Interpreter side** (timelineCompiler.js):
  - Gabor-learning blocks create looped trial sequences (lines 2792–2859)
  - Maintains rolling accuracy history (last N trials)
  - Exits on streak accuracy ≥ target or max trials reached
  - Trial data includes `gabor_learning_block: true` and `gabor_learning_trial` markers

#### QUEST Adaptive Mode (Full Pipeline)
- Complete QUEST staircase implementation for Gabor blocks
- **Builder export** (JsonBuilder.js):
  - Exports QUEST parameters to `values.adaptive` object with mode, parameter, performance target, SD/beta/delta/gamma coefficients
  - Added contrast parameter option to QUEST control list
  - Supports coarse/fine phase trials and per-location thresholds

- **Interpreter compilation** (timelineCompiler.js):
  - QUEST staircase initialized with parameters from Builder config (lines 632–685)
  - Per-location support: separate staircases for left/right target locations
  - Coarse→fine transition: reinitializes staircase at phase boundary with mean at previous phase threshold + tighter SD
  - Stores per-location thresholds to `window.cogflowState.gabor_thresholds` when enabled

- **Runtime execution** (jspsych-gabor.js):
  - `on_start` hook calls `staircase.next()` to get adapted parameter value
  - `on_finish` hook calls `staircase.update(correctness)` with trial outcome
  - Trial data records `adaptive_mode`, `adaptive_parameter`, `adaptive_value`
  - Supports tilt magnitude adaptation with randomized sign for discriminate_tilt task

### Deployment Notes

- All changes synced to JATOS asset aliases:
  - `/cogflow/builder/` and `/cogflow/cogflow-builder-app/` for Builder
  - Same pattern for Interpreter
- Hard refresh (Ctrl+Shift+R) recommended after sync to clear cached assets
- Theme preference persists across page reloads via localStorage
- Learning/QUEST logic is fully integrated end-to-end; no additional configuration needed

### Technical Details

#### Files Modified

**cogflow-builder-app:**
- `index.html`: Added early theme bootstrap + toggle button
- `index_jatos.html`: Added early theme bootstrap + toggle button (fixed top-right)
- `css/style.css`: Added theme tokens, data-attribute-driven theming, dark mode overrides, toggle styling
- `src/JsonBuilder.js`: Added gabor-learning to block types; extended export mapping for learning/QUEST
- `src/modules/TimelineBuilder.js`: Fixed visibility condition for gabor-learning
- `src/modules/ComponentPreview.js`: Updated diamond cue rendering; circular outlines; no center fixation
- `src/schemas/JSPsychSchemas.js`: Added learning param definitions

**cogflow-interpreter-app:**
- `index_jatos.html`: Uses theme from Builder export (ui_settings.theme)
- `src/jspsych-gabor.js`: Uses show_feedback + feedback_duration_ms post-trial
- `src/timelineCompiler.js`: Gabor-learning loop logic + QUEST staircase management

#### Testing Recommendations

1. **Theme toggle**: Hard-refresh Builder, toggle light/dark, verify localStorage persistence
2. **Gabor-learning**: Create learning block, set streak_length=5, verify loop exits when accuracy ≥ target
3. **QUEST**: Create QUEST block with tilt parameter, verify on_start/on_finish adapts values
4. **Per-location QUEST**: Enable staircase_per_location, verify separate thresholds logged
5. **Gabor visual**: Compare diamond cue centering and patch spacing in preview vs runtime

---

## Earlier History

_(Previous changelog entries to be populated)_
