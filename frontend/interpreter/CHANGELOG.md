# CogFlow Interpreter Changelog

## March 25, 2026

### Runtime Follow-up (Sachi, Tariq, Guy)

#### RDM Continuous: Lifetime + Motion Semantics
- Fixed refresh-rate sensitivity in continuous RDM lifetime handling.
  - Dot lifetime aging is now time-based (60Hz-equivalent), not tied to raw monitor refresh frequency.
- Kept coherence/direction as exact per-frame values during transitions (no blending of motion-definition fields).
- Added noise-type normalization aliases (`brownian`, `correlated_noise`, hyphen variants) to ensure stable runtime behavior.

#### RDM Diagnostics
- Added runtime debug panel for continuous RDM:
  - Toggle with `Ctrl+Shift+D`.
  - Enable at load with `?rdm_debug=1`.
  - Shows target vs measured coherence/speed/direction, noise mode, lifetime, reseeds, and noise-jump counts.
- Added persistent debug toggle support via localStorage and global runtime flag.

#### MW Probe Scheduling in Loop/Block Runs
- Updated mw-probe interruption scheduling to place probes inside surrounding generated block trials (not only at boundaries).
- Scheduling now supports generated runs around the probe marker (before and after placement point) and re-samples per loop iteration.
- Added fallback generated-trial duration estimation so jitter placement works even when explicit per-trial duration fields are absent.

#### DRT + Continuous RDM Display Mode Notes
- Preserved continuous-mode DRT overlay behavior while integrating probe and RDM diagnostics updates.
- Continuous RDM remains single-canvas rendering with segment-level compiler transitions and per-frame response/deadline handling.

## March 20, 2026

### Runtime Updates

#### Gabor Cue/Target Coupling in Compiler
- Added spatial cue validity coupling in `src/timelineCompiler.js`:
  - Applies `spatial_cue_validity_probability` for unilateral cues.
  - Writes per-trial `spatial_cue_valid` metadata and updates `target_location` accordingly.
- Added value-target coupling:
  - Uses `value_target_value` (`high|low|neutral`) to align target side with cue value.
- Added cue-conditioned reward availability tagging:
  - Uses `reward_availability_high`, `reward_availability_low`, `reward_availability_neutral`.
  - Writes `reward_available` and `reward_availability_probability` per trial.

#### Reward Gate and Data Output
- Reward success logic now explicitly blocks reward when `reward_available === false`.
- Trial event extraction now propagates `reward_available` into reward evaluation.
- `src/jspsych-gabor.js` now persists additional trial fields when present:
  - `spatial_cue_valid`
  - `reward_available`
  - `reward_availability_probability`
  - `value_target_value`

#### Gabor-Learning Trial Sampling
- Gabor-learning block compilation now supports:
  - Sampling from `parameter_values` arrays and `parameter_windows`
  - Applying cue-present probabilities and cue-value policies during looped trial generation
  - Carrying cue/reward metadata into trial data for downstream analysis

## March 19, 2026

### Visual & UX Improvements

#### Gabor Patch Rendering
- **Diamond cue redesign**: Implemented custom canvas-rendered diamond shape replacing Unicode arrows
  - Cue positioned at patch-center vertical location (between patches horizontally)
  - Removed separate top-center fixation cross (integrated into diamond)
  - Consistent with Builder preview rendering
  - Maintains internal 8px fixation cross within diamond for maintained timing reference

- **Patch layout refinements**:
  - Increased patch separation (0.30/0.70 canvas width)
  - Circular colored stroke outlines at patch radius instead of padded square frames
  - Improved visual clarity and reduced visual clutter

### Feature Completions

#### Gabor-Learning Support
- Full implementation of accuracy-driven learning loops at runtime
- Reads learning parameters from compiled trial data:
  - `learning_streak_length`: rolling window size for accuracy computation
  - `learning_target_accuracy`: threshold to exit loop (0–1)
  - `learning_max_trials`: maximum trials per learning block
  - `show_feedback`: whether to display correctness feedback
  - `feedback_duration_ms`: feedback display duration

**Implementation** (timelineCompiler.js, lines 2792–2859):
- Creates jsPsych loop structure with trial templates
- Maintains rolling accuracy history (drops oldest when exceeding streak length)
- Checks on each trial: if accumulated streak accuracy ≥ target AND streak_length trials collected, exit
- Records `gabor_learning_block: true` + `gabor_learning_trial: <count>` in trial data

#### QUEST Adaptive Staircase
- Complete QUEST implementation for parameterized adaptation
- Reads QUEST parameters from compiled adaptive metadata

**Startup** (lines 632–685):
- Initializes QuestStaircase with QUEST coefficients (beta, delta, gamma)
- Per-location mode: separate staircases for left/right target locations
- Coarse→fine phase support: reinitializes with tighter SD at phase boundary

**Runtime** (lines ~1000–1100, attached to trial on_start/on_finish):
- `on_start`: Calls `staircase.next()` to get parameter value, applies to trial
  - Special handling for tilt: takes magnitude, randomizes sign
- `on_finish`: Calls `staircase.update(correctness)` to advance staircase state
- Stores per-location thresholds to `window.cogflowState.gabor_thresholds` on each trial update

**Data recording**:
- Trial data includes `adaptive_mode`, `adaptive_parameter`, `adaptive_value`
- Enables post-hoc analysis of adaptive trajectory

#### Post-Trial Feedback
- Gabor plugin now supports configurable feedback display
- Parameters: `show_feedback` (boolean), `feedback_duration_ms` (ms)
- Displays "Correct" or "Incorrect" on canvas after trial response period
- Integrates cleanly with learning block loops

### Deployment Notes

- JATOS synced from source repos with rsync
- No additional configuration needed; all learning/QUEST logic handled by timelineCompiler
- Feedback display works automatically when Builder exports learning parameters

### Technical Details

#### Files Modified

**cogflow-interpreter-app:**
- `src/jspsych-gabor.js`:
  - Replaced `drawCueArrow()` with `drawCueDiamond()` (same as Builder)
  - Added `show_feedback` + `feedback_duration_ms` parameter support
  - Post-trial feedback display logic with configurable duration

- `src/timelineCompiler.js`:
  - Gabor-learning block handler: creates looped trial structure with accuracy tracking (lines 2792–2859)
  - QUEST staircase initialization and phase management (lines 632–685)
  - Adaptive on_start/on_finish callback generation (~1000 lines of adaptive logic)

#### Testing Recommendations

1. **Learning mode**: Create learning block, verify loop exits after N correct streak
2. **QUEST adaptation**: Monitor `trial.data.adaptive_value` changes across trials
3. **Feedback**: Enable `show_feedback`, verify "Correct"/"Incorrect" displays post-response
4. **Per-location QUEST**: Enable staircase_per_location, verify thresholds diverge for left/right
5. **Visual consistency**: Compare Gabor diamond cues across Builder preview and Interpreter runtime

---

## Earlier History

_(Previous changelog entries to be populated)_
