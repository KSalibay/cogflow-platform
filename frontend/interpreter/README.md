<p align="center">
  <img src="img/logo_dark.png" alt="CogFlow" width="280" />
</p>

# CogFlow Interpreter App (JATOS/jsPsych runtime)

Static runtime that loads a CogFlow Builder export and runs it via jsPsych.

## Contents

- [Recommended workflow (JATOS)](#recommended-workflow-builder--token-store--interpreter-jatos)
- [JATOS setup (Component Properties)](#jatos-setup-component-properties)
- [What this runtime does](#what-this-runtime-does)
- [Config loading modes](#config-loading-modes)
- [Quick start (local)](#quick-start-local)
- [Debugging and validation flags](#debugging-and-validation-flags)
- [Gabor Cue-Contingent Learning and Reward Metadata](#gabor-cue-contingent-learning-and-reward-metadata)
- [Supported tasks and component types](#supported-tasks-and-timeline-component-types)
- [Special paradigms](#special-paradigms)
- [Trial-based tasks](#trial-based-tasks)
- [Eye tracking (WebGazer)](#eye-tracking-webgazer)
- [Current scope / assumptions](#current-scope--assumptions)
- [Files](#files)
- [Repositories](#repositories)

## Recommended workflow: Builder → Token Store → Interpreter (JATOS)

The default “demo-ready” deployment path is:

- Build a config in the **Builder**
- Export it to the **CogFlow Token Store** (Cloudflare Worker + KV, optional R2 assets)
- Run the **Interpreter inside JATOS**, loading the config via JATOS Component Properties (no fragile URL params)

## JATOS setup (Component Properties)

This repo includes a JATOS entry wrapper: `index_jatos.html`.

Recommended asset layout inside your JATOS study assets for the Interpreter component:

- Component HTML file: `index_jatos.html`
- Interpreter runtime files live under: `interpreter/` (so the wrapper can load `/publix/.../interpreter/src/...`)

In the Interpreter component’s **Component Properties** (user-defined properties), set either **single-config** settings or a **multi-config bundle**.

#### Option A: single config (most common)

Set:

- `config_store_base_url`: Token Store base URL (e.g., `https://<your-worker>.workers.dev`)
- `config_store_config_id`: config id from the Builder export
- `config_store_read_token`: read token from the Builder export

#### Option B: multi-config bundle (JATOS-first; shuffled sequential run)

If you want to run multiple configs as one session (randomized order, sequential execution), set:

- `config_store_base_url`
- `config_store_code` (any label used to tag the session, e.g. `TEST001`)
- `config_store_configs` (array)

Example:

```json
{
  "config_store_base_url": "https://<your-worker>.workers.dev",
  "config_store_code": "TEST001",
  "config_store_configs": [
    { "config_id": "...", "read_token": "...", "task_type": "rdm", "filename": "..." },
    { "config_id": "...", "read_token": "...", "task_type": "sart", "filename": "..." }
  ]
}
```

Tip: the Builder includes a **JATOS Props** button that generates this JSON automatically from your Token Store exports.

If your JATOS UI can’t save arrays/objects as Component Properties, you can alternatively set:

- `config_store_configs_json`: a JSON string containing the array (or `{ "configs": [...] }`)

Notes:

- Do not show tokens to participants. The interpreter keeps token-store loading UI hidden unless `?debug=1`.
- The interpreter no longer relies on `?id=...` in JATOS (see `window.COGFLOW_DISABLE_URL_ID` in `index_jatos.html`).

Token Store note:

- `config_store_base_url` should point to *your* Token Store Worker URL for the deployment (not a personal/demo Worker).

### Results in JATOS

On completion inside JATOS, the interpreter:

- uploads a `cogflow-results-...json` file as a JATOS result file (preferred)
- submits a small JSON **summary object** as Result Data (rather than a raw array blob)

If the result-file upload fails for any reason, it falls back to submitting the full JSON payload in Result Data.

## What this runtime does

CogFlow Interpreter is a static jsPsych runtime that loads a CogFlow config (often from the Token Store inside JATOS), compiles it into a jsPsych timeline, runs it, and uploads results back to JATOS.

Key features:

- Token Store loading (single-config or multi-config bundle via JATOS Component Properties)
- Block expansion (parameter windows/ranges) + adaptive blocks (QUEST/staircase), including continuous-mode `block_sizing_mode: "by_duration"` where block seconds are converted to frame counts via experiment `frame_rate`
- Numeric list-range shorthand fallback at runtime (for robustness): if a list string like `1-4` appears in config values, it is interpreted as `1,2,3,4` during sampling
- Structural marker normalization and ordering semantics:
  - loop marker pairs (`loop-start` / `loop-end`) are normalized to loop nodes and expanded by iteration count
  - randomization marker pairs (`randomize-start` / `randomize-end`) are normalized to randomization groups and shuffled once per run
  - items outside a randomization group remain in authored order (immutable relative to surrounding timeline)
- RDM dot-groups runtime switching:
  - if `dynamic_target_group_switch_enabled` is true, the compiler normalizes the exported `N-N` frame range and the engine alternates the active target group at random intervals drawn from that range
  - cue borders in `target-group-color` mode follow the active target group in real time
  - response correctness and feedback use the current live target group at the moment of response
- RDM dot-groups dependent direction of movement:
  - if `dependent_direction_of_movement_enabled` is true, the independent group direction fields are replaced by `dependent_group_1_direction` (base range) and `dependent_group_direction_difference` (offset list); at block expansion time, group 1's direction is sampled from the base range and group 2's direction is computed as `(group_1_direction + sampled_difference) mod 360`
- Trial-based tasks + continuous-mode tasks (including SOC Dashboard)
- DRT (Detection Response Task) scheduling via explicit start/stop components (ISO defaults supported)
- Rewards v2 integration (compile-time wrapping + runtime screens/milestones)
- Optional eye tracking via WebGazer (permission + calibration injection, plus output bundling)
- Theming support via `ui_settings.theme` (from Builder exports)

## Config loading modes

The interpreter supports multiple ways to load a config. In production, prefer the JATOS + Token Store path.

- Primary (JATOS): Token Store settings from **Component Properties**
  - Single-config: `config_store_base_url`, `config_store_config_id`, `config_store_read_token`
  - Multi-config: `config_store_base_url`, `config_store_code`, `config_store_configs` (array)

- Secondary (local / legacy): `?id=YOUR_ID`
  - Loads `configs/YOUR_ID.json`
  - `id` is sanitized to `[A-Za-z0-9_-]`.

- Multi-config mode (local / legacy): `?id=XXXXXXX` (7 alphanumeric characters)
  - Loads all `configs/XXXXXXX-*.json`, shuffles their order, and runs them as one jsPsych session.
  - File discovery is best-effort:
    - If the server exposes a directory listing for `configs/`, it will be scraped.
    - Otherwise, create/update `configs/manifest.json` (array of filenames) and it will be used.

- Optional remote config sources (e.g., SharePoint)
  - `?base=...` sets the directory/URL used for loading configs (default: `configs`).
  - `?manifest=...` sets an explicit manifest JSON URL (recommended for SharePoint).
  - Example:
    - `index.html?id=ABC1234&base=https://your-site/configs&manifest=https://your-site/configs/manifest.json`

- Fallback: no `id` → you can upload a JSON file via the UI.

## Quick start (local)

Use VS Code Live Server on `index.html`.

Example:
- `http://127.0.0.1:5500/index.html?id=experiment_config_2026-01-16`

Multi-config example:
- `http://127.0.0.1:5500/index.html?id=ABC1234`

Note: the exact URL prefix depends on your Live Server workspace root; the important part is `index.html?id=...`.

If Live Server doesn't expose a directory listing, generate/update the manifest:

- PowerShell: `powershell -ExecutionPolicy Bypass -File scripts/generate-manifest.ps1`

## Debugging and validation flags

Debugging (local):

- Add `&debug=1` to auto-download the jsPsych data CSV on finish.
  - Example: `.../index.html?id=ABC1234&debug=1`
- Optional: `&debug=json` to download JSON instead.
  - If eye tracking is enabled, debug mode also downloads a second gaze-only JSON file: `cogflow-eye-tracking-...json`.
  - Debug mode also shows an on-screen eye-tracking HUD (when eye tracking is enabled) to confirm that samples are accumulating.

Validation (local):

- Add `&validate=1` to run a quick console self-check of adaptive blocks (QUEST/staircase) and Gabor parameter propagation.
  - This compiles a separate timeline for validation so it does not affect the real run.
- Use `&validate=only` to run validation without starting the experiment.
- Example sample configs included (single-task to match Builder validators):
  - Gabor QUEST: `.../index.html?id=sample_adaptive_gabor_quest&validate=1&debug=1`
  - RDM staircase: `.../index.html?id=sample_adaptive_rdm_staircase&validate=1&debug=1`

Gabor-specific debug:

- `&gabor_debug=1` (or `&debug=1`) enforces longer stimulus/mask durations for visibility.
- In debug mode, each stimulus patch overlays `freq=... cyc/px`.
  - If it shows `freq=0.0000`, your config likely rounded the spatial frequency somewhere upstream (common cause: treating `spatial_frequency_cyc_per_px` like a pixel integer).

## Gabor Cue-Contingent Learning and Reward Metadata

The runtime supports cue-coupling and reward-availability tagging for Gabor trial generation and learning loops.

- Spatial cue validity coupling:
  - Uses `spatial_cue_validity_probability` for unilateral cues (`left` / `right`).
  - Sets per-trial `spatial_cue_valid` and flips/keeps `target_location` accordingly.
- Value target coupling:
  - Uses `value_target_value` (`high|low|neutral|any`) to optionally force the target side to match the selected cue value.
- Reward availability by cue value:
  - Uses `reward_availability_high`, `reward_availability_low`, `reward_availability_neutral`.
  - Sets per-trial `reward_available` and `reward_availability_probability` metadata.

Reward integration behavior:

- If a trial carries `reward_available=false`, reward awarding is blocked for that trial even when correctness/RT criteria pass.

Per-trial output includes these fields when present:

- `spatial_cue_valid`
- `value_target_value`
- `reward_available`
- `reward_availability_probability`

## Supported tasks and timeline component types

The Interpreter primarily consumes `timeline[]` items by their `type`.

Common components:

- `html-keyboard-response` (includes Builder-authored Instructions)
- `html-button-response`
- `image-keyboard-response`
- `survey-response`
- `visual-angle-calibration`
- `reward-settings`
- `block`
- `detection-response-task-start`, `detection-response-task-stop`

Structural timeline nodes (typically normalized from Builder markers):

- `loop`
- `randomize-group`

Randomization scope:

- The interpreter shuffles only the children of each `randomize-group`.
- Timeline items outside that group are not reordered.

Task components:

- RDM: `rdm-trial`, `rdm-practice`, `rdm-adaptive`, `rdm-dot-groups` (continuous exports may compile contiguous frames into `rdm-continuous` segments)
  - During RDM block expansion, the Interpreter applies Builder-exported timing windows (`stimulus_duration`, `response_deadline`, `inter_trial_interval`) and direction transition schedules (`random_each_trial`, `every_n_trials`, `exact_count`).
  - For `rdm-dot-groups`, the Interpreter also honors `dynamic_target_group_switch_enabled` plus `dynamic_target_group_every_n_frames`. When enabled, it samples a random inclusive frame interval from the exported range, flips `response_target_group` between group 1 and group 2 at each interval, updates cue-border target coloring against the live target group, and scores responses against that live target rather than only the initial block state.
  - `rdm-dot-groups` also supports dependent direction of movement: when `dependent_direction_of_movement_enabled` is true, each generated trial samples a base direction from `dependent_group_1_direction` and an offset from `dependent_group_direction_difference`, then sets `group_2_direction = (base + offset) mod 360` before the trial runs.
- Flanker: `flanker-trial`
- SART: `sart-trial`
- Gabor: `gabor-trial`
- Stroop: `stroop-trial`
- Emotional Stroop: `emotional-stroop-trial` (runs through the same plugin as Stroop, forced `response_mode: "color_naming"`)
- Simon: `simon-trial`
- PVT: `pvt-trial`
- Task Switching: `task-switching-trial`
- MOT: `mot-trial`
- N-back: `nback-block` (compiled by trial-based or continuous N-back plugins depending on config defaults)
- Continuous Image Presentation (CIP): `continuous-image-presentation` (typically generated by a `block` with `component_type: "continuous-image-presentation"`)
- SOC Dashboard: `soc-dashboard` with `subtasks[]` types `sart-like`, `nback-like`, `flanker-like`, `wcst-like`, `pvt-like`

Emotional Stroop notes:

- Builder exports top-level defaults under `emotional_stroop_settings` (including `word_lists` / `word_options` and the shared Stroop ink `stimuli`).
- During Block expansion, the compiler couples list selection to word selection so the per-trial metadata `word_list_label` / `word_list_index` stays coherent.

## Special paradigms

### Continuous Image Presentation (CIP)

Continuous Image Presentation is a **block-driven** paradigm: a single `timeline[]` Block expands into one jsPsych trial per selected image.

#### Plugin loading

The CIP plugin must be available globally as:

- `window.jsPsychContinuousImagePresentation`

This repo’s `index.html` and `index_jatos.html` load `src/jspsych-continuous-image-presentation.js`.

#### Required exported fields

The Interpreter expects CIP blocks to include fully-resolved asset URLs inside `block.parameter_values` (exported by the Builder after CIP assets are generated/applied):

- `cip_image_urls` (newline- or comma-separated list; required)
- `cip_mask_to_image_sprite_urls` (newline- or comma-separated list; optional)
- `cip_image_to_mask_sprite_urls` (newline- or comma-separated list; optional)

Additional per-block settings (also read from `parameter_values`):

- `cip_image_duration_ms`, `cip_transition_duration_ms`, `cip_transition_frames`
- `cip_choice_keys`
- `cip_repeat_mode`, `cip_images_per_block`

#### Diagnostics (common failure mode)

If a config contains CIP blocks but `cip_image_urls` is missing/empty (or the block would generate 0 trials), the Interpreter shows a blocking **Interpreter error** with diagnostics.
This prevents the study from silently “ending” right after instructions.

### Task Switching

Task Switching runs via a custom jsPsych plugin (loaded as `window.jsPsychTaskSwitching`).

#### Defaults (`task_switching_settings`)

Builder exports Task Switching experiment-wide defaults under:

```json
{
  "task_switching_settings": {
    "stimulus_set_mode": "letters_numbers",
    "stimulus_position": "top",
    "border_enabled": false,
    "left_key": "f",
    "right_key": "j",

    "cue_type": "explicit",
    "task_1_cue_text": "LETTERS",
    "task_2_cue_text": "NUMBERS",
    "cue_font_size_px": 28,
    "cue_duration_ms": 0,
    "cue_gap_ms": 0,
    "cue_color_hex": "#FFFFFF",

    "task_1_position": "left",
    "task_2_position": "right",
    "task_1_color_hex": "#FFFFFF",
    "task_2_color_hex": "#FFFFFF",

    "tasks": [
      { "category_a_tokens": [], "category_b_tokens": [] },
      { "category_a_tokens": [], "category_b_tokens": [] }
    ]
  }
}
```

Notes:

- `stimulus_set_mode: "letters_numbers"` uses built-in scoring:
  - Task 1 (letters): vowel vs consonant
  - Task 2 (numbers): odd vs even
- `stimulus_set_mode: "custom"` uses `tasks[0]` and `tasks[1]` token sets.

### Trial behavior

- The compiled Task Switching trial displays a **combined stimulus** (task-1 token + task-2 token, e.g. `A 2`) on every trial.
- Correctness uses the **task-relevant token**:
  - letters task scores `stimulus_task_1`
  - numbers task scores `stimulus_task_2`
- Cueing modes:
  - `explicit`: shows `task_1_cue_text` / `task_2_cue_text` (and timing/color fields)
  - `position`: stimulus position varies by task via `task_1_position` / `task_2_position`
  - `color`: stimulus color varies by task via `task_1_color_hex` / `task_2_color_hex`

### MOT (Multiple Object Tracking)

MOT runs via a custom jsPsych plugin (loaded as `window.jsPsychMot`).

- Timeline `type`: `"mot-trial"` (plugin: `src/jspsych-mot.js`)
- Compiled by: `src/timelineCompiler.js` (loads `window.jsPsychMot`)
- Optional global defaults: top-level `mot_settings` is merged into each MOT trial at compile time.

#### Trial phases

1. **Cue** — targets flash at `cue_flash_rate_hz` Hz for `cue_duration_ms` ms; objects move during this phase.
2. **Tracking** — all objects continue moving unlabeled for `tracking_duration_ms` ms.
3. **Probe** — participant identifies targets. Two modes:
   - `click`: participant clicks objects; trial ends when `num_targets` are selected.
   - `number_entry`: each object shows its 1-based index; participant types numbers and presses Enter.
4. **Feedback** (optional, `show_feedback: true`) — color rings indicate hits (green), misses (red), and false alarms (orange); shown for `feedback_duration_ms` ms.
5. **ITI** — blank screen for `iti_ms` ms.

#### Key parameters

| Parameter | Default | Description |
|---|---|---|
| `num_objects` | 8 | Total number of moving objects |
| `num_targets` | 4 | Number of objects to track (highlighted during cue) |
| `speed_px_per_s` | 150 | Movement speed (pixels/second) |
| `motion_type` | `"linear"` | `"linear"` (bounce/wrap) or `"curved"` (smooth turning) |
| `probe_mode` | `"click"` | `"click"` or `"number_entry"` |
| `cue_duration_ms` | 2000 | Duration of cue phase |
| `tracking_duration_ms` | 8000 | Duration of tracking phase |
| `iti_ms` | 1000 | Inter-trial interval |
| `show_feedback` | `false` | Whether to show post-probe feedback |

#### Per-trial data output

- `num_correct` — targets correctly identified
- `num_false_alarms` — non-targets selected
- `num_missed` — targets not selected
- `rt_first_response_ms` — RT to first response from probe onset
- `selected_objects` — JSON array of 0-based object indices selected
- `clicks` — JSON array of click events (x, y, t_ms, object_hit, object_idx)
- `ended_reason` — `selection_complete` | `keypress_complete` | `timeout`

### DRT (Detection Response Task)

DRT is scheduled explicitly in the compiled timeline using:

- `detection-response-task-start`
- `detection-response-task-stop`

### ISO defaults

When not overridden by the config, the runtime defaults are ISO-aligned:

- Inter-trial interval: `min_iti_ms=3000`, `max_iti_ms=5000`
- Stimulus display: `stimulus_duration_ms=1000` (hidden earlier if the participant responds)
- Valid RT bounds (used for correctness only): `min_rt_ms=100`, `max_rt_ms=2500`

### Per-trial output

The interpreter writes one buffered DRT data row per stimulus/trial (exported alongside jsPsych rows). Key fields include:

- `drt_trial_number` (1-based within the active DRT segment)
- `drt_rt_ms` (first response RT in ms; recorded even if outside the valid bounds)
- `drt_response_count` (0 miss, 1 hit, >1 indicates extra responses / false alarms)
- Absolute onset timestamps: `drt_onset_unix_ms` and `drt_onset_iso`

Notes:

- The per-trial row is finalized at the end of the response window (or when the next DRT trial begins).
- The runtime also writes `drt_event: start|stop` rows with the effective `drt_settings` for auditing.

### SOC Dashboard

The interpreter includes a custom jsPsych plugin that renders a multi-window “SOC desktop” inside a single jsPsych trial.

- Timeline `type`: `"soc-dashboard"` (plugin: `src/jspsych-soc-dashboard.js`)
- Compiled by: `src/timelineCompiler.js` (loads `window.jsPsychSocDashboard`)
- Optional global defaults: top-level `soc_dashboard_settings` is merged into each SOC Dashboard trial.

### Included sample configs

- `.../index.html?id=sample_soc_sart_10s&debug=1`
- `.../index.html?id=sample_soc_nback_10s&debug=1`
- `.../index.html?id=sample_soc_pvt_like_01&debug=1`
- Auto-sequence demo (no per-subtask schedule): `.../index.html?id=sample_soc_3tasks_sequence&soc_debug=1`
- Overlap demo (scheduled windows): `.../index.html?id=sample_soc_nback_sart_overlap&debug=1`

Optional SOC debug overlay:

- Add `&soc_debug=1` to show additional per-window debug text inside SOC subtasks.
- `&debug=1` also enables SOC debug text.

Note: pass the config id **without** the `.json` suffix.

### Subtasks (inside `subtasks[]`)

Implemented subtask types:

- `sart-like` — log triage Go/No-Go
  - GO commits a triage action that is consistent for the whole run:
    - `go_condition: "target"`  → GO yields `ALLOW`
    - `go_condition: "distractor"` → GO yields `BLOCK`
  - `show_markers` (default false) toggles target/distractor badges.
  - `instructions` supports placeholder substitution: `{{GO_CONTROL}}`, `{{TARGETS}}`, `{{DISTRACTORS}}`.

- `nback-like` — alert correlation ($n$-back)
  - `match_field: "src_ip" | "username"`
  - `response_paradigm: "go_nogo" | "2afc"`
  - `instructions` supports placeholders: `{{GO_CONTROL}}`, `{{NOGO_CONTROL}}`, `{{N}}`, `{{MATCH_FIELD}}`.

- `flanker-like` — traffic spikes monitor (flanker-inspired “center vs flankers” decision)
  - Keys:
    - `allow_key` (default `f`)
    - `reject_key` (default `j`)
  - Timing:
    - `response_window_ms` (window where a response is accepted)
    - `trial_interval_ms` (cadence)
    - `num_trials` (optional; if provided with a scheduled duration, trials are distributed across the run)
  - Logic:
    - `reject_rule: "high_only" | "medium_or_high"`
    - The “Reject?” prompt is only visible during the response window and self-heals if a render bug would otherwise leave it stuck on screen.
  - Logging: responses are integrated into trial events (with RT/correctness), and late responses can be attached to the most recent just-ended trial.

- `wcst-like` — phishing-style email sorting (WCST-inspired rule discovery + shifts)
  - Response mode:
    - `response_device: "keyboard" | "mouse"`
    - Keyboard: `choice_keys` (4 keys for targets; default `1,2,3,4`)
    - Mouse: `mouse_response_mode: "click" | "drag"`
  - Participant support:
    - Optional in-window help overlay: `help_overlay_enabled`, `help_overlay_title`, `help_overlay_html`
  - Researcher-provided example libraries (optional):
    - Sender identity: `sender_domains`, `sender_display_names`
    - Email text: `subject_lines_neutral|urgent|reward|threat`, `preview_lines_neutral|urgent|reward|threat`
    - Link/attachment labels: `link_text_*`, `link_href_*`, `attachment_label_pdf|docm|zip`

- `pvt-like` — incident alert monitor (PVT-inspired vigilance)
  - Goal: respond as fast as possible when the red flash appears; early responses count as false starts.
  - Parameters:
    - `response_device: "keyboard" | "mouse"`, `response_key`
    - `countdown_seconds`, `flash_duration_ms`, `response_window_ms`
    - `alert_min_interval_ms`, `alert_max_interval_ms`
    - `show_countdown`, `show_red_flash`
  - Data: emits trial-level events and also writes summary stats under `subtasks_summary.pvt_like`.

### Scheduling (automatic window show/hide)

Each subtask can include optional timing fields to automatically show/hide the window during the SOC Dashboard trial:

- `start_at_ms` or `start_delay_ms`
- `duration_ms` (preferred) or `end_at_ms`

If any timing field is set, the window is scheduled:

- The window appears/disappears automatically based on the schedule.
- The **subtask itself does not start** until the participant clicks its instruction popup (if `instructions` is non-empty). This anchors `t_subtask_ms` to a true, participant-controlled start.

### Data output

SOC Dashboard data is written into the trial’s `events` array. Key event types include:

- Window lifecycle: `subtask_window_show`, `subtask_window_hide`
- SART-like: `sart_subtask_start`, `sart_present`, `sart_response`, `sart_miss`, `sart_subtask_end`
- N-back-like: `nback_subtask_start`, `nback_present`, `nback_response`, `nback_no_response`, `nback_subtask_end`
- Flanker-like: `flanker_subtask_start`, `flanker_present`, `flanker_response`, `flanker_no_response`, `flanker_late_response`, `flanker_subtask_forced_end`
- WCST-like: `wcst_subtask_start`, `wcst_present`, `wcst_response`, `wcst_omission`, `wcst_rule_change`, `wcst_subtask_forced_end`
- PVT-like: `pvt_like_subtask_start`, `pvt_like_alert_scheduled`, `pvt_like_countdown_start`, `pvt_like_flash_onset`, `pvt_like_response`, `pvt_like_false_start`, `pvt_like_timeout`, `pvt_like_subtask_auto_end`, `pvt_like_subtask_forced_end`

## Trial-based tasks

The interpreter includes additional jsPsych plugins for trial-based tasks compiled from CogFlow Builder exports.

### Included sample configs

- Stroop: `.../index.html?id=sample_stroop_01&debug=1`
- Emotional Stroop: export from the Builder (task type `emotional-stroop`) and run via Token Store / JATOS
- Simon: `.../index.html?id=sample_simon_01&debug=1`
- PVT: `.../index.html?id=sample_pvt_01&debug=1`
- N-back (trial-based): `.../index.html?id=sample_nback_trial_based&debug=1`
- N-back (continuous): `.../index.html?id=sample_nback_continuous&debug=1`

### Component types

- `stroop-trial` (plugin: `src/jspsych-stroop.js`)
- `emotional-stroop-trial` (plugin: `src/jspsych-stroop.js`, forced `response_mode: "color_naming"`)
- `simon-trial` (plugin: `src/jspsych-simon.js`)
- `pvt-trial` (plugin: `src/jspsych-pvt.js`)
- `nback-block` (plugins: `src/jspsych-nback.js` for trial-based, `src/jspsych-nback-continuous.js` for continuous)

### Experiment-wide defaults

Builder exports task-specific defaults at the top level (merged into each trial when fields are missing):

- `stroop_settings`
- `emotional_stroop_settings`
- `simon_settings`
- `pvt_settings`
- `nback_settings`

### PVT blocks and false-start compensation

If `pvt_settings.add_trial_per_false_start === true` and a `block` generates `pvt-trial`, the compiler uses a jsPsych loop so the block produces the requested number of **valid** trials (false starts do not count toward the target).

## Eye tracking (WebGazer)

The interpreter can optionally collect camera-based gaze estimates via WebGazer.

- Enable in config: `data_collection.eye_tracking.enabled = true` (also supports legacy `data_collection["eye-tracking"] = true`).
- Note: camera access typically requires HTTPS (or `localhost`) so the browser can prompt for permission.
- Flow:
  - Permission/start screen is injected so the camera prompt is tied to a user gesture.
  - Calibration/training is injected by default (WebGazer often returns null predictions until trained).
  - If the Builder timeline includes a **Calibration Instructions** preface screen (tagged with `data.plugin_type = "eye-tracking-calibration-instructions"`), it is automatically moved to appear between the permission screen and the calibration dots.
- Output:
  - On finish, an eye-tracking payload is attached to the jsPsych data.
  - If the jsPsych runtime does not allow mutating the data store safely, the interpreter falls back to appending a final extra row at export/submission time.
  - The eye-tracking payload row uses `plugin_type = "eye-tracking"` and includes:
    - `eye_tracking_samples_json` (stringified array of gaze samples)
    - `eye_tracking_calibration_json` (stringified array of calibration events)
    - `eye_tracking_stats`, start/stop results, and sample counts
- Reliability: recommended to vendor a pinned copy at `vendor/webgazer.min.js` so studies don’t depend on external CDNs.
  - The interpreter will try `vendor/webgazer.min.js` first, then fall back to a pinned CDN.
  - Override sources via `data_collection.eye_tracking.webgazer_srcs` (string array) or `webgazer_src` (single string).
- If you later want CDN-only (e.g., for a packaged distribution), set `webgazer_srcs` to just the CDN URL (or remove `vendor/webgazer.min.js`).
- Licensing: WebGazer is GPL-3.0; see `vendor/THIRD_PARTY_NOTICES.md` before distributing builds.
- Sample: `configs/sample_eye_tracking_webgazer.json`

### Eye tracking config knobs

Under `data_collection.eye_tracking` (object form), supported settings include:

- `enabled` (boolean)
- Sampling:
  - `sample_interval_ms` (preferred; milliseconds between stored samples)
  - `sample_rate` (Hz; used only if `sample_interval_ms` is not provided)
- Sources:
  - `webgazer_srcs` (string array) or `webgazer_src` (string)
- UI:
  - `show_video` (boolean) — show/hide webcam preview box
- Calibration:
  - `calibration_enabled` (boolean; default true)
  - `calibration_points` (number; default 9)
  - `calibration_key` (string; default space)
- Permission prompting:
  - `force_permission_request` (boolean; default true)
  - `cam_constraints` (object; passed to `getUserMedia` when forcing the prompt)

## Current scope / assumptions

- Supports both `experiment_type: "trial-based"` and `"continuous"`.
- `block` components are expanded up-front and sampled **per-trial** (with a special case for PVT blocks when `add_trial_per_false_start` is enabled; see above).
- Adaptive/staircase blocks (e.g. QUEST) choose their next value at runtime (via `on_start`) and update after each trial (via `on_finish`).
- Expected total scale is ~≤ 5k trials/frames.

### Block parameter windows

The compiler accepts either of these `parameter_windows` shapes:

- Builder shape: array of objects: `{ parameter, min, max }`
- Legacy/alternate shape: object map: `{ "coherence": {"min": 0.2, "max": 0.8}, ... }`

## Files

High-level map:

- `index.html`: local entry (loader UI + jsPsych boot)
- `index_jatos.html`: JATOS entry wrapper (reads Component Properties, disables URL-id loading in JATOS)
- `configs/`: sample configs + local/legacy configs
- `scripts/generate-manifest.ps1`: generate `configs/manifest.json` when directory listing is unavailable
- `src/main.js`: orchestration
- `src/configLoader.js`: loads configs (Token Store, URL mode, file upload)
- `src/timelineCompiler.js`: expands blocks + compiles to jsPsych timeline

Task/plugin implementations (selected):

- `src/drtEngine.js`: DRT scheduler + buffering
- `src/jspsych-continuous-image-presentation.js`: CIP plugin
- `src/jspsych-soc-dashboard.js`: SOC Dashboard plugin
- `src/jspsych-task-switching.js`: Task Switching plugin
- `src/eyeTrackingWebgazer.js`: WebGazer integration

- `src/rdmEngine.js`: dot-motion renderer used by the RDM plugins
- `src/jspsych-rdm.js`: RDM (trial-based)
- `src/jspsych-rdm-continuous.js`: RDM (continuous)
- `src/jspsych-flanker.js`: Flanker
- `src/jspsych-sart.js`: SART
- `src/jspsych-gabor.js`: Gabor
- `src/jspsych-stroop.js`: Stroop + Emotional Stroop
- `src/jspsych-simon.js`: Simon
- `src/jspsych-pvt.js`: PVT
- `src/jspsych-nback.js`: N-back (trial-based)
- `src/jspsych-nback-continuous.js`: N-back (continuous)
- `src/jspsych-survey-response.js`: Survey response
- `src/jspsych-visual-angle-calibration.js`: Visual angle calibration

## Repositories

- Interpreter repo: https://github.com/KSalibay/json-interpreter-app
- Builder repo: https://github.com/KSalibay/json-builder-app
