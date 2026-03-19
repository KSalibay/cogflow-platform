class TimelineBuilder {
    constructor(jsonBuilder) {
        this.jsonBuilder = jsonBuilder;
        this.timelineContainer = null;
        this.selectedComponent = null;
        
        this.initializeContainer();
        this.setupEventListeners();
    }

    initializeContainer() {
        // Use the timelineComponents container instead of overwriting timelineBuilder
        this.timelineContainer = document.getElementById('timelineComponents');
        if (!this.timelineContainer) {
            console.error('Timeline components container not found!');
            return;
        }

        // Don't overwrite existing HTML structure - it already has proper header and empty state
        console.log('TimelineBuilder initialized with existing container structure');
    }

    setupEventListeners() {
        document.addEventListener('click', (e) => {
            if (e.target.closest('.edit-component-btn')) {
                e.stopPropagation();
                const componentElement = e.target.closest('.timeline-component');
                this.editComponent(componentElement);
            }
        });
    }

    renderTimeline() {
        // Use the timelineComponents container instead of timelineContent
        if (!this.timelineContainer) return;

        const timeline = this.jsonBuilder.timeline;
        const emptyState = this.timelineContainer.querySelector('.empty-timeline');

        if (timeline.length === 0) {
            // Show empty state
            if (emptyState) {
                emptyState.style.display = 'block';
            }
            // Remove all timeline components
            this.timelineContainer.querySelectorAll('.timeline-component').forEach(el => el.remove());
            return;
        }

        // Hide empty state when there are components
        if (emptyState) {
            emptyState.style.display = 'none';
        }

        // Remove existing timeline components to rebuild
        this.timelineContainer.querySelectorAll('.timeline-component').forEach(el => el.remove());

        // Add new components
        timeline.forEach((component, index) => {
            const componentElement = this.createComponentElementNew(component, index);
            this.timelineContainer.appendChild(componentElement);
        });
    }

    createComponentElement(component, index) {
        return `
            <div class="timeline-component" data-index="${index}" style="border: 1px solid #ccc; margin-bottom: 10px; padding: 10px; border-radius: 5px;">
                <div class="component-header d-flex justify-content-between align-items-center">
                    <div class="component-info">
                        <div class="component-title fw-bold">${component.name}</div>
                        <div class="component-type text-muted">${component.type}</div>
                    </div>
                    <div class="component-actions">
                        <button type="button" class="btn btn-sm btn-outline-primary edit-component-btn">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    createComponentElementNew(component, index) {
        const componentElement = document.createElement('div');
        componentElement.className = 'timeline-component card mb-2';
        componentElement.dataset.componentType = component.type;
        
        // Store component data
        const componentData = {
            type: component.type,
            name: component.name,
            ...component.parameters
        };
        // Preserve top-level label (not inside parameters)
        const _topLabel = component.label ?? component.parameters?.label ?? '';
        if (_topLabel !== '' && _topLabel !== undefined && _topLabel !== null) {
            componentData.label = _topLabel;
        }
        componentElement.dataset.componentData = JSON.stringify(componentData);

        const _labelText = (component.parameters?.label ?? component.label ?? '').toString().trim();
        const _esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const _subtitleHtml = _labelText
            ? `<small class="text-muted cf-component-label"><i class="fas fa-tag me-1" style="font-size:0.75em;opacity:0.6;"></i>${_esc(_labelText)}</small>`
            : `<small class="text-muted cf-component-label">${component.type}</small>`;

        componentElement.innerHTML = `
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-center">
                    <div class="d-flex align-items-center">
                        <div class="drag-handle me-2" style="cursor: move; color: #ccc;">
                            <i class="fas fa-grip-vertical"></i>
                        </div>
                        <div>
                            <h6 class="card-title mb-1">${component.name}</h6>
                            ${_subtitleHtml}
                        </div>
                    </div>
                    <div class="btn-group" role="group">
                        <button class="btn btn-sm btn-outline-info" onclick="previewComponent(this)" title="Preview">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-secondary" onclick="editComponent(this)" title="Edit">
                            <i class="fas fa-pencil-alt"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-secondary" onclick="duplicateComponent(this)" title="Duplicate Below">
                            <i class="fas fa-copy"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="removeComponent(this)" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        return componentElement;
    }

    editComponent(componentElement) {
        // Get component data from DOM element instead of timeline array
        try {
            const componentData = JSON.parse(componentElement.dataset.componentData || '{}');
            
            // Store reference to the editing component for saving later
            this.jsonBuilder.currentEditingComponent = componentElement;
            
            this.showParameterModal(componentData, componentElement);
        } catch (e) {
            console.error('Failed to parse component data:', e);
            alert('Error: Could not load component data for editing.');
        }
    }

    showParameterModal(component, componentElement) {
        const modal = document.getElementById('parameterModal');
        const modalBody = document.getElementById('parameterModalBody');
        const modalTitle = document.getElementById('parameterModalTitle');

        // The Instructions editor overrides the modal Save button onclick handler.
        // Ensure any subsequent component edit resets the Save handler back to the
        // schema-driven save path.
        try {
            const saveBtn = document.getElementById('saveParametersBtn');
            if (saveBtn) {
                saveBtn.onclick = () => this.saveComponentParameters();
            }
        } catch {
            // ignore
        }

        if (!modal || !modalBody || !modalTitle) {
            console.error('Parameter modal elements not found');
            console.log('modal:', modal, 'modalBody:', modalBody, 'modalTitle:', modalTitle);
            return;
        }

        // Set modal title
        modalTitle.textContent = `Edit ${component.name || component.type}`;

        // Store component element reference in modal for saving
        modal.setAttribute('data-component-element', 'stored');

        console.log('Editing component:', component);
        console.log('Component type:', component.type);

        // Custom editor for survey forms (complex nested question structure)
        if (component.type === 'survey-response') {
            this.showSurveyResponseParameterModal(component, componentElement, { modal, modalBody, modalTitle });
            return;
        }

        // Custom editor for rewards (screens + milestone timing)
        if (component.type === 'reward-settings') {
            this.showRewardSettingsParameterModal(component, componentElement, { modal, modalBody, modalTitle });
            return;
        }

        // Prefer schema-driven editor when available.
        // Fall back to Builder component definitions when schema is missing (e.g., DRT Start/Stop).
        // NOTE: Blocks are *task-scoped* in the Builder and have many task-specific fields.
        // The generic plugin schema for `block` is intentionally minimal and can show the wrong
        // defaults/options (e.g., RDM). Always use Builder component definitions for Blocks.
        const forceComponentDefs = component.type === 'block';
        const schema = forceComponentDefs ? null : this.jsonBuilder.schemaValidator.getPluginSchema(component.type);
        console.log('Schema found:', schema);

        modalBody.innerHTML = schema
            ? this.generateParameterForm(component, schema)
            : this.generateParameterFormFromComponentDefinitions(component);

        this._prependLabelFieldToModal(modalBody, component);

        // Setup form listeners
        this.setupParameterFormListeners(modalBody, component);

        // Show modal
        const bootstrapModal = new bootstrap.Modal(modal);
        bootstrapModal.show();
    }

    showRewardSettingsParameterModal(component, componentElement, { modal, modalBody, modalTitle }) {
        modalTitle.textContent = `Edit ${component.name || 'Reward Settings'}`;
        modal.setAttribute('data-component-element', 'stored');

        const safeNum = (v, fallback) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : fallback;
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

        // Normalize legacy flat fields into nested screen objects.
        const instructionsScreen = normalizeScreen(
            component.instructions_screen,
            component.instructions_title,
            component.instructions_template_html
        );
        const summaryScreen = normalizeScreen(
            component.summary_screen,
            component.summary_title,
            component.summary_template_html
        );

        const intermediateScreens = Array.isArray(component.intermediate_screens)
            ? component.intermediate_screens
            : (Array.isArray(component.extra_screens) ? component.extra_screens : []);

        const milestones = Array.isArray(component.milestones) ? component.milestones : [];

        const storeKey = (component.store_key ?? '__psy_rewards').toString();
        const currencyLabel = (component.currency_label ?? 'points').toString();
        const scoringBasis = (component.scoring_basis ?? 'both').toString();
        const rtThreshold = safeNum(component.rt_threshold_ms, 600);
        const ptsPerSuccess = safeNum(component.points_per_success, 1);
        const requireCorrectForRt = !!component.require_correct_for_rt;
        const calcOnFly = (component.calculate_on_the_fly !== false);
        const showSummary = (component.show_summary_at_end !== false);
        const continueKey = (component.continue_key ?? 'space').toString();

        const escape = (s) => this.escapeHtml(String(s ?? ''));
        const escapeAttr = (s) => this.escapeHtmlAttr(String(s ?? ''));

        const getContinueKeyLabel = (raw) => {
            const k = (raw ?? '').toString();
            if (k === 'ALL_KEYS') return 'any key';
            return k;
        };

        const getScoringBasisLabel = (raw) => {
            const b = (raw ?? '').toString();
            if (b === 'accuracy') return 'Accuracy';
            if (b === 'reaction_time') return 'Reaction time';
            if (b === 'both') return 'Accuracy + reaction time';
            return b;
        };

        const getPreviewVars = () => {
            const currency = (modalBody.querySelector('#reward_currency_label')?.value ?? currencyLabel).toString() || 'points';
            const basis = (modalBody.querySelector('#reward_scoring_basis')?.value ?? scoringBasis).toString() || 'both';
            const rt = Number(modalBody.querySelector('#reward_rt_threshold_ms')?.value);
            const pts = Number(modalBody.querySelector('#reward_points_per_success')?.value);
            const cont = (modalBody.querySelector('#reward_continue_key')?.value ?? continueKey).toString() || 'space';

            return {
                currency_label: currency,
                scoring_basis_label: getScoringBasisLabel(basis),
                rt_threshold_ms: Number.isFinite(rt) ? String(rt) : String(rtThreshold),
                points_per_success: Number.isFinite(pts) ? String(pts) : String(ptsPerSuccess),
                continue_key_label: getContinueKeyLabel(cont),

                // Totals / live metrics (sample values for preview)
                total_points: '12',
                rewarded_trials: '8',
                eligible_trials: '10',
                success_streak: '3',
                badge_level: 'Bronze'
            };
        };

        const applyTemplateVars = (html, vars) => {
            const text = (html ?? '').toString();
            return text.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (m, key) => {
                if (Object.prototype.hasOwnProperty.call(vars, key)) return String(vars[key]);
                return m;
            });
        };

        const resolveMediaUrlForParam = (paramName) => {
            const inputEl = modalBody.querySelector(`#${CSS.escape(`param_${paramName}`)}`);
            const val = (inputEl?.value ?? '').toString();
            if (!val) return '';

            if (val.startsWith('asset://')) {
                const previewEl = modalBody.querySelector(`#${CSS.escape(`param_${paramName}__preview`)}`);
                const src = (previewEl && (previewEl.currentSrc || previewEl.src)) ? (previewEl.currentSrc || previewEl.src) : '';
                return src || '';
            }

            return val;
        };

        const getTemplateVariablesHelp = () => {
            return [
                '{{currency_label}}',
                '{{scoring_basis_label}}',
                '{{rt_threshold_ms}}',
                '{{points_per_success}}',
                '{{total_points}}',
                '{{rewarded_trials}}',
                '{{eligible_trials}}',
                '{{success_streak}}',
                '{{badge_level}}',
                '{{continue_key_label}}'
            ].join(', ');
        };

        const getTemplatePlaceholder = (kind) => {
            if (kind === 'instructions') {
                return '<p>You can earn <b>{{currency_label}}</b>.</p>\n<ul>\n<li><b>Basis</b>: {{scoring_basis_label}}</li>\n<li><b>RT threshold</b>: {{rt_threshold_ms}} ms</li>\n<li><b>Points per success</b>: {{points_per_success}}</li>\n</ul>\n<p>Press {{continue_key_label}} to begin.</p>';
            }
            if (kind === 'summary') {
                return '<p><b>Total earned</b>: {{total_points}} {{currency_label}}</p>\n<p><b>Rewarded trials</b>: {{rewarded_trials}} / {{eligible_trials}}</p>\n<p>Press {{continue_key_label}} to finish.</p>';
            }
            return '<p>Total so far: <b>{{total_points}}</b> {{currency_label}}</p>\n<p>Press {{continue_key_label}} to continue.</p>';
        };

        const renderImageAssetField = (paramName, label, initialValue) => {
            const inputId = `param_${paramName}`;
            const helpId = `${inputId}__help`;
            const fileId = `${inputId}__file`;
            const previewId = `${inputId}__preview`;
            const clearId = `${inputId}__clear`;
            const safeVal = (initialValue ?? '').toString();
            return `
                <div class="mb-2">
                    <label class="form-label">${escape(label)}</label>
                    <div class="d-flex flex-column gap-2">
                        <div class="input-group">
                            <span class="input-group-text">URL</span>
                            <input type="text" class="form-control" id="${escapeAttr(inputId)}" value="${escapeAttr(safeVal)}" aria-describedby="${escapeAttr(helpId)}">
                        </div>
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            <input type="file" class="form-control form-control-sm" id="${escapeAttr(fileId)}" accept="image/*"
                                   data-psy-image-file="1" data-psy-image-param="${escapeAttr(String(paramName))}" style="max-width: 360px;">
                            <button type="button" class="btn btn-sm btn-outline-secondary" id="${escapeAttr(clearId)}"
                                    data-psy-image-clear="1" data-psy-image-param="${escapeAttr(String(paramName))}">
                                Clear local file
                            </button>
                            <small class="text-muted" id="${escapeAttr(helpId)}">
                                Choose a local image to preview; it is stored as <code>asset://...</code> until exported.
                            </small>
                        </div>
                        <div>
                            <div class="small text-muted mb-1">Preview</div>
                            <div class="border rounded p-2">
                                <img id="${escapeAttr(previewId)}" alt="image preview" style="max-width: 100%; max-height: 240px; display:none;" />
                                <div class="text-muted" data-psy-image-empty="1" style="display:none;">No image selected.</div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        };

        const renderAudioAssetField = (paramName, label, initialValue) => {
            const inputId = `param_${paramName}`;
            const helpId = `${inputId}__help`;
            const fileId = `${inputId}__file`;
            const previewId = `${inputId}__preview`;
            const clearId = `${inputId}__clear`;
            const safeVal = (initialValue ?? '').toString();
            return `
                <div class="mb-2">
                    <label class="form-label">${escape(label)}</label>
                    <div class="d-flex flex-column gap-2">
                        <div class="input-group">
                            <span class="input-group-text">URL</span>
                            <input type="text" class="form-control" id="${escapeAttr(inputId)}" value="${escapeAttr(safeVal)}" aria-describedby="${escapeAttr(helpId)}">
                        </div>
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            <input type="file" class="form-control form-control-sm" id="${escapeAttr(fileId)}" accept="audio/*"
                                   data-psy-audio-file="1" data-psy-audio-param="${escapeAttr(String(paramName))}" style="max-width: 360px;">
                            <button type="button" class="btn btn-sm btn-outline-secondary" id="${escapeAttr(clearId)}"
                                    data-psy-audio-clear="1" data-psy-audio-param="${escapeAttr(String(paramName))}">
                                Clear local file
                            </button>
                            <small class="text-muted" id="${escapeAttr(helpId)}">
                                Choose a local audio file to preview; it is stored as <code>asset://...</code> until exported.
                            </small>
                        </div>
                        <div>
                            <div class="small text-muted mb-1">Preview</div>
                            <div class="border rounded p-2">
                                <audio id="${escapeAttr(previewId)}" controls style="width: 100%; display:none;"></audio>
                                <div class="text-muted" data-psy-audio-empty="1" style="display:none;">No audio selected.</div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        };

        const renderScreenCard = ({ kind, index, screen, titleLabel }) => {
            const prefix = `rw_${kind}_${index}`;
            const titleId = `${prefix}__title`;
            const htmlId = `${prefix}__html`;
            const imageParam = `${prefix}__image_url`;
            const audioParam = `${prefix}__audio_url`;

            const imageVal = (screen && typeof screen === 'object') ? (screen.image_url ?? '') : '';
            const audioVal = (screen && typeof screen === 'object') ? (screen.audio_url ?? '') : '';
            const titleVal = (screen && typeof screen === 'object') ? (screen.title ?? '') : '';
            const tplVal = (screen && typeof screen === 'object') ? (screen.template_html ?? screen.html ?? '') : '';
            const tplPlaceholder = getTemplatePlaceholder(kind);

            return `
                <div class="reward-screen border rounded p-2" data-rw-kind="${escapeAttr(kind)}" data-rw-index="${escapeAttr(String(index))}">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <strong>${escape(titleLabel)}</strong>
                        <button type="button" class="btn btn-sm btn-outline-danger" data-rw-action="remove">Remove</button>
                    </div>

                    <div class="row g-2">
                        <div class="col-md-6">
                            <label class="form-label">Title</label>
                            <input type="text" class="form-control" id="${escapeAttr(titleId)}" value="${escapeAttr(titleVal)}" placeholder="Screen title">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label">Template variables</label>
                            <div class="form-text">
                                Available: ${escape(getTemplateVariablesHelp())}
                            </div>
                        </div>
                    </div>

                    <div class="mt-2">
                        <label class="form-label">HTML (template)</label>
                        <textarea class="form-control" id="${escapeAttr(htmlId)}" rows="5" placeholder="${escapeAttr(tplPlaceholder)}">${escape(tplVal)}</textarea>
                        <div class="form-text">You may reference uploaded media URLs directly or embed <code>asset://...</code> which will be uploaded on Export.</div>
                    </div>

                    <div class="mt-2">
                        <button type="button" class="btn btn-sm btn-outline-primary" data-rw-action="preview">Preview this screen</button>
                        <div class="border rounded p-2 mt-2" data-rw-preview="1" style="display:none;"></div>
                        <div class="form-text">Preview uses sample values for totals (e.g., <code>{{total_points}}</code>) and the selected image/audio from this editor.</div>
                    </div>

                    <div class="mt-2">
                        ${renderImageAssetField(imageParam, 'Image (optional)', imageVal)}
                        ${renderAudioAssetField(audioParam, 'Audio (optional)', audioVal)}
                    </div>
                </div>
            `;
        };

        const renderPreviewForScreenCard = (cardEl) => {
            if (!cardEl) return;
            const kind = (cardEl.getAttribute('data-rw-kind') ?? '').toString();
            const index = Number(cardEl.getAttribute('data-rw-index'));
            if (!kind || !Number.isFinite(index)) return;

            const prefix = `rw_${kind}_${index}`;
            const html = (modalBody.querySelector(`#${CSS.escape(`${prefix}__html`)}`)?.value ?? '').toString();
            const imgSrc = resolveMediaUrlForParam(`${prefix}__image_url`);
            const audSrc = resolveMediaUrlForParam(`${prefix}__audio_url`);
            const vars = getPreviewVars();

            const previewEl = cardEl.querySelector('[data-rw-preview="1"]');
            if (!previewEl) return;

            const rendered = applyTemplateVars(html || getTemplatePlaceholder(kind), vars);

            let mediaHtml = '';
            if (imgSrc) {
                mediaHtml += `<div class="mb-2"><img src="${escapeAttr(imgSrc)}" alt="preview image" style="max-width:100%; max-height:240px;"></div>`;
            }
            if (audSrc) {
                mediaHtml += `<div class="mb-2"><audio src="${escapeAttr(audSrc)}" controls style="width:100%;"></audio></div>`;
            }

            previewEl.innerHTML = `${mediaHtml}<div>${rendered}</div>`;
            previewEl.style.display = '';
        };

        const bindPreviewButtons = (rootEl) => {
            if (!rootEl) return;
            rootEl.querySelectorAll('button[data-rw-action="preview"]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const cardEl = btn.closest('.reward-screen');
                    renderPreviewForScreenCard(cardEl);
                });
            });
        };

        const bindRemoveButtons = (rootEl) => {
            if (!rootEl) return;
            rootEl.querySelectorAll('button[data-rw-action="remove"]').forEach(btn => {
                btn.addEventListener('click', () => {
                    try {
                        btn.closest('.reward-screen')?.remove();
                    } catch {
                        // ignore
                    }
                });
            });
        };

        const bindScreenCardBehaviors = (rootEl) => {
            bindRemoveButtons(rootEl);
            bindPreviewButtons(rootEl);
        };

        modalBody.innerHTML = `
            <div class="d-flex flex-column gap-3">
                <div class="border rounded p-2">
                    <h6 class="mb-2">Scoring</h6>
                    <div class="row g-2">
                        <div class="col-md-4">
                            <label class="form-label">Store key</label>
                            <input type="text" class="form-control" id="reward_store_key" value="${escapeAttr(storeKey)}">
                        </div>
                        <div class="col-md-4">
                            <label class="form-label">Currency label</label>
                            <input type="text" class="form-control" id="reward_currency_label" value="${escapeAttr(currencyLabel)}">
                        </div>
                        <div class="col-md-4">
                            <label class="form-label">Continue key</label>
                            <select class="form-select" id="reward_continue_key">
                                <option value="space">space</option>
                                <option value="enter">enter</option>
                                <option value="ALL_KEYS">ALL_KEYS</option>
                            </select>
                        </div>
                        <div class="col-md-4">
                            <label class="form-label">Scoring basis</label>
                            <select class="form-select" id="reward_scoring_basis">
                                <option value="accuracy">accuracy</option>
                                <option value="reaction_time">reaction_time</option>
                                <option value="both">both</option>
                            </select>
                        </div>
                        <div class="col-md-4">
                            <label class="form-label">RT threshold (ms)</label>
                            <input type="number" class="form-control" id="reward_rt_threshold_ms" min="0" max="60000" step="1" value="${escapeAttr(String(rtThreshold))}">
                        </div>
                        <div class="col-md-4">
                            <label class="form-label">Points per success</label>
                            <input type="number" class="form-control" id="reward_points_per_success" min="0" max="1000" step="0.1" value="${escapeAttr(String(ptsPerSuccess))}">
                        </div>
                    </div>

                    <div class="form-check form-switch mt-2">
                        <input class="form-check-input" type="checkbox" id="reward_require_correct_for_rt" ${requireCorrectForRt ? 'checked' : ''}>
                        <label class="form-check-label" for="reward_require_correct_for_rt">Require correct response for RT-based success</label>
                    </div>
                    <div class="form-check form-switch mt-1">
                        <input class="form-check-input" type="checkbox" id="reward_calculate_on_the_fly" ${calcOnFly ? 'checked' : ''}>
                        <label class="form-check-label" for="reward_calculate_on_the_fly">Update totals on the fly</label>
                    </div>
                    <div class="form-check form-switch mt-1">
                        <input class="form-check-input" type="checkbox" id="reward_show_summary_at_end" ${showSummary ? 'checked' : ''}>
                        <label class="form-check-label" for="reward_show_summary_at_end">Show final summary screen</label>
                    </div>
                </div>

                <div class="border rounded p-2">
                    <h6 class="mb-2">Instructions Screen</h6>
                    <div id="rw_instructions"></div>
                </div>

                <div class="border rounded p-2">
                    <div class="d-flex justify-content-between align-items-center">
                        <h6 class="mb-0">Additional Screens (shown after instructions)</h6>
                        <button type="button" class="btn btn-sm btn-outline-primary" id="rw_add_intermediate">
                            <i class="fas fa-plus"></i> Add screen
                        </button>
                    </div>
                    <div class="form-text mb-2">These screens are shown once, before the first task trial.</div>
                    <div id="rw_intermediate_list" class="d-flex flex-column gap-2"></div>
                </div>

                <div class="border rounded p-2">
                    <div class="d-flex justify-content-between align-items-center">
                        <h6 class="mb-0">Milestone Screens (achievement-based or trial-count-based)</h6>
                        <button type="button" class="btn btn-sm btn-outline-primary" id="rw_add_milestone">
                            <i class="fas fa-plus"></i> Add milestone
                        </button>
                    </div>
                    <div class="form-text mb-2">Each milestone triggers a screen immediately after the trial that achieves it.</div>
                    <div id="rw_milestone_list" class="d-flex flex-column gap-2"></div>
                </div>

                <div class="border rounded p-2">
                    <h6 class="mb-2">Final Summary Screen</h6>
                    <div id="rw_summary"></div>
                </div>
            </div>
        `;

        // Set selects
        const contEl = modalBody.querySelector('#reward_continue_key');
        if (contEl) contEl.value = continueKey;
        const basisEl = modalBody.querySelector('#reward_scoring_basis');
        if (basisEl) basisEl.value = scoringBasis;

        // Render fixed instruction + summary cards
        const instrHost = modalBody.querySelector('#rw_instructions');
        if (instrHost) {
            instrHost.innerHTML = renderScreenCard({
                kind: 'instructions',
                index: 0,
                screen: instructionsScreen,
                titleLabel: 'Instructions'
            });
            bindScreenCardBehaviors(instrHost);
        }
        const summaryHost = modalBody.querySelector('#rw_summary');
        if (summaryHost) {
            summaryHost.innerHTML = renderScreenCard({
                kind: 'summary',
                index: 0,
                screen: summaryScreen,
                titleLabel: 'Summary'
            });
            bindScreenCardBehaviors(summaryHost);
        }

        const nextChildIndex = (containerEl, selector, attrName) => {
            if (!containerEl) return 0;
            let max = -1;
            containerEl.querySelectorAll(selector).forEach((el) => {
                const raw = el.getAttribute(attrName);
                const n = Number(raw);
                if (Number.isFinite(n) && n > max) max = n;
            });
            return max + 1;
        };

        // Helper to create intermediate screen
        const intermediateList = modalBody.querySelector('#rw_intermediate_list');
        const addIntermediate = (screen = {}) => {
            if (!intermediateList) return;
            const idx = nextChildIndex(intermediateList, '.reward-screen[data-rw-kind="intermediate"]', 'data-rw-index');
            const wrapper = document.createElement('div');
            wrapper.innerHTML = renderScreenCard({ kind: 'intermediate', index: idx, screen, titleLabel: `Additional screen #${idx + 1}` });
            const el = wrapper.firstElementChild;
            if (el) {
                intermediateList.appendChild(el);
                bindScreenCardBehaviors(el);
                try { this.setupImageParameterInputs(modalBody); } catch { /* ignore */ }
                try { this.setupAudioParameterInputs(modalBody); } catch { /* ignore */ }
            }
        };

        (Array.isArray(intermediateScreens) ? intermediateScreens : []).forEach(s => addIntermediate(s));
        const addIntermediateBtn = modalBody.querySelector('#rw_add_intermediate');
        if (addIntermediateBtn) {
            addIntermediateBtn.addEventListener('click', () => addIntermediate({
                title: '',
                template_html: getTemplatePlaceholder('intermediate')
            }));
        }

        // Helper to create milestone rule + screen
        const milestoneList = modalBody.querySelector('#rw_milestone_list');
        const addMilestone = (m = {}) => {
            if (!milestoneList) return;
            const idx = nextChildIndex(milestoneList, '.rw-milestone', 'data-rw-milestone-index');

            const triggerType = (m.trigger_type ?? m.trigger ?? 'trial_count').toString();
            const threshold = safeNum(m.threshold ?? m.value ?? 10, 10);
            const scr = (m.screen && typeof m.screen === 'object') ? m.screen : m;

            const prefix = `rw_milestone_${idx}`;
            const triggerId = `${prefix}__trigger`;
            const thresholdId = `${prefix}__threshold`;

            const outer = document.createElement('div');
            outer.className = 'rw-milestone border rounded p-2';
            outer.setAttribute('data-rw-milestone-index', String(idx));
            outer.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <strong>Milestone #${idx + 1}</strong>
                    <button type="button" class="btn btn-sm btn-outline-danger" data-rw-action="remove-milestone">Remove</button>
                </div>
                <div class="row g-2 mt-1">
                    <div class="col-md-6">
                        <label class="form-label">Trigger</label>
                        <select class="form-select" id="${escapeAttr(triggerId)}">
                            <option value="trial_count">After X trials</option>
                            <option value="total_points">After X total points</option>
                            <option value="success_streak">After X successful trials in a row</option>
                        </select>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label">Threshold (X)</label>
                        <input type="number" class="form-control" id="${escapeAttr(thresholdId)}" min="1" step="1" value="${escapeAttr(String(threshold))}">
                    </div>
                </div>
                <div class="mt-2" data-rw-milestone-screen="1"></div>
            `;

            const scrHost = outer.querySelector('[data-rw-milestone-screen="1"]');
            if (scrHost) {
                scrHost.innerHTML = renderScreenCard({ kind: 'milestone', index: idx, screen: scr, titleLabel: 'Milestone screen' });
                bindScreenCardBehaviors(scrHost);
            }

            milestoneList.appendChild(outer);
            const trigEl = outer.querySelector(`#${CSS.escape(triggerId)}`);
            if (trigEl) trigEl.value = (triggerType === 'success_streak') ? 'success_streak'
                : (triggerType === 'total_points') ? 'total_points'
                : 'trial_count';

            const rmBtn = outer.querySelector('button[data-rw-action="remove-milestone"]');
            if (rmBtn) {
                rmBtn.addEventListener('click', () => outer.remove());
            }

            try { this.setupImageParameterInputs(modalBody); } catch { /* ignore */ }
            try { this.setupAudioParameterInputs(modalBody); } catch { /* ignore */ }
        };

        (Array.isArray(milestones) ? milestones : []).forEach(m => addMilestone(m));
        const addMilestoneBtn = modalBody.querySelector('#rw_add_milestone');
        if (addMilestoneBtn) {
            addMilestoneBtn.addEventListener('click', () => addMilestone({
                trigger_type: 'trial_count',
                threshold: 10,
                screen: {
                    title: '',
                    template_html: getTemplatePlaceholder('milestone')
                }
            }));
        }

        // Bind asset pickers + previews for the whole modal.
        try { this.setupImageParameterInputs(modalBody); } catch { /* ignore */ }
        try { this.setupAudioParameterInputs(modalBody); } catch { /* ignore */ }

        const bootstrapModal = new bootstrap.Modal(modal);
        bootstrapModal.show();
    }

    collectRewardSettingsFromModal(modalBody) {
        const getText = (sel) => (modalBody.querySelector(sel)?.value ?? '').toString();
        const getNum = (sel, fallback) => {
            const raw = modalBody.querySelector(sel)?.value;
            const n = Number(raw);
            return Number.isFinite(n) ? n : fallback;
        };
        const getBool = (sel) => !!modalBody.querySelector(sel)?.checked;

        const store_key = getText('#reward_store_key') || '__psy_rewards';
        const currency_label = getText('#reward_currency_label') || 'points';
        const continue_key = getText('#reward_continue_key') || 'space';
        const scoring_basis = getText('#reward_scoring_basis') || 'both';
        const rt_threshold_ms = getNum('#reward_rt_threshold_ms', 600);
        const points_per_success = getNum('#reward_points_per_success', 1);
        const require_correct_for_rt = getBool('#reward_require_correct_for_rt');
        const calculate_on_the_fly = getBool('#reward_calculate_on_the_fly');
        const show_summary_at_end = getBool('#reward_show_summary_at_end');

        const readScreen = (kind, index) => {
            const prefix = `rw_${kind}_${index}`;
            const title = (modalBody.querySelector(`#${CSS.escape(`${prefix}__title`)}`)?.value ?? '').toString();
            const template_html = (modalBody.querySelector(`#${CSS.escape(`${prefix}__html`)}`)?.value ?? '').toString();
            const image_url = (modalBody.querySelector(`#${CSS.escape(`param_${prefix}__image_url`)}`)?.value ?? '').toString();
            const audio_url = (modalBody.querySelector(`#${CSS.escape(`param_${prefix}__audio_url`)}`)?.value ?? '').toString();
            return { title, template_html, image_url, audio_url };
        };

        const instructions_screen = readScreen('instructions', 0);
        const summary_screen = readScreen('summary', 0);

        const intermediate_screens = [];
        modalBody.querySelectorAll('.reward-screen[data-rw-kind="intermediate"]').forEach((el) => {
            const idx = Number(el.getAttribute('data-rw-index'));
            if (!Number.isFinite(idx)) return;
            intermediate_screens.push(readScreen('intermediate', idx));
        });

        const milestones = [];
        modalBody.querySelectorAll('.rw-milestone').forEach((outer) => {
            const idxRaw = outer.getAttribute('data-rw-milestone-index');
            const idx = Number(idxRaw);
            const safeIdx = Number.isFinite(idx) ? idx : milestones.length;

            const trigger = (outer.querySelector(`#${CSS.escape(`rw_milestone_${safeIdx}__trigger`)}`)?.value ?? 'trial_count').toString();
            const thresholdRaw = outer.querySelector(`#${CSS.escape(`rw_milestone_${safeIdx}__threshold`)}`)?.value;
            const threshold = Number.parseInt(thresholdRaw, 10);

            const screen = readScreen('milestone', safeIdx);
            milestones.push({
                id: `m${milestones.length + 1}`,
                trigger_type: (trigger === 'total_points') ? 'total_points'
                    : (trigger === 'success_streak') ? 'success_streak'
                    : 'trial_count',
                threshold: Number.isFinite(threshold) ? threshold : 10,
                screen
            });
        });

        // Keep legacy flat fields for backward compatibility with older Interpreters.
        const instructions_title = (instructions_screen.title || 'Rewards').toString();
        const instructions_template_html = (instructions_screen.template_html || '').toString();
        const summary_title = (summary_screen.title || 'Rewards Summary').toString();
        const summary_template_html = (summary_screen.template_html || '').toString();

        return {
            store_key,
            currency_label,
            scoring_basis,
            rt_threshold_ms,
            points_per_success,
            require_correct_for_rt,
            calculate_on_the_fly,
            show_summary_at_end,
            continue_key,

            instructions_screen,
            intermediate_screens,
            milestones,
            summary_screen,

            instructions_title,
            instructions_template_html,
            summary_title,
            summary_template_html
        };
    }

    showSurveyResponseParameterModal(component, componentElement, { modal, modalBody, modalTitle }) {
        // Title
        modalTitle.textContent = `Edit ${component.name || 'Survey Response'}`;

        // Store component element reference in modal for saving
        modal.setAttribute('data-component-element', 'stored');

        const title = component.title ?? component.parameters?.title ?? 'Survey';
        const instructions = component.instructions ?? component.parameters?.instructions ?? '';
        const submitLabel = component.submit_label ?? component.parameters?.submit_label ?? 'Continue';
        const allowEmptyOnTimeout = !!(component.allow_empty_on_timeout ?? component.parameters?.allow_empty_on_timeout ?? false);
        const timeoutMs = (component.timeout_ms ?? component.parameters?.timeout_ms ?? null);
        const questions = component.questions ?? component.parameters?.questions ?? [];

        modalBody.innerHTML = `
            <div class="mb-3">
                <label class="form-label fw-bold">Title</label>
                <input type="text" class="form-control" id="survey_title" value="${this.escapeHtmlAttr(String(title))}">
            </div>
            <div class="mb-3">
                <label class="form-label fw-bold">Instructions</label>
                <textarea class="form-control" id="survey_instructions" rows="3">${this.escapeHtml(String(instructions))}</textarea>
            </div>
            <div class="mb-3">
                <label class="form-label fw-bold">Submit button label</label>
                <input type="text" class="form-control" id="survey_submit_label" value="${this.escapeHtmlAttr(String(submitLabel))}">
            </div>

            <div class="border rounded p-2 mb-3">
                <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="survey_allow_empty_on_timeout" ${allowEmptyOnTimeout ? 'checked' : ''}>
                    <label class="form-check-label fw-bold" for="survey_allow_empty_on_timeout">
                        Continue with empty responses after timeout
                    </label>
                </div>
                <div class="row g-2 mt-1">
                    <div class="col-md-4">
                        <label class="form-label">Timeout (ms)</label>
                        <input type="number" class="form-control" id="survey_timeout_ms" min="0" value="${timeoutMs === null ? '' : this.escapeHtmlAttr(String(timeoutMs))}" placeholder="(off)">
                    </div>
                    <div class="col-md-8 d-flex align-items-end">
                        <small class="text-muted">
                            When enabled, the interpreter may auto-advance after the timeout and store unanswered items as null/empty.
                        </small>
                    </div>
                </div>
            </div>

            <hr />

            <div class="d-flex justify-content-between align-items-center mb-2">
                <h6 class="mb-0">Questions</h6>
                <button type="button" class="btn btn-sm btn-outline-primary" id="survey_add_question">
                    <i class="fas fa-plus"></i> Add Question
                </button>
            </div>
            <div id="survey_questions" class="d-flex flex-column gap-2"></div>
            <small class="text-muted d-block mt-2">
                Supported types: likert, radio, text, slider, number. Responses are keyed by question id.
            </small>
        `;

        // Toggle timeout input enable/disable
        const allowTimeoutEl = modalBody.querySelector('#survey_allow_empty_on_timeout');
        const timeoutEl = modalBody.querySelector('#survey_timeout_ms');
        const syncTimeoutUi = () => {
            if (!allowTimeoutEl || !timeoutEl) return;
            timeoutEl.disabled = !allowTimeoutEl.checked;
        };
        if (allowTimeoutEl) {
            allowTimeoutEl.addEventListener('change', syncTimeoutUi);
        }
        syncTimeoutUi();

        const container = modalBody.querySelector('#survey_questions');
        const addBtn = modalBody.querySelector('#survey_add_question');

        const addQuestionEl = (q = {}) => {
            const qType = (q.type || 'likert');
            const qId = (q.id || 'q' + (container.children.length + 1));
            const qPrompt = (q.prompt || '');
            const required = !!q.required;

            const optText = Array.isArray(q.options) ? q.options.join('\n') : (q.options || '');

            const sliderMin = (q.min ?? 0);
            const sliderMax = (q.max ?? 100);
            const sliderStep = (q.step ?? 1);
            const sliderMinLabel = (q.min_label ?? '');
            const sliderMaxLabel = (q.max_label ?? '');

            const textPlaceholder = (q.placeholder ?? '');
            const multiline = !!q.multiline;
            const rows = (q.rows ?? 3);

            const numberMin = (q.min ?? '');
            const numberMax = (q.max ?? '');
            const numberStep = (q.step ?? 1);

            const wrapper = document.createElement('div');
            wrapper.className = 'survey-question border rounded p-2';
            wrapper.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <strong>Question</strong>
                    <button type="button" class="btn btn-sm btn-outline-danger" data-action="remove">Remove</button>
                </div>
                <div class="row g-2 mt-1">
                    <div class="col-md-3">
                        <label class="form-label">ID</label>
                        <input type="text" class="form-control" data-field="id" value="${this.escapeHtmlAttr(String(qId))}">
                    </div>
                    <div class="col-md-6">
                        <label class="form-label">Prompt</label>
                        <input type="text" class="form-control" data-field="prompt" value="${this.escapeHtmlAttr(String(qPrompt))}">
                    </div>
                    <div class="col-md-3">
                        <label class="form-label">Type</label>
                        <select class="form-select" data-field="type">
                            <option value="likert">Likert scale</option>
                            <option value="radio">Radio options</option>
                            <option value="text">Text input</option>
                            <option value="slider">Slider</option>
                            <option value="number">Numeric input</option>
                        </select>
                    </div>
                </div>
                <div class="form-check mt-2">
                    <input class="form-check-input" type="checkbox" data-field="required" ${required ? 'checked' : ''}>
                    <label class="form-check-label">Required</label>
                </div>

                <div class="survey-type survey-type-likert mt-2" data-type-section="likert">
                    <label class="form-label">Options (one per line)</label>
                    <textarea class="form-control" rows="4" data-field="options">${this.escapeHtml(String(optText))}</textarea>
                </div>

                <div class="survey-type survey-type-radio mt-2" data-type-section="radio" style="display:none;">
                    <label class="form-label">Options (one per line)</label>
                    <textarea class="form-control" rows="4" data-field="options">${this.escapeHtml(String(optText))}</textarea>
                </div>

                <div class="survey-type survey-type-text mt-2" data-type-section="text" style="display:none;">
                    <div class="row g-2">
                        <div class="col-md-8">
                            <label class="form-label">Placeholder</label>
                            <input type="text" class="form-control" data-field="placeholder" value="${this.escapeHtmlAttr(String(textPlaceholder))}">
                        </div>
                        <div class="col-md-4 d-flex align-items-end">
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" data-field="multiline" ${multiline ? 'checked' : ''}>
                                <label class="form-check-label">Multiline</label>
                            </div>
                        </div>
                        <div class="col-md-4">
                            <label class="form-label">Rows (if multiline)</label>
                            <input type="number" class="form-control" data-field="rows" min="1" value="${this.escapeHtmlAttr(String(rows))}">
                        </div>
                    </div>
                </div>

                <div class="survey-type survey-type-slider mt-2" data-type-section="slider" style="display:none;">
                    <div class="row g-2">
                        <div class="col-md-4">
                            <label class="form-label">Min</label>
                            <input type="number" class="form-control" data-field="min" value="${this.escapeHtmlAttr(String(sliderMin))}">
                        </div>
                        <div class="col-md-4">
                            <label class="form-label">Max</label>
                            <input type="number" class="form-control" data-field="max" value="${this.escapeHtmlAttr(String(sliderMax))}">
                        </div>
                        <div class="col-md-4">
                            <label class="form-label">Step</label>
                            <input type="number" class="form-control" data-field="step" value="${this.escapeHtmlAttr(String(sliderStep))}">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label">Min label (optional)</label>
                            <input type="text" class="form-control" data-field="min_label" value="${this.escapeHtmlAttr(String(sliderMinLabel))}">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label">Max label (optional)</label>
                            <input type="text" class="form-control" data-field="max_label" value="${this.escapeHtmlAttr(String(sliderMaxLabel))}">
                        </div>
                    </div>
                </div>

                <div class="survey-type survey-type-number mt-2" data-type-section="number" style="display:none;">
                    <div class="row g-2">
                        <div class="col-md-3">
                            <label class="form-label">Min (optional)</label>
                            <input type="number" class="form-control" data-field="min" value="${this.escapeHtmlAttr(String(numberMin))}">
                        </div>
                        <div class="col-md-3">
                            <label class="form-label">Max (optional)</label>
                            <input type="number" class="form-control" data-field="max" value="${this.escapeHtmlAttr(String(numberMax))}">
                        </div>
                        <div class="col-md-3">
                            <label class="form-label">Step</label>
                            <input type="number" class="form-control" data-field="step" value="${this.escapeHtmlAttr(String(numberStep))}">
                        </div>
                        <div class="col-md-3">
                            <label class="form-label">Placeholder</label>
                            <input type="text" class="form-control" data-field="placeholder" value="${this.escapeHtmlAttr(String(textPlaceholder))}">
                        </div>
                    </div>
                </div>
            `;

            const typeEl = wrapper.querySelector('[data-field="type"]');
            if (typeEl) typeEl.value = qType;

            const updateVisibility = () => {
                const t = (typeEl?.value || 'likert');
                wrapper.querySelectorAll('[data-type-section]').forEach(sec => {
                    const secType = sec.getAttribute('data-type-section');
                    sec.style.display = (secType === t) ? '' : 'none';
                });
            };

            if (typeEl) typeEl.addEventListener('change', updateVisibility);
            updateVisibility();

            const removeBtn = wrapper.querySelector('[data-action="remove"]');
            if (removeBtn) {
                removeBtn.addEventListener('click', () => {
                    wrapper.remove();
                });
            }

            container.appendChild(wrapper);
        };

        (Array.isArray(questions) ? questions : []).forEach(q => addQuestionEl(q));
        if (container.children.length === 0) {
            addQuestionEl({ type: 'likert', id: 'q1', prompt: '', options: ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'], required: true });
        }

        if (addBtn) {
            addBtn.addEventListener('click', () => addQuestionEl({ type: 'likert', prompt: '', required: false }));
        }

        const bootstrapModal = new bootstrap.Modal(modal);
        bootstrapModal.show();
    }

    collectSurveyResponseFromModal(modalBody) {
        const title = modalBody.querySelector('#survey_title')?.value ?? 'Survey';
        const instructions = modalBody.querySelector('#survey_instructions')?.value ?? '';
        const submit_label = modalBody.querySelector('#survey_submit_label')?.value ?? 'Continue';

        const allow_empty_on_timeout = !!modalBody.querySelector('#survey_allow_empty_on_timeout')?.checked;
        const timeoutRaw = modalBody.querySelector('#survey_timeout_ms')?.value;
        const timeout_ms = (timeoutRaw === undefined || timeoutRaw === null || timeoutRaw === '')
            ? null
            : Number(timeoutRaw);

        const questions = [];
        const questionEls = modalBody.querySelectorAll('.survey-question');

        const parseLines = (raw) => {
            return raw
                .toString()
                .split(/\r?\n/)
                .map(s => s.trim())
                .filter(Boolean);
        };

        questionEls.forEach((el, idx) => {
            const type = (el.querySelector('[data-field="type"]')?.value || 'likert').trim();
            const idRaw = (el.querySelector('[data-field="id"]')?.value || '').trim();
            const id = idRaw || `q${idx + 1}`;
            const prompt = (el.querySelector('[data-field="prompt"]')?.value || '').trim();
            const required = !!el.querySelector('[data-field="required"]')?.checked;

            const q = { id, type, prompt, required };

            if (type === 'likert' || type === 'radio') {
                const optionsRaw = el.querySelector(`[data-type-section="${type}"] [data-field="options"]`)?.value || '';
                q.options = parseLines(optionsRaw);
            } else if (type === 'text') {
                q.placeholder = (el.querySelector('[data-type-section="text"] [data-field="placeholder"]')?.value || '').toString();
                q.multiline = !!el.querySelector('[data-type-section="text"] [data-field="multiline"]')?.checked;
                const rowsRaw = el.querySelector('[data-type-section="text"] [data-field="rows"]')?.value;
                const rows = Number.parseInt(rowsRaw, 10);
                if (Number.isFinite(rows)) q.rows = rows;
            } else if (type === 'slider') {
                const min = Number(el.querySelector('[data-type-section="slider"] [data-field="min"]')?.value);
                const max = Number(el.querySelector('[data-type-section="slider"] [data-field="max"]')?.value);
                const step = Number(el.querySelector('[data-type-section="slider"] [data-field="step"]')?.value);
                if (Number.isFinite(min)) q.min = min;
                if (Number.isFinite(max)) q.max = max;
                if (Number.isFinite(step)) q.step = step;
                q.min_label = (el.querySelector('[data-type-section="slider"] [data-field="min_label"]')?.value || '').toString();
                q.max_label = (el.querySelector('[data-type-section="slider"] [data-field="max_label"]')?.value || '').toString();
            } else if (type === 'number') {
                const minRaw = el.querySelector('[data-type-section="number"] [data-field="min"]')?.value;
                const maxRaw = el.querySelector('[data-type-section="number"] [data-field="max"]')?.value;
                const stepRaw = el.querySelector('[data-type-section="number"] [data-field="step"]')?.value;
                const min = Number(minRaw);
                const max = Number(maxRaw);
                const step = Number(stepRaw);
                if (minRaw !== '' && Number.isFinite(min)) q.min = min;
                if (maxRaw !== '' && Number.isFinite(max)) q.max = max;
                if (Number.isFinite(step)) q.step = step;
                q.placeholder = (el.querySelector('[data-type-section="number"] [data-field="placeholder"]')?.value || '').toString();
            }

            questions.push(q);
        });

        return { title, instructions, submit_label, allow_empty_on_timeout, timeout_ms, questions };
    }

    generateParameterFormFromComponentDefinitions(component) {
        const type = (component?.type ?? '').toString();

        // Block editor uses component definitions (task-scoped defaults/options), but
        // visibility filtering depends on schema-level `blockTarget` metadata.
        const blockSchema = (type === 'block' && this.jsonBuilder?.schemaValidator)
            ? this.jsonBuilder.schemaValidator.getPluginSchema('block')
            : null;
        const blockTargetByParam = (blockSchema && blockSchema.parameters && typeof blockSchema.parameters === 'object')
            ? Object.fromEntries(
                Object.entries(blockSchema.parameters)
                    .map(([k, v]) => [k, (v && typeof v === 'object') ? v.blockTarget : undefined])
                    .filter(([, target]) => typeof target === 'string' && target.trim() !== '')
            )
            : {};

        const getBlockInnerType = (c) => {
            try {
                const inner = (c?.parameters && typeof c.parameters === 'object')
                    ? (c.parameters.block_component_type ?? c.block_component_type)
                    : c?.block_component_type;
                return (inner ?? '').toString().trim();
            } catch {
                return '';
            }
        };

        const inferTaskTypeOverrideForBlock = (c) => {
            const inner = (c?.parameters && typeof c.parameters === 'object')
                ? (c.parameters.block_component_type ?? c.block_component_type)
                : c?.block_component_type;

            const innerType = (inner ?? '').toString().trim();
            if (!innerType) return null;

            if (innerType.startsWith('rdm-')) return 'rdm';
            if (innerType === 'stroop-trial') return 'stroop';
            if (innerType === 'emotional-stroop-trial') return 'emotional-stroop';
            if (innerType === 'simon-trial') return 'simon';
            if (innerType === 'pvt-trial') return 'pvt';
            if (innerType === 'task-switching-trial') return 'task-switching';
            if (innerType === 'flanker-trial') return 'flanker';
            if (innerType === 'sart-trial') return 'sart';
            if (innerType === 'nback-block') return 'nback';
            if (innerType === 'gabor-trial' || innerType === 'gabor-quest' || innerType === 'gabor-learning') return 'gabor';
            if (innerType === 'continuous-image-presentation') return 'continuous-image';
            return null;
        };

        const taskTypeOverride = (type === 'block') ? inferTaskTypeOverrideForBlock(component) : null;

        const defs = (this.jsonBuilder && typeof this.jsonBuilder.getComponentDefinitions === 'function')
            ? this.jsonBuilder.getComponentDefinitions(taskTypeOverride ? { taskTypeOverride } : undefined)
            : [];

        const isDrtStart = (type === 'detection-response-task-start');
        const isoLockedFieldNames = new Set([
            'min_iti_ms',
            'max_iti_ms',
            'stimulus_duration_ms',
            'min_rt_ms',
            'max_rt_ms'
        ]);

        const overrideIso = (() => {
            try {
                if (component?.parameters && Object.prototype.hasOwnProperty.call(component.parameters, 'override_iso_standard')) {
                    return !!component.parameters.override_iso_standard;
                }
                if (Object.prototype.hasOwnProperty.call(component || {}, 'override_iso_standard')) {
                    return !!component.override_iso_standard;
                }
            } catch {
                // ignore
            }
            return false;
        })();

        const def = Array.isArray(defs)
            ? defs.find(d => d && (d.id === type || d.type === type))
            : null;

        const parameters = def && def.parameters && typeof def.parameters === 'object' ? def.parameters : null;
        if (!parameters || Object.keys(parameters).length === 0) {
            return '<p class="text-muted">No editable parameters for this component.</p>';
        }

        // Robustness: ensure the block type dropdown always reflects the actual block.
        // If the current value isn't in the option list, browsers will select the first option
        // (often `rdm-trial`), which then cascades into Preview using the wrong task.
        if (type === 'block' && parameters.block_component_type && typeof parameters.block_component_type === 'object') {
            const innerType = getBlockInnerType(component);

            const hasAnyKey = (obj, predicate) => {
                try {
                    if (!obj || typeof obj !== 'object') return false;
                    return Object.keys(obj).some(predicate);
                } catch {
                    return false;
                }
            };

            const paramKeyHint = (() => {
                const keys = Object.keys(parameters);
                if (keys.some(k => k.startsWith('emostroop_'))) return 'emotional-stroop';
                if (keys.some(k => k.startsWith('stroop_'))) return 'stroop';
                if (keys.some(k => k.startsWith('flanker_'))) return 'flanker';
                if (keys.some(k => k.startsWith('sart_'))) return 'sart';
                if (keys.some(k => k.startsWith('simon_'))) return 'simon';
                if (keys.some(k => k.startsWith('pvt_'))) return 'pvt';
                if (keys.some(k => k.startsWith('gabor_'))) return 'gabor';
                if (keys.some(k => k.startsWith('nback_'))) return 'nback';
                return null;
            })();

            const componentKeyHint = hasAnyKey(component?.parameters, (k) => k.startsWith('emostroop_'))
                ? 'emotional-stroop'
                : null;

            const hintTask = (componentKeyHint || paramKeyHint || taskTypeOverride);

            const genericOptions = ['html-button-response', 'html-keyboard-response', 'image-keyboard-response'];
            const baseOptions = (hintTask === 'flanker')
                ? ['flanker-trial']
                : (hintTask === 'nback')
                    ? ['nback-block']
                : (hintTask === 'sart')
                    ? ['sart-trial']
                : (hintTask === 'simon')
                    ? ['simon-trial']
                : (hintTask === 'pvt')
                    ? ['pvt-trial']
                : (hintTask === 'task-switching')
                    ? ['task-switching-trial']
                : (hintTask === 'gabor')
                    ? ['gabor-trial', 'gabor-quest', 'gabor-learning']
                : (hintTask === 'continuous-image')
                    ? ['continuous-image-presentation']
                : (hintTask === 'stroop')
                    ? ['stroop-trial']
                : (hintTask === 'emotional-stroop')
                    ? ['emotional-stroop-trial']
                : ['rdm-trial', 'rdm-practice', 'rdm-adaptive', 'rdm-dot-groups'];

            let options = Array.from(new Set([...(baseOptions || []), ...genericOptions]));
            if (innerType && !options.includes(innerType)) options = [innerType, ...options];

            const original = parameters.block_component_type;
            parameters.block_component_type = {
                ...original,
                options,
                default: innerType || original.default || options[0] || 'rdm-trial'
            };
        }

        let formHtml = '';
        for (const [paramName, paramDef] of Object.entries(parameters)) {
            let currentValue;

            if (component.parameters && Object.prototype.hasOwnProperty.call(component.parameters, paramName)) {
                currentValue = component.parameters[paramName];
            } else if (Object.prototype.hasOwnProperty.call(component, paramName)) {
                currentValue = component[paramName];
            } else {
                currentValue = (paramDef && typeof paramDef === 'object') ? paramDef.default : undefined;
            }

            const shouldDisable = isDrtStart && isoLockedFieldNames.has(paramName) && !overrideIso;
            const label = (isDrtStart && paramName === 'override_iso_standard')
                ? 'Override ISO standard'
                : this.formatParameterName(paramName);

            const helpText = (isDrtStart && paramName === 'override_iso_standard')
                ? '<div class="form-text">When unchecked, ISO timing/RT fields are locked to default values.</div>'
                : '';

            const blockTargetAttr = (type === 'block' && blockTargetByParam[paramName])
                ? ` data-block-target="${this.escapeHtmlAttr(String(blockTargetByParam[paramName]))}"`
                : '';

            formHtml += `
                <div class="mb-3" data-param-name="${this.escapeHtmlAttr(paramName)}"${blockTargetAttr}>
                    <label for="param_${this.escapeHtmlAttr(paramName)}" class="form-label">${label}</label>
                    ${this.generateParameterInputFromComponentDef(paramName, paramDef, currentValue, shouldDisable)}
                    ${helpText}
                </div>
            `;
        }

        return formHtml;
    }

    generateParameterInputFromComponentDef(paramName, paramDef, currentValue, shouldDisable = false) {
        const inputId = `param_${paramName}`;
        const def = (paramDef && typeof paramDef === 'object') ? paramDef : {};
        const t = (def.type ?? 'string').toString();

        const disabledAttr = shouldDisable ? 'disabled' : '';

        const safeVal = (currentValue === undefined || currentValue === null)
            ? (def.default ?? '')
            : currentValue;

        if (t === 'boolean') {
            return `
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="${this.escapeHtmlAttr(inputId)}" ${safeVal ? 'checked' : ''} ${disabledAttr}>
                </div>
            `;
        }

        if (t === 'select') {
            const options = Array.isArray(def.options) ? def.options : [];
            const v = (safeVal ?? '').toString();
            const optionsHtml = options
                .map(o => {
                    const ov = (o ?? '').toString();
                    return `<option value="${this.escapeHtmlAttr(ov)}" ${ov === v ? 'selected' : ''}>${this.escapeHtml(ov)}</option>`;
                })
                .join('');
            return `<select class="form-select" id="${this.escapeHtmlAttr(inputId)}" ${disabledAttr}>${optionsHtml}</select>`;
        }

        if (t === 'number') {
            const minAttr = (def.min !== undefined && def.min !== null) ? ` min="${this.escapeHtmlAttr(String(def.min))}"` : '';
            const maxAttr = (def.max !== undefined && def.max !== null) ? ` max="${this.escapeHtmlAttr(String(def.max))}"` : '';
            const stepAttr = (def.step !== undefined && def.step !== null) ? ` step="${this.escapeHtmlAttr(String(def.step))}"` : '';
            return `<input type="number" class="form-control" id="${this.escapeHtmlAttr(inputId)}" value="${this.escapeHtmlAttr(String(safeVal))}"${minAttr}${maxAttr}${stepAttr} ${disabledAttr}>`;
        }

        if (t === 'textarea') {
            const rows = Number.isFinite(Number(def.rows)) ? Math.max(2, Math.min(40, Number(def.rows))) : 6;
            return `<textarea class="form-control" id="${this.escapeHtmlAttr(inputId)}" rows="${this.escapeHtmlAttr(String(rows))}" ${disabledAttr}>${this.escapeHtml(String(safeVal))}</textarea>`;
        }

        if (t === 'COLOR') {
            const v = (safeVal ?? '').toString() || (def.default ?? '#ff3b3b');
            return `
                <div class="d-flex gap-2">
                    <input type="color" class="form-control form-control-color" id="${this.escapeHtmlAttr(inputId)}" value="${this.escapeHtmlAttr(v)}" ${disabledAttr}>
                    <input type="text" class="form-control" id="${this.escapeHtmlAttr(inputId)}_hex" value="${this.escapeHtmlAttr(v)}" placeholder="#RRGGBB" pattern="^#[0-9A-Fa-f]{6}$" ${disabledAttr}>
                </div>
            `;
        }

        return `<input type="text" class="form-control" id="${this.escapeHtmlAttr(inputId)}" value="${this.escapeHtmlAttr(String(safeVal))}" ${disabledAttr}>`;
    }

    escapeHtmlAttr(str) {
        return this.escapeHtml(str).replace(/\"/g, '&quot;');
    }

    escapeHtml(str) {
        return str
            .toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    generateParameterForm(component, schema) {
        if (!schema) {
            return '<p class="text-muted">No schema available for this component type.</p>';
        }

        let formHtml = '';
        const componentType = (component?.type ?? '').toString();
        const isSocNbackLikeSubtask = (componentType === 'soc-subtask-nback-like' || componentType === 'nback-like');
        const parameters = schema.parameters;

        for (const [paramName, paramDef] of Object.entries(parameters)) {
            // Priority order: component parameter → experiment default → schema default
            let currentValue;
            
            // Check for parameter in nested parameters object first, then flat structure, then defaults
            if (component.parameters && component.parameters.hasOwnProperty(paramName)) {
                currentValue = component.parameters[paramName];
            } else if (component.hasOwnProperty(paramName)) {
                currentValue = component[paramName];
            } else {
                // Check for experiment-wide default, fall back to schema default
                const experimentDefault = this.getExperimentDefault(paramName);
                currentValue = experimentDefault !== undefined ? experimentDefault : paramDef.default;
            }

            console.log(`Parameter ${paramName}:`, currentValue, 'from', component);
            
            // Check if this parameter should be disabled based on experiment type
            const isTrialBased = this.jsonBuilder.experimentType === 'trial-based';
            const isTransitionParam = (paramName === 'transition_duration' || paramName === 'transition_type');
            const isContinuousOnlyParam = (paramName === 'end_condition_on_response_mode');
            const shouldDisable = isTrialBased && (isTransitionParam || isContinuousOnlyParam);
            
            const responseGroup = (paramName === 'mouse_segments' || paramName === 'mouse_start_angle_deg' || paramName === 'mouse_selection_mode' || paramName === 'go_button')
                ? 'mouse'
                : (paramName === 'mouse_response_mode')
                    ? 'mouse'
                : (paramName === 'show_buttons' || paramName === 'nback_show_buttons')
                    ? 'mouse'
                : (paramName === 'response_keys' || paramName === 'go_key' || paramName === 'match_key' || paramName === 'nonmatch_key'
                    || paramName === 'nback_go_key' || paramName === 'nback_match_key' || paramName === 'nback_nonmatch_key')
                    ? 'keyboard'
                    : (paramName === 'choice_keys')
                        ? 'keyboard'
                    : (paramName === 'feedback_mode' || paramName === 'feedback_duration_ms')
                        ? 'feedback'
                    : (paramName === 'cue_border_mode' || paramName === 'cue_border_width' || paramName === 'cue_border_color' || paramName === 'response_target_group')
                        ? 'cue'
                        : (paramName === 'show_aperture_outline_mode' || paramName === 'aperture_outline_width' || paramName === 'aperture_outline_color')
                            ? 'apertureOutline'
                        : (paramName === 'group_speed_mode' || paramName === 'group_1_speed' || paramName === 'group_2_speed')
                            ? 'groupSpeed'
                            : '';

            const cueSubGroup = (paramName === 'cue_border_color') ? 'cueColor' : '';
            const feedbackSubGroup = (paramName === 'feedback_duration_ms') ? 'feedbackDuration' : '';

            const blockTargetAttr = paramDef.blockTarget ? `data-block-target="${paramDef.blockTarget}"` : '';

            // SOC N-back-like: only show relevant key fields for the selected response paradigm.
            // - Go/No-Go: show go_key
            // - 2AFC: show match_key + nonmatch_key
            let nbackParadigmAttr = '';
            if (isSocNbackLikeSubtask) {
                if (paramName === 'go_key') nbackParadigmAttr = 'data-nback-paradigm="go_nogo"';
                if (paramName === 'match_key' || paramName === 'nonmatch_key') nbackParadigmAttr = 'data-nback-paradigm="2afc"';
            }

            formHtml += `
                <div class="mb-3 ${shouldDisable ? 'parameter-disabled' : ''}" data-param-name="${paramName}" ${responseGroup ? `data-response-group="${responseGroup}"` : ''} ${cueSubGroup ? `data-cue-subgroup="${cueSubGroup}"` : ''} ${feedbackSubGroup ? `data-feedback-subgroup="${feedbackSubGroup}"` : ''} ${blockTargetAttr} ${nbackParadigmAttr}>
                    <label for="param_${paramName}" class="form-label ${shouldDisable ? 'text-muted' : ''}">
                        ${this.formatParameterName(paramName)}
                        ${paramDef.required ? '<span class="text-danger">*</span>' : ''}
                        ${shouldDisable ? '<small class="text-muted">(Not used in trial-based experiments)</small>' : ''}
                    </label>
                    ${this.generateParameterInput(paramName, paramDef, currentValue, shouldDisable)}
                    ${paramDef.description ? 
                        `<div class="form-text ${shouldDisable ? 'text-muted' : ''}">${paramDef.description}</div>` : ''}
                </div>
            `;
        }

        return formHtml;
    }

    generateParameterInput(paramName, paramDef, currentValue, shouldDisable = false) {
        const inputId = `param_${paramName}`;
        const disabledAttr = shouldDisable ? 'disabled' : '';
        const disabledClass = shouldDisable ? 'text-muted' : '';
        
        // Ensure currentValue is a primitive, not an object
        let displayValue = currentValue;
        if (typeof currentValue === 'object' && currentValue !== null) {
            // If it's an object, try to extract a meaningful value
            if (currentValue.hasOwnProperty('value')) {
                displayValue = currentValue.value;
            } else if (currentValue.hasOwnProperty('default')) {
                displayValue = currentValue.default;
            } else {
                // Fallback to schema default
                displayValue = paramDef.default;
            }
        }
        
        // Handle empty or undefined values
        if (displayValue === undefined || displayValue === null) {
            displayValue = paramDef.default || '';
        }
        
        // Handle different parameter types
        switch (paramDef.type) {
            case this.jsonBuilder.schemaValidator.parameterTypes.IMAGE: {
                const safeVal = (displayValue === undefined || displayValue === null) ? '' : String(displayValue);
                const helpId = `${inputId}__help`;
                const fileId = `${inputId}__file`;
                const previewId = `${inputId}__preview`;
                const clearId = `${inputId}__clear`;

                return `
                    <div class="d-flex flex-column gap-2">
                        <div class="input-group">
                            <span class="input-group-text">URL</span>
                            <input type="text" class="form-control ${disabledClass}" id="${inputId}" value="${this.escapeHtmlAttr(safeVal)}" ${disabledAttr} aria-describedby="${helpId}">
                        </div>

                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            <input type="file" class="form-control form-control-sm ${disabledClass}" id="${fileId}" accept="image/*" ${disabledAttr}
                                   data-psy-image-file="1" data-psy-image-param="${this.escapeHtmlAttr(String(paramName))}" style="max-width: 360px;">
                            <button type="button" class="btn btn-sm btn-outline-secondary" id="${clearId}" ${disabledAttr}
                                    data-psy-image-clear="1" data-psy-image-param="${this.escapeHtmlAttr(String(paramName))}">
                                Clear local file
                            </button>
                            <small class="text-muted" id="${helpId}">
                                Tip: choose a local file to preview; it is stored as <code>asset://...</code> until exported.
                            </small>
                        </div>

                        <div>
                            <div class="small text-muted mb-1">Preview</div>
                            <div class="border rounded p-2" style="background:#fff;">
                                <img id="${previewId}" alt="image preview" style="max-width: 100%; max-height: 320px; display:none;" />
                                <div class="text-muted" data-psy-image-empty="1" style="display:none;">No image selected.</div>
                            </div>
                        </div>
                    </div>
                `;
            }

            case this.jsonBuilder.schemaValidator.parameterTypes.AUDIO: {
                const safeVal = (displayValue === undefined || displayValue === null) ? '' : String(displayValue);
                const helpId = `${inputId}__help`;
                const fileId = `${inputId}__file`;
                const previewId = `${inputId}__preview`;
                const clearId = `${inputId}__clear`;

                return `
                    <div class="d-flex flex-column gap-2">
                        <div class="input-group">
                            <span class="input-group-text">URL</span>
                            <input type="text" class="form-control ${disabledClass}" id="${inputId}" value="${this.escapeHtmlAttr(safeVal)}" ${disabledAttr} aria-describedby="${helpId}">
                        </div>

                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            <input type="file" class="form-control form-control-sm ${disabledClass}" id="${fileId}" accept="audio/*" ${disabledAttr}
                                   data-psy-audio-file="1" data-psy-audio-param="${this.escapeHtmlAttr(String(paramName))}" style="max-width: 360px;">
                            <button type="button" class="btn btn-sm btn-outline-secondary" id="${clearId}" ${disabledAttr}
                                    data-psy-audio-clear="1" data-psy-audio-param="${this.escapeHtmlAttr(String(paramName))}">
                                Clear local file
                            </button>
                            <small class="text-muted" id="${helpId}">
                                Tip: choose a local file to preview; it is stored as <code>asset://...</code> until exported.
                            </small>
                        </div>

                        <div>
                            <div class="small text-muted mb-1">Preview</div>
                            <div class="border rounded p-2" style="background:#fff;">
                                <audio id="${previewId}" controls style="width: 100%; display:none;"></audio>
                                <div class="text-muted" data-psy-audio-empty="1" style="display:none;">No audio selected.</div>
                            </div>
                        </div>
                    </div>
                `;
            }

            case this.jsonBuilder.schemaValidator.parameterTypes.BOOL:
                return `
                    <div class="form-check form-switch">
                        <input class="form-check-input ${disabledClass}" type="checkbox" id="${inputId}" 
                               ${displayValue ? 'checked' : ''} ${disabledAttr}>
                        <label class="form-check-label" for="${inputId}">Enable</label>
                    </div>
                `;

            case this.jsonBuilder.schemaValidator.parameterTypes.SELECT:
                const options = paramDef.options || [];
                const blockTypeLabel = (v) => {
                    if (v === 'gabor-trial') return 'Gabor (fixed)';
                    if (v === 'gabor-quest') return 'Gabor (QUEST)';
                    if (v === 'gabor-learning') return 'Gabor (Learning)';
                    return v;
                };

                const optionsHtml = options.map(option => {
                    const label = (paramName === 'block_component_type') ? blockTypeLabel(option) : option;
                    return `<option value="${option}" ${displayValue === option ? 'selected' : ''}>${label}</option>`;
                }).join('');
                return `
                    <select class="form-select ${disabledClass}" id="${inputId}" ${disabledAttr}>
                        ${optionsHtml}
                    </select>
                `;

            case this.jsonBuilder.schemaValidator.parameterTypes.INT:
            case this.jsonBuilder.schemaValidator.parameterTypes.FLOAT:
                // Special-case: dot-group percentage sliders (0-100) for rdm-dot-groups
                if (paramName === 'group_1_percentage' || paramName === 'group_2_percentage') {
                    const safeValue = (displayValue === '' || displayValue === undefined || displayValue === null)
                        ? (paramDef.default || 50)
                        : displayValue;

                    return `
                        <div class="d-flex align-items-center gap-3">
                            <input type="range" class="form-range flex-grow-1 ${disabledClass}" id="${inputId}" 
                                   min="0" max="100" step="1" value="${safeValue}" ${disabledAttr}>
                            <span class="small text-muted" style="min-width: 3.5rem; text-align: right;">
                                <span id="${inputId}_value">${safeValue}</span>%
                            </span>
                        </div>
                    `;
                }

                return `
                    <input type="number" class="form-control ${disabledClass}" id="${inputId}" 
                           value="${displayValue}" ${disabledAttr}
                           ${paramDef.type === this.jsonBuilder.schemaValidator.parameterTypes.INT ? 'step="1"' : 'step="any"'}>
                `;

            case this.jsonBuilder.schemaValidator.parameterTypes.HTML_STRING:
                return `
                    <textarea class="form-control ${disabledClass}" id="${inputId}" rows="4" ${disabledAttr}>${displayValue}</textarea>
                `;

            case this.jsonBuilder.schemaValidator.parameterTypes.COLOR:
                const colorInputHtml = `
                    <div class="d-flex gap-2">
                        <input type="color" class="form-control form-control-color ${disabledClass}" id="${inputId}" 
                               value="${displayValue}" style="width: 60px;" ${disabledAttr}>
                        <input type="text" class="form-control ${disabledClass}" id="${inputId}_hex" 
                               value="${displayValue}" placeholder="#FFFFFF"
                               pattern="^#[0-9A-Fa-f]{6}$" ${disabledAttr}>
                    </div>
                `;
                
                // Set up event listeners after the HTML is inserted
                setTimeout(() => {
                    const colorInput = document.getElementById(inputId);
                    const hexInput = document.getElementById(inputId + '_hex');
                    
                    if (colorInput && hexInput) {
                        colorInput.addEventListener('input', function() {
                            hexInput.value = this.value.toUpperCase();
                        });
                        
                        hexInput.addEventListener('input', function() {
                            if (this.value.match(/^#[0-9A-Fa-f]{6}$/)) {
                                colorInput.value = this.value;
                            }
                        });
                        
                        hexInput.addEventListener('blur', function() {
                            if (!this.value.match(/^#[0-9A-Fa-f]{6}$/)) {
                                this.value = colorInput.value.toUpperCase();
                            }
                        });
                    }
                }, 0);
                
                return colorInputHtml;

            case this.jsonBuilder.schemaValidator.parameterTypes.STRING:
            default:
                return `
                    <input type="text" class="form-control ${disabledClass}" id="${inputId}" value="${displayValue}" ${disabledAttr}>
                `;
        }
    }

    formatParameterName(paramName) {
        return paramName.replace(/_/g, ' ')
                       .replace(/\b\w/g, l => l.toUpperCase());
    }

    setupParameterFormListeners(formContainer, component) {
        // Setup save button listener
        const saveBtn = document.getElementById('saveParametersBtn');
        if (saveBtn) {
            saveBtn.onclick = () => {
                this.saveComponentParameters();
            };
        }

        // Emotional Stroop Block: hide list-3 fields when count = 2.
        const emostroopCountEl = formContainer.querySelector('#param_emostroop_word_list_count');
        const updateEmostroopWordListVisibility = () => {
            if (!emostroopCountEl) return;
            const count = Number.parseInt((emostroopCountEl.value ?? '2').toString(), 10);
            const show3 = (Number.isFinite(count) ? count : 2) >= 3;

            ['emostroop_word_list_3_label', 'emostroop_word_list_3_words'].forEach((paramName) => {
                const row = formContainer.querySelector(`[data-param-name="${paramName}"]`);
                if (!row) return;
                row.style.display = show3 ? '' : 'none';
                row.querySelectorAll('input, select, textarea').forEach((el) => {
                    el.disabled = !show3;
                });
            });
        };

        if (emostroopCountEl) {
            emostroopCountEl.addEventListener('change', updateEmostroopWordListVisibility);
            updateEmostroopWordListVisibility();
        }

        // Response override conditional fields (per-component)
        const responseDeviceEl = formContainer.querySelector('#param_response_device');
        const updateResponseVisibility = () => {
            const device = responseDeviceEl ? responseDeviceEl.value : 'inherit';

            // Mouse-only fields
            formContainer.querySelectorAll('[data-response-group="mouse"]').forEach(el => {
                const show = (device === 'mouse');
                el.style.display = show ? '' : 'none';
                el.querySelectorAll('input, select, textarea').forEach(i => {
                    i.disabled = !show;
                });
            });

            // Keyboard-only fields (Response Keys)
            formContainer.querySelectorAll('[data-response-group="keyboard"]').forEach(el => {
                const show = (device === 'keyboard');
                el.style.display = show ? '' : 'none';
                el.querySelectorAll('input, select, textarea').forEach(i => {
                    i.disabled = !show;
                });
            });
        };

        if (responseDeviceEl) {
            responseDeviceEl.addEventListener('change', updateResponseVisibility);
            updateResponseVisibility();
        }

        // N-back Block generator: response override conditional fields
        const nbackResponseDeviceEl = formContainer.querySelector('#param_nback_response_device');
        const updateNbackResponseVisibility = () => {
            if (!nbackResponseDeviceEl) return;
            const deviceRaw = (nbackResponseDeviceEl.value || 'inherit').toString().trim().toLowerCase();
            const effectiveDevice = (deviceRaw === 'inherit')
                ? ((this.jsonBuilder.getCurrentNbackDefaults?.()?.nback_response_device || 'keyboard').toString().trim().toLowerCase())
                : deviceRaw;

            // Mouse-only fields
            formContainer.querySelectorAll('[data-response-group="mouse"]').forEach(el => {
                const show = (effectiveDevice === 'mouse') && (deviceRaw !== 'inherit');
                el.style.display = show ? '' : 'none';
                el.querySelectorAll('input, select, textarea').forEach(i => {
                    i.disabled = !show;
                });
            });

            // Keyboard-only fields
            formContainer.querySelectorAll('[data-response-group="keyboard"]').forEach(el => {
                const show = (effectiveDevice === 'keyboard') && (deviceRaw !== 'inherit');
                el.style.display = show ? '' : 'none';
                el.querySelectorAll('input, select, textarea').forEach(i => {
                    i.disabled = !show;
                });
            });
        };

        if (nbackResponseDeviceEl) {
            nbackResponseDeviceEl.addEventListener('change', updateNbackResponseVisibility);
            updateNbackResponseVisibility();
        }

        // N-back: template HTML only relevant when render_mode/custom_html
        const renderModeEl = formContainer.querySelector('#param_render_mode');
        const updateRenderModeVisibility = () => {
            if (!renderModeEl) return;
            const mode = (renderModeEl.value || 'token').toString().trim().toLowerCase();
            const templateGroup = formContainer.querySelector('[data-param-name="stimulus_template_html"]');
            if (!templateGroup) return;
            const show = (mode === 'custom_html');
            templateGroup.style.display = show ? '' : 'none';
            templateGroup.querySelectorAll('input, select, textarea').forEach(i => {
                i.disabled = !show;
            });
        };

        if (renderModeEl) {
            renderModeEl.addEventListener('change', updateRenderModeVisibility);
            updateRenderModeVisibility();
        }

        const nbackRenderModeEl = formContainer.querySelector('#param_nback_render_mode');
        const updateNbackRenderModeVisibility = () => {
            if (!nbackRenderModeEl) return;
            const mode = (nbackRenderModeEl.value || 'token').toString().trim().toLowerCase();
            const templateGroup = formContainer.querySelector('[data-param-name="nback_stimulus_template_html"]');
            if (!templateGroup) return;
            const show = (mode === 'custom_html');
            templateGroup.style.display = show ? '' : 'none';
            templateGroup.querySelectorAll('input, select, textarea').forEach(i => {
                i.disabled = !show;
            });
        };

        if (nbackRenderModeEl) {
            nbackRenderModeEl.addEventListener('change', updateNbackRenderModeVisibility);
            updateNbackRenderModeVisibility();
        }

        // Block length clamping: blocks cannot exceed experiment length.
        const blockLenEl = formContainer.querySelector('#param_block_length');
        if (blockLenEl && component && component.type === 'block') {
            const cap = this.jsonBuilder.getExperimentWideLengthCapForBlocks?.();
            if (Number.isFinite(cap) && cap > 0) {
                try {
                    blockLenEl.max = String(cap);
                } catch {
                    // ignore
                }

                const clamp = () => {
                    const v = Number.parseInt(blockLenEl.value || '', 10);
                    if (!Number.isFinite(v)) return;
                    if (v > cap) blockLenEl.value = String(cap);
                    if (v < 1) blockLenEl.value = '1';
                };

                blockLenEl.addEventListener('input', clamp);
                blockLenEl.addEventListener('change', clamp);
                clamp();
            }
        }

        // SOC N-back-like: show only the key fields relevant to the selected response paradigm.
        const nbackParadigmEl = formContainer.querySelector('#param_response_paradigm');
        const updateNbackKeyVisibility = () => {
            if (!nbackParadigmEl) return;
            const paradigmRaw = (nbackParadigmEl.value || 'go_nogo').toString().trim().toLowerCase();
            const paradigm = (paradigmRaw === '2afc') ? '2afc' : 'go_nogo';

            formContainer.querySelectorAll('[data-nback-paradigm]').forEach(el => {
                const want = (el.getAttribute('data-nback-paradigm') || '').toString().trim().toLowerCase();
                const show = (want === paradigm);
                el.style.display = show ? '' : 'none';
                el.querySelectorAll('input, select, textarea').forEach(i => {
                    i.disabled = !show;
                });
            });
        };

        if (nbackParadigmEl) {
            nbackParadigmEl.addEventListener('change', updateNbackKeyVisibility);
            updateNbackKeyVisibility();
        }

        // Feedback conditional fields (per-component / per-block)
        const feedbackModeEl = formContainer.querySelector('#param_feedback_mode');
        const updateFeedbackVisibility = () => {
            const mode = feedbackModeEl ? feedbackModeEl.value : 'inherit';

            // Duration only relevant when explicitly enabled (not inherit/off)
            formContainer.querySelectorAll('[data-feedback-subgroup="feedbackDuration"]').forEach(el => {
                const show = (mode !== 'inherit' && mode !== 'off');
                el.style.display = show ? '' : 'none';
                el.querySelectorAll('input, select, textarea').forEach(i => {
                    i.disabled = !show;
                });
            });
        };

        if (feedbackModeEl) {
            feedbackModeEl.addEventListener('change', updateFeedbackVisibility);
            updateFeedbackVisibility();
        }

        // Cue border conditional fields (dot-groups)
        const responseTargetEl = formContainer.querySelector('#param_response_target_group');
        const cueModeEl = formContainer.querySelector('#param_cue_border_mode');

        const updateCueVisibility = () => {
            const target = responseTargetEl ? responseTargetEl.value : 'none';
            const cueMode = cueModeEl ? cueModeEl.value : 'off';

            // Hide all cue controls except target selector if none selected
            formContainer.querySelectorAll('[data-response-group="cue"]').forEach(el => {
                const paramName = el.getAttribute('data-param-name');
                if (paramName === 'response_target_group') {
                    el.style.display = '';
                    el.querySelectorAll('input, select, textarea').forEach(i => {
                        i.disabled = false;
                    });
                } else {
                    const show = (target && target !== 'none');
                    el.style.display = show ? '' : 'none';
                    el.querySelectorAll('input, select, textarea').forEach(i => {
                        i.disabled = !show;
                    });
                }
            });

            // Only show custom color when cueMode = custom
            formContainer.querySelectorAll('[data-cue-subgroup="cueColor"]').forEach(el => {
                const show = (target && target !== 'none' && cueMode === 'custom');
                el.style.display = show ? '' : 'none';
                el.querySelectorAll('input, select, textarea').forEach(i => {
                    i.disabled = !show;
                });
            });
        };

        if (responseTargetEl) {
            responseTargetEl.addEventListener('change', updateCueVisibility);
        }
        if (cueModeEl) {
            cueModeEl.addEventListener('change', updateCueVisibility);
        }
        if (responseTargetEl || cueModeEl) {
            updateCueVisibility();
        }

        // Dot-groups group-speed conditional fields
        const groupSpeedModeEl = formContainer.querySelector('#param_group_speed_mode');
        const updateGroupSpeedVisibility = () => {
            const mode = groupSpeedModeEl ? groupSpeedModeEl.value : 'shared';
            formContainer.querySelectorAll('[data-response-group="groupSpeed"]').forEach(el => {
                const paramName = el.getAttribute('data-param-name');
                if (paramName === 'group_speed_mode') {
                    el.style.display = '';
                } else {
                    el.style.display = (mode === 'per-group') ? '' : 'none';
                }
            });
        };

        if (groupSpeedModeEl) {
            groupSpeedModeEl.addEventListener('change', updateGroupSpeedVisibility);
            updateGroupSpeedVisibility();
        }

        // Aperture outline overrides: only enable width/color when mode is explicit true/false.
        const outlineModeEl = formContainer.querySelector('#param_show_aperture_outline_mode');
        const updateOutlineVisibility = () => {
            const mode = (outlineModeEl ? outlineModeEl.value : 'inherit').toString().trim().toLowerCase();
            const showDetail = (mode === 'true' || mode === 'false');

            ['aperture_outline_width', 'aperture_outline_color'].forEach(p => {
                const row = formContainer.querySelector(`[data-param-name="${p}"]`);
                if (!row) return;
                row.style.display = showDetail ? '' : 'none';
                row.querySelectorAll('input, select, textarea').forEach(i => {
                    i.disabled = !showDetail;
                });
            });
        };

        if (outlineModeEl) {
            outlineModeEl.addEventListener('change', updateOutlineVisibility);
            updateOutlineVisibility();
        }

        // Dot-groups percentage coupling: keep group_1 + group_2 = 100
        const g1El = formContainer.querySelector('#param_group_1_percentage');
        const g2El = formContainer.querySelector('#param_group_2_percentage');
        const g1ValEl = formContainer.querySelector('#param_group_1_percentage_value');
        const g2ValEl = formContainer.querySelector('#param_group_2_percentage_value');

        if (g1El && g2El) {
            let syncing = false;

            const clamp01 = (n) => Math.max(0, Math.min(100, n));
            const updateLabels = () => {
                if (g1ValEl) g1ValEl.textContent = String(g1El.value);
                if (g2ValEl) g2ValEl.textContent = String(g2El.value);
            };

            const syncFromG1 = () => {
                if (syncing) return;
                syncing = true;
                const g1 = clamp01(parseInt(g1El.value || '0'));
                const g2 = 100 - g1;
                g1El.value = String(g1);
                g2El.value = String(g2);
                updateLabels();
                syncing = false;
            };

            const syncFromG2 = () => {
                if (syncing) return;
                syncing = true;
                const g2 = clamp01(parseInt(g2El.value || '0'));
                const g1 = 100 - g2;
                g2El.value = String(g2);
                g1El.value = String(g1);
                updateLabels();
                syncing = false;
            };

            g1El.addEventListener('input', syncFromG1);
            g2El.addEventListener('input', syncFromG2);
            syncFromG1();
        }

        // Block: show only fields matching selected block component type
        const blockTypeEl = formContainer.querySelector('#param_block_component_type');

        // Task-scoped block types (keep the library constrained per task)
        if (blockTypeEl) {
            const currentTaskType = (document.getElementById('taskType')?.value || 'rdm').toString().trim();
            const isEmostroopBlock = !!formContainer.querySelector('#param_emostroop_word_list_count');

            // Try to recover the current inner type even if the edited component uses a legacy nested shape.
            const desiredValue = (() => {
                try {
                    const direct = component?.parameters?.block_component_type ?? component?.block_component_type;
                    if (direct !== undefined && direct !== null && String(direct).trim() !== '') return String(direct).trim();
                    const nested = component?.parameters?.parameters?.block_component_type;
                    if (nested !== undefined && nested !== null && String(nested).trim() !== '') return String(nested).trim();
                } catch {
                    // ignore
                }
                return '';
            })();

            const baseAllowed = (currentTaskType === 'flanker')
                ? ['flanker-trial']
                : (currentTaskType === 'sart')
                    ? ['sart-trial']
                    : (currentTaskType === 'simon')
                        ? ['simon-trial']
                    : (currentTaskType === 'pvt')
                        ? ['pvt-trial']
                    : (currentTaskType === 'task-switching')
                        ? ['task-switching-trial']
                    : (currentTaskType === 'stroop')
                        ? ['stroop-trial']
                    : (currentTaskType === 'emotional-stroop' || isEmostroopBlock)
                        ? ['emotional-stroop-trial']
                    : (currentTaskType === 'nback')
                        ? ['nback-block']
                    : (currentTaskType === 'gabor')
                        ? ['gabor-trial', 'gabor-quest', 'gabor-learning']
                    : (currentTaskType === 'continuous-image')
                        ? ['continuous-image-presentation']
                    : ['rdm-trial', 'rdm-practice', 'rdm-adaptive', 'rdm-dot-groups'];

            // Always include generic jsPsych options for Block inner trials.
            // (These are schema-driven elsewhere; this allowlist rebuild must not strip them.)
            const generic = ['html-button-response', 'html-keyboard-response', 'image-keyboard-response'];
            let allowed = Array.from(new Set([...(baseAllowed || []), ...generic]));

            // Never drop the current value (prevents silent fallback to the first option).
            const currentValue = blockTypeEl.value;
            const keepValue = (desiredValue || currentValue || '').toString().trim();
            if (keepValue && !allowed.includes(keepValue)) allowed = [keepValue, ...allowed];

            // Rebuild options if the schema contains extra entries.
            blockTypeEl.innerHTML = allowed
                .map(v => `<option value="${v}">${v}</option>`)
                .join('');

            if (desiredValue && allowed.includes(desiredValue)) {
                blockTypeEl.value = desiredValue;
            } else if (allowed.includes(currentValue)) {
                blockTypeEl.value = currentValue;
            } else {
                blockTypeEl.value = allowed[0] || currentValue;
            }
        }

        const setParamVisible = (paramName, visible) => {
            const row = formContainer.querySelector(`[data-param-name="${paramName}"]`);
            if (!row) return;
            row.classList.toggle('d-none', !visible);
            row.style.display = visible ? '' : 'none';
            row.querySelectorAll('input, select, textarea').forEach(i => {
                i.disabled = !visible;
            });
        };

        const updateGaborTrialKeyVisibility = () => {
            if (!component || component.type !== 'gabor-trial') return;
            const taskEl = formContainer.querySelector('#param_response_task');
            const task = (taskEl ? taskEl.value : 'discriminate_tilt').toString();

            const showYesNo = (task === 'detect_target');
            setParamVisible('left_key', !showYesNo);
            setParamVisible('right_key', !showYesNo);
            setParamVisible('yes_key', showYesNo);
            setParamVisible('no_key', showYesNo);
        };

        const updateGaborBlockKeyVisibility = () => {
            if (!blockTypeEl) return;
            const selected = blockTypeEl.value;
            if (selected !== 'gabor-trial' && selected !== 'gabor-quest' && selected !== 'gabor-learning') return;

            const taskEl = formContainer.querySelector('#param_gabor_response_task');
            const task = (taskEl ? taskEl.value : 'discriminate_tilt').toString();

            const showYesNo = (task === 'detect_target');
            setParamVisible('gabor_left_key', !showYesNo);
            setParamVisible('gabor_right_key', !showYesNo);
            setParamVisible('gabor_yes_key', showYesNo);
            setParamVisible('gabor_no_key', showYesNo);
        };

        const updateGaborQuestVisibility = () => {
            if (!blockTypeEl) return;
            const selected = blockTypeEl.value;
            const questParams = [
                'gabor_quest_parameter',
                'gabor_quest_target_performance',
                'gabor_quest_start_value',
                'gabor_quest_start_sd',
                'gabor_quest_beta',
                'gabor_quest_delta',
                'gabor_quest_gamma',
                'gabor_quest_min_value',
                'gabor_quest_max_value',
                'gabor_quest_trials_coarse',
                'gabor_quest_trials_fine',
                'gabor_quest_staircase_per_location',
                'gabor_quest_store_location_threshold'
            ];
            const learningParams = [
                'gabor_learning_streak_length',
                'gabor_learning_target_accuracy',
                'gabor_learning_max_trials',
                'gabor_show_feedback',
                'gabor_feedback_duration_ms'
            ];
            if (selected !== 'gabor-trial' && selected !== 'gabor-quest' && selected !== 'gabor-learning') {
                // Ensure all hidden when switching to a non-Gabor block type
                questParams.forEach(p => setParamVisible(p, false));
                learningParams.forEach(p => setParamVisible(p, false));
                return;
            }

            // Learning mode: show learning params, hide QUEST params
            if (selected === 'gabor-learning') {
                questParams.forEach(p => setParamVisible(p, false));
                learningParams.forEach(p => setParamVisible(p, true));
                return;
            }

            // gabor-trial / gabor-quest: hide learning params, show QUEST when mode = quest
            learningParams.forEach(p => setParamVisible(p, false));

            const modeEl = formContainer.querySelector('#param_gabor_adaptive_mode');
            // If the user picked the QUEST block type, force quest mode so the fields appear.
            if (selected === 'gabor-quest' && modeEl) {
                modeEl.value = 'quest';
            }

            const mode = (modeEl ? modeEl.value : 'none').toString();
            const showQuest = (mode === 'quest');

            questParams.forEach(p => setParamVisible(p, showQuest));
        };

        const updateGaborCueVisibility = () => {
            if (!blockTypeEl) return;
            const selected = blockTypeEl.value;

            // If switching away from Gabor, ensure these are hidden.
            if (selected !== 'gabor-trial' && selected !== 'gabor-quest' && selected !== 'gabor-learning') {
                [
                    'gabor_spatial_cue_options',
                    'gabor_spatial_cue_probability',
                    'gabor_spatial_cue_validity_probability',
                    'gabor_left_value_options',
                    'gabor_right_value_options',
                    'gabor_value_cue_probability',
                    'gabor_value_target_value',
                    'gabor_reward_availability_high',
                    'gabor_reward_availability_low',
                    'gabor_reward_availability_neutral'
                ].forEach(p => setParamVisible(p, false));
                return;
            }

            const spatialEnabledEl = formContainer.querySelector('#param_gabor_spatial_cue_enabled');
            const spatialEnabled = spatialEnabledEl ? !!spatialEnabledEl.checked : true;
            if (!spatialEnabled) {
                const optsEl = formContainer.querySelector('#param_gabor_spatial_cue_options');
                const probEl = formContainer.querySelector('#param_gabor_spatial_cue_probability');
                if (optsEl) optsEl.value = 'none,left,right,both';
                if (probEl) probEl.value = '1';
            }
            setParamVisible('gabor_spatial_cue_options', spatialEnabled);
            setParamVisible('gabor_spatial_cue_probability', spatialEnabled);
            setParamVisible('gabor_spatial_cue_validity_probability', spatialEnabled);

            const valueEnabledEl = formContainer.querySelector('#param_gabor_value_cue_enabled');
            const valueEnabled = valueEnabledEl ? !!valueEnabledEl.checked : true;
            if (!valueEnabled) {
                const lvEl = formContainer.querySelector('#param_gabor_left_value_options');
                const rvEl = formContainer.querySelector('#param_gabor_right_value_options');
                const probEl = formContainer.querySelector('#param_gabor_value_cue_probability');
                if (lvEl) lvEl.value = 'neutral,high,low';
                if (rvEl) rvEl.value = 'neutral,high,low';
                if (probEl) probEl.value = '1';
            }
            setParamVisible('gabor_left_value_options', valueEnabled);
            setParamVisible('gabor_right_value_options', valueEnabled);
            setParamVisible('gabor_value_cue_probability', valueEnabled);
            setParamVisible('gabor_value_target_value', valueEnabled);
            setParamVisible('gabor_reward_availability_high', valueEnabled);
            setParamVisible('gabor_reward_availability_low', valueEnabled);
            setParamVisible('gabor_reward_availability_neutral', valueEnabled);
        };

        const updateTaskSwitchingBlockVisibility = () => {
            if (!blockTypeEl) return;
            const selected = blockTypeEl.value;

            const allTsFields = [
                'ts_trial_type',
                'ts_single_task_index',
                'ts_cue_type',
                'ts_task_1_position',
                'ts_task_2_position',
                'ts_task_1_color_hex',
                'ts_task_2_color_hex',
                'ts_task_1_cue_text',
                'ts_task_2_cue_text',
                'ts_cue_font_size_px',
                'ts_cue_duration_ms',
                'ts_cue_gap_ms',
                'ts_cue_color_hex',
                'ts_stimulus_position',
                'ts_stimulus_color_hex',
                'ts_border_enabled',
                'ts_left_key',
                'ts_right_key',
                'ts_stimulus_duration_min',
                'ts_stimulus_duration_max',
                'ts_trial_duration_min',
                'ts_trial_duration_max',
                'ts_iti_min',
                'ts_iti_max'
            ];

            const isTs = selected === 'task-switching-trial';
            allTsFields.forEach(p => setParamVisible(p, isTs));
            if (!isTs) return;

            const trialTypeEl = formContainer.querySelector('#param_ts_trial_type');
            const trialType = (trialTypeEl ? trialTypeEl.value : 'switch').toString().trim().toLowerCase();
            setParamVisible('ts_single_task_index', trialType === 'single');

            const cueTypeEl = formContainer.querySelector('#param_ts_cue_type');
            const cueType = (cueTypeEl ? cueTypeEl.value : 'explicit').toString().trim().toLowerCase();

            const showPosition = cueType === 'position';
            const showColor = cueType === 'color';
            const showExplicit = cueType === 'explicit';

            setParamVisible('ts_task_1_position', showPosition);
            setParamVisible('ts_task_2_position', showPosition);

            setParamVisible('ts_task_1_color_hex', showColor);
            setParamVisible('ts_task_2_color_hex', showColor);

            setParamVisible('ts_task_1_cue_text', showExplicit);
            setParamVisible('ts_task_2_cue_text', showExplicit);
            setParamVisible('ts_cue_font_size_px', showExplicit);
            setParamVisible('ts_cue_duration_ms', showExplicit);
            setParamVisible('ts_cue_gap_ms', showExplicit);
            setParamVisible('ts_cue_color_hex', showExplicit);

            // In position cueing, task_*_position controls location.
            setParamVisible('ts_stimulus_position', !showPosition);

            // In color cueing, task colors control stimulus color.
            setParamVisible('ts_stimulus_color_hex', !showColor);
        };

        const updateBlockVisibility = () => {
            if (!blockTypeEl) return;
            const selected = blockTypeEl.value;

            formContainer.querySelectorAll('[data-block-target]').forEach(el => {
                const target = el.getAttribute('data-block-target');
                const matches = (rawTarget, selectedValue) => {
                    if (!rawTarget) return false;
                    const parts = rawTarget
                        .split(',')
                        .map(s => s.trim())
                        .filter(Boolean);

                    for (const p of parts) {
                        if (p.endsWith('*')) {
                            const prefix = p.slice(0, -1);
                            if (selectedValue.startsWith(prefix)) return true;
                        } else if (p === selectedValue) {
                            return true;
                        }
                    }
                    return false;
                };

                const show = matches(target, selected);
                el.style.display = show ? '' : 'none';
                el.querySelectorAll('input, select, textarea').forEach(i => {
                    i.disabled = !show;
                });
            });

            // Flanker block: show direction options only for arrow stimuli.
            if (selected === 'flanker-trial') {
                const stimTypeEl = formContainer.querySelector('#param_flanker_stimulus_type');
                const stimTypeRaw = (stimTypeEl ? stimTypeEl.value : 'arrows');
                const stimType = (stimTypeRaw ?? 'arrows').toString().trim().toLowerCase();
                const isArrows = (stimType === '' || stimType === 'arrows');

                setParamVisible('flanker_target_direction_options', isArrows);
                setParamVisible('flanker_target_stimulus_options', !isArrows);
                setParamVisible('flanker_distractor_stimulus_options', !isArrows);
                setParamVisible('flanker_neutral_stimulus_options', !isArrows);
            }

            // Gabor block: show the correct key fields based on response task.
            if (selected === 'gabor-trial' || selected === 'gabor-quest' || selected === 'gabor-learning') {
                updateGaborBlockKeyVisibility();
                updateGaborQuestVisibility();
                updateGaborCueVisibility();
            }

            // Task Switching block: cue + trial type conditional fields.
            updateTaskSwitchingBlockVisibility();

            // Stroop block: hide keyboard-only fields when mouse is effective, and
            // toggle between color-naming (choice keys) vs congruency (two keys).
            if (selected === 'stroop-trial') {
                updateStroopBlockResponseVisibility();
            }
        };

        const updateStroopBlockResponseVisibility = () => {
            if (!blockTypeEl) return;
            const selected = blockTypeEl.value;
            if (selected !== 'stroop-trial') return;

            const deviceEl = formContainer.querySelector('#param_stroop_response_device');
            const modeEl = formContainer.querySelector('#param_stroop_response_mode');

            const defaultDevice = (document.getElementById('stroopDefaultResponseDevice')?.value || 'keyboard').toString();
            const defaultMode = (document.getElementById('stroopDefaultResponseMode')?.value || 'color_naming').toString();

            const rawDevice = (deviceEl ? deviceEl.value : 'inherit').toString();
            const rawMode = (modeEl ? modeEl.value : 'inherit').toString();

            const effectiveDevice = (rawDevice === 'inherit' || rawDevice === '') ? defaultDevice : rawDevice;
            const effectiveMode = (rawMode === 'inherit' || rawMode === '') ? defaultMode : rawMode;

            const isMouse = effectiveDevice === 'mouse';
            const isCongruency = effectiveMode === 'congruency';

            // Mouse: no keyboard mappings.
            if (isMouse) {
                setParamVisible('stroop_choice_keys', false);
                setParamVisible('stroop_congruent_key', false);
                setParamVisible('stroop_incongruent_key', false);
                return;
            }

            // Keyboard: show only the relevant mapping fields.
            if (isCongruency) {
                setParamVisible('stroop_choice_keys', false);
                setParamVisible('stroop_congruent_key', true);
                setParamVisible('stroop_incongruent_key', true);
            } else {
                setParamVisible('stroop_choice_keys', true);
                setParamVisible('stroop_congruent_key', false);
                setParamVisible('stroop_incongruent_key', false);
            }
        };

        if (blockTypeEl) {
            blockTypeEl.addEventListener('change', updateBlockVisibility);
            updateBlockVisibility();

            // Task Switching block: cue/trial-type changes should update visibility.
            const tsTrialTypeEl = formContainer.querySelector('#param_ts_trial_type');
            if (tsTrialTypeEl) {
                tsTrialTypeEl.addEventListener('change', updateTaskSwitchingBlockVisibility);
            }
            const tsCueTypeEl = formContainer.querySelector('#param_ts_cue_type');
            if (tsCueTypeEl) {
                tsCueTypeEl.addEventListener('change', updateTaskSwitchingBlockVisibility);
            }
            updateTaskSwitchingBlockVisibility();

            // When editing a Flanker block, stimulus type changes should re-evaluate visibility.
            const stimTypeEl = formContainer.querySelector('#param_flanker_stimulus_type');
            if (stimTypeEl) {
                stimTypeEl.addEventListener('change', updateBlockVisibility);
            }

            // Gabor block: response task changes should re-evaluate key visibility.
            const gaborTaskEl = formContainer.querySelector('#param_gabor_response_task');
            if (gaborTaskEl) {
                gaborTaskEl.addEventListener('change', updateGaborBlockKeyVisibility);
                updateGaborBlockKeyVisibility();
            }

            // Gabor block: adaptive mode changes should toggle QUEST fields.
            const gaborAdaptiveEl = formContainer.querySelector('#param_gabor_adaptive_mode');
            if (gaborAdaptiveEl) {
                gaborAdaptiveEl.addEventListener('change', updateGaborQuestVisibility);
                updateGaborQuestVisibility();
            }

            // Gabor block: cue-enabled toggles should show/hide their detail controls.
            const spatialCueEnabledEl = formContainer.querySelector('#param_gabor_spatial_cue_enabled');
            if (spatialCueEnabledEl) {
                spatialCueEnabledEl.addEventListener('change', updateGaborCueVisibility);
            }
            const valueCueEnabledEl = formContainer.querySelector('#param_gabor_value_cue_enabled');
            if (valueCueEnabledEl) {
                valueCueEnabledEl.addEventListener('change', updateGaborCueVisibility);
            }
            updateGaborCueVisibility();

            // Stroop block: response device/mode should update keyboard field visibility.
            const stroopDeviceEl = formContainer.querySelector('#param_stroop_response_device');
            if (stroopDeviceEl) {
                stroopDeviceEl.addEventListener('change', updateStroopBlockResponseVisibility);
            }
            const stroopModeEl = formContainer.querySelector('#param_stroop_response_mode');
            if (stroopModeEl) {
                stroopModeEl.addEventListener('change', updateStroopBlockResponseVisibility);
            }
            updateStroopBlockResponseVisibility();
        }

        // Continuous Image Presentation (Block helper UI)
        try {
            const isCipBlock = () => {
                if (!blockTypeEl) return false;
                const selected = (blockTypeEl.value || '').toString().trim();
                return selected === 'continuous-image-presentation';
            };

            const hideButPersist = (paramName, hidden) => {
                const row = formContainer.querySelector(`[data-param-name="${paramName}"]`);
                if (!row) return;
                row.classList.toggle('d-none', !!hidden);
                // Do NOT disable: hidden fields must still be persisted by saveComponentParameters.
                row.style.display = hidden ? 'none' : '';
            };

            const stripExt = (filename) => {
                const s = (filename ?? '').toString();
                const i = s.lastIndexOf('.');
                return (i > 0) ? s.slice(0, i) : s;
            };

            const isImageFilename = (name) => {
                const s = (name ?? '').toString().trim().toLowerCase();
                return s.endsWith('.png') || s.endsWith('.jpg') || s.endsWith('.jpeg') || s.endsWith('.gif') || s.endsWith('.webp');
            };

            const isCipTransitionSpriteFilename = (name) => {
                const s = (name ?? '').toString().trim().toLowerCase();
                if (!s.endsWith('.png')) return false;
                // Transition sprites are generated as: <base>__cip_<maskKey>_(m2i|i2m).png
                return /__cip_[a-z0-9_-]+_(m2i|i2m)\.png$/i.test(s);
            };

            const parseLines = (raw) => (raw ?? '')
                .toString()
                .split(/\r?\n/g)
                .map(x => x.trim())
                .filter(Boolean);

            const toPngBlob = (canvas) => new Promise((resolve, reject) => {
                try {
                    canvas.toBlob((blob) => {
                        if (!blob) reject(new Error('Failed to encode PNG')); else resolve(blob);
                    }, 'image/png');
                } catch (e) {
                    reject(e);
                }
            });

            const loadImageBitmap = async (url) => {
                const res = await fetch(url, { cache: 'no-store' });
                if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`);
                const blob = await res.blob();

                if (typeof createImageBitmap === 'function') {
                    return await createImageBitmap(blob);
                }

                // Fallback: HTMLImageElement
                const objectUrl = URL.createObjectURL(blob);
                try {
                    const img = new Image();
                    img.decoding = 'async';
                    img.src = objectUrl;
                    await new Promise((resolve, reject) => {
                        img.onload = () => resolve();
                        img.onerror = () => reject(new Error('Failed to decode image'));
                    });
                    return img;
                } finally {
                    try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ }
                }
            };

            const buildAverageMaskCanvasFromUrls = async ({ urls, width, height, onProgress }) => {
                const w = Math.max(1, Math.floor(Number(width) || 0));
                const h = Math.max(1, Math.floor(Number(height) || 0));
                if (!(w > 0) || !(h > 0)) throw new Error('Invalid mask dimensions');

                const tmpCanvas = document.createElement('canvas');
                tmpCanvas.width = w;
                tmpCanvas.height = h;
                const tctx = tmpCanvas.getContext('2d', { willReadFrequently: true });
                if (!tctx) throw new Error('Failed to create 2D context for mask averaging');

                const sums = new Uint32Array(w * h * 4);
                let used = 0;

                const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
                for (let idx = 0; idx < list.length; idx++) {
                    const url = String(list[idx] || '').trim();
                    if (!url) continue;

                    if (typeof onProgress === 'function') {
                        try { onProgress(idx + 1, list.length); } catch { /* ignore */ }
                    }

                    let bitmap = null;
                    try {
                        bitmap = await loadImageBitmap(url);
                        tctx.globalAlpha = 1;
                        tctx.clearRect(0, 0, w, h);
                        tctx.drawImage(bitmap, 0, 0, w, h);

                        const imageData = tctx.getImageData(0, 0, w, h);
                        const data = imageData.data;
                        for (let i = 0; i < data.length; i++) {
                            sums[i] += data[i];
                        }
                        used += 1;
                    } catch {
                        // Skip unreadable images.
                    } finally {
                        try { bitmap?.close?.(); } catch { /* ignore */ }
                    }
                }

                if (used <= 0) throw new Error('Could not load any images to compute average mask');

                const out = new Uint8ClampedArray(w * h * 4);
                for (let i = 0; i < out.length; i += 4) {
                    out[i] = Math.round(sums[i] / used);
                    out[i + 1] = Math.round(sums[i + 1] / used);
                    out[i + 2] = Math.round(sums[i + 2] / used);
                    out[i + 3] = 255;
                }

                const maskCanvas = document.createElement('canvas');
                maskCanvas.width = w;
                maskCanvas.height = h;
                const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });
                if (!mctx) throw new Error('Failed to create 2D context for average mask');
                mctx.putImageData(new ImageData(out, w, h), 0, 0);
                return maskCanvas;
            };

            const normalizeCipMaskType = (raw) => {
                const t0 = (raw ?? '').toString().trim();
                const t = t0.toLowerCase();

                // New UI values
                if (t === 'pure_noise') return 'pure_noise';
                if (t === 'noise_and_shuffle') return 'noise_and_shuffle';
                if (t === 'advanced_transform') return 'advanced_transform';

                // Friendly labels (if ever used)
                if (t === 'pure noise') return 'pure_noise';
                if (t === 'noise and shuffle') return 'noise_and_shuffle';
                if (t === 'advanced transform') return 'advanced_transform';

                // Legacy values (keep old configs usable)
                if (t === 'noise') return 'noise_and_shuffle';
                if (t === 'sprite') return 'pure_noise';
                if (t === 'blank') return 'pure_noise';

                return 'noise_and_shuffle';
            };

            const clamp255 = (x) => (x < 0 ? 0 : (x > 255 ? 255 : x));

            const nextPow2 = (n) => {
                let p = 1;
                while (p < n) p <<= 1;
                return p;
            };

            // In-place radix-2 FFT (complex), iterative Cooley-Tukey.
            // real[] and imag[] must be Float32Array of length N (power of 2).
            const fft1d = (real, imag, inverse = false) => {
                const n = real.length;
                if (n <= 1) return;

                // Bit-reversal permutation
                let j = 0;
                for (let i = 1; i < n; i++) {
                    let bit = n >> 1;
                    for (; j & bit; bit >>= 1) j ^= bit;
                    j ^= bit;
                    if (i < j) {
                        const tr = real[i]; real[i] = real[j]; real[j] = tr;
                        const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
                    }
                }

                for (let len = 2; len <= n; len <<= 1) {
                    const ang = (inverse ? 2 : -2) * Math.PI / len;
                    const wlenR = Math.cos(ang);
                    const wlenI = Math.sin(ang);
                    for (let i = 0; i < n; i += len) {
                        let wr = 1;
                        let wi = 0;
                        const half = len >> 1;
                        for (let k = 0; k < half; k++) {
                            const uR = real[i + k];
                            const uI = imag[i + k];
                            const vR = real[i + k + half] * wr - imag[i + k + half] * wi;
                            const vI = real[i + k + half] * wi + imag[i + k + half] * wr;
                            real[i + k] = uR + vR;
                            imag[i + k] = uI + vI;
                            real[i + k + half] = uR - vR;
                            imag[i + k + half] = uI - vI;

                            const nwr = wr * wlenR - wi * wlenI;
                            wi = wr * wlenI + wi * wlenR;
                            wr = nwr;
                        }
                    }
                }

                if (inverse) {
                    for (let i = 0; i < n; i++) {
                        real[i] /= n;
                        imag[i] /= n;
                    }
                }
            };

            const fft2d = (real, imag, width, height, inverse = false) => {
                // Rows
                const rowR = new Float32Array(width);
                const rowI = new Float32Array(width);
                for (let y = 0; y < height; y++) {
                    const off = y * width;
                    for (let x = 0; x < width; x++) {
                        rowR[x] = real[off + x];
                        rowI[x] = imag[off + x];
                    }
                    fft1d(rowR, rowI, inverse);
                    for (let x = 0; x < width; x++) {
                        real[off + x] = rowR[x];
                        imag[off + x] = rowI[x];
                    }
                }

                // Cols
                const colR = new Float32Array(height);
                const colI = new Float32Array(height);
                for (let x = 0; x < width; x++) {
                    for (let y = 0; y < height; y++) {
                        const idx = y * width + x;
                        colR[y] = real[idx];
                        colI[y] = imag[idx];
                    }
                    fft1d(colR, colI, inverse);
                    for (let y = 0; y < height; y++) {
                        const idx = y * width + x;
                        real[idx] = colR[y];
                        imag[idx] = colI[y];
                    }
                }
            };

            const buildPhaseScrambledMaskCanvasFromAverage = ({ averageCanvas, outWidth, outHeight, noiseAmp }) => {
                const w0 = averageCanvas?.width || 0;
                const h0 = averageCanvas?.height || 0;
                if (!(w0 > 0) || !(h0 > 0)) throw new Error('Average canvas is empty');

                const maxSide = 256; // perf guard: phase scrambling is expensive at large resolutions
                const scale = Math.min(1, maxSide / Math.max(w0, h0));
                const w = Math.max(8, Math.floor(w0 * scale));
                const h = Math.max(8, Math.floor(h0 * scale));

                const smallCanvas = document.createElement('canvas');
                smallCanvas.width = w;
                smallCanvas.height = h;
                const sctx = smallCanvas.getContext('2d', { willReadFrequently: true });
                if (!sctx) throw new Error('Failed to create 2D context for phase mask');
                sctx.imageSmoothingEnabled = true;
                sctx.drawImage(averageCanvas, 0, 0, w, h);

                const imgData = sctx.getImageData(0, 0, w, h);
                const d = imgData.data;

                const W = nextPow2(w);
                const H = nextPow2(h);
                const size = W * H;
                const real = new Float32Array(size);
                const imag = new Float32Array(size);

                // Luminance into padded grid
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const si = (y * w + x) * 4;
                        const lum = 0.2126 * d[si] + 0.7152 * d[si + 1] + 0.0722 * d[si + 2];
                        real[y * W + x] = lum;
                    }
                }

                // Forward FFT
                fft2d(real, imag, W, H, false);

                // Phase randomization with conjugate symmetry enforcement
                for (let v = 0; v < H; v++) {
                    for (let u = 0; u < W; u++) {
                        const u2 = (W - u) % W;
                        const v2 = (H - v) % H;
                        // process each pair once
                        if (v > v2) continue;
                        if (v === v2 && u > u2) continue;

                        const idx = v * W + u;
                        const idx2 = v2 * W + u2;

                        const re = real[idx];
                        const im = imag[idx];
                        const amp = Math.hypot(re, im);

                        // Self-symmetric bins must stay real (imag=0) to preserve real-valued inverse.
                        const self = (idx === idx2);
                        if (self) {
                            real[idx] = amp;
                            imag[idx] = 0;
                            continue;
                        }

                        const phi = (Math.random() * 2 - 1) * Math.PI;
                        const nr = amp * Math.cos(phi);
                        const ni = amp * Math.sin(phi);
                        real[idx] = nr;
                        imag[idx] = ni;
                        real[idx2] = nr;
                        imag[idx2] = -ni;
                    }
                }

                // Inverse FFT
                fft2d(real, imag, W, H, true);

                // Crop back, normalize to 0..255
                let mn = Infinity;
                let mx = -Infinity;
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const v = real[y * W + x];
                        if (v < mn) mn = v;
                        if (v > mx) mx = v;
                    }
                }
                const denom = (mx - mn) > 1e-6 ? (mx - mn) : 1;

                const outSmall = new ImageData(w, h);
                const od = outSmall.data;
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const v = (real[y * W + x] - mn) / denom;
                        const g = clamp255(Math.round(v * 255));
                        const i = (y * w + x) * 4;
                        od[i] = g;
                        od[i + 1] = g;
                        od[i + 2] = g;
                        od[i + 3] = 255;
                    }
                }

                if (Number.isFinite(Number(noiseAmp)) && Number(noiseAmp) > 0) {
                    const ampN = Math.max(0, Math.min(128, Math.floor(Number(noiseAmp))));
                    for (let i = 0; i < od.length; i += 4) {
                        const n = (Math.random() * 2 - 1) * ampN;
                        const g = clamp255(Math.round(od[i] + n));
                        od[i] = g;
                        od[i + 1] = g;
                        od[i + 2] = g;
                    }
                }

                sctx.putImageData(outSmall, 0, 0);

                const outCanvas = document.createElement('canvas');
                outCanvas.width = outWidth;
                outCanvas.height = outHeight;
                const octx = outCanvas.getContext('2d', { willReadFrequently: true });
                if (!octx) throw new Error('Failed to create 2D context for phase mask output');
                octx.imageSmoothingEnabled = true;
                octx.drawImage(smallCanvas, 0, 0, outWidth, outHeight);
                return outCanvas;
            };

            const buildSharedMaskFromAverage = ({ averageCanvas, maskType, noiseAmp, blockSizePx }) => {
                const normalized = normalizeCipMaskType(maskType);
                const w = averageCanvas?.width || 0;
                const h = averageCanvas?.height || 0;
                if (!(w > 0) || !(h > 0)) throw new Error('Average canvas is empty');

                if (normalized === 'advanced_transform') {
                    return buildPhaseScrambledMaskCanvasFromAverage({
                        averageCanvas,
                        outWidth: w,
                        outHeight: h,
                        noiseAmp
                    });
                }

                const outCanvas = document.createElement('canvas');
                outCanvas.width = w;
                outCanvas.height = h;
                const octx = outCanvas.getContext('2d', { willReadFrequently: true });
                if (!octx) throw new Error('Failed to create 2D context for shared mask');

                // pure_noise / noise_and_shuffle: start from the average image then add per-pixel noise.
                octx.drawImage(averageCanvas, 0, 0);
                const imageData = octx.getImageData(0, 0, w, h);
                const d = imageData.data;

                const amplitude = Math.max(0, Math.min(128, Math.floor(Number(noiseAmp ?? 24))));
                for (let i = 0; i < d.length; i += 4) {
                    const n = (Math.random() * 2 - 1) * amplitude;
                    d[i] = clamp255(Math.round(d[i] + n));
                    d[i + 1] = clamp255(Math.round(d[i + 1] + n));
                    d[i + 2] = clamp255(Math.round(d[i + 2] + n));
                    d[i + 3] = 255;
                }

                if (normalized === 'pure_noise') {
                    octx.putImageData(imageData, 0, 0);
                    return outCanvas;
                }

                // Add a pixelated + shuffled structure so images can "disintegrate" into the mask.
                const blockSize = Math.max(1, Math.floor(Number(blockSizePx) || 12));
                const blocksX = Math.ceil(w / blockSize);
                const blocksY = Math.ceil(h / blockSize);
                const totalBlocks = Math.max(1, blocksX * blocksY);

                const blockColors = new Uint8ClampedArray(totalBlocks * 3);
                for (let by = 0; by < blocksY; by++) {
                    for (let bx = 0; bx < blocksX; bx++) {
                        const x0 = bx * blockSize;
                        const y0 = by * blockSize;
                        const x1 = Math.min(w, x0 + blockSize);
                        const y1 = Math.min(h, y0 + blockSize);

                        let r = 0;
                        let g = 0;
                        let b = 0;
                        let count = 0;
                        for (let y = y0; y < y1; y++) {
                            for (let x = x0; x < x1; x++) {
                                const idx = (y * w + x) * 4;
                                r += d[idx];
                                g += d[idx + 1];
                                b += d[idx + 2];
                                count += 1;
                            }
                        }

                        const bi = (by * blocksX + bx) * 3;
                        const denom = Math.max(1, count);
                        blockColors[bi] = Math.round(r / denom);
                        blockColors[bi + 1] = Math.round(g / denom);
                        blockColors[bi + 2] = Math.round(b / denom);
                    }
                }

                const perm = new Uint32Array(totalBlocks);
                for (let i = 0; i < totalBlocks; i++) perm[i] = i;
                for (let i = totalBlocks - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    const tmp = perm[i];
                    perm[i] = perm[j];
                    perm[j] = tmp;
                }

                const out = new Uint8ClampedArray(w * h * 4);
                for (let by = 0; by < blocksY; by++) {
                    for (let bx = 0; bx < blocksX; bx++) {
                        const blockIndex = by * blocksX + bx;
                        const srcIndex = perm[blockIndex];
                        const ci = srcIndex * 3;
                        const cr = blockColors[ci];
                        const cg = blockColors[ci + 1];
                        const cb = blockColors[ci + 2];

                        const x0 = bx * blockSize;
                        const y0 = by * blockSize;
                        const x1 = Math.min(w, x0 + blockSize);
                        const y1 = Math.min(h, y0 + blockSize);
                        for (let y = y0; y < y1; y++) {
                            for (let x = x0; x < x1; x++) {
                                const idx = (y * w + x) * 4;
                                out[idx] = cr;
                                out[idx + 1] = cg;
                                out[idx + 2] = cb;
                                out[idx + 3] = 255;
                            }
                        }
                    }
                }

                octx.putImageData(new ImageData(out, w, h), 0, 0);
                return outCanvas;
            };

            const buildPixelatedGrayMaskCanvas = (sourceBitmap, width, height) => {
                const maskCanvas = document.createElement('canvas');
                maskCanvas.width = width;
                maskCanvas.height = height;
                const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });
                mctx.drawImage(sourceBitmap, 0, 0, width, height);

                const imageData = mctx.getImageData(0, 0, width, height);
                const data = imageData.data;

                const block = Math.max(4, Math.round(Math.min(width, height) / 40));
                for (let y = 0; y < height; y += block) {
                    for (let x = 0; x < width; x += block) {
                        const x2 = Math.min(width, x + block);
                        const y2 = Math.min(height, y + block);

                        let sum = 0;
                        let count = 0;
                        for (let yy = y; yy < y2; yy++) {
                            for (let xx = x; xx < x2; xx++) {
                                const idx = (yy * width + xx) * 4;
                                // Simple luminance proxy
                                sum += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
                                count += 1;
                            }
                        }
                        const g = Math.max(0, Math.min(255, Math.round(sum / Math.max(1, count))));
                        for (let yy = y; yy < y2; yy++) {
                            for (let xx = x; xx < x2; xx++) {
                                const idx = (yy * width + xx) * 4;
                                data[idx] = g;
                                data[idx + 1] = g;
                                data[idx + 2] = g;
                                data[idx + 3] = 255;
                            }
                        }
                    }
                }

                mctx.putImageData(imageData, 0, 0);
                return maskCanvas;
            };

            const buildTransitionSpriteSheet = async ({ imageBitmap, maskCanvas, frames, direction, blockSizePx }) => {
                const width = maskCanvas.width;
                const height = maskCanvas.height;
                const f = Math.max(2, Number.parseInt(frames, 10) || 8);

                const imageCanvas = document.createElement('canvas');
                imageCanvas.width = width;
                imageCanvas.height = height;
                const ictx = imageCanvas.getContext('2d', { willReadFrequently: true });
                if (!ictx) throw new Error('Failed to create image canvas context');
                ictx.drawImage(imageBitmap, 0, 0, width, height);

                const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });
                if (!mctx) throw new Error('Failed to read mask canvas');

                const imageData = ictx.getImageData(0, 0, width, height);
                const maskData = mctx.getImageData(0, 0, width, height);
                const img = imageData.data;
                const mask = maskData.data;

                // Pixelation + shuffle + morph:
                // - Image->Mask: blocks start as image, then "disintegrate" by briefly pulling
                //   pixels from shuffled locations while easing their colors into the shared mask.
                // - Mask->Image: reverse process (mask -> shuffled hints -> correct image).
                const clamp01 = (x) => (x < 0 ? 0 : (x > 1 ? 1 : x));
                const smoothstep = (x) => x * x * (3 - 2 * x);

                const blockSize = Math.max(1, Math.floor(Number(blockSizePx) || Math.max(2, Math.round(Math.min(width, height) / 200))));
                const blocksX = Math.ceil(width / blockSize);
                const blocksY = Math.ceil(height / blockSize);
                const totalBlocks = Math.max(1, blocksX * blocksY);

                const makePermutation = () => {
                    const order = new Uint32Array(totalBlocks);
                    for (let i = 0; i < totalBlocks; i++) order[i] = i;
                    for (let i = totalBlocks - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        const tmp = order[i];
                        order[i] = order[j];
                        order[j] = tmp;
                    }
                    return order;
                };

                const revealOrder = makePermutation();
                const shuffleMap = makePermutation();
                const revealRank = new Float32Array(totalBlocks);
                for (let i = 0; i < totalBlocks; i++) {
                    revealRank[revealOrder[i]] = (totalBlocks <= 1) ? 1 : (i / (totalBlocks - 1));
                }

                const window = Math.min(0.35, Math.max(0.12, 2 / f));

                const frameCanvas = document.createElement('canvas');
                frameCanvas.width = width;
                frameCanvas.height = height;
                const fctx = frameCanvas.getContext('2d', { willReadFrequently: true });
                if (!fctx) throw new Error('Failed to create frame canvas');

                const out = new Uint8ClampedArray(width * height * 4);
                const outImageData = new ImageData(out, width, height);

                const sheet = document.createElement('canvas');
                sheet.width = width * f;
                sheet.height = height;
                const sctx = sheet.getContext('2d', { willReadFrequently: true });
                if (!sctx) throw new Error('Failed to create sheet canvas');

                const writeBlock = ({ blockIndex, mix }) => {
                    const bx = blockIndex % blocksX;
                    const by = Math.floor(blockIndex / blocksX);
                    const x0 = bx * blockSize;
                    const y0 = by * blockSize;
                    const x1 = Math.min(width, x0 + blockSize);
                    const y1 = Math.min(height, y0 + blockSize);

                    const srcBlockIndex = shuffleMap[blockIndex];
                    const sbx = srcBlockIndex % blocksX;
                    const sby = Math.floor(srcBlockIndex / blocksX);
                    const sx0 = sbx * blockSize;
                    const sy0 = sby * blockSize;

                    const s = mix;
                    const inv = 1 - s;

                    for (let y = y0; y < y1; y++) {
                        for (let x = x0; x < x1; x++) {
                            const di = (y * width + x) * 4;

                            const rx = x - x0;
                            const ry = y - y0;
                            const sx = Math.min(width - 1, sx0 + rx);
                            const sy = Math.min(height - 1, sy0 + ry);
                            const si = (sy * width + sx) * 4;

                            const mr = mask[di];
                            const mg = mask[di + 1];
                            const mb = mask[di + 2];

                            const cr = img[di];
                            const cg = img[di + 1];
                            const cb = img[di + 2];

                            const sr = img[si];
                            const sg = img[si + 1];
                            const sb = img[si + 2];

                            if (direction === 'mask_to_image') {
                                // mask -> (shuffled hint) -> correct image
                                const midR = sr * inv + cr * s;
                                const midG = sg * inv + cg * s;
                                const midB = sb * inv + cb * s;
                                out[di] = Math.round(mr * inv + midR * s);
                                out[di + 1] = Math.round(mg * inv + midG * s);
                                out[di + 2] = Math.round(mb * inv + midB * s);
                                out[di + 3] = 255;
                            } else {
                                // image -> (shuffled jitter) -> mask
                                const midR = sr * inv + mr * s;
                                const midG = sg * inv + mg * s;
                                const midB = sb * inv + mb * s;
                                out[di] = Math.round(cr * inv + midR * s);
                                out[di + 1] = Math.round(cg * inv + midG * s);
                                out[di + 2] = Math.round(cb * inv + midB * s);
                                out[di + 3] = 255;
                            }
                        }
                    }
                };

                for (let frameIdx = 0; frameIdx < f; frameIdx++) {
                    const t = (f <= 1) ? 1 : (frameIdx / (f - 1));
                    out.set(direction === 'mask_to_image' ? mask : img);

                    for (let blockIndex = 0; blockIndex < totalBlocks; blockIndex++) {
                        const r = revealRank[blockIndex];
                        const v = clamp01((t - (r - window)) / (2 * window));
                        const s = smoothstep(v);
                        if (s <= 0) continue;
                        writeBlock({ blockIndex, mix: s });
                    }

                    fctx.putImageData(outImageData, 0, 0);
                    sctx.drawImage(frameCanvas, frameIdx * width, 0);
                }

                return sheet;
            };

            const maskTypeEl = formContainer.querySelector('#param_cip_mask_type');
            const noiseAmpEl = formContainer.querySelector('#param_cip_mask_noise_amp');
            const blockSizeEl = formContainer.querySelector('#param_cip_mask_block_size');
            const codeEl = formContainer.querySelector('#param_cip_asset_code');
            const filenamesEl = formContainer.querySelector('#param_cip_asset_filenames');
            const urlsEl = formContainer.querySelector('#param_cip_image_urls');
            const m2iUrlsEl = formContainer.querySelector('#param_cip_mask_to_image_sprite_urls');
            const i2mUrlsEl = formContainer.querySelector('#param_cip_image_to_mask_sprite_urls');
            const framesEl = formContainer.querySelector('#param_cip_transition_frames');

            // Hide persisted URL fields unless this is a CIP block.
            const applyCipFieldVisibility = () => {
                const show = isCipBlock();
                hideButPersist('cip_image_urls', !show);
                hideButPersist('cip_mask_to_image_sprite_urls', !show);
                hideButPersist('cip_image_to_mask_sprite_urls', !show);
                hideButPersist('cip_transition_frames', !show);
            };

            // Panel: only meaningful for CIP blocks.
            const anchorRow =
                formContainer.querySelector('[data-param-name="cip_mask_block_size"]')
                || formContainer.querySelector('[data-param-name="cip_mask_noise_amp"]')
                || formContainer.querySelector('[data-param-name="cip_mask_type"]')
                || formContainer.querySelector('[data-param-name="cip_asset_code"]');
            const panelId = 'cip_assets_panel';
            let panel = formContainer.querySelector(`#${CSS.escape(panelId)}`);

            if (anchorRow && panel && panel.previousElementSibling !== anchorRow) {
                anchorRow.insertAdjacentElement('afterend', panel);
            }

            if (anchorRow && !panel) {
                panel = document.createElement('div');
                panel.id = panelId;
                panel.className = 'mt-2';
                panel.innerHTML = `
                    <div class="d-flex flex-wrap gap-2 mb-2">
                        <button type="button" class="btn btn-outline-primary btn-sm" id="cip_load_assets_btn">Load assets</button>
                        <button type="button" class="btn btn-outline-secondary btn-sm" id="cip_upload_assets_btn">Upload assets directory</button>
                        <button type="button" class="btn btn-outline-success btn-sm" id="cip_generate_half_frames_btn">Generate half-frames for transitions</button>
                    </div>
                    <div class="form-text" id="cip_assets_status"></div>
                `;
                anchorRow.insertAdjacentElement('afterend', panel);
            }

            const loadBtn = panel ? panel.querySelector('#cip_load_assets_btn') : null;
            const uploadBtn = panel ? panel.querySelector('#cip_upload_assets_btn') : null;
            const genBtn = panel ? panel.querySelector('#cip_generate_half_frames_btn') : null;
            const statusEl = panel ? panel.querySelector('#cip_assets_status') : null;

            let lastAssetsMap = null;
            let lastAssetsTaskType = null;

            const recomputeListsFromFilenames = () => {
                if (!filenamesEl || !urlsEl) return;
                const names = parseLines(filenamesEl.value).filter((n) => isImageFilename(n) && !isCipTransitionSpriteFilename(n));
                const map = (lastAssetsMap && typeof lastAssetsMap === 'object') ? lastAssetsMap : null;
                const maskKey = normalizeCipMaskType(maskTypeEl ? maskTypeEl.value : 'noise_and_shuffle');
                const urls = [];
                const m2i = [];
                const i2m = [];

                for (const name of names) {
                    const u = map && map[name] && map[name].url ? String(map[name].url) : '';
                    urls.push(u);

                    const base = stripExt(name);
                    const m2iName = `${base}__cip_${maskKey}_m2i.png`;
                    const i2mName = `${base}__cip_${maskKey}_i2m.png`;
                    const m2iUrl = map && map[m2iName] && map[m2iName].url ? String(map[m2iName].url) : '';
                    const i2mUrl = map && map[i2mName] && map[i2mName].url ? String(map[i2mName].url) : '';
                    m2i.push(m2iUrl);
                    i2m.push(i2mUrl);
                }

                urlsEl.value = urls.join('\n');
                if (m2iUrlsEl) m2iUrlsEl.value = m2i.join('\n');
                if (i2mUrlsEl) i2mUrlsEl.value = i2m.join('\n');
            };

            const loadAssetsFromIndex = async () => {
                const code = (codeEl ? codeEl.value : '').toString().trim();
                if (!code) {
                    if (statusEl) statusEl.textContent = 'Enter an export code first.';
                    lastAssetsMap = null;
                    return;
                }

                const taskType = this.jsonBuilder.normalizeTokenStoreTaskType(document.getElementById('taskType')?.value || 'task');
                lastAssetsTaskType = taskType;

                const filesMap = this.jsonBuilder.getTokenStoreAssetMapForCodeAndTask(code, taskType);
                lastAssetsMap = filesMap;

                if (!filesMap) {
                    if (statusEl) statusEl.textContent = `No Token Store assets index found for code ${code} (${String(taskType).toUpperCase()}).`;
                    return;
                }

                const filenames = Object.keys(filesMap)
                    .filter((n) => isImageFilename(n) && !isCipTransitionSpriteFilename(n))
                    .sort((a, b) => a.localeCompare(b));

                if (filenamesEl) {
                    filenamesEl.value = filenames.join('\n');
                }

                recomputeListsFromFilenames();

                const haveTransitions = (() => {
                    const m2i = parseLines(m2iUrlsEl ? m2iUrlsEl.value : '');
                    const i2m = parseLines(i2mUrlsEl ? i2mUrlsEl.value : '');
                    return m2i.some(Boolean) || i2m.some(Boolean);
                })();

                if (statusEl) {
                    statusEl.textContent = `Loaded ${filenames.length} image(s) from Token Store assets index for code ${code} (${String(taskType).toUpperCase()}).${haveTransitions ? ' (Some transitions found.)' : ''}`;
                }
            };

            const generateTransitions = async () => {
                const code = (codeEl ? codeEl.value : '').toString().trim();
                if (!code) {
                    if (statusEl) statusEl.textContent = 'Enter an export code first.';
                    return;
                }

                const taskType = lastAssetsTaskType || this.jsonBuilder.normalizeTokenStoreTaskType(document.getElementById('taskType')?.value || 'task');

                const filesMap = this.jsonBuilder.getTokenStoreAssetMapForCodeAndTask(code, taskType);
                if (!filesMap) {
                    if (statusEl) statusEl.textContent = `No Token Store assets index found for code ${code} (${String(taskType).toUpperCase()}). Upload assets first.`;
                    return;
                }

                const filenames = parseLines(filenamesEl ? filenamesEl.value : '').filter(isImageFilename);
                if (filenames.length === 0) {
                    if (statusEl) statusEl.textContent = 'No image filenames listed. Load assets first.';
                    return;
                }

                // Ensure Token Store connection + record
                let baseUrl = this.jsonBuilder.peekTokenStoreBaseUrl?.();
                if (!baseUrl) {
                    baseUrl = this.jsonBuilder.getTokenStoreBaseUrl?.();
                }
                if (!baseUrl) return;

                let record = this.jsonBuilder.getTokenStoreRecordForCodeAndTask(code, taskType);
                if (!record) {
                    if (statusEl) statusEl.textContent = `No token found for code ${code} (${String(taskType).toUpperCase()}). Creating a new token...`;
                    record = await this.jsonBuilder.createTokenStoreConfig(baseUrl);
                    this.jsonBuilder.setTokenStoreRecordForCodeAndTask(code, taskType, record, { filename: null });
                }

                const frames = Math.max(2, Number.parseInt((framesEl ? framesEl.value : '8').toString(), 10) || 8);
                const maskType = normalizeCipMaskType(maskTypeEl ? maskTypeEl.value : 'noise_and_shuffle');
                const noiseAmp = Math.max(0, Math.min(128, Number.parseInt((noiseAmpEl ? noiseAmpEl.value : '24').toString(), 10) || 0));
                const blockSizePx = Math.max(1, Number.parseInt((blockSizeEl ? blockSizeEl.value : '12').toString(), 10) || 12);
                const nextMap = { ...filesMap };

                // Token Store quota guard: the Token Store enforces a per-config total assets cap (e.g., 100MB).
                // When generating many CIP transition sheets, we can hit that cap. In that case, roll over to a
                // fresh Token Store config for the same code+task and continue uploading.
                let didRolloverRecordForQuota = false;
                const isQuotaExceededError = (e) => {
                    const msg = (e && e.message) ? String(e.message) : String(e || '');
                    return /\b413\b/.test(msg) && /(quota|exceed)/i.test(msg);
                };
                const maybeRolloverRecord = async () => {
                    if (didRolloverRecordForQuota) return false;
                    didRolloverRecordForQuota = true;
                    const ok = confirm(
                        'Token Store asset quota exceeded for this config (HTTP 413).\n\n' +
                        'Create a NEW Token Store config bucket for this same export code and task, and continue uploading the generated CIP transition sprites?\n\n' +
                        'This does not delete any existing assets; it simply starts a fresh bucket to avoid the size cap.'
                    );
                    if (!ok) return false;
                    if (statusEl) statusEl.textContent = 'Token Store quota exceeded. Creating a new token bucket and retrying uploads...';
                    record = await this.jsonBuilder.createTokenStoreConfig(baseUrl);
                    this.jsonBuilder.setTokenStoreRecordForCodeAndTask(code, taskType, record, { filename: null });
                    return true;
                };
                const uploadWithQuotaRollover = async (file, outName) => {
                    try {
                        return await this.jsonBuilder.uploadAssetToTokenStore(baseUrl, record, file, outName);
                    } catch (e) {
                        if (isQuotaExceededError(e)) {
                            const rolled = await maybeRolloverRecord();
                            if (rolled) {
                                return await this.jsonBuilder.uploadAssetToTokenStore(baseUrl, record, file, outName);
                            }
                        }
                        throw e;
                    }
                };

                // Cache-bust regenerated sprite sheets so browsers/JATOS don't keep showing old PNGs.
                const cacheBust = Date.now().toString(36);
                const withCacheBust = (rawUrl) => {
                    const u = (rawUrl ?? '').toString().trim();
                    if (!u) return '';
                    try {
                        const urlObj = new URL(u, window.location.href);
                        urlObj.searchParams.set('cb', cacheBust);
                        return urlObj.toString();
                    } catch {
                        // Fallback for odd/partial URLs
                        const sep = u.includes('?') ? '&' : '?';
                        return `${u}${sep}cb=${encodeURIComponent(cacheBust)}`;
                    }
                };

                if (genBtn) genBtn.disabled = true;
                if (loadBtn) loadBtn.disabled = true;
                if (uploadBtn) uploadBtn.disabled = true;

                try {
                    if (statusEl) statusEl.textContent = `Computing shared average mask for ${filenames.length} image(s)...`;

                    const urlsForMask = filenames
                        .map((fn) => {
                            const u = filesMap[fn] && filesMap[fn].url ? String(filesMap[fn].url) : '';
                            return u || '';
                        })
                        .filter(Boolean);

                    let baseWidth = 0;
                    let baseHeight = 0;
                    for (const u of urlsForMask) {
                        try {
                            const firstBitmap = await loadImageBitmap(u);
                            try {
                                baseWidth = firstBitmap.width || firstBitmap.naturalWidth;
                                baseHeight = firstBitmap.height || firstBitmap.naturalHeight;
                            } finally {
                                try { firstBitmap?.close?.(); } catch { /* ignore */ }
                            }
                            if (baseWidth > 0 && baseHeight > 0) break;
                        } catch {
                            // try next
                        }
                    }

                    if (!(baseWidth > 0) || !(baseHeight > 0)) {
                        if (statusEl) statusEl.textContent = 'Failed to determine image dimensions for mask averaging.';
                        return;
                    }

                    let sharedMaskBaseCanvas = null;
                    try {
                        const avgCanvas = await buildAverageMaskCanvasFromUrls({
                            urls: urlsForMask,
                            width: baseWidth,
                            height: baseHeight,
                            onProgress: (i, total) => {
                                if (!statusEl) return;
                                if (i % 3 === 0 || i === total) statusEl.textContent = `Computing shared average mask... (${i}/${total})`;
                            }
                        });

                        if (statusEl) statusEl.textContent = `Building shared mask (${maskType}) from averaged set...`;
                        sharedMaskBaseCanvas = buildSharedMaskFromAverage({ averageCanvas: avgCanvas, maskType, noiseAmp, blockSizePx });
                    } catch (e) {
                        if (statusEl) statusEl.textContent = `Failed to compute average mask: ${e && e.message ? e.message : String(e)}`;
                        return;
                    }

                    if (statusEl) statusEl.textContent = `Generating and uploading transition sprites for ${filenames.length} image(s)...`;

                    let done = 0;
                    for (const filename of filenames) {
                        const url = filesMap[filename] && filesMap[filename].url ? String(filesMap[filename].url) : '';
                        if (!url) {
                            done += 1;
                            continue;
                        }

                        const bitmap = await loadImageBitmap(url);
                        const width = bitmap.width || bitmap.naturalWidth;
                        const height = bitmap.height || bitmap.naturalHeight;
                        if (!width || !height) {
                            done += 1;
                            continue;
                        }

                        const maskCanvas = (() => {
                            if (sharedMaskBaseCanvas.width === width && sharedMaskBaseCanvas.height === height) {
                                return sharedMaskBaseCanvas;
                            }
                            const c = document.createElement('canvas');
                            c.width = width;
                            c.height = height;
                            const cctx = c.getContext('2d', { willReadFrequently: true });
                            if (cctx) {
                                cctx.globalAlpha = 1;
                                cctx.drawImage(sharedMaskBaseCanvas, 0, 0, width, height);
                            }
                            return c;
                        })();
                        const m2iSheet = await buildTransitionSpriteSheet({ imageBitmap: bitmap, maskCanvas, frames, direction: 'mask_to_image', blockSizePx });
                        const i2mSheet = await buildTransitionSpriteSheet({ imageBitmap: bitmap, maskCanvas, frames, direction: 'image_to_mask', blockSizePx });

                        const base = stripExt(filename);
                        const maskKey = normalizeCipMaskType(maskType);
                        const m2iName = `${base}__cip_${maskKey}_m2i.png`;
                        const i2mName = `${base}__cip_${maskKey}_i2m.png`;

                        const m2iBlob = await toPngBlob(m2iSheet);
                        const i2mBlob = await toPngBlob(i2mSheet);

                        const m2iFile = new File([m2iBlob], m2iName, { type: 'image/png' });
                        const i2mFile = new File([i2mBlob], i2mName, { type: 'image/png' });

                        let m2iUp;
                        let i2mUp;
                        try {
                            m2iUp = await uploadWithQuotaRollover(m2iFile, m2iName);
                            i2mUp = await uploadWithQuotaRollover(i2mFile, i2mName);
                        } catch (e) {
                            const msg = (e && e.message) ? e.message : String(e || '');
                            if (statusEl) {
                                statusEl.textContent = `Failed to upload CIP transition sprites (${filename}): ${msg}`;
                            }
                            return;
                        }

                        nextMap[m2iName] = { url: withCacheBust(m2iUp.url) };
                        nextMap[i2mName] = { url: withCacheBust(i2mUp.url) };

                        done += 1;
                        if (statusEl && (done % 3 === 0 || done === filenames.length)) {
                            statusEl.textContent = `Generating and uploading... (${done}/${filenames.length})`;
                        }
                    }

                    this.jsonBuilder.setTokenStoreAssetMapForCodeAndTask(code, taskType, nextMap);
                    lastAssetsMap = nextMap;

                    // Refresh URL lists (will pick up newly-created sprite URLs)
                    recomputeListsFromFilenames();

                    if (statusEl) statusEl.textContent = `Generated and uploaded transition sprites for code ${code} (${String(taskType).toUpperCase()}).`;
                } finally {
                    if (genBtn) genBtn.disabled = false;
                    if (loadBtn) loadBtn.disabled = false;
                    if (uploadBtn) uploadBtn.disabled = false;
                }
            };

            const updatePanelVisibility = () => {
                const show = isCipBlock();
                applyCipFieldVisibility();
                if (panel) panel.classList.toggle('d-none', !show);
            };

            if (loadBtn) loadBtn.addEventListener('click', () => loadAssetsFromIndex());
            if (uploadBtn) {
                uploadBtn.addEventListener('click', () => {
                    const btn = document.getElementById('uploadAssetsFolderBtn');
                    if (btn) btn.click();
                });
            }
            if (genBtn) genBtn.addEventListener('click', () => generateTransitions());

            if (codeEl) {
                codeEl.addEventListener('change', () => loadAssetsFromIndex());
            }
            if (filenamesEl) {
                filenamesEl.addEventListener('change', () => recomputeListsFromFilenames());
            }
            if (maskTypeEl) {
                maskTypeEl.addEventListener('change', () => recomputeListsFromFilenames());
            }

            if (blockTypeEl) {
                blockTypeEl.addEventListener('change', updatePanelVisibility);
            }

            updatePanelVisibility();
            // Best-effort auto-load (only if a code is already present)
            if (isCipBlock() && codeEl && codeEl.value && (!urlsEl || !urlsEl.value)) {
                loadAssetsFromIndex();
            }
        } catch (e) {
            console.warn('Continuous image block helper setup failed:', e);
        }

        // Gabor trial: response task changes should re-evaluate key visibility.
        const gaborTrialTaskEl = formContainer.querySelector('#param_response_task');
        if (component && component.type === 'gabor-trial' && gaborTrialTaskEl) {
            gaborTrialTaskEl.addEventListener('change', updateGaborTrialKeyVisibility);
            updateGaborTrialKeyVisibility();
        }

        // IMAGE parameters: local file picker + preview + cache binding
        try {
            this.setupImageParameterInputs(formContainer);
        } catch (e) {
            console.warn('Image parameter setup failed:', e);
        }

        // AUDIO parameters: local file picker + preview + cache binding
        try {
            this.setupAudioParameterInputs(formContainer);
        } catch (e) {
            console.warn('Audio parameter setup failed:', e);
        }

        // DRT ISO override behavior (component-definitions based editor)
        try {
            const type = (component?.type ?? '').toString();
            if (type === 'detection-response-task-start') {
                const overrideEl = formContainer.querySelector('#param_override_iso_standard');
                const isoFields = [
                    { name: 'min_iti_ms', value: 3000 },
                    { name: 'max_iti_ms', value: 5000 },
                    { name: 'stimulus_duration_ms', value: 1000 },
                    { name: 'min_rt_ms', value: 100 },
                    { name: 'max_rt_ms', value: 2500 }
                ];

                const applyIsoLockState = () => {
                    const override = !!overrideEl?.checked;
                    isoFields.forEach(({ name, value }) => {
                        const el = formContainer.querySelector(`#${CSS.escape(`param_${name}`)}`);
                        if (!el) return;
                        el.disabled = !override;
                        if (!override) {
                            el.value = String(value);
                        }
                    });
                };

                if (overrideEl) {
                    overrideEl.addEventListener('change', applyIsoLockState);
                }
                applyIsoLockState();
            }
        } catch {
            // ignore
        }
    }

    setupAudioParameterInputs(formContainer) {
        if (!formContainer) return;

        const componentEl = this.jsonBuilder.currentEditingComponent;
        const componentId = this.ensureBuilderComponentId(componentEl);

        const updatePreview = (paramName) => {
            const inputId = `param_${paramName}`;
            const urlEl = formContainer.querySelector(`#${CSS.escape(inputId)}`);
            const previewEl = formContainer.querySelector(`#${CSS.escape(inputId)}__preview`);
            const emptyEl = previewEl?.parentElement?.querySelector('[data-psy-audio-empty="1"]');

            const raw = urlEl ? (urlEl.value || '') : '';
            let src = raw;

            const parsed = this.parseAssetRef(raw);
            if (parsed && window.PsychJsonAssetCache && typeof window.PsychJsonAssetCache.get === 'function') {
                const entry = window.PsychJsonAssetCache.get(parsed.componentId, parsed.field);
                if (entry && entry.objectUrl) {
                    src = entry.objectUrl;
                } else {
                    src = '';
                }
            }

            if (previewEl) {
                if (src) {
                    previewEl.src = src;
                    previewEl.style.display = '';
                    if (emptyEl) emptyEl.style.display = 'none';
                } else {
                    previewEl.removeAttribute('src');
                    previewEl.style.display = 'none';
                    if (emptyEl) emptyEl.style.display = '';
                }
            }
        };

        const fileInputs = formContainer.querySelectorAll('input[type="file"][data-psy-audio-file="1"]');
        fileInputs.forEach((fileEl) => {
            const paramName = fileEl.getAttribute('data-psy-audio-param') || '';
            if (!paramName) return;

            fileEl.addEventListener('change', () => {
                try {
                    if (!componentId) return;
                    const file = fileEl.files && fileEl.files[0] ? fileEl.files[0] : null;

                    const urlInput = formContainer.querySelector(`#${CSS.escape(`param_${paramName}`)}`);
                    if (!urlInput) return;

                    if (file && window.PsychJsonAssetCache && typeof window.PsychJsonAssetCache.put === 'function') {
                        window.PsychJsonAssetCache.put(componentId, paramName, file);
                        urlInput.value = `asset://${componentId}/${paramName}`;
                    }

                    updatePreview(paramName);
                } catch (e) {
                    console.warn('Failed to bind audio file:', e);
                }
            });

            updatePreview(paramName);
        });

        const clearButtons = formContainer.querySelectorAll('button[data-psy-audio-clear="1"]');
        clearButtons.forEach((btn) => {
            const paramName = btn.getAttribute('data-psy-audio-param') || '';
            if (!paramName) return;
            btn.addEventListener('click', () => {
                try {
                    const urlInput = formContainer.querySelector(`#${CSS.escape(`param_${paramName}`)}`);
                    const fileInput = formContainer.querySelector(`#${CSS.escape(`param_${paramName}`)}__file`);
                    if (fileInput) fileInput.value = '';

                    const parsed = this.parseAssetRef(urlInput ? urlInput.value : '');
                    if (parsed && window.PsychJsonAssetCache && typeof window.PsychJsonAssetCache.deleteEntry === 'function') {
                        window.PsychJsonAssetCache.deleteEntry(parsed.componentId, parsed.field);
                    }

                    if (urlInput) urlInput.value = '';
                    updatePreview(paramName);
                } catch (e) {
                    console.warn('Failed to clear audio asset:', e);
                }
            });
        });
    }

    ensureBuilderComponentId(componentEl) {
        if (!componentEl) return null;
        if (componentEl.dataset && componentEl.dataset.builderComponentId) {
            return componentEl.dataset.builderComponentId;
        }

        let id = null;
        try {
            if (window.crypto && typeof window.crypto.randomUUID === 'function') {
                id = window.crypto.randomUUID();
            }
        } catch {
            id = null;
        }

        if (!id) {
            const rand = Math.floor(Math.random() * 1e9);
            id = `comp_${Date.now()}_${rand}`;
        }

        try {
            componentEl.dataset.builderComponentId = id;
        } catch {
            // ignore
        }
        return id;
    }

    parseAssetRef(ref) {
        const s = (ref || '').toString();
        const m = /^asset:\/\/([^/]+)\/([^/]+)$/.exec(s);
        if (!m) return null;
        return { componentId: m[1], field: m[2] };
    }

    setupImageParameterInputs(formContainer) {
        if (!formContainer) return;

        const componentEl = this.jsonBuilder.currentEditingComponent;
        const componentId = this.ensureBuilderComponentId(componentEl);

        const updatePreview = (paramName) => {
            const inputId = `param_${paramName}`;
            const urlEl = formContainer.querySelector(`#${CSS.escape(inputId)}`);
            const previewEl = formContainer.querySelector(`#${CSS.escape(inputId)}__preview`);
            const emptyEl = previewEl?.parentElement?.querySelector('[data-psy-image-empty="1"]');

            const raw = urlEl ? (urlEl.value || '') : '';
            let src = raw;

            const parsed = this.parseAssetRef(raw);
            if (parsed && window.PsychJsonAssetCache && typeof window.PsychJsonAssetCache.get === 'function') {
                const entry = window.PsychJsonAssetCache.get(parsed.componentId, parsed.field);
                if (entry && entry.objectUrl) {
                    src = entry.objectUrl;
                } else {
                    src = '';
                }
            }

            if (previewEl) {
                if (src) {
                    previewEl.src = src;
                    previewEl.style.display = '';
                    if (emptyEl) emptyEl.style.display = 'none';
                } else {
                    previewEl.removeAttribute('src');
                    previewEl.style.display = 'none';
                    if (emptyEl) emptyEl.style.display = '';
                }
            }
        };

        // Bind each IMAGE file input
        const fileInputs = formContainer.querySelectorAll('input[type="file"][data-psy-image-file="1"]');
        fileInputs.forEach((fileEl) => {
            const paramName = fileEl.getAttribute('data-psy-image-param') || '';
            if (!paramName) return;

            // On file pick: store in cache and write asset:// ref into the URL input
            fileEl.addEventListener('change', () => {
                try {
                    if (!componentId) return;
                    const file = fileEl.files && fileEl.files[0] ? fileEl.files[0] : null;

                    const urlInput = formContainer.querySelector(`#${CSS.escape(`param_${paramName}`)}`);
                    if (!urlInput) return;

                    if (file && window.PsychJsonAssetCache && typeof window.PsychJsonAssetCache.put === 'function') {
                        window.PsychJsonAssetCache.put(componentId, paramName, file);
                        urlInput.value = `asset://${componentId}/${paramName}`;
                    }

                    updatePreview(paramName);
                } catch (e) {
                    console.warn('Failed to bind image file:', e);
                }
            });

            // Initial preview (in case the field already contains asset://...)
            updatePreview(paramName);
        });

        // Clear local file button
        const clearButtons = formContainer.querySelectorAll('button[data-psy-image-clear="1"]');
        clearButtons.forEach((btn) => {
            const paramName = btn.getAttribute('data-psy-image-param') || '';
            if (!paramName) return;
            btn.addEventListener('click', () => {
                try {
                    const urlInput = formContainer.querySelector(`#${CSS.escape(`param_${paramName}`)}`);
                    const fileInput = formContainer.querySelector(`#${CSS.escape(`param_${paramName}`)}__file`);
                    if (fileInput) fileInput.value = '';

                    // If it's an asset ref, delete from cache
                    const parsed = this.parseAssetRef(urlInput ? urlInput.value : '');
                    if (parsed && window.PsychJsonAssetCache && typeof window.PsychJsonAssetCache.deleteEntry === 'function') {
                        window.PsychJsonAssetCache.deleteEntry(parsed.componentId, parsed.field);
                    }

                    if (urlInput) urlInput.value = '';
                    updatePreview(paramName);
                } catch (e) {
                    console.warn('Failed to clear image asset:', e);
                }
            });
        });
    }

    saveComponentParameters() {
        const modal = document.getElementById('parameterModal');
        
        // Get the component element that's being edited
        if (!this.jsonBuilder.currentEditingComponent) {
            console.error('No component reference found for saving parameters');
            return;
        }

        console.log('Saving parameters for component:', this.jsonBuilder.currentEditingComponent);

        const modalBody = document.getElementById('parameterModalBody');

        // Read current component data first so we can special-case complex editors.
        let currentData = {};
        try {
            currentData = JSON.parse(this.jsonBuilder.currentEditingComponent.dataset.componentData || '{}') || {};
        } catch (e) {
            currentData = {};
        }

        // Ensure we have the essential fields
        if (!currentData.type) {
            console.error('Warning: Component missing type field!', currentData);
            // Try to recover from dataset.componentType as fallback
            const fallbackType = this.jsonBuilder.currentEditingComponent.dataset.componentType;
            if (fallbackType) {
                currentData.type = fallbackType;
                console.log('Recovered type from componentType:', fallbackType);
            }
        }

        // Survey editor uses a custom DOM (not param_* inputs)
        if (currentData.type === 'survey-response') {
            const survey = this.collectSurveyResponseFromModal(modalBody);
            const updatedData = {
                type: currentData.type,
                name: currentData.name || 'Survey Response',
                ...currentData,
                ...survey,
                label: this._readLabelFromModal(modalBody)
            };

            // Legacy DRT per-element toggle is deprecated; never persist it.
            if (Object.prototype.hasOwnProperty.call(updatedData, 'detection_response_task_enabled')) {
                delete updatedData.detection_response_task_enabled;
            }
            if (updatedData.parameters && typeof updatedData.parameters === 'object') {
                if (Object.prototype.hasOwnProperty.call(updatedData.parameters, 'detection_response_task_enabled')) {
                    delete updatedData.parameters.detection_response_task_enabled;
                }
            }

            this._updateCardLabel(this.jsonBuilder.currentEditingComponent, updatedData.label);
            this.jsonBuilder.currentEditingComponent.dataset.componentData = JSON.stringify(updatedData);
            this.jsonBuilder.updateJSON();

            const paramModal = document.getElementById('parameterModal');
            const bootstrapModal = bootstrap.Modal.getInstance(paramModal);
            if (bootstrapModal) {
                bootstrapModal.hide();
            }
            return;
        }

        // Reward settings editor uses a custom DOM (screens + milestones)
        if (currentData.type === 'reward-settings') {
            const rewards = this.collectRewardSettingsFromModal(modalBody);
            const updatedData = {
                type: currentData.type,
                name: currentData.name || 'Reward Settings',
                ...currentData,
                ...rewards
            };

            // Legacy DRT per-element toggle is deprecated; never persist it.
            if (Object.prototype.hasOwnProperty.call(updatedData, 'detection_response_task_enabled')) {
                delete updatedData.detection_response_task_enabled;
            }
            if (updatedData.parameters && typeof updatedData.parameters === 'object') {
                if (Object.prototype.hasOwnProperty.call(updatedData.parameters, 'detection_response_task_enabled')) {
                    delete updatedData.parameters.detection_response_task_enabled;
                }
            }

            updatedData.label = this._readLabelFromModal(modalBody);
            this._updateCardLabel(this.jsonBuilder.currentEditingComponent, updatedData.label);
            this.jsonBuilder.currentEditingComponent.dataset.componentData = JSON.stringify(updatedData);
            this.jsonBuilder.updateJSON();

            const paramModal = document.getElementById('parameterModal');
            const bootstrapModal = bootstrap.Modal.getInstance(paramModal);
            if (bootstrapModal) {
                bootstrapModal.hide();
            }
            return;
        }

        // Collect form data
        const inputs = modalBody.querySelectorAll('input, textarea, select');
        const newParameters = {};

        inputs.forEach(input => {
            // Don't persist hidden/disabled modality-specific fields
            if (input.disabled) {
                return;
            }

            // Skip helper inputs for IMAGE parameters (file picker, etc.)
            try {
                if (input.matches && input.matches('[data-psy-image-file="1"]')) {
                    return;
                }
            } catch {
                // ignore
            }

            // Skip helper inputs for AUDIO parameters (file picker, etc.)
            try {
                if (input.matches && input.matches('[data-psy-audio-file="1"]')) {
                    return;
                }
            } catch {
                // ignore
            }

            const paramName = input.id.replace('param_', '');

            // Skip IMAGE helper ids
            if (paramName.endsWith('__file') || paramName.endsWith('__preview')) {
                return;
            }

            // Skip COLOR helper hex inputs (UI-only)
            if (paramName.endsWith('_hex')) {
                return;
            }
            
            // Skip 'type' and 'name' - these should not be overwritten by form inputs
            if (paramName === 'type' || paramName === 'name') {
                console.log('Skipping system parameter:', paramName);
                return;
            }
            
            let value = input.value;

            // Handle different input types
            if (input.type === 'checkbox') {
                value = input.checked;
            } else if (input.type === 'range') {
                value = input.step === '1' ? parseInt(value) : parseFloat(value);
            } else if (input.type === 'number') {
                value = input.step === '1' ? parseInt(value) : parseFloat(value);
            }

            newParameters[paramName] = value;
        });

        // DRT Start: ISO-compliant by default unless explicitly overridden.
        try {
            const isDrtStart = (currentData.type || '') === 'detection-response-task-start';
            if (isDrtStart) {
                const override = (newParameters.override_iso_standard !== undefined)
                    ? !!newParameters.override_iso_standard
                    : !!(currentData.parameters?.override_iso_standard ?? currentData.override_iso_standard);

                if (!override) {
                    newParameters.min_iti_ms = 3000;
                    newParameters.max_iti_ms = 5000;
                    newParameters.stimulus_duration_ms = 1000;
                    newParameters.min_rt_ms = 100;
                    newParameters.max_rt_ms = 2500;
                }
            }
        } catch {
            // ignore
        }

        // Block length: default to (and cap at) the experiment-wide length.
        // Researchers may shorten blocks, but cannot extend them beyond the experiment length.
        try {
            if ((currentData.type || '') === 'block') {
                const cap = this.jsonBuilder?.getExperimentWideLengthCapForBlocks?.();
                const proposed = Number.parseInt(newParameters.block_length ?? currentData.block_length ?? '', 10);
                if (Number.isFinite(cap) && cap > 0 && Number.isFinite(proposed) && proposed > cap) {
                    newParameters.block_length = cap;
                    const inputEl = modalBody.querySelector('#param_block_length');
                    if (inputEl) inputEl.value = String(cap);
                    window.alert(`Block length cannot exceed the experiment length (${cap}). It has been set to ${cap}.`);
                }
            }
        } catch {
            // ignore
        }

        // Gabor block cue toggles: when disabled, reset dependent fields so the saved component stays clean.
        if ((currentData.type || '') === 'block') {
            const blockType = (newParameters.block_component_type ?? currentData.block_component_type ?? '').toString();
            const isGaborBlock = (blockType === 'gabor-trial' || blockType === 'gabor-quest');

            const isStroopBlock = (blockType === 'stroop-trial');

            if (isGaborBlock) {
                if (newParameters.gabor_spatial_cue_enabled === false) {
                    newParameters.gabor_spatial_cue_options = 'none,left,right,both';
                    newParameters.gabor_spatial_cue_probability = 1;
                }
                if (newParameters.gabor_value_cue_enabled === false) {
                    newParameters.gabor_left_value_options = 'neutral,high,low';
                    newParameters.gabor_right_value_options = 'neutral,high,low';
                    newParameters.gabor_value_cue_probability = 1;
                }
            }

            if (isStroopBlock) {
                // Always drop legacy field (we now use the experiment-wide stimuli palette)
                if (Object.prototype.hasOwnProperty.call(newParameters, 'stroop_ink_color_options')) {
                    delete newParameters.stroop_ink_color_options;
                }

                const defaultDevice = (document.getElementById('stroopDefaultResponseDevice')?.value || 'keyboard').toString();
                const defaultMode = (document.getElementById('stroopDefaultResponseMode')?.value || 'color_naming').toString();

                const rawDevice = (newParameters.stroop_response_device ?? currentData.stroop_response_device ?? 'inherit').toString();
                const rawMode = (newParameters.stroop_response_mode ?? currentData.stroop_response_mode ?? 'inherit').toString();

                const effectiveDevice = (rawDevice === 'inherit' || rawDevice === '') ? defaultDevice : rawDevice;
                const effectiveMode = (rawMode === 'inherit' || rawMode === '') ? defaultMode : rawMode;

                if (effectiveDevice === 'mouse') {
                    if (Object.prototype.hasOwnProperty.call(newParameters, 'stroop_choice_keys')) delete newParameters.stroop_choice_keys;
                    if (Object.prototype.hasOwnProperty.call(newParameters, 'stroop_congruent_key')) delete newParameters.stroop_congruent_key;
                    if (Object.prototype.hasOwnProperty.call(newParameters, 'stroop_incongruent_key')) delete newParameters.stroop_incongruent_key;
                } else if (effectiveMode === 'congruency') {
                    if (Object.prototype.hasOwnProperty.call(newParameters, 'stroop_choice_keys')) delete newParameters.stroop_choice_keys;
                } else {
                    if (Object.prototype.hasOwnProperty.call(newParameters, 'stroop_congruent_key')) delete newParameters.stroop_congruent_key;
                    if (Object.prototype.hasOwnProperty.call(newParameters, 'stroop_incongruent_key')) delete newParameters.stroop_incongruent_key;
                }
            }
        }

        console.log('Collected parameters:', newParameters);

        const validateCommaSeparatedNumericList = (raw, { min, max, integersOnly = false } = {}) => {
            const text = (raw ?? '').toString();
            const parts = text
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);

            const kept = [];
            const invalid = [];

            for (const p of parts) {
                const n = integersOnly ? Number.parseInt(p, 10) : Number(p);
                if (!Number.isFinite(n)) {
                    invalid.push(p);
                    continue;
                }
                if (integersOnly && `${n}` !== `${Number.parseInt(`${n}`, 10)}`) {
                    // Defensive (should not happen in JS), treat as invalid.
                    invalid.push(p);
                    continue;
                }
                if (Number.isFinite(min) && n < min) {
                    invalid.push(p);
                    continue;
                }
                if (Number.isFinite(max) && n > max) {
                    invalid.push(p);
                    continue;
                }
                kept.push(n);
            }

            // de-dupe while preserving order
            const deduped = Array.from(new Set(kept));
            return {
                sanitized: deduped.map(v => integersOnly ? `${Math.trunc(v)}` : `${v}`).join(','),
                invalid,
                keptCount: deduped.length
            };
        };

        const validateCommaSeparatedTokenList = (raw, { allowed = [], caseSensitive = false } = {}) => {
            const text = (raw ?? '').toString();
            const parts = text
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);

            const allowedList = Array.isArray(allowed) ? allowed : [];
            const allowedMap = new Map();
            for (const a of allowedList) {
                const key = caseSensitive ? `${a}` : `${a}`.toLowerCase();
                allowedMap.set(key, `${a}`);
            }

            const kept = [];
            const invalid = [];

            for (const p of parts) {
                const key = caseSensitive ? p : p.toLowerCase();
                const canonical = allowedMap.get(key);
                if (!canonical) {
                    invalid.push(p);
                    continue;
                }
                kept.push(canonical);
            }

            const deduped = Array.from(new Set(kept));
            return {
                sanitized: deduped.join(','),
                invalid,
                keptCount: deduped.length
            };
        };

        const listRules = {
            // Gabor ranges
            gabor_target_tilt_options: { min: -90, max: 90, integersOnly: false },
            gabor_distractor_orientation_options: { min: 0, max: 179, integersOnly: false },

            // RDM direction fields
            direction_options: { min: 0, max: 359, integersOnly: false },
            practice_direction_options: { min: 0, max: 359, integersOnly: false },
            group_1_direction_options: { min: 0, max: 359, integersOnly: false },
            group_2_direction_options: { min: 0, max: 359, integersOnly: false },

            // SART digits
            sart_digit_options: { min: 0, max: 9, integersOnly: true }
        };

        for (const [field, rules] of Object.entries(listRules)) {
            if (!(field in newParameters)) continue;
            const v = newParameters[field];
            if (typeof v !== 'string') continue;

            const res = validateCommaSeparatedNumericList(v, rules);
            if (res.invalid.length === 0) {
                newParameters[field] = res.sanitized;
                continue;
            }

            const rangeNote = `Allowed range: ${rules.min} to ${rules.max}${rules.integersOnly ? ' (integers only)' : ''}.`;
            const msg =
                `Some values in "${field}" are invalid and will be removed.\n\n` +
                `${rangeNote}\n\n` +
                `Invalid: ${res.invalid.join(', ')}\n\n` +
                `Continue and auto-fix?`;

            const ok = window.confirm(msg);
            if (!ok) {
                return; // keep modal open
            }

            newParameters[field] = res.sanitized;
            const inputEl = modalBody.querySelector(`#param_${field}`);
            if (inputEl) {
                inputEl.value = res.sanitized;
            }
        }

        const tokenListRules = {
            // Flanker
            flanker_congruency_options: { allowed: ['congruent', 'incongruent', 'neutral'] },
            flanker_target_direction_options: { allowed: ['left', 'right'] },

            // Gabor
            gabor_target_location_options: { allowed: ['left', 'right'] },
            gabor_spatial_cue_options: { allowed: ['none', 'left', 'right', 'both'] },
            gabor_left_value_options: { allowed: ['neutral', 'high', 'low'] },
            gabor_right_value_options: { allowed: ['neutral', 'high', 'low'] },
            gabor_grating_waveform_options: { allowed: ['sinusoidal', 'square', 'triangle'] }
        };

        for (const [field, rules] of Object.entries(tokenListRules)) {
            if (!(field in newParameters)) continue;
            const v = newParameters[field];
            if (typeof v !== 'string') continue;

            const res = validateCommaSeparatedTokenList(v, rules);
            if (res.invalid.length === 0) {
                newParameters[field] = res.sanitized;
                continue;
            }

            const allowedNote = `Allowed values: ${(rules.allowed || []).join(', ')}.`;
            const msg =
                `Some values in "${field}" are invalid and will be removed.\n\n` +
                `${allowedNote}\n\n` +
                `Invalid: ${res.invalid.join(', ')}\n\n` +
                `Continue and auto-fix?`;

            const ok = window.confirm(msg);
            if (!ok) {
                return; // keep modal open
            }

            newParameters[field] = res.sanitized;
            const inputEl = modalBody.querySelector(`#param_${field}`);
            if (inputEl) {
                inputEl.value = res.sanitized;
            }
        }

        // Update the DOM element's data
        try {
            console.log('Current component data before save:', currentData);

            let updatedData;
            
            // Check if this component uses nested parameters structure
            if (currentData.parameters && typeof currentData.parameters === 'object') {
                // Nested structure - update parameters object
                updatedData = {
                    type: currentData.type, // Explicitly preserve type first
                    name: currentData.name, // Explicitly preserve name
                    ...currentData,
                    parameters: {
                        ...currentData.parameters,
                        ...newParameters
                    }
                };
            } else {
                // Flat structure - merge parameters directly, preserving type and name
                updatedData = {
                    type: currentData.type, // Explicitly preserve type first
                    name: currentData.name, // Explicitly preserve name  
                    ...currentData, // Include any other existing properties
                    ...newParameters // Override with new parameters
                };
            }

            // Legacy DRT per-element toggle is deprecated; never persist it.
            if (Object.prototype.hasOwnProperty.call(updatedData, 'detection_response_task_enabled')) {
                delete updatedData.detection_response_task_enabled;
            }
            if (updatedData.parameters && typeof updatedData.parameters === 'object') {
                if (Object.prototype.hasOwnProperty.call(updatedData.parameters, 'detection_response_task_enabled')) {
                    delete updatedData.parameters.detection_response_task_enabled;
                }
            }

            // WCST-like: keep output clean when toggling response device.
            // If the user switches to mouse, remove keyboard-only choice_keys.
            // If the user switches to keyboard, remove mouse-only mouse_response_mode.
            try {
                const isWcst = (updatedData.type === 'soc-subtask-wcst-like' || updatedData.type === 'wcst-like');
                if (isWcst) {
                    const rawDevice = (updatedData.response_device ?? currentData.response_device ?? 'keyboard').toString().trim().toLowerCase();
                    const device = (rawDevice === 'mouse') ? 'mouse' : 'keyboard';

                    const containers = [];
                    if (updatedData && typeof updatedData === 'object') containers.push(updatedData);
                    if (updatedData.parameters && typeof updatedData.parameters === 'object') containers.push(updatedData.parameters);

                    for (const c of containers) {
                        if (!c || typeof c !== 'object') continue;
                        if (device === 'mouse') {
                            if (Object.prototype.hasOwnProperty.call(c, 'choice_keys')) delete c.choice_keys;
                        } else {
                            if (Object.prototype.hasOwnProperty.call(c, 'mouse_response_mode')) delete c.mouse_response_mode;
                        }
                    }
                }
            } catch {
                // ignore
            }

            // Stroop Block: keep output clean and consistent with effective device/mode.
            try {
                const isBlock = (updatedData.type === 'block');
                if (isBlock) {
                    const blockType = (updatedData.block_component_type ?? updatedData.component_type ?? '').toString();
                    if (blockType === 'stroop-trial') {
                        const defaultDevice = (document.getElementById('stroopDefaultResponseDevice')?.value || 'keyboard').toString();
                        const defaultMode = (document.getElementById('stroopDefaultResponseMode')?.value || 'color_naming').toString();

                        const containers = [];
                        if (updatedData && typeof updatedData === 'object') containers.push(updatedData);
                        if (updatedData.parameters && typeof updatedData.parameters === 'object') containers.push(updatedData.parameters);

                        // Determine effective values from the top-level block fields (same across containers)
                        const rawDevice = (updatedData.stroop_response_device ?? 'inherit').toString();
                        const rawMode = (updatedData.stroop_response_mode ?? 'inherit').toString();
                        const effectiveDevice = (rawDevice === 'inherit' || rawDevice === '') ? defaultDevice : rawDevice;
                        const effectiveMode = (rawMode === 'inherit' || rawMode === '') ? defaultMode : rawMode;

                        for (const c of containers) {
                            if (!c || typeof c !== 'object') continue;

                            if (Object.prototype.hasOwnProperty.call(c, 'stroop_ink_color_options')) {
                                delete c.stroop_ink_color_options;
                            }

                            if (effectiveDevice === 'mouse') {
                                if (Object.prototype.hasOwnProperty.call(c, 'stroop_choice_keys')) delete c.stroop_choice_keys;
                                if (Object.prototype.hasOwnProperty.call(c, 'stroop_congruent_key')) delete c.stroop_congruent_key;
                                if (Object.prototype.hasOwnProperty.call(c, 'stroop_incongruent_key')) delete c.stroop_incongruent_key;
                            } else if (effectiveMode === 'congruency') {
                                if (Object.prototype.hasOwnProperty.call(c, 'stroop_choice_keys')) delete c.stroop_choice_keys;
                            } else {
                                if (Object.prototype.hasOwnProperty.call(c, 'stroop_congruent_key')) delete c.stroop_congruent_key;
                                if (Object.prototype.hasOwnProperty.call(c, 'stroop_incongruent_key')) delete c.stroop_incongruent_key;
                            }
                        }
                    }
                }
            } catch {
                // ignore
            }
            
            // Final safety check - ensure type is never lost
            if (!updatedData.type && currentData.type) {
                updatedData.type = currentData.type;
                console.log('Applied final type safety check');
            }
            
            console.log('Updated component data after save:', updatedData);

            updatedData.label = this._readLabelFromModal(modalBody);
            this._updateCardLabel(this.jsonBuilder.currentEditingComponent, updatedData.label);
            this.jsonBuilder.currentEditingComponent.dataset.componentData = JSON.stringify(updatedData);
            console.log('Updated component DOM data:', updatedData);
            console.log('Updated parameters:', updatedData.parameters);
        } catch (e) {
            console.warn('Failed to update component DOM data:', e);
        }

        // Update JSON only - don't re-render timeline since DOM is already updated
        this.jsonBuilder.updateJSON();

        // Close modal
        const paramModal = document.getElementById('parameterModal');
        const bootstrapModal = bootstrap.Modal.getInstance(paramModal);
        if (bootstrapModal) {
            bootstrapModal.hide();
        }
    }

    getExperimentDefault(paramName) {
        const experimentDefaults = this.jsonBuilder.getCurrentRDMParameters();
        const parameterMappings = {
            'coherence': 'rdm_coherence',
            'direction': 'rdm_direction', 
            'speed': 'rdm_speed',
            'stimulus_duration': 'rdm_stimulus_duration',
            'total_dots': 'rdm_total_dots',
            'dot_size': 'rdm_dot_size',
            'aperture_diameter': 'rdm_aperture_diameter'
        };
        
        const formFieldName = parameterMappings[paramName];
        if (formFieldName && experimentDefaults.hasOwnProperty(formFieldName)) {
            return experimentDefaults[formFieldName];
        }
        
        return undefined;
    }

    // ── Label field helpers ──────────────────────────────────────────────────

    _prependLabelFieldToModal(modalBody, component) {
        if (!modalBody) return;
        if (modalBody.querySelector('#cf-label-wrapper')) return; // already injected
        const currentLabel = ((component?.label ?? component?.parameters?.label) ?? '').toString();
        const escaped = currentLabel.replace(/"/g, '&quot;');
        const wrapper = document.createElement('div');
        wrapper.className = 'mb-3 border-bottom pb-3';
        wrapper.id = 'cf-label-wrapper';
        wrapper.innerHTML = `
            <label for="cf-label-input" class="form-label fw-semibold">
                <i class="fas fa-tag me-1 text-muted"></i>Component Label
            </label>
            <input type="text" class="form-control" id="cf-label-input"
                   placeholder="Optional label shown in the timeline"
                   value="${escaped}">
            <div class="form-text">A short descriptive label displayed under the component name in the timeline. Does not affect experiment logic.</div>
        `;
        modalBody.prepend(wrapper);
    }

    _readLabelFromModal(modalBody) {
        if (!modalBody) return '';
        const input = modalBody.querySelector('#cf-label-input');
        return input ? input.value.trim() : '';
    }

    _updateCardLabel(componentElement, label) {
        if (!componentElement) return;
        const subtitle = componentElement.querySelector('.cf-component-label');
        if (!subtitle) return;
        const labelText = (label ?? '').toString().trim();
        const type = (componentElement.dataset.componentType ?? '').toString();
        if (labelText) {
            const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            subtitle.innerHTML = `<i class="fas fa-tag me-1" style="font-size:0.75em;opacity:0.6;"></i>${esc(labelText)}`;
        } else {
            subtitle.textContent = type || '';
        }
    }

}
