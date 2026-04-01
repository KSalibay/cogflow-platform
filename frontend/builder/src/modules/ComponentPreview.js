/**
 * Component Preview Module
 * Provides live visual preview of RDM components with real-time parameter visualization
 */
class ComponentPreview {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.animationId = null;
        this.isRunning = false;
        this.isPaused = false;
        
        // Dot motion parameters
        this.dots = [];
        this.parameters = {};
        this.frameCount = 0;
        this.startTime = 0;
        this.lastFrameTime = 0;
        this.frameRate = 0;

        // Block preview sampling state
        this.blockPreviewSource = null;
        this.blockPreviewSeed = null;
        this.blockPreviewRngState = null;
        
        this.initializePreview();
        this.setupEventListeners();
    }

    getPreviewModal() {
        const modalEl = document.getElementById('componentPreviewModal');
        if (!modalEl) {
            console.warn('componentPreviewModal not found');
            return null;
        }

        // IMPORTANT: use a single Modal instance to avoid stacking backdrops
        // when re-rendering the preview (e.g., Block Resample).
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        return { modalEl, modal };
    }
    
    initializePreview() {
        this.canvas = document.getElementById('previewCanvas');
        if (!this.canvas) return;
        
        this.ctx = this.canvas.getContext('2d');
        
        // Set default parameters
        this.parameters = {
            canvas_width: 600,
            canvas_height: 600,
            aperture_shape: 'circle',
            aperture_size: 300,
            background_color: '#000000',
            dot_size: 4,
            dot_color: '#ffffff',
            total_dots: 150,
            coherent_direction: 0, // degrees
            coherence: 0.5, // 50% coherent
            speed: 5, // pixels per frame
            lifetime_frames: 60, // 1 second at 60fps
            noise_type: 'random_direction'
        };
        
        this.initializeDots();
    }
    
    setupEventListeners() {
        // Use .onclick to avoid stacking listeners when the modal content is restored.
        const startBtn = document.getElementById('startPreviewBtn');
        const pauseBtn = document.getElementById('pausePreviewBtn');
        const stopBtn = document.getElementById('stopPreviewBtn');
        const resetBtn = document.getElementById('resetPreviewBtn');

        if (startBtn) startBtn.onclick = () => this.startPreview();
        if (pauseBtn) pauseBtn.onclick = () => this.pausePreview();
        if (stopBtn) stopBtn.onclick = () => this.stopPreview();
        if (resetBtn) resetBtn.onclick = () => this.resetPreview();
    }
    
    showPreview(componentData) {
        // Check component type to determine preview type
        const componentType = componentData?.type || 'unknown';
        
        console.log('🔍 ComponentPreview.showPreview() called with componentType:', componentType);
        console.log('   Full componentData:', componentData);
        
        // Simple, direct routing like the Figma prototype
        if (componentType === 'detection-response-task-start') {
            this.showDrtStartPreview(componentData);
        } else if (componentType === 'detection-response-task-stop') {
            this.showDrtStopPreview(componentData);
        } else if (componentType === 'html-keyboard-response') {
            // Instructions component - show the actual stimulus text
            const stimulusText = componentData.stimulus || 'No instructions text provided';
            this.showInstructionsPreview(stimulusText, componentData);
        } else if (componentType === 'html-button-response') {
            this.showHtmlButtonResponsePreview(componentData);
        } else if (componentType === 'image-keyboard-response') {
            this.showImageKeyboardResponsePreview(componentData);
        } else if (componentType === 'continuous-image-presentation') {
            this.showContinuousImagePresentationPreview(componentData);
        } else if (componentType === 'visual-angle-calibration') {
            this.showVisualAngleCalibrationPreview(componentData);
        } else if (componentType === 'reward-settings') {
            this.showRewardSettingsPreview(componentData);
        } else if (componentType === 'flanker-trial') {
            this.showFlankerPreview(componentData);
        } else if (componentType === 'gabor-trial' || componentType === 'gabor-quest' || componentType === 'gabor-learning') {
            console.log('   ✓ Routing to showGaborPreview for type:', componentType);
            this.showGaborPreview(componentData);
        } else if (componentType === 'sart-trial') {
            this.showSartPreview(componentData);
        } else if (componentType === 'stroop-trial' || componentType === 'emotional-stroop-trial') {
            this.showStroopPreview(componentData);
        } else if (componentType === 'simon-trial') {
            this.showSimonPreview(componentData);
        } else if (componentType === 'task-switching-trial') {
            this.showTaskSwitchingPreview(componentData);
        } else if (componentType === 'pvt-trial') {
            this.showPvtPreview(componentData);
        } else if (componentType === 'nback-trial-sequence') {
            this.showNbackTrialSequencePreview(componentData);
        } else if (componentType === 'nback-block') {
            this.showNbackBlockPreview(componentData);
        } else if (componentType === 'mot-trial') {
            this.showMotPreview(componentData);
        } else if (componentType === 'survey-response') {
            this.showSurveyPreview(componentData);
        } else if (componentType === 'soc-dashboard') {
            this.showSocDashboardPreview(componentData);
        } else if (componentType === 'soc-subtask-sart-like' ||
                   componentType === 'soc-subtask-flanker-like' ||
                   componentType === 'soc-subtask-nback-like' ||
                   componentType === 'soc-subtask-wcst-like' ||
                   componentType === 'soc-subtask-pvt-like') {
            const wrapped = this.wrapSocSubtaskAsSession(componentData);
            this.showSocDashboardPreview(wrapped);
        } else if (componentType === 'block') {
            this.showBlockPreview(componentData);
        } else if (componentType.includes('rdm') || 
                   componentType === 'psychophysics-rdm' || 
                   componentType === 'rdk' ||
                   (componentData.coherence !== undefined)) {
            console.log('   ⚠️  Routing to showRDMPreview; componentType=' + componentType + ', has coherence=' + (componentData.coherence !== undefined));
            this.showRDMPreview(componentData);
        } else {
            console.warn('Unknown component type for preview:', componentType);
            this.showGenericPreview(componentData);
        }
    }

    showDrtStartPreview(componentData) {
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modalEl, modal } = previewModal;

        const modalBody = modalEl.querySelector('.modal-body');
        if (!modalBody) return;

        const escape = (s) => {
            return (s ?? '')
                .toString()
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        const displayMode = (componentData.drt_display_mode ?? 'corner_dot').toString().trim().toLowerCase() === 'screen_border'
            ? 'screen_border'
            : 'corner_dot';
        const location = (componentData.location ?? 'top-right').toString();
        const sizePx = Number.isFinite(Number(componentData.size_px)) ? Number(componentData.size_px) : 18;
        const color = (componentData.stimulus_color ?? '#ff3b3b').toString() || '#ff3b3b';
        const shape = (componentData.stimulus_type ?? 'square').toString().toLowerCase() === 'circle' ? 'circle' : 'square';
        const key = (componentData.response_key ?? 'space').toString() || 'space';

        const minIti = Number.isFinite(Number(componentData.min_iti_ms)) ? Number(componentData.min_iti_ms) : 3000;
        const maxIti = Number.isFinite(Number(componentData.max_iti_ms)) ? Number(componentData.max_iti_ms) : 5000;
        const stimDur = Number.isFinite(Number(componentData.stimulus_duration_ms)) ? Number(componentData.stimulus_duration_ms) : 1000;
        const minRt = Number.isFinite(Number(componentData.min_rt_ms)) ? Number(componentData.min_rt_ms) : 100;
        const maxRt = Number.isFinite(Number(componentData.max_rt_ms)) ? Number(componentData.max_rt_ms) : 2000;

        const posCss = (() => {
            const margin = 18;
            if (location === 'top-left') return `left:${margin}px; top:${margin}px;`;
            if (location === 'bottom-left') return `left:${margin}px; bottom:${margin}px;`;
            if (location === 'bottom-right') return `right:${margin}px; bottom:${margin}px;`;
            return `right:${margin}px; top:${margin}px;`;
        })();

        modalBody.innerHTML = `
            <div class="p-3">
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <div>
                        <div class="h5 mb-0">DRT Start Preview</div>
                        <div class="small text-muted">Response key: <span class="badge bg-secondary">${escape(key)}</span></div>
                        <div class="small text-muted">Display mode: <span class="badge bg-light text-dark">${escape(displayMode)}</span></div>
                    </div>
                    <div class="small text-muted text-end">
                        ITI: ${escape(minIti)}–${escape(maxIti)} ms<br/>
                        Stimulus: ${escape(stimDur)} ms<br/>
                        RT window: ${escape(minRt)}–${escape(maxRt)} ms
                    </div>
                </div>

                <div class="position-relative border rounded overflow-hidden" style="height:260px;">
                    ${displayMode === 'screen_border'
                        ? `<div class="position-absolute" style="inset:10px; border:${escape(sizePx)}px solid ${escape(color)}; border-radius:6px;"></div>`
                        : `<div class="position-absolute" style="${posCss}"><div style="width:${escape(sizePx)}px; height:${escape(sizePx)}px; background:${escape(color)}; border-radius:${shape === 'circle' ? '999px' : '0px'};"></div></div>`}
                    <div class="small text-muted position-absolute" style="left:18px; bottom:18px;">
                        Static preview (runtime will flash this stimulus periodically).
                    </div>
                </div>
            </div>
        `;

        modal.show();
    }

    showDrtStopPreview(componentData) {
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modalEl, modal } = previewModal;

        const modalBody = modalEl.querySelector('.modal-body');
        if (!modalBody) return;

        modalBody.innerHTML = `
            <div class="p-3">
                <div class="h5 mb-2">DRT Stop</div>
                <div class="text-muted">Stops the background DRT stream started by a prior DRT Start.</div>
            </div>
        `;

        modal.show();
    }

    showNbackBlockPreview(componentData) {
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modalEl, modal } = previewModal;

        const modalBody = modalEl.querySelector('.modal-body');
        if (!modalBody) return;

        const escape = (s) => {
            return (s ?? '')
                .toString()
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        const n = Number.isFinite(Number(componentData?.n)) ? Number(componentData.n) : 2;
        const token = (componentData?.token ?? '').toString() || 'A';

        const renderMode = (componentData?.render_mode ?? 'token').toString().trim().toLowerCase();
        const templateHtml = (componentData?.stimulus_template_html ?? '<div style="font-size:72px; font-weight:700; text-align:center;">{{TOKEN}}</div>').toString();

        const responseParadigm = (componentData?.response_paradigm ?? 'go_nogo').toString().trim().toLowerCase();
        const responseDevice = (componentData?.response_device ?? 'keyboard').toString().trim().toLowerCase();
        const goKey = (componentData?.go_key ?? 'space').toString();
        const matchKey = (componentData?.match_key ?? 'j').toString();
        const nonmatchKey = (componentData?.nonmatch_key ?? 'f').toString();
        const showButtons = !!componentData?.show_buttons;

        const stimulusDuration = Number.isFinite(Number(componentData?.stimulus_duration_ms)) ? Number(componentData.stimulus_duration_ms) : 500;
        const isiDuration = Number.isFinite(Number(componentData?.isi_duration_ms)) ? Number(componentData.isi_duration_ms) : 500;
        const trialDuration = Number.isFinite(Number(componentData?.trial_duration_ms)) ? Number(componentData.trial_duration_ms) : (stimulusDuration + isiDuration);

        const stimulusHtml = (() => {
            if (renderMode === 'custom_html') {
                const withToken = templateHtml.includes('{{TOKEN}}')
                    ? templateHtml.split('{{TOKEN}}').join(escape(token))
                    : `${templateHtml}${escape(token)}`;
                return withToken;
            }
            return `<div style="font-size:72px; font-weight:700; text-align:center;">${escape(token)}</div>`;
        })();

        const responseHint = (() => {
            if (responseDevice === 'mouse') {
                if (showButtons) {
                    if (responseParadigm === '2afc') {
                        return `<div class="d-flex justify-content-center gap-2 mt-3">
                            <button class="btn btn-outline-light" type="button" disabled>Match</button>
                            <button class="btn btn-outline-light" type="button" disabled>No match</button>
                        </div>`;
                    }
                    return `<div class="d-flex justify-content-center gap-2 mt-3">
                        <button class="btn btn-outline-light" type="button" disabled>Go</button>
                    </div>`;
                }
                return `<div class="small text-muted mt-3">Mouse response (buttons hidden)</div>`;
            }

            if (responseParadigm === '2afc') {
                const mk = (matchKey ?? '').toString().trim() || goKey;
                return `<div class="small text-muted mt-3"><b>Keyboard:</b> <span class="badge bg-secondary">${escape(mk)}</span> = MATCH, <span class="badge bg-secondary">${escape(nonmatchKey)}</span> = NO MATCH</div>`;
            }
            return `<div class="small text-muted mt-3"><b>Keyboard:</b> <span class="badge bg-secondary">${escape(goKey)}</span> = GO</div>`;
        })();

        modalBody.innerHTML = `
            <div class="p-3" style="background:#0b1220; border-radius:12px; color:#e5e7eb;">
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <div>
                        <div class="h5 mb-0">N-back Item Preview</div>
                        <div class="small text-muted">n=${escape(n)} · ${escape(renderMode)} · ${escape(responseParadigm)} · ${escape(responseDevice)}</div>
                    </div>
                    <div class="text-end small text-muted">${escape(trialDuration)}ms total</div>
                </div>

                <div class="p-4" style="background:rgba(255,255,255,0.06); border-radius:12px;">
                    ${stimulusHtml}
                    ${responseHint}
                </div>
            </div>
        `;

        modal.show();
    }

    showNbackTrialSequencePreview(componentData) {
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modalEl, modal } = previewModal;

        const modalBody = modalEl.querySelector('.modal-body');
        if (!modalBody) return;

        const escape = (s) => {
            return (s ?? '')
                .toString()
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        const n = Number.isFinite(Number(componentData?.n)) ? Math.max(1, Math.floor(Number(componentData.n))) : 2;
        const length = Number.isFinite(Number(componentData?.length)) ? Math.max(1, Math.floor(Number(componentData.length))) : 30;
        const targetProb = Number.isFinite(Number(componentData?.target_probability)) ? Math.min(1, Math.max(0, Number(componentData.target_probability))) : 0.25;

        const stimulusMode = (componentData?.stimulus_mode ?? 'letters').toString().trim().toLowerCase();
        const stimulusPoolRaw = (componentData?.stimulus_pool ?? '').toString();
        const seedRaw = (componentData?.seed ?? '').toString();

        const parsePool = (raw) => {
            const parts = (raw ?? '')
                .toString()
                .split(/[\n,]/g)
                .map(s => s.trim())
                .filter(Boolean);
            if (parts.length > 0) return parts;
            if (stimulusMode === 'numbers') return ['1','2','3','4','5','6','7','8','9'];
            if (stimulusMode === 'shapes') return ['●','■','▲','◆','★','⬟'];
            if (stimulusMode === 'custom') return ['A','B','C'];
            return ['A','B','C','D','E','F','G','H'];
        };

        const pool = parsePool(stimulusPoolRaw);

        const hashSeed = (s) => {
            let h = 2166136261;
            const str = (s ?? 'preview').toString();
            for (let i = 0; i < str.length; i++) {
                h ^= str.charCodeAt(i);
                h = Math.imul(h, 16777619);
            }
            return h >>> 0;
        };

        const mulberry32 = (a) => {
            return function() {
                let t = (a += 0x6D2B79F5);
                t = Math.imul(t ^ (t >>> 15), t | 1);
                t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        };

        const rng = mulberry32(hashSeed(seedRaw || 'preview'));

        const pickFromPool = (avoidToken) => {
            if (!Array.isArray(pool) || pool.length === 0) return 'A';
            if (!avoidToken || pool.length === 1) return pool[Math.floor(rng() * pool.length)];
            let token = pool[Math.floor(rng() * pool.length)];
            let guard = 0;
            while (token === avoidToken && guard < 10) {
                token = pool[Math.floor(rng() * pool.length)];
                guard++;
            }
            return token;
        };

        const maxRows = Math.min(length, 20);
        const seq = [];
        const isTarget = [];
        for (let i = 0; i < length; i++) {
            if (i >= n && rng() < targetProb) {
                seq[i] = seq[i - n];
                isTarget[i] = true;
            } else {
                const avoid = (i >= n) ? seq[i - n] : null;
                seq[i] = pickFromPool(avoid);
                isTarget[i] = (i >= n) ? (seq[i] === seq[i - n]) : false;
            }
        }

        const rowsHtml = seq.slice(0, maxRows).map((t, i) => {
            const tag = isTarget[i]
                ? '<span class="badge bg-success">match</span>'
                : (i < n) ? '<span class="badge bg-secondary">buffer</span>' : '<span class="badge bg-dark">no</span>';
            return `
                <tr>
                    <td class="text-muted">${i + 1}</td>
                    <td style="font-weight:700; font-size:18px;">${escape(t)}</td>
                    <td>${tag}</td>
                </tr>
            `;
        }).join('');

        modalBody.innerHTML = `
            <div class="p-3">
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <div>
                        <div class="h5 mb-0">N-back Sequence Preview</div>
                        <div class="small text-muted">n=${escape(n)} · length=${escape(length)} · target_probability=${escape(targetProb)} · pool=${escape(pool.length)} items</div>
                    </div>
                    <div class="text-end small text-muted">seed=${escape(seedRaw || '(default)')}</div>
                </div>

                <div class="table-responsive">
                    <table class="table table-sm align-middle">
                        <thead>
                            <tr>
                                <th style="width:70px;">#</th>
                                <th>Token</th>
                                <th style="width:120px;">Match?</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
                <div class="small text-muted">Preview uses a local seeded generator for display only (interpreter generation may differ until compiler support is added).</div>
            </div>
        `;

        modal.show();
    }

    showSimonPreview(componentData) {
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modalEl, modal } = previewModal;

        const modalBody = modalEl.querySelector('.modal-body');
        if (!modalBody) return;

        const escape = (s) => {
            return (s ?? '')
                .toString()
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        const isHex = (s) => typeof s === 'string' && /^#([0-9a-fA-F]{6})$/.test(s.trim());

        const fallbackStimuli = (() => {
            try {
                const list = window.jsonBuilderInstance?.getCurrentSimonStimuliFromUI?.();
                return Array.isArray(list) ? list : [];
            } catch {
                return [];
            }
        })();

        const stimuli = Array.isArray(componentData?.simon_settings?.stimuli)
            ? componentData.simon_settings.stimuli
            : fallbackStimuli;

        const nameToHex = new Map(
            (Array.isArray(stimuli) ? stimuli : [])
                .filter(s => s && typeof s === 'object')
                .map(s => [String(s.name ?? '').trim().toLowerCase(), String(s.color ?? '').trim()])
                .filter(([k, v]) => !!k && !!v)
        );

        const resolveHexForName = (name) => {
            const raw = (name ?? '').toString().trim();
            if (isHex(raw)) return raw;
            const hit = nameToHex.get(raw.toLowerCase());
            return hit || '#ffffff';
        };

        const resolveInherit = (v, fallback) => {
            const s = (v ?? '').toString().trim();
            if (s === '' || s === 'inherit') return fallback;
            return s;
        };

        // For Block previews (and Trial previews that omit simon_settings), fall back to current UI defaults.
        const uiDefaults = (() => {
            try {
                return window.jsonBuilderInstance?.getCurrentSimonDefaults?.() || null;
            } catch {
                return null;
            }
        })();

        const defaults = (componentData?.simon_settings && typeof componentData.simon_settings === 'object')
            ? componentData.simon_settings
            : (uiDefaults?.simon_settings && typeof uiDefaults.simon_settings === 'object')
                ? uiDefaults.simon_settings
                : {};

        const side = (componentData?.stimulus_side ?? 'left').toString().trim().toLowerCase() === 'right' ? 'right' : 'left';
        const colorName = (componentData?.stimulus_color_name ?? stimuli?.[0]?.name ?? 'BLUE').toString();
        const colorHex = resolveHexForName(colorName);

        const responseDevice = resolveInherit(componentData?.response_device, defaults?.response_device || uiDefaults?.response_device || 'keyboard');
        const leftKey = resolveInherit(componentData?.left_key, defaults?.left_key || uiDefaults?.left_key || 'f');
        const rightKey = resolveInherit(componentData?.right_key, defaults?.right_key || uiDefaults?.right_key || 'j');
        const circleDiameterPx = Number.isFinite(Number(componentData?.circle_diameter_px))
            ? Number(componentData.circle_diameter_px)
            : (Number.isFinite(Number(defaults?.circle_diameter_px)) ? Number(defaults.circle_diameter_px) : 140);

        const noteText = (componentData?._previewContextNote ?? '').toString();
        const hasBlockSource = !!componentData?._blockPreviewSource;

        const mappingSwatches = (() => {
            const list = Array.isArray(stimuli) ? stimuli : [];
            const take = list.slice(0, 2);
            const items = take.map((s, idx) => {
                const n = (s?.name ?? `Stimulus ${idx + 1}`).toString();
                const h = resolveHexForName(n);
                const sideLabel = idx === 0 ? 'LEFT response' : 'RIGHT response';
                return `
                    <div class="d-inline-flex align-items-center me-3 mb-2" style="gap:8px;">
                        <span style="display:inline-block; width:14px; height:14px; border-radius:4px; background:${escape(h)}; border:1px solid rgba(255,255,255,0.22);"></span>
                        <span><b>${escape(n)}</b> → ${escape(sideLabel)}</span>
                    </div>
                `;
            }).join('');
            return items || '<div class="text-warning">No stimulus library available.</div>';
        })();

        const keyboardHintHtml = (responseDevice === 'keyboard')
            ? `<div class="small text-muted"><b>Keyboard:</b> <span class="badge bg-secondary">${escape(leftKey)}</span> = LEFT, <span class="badge bg-secondary">${escape(rightKey)}</span> = RIGHT</div>`
            : `<div class="small text-muted"><b>Mouse:</b> click LEFT or RIGHT circle</div>`;

        const circleStyle = `width:${circleDiameterPx}px; height:${circleDiameterPx}px; border-radius:999px; border:2px solid rgba(255,255,255,0.35);`;

        const body = `
            <div class="p-3">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <h5 class="mb-1">Simon Preview</h5>
                        <div class="small text-muted">Lightweight renderer</div>
                        ${noteText ? `<div class="small text-muted">${escape(noteText)}</div>` : ''}
                    </div>
                    <div class="text-end small text-muted">
                        <div><strong>Stimulus:</strong> ${escape(colorName)}</div>
                        <div><strong>Side:</strong> ${escape(side)}</div>
                        <div><strong>Response:</strong> ${escape(responseDevice)}</div>
                    </div>
                </div>

                <div class="border rounded mt-3 p-4 d-flex justify-content-center align-items-center" style="background:#111; color:#fff; min-height: 240px;">
                    <div style="display:flex; gap:64px; align-items:center; justify-content:center;">
                        <div style="${circleStyle} background:${side === 'left' ? escape(colorHex) : 'rgba(255,255,255,0.08)'};"></div>
                        <div style="${circleStyle} background:${side === 'right' ? escape(colorHex) : 'rgba(255,255,255,0.08)'};"></div>
                    </div>
                </div>

                <div class="mt-3">${keyboardHintHtml}</div>
                <div class="mt-2 small text-muted">${mappingSwatches}</div>

                <div class="mt-3 small text-muted d-flex justify-content-between align-items-center">
                    <div>${escape((componentData?.detection_response_task_enabled ? 'DRT enabled' : ''))}</div>
                    ${hasBlockSource ? `<button type="button" class="btn btn-sm btn-outline-secondary" id="simonResampleBtn"><i class="fas fa-dice"></i> Resample</button>` : ''}
                </div>
            </div>
        `;

        modalBody.innerHTML = body;

        if (hasBlockSource) {
            const btn = modalBody.querySelector('#simonResampleBtn');
            if (btn) {
                btn.onclick = () => {
                    const sampled = this.sampleComponentFromBlock(componentData._blockPreviewSource);
                    const baseType = componentData._blockPreviewSource.block_component_type || componentData._blockPreviewSource.component_type || 'simon-trial';
                    const length = componentData._blockPreviewSource.block_length ?? componentData._blockPreviewSource.length ?? 0;
                    const sampling = componentData._blockPreviewSource.sampling_mode || 'per-trial';
                    sampled._previewContextNote = `Block sample → ${baseType} (length ${length}, ${sampling})`;
                    sampled._blockPreviewSource = componentData._blockPreviewSource;
                    this.showSimonPreview(sampled);
                };
            }
        }

        modal.show();
    }

    showTaskSwitchingPreview(componentData) {
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modalEl, modal } = previewModal;

        const modalBody = modalEl.querySelector('.modal-body');
        if (!modalBody) return;

        const escape = (s) => {
            return (s ?? '')
                .toString()
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        const stim1 = (componentData?.stimulus_task_1 ?? '').toString().trim();
        const stim2 = (componentData?.stimulus_task_2 ?? '').toString().trim();
        const fallbackStimulus = (componentData?.stimulus ?? 'A').toString();
        const stimulus = (stim1 && stim2) ? `${stim1} ${stim2}` : fallbackStimulus;
        const position = (componentData?.stimulus_position ?? 'top').toString();
        const borderEnabled = !!componentData?.border_enabled;
        const leftKey = (componentData?.left_key ?? 'f').toString();
        const rightKey = (componentData?.right_key ?? 'j').toString();
        const taskIndex = Number.isFinite(Number(componentData?.task_index)) ? Number(componentData.task_index) : 1;

        const noteText = (componentData?._previewContextNote ?? '').toString();
        const hasBlockSource = !!componentData?._blockPreviewSource;

        const posCss = (() => {
            const m = 18;
            if (position === 'left') return `left:${m}px; top:50%; transform:translateY(-50%);`;
            if (position === 'right') return `right:${m}px; top:50%; transform:translateY(-50%);`;
            if (position === 'bottom') return `left:50%; bottom:${m}px; transform:translateX(-50%);`;
            return `left:50%; top:${m}px; transform:translateX(-50%);`;
        })();

        modalBody.innerHTML = `
            <div class="p-3">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <h5 class="mb-1">Task Switching Preview</h5>
                        <div class="small text-muted">Lightweight renderer</div>
                        ${noteText ? `<div class="small text-muted">${escape(noteText)}</div>` : ''}
                    </div>
                    <div class="text-end small text-muted">
                        <div><strong>Task:</strong> ${escape(taskIndex)}</div>
                        <div><strong>Position:</strong> ${escape(position)}</div>
                    </div>
                </div>

                <div class="border rounded mt-3 p-4 position-relative" style="background:#111; color:#fff; min-height: 260px;">
                    <div class="position-absolute" style="${posCss}">
                        <div style="min-width:72px; min-height:72px; display:flex; align-items:center; justify-content:center; font-size:56px; font-weight:700; ${borderEnabled ? 'border:2px solid rgba(255,255,255,0.35); border-radius:12px; padding:8px 12px;' : ''}">
                            ${escape(stimulus)}
                        </div>
                    </div>

                    <div class="small text-muted position-absolute" style="left:18px; bottom:18px;">
                        Keys: <span class="badge bg-secondary">${escape(leftKey)}</span> / <span class="badge bg-secondary">${escape(rightKey)}</span>
                    </div>
                </div>

                <div class="mt-2 small text-muted">Static preview (runtime determines correctness based on configured task rule).</div>

                <div class="mt-3 small text-muted d-flex justify-content-between align-items-center">
                    <div></div>
                    ${hasBlockSource ? `<button type="button" class="btn btn-sm btn-outline-secondary" id="taskSwitchingResampleBtn"><i class="fas fa-dice"></i> Resample</button>` : ''}
                </div>
            </div>
        `;

        if (hasBlockSource) {
            const btn = modalBody.querySelector('#taskSwitchingResampleBtn');
            if (btn) {
                btn.onclick = () => {
                    const sampled = this.sampleComponentFromBlock(componentData._blockPreviewSource);
                    const baseType = componentData._blockPreviewSource.block_component_type || componentData._blockPreviewSource.component_type || 'task-switching-trial';
                    const length = componentData._blockPreviewSource.block_length ?? componentData._blockPreviewSource.length ?? 0;
                    const sampling = componentData._blockPreviewSource.sampling_mode || 'per-trial';
                    sampled._previewContextNote = `Block sample → ${baseType} (length ${length}, ${sampling})`;
                    sampled._blockPreviewSource = componentData._blockPreviewSource;
                    this.showTaskSwitchingPreview(sampled);
                };
            }
        }

        modal.show();
    }

    showPvtPreview(componentData) {
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modalEl, modal } = previewModal;

        const modalBody = modalEl.querySelector('.modal-body');
        if (!modalBody) return;

        const escape = (s) => {
            return (s ?? '')
                .toString()
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        const resolveInherit = (v, fallback) => {
            const s = (v ?? '').toString().trim();
            if (s === '' || s === 'inherit') return fallback;
            return s;
        };

        const uiDefaults = (() => {
            try {
                return window.jsonBuilderInstance?.getCurrentPvtDefaults?.() || null;
            } catch {
                return null;
            }
        })();

        const defaults = {
            response_device: (uiDefaults?.response_device ?? 'keyboard').toString(),
            response_key: (uiDefaults?.response_key ?? 'space').toString(),
            foreperiod_ms: Number.isFinite(Number(uiDefaults?.foreperiod_ms)) ? Number(uiDefaults.foreperiod_ms) : 4000,
            trial_duration_ms: Number.isFinite(Number(uiDefaults?.trial_duration_ms)) ? Number(uiDefaults.trial_duration_ms) : 10000,
            iti_ms: Number.isFinite(Number(uiDefaults?.iti_ms)) ? Number(uiDefaults.iti_ms) : 0,
            feedback_enabled: (uiDefaults?.feedback_enabled === true),
            feedback_message: (uiDefaults?.feedback_message ?? '').toString()
        };

        const responseDevice = resolveInherit(componentData?.response_device, defaults.response_device);
        const responseKey = resolveInherit(componentData?.response_key, defaults.response_key);

        const foreperiodMs = Number.isFinite(Number(componentData?.foreperiod_ms))
            ? Number(componentData.foreperiod_ms)
            : defaults.foreperiod_ms;

        const trialMs = Number.isFinite(Number(componentData?.trial_duration_ms))
            ? Number(componentData.trial_duration_ms)
            : defaults.trial_duration_ms;

        const itiMs = Number.isFinite(Number(componentData?.iti_ms))
            ? Number(componentData.iti_ms)
            : defaults.iti_ms;

        const feedbackEnabled = (typeof componentData?.feedback_enabled === 'boolean')
            ? componentData.feedback_enabled
            : defaults.feedback_enabled;
        const feedbackMessage = (typeof componentData?.feedback_message === 'string')
            ? componentData.feedback_message
            : defaults.feedback_message;

        const noteText = (componentData?._previewContextNote ?? '').toString();
        const hasBlockSource = !!componentData?._blockPreviewSource;

        const responseHint = (responseDevice === 'mouse')
            ? '<div class="small text-muted"><b>Mouse:</b> click the timer screen</div>'
            : (responseDevice === 'both')
                ? `<div class="small text-muted"><b>Both:</b> press <span class="badge bg-secondary">${escape(responseKey)}</span> or click</div>`
                : `<div class="small text-muted"><b>Keyboard:</b> press <span class="badge bg-secondary">${escape(responseKey)}</span></div>`;

        const body = `
            <div class="p-3">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <h5 class="mb-1">PVT Preview</h5>
                        <div class="small text-muted">Lightweight renderer</div>
                        ${noteText ? `<div class="small text-muted">${escape(noteText)}</div>` : ''}
                    </div>
                    <div class="text-end small text-muted">
                        <div><strong>Foreperiod:</strong> ${escape(foreperiodMs)} ms</div>
                        <div><strong>Timeout:</strong> ${escape(trialMs)} ms</div>
                        <div><strong>ITI:</strong> ${escape(itiMs)} ms</div>
                    </div>
                </div>

                <div class="border rounded mt-3 p-4 d-flex justify-content-center align-items-center" style="background:#111; color:#fff; min-height: 260px;">
                    <div class="text-center" style="width:100%; max-width:720px;">
                        <div id="pvtStatus" class="small" style="opacity:0.75; min-height: 18px;">Ready</div>
                        <div id="pvtStage" tabindex="0" role="button" aria-label="PVT timer stage" style="outline:none; user-select:none; cursor:pointer; padding: 18px 8px; border-radius: 12px;">
                            <div id="pvtTimer" style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 96px; letter-spacing: 0.08em;">
                                0000
                            </div>
                            <div class="mt-2">${responseHint}</div>
                            <div class="mt-2 small text-muted" style="max-width:680px; margin:0 auto;">
                                Click/press to respond. This preview simulates foreperiod + timer.
                            </div>
                        </div>

                        <div class="mt-3 d-flex justify-content-center gap-2">
                            <button type="button" class="btn btn-sm btn-success" id="pvtSimStartBtn"><i class="fas fa-play"></i> Simulate Trial</button>
                            <button type="button" class="btn btn-sm btn-outline-secondary" id="pvtSimResetBtn"><i class="fas fa-rotate"></i> Reset</button>
                        </div>

                        <div id="pvtFeedbackBox" class="alert alert-info mt-3" style="display:none; text-align:left;"></div>
                    </div>
                </div>

                <div class="mt-3 small text-muted d-flex justify-content-between align-items-center">
                    <div>
                        ${feedbackEnabled ? `<span class="badge bg-info text-dark">Feedback: ON (false-start only)</span>` : `<span class="badge bg-secondary">Feedback: OFF</span>`}
                    </div>
                    <div class="d-flex gap-2">
                        ${hasBlockSource ? `<button type="button" class="btn btn-sm btn-outline-secondary" id="pvtResampleBtn"><i class="fas fa-dice"></i> Resample</button>` : ''}
                    </div>
                </div>
            </div>
        `;

        modalBody.innerHTML = body;

        if (hasBlockSource) {
            const btn = modalBody.querySelector('#pvtResampleBtn');
            if (btn) {
                btn.onclick = () => {
                    const sampled = this.sampleComponentFromBlock(componentData._blockPreviewSource);
                    const baseType = componentData._blockPreviewSource.block_component_type || componentData._blockPreviewSource.component_type || 'pvt-trial';
                    const length = componentData._blockPreviewSource.block_length ?? componentData._blockPreviewSource.length ?? 0;
                    const sampling = componentData._blockPreviewSource.sampling_mode || 'per-trial';
                    sampled._previewContextNote = `Block sample → ${baseType} (length ${length}, ${sampling})`;
                    sampled._blockPreviewSource = componentData._blockPreviewSource;
                    this.showPvtPreview(sampled);
                };
            }
        }

        // Interactive simulation
        const statusEl = modalBody.querySelector('#pvtStatus');
        const stageEl = modalBody.querySelector('#pvtStage');
        const timerEl = modalBody.querySelector('#pvtTimer');
        const startBtn = modalBody.querySelector('#pvtSimStartBtn');
        const resetBtn = modalBody.querySelector('#pvtSimResetBtn');
        const feedbackBox = modalBody.querySelector('#pvtFeedbackBox');

        let phase = 'idle'; // idle | foreperiod | running | ended
        let foreTimeout = null;
        let deadlineTimeout = null;
        let rafId = null;
        let targetOnset = null;

        const clearTimers = () => {
            if (foreTimeout !== null) { clearTimeout(foreTimeout); foreTimeout = null; }
            if (deadlineTimeout !== null) { clearTimeout(deadlineTimeout); deadlineTimeout = null; }
            if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        };

        const fmt4 = (n) => {
            const x = Math.max(0, Math.min(9999, Math.floor(Number(n) || 0)));
            return x.toString().padStart(4, '0');
        };

        const setStatus = (s) => {
            if (statusEl) statusEl.textContent = s || '';
        };

        const setTimer = (ms) => {
            if (timerEl) timerEl.textContent = fmt4(ms);
        };

        const hideFeedback = () => {
            if (!feedbackBox) return;
            feedbackBox.style.display = 'none';
            feedbackBox.textContent = '';
        };

        const showFeedback = (msg) => {
            if (!feedbackBox) return;
            const m = (msg ?? '').toString();
            if (!m) return;
            feedbackBox.textContent = m;
            feedbackBox.style.display = '';
            // Match interpreter-ish behavior: auto-hide after a short time.
            setTimeout(() => {
                // Only hide if nothing else replaced it.
                if (feedbackBox.textContent === m) hideFeedback();
            }, 750);
        };

        const resetSim = () => {
            clearTimers();
            phase = 'idle';
            targetOnset = null;
            setStatus('Ready');
            setTimer(0);
            hideFeedback();
            try { stageEl?.focus?.(); } catch { /* ignore */ }
        };

        const startSim = () => {
            resetSim();
            phase = 'foreperiod';
            setStatus('Get ready…');

            foreTimeout = setTimeout(() => {
                if (phase !== 'foreperiod') return;
                phase = 'running';
                targetOnset = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                setStatus('Respond now');

                const loop = () => {
                    if (phase !== 'running') return;
                    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                    setTimer(now - targetOnset);
                    rafId = requestAnimationFrame(loop);
                };
                rafId = requestAnimationFrame(loop);

                if (Number.isFinite(Number(trialMs)) && Number(trialMs) > 0) {
                    deadlineTimeout = setTimeout(() => {
                        if (phase !== 'running') return;
                        phase = 'ended';
                        clearTimers();
                        setStatus('Timed out');
                    }, Number(trialMs));
                }
            }, Math.max(0, Number(foreperiodMs) || 0));
        };

        const respond = (source) => {
            if (phase === 'ended') return;

            if (phase === 'foreperiod' || phase === 'idle') {
                phase = 'ended';
                clearTimers();
                setStatus(`False start (${source})`);
                if (feedbackEnabled && feedbackMessage) showFeedback(feedbackMessage);
                return;
            }

            if (phase === 'running') {
                const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                const rt = Math.max(0, now - targetOnset);
                phase = 'ended';
                clearTimers();
                setTimer(rt);
                setStatus(`Response (${source})`);
            }
        };

        if (startBtn) startBtn.onclick = () => startSim();
        if (resetBtn) resetBtn.onclick = () => resetSim();

        if (stageEl) {
            stageEl.onclick = () => {
                if (responseDevice === 'keyboard') return;
                respond('click');
            };
            stageEl.onkeydown = (ev) => {
                const key = (ev?.key ?? '').toString();
                const keyLower = key.toLowerCase();
                const targetKey = (responseKey ?? '').toString().trim().toLowerCase();
                const isSpace = (key === ' ' || keyLower === 'space');
                const matches = (targetKey === ' ' || targetKey === 'space') ? isSpace : (keyLower === targetKey);
                if (!matches) return;
                if (responseDevice === 'mouse') return;
                try { ev.preventDefault(); } catch { /* ignore */ }
                respond('key');
            };

            // focus so keyboard preview works immediately
            try { stageEl.focus(); } catch { /* ignore */ }
        }

        modal.show();
    }

    resolveMaybeAssetUrl(raw) {
        const s = (raw ?? '').toString().trim();
        if (!s) return '';

        // Already-resolvable URL-like strings.
        if (/^(https?:|data:|blob:)/i.test(s)) return s;

        // Local cache placeholder: asset://<componentId>/<field>
        const m = /^asset:\/\/([^/]+)\/([^/]+)$/.exec(s);
        if (!m) {
            // Token Store uploaded assets: allow referring to images by filename
            // after using the Builder's "Upload Assets" (folder) feature.
            const tokenUrl = this.resolveTokenStoreAssetUrlByFilename(s);
            return tokenUrl || s;
        }

        try {
            const cid = m[1];
            const field = m[2];
            const entry = window.PsychJsonAssetCache?.get?.(cid, field);
            if (entry && entry.objectUrl) return entry.objectUrl;
        } catch {
            // ignore
        }

        return '';
    }

    resolveTokenStoreAssetUrlByFilename(name) {
        try {
            const raw = (name ?? '').toString().trim();
            if (!raw) return '';
            if (/^(https?:|data:|blob:|asset:)/i.test(raw)) return '';

            // Folder uploads store by File.name (basename). Accept paths by taking the basename.
            const filename = raw.split(/[\\/]/).pop();
            if (!filename) return '';

            const code = (localStorage.getItem('cogflow_last_export_code') || localStorage.getItem('psychjson_last_export_code') || '').toString().trim();
            if (!code) return '';

            const taskTypeRaw = (document.getElementById('taskType')?.value || '').toString().trim().toLowerCase();
            const taskType = taskTypeRaw || 'task';

            const key = 'cogflow_token_store_asset_index_v1';
            const legacyKey = 'psychjson_token_store_asset_index_v1';
            const rawIndex = (localStorage.getItem(key) || localStorage.getItem(legacyKey) || '').toString();
            const index = rawIndex ? JSON.parse(rawIndex) : {};
            const byCode = (index && typeof index === 'object') ? index[code] : null;
            const byTask = (byCode && typeof byCode === 'object' && byCode.by_task && typeof byCode.by_task === 'object') ? byCode.by_task : null;
            if (!byTask) return '';

            // Prefer current task type.
            const entry = byTask?.[taskType]?.files?.[filename];
            const url = entry?.url ? String(entry.url).trim() : '';
            if (url) return url;

            // Fallback: find the filename under any task bucket for this code.
            for (const t of Object.keys(byTask)) {
                const e = byTask?.[t]?.files?.[filename];
                const u = e?.url ? String(e.url).trim() : '';
                if (u) return u;
            }
        } catch {
            // ignore
        }
        return '';
    }

    wrapCenteredPreview(html) {
        // Builder preview modal has its own styling; include a minimal centered stage.
        return `
            <div style="min-height:70vh; display:flex; align-items:center; justify-content:center; padding:18px; box-sizing:border-box; background:#0b0b0b; color:rgba(255,255,255,0.9); border-radius:12px;">
                <div style="width:min(980px, 100%);">
                    ${html}
                </div>
            </div>
        `;
    }

    showImageKeyboardResponsePreview(componentData) {
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modalEl, modal } = previewModal;

        const modalBody = modalEl.querySelector('.modal-body');
        if (!modalBody) return;

        const stim = this.resolveMaybeAssetUrl(componentData?.stimulus);
        const prompt = (componentData?.prompt ?? '').toString();
        const choices = componentData?.choices ?? 'ALL_KEYS';
        const w = componentData?.stimulus_width;
        const h = componentData?.stimulus_height;

        const styleParts = [];
        if (Number.isFinite(Number(w))) styleParts.push(`width:${Number(w)}px;`);
        if (Number.isFinite(Number(h))) styleParts.push(`height:${Number(h)}px;`);
        styleParts.push('max-width:100%; max-height:55vh; object-fit:contain;');

        const imgHtml = stim
            ? `<img src="${stim}" alt="stimulus" style="${styleParts.join(' ')}" />`
            : `<div class="text-warning">No image stimulus set (or missing cached asset).</div>`;

        const body = `
            <h5 style="margin:0 0 10px 0;">Image + Keyboard Response</h5>
            <div style="display:flex; justify-content:center; margin:14px 0;">${imgHtml}</div>
            ${prompt ? `<div style="margin-top:10px; opacity:0.9;">${prompt}</div>` : ''}
            <div style="margin-top:14px; font-size:12px; opacity:0.75;">
                <b>Choices:</b> ${Array.isArray(choices) ? choices.join(', ') : String(choices)}
            </div>
        `;

        modalBody.innerHTML = this.wrapCenteredPreview(body);
        modal.show();
    }

    showVisualAngleCalibrationPreview(componentData) {
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modalEl, modal } = previewModal;

        const modalBody = modalEl.querySelector('.modal-body');
        if (!modalBody) return;

        const storeKey = (componentData?.store_key || '__psy_visual_angle').toString();
        const card = (componentData?.reference_object || 'ID card').toString();
        const cardWidth = Number(componentData?.reference_width_cm);
        const cardHeight = Number(componentData?.reference_height_cm);

        const page1 = `
            <h5 style="margin:0 0 8px 0;">Visual Angle Calibration (Page 1/2)</h5>
            <div style="opacity:0.85; margin-bottom:10px;">Match the on-screen rectangle to a <b>${card}</b>.</div>
            <div style="display:flex; justify-content:center; margin:12px 0;">
                <div style="width:320px; height:200px; border:2px solid rgba(255,255,255,0.7); border-radius:10px;"></div>
            </div>
            <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                <label style="min-width:160px; opacity:0.8;">Adjust size</label>
                <input type="range" min="50" max="150" value="100" style="flex:1;" disabled />
                <span style="opacity:0.7;">(preview)</span>
            </div>
            <div style="margin-top:12px; font-size:12px; opacity:0.75;">
                <div><b>Reference size:</b> ${Number.isFinite(cardWidth) ? cardWidth : 'n/a'}cm × ${Number.isFinite(cardHeight) ? cardHeight : 'n/a'}cm</div>
                <div><b>Store key:</b> ${storeKey}</div>
            </div>
        `;

        const page2 = `
            <h5 style="margin:0 0 8px 0;">Visual Angle Calibration (Page 2/2)</h5>
            <div style="opacity:0.85; margin-bottom:10px;">Select your approximate viewing distance.</div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; margin-top:10px;">
                <div style="display:flex; gap:12px; align-items:center; padding:12px; border-radius:14px; border:1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.06); opacity:0.95;">
                    <img src="img/recline.png" alt="Recline" style="width:92px; height:70px; object-fit:contain; border-radius:10px; border:1px solid rgba(255,255,255,0.14); background: rgba(0,0,0,0.25);" onerror="this.style.display='none'" />
                    <div>
                        <div style="font-weight:700;">Leaning back</div>
                        <div style="font-size:12px; opacity:0.75;">(example posture)</div>
                    </div>
                </div>

                <div style="display:flex; gap:12px; align-items:center; padding:12px; border-radius:14px; border:1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.06); opacity:0.95;">
                    <img src="img/sitting.png" alt="Sitting" style="width:92px; height:70px; object-fit:contain; border-radius:10px; border:1px solid rgba(255,255,255,0.14); background: rgba(0,0,0,0.25);" onerror="this.style.display='none'" />
                    <div>
                        <div style="font-weight:700;">Normal posture</div>
                        <div style="font-size:12px; opacity:0.75;">(example posture)</div>
                    </div>
                </div>

                <div style="display:flex; gap:12px; align-items:center; padding:12px; border-radius:14px; border:1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.06); opacity:0.95;">
                    <img src="img/criss-cross.png" alt="Leaning forward" style="width:92px; height:70px; object-fit:contain; border-radius:10px; border:1px solid rgba(255,255,255,0.14); background: rgba(0,0,0,0.25);" onerror="this.style.display='none'" />
                    <div>
                        <div style="font-weight:700;">Leaning forward</div>
                        <div style="font-size:12px; opacity:0.75;">(example posture)</div>
                    </div>
                </div>

                <div style="display:flex; gap:12px; align-items:center; padding:12px; border-radius:14px; border:1px dashed rgba(255,255,255,0.22); background: rgba(255,255,255,0.04); opacity:0.9;">
                    <div style="width:92px; height:70px; display:flex; align-items:center; justify-content:center; border-radius:10px; border:1px dashed rgba(255,255,255,0.18); background: rgba(0,0,0,0.18); font-size:12px; opacity:0.8;">Manual</div>
                    <div>
                        <div style="font-weight:700;">Enter manually</div>
                        <div style="font-size:12px; opacity:0.75;">(optional)</div>
                    </div>
                </div>
            </div>
            <div style="margin-top:12px; font-size:12px; opacity:0.75;">
                This preview is static; the Interpreter screen is interactive.
            </div>
        `;

        modalBody.innerHTML = `
            <ul class="nav nav-tabs" role="tablist">
              <li class="nav-item" role="presentation"><button class="nav-link active" data-bs-toggle="tab" data-bs-target="#vac_p1" type="button" role="tab">Page 1</button></li>
              <li class="nav-item" role="presentation"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#vac_p2" type="button" role="tab">Page 2</button></li>
            </ul>
            <div class="tab-content" style="margin-top:10px;">
              <div class="tab-pane fade show active" id="vac_p1" role="tabpanel">${this.wrapCenteredPreview(page1)}</div>
              <div class="tab-pane fade" id="vac_p2" role="tabpanel">${this.wrapCenteredPreview(page2)}</div>
            </div>
        `;

        modal.show();
    }

    showRewardSettingsPreview(componentData) {
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modalEl, modal } = previewModal;

        const modalBody = modalEl.querySelector('.modal-body');
        if (!modalBody) return;

        const escapeHtml = (s) => {
            return String(s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        const renderTemplate = (tpl, vars) => {
            const raw = (tpl ?? '').toString();
            return raw.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
                const v = Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : '';
                return (v === null || v === undefined) ? '' : String(v);
            });
        };

        const rewriteAssetRefsInHtml = (html) => {
            const raw = (html ?? '').toString();
            return raw.replace(/asset:\/\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/g, (full) => {
                const resolved = this.resolveMaybeAssetUrl(full);
                return resolved || full;
            });
        };

        const normalizeScreen = (raw, legacyTitle, legacyTpl) => {
            const s = (raw && typeof raw === 'object') ? raw : {};
            return {
                title: (s.title ?? legacyTitle ?? '').toString() || 'Rewards',
                template_html: (s.template_html ?? s.html ?? legacyTpl ?? '').toString(),
                image_url: (s.image_url ?? '').toString(),
                audio_url: (s.audio_url ?? '').toString()
            };
        };

        const currency = (componentData?.currency_label || 'points').toString();
        const basis = (componentData?.scoring_basis || 'both').toString();
        const continueKey = (componentData?.continue_key ?? 'space').toString();
        const rtThresh = Number.isFinite(Number(componentData?.rt_threshold_ms)) ? Number(componentData.rt_threshold_ms) : 600;
        const pps = Number.isFinite(Number(componentData?.points_per_success)) ? Number(componentData.points_per_success) : 1;

        const scoringBasisLabel = (b) => {
            if (b === 'accuracy') return 'Accuracy';
            if (b === 'reaction_time') return 'Reaction time';
            if (b === 'both') return 'Accuracy + reaction time';
            return b;
        };

        const continueKeyLabel = (k) => {
            if (k === 'ALL_KEYS') return 'ANY KEY';
            return k.toUpperCase();
        };

        // Support both legacy flat fields and v2 nested screen objects.
        const instructionsScreenObj = normalizeScreen(
            componentData?.instructions_screen,
            componentData?.instructions_title,
            componentData?.instructions_template_html
        );
        const summaryScreenObj = normalizeScreen(
            componentData?.summary_screen,
            componentData?.summary_title,
            componentData?.summary_template_html
        );

        const intermediateScreens = Array.isArray(componentData?.intermediate_screens)
            ? componentData.intermediate_screens
            : (Array.isArray(componentData?.extra_screens) ? componentData.extra_screens : []);

        const milestones = Array.isArray(componentData?.milestones) ? componentData.milestones : [];

        const vars = {
            currency_label: currency,
            scoring_basis: basis,
            scoring_basis_label: scoringBasisLabel(basis),
            rt_threshold_ms: rtThresh,
            points_per_success: pps,
            continue_key_label: continueKeyLabel(continueKey),

            // sample values for preview
            total_points: 12,
            rewarded_trials: 8,
            eligible_trials: 20,
            success_streak: 3,
            badge_level: 'Bronze'
        };

        const resolveMediaUrl = (rawUrl) => {
            const u = (rawUrl ?? '').toString();
            if (!u) return '';
            const resolved = this.resolveMaybeAssetUrl(u);
            return resolved || u;
        };

        const renderRewardScreen = (screen, { subtitle = '' } = {}) => {
            const title = (screen?.title ?? '').toString();
            const tpl = (screen?.template_html ?? '').toString();
            const html = tpl
                ? rewriteAssetRefsInHtml(renderTemplate(tpl, vars))
                : '<div class="text-muted">No HTML template provided.</div>';

            const img = resolveMediaUrl(screen?.image_url);
            const aud = resolveMediaUrl(screen?.audio_url);

            const mediaHtml = `
                ${img ? `<div style="margin:0 0 12px 0;"><img src="${escapeHtml(img)}" alt="preview image" style="max-width:100%; max-height:260px;"></div>` : ''}
                ${aud ? `<div style="margin:0 0 12px 0;"><audio src="${escapeHtml(aud)}" controls style="width:100%;"></audio></div>` : ''}
            `;

            const subtitleHtml = subtitle ? `<div style="margin:0 0 10px 0; font-size:12px; opacity:0.75;">${escapeHtml(subtitle)}</div>` : '';
            return `
                <h5 style="margin:0 0 10px 0;">${escapeHtml(title || 'Rewards')}</h5>
                ${subtitleHtml}
                ${mediaHtml}
                <div>${html}</div>
            `;
        };

        const screens = [];
        screens.push({
            id: 'rew_instr',
            label: 'Instructions',
            body: renderRewardScreen(instructionsScreenObj, {
                subtitle: `Scoring: ${vars.scoring_basis_label} • RT threshold: ${rtThresh}ms • Points per success: ${pps}`
            })
        });

        intermediateScreens.forEach((s, i) => {
            const screenObj = normalizeScreen(s, `Additional screen #${i + 1}`, '');
            screens.push({
                id: `rew_int_${i + 1}`,
                label: `Additional ${i + 1}`,
                body: renderRewardScreen(screenObj)
            });
        });

        milestones.forEach((m, i) => {
            const triggerType = (m?.trigger_type ?? m?.trigger ?? 'trial_count').toString();
            const threshold = Number.isFinite(Number(m?.threshold ?? m?.value)) ? Number(m.threshold ?? m.value) : 10;
            const scr = (m?.screen && typeof m.screen === 'object') ? m.screen : m;
            const screenObj = normalizeScreen(scr, `Milestone ${i + 1}`, '');

            const triggerLabel = (triggerType === 'total_points')
                ? `After ${threshold} total points`
                : (triggerType === 'success_streak')
                    ? `After ${threshold} successful trials in a row`
                    : `After ${threshold} trials`;

            screens.push({
                id: `rew_ms_${i + 1}`,
                label: `Milestone ${i + 1}`,
                body: renderRewardScreen(screenObj, { subtitle: triggerLabel })
            });
        });

        screens.push({
            id: 'rew_sum',
            label: 'Final summary',
            body: renderRewardScreen(summaryScreenObj, { subtitle: 'Preview uses example totals.' })
        });

        const tabsHtml = screens.map((s, idx) => {
            const active = idx === 0 ? 'active' : '';
            return `<li class="nav-item" role="presentation"><button class="nav-link ${active}" data-bs-toggle="tab" data-bs-target="#${s.id}" type="button" role="tab">${escapeHtml(s.label)}</button></li>`;
        }).join('');

        const panesHtml = screens.map((s, idx) => {
            const active = idx === 0 ? 'show active' : '';
            return `<div class="tab-pane fade ${active}" id="${s.id}" role="tabpanel">${this.wrapCenteredPreview(s.body)}</div>`;
        }).join('');

        modalBody.innerHTML = `
            <ul class="nav nav-tabs" role="tablist">${tabsHtml}</ul>
            <div class="tab-content" style="margin-top:10px;">${panesHtml}</div>
        `;

        modal.show();
    }

    wrapSocSubtaskAsSession(subtaskComponentData) {
        const raw = (subtaskComponentData && typeof subtaskComponentData === 'object') ? subtaskComponentData : {};
        const merged = {
            ...raw,
            ...((raw.parameters && typeof raw.parameters === 'object') ? raw.parameters : {})
        };

        const type = (merged.type ?? raw.type ?? '').toString();

        const mapKind = (t) => {
            switch (t) {
                case 'soc-subtask-sart-like': return 'sart-like';
                case 'soc-subtask-flanker-like': return 'flanker-like';
                case 'soc-subtask-nback-like': return 'nback-like';
                case 'soc-subtask-wcst-like': return 'wcst-like';
                case 'soc-subtask-pvt-like': return 'pvt-like';
                default: return 'unknown';
            }
        };

        const defaults = window.jsonBuilderInstance?.getCurrentSocDashboardDefaults?.() || {};

        // Copy all non-identity fields into the subtask object (so the preview reflects modal params).
        const subtaskParams = {};
        for (const [k, v] of Object.entries(merged)) {
            if (k === 'type' || k === 'name' || k === 'title' || k === 'parameters') continue;
            subtaskParams[k] = v;
        }

        const subtask = {
            type: mapKind(type),
            title: (merged.title || merged.name || raw.title || raw.name || 'Subtask').toString(),
            ...subtaskParams
        };

        return {
            ...defaults,
            type: 'soc-dashboard',
            title: (defaults?.title ?? 'SOC Dashboard').toString(),
            // Ensure a single window representing the subtask.
            subtasks: [subtask],
            num_tasks: 1
        };
    }

    showSocDashboardPreview(componentData) {
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modalEl, modal } = previewModal;

        const modalBody = modalEl.querySelector('.modal-body');
        if (!modalBody) return;

        modalBody.innerHTML = `
            <div class="p-2">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <h5 class="mb-1">SOC Dashboard Preview</h5>
                        <div class="small text-muted">Vanilla prototype renderer (isolated)</div>
                    </div>
                    <div class="text-end small text-muted">
                        <div><strong>End key:</strong> ${(componentData?.end_key ?? 'escape').toString()}</div>
                        <div><strong>Duration:</strong> ${Number.isFinite(Number(componentData?.trial_duration_ms)) ? `${Number(componentData.trial_duration_ms)}ms` : 'n/a'}</div>
                    </div>
                </div>
                <div id="socDashboardPreviewHost" class="mt-2"></div>
            </div>
        `;

        const host = modalBody.querySelector('#socDashboardPreviewHost');
        if (host && window.SocDashboardPreview && typeof window.SocDashboardPreview.render === 'function') {
            // Tear down any previous preview instance first.
            try {
                if (this._socPreviewInstance && typeof this._socPreviewInstance.destroy === 'function') {
                    this._socPreviewInstance.destroy();
                }
            } catch {
                // ignore
            }

            this._socPreviewInstance = window.SocDashboardPreview.render(host, componentData);
        } else if (host) {
            host.innerHTML = '<div class="text-danger">SocDashboardPreview module not loaded.</div>';
        }

        // Cleanup any injected preview content on close
        if (!this._socPreviewCleanupBound) {
            this._socPreviewCleanupBound = true;
            modalEl.addEventListener('hidden.bs.modal', () => {
                try {
                    if (this._socPreviewInstance && typeof this._socPreviewInstance.destroy === 'function') {
                        this._socPreviewInstance.destroy();
                    }
                    this._socPreviewInstance = null;
                    const body = modalEl.querySelector('.modal-body');
                    if (body) body.innerHTML = '';
                } catch {
                    // ignore
                }
            });
        }

        modal.show();
    }

    showFlankerPreview(componentData) {
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modal } = previewModal;

        const escape = (s) => {
            return (s ?? '')
                .toString()
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        const congruency = (componentData?.congruency ?? 'congruent').toString();
        const leftKey = (componentData?.left_key ?? 'f').toString();
        const rightKey = (componentData?.right_key ?? 'j').toString();

        const stimulusType = (componentData?.stimulus_type ?? 'arrows').toString();
        const showFixationDot = !!(componentData?.show_fixation_dot ?? false);
        const showFixationCrossBetweenTrials = !!(componentData?.show_fixation_cross_between_trials ?? false);

        // Arrow mode (back-compat)
        const targetDir = (componentData?.target_direction ?? 'left').toString();
        const arrowLeft = '←';
        const arrowRight = '→';

        // Generic symbol mode
        const targetStimulusRaw = (componentData?.target_stimulus ?? 'H').toString();
        const distractorStimulusRaw = (componentData?.distractor_stimulus ?? 'S').toString();
        const neutralStimulusRaw = (componentData?.neutral_stimulus ?? '–').toString();

        let center;
        let flank;

        if (stimulusType === 'arrows') {
            center = (targetDir === 'right') ? arrowRight : arrowLeft;
            flank = center;
            if (congruency === 'incongruent') {
                flank = (center === arrowRight) ? arrowLeft : arrowRight;
            } else if (congruency === 'neutral') {
                flank = neutralStimulusRaw;
            }
        } else {
            // Letters/symbols/custom: congruent = same as center; incongruent = distractor; neutral = neutral symbol
            center = targetStimulusRaw;
            flank = targetStimulusRaw;
            if (congruency === 'incongruent') {
                flank = distractorStimulusRaw;
            } else if (congruency === 'neutral') {
                flank = neutralStimulusRaw;
            }
        }

        // Standard 5-item array: two flankers on each side
        const stim = `${flank}${flank}${center}${flank}${flank}`;

        const noteText = (componentData?._previewContextNote ?? '').toString();
        const hasBlockSource = !!componentData?._blockPreviewSource;

        const modalBody = document.querySelector('#componentPreviewModal .modal-body');
        if (modalBody) {
            modalBody.innerHTML = `
                <div class="p-3">
                    <div class="d-flex justify-content-between align-items-start">
                        <div>
                            <h5 class="mb-1">Flanker Preview</h5>
                            <div class="small text-muted">Lightweight renderer (safe to reuse in interpreter)</div>
                            ${noteText ? `<div class="small text-muted">${escape(noteText)}</div>` : ''}
                        </div>
                        <div class="text-end small text-muted">
                            <div><strong>Congruency:</strong> ${escape(congruency)}</div>
                            <div><strong>Stimulus type:</strong> ${escape(stimulusType)}</div>
                            ${stimulusType === 'arrows' ? `<div><strong>Target:</strong> ${escape(targetDir)}</div>` : ''}
                        </div>
                    </div>

                    <div class="border rounded mt-3 p-4 d-flex justify-content-center align-items-center" style="background:#111; color:#fff; min-height: 160px;">
                        <div class="text-center">
                            <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 64px; letter-spacing: 0.25em;">
                                ${escape(stim)}
                            </div>
                            ${showFixationDot ? `<div class="mt-2" style="font-size: 28px; line-height: 1; opacity: 0.9;">•</div>` : ''}
                        </div>
                    </div>

                    ${showFixationCrossBetweenTrials ? `
                        <div class="mt-3 border rounded p-3" style="background:#0b0b0b; color:#ddd;">
                            <div class="small text-muted mb-2">Between-trials fixation</div>
                            <div class="d-flex justify-content-center" style="font-size: 36px;">+</div>
                        </div>
                    ` : ''}

                    <div class="mt-3 small text-muted">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                Response mapping: <strong>${escape(leftKey)}</strong> = left, <strong>${escape(rightKey)}</strong> = right.
                                ${componentData?.detection_response_task_enabled ? '<br><span class="badge bg-warning text-dark">DRT enabled</span>' : ''}
                            </div>
                            ${hasBlockSource ? `<button type="button" class="btn btn-sm btn-outline-secondary" id="flankerResampleBtn"><i class="fas fa-dice"></i> Resample</button>` : ''}
                        </div>
                    </div>
                </div>
            `;

            // Optional block resample
            if (hasBlockSource) {
                const btn = modalBody.querySelector('#flankerResampleBtn');
                if (btn) {
                    btn.onclick = () => {
                        const sampled = this.sampleComponentFromBlock(componentData._blockPreviewSource);
                        const baseType = componentData._blockPreviewSource.block_component_type || componentData._blockPreviewSource.component_type || 'flanker-trial';
                        const length = componentData._blockPreviewSource.block_length ?? componentData._blockPreviewSource.length ?? 0;
                        const sampling = componentData._blockPreviewSource.sampling_mode || 'per-trial';
                        sampled._previewContextNote = `Block sample → ${baseType} (length ${length}, ${sampling})`;
                        sampled._blockPreviewSource = componentData._blockPreviewSource;
                        this.showFlankerPreview(sampled);
                    };
                }
            }
        }

        modal.show();
    }

    showSartPreview(componentData) {
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modal } = previewModal;

        const escape = (s) => {
            return (s ?? '')
                .toString()
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        const digit = (componentData?.digit ?? 1);
        const nogo = (componentData?.nogo_digit ?? 3);
        const goKey = (componentData?.go_key ?? 'space').toString();
        const isNoGo = Number(digit) === Number(nogo);

        const noteText = (componentData?._previewContextNote ?? '').toString();
        const hasBlockSource = !!componentData?._blockPreviewSource;

        const modalBody = document.querySelector('#componentPreviewModal .modal-body');
        if (modalBody) {
            modalBody.innerHTML = `
                <div class="p-3">
                    <div class="d-flex justify-content-between align-items-start">
                        <div>
                            <h5 class="mb-1">SART Preview</h5>
                            <div class="small text-muted">Lightweight renderer (safe to reuse in interpreter)</div>
                            ${noteText ? `<div class="small text-muted">${escape(noteText)}</div>` : ''}
                        </div>
                        <div class="text-end small text-muted">
                            <div><strong>Go key:</strong> ${escape(goKey)}</div>
                            <div><strong>No-go digit:</strong> ${escape(nogo)}</div>
                        </div>
                    </div>

                    <div class="border rounded mt-3 p-4 d-flex justify-content-center align-items-center" style="background:#111; color:#fff; min-height: 180px;">
                        <div class="text-center">
                            <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; font-size: 96px; line-height: 1;">
                                ${escape(digit)}
                            </div>
                            <div class="mt-3 small ${isNoGo ? 'text-warning' : 'text-muted'}">
                                ${isNoGo ? 'NO-GO (withhold response)' : `GO (press ${escape(goKey)})`}
                            </div>
                        </div>
                    </div>

                    <div class="mt-3 small text-muted">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                ${componentData?.detection_response_task_enabled ? '<span class="badge bg-warning text-dark">DRT enabled</span>' : ''}
                            </div>
                            ${hasBlockSource ? `<button type="button" class="btn btn-sm btn-outline-secondary" id="sartResampleBtn"><i class="fas fa-dice"></i> Resample</button>` : ''}
                        </div>
                    </div>
                </div>
            `;

            if (hasBlockSource) {
                const btn = modalBody.querySelector('#sartResampleBtn');
                if (btn) {
                    btn.onclick = () => {
                        const sampled = this.sampleComponentFromBlock(componentData._blockPreviewSource);
                        const baseType = componentData._blockPreviewSource.block_component_type || componentData._blockPreviewSource.component_type || 'sart-trial';
                        const length = componentData._blockPreviewSource.block_length ?? componentData._blockPreviewSource.length ?? 0;
                        const sampling = componentData._blockPreviewSource.sampling_mode || 'per-trial';
                        sampled._previewContextNote = `Block sample → ${baseType} (length ${length}, ${sampling})`;
                        sampled._blockPreviewSource = componentData._blockPreviewSource;
                        this.showSartPreview(sampled);
                    };
                }
            }
        }

        modal.show();
    }

    showStroopPreview(componentData) {
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modalEl, modal } = previewModal;

        const modalBody = modalEl.querySelector('.modal-body');
        if (!modalBody) return;

        const escape = (s) => {
            return (s ?? '')
                .toString()
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        const isHex = (s) => typeof s === 'string' && /^#([0-9a-fA-F]{6})$/.test(s.trim());

        const isEmotional = (componentData?.type === 'emotional-stroop-trial');

        const fallbackStimuli = (() => {
            try {
                const list = window.jsonBuilderInstance?.getCurrentStroopStimuliFromUI?.();
                return Array.isArray(list) ? list : [];
            } catch {
                return [];
            }
        })();

        const stimuli = Array.isArray(componentData?.stroop_settings?.stimuli)
            ? componentData.stroop_settings.stimuli
            : fallbackStimuli;

        const nameToHex = new Map(
            (Array.isArray(stimuli) ? stimuli : [])
                .filter(s => s && typeof s === 'object')
                .map(s => [String(s.name ?? '').trim().toLowerCase(), String(s.color ?? '').trim()])
                .filter(([k, v]) => !!k && !!v)
        );

        const resolveHexForName = (name) => {
            const raw = (name ?? '').toString().trim();
            if (isHex(raw)) return raw;
            const hit = nameToHex.get(raw.toLowerCase());
            return hit || '#ffffff';
        };

        const word = (componentData?.word ?? stimuli?.[0]?.name ?? 'RED').toString();
        const inkName = (componentData?.ink_color_name ?? stimuli?.[1]?.name ?? stimuli?.[0]?.name ?? 'BLUE').toString();
        const inkHex = resolveHexForName(inkName);

        const computedCongruency = (word.trim().toLowerCase() === inkName.trim().toLowerCase()) ? 'congruent' : 'incongruent';
        const congruency = (componentData?.congruency ?? 'auto').toString();
        const congruencyLabel = (congruency === 'auto') ? `auto → ${computedCongruency}` : congruency;

        const resolveInherit = (v, fallback) => {
            const s = (v ?? '').toString().trim();
            if (s === '' || s === 'inherit') return fallback;
            return s;
        };

        // For Block previews (and Trial previews that omit stroop_settings), fall back to the
        // current experiment-wide Stroop defaults in the Builder UI.
        const uiDefaults = (() => {
            try {
                if (isEmotional) return window.jsonBuilderInstance?.getCurrentEmotionalStroopDefaults?.() || null;
                return window.jsonBuilderInstance?.getCurrentStroopDefaults?.() || null;
            } catch {
                return null;
            }
        })();

        const defaults = (componentData?.stroop_settings && typeof componentData.stroop_settings === 'object')
            ? componentData.stroop_settings
            : (uiDefaults?.stroop_settings && typeof uiDefaults.stroop_settings === 'object')
                ? uiDefaults.stroop_settings
                : {};

        const responseModeRaw = isEmotional
            ? 'color_naming'
            : resolveInherit(componentData?.response_mode, defaults?.response_mode || uiDefaults?.response_mode || 'color_naming');
        const responseDevice = resolveInherit(componentData?.response_device, defaults?.response_device || uiDefaults?.response_device || 'keyboard');
        // Mouse mode always behaves like color naming (click the color); don't show keyboard-only congruency mapping.
        const responseMode = (responseDevice === 'mouse') ? 'color_naming' : responseModeRaw;

        const congruentKey = resolveInherit(componentData?.congruent_key, defaults?.congruent_key || 'f');
        const incongruentKey = resolveInherit(componentData?.incongruent_key, defaults?.incongruent_key || 'j');

        const choiceKeys = (() => {
            const raw = componentData?.choice_keys ?? defaults?.choice_keys;
            if (Array.isArray(raw)) return raw.map(s => (s ?? '').toString());
            if (typeof raw === 'string') {
                return raw.split(',').map(s => s.trim()).filter(Boolean);
            }
            return [];
        })();

        const mappingHtml = (() => {
            if (responseDevice === 'mouse') {
                const names = (Array.isArray(stimuli) ? stimuli : [])
                    .map(s => (s?.name ?? '').toString())
                    .map(s => s.trim())
                    .filter(Boolean);

                const swatches = names.map(n => {
                    const hex = resolveHexForName(n);
                    return `
                        <div class="d-inline-flex align-items-center me-2 mb-2" style="gap:6px;">
                            <span style="display:inline-block; width:14px; height:14px; border-radius:4px; background:${escape(hex)}; border:1px solid rgba(255,255,255,0.22);"></span>
                            <span>${escape(n)}</span>
                        </div>
                    `;
                }).join('');

                return `
                    <div class="small text-muted">
                        <div class="mb-1"><b>Mouse mapping:</b> click the correct ink color</div>
                        <div>${swatches || '<div class="text-warning">No stimulus library available.</div>'}</div>
                    </div>
                `;
            }

            if (!isEmotional && responseMode === 'congruency') {
                return `
                    <div class="small text-muted">
                        <div><b>Keyboard:</b> <span class="badge bg-secondary">${escape(congruentKey)}</span> = Congruent</div>
                        <div><b>Keyboard:</b> <span class="badge bg-secondary">${escape(incongruentKey)}</span> = Incongruent</div>
                    </div>
                `;
            }

            const names = (Array.isArray(stimuli) ? stimuli : []).map(s => (s?.name ?? '').toString()).filter(Boolean);
            const rows = names.map((n, i) => {
                const k = choiceKeys[i] ?? `${i + 1}`;
                return `<div><span class="badge bg-secondary">${escape(k)}</span> = ${escape(n)}</div>`;
            }).join('');

            return `
                <div class="small text-muted">
                    <div class="mb-1"><b>Color naming mapping:</b></div>
                    ${rows || '<div class="text-warning">No stimulus library available to build mapping.</div>'}
                </div>
            `;
        })();

        const noteText = (componentData?._previewContextNote ?? '').toString();
        const deviceNote = (responseDevice === 'mouse')
            ? '<div class="small text-muted mt-2">Mouse mode: participant clicks the correct color.</div>'
            : '';

        const hasBlockSource = !!componentData?._blockPreviewSource;

        const fontSizePx = Number.isFinite(Number(componentData?.stimulus_font_size_px)) ? Number(componentData.stimulus_font_size_px) : 64;

        const body = `
            <div class="p-3">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <h5 class="mb-1">${isEmotional ? 'Emotional Stroop' : 'Stroop'} Preview</h5>
                        <div class="small text-muted">Lightweight renderer</div>
                        ${noteText ? `<div class="small text-muted">${escape(noteText)}</div>` : ''}
                    </div>
                    <div class="text-end small text-muted">
                        <div><strong>Word:</strong> ${escape(word)}</div>
                        <div><strong>Ink:</strong> ${escape(inkName)} <span style="display:inline-block; width:12px; height:12px; border-radius:3px; background:${escape(inkHex)}; border:1px solid rgba(255,255,255,0.18);"></span></div>
                        ${isEmotional ? '' : `<div><strong>Congruency:</strong> ${escape(congruencyLabel)}</div>`}
                        <div><strong>Response:</strong> ${escape(responseMode)} (${escape(responseDevice)})</div>
                    </div>
                </div>

                <div class="border rounded mt-3 p-4 d-flex justify-content-center align-items-center" style="background:#111; color:#fff; min-height: 220px;">
                    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; font-weight: 800; letter-spacing: 0.02em; font-size:${fontSizePx}px; line-height:1; color:${escape(inkHex)}; text-transform:uppercase;">
                        ${escape(word)}
                    </div>
                </div>

                <div class="mt-3">${mappingHtml}${deviceNote}</div>

                <div class="mt-3 small text-muted d-flex justify-content-between align-items-center">
                    <div>${escape((componentData?.detection_response_task_enabled ? 'DRT enabled' : ''))}</div>
                    ${hasBlockSource ? `<button type="button" class="btn btn-sm btn-outline-secondary" id="stroopResampleBtn"><i class="fas fa-dice"></i> Resample</button>` : ''}
                </div>
            </div>
        `;

        modalBody.innerHTML = body;

        if (hasBlockSource) {
            const btn = modalBody.querySelector('#stroopResampleBtn');
            if (btn) {
                btn.onclick = () => {
                    const sampled = this.sampleComponentFromBlock(componentData._blockPreviewSource);
                    const baseType = componentData._blockPreviewSource.block_component_type || componentData._blockPreviewSource.component_type || 'stroop-trial';
                    const length = componentData._blockPreviewSource.block_length ?? componentData._blockPreviewSource.length ?? 0;
                    const sampling = componentData._blockPreviewSource.sampling_mode || 'per-trial';
                    sampled._previewContextNote = `Block sample → ${baseType} (length ${length}, ${sampling})`;
                    sampled._blockPreviewSource = componentData._blockPreviewSource;
                    this.showStroopPreview(sampled);
                };
            }
        }

        modal.show();
    }

    showGaborPreview(componentData) {
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modal } = previewModal;

        const escape = (s) => {
            return (s ?? '')
                .toString()
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        const targetLocation = (componentData?.target_location ?? 'left').toString();
        const targetTilt = Number(componentData?.target_tilt_deg ?? 45);
        const distractorOrientation = Number(componentData?.distractor_orientation_deg ?? 0);
        const spatialCue = (componentData?.spatial_cue ?? 'none').toString();
        const valueCueEnabled = componentData?.value_cue_enabled !== false && componentData?.value_cue_enabled !== 'false' && componentData?.value_cue_enabled !== 0;
        const leftValue = valueCueEnabled ? (componentData?.left_value ?? 'neutral').toString() : 'neutral';
        const rightValue = valueCueEnabled ? (componentData?.right_value ?? 'neutral').toString() : 'neutral';

        const responseTask = (componentData?.response_task ?? 'discriminate_tilt').toString();
        const leftKey = (componentData?.left_key ?? 'f').toString();
        const rightKey = (componentData?.right_key ?? 'j').toString();
        const yesKey = (componentData?.yes_key ?? 'f').toString();
        const noKey = (componentData?.no_key ?? 'j').toString();

        // Prefer per-component preview colors; fall back to current defaults panel if present.
        const panelHigh = document.getElementById('gaborHighValueColor')?.value;
        const panelLow = document.getElementById('gaborLowValueColor')?.value;
        const highColor = (componentData?.high_value_color ?? panelHigh ?? '#00aa00').toString();
        const lowColor = (componentData?.low_value_color ?? panelLow ?? '#0066ff').toString();
        const neutralColor = '#666666';

        const panelFreqRaw = document.getElementById('gaborSpatialFrequency')?.value;
        const panelFreq = (panelFreqRaw !== undefined && panelFreqRaw !== null && `${panelFreqRaw}` !== '')
            ? Number.parseFloat(panelFreqRaw)
            : null;
        const spatialFrequency = Number(componentData?.spatial_frequency_cyc_per_px ?? panelFreq ?? 0.06);
        const gratingWaveform = (componentData?.grating_waveform ?? document.getElementById('gaborGratingWaveform')?.value ?? 'sinusoidal').toString();
        const contrast = (componentData?.contrast !== undefined && Number.isFinite(Number(componentData.contrast)))
            ? Math.max(0, Math.min(1, Number(componentData.contrast)))
            : 0.95;
        const patchBorder = {
            enabled: componentData?.patch_border_enabled !== false,
            widthPx: Math.max(0, Math.min(50, Number(componentData?.patch_border_width_px ?? 2))),
            color: (componentData?.patch_border_color ?? '#ffffff').toString(),
            opacity: Math.max(0, Math.min(1, Number(componentData?.patch_border_opacity ?? 0.22)))
        };

        const frameColorForValue = (v) => {
            if (v === 'high') return highColor;
            if (v === 'low') return lowColor;
            return neutralColor;
        };

        const leftAngle = (targetLocation === 'left') ? targetTilt : distractorOrientation;
        const rightAngle = (targetLocation === 'right') ? targetTilt : distractorOrientation;

        const noteText = (componentData?._previewContextNote ?? '').toString();
        const hasBlockSource = !!componentData?._blockPreviewSource;

        const modalBody = document.querySelector('#componentPreviewModal .modal-body');
        if (modalBody) {
            modalBody.innerHTML = `
                <div class="p-3">
                    <div class="d-flex justify-content-between align-items-start">
                        <div>
                            <h5 class="mb-1">Gabor Preview</h5>
                            <div class="small text-muted">Canvas renderer (actual Gabor gratings)</div>
                            ${noteText ? `<div class="small text-muted">${escape(noteText)}</div>` : ''}
                        </div>
                        <div class="text-end small text-muted">
                            <div><strong>Target:</strong> ${escape(targetLocation)}</div>
                            <div><strong>Spatial cue:</strong> ${escape(spatialCue)}</div>
                            <div><strong>Response:</strong> ${escape(responseTask)}</div>
                        </div>
                    </div>

                    <div class="border rounded mt-3 p-2" style="background:#0f0f0f;">
                        <canvas id="gaborPreviewCanvas" width="720" height="320" style="width:100%; height:auto; display:block;"></canvas>
                        <div class="mt-2 small text-muted d-flex justify-content-between">
                            <div><strong>Left value:</strong> ${escape(leftValue)}</div>
                            <div><strong>Right value:</strong> ${escape(rightValue)}</div>
                        </div>
                    </div>

                    <div class="mt-3 small text-muted">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                ${responseTask === 'detect_target'
                                    ? `Yes/No: <strong>${escape(yesKey)}</strong>/<strong>${escape(noKey)}</strong>`
                                    : `Left/Right: <strong>${escape(leftKey)}</strong>/<strong>${escape(rightKey)}</strong>`}
                                ${componentData?.detection_response_task_enabled ? '<br><span class="badge bg-warning text-dark">DRT enabled</span>' : ''}
                            </div>
                            ${hasBlockSource ? `<button type="button" class="btn btn-sm btn-outline-secondary" id="gaborResampleBtn"><i class="fas fa-dice"></i> Resample</button>` : ''}
                        </div>
                    </div>
                </div>
            `;

            // Render actual Gabor patches
            const canvas = modalBody.querySelector('#gaborPreviewCanvas');
            if (canvas) {
                this.renderGaborTrialToCanvas(canvas, {
                    spatialCue,
                    leftFrameColor: frameColorForValue(leftValue),
                    rightFrameColor: frameColorForValue(rightValue),
                    leftAngle,
                    rightAngle,
                    spatialFrequency,
                    gratingWaveform,
                    contrast,
                    patchBorder
                });
            }

            if (hasBlockSource) {
                const btn = modalBody.querySelector('#gaborResampleBtn');
                if (btn) {
                    btn.onclick = () => {
                        const sampled = this.sampleComponentFromBlock(componentData._blockPreviewSource);
                        const baseType = componentData._blockPreviewSource.block_component_type || componentData._blockPreviewSource.component_type || 'gabor-trial';
                        const length = componentData._blockPreviewSource.block_length ?? componentData._blockPreviewSource.length ?? 0;
                        const sampling = componentData._blockPreviewSource.sampling_mode || 'per-trial';
                        sampled._previewContextNote = `Block sample → ${baseType} (length ${length}, ${sampling})`;
                        sampled._blockPreviewSource = componentData._blockPreviewSource;
                        this.showGaborPreview(sampled);
                    };
                }
            }
        }

        modal.show();
    }

    renderGaborTrialToCanvas(canvas, { spatialCue, leftFrameColor, rightFrameColor, leftAngle, rightAngle, spatialFrequency, gratingWaveform, contrast, patchBorder }) {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        // Background
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#0b0b0b';
        ctx.fillRect(0, 0, w, h);

        // Layout
        const pad = 24;
        const patchSize = Math.min(200, Math.floor((w - pad * 2) / 3));
        const cy = Math.floor(h * 0.60);
        const leftCx = Math.floor(w * 0.30);
        const rightCx = Math.floor(w * 0.70);

        // Cue — diamond shape matching the interpreter (drawCueDiamond)
        const hasCue = (spatialCue === 'left' || spatialCue === 'right' || spatialCue === 'both');
        if (hasCue) {
            this.drawCueDiamond(ctx, Math.floor(w / 2), cy, spatialCue);
        } else {
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.font = '14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('(no spatial cue)', Math.floor(w / 2), Math.floor(h * 0.18));
        }

        // Gabor patches — draw first so value cue rings are painted on top
        this.drawGaborPatch(ctx, leftCx, cy, patchSize, leftAngle, { spatialFrequency, gratingWaveform, contrast, patchBorder });
        this.drawGaborPatch(ctx, rightCx, cy, patchSize, rightAngle, { spatialFrequency, gratingWaveform, contrast, patchBorder });

        // Circular value cue rings drawn AFTER patches so putImageData doesn't overwrite them
        const outlineRadius = Math.floor(patchSize / 2) - 1;
        ctx.save();
        ctx.lineWidth = Math.max(2, patchBorder?.widthPx ?? 6);
        ctx.strokeStyle = leftFrameColor;
        ctx.beginPath();
        ctx.arc(leftCx, cy, outlineRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = rightFrameColor;
        ctx.beginPath();
        ctx.arc(rightCx, cy, outlineRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

    }

    drawCueDiamond(ctx, x, y, spatialCue) {
        // Mirrors drawCueDiamond() in jspsych-gabor.js exactly.
        const cue = (spatialCue || 'none').toString().toLowerCase();
        const half = 28;
        const fillLeft  = (cue === 'left'  || cue === 'both');
        const fillRight = (cue === 'right' || cue === 'both');

        ctx.save();

        // Left half fill
        ctx.beginPath();
        ctx.moveTo(x, y - half);
        ctx.lineTo(x, y + half);
        ctx.lineTo(x - half, y);
        ctx.closePath();
        ctx.fillStyle = fillLeft ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.08)';
        ctx.fill();

        // Right half fill
        ctx.beginPath();
        ctx.moveTo(x, y - half);
        ctx.lineTo(x + half, y);
        ctx.lineTo(x, y + half);
        ctx.closePath();
        ctx.fillStyle = fillRight ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.08)';
        ctx.fill();

        // Outline on top
        ctx.beginPath();
        ctx.moveTo(x, y - half);
        ctx.lineTo(x + half, y);
        ctx.lineTo(x, y + half);
        ctx.lineTo(x - half, y);
        ctx.closePath();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Fixation cross inside the cue (matches interpreter)
        ctx.strokeStyle = 'rgba(16,16,16,0.95)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 8, y);
        ctx.lineTo(x + 8, y);
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x, y + 8);
        ctx.stroke();

        ctx.restore();
    }

    drawRoundedRectStroke(ctx, x, y, width, height, radius, strokeStyle, lineWidth) {
        const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
        ctx.save();
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        ctx.lineTo(x + width, y + height - r);
        ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        ctx.lineTo(x + r, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
    }

    drawGaborPatch(ctx, centerX, centerY, sizePx, orientationDeg, { spatialFrequency, gratingWaveform, contrast: contrastParam, patchBorder } = {}) {
        const w = Math.max(8, Math.floor(sizePx));
        const h = w;
        const r = Math.floor(w / 2);
        const theta = (Number.isFinite(orientationDeg) ? orientationDeg : 0) * Math.PI / 180;

        // Frequency: cycles per pixel (tuned for preview visibility)
        const freq = (Number.isFinite(Number(spatialFrequency)) && Number(spatialFrequency) > 0)
            ? Number(spatialFrequency)
            : 0.06;
        const waveform = (gratingWaveform || 'sinusoidal').toString();
        const sigma = w / 6;
        const contrast = (Number.isFinite(Number(contrastParam)) && Number(contrastParam) >= 0)
            ? Math.min(1, Number(contrastParam))
            : 0.95;
        const phase = 0;

        const img = ctx.createImageData(w, h);
        const data = img.data;

        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        const twoSigma2 = 2 * sigma * sigma;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const dx = x - r;
                const dy = y - r;
                const rr = dx * dx + dy * dy;
                const idx = (y * w + x) * 4;

                // Circular aperture with alpha outside
                if (rr > r * r) {
                    data[idx + 0] = 0;
                    data[idx + 1] = 0;
                    data[idx + 2] = 0;
                    data[idx + 3] = 0;
                    continue;
                }

                // Rotate coordinates
                const xRot = dx * cosT + dy * sinT;

                const envelope = Math.exp(-(rr) / twoSigma2);
                const angle = 2 * Math.PI * freq * xRot + phase;
                let carrier = Math.cos(angle);
                if (waveform === 'square') {
                    carrier = (carrier >= 0) ? 1 : -1;
                } else if (waveform === 'triangle') {
                    // Triangle in [-1,1]
                    carrier = (2 / Math.PI) * Math.asin(Math.sin(angle));
                }

                const val = 127.5 + 127.5 * contrast * envelope * carrier;
                const v = Math.max(0, Math.min(255, Math.round(val)));

                data[idx + 0] = v;
                data[idx + 1] = v;
                data[idx + 2] = v;
                data[idx + 3] = 255;
            }
        }

        // NOTE: putImageData ignores the current transform matrix, so we must
        // provide absolute coordinates.
        ctx.putImageData(img, Math.round(centerX - r), Math.round(centerY - r));

        // Border ring (respects patchBorder settings, mirrors interpreter)
        const pbEnabled = patchBorder?.enabled !== false;
        const pbWidth   = Math.max(0, Math.min(50, Number(patchBorder?.widthPx ?? 2)));
        const pbOpacity = Math.max(0, Math.min(1, Number(patchBorder?.opacity ?? 0.22)));
        const pbColor   = (patchBorder?.color ?? '#ffffff').toString();
        if (pbEnabled && pbWidth > 0 && pbOpacity > 0) {
            ctx.save();
            ctx.strokeStyle = pbColor.startsWith('#')
                ? pbColor + Math.round(pbOpacity * 255).toString(16).padStart(2, '0')
                : `rgba(255,255,255,${pbOpacity})`;
            ctx.lineWidth = pbWidth;
            ctx.beginPath();
            ctx.arc(centerX, centerY, r - 1, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }

    showSurveyPreview(componentData) {
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modal } = previewModal;

        // Support both flat storage (preferred) and nested storage under `parameters`.
        const title = componentData?.title ?? componentData?.parameters?.title ?? 'Survey';
        const instructions = componentData?.instructions ?? componentData?.parameters?.instructions ?? '';
        const submitLabel = componentData?.submit_label ?? componentData?.parameters?.submit_label ?? 'Continue';
        const allowEmptyOnTimeout = !!(componentData?.allow_empty_on_timeout ?? componentData?.parameters?.allow_empty_on_timeout ?? false);
        const timeoutMs = (componentData?.timeout_ms ?? componentData?.parameters?.timeout_ms ?? null);
        const questions = Array.isArray(componentData?.questions)
            ? componentData.questions
            : (Array.isArray(componentData?.parameters?.questions) ? componentData.parameters.questions : []);

        const escape = (s) => {
            return (s ?? '')
                .toString()
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        const renderQuestion = (q) => {
            const id = escape(q?.id || 'q');
            const prompt = escape(q?.prompt || '');
            const required = q?.required ? 'required' : '';
            const type = (q?.type || 'text');

            if (type === 'likert' || type === 'radio') {
                const options = Array.isArray(q?.options) ? q.options : [];
                const optionsHtml = options
                    .map((opt, idx) => {
                        const optEsc = escape(opt);
                        const inputType = 'radio';
                        return `
                            <div class="form-check">
                                <input class="form-check-input" type="${inputType}" name="${id}" id="${id}_${idx}" ${required}>
                                <label class="form-check-label" for="${id}_${idx}">${optEsc}</label>
                            </div>
                        `;
                    })
                    .join('');
                return `
                    <div class="mb-3">
                        <label class="form-label fw-bold">${prompt || id}${q?.required ? ' *' : ''}</label>
                        ${optionsHtml || '<div class="text-muted">(No options configured)</div>'}
                    </div>
                `;
            }

            if (type === 'slider') {
                const min = Number.isFinite(Number(q?.min)) ? Number(q.min) : 0;
                const max = Number.isFinite(Number(q?.max)) ? Number(q.max) : 100;
                const step = Number.isFinite(Number(q?.step)) ? Number(q.step) : 1;
                const minLabel = escape(q?.min_label || '');
                const maxLabel = escape(q?.max_label || '');
                return `
                    <div class="mb-3">
                        <label class="form-label fw-bold" for="${id}">${prompt || id}${q?.required ? ' *' : ''}</label>
                        <input class="form-range" type="range" id="${id}" min="${min}" max="${max}" step="${step}" ${required}>
                        <div class="d-flex justify-content-between small text-muted">
                            <span>${minLabel || min}</span>
                            <span>${maxLabel || max}</span>
                        </div>
                    </div>
                `;
            }

            if (type === 'number') {
                const minAttr = (q?.min !== undefined && q?.min !== null && q?.min !== '') ? `min="${escape(q.min)}"` : '';
                const maxAttr = (q?.max !== undefined && q?.max !== null && q?.max !== '') ? `max="${escape(q.max)}"` : '';
                const stepAttr = (q?.step !== undefined && q?.step !== null && q?.step !== '') ? `step="${escape(q.step)}"` : '';
                const ph = escape(q?.placeholder || '');
                return `
                    <div class="mb-3">
                        <label class="form-label fw-bold" for="${id}">${prompt || id}${q?.required ? ' *' : ''}</label>
                        <input class="form-control" type="number" id="${id}" name="${id}" placeholder="${ph}" ${minAttr} ${maxAttr} ${stepAttr} ${required}>
                    </div>
                `;
            }

            // text
            const multiline = !!q?.multiline;
            const ph = escape(q?.placeholder || '');
            const rows = Number.isFinite(Number(q?.rows)) ? Math.max(1, Number(q.rows)) : 3;
            return `
                <div class="mb-3">
                    <label class="form-label fw-bold" for="${id}">${prompt || id}${q?.required ? ' *' : ''}</label>
                    ${multiline
                        ? `<textarea class="form-control" id="${id}" name="${id}" rows="${rows}" placeholder="${ph}" ${required}></textarea>`
                        : `<input class="form-control" type="text" id="${id}" name="${id}" placeholder="${ph}" ${required}>`
                    }
                </div>
            `;
        };

        const modalBody = document.querySelector('#componentPreviewModal .modal-body');
        if (modalBody) {
            modalBody.innerHTML = `
                <div class="survey-preview-container">
                    <h5 class="mb-1">${escape(title)}</h5>
                    ${instructions ? `<p class="text-muted">${escape(instructions)}</p>` : ''}
                    ${(allowEmptyOnTimeout && timeoutMs !== null && timeoutMs !== '')
                        ? `<div class="alert alert-warning py-2 small mb-2">Auto-continue enabled after <strong>${escape(timeoutMs)}</strong> ms (unanswered = empty/null).</div>`
                        : ''}
                    <form onsubmit="return false;" class="mt-3">
                        ${questions.map(renderQuestion).join('')}
                        <button type="button" class="btn btn-primary">${escape(submitLabel)}</button>
                        <div class="mt-2 small text-muted">
                            Preview only — the interpreter app should capture and store responses by question id.
                            ${questions.length === 0 ? '<br><strong>Note:</strong> No questions found on this component. (Expected `questions: [...]`.)' : ''}
                        </div>
                    </form>
                </div>
            `;
        }

        modal.show();
    }

    showBlockPreview(componentData) {
        const rawBaseType = componentData.block_component_type || componentData.component_type;
        const baseType = (typeof rawBaseType === 'string' && rawBaseType.trim() !== '') ? rawBaseType : 'rdm-trial';

        if (baseType === 'nback-block') {
            this.showNbackBlockGeneratorPreview(componentData);
            return;
        }

        if (baseType === 'continuous-image-presentation') {
            this.showContinuousImagePresentationBlockPreview(componentData);
            return;
        }

        // Render a randomly sampled parameter set from the block window so users can
        // quickly sanity-check the block configuration.
        const sampled = this.sampleComponentFromBlock(componentData);
        const length = componentData.block_length ?? componentData.length ?? 0;
        const sampling = componentData.sampling_mode || 'per-trial';

        sampled._previewContextNote = `Block sample → ${baseType} (length ${length}, ${sampling})`;
        sampled._blockPreviewSource = componentData;

        if (baseType === 'flanker-trial') {
            this.showFlankerPreview(sampled);
            return;
        }

        if (baseType === 'sart-trial') {
            this.showSartPreview(sampled);
            return;
        }

        if (baseType === 'gabor-trial' || baseType === 'gabor-quest' || baseType === 'gabor-learning') {
            console.log('   ✓ showBlockPreview routing to showGaborPreview for baseType:', baseType);
            this.showGaborPreview(sampled);
            return;
        }

        if (baseType === 'stroop-trial') {
            this.showStroopPreview(sampled);
            return;
        }

        if (baseType === 'emotional-stroop-trial') {
            this.showStroopPreview(sampled);
            return;
        }

        if (baseType === 'simon-trial') {
            this.showSimonPreview(sampled);
            return;
        }

        if (baseType === 'task-switching-trial') {
            this.showTaskSwitchingPreview(sampled);
            return;
        }

        if (baseType === 'pvt-trial') {
            this.showPvtPreview(sampled);
            return;
        }

        if (baseType === 'mot-trial') {
            this.showMotPreview(sampled);
            return;
        }

        if (baseType === 'html-keyboard-response') {
            const stimulusText = (sampled.stimulus ?? sampled.stimulus_html ?? '').toString() || 'No HTML stimulus provided';
            this.showInstructionsPreview(stimulusText, sampled);
            return;
        }

        if (baseType === 'html-button-response') {
            this.showHtmlButtonResponsePreview(sampled);
            return;
        }

        if (baseType === 'image-keyboard-response') {
            this.showImageKeyboardResponsePreview(sampled);
            return;
        }

        this.showRDMPreview(sampled);
    }

    stopContinuousImagePresentationPreview() {
        const timers = Array.isArray(this._cipPreviewTimeouts) ? this._cipPreviewTimeouts : [];
        for (const id of timers) {
            try {
                clearTimeout(id);
            } catch {
                // ignore
            }
        }
        this._cipPreviewTimeouts = [];

        // Cancel any in-flight sprite animations (RAF loops).
        this._cipPreviewPlayToken = (Number(this._cipPreviewPlayToken) || 0) + 1;
        if (Number.isFinite(Number(this._cipPreviewRafId))) {
            try {
                cancelAnimationFrame(this._cipPreviewRafId);
            } catch {
                // ignore
            }
        }
        this._cipPreviewRafId = null;

        // Reset visibility if the modal is currently open.
        const imageLayer = document.getElementById('cipPreviewModalImageLayer');
        const maskLayer = document.getElementById('cipPreviewModalMaskLayer');
        const spriteLayer = document.getElementById('cipPreviewModalSpriteLayer');
        const spriteCanvas = document.getElementById('cipPreviewModalSpriteCanvas');
        if (imageLayer) imageLayer.style.opacity = '0';
        if (maskLayer) maskLayer.style.opacity = '1';
        if (spriteLayer) spriteLayer.style.opacity = '0';
        if (spriteCanvas) {
            spriteCanvas.style.display = 'none';
            const ctx = spriteCanvas.getContext && spriteCanvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
            }
        }
    }

    renderCipPreviewMaskInto(maskLayer, canvas, maskType) {
        if (!maskLayer) return;

        const t0 = (maskType ?? '').toString().trim();
        const t = t0.toLowerCase();
        const normalized =
            (t === 'blank') ? 'blank'
            : (t === 'noise' || t === 'pure_noise' || t === 'noise_and_shuffle' || t === 'advanced_transform') ? 'noise'
            : (t === 'sprite') ? 'sprite'
            : 'noise';

        if (canvas && normalized === 'noise') {
            canvas.style.display = 'block';
            const ctx = canvas.getContext && canvas.getContext('2d');
            if (ctx) {
                const w = canvas.width || 320;
                const h = canvas.height || 200;
                const img = ctx.createImageData(w, h);
                for (let i = 0; i < img.data.length; i += 4) {
                    const v = Math.floor(Math.random() * 256);
                    img.data[i] = v;
                    img.data[i + 1] = v;
                    img.data[i + 2] = v;
                    img.data[i + 3] = 255;
                }
                ctx.putImageData(img, 0, 0);
            }

            maskLayer.style.backgroundImage = 'none';
            maskLayer.style.backgroundColor = '#111';
            return;
        }

        if (canvas) {
            canvas.style.display = 'none';
        }

        if (normalized === 'blank') {
            maskLayer.style.backgroundImage = 'none';
            maskLayer.style.backgroundColor = '#000';
            return;
        }

        // sprite (placeholder): simple patterned mask
        maskLayer.style.backgroundColor = '#111';
        maskLayer.style.backgroundSize = '20px 20px';
        maskLayer.style.backgroundImage = 'repeating-linear-gradient(45deg, rgba(255,255,255,0.12), rgba(255,255,255,0.12) 10px, rgba(255,255,255,0.02) 10px, rgba(255,255,255,0.02) 20px)';
    }

    playContinuousImagePresentationPreview({
        maskType,
        transitionMs,
        frames,
        imageMs,
        maskToImageSpriteUrl = '',
        imageToMaskSpriteUrl = '',
        imageUrl = '',
        sequenceItems = null
    }) {
        this.stopContinuousImagePresentationPreview();

        const imageLayer = document.getElementById('cipPreviewModalImageLayer');
        const maskLayer = document.getElementById('cipPreviewModalMaskLayer');
        const spriteLayer = document.getElementById('cipPreviewModalSpriteLayer');
        const canvas = document.getElementById('cipPreviewModalMaskCanvas');
        const spriteCanvas = document.getElementById('cipPreviewModalSpriteCanvas');
        if (!imageLayer || !maskLayer) return;

        if (imageUrl) {
            const cssUrl = (imageUrl ?? '').toString().trim().replace(/"/g, '%22');
            imageLayer.style.backgroundImage = `url("${cssUrl}")`;
            imageLayer.style.backgroundSize = 'contain';
            imageLayer.style.backgroundPosition = 'center';
            imageLayer.style.backgroundRepeat = 'no-repeat';
        } else {
            // Revert to the placeholder background defined in the HTML.
            imageLayer.style.backgroundImage = '';
            imageLayer.style.backgroundSize = '';
            imageLayer.style.backgroundPosition = '';
            imageLayer.style.backgroundRepeat = '';
        }

        const f = Math.max(2, Number.parseInt(frames ?? 8, 10) || 8);
        const tMs = Math.max(0, Number.parseInt(transitionMs ?? 250, 10) || 250);
        const iMs = Math.max(0, Number.parseInt(imageMs ?? 750, 10) || 750);
        const stepMs = Math.max(1, Math.floor(tMs / f));

        const items = Array.isArray(sequenceItems) && sequenceItems.length > 0
            ? sequenceItems
            : null;

        // If sprite URLs are provided, we should use them regardless of maskType.
        // `maskType` controls how the shared mask is *generated*, not whether we have sprites.
        const firstM2I = (items ? (items[0]?.maskToImageSpriteUrl ?? '') : maskToImageSpriteUrl).toString().trim();
        const firstI2M = (items ? (items[0]?.imageToMaskSpriteUrl ?? '') : imageToMaskSpriteUrl).toString().trim();
        const hasSprites = firstM2I !== '' && firstI2M !== '' && !!spriteCanvas;

        if (hasSprites) {
            // Sprite-sheet preview (canvas blit): deterministic per-frame drawing.
            if (canvas) canvas.style.display = 'none';
            if (spriteLayer) spriteLayer.style.opacity = '0';

            // Keep the mask label visible without covering the sprite.
            maskLayer.style.opacity = '1';
            maskLayer.style.backgroundImage = 'none';
            maskLayer.style.backgroundColor = 'transparent';
            imageLayer.style.opacity = '0';

            spriteCanvas.style.display = 'block';
            const spriteCtx = spriteCanvas.getContext && spriteCanvas.getContext('2d');
            if (!spriteCtx) return;

            const token = (Number(this._cipPreviewPlayToken) || 0) + 1;
            this._cipPreviewPlayToken = token;

            const ensureCanvasSize = () => {
                const dpr = window.devicePixelRatio || 1;
                const w = Math.max(1, Math.floor((spriteCanvas.clientWidth || spriteCanvas.width || 360) * dpr));
                const h = Math.max(1, Math.floor((spriteCanvas.clientHeight || spriteCanvas.height || 220) * dpr));
                if (spriteCanvas.width !== w || spriteCanvas.height !== h) {
                    spriteCanvas.width = w;
                    spriteCanvas.height = h;
                }
            };

            const loadImage = (url) => {
                const u = (url ?? '').toString().trim();
                if (!u) return Promise.resolve(null);
                const cache = (this._cipPreviewAssetCache && this._cipPreviewAssetCache instanceof Map)
                    ? this._cipPreviewAssetCache
                    : null;
                if (cache && cache.has(u)) return Promise.resolve(cache.get(u));

                return new Promise((resolve) => {
                    try {
                        const img = new Image();
                        img.decoding = 'async';
                        img.onload = () => {
                            try {
                                if (cache) cache.set(u, img);
                            } catch {
                                // ignore
                            }
                            resolve(img);
                        };
                        img.onerror = () => resolve(null);
                        img.src = u;
                    } catch {
                        resolve(null);
                    }
                });
            };

            const drawFrame = (img, frameIndex) => {
                if (!img) return;
                ensureCanvasSize();
                const fw = Math.floor(img.width / f);
                const fh = img.height;
                const idx = Math.max(0, Math.min(f - 1, frameIndex | 0));
                const sx = idx * fw;
                spriteCtx.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
                try {
                    // Draw with aspect-ratio preserved (like CSS background-size: contain)
                    const cw = spriteCanvas.width;
                    const ch = spriteCanvas.height;
                    const scale = Math.min(cw / Math.max(1, fw), ch / Math.max(1, fh));
                    const dw = Math.max(1, Math.floor(fw * scale));
                    const dh = Math.max(1, Math.floor(fh * scale));
                    const dx = Math.floor((cw - dw) / 2);
                    const dy = Math.floor((ch - dh) / 2);
                    spriteCtx.drawImage(img, sx, 0, fw, fh, dx, dy, dw, dh);
                } catch {
                    // ignore
                }
            };

            const playSprite = async (url, durationMs) => {
                const img = await loadImage(url);
                if (this._cipPreviewPlayToken !== token) return;
                if (!img) return;

                const dur = Math.max(0, Number.parseInt(durationMs ?? 0, 10) || 0);
                if (dur <= 0) {
                    drawFrame(img, f - 1);
                    return;
                }

                const start = performance.now();
                return new Promise((resolve) => {
                    const tick = () => {
                        if (this._cipPreviewPlayToken !== token) return resolve();
                        const now = performance.now();
                        const elapsed = now - start;
                        const p = Math.max(0, Math.min(1, elapsed / dur));
                        const idx = Math.min(f - 1, Math.floor(p * f));
                        drawFrame(img, idx);
                        if (elapsed >= dur) return resolve();
                        this._cipPreviewRafId = requestAnimationFrame(tick);
                    };
                    this._cipPreviewRafId = requestAnimationFrame(tick);
                });
            };

            const setImageUrl = (url) => {
                const u = (url ?? '').toString().trim();
                if (!u) return;
                const cssUrl = u.replace(/"/g, '%22');
                imageLayer.style.backgroundImage = `url("${cssUrl}")`;
                imageLayer.style.backgroundSize = 'contain';
                imageLayer.style.backgroundPosition = 'center';
                imageLayer.style.backgroundRepeat = 'no-repeat';
            };

            const seqItems = items ? items : [{ imageUrl, maskToImageSpriteUrl, imageToMaskSpriteUrl }];
            const maskHoldMs = Math.max(0, stepMs);

            (async () => {
                for (const it of seqItems) {
                    if (this._cipPreviewPlayToken !== token) return;

                    const m2i = (it?.maskToImageSpriteUrl ?? maskToImageSpriteUrl).toString().trim();
                    const i2m = (it?.imageToMaskSpriteUrl ?? imageToMaskSpriteUrl).toString().trim();
                    const imgUrl = (it?.imageUrl ?? imageUrl).toString().trim();

                    // Mask hold: show frame 0 of mask->image sprite (it starts at the shared mask).
                    imageLayer.style.opacity = '0';
                    maskLayer.style.opacity = '1';
                    spriteCanvas.style.display = 'block';
                    const m2iImg = await loadImage(m2i);
                    if (this._cipPreviewPlayToken !== token) return;
                    if (m2iImg) drawFrame(m2iImg, 0);
                    if (maskHoldMs > 0) await new Promise(r => setTimeout(r, maskHoldMs));

                    // mask -> image transition
                    await playSprite(m2i, tMs);
                    if (this._cipPreviewPlayToken !== token) return;

                    // show image
                    setImageUrl(imgUrl);
                    spriteCanvas.style.display = 'none';
                    imageLayer.style.opacity = '1';
                    maskLayer.style.opacity = '0';
                    if (iMs > 0) await new Promise(r => setTimeout(r, iMs));
                    if (this._cipPreviewPlayToken !== token) return;

                    // image -> mask transition
                    imageLayer.style.opacity = '0';
                    maskLayer.style.opacity = '1';
                    spriteCanvas.style.display = 'block';
                    await playSprite(i2m, tMs);
                    if (this._cipPreviewPlayToken !== token) return;
                }
            })();

            return;
        }

        // Fallback: placeholder (mask pattern/noise + opacity stepping)
        this.renderCipPreviewMaskInto(maskLayer, canvas, maskType);
        if (spriteLayer) spriteLayer.style.opacity = '0';

        const setMix = (alphaImage) => {
            const a = Math.max(0, Math.min(1, alphaImage));
            imageLayer.style.opacity = `${a}`;
            maskLayer.style.opacity = `${1 - a}`;
        };

        // Start fully masked
        setMix(0);

        const timeouts = [];

        // mask -> image
        for (let i = 0; i <= f; i += 1) {
            const t = i * stepMs;
            timeouts.push(setTimeout(() => setMix(i / f), t));
        }

        const afterTransition = f * stepMs;
        // hold image
        timeouts.push(setTimeout(() => setMix(1), afterTransition));
        // image -> mask
        const afterHold = afterTransition + iMs;
        for (let i = 0; i <= f; i += 1) {
            const t = afterHold + i * stepMs;
            timeouts.push(setTimeout(() => setMix(1 - (i / f)), t));
        }

        this._cipPreviewTimeouts = timeouts;
    }

    showContinuousImagePresentationBlockPreview(blockData) {
        // Normalize: some exports store block fields under parameter_values.
        const src = (blockData && typeof blockData === 'object' && blockData.parameter_values && typeof blockData.parameter_values === 'object')
            ? { ...blockData, ...blockData.parameter_values }
            : (blockData || {});

        const derived = {
            type: 'continuous-image-presentation',
            name: (src?.name ?? 'CIP Block Preview').toString(),
            preview_mode: 'block',
            mask_type: (src?.cip_mask_type ?? 'sprite').toString(),
            image_duration_ms: src?.cip_image_duration_ms,
            transition_duration_ms: src?.cip_transition_duration_ms,
            transition_frames: src?.cip_transition_frames,
            choices: (src?.cip_choice_keys ?? '').toString(),

            images_per_block: src?.cip_images_per_block,

            // Optional: generated assets for preview
            image_urls: (src?.cip_image_urls ?? '').toString(),
            mask_to_image_sprite_urls: (src?.cip_mask_to_image_sprite_urls ?? '').toString(),
            image_to_mask_sprite_urls: (src?.cip_image_to_mask_sprite_urls ?? '').toString()
        };

        this.showContinuousImagePresentationPreview(derived, { contextNote: 'Block preview (uses CIP block timings)' });
    }

    showContinuousImagePresentationPreview(componentData, { contextNote = '' } = {}) {
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modalEl, modal } = previewModal;

        const modalBody = modalEl.querySelector('.modal-body');
        if (!modalBody) return;

        const escape = (s) => {
            return (s ?? '')
                .toString()
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        const maskType = (componentData?.mask_type ?? componentData?.cip_mask_type ?? 'sprite').toString();
        const imageMs = componentData?.image_duration_ms ?? componentData?.cip_image_duration_ms ?? 750;
        const transitionMs = componentData?.transition_duration_ms ?? componentData?.cip_transition_duration_ms ?? 250;
        const frames = componentData?.transition_frames ?? componentData?.cip_transition_frames ?? 8;
        const keys = (componentData?.choices ?? componentData?.cip_choice_keys ?? '').toString();

        const parseUrlList = (raw) => {
            if (raw === undefined || raw === null) return [];
            return raw
                .toString()
                .split(/[\n,]+/)
                .map(s => s.trim())
                .filter(Boolean);
        };

        const imageUrls = parseUrlList(componentData?.image_urls ?? componentData?.cip_image_urls);
        const maskToImageSpriteUrls = parseUrlList(componentData?.mask_to_image_sprite_urls ?? componentData?.cip_mask_to_image_sprite_urls);
        const imageToMaskSpriteUrls = parseUrlList(componentData?.image_to_mask_sprite_urls ?? componentData?.cip_image_to_mask_sprite_urls);

        const sampleTransitionSet = () => {
            const hasPaired =
                imageUrls.length > 0 &&
                maskToImageSpriteUrls.length === imageUrls.length &&
                imageToMaskSpriteUrls.length === imageUrls.length;

            if (hasPaired) {
                const idx = Math.floor(Math.random() * imageUrls.length);
                return {
                    imageUrl: imageUrls[idx] || '',
                    maskToImageSpriteUrl: maskToImageSpriteUrls[idx] || '',
                    imageToMaskSpriteUrl: imageToMaskSpriteUrls[idx] || ''
                };
            }

            const pick = (arr) => {
                if (!Array.isArray(arr) || arr.length === 0) return '';
                const idx = Math.floor(Math.random() * arr.length);
                return arr[idx] || '';
            };

            return {
                imageUrl: pick(imageUrls),
                maskToImageSpriteUrl: pick(maskToImageSpriteUrls),
                imageToMaskSpriteUrl: pick(imageToMaskSpriteUrls)
            };
        };

        const sampleSequence = () => {
            const mode = (componentData?.preview_mode ?? '').toString();
            if (mode !== 'block') return [];

            const hasPaired =
                imageUrls.length > 0 &&
                maskToImageSpriteUrls.length === imageUrls.length &&
                imageToMaskSpriteUrls.length === imageUrls.length;

            if (!hasPaired) return [];

            const idxs = imageUrls.map((_, i) => i);
            // Fisher-Yates shuffle
            for (let i = idxs.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const tmp = idxs[i];
                idxs[i] = idxs[j];
                idxs[j] = tmp;
            }

            const nRaw = Number.parseInt(componentData?.images_per_block ?? componentData?.cip_images_per_block ?? 0, 10);
            const n = (Number.isFinite(nRaw) && nRaw > 0) ? Math.min(nRaw, idxs.length) : idxs.length;
            return idxs.slice(0, Math.max(1, n)).map((idx) => ({
                imageUrl: imageUrls[idx] || '',
                maskToImageSpriteUrl: maskToImageSpriteUrls[idx] || '',
                imageToMaskSpriteUrl: imageToMaskSpriteUrls[idx] || ''
            }));
        };

        const initialSample = sampleTransitionSet();
        const initialSequence = sampleSequence();

        const note = (componentData?._previewContextNote ?? contextNote ?? '').toString();

        modalBody.innerHTML = `
            <div class="p-3">
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <div>
                        <div class="h5 mb-0">Continuous Image Presentation (CIP)</div>
                        ${note ? `<div class="small text-muted">${escape(note)}</div>` : ''}
                    </div>
                    <div class="small text-muted text-end">
                        Mask: <strong>${escape(maskType)}</strong><br/>
                        Transition: ${escape(transitionMs)} ms (${escape(frames)} frames)<br/>
                        Image: ${escape(imageMs)} ms
                        ${keys ? `<br/>Keys: <span class="badge bg-secondary">${escape(keys)}</span>` : ''}
                    </div>
                </div>

                <div class="position-relative border rounded overflow-hidden" style="height:220px; background:#111;">
                    <div id="cipPreviewModalSpriteLayer" style="position:absolute; inset:0; opacity:0; background-color:#111;"></div>
                    <canvas id="cipPreviewModalSpriteCanvas" width="360" height="220" style="position:absolute; inset:0; width:100%; height:100%; display:none;"></canvas>
                    <div id="cipPreviewModalImageLayer" style="position:absolute; inset:0; opacity:0; background-size: 24px 24px; background-image: linear-gradient(45deg, rgba(255,255,255,0.10) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.10) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.10) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.10) 75%); background-position: 0 0, 0 12px, 12px -12px, -12px 0px;">
                        <div style="position:absolute; inset:auto 12px 12px 12px; color:#fff; font-size:12px; opacity:0.85;">IMAGE</div>
                    </div>
                    <div id="cipPreviewModalMaskLayer" style="position:absolute; inset:0; opacity:1; background-size: 20px 20px; background-image: repeating-linear-gradient(45deg, rgba(255,255,255,0.12), rgba(255,255,255,0.12) 10px, rgba(255,255,255,0.02) 10px, rgba(255,255,255,0.02) 20px);">
                        <canvas id="cipPreviewModalMaskCanvas" width="360" height="220" style="position:absolute; inset:0; width:100%; height:100%; display:none;"></canvas>
                        <div style="position:absolute; inset:auto 12px 12px 12px; color:#fff; font-size:12px; opacity:0.85;">MASK</div>
                    </div>
                    <div id="cipPreviewLoading" style="position:absolute; inset:0; display:none; align-items:center; justify-content:center; text-align:center; padding:12px; background: rgba(0,0,0,0.55); color:#fff; font-size:13px; z-index:5;">
                        Loading preview assets…
                    </div>
                </div>

                <div class="small text-muted mt-2">Preview plays one mask→image→mask cycle using the current timings (uses sprite sheets when available; otherwise placeholder visuals).</div>
                <div class="d-flex justify-content-end mt-2">
                    <button type="button" class="btn btn-sm btn-outline-secondary" id="cipPreviewResampleBtn">Resample</button>
                </div>
            </div>
        `;

        // Stop any prior timers, and ensure we stop when the modal closes.
        this.stopContinuousImagePresentationPreview();
        try {
            modalEl.addEventListener('hidden.bs.modal', () => this.stopContinuousImagePresentationPreview(), { once: true });
        } catch {
            // ignore
        }

        modal.show();

        const loadingEl = document.getElementById('cipPreviewLoading');
        const showLoading = (msg) => {
            if (loadingEl) {
                loadingEl.textContent = (msg ?? 'Loading preview assets…').toString();
                loadingEl.style.display = 'flex';
            }
        };
        const hideLoading = () => {
            if (loadingEl) loadingEl.style.display = 'none';
        };

        const preloadImage = (url) => {
            const u = (url ?? '').toString().trim();
            if (!u) return Promise.resolve({ ok: true, url: '' });
            return new Promise((resolve) => {
                try {
                    if (!this._cipPreviewAssetCache || !(this._cipPreviewAssetCache instanceof Map)) {
                        this._cipPreviewAssetCache = new Map();
                    }
                    const img = new Image();
                    img.decoding = 'async';
                    img.loading = 'eager';
                    img.onload = () => {
                        try {
                            this._cipPreviewAssetCache.set(u, img);
                        } catch {
                            // ignore
                        }
                        resolve({ ok: true, url: u });
                    };
                    img.onerror = () => resolve({ ok: false, url: u });
                    img.src = u;
                } catch {
                    resolve({ ok: false, url: u });
                }
            });
        };

        const preloadAll = async (urls) => {
            const uniq = Array.from(new Set((urls || []).map(s => (s ?? '').toString().trim()).filter(Boolean)));
            const results = await Promise.all(uniq.map(preloadImage));
            const failed = results.filter(r => !r.ok).map(r => r.url);
            return { ok: failed.length === 0, failed };
        };

        const playWithPreload = async ({ sample, sequence }) => {
            const token = (Number(this._cipPreviewLoadToken) || 0) + 1;
            this._cipPreviewLoadToken = token;

            const items = (Array.isArray(sequence) && sequence.length > 0)
                ? sequence
                : [sample];

            const urlsToLoad = [];
            for (const it of items) {
                urlsToLoad.push(it?.imageUrl ?? '');
                urlsToLoad.push(it?.maskToImageSpriteUrl ?? '');
                urlsToLoad.push(it?.imageToMaskSpriteUrl ?? '');
            }

            showLoading(`Loading ${urlsToLoad.filter(Boolean).length} assets…`);
            const { ok, failed } = await preloadAll(urlsToLoad);
            if (this._cipPreviewLoadToken !== token) return;
            hideLoading();

            if (!ok) {
                console.warn('CIP preview: some assets failed to preload:', failed);
            }

            this.playContinuousImagePresentationPreview({
                maskType,
                transitionMs,
                frames,
                imageMs,
                maskToImageSpriteUrl: sample?.maskToImageSpriteUrl ?? '',
                imageToMaskSpriteUrl: sample?.imageToMaskSpriteUrl ?? '',
                imageUrl: sample?.imageUrl ?? '',
                sequenceItems: (Array.isArray(sequence) && sequence.length > 0) ? sequence : null
            });
        };

        playWithPreload({ sample: initialSample, sequence: initialSequence });

        const resampleBtn = document.getElementById('cipPreviewResampleBtn');
        if (resampleBtn) {
            resampleBtn.addEventListener('click', () => {
                const seq = sampleSequence();
                const one = sampleTransitionSet();
                playWithPreload({ sample: one, sequence: (Array.isArray(seq) && seq.length > 0) ? seq : null });
            });
        }
    }

    showHtmlButtonResponsePreview(componentData) {
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modalEl, modal } = previewModal;

        const modalBody = modalEl.querySelector('.modal-body');
        if (!modalBody) return;

        const stimulus = (componentData?.stimulus ?? componentData?.stimulus_html ?? '').toString();
        const prompt = (componentData?.prompt ?? '').toString();
        const rawChoices = (componentData?.button_choices ?? componentData?.choices ?? 'Continue');

        const labels = Array.isArray(rawChoices)
            ? rawChoices.map(x => (x ?? '').toString()).filter(s => s.trim() !== '')
            : rawChoices
                .toString()
                .split(/[\n,]+/)
                .map(s => s.trim())
                .filter(Boolean);

        const btns = (labels.length > 0 ? labels : ['Continue']).slice(0, 8).map((label) => {
            return `<button type="button" class="btn btn-outline-light" disabled>${label}</button>`;
        }).join(' ');

        const body = `
            <h5 style="margin:0 0 10px 0;">HTML + Button Response</h5>
            <div class="p-3 border rounded" style="background: rgba(255,255,255,0.06);">
                <div>${stimulus || '<span class="text-warning">No HTML stimulus provided.</span>'}</div>
                ${prompt ? `<div style="margin-top:12px; opacity:0.9;">${prompt}</div>` : ''}
                <div style="margin-top:16px; display:flex; gap:10px; flex-wrap:wrap; justify-content:center;">${btns}</div>
            </div>
        `;

        modalBody.innerHTML = this.wrapCenteredPreview(body);
        modal.show();
    }

    showNbackBlockGeneratorPreview(blockData) {
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modalEl, modal } = previewModal;

        const modalBody = modalEl.querySelector('.modal-body');
        if (!modalBody) return;

        // Normalize: some exports store block fields under parameter_values.
        const src = (blockData && typeof blockData === 'object' && blockData.parameter_values && typeof blockData.parameter_values === 'object')
            ? { ...blockData, ...blockData.parameter_values }
            : (blockData || {});

        const escape = (s) => {
            return (s ?? '')
                .toString()
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        const parsePool = (raw, stimulusMode) => {
            const parts = (raw ?? '')
                .toString()
                .split(/[\n,]/g)
                .map(s => s.trim())
                .filter(Boolean);
            if (parts.length > 0) return parts;
            const mode = (stimulusMode ?? 'letters').toString().trim().toLowerCase();
            if (mode === 'numbers') return ['1','2','3','4','5','6','7','8','9'];
            if (mode === 'shapes') return ['●','■','▲','◆','★','⬟'];
            if (mode === 'custom') return ['A','B','C'];
            return ['A','B','C','D','E','F','G','H'];
        };

        const toInt = (v, fallback) => {
            const n = Number.parseInt(v, 10);
            return Number.isFinite(n) ? n : fallback;
        };

        const toFloat = (v, fallback) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : fallback;
        };

        const n = Math.max(1, Math.floor(toInt(src.nback_n, 2)));
        const targetProb = Math.max(0, Math.min(1, toFloat(src.nback_target_probability, 0.25)));
        const stimulusMode = (src.nback_stimulus_mode ?? 'letters').toString().trim().toLowerCase();
        const pool = parsePool(src.nback_stimulus_pool, stimulusMode);
        const rawLen = toInt(src.block_length ?? src.length, 30);
        const length = Math.max(rawLen, n + 1);

        const seedStr = (src.seed ?? '').toString().trim();
        const sampling = (src.sampling_mode ?? 'per-trial').toString();

        const renderMode = (src.nback_render_mode ?? 'token').toString().trim().toLowerCase();
        const templateHtml = (src.nback_stimulus_template_html ?? '<div style="font-size:72px; font-weight:700; letter-spacing:0.02em;">{{TOKEN}}</div>').toString();

        const stimMs = Math.max(0, toInt(src.nback_stimulus_duration_ms, 500));
        const isiMs = Math.max(0, toInt(src.nback_isi_duration_ms, 700));

        const responseParadigm = (src.nback_response_paradigm ?? 'go_nogo').toString().trim().toLowerCase();
        const responseDeviceRaw = (src.nback_response_device ?? 'keyboard').toString().trim().toLowerCase();
        const responseDevice = (responseDeviceRaw === 'inherit')
            ? ((window.jsonBuilderInstance?.getCurrentNbackDefaults?.()?.nback_response_device || 'keyboard').toString().trim().toLowerCase())
            : responseDeviceRaw;

        const goKey = (src.nback_go_key ?? 'space').toString();
        const matchKey = (src.nback_match_key ?? 'j').toString();
        const nonmatchKey = (src.nback_nonmatch_key ?? 'f').toString();
        const showButtons = (src.nback_show_buttons === true);

        // For resampling, reuse the same seeded RNG machinery as other Block previews.
        // This will generate a deterministic stream per seed across resamples.
        const rng = this.getBlockRng(src);

        const pickFromPool = (avoidToken) => {
            if (!Array.isArray(pool) || pool.length === 0) return 'A';
            if (!avoidToken || pool.length === 1) return pool[Math.floor(rng() * pool.length)];
            let token = pool[Math.floor(rng() * pool.length)];
            let guard = 0;
            while (token === avoidToken && guard < 10) {
                token = pool[Math.floor(rng() * pool.length)];
                guard++;
            }
            return token;
        };

        const buildSequence = () => {
            const seq = new Array(length);
            const isTarget = new Array(length);
            for (let i = 0; i < length; i++) {
                if (i >= n && rng() < targetProb) {
                    seq[i] = seq[i - n];
                    isTarget[i] = true;
                } else {
                    const avoid = (i >= n) ? seq[i - n] : null;
                    seq[i] = pickFromPool(avoid);
                    isTarget[i] = (i >= n) ? (seq[i] === seq[i - n]) : false;
                }
            }
            return { seq, isTarget };
        };

        const render = () => {
            const { seq, isTarget } = buildSequence();
            const maxRows = Math.min(length, 40);
            const rowsHtml = seq.slice(0, maxRows).map((t, i) => {
                const tag = isTarget[i]
                    ? '<span class="badge bg-success">match</span>'
                    : (i < n) ? '<span class="badge bg-secondary">buffer</span>' : '<span class="badge bg-dark">no</span>';
                const back = (i >= n) ? seq[i - n] : '';
                return `
                    <tr>
                        <td class="text-muted">${i + 1}</td>
                        <td style="font-weight:700; font-size:18px;">${escape(t)}</td>
                        <td class="text-muted">${escape(back)}</td>
                        <td>${tag}</td>
                    </tr>
                `;
            }).join('');

            const runLen = Math.min(6, length);
            let runIndex = 0;
            let isPlaying = false;
            let timer = null;
            let phase = 'stimulus'; // stimulus | isi

            const escapeToken = (s) => {
                return (s ?? '')
                    .toString()
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');
            };

            const renderStimulusHtml = (token) => {
                if (renderMode === 'custom_html') {
                    const safeToken = escapeToken(token);
                    if (templateHtml.includes('{{TOKEN}}')) {
                        return templateHtml.split('{{TOKEN}}').join(safeToken);
                    }
                    return `${templateHtml}${safeToken}`;
                }
                return `<div style="font-size:72px; font-weight:700; letter-spacing:0.02em;">${escapeToken(token)}</div>`;
            };

            const responseHintHtml = (() => {
                if (responseDevice === 'mouse') {
                    if (showButtons) {
                        if (responseParadigm === '2afc') {
                            return `<div class="d-flex justify-content-center gap-2 mt-3">
                                <button class="btn btn-outline-light" type="button" disabled>Match</button>
                                <button class="btn btn-outline-light" type="button" disabled>No match</button>
                            </div>`;
                        }
                        return `<div class="d-flex justify-content-center gap-2 mt-3">
                            <button class="btn btn-outline-light" type="button" disabled>Go</button>
                        </div>`;
                    }
                    return `<div class="small text-muted mt-3">Mouse response (buttons hidden)</div>`;
                }

                if (responseParadigm === '2afc') {
                    const mk = (matchKey ?? '').toString().trim() || goKey;
                    return `<div class="small text-muted mt-3"><b>Keyboard:</b> <span class="badge bg-secondary">${escapeToken(mk)}</span> = MATCH, <span class="badge bg-secondary">${escapeToken(nonmatchKey)}</span> = NO MATCH</div>`;
                }
                return `<div class="small text-muted mt-3"><b>Keyboard:</b> <span class="badge bg-secondary">${escapeToken(goKey)}</span> = GO</div>`;
            })();

            modalBody.innerHTML = `
                <div class="p-3">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <div>
                            <div class="h5 mb-0">N-back Block Preview</div>
                            <div class="small text-muted">block_component_type=nback-block · n=${escape(n)} · length=${escape(length)} · target_probability=${escape(targetProb)} · pool=${escape(pool.length)} items</div>
                            <div class="small text-muted">seed=${escape(seedStr || '(none)')} · sampling_mode=${escape(sampling)}</div>
                        </div>
                        <div class="text-end">
                            <button type="button" class="btn btn-sm btn-outline-secondary" id="nbackBlockResampleBtn"><i class="fas fa-dice"></i> Resample</button>
                        </div>
                    </div>

                    <ul class="nav nav-tabs" role="tablist">
                        <li class="nav-item" role="presentation">
                            <button class="nav-link active" id="nbackGenSeqTabBtn" data-bs-toggle="tab" data-bs-target="#nbackGenSeqTab" type="button" role="tab">Sequence</button>
                        </li>
                        <li class="nav-item" role="presentation">
                            <button class="nav-link" id="nbackGenRunTabBtn" data-bs-toggle="tab" data-bs-target="#nbackGenRunTab" type="button" role="tab">Run</button>
                        </li>
                    </ul>

                    <div class="tab-content border border-top-0 rounded-bottom p-3" style="background:#fff;">
                        <div class="tab-pane fade show active" id="nbackGenSeqTab" role="tabpanel" aria-labelledby="nbackGenSeqTabBtn">
                            <div class="table-responsive">
                                <table class="table table-sm align-middle">
                                    <thead>
                                        <tr>
                                            <th style="width:70px;">#</th>
                                            <th>Token</th>
                                            <th style="width:140px;">Back (${escape(n)})</th>
                                            <th style="width:120px;">Match?</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${rowsHtml}
                                    </tbody>
                                </table>
                            </div>
                            ${length > maxRows ? `<div class="small text-muted">Showing first ${escape(maxRows)} of ${escape(length)} items.</div>` : ''}
                        </div>

                        <div class="tab-pane fade" id="nbackGenRunTab" role="tabpanel" aria-labelledby="nbackGenRunTabBtn">
                            <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
                                <div class="small text-muted">Demo run: first ${escape(runLen)} items · ${escape(renderMode)} · ${escape(responseParadigm)} · ${escape(responseDevice)}</div>
                                <div class="btn-group btn-group-sm" role="group" aria-label="run controls">
                                    <button type="button" class="btn btn-outline-primary" id="nbackRunStartBtn">Start</button>
                                    <button type="button" class="btn btn-outline-secondary" id="nbackRunStopBtn">Stop</button>
                                    <button type="button" class="btn btn-outline-secondary" id="nbackRunPrevBtn">Prev</button>
                                    <button type="button" class="btn btn-outline-secondary" id="nbackRunNextBtn">Next</button>
                                </div>
                            </div>

                            <div class="p-3" style="background:#0b1220; border-radius:12px; color:#e5e7eb; min-height: 220px;">
                                <div class="d-flex justify-content-between align-items-start mb-2">
                                    <div>
                                        <div class="h6 mb-0">Run Preview</div>
                                        <div class="small text-muted" id="nbackRunStatus"></div>
                                    </div>
                                    <div class="small text-muted">stim=${escape(stimMs)}ms · isi=${escape(isiMs)}ms</div>
                                </div>

                                <div class="p-4" style="background:rgba(255,255,255,0.06); border-radius:12px;">
                                    <div id="nbackRunStimulus" style="display:flex; align-items:center; justify-content:center; min-height: 90px;"></div>
                                    <div id="nbackRunResponseHint">${responseHintHtml}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            const stop = () => {
                if (timer !== null) {
                    clearTimeout(timer);
                    timer = null;
                }
                isPlaying = false;
            };

            const setPhase = (nextPhase) => {
                phase = nextPhase;
            };

            const updateRunUI = () => {
                const statusEl = modalBody.querySelector('#nbackRunStatus');
                const stimEl = modalBody.querySelector('#nbackRunStimulus');
                if (!statusEl || !stimEl) return;

                const token = seq[runIndex];
                const back = (runIndex >= n) ? seq[runIndex - n] : '';
                const m = !!isTarget[runIndex];
                const label = m ? 'match' : (runIndex < n ? 'buffer' : 'no');
                statusEl.textContent = `item ${runIndex + 1}/${runLen} · token=${token} · back(${n})=${back || '-'} · ${label} · phase=${phase}`;

                if (phase === 'stimulus') {
                    stimEl.innerHTML = renderStimulusHtml(token);
                } else {
                    stimEl.innerHTML = '';
                }
            };

            const stepOnce = () => {
                // stimulus -> isi -> advance
                if (phase === 'stimulus') {
                    setPhase('isi');
                    updateRunUI();
                    return;
                }

                // isi: advance
                setPhase('stimulus');
                runIndex = Math.min(runLen - 1, runIndex + 1);
                updateRunUI();
            };

            const tick = () => {
                if (!isPlaying) return;
                if (phase === 'stimulus') {
                    setPhase('isi');
                    updateRunUI();
                    timer = setTimeout(tick, Math.max(0, isiMs));
                    return;
                }

                // isi -> next stimulus
                runIndex += 1;
                if (runIndex >= runLen) {
                    stop();
                    return;
                }
                setPhase('stimulus');
                updateRunUI();
                timer = setTimeout(tick, Math.max(0, stimMs));
            };

            const start = () => {
                stop();
                isPlaying = true;
                phase = 'stimulus';
                updateRunUI();
                timer = setTimeout(tick, Math.max(0, stimMs));
            };

            const startBtn = modalBody.querySelector('#nbackRunStartBtn');
            const stopBtn = modalBody.querySelector('#nbackRunStopBtn');
            const nextBtn = modalBody.querySelector('#nbackRunNextBtn');
            const prevBtn = modalBody.querySelector('#nbackRunPrevBtn');
            const resampleBtn = modalBody.querySelector('#nbackBlockResampleBtn');

            if (startBtn) startBtn.onclick = () => start();
            if (stopBtn) stopBtn.onclick = () => stop();
            if (nextBtn) nextBtn.onclick = () => {
                stop();
                // keep current phase; advance one item
                runIndex = Math.min(runLen - 1, runIndex + 1);
                phase = 'stimulus';
                updateRunUI();
            };
            if (prevBtn) prevBtn.onclick = () => {
                stop();
                runIndex = Math.max(0, runIndex - 1);
                phase = 'stimulus';
                updateRunUI();
            };

            if (resampleBtn) {
                resampleBtn.onclick = () => {
                    stop();
                    render();
                };
            }

            // Initialize run UI
            updateRunUI();
        };

        render();
        modal.show();
    }

    getBlockRng(blockData) {
        const seedStr = (blockData?.seed ?? '').toString().trim();
        const seed = Number.parseInt(seedStr, 10);
        const hasSeed = Number.isFinite(seed);

        if (!hasSeed) {
            return () => Math.random();
        }

        if (this.blockPreviewSeed !== seed || this.blockPreviewRngState === null) {
            // Mulberry32 state must be uint32
            this.blockPreviewSeed = seed;
            this.blockPreviewRngState = (seed >>> 0);
        }

        return () => {
            // mulberry32
            let t = (this.blockPreviewRngState += 0x6D2B79F5);
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            const out = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            return out;
        };
    }

    sampleComponentFromBlock(blockData) {
        // Some builder flows store block parameter fields under `parameter_values`.
        // Normalize into a single flat object so previews work from either shape.
            const src = (blockData && typeof blockData === 'object' && blockData.parameter_values && typeof blockData.parameter_values === 'object')
            ? { ...blockData, ...blockData.parameter_values }
            : blockData;

        const rng = this.getBlockRng(src);
        const rawType = src?.block_component_type || src?.component_type;
        const componentType = (typeof rawType === 'string' && rawType.trim() !== '') ? rawType : 'rdm-trial';

        const randFloat = (min, max) => {
            const a = Number(min);
            const b = Number(max);
            if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
            const lo = Math.min(a, b);
            const hi = Math.max(a, b);
            return lo + (hi - lo) * rng();
        };

        const randInt = (min, max) => {
            const f = randFloat(min, max);
            if (f === null) return null;
            // inclusive
            const lo = Math.min(Number(min), Number(max));
            const hi = Math.max(Number(min), Number(max));
            return Math.floor(lo + (hi - lo + 1) * rng());
        };

        const parseNumberList = (raw, { min = 0, max = 359 } = {}) => {
            if (raw === undefined || raw === null) return [];
            const parts = raw
                .toString()
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
            const nums = [];
            for (const p of parts) {
                const n = Number(p);
                if (!Number.isFinite(n)) continue;
                if (n < min || n > max) continue;
                nums.push(n);
            }
            return Array.from(new Set(nums));
        };

        const pickFromList = (arr, fallback) => {
            if (!Array.isArray(arr) || arr.length === 0) return fallback;
            const idx = Math.floor(rng() * arr.length);
            return arr[Math.max(0, Math.min(arr.length - 1, idx))];
        };

        const parseStringList = (raw) => {
            if (raw === undefined || raw === null) return [];
            return raw
                .toString()
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
        };

        // Start with a minimal component data shape compatible with showRDMPreview()
        const sampled = { type: componentType };

        // Pass through per-block response cue settings (dot-groups)
        if (src?.response_target_group !== undefined) sampled.response_target_group = src.response_target_group;
        if (src?.cue_border_mode !== undefined) sampled.cue_border_mode = src.cue_border_mode;
        if (src?.cue_border_color !== undefined) sampled.cue_border_color = src.cue_border_color;
        if (src?.cue_border_width !== undefined) sampled.cue_border_width = src.cue_border_width;

        // Pass through per-block aperture outline settings (all RDM types)
        // New export nests these under `aperture_parameters`, but keep flat-field support for older configs.
        if (src?.aperture_parameters && typeof src.aperture_parameters === 'object') {
            sampled.aperture_parameters = { ...src.aperture_parameters };
        }
        if (src?.show_aperture_outline_mode !== undefined) sampled.show_aperture_outline_mode = src.show_aperture_outline_mode;
        if (src?.show_aperture_outline !== undefined) sampled.show_aperture_outline = src.show_aperture_outline;
        if (src?.aperture_outline_width !== undefined) sampled.aperture_outline_width = src.aperture_outline_width;
        if (src?.aperture_outline_color !== undefined) sampled.aperture_outline_color = src.aperture_outline_color;

        if (componentType === 'rdm-trial') {
            const coherence = randFloat(src.coherence_min, src.coherence_max);
            if (coherence !== null) sampled.coherence = Math.max(0, Math.min(1, coherence));

            const speed = randFloat(src.speed_min, src.speed_max);
            if (speed !== null) sampled.speed = speed;

            const dirs = parseNumberList(src.direction_options);
            sampled.direction = pickFromList(dirs, 0);

            if (typeof src.dot_color === 'string' && src.dot_color.trim() !== '') {
                sampled.dot_color = src.dot_color;
            }
        } else if (componentType === 'rdm-practice') {
            const coherence = randFloat(src.practice_coherence_min, src.practice_coherence_max);
            if (coherence !== null) sampled.coherence = Math.max(0, Math.min(1, coherence));

            const dirs = parseNumberList(src.practice_direction_options);
            sampled.direction = pickFromList(dirs, 0);

            // Feedback window isn't directly visualized, but keep it on the payload for completeness.
            const feedback = randInt(src.practice_feedback_duration_min, src.practice_feedback_duration_max);
            if (feedback !== null) sampled.feedback_duration = feedback;

            if (typeof src.dot_color === 'string' && src.dot_color.trim() !== '') {
                sampled.dot_color = src.dot_color;
            }
        } else if (componentType === 'rdm-adaptive') {
            // Preview a single plausible stimulus instance by sampling initial_coherence → coherence.
            const coherence = randFloat(src.adaptive_initial_coherence_min, src.adaptive_initial_coherence_max);
            if (coherence !== null) sampled.coherence = Math.max(0, Math.min(1, coherence));

            if (typeof src.dot_color === 'string' && src.dot_color.trim() !== '') {
                sampled.dot_color = src.dot_color;
            }
        } else if (componentType === 'rdm-dot-groups') {
            // Percentages: sample group_1 and set group_2 = 100 - group_1
            const g1Pct = randInt(src.group_1_percentage_min, src.group_1_percentage_max);
            const safeG1Pct = (g1Pct === null) ? 50 : Math.max(0, Math.min(100, g1Pct));
            sampled.group_1_percentage = safeG1Pct;
            sampled.group_2_percentage = 100 - safeG1Pct;

            const g1C = randFloat(src.group_1_coherence_min, src.group_1_coherence_max);
            if (g1C !== null) sampled.group_1_coherence = Math.max(0, Math.min(1, g1C));
            const g2C = randFloat(src.group_2_coherence_min, src.group_2_coherence_max);
            if (g2C !== null) sampled.group_2_coherence = Math.max(0, Math.min(1, g2C));

            const g1S = randFloat(src.group_1_speed_min, src.group_1_speed_max);
            if (g1S !== null) sampled.group_1_speed = g1S;
            const g2S = randFloat(src.group_2_speed_min, src.group_2_speed_max);
            if (g2S !== null) sampled.group_2_speed = g2S;

            const g1Dirs = parseNumberList(src.group_1_direction_options);
            sampled.group_1_direction = pickFromList(g1Dirs, 0);
            const g2Dirs = parseNumberList(src.group_2_direction_options);
            sampled.group_2_direction = pickFromList(g2Dirs, 180);

            const fallback = (typeof src.dot_color === 'string' && src.dot_color.trim() !== '') ? src.dot_color : null;
            sampled.group_1_color = (typeof src.group_1_color === 'string' && src.group_1_color.trim() !== '') ? src.group_1_color : (fallback || '#FF0066');
            sampled.group_2_color = (typeof src.group_2_color === 'string' && src.group_2_color.trim() !== '') ? src.group_2_color : (fallback || '#0066FF');
        } else if (componentType === 'flanker-trial') {
            const congruency = parseStringList(src.flanker_congruency_options);
            sampled.congruency = pickFromList(congruency, 'congruent');

            // Optional stimulus type and symbol options
            const stimType = (src.flanker_stimulus_type || 'arrows').toString();
            sampled.stimulus_type = stimType;
            const isArrows = stimType.trim().toLowerCase() === 'arrows' || stimType.trim() === '';

            if (isArrows) {
                const dirs = parseStringList(src.flanker_target_direction_options);
                sampled.target_direction = pickFromList(dirs, 'left');
            } else {
                const tOpts = parseStringList(src.flanker_target_stimulus_options);
                const dOpts = parseStringList(src.flanker_distractor_stimulus_options);
                const nOpts = parseStringList(src.flanker_neutral_stimulus_options);
                sampled.target_stimulus = pickFromList(tOpts, 'H');
                sampled.distractor_stimulus = pickFromList(dOpts, 'S');
                sampled.neutral_stimulus = pickFromList(nOpts, '–');
            }

            sampled.left_key = (src.flanker_left_key || 'f').toString();
            sampled.right_key = (blockData.flanker_right_key || 'j').toString();
            sampled.show_fixation_dot = !!(blockData.flanker_show_fixation_dot ?? false);
            sampled.show_fixation_cross_between_trials = !!(blockData.flanker_show_fixation_cross_between_trials ?? false);

            const stimMs = randInt(blockData.flanker_stimulus_duration_min, blockData.flanker_stimulus_duration_max);
            if (stimMs !== null) sampled.stimulus_duration_ms = stimMs;

            const trialMs = randInt(blockData.flanker_trial_duration_min, blockData.flanker_trial_duration_max);
            if (trialMs !== null) sampled.trial_duration_ms = trialMs;

            const iti = randInt(blockData.flanker_iti_min, blockData.flanker_iti_max);
            if (iti !== null) sampled.iti_ms = iti;
        } else if (componentType === 'sart-trial') {
            const parseIntList = (raw) => {
                if (raw === undefined || raw === null) return [];
                return raw
                    .toString()
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean)
                    .map(s => Number.parseInt(s, 10))
                    .filter(n => Number.isFinite(n));
            };

            const digits = parseIntList(blockData.sart_digit_options);
            const nogo = Number.parseInt(blockData.sart_nogo_digit, 10);
            const nogoProb = Number.parseFloat(blockData.sart_nogo_probability);
            const useWeighted = Number.isFinite(nogoProb) && nogoProb > 0 && nogoProb < 1 && Number.isFinite(nogo);
            if (useWeighted) {
                const goDigits = digits.filter(d => d !== nogo);
                if (goDigits.length > 0 && Math.random() < nogoProb) {
                    sampled.digit = nogo;
                } else {
                    sampled.digit = pickFromList(goDigits.length > 0 ? goDigits : digits, 1);
                }
            } else {
                sampled.digit = pickFromList(digits, 1);
            }

            if (Number.isFinite(nogo)) sampled.nogo_digit = nogo;

            sampled.go_key = (blockData.sart_go_key || 'space').toString();

            const stimMs = randInt(blockData.sart_stimulus_duration_min, blockData.sart_stimulus_duration_max);
            if (stimMs !== null) sampled.stimulus_duration_ms = stimMs;
            const maskMs = randInt(blockData.sart_mask_duration_min, blockData.sart_mask_duration_max);
            if (maskMs !== null) sampled.mask_duration_ms = maskMs;

            const trialMs = randInt(blockData.sart_trial_duration_min, blockData.sart_trial_duration_max);
            if (trialMs !== null) sampled.trial_duration_ms = trialMs;

            const iti = randInt(blockData.sart_iti_min, blockData.sart_iti_max);
            if (iti !== null) sampled.iti_ms = iti;
        } else if (componentType === 'simon-trial') {
            const colors = parseStringList(src.simon_color_options);
            sampled.stimulus_color_name = pickFromList(colors, 'BLUE');

            const sides = parseStringList(src.simon_side_options);
            sampled.stimulus_side = pickFromList(sides, 'left');

            sampled.response_device = (src.simon_response_device || 'inherit').toString();
            sampled.left_key = (src.simon_left_key || 'f').toString();
            sampled.right_key = (src.simon_right_key || 'j').toString();

            const stimMs = randInt(src.simon_stimulus_duration_min, src.simon_stimulus_duration_max);
            if (stimMs !== null) sampled.stimulus_duration_ms = stimMs;

            const trialMs = randInt(src.simon_trial_duration_min, src.simon_trial_duration_max);
            if (trialMs !== null) sampled.trial_duration_ms = trialMs;

            const iti = randInt(src.simon_iti_min, src.simon_iti_max);
            if (iti !== null) sampled.iti_ms = iti;
        } else if (componentType === 'pvt-trial') {
            sampled.response_device = (src.pvt_response_device || 'inherit').toString();
            sampled.response_key = (src.pvt_response_key || 'space').toString();

            const fp = randInt(src.pvt_foreperiod_min, src.pvt_foreperiod_max);
            if (fp !== null) sampled.foreperiod_ms = fp;

            const trialMs = randInt(src.pvt_trial_duration_min, src.pvt_trial_duration_max);
            if (trialMs !== null) sampled.trial_duration_ms = trialMs;

            const iti = randInt(src.pvt_iti_min, src.pvt_iti_max);
            if (iti !== null) sampled.iti_ms = iti;
        } else if (componentType === 'mot-trial') {
            const parseIntCSV = (raw) => (raw ?? '').toString().split(',')
                .map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n));
            const numObjs = parseIntCSV(src.mot_num_objects_options);
            sampled.num_objects = numObjs.length > 0 ? numObjs[Math.floor(Math.random() * numObjs.length)] : 8;
            const numTgts = parseIntCSV(src.mot_num_targets_options);
            sampled.num_targets = numTgts.length > 0 ? numTgts[Math.floor(Math.random() * numTgts.length)] : 4;
            const spd = randFloat(src.mot_speed_px_per_s_min, src.mot_speed_px_per_s_max);
            if (spd !== null) sampled.speed_px_per_s = spd;
            const tDur = randInt(src.mot_tracking_duration_ms_min, src.mot_tracking_duration_ms_max);
            if (tDur !== null) sampled.tracking_duration_ms = tDur;
            const cDur = randInt(src.mot_cue_duration_ms_min, src.mot_cue_duration_ms_max);
            if (cDur !== null) sampled.cue_duration_ms = cDur;
            const itiMot = randInt(src.mot_iti_ms_min, src.mot_iti_ms_max);
            if (itiMot !== null) sampled.iti_ms = itiMot;
            sampled.motion_type      = (src.mot_motion_type || 'linear').toString();
            sampled.probe_mode       = (src.mot_probe_mode  || 'click').toString();
            sampled.show_feedback    = !!src.mot_show_feedback;
            sampled.object_color     = src.object_color     || '#FFFFFF';
            sampled.target_cue_color = src.target_cue_color || '#FF9900';
            sampled.background_color = src.background_color || '#111111';
        } else if (componentType === 'stroop-trial') {
            const uiStimulusNames = (() => {
                try {
                    const list = window.jsonBuilderInstance?.getCurrentStroopStimuliFromUI?.();
                    return (Array.isArray(list) ? list : [])
                        .map(s => (s?.name ?? '').toString().trim())
                        .filter(Boolean);
                } catch {
                    return [];
                }
            })();

            const wordsRaw = parseStringList(src.stroop_word_options);
            const words = (wordsRaw.length > 0) ? wordsRaw : uiStimulusNames;

            const normalize = (s) => (s ?? '').toString().trim().toLowerCase();
            const allowedInkSet = new Set((Array.isArray(words) ? words : []).map(normalize).filter(Boolean));

            const inksExplicitRaw = parseStringList(src.stroop_ink_color_options);
            const inksExplicitSanitized = (inksExplicitRaw.length > 0)
                ? inksExplicitRaw.filter((n) => allowedInkSet.has(normalize(n)))
                : [];

            const inksExplicit = (inksExplicitSanitized.length > 0) ? inksExplicitSanitized : [];
            const inks = (inksExplicit.length > 0) ? inksExplicit : words;

            const congruencyOptionsRaw = parseStringList(src.stroop_congruency_options);
            const congruencyOptions = (congruencyOptionsRaw.length > 0) ? congruencyOptionsRaw : ['auto'];
            const congruency = pickFromList(congruencyOptions, 'auto');

            const pickedWord = pickFromList(words, uiStimulusNames[0] || 'RED');
            let pickedInk = pickFromList(inks, pickedWord || uiStimulusNames[0] || 'BLUE');

            if (congruency === 'congruent') {
                pickedInk = pickedWord;
            } else if (congruency === 'incongruent') {
                if (inks.length > 1) {
                    const different = inks.filter(n => n.trim().toLowerCase() !== pickedWord.trim().toLowerCase());
                    pickedInk = pickFromList(different, pickedInk);
                }
            }

            sampled.word = pickedWord;
            sampled.ink_color_name = pickedInk;
            sampled.congruency = congruency;

            sampled.response_mode = (src.stroop_response_mode || 'inherit').toString();
            sampled.response_device = (src.stroop_response_device || 'inherit').toString();
            sampled.choice_keys = parseStringList(src.stroop_choice_keys);
            sampled.congruent_key = (src.stroop_congruent_key || 'f').toString();
            sampled.incongruent_key = (src.stroop_incongruent_key || 'j').toString();

            const stimMs = randInt(src.stroop_stimulus_duration_min, src.stroop_stimulus_duration_max);
            if (stimMs !== null) sampled.stimulus_duration_ms = stimMs;

            const trialMs = randInt(src.stroop_trial_duration_min, src.stroop_trial_duration_max);
            if (trialMs !== null) sampled.trial_duration_ms = trialMs;

            const iti = randInt(src.stroop_iti_min, src.stroop_iti_max);
            if (iti !== null) sampled.iti_ms = iti;
        } else if (componentType === 'emotional-stroop-trial') {
            const uiStimulusNames = (() => {
                try {
                    const list = window.jsonBuilderInstance?.getCurrentStroopStimuliFromUI?.();
                    return (Array.isArray(list) ? list : [])
                        .map(s => (s?.name ?? '').toString().trim())
                        .filter(Boolean);
                } catch {
                    return [];
                }
            })();

            const normalize = (s) => (s ?? '').toString().trim().toLowerCase();
            const allowedInkSet = new Set(uiStimulusNames.map(normalize).filter(Boolean));

            const countRaw = Number.parseInt((src.emostroop_word_list_count ?? '2').toString(), 10);
            const count = Number.isFinite(countRaw) ? (countRaw === 3 ? 3 : 2) : 2;

            const list1 = {
                label: (src.emostroop_word_list_1_label ?? 'Neutral').toString().trim() || 'Neutral',
                words: parseStringList(src.emostroop_word_list_1_words)
            };
            const list2 = {
                label: (src.emostroop_word_list_2_label ?? 'Negative').toString().trim() || 'Negative',
                words: parseStringList(src.emostroop_word_list_2_words)
            };
            const list3 = {
                label: (src.emostroop_word_list_3_label ?? 'Positive').toString().trim() || 'Positive',
                words: parseStringList(src.emostroop_word_list_3_words)
            };

            const wordLists = [list1, list2, ...(count === 3 ? [list3] : [])]
                .map((l, i) => ({
                    index: i + 1,
                    label: (l.label || '').toString(),
                    words: Array.isArray(l.words) ? l.words : []
                }))
                .filter(l => l.words.length > 0);

            const legacyWordsRaw = parseStringList(src.emostroop_word_options);
            const fallbackWords = (legacyWordsRaw.length > 0) ? legacyWordsRaw : ['HAPPY', 'SAD', 'ANGRY', 'CHAIR'];

            const chosenList = (wordLists.length > 0)
                ? pickFromList(wordLists, wordLists[0])
                : null;

            const words = chosenList ? chosenList.words : fallbackWords;

            const inksRaw = parseStringList(src.emostroop_ink_color_options);
            const inksSanitized = (inksRaw.length > 0)
                ? inksRaw.filter((n) => allowedInkSet.size === 0 || allowedInkSet.has(normalize(n)))
                : [];
            const inks = (inksSanitized.length > 0) ? inksSanitized : (uiStimulusNames.length > 0 ? uiStimulusNames : ['RED', 'GREEN', 'BLUE', 'YELLOW']);

            sampled.word = pickFromList(words, words[0] || 'HAPPY');
            if (chosenList) {
                sampled.word_list_label = chosenList.label;
                sampled.word_list_index = chosenList.index;
            }
            sampled.ink_color_name = pickFromList(inks, inks[0] || 'BLUE');

            sampled.response_mode = 'color_naming';
            sampled.response_device = (src.emostroop_response_device || 'inherit').toString();
            sampled.choice_keys = parseStringList(src.emostroop_choice_keys);

            const stimMs = randInt(src.emostroop_stimulus_duration_min, src.emostroop_stimulus_duration_max);
            if (stimMs !== null) sampled.stimulus_duration_ms = stimMs;

            const trialMs = randInt(src.emostroop_trial_duration_min, src.emostroop_trial_duration_max);
            if (trialMs !== null) sampled.trial_duration_ms = trialMs;

            const iti = randInt(src.emostroop_iti_min, src.emostroop_iti_max);
            if (iti !== null) sampled.iti_ms = iti;
        } else if (componentType === 'gabor-trial' || componentType === 'gabor-quest' || componentType === 'gabor-learning') {
            const locs = parseStringList(blockData.gabor_target_location_options);
            sampled.target_location = pickFromList(locs, 'left');

            const tilts = parseNumberList(blockData.gabor_target_tilt_options, { min: -90, max: 90 });
            sampled.target_tilt_deg = pickFromList(tilts, 45);

            const dis = parseNumberList(blockData.gabor_distractor_orientation_options, { min: 0, max: 179 });
            sampled.distractor_orientation_deg = pickFromList(dis, 0);

            const spatialCueEnabled = blockData.gabor_spatial_cue_enabled !== false && blockData.gabor_spatial_cue_enabled !== 'false' && blockData.gabor_spatial_cue_enabled !== 0;
            sampled.spatial_cue_enabled = spatialCueEnabled;
            if (spatialCueEnabled) {
                const cues = parseStringList(blockData.gabor_spatial_cue_options);
                sampled.spatial_cue = pickFromList(cues, 'none');
            } else {
                sampled.spatial_cue = 'none';
            }

            const valueCueEnabled = blockData.gabor_value_cue_enabled !== false && blockData.gabor_value_cue_enabled !== 'false' && blockData.gabor_value_cue_enabled !== 0;
            sampled.value_cue_enabled = valueCueEnabled;
            if (valueCueEnabled) {
                const lv = parseStringList(blockData.gabor_left_value_options);
                sampled.left_value = pickFromList(lv, 'neutral');

                const rv = parseStringList(blockData.gabor_right_value_options);
                sampled.right_value = pickFromList(rv, 'neutral');
            } else {
                sampled.left_value = 'neutral';
                sampled.right_value = 'neutral';
            }

            const freq = randFloat(blockData.gabor_spatial_frequency_min, blockData.gabor_spatial_frequency_max);
            if (freq !== null) sampled.spatial_frequency_cyc_per_px = freq;

            const waves = parseStringList(blockData.gabor_grating_waveform_options);
            sampled.grating_waveform = pickFromList(waves, 'sinusoidal');

            const responseTask = (blockData.gabor_response_task || '').toString().trim();
            sampled.response_task = responseTask || 'discriminate_tilt';

            sampled.left_key = (blockData.gabor_left_key || 'f').toString();
            sampled.right_key = (blockData.gabor_right_key || 'j').toString();
            sampled.yes_key = (blockData.gabor_yes_key || 'f').toString();
            sampled.no_key = (blockData.gabor_no_key || 'j').toString();

            const stimMs = randInt(blockData.gabor_stimulus_duration_min, blockData.gabor_stimulus_duration_max);
            if (stimMs !== null) sampled.stimulus_duration_ms = stimMs;
            const maskMs = randInt(blockData.gabor_mask_duration_min, blockData.gabor_mask_duration_max);
            if (maskMs !== null) sampled.mask_duration_ms = maskMs;
        } else if (componentType === 'task-switching-trial') {
            const trialType = (src?.ts_trial_type ?? src?.trial_type ?? 'switch').toString().trim().toLowerCase();
            const cueType = (src?.ts_cue_type ?? src?.cue_type ?? 'explicit').toString().trim().toLowerCase();

            const normalizePos = (raw, fallback) => {
                const s = (raw ?? '').toString().trim().toLowerCase();
                if (s === 'left' || s === 'right' || s === 'top' || s === 'bottom') return s;
                return fallback;
            };

            const taskIndex = (() => {
                if (trialType === 'single') {
                    const raw = Number.parseInt((src?.ts_single_task_index ?? src?.single_task_index ?? 1).toString(), 10);
                    return (raw === 2) ? 2 : 1;
                }
                return (rng() < 0.5) ? 1 : 2;
            })();
            sampled.task_index = taskIndex;

            const parseUiList = (id) => {
                try {
                    return (document.getElementById(id)?.value ?? '')
                        .toString()
                        .split(',')
                        .map(s => s.trim())
                        .filter(Boolean);
                } catch {
                    return [];
                }
            };

            const uiMode = (document.getElementById('taskSwitchingStimulusSetMode')?.value || 'letters_numbers').toString();
            const builtIn = {
                task1: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
                task2: ['1', '2', '3', '4', '5', '6', '7', '8', '9']
            };

            const t1Pool = (() => {
                if (uiMode !== 'custom') return builtIn.task1;
                const a = parseUiList('taskSwitchingTask1CategoryA');
                const b = parseUiList('taskSwitchingTask1CategoryB');
                const pool = [...a, ...b].filter(Boolean);
                return (pool.length > 0) ? pool : builtIn.task1;
            })();

            const t2Pool = (() => {
                if (uiMode !== 'custom') return builtIn.task2;
                const a = parseUiList('taskSwitchingTask2CategoryA');
                const b = parseUiList('taskSwitchingTask2CategoryB');
                const pool = [...a, ...b].filter(Boolean);
                return (pool.length > 0) ? pool : builtIn.task2;
            })();

            const stimulusTask1 = (pickFromList(t1Pool, 'A') ?? 'A').toString();
            const stimulusTask2 = (pickFromList(t2Pool, '1') ?? '1').toString();

            sampled.stimulus_task_1 = stimulusTask1;
            sampled.stimulus_task_2 = stimulusTask2;
            sampled.stimulus = `${stimulusTask1} ${stimulusTask2}`.trim();

            if (cueType === 'position') {
                const p1 = normalizePos(src?.ts_task_1_position ?? src?.task_1_position, 'left');
                const p2 = normalizePos(src?.ts_task_2_position ?? src?.task_2_position, 'right');
                sampled.stimulus_position = (taskIndex === 2) ? p2 : p1;
            } else {
                sampled.stimulus_position = normalizePos(src?.ts_stimulus_position ?? src?.stimulus_position, 'top');
            }

            sampled.border_enabled = !!(src?.ts_border_enabled ?? src?.border_enabled ?? false);
            sampled.left_key = (src?.ts_left_key ?? src?.left_key ?? 'f').toString();
            sampled.right_key = (src?.ts_right_key ?? src?.right_key ?? 'j').toString();

            if (cueType === 'color') {
                const c1 = (src?.ts_task_1_color_hex ?? src?.task_1_color_hex ?? '').toString().trim();
                const c2 = (src?.ts_task_2_color_hex ?? src?.task_2_color_hex ?? '').toString().trim();
                sampled.stimulus_color_hex = (taskIndex === 2) ? (c2 || '#FFFFFF') : (c1 || '#FFFFFF');
            } else {
                const c = (src?.ts_stimulus_color_hex ?? src?.stimulus_color_hex ?? '').toString().trim();
                if (c) sampled.stimulus_color_hex = c;
            }

            const stimMs = randInt(src?.ts_stimulus_duration_min ?? src?.stimulus_duration_min, src?.ts_stimulus_duration_max ?? src?.stimulus_duration_max);
            if (stimMs !== null) sampled.stimulus_duration_ms = stimMs;
            const trialMs = randInt(src?.ts_trial_duration_min ?? src?.trial_duration_min, src?.ts_trial_duration_max ?? src?.trial_duration_max);
            if (trialMs !== null) sampled.trial_duration_ms = trialMs;
            const iti = randInt(src?.ts_iti_min ?? src?.iti_min, src?.ts_iti_max ?? src?.iti_max);
            if (iti !== null) sampled.iti_ms = iti;
        } else if (componentType === 'html-keyboard-response') {
            const stim = (src?.stimulus_html ?? src?.stimulus ?? '').toString();
            sampled.stimulus = stim || '<p>Press a key to continue.</p>';
            sampled.prompt = (src?.prompt ?? '').toString();
            sampled.choices = (src?.choices ?? 'ALL_KEYS');
        } else if (componentType === 'html-button-response') {
            const stim = (src?.stimulus_html ?? src?.stimulus ?? '').toString();
            sampled.stimulus = stim || '<p>Click a button to continue.</p>';
            sampled.prompt = (src?.prompt ?? '').toString();
            // Builder exports button labels as a single string in `choices`.
            sampled.choices = (src?.button_choices ?? src?.choices ?? 'Continue');
            if (src?.button_html !== undefined) sampled.button_html = src.button_html;
        } else if (componentType === 'image-keyboard-response') {
            const listRaw = (src?.stimulus_images ?? '').toString();
            const list = listRaw
                ? listRaw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
                : [];

            const chosen = (list.length > 0)
                ? pickFromList(list, '')
                : (() => {
                    const v = (src?.stimulus_image ?? src?.stimulus ?? '');
                    if (Array.isArray(v)) return pickFromList(v, '');
                    return (v ?? '').toString();
                })();

            sampled.stimulus = chosen;
            sampled.prompt = (src?.prompt ?? '').toString();
            sampled.choices = (src?.choices ?? 'ALL_KEYS');
        }

        return sampled;
    }
    
    showInstructionsPreview(stimulusText, componentData) {
        // Clean instructions preview like the Figma prototype
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modal } = previewModal;
        
        // Convert \n to <br> tags for proper line breaks
        const formattedText = stimulusText.replace(/\n/g, '<br>');
        
        const modalBody = document.querySelector('#componentPreviewModal .modal-body');
        if (modalBody) {
            modalBody.innerHTML = `
                <div class="instructions-preview-container">
                    <h5>Instructions Preview</h5>
                    <div class="preview-screen" style="
                        background-color: #000000; 
                        color: #ffffff; 
                        padding: 40px; 
                        border-radius: 8px; 
                        text-align: center;
                        font-family: sans-serif;
                        font-size: 18px;
                        line-height: 1.6;
                        min-height: 300px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    ">
                        <div>
                            ${formattedText}
                            <div style="margin-top: 30px; font-size: 14px; color: #ccc;">
                                (Press any key to continue)
                            </div>
                        </div>
                    </div>
                    <div class="mt-3">
                        <small class="text-muted">
                            <strong>Component Type:</strong> Instructions<br>
                            <strong>Response Keys:</strong> ${componentData.choices === 'ALL_KEYS' ? 'Any key' : (componentData.choices || 'Not specified')}
                        </small>
                    </div>
                </div>
            `;
        }
        
        modal.show();
    }
    
    showHTMLPreview(componentData) {
        // Show HTML content preview
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modal } = previewModal;
        
        // Get the stimulus content - it might be JSON-encoded
        let stimulusContent = componentData.stimulus || 'No content specified';
        
        // If the stimulus appears to be JSON-encoded, try to parse it
        if (typeof stimulusContent === 'string' && stimulusContent.startsWith('{')) {
            try {
                const parsed = JSON.parse(stimulusContent);
                // If it's an object with a stimulus property, use that
                if (parsed.stimulus) {
                    stimulusContent = parsed.stimulus;
                }
            } catch (e) {
                // If parsing fails, use the original string
                console.log('Stimulus content is not JSON, using as-is');
            }
        }
        
        // Update modal content for HTML preview
        const modalBody = document.querySelector('#componentPreviewModal .modal-body');
        if (modalBody) {
            modalBody.innerHTML = `
                <div class="html-preview-container">
                    <h5>HTML Component Preview</h5>
                    <div class="preview-content p-3 border rounded" style="background-color: #f8f9fa; min-height: 200px; font-family: sans-serif; font-size: 16px; line-height: 1.5;">
                        ${stimulusContent}
                    </div>
                    <div class="mt-3">
                        <small class="text-muted">
                            <strong>Component Type:</strong> ${componentData.type}<br>
                            <strong>Response Keys:</strong> ${componentData.choices === 'ALL_KEYS' ? 'Any key' : (componentData.choices || 'Not specified')}
                        </small>
                    </div>
                </div>
            `;
        }
        
        modal.show();
    }
    
    showRDMPreview(componentData) {
        // Update parameters from component data
        if (componentData && Object.keys(componentData).length > 0) {
            console.log('Updating RDM preview with parameters:', componentData);
            this.updateParameters(componentData);
        } else {
            console.warn('No component data provided for RDM preview');
        }
        
        // Restore original RDM modal content if it was changed
        this.restoreRDMModalContent();
        
        // Re-setup event listeners after content restore
        this.setupEventListeners();

        // Optional: show context note / enable block resample
        const noteEl = document.getElementById('previewContextNote');
        const resampleBtn = document.getElementById('resamplePreviewBtn');
        const noteText = componentData?._previewContextNote || '';

        if (noteEl) {
            noteEl.textContent = noteText;
        }

        const blockSource = componentData?._blockPreviewSource || null;
        if (resampleBtn) {
            if (blockSource) {
                this.blockPreviewSource = blockSource;
                // Reset seeded RNG state when switching blocks
                const seedStr = (blockSource?.seed ?? '').toString().trim();
                const seed = Number.parseInt(seedStr, 10);
                if (Number.isFinite(seed) && this.blockPreviewSeed !== seed) {
                    this.blockPreviewSeed = seed;
                    this.blockPreviewRngState = (seed >>> 0);
                }

                resampleBtn.style.display = '';
                resampleBtn.onclick = () => {
                    const sampled = this.sampleComponentFromBlock(this.blockPreviewSource);
                    const baseType = this.blockPreviewSource.block_component_type || this.blockPreviewSource.component_type || 'rdm-trial';
                    const length = this.blockPreviewSource.block_length ?? this.blockPreviewSource.length ?? 0;
                    const sampling = this.blockPreviewSource.sampling_mode || 'per-trial';
                    sampled._previewContextNote = `Block sample → ${baseType} (length ${length}, ${sampling})`;
                    sampled._blockPreviewSource = this.blockPreviewSource;
                    this.showRDMPreview(sampled);
                };
            } else {
                this.blockPreviewSource = null;
                resampleBtn.style.display = 'none';
                resampleBtn.onclick = null;
            }
        }
        
        // Show the modal (single instance; avoids stacked backdrops on Resample)
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modal } = previewModal;
        modal.show();

        // Ensure canvas/context references are current BEFORE (re)rendering
        this.canvas = document.getElementById('previewCanvas');
        if (this.canvas) {
            this.ctx = this.canvas.getContext('2d');
            console.log('RDM canvas initialized:', this.canvas.width, 'x', this.canvas.height);
        } else {
            console.warn('Preview canvas not found after modal restoration');
        }

        // Force a clean re-init so dot colors/count/cue border always match the latest parameters
        this.stopPreview();
        this.frameCount = 0;
        this.startTime = 0;
        this.lastFrameTime = 0;
        this.frameRate = 0;

        this.initializeDots();
        this.render();
        this.updateParameterDisplay();
        this.updateStats();
    }
    
    showGenericPreview(componentData) {
        // Show generic component info
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modal } = previewModal;
        
        const modalBody = document.querySelector('#componentPreviewModal .modal-body');
        if (modalBody) {
            modalBody.innerHTML = `
                <div class="generic-preview-container">
                    <h5>Component Preview</h5>
                    <p class="text-muted">Preview not available for this component type.</p>
                    <div class="mt-3">
                        <h6>Component Data:</h6>
                        <pre class="bg-light p-3 rounded"><code>${JSON.stringify(componentData, null, 2)}</code></pre>
                    </div>
                </div>
            `;
        }
        
        modal.show();
    }
    
    restoreRDMModalContent() {
        const modalBody = document.querySelector('#componentPreviewModal .modal-body');
        // Some legacy layouts (e.g. index.html initial markup) include a canvas but
        // are missing newer controls like Block "Resample". Upgrade the modal body
        // to the canonical RDM preview layout when required elements are absent.
        const hasRdmCanvas = !!modalBody?.querySelector('#previewCanvas');
        const hasRdmControls = !!modalBody?.querySelector('#startPreviewBtn')
            && !!modalBody?.querySelector('#pausePreviewBtn')
            && !!modalBody?.querySelector('#stopPreviewBtn')
            && !!modalBody?.querySelector('#resetPreviewBtn');
        const hasRdmExtras = !!modalBody?.querySelector('#previewContextNote')
            && !!modalBody?.querySelector('#resamplePreviewBtn')
            && !!modalBody?.querySelector('#previewParameters');

        const needsRestore = !modalBody || !hasRdmCanvas || !hasRdmControls || !hasRdmExtras;

        if (modalBody && needsRestore) {
            // Restore the original RDM preview content
            modalBody.innerHTML = `
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <div>
                        <h5 class="mb-0">RDM Component Preview</h5>
                        <div id="previewContextNote" class="small text-muted"></div>
                    </div>
                    <div class="btn-group" role="group">
                        <button type="button" class="btn btn-success btn-sm" id="startPreviewBtn">
                            <i class="fas fa-play"></i> Start
                        </button>
                        <button type="button" class="btn btn-outline-secondary btn-sm" id="resamplePreviewBtn" style="display:none;">
                            <i class="fas fa-dice"></i> Resample
                        </button>
                        <button type="button" class="btn btn-warning btn-sm" id="pausePreviewBtn" disabled>
                            <i class="fas fa-pause"></i> Pause
                        </button>
                        <button type="button" class="btn btn-danger btn-sm" id="stopPreviewBtn" disabled>
                            <i class="fas fa-stop"></i> Stop
                        </button>
                        <button type="button" class="btn btn-info btn-sm" id="resetPreviewBtn">
                            <i class="fas fa-redo"></i> Reset
                        </button>
                    </div>
                </div>
                
                <div class="preview-container mb-3">
                    <canvas id="previewCanvas" width="600" height="600" class="border"></canvas>
                </div>
                
                <div class="row">
                    <div class="col-md-6">
                        <h6>Statistics</h6>
                        <div id="previewStats" class="small text-muted">
                            <div>Frame Rate: <span id="frameRate">0</span> fps</div>
                            <div>Frame Count: <span id="frameCount">0</span></div>
                            <div>Coherent Dots: <span id="coherentDots">0</span></div>
                            <div>Random Dots: <span id="randomDots">0</span></div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <h6>Parameters</h6>
                        <div id="previewParameters" class="small text-muted">
                            <!-- Parameters will be populated here -->
                        </div>
                    </div>
                </div>
            `;
            
            // Re-setup event listeners only
            this.setupEventListeners();
            
            // Initialize canvas references
            this.canvas = document.getElementById('previewCanvas');
            if (this.canvas) {
                this.ctx = this.canvas.getContext('2d');
            }
        }
    }
    
    updateParameters(newParameters) {
        // Support legacy/nested component data shape: { type, name, parameters: { ... } }
        // The preview mapper expects a flat parameter object.
        const params = (newParameters && typeof newParameters === 'object' && newParameters.parameters && typeof newParameters.parameters === 'object')
            ? { ...newParameters, ...newParameters.parameters }
            : (newParameters || {});

        // Support nested dot-groups schema shape (used by some validators/exporters)
        //   groups: { enabled: true, group_definitions: [ { percentage, color, motion_properties: { coherence, direction } } ] }
        // Normalize first two groups into the flat fields the preview renderer uses.
        const normalizedFromGroups = {};
        if (params?.groups && typeof params.groups === 'object') {
            const enabled = !!params.groups.enabled;
            const defs = Array.isArray(params.groups.group_definitions) ? params.groups.group_definitions : null;

            if (enabled && defs && defs.length >= 2) {
                const g1 = defs[0] || {};
                const g2 = defs[1] || {};
                const g1Motion = (g1.motion_properties && typeof g1.motion_properties === 'object') ? g1.motion_properties : {};
                const g2Motion = (g2.motion_properties && typeof g2.motion_properties === 'object') ? g2.motion_properties : {};

                normalizedFromGroups.enable_groups = true;
                if (g1.percentage !== undefined) normalizedFromGroups.group_1_percentage = g1.percentage;
                if (g1.color !== undefined) normalizedFromGroups.group_1_color = g1.color;
                if (g1Motion.coherence !== undefined) normalizedFromGroups.group_1_coherence = g1Motion.coherence;
                if (g1Motion.direction !== undefined) normalizedFromGroups.group_1_direction = g1Motion.direction;

                if (g2.percentage !== undefined) normalizedFromGroups.group_2_percentage = g2.percentage;
                if (g2.color !== undefined) normalizedFromGroups.group_2_color = g2.color;
                if (g2Motion.coherence !== undefined) normalizedFromGroups.group_2_coherence = g2Motion.coherence;
                if (g2Motion.direction !== undefined) normalizedFromGroups.group_2_direction = g2Motion.direction;
            }
        }

        const mergedParams = { ...params, ...normalizedFromGroups };

        // Support nested aperture parameters (new export structure).
        // Flatten into mergedParams so the existing preview mapper continues to work.
        if (mergedParams.aperture_parameters && typeof mergedParams.aperture_parameters === 'object') {
            for (const [key, value] of Object.entries(mergedParams.aperture_parameters)) {
                if (mergedParams[key] === undefined) {
                    mergedParams[key] = value;
                }
            }
        }

        // Legacy aliases for target group (older UI/modal names)
        if (!mergedParams.response_target_group) {
            const legacyTarget = mergedParams.custom_response || mergedParams.customResponse || mergedParams.modalCustomResponse || mergedParams.modal_custom_response;
            if (legacyTarget) mergedParams.response_target_group = legacyTarget;
        }

        const componentType = String(mergedParams?.type || mergedParams?.trial_type || mergedParams?.plugin || '').trim();
        const componentName = String(mergedParams?.name || '').trim();

        // Infer dot-groups mode even if legacy enable_groups flag is absent
        const inferredGroupsEnabled = (
            componentType === 'rdm-dot-groups' ||
            componentType.includes('dot-groups') ||
            componentName.toLowerCase().includes('groups') ||
            mergedParams?.groups?.enabled === true ||
            mergedParams?.groups?.enabled === 'true' ||
            mergedParams?.group_1_percentage !== undefined ||
            mergedParams?.group_2_percentage !== undefined ||
            mergedParams?.group_1_color !== undefined ||
            mergedParams?.group_2_color !== undefined ||
            mergedParams?.group_1_coherence !== undefined ||
            mergedParams?.group_2_coherence !== undefined ||
            mergedParams?.group_1_direction !== undefined ||
            mergedParams?.group_2_direction !== undefined
        );

        // Resolve cue border configuration from flat params or nested override
        const cue = mergedParams?.cue_border || mergedParams?.response_parameters_override?.cue_border || null;
        const rawCueMode = mergedParams?.cue_border_mode || cue?.mode || 'off';

        const normalizeCueMode = (mode) => {
            const m = String(mode || 'off').trim();
            if (m === 'target_group_color' || m === 'targetGroupColor') return 'target-group-color';
            if (m === 'target-group-color') return 'target-group-color';
            if (m === 'custom') return 'custom';
            if (m === 'off' || m === '' || m === 'none') return 'off';
            return m;
        };

        const cueMode = normalizeCueMode(rawCueMode);
        const targetGroup = (
            mergedParams?.response_target_group ||
            mergedParams?.target_group ||
            cue?.target_group ||
            cue?.target ||
            'none'
        );

        const cueWidth = mergedParams?.cue_border_width || cue?.width || 4;

        // Important: when cueMode is target-group-color, ignore any default cue_border_color
        // (the modal often has a color field with a default '#FFFFFF' that would override the group color).
        let cueColor = null;
        if (cueMode === 'custom') {
            cueColor = mergedParams?.cue_border_color || cue?.color || null;
        } else if (cueMode === 'target-group-color') {
            if (targetGroup === 'group_1') cueColor = mergedParams?.group_1_color || '#FF0066';
            if (targetGroup === 'group_2') cueColor = mergedParams?.group_2_color || '#0066FF';
        }

        const cueEnabled = (cueMode && cueMode !== 'off' && targetGroup && targetGroup !== 'none' && !!cueColor);

        // Aperture outline (non-cue) configuration
        const outlineModeRaw = (mergedParams?.show_aperture_outline_mode ?? mergedParams?.aperture_outline_mode ?? 'inherit');
        const outlineMode = String(outlineModeRaw).trim().toLowerCase();
        const outlineWidthRaw = mergedParams?.aperture_outline_width;
        const outlineColorRaw = mergedParams?.aperture_outline_color;

        const outlineWidthNum = (outlineWidthRaw === '' || outlineWidthRaw === null || outlineWidthRaw === undefined)
            ? null
            : Number(outlineWidthRaw);
        const hasOutlineWidth = (outlineWidthNum !== null && Number.isFinite(outlineWidthNum) && outlineWidthNum > 0);
        const hasOutlineColor = (typeof outlineColorRaw === 'string' && outlineColorRaw.trim().length > 0);

        let outlineEnabled;
        if (typeof mergedParams?.show_aperture_outline === 'boolean') {
            outlineEnabled = mergedParams.show_aperture_outline;
        } else if (mergedParams?.show_aperture_outline === 'true' || mergedParams?.show_aperture_outline === 'false') {
            outlineEnabled = (String(mergedParams.show_aperture_outline).toLowerCase() === 'true');
        } else if (outlineMode === 'true' || outlineMode === 'on' || outlineMode === 'enabled') {
            outlineEnabled = true;
        } else if (outlineMode === 'false' || outlineMode === 'off' || outlineMode === 'disabled') {
            outlineEnabled = false;
        } else {
            // inherit/unknown: if user set width/color, assume they intended it to be visible
            outlineEnabled = (hasOutlineWidth || hasOutlineColor) ? true : false;
        }

        // Map component parameters to preview parameters
        this.parameters = {
            component_type: componentType || this.parameters.component_type,
            component_name: componentName || this.parameters.component_name,
            canvas_width: mergedParams.canvas_width || this.parameters.canvas_width,
            canvas_height: mergedParams.canvas_height || this.parameters.canvas_height,
            aperture_shape: mergedParams.aperture_shape || this.parameters.aperture_shape,
            aperture_size: mergedParams.aperture_diameter || mergedParams.aperture_size || this.parameters.aperture_size,
            background_color: mergedParams.background_color || this.parameters.background_color,
            dot_size: mergedParams.dot_size || this.parameters.dot_size,
            dot_color: mergedParams.dot_color || this.parameters.dot_color,
            total_dots: mergedParams.total_dots || this.parameters.total_dots,
            coherent_direction: mergedParams.coherent_direction !== undefined
                ? mergedParams.coherent_direction
                : (mergedParams.direction !== undefined ? mergedParams.direction : this.parameters.coherent_direction),
            coherence: mergedParams.coherence !== undefined ? mergedParams.coherence : this.parameters.coherence,
            speed: mergedParams.speed || this.parameters.speed,
            lifetime_frames: mergedParams.lifetime_frames || this.parameters.lifetime_frames,
            noise_type: mergedParams.noise_type || this.parameters.noise_type,
            
            // Handle RDM Groups parameters
            enable_groups: inferredGroupsEnabled || !!mergedParams.enable_groups,
            group_1_percentage: (mergedParams.group_1_percentage ?? 50),
            group_1_color: mergedParams.group_1_color || '#FF0066',
            group_1_coherence: mergedParams.group_1_coherence !== undefined ? mergedParams.group_1_coherence : 0.2,
            group_1_direction: mergedParams.group_1_direction !== undefined ? mergedParams.group_1_direction : 0,
            group_1_speed: mergedParams.group_1_speed !== undefined ? mergedParams.group_1_speed : null,
            group_2_percentage: (mergedParams.group_2_percentage ?? 50),
            group_2_color: mergedParams.group_2_color || '#0066FF',
            group_2_coherence: mergedParams.group_2_coherence !== undefined ? mergedParams.group_2_coherence : 0.8,
            group_2_direction: mergedParams.group_2_direction !== undefined ? mergedParams.group_2_direction : 180,
            group_2_speed: mergedParams.group_2_speed !== undefined ? mergedParams.group_2_speed : null,

            // Cue border (aperture border as response cue)
            cue_border_enabled: cueEnabled,
            cue_border_color: cueColor || '#888888',
            cue_border_width: parseInt(cueWidth),

            // Aperture outline (static)
            show_aperture_outline: outlineEnabled,
            aperture_outline_width: hasOutlineWidth ? outlineWidthNum : null,
            aperture_outline_color: hasOutlineColor ? outlineColorRaw.trim() : null
        };

        // For dot-groups, compute an effective coherence for display purposes.
        // (Otherwise the UI shows the experiment-wide default coherence even when groups are used.)
        if (this.parameters.enable_groups) {
            const g1Pct = Number(this.parameters.group_1_percentage ?? 0);
            const g2Pct = Number(this.parameters.group_2_percentage ?? 0);
            const denom = (g1Pct + g2Pct) || 100;
            const g1C = Number(this.parameters.group_1_coherence ?? 0);
            const g2C = Number(this.parameters.group_2_coherence ?? 0);
            const eff = ((g1Pct * g1C) + (g2Pct * g2C)) / denom;
            if (!Number.isNaN(eff)) {
                this.parameters.coherence = Math.max(0, Math.min(1, eff));
            }
        }
        
        console.log('Updated parameters:', this.parameters);
        
        // Update canvas size and background
        // (Modal content can be swapped, leaving a stale detached canvas reference.)
        if (!this.canvas || !document.body.contains(this.canvas)) {
            this.canvas = document.getElementById('previewCanvas');
            this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        }

        if (this.canvas) {
            this.canvas.width = this.parameters.canvas_width;
            this.canvas.height = this.parameters.canvas_height;
            this.canvas.style.backgroundColor = this.parameters.background_color;
        }
        
        this.initializeDots();
    }
    
    initializeDots() {
        this.dots = [];
        
        for (let i = 0; i < this.parameters.total_dots; i++) {
            this.createDot();
        }
    }

    getRandomStartPosition() {
        // If an aperture is configured, start dots within it so the preview shows the full dot field.
        const hasAperture = !!(this.parameters.aperture_shape && this.parameters.aperture_size);
        if (!hasAperture) {
            return {
                x: Math.random() * this.parameters.canvas_width,
                y: Math.random() * this.parameters.canvas_height
            };
        }

        const centerX = this.parameters.canvas_width / 2;
        const centerY = this.parameters.canvas_height / 2;
        const half = this.parameters.aperture_size / 2;

        if (this.parameters.aperture_shape === 'circle') {
            // Uniform sampling within a circle
            const t = 2 * Math.PI * Math.random();
            const r = half * Math.sqrt(Math.random());
            return { x: centerX + r * Math.cos(t), y: centerY + r * Math.sin(t) };
        }

        // Rectangle (and any other shapes) default to square bounds
        return {
            x: centerX + (Math.random() * 2 - 1) * half,
            y: centerY + (Math.random() * 2 - 1) * half
        };
    }
    
    createDot() {
        const start = this.getRandomStartPosition();
        const dot = {
            x: start.x,
            y: start.y,
            age: Math.floor(Math.random() * this.parameters.lifetime_frames)
        };
        
        // Handle RDM Groups if enabled
        if (this.parameters.enable_groups) {
            // Determine which group this dot belongs to
            const group1Size = Math.round(this.parameters.total_dots * this.parameters.group_1_percentage / 100);
            const currentGroup1Count = this.dots.filter(d => d.group === 1).length;
            
            if (currentGroup1Count < group1Size) {
                // Assign to group 1
                dot.group = 1;
                dot.color = this.parameters.group_1_color;
                dot.isCoherent = Math.random() < this.parameters.group_1_coherence;

                const groupSpeed = (this.parameters.group_1_speed !== null && this.parameters.group_1_speed !== undefined && this.parameters.group_1_speed !== '')
                    ? Number(this.parameters.group_1_speed)
                    : Number(this.parameters.speed);
                
                if (dot.isCoherent) {
                    const radians = (this.parameters.group_1_direction * Math.PI) / 180;
                    dot.vx = Math.cos(radians) * groupSpeed;
                    dot.vy = Math.sin(radians) * groupSpeed;
                } else {
                    const randomAngle = Math.random() * 2 * Math.PI;
                    dot.vx = Math.cos(randomAngle) * groupSpeed;
                    dot.vy = Math.sin(randomAngle) * groupSpeed;
                }
            } else {
                // Assign to group 2
                dot.group = 2;
                dot.color = this.parameters.group_2_color;
                dot.isCoherent = Math.random() < this.parameters.group_2_coherence;

                const groupSpeed = (this.parameters.group_2_speed !== null && this.parameters.group_2_speed !== undefined && this.parameters.group_2_speed !== '')
                    ? Number(this.parameters.group_2_speed)
                    : Number(this.parameters.speed);
                
                if (dot.isCoherent) {
                    const radians = (this.parameters.group_2_direction * Math.PI) / 180;
                    dot.vx = Math.cos(radians) * groupSpeed;
                    dot.vy = Math.sin(radians) * groupSpeed;
                } else {
                    const randomAngle = Math.random() * 2 * Math.PI;
                    dot.vx = Math.cos(randomAngle) * groupSpeed;
                    dot.vy = Math.sin(randomAngle) * groupSpeed;
                }
            }
        } else {
            // Single group behavior (original)
            dot.group = 1;
            dot.color = this.parameters.dot_color;
            dot.isCoherent = Math.random() < this.parameters.coherence;
            
            if (dot.isCoherent) {
                const radians = (this.parameters.coherent_direction * Math.PI) / 180;
                dot.vx = Math.cos(radians) * this.parameters.speed;
                dot.vy = Math.sin(radians) * this.parameters.speed;
            } else {
                const randomAngle = Math.random() * 2 * Math.PI;
                dot.vx = Math.cos(randomAngle) * this.parameters.speed;
                dot.vy = Math.sin(randomAngle) * this.parameters.speed;
            }
        }
        
        this.dots.push(dot);
    }
    
    updateDots() {
        for (let i = this.dots.length - 1; i >= 0; i--) {
            const dot = this.dots[i];
            
            // Update position
            dot.x += dot.vx;
            dot.y += dot.vy;
            dot.age++;
            
            // Check boundaries and wrap around
            if (dot.x < 0) dot.x = this.parameters.canvas_width;
            if (dot.x > this.parameters.canvas_width) dot.x = 0;
            if (dot.y < 0) dot.y = this.parameters.canvas_height;
            if (dot.y > this.parameters.canvas_height) dot.y = 0;
            
            // Check lifetime
            if (dot.age >= this.parameters.lifetime_frames) {
                this.dots.splice(i, 1);
                this.createDot(); // Replace with new dot
            }
        }
    }
    
    render() {
        if (!this.ctx) return;
        
        // Clear canvas
        this.ctx.fillStyle = this.parameters.background_color;
        this.ctx.fillRect(0, 0, this.parameters.canvas_width, this.parameters.canvas_height);
        
        // Set up aperture clipping if specified
        if (this.parameters.aperture_shape && this.parameters.aperture_size) {
            this.ctx.save(); // Save the current state
            
            // Create clipping path based on aperture shape
            this.ctx.beginPath();
            const centerX = this.parameters.canvas_width / 2;
            const centerY = this.parameters.canvas_height / 2;
            
            if (this.parameters.aperture_shape === 'circle') {
                this.ctx.arc(centerX, centerY, this.parameters.aperture_size / 2, 0, 2 * Math.PI);
            } else if (this.parameters.aperture_shape === 'rectangle') {
                const halfSize = this.parameters.aperture_size / 2;
                this.ctx.rect(centerX - halfSize, centerY - halfSize, this.parameters.aperture_size, this.parameters.aperture_size);
            }
            
            this.ctx.clip(); // Apply the clipping path
        }
        
        // Draw dots (will be clipped by aperture if set)
        for (const dot of this.dots) {
            // Use individual dot color (for groups) or default color
            this.ctx.fillStyle = dot.color || this.parameters.dot_color;
            this.ctx.beginPath();
            this.ctx.arc(dot.x, dot.y, this.parameters.dot_size / 2, 0, 2 * Math.PI);
            this.ctx.fill();
        }
        
        // Restore context if clipping was applied
        if (this.parameters.aperture_shape && this.parameters.aperture_size) {
            this.ctx.restore();
            
            // Draw aperture boundary for visualization
            // Priority: response cue border > static outline > default dashed
            const shouldDrawCue = !!this.parameters.cue_border_enabled;
            const shouldDrawOutline = (!shouldDrawCue && !!this.parameters.show_aperture_outline);

            if (shouldDrawCue) {
                this.ctx.strokeStyle = this.parameters.cue_border_color;
                this.ctx.lineWidth = Math.max(1, Number(this.parameters.cue_border_width) || 1);
                this.ctx.setLineDash([]); // Solid for cue
            } else if (shouldDrawOutline) {
                const color = this.parameters.aperture_outline_color || '#888888';
                const width = Math.max(1, Number(this.parameters.aperture_outline_width) || 2);
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = width;
                this.ctx.setLineDash([]); // Solid for outline
            } else {
                this.ctx.strokeStyle = '#888888';
                this.ctx.lineWidth = 2;
                this.ctx.setLineDash([5, 5]); // Dashed when no cue/outline
            }
            
            this.ctx.beginPath();
            const centerX = this.parameters.canvas_width / 2;
            const centerY = this.parameters.canvas_height / 2;
            
            if (this.parameters.aperture_shape === 'circle') {
                this.ctx.arc(centerX, centerY, this.parameters.aperture_size / 2, 0, 2 * Math.PI);
            } else if (this.parameters.aperture_shape === 'rectangle') {
                const halfSize = this.parameters.aperture_size / 2;
                this.ctx.rect(centerX - halfSize, centerY - halfSize, this.parameters.aperture_size, this.parameters.aperture_size);
            }
            
            this.ctx.stroke();
            this.ctx.setLineDash([]); // Reset line dash
        }
        
        // Update frame counter and stats
        this.frameCount++;
        this.updateStats();
    }
    
    animate() {
        if (!this.isRunning || this.isPaused) return;
        
        this.updateDots();
        this.render();
        
        // Calculate frame rate
        const currentTime = performance.now();
        if (this.lastFrameTime !== 0) {
            const deltaTime = currentTime - this.lastFrameTime;
            this.frameRate = Math.round(1000 / deltaTime);
        }
        this.lastFrameTime = currentTime;
        
        this.animationId = requestAnimationFrame(() => this.animate());
    }
    
    startPreview() {
        if (this.isPaused) {
            this.isPaused = false;
        } else {
            this.isRunning = true;
            this.startTime = performance.now();
            this.frameCount = 0;
        }
        
        this.updateButtons();
        this.animate();
    }
    
    pausePreview() {
        this.isPaused = true;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        this.updateButtons();
    }
    
    stopPreview() {
        this.isRunning = false;
        this.isPaused = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        this.updateButtons();
        this.render(); // Final render
    }
    
    resetPreview() {
        this.stopPreview();
        this.frameCount = 0;
        this.initializeDots();
        this.render();
        this.updateStats();
    }
    
    updateButtons() {
        const startBtn = document.getElementById('startPreviewBtn');
        const pauseBtn = document.getElementById('pausePreviewBtn');
        const stopBtn = document.getElementById('stopPreviewBtn');
        
        if (startBtn && pauseBtn && stopBtn) {
            if (this.isRunning && !this.isPaused) {
                startBtn.disabled = true;
                pauseBtn.disabled = false;
                stopBtn.disabled = false;
            } else if (this.isPaused) {
                startBtn.disabled = false;
                pauseBtn.disabled = true;
                stopBtn.disabled = false;
            } else {
                startBtn.disabled = false;
                pauseBtn.disabled = true;
                stopBtn.disabled = true;
            }
        }
    }
    
    updateParameterDisplay() {
        const container = document.getElementById('previewParameterInfo');
        if (!container) return;

        const isDotGroups = (this.parameters.component_type && this.parameters.component_type.includes('dot-groups')) ||
            (this.parameters.component_name && this.parameters.component_name.toLowerCase().includes('groups'));

        const hasGroupSpeeds = (this.parameters.group_1_speed !== null && this.parameters.group_1_speed !== undefined && this.parameters.group_1_speed !== '') ||
            (this.parameters.group_2_speed !== null && this.parameters.group_2_speed !== undefined && this.parameters.group_2_speed !== '');

        const groupSpeedText = hasGroupSpeeds
            ? `G1 ${this.parameters.group_1_speed ?? this.parameters.speed}, G2 ${this.parameters.group_2_speed ?? this.parameters.speed} px/frame`
            : `${this.parameters.speed} px/frame (shared)`;

        const groupsInfo = (this.parameters.enable_groups || isDotGroups) ? `
            <p><strong>Groups:</strong> ${this.parameters.enable_groups ? 'on' : 'inferred'}</p>
            <p><strong>Group 1:</strong> ${this.parameters.group_1_percentage}% @ ${this.parameters.group_1_color}</p>
            <p><strong>Group 1 Coherence:</strong> ${Math.round(Number(this.parameters.group_1_coherence) * 100)}%</p>
            ${hasGroupSpeeds ? `<p><strong>Group 1 Speed:</strong> ${this.parameters.group_1_speed ?? this.parameters.speed} px/frame</p>` : ''}
            <p><strong>Group 2:</strong> ${this.parameters.group_2_percentage}% @ ${this.parameters.group_2_color}</p>
            <p><strong>Group 2 Coherence:</strong> ${Math.round(Number(this.parameters.group_2_coherence) * 100)}%</p>
            ${hasGroupSpeeds ? `<p><strong>Group 2 Speed:</strong> ${this.parameters.group_2_speed ?? this.parameters.speed} px/frame</p>` : ''}
            <p><strong>Effective Speed:</strong> ${groupSpeedText}</p>
            <p><strong>Cue Border:</strong> ${this.parameters.cue_border_enabled ? 'on' : 'off'}</p>
            ${this.parameters.cue_border_enabled ? `<p><strong>Cue Color:</strong> ${this.parameters.cue_border_color} (${this.parameters.cue_border_width}px)</p>` : ''}
        ` : '';

        const outlineInfo = (this.parameters.show_aperture_outline)
            ? `<p><strong>Aperture Outline:</strong> on (${this.parameters.aperture_outline_color || '#888888'}, ${this.parameters.aperture_outline_width || 2}px)</p>`
            : `<p><strong>Aperture Outline:</strong> off</p>`;
        
        container.innerHTML = `
            <div class="parameter-group">
                <p><strong>Type:</strong> ${this.parameters.component_type || 'rdm'}</p>
                <p><strong>Canvas:</strong> ${this.parameters.canvas_width}×${this.parameters.canvas_height}px</p>
                <p><strong>Aperture:</strong> ${this.parameters.aperture_shape} (${this.parameters.aperture_size}px)</p>
                ${outlineInfo}
                <p><strong>Dots:</strong> ${this.parameters.total_dots}</p>
                <p><strong>Coherence:</strong> ${Math.round(this.parameters.coherence * 100)}%</p>
                <p><strong>Direction:</strong> ${this.parameters.coherent_direction}°</p>
                <p><strong>Speed:</strong> ${this.parameters.speed} px/frame</p>
                <p><strong>Dot Size:</strong> ${this.parameters.dot_size}px</p>
                <p><strong>Lifetime:</strong> ${this.parameters.lifetime_frames} frames</p>
                ${groupsInfo}
            </div>
        `;
    }
    
    updateStats() {
        const coherentCount = this.dots.filter(dot => dot.isCoherent).length;
        const timeElapsed = this.isRunning ? Math.round(performance.now() - this.startTime) : 0;
        
        // Check if elements exist before updating
        const frameRateEl = document.getElementById('frameRate');
        const dotsVisibleEl = document.getElementById('dotsVisible');
        const coherentDotsEl = document.getElementById('coherentDots');
        const timeElapsedEl = document.getElementById('timeElapsed');
        
        if (frameRateEl) frameRateEl.textContent = this.frameRate || 0;
        if (dotsVisibleEl) dotsVisibleEl.textContent = this.dots.length;
        if (coherentDotsEl) coherentDotsEl.textContent = coherentCount;
        if (timeElapsedEl) timeElapsedEl.textContent = timeElapsed;
        
        // Try alternative element IDs for different stat layouts
        const frameCountEl = document.getElementById('frameCount');
        const randomDotsEl = document.getElementById('randomDots');
        
        if (frameCountEl) frameCountEl.textContent = this.frameCount || 0;
        if (randomDotsEl) randomDotsEl.textContent = this.dots.length - coherentCount;
    }
    showMotPreview(componentData) {
        const previewModal = this.getPreviewModal();
        if (!previewModal) return;
        const { modalEl, modal } = previewModal;

        const params = componentData || {};
        const W    = params.arena_width_px  || 700;
        const H    = params.arena_height_px || 500;
        const bg   = params.background_color || '#111111';
        const N    = Math.max(2, parseInt(params.num_objects, 10) || 8);
        const T    = Math.min(N - 1, Math.max(1, parseInt(params.num_targets, 10) || 4));
        const note = params._previewContextNote || '';
        const apertureShape = String(params.aperture_shape || 'rectangle').toLowerCase();
        const borderEnabled = params.aperture_border_enabled !== false;
        const borderColor = params.aperture_border_color || '#444444';

        const canvasId = 'motPreviewCanvas_' + Date.now();
        const borderInfo = borderEnabled ? ` (border: ${borderColor})` : '';
        const bodyHtml = `
            <div class="text-center">
                <canvas id="${canvasId}" width="${W}" height="${H}"
                    style="background:${bg};max-width:100%;border:1px solid #555;"></canvas>
                ${note ? `<p class="text-muted small mt-1">${note}</p>` : ''}
                <p class="text-muted small">Static preview — ${T} target(s) (orange flash) among ${N} object(s).
                  Speed: ${params.speed_px_per_s ?? 150} px/s &middot; ${params.motion_type ?? 'linear'} &middot; ${params.probe_mode ?? 'click'} probe
                  <br/>Aperture: <strong>${apertureShape}</strong>${borderInfo}</p>
            </div>`;

        const titleEl = modalEl.querySelector('.modal-title');
        const bodyEl  = modalEl.querySelector('.modal-body');
        if (titleEl) titleEl.textContent = 'MOT Trial Preview';
        if (bodyEl)  bodyEl.innerHTML    = bodyHtml;
        modal.show();

        setTimeout(() => {
            const canvas = document.getElementById(canvasId);
            if (canvas) this._renderMotPreviewToCanvas(canvas, params);
        }, 50);
    }

    _renderMotPreviewToCanvas(canvas, params) {
        const ctx = canvas.getContext('2d');
        const W   = canvas.width;
        const H   = canvas.height;
        const bg  = params.background_color  || '#111111';
        const objColor = params.object_color     || '#FFFFFF';
        const tgtColor = params.target_cue_color || '#FF9900';
        const r   = Math.max(5, parseInt(params.object_radius_px, 10) || 22);
        const N   = Math.max(2, parseInt(params.num_objects, 10) || 8);
        const T   = Math.min(N - 1, Math.max(1, parseInt(params.num_targets, 10) || 4));

        // Aperture settings
        const apertureShape = String(params.aperture_shape || 'rectangle').toLowerCase();
        const borderEnabled = params.aperture_border_enabled !== false;
        const borderColor = params.aperture_border_color || '#444444';
        const borderWidth = Math.max(0, parseInt(params.aperture_border_width_px, 10) || 2);
        
        const cx = W / 2;
        const cy = H / 2;
        const isCircular = apertureShape === 'circle';
        const apertureRadius = isCircular ? Math.min(W, H) / 2 - (borderEnabled ? borderWidth / 2 : 1) : null;

        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        // Helper: check if point is within aperture
        const isInAperture = (x, y) => {
            if (isCircular) {
                return Math.hypot(x - cx, y - cy) <= apertureRadius;
            } else {
                return x >= r && x <= W - r && y >= r && y <= H - r;
            }
        };

        // Place circles with rejection sampling to avoid overlap, constrained to aperture
        const minDist   = 2 * r + 6;
        const positions = [];
        for (let i = 0; i < N; i++) {
            let x, y, ok, attempts = 0;
            do {
                if (isCircular) {
                    // Place within circular aperture using polar coordinates
                    const theta = Math.random() * 2 * Math.PI;
                    const rnd = Math.sqrt(Math.random());
                    x = cx + rnd * (apertureRadius - r) * Math.cos(theta);
                    y = cy + rnd * (apertureRadius - r) * Math.sin(theta);
                } else {
                    // Place within rectangular aperture
                    x = r + Math.random() * (W - 2 * r);
                    y = r + Math.random() * (H - 2 * r);
                }
                ok = isInAperture(x, y) && positions.every(p => Math.hypot(p.x - x, p.y - y) >= minDist);
            } while (!ok && ++attempts < 500);
            if (ok) {
                positions.push({ x, y, isTarget: i < T });
            }
        }
        
        // Shuffle so targets are not always top-left
        for (let i = positions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [positions[i], positions[j]] = [positions[j], positions[i]];
        }

        // Draw objects
        for (const p of positions) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
            ctx.fillStyle   = p.isTarget ? tgtColor : objColor;
            ctx.fill();
            ctx.strokeStyle = 'rgba(136,136,136,0.5)';
            ctx.lineWidth   = 1.5;
            ctx.stroke();
        }

        // Draw aperture border if enabled
        if (borderEnabled) {
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = borderWidth;
            if (isCircular) {
                ctx.beginPath();
                ctx.arc(cx, cy, apertureRadius, 0, 2 * Math.PI);
                ctx.stroke();
            } else {
                ctx.strokeRect(r, r, W - 2 * r, H - 2 * r);
            }
        }
    }
}

// Global instance
window.componentPreview = new ComponentPreview();