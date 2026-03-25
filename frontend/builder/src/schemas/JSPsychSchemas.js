/**
 * jsPsych Schema Validation
 * 
 * Validates JSON configurations against jsPsych parameter types and experimental psychology standards
 * Ensures compatibility with jsPsych plugins and JATOS deployment
 */

class JSPsychSchemas {
    constructor() {
        console.log('[SchemaDebug] Loaded JSPsychSchemas.js build: 20260304-1');
        this.parameterTypes = this.initializeParameterTypes();
        this.pluginSchemas = this.initializePluginSchemas();
        this.experimentSchemas = this.initializeExperimentSchemas();
        
        // Initialize RDM task schema for RDM-specific validation
        try {
            this.rdmSchema = new RDMTaskSchema();
        } catch (error) {
            console.warn('RDMTaskSchema not available:', error.message);
            this.rdmSchema = null;
        }
    }

    /**
     * Initialize jsPsych parameter types
     */
    initializeParameterTypes() {
        return {
            AUDIO: 'AUDIO',
            BOOL: 'BOOL',
            COLOR: 'COLOR',
            COMPLEX: 'COMPLEX',
            FLOAT: 'FLOAT',
            FUNCTION: 'FUNCTION',
            HTML_STRING: 'HTML_STRING',
            IMAGE: 'IMAGE',
            INT: 'INT',
            KEY: 'KEY',
            KEYS: 'KEYS',
            OBJECT: 'OBJECT',
            SELECT: 'SELECT',
            STRING: 'STRING',
            TIMELINE: 'TIMELINE',
            VIDEO: 'VIDEO'
        };
    }

    getCommonTrialParameters() {
        // Legacy: older builds exposed a per-trial DRT toggle here.
        // DRT is now configured via explicit timeline items:
        //   - detection-response-task-start
        //   - detection-response-task-stop
        // So we intentionally do not expose any common DRT flag in schemas.
        return {};
    }

    /**
     * Initialize plugin schemas based on jsPsych plugins
     */
    initializePluginSchemas() {
        return {
            'soc-dashboard': {
                name: 'soc-dashboard',
                description: 'SOC Dashboard session (Windows-like shell). Subtasks are added in the Builder and composed into this session on export.',
                parameters: {
                    title: {
                        type: this.parameterTypes.STRING,
                        default: 'SOC Dashboard',
                        description: 'Session title (shown in subtask windows)'
                    },
                    trial_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 60000,
                        description: 'Session duration in ms (0 = no auto-end)'
                    },
                    end_key: {
                        type: this.parameterTypes.STRING,
                        default: 'escape',
                        description: 'Key that ends the session'
                    },
                    wallpaper_url: {
                        type: this.parameterTypes.STRING,
                        default: '',
                        description: 'Optional wallpaper image URL'
                    },
                    background_color: {
                        type: this.parameterTypes.STRING,
                        default: '#0b1220',
                        description: 'Background color used when no wallpaper URL is provided'
                    },
                    start_menu_enabled: {
                        type: this.parameterTypes.BOOL,
                        default: true,
                        description: 'Enable Start button'
                    },
                    default_app: {
                        type: this.parameterTypes.SELECT,
                        default: 'soc',
                        options: ['soc', 'email', 'terminal'],
                        description: 'Initial active app'
                    },
                    num_tasks: {
                        type: this.parameterTypes.INT,
                        default: 1,
                        min: 1,
                        max: 4,
                        description: 'Fallback: number of placeholder windows shown when no subtasks are configured (1–4)'
                    },
                    icons_clickable: {
                        type: this.parameterTypes.BOOL,
                        default: true,
                        description: 'Whether desktop icons appear clickable (interpreter logs clicks as distractors)'
                    },
                    log_icon_clicks: {
                        type: this.parameterTypes.BOOL,
                        default: true,
                        description: 'Whether to log desktop icon clicks'
                    },
                    icon_clicks_are_distractors: {
                        type: this.parameterTypes.BOOL,
                        default: true,
                        description: 'Tag icon-click events as distractors'
                    }
                }
            },

            // Builder-only helper components: composed into soc-dashboard trials on export.
            'soc-subtask-sart-like': {
                name: 'soc-subtask-sart-like',
                description: 'SOC subtask window (SART-like). Composed into the nearest SOC Dashboard session at export time.',
                parameters: {
                    title: {
                        type: this.parameterTypes.STRING,
                        default: 'Login monitor',
                        description: 'Subtask window title'
                    },
                    start_at_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        min: 0,
                        max: 3600000,
                        description: 'Scheduled start time (ms) from SOC session start. If used with duration_ms, the window appears/disappears automatically.'
                    },
                    duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        min: 0,
                        max: 3600000,
                        description: 'Scheduled duration (ms). If 0, scheduling is disabled unless end_at_ms is provided manually in JSON.'
                    },
                    instructions: {
                        type: this.parameterTypes.HTML_STRING,
                           default: '<p>Log entries will stream past. Your job is to triage each one:</p>\n<p>Press <b>{{GO_CONTROL}}</b> when the current entry matches the class configured for a response in this subtask.</p>\n<p><b>Withhold</b> your response for the other class.</p>\n<p><b>Harmful:</b> {{TARGETS}}</p>\n<p><b>Benign:</b> {{DISTRACTORS}}</p>\n<p><i>Click this popup to begin.</i></p>',
                        description: 'Optional instructions shown in a popup before this subtask begins (closing the popup marks the subtask start time)'
                    },
                    instructions_title: {
                        type: this.parameterTypes.STRING,
                        default: 'Filtering harmful logins',
                        description: 'Popup title for the subtask instructions overlay'
                    },
                    show_markers: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        description: 'Show TARGET/DISTRACTOR markers inside the task UI (off by default)'
                    },
                    visible_entries: {
                        type: this.parameterTypes.INT,
                        default: 8,
                        min: 3,
                        max: 25,
                        description: 'Number of log entries visible at once (older entries scroll out of view)'
                    },
                    scroll_interval_ms: {
                        type: this.parameterTypes.INT,
                        default: 900,
                        min: 100,
                        max: 10000,
                        description: 'Milliseconds between new log entries (auto-scroll rate)'
                    },
                    min_run_ms: {
                        type: this.parameterTypes.INT,
                        default: 30000,
                        min: 0,
                        max: 3600000,
                        description: 'Minimum subtask runtime in ms (0 = no minimum)'
                    },
                    max_run_ms: {
                        type: this.parameterTypes.INT,
                        default: 60000,
                        min: 0,
                        max: 3600000,
                        description: 'Maximum subtask runtime in ms (0 = no maximum). If max < min, values are swapped at runtime.'
                    },
                    response_device: {
                        type: this.parameterTypes.SELECT,
                        default: 'keyboard',
                        options: ['keyboard', 'mouse'],
                        description: 'Primary response device for this subtask'
                    },
                    go_key: {
                        type: this.parameterTypes.STRING,
                        default: 'space',
                        description: 'Keyboard go key (ignored if response_device = mouse)'
                    },
                    go_button: {
                        type: this.parameterTypes.SELECT,
                        default: 'action',
                        options: ['action', 'change'],
                        description: 'Mouse-only: which button the participant clicks to respond (controls the in-window action UI)'
                    },
                    go_condition: {
                        type: this.parameterTypes.SELECT,
                        default: 'block',
                        options: ['block', 'allow'],
                        description: 'Response condition: "block" to respond to distractors, "allow" to respond to targets'
                    },
                    highlight_subdomains: {
                        type: this.parameterTypes.BOOL,
                        default: true,
                        description: 'Highlight target/distractor entries in the feed'
                    },
                    target_highlight_color: {
                        type: this.parameterTypes.COLOR,
                        default: '#ff4d4d',
                        description: 'Target highlight color'
                    },
                    distractor_highlight_color: {
                        type: this.parameterTypes.COLOR,
                        default: '#3dd6ff',
                        description: 'Distractor highlight color'
                    },
                    target_subdomains: {
                        type: this.parameterTypes.HTML_STRING,
                        default: 'login.bank.example\nvpn.bank.example\nadmin.bank.example',
                        description: 'Target domain/subdomain list (comma- or newline-separated)'
                    },
                    distractor_subdomains: {
                        type: this.parameterTypes.HTML_STRING,
                        default: 'cdn.news.example\nstatic.video.example\napi.store.example',
                        description: 'Distractor domain/subdomain list (comma- or newline-separated)'
                    },
                    neutral_subdomains: {
                        type: this.parameterTypes.HTML_STRING,
                        default: '',
                        description: 'Optional neutral domain/subdomain list (comma- or newline-separated). If blank, neutrals are auto-generated.'
                    },
                    target_probability: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.15,
                        min: 0,
                        max: 1,
                        description: 'Probability a new entry is a target (0–1)'
                    },
                    distractor_probability: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.35,
                        min: 0,
                        max: 1,
                        description: 'Probability a new entry is a distractor (0–1). Remaining probability becomes neutral.'
                    }
                }
            },
            'soc-subtask-flanker-like': {
                name: 'soc-subtask-flanker-like',
                description: 'SOC subtask window (Flanker-like). Composed into the nearest SOC Dashboard session at export time.',
                parameters: {
                    title: {
                        type: this.parameterTypes.STRING,
                        default: 'Flanker-like',
                        description: 'Subtask window title'
                    },
                    start_at_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        min: 0,
                        max: 3600000,
                        description: 'Scheduled start time (ms) from SOC session start. If used with duration_ms, the window appears/disappears automatically.'
                    },
                    duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        min: 0,
                        max: 3600000,
                        description: 'Scheduled duration (ms). If 0, scheduling is disabled unless end_at_ms is provided manually in JSON.'
                    },
                    num_trials: {
                        type: this.parameterTypes.INT,
                        default: 20,
                        min: 0,
                        max: 5000,
                        description: 'Number of decision epochs (trial clusters) to schedule while the window is visible. If 0, trials are scheduled by trial_interval_ms.'
                    },
                    instructions: {
                        type: this.parameterTypes.HTML_STRING,
                        default: '<p>You will see a scrolling <b>traffic spikes</b> monitor.</p>\n<p>When <b>Reject?</b> flashes, respond to the <b>center spike</b> directly underneath that question, ignoring surrounding spikes.</p>\n<p>Press <b>{{REJECT_KEY}}</b> to reject and <b>{{ALLOW_KEY}}</b> to allow.</p>\n<p><i>Click this popup to begin.</i></p>',
                        description: 'Optional instructions shown in a popup before this subtask begins (closing the popup marks the subtask start time)'
                    },
                    instructions_title: {
                        type: this.parameterTypes.STRING,
                        default: 'Traffic spikes monitor',
                        description: 'Popup title for the subtask instructions overlay'
                    },

                    allow_key: {
                        type: this.parameterTypes.STRING,
                        default: 'f',
                        description: 'Keyboard key for ALLOW / "No" (e.g., f)'
                    },
                    reject_key: {
                        type: this.parameterTypes.STRING,
                        default: 'j',
                        description: 'Keyboard key for REJECT / "Yes" (e.g., j)'
                    },

                    trial_interval_ms: {
                        type: this.parameterTypes.INT,
                        default: 1400,
                        min: 300,
                        max: 10000,
                        description: 'Time between decision prompts (ms)'
                    },
                    response_window_ms: {
                        type: this.parameterTypes.INT,
                        default: 900,
                        min: 150,
                        max: 10000,
                        description: 'Response deadline from prompt onset (ms)'
                    },
                    question_flash_ms: {
                        type: this.parameterTypes.INT,
                        default: 550,
                        min: 80,
                        max: 5000,
                        description: 'How long the "Reject?" prompt is visually emphasized (ms)'
                    },

                    congruent_probability: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.5,
                        min: 0,
                        max: 1,
                        description: 'Probability flankers match the center spike (0–1)'
                    },
                    center_high_probability: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.34,
                        min: 0,
                        max: 1,
                        description: 'Probability the center spike is HIGH (0–1). Probabilities are normalized at runtime.'
                    },
                    center_medium_probability: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.33,
                        min: 0,
                        max: 1,
                        description: 'Probability the center spike is MEDIUM (0–1). Probabilities are normalized at runtime.'
                    },
                    center_low_probability: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.33,
                        min: 0,
                        max: 1,
                        description: 'Probability the center spike is LOW (0–1). Probabilities are normalized at runtime.'
                    },
                    reject_rule: {
                        type: this.parameterTypes.SELECT,
                        default: 'high_only',
                        options: ['high_only', 'medium_or_high'],
                        description: 'Which center-spike levels count as a correct REJECT'
                    },

                    scroll_speed_px_per_s: {
                        type: this.parameterTypes.FLOAT,
                        default: 240,
                        min: 40,
                        max: 1200,
                        description: 'Base scrolling speed of the monitor (px/s)'
                    },
                    jerkiness: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.35,
                        min: 0,
                        max: 1,
                        description: 'How "jerky" the scrolling is (0–1)'
                    },
                    point_spacing_px: {
                        type: this.parameterTypes.INT,
                        default: 8,
                        min: 4,
                        max: 24,
                        description: 'Horizontal spacing between graph points (px)'
                    },

                    show_feedback: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        description: 'Briefly show Correct/Incorrect after response (preview + interpreter)'
                    }
                }
            },
            'soc-subtask-nback-like': {
                name: 'soc-subtask-nback-like',
                description: 'SOC subtask window (N-back-like). Composed into the nearest SOC Dashboard session at export time.',
                parameters: {
                    title: {
                        type: this.parameterTypes.STRING,
                        default: 'Repeat-offender monitor',
                        description: 'Subtask window title'
                    },
                    start_at_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        min: 0,
                        max: 3600000,
                        description: 'Scheduled start time (ms) from SOC session start. If used with duration_ms, the window appears/disappears automatically.'
                    },
                    duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        min: 0,
                        max: 3600000,
                        description: 'Scheduled duration (ms). If 0, scheduling is disabled unless end_at_ms is provided manually in JSON.'
                    },
                    instructions: {
                        type: this.parameterTypes.HTML_STRING,
                        default: '<p>You will see a stream of security alerts, one at a time.</p>\n<p>Press <b>{{GO_CONTROL}}</b> when the current alert matches the one from <b>{{N}}-back</b> on <b>{{MATCH_FIELD}}</b>.</p>\n<p>If it does not match, respond <b>{{NOGO_CONTROL}}</b> (or withhold if using Go/No-Go).</p>\n<p><i>Click this popup to begin.</i></p>',
                        description: 'Optional instructions shown in a popup before this subtask begins (closing the popup marks the subtask start time)'
                    },
                    instructions_title: {
                        type: this.parameterTypes.STRING,
                        default: 'Correlating repeat offenders',
                        description: 'Popup title for the subtask instructions overlay'
                    },

                    n: {
                        type: this.parameterTypes.INT,
                        default: 2,
                        min: 1,
                        max: 3,
                        description: 'N-back level (1–3)'
                    },
                    match_field: {
                        type: this.parameterTypes.SELECT,
                        default: 'src_ip',
                        options: ['src_ip', 'username'],
                        description: 'Which field defines an N-back match'
                    },

                    response_paradigm: {
                        type: this.parameterTypes.SELECT,
                        default: 'go_nogo',
                        options: ['go_nogo', '2afc'],
                        description: 'Response paradigm: Go/No-Go (single key) or 2AFC (match vs no-match keys)'
                    },
                    go_key: {
                        type: this.parameterTypes.STRING,
                        default: 'space',
                        description: 'Go key for Go/No-Go (and also accepted as the Match key if response_paradigm=2afc and match_key is blank)'
                    },
                    match_key: {
                        type: this.parameterTypes.STRING,
                        default: 'j',
                        description: '2AFC: key for MATCH (yes)'
                    },
                    nonmatch_key: {
                        type: this.parameterTypes.STRING,
                        default: 'f',
                        description: '2AFC: key for NO MATCH (no)'
                    },

                    stimulus_interval_ms: {
                        type: this.parameterTypes.INT,
                        default: 1200,
                        min: 200,
                        max: 10000,
                        description: 'Milliseconds between alert cards (stimulus cadence)'
                    },
                    target_probability: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.25,
                        min: 0,
                        max: 1,
                        description: 'Probability the current alert matches the alert from N-back (0–1). Only applies after the buffer has at least N items.'
                    },
                    min_run_ms: {
                        type: this.parameterTypes.INT,
                        default: 30000,
                        min: 0,
                        max: 3600000,
                        description: 'Minimum subtask runtime in ms (0 = no minimum)'
                    },
                    max_run_ms: {
                        type: this.parameterTypes.INT,
                        default: 60000,
                        min: 0,
                        max: 3600000,
                        description: 'Maximum subtask runtime in ms (0 = no maximum). If max < min, values are swapped at runtime.'
                    },
                    show_feedback: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        description: 'Show brief on-screen feedback after responses (off by default)'
                    },
                }
            },
            'soc-subtask-wcst-like': {
                name: 'soc-subtask-wcst-like',
                description: 'SOC subtask window (WCST-like). Composed into the nearest SOC Dashboard session at export time.',
                parameters: {
                    title: {
                        type: this.parameterTypes.STRING,
                        default: 'WCST-like',
                        description: 'Subtask window title'
                    },
                    start_at_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        min: 0,
                        max: 3600000,
                        description: 'Scheduled start time (ms) from SOC session start. If used with duration_ms, the window appears/disappears automatically.'
                    },
                    duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        min: 0,
                        max: 3600000,
                        description: 'Scheduled duration (ms). If 0, scheduling is disabled unless end_at_ms is provided manually in JSON.'
                    },
                    instructions: {
                        type: this.parameterTypes.HTML_STRING,
                        default: '<p>Sort each email into one of four target cards.</p>\n<p>{{CONTROLS}}</p>\n<p><b>Possible rules</b>: {{RULES}}</p>\n<p><i>Click this popup to begin.</i></p>',
                        description: 'Optional instructions shown in a popup before this subtask begins (closing the popup marks the subtask start time)'
                    },
                    instructions_title: {
                        type: this.parameterTypes.STRING,
                        default: 'Email sorting',
                        description: 'Popup title for the subtask instructions overlay'
                    },
                    response_device: {
                        type: this.parameterTypes.SELECT,
                        default: 'keyboard',
                        options: ['keyboard', 'mouse'],
                        description: 'Primary response device for this subtask'
                    },
                    mouse_response_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'click',
                        options: ['click', 'drag'],
                        description: 'Mouse-only: click a target vs drag the email onto a target'
                    },
                    choice_keys: {
                        type: this.parameterTypes.STRING,
                        default: '1,2,3,4',
                        description: 'Keyboard choice keys for targets A-D (comma-separated; ignored if response_device = mouse)'
                    },
                    sender_domains: {
                        type: this.parameterTypes.STRING,
                        default: 'corp.test, vendor.test, typo.test, ip.test',
                        description: 'Comma- or newline-separated list of 4 example sender domains (A–D). Tip: use reserved .test domains.'
                    },
                    sender_display_names: {
                        type: this.parameterTypes.STRING,
                        default: 'Operations, IT Vendor, Support Desk, Automated Notice',
                        description: 'Comma- or newline-separated list of 4 sender display names aligned to sender_domains (A–D)'
                    },
                    subject_lines_neutral: {
                        type: this.parameterTypes.STRING,
                        default: 'Weekly account summary',
                        description: 'Example subject lines for neutral tone (newline-separated recommended). One is sampled per trial.'
                    },
                    subject_lines_urgent: {
                        type: this.parameterTypes.STRING,
                        default: 'Action required: verify your account',
                        description: 'Example subject lines for urgent tone (newline-separated recommended)'
                    },
                    subject_lines_reward: {
                        type: this.parameterTypes.STRING,
                        default: 'You have a new benefit available',
                        description: 'Example subject lines for reward tone (newline-separated recommended)'
                    },
                    subject_lines_threat: {
                        type: this.parameterTypes.STRING,
                        default: 'Account will be restricted soon',
                        description: 'Example subject lines for threat tone (newline-separated recommended)'
                    },
                    preview_lines_neutral: {
                        type: this.parameterTypes.STRING,
                        default: 'No action needed. Review recent activity.',
                        description: 'Example preview lines for neutral tone (newline-separated recommended). One is sampled per trial.'
                    },
                    preview_lines_urgent: {
                        type: this.parameterTypes.STRING,
                        default: 'Please verify your account details to avoid interruption.',
                        description: 'Example preview lines for urgent tone (newline-separated recommended)'
                    },
                    preview_lines_reward: {
                        type: this.parameterTypes.STRING,
                        default: 'A new item is available. Review details when convenient.',
                        description: 'Example preview lines for reward tone (newline-separated recommended)'
                    },
                    preview_lines_threat: {
                        type: this.parameterTypes.STRING,
                        default: 'Failure to act may result in restricted access.',
                        description: 'Example preview lines for threat tone (newline-separated recommended)'
                    },
                    link_text_visible: {
                        type: this.parameterTypes.STRING,
                        default: 'portal.corp.test',
                        description: 'Visible-link style: link text shown in the email'
                    },
                    link_href_visible: {
                        type: this.parameterTypes.STRING,
                        default: 'https://portal.corp.test/',
                        description: 'Visible-link style: link href (displayed in data, not navigated)'
                    },
                    link_text_shortened: {
                        type: this.parameterTypes.STRING,
                        default: 'short.test/abc',
                        description: 'Shortened-link style: link text shown in the email'
                    },
                    link_href_shortened: {
                        type: this.parameterTypes.STRING,
                        default: 'https://short.test/abc',
                        description: 'Shortened-link style: link href (displayed in data, not navigated)'
                    },
                    link_text_mismatch: {
                        type: this.parameterTypes.STRING,
                        default: 'portal.corp.test',
                        description: 'Mismatch-link style: link text shown in the email'
                    },
                    link_href_mismatch: {
                        type: this.parameterTypes.STRING,
                        default: 'https://vendor.test/portal',
                        description: 'Mismatch-link style: link href (displayed in data, not navigated)'
                    },
                    attachment_label_pdf: {
                        type: this.parameterTypes.STRING,
                        default: 'report.pdf',
                        description: 'PDF attachment filename label'
                    },
                    attachment_label_docm: {
                        type: this.parameterTypes.STRING,
                        default: 'invoice.docm',
                        description: 'DOCM attachment filename label'
                    },
                    attachment_label_zip: {
                        type: this.parameterTypes.STRING,
                        default: 'archive.zip',
                        description: 'ZIP attachment filename label'
                    },
                    help_overlay_enabled: {
                        type: this.parameterTypes.BOOL,
                        default: true,
                        description: 'Show a brief in-window help overlay describing mechanics and examples'
                    },
                    help_overlay_title: {
                        type: this.parameterTypes.STRING,
                        default: 'Quick help',
                        description: 'Title for the in-window help overlay'
                    },
                    help_overlay_html: {
                        type: this.parameterTypes.HTML_STRING,
                        default: '<p><b>Goal:</b> Sort each email into one of four targets.</p>\n<p><b>How to respond:</b> {{CONTROLS}}</p>\n<p><b>What the domains mean:</b> example sender domains used as stimulus attributes: <b>{{DOMAINS}}</b>.</p>\n<p><b>Possible rules:</b> {{RULES}}</p>',
                        description: 'Optional custom HTML for the help overlay. Placeholders: {{CONTROLS}}, {{DOMAINS}}, {{RULES}}, {{KEYS}}'
                    },
                    num_trials: {
                        type: this.parameterTypes.INT,
                        default: 24,
                        min: 0,
                        max: 5000,
                        description: 'Number of trials (0 = unlimited until forced end / schedule end)'
                    },
                    response_window_ms: {
                        type: this.parameterTypes.INT,
                        default: 2500,
                        min: 200,
                        max: 20000,
                        description: 'Response deadline per email (ms)'
                    },
                    iti_ms: {
                        type: this.parameterTypes.INT,
                        default: 300,
                        min: 0,
                        max: 20000,
                        description: 'Inter-trial interval (ms)'
                    },
                    show_feedback: {
                        type: this.parameterTypes.BOOL,
                        default: true,
                        description: 'Show brief on-screen feedback after each response'
                    },
                    feedback_ms: {
                        type: this.parameterTypes.INT,
                        default: 450,
                        min: 0,
                        max: 5000,
                        description: 'Feedback duration (ms)'
                    },
                    rules: {
                        type: this.parameterTypes.STRING,
                        default: 'sender_domain,subject_tone,link_style,attachment_type',
                        description: 'Rule sequence (comma-separated): sender_domain, subject_tone, link_style, attachment_type'
                    },
                    rule_change_correct_streak: {
                        type: this.parameterTypes.INT,
                        default: 8,
                        min: 1,
                        max: 50,
                        description: 'Change the rule after this many consecutive correct responses'
                    },
                    min_run_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        min: 0,
                        max: 3600000,
                        description: 'Minimum subtask runtime in ms (0 = no minimum)'
                    },
                    max_run_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        min: 0,
                        max: 3600000,
                        description: 'Maximum subtask runtime in ms (0 = no maximum). If max < min, values are swapped at runtime.'
                    }
                }
            },

            'soc-subtask-pvt-like': {
                name: 'soc-subtask-pvt-like',
                description: 'SOC subtask window (PVT-like vigilance). Scrolling console logs with occasional countdown alerts and a red flash. Composed into the nearest SOC Dashboard session at export time.',
                parameters: {
                    title: {
                        type: this.parameterTypes.STRING,
                        default: 'Incident alerts',
                        description: 'Subtask window title'
                    },
                    start_at_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        min: 0,
                        max: 3600000,
                        description: 'Scheduled start time (ms) from SOC session start. If used with duration_ms, the window appears/disappears automatically.'
                    },
                    duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        min: 0,
                        max: 3600000,
                        description: 'Scheduled duration (ms). If 0, scheduling is disabled unless end_at_ms is provided manually in JSON.'
                    },
                    instructions: {
                        type: this.parameterTypes.HTML_STRING,
                        default: '<p>This window shows a scrolling event feed.</p>\n<p>Occasionally you will see a <b>countdown</b> followed by a <b>red flash</b>.</p>\n<p>Press <b>{{RESPONSE_CONTROL}}</b> as soon as the <b>red flash</b> appears.</p>\n<p><i>Click this popup to begin.</i></p>',
                        description: 'Optional instructions shown in a popup before this subtask begins (closing the popup marks the subtask start time)'
                    },
                    instructions_title: {
                        type: this.parameterTypes.STRING,
                        default: 'Incident alert monitor',
                        description: 'Popup title for the subtask instructions overlay'
                    },
                    response_device: {
                        type: this.parameterTypes.SELECT,
                        default: 'keyboard',
                        options: ['keyboard', 'mouse'],
                        description: 'Primary response device for this subtask'
                    },
                    response_key: {
                        type: this.parameterTypes.STRING,
                        default: 'space',
                        description: 'Keyboard response key (ignored if response_device = mouse)'
                    },

                    visible_entries: {
                        type: this.parameterTypes.INT,
                        default: 10,
                        min: 3,
                        max: 30,
                        description: 'Number of console/log entries visible at once (older entries scroll out of view)'
                    },
                    log_scroll_interval_ms: {
                        type: this.parameterTypes.INT,
                        default: 400,
                        min: 50,
                        max: 5000,
                        description: 'Milliseconds between new console/log entries (auto-scroll rate)'
                    },

                    alert_min_interval_ms: {
                        type: this.parameterTypes.INT,
                        default: 2000,
                        min: 250,
                        max: 600000,
                        description: 'Minimum time between alerts (ms)'
                    },
                    alert_max_interval_ms: {
                        type: this.parameterTypes.INT,
                        default: 6000,
                        min: 250,
                        max: 600000,
                        description: 'Maximum time between alerts (ms)'
                    },
                    countdown_seconds: {
                        type: this.parameterTypes.INT,
                        default: 3,
                        min: 0,
                        max: 10,
                        description: 'Countdown length (seconds) shown before the red flash'
                    },
                    flash_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 120,
                        min: 20,
                        max: 2000,
                        description: 'Red flash duration (ms)'
                    },
                    response_window_ms: {
                        type: this.parameterTypes.INT,
                        default: 1500,
                        min: 100,
                        max: 20000,
                        description: 'Response deadline from red-flash onset (ms)'
                    },
                    show_countdown: {
                        type: this.parameterTypes.BOOL,
                        default: true,
                        description: 'Show countdown overlay'
                    },
                    show_red_flash: {
                        type: this.parameterTypes.BOOL,
                        default: true,
                        description: 'Show red flash overlay at alert onset'
                    },

                    min_run_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        min: 0,
                        max: 3600000,
                        description: 'Minimum subtask runtime in ms (0 = no minimum)'
                    },
                    max_run_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        min: 0,
                        max: 3600000,
                        description: 'Maximum subtask runtime in ms (0 = no maximum). If max < min, values are swapped at runtime.'
                    },
                }
            },

            // Builder-only helper component: composed into soc-dashboard trials on export.
            'soc-dashboard-icon': {
                name: 'soc-dashboard-icon',
                description: 'Desktop icon definition (composed into the nearest SOC session at export time)',
                parameters: {
                    label: {
                        type: this.parameterTypes.STRING,
                        default: 'Email',
                        description: 'Icon label'
                    },
                    app: {
                        type: this.parameterTypes.SELECT,
                        default: 'email',
                        options: ['soc', 'email', 'terminal'],
                        description: 'App to activate when clicked'
                    },
                    icon_text: {
                        type: this.parameterTypes.STRING,
                        default: '✉',
                        description: 'Simple text glyph used as icon'
                    },
                    row: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        description: 'Grid row'
                    },
                    col: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        description: 'Grid column'
                    },
                    distractor: {
                        type: this.parameterTypes.BOOL,
                        default: true,
                        description: 'Whether clicking this icon should be treated as a distractor'
                    }
                }
            },

            'flanker-trial': {
                name: 'flanker-trial',
                description: 'Flanker trial/frame (stimulus + scoring implemented by interpreter)',
                parameters: {
                    stimulus_type: {
                        type: this.parameterTypes.SELECT,
                        default: 'arrows',
                        options: ['arrows', 'letters', 'symbols', 'custom'],
                        description: 'What kind of stimuli to display (arrows vs letters/symbols/custom strings)'
                    },
                    target_direction: {
                        type: this.parameterTypes.SELECT,
                        default: 'left',
                        options: ['left', 'right'],
                        description: 'Target direction (for arrow-style flankers)'
                    },
                    target_stimulus: {
                        type: this.parameterTypes.STRING,
                        default: 'H',
                        description: 'Center stimulus when stimulus_type is letters/symbols/custom'
                    },
                    distractor_stimulus: {
                        type: this.parameterTypes.STRING,
                        default: 'S',
                        description: 'Distractor stimulus used when congruency = incongruent (letters/symbols/custom)'
                    },
                    neutral_stimulus: {
                        type: this.parameterTypes.STRING,
                        default: '–',
                        description: 'Neutral flanker stimulus used when congruency = neutral'
                    },
                    congruency: {
                        type: this.parameterTypes.SELECT,
                        default: 'congruent',
                        options: ['congruent', 'incongruent', 'neutral'],
                        description: 'Congruency condition'
                    },
                    show_fixation_dot: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        description: 'Show a small fixation dot under the center stimulus'
                    },
                    show_fixation_cross_between_trials: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        description: 'Show a fixation cross between trials (during ITI/inter-stimulus)'
                    },
                    left_key: {
                        type: this.parameterTypes.STRING,
                        default: 'f',
                        description: 'Response key mapped to left'
                    },
                    right_key: {
                        type: this.parameterTypes.STRING,
                        default: 'j',
                        description: 'Response key mapped to right'
                    },
                    stimulus_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 800,
                        description: 'Stimulus display duration (ms)'
                    },
                    trial_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 1500,
                        description: 'Total trial duration (ms)'
                    },
                    iti_ms: {
                        type: this.parameterTypes.INT,
                        default: 500,
                        description: 'Inter-trial interval (ms)'
                    }
                }
            },

            'sart-trial': {
                name: 'sart-trial',
                description: 'SART trial/frame (go/no-go logic implemented by interpreter)',
                parameters: {
                    digit: {
                        type: this.parameterTypes.INT,
                        default: 1,
                        description: 'Digit to display (0-9)'
                    },
                    nogo_digit: {
                        type: this.parameterTypes.INT,
                        default: 3,
                        description: 'No-go digit (withhold response)'
                    },
                    go_key: {
                        type: this.parameterTypes.STRING,
                        default: 'space',
                        description: 'Response key for go trials'
                    },
                    stimulus_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 250,
                        description: 'Digit display duration (ms)'
                    },
                    mask_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 900,
                        description: 'Mask duration after digit (ms)'
                    },
                    trial_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 1150,
                        description: 'Total trial duration (ms)'
                    },
                    iti_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        description: 'Inter-trial interval (ms)'
                    }
                }
            },

            'simon-trial': {
                name: 'simon-trial',
                description: 'Simon trial (colored circle appears left/right; respond by mapped color-side; scoring implemented by interpreter)',
                parameters: {
                    stimulus_side: {
                        type: this.parameterTypes.SELECT,
                        default: 'left',
                        options: ['left', 'right'],
                        description: 'Which side the colored stimulus circle appears on'
                    },
                    stimulus_color_name: {
                        type: this.parameterTypes.STRING,
                        default: 'BLUE',
                        description: 'Name of the stimulus color (looked up in simon_settings.stimuli by name)'
                    },
                    response_device: {
                        type: this.parameterTypes.SELECT,
                        default: 'inherit',
                        options: ['inherit', 'keyboard', 'mouse'],
                        description: 'Override experiment-wide response_device (inherit uses simon_settings.response_device)'
                    },
                    left_key: {
                        type: this.parameterTypes.KEY,
                        default: 'f',
                        description: 'Keyboard key for LEFT response (when response_device=keyboard)'
                    },
                    right_key: {
                        type: this.parameterTypes.KEY,
                        default: 'j',
                        description: 'Keyboard key for RIGHT response (when response_device=keyboard)'
                    },
                    circle_diameter_px: {
                        type: this.parameterTypes.INT,
                        default: 140,
                        min: 40,
                        max: 400,
                        description: 'Diameter of each circle (px)'
                    },
                    stimulus_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        description: 'Stimulus display duration (ms). 0 = until response/trial end.'
                    },
                    trial_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 1500,
                        description: 'Total trial duration (ms). 0 = no timeout.'
                    },
                    iti_ms: {
                        type: this.parameterTypes.INT,
                        default: 500,
                        description: 'Inter-trial interval (ms)'
                    }
                }
            },

            'nback-trial-sequence': {
                name: 'nback-trial-sequence',
                description: 'N-back trial sequence generator (expanded by interpreter/compiler into nback-block items)',
                parameters: {
                    n: {
                        type: this.parameterTypes.INT,
                        default: 2,
                        min: 1,
                        max: 9,
                        description: 'N-back level'
                    },
                    length: {
                        type: this.parameterTypes.INT,
                        default: 30,
                        min: 1,
                        max: 50000,
                        description: 'Number of trials/frames to generate'
                    },
                    seed: {
                        type: this.parameterTypes.STRING,
                        default: '',
                        description: 'Optional seed for deterministic sequence generation (blank = interpreter default)'
                    },
                    stimulus_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'letters',
                        options: ['letters', 'numbers', 'shapes', 'custom'],
                        description: 'How to interpret stimulus_pool defaults'
                    },
                    stimulus_pool: {
                        type: this.parameterTypes.STRING,
                        default: 'A,B,C,D,E,F,G,H',
                        description: 'Comma/newline-separated stimulus tokens to sample from'
                    },
                    render_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'token',
                        options: ['token', 'custom_html'],
                        description: 'Render each stimulus as a token label or via stimulus_template_html'
                    },
                    stimulus_template_html: {
                        type: this.parameterTypes.HTML_STRING,
                        default: '<div style="font-size:72px; font-weight:700; text-align:center;">{{TOKEN}}</div>',
                        description: 'Used when render_mode=custom_html ({{TOKEN}} is replaced with the token)'
                    },

                    stimulus_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 500,
                        min: 0,
                        max: 60000,
                        description: 'Stimulus display duration (ms)'
                    },
                    isi_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 500,
                        min: 0,
                        max: 60000,
                        description: 'Inter-stimulus interval (ms)'
                    },
                    trial_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 1000,
                        min: 0,
                        max: 60000,
                        description: 'Total trial duration (ms). 0 = no timeout.'
                    },

                    show_fixation_cross_between_trials: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        description: 'Show a fixation cross (+) when the token is hidden (during ISI/ITI between items)'
                    },

                    response_paradigm: {
                        type: this.parameterTypes.SELECT,
                        default: 'go_nogo',
                        options: ['go_nogo', '2afc'],
                        description: 'Go/No-Go (single key) vs 2AFC (match vs non-match keys)'
                    },
                    response_device: {
                        type: this.parameterTypes.SELECT,
                        default: 'keyboard',
                        options: ['keyboard', 'mouse'],
                        description: 'Primary response device'
                    },
                    go_key: {
                        type: this.parameterTypes.KEY,
                        default: 'space',
                        description: 'Go key (and accepted as Match key when response_paradigm=2afc and match_key is blank)'
                    },
                    match_key: {
                        type: this.parameterTypes.KEY,
                        default: 'j',
                        description: '2AFC: key for MATCH'
                    },
                    nonmatch_key: {
                        type: this.parameterTypes.KEY,
                        default: 'f',
                        description: '2AFC: key for NO MATCH'
                    },
                    show_buttons: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        description: 'Mouse mode: show clickable response buttons'
                    },

                    target_probability: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.25,
                        min: 0,
                        max: 1,
                        description: 'Probability a given trial is an N-back match (applies only once i >= n)'
                    },
                    show_feedback: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        description: 'Show brief Correct/Incorrect feedback after responses'
                    },
                    feedback_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 300,
                        min: 0,
                        max: 10000,
                        description: 'Feedback duration (ms)'
                    }
                }
            },

            'nback-block': {
                name: 'nback-block',
                description: 'N-back item (single trial/frame). Usually generated by nback-trial-sequence.',
                parameters: {
                    n: {
                        type: this.parameterTypes.INT,
                        default: 2,
                        min: 1,
                        max: 9,
                        description: 'N-back level (used for scoring when a sequence context is present)'
                    },
                    token: {
                        type: this.parameterTypes.STRING,
                        default: 'A',
                        description: 'Stimulus token to show (e.g., A, 7, ●)'
                    },
                    render_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'token',
                        options: ['token', 'custom_html'],
                        description: 'Render stimulus as token label or via stimulus_template_html'
                    },
                    stimulus_template_html: {
                        type: this.parameterTypes.HTML_STRING,
                        default: '<div style="font-size:72px; font-weight:700; text-align:center;">{{TOKEN}}</div>',
                        description: 'Used when render_mode=custom_html ({{TOKEN}} is replaced with the token)'
                    },

                    stimulus_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 500,
                        min: 0,
                        max: 60000,
                        description: 'Stimulus display duration (ms)'
                    },
                    isi_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 500,
                        min: 0,
                        max: 60000,
                        description: 'Inter-stimulus interval (ms)'
                    },
                    trial_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 1000,
                        min: 0,
                        max: 60000,
                        description: 'Total trial duration (ms). 0 = no timeout.'
                    },

                    show_fixation_cross_between_trials: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        description: 'Show a fixation cross (+) when the token is hidden (during ISI/ITI between items)'
                    },

                    response_paradigm: {
                        type: this.parameterTypes.SELECT,
                        default: 'go_nogo',
                        options: ['go_nogo', '2afc'],
                        description: 'Go/No-Go (single key) vs 2AFC (match vs non-match keys)'
                    },
                    response_device: {
                        type: this.parameterTypes.SELECT,
                        default: 'inherit',
                        options: ['inherit', 'keyboard', 'mouse'],
                        description: 'Primary response device'
                    },
                    go_key: {
                        type: this.parameterTypes.KEY,
                        default: 'space',
                        description: 'Go key (and accepted as Match key when response_paradigm=2afc and match_key is blank)'
                    },
                    match_key: {
                        type: this.parameterTypes.KEY,
                        default: 'j',
                        description: '2AFC: key for MATCH'
                    },
                    nonmatch_key: {
                        type: this.parameterTypes.KEY,
                        default: 'f',
                        description: '2AFC: key for NO MATCH'
                    },
                    show_buttons: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        description: 'Mouse mode: show clickable response buttons'
                    },
                    show_feedback: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        description: 'Show brief Correct/Incorrect feedback after responses'
                    },
                    feedback_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 300,
                        min: 0,
                        max: 10000,
                        description: 'Feedback duration (ms)'
                    }
                }
            },

            'pvt-trial': {
                name: 'pvt-trial',
                description: 'Psychomotor Vigilance Task trial (foreperiod, running 4-digit timer, keyboard/click response; logic implemented by interpreter)',
                parameters: {
                    response_device: {
                        type: this.parameterTypes.SELECT,
                        default: 'inherit',
                        options: ['inherit', 'keyboard', 'mouse', 'both'],
                        description: 'Override experiment-wide response_device (inherit uses pvt_settings.response_device)'
                    },
                    response_key: {
                        type: this.parameterTypes.KEY,
                        default: 'space',
                        description: 'Keyboard key used to respond (ignored if response_device=mouse)'
                    },
                    foreperiod_ms: {
                        type: this.parameterTypes.INT,
                        default: 4000,
                        min: 0,
                        max: 60000,
                        description: 'Delay before the timer starts (ms)'
                    },
                    trial_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 10000,
                        min: 0,
                        max: 60000,
                        description: 'Timeout after timer starts (ms). 0 = no timeout.'
                    },
                    iti_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        min: 0,
                        max: 30000,
                        description: 'Inter-trial interval after response/timeout (ms)'
                    }
                }
            },

            'task-switching-trial': {
                name: 'task-switching-trial',
                description: 'Task Switching trial (combined stimulus for two tasks; cueing can be explicit/position/color; scoring implemented by interpreter)',
                parameters: {
                    task_index: {
                        type: this.parameterTypes.INT,
                        default: 1,
                        min: 1,
                        max: 2,
                        description: 'Which task is currently active (1 or 2)'
                    },
                    stimulus: {
                        type: this.parameterTypes.STRING,
                        default: 'A 1',
                        description: 'Combined stimulus string (e.g., "A 2"). The interpreter also supports stimulus_task_1/stimulus_task_2 fields.'
                    },
                    stimulus_task_1: {
                        type: this.parameterTypes.STRING,
                        default: 'A',
                        description: 'Task 1 token (letters task by default)'
                    },
                    stimulus_task_2: {
                        type: this.parameterTypes.STRING,
                        default: '1',
                        description: 'Task 2 token (numbers task by default)'
                    },

                    trial_type: {
                        type: this.parameterTypes.SELECT,
                        default: 'switch',
                        options: ['single', 'switch'],
                        description: 'Single-task vs task-switching sequence (used by block generation; explicit trials can ignore)'
                    },
                    single_task_index: {
                        type: this.parameterTypes.INT,
                        default: 1,
                        min: 1,
                        max: 2,
                        description: 'When trial_type=single, which task index is used (1 or 2)'
                    },

                    cue_type: {
                        type: this.parameterTypes.SELECT,
                        default: 'explicit',
                        options: ['explicit', 'position', 'color'],
                        description: 'Cueing mode: explicit text, position mapping, or color mapping'
                    },
                    cue_text: {
                        type: this.parameterTypes.STRING,
                        default: '',
                        description: 'Optional explicit cue override text (if blank, uses task_1_cue_text/task_2_cue_text)'
                    },
                    cue_font_size_px: {
                        type: this.parameterTypes.INT,
                        default: 28,
                        min: 8,
                        max: 200,
                        description: 'Explicit cue font size (px)'
                    },
                    cue_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        min: 0,
                        max: 10000,
                        description: 'Explicit cue duration in ms (0 = stays visible)'
                    },
                    cue_gap_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        min: 0,
                        max: 10000,
                        description: 'Optional delay between cue and stimulus (ms; if supported by the runtime)'
                    },
                    cue_color_hex: {
                        type: this.parameterTypes.COLOR,
                        default: '#FFFFFF',
                        description: 'Explicit cue color (hex)'
                    },

                    task_1_cue_text: {
                        type: this.parameterTypes.STRING,
                        default: 'LETTERS',
                        description: 'Default explicit cue label for Task 1'
                    },
                    task_2_cue_text: {
                        type: this.parameterTypes.STRING,
                        default: 'NUMBERS',
                        description: 'Default explicit cue label for Task 2'
                    },

                    task_1_position: {
                        type: this.parameterTypes.SELECT,
                        default: 'left',
                        options: ['left', 'right', 'top', 'bottom'],
                        description: 'Position cue: stimulus position when Task 1 is active'
                    },
                    task_2_position: {
                        type: this.parameterTypes.SELECT,
                        default: 'right',
                        options: ['left', 'right', 'top', 'bottom'],
                        description: 'Position cue: stimulus position when Task 2 is active'
                    },

                    task_1_color_hex: {
                        type: this.parameterTypes.COLOR,
                        default: '#FFFFFF',
                        description: 'Color cue: stimulus color when Task 1 is active (hex)'
                    },
                    task_2_color_hex: {
                        type: this.parameterTypes.COLOR,
                        default: '#FFFFFF',
                        description: 'Color cue: stimulus color when Task 2 is active (hex)'
                    },
                    stimulus_color_hex: {
                        type: this.parameterTypes.COLOR,
                        default: '#FFFFFF',
                        description: 'Stimulus color when cue_type is not color (hex)'
                    },

                    stimulus_position: {
                        type: this.parameterTypes.SELECT,
                        default: 'top',
                        options: ['left', 'right', 'top', 'bottom'],
                        description: 'Stimulus position when cue_type is not position'
                    },
                    border_enabled: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        description: 'Whether to draw a border around the stimulus'
                    },

                    left_key: {
                        type: this.parameterTypes.KEY,
                        default: 'f',
                        description: 'Left/category A response key'
                    },
                    right_key: {
                        type: this.parameterTypes.KEY,
                        default: 'j',
                        description: 'Right/category B response key'
                    },

                    stimulus_set_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'letters_numbers',
                        options: ['letters_numbers', 'custom'],
                        description: 'Built-in scoring vs custom token sets'
                    },
                    tasks: {
                        type: this.parameterTypes.COMPLEX,
                        default: [],
                        description: 'Custom mode: tasks[0] and tasks[1] each define category_a_tokens/category_b_tokens arrays'
                    },

                    stimulus_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        min: 0,
                        max: 60000,
                        description: 'Stimulus display duration (ms). 0 = show until response or trial duration'
                    },
                    trial_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 2000,
                        min: 0,
                        max: 60000,
                        description: 'Total trial duration (ms). 0 = no timeout.'
                    },
                    iti_ms: {
                        type: this.parameterTypes.INT,
                        default: 500,
                        min: 0,
                        max: 30000,
                        description: 'Inter-trial interval (ms)'
                    }
                }
            },

            'stroop-trial': {
                name: 'stroop-trial',
                description: 'Stroop trial (word shown in ink color; response/scoring implemented by interpreter)',
                parameters: {
                    word: {
                        type: this.parameterTypes.STRING,
                        default: 'RED',
                        description: 'The word to display (usually a color name)'
                    },
                    ink_color_name: {
                        type: this.parameterTypes.STRING,
                        default: 'BLUE',
                        description: 'Name of the ink color (looked up in stroop_settings.stimuli by name)'
                    },
                    congruency: {
                        type: this.parameterTypes.SELECT,
                        default: 'auto',
                        options: ['auto', 'congruent', 'incongruent'],
                        description: 'Optional tag used by block generation / logging; auto = derived from word vs ink'
                    },
                    response_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'inherit',
                        options: ['inherit', 'color_naming', 'congruency'],
                        description: 'Override experiment-wide response_mode (inherit uses stroop_settings.response_mode)'
                    },
                    response_device: {
                        type: this.parameterTypes.SELECT,
                        default: 'inherit',
                        options: ['inherit', 'keyboard', 'mouse'],
                        description: 'Override experiment-wide response_device (inherit uses stroop_settings.response_device)'
                    },
                    choice_keys: {
                        type: this.parameterTypes.KEYS,
                        default: ['1', '2', '3', '4'],
                        description: 'Keyboard keys mapped to stroop_settings.stimuli order (color_naming mode)'
                    },
                    congruent_key: {
                        type: this.parameterTypes.KEY,
                        default: 'f',
                        description: 'Key for congruent (congruency mode)'
                    },
                    incongruent_key: {
                        type: this.parameterTypes.KEY,
                        default: 'j',
                        description: 'Key for incongruent (congruency mode)'
                    },
                    stimulus_font_size_px: {
                        type: this.parameterTypes.INT,
                        default: 72,
                        min: 12,
                        max: 200,
                        description: 'Font size of the stimulus word in pixels'
                    },
                    stimulus_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 1500,
                        description: 'Stimulus display duration (ms)'
                    },
                    trial_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 2000,
                        description: 'Total trial duration (ms)'
                    },
                    iti_ms: {
                        type: this.parameterTypes.INT,
                        default: 500,
                        description: 'Inter-trial interval (ms)'
                    }
                }
            },

            'gabor-trial': {
                name: 'gabor-trial',
                description: 'Gabor patch trial/frame (stimulus + scoring implemented by interpreter)',
                parameters: {
                    response_task: {
                        type: this.parameterTypes.SELECT,
                        default: 'discriminate_tilt',
                        options: ['detect_target', 'discriminate_tilt'],
                        description: 'Whether participant detects the target (yes/no) or discriminates its tilt (left/right)'
                    },
                    left_key: {
                        type: this.parameterTypes.STRING,
                        default: 'f',
                        description: 'Left response key (for discriminate_tilt)'
                    },
                    right_key: {
                        type: this.parameterTypes.STRING,
                        default: 'j',
                        description: 'Right response key (for discriminate_tilt)'
                    },
                    yes_key: {
                        type: this.parameterTypes.STRING,
                        default: 'f',
                        description: 'Yes key (for detect_target)'
                    },
                    no_key: {
                        type: this.parameterTypes.STRING,
                        default: 'j',
                        description: 'No key (for detect_target)'
                    },
                    target_location: {
                        type: this.parameterTypes.SELECT,
                        default: 'left',
                        options: ['left', 'right'],
                        description: 'Which location contains the target'
                    },
                    target_tilt_deg: {
                        type: this.parameterTypes.FLOAT,
                        default: 45,
                        description: 'Target orientation tilt (degrees)'
                    },
                    distractor_orientation_deg: {
                        type: this.parameterTypes.FLOAT,
                        default: 0,
                        description: 'Distractor orientation (degrees)'
                    },
                    spatial_frequency_cyc_per_px: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.06,
                        description: 'Spatial frequency (cycles per pixel) of the grating carrier'
                    },
                    grating_waveform: {
                        type: this.parameterTypes.SELECT,
                        default: 'sinusoidal',
                        options: ['sinusoidal', 'square', 'triangle'],
                        description: 'Waveform of the grating carrier'
                    },
                    patch_diameter_deg: {
                        type: this.parameterTypes.FLOAT,
                        default: 6,
                        description: 'Patch diameter in degrees of visual angle (requires Visual Angle Calibration for true deg-based sizing)'
                    },
                    spatial_cue: {
                        type: this.parameterTypes.SELECT,
                        default: 'none',
                        options: ['none', 'left', 'right', 'both'],
                        description: 'Spatial cue direction'
                    },
                    left_value: {
                        type: this.parameterTypes.SELECT,
                        default: 'neutral',
                        options: ['neutral', 'high', 'low'],
                        description: 'Value cue for left location (frame color mapping via gabor_settings)'
                    },
                    right_value: {
                        type: this.parameterTypes.SELECT,
                        default: 'neutral',
                        options: ['neutral', 'high', 'low'],
                        description: 'Value cue for right location (frame color mapping via gabor_settings)'
                    },
                    stimulus_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 67,
                        description: 'Stimulus display duration (ms)'
                    },
                    mask_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 67,
                        description: 'Mask duration after stimulus (ms)'
                    },
                    patch_border_enabled: {
                        type: this.parameterTypes.BOOL,
                        default: true,
                        description: 'Whether to draw a circular border around each patch (stimulus + mask)'
                    },
                    patch_border_width_px: {
                        type: this.parameterTypes.INT,
                        default: 2,
                        description: 'Patch border stroke width (px)'
                    },
                    patch_border_color: {
                        type: this.parameterTypes.COLOR,
                        default: '#FFFFFF',
                        description: 'Patch border color (hex)'
                    },
                    patch_border_opacity: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.22,
                        description: 'Patch border opacity (0–1)'
                    },
                    contrast: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.95,
                        description: 'Gabor patch contrast (0–1)'
                    }
                }
            },

            'visual-angle-calibration': {
                name: 'visual-angle-calibration',
                description: 'Visual angle calibration (ID/credit card screen scale + viewing distance) used to compute px/deg',
                parameters: {
                    title: {
                        type: this.parameterTypes.STRING,
                        default: 'Visual Angle Calibration',
                        description: 'Heading shown to participants'
                    },
                    instructions: {
                        type: this.parameterTypes.HTML_STRING,
                        default: '',
                        description: 'Optional instructions text (HTML allowed)'
                    },
                    object_preset: {
                        type: this.parameterTypes.SELECT,
                        default: 'id_card_long',
                        options: ['id_card_long', 'id_card_short', 'custom'],
                        description: 'Calibration object preset'
                    },
                    object_length_cm: {
                        type: this.parameterTypes.FLOAT,
                        default: 8.56,
                        description: 'Object length in cm (used when preset is custom; also shown/adjustable during calibration)'
                    },
                    distance_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'posture_choice',
                        options: ['posture_choice', 'manual'],
                        description: 'How viewing distance is collected'
                    },
                    close_label: {
                        type: this.parameterTypes.STRING,
                        default: 'Close',
                        description: 'Label for close posture option'
                    },
                    close_distance_cm: {
                        type: this.parameterTypes.FLOAT,
                        default: 35,
                        description: 'Viewing distance (cm) for close posture option'
                    },
                    normal_label: {
                        type: this.parameterTypes.STRING,
                        default: 'Normal',
                        description: 'Label for normal posture option'
                    },
                    normal_distance_cm: {
                        type: this.parameterTypes.FLOAT,
                        default: 50,
                        description: 'Viewing distance (cm) for normal posture option'
                    },
                    far_label: {
                        type: this.parameterTypes.STRING,
                        default: 'Far',
                        description: 'Label for far posture option'
                    },
                    far_distance_cm: {
                        type: this.parameterTypes.FLOAT,
                        default: 65,
                        description: 'Viewing distance (cm) for far posture option'
                    },
                    manual_distance_default_cm: {
                        type: this.parameterTypes.FLOAT,
                        default: 50,
                        description: 'Default viewing distance (cm) shown in manual entry mode'
                    },
                    webcam_enabled: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        description: 'Enable optional webcam preview (does not estimate distance)'
                    },
                    webcam_facing_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'user',
                        options: ['user', 'environment'],
                        description: 'Preferred camera (front/user vs back/environment)'
                    },
                    store_key: {
                        type: this.parameterTypes.STRING,
                        default: '__psy_visual_angle',
                        description: 'Global key used to store calibration results (window[store_key])'
                    }
                }
            },

            'reward-settings': {
                name: 'reward-settings',
                description: 'Reward policy configuration + optional participant-facing instructions and end-of-experiment summary',
                parameters: {
                    store_key: {
                        type: this.parameterTypes.STRING,
                        default: '__psy_rewards',
                        description: 'Global key used to store reward policy and state (window[store_key])'
                    },
                    currency_label: {
                        type: this.parameterTypes.STRING,
                        default: 'points',
                        description: 'Label for the reward currency (e.g., points, tokens, cents)'
                    },
                    scoring_basis: {
                        type: this.parameterTypes.SELECT,
                        default: 'both',
                        options: ['accuracy', 'reaction_time', 'both'],
                        description: 'What constitutes a rewarded trial'
                    },
                    rt_threshold_ms: {
                        type: this.parameterTypes.INT,
                        default: 600,
                        description: 'Reaction time cutoff (ms) for reaction-time or both modes'
                    },
                    points_per_success: {
                        type: this.parameterTypes.FLOAT,
                        default: 1,
                        description: 'Points awarded for each rewarded trial'
                    },
                    require_correct_for_rt: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        description: 'If true, RT-based rewards require correctness when correctness is available'
                    },
                    calculate_on_the_fly: {
                        type: this.parameterTypes.BOOL,
                        default: true,
                        description: 'If true, reward points are computed as trials finish; if false, they are computed at summary time using recorded outcomes'
                    },
                    show_summary_at_end: {
                        type: this.parameterTypes.BOOL,
                        default: true,
                        description: 'If true, interpreter shows a reward summary screen at the end'
                    },
                    continue_key: {
                        type: this.parameterTypes.SELECT,
                        default: 'space',
                        options: ['space', 'enter', 'ALL_KEYS'],
                        description: 'Key(s) used to continue past instructions/summary'
                    },
                    instructions_title: {
                        type: this.parameterTypes.STRING,
                        default: 'Rewards',
                        description: 'Title shown on the reward instructions screen'
                    },
                    instructions_template_html: {
                        type: this.parameterTypes.HTML_STRING,
                        default: '<p>You can earn <b>{{currency_label}}</b> during this study.</p>\n<ul>\n<li><b>Basis</b>: {{scoring_basis_label}}</li>\n<li><b>RT threshold</b>: {{rt_threshold_ms}} ms</li>\n<li><b>Points per success</b>: {{points_per_success}}</li>\n</ul>\n<p>Press {{continue_key_label}} to begin.</p>',
                        description: 'Participant instructions (HTML allowed). Variables: {{currency_label}}, {{scoring_basis_label}}, {{rt_threshold_ms}}, {{points_per_success}}, {{continue_key_label}}'
                    },
                    summary_title: {
                        type: this.parameterTypes.STRING,
                        default: 'Rewards Summary',
                        description: 'Title shown on the end-of-experiment summary screen'
                    },
                    summary_template_html: {
                        type: this.parameterTypes.HTML_STRING,
                        default: '<p><b>Total earned</b>: {{total_points}} {{currency_label}}</p>\n<p><b>Rewarded trials</b>: {{rewarded_trials}} / {{eligible_trials}}</p>\n<p>Press {{continue_key_label}} to finish.</p>',
                        description: 'Summary HTML. Variables also include: {{total_points}}, {{rewarded_trials}}, {{eligible_trials}}'
                    }
                }
            },

            'mot-trial': {
                name: 'mot-trial',
                description: 'Multiple Object Tracking (MOT) trial — animate objects on canvas, cue targets by flashing, then probe',
                parameters: {
                    // Objects
                    num_objects: {
                        type: this.parameterTypes.INT,
                        default: 8,
                        min: 2,
                        max: 20,
                        description: 'Total number of objects on screen'
                    },
                    num_targets: {
                        type: this.parameterTypes.INT,
                        default: 4,
                        min: 1,
                        max: 10,
                        description: 'Number of target objects to track'
                    },
                    object_radius_px: {
                        type: this.parameterTypes.INT,
                        default: 22,
                        min: 5,
                        max: 80,
                        description: 'Radius of each object in pixels'
                    },
                    object_color: {
                        type: this.parameterTypes.COLOR,
                        default: '#FFFFFF',
                        description: 'Fill color for all objects (outside cue phase)'
                    },
                    target_cue_color: {
                        type: this.parameterTypes.COLOR,
                        default: '#FF9900',
                        description: 'Alternate flash color used to cue targets during the cue phase'
                    },
                    background_color: {
                        type: this.parameterTypes.COLOR,
                        default: '#111111',
                        description: 'Canvas background color'
                    },
                    // Arena
                    arena_width_px: {
                        type: this.parameterTypes.INT,
                        default: 700,
                        min: 200,
                        max: 1400,
                        description: 'Width of the arena canvas in pixels'
                    },
                    arena_height_px: {
                        type: this.parameterTypes.INT,
                        default: 500,
                        min: 150,
                        max: 1000,
                        description: 'Height of the arena canvas in pixels'
                    },
                    boundary_behavior: {
                        type: this.parameterTypes.SELECT,
                        default: 'bounce',
                        options: ['bounce', 'wrap'],
                        description: 'How objects behave at arena boundaries'
                    },
                    min_separation_px: {
                        type: this.parameterTypes.INT,
                        default: 50,
                        min: 0,
                        max: 200,
                        description: 'Minimum center-to-center distance when placing objects initially'
                    },
                    // Motion
                    speed_px_per_s: {
                        type: this.parameterTypes.FLOAT,
                        default: 150,
                        min: 20,
                        max: 600,
                        description: 'Object speed in pixels per second'
                    },
                    speed_variability: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.0,
                        min: 0,
                        max: 1,
                        description: 'Per-object speed jitter (0 = all same speed, 1 = ±100% of base speed)'
                    },
                    motion_type: {
                        type: this.parameterTypes.SELECT,
                        default: 'linear',
                        options: ['linear', 'curved'],
                        description: 'Trajectory type: linear (straight paths) or curved (smooth random turns)'
                    },
                    curve_strength: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.3,
                        min: 0,
                        max: 1,
                        description: 'Turning rate for curved motion (ignored when motion_type is linear)'
                    },
                    // Timing
                    cue_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 2000,
                        min: 500,
                        max: 5000,
                        description: 'Duration of the cue phase (ms) during which targets flash'
                    },
                    cue_flash_rate_hz: {
                        type: this.parameterTypes.FLOAT,
                        default: 3,
                        min: 0.5,
                        max: 10,
                        description: 'Flash frequency (Hz) for target cue color alternation'
                    },
                    tracking_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 8000,
                        min: 1000,
                        max: 30000,
                        description: 'Duration of the tracking phase (ms) where all objects move unlabeled'
                    },
                    iti_ms: {
                        type: this.parameterTypes.INT,
                        default: 1000,
                        min: 0,
                        max: 10000,
                        description: 'Inter-trial interval (ms) shown as blank canvas after the response'
                    },
                    // Probe / Response
                    probe_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'click',
                        options: ['click', 'number_entry'],
                        description: 'Probe interaction: click objects to select targets, or type numbered labels shown inside objects'
                    },
                    probe_timeout_ms: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        min: 0,
                        max: 30000,
                        description: 'Probe phase time limit in ms (0 = no time limit)'
                    },
                    show_feedback: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        description: 'Show correct/incorrect feedback after probe response'
                    },
                    feedback_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 1500,
                        min: 0,
                        max: 10000,
                        description: 'Duration of feedback display in ms (ignored when show_feedback is false)'
                    }
                }
            },

            'block': {
                name: 'block',
                description: 'Generate many trials from parameter windows/ranges (compact representation for large experiments)',
                parameters: {
                    block_component_type: {
                        type: this.parameterTypes.SELECT,
                        default: 'rdm-trial',
                        options: ['rdm-trial', 'rdm-practice', 'rdm-adaptive', 'rdm-dot-groups', 'flanker-trial', 'sart-trial', 'simon-trial', 'pvt-trial', 'task-switching-trial', 'stroop-trial', 'emotional-stroop-trial', 'gabor-trial', 'gabor-quest', 'gabor-learning', 'nback-block', 'mot-trial', 'html-button-response', 'html-keyboard-response', 'image-keyboard-response', 'continuous-image-presentation'],
                        required: true,
                        description: 'What component type this block generates'
                    },
                    block_length: {
                        type: this.parameterTypes.INT,
                        default: 100,
                        required: true,
                        description: 'Number of trials/frames this block represents'
                    },
                    sampling_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'per-trial',
                        options: ['per-trial', 'per-block'],
                        description: 'per-trial samples new parameters each trial; per-block samples once and reuses'
                    },
                    seed: {
                        type: this.parameterTypes.STRING,
                        default: '',
                        description: 'Optional random seed (blank = no seed)'
                    },

                    // Generic jsPsych trials inside Blocks (minimal set)
                    stimulus_html: {
                        type: this.parameterTypes.HTML_STRING,
                        default: '<p>Replace this with your HTML.</p>',
                        blockTarget: 'html-keyboard-response,html-button-response',
                        description: 'HTML stimulus content for generated trials'
                    },
                    prompt: {
                        type: this.parameterTypes.HTML_STRING,
                        default: '',
                        blockTarget: 'html-keyboard-response,html-button-response,image-keyboard-response',
                        description: 'Optional prompt shown below the stimulus (HTML allowed)'
                    },
                    choices: {
                        type: this.parameterTypes.STRING,
                        default: 'ALL_KEYS',
                        blockTarget: 'html-keyboard-response,image-keyboard-response',
                        description: 'Keyboard choices: ALL_KEYS, NO_KEYS, or a comma/space-separated list (e.g., "f j")'
                    },
                    button_choices: {
                        type: this.parameterTypes.STRING,
                        default: 'Continue',
                        blockTarget: 'html-button-response',
                        description: 'Button labels (comma/newline separated)'
                    },
                    button_html: {
                        type: this.parameterTypes.HTML_STRING,
                        default: '',
                        blockTarget: 'html-button-response',
                        description: 'Optional custom button HTML template (advanced)'
                    },
                    stimulus_image: {
                        type: this.parameterTypes.IMAGE,
                        default: '',
                        blockTarget: 'image-keyboard-response',
                        description: 'Single image URL or filename (e.g., "img1.png" after uploading assets). If you provide stimulus_images, it takes precedence.'
                    },
                    stimulus_images: {
                        type: this.parameterTypes.HTML_STRING,
                        default: '',
                        blockTarget: 'image-keyboard-response',
                        description: 'List of images (comma or newline separated). Use this to sample different images across trials in the Block (works with uploaded assets filenames).'
                    },

                    // Continuous Image Presentation (CIP) per-block settings.
                    // NOTE: the Interpreter consumes these from block.parameter_values after export.
                    cip_asset_code: {
                        type: this.parameterTypes.STRING,
                        default: '',
                        blockTarget: 'continuous-image-presentation',
                        description: 'CIP: asset bundle code used by the Builder asset generator'
                    },
                    cip_mask_type: {
                        type: this.parameterTypes.SELECT,
                        default: 'noise_and_shuffle',
                        options: ['pure_noise', 'noise_and_shuffle', 'advanced_transform'],
                        blockTarget: 'continuous-image-presentation',
                        description: 'CIP: mask generation mode'
                    },
                    cip_mask_noise_amp: {
                        type: this.parameterTypes.INT,
                        default: 24,
                        min: 0,
                        max: 128,
                        blockTarget: 'continuous-image-presentation',
                        description: 'CIP: noise amplitude applied to the mask'
                    },
                    cip_mask_block_size: {
                        type: this.parameterTypes.INT,
                        default: 12,
                        min: 1,
                        max: 128,
                        blockTarget: 'continuous-image-presentation',
                        description: 'CIP: block size used by mask transforms'
                    },
                    cip_repeat_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'no_repeats',
                        options: ['no_repeats', 'repeat_to_fill'],
                        blockTarget: 'continuous-image-presentation',
                        description: 'CIP: whether to repeat images to fill the block'
                    },
                    cip_images_per_block: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        min: 0,
                        max: 50000,
                        blockTarget: 'continuous-image-presentation',
                        description: 'CIP: how many images the block expands into (0 = default)'
                    },
                    cip_image_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 750,
                        min: 0,
                        max: 60000,
                        blockTarget: 'continuous-image-presentation',
                        description: 'CIP: image presentation duration (ms)'
                    },
                    cip_transition_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 250,
                        min: 0,
                        max: 60000,
                        blockTarget: 'continuous-image-presentation',
                        description: 'CIP: mask transition duration (ms)'
                    },
                    cip_transition_frames: {
                        type: this.parameterTypes.INT,
                        default: 8,
                        min: 2,
                        max: 60,
                        blockTarget: 'continuous-image-presentation',
                        description: 'CIP: number of frames used for sprite-sheet mask transitions'
                    },
                    cip_choice_keys: {
                        type: this.parameterTypes.STRING,
                        default: 'f,j',
                        blockTarget: 'continuous-image-presentation',
                        description: 'CIP: comma-separated response keys'
                    },
                    cip_asset_filenames: {
                        type: this.parameterTypes.STRING,
                        default: '',
                        blockTarget: 'continuous-image-presentation',
                        description: 'CIP: source image filenames (comma/newline separated)'
                    },
                    cip_image_urls: {
                        type: this.parameterTypes.STRING,
                        default: '',
                        blockTarget: 'continuous-image-presentation',
                        description: 'CIP: resolved image URLs (comma/newline separated)'
                    },
                    cip_mask_to_image_sprite_urls: {
                        type: this.parameterTypes.STRING,
                        default: '',
                        blockTarget: 'continuous-image-presentation',
                        description: 'CIP: resolved sprite URLs for mask→image transitions (comma/newline separated)'
                    },
                    cip_image_to_mask_sprite_urls: {
                        type: this.parameterTypes.STRING,
                        default: '',
                        blockTarget: 'continuous-image-presentation',
                        description: 'CIP: resolved sprite URLs for image→mask transitions (comma/newline separated)'
                    },

                    // N-back generator parameters (Block → nback-block)
                    nback_n: {
                        type: this.parameterTypes.INT,
                        default: 2,
                        min: 1,
                        max: 6,
                        blockTarget: 'nback-block',
                        description: 'N-back depth'
                    },
                    nback_target_probability: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.25,
                        min: 0,
                        max: 1,
                        blockTarget: 'nback-block',
                        description: 'Probability an item is forced to match the item N-back'
                    },
                    nback_stimulus_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'letters',
                        options: ['letters', 'numbers', 'shapes', 'custom'],
                        blockTarget: 'nback-block',
                        description: 'Token set to use (custom uses the custom pool string)'
                    },
                    nback_stimulus_pool: {
                        type: this.parameterTypes.STRING,
                        default: '',
                        blockTarget: 'nback-block',
                        description: 'Custom pool tokens (comma/newline separated); used when stimulus_mode=custom'
                    },
                    nback_render_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'token',
                        options: ['token', 'custom_html'],
                        blockTarget: 'nback-block',
                        description: 'Whether to render raw token text or use a custom HTML template'
                    },
                    nback_stimulus_template_html: {
                        type: this.parameterTypes.HTML_STRING,
                        default: '<div style="font-size:72px; font-weight:700; letter-spacing:0.02em;">{{TOKEN}}</div>',
                        blockTarget: 'nback-block',
                        description: 'HTML template used when render_mode=custom_html. Variable: {{TOKEN}}'
                    },
                    nback_stimulus_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 500,
                        min: 0,
                        max: 60000,
                        blockTarget: 'nback-block',
                        description: 'Stimulus display duration (ms)'
                    },
                    nback_isi_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 700,
                        min: 0,
                        max: 60000,
                        blockTarget: 'nback-block',
                        description: 'Inter-stimulus interval duration (ms)'
                    },
                    nback_trial_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 1200,
                        min: 0,
                        max: 60000,
                        blockTarget: 'nback-block',
                        description: 'Total item/trial duration (ms)'
                    },
                    nback_show_fixation_cross_between_trials: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        blockTarget: 'nback-block',
                        description: 'Show a fixation cross (+) when the token is hidden (during ISI/ITI between items)'
                    },
                    nback_response_paradigm: {
                        type: this.parameterTypes.SELECT,
                        default: 'go_nogo',
                        options: ['go_nogo', '2afc'],
                        blockTarget: 'nback-block',
                        description: 'go_nogo: respond on matches; 2afc: match vs non-match keys'
                    },
                    nback_response_device: {
                        type: this.parameterTypes.SELECT,
                        default: 'inherit',
                        options: ['inherit', 'keyboard', 'mouse'],
                        blockTarget: 'nback-block',
                        description: 'Response device used by generated N-back items'
                    },
                    nback_go_key: {
                        type: this.parameterTypes.STRING,
                        default: 'space',
                        blockTarget: 'nback-block',
                        description: 'Go key for matches (go/no-go)'
                    },
                    nback_match_key: {
                        type: this.parameterTypes.STRING,
                        default: 'j',
                        blockTarget: 'nback-block',
                        description: 'Match key (2AFC)'
                    },
                    nback_nonmatch_key: {
                        type: this.parameterTypes.STRING,
                        default: 'f',
                        blockTarget: 'nback-block',
                        description: 'Non-match key (2AFC)'
                    },
                    nback_show_buttons: {
                        type: this.parameterTypes.BOOL,
                        default: true,
                        blockTarget: 'nback-block',
                        description: 'Show clickable buttons when using mouse'
                    },
                    nback_show_feedback: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        blockTarget: 'nback-block',
                        description: 'Show correctness feedback after response/timeout'
                    },
                    nback_feedback_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 250,
                        min: 0,
                        max: 5000,
                        blockTarget: 'nback-block',
                        description: 'Feedback duration (ms)'
                    },

                    // Dot color (used for rdm-trial / rdm-practice / rdm-adaptive; dot-groups uses per-group colors)
                    dot_color: {
                        type: this.parameterTypes.COLOR,
                        default: '#FFFFFF',
                        blockTarget: 'rdm-*',
                        description: 'Dot color (hex). For dot-groups blocks, set Group 1/2 colors below.'
                    },

                    transition_duration: {
                        type: this.parameterTypes.INT,
                        default: 500,
                        blockTarget: 'rdm-*',
                        description: 'Continuous mode only: duration of the transition to the next condition (ms)'
                    },
                    transition_type: {
                        type: this.parameterTypes.SELECT,
                        default: 'both',
                        options: ['both', 'color', 'speed'],
                        blockTarget: 'rdm-*',
                        description: 'Continuous mode only: transition type (color = gradient, speed = slow/fast, both = combine)'
                    },

                    // Aperture outline overrides (per-block)
                    show_aperture_outline_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'inherit',
                        options: ['inherit', 'true', 'false'],
                        blockTarget: 'rdm-*',
                        description: 'Aperture outline override for generated RDM trials (inherit uses experiment-wide aperture_parameters)'
                    },
                    aperture_outline_width: {
                        type: this.parameterTypes.FLOAT,
                        default: 2,
                        blockTarget: 'rdm-*',
                        description: 'Outline width (px) when overriding outline visibility'
                    },
                    aperture_outline_color: {
                        type: this.parameterTypes.COLOR,
                        default: '#FFFFFF',
                        blockTarget: 'rdm-*',
                        description: 'Outline color when overriding outline visibility'
                    },

                    // Response override (per-block)
                    // Uses the same parameter names as per-component overrides so TimelineBuilder conditional UI works.
                    response_device: {
                        type: this.parameterTypes.SELECT,
                        default: 'inherit',
                        options: ['inherit', 'keyboard', 'mouse', 'touch', 'voice', 'custom'],
                        blockTarget: 'rdm-*',
                        description: 'Override response device for this block (inherit uses experiment defaults)'
                    },
                    response_keys: {
                        type: this.parameterTypes.STRING,
                        default: '',
                        blockTarget: 'rdm-*',
                        description: 'Comma-separated keys for keyboard responses (blank = inherit)'
                    },
                    require_response_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'inherit',
                        options: ['inherit', 'true', 'false'],
                        blockTarget: 'rdm-*',
                        description: 'Override require_response for this block'
                    },
                    end_condition_on_response_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'inherit',
                        options: ['inherit', 'true', 'false'],
                        blockTarget: 'rdm-*',
                        description: 'Continuous mode only: end the current condition immediately after a response'
                    },
                    feedback_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'inherit',
                        options: ['inherit', 'off', 'corner-text', 'arrow', 'custom'],
                        blockTarget: 'rdm-*',
                        description: 'Override response feedback for this block (inherit uses experiment defaults)'
                    },
                    feedback_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 500,
                        blockTarget: 'rdm-*',
                        description: 'Feedback duration (ms) when feedback_mode is enabled (corner-text/arrow/custom)'
                    },
                    mouse_segments: {
                        type: this.parameterTypes.INT,
                        default: 2,
                        blockTarget: 'rdm-*',
                        description: 'Mouse response: number of aperture segments (used when response_device = mouse)'
                    },
                    mouse_start_angle_deg: {
                        type: this.parameterTypes.FLOAT,
                        default: 0,
                        blockTarget: 'rdm-*',
                        description: 'Mouse response: segment start angle offset in degrees (0=right; 90=down; 180=left; 270=up). Angles increase clockwise (screen/canvas coordinates).'
                    },
                    mouse_selection_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'click',
                        options: ['click', 'hover'],
                        blockTarget: 'rdm-*',
                        description: 'Mouse response: how a segment selection is registered'
                    },

                    // rdm-trial windows
                    coherence_min: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.2,
                        blockTarget: 'rdm-trial',
                        description: 'RDM Trial: coherence range min (0-1)'
                    },
                    coherence_max: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.8,
                        blockTarget: 'rdm-trial',
                        description: 'RDM Trial: coherence range max (0-1)'
                    },
                    direction_options: {
                        type: this.parameterTypes.STRING,
                        default: '0,180',
                        blockTarget: 'rdm-trial',
                        description: 'RDM Trial: comma-separated directions (degrees; 0=right, 90=down, 180=left, 270=up) to sample from. Allowed range: 0 to 359.'
                    },
                    speed_min: {
                        type: this.parameterTypes.FLOAT,
                        default: 4,
                        blockTarget: 'rdm-trial',
                        description: 'RDM Trial: speed range min'
                    },
                    speed_max: {
                        type: this.parameterTypes.FLOAT,
                        default: 10,
                        blockTarget: 'rdm-trial',
                        description: 'RDM Trial: speed range max'
                    },

                    // rdm-practice windows
                    practice_coherence_min: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.5,
                        blockTarget: 'rdm-practice',
                        description: 'RDM Practice: coherence range min (0-1)'
                    },
                    practice_coherence_max: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.9,
                        blockTarget: 'rdm-practice',
                        description: 'RDM Practice: coherence range max (0-1)'
                    },
                    practice_direction_options: {
                        type: this.parameterTypes.STRING,
                        default: '0,180',
                        blockTarget: 'rdm-practice',
                        description: 'RDM Practice: comma-separated directions (degrees; 0=right, 90=down, 180=left, 270=up) to sample from. Allowed range: 0 to 359.'
                    },
                    practice_feedback_duration_min: {
                        type: this.parameterTypes.INT,
                        default: 750,
                        blockTarget: 'rdm-practice',
                        description: 'RDM Practice: feedback duration min (ms)'
                    },
                    practice_feedback_duration_max: {
                        type: this.parameterTypes.INT,
                        default: 1500,
                        blockTarget: 'rdm-practice',
                        description: 'RDM Practice: feedback duration max (ms)'
                    },

                    // rdm-adaptive windows
                    adaptive_initial_coherence_min: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.05,
                        blockTarget: 'rdm-adaptive',
                        description: 'RDM Adaptive: initial coherence range min (0-1)'
                    },
                    adaptive_initial_coherence_max: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.2,
                        blockTarget: 'rdm-adaptive',
                        description: 'RDM Adaptive: initial coherence range max (0-1)'
                    },
                    adaptive_algorithm: {
                        type: this.parameterTypes.SELECT,
                        default: 'quest',
                        options: ['quest', 'staircase', 'simple'],
                        blockTarget: 'rdm-adaptive',
                        description: 'RDM Adaptive: adaptive algorithm'
                    },
                    adaptive_step_size_min: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.02,
                        blockTarget: 'rdm-adaptive',
                        description: 'RDM Adaptive: step size range min'
                    },
                    adaptive_step_size_max: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.08,
                        blockTarget: 'rdm-adaptive',
                        description: 'RDM Adaptive: step size range max'
                    },
                    adaptive_target_performance: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.82,
                        blockTarget: 'rdm-adaptive',
                        description: 'RDM Adaptive: target performance (fixed)'
                    },

                    // rdm-dot-groups windows
                    group_1_color: {
                        type: this.parameterTypes.COLOR,
                        default: '#FF0066',
                        blockTarget: 'rdm-dot-groups',
                        description: 'RDM Groups: group 1 dot color (hex)'
                    },
                    group_2_color: {
                        type: this.parameterTypes.COLOR,
                        default: '#0066FF',
                        blockTarget: 'rdm-dot-groups',
                        description: 'RDM Groups: group 2 dot color (hex)'
                    },
                    response_target_group: {
                        type: this.parameterTypes.SELECT,
                        default: 'none',
                        options: ['none', 'group_1', 'group_2'],
                        blockTarget: 'rdm-dot-groups',
                        description: 'RDM Groups: which dot group the participant should respond to'
                    },
                    cue_border_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'off',
                        options: ['off', 'target-group-color', 'custom'],
                        blockTarget: 'rdm-dot-groups',
                        description: 'RDM Groups: aperture border cue mode'
                    },
                    cue_border_color: {
                        type: this.parameterTypes.COLOR,
                        default: '#FFFFFF',
                        blockTarget: 'rdm-dot-groups',
                        description: 'RDM Groups: cue border color when cue_border_mode = custom'
                    },
                    cue_border_width: {
                        type: this.parameterTypes.INT,
                        default: 4,
                        blockTarget: 'rdm-dot-groups',
                        description: 'RDM Groups: cue border width in pixels'
                    },
                    group_1_percentage_min: {
                        type: this.parameterTypes.INT,
                        default: 40,
                        blockTarget: 'rdm-dot-groups',
                        description: 'RDM Groups: group 1 percentage min (0-100)'
                    },
                    group_1_percentage_max: {
                        type: this.parameterTypes.INT,
                        default: 60,
                        blockTarget: 'rdm-dot-groups',
                        description: 'RDM Groups: group 1 percentage max (0-100)'
                    },

                    // Flanker block windows/values
                    flanker_congruency_options: {
                        type: this.parameterTypes.STRING,
                        default: 'congruent,incongruent',
                        blockTarget: 'flanker-trial',
                        description: 'Flanker: comma-separated congruency values to sample from. Allowed: congruent, incongruent, neutral.'
                    },
                    flanker_target_direction_options: {
                        type: this.parameterTypes.STRING,
                        default: 'left,right',
                        blockTarget: 'flanker-trial',
                        description: 'Flanker: comma-separated target directions to sample from (used for arrows). Allowed: left, right.'
                    },
                    flanker_stimulus_type: {
                        type: this.parameterTypes.SELECT,
                        default: 'arrows',
                        options: ['arrows', 'letters', 'symbols', 'custom'],
                        blockTarget: 'flanker-trial',
                        description: 'Flanker: stimulus type'
                    },
                    flanker_target_stimulus_options: {
                        type: this.parameterTypes.STRING,
                        default: 'H',
                        blockTarget: 'flanker-trial',
                        description: 'Flanker: comma-separated possible center stimuli (used when stimulus_type is letters/symbols/custom). Example: H,S,@.'
                    },
                    flanker_distractor_stimulus_options: {
                        type: this.parameterTypes.STRING,
                        default: 'S',
                        blockTarget: 'flanker-trial',
                        description: 'Flanker: comma-separated possible distractor stimuli (used when stimulus_type is letters/symbols/custom).'
                    },
                    flanker_neutral_stimulus_options: {
                        type: this.parameterTypes.STRING,
                        default: '–',
                        blockTarget: 'flanker-trial',
                        description: 'Flanker: comma-separated neutral flanker stimuli (used when stimulus_type is letters/symbols/custom and congruency = neutral).'
                    },
                    flanker_left_key: {
                        type: this.parameterTypes.STRING,
                        default: 'f',
                        blockTarget: 'flanker-trial',
                        description: 'Flanker: response key mapped to left'
                    },
                    flanker_right_key: {
                        type: this.parameterTypes.STRING,
                        default: 'j',
                        blockTarget: 'flanker-trial',
                        description: 'Flanker: response key mapped to right'
                    },
                    flanker_show_fixation_dot: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        blockTarget: 'flanker-trial',
                        description: 'Flanker: show fixation dot under center stimulus'
                    },
                    flanker_show_fixation_cross_between_trials: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        blockTarget: 'flanker-trial',
                        description: 'Flanker: show fixation cross between trials'
                    },
                    flanker_stimulus_duration_min: {
                        type: this.parameterTypes.INT,
                        default: 200,
                        blockTarget: 'flanker-trial',
                        description: 'Flanker: stimulus duration min (ms)'
                    },
                    flanker_stimulus_duration_max: {
                        type: this.parameterTypes.INT,
                        default: 800,
                        blockTarget: 'flanker-trial',
                        description: 'Flanker: stimulus duration max (ms)'
                    },
                    flanker_trial_duration_min: {
                        type: this.parameterTypes.INT,
                        default: 1000,
                        blockTarget: 'flanker-trial',
                        description: 'Flanker: trial duration min (ms)'
                    },
                    flanker_trial_duration_max: {
                        type: this.parameterTypes.INT,
                        default: 2000,
                        blockTarget: 'flanker-trial',
                        description: 'Flanker: trial duration max (ms)'
                    },
                    flanker_iti_min: {
                        type: this.parameterTypes.INT,
                        default: 200,
                        blockTarget: 'flanker-trial',
                        description: 'Flanker: ITI min (ms)'
                    },
                    flanker_iti_max: {
                        type: this.parameterTypes.INT,
                        default: 800,
                        blockTarget: 'flanker-trial',
                        description: 'Flanker: ITI max (ms)'
                    },

                    // SART block windows/values
                    sart_digit_options: {
                        type: this.parameterTypes.STRING,
                        default: '1,2,3,4,5,6,7,8,9',
                        blockTarget: 'sart-trial',
                        description: 'SART: comma-separated digits to sample from. Allowed range: 0 to 9.'
                    },
                    sart_nogo_digit: {
                        type: this.parameterTypes.INT,
                        default: 3,
                        blockTarget: 'sart-trial',
                        description: 'SART: no-go digit (withhold response)'
                    },
                    sart_go_key: {
                        type: this.parameterTypes.STRING,
                        default: 'space',
                        blockTarget: 'sart-trial',
                        description: 'SART: response key for GO trials'
                    },
                    sart_stimulus_duration_min: {
                        type: this.parameterTypes.INT,
                        default: 150,
                        blockTarget: 'sart-trial',
                        description: 'SART: stimulus duration min (ms)'
                    },
                    sart_stimulus_duration_max: {
                        type: this.parameterTypes.INT,
                        default: 400,
                        blockTarget: 'sart-trial',
                        description: 'SART: stimulus duration max (ms)'
                    },
                    sart_mask_duration_min: {
                        type: this.parameterTypes.INT,
                        default: 600,
                        blockTarget: 'sart-trial',
                        description: 'SART: mask duration min (ms)'
                    },
                    sart_mask_duration_max: {
                        type: this.parameterTypes.INT,
                        default: 1200,
                        blockTarget: 'sart-trial',
                        description: 'SART: mask duration max (ms)'
                    },
                    sart_trial_duration_min: {
                        type: this.parameterTypes.INT,
                        default: 800,
                        blockTarget: 'sart-trial',
                        description: 'SART: total trial duration min (ms)'
                    },
                    sart_trial_duration_max: {
                        type: this.parameterTypes.INT,
                        default: 2000,
                        blockTarget: 'sart-trial',
                        description: 'SART: total trial duration max (ms)'
                    },
                    sart_iti_min: {
                        type: this.parameterTypes.INT,
                        default: 200,
                        blockTarget: 'sart-trial',
                        description: 'SART: ITI min (ms)'
                    },
                    sart_iti_max: {
                        type: this.parameterTypes.INT,
                        default: 800,
                        blockTarget: 'sart-trial',
                        description: 'SART: ITI max (ms)'
                    },

                    // Simon block windows/values
                    simon_color_options: {
                        type: this.parameterTypes.STRING,
                        default: 'BLUE,ORANGE',
                        blockTarget: 'simon-trial',
                        description: 'Simon: comma-separated stimulus color names to sample from (should match simon_settings.stimuli names)'
                    },
                    simon_side_options: {
                        type: this.parameterTypes.STRING,
                        default: 'left,right',
                        blockTarget: 'simon-trial',
                        description: 'Simon: comma-separated sides to sample from. Allowed: left, right.'
                    },
                    simon_response_device: {
                        type: this.parameterTypes.SELECT,
                        default: 'inherit',
                        options: ['inherit', 'keyboard', 'mouse'],
                        blockTarget: 'simon-trial',
                        description: 'Simon: response device override for generated trials'
                    },
                    simon_left_key: {
                        type: this.parameterTypes.STRING,
                        default: 'f',
                        blockTarget: 'simon-trial',
                        description: 'Simon: key for LEFT response (keyboard mode)'
                    },
                    simon_right_key: {
                        type: this.parameterTypes.STRING,
                        default: 'j',
                        blockTarget: 'simon-trial',
                        description: 'Simon: key for RIGHT response (keyboard mode)'
                    },
                    simon_stimulus_duration_min: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        blockTarget: 'simon-trial',
                        description: 'Simon: stimulus duration min (ms). 0 = until response/trial end.'
                    },
                    simon_stimulus_duration_max: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        blockTarget: 'simon-trial',
                        description: 'Simon: stimulus duration max (ms). 0 = until response/trial end.'
                    },
                    simon_trial_duration_min: {
                        type: this.parameterTypes.INT,
                        default: 1500,
                        blockTarget: 'simon-trial',
                        description: 'Simon: total trial duration min (ms)'
                    },
                    simon_trial_duration_max: {
                        type: this.parameterTypes.INT,
                        default: 1500,
                        blockTarget: 'simon-trial',
                        description: 'Simon: total trial duration max (ms)'
                    },
                    simon_iti_min: {
                        type: this.parameterTypes.INT,
                        default: 500,
                        blockTarget: 'simon-trial',
                        description: 'Simon: ITI min (ms)'
                    },
                    simon_iti_max: {
                        type: this.parameterTypes.INT,
                        default: 500,
                        blockTarget: 'simon-trial',
                        description: 'Simon: ITI max (ms)'
                    },

                    // PVT block windows/values
                    pvt_response_device: {
                        type: this.parameterTypes.SELECT,
                        default: 'inherit',
                        options: ['inherit', 'keyboard', 'mouse', 'both'],
                        blockTarget: 'pvt-trial',
                        description: 'PVT: response device override for generated trials'
                    },
                    pvt_response_key: {
                        type: this.parameterTypes.STRING,
                        default: 'space',
                        blockTarget: 'pvt-trial',
                        description: 'PVT: response key (keyboard mode)'
                    },
                    pvt_foreperiod_min: {
                        type: this.parameterTypes.INT,
                        default: 2000,
                        blockTarget: 'pvt-trial',
                        description: 'PVT: foreperiod min (ms)'
                    },
                    pvt_foreperiod_max: {
                        type: this.parameterTypes.INT,
                        default: 10000,
                        blockTarget: 'pvt-trial',
                        description: 'PVT: foreperiod max (ms)'
                    },
                    pvt_trial_duration_min: {
                        type: this.parameterTypes.INT,
                        default: 10000,
                        blockTarget: 'pvt-trial',
                        description: 'PVT: trial duration min (ms)'
                    },
                    pvt_trial_duration_max: {
                        type: this.parameterTypes.INT,
                        default: 10000,
                        blockTarget: 'pvt-trial',
                        description: 'PVT: trial duration max (ms)'
                    },
                    pvt_iti_min: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        blockTarget: 'pvt-trial',
                        description: 'PVT: ITI min (ms)'
                    },
                    pvt_iti_max: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        blockTarget: 'pvt-trial',
                        description: 'PVT: ITI max (ms)'
                    },

                    // Stroop block windows/values
                    stroop_word_options: {
                        type: this.parameterTypes.STRING,
                        default: 'RED,BLUE',
                        blockTarget: 'stroop-trial',
                        description: 'Stroop: comma-separated stimulus names to sample from (should match your experiment-wide stimulus library names). Used for both word and ink-color sampling.'
                    },
                    stroop_congruency_options: {
                        type: this.parameterTypes.STRING,
                        default: 'auto,congruent,incongruent',
                        blockTarget: 'stroop-trial',
                        description: 'Stroop: comma-separated congruency modes to sample from. Allowed: auto, congruent, incongruent.'
                    },
                    stroop_response_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'inherit',
                        options: ['inherit', 'color_naming', 'congruency'],
                        blockTarget: 'stroop-trial',
                        description: 'Stroop: response mode override for generated trials (inherit uses experiment stroop_settings)'
                    },
                    stroop_response_device: {
                        type: this.parameterTypes.SELECT,
                        default: 'inherit',
                        options: ['inherit', 'keyboard', 'mouse'],
                        blockTarget: 'stroop-trial',
                        description: 'Stroop: response device override for generated trials'
                    },
                    stroop_choice_keys: {
                        type: this.parameterTypes.STRING,
                        default: '1,2',
                        blockTarget: 'stroop-trial',
                        description: 'Stroop color-naming: comma-separated key labels mapped to each stimulus in order (e.g., 1,2,3,4)'
                    },
                    stroop_congruent_key: {
                        type: this.parameterTypes.STRING,
                        default: 'f',
                        blockTarget: 'stroop-trial',
                        description: 'Stroop congruency: key for CONGRUENT (keyboard mode)'
                    },
                    stroop_incongruent_key: {
                        type: this.parameterTypes.STRING,
                        default: 'j',
                        blockTarget: 'stroop-trial',
                        description: 'Stroop congruency: key for INCONGRUENT (keyboard mode)'
                    },
                    stroop_stimulus_duration_min: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        blockTarget: 'stroop-trial',
                        description: 'Stroop: stimulus duration min (ms). 0 = until response/trial end.'
                    },
                    stroop_stimulus_duration_max: {
                        type: this.parameterTypes.INT,
                        default: 0,
                        blockTarget: 'stroop-trial',
                        description: 'Stroop: stimulus duration max (ms). 0 = until response/trial end.'
                    },
                    stroop_trial_duration_min: {
                        type: this.parameterTypes.INT,
                        default: 2000,
                        blockTarget: 'stroop-trial',
                        description: 'Stroop: total trial duration min (ms)'
                    },
                    stroop_trial_duration_max: {
                        type: this.parameterTypes.INT,
                        default: 2000,
                        blockTarget: 'stroop-trial',
                        description: 'Stroop: total trial duration max (ms)'
                    },
                    stroop_iti_min: {
                        type: this.parameterTypes.INT,
                        default: 500,
                        blockTarget: 'stroop-trial',
                        description: 'Stroop: ITI min (ms)'
                    },
                    stroop_iti_max: {
                        type: this.parameterTypes.INT,
                        default: 500,
                        blockTarget: 'stroop-trial',
                        description: 'Stroop: ITI max (ms)'
                    },

                    // Gabor block windows/values
                    gabor_response_task: {
                        type: this.parameterTypes.SELECT,
                        default: 'discriminate_tilt',
                        options: ['detect_target', 'discriminate_tilt'],
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: response task mode for generated trials'
                    },
                    gabor_left_key: {
                        type: this.parameterTypes.STRING,
                        default: 'f',
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: left key (discriminate_tilt)'
                    },
                    gabor_right_key: {
                        type: this.parameterTypes.STRING,
                        default: 'j',
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: right key (discriminate_tilt)'
                    },
                    gabor_yes_key: {
                        type: this.parameterTypes.STRING,
                        default: 'f',
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: yes key (detect_target)'
                    },
                    gabor_no_key: {
                        type: this.parameterTypes.STRING,
                        default: 'j',
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: no key (detect_target)'
                    },
                    gabor_target_location_options: {
                        type: this.parameterTypes.STRING,
                        default: 'left,right',
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: comma-separated target locations to sample from. Allowed: left, right.'
                    },
                    gabor_target_tilt_options: {
                        type: this.parameterTypes.STRING,
                        default: '-45,45',
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: comma-separated target tilts (degrees) to sample from. Allowed range: -90 to 90.'
                    },
                    gabor_distractor_orientation_options: {
                        type: this.parameterTypes.STRING,
                        default: '0,90',
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: comma-separated distractor orientations (degrees) to sample from. Allowed range: 0 to 179.'
                    },
                    gabor_spatial_cue_enabled: {
                        type: this.parameterTypes.BOOL,
                        default: true,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: enable sampling spatial cue presence per trial (when false: spatial_cue forced to none)'
                    },
                    gabor_spatial_cue_options: {
                        type: this.parameterTypes.STRING,
                        default: 'none,left,right,both',
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: comma-separated spatial cue options to sample from. Allowed: none, left, right, both.'
                    },
                    gabor_spatial_cue_probability: {
                        type: this.parameterTypes.FLOAT,
                        default: 1,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: probability a trial contains a spatial cue (0–1)'
                    },
                    gabor_spatial_cue_validity_probability: {
                        type: this.parameterTypes.FLOAT,
                        default: 1,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: probability that a unilateral spatial cue (left/right) is valid for target side (0–1)'
                    },
                    gabor_value_cue_enabled: {
                        type: this.parameterTypes.BOOL,
                        default: true,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: enable sampling value cue presence per trial (when false: left/right_value forced to neutral)'
                    },
                    gabor_left_value_options: {
                        type: this.parameterTypes.STRING,
                        default: 'neutral,high,low',
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: comma-separated left value cue options to sample from. Allowed: neutral, high, low.'
                    },
                    gabor_right_value_options: {
                        type: this.parameterTypes.STRING,
                        default: 'neutral,high,low',
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: comma-separated right value cue options to sample from. Allowed: neutral, high, low.'
                    },
                    gabor_value_cue_probability: {
                        type: this.parameterTypes.FLOAT,
                        default: 1,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: probability a trial contains value cues (0–1)'
                    },
                    gabor_value_target_value: {
                        type: this.parameterTypes.SELECT,
                        default: 'any',
                        options: ['any', 'high', 'low', 'neutral'],
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor Value Learning: when set, force target location to side carrying this value cue'
                    },
                    gabor_reward_availability_high: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.8,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor Value Learning: reward-available probability when target appears on HIGH value cue (0–1)'
                    },
                    gabor_reward_availability_low: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.8,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor Value Learning: reward-available probability when target appears on LOW value cue (0–1)'
                    },
                    gabor_reward_availability_neutral: {
                        type: this.parameterTypes.FLOAT,
                        default: 0,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor Value Learning: reward-available probability when target appears on NEUTRAL value cue (0–1)'
                    },
                    gabor_spatial_frequency_min: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.06,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: spatial frequency min (cycles per pixel)'
                    },
                    gabor_spatial_frequency_max: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.06,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: spatial frequency max (cycles per pixel)'
                    },
                    gabor_patch_diameter_deg_min: {
                        type: this.parameterTypes.FLOAT,
                        default: 6,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: patch diameter min (degrees of visual angle)'
                    },
                    gabor_patch_diameter_deg_max: {
                        type: this.parameterTypes.FLOAT,
                        default: 6,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: patch diameter max (degrees of visual angle)'
                    },
                    gabor_grating_waveform_options: {
                        type: this.parameterTypes.STRING,
                        default: 'sinusoidal',
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: comma-separated grating waveforms to sample from. Allowed: sinusoidal, square, triangle.'
                    },
                    gabor_patch_border_enabled: {
                        type: this.parameterTypes.BOOL,
                        default: true,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: draw circular patch border (applies to stimulus + mask + placeholders)'
                    },
                    gabor_patch_border_width_px: {
                        type: this.parameterTypes.INT,
                        default: 2,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: patch border line width (px)'
                    },
                    gabor_patch_border_color: {
                        type: this.parameterTypes.COLOR,
                        default: '#FFFFFF',
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: patch border color'
                    },
                    gabor_patch_border_opacity: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.22,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: patch border opacity (0–1)'
                    },
                    gabor_adaptive_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'none',
                        options: ['none', 'quest'],
                        blockTarget: 'gabor-trial,gabor-quest',
                        description: 'Gabor: optional adaptive staircase mode for this block'
                    },
                    gabor_quest_parameter: {
                        type: this.parameterTypes.SELECT,
                        default: 'target_tilt_deg',
                        options: ['target_tilt_deg', 'spatial_frequency_cyc_per_px', 'contrast'],
                        blockTarget: 'gabor-trial,gabor-quest',
                        description: 'Gabor QUEST: which parameter to adapt'
                    },
                    gabor_quest_target_performance: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.82,
                        blockTarget: 'gabor-trial,gabor-quest',
                        description: 'Gabor QUEST: target performance level (e.g., 0.82)'
                    },
                    gabor_quest_start_value: {
                        type: this.parameterTypes.FLOAT,
                        default: 45,
                        blockTarget: 'gabor-trial,gabor-quest',
                        description: 'Gabor QUEST: initial value'
                    },
                    gabor_quest_start_sd: {
                        type: this.parameterTypes.FLOAT,
                        default: 20,
                        blockTarget: 'gabor-trial,gabor-quest',
                        description: 'Gabor QUEST: initial SD'
                    },
                    gabor_quest_beta: {
                        type: this.parameterTypes.FLOAT,
                        default: 3.5,
                        blockTarget: 'gabor-trial,gabor-quest',
                        description: 'Gabor QUEST: beta (slope)'
                    },
                    gabor_quest_delta: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.01,
                        blockTarget: 'gabor-trial,gabor-quest',
                        description: 'Gabor QUEST: lapse rate (delta)'
                    },
                    gabor_quest_gamma: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.5,
                        blockTarget: 'gabor-trial,gabor-quest',
                        description: 'Gabor QUEST: guess rate (gamma)'
                    },
                    gabor_quest_min_value: {
                        type: this.parameterTypes.FLOAT,
                        default: -90,
                        blockTarget: 'gabor-trial,gabor-quest',
                        description: 'Gabor QUEST: minimum allowed value'
                    },
                    gabor_quest_max_value: {
                        type: this.parameterTypes.FLOAT,
                        default: 90,
                        blockTarget: 'gabor-trial,gabor-quest',
                        description: 'Gabor QUEST: maximum allowed value'
                    },
                    gabor_quest_trials_coarse: {
                        type: this.parameterTypes.INT,
                        default: 32,
                        blockTarget: 'gabor-trial,gabor-quest',
                        description: 'Gabor QUEST: trials in broad staircase phase'
                    },
                    gabor_quest_trials_fine: {
                        type: this.parameterTypes.INT,
                        default: 32,
                        blockTarget: 'gabor-trial,gabor-quest',
                        description: 'Gabor QUEST: trials in fine-tuning staircase phase (runs after coarse)'
                    },
                    gabor_quest_staircase_per_location: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        blockTarget: 'gabor-trial,gabor-quest',
                        description: 'Gabor QUEST: run separate staircases for left and right target locations'
                    },
                    gabor_quest_store_location_threshold: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        blockTarget: 'gabor-trial,gabor-quest',
                        description: 'Gabor QUEST: store per-location thresholds in window.cogflowState after block completes'
                    },
                    gabor_contrast_min: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.05,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: contrast minimum (0–1)'
                    },
                    gabor_contrast_max: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.95,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: contrast maximum (0–1)'
                    },
                    gabor_learning_streak_length: {
                        type: this.parameterTypes.INT,
                        default: 20,
                        blockTarget: 'gabor-learning',
                        description: 'Gabor Learning: number of recent trials to evaluate accuracy over'
                    },
                    gabor_learning_target_accuracy: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.9,
                        blockTarget: 'gabor-learning',
                        description: 'Gabor Learning: accuracy criterion to reach (0–1, e.g. 0.9 = 90%)'
                    },
                    gabor_learning_max_trials: {
                        type: this.parameterTypes.INT,
                        default: 200,
                        blockTarget: 'gabor-learning',
                        description: 'Gabor Learning: maximum number of trials before block ends regardless of accuracy'
                    },
                    gabor_show_feedback: {
                        type: this.parameterTypes.BOOL,
                        default: true,
                        blockTarget: 'gabor-learning',
                        description: 'Gabor: show correct/incorrect feedback after each trial'
                    },
                    gabor_feedback_duration_ms: {
                        type: this.parameterTypes.INT,
                        default: 800,
                        blockTarget: 'gabor-learning',
                        description: 'Gabor: duration of feedback display (ms)'
                    },
                    gabor_stimulus_duration_min: {
                        type: this.parameterTypes.INT,
                        default: 67,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: stimulus duration min (ms)'
                    },
                    gabor_stimulus_duration_max: {
                        type: this.parameterTypes.INT,
                        default: 67,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: stimulus duration max (ms)'
                    },
                    gabor_mask_duration_min: {
                        type: this.parameterTypes.INT,
                        default: 67,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: mask duration min (ms)'
                    },
                    gabor_mask_duration_max: {
                        type: this.parameterTypes.INT,
                        default: 67,
                        blockTarget: 'gabor-trial,gabor-quest,gabor-learning',
                        description: 'Gabor: mask duration max (ms)'
                    },
                    group_1_coherence_min: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.1,
                        blockTarget: 'rdm-dot-groups',
                        description: 'RDM Groups: group 1 coherence min (0-1)'
                    },
                    group_1_coherence_max: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.5,
                        blockTarget: 'rdm-dot-groups',
                        description: 'RDM Groups: group 1 coherence max (0-1)'
                    },
                    group_1_direction_options: {
                        type: this.parameterTypes.STRING,
                        default: '0,180',
                        blockTarget: 'rdm-dot-groups',
                        description: 'RDM Groups: group 1 comma-separated direction options (degrees; 0=right, 90=down, 180=left, 270=up). Allowed range: 0 to 359.'
                    },
                    group_1_speed_min: {
                        type: this.parameterTypes.FLOAT,
                        default: 4,
                        blockTarget: 'rdm-dot-groups',
                        description: 'RDM Groups: group 1 speed min'
                    },
                    group_1_speed_max: {
                        type: this.parameterTypes.FLOAT,
                        default: 10,
                        blockTarget: 'rdm-dot-groups',
                        description: 'RDM Groups: group 1 speed max'
                    },
                    group_2_coherence_min: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.5,
                        blockTarget: 'rdm-dot-groups',
                        description: 'RDM Groups: group 2 coherence min (0-1)'
                    },
                    group_2_coherence_max: {
                        type: this.parameterTypes.FLOAT,
                        default: 0.9,
                        blockTarget: 'rdm-dot-groups',
                        description: 'RDM Groups: group 2 coherence max (0-1)'
                    },
                    group_2_direction_options: {
                        type: this.parameterTypes.STRING,
                        default: '0,180',
                        blockTarget: 'rdm-dot-groups',
                        description: 'RDM Groups: group 2 comma-separated direction options (degrees; 0=right, 90=down, 180=left, 270=up). Allowed range: 0 to 359.'
                    },
                    group_2_speed_min: {
                        type: this.parameterTypes.FLOAT,
                        default: 4,
                        blockTarget: 'rdm-dot-groups',
                        description: 'RDM Groups: group 2 speed min'
                    },
                    group_2_speed_max: {
                        type: this.parameterTypes.FLOAT,
                        default: 10,
                        blockTarget: 'rdm-dot-groups',
                        description: 'RDM Groups: group 2 speed max'
                    },

                    // MOT block window parameters
                    mot_num_objects_options: {
                        type: this.parameterTypes.STRING,
                        default: '6,8,10',
                        blockTarget: 'mot-trial',
                        description: 'MOT: comma-separated integers for num_objects sampling'
                    },
                    mot_num_targets_options: {
                        type: this.parameterTypes.STRING,
                        default: '2,3,4',
                        blockTarget: 'mot-trial',
                        description: 'MOT: comma-separated integers for num_targets sampling'
                    },
                    mot_speed_px_per_s_min: {
                        type: this.parameterTypes.FLOAT,
                        default: 100,
                        blockTarget: 'mot-trial',
                        description: 'MOT: minimum speed (px/s) for block sampling'
                    },
                    mot_speed_px_per_s_max: {
                        type: this.parameterTypes.FLOAT,
                        default: 200,
                        blockTarget: 'mot-trial',
                        description: 'MOT: maximum speed (px/s) for block sampling'
                    },
                    mot_tracking_duration_ms_min: {
                        type: this.parameterTypes.INT,
                        default: 5000,
                        blockTarget: 'mot-trial',
                        description: 'MOT: minimum tracking duration (ms) for block sampling'
                    },
                    mot_tracking_duration_ms_max: {
                        type: this.parameterTypes.INT,
                        default: 10000,
                        blockTarget: 'mot-trial',
                        description: 'MOT: maximum tracking duration (ms) for block sampling'
                    },
                    mot_cue_duration_ms_min: {
                        type: this.parameterTypes.INT,
                        default: 1500,
                        blockTarget: 'mot-trial',
                        description: 'MOT: minimum cue duration (ms) for block sampling'
                    },
                    mot_cue_duration_ms_max: {
                        type: this.parameterTypes.INT,
                        default: 2500,
                        blockTarget: 'mot-trial',
                        description: 'MOT: maximum cue duration (ms) for block sampling'
                    },
                    mot_iti_ms_min: {
                        type: this.parameterTypes.INT,
                        default: 800,
                        blockTarget: 'mot-trial',
                        description: 'MOT: minimum ITI (ms) for block sampling'
                    },
                    mot_iti_ms_max: {
                        type: this.parameterTypes.INT,
                        default: 1500,
                        blockTarget: 'mot-trial',
                        description: 'MOT: maximum ITI (ms) for block sampling'
                    },
                    mot_motion_type: {
                        type: this.parameterTypes.SELECT,
                        default: 'linear',
                        options: ['linear', 'curved'],
                        blockTarget: 'mot-trial',
                        description: 'MOT: fixed motion type for all trials in this block'
                    },
                    mot_probe_mode: {
                        type: this.parameterTypes.SELECT,
                        default: 'click',
                        options: ['click', 'number_entry'],
                        blockTarget: 'mot-trial',
                        description: 'MOT: fixed probe mode for all trials in this block'
                    },
                    mot_show_feedback: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        blockTarget: 'mot-trial',
                        description: 'MOT: whether to show feedback for all trials in this block'
                    }
                },
                data: {}
            },
            'instructions': {
                name: 'instructions',
                description: 'Display instructions to participants',
                parameters: {
                    pages: { 
                        type: this.parameterTypes.HTML_STRING, 
                        array: true, 
                        required: true,
                        description: 'Array of instruction pages to display'
                    },
                    key_forward: { 
                        type: this.parameterTypes.KEY, 
                        default: 'ArrowRight',
                        description: 'Key to advance to next page'
                    },
                    key_backward: { 
                        type: this.parameterTypes.KEY, 
                        default: 'ArrowLeft',
                        description: 'Key to go back to previous page'
                    },
                    allow_backward: { 
                        type: this.parameterTypes.BOOL, 
                        default: true,
                        description: 'Allow participants to go back'
                    },
                    allow_keys: { 
                        type: this.parameterTypes.BOOL, 
                        default: true,
                        description: 'Allow keyboard navigation'
                    },
                    show_clickable_nav: { 
                        type: this.parameterTypes.BOOL, 
                        default: false,
                        description: 'Show clickable navigation buttons'
                    },
                    button_label_previous: { 
                        type: this.parameterTypes.STRING, 
                        default: 'Previous',
                        description: 'Text for previous button'
                    },
                    button_label_next: { 
                        type: this.parameterTypes.STRING, 
                        default: 'Next',
                        description: 'Text for next button'
                    }
                },
                data: {
                    view_history: { type: this.parameterTypes.OBJECT },
                    rt: { type: this.parameterTypes.INT }
                }
            },

            'html-keyboard-response': {
                name: 'html-keyboard-response',
                description: 'Display HTML stimulus and collect keyboard response',
                parameters: {
                    stimulus: { 
                        type: this.parameterTypes.HTML_STRING, 
                        required: true,
                        description: 'HTML content to display'
                    },
                    choices: { 
                        type: this.parameterTypes.KEYS, 
                        default: 'ALL_KEYS',
                        description: 'Keys that will be accepted as responses'
                    },
                    prompt: { 
                        type: this.parameterTypes.HTML_STRING, 
                        default: null,
                        description: 'Prompt text displayed below stimulus'
                    },
                    stimulus_duration: { 
                        type: this.parameterTypes.INT, 
                        default: null,
                        description: 'How long to show stimulus (ms)'
                    },
                    trial_duration: { 
                        type: this.parameterTypes.INT, 
                        default: null,
                        description: 'Maximum time allowed for response (ms)'
                    },
                    response_ends_trial: { 
                        type: this.parameterTypes.BOOL, 
                        default: true,
                        description: 'End trial immediately after response'
                    }
                },
                data: {
                    stimulus: { type: this.parameterTypes.HTML_STRING },
                    response: { type: this.parameterTypes.KEY },
                    rt: { type: this.parameterTypes.INT },
                    correct: { type: this.parameterTypes.BOOL, optional: true }
                }
            },

            'survey-response': {
                name: 'survey-response',
                description: 'Collect survey/questionnaire responses in a single HTML form',
                parameters: {
                    title: {
                        type: this.parameterTypes.STRING,
                        default: 'Survey',
                        description: 'Survey title/header'
                    },
                    instructions: {
                        type: this.parameterTypes.HTML_STRING,
                        default: '',
                        description: 'Optional instructions shown above the form'
                    },
                    submit_label: {
                        type: this.parameterTypes.STRING,
                        default: 'Continue',
                        description: 'Submit button text'
                    },
                    allow_empty_on_timeout: {
                        type: this.parameterTypes.BOOL,
                        default: false,
                        description: 'If true, allow continuing with empty responses after timeout_ms'
                    },
                    timeout_ms: {
                        type: this.parameterTypes.INT,
                        default: null,
                        description: 'Optional timeout in ms for auto-continue (null/omitted = off)'
                    },
                    questions: {
                        type: this.parameterTypes.COMPLEX,
                        required: true,
                        description: 'Array of question objects (id, type, prompt, required, and type-specific fields)'
                    }
                },
                data: {
                    responses: { type: this.parameterTypes.OBJECT, optional: true },
                    rt: { type: this.parameterTypes.INT, optional: true }
                }
            },

            'image-keyboard-response': {
                name: 'image-keyboard-response',
                description: 'Display image stimulus and collect keyboard response',
                parameters: {
                    stimulus: { 
                        type: this.parameterTypes.IMAGE, 
                        required: true,
                        description: 'Path to image file'
                    },
                    stimulus_height: { 
                        type: this.parameterTypes.INT, 
                        default: null,
                        description: 'Height of image in pixels'
                    },
                    stimulus_width: { 
                        type: this.parameterTypes.INT, 
                        default: null,
                        description: 'Width of image in pixels'
                    },
                    maintain_aspect_ratio: { 
                        type: this.parameterTypes.BOOL, 
                        default: true,
                        description: 'Maintain image aspect ratio'
                    },
                    choices: { 
                        type: this.parameterTypes.KEYS, 
                        default: 'ALL_KEYS',
                        description: 'Keys that will be accepted as responses'
                    },
                    prompt: { 
                        type: this.parameterTypes.HTML_STRING, 
                        default: null,
                        description: 'Prompt text displayed below stimulus'
                    },
                    stimulus_duration: { 
                        type: this.parameterTypes.INT, 
                        default: null,
                        description: 'How long to show stimulus (ms)'
                    },
                    trial_duration: { 
                        type: this.parameterTypes.INT, 
                        default: null,
                        description: 'Maximum time allowed for response (ms)'
                    },
                    response_ends_trial: { 
                        type: this.parameterTypes.BOOL, 
                        default: true,
                        description: 'End trial immediately after response'
                    }
                },
                data: {
                    stimulus: { type: this.parameterTypes.IMAGE },
                    response: { type: this.parameterTypes.KEY },
                    rt: { type: this.parameterTypes.INT },
                    correct: { type: this.parameterTypes.BOOL, optional: true }
                }
            },

            'html-button-response': {
                name: 'html-button-response',
                description: 'Display HTML stimulus and collect button response',
                parameters: {
                    stimulus: { 
                        type: this.parameterTypes.HTML_STRING, 
                        required: true,
                        description: 'HTML content to display'
                    },
                    choices: { 
                        type: this.parameterTypes.STRING, 
                        array: true, 
                        required: true,
                        description: 'Labels for buttons'
                    },
                    button_html: { 
                        type: this.parameterTypes.FUNCTION, 
                        default: null,
                        description: 'Custom HTML for buttons'
                    },
                    prompt: { 
                        type: this.parameterTypes.HTML_STRING, 
                        default: null,
                        description: 'Prompt text displayed below stimulus'
                    },
                    stimulus_duration: { 
                        type: this.parameterTypes.INT, 
                        default: null,
                        description: 'How long to show stimulus (ms)'
                    },
                    trial_duration: { 
                        type: this.parameterTypes.INT, 
                        default: null,
                        description: 'Maximum time allowed for response (ms)'
                    },
                    button_layout: { 
                        type: this.parameterTypes.STRING, 
                        default: 'grid',
                        description: 'How to arrange buttons'
                    },
                    grid_rows: { 
                        type: this.parameterTypes.INT, 
                        default: 1,
                        description: 'Number of rows in button grid'
                    },
                    grid_columns: { 
                        type: this.parameterTypes.INT, 
                        default: null,
                        description: 'Number of columns in button grid'
                    },
                    response_ends_trial: { 
                        type: this.parameterTypes.BOOL, 
                        default: true,
                        description: 'End trial immediately after response'
                    }
                },
                data: {
                    stimulus: { type: this.parameterTypes.HTML_STRING },
                    response: { type: this.parameterTypes.INT },
                    rt: { type: this.parameterTypes.INT },
                    button_pressed: { type: this.parameterTypes.STRING },
                    correct: { type: this.parameterTypes.BOOL, optional: true }
                }
            },

            'preload': {
                name: 'preload',
                description: 'Preload images, audio, and video files',
                parameters: {
                    auto_preload: { 
                        type: this.parameterTypes.BOOL, 
                        default: false,
                        description: 'Automatically detect files to preload'
                    },
                    trials: { 
                        type: this.parameterTypes.TIMELINE, 
                        default: [],
                        description: 'Timeline to scan for files to preload'
                    },
                    images: { 
                        type: this.parameterTypes.IMAGE, 
                        array: true, 
                        default: [],
                        description: 'Array of image files to preload'
                    },
                    audio: { 
                        type: this.parameterTypes.AUDIO, 
                        array: true, 
                        default: [],
                        description: 'Array of audio files to preload'
                    },
                    video: { 
                        type: this.parameterTypes.VIDEO, 
                        array: true, 
                        default: [],
                        description: 'Array of video files to preload'
                    },
                    message: { 
                        type: this.parameterTypes.HTML_STRING, 
                        default: null,
                        description: 'Message to show during preloading'
                    },
                    show_progress_bar: { 
                        type: this.parameterTypes.BOOL, 
                        default: true,
                        description: 'Show preloading progress bar'
                    },
                    continue_after_error: { 
                        type: this.parameterTypes.BOOL, 
                        default: false,
                        description: 'Continue if file fails to load'
                    },
                    max_load_time: { 
                        type: this.parameterTypes.INT, 
                        default: null,
                        description: 'Maximum time to spend loading files (ms)'
                    }
                },
                data: {
                    success: { type: this.parameterTypes.BOOL },
                    timeout: { type: this.parameterTypes.BOOL },
                    failed_images: { type: this.parameterTypes.STRING, array: true },
                    failed_audio: { type: this.parameterTypes.STRING, array: true },
                    failed_video: { type: this.parameterTypes.STRING, array: true }
                }
            }
        };
    }

    /**
     * Initialize experiment-level schemas
     */
    initializeExperimentSchemas() {
        return {
            'trial-based': {
                required_fields: ['timeline'],
                optional_fields: [
                    'num_trials', 'default_iti', 'randomize_order', 
                    'on_finish', 'on_trial_start', 'on_trial_finish',
                    'data_collection', 'experiment_type', 'task_type', 'ui_settings'
                ],
                validation_rules: {
                    timeline: { 
                        type: 'array', 
                        min_length: 1,
                        description: 'Must contain at least one trial'
                    },
                    num_trials: { 
                        type: 'number', 
                        min: 1,
                        description: 'Must be a positive integer'
                    },
                    default_iti: { 
                        type: 'number', 
                        min: 0,
                        description: 'Inter-trial interval in milliseconds'
                    }
                }
            },

            'continuous': {
                required_fields: ['timeline', 'frame_rate'],
                optional_fields: [
                    'duration', 'update_interval', 'on_frame_update',
                    'data_collection', 'experiment_type', 'task_type', 'ui_settings'
                ],
                validation_rules: {
                    timeline: { 
                        type: 'array', 
                        min_length: 1,
                        description: 'Must contain at least one component'
                    },
                    frame_rate: { 
                        type: 'number', 
                        min: 1, 
                        max: 120,
                        description: 'Frame rate between 1-120 fps'
                    },
                    duration: { 
                        type: 'number', 
                        min: 1,
                        description: 'Duration in seconds'
                    },
                    update_interval: { 
                        type: 'number', 
                        min: 1,
                        description: 'Update interval in milliseconds'
                    }
                }
            },

            'rdm': {
                required_fields: ['timeline'],
                optional_fields: [
                    'num_trials', 'default_iti', 'randomize_order', 
                    'stimulus_width', 'stimulus_height', 'background_color',
                    'on_finish', 'on_trial_start', 'on_trial_finish',
                    'data_collection', 'experiment_type', 'task_type', 'ui_settings'
                ],
                validation_rules: {
                    timeline: { 
                        type: 'array', 
                        min_length: 1,
                        description: 'Must contain at least one RDM trial'
                    },
                    num_trials: { 
                        type: 'number', 
                        min: 1,
                        description: 'Must be a positive integer'
                    },
                    stimulus_width: { 
                        type: 'number', 
                        min: 50, 
                        max: 800,
                        description: 'Stimulus aperture width in pixels'
                    },
                    stimulus_height: { 
                        type: 'number', 
                        min: 50, 
                        max: 800,
                        description: 'Stimulus aperture height in pixels'
                    },
                    background_color: { 
                        type: 'string',
                        description: 'Background color in hex format'
                    }
                }
            },

            'custom': {
                required_fields: ['timeline'],
                optional_fields: [
                    'experiment_type', 'data_collection', 'task_type',
                    'on_finish', 'on_trial_start', 'on_trial_finish', 'ui_settings'
                ],
                validation_rules: {
                    timeline: { 
                        type: 'array', 
                        min_length: 1,
                        description: 'Must contain at least one component'
                    }
                }
            }
        };
    }

    /**
     * Validate a complete experiment configuration
     */
    validate(config) {
        const errors = [];
        const warnings = [];

        try {
            // Check experiment type
            if (!config.experiment_type) {
                errors.push('Missing required field: experiment_type');
            } else if (!this.experimentSchemas[config.experiment_type]) {
                errors.push(`Invalid experiment type: ${config.experiment_type}`);
            }

            // Validate task type (experiment-wide)
            const knownTaskTypes = [
                'rdm',
                'stroop',
                'emotional-stroop',
                'nback',
                'simon',
                'task-switching',
                'pvt',
                'mot',
                'gabor',
                'flanker',
                'sart',
                'continuous-image',
                'soc-dashboard',
                'custom'
            ];
            if (config.task_type === undefined || config.task_type === null || config.task_type === '') {
                warnings.push('Missing recommended field: task_type');
            } else if (typeof config.task_type !== 'string') {
                errors.push(`task_type should be string, got ${typeof config.task_type}`);
            } else if (!knownTaskTypes.includes(config.task_type)) {
                // Allow forward-compatible task additions without hard failing
                warnings.push(`Unknown task_type '${config.task_type}' (known: ${knownTaskTypes.join(', ')})`);
            }

            // Validate experiment-specific requirements
            if (config.experiment_type && this.experimentSchemas[config.experiment_type]) {
                const schema = this.experimentSchemas[config.experiment_type];
                
                // Check required fields
                for (const field of schema.required_fields) {
                    if (!(field in config)) {
                        errors.push(`Missing required field: ${field}`);
                    }
                }

                // Validate field values
                for (const [field, rules] of Object.entries(schema.validation_rules)) {
                    if (field in config) {
                        const validation = this.validateField(config[field], rules, field);
                        if (!validation.valid) {
                            errors.push(...validation.errors);
                        }
                        warnings.push(...validation.warnings);
                    }
                }
            }

            // Validate timeline
            if (config.timeline) {
                const timelineValidation = this.validateTimeline(config.timeline);
                errors.push(...timelineValidation.errors);
                warnings.push(...timelineValidation.warnings);
            }

            // Validate data collection settings
            if (config.data_collection) {
                const dcValidation = this.validateDataCollection(config.data_collection);
                errors.push(...dcValidation.errors);
                warnings.push(...dcValidation.warnings);
            }

        } catch (error) {
            errors.push(`Validation error: ${error.message}`);
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validate individual field against rules
     */
    validateField(value, rules, fieldName) {
        const errors = [];
        const warnings = [];

        // Type checking
        if (rules.type) {
            const actualType = Array.isArray(value) ? 'array' : typeof value;
            if (actualType !== rules.type) {
                errors.push(`${fieldName} should be ${rules.type}, got ${actualType}`);
            }
        }

        // Range checking for numbers
        if (typeof value === 'number') {
            if (rules.min !== undefined && value < rules.min) {
                errors.push(`${fieldName} should be >= ${rules.min}, got ${value}`);
            }
            if (rules.max !== undefined && value > rules.max) {
                errors.push(`${fieldName} should be <= ${rules.max}, got ${value}`);
            }
        }

        // Array length checking
        if (Array.isArray(value)) {
            if (rules.min_length !== undefined && value.length < rules.min_length) {
                errors.push(`${fieldName} should have at least ${rules.min_length} items, got ${value.length}`);
            }
            if (rules.max_length !== undefined && value.length > rules.max_length) {
                errors.push(`${fieldName} should have at most ${rules.max_length} items, got ${value.length}`);
            }
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    /**
     * Validate timeline components
     */
    validateTimeline(timeline) {
        const errors = [];
        const warnings = [];

        if (!Array.isArray(timeline)) {
            errors.push('Timeline must be an array');
            return { errors, warnings };
        }

        timeline.forEach((trial, index) => {
            // Check if trial has a type
            if (!trial.type) {
                errors.push(`Trial ${index}: Missing 'type' field`);
                return;
            }

            // Resolve a schema for this component type.
            // For RDM components, prefer generateRDMPluginSchema() (current export shape).
            const schema = this.getPluginSchema(trial.type);
            if (!schema) {
                warnings.push(`Trial ${index}: No schema available for plugin '${trial.type}'`);
                return;
            }

            // Validate against plugin schema
            const pluginValidation = this.validateTrialAgainstSchema(trial, schema, index);
            errors.push(...pluginValidation.errors);
            warnings.push(...pluginValidation.warnings);

            // Component-specific deep validation
            if (trial.type === 'survey-response') {
                const surveyValidation = this.validateSurveyResponse(trial, index);
                errors.push(...surveyValidation.errors);
                warnings.push(...surveyValidation.warnings);
            }
        });

        return { errors, warnings };
    }

    validateSurveyResponse(trial, trialIndex) {
        const errors = [];
        const warnings = [];

        const allowEmpty = !!trial?.allow_empty_on_timeout;
        const timeoutRaw = trial?.timeout_ms;
        const hasTimeout = timeoutRaw !== undefined && timeoutRaw !== null && timeoutRaw !== '';
        const timeout = hasTimeout ? Number(timeoutRaw) : null;

        if (allowEmpty) {
            if (timeout === null || !Number.isFinite(timeout) || timeout <= 0) {
                errors.push(`Trial ${trialIndex}: survey-response allow_empty_on_timeout=true requires a positive timeout_ms`);
            }
        } else {
            // If timeout is provided but allowEmpty is false, it's harmless; just warn.
            if (hasTimeout && Number.isFinite(timeout) && timeout > 0) {
                warnings.push(`Trial ${trialIndex}: survey-response has timeout_ms set but allow_empty_on_timeout is false (timeout will be ignored)`);
            }
        }

        const questions = trial?.questions;
        if (!Array.isArray(questions)) {
            errors.push(`Trial ${trialIndex}: survey-response 'questions' must be an array`);
            return { errors, warnings };
        }
        if (questions.length === 0) {
            warnings.push(`Trial ${trialIndex}: survey-response has no questions`);
            return { errors, warnings };
        }

        const seenIds = new Set();
        const knownTypes = new Set(['likert', 'radio', 'text', 'slider', 'number']);

        questions.forEach((q, qi) => {
            if (!q || typeof q !== 'object') {
                errors.push(`Trial ${trialIndex} question ${qi}: must be an object`);
                return;
            }

            const id = (q.id ?? '').toString().trim();
            const type = (q.type ?? '').toString().trim();
            const prompt = (q.prompt ?? '').toString().trim();

            if (!id) {
                errors.push(`Trial ${trialIndex} question ${qi}: missing id`);
            } else if (seenIds.has(id)) {
                errors.push(`Trial ${trialIndex} question ${qi}: duplicate id '${id}'`);
            } else {
                seenIds.add(id);
            }

            if (!type) {
                errors.push(`Trial ${trialIndex} question ${qi} (${id || 'no-id'}): missing type`);
            } else if (!knownTypes.has(type)) {
                warnings.push(`Trial ${trialIndex} question ${qi} (${id || 'no-id'}): unknown type '${type}'`);
            }

            if (!prompt) {
                warnings.push(`Trial ${trialIndex} question ${qi} (${id || 'no-id'}): empty prompt`);
            }

            if (type === 'likert' || type === 'radio') {
                if (!Array.isArray(q.options) || q.options.length < 2) {
                    errors.push(`Trial ${trialIndex} question ${qi} (${id || 'no-id'}): '${type}' requires options (at least 2)`);
                }
            }

            if (type === 'slider') {
                const min = Number(q.min);
                const max = Number(q.max);
                const step = Number(q.step);
                if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
                    errors.push(`Trial ${trialIndex} question ${qi} (${id || 'no-id'}): slider requires numeric min < max`);
                }
                if (!Number.isFinite(step) || step <= 0) {
                    errors.push(`Trial ${trialIndex} question ${qi} (${id || 'no-id'}): slider requires positive step`);
                }
            }

            if (type === 'number') {
                if (q.min !== undefined && q.min !== null && q.min !== '' && !Number.isFinite(Number(q.min))) {
                    errors.push(`Trial ${trialIndex} question ${qi} (${id || 'no-id'}): number min must be numeric`);
                }
                if (q.max !== undefined && q.max !== null && q.max !== '' && !Number.isFinite(Number(q.max))) {
                    errors.push(`Trial ${trialIndex} question ${qi} (${id || 'no-id'}): number max must be numeric`);
                }
                if (q.step !== undefined && q.step !== null && q.step !== '' && !Number.isFinite(Number(q.step))) {
                    errors.push(`Trial ${trialIndex} question ${qi} (${id || 'no-id'}): number step must be numeric`);
                }
            }

            if (type === 'text') {
                if (q.rows !== undefined && q.rows !== null && q.rows !== '') {
                    const rows = Number.parseInt(q.rows, 10);
                    if (!Number.isFinite(rows) || rows < 1) {
                        errors.push(`Trial ${trialIndex} question ${qi} (${id || 'no-id'}): rows must be an integer >= 1`);
                    }
                }
            }
        });

        return { errors, warnings };
    }

    /**
     * Validate trial against plugin schema
     */
    validateTrialAgainstSchema(trial, schema, trialIndex) {
        const errors = [];
        const warnings = [];

        const trialForValidation = this.normalizeTrialForValidation(trial, schema);

        // Check required parameters
        for (const [paramName, paramDef] of Object.entries(schema.parameters)) {
            if (paramDef.required && !(paramName in trialForValidation)) {
                errors.push(`Trial ${trialIndex}: Missing required parameter '${paramName}'`);
            }
        }

        // Validate parameter types
        for (const [paramName, value] of Object.entries(trialForValidation)) {
            if (paramName === 'type') continue; // Skip type field
            
            if (schema.parameters[paramName]) {
                const paramDef = schema.parameters[paramName];
                const validation = this.validateParameter(value, paramDef, paramName, trialIndex);
                errors.push(...validation.errors);
                warnings.push(...validation.warnings);
            } else {
                // Avoid noisy warnings for known "export-only" fields.
                const isExportOnly = (
                    trial.type === 'block' &&
                    ['component_type', 'length', 'parameter_windows', 'parameter_values', 'response_parameters_override', 'seed'].includes(paramName)
                );
                const isRdmExportOnly = (
                    trial.type && trial.type.startsWith('rdm-') &&
                    (paramName === 'response_parameters_override')
                );
                if (!isExportOnly && !isRdmExportOnly) {
                    warnings.push(`Trial ${trialIndex}: Unknown parameter '${paramName}' for plugin '${trial.type}'`);
                }
            }
        }

        return { errors, warnings };
    }

    /**
     * Normalizes known exported shapes to the editor-schema parameter names
     * so validation doesn't fail due to naming differences.
     */
    normalizeTrialForValidation(trial, schema) {
        if (!trial || typeof trial !== 'object') {
            return trial;
        }

        // Shallow clone so we don't mutate the exported config.
        const normalized = { ...trial };

        // Blocks export as { component_type, length, ... } but the editor schema uses
        // { block_component_type, block_length, ... }.
        if (normalized.type === 'block') {
            if (normalized.component_type !== undefined && normalized.block_component_type === undefined) {
                normalized.block_component_type = normalized.component_type;
            }
            if (normalized.length !== undefined && normalized.block_length === undefined) {
                normalized.block_length = normalized.length;
            }
        }

        // Future-proofing: if we ever validate against a schema that expects block_* but we have export names.
        if (schema?.name === 'block') {
            if (normalized.component_type !== undefined && normalized.block_component_type === undefined) {
                normalized.block_component_type = normalized.component_type;
            }
            if (normalized.length !== undefined && normalized.block_length === undefined) {
                normalized.block_length = normalized.length;
            }
        }

        return normalized;
    }

    /**
     * Validate parameter against jsPsych parameter definition
     */
    validateParameter(value, paramDef, paramName, trialIndex) {
        const errors = [];
        const warnings = [];

        // Check if array is required
        if (paramDef.array && !Array.isArray(value)) {
            errors.push(`Trial ${trialIndex}: Parameter '${paramName}' should be an array`);
            return { errors, warnings };
        }

        // For non-array values, validate the type
        const valuesToCheck = paramDef.array ? value : [value];
        
        for (const val of valuesToCheck) {
            if (!this.isValidParameterType(val, paramDef.type)) {
                errors.push(`Trial ${trialIndex}: Parameter '${paramName}' has invalid type. Expected ${paramDef.type}`);
            }
        }

        return { errors, warnings };
    }

    /**
     * Check if value matches jsPsych parameter type
     */
    isValidParameterType(value, expectedType) {
        switch (expectedType) {
            case this.parameterTypes.STRING:
                return typeof value === 'string';
            
            case this.parameterTypes.HTML_STRING:
                return typeof value === 'string';
            
            case this.parameterTypes.INT:
                return typeof value === 'number' && Number.isInteger(value);
            
            case this.parameterTypes.FLOAT:
                return typeof value === 'number';
            
            case this.parameterTypes.BOOL:
                return typeof value === 'boolean';
            
            case this.parameterTypes.FUNCTION:
                return typeof value === 'function' || typeof value === 'string';
            
            case this.parameterTypes.KEY:
                return typeof value === 'string';
            
            case this.parameterTypes.KEYS:
                return typeof value === 'string' || Array.isArray(value);
            
            case this.parameterTypes.IMAGE:
            case this.parameterTypes.AUDIO:
            case this.parameterTypes.VIDEO:
                return typeof value === 'string';
            
            case this.parameterTypes.OBJECT:
                return typeof value === 'object' && value !== null;
            
            case this.parameterTypes.TIMELINE:
                return Array.isArray(value);
            
            case this.parameterTypes.COMPLEX:
                return true; // Accept any type for complex parameters
            
            default:
                return true; // Unknown types are accepted
        }
    }

    /**
     * Validate data collection configuration
     */
    validateDataCollection(dataCollection) {
        const errors = [];
        const warnings = [];

        // Keep this aligned with the UI checkboxes in index.html.
        // Include mouse-tracking for backward compatibility with older configs.
        const validModalities = [
            'reaction-time',
            'accuracy',
            'correctness',
            'eye-tracking',
            'mouse-tracking'
        ];

        for (const [modality, enabled] of Object.entries(dataCollection)) {
            if (!validModalities.includes(modality)) {
                warnings.push(`Unknown data collection modality: ${modality}`);
                continue;
            }

            if (typeof enabled !== 'boolean') {
                errors.push(`Data collection modality '${modality}' should be boolean, got ${typeof enabled}`);
            }
        }

        // Don’t hard-error if none selected; allow "no extra collection" configurations
        const anySelected = validModalities.some(m => dataCollection[m] === true);
        if (!anySelected) {
            warnings.push('No data collection modalities selected');
        }

        return { errors, warnings };
    }

    /**
     * Get schema information for a specific plugin
     */
    getPluginSchema(pluginName) {
        let schema = null;

        // Handle RDM components directly - don't depend on external RDMTaskSchema
        if (pluginName && pluginName.startsWith('rdm-')) {
            schema = this.generateRDMPluginSchema(pluginName);
        } else {
            schema = this.pluginSchemas[pluginName] || null;
        }

        if (!schema) return null;

        // Inject common per-trial parameters for all plugins without mutating the base schema.
        // Also strip legacy DRT toggles that should no longer be present.
        const common = this.getCommonTrialParameters();
        const merged = {
            ...common,
            ...(schema.parameters || {})
        };
        if (merged.detection_response_task_enabled !== undefined) {
            delete merged.detection_response_task_enabled;
        }

        return {
            ...schema,
            parameters: merged
        };
    }

    /**
     * Generate plugin schema format for RDM components
     */
    generateRDMPluginSchema(componentType) {
        const responseOverrideParameters = {
            response_device: {
                type: this.parameterTypes.SELECT,
                default: 'inherit',
                options: ['inherit', 'keyboard', 'mouse', 'touch', 'voice', 'custom'],
                description: 'Override response device for this component (inherit uses experiment defaults)'
            },
            response_keys: {
                type: this.parameterTypes.STRING,
                default: '',
                description: 'Comma-separated keys for keyboard responses (blank = inherit)'
            },
            require_response_mode: {
                type: this.parameterTypes.SELECT,
                default: 'inherit',
                options: ['inherit', 'true', 'false'],
                description: 'Override require_response for this component'
            },
            end_condition_on_response_mode: {
                type: this.parameterTypes.SELECT,
                default: 'inherit',
                options: ['inherit', 'true', 'false'],
                description: 'Continuous mode only: end the current condition immediately after a response'
            },
            feedback_mode: {
                type: this.parameterTypes.SELECT,
                default: 'inherit',
                options: ['inherit', 'off', 'corner-text', 'arrow', 'custom'],
                description: 'Override response feedback for this component (inherit uses experiment defaults)'
            },
            feedback_duration_ms: {
                type: this.parameterTypes.INT,
                default: 500,
                description: 'Feedback duration (ms) when feedback_mode is enabled (corner-text/arrow/custom)'
            },
            mouse_segments: {
                type: this.parameterTypes.INT,
                default: 2,
                description: 'Mouse response: number of aperture segments (used when response_device = mouse)'
            },
            mouse_start_angle_deg: {
                type: this.parameterTypes.FLOAT,
                default: 0,
                description: 'Mouse response: segment start angle offset in degrees (0=right; 90=down; 180=left; 270=up). Angles increase clockwise (screen/canvas coordinates).'
            },
            mouse_selection_mode: {
                type: this.parameterTypes.SELECT,
                default: 'click',
                options: ['click', 'hover'],
                description: 'Mouse response: how a segment selection is registered'
            }
        };

        const baseParameters = {
            coherence: { 
                type: this.parameterTypes.FLOAT, 
                default: 0.5, 
                required: true,
                description: 'Motion coherence (0-1)'
            },
            direction: { 
                type: this.parameterTypes.FLOAT, 
                default: 0, 
                required: true,
                description: 'Motion direction in degrees (0-359; 0=right, 90=down, 180=left, 270=up)'
            },
            speed: { 
                type: this.parameterTypes.FLOAT, 
                default: 6,
                // Not required because the builder also provides experiment-wide motion defaults.
                required: false,
                description: 'Dot movement speed'
            },
            stimulus_duration: { 
                type: this.parameterTypes.INT, 
                default: 1500,
                // Not required because the builder also provides experiment-wide timing defaults.
                required: false,
                description: 'Stimulus duration in milliseconds'
            },
            trial_duration: { 
                type: this.parameterTypes.INT, 
                default: 3000, 
                description: 'Duration of this trial condition in continuous mode (ms)'
            },
            transition_duration: { 
                type: this.parameterTypes.INT, 
                default: 500,
                description: 'Duration of smooth transition to next condition (ms)'
            },
            transition_type: {
                type: this.parameterTypes.SELECT,
                default: 'both',
                options: ['both', 'color', 'speed'],
                description: 'Transition type (continuous mode only): color = gradient, speed = slow/fast, both = combine'
            },
            total_dots: { 
                type: this.parameterTypes.INT, 
                default: 150,
                description: 'Total number of dots'
            },
            dot_size: { 
                type: this.parameterTypes.FLOAT, 
                default: 4,
                description: 'Size of individual dots in pixels'
            },
            dot_color: {
                type: this.parameterTypes.COLOR,
                default: '#FFFFFF',
                description: 'Color of the dots'
            },
            aperture_diameter: { 
                type: this.parameterTypes.FLOAT, 
                default: 350,
                description: 'Aperture diameter in pixels'
            },

            // Aperture outline overrides (per-component)
            show_aperture_outline_mode: {
                type: this.parameterTypes.SELECT,
                default: 'inherit',
                options: ['inherit', 'true', 'false'],
                description: 'Aperture outline override (inherit uses experiment-wide aperture_parameters)'
            },
            aperture_outline_width: {
                type: this.parameterTypes.FLOAT,
                default: 2,
                description: 'Outline width (px) when overriding outline visibility'
            },
            aperture_outline_color: {
                type: this.parameterTypes.COLOR,
                default: '#FFFFFF',
                description: 'Outline color when overriding outline visibility'
            },
            ...responseOverrideParameters
        };

        switch (componentType) {
            case 'rdm-trial':
                return {
                    name: 'rdm-trial',
                    parameters: baseParameters
                };

            case 'rdm-practice':
                return {
                    name: 'rdm-practice',
                    description: 'Practice RDM trial with feedback',
                    parameters: {
                        ...baseParameters,
                        feedback: { 
                            type: this.parameterTypes.SELECT,
                            default: 'accuracy',
                            options: ['accuracy', 'detailed', 'none'],
                            description: 'Type of feedback to show'
                        },
                        feedback_duration: { 
                            type: this.parameterTypes.INT, 
                            default: 1000,
                            description: 'Feedback display duration in ms'
                        },
                        show_feedback: { 
                            type: this.parameterTypes.BOOL, 
                            default: true,
                            description: 'Whether to show feedback'
                        }
                    }
                };

            case 'rdm-dot-groups':
                return {
                    name: 'rdm-dot-groups',
                    description: 'RDM trial with multiple dot groups',
                    parameters: {
                        group_speed_mode: {
                            type: this.parameterTypes.SELECT,
                            default: 'shared',
                            options: ['shared', 'per-group'],
                            description: 'Use a shared speed (from experiment defaults) or set different speeds per group'
                        },
                        group_1_speed: {
                            type: this.parameterTypes.FLOAT,
                            default: 5,
                            description: 'Dot speed for group 1 (px/frame) when group_speed_mode = per-group'
                        },
                        group_2_speed: {
                            type: this.parameterTypes.FLOAT,
                            default: 5,
                            description: 'Dot speed for group 2 (px/frame) when group_speed_mode = per-group'
                        },
                        response_target_group: {
                            type: this.parameterTypes.SELECT,
                            default: 'none',
                            options: ['none', 'group_1', 'group_2'],
                            description: 'Which dot group the participant should respond to'
                        },
                        cue_border_mode: {
                            type: this.parameterTypes.SELECT,
                            default: 'off',
                            options: ['off', 'target-group-color', 'custom'],
                            description: 'Aperture border cue mode for response target group'
                        },
                        cue_border_color: {
                            type: this.parameterTypes.COLOR,
                            default: '#FFFFFF',
                            description: 'Cue border color when cue_border_mode = custom'
                        },
                        cue_border_width: {
                            type: this.parameterTypes.INT,
                            default: 4,
                            description: 'Cue border width in pixels'
                        },
                        group_1_percentage: { 
                            type: this.parameterTypes.FLOAT, 
                            default: 50,
                            description: 'Percentage of dots in group 1 (0-100)'
                        },
                        group_1_color: { 
                            type: this.parameterTypes.COLOR, 
                            default: '#FF0066',
                            description: 'Color for group 1 dots (hex format)'
                        },
                        group_1_coherence: { 
                            type: this.parameterTypes.FLOAT, 
                            default: 0.2,
                            description: 'Motion coherence for group 1 (0-1)'
                        },
                        group_1_direction: {
                            type: this.parameterTypes.INT,
                            default: 0,
                            description: 'Motion direction for coherent dots in group 1 (degrees 0-359; 0=right, 90=down, 180=left, 270=up)'
                        },
                        group_2_percentage: { 
                            type: this.parameterTypes.FLOAT, 
                            default: 50,
                            description: 'Percentage of dots in group 2 (0-100)'
                        },
                        group_2_color: { 
                            type: this.parameterTypes.COLOR, 
                            default: '#0066FF',
                            description: 'Color for group 2 dots (hex format)'
                        },
                        group_2_coherence: { 
                            type: this.parameterTypes.FLOAT, 
                            default: 0.8,
                            description: 'Motion coherence for group 2 (0-1)'
                        },
                        group_2_direction: {
                            type: this.parameterTypes.INT,
                            default: 180,
                            description: 'Motion direction for coherent dots in group 2 (degrees 0-359; 0=right, 90=down, 180=left, 270=up)'
                        },
                        total_dots: { 
                            type: this.parameterTypes.INT, 
                            default: 200,
                            description: 'Total number of dots across all groups'
                        },
                        trial_duration: { 
                            type: this.parameterTypes.INT, 
                            default: 3000,
                            description: 'Duration of this trial condition in continuous mode (ms)'
                        },
                        transition_duration: { 
                            type: this.parameterTypes.INT, 
                            default: 500,
                            description: 'Duration of smooth transition to next condition (ms)'
                        },
                        transition_type: {
                            type: this.parameterTypes.SELECT,
                            default: 'both',
                            options: ['both', 'color', 'speed'],
                            description: 'Transition type (continuous mode only): color = gradient, speed = slow/fast, both = combine'
                        },
                        transition_type: {
                            type: this.parameterTypes.SELECT,
                            default: 'both',
                            options: ['both', 'color', 'speed'],
                            description: 'Transition type (continuous mode only): color = gradient, speed = slow/fast, both = combine'
                        },
                        aperture_diameter: { 
                            type: this.parameterTypes.FLOAT, 
                            default: 350,
                            description: 'Aperture diameter in pixels'
                        },

                        // Aperture outline overrides (per-component)
                        show_aperture_outline_mode: {
                            type: this.parameterTypes.SELECT,
                            default: 'inherit',
                            options: ['inherit', 'true', 'false'],
                            description: 'Aperture outline override (inherit uses experiment-wide aperture_parameters)'
                        },
                        aperture_outline_width: {
                            type: this.parameterTypes.FLOAT,
                            default: 2,
                            description: 'Outline width (px) when overriding outline visibility'
                        },
                        aperture_outline_color: {
                            type: this.parameterTypes.COLOR,
                            default: '#FFFFFF',
                            description: 'Outline color when overriding outline visibility'
                        },
                        ...responseOverrideParameters
                    }
                };

            case 'rdm-adaptive':
                return {
                    name: 'rdm-adaptive',
                    description: 'Adaptive RDM trial with QUEST or staircase',
                    parameters: {
                        algorithm: { 
                            type: this.parameterTypes.SELECT,
                            default: 'quest',
                            options: ['quest', 'staircase', 'simple'],
                            required: true,
                            description: 'Adaptive algorithm to use'
                        },
                        target_performance: { 
                            type: this.parameterTypes.FLOAT, 
                            default: 0.82,
                            description: 'Target performance level (0.5-1.0)'
                        },
                        initial_coherence: { 
                            type: this.parameterTypes.FLOAT, 
                            default: 0.1,
                            description: 'Initial coherence estimate (0-1)'
                        },
                        step_size: { 
                            type: this.parameterTypes.FLOAT, 
                            default: 0.05,
                            description: 'Step size for adjustments'
                        },
                        direction: { 
                            type: this.parameterTypes.FLOAT, 
                            default: 0,
                            description: 'Motion direction in degrees (0-359)'
                        },
                        speed: { 
                            type: this.parameterTypes.FLOAT, 
                            default: 6,
                            description: 'Dot movement speed'
                        },
                        stimulus_duration: { 
                            type: this.parameterTypes.INT, 
                            default: 1500,
                            description: 'Stimulus duration in milliseconds'
                        },
                        trial_duration: { 
                            type: this.parameterTypes.INT, 
                            default: 3000,
                            description: 'Duration of this trial condition in continuous mode (ms)'
                        },
                        transition_duration: { 
                            type: this.parameterTypes.INT, 
                            default: 500,
                            description: 'Duration of smooth transition to next condition (ms)'
                        },
                        total_dots: { 
                            type: this.parameterTypes.INT, 
                            default: 150,
                            description: 'Total number of dots'
                        },
                        dot_color: {
                            type: this.parameterTypes.COLOR,
                            default: '#FFFFFF',
                            description: 'Color of the dots'
                        },
                        ...responseOverrideParameters
                    }
                };

            default:
                return null;
        }
    }

    /**
     * Get all available plugin schemas
     */
    getAllPluginSchemas() {
        return Object.keys(this.pluginSchemas);
    }

    /**
     * Get parameter information for a specific plugin
     */
    getPluginParameters(pluginName) {
        const schema = this.pluginSchemas[pluginName];
        return schema ? schema.parameters : null;
    }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = JSPsychSchemas;
}