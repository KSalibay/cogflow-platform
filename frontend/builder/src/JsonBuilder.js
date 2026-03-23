/**
 * CogFlow Builder - Main Application Class
 * 
 * A modular web application for generating JSON parameter files
 * for experimental psychology tasks compatible with jsPsych and JATOS
 */

try { console.log('[BuilderDebug] Loaded JsonBuilder.js build: 20260309-1'); } catch { /* ignore */ }

class JsonBuilder {
    constructor() {
        this.timeline = [];
        this.experimentType = 'trial-based';
        this.currentTaskType = 'rdm';
        this.dataCollection = {
            'reaction-time': true,
            'accuracy': true,
            'correctness': false,
            'eye-tracking': false,
            // Response modalities are configured via the "Default Response" dropdown
        };
        this.currentComponent = null;
        this.componentCounter = 0;
        this.templates = {};
        
        // Initialize modules
        this.dataModules = null;
        this.trialManager = null;
        this.timelineBuilder = null;
        this.schemaValidator = null;
        
        // Bind methods
        this.updateJSON = this.updateJSON.bind(this);
        this.onExperimentTypeChange = this.onExperimentTypeChange.bind(this);
        this.onDataCollectionChange = this.onDataCollectionChange.bind(this);
        this.onTaskTypeChange = this.onTaskTypeChange.bind(this);
    }
    /**
     * Show/hide UI sections based on current settings
     */
    updateConditionalUI() {
        const defaultDevice = document.getElementById('defaultResponseDevice')?.value || 'keyboard';

        const feedbackType = document.getElementById('defaultFeedbackType')?.value || 'off';

        const mouseSettings = document.getElementById('mouseResponseSettings');
        if (mouseSettings) {
            const showMouse = (defaultDevice === 'mouse');
            mouseSettings.style.display = showMouse ? 'block' : 'none';

            // Also disable hidden inputs so they don't clutter tab order
            // and so the UI state is unambiguous.
            mouseSettings.querySelectorAll('input, select, textarea').forEach((el) => {
                el.disabled = !showMouse;
            });
        }

        // Hide Response Keys unless the default response is keyboard
        document.querySelectorAll('#responseKeys').forEach((input) => {
            const row = input.closest('.parameter-row');
            if (row) {
                row.style.display = (defaultDevice === 'keyboard') ? '' : 'none';
            }
            input.disabled = (defaultDevice !== 'keyboard');
        });

        // Feedback duration shown only when feedback is enabled
        const feedbackDurationRow = document.getElementById('feedbackDurationRow');
        const feedbackDurationInput = document.getElementById('defaultFeedbackDuration');
        if (feedbackDurationRow && feedbackDurationInput) {
            const show = feedbackType !== 'off';
            feedbackDurationRow.style.display = show ? '' : 'none';
            feedbackDurationInput.disabled = !show;
        }

        // N-back defaults: only show template HTML when render_mode=custom_html
        const nbackRenderMode = (document.getElementById('nbackDefaultRenderMode')?.value || 'token').toString();
        const nbackTemplateRow = document.getElementById('nbackDefaultTemplateRow');
        const nbackTemplateEl = document.getElementById('nbackDefaultTemplateHtml');
        if (nbackTemplateRow && nbackTemplateEl) {
            const show = (nbackRenderMode === 'custom_html');
            nbackTemplateRow.style.display = show ? '' : 'none';
            nbackTemplateEl.disabled = !show;
        }

        // N-back defaults: mouse hides keyboard controls; Show Buttons only relevant for mouse
        const nbackDevice = (document.getElementById('nbackDefaultDevice')?.value || 'keyboard').toString();
        const effectiveNbackDevice = (nbackDevice === 'inherit') ? (defaultDevice || 'keyboard') : nbackDevice;

        const keyRowIds = ['nbackDefaultGoKeyRow', 'nbackDefaultMatchKeyRow', 'nbackDefaultNonmatchKeyRow'];
        for (const id of keyRowIds) {
            const row = document.getElementById(id);
            if (!row) continue;
            const show = (effectiveNbackDevice === 'keyboard');
            row.style.display = show ? '' : 'none';
            row.querySelectorAll('input, select, textarea').forEach((el) => {
                el.disabled = !show;
            });
        }

        const buttonsRow = document.getElementById('nbackDefaultShowButtonsRow');
        if (buttonsRow) {
            const show = (effectiveNbackDevice === 'mouse');
            buttonsRow.style.display = show ? '' : 'none';
            buttonsRow.querySelectorAll('input, select, textarea').forEach((el) => {
                el.disabled = !show;
            });
        }
    }

    applyGaborResponseTaskVisibility() {
        const mode = document.getElementById('gaborResponseTask')?.value || 'discriminate_tilt';
        const directionGroup = document.getElementById('gaborDirectionKeysGroup');
        const detectionGroup = document.getElementById('gaborDetectionKeysGroup');

        if (directionGroup) {
            directionGroup.style.display = (mode === 'discriminate_tilt') ? '' : 'none';
        }
        if (detectionGroup) {
            detectionGroup.style.display = (mode === 'detect_target') ? '' : 'none';
        }
    }

    wrapParameterFormsInCollapsibles() {
        const root = document.getElementById('parameterForms');
        if (!root) return;

        const groups = Array.from(root.querySelectorAll(':scope > .parameter-group'));
        if (!groups.length) return;

        const shouldCollapseGroup = (group, titleText) => {
            const id = (group?.id || '').toString();
            if (titleText === 'Trial Configuration' || titleText === 'Continuous Configuration') return true;
            if (id && /ExperimentParameters$/i.test(id)) return true;
            if (id && /ExperimentParameters/i.test(id)) return true;
            return false;
        };

        const shouldStartOpen = (titleText) => {
            // Keep the high-level configuration visible; collapse long defaults.
            if (titleText === 'Trial Configuration' || titleText === 'Continuous Configuration') return true;
            return false;
        };

        for (let i = 0; i < groups.length; i += 1) {
            const group = groups[i];
            if (!group || group.classList.contains('cf-collapsible')) continue;

            const titleEl = group.querySelector(':scope > .group-title');
            if (!titleEl) continue;

            const titleText = (titleEl.textContent || '').trim();
            if (!shouldCollapseGroup(group, titleText)) continue;

            const openByDefault = shouldStartOpen(titleText);
            const collapseId = `cf-param-collapse-${group.id || i}`;

            // Move all content after the title into the collapse body.
            const inner = document.createElement('div');
            inner.className = 'cf-collapse-body';

            while (titleEl.nextSibling) {
                inner.appendChild(titleEl.nextSibling);
            }

            const collapse = document.createElement('div');
            collapse.className = openByDefault ? 'collapse show' : 'collapse';
            collapse.id = collapseId;
            collapse.appendChild(inner);

            // Build a header that contains a toggle (left) and preserves any preview button (right).
            const header = document.createElement('div');
            header.className = `${titleEl.className} cf-collapse-header`;

            const previewBtn = titleEl.querySelector('button');
            if (previewBtn) {
                previewBtn.remove();
            }

            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'btn btn-link cf-collapse-toggle p-0 text-start text-decoration-none';
            toggle.setAttribute('data-bs-toggle', 'collapse');
            toggle.setAttribute('data-bs-target', `#${collapseId}`);
            toggle.setAttribute('aria-controls', collapseId);
            toggle.setAttribute('aria-expanded', openByDefault ? 'true' : 'false');

            // Preserve the original title HTML (e.g., small helper text).
            toggle.innerHTML = `
                <span class="cf-collapse-title">${titleEl.innerHTML}</span>
                <span class="cf-collapse-chevron"><i class="fas fa-chevron-down"></i></span>
            `;

            header.appendChild(toggle);
            if (previewBtn) header.appendChild(previewBtn);

            titleEl.replaceWith(header);
            group.appendChild(collapse);
            group.classList.add('cf-collapsible');
        }
    }

    applyGaborPatchBorderVisibility() {
        const enabled = !!document.getElementById('gaborPatchBorderEnabled')?.checked;
        const details = document.getElementById('gaborPatchBorderDetails');
        if (!details) return;
        details.style.display = enabled ? '' : 'none';
    }

    applyGaborCueVisibility() {
        const spatialEnabled = !!document.getElementById('gaborSpatialCueEnabled')?.checked;
        const spatialDetails = document.getElementById('gaborSpatialCueDetails');

        if (!spatialEnabled) {
            const opts = document.getElementById('gaborSpatialCueOptions');
            const prob = document.getElementById('gaborSpatialCueProbability');
            if (opts) opts.value = 'none,left,right,both';
            if (prob) prob.value = '1';
        }
        if (spatialDetails) {
            spatialDetails.style.display = spatialEnabled ? '' : 'none';
        }

        const valueEnabled = !!document.getElementById('gaborValueCueEnabled')?.checked;
        const valueDetails = document.getElementById('gaborValueCueDetails');

        if (!valueEnabled) {
            const lv = document.getElementById('gaborLeftValueOptions');
            const rv = document.getElementById('gaborRightValueOptions');
            const prob = document.getElementById('gaborValueCueProbability');
            if (lv) lv.value = 'neutral,high,low';
            if (rv) rv.value = 'neutral,high,low';
            if (prob) prob.value = '1';
        }
        if (valueDetails) {
            valueDetails.style.display = valueEnabled ? '' : 'none';
        }
    }

    bindNbackSettingsUI() {
        const deviceEl = document.getElementById('nbackDefaultDevice');
        const renderEl = document.getElementById('nbackDefaultRenderMode');

        if (deviceEl) {
            deviceEl.addEventListener('change', () => this.updateConditionalUI());
        }
        if (renderEl) {
            renderEl.addEventListener('change', () => this.updateConditionalUI());
        }
    }

    bindGaborSettingsUI() {
        const responseTaskEl = document.getElementById('gaborResponseTask');
        if (!responseTaskEl) return;

        // Prevent stacking listeners across re-renders.
        if (responseTaskEl.dataset.bound === '1') {
            this.applyGaborResponseTaskVisibility();
            this.applyGaborPatchBorderVisibility();
            this.applyGaborCueVisibility();
            return;
        }

        responseTaskEl.dataset.bound = '1';
        responseTaskEl.addEventListener('change', () => {
            this.applyGaborResponseTaskVisibility();
            this.updateJSON();
        });

        const borderToggleEl = document.getElementById('gaborPatchBorderEnabled');
        if (borderToggleEl && borderToggleEl.dataset.bound !== '1') {
            borderToggleEl.dataset.bound = '1';
            borderToggleEl.addEventListener('change', () => {
                this.applyGaborPatchBorderVisibility();
                this.updateJSON();
            });
        }

        const spatialCueToggleEl = document.getElementById('gaborSpatialCueEnabled');
        if (spatialCueToggleEl && spatialCueToggleEl.dataset.bound !== '1') {
            spatialCueToggleEl.dataset.bound = '1';
            spatialCueToggleEl.addEventListener('change', () => {
                this.applyGaborCueVisibility();
                this.updateJSON();
            });
        }

        const valueCueToggleEl = document.getElementById('gaborValueCueEnabled');
        if (valueCueToggleEl && valueCueToggleEl.dataset.bound !== '1') {
            valueCueToggleEl.dataset.bound = '1';
            valueCueToggleEl.addEventListener('change', () => {
                this.applyGaborCueVisibility();
                this.updateJSON();
            });
        }

        this.applyGaborResponseTaskVisibility();
        this.applyGaborPatchBorderVisibility();
        this.applyGaborCueVisibility();
    }

    applyStroopResponseVisibility() {
        const mode = (document.getElementById('stroopDefaultResponseMode')?.value || 'color_naming').toString();
        const device = (document.getElementById('stroopDefaultResponseDevice')?.value || 'keyboard').toString();

        const colorNamingKeys = document.getElementById('stroopColorNamingKeysGroup');
        const congruencyKeys = document.getElementById('stroopCongruencyKeysGroup');
        const keyboardOnlyNote = document.getElementById('stroopKeyboardOnlyNote');

        const usingKeyboard = device === 'keyboard';
        if (keyboardOnlyNote) keyboardOnlyNote.style.display = usingKeyboard ? 'none' : '';

        if (colorNamingKeys) {
            colorNamingKeys.style.display = (mode === 'color_naming' && usingKeyboard) ? '' : 'none';
        }
        if (congruencyKeys) {
            congruencyKeys.style.display = (mode === 'congruency' && usingKeyboard) ? '' : 'none';
        }
    }

    applySimonResponseVisibility() {
        const device = (document.getElementById('simonDefaultResponseDevice')?.value || 'keyboard').toString();

        const keyboardOnlyNote = document.getElementById('simonKeyboardOnlyNote');
        const keyboardGroup = document.getElementById('simonKeyboardKeysGroup');

        const usingKeyboard = device === 'keyboard';
        if (keyboardOnlyNote) keyboardOnlyNote.style.display = usingKeyboard ? 'none' : '';
        if (keyboardGroup) keyboardGroup.style.display = usingKeyboard ? '' : 'none';
    }

    renderStroopStimuliRows() {
        const sizeEl = document.getElementById('stroopStimulusSetSize');
        const rowsEl = document.getElementById('stroopStimuliRows');
        if (!sizeEl || !rowsEl) return;

        const rawN = Number.parseInt(sizeEl.value || '4', 10);
        const n = Number.isFinite(rawN) ? Math.max(2, Math.min(7, rawN)) : 4;
        if (`${n}` !== `${rawN}`) sizeEl.value = `${n}`;

        // Preserve existing values when possible
        const existing = {};
        for (let i = 1; i <= 7; i += 1) {
            const nameEl = document.getElementById(`stroopStimulusName_${i}`);
            const colorEl = document.getElementById(`stroopStimulusColor_${i}`);
            if (nameEl || colorEl) {
                existing[i] = {
                    name: nameEl?.value,
                    color: colorEl?.value
                };
            }
        }

        const defaults = [
            { name: 'RED', color: '#ff0000' },
            { name: 'GREEN', color: '#00aa00' },
            { name: 'BLUE', color: '#0066ff' },
            { name: 'YELLOW', color: '#ffd200' },
            { name: 'PURPLE', color: '#7a3cff' },
            { name: 'ORANGE', color: '#ff7a00' },
            { name: 'PINK', color: '#ff3c8f' }
        ];

        let html = '';
        for (let i = 1; i <= 7; i += 1) {
            const rowVisible = i <= n;
            const fallback = defaults[i - 1] || { name: `COLOR_${i}`, color: '#ffffff' };
            const nameVal = (existing[i]?.name ?? fallback.name).toString();
            const colorVal = (existing[i]?.color ?? fallback.color).toString();

            html += `
                <div class="parameter-row" style="${rowVisible ? '' : 'display:none;'}">
                    <label class="parameter-label">Stimulus ${i}:</label>
                    <div class="parameter-input d-flex gap-2">
                        <input type="text" class="form-control" id="stroopStimulusName_${i}" value="${nameVal.replaceAll('"', '&quot;')}">
                        <input type="color" class="form-control" style="max-width: 80px;" id="stroopStimulusColor_${i}" value="${colorVal}">
                    </div>
                    <div class="parameter-help">Name (word) + ink color (hex)</div>
                </div>
            `;
        }

        rowsEl.innerHTML = html;

        // Ensure changes propagate to JSON
        rowsEl.querySelectorAll('input').forEach(el => {
            el.addEventListener('change', this.updateJSON);
        });
    }

    bindStroopSettingsUI() {
        const sizeEl = document.getElementById('stroopStimulusSetSize');
        if (!sizeEl) return;

        if (sizeEl.dataset.bound === '1') {
            this.renderStroopStimuliRows();
            this.applyStroopResponseVisibility();
            return;
        }

        sizeEl.dataset.bound = '1';
        sizeEl.addEventListener('change', () => {
            this.renderStroopStimuliRows();
            this.updateJSON();
        });

        const modeEl = document.getElementById('stroopDefaultResponseMode');
        if (modeEl && modeEl.dataset.bound !== '1') {
            modeEl.dataset.bound = '1';
            modeEl.addEventListener('change', () => {
                this.applyStroopResponseVisibility();
                this.updateJSON();
            });
        }

        const deviceEl = document.getElementById('stroopDefaultResponseDevice');
        if (deviceEl && deviceEl.dataset.bound !== '1') {
            deviceEl.dataset.bound = '1';
            deviceEl.addEventListener('change', () => {
                this.applyStroopResponseVisibility();
                this.updateJSON();
            });
        }

        this.renderStroopStimuliRows();
        this.applyStroopResponseVisibility();
    }

    applyEmotionalStroopWordListVisibility() {
        const countRaw = Number.parseInt(document.getElementById('emotionalStroopWordListCount')?.value || '2', 10);
        const count = Number.isFinite(countRaw) ? (countRaw === 3 ? 3 : 2) : 2;
        const g3 = document.getElementById('emotionalStroopWordList3Group');
        if (g3) g3.style.display = (count === 3) ? '' : 'none';
    }

    bindEmotionalStroopWordListUI() {
        // No-op unless the Emotional Stroop panel is currently rendered.
        const countEl = document.getElementById('emotionalStroopWordListCount');
        if (!countEl) return;

        if (countEl.dataset.bound !== '1') {
            countEl.dataset.bound = '1';
            countEl.addEventListener('change', () => {
                this.applyEmotionalStroopWordListVisibility();
                this.updateJSON();
            });
        }

        [
            'emotionalStroopWordList1Label',
            'emotionalStroopWordList1Words',
            'emotionalStroopWordList2Label',
            'emotionalStroopWordList2Words',
            'emotionalStroopWordList3Label',
            'emotionalStroopWordList3Words'
        ].forEach((id) => {
            const el = document.getElementById(id);
            if (!el || el.dataset.bound === '1') return;
            el.dataset.bound = '1';
            el.addEventListener('input', () => this.updateJSON());
        });

        this.applyEmotionalStroopWordListVisibility();
    }

    bindSimonSettingsUI() {
        const devEl = document.getElementById('simonDefaultResponseDevice');
        if (!devEl) return;

        if (devEl.dataset.bound === '1') {
            this.applySimonResponseVisibility();
            return;
        }

        devEl.dataset.bound = '1';
        devEl.addEventListener('change', () => {
            this.applySimonResponseVisibility();
            this.updateJSON();
        });

        // Bind color/name inputs
        ['simonStimulusName_1', 'simonStimulusColor_1', 'simonStimulusName_2', 'simonStimulusColor_2',
            'simonLeftKey', 'simonRightKey', 'simonCircleDiameterPx',
            'simonStimulusDurationMs', 'simonTrialDurationMs', 'simonItiMs'
        ].forEach(id => {
            const el = document.getElementById(id);
            if (!el || el.dataset.bound === '1') return;
            el.dataset.bound = '1';
            el.addEventListener('change', () => this.updateJSON());
        });

        this.applySimonResponseVisibility();
    }

    applyTaskSwitchingCustomSetVisibility() {
        const mode = (document.getElementById('taskSwitchingStimulusSetMode')?.value || 'letters_numbers').toString();
        const customRoot = document.getElementById('taskSwitchingCustomSets');
        if (!customRoot) return;

        const show = mode === 'custom';
        customRoot.style.display = show ? '' : 'none';
        customRoot.querySelectorAll('input, select, textarea').forEach((el) => {
            el.disabled = !show;
        });
    }

    applyTaskSwitchingCueVisibility() {
        const cueType = (document.getElementById('taskSwitchingCueType')?.value || 'explicit').toString();
        const explicitRoot = document.getElementById('taskSwitchingCueExplicitGroup');
        const positionRoot = document.getElementById('taskSwitchingCuePositionGroup');
        const colorRoot = document.getElementById('taskSwitchingCueColorGroup');

        const showExplicit = cueType === 'explicit';
        const showPosition = cueType === 'position';
        const showColor = cueType === 'color';

        if (explicitRoot) {
            explicitRoot.style.display = showExplicit ? '' : 'none';
            explicitRoot.querySelectorAll('input, select, textarea').forEach((el) => {
                el.disabled = !showExplicit;
            });
        }

        if (positionRoot) {
            positionRoot.style.display = showPosition ? '' : 'none';
            positionRoot.querySelectorAll('input, select, textarea').forEach((el) => {
                el.disabled = !showPosition;
            });
        }

        if (colorRoot) {
            colorRoot.style.display = showColor ? '' : 'none';
            colorRoot.querySelectorAll('input, select, textarea').forEach((el) => {
                el.disabled = !showColor;
            });
        }
    }

    bindTaskSwitchingSettingsUI() {
        const modeEl = document.getElementById('taskSwitchingStimulusSetMode');
        if (!modeEl) return;

        if (modeEl.dataset.bound === '1') {
            this.applyTaskSwitchingCustomSetVisibility();
            this.applyTaskSwitchingCueVisibility();
            return;
        }

        modeEl.dataset.bound = '1';
        modeEl.addEventListener('change', () => {
            this.applyTaskSwitchingCustomSetVisibility();
            this.updateJSON();
        });

        const cueTypeEl = document.getElementById('taskSwitchingCueType');
        if (cueTypeEl && cueTypeEl.dataset.bound !== '1') {
            cueTypeEl.dataset.bound = '1';
            cueTypeEl.addEventListener('change', () => {
                this.applyTaskSwitchingCueVisibility();
                this.updateJSON();
            });
        }

        [
            'taskSwitchingStimulusPosition',
            'taskSwitchingBorderEnabled',
            'taskSwitchingLeftKey',
            'taskSwitchingRightKey',
            'taskSwitchingCueType',
            'taskSwitchingTask1CueText',
            'taskSwitchingTask2CueText',
            'taskSwitchingCueFontSizePx',
            'taskSwitchingCueDurationMs',
            'taskSwitchingCueGapMs',
            'taskSwitchingCueColorHex',
            'taskSwitchingTask1Position',
            'taskSwitchingTask2Position',
            'taskSwitchingTask1ColorHex',
            'taskSwitchingTask2ColorHex',
            'taskSwitchingTask1CategoryA',
            'taskSwitchingTask1CategoryB',
            'taskSwitchingTask2CategoryA',
            'taskSwitchingTask2CategoryB'
        ].forEach((id) => {
            const el = document.getElementById(id);
            if (!el || el.dataset.bound === '1') return;
            el.dataset.bound = '1';
            el.addEventListener('change', () => this.updateJSON());
            el.addEventListener('input', () => this.updateJSON());
        });

        this.applyTaskSwitchingCustomSetVisibility();
        this.applyTaskSwitchingCueVisibility();
    }

    bindPvtSettingsUI() {
        const devEl = document.getElementById('pvtDefaultResponseDevice');
        if (!devEl) return;

        if (devEl.dataset.bound === '1') {
            this.applyPvtResponseVisibility();
            return;
        }

        devEl.dataset.bound = '1';
        devEl.addEventListener('change', () => {
            this.applyPvtResponseVisibility();
            this.updateJSON();
        });

        const fbEl = document.getElementById('pvtFeedbackEnabled');
        if (fbEl && fbEl.dataset.bound !== '1') {
            fbEl.dataset.bound = '1';
            fbEl.addEventListener('change', () => {
                this.applyPvtFeedbackVisibility();
                this.updateJSON();
            });
        }

        const extraEl = document.getElementById('pvtAddTrialPerFalseStart');
        if (extraEl && extraEl.dataset.bound !== '1') {
            extraEl.dataset.bound = '1';
            extraEl.addEventListener('change', () => this.updateJSON());
        }

        // Bind inputs
        [
            'pvtResponseKey',
            'pvtForeperiodMs',
            'pvtTrialDurationMs',
            'pvtItiMs',
            'pvtFeedbackMessage'
        ].forEach(id => {
            const el = document.getElementById(id);
            if (!el || el.dataset.bound === '1') return;
            el.dataset.bound = '1';
            el.addEventListener('change', () => this.updateJSON());
        });

        this.applyPvtResponseVisibility();
        this.applyPvtFeedbackVisibility();
    }

    applyPvtResponseVisibility() {
        const dev = (document.getElementById('pvtDefaultResponseDevice')?.value || 'keyboard').toString();
        const keyGroup = document.getElementById('pvtKeyboardKeysGroup');
        const note = document.getElementById('pvtKeyboardOnlyNote');
        if (!keyGroup || !note) return;

        const usesKeyboard = (dev === 'keyboard' || dev === 'both');
        keyGroup.style.display = usesKeyboard ? '' : 'none';
        note.style.display = usesKeyboard ? 'none' : '';
    }

    applyPvtFeedbackVisibility() {
        const enabled = !!document.getElementById('pvtFeedbackEnabled')?.checked;
        const group = document.getElementById('pvtFeedbackMessageGroup');
        if (!group) return;
        group.style.display = enabled ? '' : 'none';
    }

    findRewardSettingsTimelineElements() {
        const timelineContainer = document.getElementById('timelineComponents');
        if (!timelineContainer) return [];

        const els = Array.from(timelineContainer.querySelectorAll('.timeline-component'));
        const matches = [];

        for (const el of els) {
            const directType = el.dataset.componentType;
            if (directType === 'reward-settings') {
                matches.push(el);
                continue;
            }
            try {
                const d = JSON.parse(el.dataset.componentData || '{}');
                if (d && d.type === 'reward-settings') matches.push(el);
            } catch {
                // ignore
            }
        }

        return matches;
    }

    syncRewardsToggleFromTimeline() {
        const toggle = document.getElementById('rewardsEnabled');
        if (!toggle) return;
        const any = this.findRewardSettingsTimelineElements().length > 0;
        toggle.checked = any;
    }

    applyRewardsEnabled(enabled) {
        const timelineContainer = document.getElementById('timelineComponents');
        if (!timelineContainer) return;

        const existing = this.findRewardSettingsTimelineElements();

        if (enabled) {
            if (existing.length > 0) return;

            // Build a component definition from the library (so defaults stay consistent).
            const defs = this.getComponentDefinitions();
            const rewardDef = defs.find(d => d && (d.id === 'reward-settings' || d.type === 'reward-settings'));
            if (!rewardDef) {
                console.warn('Reward Settings component definition not found');
                return;
            }

            // Add via the normal path (creates DOM + componentData).
            this.addComponentToTimeline(rewardDef);

            // Move it near the top: after any instruction-like prefaces, otherwise first.
            const added = this.findRewardSettingsTimelineElements().slice(-1)[0];
            if (added) {
                added.dataset.autoAddedByRewardsToggle = '1';

                const items = Array.from(timelineContainer.querySelectorAll('.timeline-component'));
                const instructionLike = items.filter(el => {
                    const t = el.dataset.componentType;
                    const builderId = el.dataset.builderComponentId;
                    return t === 'html-keyboard-response' && (builderId === 'instructions' || builderId === 'eye-tracking-calibration-instructions');
                });

                const anchor = instructionLike.length > 0 ? instructionLike[instructionLike.length - 1] : null;
                if (anchor && anchor.nextSibling) {
                    timelineContainer.insertBefore(added, anchor.nextSibling);
                } else if (anchor) {
                    timelineContainer.appendChild(added);
                } else {
                    const first = timelineContainer.querySelector('.timeline-component');
                    if (first) timelineContainer.insertBefore(added, first);
                }
            }

            // Hide empty-state if needed
            const emptyState = timelineContainer.querySelector('.empty-timeline');
            if (emptyState) emptyState.style.display = 'none';
            return;
        }

        // Disable: remove all reward-settings components.
        for (const el of existing) {
            el.remove();
        }

        // Restore empty state if needed
        const hasAny = timelineContainer.querySelector('.timeline-component');
        const emptyState = timelineContainer.querySelector('.empty-timeline');
        if (emptyState) emptyState.style.display = hasAny ? 'none' : '';
    }

    bindRewardsToggleUI() {
        const toggle = document.getElementById('rewardsEnabled');
        if (!toggle) return;

        // Rewards are supported for the task types that output RT and correctness/accuracy.
        // Allow enabling in any experiment type; unsupported tasks simply won't accrue points.
        toggle.disabled = false;
        toggle.title = (this.experimentType === 'trial-based')
            ? ''
            : 'Rewards may not be supported for all continuous-task plugins.';

        // Ensure UI reflects timeline state when panel is re-rendered.
        this.syncRewardsToggleFromTimeline();

        if (toggle.dataset.bound === '1') return;
        toggle.dataset.bound = '1';

        toggle.addEventListener('change', () => {
            const enabled = !!toggle.checked;
            this.applyRewardsEnabled(enabled);
            this.updateJSON();
        });
    }

    /**
     * Initialize the application
     */
    initialize() {
        this.initializeModules();
        this.setupEventListeners();

        // Track current task type for safe switching
        this.currentTaskType = document.getElementById('taskType')?.value || 'rdm';

        // Ensure JS state matches the actual checkbox state on load
        this.syncDataCollectionFromUI();

        this.updateExperimentTypeUI(); // Initialize parameter forms (task-scoped)
        this.loadComponentLibrary();

        // Only auto-load the RDM sample template when RDM is selected.
        if (this.currentTaskType === 'rdm') {
            this.loadDefaultRDMTemplate();
        }
        this.updateJSON();
        
        console.log('CogFlow Builder initialized successfully');
    }

    setAccessibilityMode(enabled) {
        const on = !!enabled;
        document.documentElement.classList.toggle('cf-a11y', on);
        try {
            localStorage.setItem('cogflow_builder_a11y', on ? '1' : '0');
        } catch (e) {
            // Ignore storage errors
        }
    }
    /**
     * Initialize all modules
     */
    initializeModules() {
        try {
            this.dataModules = new DataCollectionModules();
            this.trialManager = new TrialManager(this);
            this.timelineBuilder = new TimelineBuilder(this);
            this.schemaValidator = new JSPsychSchemas();
            
            console.log('All modules initialized successfully');
        } catch (error) {
            console.error('Error initializing modules:', error);
        }
    }

    /**
     * Set up event listeners for UI interactions
     */
    setupEventListeners() {
        // Accessibility Mode toggle (footer)
        const a11yToggle = document.getElementById('accessibilityModeToggle');
        if (a11yToggle && a11yToggle.dataset.bound !== '1') {
            a11yToggle.dataset.bound = '1';
            a11yToggle.checked = document.documentElement.classList.contains('cf-a11y');

            a11yToggle.addEventListener('change', () => {
                this.setAccessibilityMode(!!a11yToggle.checked);
            });
        }

        // Experiment type radio buttons
        document.querySelectorAll('input[name="experimentType"]').forEach(radio => {
            radio.addEventListener('change', this.onExperimentTypeChange);
        });

        // Data collection checkboxes (scoped)
        document.querySelectorAll('.data-collection-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', this.onDataCollectionChange);
        });

        // Task type dropdown
        const taskTypeEl = document.getElementById('taskType');
        if (taskTypeEl) {
            taskTypeEl.addEventListener('change', this.onTaskTypeChange);
        }

        // Experiment theme dropdown
        const themeEl = document.getElementById('experimentTheme');
        if (themeEl) {
            themeEl.addEventListener('change', () => {
                this.updateJSON();
            });
        }

        // Main action buttons
        document.getElementById('addComponentBtn').addEventListener('click', () => {
            this.showComponentLibrary();
        });

        const exportJsonBtn = document.getElementById('exportJsonBtn');
        if (exportJsonBtn) {
            exportJsonBtn.addEventListener('click', () => {
                this.exportJSON();
            });
        }

        // Assets folder upload -> Token Store assets + filename-to-URL index
        const assetsBtn = document.getElementById('uploadAssetsFolderBtn');
        const assetsInput = document.getElementById('assetsFolderInput');
        if (assetsBtn && assetsInput && assetsBtn.dataset.bound !== '1') {
            assetsBtn.dataset.bound = '1';

            assetsBtn.addEventListener('click', () => {
                try {
                    assetsInput.value = '';
                } catch {
                    // ignore
                }
                try {
                    assetsInput.click();
                } catch {
                    // ignore
                }
            });

            assetsInput.addEventListener('change', async () => {
                const files = Array.from(assetsInput.files || []);
                if (files.length === 0) return;
                try {
                    await this.uploadAssetDirectoryToTokenStore(files);
                } catch (e) {
                    console.error('uploadAssetDirectoryToTokenStore failed:', e);
                    this.showValidationResult('error', `Asset folder upload failed. (${e?.message || 'Unknown error'})`);
                }
            });
        }

        // Local JSON import -> Token Store upload (batch)
        const importBtn = document.getElementById('importLocalJsonBtn');
        const importInput = document.getElementById('importLocalJsonInput');
        if (importBtn && importInput && importBtn.dataset.bound !== '1') {
            importBtn.dataset.bound = '1';

            importBtn.addEventListener('click', () => {
                try {
                    // Re-selecting the same file(s) should re-trigger change.
                    importInput.value = '';
                } catch {
                    // ignore
                }
                try {
                    importInput.click();
                } catch {
                    // ignore
                }
            });

            importInput.addEventListener('change', async () => {
                const files = Array.from(importInput.files || []);
                if (files.length === 0) return;
                try {
                    await this.importLocalJsonFilesToTokenStore(files);
                } catch (e) {
                    console.error('importLocalJsonFilesToTokenStore failed:', e);
                    this.showValidationResult('error', `Import failed. (${e?.message || 'Unknown error'})`);
                }
            });
        }

        const prepBtn = document.getElementById('prepJatosPropsBtn');
        if (prepBtn) {
            prepBtn.addEventListener('click', () => {
                this.prepareJatosComponentPropertiesForTokenStoreBundle();
            });
        }

        const saveJsonBtn = document.getElementById('saveJsonBtn');
        if (saveJsonBtn) {
            saveJsonBtn.addEventListener('click', () => {
                this.saveJSON();
            });
        }

        document.getElementById('loadTemplateBtn').addEventListener('click', () => {
            this.loadTemplate();
        });

        document.getElementById('saveTemplateBtn').addEventListener('click', () => {
            this.saveTemplate();
        });

        document.getElementById('clearTimelineBtn').addEventListener('click', () => {
            this.clearTimeline();
        });

        document.getElementById('validateJsonBtn').addEventListener('click', () => {
            this.validateJSON();
        });

        document.getElementById('copyJsonBtn').addEventListener('click', () => {
            this.copyJSONToClipboard();
        });

        // Parameter modal
        const saveParametersBtn = document.getElementById('saveParametersBtn');
        if (saveParametersBtn) {
            // Use onclick so component-specific editors can override it cleanly.
            saveParametersBtn.onclick = () => {
                this.saveParameters();
            };
        }
        
        // Add event listener for preview button
        document.getElementById('previewComponentBtn').addEventListener('click', () => {
            this.previewCurrentComponent();
        });
    }

    getSharePointFolderUrl() {
        const key = 'cogflow_sharepoint_folder_url_v1';
        const legacyKey = 'psychjson_sharepoint_folder_url_v1';
        const last = (localStorage.getItem(key) || localStorage.getItem(legacyKey) || '').toString();

        const raw = prompt(
            'Enter SharePoint folder URL (will open in a new tab):\n\nExample: https://yourtenant.sharepoint.com/sites/YourSite/Shared%20Documents/YourFolder',
            last
        );
        if (raw === null) return null;

        const url = String(raw || '').trim();
        if (!url) return null;
        if (!/^https?:\/\//i.test(url)) {
            this.showValidationResult('error', 'SharePoint URL must start with http:// or https://');
            return null;
        }

        // Defensive: reject non-network schemes.
        if (/^(javascript:|data:|file:)/i.test(url)) {
            this.showValidationResult('error', 'Invalid URL scheme.');
            return null;
        }

        localStorage.setItem(key, url);
        localStorage.setItem(legacyKey, url);
        return url;
    }

    getTokenStoreBaseUrl() {
        // Allow hard-coded runtime override (useful for JATOS deployments).
        try {
            const globalUrl = window.COGFLOW_TOKEN_STORE_BASE_URL;
            if (typeof globalUrl === 'string' && globalUrl.trim()) {
                const trimmed = globalUrl.trim();
                if (/^https?:\/\//i.test(trimmed) && !/^(javascript:|data:|file:)/i.test(trimmed)) {
                    return trimmed.replace(/\/+$/, '');
                }
            }
        } catch {
            // ignore
        }

        const key = 'cogflow_token_store_base_url_v1';
        const legacyKey = 'psychjson_token_store_base_url_v1';
        const last = (localStorage.getItem(key) || localStorage.getItem(legacyKey) || '').toString();

        const raw = prompt(
            'Enter Token Store API base URL:\n\nExample: https://your-worker.yourname.workers.dev',
            last
        );
        if (raw === null) return null;

        let url = String(raw || '').trim();
        if (!url) return null;

        // QoL: if the user pastes a bare host like cool-star....workers.dev, assume https://
        if (!/^https?:\/\//i.test(url) && /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(\/.+)?$/.test(url)) {
            url = `https://${url}`;
        }

        if (!/^https?:\/\//i.test(url)) {
            this.showValidationResult('error', 'Token Store URL must start with http:// or https://');
            return null;
        }
        if (/^(javascript:|data:|file:)/i.test(url)) {
            this.showValidationResult('error', 'Invalid URL scheme.');
            return null;
        }

        const normalized = url.replace(/\/+$/, '');
        localStorage.setItem(key, normalized);
        localStorage.setItem(legacyKey, normalized);
        return normalized;
    }

    isInitialDeploymentMode() {
        return window.COGFLOW_INITIAL_DEPLOYMENT === true;
    }

    getTokenStoreRecords() {
        const key = 'cogflow_token_store_records_v1';
        const legacyKey = 'psychjson_token_store_records_v1';
        try {
            const raw = localStorage.getItem(key) || localStorage.getItem(legacyKey) || '';
            const parsed = raw ? JSON.parse(raw) : {};
            if (parsed && typeof parsed === 'object') return parsed;
        } catch {
            // ignore
        }
        return {};
    }

    getTokenStoreAssetIndex() {
        const key = 'cogflow_token_store_asset_index_v1';
        const legacyKey = 'psychjson_token_store_asset_index_v1';
        try {
            const raw = localStorage.getItem(key) || localStorage.getItem(legacyKey) || '';
            const parsed = raw ? JSON.parse(raw) : {};
            if (parsed && typeof parsed === 'object') return parsed;
        } catch {
            // ignore
        }
        return {};
    }

    setTokenStoreAssetIndex(index) {
        const key = 'cogflow_token_store_asset_index_v1';
        const legacyKey = 'psychjson_token_store_asset_index_v1';
        try {
            const obj = (index && typeof index === 'object') ? index : {};
            const json = JSON.stringify(obj);
            localStorage.setItem(key, json);
            localStorage.setItem(legacyKey, json);
        } catch {
            // ignore
        }
    }

    getTokenStoreAssetMapForCodeAndTask(code, taskType) {
        const c = (code || '').toString().trim();
        if (!c) return null;
        const t = this.normalizeTokenStoreTaskType(taskType);
        const all = this.getTokenStoreAssetIndex();
        const byCode = all[c];
        if (!byCode || typeof byCode !== 'object') return null;
        const byTask = byCode.by_task && typeof byCode.by_task === 'object' ? byCode.by_task : null;
        if (!byTask) return null;
        const m = byTask[t];
        if (!m || typeof m !== 'object') return null;
        const files = m.files && typeof m.files === 'object' ? m.files : null;
        if (!files) return null;
        return files;
    }

    setTokenStoreAssetMapForCodeAndTask(code, taskType, filesMap) {
        const c = (code || '').toString().trim();
        if (!c) return;
        const t = this.normalizeTokenStoreTaskType(taskType);
        const all = this.getTokenStoreAssetIndex();
        const existing = all[c];
        const next = (existing && typeof existing === 'object' && existing.by_task && typeof existing.by_task === 'object')
            ? existing
            : { v: 1, by_task: {} };
        if (!next.by_task || typeof next.by_task !== 'object') next.by_task = {};
        next.by_task[t] = {
            updated_at_local: new Date().toISOString(),
            files: (filesMap && typeof filesMap === 'object') ? filesMap : {}
        };
        all[c] = next;
        this.setTokenStoreAssetIndex(all);
    }

    escapeRegex(s) {
        return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    rewriteStringUsingTokenStoreAssets(raw, assetsByFilename) {
        const s = (raw ?? '').toString();
        if (!s) return s;

        // Do not touch already-hosted URLs or asset:// placeholders.
        if (/^(https?:|data:|blob:|asset:)/i.test(s.trim())) return s;

        // Exact string match first (most common: image stimulus = "img1.png").
        const direct = assetsByFilename && assetsByFilename[s];
        if (direct && direct.url) return direct.url;

        // Replace occurrences inside HTML/templates safely.
        // Only replace when the filename appears as its own token (e.g., src="img1.png", url('img1.png')).
        let out = s;
        const entries = assetsByFilename && typeof assetsByFilename === 'object' ? Object.entries(assetsByFilename) : [];
        for (const [filename, meta] of entries) {
            const url = meta && meta.url ? String(meta.url) : '';
            if (!filename || !url) continue;
            if (!out.includes(filename)) continue;

            const escaped = this.escapeRegex(filename);
            const re = new RegExp(`(^|[\\s"'=:(),])(${escaped})(?=$|[\\s"'<>),;])`, 'g');
            out = out.replace(re, `$1${url}`);
        }
        return out;
    }

    rewriteBareAssetFilenamesToTokenStoreUrls(config, { code, taskType }) {
        const filesMap = this.getTokenStoreAssetMapForCodeAndTask(code, taskType);
        if (!filesMap) return config;

        const rewriteDeep = (x) => {
            if (typeof x === 'string') {
                return this.rewriteStringUsingTokenStoreAssets(x, filesMap);
            }
            if (Array.isArray(x)) return x.map(rewriteDeep);
            if (x && typeof x === 'object') {
                const out = {};
                for (const [k, v] of Object.entries(x)) {
                    out[k] = rewriteDeep(v);
                }
                return out;
            }
            return x;
        };

        return rewriteDeep((config && typeof config === 'object') ? config : {});
    }

    async uploadAssetDirectoryToTokenStore(files) {
        const inputFiles = Array.isArray(files) ? files : [];
        if (inputFiles.length === 0) return;

        const code = this.promptForExportCodeOnly();
        if (!code) return;

        // Use current Builder task selection as the Token Store task bucket.
        const taskType = this.normalizeTokenStoreTaskType(document.getElementById('taskType')?.value || 'task');

        let baseUrl = this.peekTokenStoreBaseUrl();
        if (!baseUrl) {
            baseUrl = this.getTokenStoreBaseUrl();
        }
        if (!baseUrl) return;

        if (!/^https?:\/\//i.test(baseUrl) || /^(javascript:|data:|file:)/i.test(baseUrl)) {
            this.showValidationResult('error', 'Invalid Token Store base URL.');
            return;
        }

        let record = this.getTokenStoreRecordForCodeAndTask(code, taskType);
        if (!record) {
            this.showValidationResult('warning', `No token found for code ${code} (${String(taskType).toUpperCase()}). Creating a new token...`);
            record = await this.createTokenStoreConfig(baseUrl);
            this.setTokenStoreRecordForCodeAndTask(code, taskType, record, { filename: null });
        }

        // De-dupe by basename (folder uploads can contain duplicates). Keep first.
        const queue = inputFiles.slice().filter((f) => f && f.name).sort((a, b) => String(a.name).localeCompare(String(b.name)));
        const seen = new Set();
        const duplicates = [];
        const unique = [];
        for (const f of queue) {
            const name = String(f.name || '').trim();
            if (!name) continue;
            const key = name;
            if (seen.has(key)) {
                duplicates.push(name);
                continue;
            }
            seen.add(key);
            unique.push(f);
        }

        if (duplicates.length > 0) {
            this.showValidationResult('warning', `Skipped ${duplicates.length} duplicate filename(s) in the selected folder (kept first occurrence).`);
        }

        const existing = this.getTokenStoreAssetMapForCodeAndTask(code, taskType) || {};
        const conflicts = unique.filter((f) => {
            const name = String(f.name || '').trim();
            return !!(name && existing[name] && existing[name].url);
        });

        if (conflicts.length > 0) {
            const ok = confirm(
                `This assets index already contains ${conflicts.length} file(s) for code ${code} and task ${String(taskType).toUpperCase()} (e.g., ${conflicts[0].name}).\n\nContinue and overwrite the saved URL mapping(s) by re-uploading?`
            );
            if (!ok) {
                this.showValidationResult('warning', 'Asset folder upload cancelled.');
                return;
            }
        }

        const nextMap = { ...existing };
        let uploaded = 0;
        for (const file of unique) {
            const filename = String(file.name || '').trim();
            if (!filename) continue;
            const out = await this.uploadAssetToTokenStore(baseUrl, record, file, filename);
            nextMap[filename] = { url: out.url };
            uploaded += 1;
        }

        this.setTokenStoreAssetMapForCodeAndTask(code, taskType, nextMap);
        this.showValidationResult('success', `Uploaded ${uploaded} asset(s) to Token Store and saved a filename→URL index for code ${code} (${String(taskType).toUpperCase()}).`);
    }

    normalizeTokenStoreTaskType(taskType) {
        const t = (taskType || '').toString().trim().toLowerCase();
        return t || 'task';
    }

    getTokenStoreBundleForCode(code) {
        const c = (code || '').toString().trim();
        if (!c) return null;

        const all = this.getTokenStoreRecords();
        const rec = all[c];
        if (!rec || typeof rec !== 'object') return null;

        // Legacy shape: { config_id, write_token, read_token }
        if (rec.config_id || rec.configId) {
            const configId = (rec.config_id || rec.configId || '').toString().trim();
            const writeToken = (rec.write_token || rec.writeToken || '').toString().trim();
            const readToken = (rec.read_token || rec.readToken || '').toString().trim();
            if (!configId || !writeToken || !readToken) return null;
            return {
                v: 1,
                configs: [
                    {
                        task_type: null,
                        filename: null,
                        config_id: configId,
                        write_token: writeToken,
                        read_token: readToken,
                        updated_at_local: null
                    }
                ]
            };
        }

        // v2+ shape: { v: 2, by_task: { rdm: { ... }, flanker: { ... } } }
        const byTask = rec.by_task && typeof rec.by_task === 'object' ? rec.by_task : null;
        if (!byTask) return null;

        const configs = [];
        for (const [task, r] of Object.entries(byTask)) {
            if (!r || typeof r !== 'object') continue;
            const configId = (r.config_id || r.configId || '').toString().trim();
            const writeToken = (r.write_token || r.writeToken || '').toString().trim();
            const readToken = (r.read_token || r.readToken || '').toString().trim();
            if (!configId || !writeToken || !readToken) continue;
            configs.push({
                task_type: (task || '').toString().trim() || null,
                filename: (r.filename || '').toString().trim() || null,
                config_id: configId,
                write_token: writeToken,
                read_token: readToken,
                updated_at_local: (r.updated_at_local || '').toString().trim() || null
            });
        }

        if (configs.length === 0) return null;
        configs.sort((a, b) => (a.task_type || '').localeCompare(b.task_type || ''));
        return { v: 2, configs };
    }

    getTokenStoreRecordForCodeAndTask(code, taskType) {
        const c = (code || '').toString().trim();
        if (!c) return null;
        const t = this.normalizeTokenStoreTaskType(taskType);

        const all = this.getTokenStoreRecords();
        const rec = all[c];
        if (!rec || typeof rec !== 'object') return null;

        // Legacy shape: treat it as "single record" (no per-task distinction)
        if (rec.config_id || rec.configId) {
            const configId = (rec.config_id || rec.configId || '').toString().trim();
            const writeToken = (rec.write_token || rec.writeToken || '').toString().trim();
            const readToken = (rec.read_token || rec.readToken || '').toString().trim();
            if (!configId || !writeToken || !readToken) return null;
            return { config_id: configId, write_token: writeToken, read_token: readToken, task_type: t, filename: null };
        }

        const byTask = rec.by_task && typeof rec.by_task === 'object' ? rec.by_task : null;
        if (!byTask) return null;
        const r = byTask[t];
        if (!r || typeof r !== 'object') return null;

        const configId = (r.config_id || r.configId || '').toString().trim();
        const writeToken = (r.write_token || r.writeToken || '').toString().trim();
        const readToken = (r.read_token || r.readToken || '').toString().trim();
        if (!configId || !writeToken || !readToken) return null;
        return {
            config_id: configId,
            write_token: writeToken,
            read_token: readToken,
            task_type: t,
            filename: (r.filename || '').toString().trim() || null
        };
    }

    setTokenStoreRecordForCodeAndTask(code, taskType, record, meta) {
        const c = (code || '').toString().trim();
        if (!c) return;
        const t = this.normalizeTokenStoreTaskType(taskType);

        const rec = (record && typeof record === 'object') ? record : null;
        if (!rec) return;

        const configId = (rec.config_id || rec.configId || '').toString().trim();
        const writeToken = (rec.write_token || rec.writeToken || '').toString().trim();
        const readToken = (rec.read_token || rec.readToken || '').toString().trim();
        if (!configId || !writeToken || !readToken) return;

        const filename = meta && meta.filename ? String(meta.filename).trim() : null;
        const updatedAt = new Date().toISOString();

        const all = this.getTokenStoreRecords();
        const existing = all[c];
        const next = (existing && typeof existing === 'object' && existing.by_task && typeof existing.by_task === 'object')
            ? existing
            : { v: 2, by_task: {} };

        if (!next.by_task || typeof next.by_task !== 'object') next.by_task = {};

        next.by_task[t] = {
            config_id: configId,
            write_token: writeToken,
            read_token: readToken,
            filename: filename,
            updated_at_local: updatedAt
        };

        all[c] = next;
        this.setTokenStoreRecords(all);

        // Verify persistence (some browser/privacy modes can block localStorage).
        try {
            const reread = this.getTokenStoreRecordForCodeAndTask(c, t);
            if (!reread || reread.config_id !== configId || reread.write_token !== writeToken || reread.read_token !== readToken) {
                throw new Error('Token record did not persist');
            }
        } catch {
            const tokenJson = JSON.stringify({ config_id: configId, write_token: writeToken, read_token: readToken }, null, 2);
            try {
                navigator.clipboard.writeText(tokenJson);
            } catch {
                // ignore
            }
            this.showValidationResult(
                'warning',
                'Could not persist Token Store tokens in localStorage (browser privacy mode?). Tokens were copied to clipboard as a fallback.'
            );
        }
    }

    setTokenStoreRecords(records) {
        const key = 'cogflow_token_store_records_v1';
        const legacyKey = 'psychjson_token_store_records_v1';
        try {
            const obj = (records && typeof records === 'object') ? records : {};
            const json = JSON.stringify(obj);
            localStorage.setItem(key, json);
            localStorage.setItem(legacyKey, json);
        } catch {
            // ignore
        }
    }

    getExportBackups() {
        const key = 'cogflow_export_backups_v1';
        const legacyKey = 'psychjson_export_backups_v1';
        try {
            const raw = localStorage.getItem(key) || localStorage.getItem(legacyKey) || '';
            const parsed = raw ? JSON.parse(raw) : [];
            if (Array.isArray(parsed)) return parsed;
        } catch {
            // ignore
        }
        return [];
    }

    persistExportBackup({ jsonText, naming, source }) {
        const text = (jsonText ?? '').toString();
        if (!text.trim()) return;

        const entry = {
            v: 1,
            created_at_local: new Date().toISOString(),
            source: (source || 'export').toString(),
            code: naming?.code || null,
            task_type: naming?.taskType || null,
            filename: naming?.filename || null,
            json_text: text
        };

        const key = 'cogflow_export_backups_v1';
        const legacyKey = 'psychjson_export_backups_v1';
        const existing = this.getExportBackups();

        // Most recent first; keep small to avoid quota issues.
        const next = [entry, ...existing].slice(0, 10);
        const out = JSON.stringify(next);
        localStorage.setItem(key, out);
        localStorage.setItem(legacyKey, out);
    }

    getJatosApi() {
        // JATOS' jatos.js defines `const jatos = {}` in the global lexical scope.
        // That does NOT necessarily become `window.jatos`, so detect it via `typeof jatos`.
        try {
            // eslint-disable-next-line no-undef
            if (typeof jatos !== 'undefined' && jatos) {
                // eslint-disable-next-line no-undef
                return jatos;
            }
        } catch {
            // ignore
        }
        try {
            if (typeof window.jatos !== 'undefined' && window.jatos) return window.jatos;
        } catch {
            // ignore
        }
        try {
            if (window.parent && window.parent !== window && typeof window.parent.jatos !== 'undefined' && window.parent.jatos) return window.parent.jatos;
        } catch {
            // ignore
        }
        try {
            if (window.top && window.top !== window && typeof window.top.jatos !== 'undefined' && window.top.jatos) return window.top.jatos;
        } catch {
            // ignore
        }
        return null;
    }

    sanitizeFilenamePart(x) {
        return String(x || '')
            .replace(/\s+/g, '_')
            .replace(/[^A-Za-z0-9._-]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 80);
    }

    formatTimestampForFilename(d) {
        const pad = (n) => String(n).padStart(2, '0');
        const dt = d instanceof Date ? d : new Date();
        const y = dt.getFullYear();
        const m = pad(dt.getMonth() + 1);
        const day = pad(dt.getDate());
        const hh = pad(dt.getHours());
        const mm = pad(dt.getMinutes());
        const ss = pad(dt.getSeconds());
        return `${y}${m}${day}-${hh}${mm}${ss}`;
    }

    buildJatosExportBackupFilename(naming) {
        const filename = naming?.filename ? String(naming.filename) : 'export.json';
        const base = filename.toLowerCase().endsWith('.json') ? filename.slice(0, -'.json'.length) : filename;
        const safeBase = this.sanitizeFilenamePart(base) || 'export';
        const stamp = this.formatTimestampForFilename(new Date());
        return `cogflow-builder-export-${safeBase}-${stamp}.json`;
    }

    async tryUploadExportBackupToJatos({ jsonText, naming }) {
        const j = this.getJatosApi();
        if (!j || typeof j.uploadResultFile !== 'function') return { ok: false, reason: 'jatos_unavailable' };

        const text = (jsonText || '').toString();
        if (!text.trim()) return { ok: false, reason: 'empty' };

        const outName = this.buildJatosExportBackupFilename(naming);

        let fileObj = null;
        try {
            fileObj = new File([text], outName, { type: 'application/json' });
        } catch {
            try {
                const blob = new Blob([text], { type: 'application/json' });
                blob.name = outName;
                fileObj = blob;
            } catch {
                fileObj = null;
            }
        }

        if (!fileObj) return { ok: false, reason: 'file_construct_failed' };

        try {
            const res = await j.uploadResultFile(fileObj, outName);
            return { ok: true, filename: outName, size: text.length, result: res };
        } catch (e) {
            return { ok: false, reason: e && e.message ? e.message : String(e) };
        }
    }


    peekTokenStoreBaseUrl() {
        // Non-interactive: prefer global override, then localStorage.
        try {
            const globalUrl = window.COGFLOW_TOKEN_STORE_BASE_URL;
            if (typeof globalUrl === 'string' && globalUrl.trim()) {
                const trimmed = globalUrl.trim();
                if (/^https?:\/\//i.test(trimmed) && !/^(javascript:|data:|file:)/i.test(trimmed)) {
                    return trimmed.replace(/\/+$/, '');
                }
            }
        } catch {
            // ignore
        }

        try {
            const key = 'cogflow_token_store_base_url_v1';
            const legacyKey = 'psychjson_token_store_base_url_v1';
            const raw = (localStorage.getItem(key) || localStorage.getItem(legacyKey) || '').toString().trim();
            if (raw && /^https?:\/\//i.test(raw) && !/^(javascript:|data:|file:)/i.test(raw)) return raw.replace(/\/+$/, '');
        } catch {
            // ignore
        }
        return '';
    }

    promptForExportCodeOnly() {
        const last = (localStorage.getItem('cogflow_last_export_code') || localStorage.getItem('psychjson_last_export_code') || '').toString();
        const rawCode = prompt('Enter export code (7 alphanumeric characters):', last);
        if (rawCode === null) return null;
        const code = (rawCode || '').toString().trim();
        if (!/^[A-Za-z0-9]{7}$/.test(code)) {
            this.showValidationResult('error', 'Invalid export code. Please use exactly 7 letters/numbers (A-Z, a-z, 0-9).');
            return null;
        }
        localStorage.setItem('cogflow_last_export_code', code);
        localStorage.setItem('psychjson_last_export_code', code);
        return code;
    }

    async importLocalJsonFilesToTokenStore(files) {
        const inputFiles = Array.isArray(files) ? files : [];
        if (inputFiles.length === 0) return;

        const code = this.promptForExportCodeOnly();
        if (!code) return;

        let baseUrl = this.peekTokenStoreBaseUrl();
        if (!baseUrl) {
            baseUrl = this.getTokenStoreBaseUrl();
        }
        if (!baseUrl) return;

        if (!/^https?:\/\//i.test(baseUrl) || /^(javascript:|data:|file:)/i.test(baseUrl)) {
            this.showValidationResult('error', 'Invalid Token Store base URL.');
            return;
        }

        const readFileAsText = (file) => {
            return new Promise((resolve, reject) => {
                try {
                    const reader = new FileReader();
                    reader.onload = () => resolve((reader.result ?? '').toString());
                    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
                    reader.readAsText(file);
                } catch (e) {
                    reject(e);
                }
            });
        };

        const ensureJsonFilename = (name) => {
            const raw = (name || '').toString().trim() || 'config.json';
            return /\.json$/i.test(raw) ? raw : `${raw}.json`;
        };

        // Sort for predictable behavior.
        const queue = inputFiles.slice().sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));

        const seenTaskTypes = new Map();
        const overwritesConfirmed = new Set();

        const results = [];

        for (const file of queue) {
            const filename = ensureJsonFilename(file?.name || 'config.json');

            let config;
            let jsonText;
            try {
                jsonText = await readFileAsText(file);
                config = JSON.parse(jsonText);
            } catch (e) {
                results.push({ ok: false, filename, error: `Invalid JSON (${e?.message || 'parse error'})` });
                continue;
            }

            if (!config || typeof config !== 'object' || Array.isArray(config)) {
                results.push({ ok: false, filename, error: 'JSON must be an object at the top level' });
                continue;
            }

            const taskTypeRaw = (config.task_type || config.taskType || '').toString().trim();
            const taskType = this.normalizeTokenStoreTaskType(taskTypeRaw || 'task');

            // Token store record storage is per (code, task). Multiple JSONs with same task under one code will overwrite.
            const prior = seenTaskTypes.get(taskType);
            if (prior && prior !== filename && !overwritesConfirmed.has(taskType)) {
                const ok = confirm(
                    `You selected multiple JSON files with task_type "${taskType}" (e.g., ${prior} and ${filename}).\n\nToken Store supports ONE config per (export code, task_type). Continuing will overwrite earlier uploads for this task type under code ${code}.\n\nContinue?`
                );
                if (!ok) {
                    results.push({ ok: false, filename, taskType, error: 'Skipped (duplicate task_type under same export code)' });
                    continue;
                }
                overwritesConfirmed.add(taskType);
            }
            seenTaskTypes.set(taskType, filename);

            const naming = {
                code,
                taskType,
                filename
            };

            // Persist an import backup early (helps recover if upload fails).
            try {
                this.persistExportBackup({
                    jsonText: JSON.stringify(config, null, 2),
                    naming,
                    source: 'import_start'
                });
            } catch {
                // ignore
            }

            try {
                let record = this.getTokenStoreRecordForCodeAndTask(code, taskType);

                if (record && !overwritesConfirmed.has(taskType)) {
                    const ok = confirm(
                        `A Token Store record already exists locally for export code ${code} and task ${String(taskType).toUpperCase()}.\n\nContinuing will OVERWRITE the previously uploaded config for this task.\n\nContinue?`
                    );
                    if (!ok) {
                        results.push({ ok: false, filename, taskType, error: 'Cancelled (existing token record)' });
                        continue;
                    }
                    overwritesConfirmed.add(taskType);
                }

                if (!record) {
                    record = await this.createTokenStoreConfig(baseUrl);
                    this.setTokenStoreRecordForCodeAndTask(code, taskType, record, { filename });
                }

                // Attempt asset:// upload rewrite if cached assets exist.
                try {
                    config = await this.uploadAssetRefsToTokenStoreAndRewriteConfig(config, naming, baseUrl, record);
                } catch (e) {
                    console.warn('Token store asset upload failed (continuing with JSON-only):', e);
                    this.showValidationResult('warning', `Asset upload failed for ${filename}; uploading JSON only. (${e?.message || 'Unknown error'})`);
                }

                await this.uploadConfigToTokenStore(baseUrl, record, config, naming);
                this.setTokenStoreRecordForCodeAndTask(code, taskType, record, { filename });

                // Persist post-import snapshot.
                try {
                    this.persistExportBackup({
                        jsonText: JSON.stringify(config, null, 2),
                        naming,
                        source: 'import_success'
                    });
                } catch {
                    // ignore
                }

                results.push({ ok: true, filename, taskType, record });
            } catch (e) {
                console.error('Import upload failed:', e);
                results.push({ ok: false, filename, taskType, error: e?.message || 'Upload failed' });
            }
        }

        const okCount = results.filter((r) => r && r.ok).length;
        const failCount = results.length - okCount;

        if (okCount === 0) {
            const msg = failCount > 0
                ? `No JSON files were uploaded. (${failCount} failed)`
                : 'No JSON files were uploaded.';
            this.showValidationResult('error', msg);
            return;
        }

        // Show bundled multi-config props for this export code (Interpreter supports this).
        try {
            const bundle = this.getTokenStoreBundleForCode(code);
            const configs = bundle && Array.isArray(bundle.configs) ? bundle.configs : [];
            const safeConfigs = configs.map((c) => {
                return {
                    task_type: c.task_type || null,
                    filename: c.filename || null,
                    config_id: c.config_id,
                    read_token: c.read_token
                };
            }).filter((c) => c && c.config_id && c.read_token);

            const props = {
                config_store_base_url: baseUrl,
                config_store_code: code,
                config_store_configs: safeConfigs
            };
            const propsText = JSON.stringify(props, null, 2);
            try {
                await navigator.clipboard.writeText(propsText);
            } catch {
                // ignore
            }

            this.showExportTokenOverlay({
                title: 'Token Store import complete',
                subtitle: 'Paste this JSON into the Interpreter component’s JATOS Component Properties (JSON). It contains read tokens for multiple tasks under one export code.',
                jsonText: propsText
            });
        } catch (e) {
            console.warn('Failed to prepare bundle props after import:', e);
        }

        const summary = failCount > 0
            ? `Imported ${okCount} config(s) to Token Store (${failCount} failed). JATOS props copied/shown.`
            : `Imported ${okCount} config(s) to Token Store. JATOS props copied/shown.`;
        this.showValidationResult(failCount > 0 ? 'warning' : 'success', summary);
    }

    prepareJatosComponentPropertiesForTokenStoreBundle() {
        try {
            const code = this.promptForExportCodeOnly();
            if (!code) return;

            let baseUrl = this.peekTokenStoreBaseUrl();
            if (!baseUrl) {
                baseUrl = this.getTokenStoreBaseUrl();
            }
            if (!baseUrl) return;

            const bundle = this.getTokenStoreBundleForCode(code);
            const configs = bundle && Array.isArray(bundle.configs) ? bundle.configs : [];
            if (configs.length === 0) {
                this.showValidationResult('error', `No Token Store exports found locally for code ${code}. Export at least one task first.`);
                return;
            }

            const safeConfigs = configs.map((c) => {
                return {
                    task_type: c.task_type || null,
                    filename: c.filename || null,
                    config_id: c.config_id,
                    read_token: c.read_token
                };
            });

            const props = {
                config_store_base_url: baseUrl,
                config_store_code: code,
                config_store_configs: safeConfigs
            };

            const propsText = JSON.stringify(props, null, 2);
            try {
                navigator.clipboard.writeText(propsText);
            } catch {
                // ignore
            }

            this.showExportTokenOverlay({
                title: 'JATOS Component Properties (multi-config)',
                subtitle: 'Paste this JSON into the Interpreter component’s JATOS Component Properties (JSON). It contains read tokens for multiple tasks under one export code.',
                jsonText: propsText
            });
        } catch (e) {
            console.error('prepareJatosComponentPropertiesForTokenStoreBundle failed:', e);
            this.showValidationResult('error', `Failed to prepare JATOS props. (${e?.message || 'Unknown error'})`);
        }
    }

    async createTokenStoreConfig(baseUrl) {
        const safeBase = String(baseUrl || '').trim().replace(/\/+$/, '');
        if (!safeBase) throw new Error('Missing token store base URL');

        const url = `${safeBase}/v1/configs`;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Token store create failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ''}`);
        }
        const json = await res.json();
        const configId = (json && (json.config_id || json.configId)) ? String(json.config_id || json.configId).trim() : '';
        const writeToken = (json && (json.write_token || json.writeToken)) ? String(json.write_token || json.writeToken).trim() : '';
        const readToken = (json && (json.read_token || json.readToken)) ? String(json.read_token || json.readToken).trim() : '';
        if (!configId || !writeToken || !readToken) {
            throw new Error('Token store create returned an invalid payload');
        }
        return { config_id: configId, write_token: writeToken, read_token: readToken };
    }

    async uploadConfigToTokenStore(baseUrl, record, config, naming) {
        const safeBase = String(baseUrl || '').trim().replace(/\/+$/, '');
        if (!safeBase) throw new Error('Missing token store base URL');
        const configId = (record && record.config_id) ? String(record.config_id).trim() : '';
        const writeToken = (record && record.write_token) ? String(record.write_token).trim() : '';
        if (!configId || !writeToken) throw new Error('Missing token store record');

        const url = `${safeBase}/v1/configs/${encodeURIComponent(configId)}`;
        const payload = {
            config,
            meta: {
                filename: naming && naming.filename ? naming.filename : null,
                code: naming && naming.code ? naming.code : null,
                task_type: naming && naming.taskType ? naming.taskType : null,
                updated_at_local: new Date().toISOString()
            }
        };

        const res = await fetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${writeToken}`
            },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Token store update failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ''}`);
        }
        const out = await res.json().catch(() => ({}));
        return out;
    }

    async uploadAssetToTokenStore(baseUrl, record, file, filename) {
        const safeBase = String(baseUrl || '').trim().replace(/\/+$/, '');
        if (!safeBase) throw new Error('Missing token store base URL');
        const configId = (record && record.config_id) ? String(record.config_id).trim() : '';
        const writeToken = (record && record.write_token) ? String(record.write_token).trim() : '';
        if (!configId || !writeToken) throw new Error('Missing token store record');

        const url = `${safeBase}/v1/configs/${encodeURIComponent(configId)}/assets`;

        const form = new FormData();
        // Ensure the uploaded object has a stable, meaningful filename.
        const outName = (filename && String(filename).trim()) ? String(filename).trim() : (file && file.name ? file.name : 'asset');
        form.append('file', file, outName);

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${writeToken}`
            },
            body: form
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Token store asset upload failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ''}`);
        }

        const json = await res.json().catch(() => ({}));
        const outUrl = (json && json.url) ? String(json.url).trim() : '';
        if (!outUrl) throw new Error('Token store asset upload returned no URL');
        return { url: outUrl, asset_id: json.asset_id || null };
    }

    async uploadAssetRefsToTokenStoreAndRewriteConfig(config, naming, baseUrl, record) {
        const cfg = (config && typeof config === 'object') ? config : {};
        const jsonText = JSON.stringify(cfg);
        const refs = this.findAssetRefsInString(jsonText);
        if (refs.length === 0) return cfg;

        const base = String(naming?.filename || 'export').replace(/\.json$/i, '');
        const sanitizeFileName = (s) => {
            return String(s || '')
                .replace(/[^A-Za-z0-9._-]/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_+|_+$/g, '')
                .slice(0, 160) || 'asset';
        };

        const uploadedByRef = new Map();

        for (const ref of refs) {
            const m = /^asset:\/\/([^/]+)\/([^/]+)$/.exec(ref);
            if (!m) continue;
            const componentId = m[1];
            const field = m[2];

            const assetCache = window.CogFlowAssetCache || window.PsychJsonAssetCache;
            const entry = assetCache?.get?.(componentId, field);
            const file = entry?.file;
            if (!file) {
                console.warn('Missing cached file for', ref);
                continue;
            }

            const originalName = entry?.filename || file.name || `${field}`;
            const extMatch = /\.[A-Za-z0-9]{1,8}$/.exec(originalName);
            const ext = extMatch ? extMatch[0] : '';
            const outName = sanitizeFileName(`${base}-asset-${componentId}-${field}`) + ext;

            if (!uploadedByRef.has(ref)) {
                const uploaded = await this.uploadAssetToTokenStore(baseUrl, record, file, outName);
                uploadedByRef.set(ref, uploaded.url);
            }
        }

        // Rewrite any asset:// refs anywhere in the config (including HTML templates)
        const replaceInString = (s) => {
            const raw = (s ?? '').toString();
            return raw.replace(/asset:\/\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/g, (full) => {
                const mapped = uploadedByRef.get(full);
                return mapped ? mapped : full;
            });
        };

        const rewriteDeep = (x) => {
            if (typeof x === 'string') return replaceInString(x);
            if (Array.isArray(x)) return x.map(rewriteDeep);
            if (x && typeof x === 'object') {
                const out = {};
                for (const [k, v] of Object.entries(x)) {
                    out[k] = rewriteDeep(v);
                }
                return out;
            }
            return x;
        };

        const rewritten = rewriteDeep(cfg);
        const uploadedCount = uploadedByRef.size;
        if (uploadedCount > 0) {
            this.showValidationResult('success', `Uploaded ${uploadedCount} asset(s) to Token Store (R2) and rewrote asset:// refs.`);
        } else {
            this.showValidationResult('warning', `Found ${refs.length} asset reference(s), but no cached files were available to upload.`);
        }
        return rewritten;
    }

    getExportFilename(config) {
        // Ask for a 7-char alphanumeric code and use it in the filename.
        const last = (localStorage.getItem('cogflow_last_export_code') || localStorage.getItem('psychjson_last_export_code') || '').toString();
        const rawCode = prompt('Enter export code (7 alphanumeric characters):', last);
        if (rawCode === null) return null;

        const code = (rawCode || '').toString().trim();
        const ok = /^[A-Za-z0-9]{7}$/.test(code);
        if (!ok) {
            this.showValidationResult('error', 'Invalid export code. Please use exactly 7 letters/numbers (A-Z, a-z, 0-9).');
            return null;
        }
        localStorage.setItem('cogflow_last_export_code', code);
        localStorage.setItem('psychjson_last_export_code', code);

        const taskType = (config.task_type || document.getElementById('taskType')?.value || 'task').toString().trim().toLowerCase();
        const prefix = `${code}-${taskType}-`;

        // Browser sandbox cannot inspect your Downloads directory.
        // We approximate "-01, -02, ..." by tracking export history in localStorage.
        const historyKey = 'cogflow_export_history_v1';
        const legacyHistoryKey = 'psychjson_export_history_v1';
        let history = [];
        try {
            history = JSON.parse(localStorage.getItem(historyKey) || localStorage.getItem(legacyHistoryKey) || '[]');
            if (!Array.isArray(history)) history = [];
        } catch {
            history = [];
        }

        const parseSuffix = (name) => {
            if (typeof name !== 'string') return null;
            if (!name.startsWith(prefix) || !name.endsWith('.json')) return null;
            const mid = name.slice(prefix.length, -'.json'.length);
            const n = Number.parseInt(mid, 10);
            return Number.isFinite(n) ? n : null;
        };

        const used = history.map(parseSuffix).filter(n => Number.isFinite(n));
        const nextNum = (used.length ? Math.max(...used) : 0) + 1;
        const suffix = String(nextNum).padStart(2, '0');
        const filename = `${code}-${taskType}-${suffix}.json`;

        history.push(filename);
        if (history.length > 200) history = history.slice(history.length - 200);
        localStorage.setItem(historyKey, JSON.stringify(history));
        localStorage.setItem(legacyHistoryKey, JSON.stringify(history));

        return { filename, code, taskType };
    }

    downloadJsonToFile(jsonText, filename) {
        const blob = new Blob([jsonText], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        URL.revokeObjectURL(url);
    }

    /**
     * Save JSON file locally
     */
    saveJSON() {
        const config = this.generateJSON();
        const json = JSON.stringify(config, null, 2);

        const naming = this.getExportFilename(config);
        if (!naming) return;

        this.downloadJsonToFile(json, naming.filename);
        this.showValidationResult('success', `JSON saved locally: ${naming.filename}`);
    }

    /**
     * Handle task type changes
     */
    onTaskTypeChange(event) {
        const nextTaskType = event?.target?.value || 'rdm';
        const prevTaskType = this.currentTaskType || 'rdm';

        // Continuous Image Presentation is a continuous-mode task (by design).
        // If the user selects it while in trial-based mode, auto-switch to continuous.
        if (nextTaskType === 'continuous-image' && this.experimentType !== 'continuous') {
            const continuousRadio = document.getElementById('continuous');
            if (continuousRadio) continuousRadio.checked = true;
            this.experimentType = 'continuous';

            // Re-render task-scoped panels so availability + defaults match.
            this.enforceTaskTypeAvailability();
            this.updateExperimentTypeUI();
            this.updateConditionalUI();
        }

        if (!this.isTaskTypeAllowedForExperiment(nextTaskType, this.experimentType)) {
            alert(`Task "${nextTaskType}" is not available for ${this.experimentType} experiments.`);
            if (event?.target) event.target.value = prevTaskType;
            return;
        }

        if (nextTaskType === prevTaskType) {
            this.updateJSON();
            return;
        }

        // Custom mode: do not auto-prune timeline.
        if (nextTaskType !== 'custom') {
            const incompatible = this.findIncompatibleTimelineComponents(nextTaskType);
            if (incompatible.count > 0) {
                const ok = confirm(
                    `Switching task type to "${nextTaskType}" will remove ${incompatible.count} incompatible timeline item(s).\n\nContinue?`
                );
                if (!ok) {
                    // Revert dropdown selection
                    if (event?.target) event.target.value = prevTaskType;
                    return;
                }

                this.removeIncompatibleTimelineComponents(nextTaskType);
            }
        }

        this.currentTaskType = nextTaskType;

        // Re-render task-scoped settings UI and component library
        this.updateExperimentTypeUI();
        this.loadComponentLibrary();

        // If switching to a non-RDM task leaves the timeline empty, seed a starter timeline.
        this.maybeInsertStarterTimeline(nextTaskType);

        // If the component library modal is open, the DOM is already updated by loadComponentLibrary.
        this.updateConditionalUI();
        this.updateJSON();
    }

    maybeInsertStarterTimeline(taskType) {
        if (taskType === 'soc-dashboard' && this.experimentType !== 'continuous') return;
        if (taskType !== 'flanker' && taskType !== 'sart' && taskType !== 'gabor' && taskType !== 'stroop' && taskType !== 'emotional-stroop' && taskType !== 'simon' && taskType !== 'task-switching' && taskType !== 'pvt' && taskType !== 'mot' && taskType !== 'soc-dashboard' && taskType !== 'nback') return;

        const timelineContainer = document.getElementById('timelineComponents');
        if (!timelineContainer) return;

        const hasAny = !!timelineContainer.querySelector('.timeline-component');
        if (hasAny) return;

        const defs = this.getComponentDefinitions();
        const instructionsDef = defs.find(d => d.id === 'instructions');
        const trialId = taskType === 'flanker'
            ? 'flanker-trial'
            : (taskType === 'sart')
                ? 'sart-trial'
                : (taskType === 'simon')
                    ? 'simon-trial'
                : (taskType === 'task-switching')
                    ? 'task-switching-trial'
                : (taskType === 'pvt')
                    ? 'pvt-trial'
                : (taskType === 'mot')
                    ? 'mot-trial'
                : (taskType === 'stroop')
                    ? 'stroop-trial'
                : (taskType === 'emotional-stroop')
                    ? 'emotional-stroop-trial'
                : (taskType === 'nback')
                    ? 'nback-trial-sequence'
                : (taskType === 'soc-dashboard')
                    ? 'soc-dashboard'
                    : 'gabor-trial';
        const trialDef = defs.find(d => d.id === trialId);

        if (instructionsDef) this.addComponentToTimeline(instructionsDef);
        if (trialDef) this.addComponentToTimeline(trialDef);
    }

    /**
     * Return list/count of incompatible timeline components for the given task type.
     */
    findIncompatibleTimelineComponents(taskType) {
        const elements = Array.from(document.querySelectorAll('#timelineComponents .timeline-component'));
        const incompatible = [];

        for (const el of elements) {
            const raw = el.dataset?.componentData;
            let componentData = null;
            try {
                componentData = raw ? JSON.parse(raw) : null;
            } catch {
                componentData = null;
            }

            const type = componentData?.type || el.dataset?.componentType || '';
            if (!type) continue;

            if (!this.isComponentTypeAllowedForTask(type, componentData, taskType)) {
                incompatible.push({ element: el, type });
            }
        }

        return { count: incompatible.length, items: incompatible };
    }

    /**
     * Remove incompatible timeline components for the given task type.
     */
    removeIncompatibleTimelineComponents(taskType) {
        const incompatible = this.findIncompatibleTimelineComponents(taskType);
        for (const item of incompatible.items) {
            item.element.remove();
        }

        // Restore empty state if needed
        const timelineContainer = document.getElementById('timelineComponents');
        if (timelineContainer) {
            const hasAny = timelineContainer.querySelector('.timeline-component');
            const emptyState = timelineContainer.querySelector('.empty-timeline');
            if (emptyState) emptyState.style.display = hasAny ? 'none' : '';
        }
    }

    /**
     * Decide if a component is allowed under a task type.
     */
    isComponentTypeAllowedForTask(type, componentData, taskType) {
        // Always allow generic components
        const alwaysAllowed = new Set([
            'html-keyboard-response',
            'html-button-response',
            'image-keyboard-response',
            'survey-response',
            'instructions',
            'visual-angle-calibration',
            'reward-settings',

            // Response Detection Task (independent timeline controls)
            'detection-response-task-start',
            'detection-response-task-stop'
        ]);
        if (alwaysAllowed.has(type)) return true;

        const getBlockInnerType = () => {
            if (type !== 'block') return null;
            const d = (componentData && typeof componentData === 'object') ? componentData : {};
            // Block editors sometimes store values under `parameter_values`.
            const pv = (d.parameter_values && typeof d.parameter_values === 'object') ? d.parameter_values : {};
            const inner = d.block_component_type ?? d.component_type ?? pv.block_component_type ?? pv.component_type;
            return (typeof inner === 'string' && inner.trim() !== '') ? inner.trim() : null;
        };

        // Custom: do not restrict
        if (taskType === 'custom') return true;

        if (taskType === 'rdm') {
            // RDM task: keep timeline focused on RDM components.
            if (typeof type === 'string' && type.startsWith('rdm-')) return true;
            if (type === 'block') {
                const innerType = getBlockInnerType();
                return !!innerType && innerType.startsWith('rdm-');
            }
            return false;
        }

        if (taskType === 'flanker') {
            if (type === 'flanker-trial') return true;
            if (type === 'block') {
                const innerType = getBlockInnerType();
                return innerType === 'flanker-trial';
            }
            return false;
        }

        if (taskType === 'sart') {
            if (type === 'sart-trial') return true;
            if (type === 'block') {
                const innerType = getBlockInnerType();
                return innerType === 'sart-trial';
            }
            return false;
        }

        if (taskType === 'gabor') {
            if (type === 'gabor-trial') return true;
            if (type === 'block') {
                const innerType = getBlockInnerType();
                return innerType === 'gabor-trial' || innerType === 'gabor-quest' || innerType === 'gabor-learning';
            }
            return false;
        }

        if (taskType === 'stroop') {
            if (type === 'stroop-trial') return true;
            if (type === 'block') {
                const innerType = getBlockInnerType();
                return innerType === 'stroop-trial';
            }
            return false;
        }

        if (taskType === 'emotional-stroop') {
            if (type === 'emotional-stroop-trial') return true;
            if (type === 'block') {
                const innerType = getBlockInnerType();
                return innerType === 'emotional-stroop-trial';
            }
            return false;
        }

        if (taskType === 'simon') {
            if (type === 'simon-trial') return true;
            if (type === 'block') {
                const innerType = getBlockInnerType();
                return innerType === 'simon-trial';
            }
            return false;
        }

        if (taskType === 'task-switching') {
            if (type === 'task-switching-trial') return true;
            if (type === 'block') {
                const innerType = getBlockInnerType();
                return innerType === 'task-switching-trial';
            }
            return false;
        }

        if (taskType === 'pvt') {
            if (type === 'pvt-trial') return true;
            if (type === 'block') {
                const innerType = getBlockInnerType();
                return innerType === 'pvt-trial';
            }
            return false;
        }

        if (taskType === 'mot') {
            if (type === 'mot-trial') return true;
            if (type === 'block') {
                const innerType = getBlockInnerType();
                return innerType === 'mot-trial';
            }
            return false;
        }

        if (taskType === 'nback') {
            if (type === 'nback-trial-sequence') return true;
            if (type === 'nback-block') return true;
            if (type === 'block') {
                const innerType = getBlockInnerType();
                return innerType === 'nback-block';
            }
            return false;
        }

        if (taskType === 'continuous-image') {
            if (type === 'continuous-image-presentation') return true;
            if (type === 'block') {
                const innerType = getBlockInnerType();
                return innerType === 'continuous-image-presentation';
            }
            return false;
        }

        if (taskType === 'soc-dashboard') {
            if (type === 'soc-dashboard') return true;
            if (type === 'soc-dashboard-icon') return true;
            if (type === 'soc-subtask-sart-like') return true;
            if (type === 'soc-subtask-flanker-like') return true;
            if (type === 'soc-subtask-nback-like') return true;
            if (type === 'soc-subtask-wcst-like') return true;
            if (type === 'soc-subtask-pvt-like') return true;
            return false;
        }

        // Default: be conservative
        return false;
    }

    /**
     * Sync data collection state from UI
     */
    syncDataCollectionFromUI() {
        document.querySelectorAll('.data-collection-checkbox').forEach(cb => {
            const key = cb.value;
            this.dataCollection[key] = !!cb.checked;
        });
    }

    /**
     * Handle experiment type changes
     */
    onExperimentTypeChange(event) {
        this.experimentType = event.target.value;
        console.log('Experiment type changed to:', this.experimentType);

        // Prevent switching CIP into trial-based mode (auto-revert to continuous).
        const taskTypeEl = document.getElementById('taskType');
        const taskType = taskTypeEl?.value || this.currentTaskType || 'rdm';
        if (this.experimentType === 'trial-based' && taskType === 'continuous-image') {
            const continuousRadio = document.getElementById('continuous');
            if (continuousRadio) continuousRadio.checked = true;
            this.experimentType = 'continuous';
            console.log('Reverted experiment type to continuous (CIP requires continuous mode)');
        }

        // Keep task type options consistent with experiment type.
        // (SOC Dashboard is continuous-only.)
        const taskTypeChanged = this.enforceTaskTypeAvailability();
        
        // Update UI based on experiment type
        this.updateExperimentTypeUI();
        this.updateConditionalUI();

        // If we auto-switched task types, keep the component library in sync.
        if (taskTypeChanged) {
            // Remove any now-incompatible timeline items (e.g., SOC sessions/icons).
            this.removeIncompatibleTimelineComponents(this.currentTaskType);
            this.loadComponentLibrary();
        }
        this.updateJSON();
    }

    /**
     * Handle data collection modality changes
     */
    onDataCollectionChange(event) {
        const modality = event.target.value;
        const isChecked = event.target.checked;
        
        this.dataCollection[modality] = isChecked;
        console.log(`Data collection ${modality}: ${isChecked}`);
        
        // Update data collection modules
        if (this.dataModules) {
            this.dataModules.toggleModule(modality, isChecked);
        }

        // Keep state in sync if checkboxes were manipulated programmatically
        this.syncDataCollectionFromUI();

        // Toggle conditional UI sections without re-rendering the whole panel
        this.updateConditionalUI();

        // Data-collection modalities can add/remove components (e.g., eye tracking).
        // Refresh the component library so the modal + sidebar stay in sync.
        this.loadComponentLibrary();
        
        this.updateJSON();
    }

    /**
     * Update UI based on experiment type
     */
    updateExperimentTypeUI() {
        const captureParameterFormState = () => {
            const root = document.getElementById('parameterForms');
            if (!root) return {};
            const state = {};

            root.querySelectorAll('input[id], select[id], textarea[id]').forEach((el) => {
                const id = el.id;
                if (!id) return;
                const tag = (el.tagName || '').toLowerCase();
                const type = (el.type || '').toLowerCase();

                if (tag === 'input' && (type === 'checkbox' || type === 'radio')) {
                    state[id] = { kind: 'checked', value: !!el.checked };
                } else {
                    state[id] = { kind: 'value', value: (el.value ?? '').toString() };
                }
            });

            return state;
        };

        const restoreParameterFormState = (state) => {
            const root = document.getElementById('parameterForms');
            if (!root || !state || typeof state !== 'object') return;

            for (const [id, entry] of Object.entries(state)) {
                if (!id) continue;
                const el = document.getElementById(id);
                if (!el || !root.contains(el)) continue;
                if (!entry || typeof entry !== 'object') continue;

                const tag = (el.tagName || '').toLowerCase();
                const type = (el.type || '').toLowerCase();
                const kind = entry.kind;

                if (tag === 'input' && (type === 'checkbox' || type === 'radio') && kind === 'checked') {
                    el.checked = !!entry.value;
                } else if (kind === 'value') {
                    el.value = entry.value;
                }
            }
        };

        const prevState = captureParameterFormState();

        // Enforce task-type availability whenever we rerender task-scoped panels.
        this.enforceTaskTypeAvailability();

        const parameterForms = document.getElementById('parameterForms');
        parameterForms.innerHTML = '';
        
        if (this.experimentType === 'trial-based') {
            this.showTrialBasedParameters();
        } else if (this.experimentType === 'continuous') {
            this.showContinuousParameters();
        }

        // Preserve any author-edited values (e.g., instruction templates with placeholders)
        // across experiment-type switches.
        restoreParameterFormState(prevState);

        // Ensure conditional sections match current state after re-render
        this.updateConditionalUI();
    }

    isTaskTypeAllowedForExperiment(taskType, experimentType) {
        const t = (taskType ?? '').toString().trim();
        const e = (experimentType ?? '').toString().trim();

        // Keep PVT available in both modes.
        if (t === 'pvt') return true;

        if (e === 'continuous') {
            // Only show/allow continuous-capable tasks in continuous experiments.
            // RDM has a special continuous compilation path; SOC Dashboard is also continuous-only.
            return (t === 'rdm' || t === 'soc-dashboard' || t === 'custom' || t === 'nback' || t === 'continuous-image');
        }

        // Trial-based: SOC Dashboard + Continuous Image Presentation should not be selectable.
        if (t === 'soc-dashboard') return false;
        if (t === 'continuous-image') return false;
        return true;
    }

    enforceTaskTypeAvailability() {
        const taskTypeEl = document.getElementById('taskType');
        if (!taskTypeEl) return false;

        let changed = false;

        // Show/hide task types based on experiment type.
        const options = Array.from(taskTypeEl.options || []);
        for (const opt of options) {
            const value = (opt?.value ?? '').toString();
            const allowed = this.isTaskTypeAllowedForExperiment(value, this.experimentType);
            // Prefer hiding instead of disabling so each mode has a clean dropdown.
            opt.hidden = !allowed;
            // Preserve author-intended disabled state for "Coming Soon" items.
            // But ensure allowed tasks are not disabled just because HTML had it.
            if (allowed && value === 'soc-dashboard') {
                opt.disabled = false;
            }
        }

        // If current selection is now disallowed/hidden, switch to a safe default.
        const currentAllowed = this.isTaskTypeAllowedForExperiment(taskTypeEl.value, this.experimentType);
        if (!currentAllowed) {
            const fallback = options.find(o => !o.hidden && !o.disabled && (o.value === 'rdm'))
                || options.find(o => !o.hidden && !o.disabled)
                || null;
            if (fallback) {
                taskTypeEl.value = fallback.value;
                changed = true;
            }
        }

        if (changed) {
            this.currentTaskType = taskTypeEl.value || 'rdm';
        }

        return changed;
    }

    /**
     * Show parameters for trial-based experiments
     */
    showTrialBasedParameters() {
        // Defensive: stop any continuous-mode previews when switching modes.
        this.stopCipDefaultsPreview();

        const container = document.getElementById('parameterForms');
        const taskType = document.getElementById('taskType')?.value || 'rdm';

        const taskSpecificDefaultsHtml = (taskType === 'flanker')
            ? `
            <div class="parameter-group" id="flankerExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>Flanker Experiment Settings</span>
                        <small class="text-muted d-block">Default values for Flanker components</small>
                    </div>
                    <button class="btn btn-sm btn-info" id="previewTaskDefaultsBtn" onclick="window.componentPreview?.showPreview(window.jsonBuilderInstance?.getCurrentFlankerDefaults())">
                        <i class="fas fa-eye"></i> Preview Defaults
                    </button>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Stimulus Type:</label>
                    <select class="form-control parameter-input" id="flankerStimulusType">
                        <option value="arrows" selected>Arrows</option>
                        <option value="letters">Letters</option>
                        <option value="symbols">Symbols</option>
                        <option value="custom">Custom</option>
                    </select>
                    <div class="parameter-help">Applies to newly-added Flanker trials/blocks</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Target Stimulus:</label>
                    <input type="text" class="form-control parameter-input" id="flankerTargetStimulus" value="H">
                    <div class="parameter-help">Used when stimulus type is letters/symbols/custom</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Distractor Stimulus:</label>
                    <input type="text" class="form-control parameter-input" id="flankerDistractorStimulus" value="S">
                    <div class="parameter-help">Used when congruency = incongruent (letters/symbols/custom)</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Neutral Stimulus:</label>
                    <input type="text" class="form-control parameter-input" id="flankerNeutralStimulus" value="–">
                    <div class="parameter-help">Used when congruency = neutral</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Fixation Dot:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="flankerShowFixationDot">
                            <label class="form-check-label" for="flankerShowFixationDot">Show dot under center stimulus</label>
                        </div>
                    </div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Between-trials Fixation:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="flankerShowFixationCrossBetweenTrials">
                            <label class="form-check-label" for="flankerShowFixationCrossBetweenTrials">Show fixation cross during ITI</label>
                        </div>
                    </div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Left Key:</label>
                    <input type="text" class="form-control parameter-input" id="flankerLeftKey" value="f">
                    <div class="parameter-help">Default key for "left" responses</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Right Key:</label>
                    <input type="text" class="form-control parameter-input" id="flankerRightKey" value="j">
                    <div class="parameter-help">Default key for "right" responses</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Stimulus Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="flankerStimulusDurationMs" value="800" min="0" max="10000">
                    <div class="parameter-help">Default stimulus display duration</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Trial Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="flankerTrialDurationMs" value="1500" min="0" max="30000">
                    <div class="parameter-help">Default total trial duration</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">ITI (ms):</label>
                    <input type="number" class="form-control parameter-input" id="flankerItiMs" value="500" min="0" max="10000">
                    <div class="parameter-help">Default inter-trial interval</div>
                </div>
            </div>
            `
            : (taskType === 'nback')
            ? `
            <div class="parameter-group" id="nbackExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>N-back Experiment Settings</span>
                        <small class="text-muted d-block">Default values applied to newly-added N-back blocks</small>
                    </div>
                    <button class="btn btn-sm btn-info" id="previewTaskDefaultsBtn" onclick="window.componentPreview?.showPreview(window.jsonBuilderInstance?.getCurrentNbackDefaults())">
                        <i class="fas fa-eye"></i> Preview Defaults
                    </button>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">N:</label>
                    <input type="number" class="form-control parameter-input" id="nbackDefaultN" value="2" min="1" max="6" step="1">
                    <div class="parameter-help">N-back depth</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Seed:</label>
                    <input type="text" class="form-control parameter-input" id="nbackDefaultSeed" value="1234">
                    <div class="parameter-help">Optional seed (blank = random)</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Stimulus Mode:</label>
                    <select class="form-control parameter-input" id="nbackDefaultStimulusMode">
                        <option value="letters" selected>Letters</option>
                        <option value="numbers">Numbers</option>
                        <option value="shapes">Shapes</option>
                        <option value="custom">Custom Pool</option>
                    </select>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Custom Stimulus Pool:</label>
                    <textarea class="form-control parameter-input" id="nbackDefaultStimulusPool" rows="2" placeholder="A,B,C,D"></textarea>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Target Probability:</label>
                    <input type="number" class="form-control parameter-input" id="nbackDefaultTargetProb" value="0.25" min="0" max="1" step="0.01">
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Render Mode:</label>
                    <select class="form-control parameter-input" id="nbackDefaultRenderMode">
                        <option value="token" selected>Token</option>
                        <option value="custom_html">Custom HTML Template</option>
                    </select>
                </div>

                <div class="parameter-row" id="nbackDefaultTemplateRow">
                    <label class="parameter-label">Stimulus Template HTML:</label>
                    <textarea class="form-control parameter-input" id="nbackDefaultTemplateHtml" rows="2"><div style="font-size:72px; font-weight:700; letter-spacing:0.02em;">{{TOKEN}}</div></textarea>
                    <div class="parameter-help">Used when render_mode=custom_html. Variable: {{TOKEN}}</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Stimulus (ms):</label>
                    <input type="number" class="form-control parameter-input" id="nbackDefaultStimulusMs" value="500" min="0" max="60000" step="1">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">ISI (ms):</label>
                    <input type="number" class="form-control parameter-input" id="nbackDefaultIsiMs" value="700" min="0" max="60000" step="1">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Trial (ms):</label>
                    <input type="number" class="form-control parameter-input" id="nbackDefaultTrialMs" value="1200" min="0" max="60000" step="1">
                </div>

                <div class="parameter-row" id="nbackDefaultFixationBetweenTrialsRow">
                    <label class="parameter-label">Fixation During ISI:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="nbackDefaultShowFixationCrossBetweenTrials">
                            <label class="form-check-label" for="nbackDefaultShowFixationCrossBetweenTrials">Show fixation cross when the token is hidden</label>
                        </div>
                    </div>
                    <div class="parameter-help">Interpreter renders a "+" marker during the ISI/ITI interval (between items).</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Response Paradigm:</label>
                    <select class="form-control parameter-input" id="nbackDefaultParadigm">
                        <option value="go_nogo" selected>Go/No-Go</option>
                        <option value="2afc">2AFC (match vs non-match)</option>
                    </select>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Response Device:</label>
                    <select class="form-control parameter-input" id="nbackDefaultDevice">
                        <option value="inherit">Inherit</option>
                        <option value="keyboard" selected>Keyboard</option>
                        <option value="mouse">Mouse</option>
                    </select>
                </div>

                <div class="parameter-row" id="nbackDefaultGoKeyRow">
                    <label class="parameter-label">Go Key:</label>
                    <input type="text" class="form-control parameter-input" id="nbackDefaultGoKey" value="space">
                </div>

                <div class="parameter-row" id="nbackDefaultMatchKeyRow">
                    <label class="parameter-label">Match Key:</label>
                    <input type="text" class="form-control parameter-input" id="nbackDefaultMatchKey" value="j">
                </div>

                <div class="parameter-row" id="nbackDefaultNonmatchKeyRow">
                    <label class="parameter-label">Non-match Key:</label>
                    <input type="text" class="form-control parameter-input" id="nbackDefaultNonmatchKey" value="f">
                </div>

                <div class="parameter-row" id="nbackDefaultShowButtonsRow">
                    <label class="parameter-label">Show Buttons:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="nbackDefaultShowButtons" checked>
                            <label class="form-check-label" for="nbackDefaultShowButtons">Show on-screen buttons</label>
                        </div>
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Feedback:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="nbackDefaultFeedback">
                            <label class="form-check-label" for="nbackDefaultFeedback">Show correctness feedback</label>
                        </div>
                    </div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Feedback Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="nbackDefaultFeedbackMs" value="250" min="0" max="5000" step="1">
                </div>
            </div>
            `
            : (taskType === 'sart')
            ? `
            <div class="parameter-group" id="sartExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>SART Experiment Settings</span>
                        <small class="text-muted d-block">Default values for SART components</small>
                    </div>
                    <button class="btn btn-sm btn-info" id="previewTaskDefaultsBtn" onclick="window.componentPreview?.showPreview(window.jsonBuilderInstance?.getCurrentSartDefaults())">
                        <i class="fas fa-eye"></i> Preview Defaults
                    </button>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Go Key:</label>
                    <input type="text" class="form-control parameter-input" id="sartGoKey" value="space">
                    <div class="parameter-help">Default response key for GO trials</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">No-Go Digit:</label>
                    <input type="number" class="form-control parameter-input" id="sartNoGoDigit" value="3" min="0" max="9">
                    <div class="parameter-help">Digit that signals a NO-GO trial</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Stimulus Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="sartStimulusDurationMs" value="250" min="0" max="10000">
                    <div class="parameter-help">Default digit display duration</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Mask Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="sartMaskDurationMs" value="900" min="0" max="10000">
                    <div class="parameter-help">Default mask duration after digit</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">ITI (ms):</label>
                    <input type="number" class="form-control parameter-input" id="sartItiMs" value="0" min="0" max="10000">
                    <div class="parameter-help">Default inter-trial interval</div>
                </div>
            </div>
            `
            : (taskType === 'simon')
            ? `
            <div class="parameter-group" id="simonExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>Simon Experiment Settings</span>
                        <small class="text-muted d-block">Default values for Simon components</small>
                    </div>
                    <button class="btn btn-sm btn-info" id="previewTaskDefaultsBtn" onclick="window.componentPreview?.showPreview(window.jsonBuilderInstance?.getCurrentSimonDefaults())">
                        <i class="fas fa-eye"></i> Preview Defaults
                    </button>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Stimulus A (maps to LEFT response):</label>
                    <div class="d-flex gap-2 align-items-center">
                        <input type="text" class="form-control parameter-input" id="simonStimulusName_1" value="BLUE" style="max-width: 200px;" />
                        <input type="color" class="form-control parameter-input" id="simonStimulusColor_1" value="#0066ff" style="width: 72px;" />
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Stimulus B (maps to RIGHT response):</label>
                    <div class="d-flex gap-2 align-items-center">
                        <input type="text" class="form-control parameter-input" id="simonStimulusName_2" value="ORANGE" style="max-width: 200px;" />
                        <input type="color" class="form-control parameter-input" id="simonStimulusColor_2" value="#ff7a00" style="width: 72px;" />
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Default Response Device:</label>
                    <select class="form-control parameter-input" id="simonDefaultResponseDevice">
                        <option value="keyboard" selected>Keyboard</option>
                        <option value="mouse">Mouse</option>
                    </select>
                    <div class="parameter-help">Mouse mode uses clickable left/right circles.</div>
                </div>

                <div class="parameter-row" id="simonKeyboardOnlyNote" style="display:none;">
                    <label class="parameter-label text-muted">Keyboard Mappings:</label>
                    <div class="parameter-help text-muted">Key mappings are ignored when response device is Mouse.</div>
                </div>

                <div id="simonKeyboardKeysGroup">
                    <div class="parameter-row">
                        <label class="parameter-label">Left Key:</label>
                        <input type="text" class="form-control parameter-input" id="simonLeftKey" value="f">
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Right Key:</label>
                        <input type="text" class="form-control parameter-input" id="simonRightKey" value="j">
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Circle Diameter (px):</label>
                    <input type="number" class="form-control parameter-input" id="simonCircleDiameterPx" value="140" min="40" max="400">
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Stimulus Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="simonStimulusDurationMs" value="0" min="0" max="10000">
                    <div class="parameter-help">0 = show until response or trial duration</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Trial Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="simonTrialDurationMs" value="1500" min="0" max="30000">
                    <div class="parameter-help">0 = no timeout</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">ITI (ms):</label>
                    <input type="number" class="form-control parameter-input" id="simonItiMs" value="500" min="0" max="10000">
                </div>
            </div>
            `
            : (taskType === 'task-switching')
            ? `
            <div class="parameter-group" id="taskSwitchingExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>Task Switching Experiment Settings</span>
                        <small class="text-muted d-block">Default values for Task Switching components</small>
                    </div>
                    <button class="btn btn-sm btn-info" id="previewTaskDefaultsBtn" onclick="window.componentPreview?.showPreview(window.jsonBuilderInstance?.getCurrentTaskSwitchingDefaults())">
                        <i class="fas fa-eye"></i> Preview Defaults
                    </button>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Stimulus Set:</label>
                    <select class="form-control parameter-input" id="taskSwitchingStimulusSetMode">
                        <option value="letters_numbers" selected>Letters + Numbers (Vowel/Consonant; Odd/Even)</option>
                        <option value="custom">Custom (two 2AFC token sets)</option>
                    </select>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Stimulus Position:</label>
                    <select class="form-control parameter-input" id="taskSwitchingStimulusPosition">
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                        <option value="top" selected>Top</option>
                        <option value="bottom">Bottom</option>
                    </select>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Stimulus Border:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="taskSwitchingBorderEnabled">
                            <label class="form-check-label" for="taskSwitchingBorderEnabled">Draw a border around the stimulus</label>
                        </div>
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Left Key:</label>
                    <input type="text" class="form-control parameter-input" id="taskSwitchingLeftKey" value="f">
                    <div class="parameter-help">Default key for Category A / LEFT responses</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Right Key:</label>
                    <input type="text" class="form-control parameter-input" id="taskSwitchingRightKey" value="j">
                    <div class="parameter-help">Default key for Category B / RIGHT responses</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Cue Type:</label>
                    <select class="form-control parameter-input" id="taskSwitchingCueType">
                        <option value="explicit" selected>Explicit text cue</option>
                        <option value="position">Position cue (stimulus position by task)</option>
                        <option value="color">Color cue (stimulus color by task)</option>
                    </select>
                    <div class="parameter-help">Controls how the task is cued during Task Switching trials.</div>
                </div>

                <div id="taskSwitchingCueExplicitGroup">
                    <div class="parameter-row">
                        <label class="parameter-label">Task A Cue Text:</label>
                        <input type="text" class="form-control parameter-input" id="taskSwitchingTask1CueText" value="LETTERS">
                        <div class="parameter-help">Shown when Task A is active (explicit cue type)</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Task B Cue Text:</label>
                        <input type="text" class="form-control parameter-input" id="taskSwitchingTask2CueText" value="NUMBERS">
                        <div class="parameter-help">Shown when Task B is active (explicit cue type)</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Cue Font Size (px):</label>
                        <input type="number" class="form-control parameter-input" id="taskSwitchingCueFontSizePx" value="28" min="8" max="200">
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Cue Duration (ms):</label>
                        <input type="number" class="form-control parameter-input" id="taskSwitchingCueDurationMs" value="0" min="0" max="10000">
                        <div class="parameter-help">0 = cue remains visible throughout the trial</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Cue Gap (ms):</label>
                        <input type="number" class="form-control parameter-input" id="taskSwitchingCueGapMs" value="0" min="0" max="10000">
                        <div class="parameter-help">Optional delay between cue and stimulus (if supported by the runtime)</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Cue Color:</label>
                        <input type="color" class="form-control form-control-color parameter-input" id="taskSwitchingCueColorHex" value="#FFFFFF">
                    </div>
                </div>

                <div id="taskSwitchingCuePositionGroup" style="display:none;">
                    <div class="parameter-row">
                        <label class="parameter-label">Task A Position:</label>
                        <select class="form-control parameter-input" id="taskSwitchingTask1Position">
                            <option value="left" selected>Left</option>
                            <option value="right">Right</option>
                            <option value="top">Top</option>
                            <option value="bottom">Bottom</option>
                        </select>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Task B Position:</label>
                        <select class="form-control parameter-input" id="taskSwitchingTask2Position">
                            <option value="left">Left</option>
                            <option value="right" selected>Right</option>
                            <option value="top">Top</option>
                            <option value="bottom">Bottom</option>
                        </select>
                    </div>
                </div>

                <div id="taskSwitchingCueColorGroup" style="display:none;">
                    <div class="parameter-row">
                        <label class="parameter-label">Task A Color:</label>
                        <input type="color" class="form-control form-control-color parameter-input" id="taskSwitchingTask1ColorHex" value="#FFFFFF">
                        <div class="parameter-help">Stimulus color when Task A is active (color cue type)</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Task B Color:</label>
                        <input type="color" class="form-control form-control-color parameter-input" id="taskSwitchingTask2ColorHex" value="#FFFFFF">
                        <div class="parameter-help">Stimulus color when Task B is active (color cue type)</div>
                    </div>
                </div>

                <div id="taskSwitchingCustomSets" style="display:none;">
                    <div class="parameter-row">
                        <label class="parameter-label">Task A Tokens (Category A):</label>
                        <textarea class="form-control parameter-input" id="taskSwitchingTask1CategoryA" rows="2" placeholder="e.g., A,E,I,O,U"></textarea>
                        <div class="parameter-help">Comma-separated tokens mapped to LEFT key</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Task A Tokens (Category B):</label>
                        <textarea class="form-control parameter-input" id="taskSwitchingTask1CategoryB" rows="2" placeholder="e.g., B,C,D,F,G"></textarea>
                        <div class="parameter-help">Comma-separated tokens mapped to RIGHT key</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Task B Tokens (Category A):</label>
                        <textarea class="form-control parameter-input" id="taskSwitchingTask2CategoryA" rows="2" placeholder="e.g., 1,3,5,7,9"></textarea>
                        <div class="parameter-help">Comma-separated tokens mapped to LEFT key</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Task B Tokens (Category B):</label>
                        <textarea class="form-control parameter-input" id="taskSwitchingTask2CategoryB" rows="2" placeholder="e.g., 2,4,6,8"></textarea>
                        <div class="parameter-help">Comma-separated tokens mapped to RIGHT key</div>
                    </div>
                </div>
            </div>
            `
            : (taskType === 'pvt')
            ? `
            <div class="parameter-group" id="pvtExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>PVT Experiment Settings</span>
                        <small class="text-muted d-block">Default values for PVT components</small>
                    </div>
                    <button class="btn btn-sm btn-info" id="previewTaskDefaultsBtn" onclick="window.componentPreview?.showPreview(window.jsonBuilderInstance?.getCurrentPvtDefaults())">
                        <i class="fas fa-eye"></i> Preview Defaults
                    </button>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Default Response Device:</label>
                    <select class="form-control parameter-input" id="pvtDefaultResponseDevice">
                        <option value="keyboard" selected>Keyboard</option>
                        <option value="mouse">Mouse</option>
                        <option value="both">Both</option>
                    </select>
                    <div class="parameter-help">Mouse mode registers clicks on the timer screen. Both allows keyboard + click.</div>
                </div>

                <div class="parameter-row" id="pvtKeyboardOnlyNote" style="display:none;">
                    <label class="parameter-label text-muted">Keyboard Mapping:</label>
                    <div class="parameter-help text-muted">Key mapping is ignored when response device is Mouse.</div>
                </div>

                <div id="pvtKeyboardKeysGroup">
                    <div class="parameter-row">
                        <label class="parameter-label">Response Key:</label>
                        <input type="text" class="form-control parameter-input" id="pvtResponseKey" value="space">
                        <div class="parameter-help">Key used to respond when the timer is running</div>
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Foreperiod (ms):</label>
                    <input type="number" class="form-control parameter-input" id="pvtForeperiodMs" value="4000" min="0" max="60000">
                    <div class="parameter-help">Delay before timer starts (blocks can randomize this)</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Trial Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="pvtTrialDurationMs" value="10000" min="0" max="60000">
                    <div class="parameter-help">0 = no timeout (timer can run indefinitely)</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">ITI (ms):</label>
                    <input type="number" class="form-control parameter-input" id="pvtItiMs" value="0" min="0" max="30000">
                    <div class="parameter-help">Post-trial gap after response/timeout</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Feedback Mode:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="pvtFeedbackEnabled">
                            <label class="form-check-label" for="pvtFeedbackEnabled">Show feedback message on false starts (responses before the timer starts)</label>
                        </div>
                    </div>
                </div>

                <div class="parameter-row" id="pvtFeedbackMessageGroup" style="display:none;">
                    <label class="parameter-label">Feedback Message:</label>
                    <textarea class="form-control parameter-input" id="pvtFeedbackMessage" rows="2" placeholder="e.g., Too soon! / Please wait for the timer."></textarea>
                    <div class="parameter-help">Displayed only after false starts (researcher-defined)</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">False Start Handling:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="pvtAddTrialPerFalseStart">
                            <label class="form-check-label" for="pvtAddTrialPerFalseStart">Add one extra trial per false start</label>
                        </div>
                        <div class="parameter-help">When enabled, false starts do not count toward the intended PVT block length (Interpreter extends the block to preserve the target number of valid trials).</div>
                    </div>
                </div>
            </div>
            `
            : (taskType === 'mot')
            ? `
            <div class="parameter-group" id="motExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>MOT Experiment Settings</span>
                        <small class="text-muted d-block">Default values for MOT components</small>
                    </div>
                    <button class="btn btn-sm btn-info" id="previewTaskDefaultsBtn" onclick="window.componentPreview?.showPreview(window.jsonBuilderInstance?.getCurrentMotDefaults())">
                        <i class="fas fa-eye"></i> Preview Defaults
                    </button>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label"># Objects:</label>
                    <input type="number" class="form-control parameter-input" id="motNumObjectsDefault" value="8" min="2" max="20">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label"># Targets:</label>
                    <input type="number" class="form-control parameter-input" id="motNumTargetsDefault" value="4" min="1" max="10">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Speed (px/s):</label>
                    <input type="number" class="form-control parameter-input" id="motSpeedDefault" value="150" min="20" max="600">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Motion Type:</label>
                    <select class="form-control parameter-input" id="motMotionTypeDefault">
                        <option value="linear" selected>Linear</option>
                        <option value="curved">Curved</option>
                    </select>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Probe Mode:</label>
                    <select class="form-control parameter-input" id="motProbeModeDefault">
                        <option value="click" selected>Click</option>
                        <option value="number_entry">Number entry</option>
                    </select>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Cue Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="motCueDurationMsDefault" value="2000" min="0" max="30000">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Tracking Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="motTrackingDurationMsDefault" value="8000" min="0" max="60000">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">ITI (ms):</label>
                    <input type="number" class="form-control parameter-input" id="motItiMsDefault" value="1000" min="0" max="30000">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Show Feedback:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="motShowFeedbackDefault">
                            <label class="form-check-label" for="motShowFeedbackDefault">Highlight correct/incorrect picks</label>
                        </div>
                    </div>
                </div>
            </div>
            `
            : (taskType === 'gabor')
            ? `
            <div class="parameter-group" id="gaborExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>Gabor Experiment Settings</span>
                        <small class="text-muted d-block">Default values for Gabor components</small>
                    </div>
                    <button class="btn btn-sm btn-info" id="previewTaskDefaultsBtn" onclick="window.componentPreview?.showPreview(window.jsonBuilderInstance?.getCurrentGaborDefaults())">
                        <i class="fas fa-eye"></i> Preview Defaults
                    </button>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Response Task:</label>
                    <select class="form-control parameter-input" id="gaborResponseTask">
                        <option value="detect_target">Detect target (yes/no)</option>
                        <option value="discriminate_tilt" selected>Discriminate target tilt (left/right)</option>
                    </select>
                    <div class="parameter-help">Interpreter decides scoring based on this mode</div>
                </div>

                <div id="gaborDirectionKeysGroup">
                    <div class="parameter-row">
                        <label class="parameter-label">Left Key:</label>
                        <input type="text" class="form-control parameter-input" id="gaborLeftKey" value="f">
                        <div class="parameter-help">Used for left-tilt responses (discriminate_tilt)</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Right Key:</label>
                        <input type="text" class="form-control parameter-input" id="gaborRightKey" value="j">
                        <div class="parameter-help">Used for right-tilt responses (discriminate_tilt)</div>
                    </div>
                </div>

                <div id="gaborDetectionKeysGroup">
                    <div class="parameter-row">
                        <label class="parameter-label">Yes Key:</label>
                        <input type="text" class="form-control parameter-input" id="gaborYesKey" value="f">
                        <div class="parameter-help">Used for target-present responses (detect_target)</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">No Key:</label>
                        <input type="text" class="form-control parameter-input" id="gaborNoKey" value="j">
                        <div class="parameter-help">Used for target-absent responses (detect_target)</div>
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">High Value Color:</label>
                    <input type="color" class="form-control parameter-input" id="gaborHighValueColor" value="#00aa00">
                    <div class="parameter-help">Example: green = high value</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Low Value Color:</label>
                    <input type="color" class="form-control parameter-input" id="gaborLowValueColor" value="#0066ff">
                    <div class="parameter-help">Example: blue = low value</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Patch Border:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="gaborPatchBorderEnabled" checked>
                            <label class="form-check-label" for="gaborPatchBorderEnabled">Draw circular border around each patch</label>
                        </div>
                    </div>
                    <div class="parameter-help">Controls the circle border drawn around the Gabor stimulus + mask</div>
                </div>
                <div id="gaborPatchBorderDetails">
                <div class="parameter-row">
                    <label class="parameter-label">Border Width (px):</label>
                    <input type="number" class="form-control parameter-input" id="gaborPatchBorderWidthPx" value="2" min="0" max="50" step="1">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Border Color:</label>
                    <input type="color" class="form-control parameter-input" id="gaborPatchBorderColor" value="#ffffff">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Border Opacity (0–1):</label>
                    <input type="number" class="form-control parameter-input" id="gaborPatchBorderOpacity" value="0.22" min="0" max="1" step="0.01">
                </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Spatial Frequency (cyc/px):</label>
                    <input type="number" class="form-control parameter-input" id="gaborSpatialFrequency" value="0.06" min="0.001" max="0.5" step="0.001">
                    <div class="parameter-help">Spatial frequency of the grating carrier (Gaussian envelope)</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Grating Waveform:</label>
                    <select class="form-control parameter-input" id="gaborGratingWaveform">
                        <option value="sinusoidal" selected>Sinusoidal</option>
                        <option value="square">Square</option>
                        <option value="triangle">Triangle</option>
                    </select>
                    <div class="parameter-help">Carrier waveform; envelope remains Gaussian</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Patch Diameter (deg):</label>
                    <input type="number" class="form-control parameter-input" id="gaborPatchDiameterDeg" value="6" min="0.1" max="60" step="0.1">
                    <div class="parameter-help">Primary size control: patch diameter in degrees of visual angle. For true degree-based sizing, add a Visual Angle Calibration component before Gabor trials/blocks.</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Spatial Cue Validity (0–1):</label>
                    <input type="number" class="form-control parameter-input" id="gaborSpatialCueValidity" value="0.8" min="0" max="1" step="0.01">
                    <div class="parameter-help">Directional arrow indicates this probability the target is at the cued location</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Spatial Cue Enabled:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="gaborSpatialCueEnabled" checked>
                            <label class="form-check-label" for="gaborSpatialCueEnabled">Enable</label>
                        </div>
                    </div>
                    <div class="parameter-help">Gabor: enable sampling spatial cue presence per trial (when false: spatial_cue forced to none)</div>
                </div>
                <div id="gaborSpatialCueDetails">
                    <div class="parameter-row">
                        <label class="parameter-label">Spatial Cue Options:</label>
                        <input type="text" class="form-control parameter-input" id="gaborSpatialCueOptions" value="none,left,right,both">
                        <div class="parameter-help">Gabor: comma-separated spatial cue options to sample from. Allowed: none, left, right, both.</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Spatial Cue Probability:</label>
                        <input type="number" class="form-control parameter-input" id="gaborSpatialCueProbability" value="1" min="0" max="1" step="0.01">
                        <div class="parameter-help">Gabor: probability a trial contains a spatial cue (0–1)</div>
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Value Cue Enabled:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="gaborValueCueEnabled" checked>
                            <label class="form-check-label" for="gaborValueCueEnabled">Enable</label>
                        </div>
                    </div>
                    <div class="parameter-help">Gabor: enable sampling value cue presence per trial (when false: left/right_value forced to neutral)</div>
                </div>
                <div id="gaborValueCueDetails">
                    <div class="parameter-row">
                        <label class="parameter-label">Left Value Options:</label>
                        <input type="text" class="form-control parameter-input" id="gaborLeftValueOptions" value="neutral,high,low">
                        <div class="parameter-help">Gabor: comma-separated left value cue options to sample from. Allowed: neutral, high, low.</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Right Value Options:</label>
                        <input type="text" class="form-control parameter-input" id="gaborRightValueOptions" value="neutral,high,low">
                        <div class="parameter-help">Gabor: comma-separated right value cue options to sample from. Allowed: neutral, high, low.</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Value Cue Probability:</label>
                        <input type="number" class="form-control parameter-input" id="gaborValueCueProbability" value="1" min="0" max="1" step="0.01">
                        <div class="parameter-help">Gabor: probability a trial contains value cues (0–1)</div>
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Fixation (ms):</label>
                    <input type="number" class="form-control parameter-input" id="gaborFixationMs" value="1000" min="0" max="20000">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Placeholders (ms):</label>
                    <input type="number" class="form-control parameter-input" id="gaborPlaceholdersMs" value="400" min="0" max="20000">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Cue (ms):</label>
                    <input type="number" class="form-control parameter-input" id="gaborCueMs" value="300" min="0" max="20000">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Cue→Target Delay Min (ms):</label>
                    <input type="number" class="form-control parameter-input" id="gaborCueDelayMinMs" value="100" min="0" max="20000">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Cue→Target Delay Max (ms):</label>
                    <input type="number" class="form-control parameter-input" id="gaborCueDelayMaxMs" value="200" min="0" max="20000">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Stimulus Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="gaborStimulusDurationMs" value="67" min="0" max="10000">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Mask Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="gaborMaskDurationMs" value="67" min="0" max="10000">
                </div>
            </div>
            `
            : (taskType === 'stroop')
            ? `
            <div class="parameter-group" id="stroopExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>Stroop Experiment Settings</span>
                        <small class="text-muted d-block">Default values for Stroop components</small>
                    </div>
                    <button class="btn btn-sm btn-info" id="previewTaskDefaultsBtn" onclick="window.componentPreview?.showPreview(window.jsonBuilderInstance?.getCurrentStroopDefaults())">
                        <i class="fas fa-eye"></i> Preview Defaults
                    </button>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Stimulus Set Size:</label>
                    <input type="number" class="form-control parameter-input" id="stroopStimulusSetSize" value="4" min="2" max="7">
                    <div class="parameter-help">Number of color-name stimuli (2–7)</div>
                </div>

                <div id="stroopStimuliRows"></div>

                <div class="parameter-row">
                    <label class="parameter-label">Default Response Mode:</label>
                    <select class="form-control parameter-input" id="stroopDefaultResponseMode">
                        <option value="color_naming" selected>Precise color naming (choose ink color)</option>
                        <option value="congruency">Congruency judgment (match vs mismatch)</option>
                    </select>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Default Response Device:</label>
                    <select class="form-control parameter-input" id="stroopDefaultResponseDevice">
                        <option value="keyboard" selected>Keyboard</option>
                        <option value="mouse">Mouse</option>
                    </select>
                    <div class="parameter-help">Mouse mode shows on-screen buttons; keyboard uses keys below.</div>
                </div>

                <div class="parameter-row" id="stroopKeyboardOnlyNote" style="display:none;">
                    <label class="parameter-label text-muted">Keyboard Mappings:</label>
                    <div class="parameter-help text-muted">Key mappings are ignored when response device is Mouse.</div>
                </div>

                <div id="stroopColorNamingKeysGroup">
                    <div class="parameter-row">
                        <label class="parameter-label">Choice Keys:</label>
                        <input type="text" class="form-control parameter-input" id="stroopChoiceKeys" value="1,2,3,4">
                        <div class="parameter-help">Comma-separated keys mapped to Stimulus 1..N (e.g., 1,2,3,4)</div>
                    </div>
                </div>

                <div id="stroopCongruencyKeysGroup" style="display:none;">
                    <div class="parameter-row">
                        <label class="parameter-label">Congruent Key:</label>
                        <input type="text" class="form-control parameter-input" id="stroopCongruentKey" value="f">
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Incongruent Key:</label>
                        <input type="text" class="form-control parameter-input" id="stroopIncongruentKey" value="j">
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Font Size (px):</label>
                    <input type="number" class="form-control parameter-input" id="stroopStimulusFontSizePx" value="64" min="10" max="200">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Stimulus Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="stroopStimulusDurationMs" value="0" min="0" max="10000">
                    <div class="parameter-help">0 = show until response or trial duration</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Trial Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="stroopTrialDurationMs" value="2000" min="0" max="30000">
                    <div class="parameter-help">0 = no timeout</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">ITI (ms):</label>
                    <input type="number" class="form-control parameter-input" id="stroopItiMs" value="500" min="0" max="10000">
                </div>
            </div>
            `
            : (taskType === 'emotional-stroop')
            ? `
            <div class="parameter-group" id="emotionalStroopExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>Emotional Stroop Experiment Settings</span>
                        <small class="text-muted d-block">Default values for Emotional Stroop components</small>
                    </div>
                    <button class="btn btn-sm btn-info" id="previewTaskDefaultsBtn" onclick="window.componentPreview?.showPreview(window.jsonBuilderInstance?.getCurrentEmotionalStroopDefaults())">
                        <i class="fas fa-eye"></i> Preview Defaults
                    </button>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Word Lists:</label>
                    <div class="d-flex gap-2 align-items-center" style="flex-wrap:wrap;">
                        <select class="form-control parameter-input" id="emotionalStroopWordListCount" style="max-width: 180px;">
                            <option value="2" selected>2 lists</option>
                            <option value="3">3 lists</option>
                        </select>
                        <div class="parameter-help mb-0">Choose 2 or 3 labeled word pools (labels recorded in data)</div>
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">List 1 Label:</label>
                    <input type="text" class="form-control parameter-input" id="emotionalStroopWordList1Label" value="Neutral">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">List 1 Words:</label>
                    <textarea class="form-control parameter-input" id="emotionalStroopWordList1Words" rows="2">CHAIR,TABLE,WINDOW</textarea>
                    <div class="parameter-help">Comma-separated words in this list</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">List 2 Label:</label>
                    <input type="text" class="form-control parameter-input" id="emotionalStroopWordList2Label" value="Negative">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">List 2 Words:</label>
                    <textarea class="form-control parameter-input" id="emotionalStroopWordList2Words" rows="2">SAD,ANGRY,FEAR</textarea>
                    <div class="parameter-help">Comma-separated words in this list</div>
                </div>

                <div id="emotionalStroopWordList3Group" style="display:none;">
                    <div class="parameter-row">
                        <label class="parameter-label">List 3 Label:</label>
                        <input type="text" class="form-control parameter-input" id="emotionalStroopWordList3Label" value="Positive">
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">List 3 Words:</label>
                        <textarea class="form-control parameter-input" id="emotionalStroopWordList3Words" rows="2">HAPPY,JOY,LOVE</textarea>
                        <div class="parameter-help">Comma-separated words in this list</div>
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label text-muted">Data Capture:</label>
                    <div class="parameter-help">When trials are generated from Blocks, the selected list label is stored in <code>word_list_label</code> (and index in <code>word_list_index</code>).</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Ink Palette Size:</label>
                    <input type="number" class="form-control parameter-input" id="stroopStimulusSetSize" value="4" min="2" max="7">
                    <div class="parameter-help">Number of ink colors available for this task (2–7)</div>
                </div>

                <div id="stroopStimuliRows"></div>

                <div class="parameter-row">
                    <label class="parameter-label">Default Response Device:</label>
                    <select class="form-control parameter-input" id="stroopDefaultResponseDevice">
                        <option value="keyboard" selected>Keyboard</option>
                        <option value="mouse">Mouse</option>
                    </select>
                    <div class="parameter-help">Mouse mode shows on-screen buttons; keyboard uses keys below.</div>
                </div>

                <div class="parameter-row" id="stroopKeyboardOnlyNote" style="display:none;">
                    <label class="parameter-label text-muted">Keyboard Mappings:</label>
                    <div class="parameter-help text-muted">Key mappings are ignored when response device is Mouse.</div>
                </div>

                <div id="stroopColorNamingKeysGroup">
                    <div class="parameter-row">
                        <label class="parameter-label">Choice Keys:</label>
                        <input type="text" class="form-control parameter-input" id="stroopChoiceKeys" value="1,2,3,4">
                        <div class="parameter-help">Comma-separated keys mapped to Ink 1..N (e.g., 1,2,3,4)</div>
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Font Size (px):</label>
                    <input type="number" class="form-control parameter-input" id="stroopStimulusFontSizePx" value="64" min="10" max="200">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Stimulus Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="stroopStimulusDurationMs" value="0" min="0" max="10000">
                    <div class="parameter-help">0 = show until response or trial duration</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Trial Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="stroopTrialDurationMs" value="2000" min="0" max="30000">
                    <div class="parameter-help">0 = no timeout</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">ITI (ms):</label>
                    <input type="number" class="form-control parameter-input" id="stroopItiMs" value="500" min="0" max="10000">
                </div>
            </div>
            `
            : (taskType === 'soc-dashboard')
            ? `
            <div class="parameter-group" id="socDashboardExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>SOC Dashboard Settings</span>
                        <small class="text-muted d-block">Experiment-wide defaults (applies to newly-added SOC session components). Add subtasks via the Component Library.</small>
                    </div>
                    <button class="btn btn-sm btn-info" id="previewTaskDefaultsBtn" onclick="window.componentPreview?.showPreview(window.jsonBuilderInstance?.getCurrentSocDashboardDefaults())">
                        <i class="fas fa-eye"></i> Preview Defaults
                    </button>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Session Title:</label>
                    <input type="text" class="form-control parameter-input" id="socTitle" value="SOC Dashboard">
                    <div class="parameter-help">Shown in the subtask window titlebars</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Wallpaper URL:</label>
                    <input type="text" class="form-control parameter-input" id="socWallpaperUrl" value="" placeholder="https://...">
                    <div class="parameter-help">Optional background image URL (leave blank for default gradient)</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Background Color:</label>
                    <input type="color" class="form-control parameter-input" id="socBackgroundColor" value="#0b1220">
                    <div class="parameter-help">Used when no wallpaper URL is provided</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Desktop Icons Clickable:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="socIconsClickable" checked>
                            <label class="form-check-label" for="socIconsClickable">Show icons as clickable</label>
                        </div>
                    </div>
                    <div class="parameter-help">If disabled, icon clicks can still be logged (visual affordance only)</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Log Icon Clicks:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="socLogIconClicks" checked>
                            <label class="form-check-label" for="socLogIconClicks">Record icon clicks in the trial events log</label>
                        </div>
                    </div>
                    <div class="parameter-help">Useful for multitasking/distractor analysis</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Tag Icon Clicks as Distractors:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="socIconClicksAreDistractors" checked>
                            <label class="form-check-label" for="socIconClicksAreDistractors">Add a distractor flag to icon-click events</label>
                        </div>
                    </div>
                    <div class="parameter-help">When enabled, icon-click events include <code>distractor: true</code></div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Default App:</label>
                    <select class="form-control parameter-input" id="socDefaultApp">
                        <option value="soc" selected>SOC</option>
                        <option value="email">Email</option>
                        <option value="terminal">Terminal</option>
                    </select>
                    <div class="parameter-help">Initial active app when the session starts</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Number of Tasks:</label>
                    <input type="number" class="form-control parameter-input" id="socNumTasks" value="1" min="1" max="4">
                    <div class="parameter-help">Fallback window count used when no subtasks are configured (1–4)</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Session Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="socSessionDurationMs" value="60000" min="0" max="3600000">
                    <div class="parameter-help">0 = no auto-end (participant ends with end key)</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">End Key:</label>
                    <input type="text" class="form-control parameter-input" id="socEndKey" value="escape">
                    <div class="parameter-help">Key that ends the session (e.g., escape)</div>
                </div>
            </div>
            `
            : '';
        
        const html = `
            <div class="parameter-group">
                <div class="group-title">Trial Configuration</div>
                <div class="parameter-row">
                    <label class="parameter-label">Number of Trials:</label>
                    <input type="number" class="form-control parameter-input" id="numTrials" value="20" min="1">
                    <div class="parameter-help">Total number of experimental trials</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">ITI (ms):</label>
                    <input type="number" class="form-control parameter-input" id="iti" value="1000" min="0">
                    <div class="parameter-help">Inter-trial interval in milliseconds</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Randomize Order:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="randomizeOrder" checked>
                            <label class="form-check-label" for="randomizeOrder">Enable randomization</label>
                        </div>
                    </div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Rewards Enabled:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="rewardsEnabled">
                            <label class="form-check-label" for="rewardsEnabled">Enable rewards</label>
                        </div>
                    </div>
                    <div class="parameter-help">When enabled, the Builder adds a Reward Settings component to the timeline so reward policy doesn’t clutter experiment-wide defaults.</div>
                </div>
            </div>
            
            ${taskType === 'rdm' ? `
            <!-- RDM-specific experiment parameters -->
            <div class="parameter-group" id="rdmExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>RDM Experiment Settings</span>
                        <small class="text-muted d-block">Default values for all components</small>
                    </div>
                    <button class="btn btn-sm btn-info" id="previewRDMBtn" onclick="window.componentPreview?.showPreview(window.jsonBuilderInstance?.getCurrentRDMParameters())">
                        <i class="fas fa-eye"></i> Preview Defaults
                    </button>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Canvas Width (px):</label>
                    <input type="number" class="form-control parameter-input" id="canvasWidth" value="600" min="400" max="1200">
                    <div class="parameter-help">Width of the stimulus display area</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Canvas Height (px):</label>
                    <input type="number" class="form-control parameter-input" id="canvasHeight" value="600" min="300" max="900">
                    <div class="parameter-help">Height of the stimulus display area</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Aperture Shape:</label>
                    <select class="form-control parameter-input" id="apertureShape">
                        <option value="circle">Circle</option>
                        <option value="rectangle">Rectangle</option>
                    </select>
                    <div class="parameter-help">Shape of the stimulus aperture area</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Aperture Diameter (px):</label>
                    <input type="number" class="form-control parameter-input" id="apertureDiameter" value="350" min="50" max="800">
                    <div class="parameter-help">Diameter (circle) or width (rectangle) of aperture</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Aperture Outline:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input parameter-input" type="checkbox" id="apertureOutlineEnabled">
                            <label class="form-check-label" for="apertureOutlineEnabled">Show outline</label>
                        </div>
                    </div>
                    <div class="parameter-help">Experiment default: draw an outline around the aperture</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Outline Width (px):</label>
                    <input type="number" class="form-control parameter-input" id="apertureOutlineWidth" value="2" min="0" max="50" step="0.5">
                    <div class="parameter-help">Experiment default outline width (used when outline is enabled)</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Outline Color:</label>
                    <input type="color" class="form-control parameter-input" id="apertureOutlineColor" value="#FFFFFF">
                    <div class="parameter-help">Experiment default outline color (used when outline is enabled)</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Background Color:</label>
                    <input type="color" class="form-control parameter-input" id="backgroundColor" value="#404040">
                    <div class="parameter-help">Background color for stimulus display</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Dot Size (px):</label>
                    <input type="number" class="form-control parameter-input" id="dotSize" value="4" min="1" max="10">
                    <div class="parameter-help">Size of individual dots in pixels</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Dot Color:</label>
                    <input type="color" class="form-control parameter-input" id="dotColor" value="#ffffff">
                    <div class="parameter-help">Color of the moving dots</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Total Dots:</label>
                    <input type="number" class="form-control parameter-input" id="totalDots" value="150" min="10" max="500">
                    <div class="parameter-help">Total number of dots to display</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Motion Coherence:</label>
                    <input type="range" class="form-range" id="motionCoherence" min="0" max="1" step="0.01" value="0.5">
                    <div class="parameter-help">Proportion of dots moving coherently (0-1): <span id="coherenceValue">0.50</span></div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Direction (degrees):</label>
                    <input type="number" class="form-control parameter-input" id="motionDirection" value="0" min="0" max="359">
                    <div class="parameter-help">Direction of coherent motion in degrees (0 = right, 90 = down)</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Speed (px/frame):</label>
                    <input type="number" class="form-control parameter-input" id="motionSpeed" value="5" min="1" max="20">
                    <div class="parameter-help">Speed of dot movement in pixels per frame</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Dot Lifetime (frames):</label>
                    <input type="number" class="form-control parameter-input" id="dotLifetime" value="60" min="10" max="200">
                    <div class="parameter-help">How long each dot lives before being replaced (frames)</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Noise Type:</label>
                    <select class="form-control parameter-input" id="noiseType">
                        <option value="random_direction">Random Direction</option>
                        <option value="random_walk">Random Walk</option>
                        <option value="brownian">Brownian</option>
                    </select>
                    <div class="parameter-help">Noise motion model for incoherent dots</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Fixation Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="fixationDuration" value="500" min="0" max="2000">
                    <div class="parameter-help">Duration of fixation cross before stimulus</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Stimulus Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="stimulusDuration" value="1500" min="100" max="30000">
                    <div class="parameter-help">How long to display the dots</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Response Deadline (ms):</label>
                    <input type="number" class="form-control parameter-input" id="responseDeadline" value="2500" min="100" max="30000">
                    <div class="parameter-help">Maximum time allowed for a response</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Inter-trial Interval (ms):</label>
                    <input type="number" class="form-control parameter-input" id="interTrialInterval" value="1200" min="0" max="10000">
                    <div class="parameter-help">Time between trials</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Default Response:</label>
                    <select class="form-control parameter-input" id="defaultResponseDevice">
                        <option value="keyboard" selected>Keyboard</option>
                        <option value="mouse">Mouse</option>
                        <option value="touch">Touch</option>
                        <option value="voice">Voice</option>
                        <option value="custom">Custom</option>
                    </select>
                    <div class="parameter-help">Default response device for RDM trials. Individual components can still override/add response types.</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Response Keys:</label>
                    <input type="text" class="form-control parameter-input" id="responseKeys" value="ArrowLeft,ArrowRight">
                    <div class="parameter-help">Comma-separated list of valid response keys</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Require Response:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="requireResponse" checked>
                            <label class="form-check-label" for="requireResponse">Require a response to proceed</label>
                        </div>
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label text-muted">Response Ends Condition:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="endConditionOnResponse" disabled>
                            <label class="form-check-label text-muted" for="endConditionOnResponse">Continuous-only (disabled for trial-based)</label>
                        </div>
                    </div>
                    <div class="parameter-help text-muted">When enabled (continuous mode), a response will end the current condition and advance/transition immediately.</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Default Feedback:</label>
                    <select class="form-control parameter-input" id="defaultFeedbackType">
                        <option value="off" selected>Off</option>
                        <option value="corner-text">Corner Text</option>
                        <option value="arrow">Arrow</option>
                        <option value="custom">Custom (placeholder)</option>
                    </select>
                    <div class="parameter-help">Optional feedback shown after response (applies by default; components can override).</div>
                </div>
                <div class="parameter-row" id="feedbackDurationRow" style="display:none;">
                    <label class="parameter-label">Feedback Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="defaultFeedbackDuration" value="500" min="0" max="20000" disabled>
                    <div class="parameter-help">How long feedback is displayed after the response</div>
                </div>
                <div id="mouseResponseSettings" style="display: none;">
                    <div class="parameter-row">
                        <label class="parameter-label">Mouse Response:</label>
                        <div class="parameter-help">Shown only when Default Response is set to Mouse.</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Aperture Segments:</label>
                        <input type="number" class="form-control parameter-input" id="mouseApertureSegments" value="2" min="2" max="12">
                        <div class="parameter-help">Number of clickable segments around the aperture</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Start Angle (deg):</label>
                        <input type="number" class="form-control parameter-input" id="mouseSegmentStartAngle" value="0" min="0" max="359">
                        <div class="parameter-help">Angle offset for segment 0 (0 = right)</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Selection Mode:</label>
                        <select class="form-control parameter-input" id="mouseSelectionMode">
                            <option value="click" selected>Click</option>
                            <option value="hover">Hover (no click)</option>
                        </select>
                        <div class="parameter-help">How a segment selection is registered</div>
                    </div>
                </div>
            </div>
            ` : ''}

            ${taskSpecificDefaultsHtml}
        `;
        
        container.innerHTML = html;
        
        // Add event listeners for parameter changes
        container.querySelectorAll('input, select, textarea').forEach(el => {
            el.addEventListener('change', this.updateJSON);
        });

        // Keep conditional UI in sync when default response changes
        const defaultResponseEl = document.getElementById('defaultResponseDevice');
        if (defaultResponseEl) {
            defaultResponseEl.addEventListener('change', () => this.updateConditionalUI());
        }

        const feedbackTypeEl = document.getElementById('defaultFeedbackType');
        if (feedbackTypeEl) {
            feedbackTypeEl.addEventListener('change', () => this.updateConditionalUI());
        }

        // Task-specific conditional UI (Gabor response keys)
        this.bindGaborSettingsUI();

        // Task-specific conditional UI (Stroop stimulus set + response mappings)
        this.bindStroopSettingsUI();

        // Emotional Stroop: word-list UI (2 vs 3 lists)
        this.bindEmotionalStroopWordListUI();

        // Task-specific conditional UI (Simon response device + keys)
        this.bindSimonSettingsUI();

        // Task-specific conditional UI (Task Switching custom stimulus sets)
        this.bindTaskSwitchingSettingsUI();

        // Reduce default scrolling: collapse long experiment-default sections.
        this.wrapParameterFormsInCollapsibles();

        // Task-specific conditional UI (PVT response device + key)
        this.bindPvtSettingsUI();

        // Task-specific conditional UI (N-back defaults)
        this.bindNbackSettingsUI();

        // Rewards toggle (experiment-wide)
        this.bindRewardsToggleUI();
        
        // Add specific listener for coherence slider
        const coherenceSlider = document.getElementById('motionCoherence');
        const coherenceValue = document.getElementById('coherenceValue');
        if (coherenceSlider && coherenceValue) {
            coherenceSlider.addEventListener('input', function() {
                coherenceValue.textContent = parseFloat(this.value).toFixed(2);
            });
        }
    }

    /**
     * Show parameters for continuous experiments
     */
    showContinuousParameters() {
        // Ensure we don't leave timeouts running while swapping the UI.
        this.stopCipDefaultsPreview();

        const container = document.getElementById('parameterForms');
        const taskType = document.getElementById('taskType')?.value || 'rdm';

        const taskSpecificDefaultsHtml = (taskType === 'flanker')
            ? `
            <div class="parameter-group" id="flankerExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>Flanker Experiment Settings</span>
                        <small class="text-muted d-block">Default values for Flanker components</small>
                    </div>
                    <button class="btn btn-sm btn-info" id="previewTaskDefaultsBtn" onclick="window.componentPreview?.showPreview(window.jsonBuilderInstance?.getCurrentFlankerDefaults())">
                        <i class="fas fa-eye"></i> Preview Defaults
                    </button>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Stimulus Type:</label>
                    <select class="form-control parameter-input" id="flankerStimulusType">
                        <option value="arrows" selected>Arrows</option>
                        <option value="letters">Letters</option>
                        <option value="symbols">Symbols</option>
                        <option value="custom">Custom</option>
                    </select>
                    <div class="parameter-help">Applies to newly-added Flanker trials/blocks</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Target Stimulus:</label>
                    <input type="text" class="form-control parameter-input" id="flankerTargetStimulus" value="H">
                    <div class="parameter-help">Used when stimulus type is letters/symbols/custom</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Distractor Stimulus:</label>
                    <input type="text" class="form-control parameter-input" id="flankerDistractorStimulus" value="S">
                    <div class="parameter-help">Used when congruency = incongruent (letters/symbols/custom)</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Neutral Stimulus:</label>
                    <input type="text" class="form-control parameter-input" id="flankerNeutralStimulus" value="–">
                    <div class="parameter-help">Used when congruency = neutral</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Fixation Dot:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="flankerShowFixationDot">
                            <label class="form-check-label" for="flankerShowFixationDot">Show dot under center stimulus</label>
                        </div>
                    </div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Between-trials Fixation:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="flankerShowFixationCrossBetweenTrials">
                            <label class="form-check-label" for="flankerShowFixationCrossBetweenTrials">Show fixation cross during ITI</label>
                        </div>
                    </div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Left Key:</label>
                    <input type="text" class="form-control parameter-input" id="flankerLeftKey" value="f">
                    <div class="parameter-help">Default key for "left" responses</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Right Key:</label>
                    <input type="text" class="form-control parameter-input" id="flankerRightKey" value="j">
                    <div class="parameter-help">Default key for "right" responses</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Stimulus Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="flankerStimulusDurationMs" value="800" min="0" max="10000">
                    <div class="parameter-help">Default stimulus display duration</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Trial Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="flankerTrialDurationMs" value="1500" min="0" max="30000">
                    <div class="parameter-help">Default total trial duration</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">ITI (ms):</label>
                    <input type="number" class="form-control parameter-input" id="flankerItiMs" value="500" min="0" max="10000">
                    <div class="parameter-help">Default inter-trial interval</div>
                </div>
            </div>
            `
            : (taskType === 'nback')
            ? `
            <div class="parameter-group" id="nbackExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>N-back Experiment Settings</span>
                        <small class="text-muted d-block">Default values applied to newly-added N-back streams/sequences</small>
                    </div>
                    <button class="btn btn-sm btn-info" id="previewTaskDefaultsBtn" onclick="window.componentPreview?.showPreview(window.jsonBuilderInstance?.getCurrentNbackDefaults())">
                        <i class="fas fa-eye"></i> Preview Defaults
                    </button>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">N:</label>
                    <input type="number" class="form-control parameter-input" id="nbackDefaultN" value="2" min="1" max="6" step="1">
                    <div class="parameter-help">N-back depth</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Seed:</label>
                    <input type="text" class="form-control parameter-input" id="nbackDefaultSeed" value="1234">
                    <div class="parameter-help">Optional seed (blank = random)</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Stimulus Mode:</label>
                    <select class="form-control parameter-input" id="nbackDefaultStimulusMode">
                        <option value="letters" selected>Letters</option>
                        <option value="numbers">Numbers</option>
                        <option value="shapes">Shapes</option>
                        <option value="custom">Custom Pool</option>
                    </select>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Custom Stimulus Pool:</label>
                    <textarea class="form-control parameter-input" id="nbackDefaultStimulusPool" rows="2" placeholder="A,B,C,D"></textarea>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Target Probability:</label>
                    <input type="number" class="form-control parameter-input" id="nbackDefaultTargetProb" value="0.25" min="0" max="1" step="0.01">
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Render Mode:</label>
                    <select class="form-control parameter-input" id="nbackDefaultRenderMode">
                        <option value="token" selected>Token</option>
                        <option value="custom_html">Custom HTML Template</option>
                    </select>
                </div>

                <div class="parameter-row" id="nbackDefaultTemplateRow">
                    <label class="parameter-label">Stimulus Template HTML:</label>
                    <textarea class="form-control parameter-input" id="nbackDefaultTemplateHtml" rows="2"><div style="font-size:72px; font-weight:700; letter-spacing:0.02em;">{{TOKEN}}</div></textarea>
                    <div class="parameter-help">Used when render_mode=custom_html. Variable: {{TOKEN}}</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Stimulus (ms):</label>
                    <input type="number" class="form-control parameter-input" id="nbackDefaultStimulusMs" value="500" min="0" max="60000" step="1">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">ISI (ms):</label>
                    <input type="number" class="form-control parameter-input" id="nbackDefaultIsiMs" value="700" min="0" max="60000" step="1">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Trial (ms):</label>
                    <input type="number" class="form-control parameter-input" id="nbackDefaultTrialMs" value="1200" min="0" max="60000" step="1">
                </div>

                <div class="parameter-row" id="nbackDefaultFixationBetweenTrialsRow">
                    <label class="parameter-label">Fixation During ISI:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="nbackDefaultShowFixationCrossBetweenTrials">
                            <label class="form-check-label" for="nbackDefaultShowFixationCrossBetweenTrials">Show fixation cross when the token is hidden</label>
                        </div>
                    </div>
                    <div class="parameter-help">Interpreter renders a "+" marker during the ISI/ITI interval (between items).</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Response Paradigm:</label>
                    <select class="form-control parameter-input" id="nbackDefaultParadigm">
                        <option value="go_nogo" selected>Go/No-Go</option>
                        <option value="2afc">2AFC (match vs non-match)</option>
                    </select>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Response Device:</label>
                    <select class="form-control parameter-input" id="nbackDefaultDevice">
                        <option value="inherit">Inherit</option>
                        <option value="keyboard" selected>Keyboard</option>
                        <option value="mouse">Mouse</option>
                    </select>
                </div>

                <div class="parameter-row" id="nbackDefaultGoKeyRow">
                    <label class="parameter-label">Go Key:</label>
                    <input type="text" class="form-control parameter-input" id="nbackDefaultGoKey" value="space">
                </div>

                <div class="parameter-row" id="nbackDefaultMatchKeyRow">
                    <label class="parameter-label">Match Key:</label>
                    <input type="text" class="form-control parameter-input" id="nbackDefaultMatchKey" value="j">
                </div>

                <div class="parameter-row" id="nbackDefaultNonmatchKeyRow">
                    <label class="parameter-label">Non-match Key:</label>
                    <input type="text" class="form-control parameter-input" id="nbackDefaultNonmatchKey" value="f">
                </div>

                <div class="parameter-row" id="nbackDefaultShowButtonsRow">
                    <label class="parameter-label">Show Buttons:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="nbackDefaultShowButtons" checked>
                            <label class="form-check-label" for="nbackDefaultShowButtons">Show on-screen buttons</label>
                        </div>
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Feedback:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="nbackDefaultFeedback">
                            <label class="form-check-label" for="nbackDefaultFeedback">Show correctness feedback</label>
                        </div>
                    </div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Feedback Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="nbackDefaultFeedbackMs" value="250" min="0" max="5000" step="1">
                </div>
            </div>
            `
            : (taskType === 'sart')
            ? `
            <div class="parameter-group" id="sartExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>SART Experiment Settings</span>
                        <small class="text-muted d-block">Default values for SART components</small>
                    </div>
                    <button class="btn btn-sm btn-info" id="previewTaskDefaultsBtn" onclick="window.componentPreview?.showPreview(window.jsonBuilderInstance?.getCurrentSartDefaults())">
                        <i class="fas fa-eye"></i> Preview Defaults
                    </button>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Go Key:</label>
                    <input type="text" class="form-control parameter-input" id="sartGoKey" value="space">
                    <div class="parameter-help">Default response key for GO trials</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">No-Go Digit:</label>
                    <input type="number" class="form-control parameter-input" id="sartNoGoDigit" value="3" min="0" max="9">
                    <div class="parameter-help">Digit that signals a NO-GO trial</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Stimulus Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="sartStimulusDurationMs" value="250" min="0" max="10000">
                    <div class="parameter-help">Default digit display duration</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Mask Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="sartMaskDurationMs" value="900" min="0" max="10000">
                    <div class="parameter-help">Default mask duration after digit</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">ITI (ms):</label>
                    <input type="number" class="form-control parameter-input" id="sartItiMs" value="0" min="0" max="10000">
                    <div class="parameter-help">Default inter-trial interval</div>
                </div>
            </div>
            `
            : (taskType === 'pvt')
            ? `
            <div class="parameter-group" id="pvtExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>PVT Experiment Settings</span>
                        <small class="text-muted d-block">Default values for PVT components</small>
                    </div>
                    <button class="btn btn-sm btn-info" id="previewTaskDefaultsBtn" onclick="window.componentPreview?.showPreview(window.jsonBuilderInstance?.getCurrentPvtDefaults())">
                        <i class="fas fa-eye"></i> Preview Defaults
                    </button>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Response Device:</label>
                    <select class="form-control parameter-input" id="pvtDefaultResponseDevice">
                        <option value="keyboard" selected>Keyboard</option>
                        <option value="mouse">Mouse</option>
                        <option value="both">Both</option>
                    </select>
                    <div class="parameter-help">Mouse mode registers clicks on the timer screen. Both allows keyboard + click.</div>
                </div>

                <div class="parameter-row" id="pvtKeyboardOnlyNote" style="display:none;">
                    <label class="parameter-label text-muted">Keyboard Mapping:</label>
                    <div class="parameter-help text-muted">Key mapping is ignored when response device is Mouse.</div>
                </div>

                <div id="pvtKeyboardKeysGroup">
                    <div class="parameter-row">
                        <label class="parameter-label">Response Key:</label>
                        <input type="text" class="form-control parameter-input" id="pvtResponseKey" value="space">
                        <div class="parameter-help">Key used to respond when the timer is running</div>
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Foreperiod (ms):</label>
                    <input type="number" class="form-control parameter-input" id="pvtForeperiodMs" value="4000" min="0" max="60000">
                    <div class="parameter-help">Delay before timer starts (blocks can randomize this)</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Trial Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="pvtTrialDurationMs" value="10000" min="0" max="60000">
                    <div class="parameter-help">0 = no timeout (timer can run indefinitely)</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">ITI (ms):</label>
                    <input type="number" class="form-control parameter-input" id="pvtItiMs" value="0" min="0" max="30000">
                    <div class="parameter-help">Post-trial gap after response/timeout</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Feedback Mode:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="pvtFeedbackEnabled">
                            <label class="form-check-label" for="pvtFeedbackEnabled">Show feedback message on false starts (responses before the timer starts)</label>
                        </div>
                    </div>
                </div>

                <div class="parameter-row" id="pvtFeedbackMessageGroup" style="display:none;">
                    <label class="parameter-label">Feedback Message:</label>
                    <textarea class="form-control parameter-input" id="pvtFeedbackMessage" rows="2" placeholder="e.g., Too soon! / Please wait for the timer."></textarea>
                    <div class="parameter-help">Displayed only after false starts (researcher-defined)</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">False Start Handling:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="pvtAddTrialPerFalseStart">
                            <label class="form-check-label" for="pvtAddTrialPerFalseStart">Add one extra trial per false start</label>
                        </div>
                        <div class="parameter-help">When enabled, false starts do not count toward the intended PVT block length (Interpreter extends the block to preserve the target number of valid trials).</div>
                    </div>
                </div>
            </div>
            `
            : (taskType === 'mot')
            ? `
            <div class="parameter-group" id="motExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>MOT Experiment Settings</span>
                        <small class="text-muted d-block">Default values for MOT components</small>
                    </div>
                    <button class="btn btn-sm btn-info" id="previewTaskDefaultsBtn" onclick="window.componentPreview?.showPreview(window.jsonBuilderInstance?.getCurrentMotDefaults())">
                        <i class="fas fa-eye"></i> Preview Defaults
                    </button>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label"># Objects:</label>
                    <input type="number" class="form-control parameter-input" id="motNumObjectsDefault" value="8" min="2" max="20">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label"># Targets:</label>
                    <input type="number" class="form-control parameter-input" id="motNumTargetsDefault" value="4" min="1" max="10">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Speed (px/s):</label>
                    <input type="number" class="form-control parameter-input" id="motSpeedDefault" value="150" min="20" max="600">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Motion Type:</label>
                    <select class="form-control parameter-input" id="motMotionTypeDefault">
                        <option value="linear" selected>Linear</option>
                        <option value="curved">Curved</option>
                    </select>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Probe Mode:</label>
                    <select class="form-control parameter-input" id="motProbeModeDefault">
                        <option value="click" selected>Click</option>
                        <option value="number_entry">Number entry</option>
                    </select>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Cue Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="motCueDurationMsDefault" value="2000" min="0" max="30000">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Tracking Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="motTrackingDurationMsDefault" value="8000" min="0" max="60000">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">ITI (ms):</label>
                    <input type="number" class="form-control parameter-input" id="motItiMsDefault" value="1000" min="0" max="30000">
                </div>
            </div>
            `
            : (taskType === 'gabor')
            ? `
            <div class="parameter-group" id="gaborExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>Gabor Experiment Settings</span>
                        <small class="text-muted d-block">Default values for Gabor components</small>
                    </div>
                    <button class="btn btn-sm btn-info" id="previewTaskDefaultsBtn" onclick="window.componentPreview?.showPreview(window.jsonBuilderInstance?.getCurrentGaborDefaults())">
                        <i class="fas fa-eye"></i> Preview Defaults
                    </button>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Response Task:</label>
                    <select class="form-control parameter-input" id="gaborResponseTask">
                        <option value="detect_target">Detect target (yes/no)</option>
                        <option value="discriminate_tilt" selected>Discriminate target tilt (left/right)</option>
                    </select>
                    <div class="parameter-help">Interpreter decides scoring based on this mode</div>
                </div>

                <div id="gaborDirectionKeysGroup">
                    <div class="parameter-row">
                        <label class="parameter-label">Left Key:</label>
                        <input type="text" class="form-control parameter-input" id="gaborLeftKey" value="f">
                        <div class="parameter-help">Used for left-tilt responses (discriminate_tilt)</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Right Key:</label>
                        <input type="text" class="form-control parameter-input" id="gaborRightKey" value="j">
                        <div class="parameter-help">Used for right-tilt responses (discriminate_tilt)</div>
                    </div>
                </div>

                <div id="gaborDetectionKeysGroup">
                    <div class="parameter-row">
                        <label class="parameter-label">Yes Key:</label>
                        <input type="text" class="form-control parameter-input" id="gaborYesKey" value="f">
                        <div class="parameter-help">Used for target-present responses (detect_target)</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">No Key:</label>
                        <input type="text" class="form-control parameter-input" id="gaborNoKey" value="j">
                        <div class="parameter-help">Used for target-absent responses (detect_target)</div>
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">High Value Color:</label>
                    <input type="color" class="form-control parameter-input" id="gaborHighValueColor" value="#00aa00">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Low Value Color:</label>
                    <input type="color" class="form-control parameter-input" id="gaborLowValueColor" value="#0066ff">
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Patch Border:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="gaborPatchBorderEnabled" checked>
                            <label class="form-check-label" for="gaborPatchBorderEnabled">Draw circular border around each patch</label>
                        </div>
                    </div>
                </div>
                <div id="gaborPatchBorderDetails">
                <div class="parameter-row">
                    <label class="parameter-label">Border Width (px):</label>
                    <input type="number" class="form-control parameter-input" id="gaborPatchBorderWidthPx" value="2" min="0" max="50" step="1">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Border Color:</label>
                    <input type="color" class="form-control parameter-input" id="gaborPatchBorderColor" value="#ffffff">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Border Opacity (0–1):</label>
                    <input type="number" class="form-control parameter-input" id="gaborPatchBorderOpacity" value="0.22" min="0" max="1" step="0.01">
                </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Spatial Frequency (cyc/px):</label>
                    <input type="number" class="form-control parameter-input" id="gaborSpatialFrequency" value="0.06" min="0.001" max="0.5" step="0.001">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Grating Waveform:</label>
                    <select class="form-control parameter-input" id="gaborGratingWaveform">
                        <option value="sinusoidal" selected>Sinusoidal</option>
                        <option value="square">Square</option>
                        <option value="triangle">Triangle</option>
                    </select>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Spatial Cue Validity (0–1):</label>
                    <input type="number" class="form-control parameter-input" id="gaborSpatialCueValidity" value="0.8" min="0" max="1" step="0.01">
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Spatial Cue Enabled:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="gaborSpatialCueEnabled" checked>
                            <label class="form-check-label" for="gaborSpatialCueEnabled">Enable</label>
                        </div>
                    </div>
                    <div class="parameter-help">Gabor: enable sampling spatial cue presence per trial (when false: spatial_cue forced to none)</div>
                </div>
                <div id="gaborSpatialCueDetails">
                    <div class="parameter-row">
                        <label class="parameter-label">Spatial Cue Options:</label>
                        <input type="text" class="form-control parameter-input" id="gaborSpatialCueOptions" value="none,left,right,both">
                        <div class="parameter-help">Gabor: comma-separated spatial cue options to sample from. Allowed: none, left, right, both.</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Spatial Cue Probability:</label>
                        <input type="number" class="form-control parameter-input" id="gaborSpatialCueProbability" value="1" min="0" max="1" step="0.01">
                        <div class="parameter-help">Gabor: probability a trial contains a spatial cue (0–1)</div>
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Value Cue Enabled:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="gaborValueCueEnabled" checked>
                            <label class="form-check-label" for="gaborValueCueEnabled">Enable</label>
                        </div>
                    </div>
                    <div class="parameter-help">Gabor: enable sampling value cue presence per trial (when false: left/right_value forced to neutral)</div>
                </div>
                <div id="gaborValueCueDetails">
                    <div class="parameter-row">
                        <label class="parameter-label">Left Value Options:</label>
                        <input type="text" class="form-control parameter-input" id="gaborLeftValueOptions" value="neutral,high,low">
                        <div class="parameter-help">Gabor: comma-separated left value cue options to sample from. Allowed: neutral, high, low.</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Right Value Options:</label>
                        <input type="text" class="form-control parameter-input" id="gaborRightValueOptions" value="neutral,high,low">
                        <div class="parameter-help">Gabor: comma-separated right value cue options to sample from. Allowed: neutral, high, low.</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Value Cue Probability:</label>
                        <input type="number" class="form-control parameter-input" id="gaborValueCueProbability" value="1" min="0" max="1" step="0.01">
                        <div class="parameter-help">Gabor: probability a trial contains value cues (0–1)</div>
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Fixation (ms):</label>
                    <input type="number" class="form-control parameter-input" id="gaborFixationMs" value="1000" min="0" max="20000">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Placeholders (ms):</label>
                    <input type="number" class="form-control parameter-input" id="gaborPlaceholdersMs" value="400" min="0" max="20000">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Cue (ms):</label>
                    <input type="number" class="form-control parameter-input" id="gaborCueMs" value="300" min="0" max="20000">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Cue→Target Delay Min (ms):</label>
                    <input type="number" class="form-control parameter-input" id="gaborCueDelayMinMs" value="100" min="0" max="20000">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Cue→Target Delay Max (ms):</label>
                    <input type="number" class="form-control parameter-input" id="gaborCueDelayMaxMs" value="200" min="0" max="20000">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Stimulus Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="gaborStimulusDurationMs" value="67" min="0" max="10000">
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Mask Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="gaborMaskDurationMs" value="67" min="0" max="10000">
                </div>
            </div>
            `
            : (taskType === 'continuous-image')
            ? `
            <div class="parameter-group" id="cipExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>Continuous Image Presentation (CIP) Settings</span>
                        <small class="text-muted d-block">Experiment-wide defaults (applies to newly-added Continuous Image blocks/components).</small>
                    </div>
                    <div class="btn-group" role="group">
                        <button class="btn btn-sm btn-info" id="previewCipDefaultsBtn" onclick="window.jsonBuilderInstance?.playCipDefaultsPreview()">
                            <i class="fas fa-eye"></i> Preview
                        </button>
                        <button class="btn btn-sm btn-outline-secondary" id="stopCipDefaultsBtn" onclick="window.jsonBuilderInstance?.stopCipDefaultsPreview()">
                            <i class="fas fa-stop"></i>
                        </button>
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Mask Type:</label>
                    <select class="form-control parameter-input" id="cipDefaultMaskType">
                        <option value="pure_noise">Average + noise (pure noise)</option>
                        <option value="noise_and_shuffle" selected>Average + noise + shuffle (noise and shuffle)</option>
                        <option value="advanced_transform">Phase-scrambled (advanced transform)</option>
                    </select>
                    <div class="parameter-help">Controls how the shared mask is constructed from the averaged image set. Used by the CIP asset generator and stored into newly-created blocks.</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Mask Noise Amp:</label>
                    <input type="number" class="form-control parameter-input" id="cipDefaultMaskNoiseAmp" value="24" min="0" max="128">
                    <div class="parameter-help">0–128. Higher values add more noise to the shared mask.</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Mask Block Size (px):</label>
                    <input type="number" class="form-control parameter-input" id="cipDefaultMaskBlockSize" value="12" min="1" max="128">
                    <div class="parameter-help">Block size used for the shuffle/disintegration effect (only applies to “noise and shuffle”).</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Image Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="cipDefaultImageDurationMs" value="750" min="0" max="60000">
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Transition Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="cipDefaultTransitionDurationMs" value="250" min="0" max="60000">
                    <div class="parameter-help">The preview approximates sprite transitions using ${'${frames}'} discrete steps.</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Transition Frames:</label>
                    <input type="number" class="form-control parameter-input" id="cipDefaultTransitionFrames" value="8" min="2" max="60">
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">2AFC Choice Keys:</label>
                    <input type="text" class="form-control parameter-input" id="cipDefaultChoiceKeys" value="f,j">
                    <div class="parameter-help">Comma-separated (e.g., f,j). Stored as a string; blocks can override.</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Preview:</label>
                    <div class="parameter-input">
                        <div id="cipDefaultsPreview" style="position: relative; width: 240px; height: 140px; border: 1px solid #555; background: #111; overflow: hidden; border-radius: 6px;">
                            <div id="cipPreviewImageLayer" style="position:absolute; inset:0; opacity:0; background-size: 24px 24px; background-image: linear-gradient(45deg, rgba(255,255,255,0.10) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.10) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.10) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.10) 75%); background-position: 0 0, 0 12px, 12px -12px, -12px 0px;">
                                <div style="position:absolute; inset:auto 10px 10px 10px; color:#fff; font-size:12px; opacity:0.85;">IMAGE</div>
                            </div>
                            <div id="cipPreviewMaskLayer" style="position:absolute; inset:0; opacity:1; background-size: 20px 20px; background-image: repeating-linear-gradient(45deg, rgba(255,255,255,0.12), rgba(255,255,255,0.12) 10px, rgba(255,255,255,0.02) 10px, rgba(255,255,255,0.02) 20px);">
                                <canvas id="cipPreviewMaskCanvas" width="240" height="140" style="position:absolute; inset:0; width:100%; height:100%; display:none;"></canvas>
                                <div style="position:absolute; inset:auto 10px 10px 10px; color:#fff; font-size:12px; opacity:0.85;">MASK</div>
                            </div>
                        </div>
                    </div>
                    <div class="parameter-help">Click Preview to play one mask→image→mask cycle using the current timings.</div>
                </div>
            </div>
            `
            : (taskType === 'soc-dashboard')
            ? `
            <div class="parameter-group" id="socDashboardExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>SOC Dashboard Settings</span>
                        <small class="text-muted d-block">Experiment-wide defaults (applies to newly-added SOC session components). Add subtasks via the Component Library.</small>
                    </div>
                    <button class="btn btn-sm btn-info" id="previewTaskDefaultsBtn" onclick="window.componentPreview?.showPreview(window.jsonBuilderInstance?.getCurrentSocDashboardDefaults())">
                        <i class="fas fa-eye"></i> Preview Defaults
                    </button>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Session Title:</label>
                    <input type="text" class="form-control parameter-input" id="socTitle" value="SOC Dashboard">
                    <div class="parameter-help">Shown in the subtask window titlebars</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Wallpaper URL:</label>
                    <input type="text" class="form-control parameter-input" id="socWallpaperUrl" value="" placeholder="https://...">
                    <div class="parameter-help">Optional background image URL (leave blank for default gradient)</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Background Color:</label>
                    <input type="color" class="form-control parameter-input" id="socBackgroundColor" value="#0b1220">
                    <div class="parameter-help">Used when no wallpaper URL is provided</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Desktop Icons Clickable:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="socIconsClickable" checked>
                            <label class="form-check-label" for="socIconsClickable">Show icons as clickable</label>
                        </div>
                    </div>
                    <div class="parameter-help">If disabled, icon clicks can still be logged (visual affordance only)</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Log Icon Clicks:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="socLogIconClicks" checked>
                            <label class="form-check-label" for="socLogIconClicks">Record icon clicks in the trial events log</label>
                        </div>
                    </div>
                    <div class="parameter-help">Useful for multitasking/distractor analysis</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Tag Icon Clicks as Distractors:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="socIconClicksAreDistractors" checked>
                            <label class="form-check-label" for="socIconClicksAreDistractors">Add a distractor flag to icon-click events</label>
                        </div>
                    </div>
                    <div class="parameter-help">When enabled, icon-click events include <code>distractor: true</code></div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Default App:</label>
                    <select class="form-control parameter-input" id="socDefaultApp">
                        <option value="soc" selected>SOC</option>
                        <option value="email">Email</option>
                        <option value="terminal">Terminal</option>
                    </select>
                    <div class="parameter-help">Initial active app when the session starts</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Number of Tasks:</label>
                    <input type="number" class="form-control parameter-input" id="socNumTasks" value="1" min="1" max="4">
                    <div class="parameter-help">Fallback window count used when no subtasks are configured (1–4)</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Session Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="socSessionDurationMs" value="60000" min="0" max="3600000">
                    <div class="parameter-help">0 = no auto-end (participant ends with end key)</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">End Key:</label>
                    <input type="text" class="form-control parameter-input" id="socEndKey" value="escape">
                    <div class="parameter-help">Key that ends the session (e.g., escape)</div>
                </div>
            </div>
            `
            : '';
        
        const html = `
            <div class="parameter-group">
                <div class="group-title">Continuous Configuration</div>
                <div class="parameter-row">
                    <label class="parameter-label">Frame Rate (fps):</label>
                    <input type="number" class="form-control parameter-input" id="frameRate" value="60" min="1" max="120">
                    <div class="parameter-help">Frames per second for continuous updating</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Duration (seconds):</label>
                    <input type="number" class="form-control parameter-input" id="duration" value="30" min="1">
                    <div class="parameter-help">Total duration of continuous experiment</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Update Interval (ms):</label>
                    <input type="number" class="form-control parameter-input" id="updateInterval" value="16" min="1">
                    <div class="parameter-help">Parameter update interval in milliseconds</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Rewards Enabled:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="rewardsEnabled">
                            <label class="form-check-label" for="rewardsEnabled">Enable rewards</label>
                        </div>
                    </div>
                    <div class="parameter-help">When enabled, the Builder adds a Reward Settings component to the timeline so reward policy doesn’t clutter experiment-wide defaults.</div>
                </div>
            </div>

            ${taskType === 'rdm' ? `
            <!-- RDM-specific experiment parameters for continuous -->
            <div class="parameter-group" id="rdmExperimentParameters">
                <div class="group-title d-flex justify-content-between align-items-center">
                    <div>
                        <span>RDM Experiment Settings</span>
                        <small class="text-muted d-block">Default values for all components</small>
                    </div>
                    <button class="btn btn-sm btn-info" id="previewRDMBtn" onclick="window.componentPreview?.showPreview(window.jsonBuilderInstance?.getCurrentRDMParameters())">
                        <i class="fas fa-eye"></i> Preview Defaults
                    </button>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Canvas Width (px):</label>
                    <input type="number" class="form-control parameter-input" id="canvasWidth" value="600" min="400" max="1200">
                    <div class="parameter-help">Width of the stimulus display area</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Canvas Height (px):</label>
                    <input type="number" class="form-control parameter-input" id="canvasHeight" value="600" min="300" max="900">
                    <div class="parameter-help">Height of the stimulus display area</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Aperture Shape:</label>
                    <select class="form-control parameter-input" id="apertureShape">
                        <option value="circle">Circle</option>
                        <option value="rectangle">Rectangle</option>
                    </select>
                    <div class="parameter-help">Shape of the stimulus aperture area</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Aperture Diameter (px):</label>
                    <input type="number" class="form-control parameter-input" id="apertureDiameter" value="350" min="50" max="800">
                    <div class="parameter-help">Diameter (circle) or width (rectangle) of aperture</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Aperture Outline:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input parameter-input" type="checkbox" id="apertureOutlineEnabled">
                            <label class="form-check-label" for="apertureOutlineEnabled">Show outline</label>
                        </div>
                    </div>
                    <div class="parameter-help">Experiment default: draw an outline around the aperture</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Outline Width (px):</label>
                    <input type="number" class="form-control parameter-input" id="apertureOutlineWidth" value="2" min="0" max="50" step="0.5">
                    <div class="parameter-help">Experiment default outline width (used when outline is enabled)</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Outline Color:</label>
                    <input type="color" class="form-control parameter-input" id="apertureOutlineColor" value="#FFFFFF">
                    <div class="parameter-help">Experiment default outline color (used when outline is enabled)</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Background Color:</label>
                    <input type="color" class="form-control parameter-input" id="backgroundColor" value="#404040">
                    <div class="parameter-help">Background color for stimulus display</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Dot Size (px):</label>
                    <input type="number" class="form-control parameter-input" id="dotSize" value="4" min="1" max="10">
                    <div class="parameter-help">Size of individual dots in pixels</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Dot Color:</label>
                    <input type="color" class="form-control parameter-input" id="dotColor" value="#ffffff">
                    <div class="parameter-help">Color of the moving dots</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Total Dots:</label>
                    <input type="number" class="form-control parameter-input" id="totalDots" value="150" min="10" max="500">
                    <div class="parameter-help">Total number of dots to display</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Motion Coherence:</label>
                    <input type="range" class="form-range" id="motionCoherence" min="0" max="1" step="0.01" value="0.5">
                    <div class="parameter-help">Proportion of dots moving coherently (0-1): <span id="coherenceValue">0.50</span></div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Direction (degrees):</label>
                    <input type="number" class="form-control parameter-input" id="motionDirection" value="0" min="0" max="359">
                    <div class="parameter-help">Direction of coherent motion in degrees (0 = right, 90 = down)</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Speed (px/frame):</label>
                    <input type="number" class="form-control parameter-input" id="motionSpeed" value="5" min="1" max="20">
                    <div class="parameter-help">Speed of dot movement in pixels per frame</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Dot Lifetime (frames):</label>
                    <input type="number" class="form-control parameter-input" id="dotLifetime" value="60" min="10" max="200">
                    <div class="parameter-help">How long each dot lives before being replaced (frames)</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Noise Type:</label>
                    <select class="form-control parameter-input" id="noiseType">
                        <option value="random_direction">Random Direction</option>
                        <option value="random_walk">Random Walk</option>
                        <option value="brownian">Brownian</option>
                    </select>
                    <div class="parameter-help">Noise motion model for incoherent dots</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Transition Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="defaultTransitionDuration" value="500" min="0" max="20000">
                    <div class="parameter-help">Continuous mode only. Default transition duration between timeline components (0 = no transition)</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Transition Type:</label>
                    <select class="form-control parameter-input" id="defaultTransitionType">
                        <option value="both" selected>Both (color + speed)</option>
                        <option value="color">Color</option>
                        <option value="speed">Speed</option>
                    </select>
                    <div class="parameter-help">Continuous mode only. Color = smooth color gradient; Speed = slow down/speed up; Both = combine</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Default Response:</label>
                    <select class="form-control parameter-input" id="defaultResponseDevice">
                        <option value="keyboard" selected>Keyboard</option>
                        <option value="mouse">Mouse</option>
                        <option value="touch">Touch</option>
                        <option value="voice">Voice</option>
                        <option value="custom">Custom</option>
                    </select>
                    <div class="parameter-help">Default response device for RDM trials. Individual components can still override/add response types.</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Response Keys:</label>
                    <input type="text" class="form-control parameter-input" id="responseKeys" value="ArrowLeft,ArrowRight">
                    <div class="parameter-help">Comma-separated list of valid response keys</div>
                </div>
                <div class="parameter-row">
                    <label class="parameter-label">Require Response:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="requireResponse" checked>
                            <label class="form-check-label" for="requireResponse">Require a response to proceed</label>
                        </div>
                    </div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Response Ends Condition:</label>
                    <div class="parameter-input">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="endConditionOnResponse">
                            <label class="form-check-label" for="endConditionOnResponse">End current condition on response</label>
                        </div>
                    </div>
                    <div class="parameter-help">Continuous mode: response immediately ends the condition and triggers the transition to the next one.</div>
                </div>

                <div class="parameter-row">
                    <label class="parameter-label">Default Feedback:</label>
                    <select class="form-control parameter-input" id="defaultFeedbackType">
                        <option value="off" selected>Off</option>
                        <option value="corner-text">Corner Text</option>
                        <option value="arrow">Arrow</option>
                        <option value="custom">Custom (placeholder)</option>
                    </select>
                    <div class="parameter-help">Optional feedback shown after response (applies by default; components can override).</div>
                </div>
                <div class="parameter-row" id="feedbackDurationRow" style="display:none;">
                    <label class="parameter-label">Feedback Duration (ms):</label>
                    <input type="number" class="form-control parameter-input" id="defaultFeedbackDuration" value="500" min="0" max="20000" disabled>
                    <div class="parameter-help">How long feedback is displayed after the response</div>
                </div>
                <div id="mouseResponseSettings" style="display: none;">
                    <div class="parameter-row">
                        <label class="parameter-label">Mouse Response:</label>
                        <div class="parameter-help">Shown only when Default Response is set to Mouse.</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Aperture Segments:</label>
                        <input type="number" class="form-control parameter-input" id="mouseApertureSegments" value="2" min="2" max="12">
                        <div class="parameter-help">Number of clickable segments around the aperture</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Start Angle (deg):</label>
                        <input type="number" class="form-control parameter-input" id="mouseSegmentStartAngle" value="0" min="0" max="359">
                        <div class="parameter-help">Angle offset for segment 0 (0 = right)</div>
                    </div>
                    <div class="parameter-row">
                        <label class="parameter-label">Selection Mode:</label>
                        <select class="form-control parameter-input" id="mouseSelectionMode">
                            <option value="click" selected>Click</option>
                            <option value="hover">Hover (no click)</option>
                        </select>
                        <div class="parameter-help">How a segment selection is registered</div>
                    </div>
                </div>
            </div>
            ` : ''}

            ${taskSpecificDefaultsHtml}
        `;
        
        container.innerHTML = html;
        
        // Add event listeners for parameter changes
        container.querySelectorAll('input, select, textarea').forEach(el => {
            el.addEventListener('change', this.updateJSON);
        });

        // Reduce default scrolling: collapse long experiment-default sections.
        this.wrapParameterFormsInCollapsibles();

        const defaultResponseEl = document.getElementById('defaultResponseDevice');
        if (defaultResponseEl) {
            defaultResponseEl.addEventListener('change', () => this.updateConditionalUI());
        }

        const feedbackTypeEl = document.getElementById('defaultFeedbackType');
        if (feedbackTypeEl) {
            feedbackTypeEl.addEventListener('change', () => this.updateConditionalUI());
        }

        // Task-specific conditional UI (Gabor response keys)
        this.bindGaborSettingsUI();

        // Task-specific conditional UI (Stroop stimulus set + response mappings)
        this.bindStroopSettingsUI();

        // Task-specific conditional UI (PVT response device + key + feedback)
        this.bindPvtSettingsUI();

        // Task-specific conditional UI (N-back defaults)
        this.bindNbackSettingsUI();

        // Rewards toggle (experiment-wide)
        this.bindRewardsToggleUI();
        
        // Add specific listener for coherence slider
        const coherenceSlider = document.getElementById('motionCoherence');
        const coherenceValue = document.getElementById('coherenceValue');
        if (coherenceSlider && coherenceValue) {
            coherenceSlider.addEventListener('input', function() {
                coherenceValue.textContent = parseFloat(this.value).toFixed(2);
            });
        }
    }

    /**
     * Load and display component library
     */
    loadComponentLibrary() {
        const library = document.getElementById('componentLibrary');
        
        const components = this.getComponentDefinitions();
        
        library.innerHTML = '';
        
        components.forEach(component => {
            const componentCard = this.createComponentCard(component);
            library.appendChild(componentCard);
        });
    }

    /**
     * Get component definitions based on experiment type and data collection
     */
    getComponentDefinitions(opts = {}) {
        const taskType = (opts && typeof opts === 'object' && typeof opts.taskTypeOverride === 'string' && opts.taskTypeOverride.trim() !== '')
            ? opts.taskTypeOverride.trim()
            : (document.getElementById('taskType')?.value || 'rdm');
        const unitName = (this.experimentType === 'continuous') ? 'Frame' : 'Trial';

        const createComponentDefFromSchema = (schemaId, { name, icon, description, category } = {}) => {
            const schema = this.schemaValidator?.pluginSchemas?.[schemaId];
            const params = {};

            const mapType = (t) => {
                const s = (t ?? '').toString();
                if (s === 'BOOL') return 'boolean';
                if (s === 'SELECT') return 'select';
                if (s === 'INT' || s === 'FLOAT') return 'number';
                if (s === 'COLOR') return 'COLOR';
                // HTML_STRING / STRING / IMAGE => edit as string in Builder (IMAGE gets special handling)
                if (s === 'HTML_STRING' || s === 'STRING' || s === 'IMAGE') return 'string';
                return 'string';
            };

            if (schema && schema.parameters && typeof schema.parameters === 'object') {
                for (const [key, def] of Object.entries(schema.parameters)) {
                    if (!def || typeof def !== 'object') continue;
                    const out = { type: mapType(def.type), default: def.default };
                    if (Array.isArray(def.options)) out.options = def.options;
                    if (def.min !== undefined) out.min = def.min;
                    if (def.max !== undefined) out.max = def.max;
                    if (def.step !== undefined) out.step = def.step;
                    params[key] = out;
                }
            }

            return {
                id: schemaId,
                name: name || schema?.name || schemaId,
                icon: icon || 'fas fa-puzzle-piece',
                description: description || schema?.description || '',
                category: category || 'task',
                type: schemaId,
                parameters: params
            };
        };

        const createBlockComponentDef = (currentTaskType) => {
            const blockDisplayName = (currentTaskType === 'rdm')
                ? 'RDM Block'
                : (currentTaskType === 'nback')
                    ? 'N-back Block'
                : (currentTaskType === 'flanker')
                    ? 'Flanker Block'
                    : (currentTaskType === 'sart')
                        ? 'SART Block'
                        : (currentTaskType === 'simon')
                            ? 'Simon Block'
                        : (currentTaskType === 'task-switching')
                            ? 'Task Switching Block'
                        : (currentTaskType === 'pvt')
                            ? 'PVT Block'
                        : (currentTaskType === 'mot')
                            ? 'MOT Block'
                        : (currentTaskType === 'gabor')
                            ? 'Gabor Block'
                            : (currentTaskType === 'continuous-image')
                                ? 'Continuous Image Block'
                            : (currentTaskType === 'stroop')
                                ? 'Stroop Block'
                                : (currentTaskType === 'emotional-stroop')
                                    ? 'Emotional Stroop Block'
                                : 'Block';

            const baseOptions = (currentTaskType === 'flanker')
                ? ['flanker-trial']
                : (currentTaskType === 'nback')
                    ? ['nback-block']
                : (currentTaskType === 'sart')
                    ? ['sart-trial']
                    : (currentTaskType === 'simon')
                        ? ['simon-trial']
                    : (currentTaskType === 'task-switching')
                        ? ['task-switching-trial']
                    : (currentTaskType === 'pvt')
                        ? ['pvt-trial']
                    : (currentTaskType === 'mot')
                        ? ['mot-trial']
                    : (currentTaskType === 'gabor')
                        ? ['gabor-trial', 'gabor-quest', 'gabor-learning']
                        : (currentTaskType === 'continuous-image')
                            ? ['continuous-image-presentation']
                        : (currentTaskType === 'stroop')
                            ? ['stroop-trial']
                            : (currentTaskType === 'emotional-stroop')
                                ? ['emotional-stroop-trial']
                        : ['rdm-trial', 'rdm-practice', 'rdm-adaptive', 'rdm-dot-groups'];

            // Always allow generic jsPsych trial types inside Blocks (across all tasks).
            const genericOptions = ['html-button-response', 'html-keyboard-response', 'image-keyboard-response'];
            const options = Array.from(new Set([...(baseOptions || []), ...genericOptions]));

            const defaultType = (baseOptions && baseOptions[0]) ? baseOptions[0] : (options[0] || 'rdm-trial');

            const defaultBlockLength = this.getExperimentWideBlockLengthDefault();

            const commonParams = {
                block_component_type: { type: 'select', default: defaultType, options },
                block_length: { type: 'number', default: defaultBlockLength, min: 1, max: 50000 },
                sampling_mode: { type: 'select', default: 'per-trial', options: ['per-trial', 'per-block'] },
                seed: { type: 'string', default: '' }
            };

            const flankerStimulusTypeDefault = (() => {
                const el = document.getElementById('flankerStimulusType');
                const v = (el && typeof el.value === 'string') ? el.value : null;
                const s = (v ?? 'arrows').toString().trim();
                return s || 'arrows';
            })();

            const flankerOnlyParams = {
                flanker_stimulus_type: { type: 'select', default: flankerStimulusTypeDefault, options: ['arrows', 'letters', 'symbols', 'custom'] },
                flanker_target_stimulus_options: { type: 'string', default: 'H' },
                flanker_distractor_stimulus_options: { type: 'string', default: 'S' },
                flanker_neutral_stimulus_options: { type: 'string', default: '–' },
                flanker_left_key: { type: 'string', default: 'f' },
                flanker_right_key: { type: 'string', default: 'j' },
                flanker_show_fixation_dot: { type: 'boolean', default: false },
                flanker_show_fixation_cross_between_trials: { type: 'boolean', default: false },
                flanker_congruency_options: { type: 'string', default: 'congruent,incongruent' },
                flanker_target_direction_options: { type: 'string', default: 'left,right' },
                flanker_stimulus_duration_min: { type: 'number', default: 200, min: 0, max: 10000 },
                flanker_stimulus_duration_max: { type: 'number', default: 800, min: 0, max: 10000 },
                flanker_trial_duration_min: { type: 'number', default: 1000, min: 0, max: 60000 },
                flanker_trial_duration_max: { type: 'number', default: 2000, min: 0, max: 60000 },
                flanker_iti_min: { type: 'number', default: 200, min: 0, max: 10000 },
                flanker_iti_max: { type: 'number', default: 800, min: 0, max: 10000 }
            };

            const sartOnlyParams = {
                sart_digit_options: { type: 'string', default: '1,2,3,4,5,6,7,8,9' },
                sart_nogo_digit: { type: 'number', default: 3, min: 0, max: 9 },
                sart_go_key: { type: 'string', default: 'space' },
                sart_stimulus_duration_min: { type: 'number', default: 150, min: 0, max: 10000 },
                sart_stimulus_duration_max: { type: 'number', default: 400, min: 0, max: 10000 },
                sart_mask_duration_min: { type: 'number', default: 600, min: 0, max: 10000 },
                sart_mask_duration_max: { type: 'number', default: 1200, min: 0, max: 10000 },
                sart_trial_duration_min: { type: 'number', default: 800, min: 0, max: 60000 },
                sart_trial_duration_max: { type: 'number', default: 2000, min: 0, max: 60000 },
                sart_iti_min: { type: 'number', default: 200, min: 0, max: 10000 },
                sart_iti_max: { type: 'number', default: 800, min: 0, max: 10000 }
            };

            const gaborOnlyParams = {
                // Gabor task-wide settings (copyable to blocks so multiple blocks can co-exist)
                gabor_response_task: { type: 'select', default: 'discriminate_tilt', options: ['detect_target', 'discriminate_tilt'] },
                gabor_left_key: { type: 'string', default: 'f' },
                gabor_right_key: { type: 'string', default: 'j' },
                gabor_yes_key: { type: 'string', default: 'f' },
                gabor_no_key: { type: 'string', default: 'j' },

                gabor_target_location_options: { type: 'string', default: 'left,right' },
                gabor_target_tilt_options: { type: 'string', default: '-45,45' },
                gabor_distractor_orientation_options: { type: 'string', default: '0,90' },
                gabor_spatial_cue_enabled: { type: 'boolean', default: true },
                gabor_spatial_cue_options: { type: 'string', default: 'none,left,right,both' },
                gabor_spatial_cue_probability: { type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
                gabor_spatial_cue_validity_probability: { type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
                gabor_value_cue_enabled: { type: 'boolean', default: true },
                gabor_left_value_options: { type: 'string', default: 'neutral,high,low' },
                gabor_right_value_options: { type: 'string', default: 'neutral,high,low' },
                gabor_value_cue_probability: { type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
                gabor_value_target_value: { type: 'select', default: 'any', options: ['any', 'high', 'low', 'neutral'] },
                gabor_reward_availability_high: { type: 'number', default: 0.8, min: 0, max: 1, step: 0.01 },
                gabor_reward_availability_low: { type: 'number', default: 0.8, min: 0, max: 1, step: 0.01 },
                gabor_reward_availability_neutral: { type: 'number', default: 0, min: 0, max: 1, step: 0.01 },

                gabor_spatial_frequency_min: { type: 'number', default: 0.06, min: 0.001, max: 0.5, step: 0.001 },
                gabor_spatial_frequency_max: { type: 'number', default: 0.06, min: 0.001, max: 0.5, step: 0.001 },
                gabor_grating_waveform_options: { type: 'string', default: 'sinusoidal' },

                gabor_patch_diameter_deg_min: { type: 'number', default: 6, min: 0.1, max: 60, step: 0.1 },
                gabor_patch_diameter_deg_max: { type: 'number', default: 6, min: 0.1, max: 60, step: 0.1 },

                gabor_patch_border_enabled: { type: 'boolean', default: true },
                gabor_patch_border_width_px: { type: 'number', default: 2, min: 0, max: 50, step: 1 },
                gabor_patch_border_color: { type: 'COLOR', default: '#ffffff' },
                gabor_patch_border_opacity: { type: 'number', default: 0.22, min: 0, max: 1, step: 0.01 },

                // Optional adaptive staircase per-block (stored in exported block.parameter_values.adaptive)
                gabor_adaptive_mode: { type: 'select', default: 'none', options: ['none', 'quest'] },
                gabor_quest_parameter: { type: 'select', default: 'target_tilt_deg', options: ['target_tilt_deg', 'spatial_frequency_cyc_per_px', 'contrast'] },
                gabor_quest_target_performance: { type: 'number', default: 0.82, min: 0.5, max: 0.99, step: 0.01 },
                gabor_quest_start_value: { type: 'number', default: 45, step: 0.1 },
                gabor_quest_start_sd: { type: 'number', default: 20, min: 0.001, step: 0.1 },
                gabor_quest_beta: { type: 'number', default: 3.5, min: 0.001, step: 0.1 },
                gabor_quest_delta: { type: 'number', default: 0.01, min: 0, step: 0.001 },
                gabor_quest_gamma: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
                gabor_quest_min_value: { type: 'number', default: -90, step: 0.1 },
                gabor_quest_max_value: { type: 'number', default: 90, step: 0.1 },
                gabor_quest_trials_coarse: { type: 'number', default: 32, min: 0, max: 10000, step: 1 },
                gabor_quest_trials_fine: { type: 'number', default: 32, min: 0, max: 10000, step: 1 },
                gabor_quest_staircase_per_location: { type: 'boolean', default: false },
                gabor_quest_store_location_threshold: { type: 'boolean', default: false },

                gabor_contrast_min: { type: 'number', default: 0.05, min: 0, max: 1, step: 0.01 },
                gabor_contrast_max: { type: 'number', default: 0.95, min: 0, max: 1, step: 0.01 },

                gabor_learning_streak_length: { type: 'number', default: 20, min: 1, max: 10000, step: 1 },
                gabor_learning_target_accuracy: { type: 'number', default: 0.9, min: 0, max: 1, step: 0.01 },
                gabor_learning_max_trials: { type: 'number', default: 200, min: 1, max: 100000, step: 1 },
                gabor_show_feedback: { type: 'boolean', default: true },
                gabor_feedback_duration_ms: { type: 'number', default: 800, min: 0, max: 30000, step: 1 },

                gabor_stimulus_duration_min: { type: 'number', default: 67, min: 0, max: 10000 },
                gabor_stimulus_duration_max: { type: 'number', default: 67, min: 0, max: 10000 },
                gabor_mask_duration_min: { type: 'number', default: 67, min: 0, max: 10000 },
                gabor_mask_duration_max: { type: 'number', default: 67, min: 0, max: 10000 }
            };

            const stroopOnlyParams = {
                // Library sampling
                stroop_word_options: { type: 'string', default: 'RED,GREEN,BLUE,YELLOW' },
                stroop_ink_color_options: { type: 'string', default: 'RED,GREEN,BLUE,YELLOW' },
                stroop_congruency_options: { type: 'string', default: 'auto,congruent,incongruent' },

                // Response overrides
                stroop_response_mode: { type: 'select', default: 'inherit', options: ['inherit', 'color_naming', 'congruency'] },
                stroop_response_device: { type: 'select', default: 'inherit', options: ['inherit', 'keyboard', 'mouse'] },
                stroop_choice_keys: { type: 'string', default: '' },
                stroop_congruent_key: { type: 'string', default: '' },
                stroop_incongruent_key: { type: 'string', default: '' },

                // Timing windows
                stroop_stimulus_duration_min: { type: 'number', default: 0, min: 0, max: 10000 },
                stroop_stimulus_duration_max: { type: 'number', default: 0, min: 0, max: 10000 },
                stroop_trial_duration_min: { type: 'number', default: 2000, min: 0, max: 60000 },
                stroop_trial_duration_max: { type: 'number', default: 2000, min: 0, max: 60000 },
                stroop_iti_min: { type: 'number', default: 500, min: 0, max: 10000 },
                stroop_iti_max: { type: 'number', default: 500, min: 0, max: 10000 }
            };

            const emotionalStroopOnlyParams = {
                // Sampling: labeled word lists (2–3)
                emostroop_word_list_count: { type: 'select', default: '2', options: ['2', '3'] },

                emostroop_word_list_1_label: { type: 'string', default: 'Neutral' },
                emostroop_word_list_1_words: { type: 'string', default: 'CHAIR,TABLE,WINDOW' },

                emostroop_word_list_2_label: { type: 'string', default: 'Negative' },
                emostroop_word_list_2_words: { type: 'string', default: 'SAD,ANGRY,FEAR' },

                emostroop_word_list_3_label: { type: 'string', default: 'Positive' },
                emostroop_word_list_3_words: { type: 'string', default: 'HAPPY,JOY,LOVE' },

                // Back-compat: flattened word pool (ignored at runtime if word_lists present)
                emostroop_word_options: { type: 'string', default: '' },

                // Ink palette sampling
                emostroop_ink_color_options: { type: 'string', default: 'RED,GREEN,BLUE,YELLOW' },

                // Response overrides
                emostroop_response_device: { type: 'select', default: 'inherit', options: ['inherit', 'keyboard', 'mouse'] },
                emostroop_choice_keys: { type: 'string', default: '' },

                // Timing windows
                emostroop_stimulus_duration_min: { type: 'number', default: 0, min: 0, max: 10000 },
                emostroop_stimulus_duration_max: { type: 'number', default: 0, min: 0, max: 10000 },
                emostroop_trial_duration_min: { type: 'number', default: 2000, min: 0, max: 60000 },
                emostroop_trial_duration_max: { type: 'number', default: 2000, min: 0, max: 60000 },
                emostroop_iti_min: { type: 'number', default: 500, min: 0, max: 10000 },
                emostroop_iti_max: { type: 'number', default: 500, min: 0, max: 10000 }
            };

            const simonOnlyParams = {
                // Sampling
                simon_color_options: { type: 'string', default: 'BLUE,ORANGE' },
                simon_side_options: { type: 'string', default: 'left,right' },

                // Response overrides
                simon_response_device: { type: 'select', default: 'inherit', options: ['inherit', 'keyboard', 'mouse'] },
                simon_left_key: { type: 'string', default: '' },
                simon_right_key: { type: 'string', default: '' },

                // Timing windows
                simon_stimulus_duration_min: { type: 'number', default: 0, min: 0, max: 10000 },
                simon_stimulus_duration_max: { type: 'number', default: 0, min: 0, max: 10000 },
                simon_trial_duration_min: { type: 'number', default: 1500, min: 0, max: 60000 },
                simon_trial_duration_max: { type: 'number', default: 1500, min: 0, max: 60000 },
                simon_iti_min: { type: 'number', default: 500, min: 0, max: 10000 },
                simon_iti_max: { type: 'number', default: 500, min: 0, max: 10000 }
            };

            const taskSwitchingOnlyParams = {
                // Core block mode
                ts_trial_type: {
                    type: 'select',
                    default: 'switch',
                    options: ['switch', 'single'],
                    description: 'Switching alternates tasks; single fixes one task for the whole block.'
                },
                ts_single_task_index: {
                    type: 'select',
                    default: 1,
                    options: [1, 2],
                    description: 'Used only when Trial type = single.'
                },

                // Cueing
                ts_cue_type: {
                    type: 'select',
                    default: 'explicit',
                    options: ['position', 'color', 'explicit']
                },

                // Position cue params
                ts_task_1_position: { type: 'select', default: 'left', options: ['left', 'right', 'top', 'bottom'] },
                ts_task_2_position: { type: 'select', default: 'right', options: ['left', 'right', 'top', 'bottom'] },

                // Color cue params
                ts_task_1_color_hex: { type: 'COLOR', default: '#FFFFFF' },
                ts_task_2_color_hex: { type: 'COLOR', default: '#FFFFFF' },

                // Explicit cue params
                ts_task_1_cue_text: { type: 'string', default: 'LETTERS' },
                ts_task_2_cue_text: { type: 'string', default: 'NUMBERS' },
                ts_cue_font_size_px: { type: 'number', default: 28, min: 8, max: 96 },
                ts_cue_duration_ms: { type: 'number', default: 0, min: 0, max: 5000 },
                ts_cue_gap_ms: { type: 'number', default: 0, min: 0, max: 5000 },
                ts_cue_color_hex: { type: 'COLOR', default: '#FFFFFF' },

                // Stimulus appearance / response
                ts_stimulus_position: { type: 'select', default: 'top', options: ['left', 'right', 'top', 'bottom'] },
                ts_stimulus_color_hex: { type: 'COLOR', default: '#FFFFFF' },
                ts_border_enabled: { type: 'boolean', default: false },
                ts_left_key: { type: 'string', default: '' },
                ts_right_key: { type: 'string', default: '' },

                // Timing windows
                ts_stimulus_duration_min: { type: 'number', default: 0, min: 0, max: 10000 },
                ts_stimulus_duration_max: { type: 'number', default: 0, min: 0, max: 10000 },
                ts_trial_duration_min: { type: 'number', default: 2000, min: 0, max: 60000 },
                ts_trial_duration_max: { type: 'number', default: 2000, min: 0, max: 60000 },
                ts_iti_min: { type: 'number', default: 500, min: 0, max: 10000 },
                ts_iti_max: { type: 'number', default: 500, min: 0, max: 10000 }
            };

            const pvtOnlyParams = {
                // Response overrides
                pvt_response_device: { type: 'select', default: 'inherit', options: ['inherit', 'keyboard', 'mouse', 'both'] },
                pvt_response_key: { type: 'string', default: '' },

                // Timing windows
                pvt_foreperiod_min: { type: 'number', default: 2000, min: 0, max: 60000 },
                pvt_foreperiod_max: { type: 'number', default: 10000, min: 0, max: 60000 },
                pvt_trial_duration_min: { type: 'number', default: 10000, min: 0, max: 60000 },
                pvt_trial_duration_max: { type: 'number', default: 10000, min: 0, max: 60000 },
                pvt_iti_min: { type: 'number', default: 0, min: 0, max: 30000 },
                pvt_iti_max: { type: 'number', default: 0, min: 0, max: 30000 }
            };

            const motOnlyParams = {
                mot_num_objects_options: { type: 'string', default: (document.getElementById('motNumObjectsDefault')?.value || '8').toString() },
                mot_num_targets_options: { type: 'string', default: (document.getElementById('motNumTargetsDefault')?.value || '4').toString() },
                mot_motion_type: { type: 'select', default: (document.getElementById('motMotionTypeDefault')?.value || 'linear').toString(), options: ['linear', 'curved'] },
                mot_probe_mode: { type: 'select', default: (document.getElementById('motProbeModeDefault')?.value || 'click').toString(), options: ['click', 'number_entry'] },
                mot_show_feedback: { type: 'boolean', default: !!document.getElementById('motShowFeedbackDefault')?.checked },
                mot_speed_px_per_s_min: { type: 'number', default: Number.parseFloat(document.getElementById('motSpeedDefault')?.value || '150'), min: 20, max: 600 },
                mot_speed_px_per_s_max: { type: 'number', default: Number.parseFloat(document.getElementById('motSpeedDefault')?.value || '150'), min: 20, max: 600 },
                mot_tracking_duration_ms_min: { type: 'number', default: Number.parseInt(document.getElementById('motTrackingDurationMsDefault')?.value || '8000', 10), min: 0, max: 60000 },
                mot_tracking_duration_ms_max: { type: 'number', default: Number.parseInt(document.getElementById('motTrackingDurationMsDefault')?.value || '8000', 10), min: 0, max: 60000 },
                mot_cue_duration_ms_min: { type: 'number', default: Number.parseInt(document.getElementById('motCueDurationMsDefault')?.value || '2000', 10), min: 0, max: 30000 },
                mot_cue_duration_ms_max: { type: 'number', default: Number.parseInt(document.getElementById('motCueDurationMsDefault')?.value || '2000', 10), min: 0, max: 30000 },
                mot_iti_ms_min: { type: 'number', default: Number.parseInt(document.getElementById('motItiMsDefault')?.value || '1000', 10), min: 0, max: 30000 },
                mot_iti_ms_max: { type: 'number', default: Number.parseInt(document.getElementById('motItiMsDefault')?.value || '1000', 10), min: 0, max: 30000 }
            };

            const continuousImageOnlyParams = {
                cip_asset_code: { type: 'string', default: '' },
                // Mask is derived from the pixel-wise average of the image set, then modified by the selected transform.
                // Note: sprite sheets are generated per-mask-type; switching types can re-use existing assets if present.
                cip_mask_type: { type: 'select', default: 'noise_and_shuffle', options: ['pure_noise', 'noise_and_shuffle', 'advanced_transform'] },
                cip_mask_noise_amp: { type: 'number', default: 24, min: 0, max: 128 },
                cip_mask_block_size: { type: 'number', default: 12, min: 1, max: 128 },
                cip_repeat_mode: { type: 'select', default: 'no_repeats', options: ['no_repeats', 'repeat_to_fill'] },
                cip_images_per_block: { type: 'number', default: 0, min: 0, max: 50000 },

                cip_image_duration_ms: { type: 'number', default: 750, min: 0, max: 60000 },
                cip_transition_duration_ms: { type: 'number', default: 250, min: 0, max: 60000 },
                cip_choice_keys: { type: 'string', default: 'f,j' },

                // Filenames are shown/edited by researchers; URL lists are filled by the modal helper.
                cip_asset_filenames: { type: 'textarea', default: '', rows: 8 },

                // Hidden (but persisted) lists used by the interpreter.
                cip_image_urls: { type: 'textarea', default: '', rows: 6 },
                cip_mask_to_image_sprite_urls: { type: 'textarea', default: '', rows: 6 },
                cip_image_to_mask_sprite_urls: { type: 'textarea', default: '', rows: 6 },

                // Internal: keep Builder+Interpreter in sync for sprite animations.
                cip_transition_frames: { type: 'number', default: 8, min: 2, max: 60 }
            };

            // RDM-only params remain in RDM mode; other tasks should not inherit the RDM UI surface.
            const rdmOnlyParams = {
                // Dot color (used for simple trial/practice/adaptive; dot-groups uses per-group colors)
                dot_color: { type: 'COLOR', default: '#FFFFFF' },

                // Continuous mode transitions (applied when experiment_type = continuous)
                transition_duration: { type: 'number', default: 500, min: 0, max: 20000 },
                transition_type: { type: 'select', default: 'both', options: ['both', 'color', 'speed'] },

                // Per-block response overrides
                response_device: { type: 'select', default: 'inherit', options: ['inherit', 'keyboard', 'mouse', 'touch', 'voice', 'custom'] },
                response_keys: { type: 'string', default: '' },
                require_response_mode: { type: 'select', default: 'inherit', options: ['inherit', 'true', 'false'] },
                mouse_segments: { type: 'number', default: 2, min: 1, max: 12 },
                mouse_start_angle_deg: { type: 'number', default: 0, min: 0, max: 359 },
                mouse_selection_mode: { type: 'select', default: 'click', options: ['click', 'hover'] },

                // rdm-trial windows
                coherence_min: { type: 'number', default: 0.2, min: 0, max: 1, step: 0.01 },
                coherence_max: { type: 'number', default: 0.8, min: 0, max: 1, step: 0.01 },
                direction_options: { type: 'string', default: '0,180' },
                speed_min: { type: 'number', default: 4, min: 0, max: 50 },
                speed_max: { type: 'number', default: 10, min: 0, max: 50 },

                // rdm-practice windows
                practice_coherence_min: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
                practice_coherence_max: { type: 'number', default: 0.9, min: 0, max: 1, step: 0.01 },
                practice_direction_options: { type: 'string', default: '0,180' },
                practice_feedback_duration_min: { type: 'number', default: 750, min: 0, max: 5000 },
                practice_feedback_duration_max: { type: 'number', default: 1500, min: 0, max: 5000 },

                // rdm-adaptive windows
                adaptive_initial_coherence_min: { type: 'number', default: 0.05, min: 0, max: 1, step: 0.01 },
                adaptive_initial_coherence_max: { type: 'number', default: 0.2, min: 0, max: 1, step: 0.01 },
                adaptive_algorithm: { type: 'select', default: 'quest', options: ['quest', 'staircase', 'simple'] },
                adaptive_step_size_min: { type: 'number', default: 0.02, min: 0.001, max: 0.5, step: 0.001 },
                adaptive_step_size_max: { type: 'number', default: 0.08, min: 0.001, max: 0.5, step: 0.001 },
                adaptive_target_performance: { type: 'number', default: 0.82, min: 0.5, max: 1, step: 0.01 },

                // rdm-dot-groups windows
                group_1_percentage_min: { type: 'number', default: 40, min: 0, max: 100 },
                group_1_percentage_max: { type: 'number', default: 60, min: 0, max: 100 },
                group_1_color: { type: 'COLOR', default: '#FF0066' },
                group_1_coherence_min: { type: 'number', default: 0.1, min: 0, max: 1, step: 0.01 },
                group_1_coherence_max: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
                group_1_direction_options: { type: 'string', default: '0,180' },
                group_1_speed_min: { type: 'number', default: 4, min: 0, max: 50 },
                group_1_speed_max: { type: 'number', default: 10, min: 0, max: 50 },
                group_2_coherence_min: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
                group_2_coherence_max: { type: 'number', default: 0.9, min: 0, max: 1, step: 0.01 },
                group_2_color: { type: 'COLOR', default: '#0066FF' },
                group_2_direction_options: { type: 'string', default: '0,180' },
                group_2_speed_min: { type: 'number', default: 4, min: 0, max: 50 },
                group_2_speed_max: { type: 'number', default: 10, min: 0, max: 50 },

                // Dot-groups cue border / target
                response_target_group: { type: 'select', default: 'none', options: ['none', 'group_1', 'group_2'] },
                cue_border_mode: { type: 'select', default: 'off', options: ['off', 'target-group-color', 'custom'] },
                cue_border_color: { type: 'COLOR', default: '#FFFFFF' },
                cue_border_width: { type: 'number', default: 4, min: 0, max: 20 }
            };

            const perTaskParams = (currentTaskType === 'flanker')
                ? flankerOnlyParams
                : (currentTaskType === 'sart')
                    ? sartOnlyParams
                    : (currentTaskType === 'simon')
                        ? simonOnlyParams
                    : (currentTaskType === 'task-switching')
                        ? taskSwitchingOnlyParams
                    : (currentTaskType === 'pvt')
                        ? pvtOnlyParams
                    : (currentTaskType === 'mot')
                        ? motOnlyParams
                    : (currentTaskType === 'gabor')
                        ? gaborOnlyParams
                        : (currentTaskType === 'continuous-image')
                            ? continuousImageOnlyParams
                        : (currentTaskType === 'stroop')
                            ? stroopOnlyParams
                        : (currentTaskType === 'emotional-stroop')
                            ? emotionalStroopOnlyParams
                        : rdmOnlyParams;

            return {
                id: 'block',
                name: blockDisplayName,
                icon: 'fas fa-layer-group',
                description: 'Compactly represent many generated trials using parameter windows (ranges)',
                category: 'advanced',
                parameters: {
                    ...commonParams,
                    ...perTaskParams
                }
            };
        };
        
        const baseComponents = [
            {
                id: 'instructions',
                name: 'Instructions',
                icon: 'fas fa-info-circle',
                description: 'Display text instructions to participants',
                category: 'basic',
                type: 'html-keyboard-response',
                parameters: {
                    stimulus: { type: 'string', default: 'Welcome to the experiment.\n\nPlease read the instructions carefully and press any key to continue.' },
                    choices: { type: 'select', default: 'ALL_KEYS', options: ['ALL_KEYS', 'space', 'enter', 'escape'] },
                    prompt: { type: 'string', default: '' },
                    stimulus_duration: { type: 'number', default: null, min: 100, max: 30000 },
                    trial_duration: { type: 'number', default: null, min: 500, max: 60000 },
                    response_ends_trial: { type: 'boolean', default: true }
                },
                data: {
                    type: 'html-keyboard-response',
                    auto_generated: true,
                    stimulus: 'Welcome to the experiment.\n\nPlease read the instructions carefully and press any key to continue.',
                    choices: 'ALL_KEYS',
                    prompt: '',
                    stimulus_duration: null,
                    trial_duration: null,
                    response_ends_trial: true
                }
            },
            {
                id: 'detection-response-task-start',
                name: 'DRT Start (Response Detection Task)',
                icon: 'fas fa-bullseye',
                description: 'Start a background response-detection stream; DRT events are logged as separate data rows until a matching DRT Stop',
                category: 'setup',
                type: 'detection-response-task-start',
                parameters: {
                    override_iso_standard: { type: 'boolean', default: false },
                    segment_label: { type: 'string', default: '' },
                    response_key: { type: 'string', default: 'space' },
                    min_iti_ms: { type: 'number', default: 3000, min: 200, max: 600000, step: 50 },
                    max_iti_ms: { type: 'number', default: 5000, min: 200, max: 600000, step: 50 },
                    stimulus_duration_ms: { type: 'number', default: 1000, min: 50, max: 60000, step: 10 },
                    stimulus_type: { type: 'select', default: 'square', options: ['square', 'circle'] },
                    stimulus_color: { type: 'COLOR', default: '#ff3b3b' },
                    location: { type: 'select', default: 'top-right', options: ['top-right', 'top-left', 'bottom-right', 'bottom-left'] },
                    size_px: { type: 'number', default: 18, min: 6, max: 80, step: 1 },
                    min_rt_ms: { type: 'number', default: 100, min: 0, max: 60000, step: 10 },
                    max_rt_ms: { type: 'number', default: 2500, min: 50, max: 60000, step: 10 }
                }
            },
            {
                id: 'detection-response-task-stop',
                name: 'DRT Stop (Response Detection Task)',
                icon: 'fas fa-circle-stop',
                description: 'Stop the background response-detection stream (started by DRT Start)',
                category: 'setup',
                type: 'detection-response-task-stop',
                parameters: {}
            },
            {
                id: 'survey-response',
                name: 'Survey Response',
                icon: 'fas fa-clipboard-list',
                description: 'Collect questionnaire/survey responses in a single form',
                category: 'survey',
                type: 'survey-response',
                parameters: {
                    title: { type: 'string', default: 'Survey' },
                    instructions: { type: 'string', default: 'Please answer the following questions.' },
                    submit_label: { type: 'string', default: 'Continue' },
                    // Optional timeout behavior: allow continuing without responses after timeout_ms
                    allow_empty_on_timeout: { type: 'boolean', default: false },
                    timeout_ms: { type: 'number', default: null, min: 0, max: 600000 },
                    questions: {
                        type: 'COMPLEX',
                        default: [
                            {
                                id: 'q1',
                                type: 'likert',
                                prompt: 'I found the task engaging.',
                                options: ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'],
                                required: true
                            }
                        ]
                    }
                }
            },
            {
                id: 'visual-angle-calibration',
                name: 'Visual Angle Calibration',
                icon: 'fas fa-ruler-combined',
                description: 'Calibrate screen px/cm and compute px/deg (ID/credit card on screen + distance choice; optional webcam preview)',
                category: 'setup',
                type: 'visual-angle-calibration',
                parameters: {
                    title: { type: 'string', default: 'Visual Angle Calibration' },
                    instructions: { type: 'string', default: 'Place an ID/credit card flat against the screen and match the on-screen bar. Then estimate your viewing distance.' },

                    object_preset: { type: 'select', default: 'id_card_long', options: ['id_card_long', 'id_card_short', 'custom'] },
                    object_length_cm: { type: 'number', default: 8.56, min: 0.1, max: 100, step: 0.001 },

                    distance_mode: { type: 'select', default: 'posture_choice', options: ['posture_choice', 'manual'] },

                    close_label: { type: 'string', default: 'Close' },
                    close_distance_cm: { type: 'number', default: 35, min: 1, max: 200, step: 0.1 },
                    normal_label: { type: 'string', default: 'Normal' },
                    normal_distance_cm: { type: 'number', default: 50, min: 1, max: 200, step: 0.1 },
                    far_label: { type: 'string', default: 'Far' },
                    far_distance_cm: { type: 'number', default: 65, min: 1, max: 200, step: 0.1 },

                    manual_distance_default_cm: { type: 'number', default: 50, min: 1, max: 200, step: 0.1 },

                    webcam_enabled: { type: 'boolean', default: false },
                    webcam_facing_mode: { type: 'select', default: 'user', options: ['user', 'environment'] },

                    store_key: { type: 'string', default: '__psy_visual_angle' }
                }
            },
            {
                id: 'reward-settings',
                name: 'Reward Settings',
                icon: 'fas fa-coins',
                description: 'Define reward policy (RT/accuracy/both), thresholds, and optional end-of-experiment summary screen',
                category: 'setup',
                type: 'reward-settings',
                parameters: {
                    store_key: { type: 'string', default: '__psy_rewards' },
                    currency_label: { type: 'string', default: 'points' },

                    scoring_basis: { type: 'select', default: 'both', options: ['accuracy', 'reaction_time', 'both'] },
                    rt_threshold_ms: { type: 'number', default: 600, min: 0, max: 60000, step: 1 },
                    points_per_success: { type: 'number', default: 1, min: 0, max: 1000, step: 0.1 },
                    require_correct_for_rt: { type: 'boolean', default: false },

                    calculate_on_the_fly: { type: 'boolean', default: true },
                    show_summary_at_end: { type: 'boolean', default: true },
                    continue_key: { type: 'select', default: 'space', options: ['space', 'enter', 'ALL_KEYS'] },

                    // New (v2) reward screen model
                    instructions_screen: {
                        type: 'object',
                        default: {
                            title: 'Rewards',
                            template_html: '<p>You can earn <b>{{currency_label}}</b> during this study.</p>\n<ul>\n<li><b>Basis</b>: {{scoring_basis_label}}</li>\n<li><b>RT threshold</b>: {{rt_threshold_ms}} ms</li>\n<li><b>Points per success</b>: {{points_per_success}}</li>\n</ul>\n<p>Press {{continue_key_label}} to begin.</p>',
                            image_url: '',
                            audio_url: ''
                        }
                    },
                    intermediate_screens: { type: 'object', default: [] },
                    milestones: { type: 'object', default: [] },
                    summary_screen: {
                        type: 'object',
                        default: {
                            title: 'Rewards Summary',
                            template_html: '<p><b>Total earned</b>: {{total_points}} {{currency_label}}</p>\n<p><b>Rewarded trials</b>: {{rewarded_trials}} / {{eligible_trials}}</p>\n<p>Press {{continue_key_label}} to finish.</p>',
                            image_url: '',
                            audio_url: ''
                        }
                    },

                    instructions_title: { type: 'string', default: 'Rewards' },
                    instructions_template_html: {
                        type: 'string',
                        default: '<p>You can earn <b>{{currency_label}}</b> during this study.</p>\n<ul>\n<li><b>Basis</b>: {{scoring_basis_label}}</li>\n<li><b>RT threshold</b>: {{rt_threshold_ms}} ms</li>\n<li><b>Points per success</b>: {{points_per_success}}</li>\n</ul>\n<p>Press {{continue_key_label}} to begin.</p>'
                    },

                    summary_title: { type: 'string', default: 'Rewards Summary' },
                    summary_template_html: {
                        type: 'string',
                        default: '<p><b>Total earned</b>: {{total_points}} {{currency_label}}</p>\n<p><b>Rewarded trials</b>: {{rewarded_trials}} / {{eligible_trials}}</p>\n<p>Press {{continue_key_label}} to finish.</p>'
                    }
                }
            }
        ];

        // SOC Dashboard (continuous-only): add the SOC session + helper components.
        if (taskType === 'soc-dashboard') {
            baseComponents.push(
                createComponentDefFromSchema('soc-dashboard', {
                    name: `SOC Dashboard Session`,
                    icon: 'fas fa-desktop',
                    description: 'Windows-like SOC session shell (subtasks and icons are composed into this on export)',
                    category: 'task'
                }),
                createComponentDefFromSchema('soc-dashboard-icon', {
                    name: 'SOC Desktop Icon',
                    icon: 'fas fa-icons',
                    description: 'Builder-only: desktop icon composed into the SOC session at export',
                    category: 'task'
                }),
                createComponentDefFromSchema('soc-subtask-sart-like', {
                    name: 'SOC Subtask: SART-like',
                    icon: 'fas fa-list-check',
                    description: 'Builder-only: subtask window composed into the SOC session at export',
                    category: 'task'
                }),
                createComponentDefFromSchema('soc-subtask-nback-like', {
                    name: 'SOC Subtask: N-back-like',
                    icon: 'fas fa-repeat',
                    description: 'Builder-only: subtask window composed into the SOC session at export',
                    category: 'task'
                }),
                createComponentDefFromSchema('soc-subtask-flanker-like', {
                    name: 'SOC Subtask: Flanker-like',
                    icon: 'fas fa-arrows-left-right',
                    description: 'Builder-only: subtask window composed into the SOC session at export',
                    category: 'task'
                }),
                createComponentDefFromSchema('soc-subtask-wcst-like', {
                    name: 'SOC Subtask: WCST-like',
                    icon: 'fas fa-shapes',
                    description: 'Builder-only: subtask window composed into the SOC session at export',
                    category: 'task'
                }),
                createComponentDefFromSchema('soc-subtask-pvt-like', {
                    name: 'SOC Subtask: PVT-like',
                    icon: 'fas fa-bell',
                    description: 'Builder-only: scrolling logs with alert countdown + red flash; composed into the SOC session at export',
                    category: 'task'
                })
            );

            // Keep generic stimulus components available while authoring SOC timelines.
            baseComponents.push(
                {
                    id: 'html-keyboard-response',
                    name: 'HTML + Keyboard',
                    icon: 'fas fa-keyboard',
                    description: 'Show HTML content and collect keyboard response',
                    category: 'basic',
                    parameters: {
                        stimulus: { type: 'string', default: '<p>Press a key to continue.</p>' },
                        choices: { type: 'select', default: 'ALL_KEYS', options: ['ALL_KEYS', 'space', 'enter', 'escape'] },
                        prompt: { type: 'string', default: '' },
                        stimulus_duration: { type: 'number', default: null, min: 0, max: 30000 },
                        trial_duration: { type: 'number', default: null, min: 0, max: 60000 },
                        response_ends_trial: { type: 'boolean', default: true }
                    }
                },
                {
                    id: 'image-keyboard-response',
                    name: 'Image + Keyboard',
                    icon: 'fas fa-image',
                    description: 'Show image and collect keyboard response',
                    category: 'stimulus',
                    parameters: {
                        stimulus: { type: 'string', default: 'img/sitting.png' },
                        choices: { type: 'array', default: ['f', 'j'] },
                        stimulus_duration: { type: 'number', default: null },
                        trial_duration: { type: 'number', default: null }
                    }
                },
                {
                    id: 'html-button-response',
                    name: 'HTML + Button',
                    icon: 'fas fa-mouse-pointer',
                    description: 'Show HTML content and collect button response',
                    category: 'stimulus',
                    parameters: {
                        stimulus: { type: 'string', default: '<p>Click a button</p>' },
                        choices: { type: 'array', default: ['Option 1', 'Option 2'] },
                        trial_duration: { type: 'number', default: null }
                    }
                }
            );

            // Data-collection components (same behavior as other tasks)
            if (this.dataCollection['mouse-tracking']) {
                baseComponents.push({
                    id: 'mouse-tracking',
                    name: 'Mouse Tracking',
                    icon: 'fas fa-mouse',
                    description: 'Track mouse movement and clicks',
                    category: 'tracking',
                    parameters: {
                        track_movement: { type: 'boolean', default: true },
                        track_clicks: { type: 'boolean', default: true },
                        sampling_rate: { type: 'number', default: 50 }
                    }
                });
            }

            if (this.dataCollection['eye-tracking']) {
                baseComponents.push({
                    id: 'eye-tracking',
                    name: 'Eye Tracking',
                    icon: 'fas fa-eye',
                    description: 'WebGazer-based eye tracking',
                    category: 'tracking',
                    parameters: {
                        calibration_points: { type: 'number', default: 9 },
                        prediction_points: { type: 'number', default: 50 },
                        sample_rate: { type: 'number', default: 30 }
                    }
                });
            }

            return baseComponents;
        }

        // For Flanker/SART/Simon/Task Switching/PVT/Gabor/Stroop/N-back/Continuous Image, show only task-appropriate components.
        if (taskType === 'flanker' || taskType === 'sart' || taskType === 'simon' || taskType === 'task-switching' || taskType === 'pvt' || taskType === 'mot' || taskType === 'gabor' || taskType === 'stroop' || taskType === 'emotional-stroop' || taskType === 'nback' || taskType === 'continuous-image') {
            if (taskType === 'flanker') {
                baseComponents.push({
                    id: 'flanker-trial',
                    name: `Flanker ${unitName}`,
                    icon: 'fas fa-arrows-alt-h',
                    description: 'Flanker trial/frame (interpreter implements stimulus + scoring)',
                    category: 'task',
                    parameters: {
                        target_direction: { type: 'select', default: 'left', options: ['left', 'right'] },
                        congruency: { type: 'select', default: 'congruent', options: ['congruent', 'incongruent', 'neutral'] },
                        left_key: { type: 'string', default: 'f' },
                        right_key: { type: 'string', default: 'j' },
                        stimulus_duration_ms: { type: 'number', default: 800, min: 0, max: 10000 },
                        trial_duration_ms: { type: 'number', default: 1500, min: 0, max: 30000 },
                        iti_ms: { type: 'number', default: 500, min: 0, max: 10000 }
                    }
                });
            }

            if (taskType === 'sart') {
                baseComponents.push({
                    id: 'sart-trial',
                    name: `SART ${unitName}`,
                    icon: 'fas fa-stopwatch',
                    description: 'SART trial/frame (interpreter implements go/no-go logic)',
                    category: 'task',
                    parameters: {
                        stimulus_type: { type: 'select', default: 'arrows', options: ['arrows', 'letters', 'symbols', 'custom'] },
                        digit: { type: 'number', default: 1, min: 0, max: 9 },
                        target_stimulus: { type: 'string', default: 'H' },
                        distractor_stimulus: { type: 'string', default: 'S' },
                        neutral_stimulus: { type: 'string', default: '–' },
                        nogo_digit: { type: 'number', default: 3, min: 0, max: 9 },
                        show_fixation_dot: { type: 'boolean', default: false },
                        show_fixation_cross_between_trials: { type: 'boolean', default: false },
                        go_key: { type: 'string', default: 'space' },
                        stimulus_duration_ms: { type: 'number', default: 250, min: 0, max: 10000 },
                        mask_duration_ms: { type: 'number', default: 900, min: 0, max: 10000 },
                        trial_duration_ms: { type: 'number', default: 1150, min: 0, max: 30000 },
                        iti_ms: { type: 'number', default: 0, min: 0, max: 10000 }
                    }
                });
            }

            if (taskType === 'simon') {
                baseComponents.push({
                    id: 'simon-trial',
                    name: `Simon ${unitName}`,
                    icon: 'fas fa-circle-dot',
                    description: 'Simon trial/frame (two circles; respond by mapped color side; interpreter implements stimulus + scoring)',
                    category: 'task',
                    parameters: {
                        stimulus_side: { type: 'select', default: 'left', options: ['left', 'right'] },
                        stimulus_color_name: { type: 'string', default: 'BLUE' },

                        response_device: { type: 'select', default: 'inherit', options: ['inherit', 'keyboard', 'mouse'] },
                        left_key: { type: 'string', default: 'f' },
                        right_key: { type: 'string', default: 'j' },

                        circle_diameter_px: { type: 'number', default: 140, min: 40, max: 400 },

                        stimulus_duration_ms: { type: 'number', default: 0, min: 0, max: 10000 },
                        trial_duration_ms: { type: 'number', default: 1500, min: 0, max: 30000 },
                        iti_ms: { type: 'number', default: 500, min: 0, max: 10000 }
                    }
                });
            }

            if (taskType === 'task-switching') {
                baseComponents.push({
                    id: 'task-switching-trial',
                    name: `Task Switching ${unitName}`,
                    icon: 'fas fa-random',
                    description: 'Task switching trial/frame (2AFC per task; interpreter implements stimulus + scoring)',
                    category: 'task',
                    parameters: {
                        task_index: { type: 'select', default: 1, options: [1, 2] },
                        stimulus: { type: 'string', default: 'A' },
                        stimulus_position: { type: 'select', default: 'top', options: ['left', 'right', 'top', 'bottom'] },
                        border_enabled: { type: 'boolean', default: false },
                        left_key: { type: 'string', default: 'f' },
                        right_key: { type: 'string', default: 'j' },
                        stimulus_duration_ms: { type: 'number', default: 0, min: 0, max: 10000 },
                        trial_duration_ms: { type: 'number', default: 2000, min: 0, max: 30000 },
                        iti_ms: { type: 'number', default: 500, min: 0, max: 10000 }
                    }
                });
            }

            if (taskType === 'pvt') {
                baseComponents.push({
                    id: 'pvt-trial',
                    name: `PVT ${unitName}`,
                    icon: 'fas fa-stopwatch',
                    description: 'Psychomotor Vigilance Task trial (variable foreperiod; running 4-digit timer; keyboard/click response)',
                    category: 'task',
                    parameters: {
                        response_device: { type: 'select', default: 'inherit', options: ['inherit', 'keyboard', 'mouse', 'both'] },
                        response_key: { type: 'string', default: 'space' },

                        foreperiod_ms: { type: 'number', default: 4000, min: 0, max: 60000 },
                        trial_duration_ms: { type: 'number', default: 10000, min: 0, max: 60000 },
                        iti_ms: { type: 'number', default: 0, min: 0, max: 30000 }
                    }
                });
            }

            if (taskType === 'mot') {
                baseComponents.push({
                    id: 'mot-trial',
                    name: `MOT ${unitName}`,
                    icon: 'fas fa-bullseye',
                    description: 'Multiple Object Tracking trial (cue, tracking, probe)',
                    category: 'task',
                    parameters: {
                        num_objects: { type: 'number', default: 8, min: 2, max: 20 },
                        num_targets: { type: 'number', default: 4, min: 1, max: 10 },
                        speed_px_per_s: { type: 'number', default: 150, min: 20, max: 600 },
                        motion_type: { type: 'select', default: 'linear', options: ['linear', 'curved'] },
                        probe_mode: { type: 'select', default: 'click', options: ['click', 'number_entry'] },
                        cue_duration_ms: { type: 'number', default: 2000, min: 0, max: 30000 },
                        tracking_duration_ms: { type: 'number', default: 8000, min: 0, max: 60000 },
                        iti_ms: { type: 'number', default: 1000, min: 0, max: 30000 }
                    }
                });
            }

            if (taskType === 'gabor') {
                baseComponents.push({
                    id: 'gabor-trial',
                    name: `Gabor ${unitName}`,
                    icon: 'fas fa-wave-square',
                    description: 'Gabor patch trial/frame (interpreter implements stimulus + scoring)',
                    category: 'task',
                    parameters: {
                        response_task: { type: 'select', default: 'discriminate_tilt', options: ['detect_target', 'discriminate_tilt'] },
                        left_key: { type: 'string', default: 'f' },
                        right_key: { type: 'string', default: 'j' },
                        yes_key: { type: 'string', default: 'f' },
                        no_key: { type: 'string', default: 'j' },

                        target_location: { type: 'select', default: 'left', options: ['left', 'right'] },
                        target_tilt_deg: { type: 'number', default: 45, min: -90, max: 90 },
                        distractor_orientation_deg: { type: 'number', default: 0, min: 0, max: 179 },

                        spatial_frequency_cyc_per_px: { type: 'number', default: 0.06, min: 0.001, max: 0.5, step: 0.001 },
                        grating_waveform: { type: 'select', default: 'sinusoidal', options: ['sinusoidal', 'square', 'triangle'] },

                        patch_diameter_deg: { type: 'number', default: 6, min: 0.1, max: 60, step: 0.1 },

                        spatial_cue: { type: 'select', default: 'none', options: ['none', 'left', 'right', 'both'] },
                        left_value: { type: 'select', default: 'neutral', options: ['neutral', 'high', 'low'] },
                        right_value: { type: 'select', default: 'neutral', options: ['neutral', 'high', 'low'] },

                        stimulus_duration_ms: { type: 'number', default: 67, min: 0, max: 10000 },
                        mask_duration_ms: { type: 'number', default: 67, min: 0, max: 10000 },

                        patch_border_enabled: { type: 'boolean', default: true },
                        patch_border_width_px: { type: 'number', default: 2, min: 0, max: 50, step: 1 },
                        patch_border_color: { type: 'COLOR', default: '#ffffff' },
                        patch_border_opacity: { type: 'number', default: 0.22, min: 0, max: 1, step: 0.01 }
                    }
                });
            }

            if (taskType === 'continuous-image') {
                baseComponents.push({
                    id: 'continuous-image-presentation',
                    name: `Continuous Image ${unitName}`,
                    icon: 'fas fa-images',
                    description: 'Continuous image presentation frame (precomputed transition sprites; 2AFC response)',
                    category: 'task',
                    parameters: {
                        image_url: { type: 'string', default: '' },
                        mask_to_image_sprite_url: { type: 'string', default: '' },
                        image_to_mask_sprite_url: { type: 'string', default: '' },
                        transition_frames: { type: 'number', default: 8, min: 2, max: 60 },

                        image_duration_ms: { type: 'number', default: 750, min: 0, max: 60000 },
                        transition_duration_ms: { type: 'number', default: 250, min: 0, max: 60000 },
                        choices: { type: 'string', default: 'f,j' }
                    }
                });
            }

            if (taskType === 'stroop') {
                baseComponents.push({
                    id: 'stroop-trial',
                    name: `Stroop ${unitName}`,
                    icon: 'fas fa-font',
                    description: 'Stroop trial/frame (word shown in ink color; interpreter implements stimulus + scoring)',
                    category: 'task',
                    parameters: {
                        word: { type: 'string', default: 'RED' },
                        ink_color_name: { type: 'string', default: 'BLUE' },
                        congruency: { type: 'select', default: 'auto', options: ['auto', 'congruent', 'incongruent'] },

                        response_mode: { type: 'select', default: 'inherit', options: ['inherit', 'color_naming', 'congruency'] },
                        response_device: { type: 'select', default: 'inherit', options: ['inherit', 'keyboard', 'mouse'] },

                        // Key mappings (can be overridden per-trial; defaults can be applied from the Stroop defaults panel).
                        choice_keys: { type: 'array', default: ['1', '2', '3', '4'] },
                        congruent_key: { type: 'string', default: 'f' },
                        incongruent_key: { type: 'string', default: 'j' },

                        stimulus_font_size_px: { type: 'number', default: 64, min: 12, max: 200 },
                        stimulus_duration_ms: { type: 'number', default: 0, min: 0, max: 10000 },
                        trial_duration_ms: { type: 'number', default: 2000, min: 0, max: 30000 },
                        iti_ms: { type: 'number', default: 500, min: 0, max: 10000 }
                    }
                });
            }

            if (taskType === 'emotional-stroop') {
                baseComponents.push({
                    id: 'emotional-stroop-trial',
                    name: `Emotional Stroop ${unitName}`,
                    icon: 'fas fa-font',
                    description: 'Emotional Stroop trial/frame (emotional word shown in ink color; respond by ink color)',
                    category: 'task',
                    parameters: {
                        word: { type: 'string', default: 'HAPPY' },
                        word_list_label: { type: 'string', default: 'Neutral' },
                        word_list_index: { type: 'number', default: 1, min: 1, max: 3 },
                        ink_color_name: { type: 'string', default: 'BLUE' },

                        response_device: { type: 'select', default: 'inherit', options: ['inherit', 'keyboard', 'mouse'] },
                        choice_keys: { type: 'array', default: ['1', '2', '3', '4'] },

                        stimulus_font_size_px: { type: 'number', default: 64, min: 12, max: 200 },
                        stimulus_duration_ms: { type: 'number', default: 0, min: 0, max: 10000 },
                        trial_duration_ms: { type: 'number', default: 2000, min: 0, max: 30000 },
                        iti_ms: { type: 'number', default: 500, min: 0, max: 10000 }
                    }
                });
            }

            if (taskType === 'nback') {
                const isContinuous = (this.experimentType === 'continuous');
                baseComponents.push(createComponentDefFromSchema('nback-trial-sequence', {
                    name: isContinuous ? 'N-back Stream' : 'N-back Sequence',
                    icon: 'fas fa-repeat',
                    description: isContinuous
                        ? 'Generate a continuous N-back stream (compiled to the continuous N-back plugin)'
                        : 'Generate a trial-based N-back sequence (expanded to N-back trials on export)',
                    category: 'task'
                }));
            }

            // HTML-based components
            baseComponents.push(
                {
                    id: 'html-keyboard-response',
                    name: 'HTML + Keyboard',
                    icon: 'fas fa-keyboard',
                    description: 'Show HTML content and collect keyboard response',
                    category: 'basic',
                    parameters: {
                        stimulus: { type: 'string', default: '<p>Press a key to continue.</p>' },
                        choices: { type: 'select', default: 'ALL_KEYS', options: ['ALL_KEYS', 'space', 'enter', 'escape'] },
                        prompt: { type: 'string', default: '' },
                        stimulus_duration: { type: 'number', default: null, min: 0, max: 30000 },
                        trial_duration: { type: 'number', default: null, min: 0, max: 60000 },
                        response_ends_trial: { type: 'boolean', default: true }
                    }
                },
                {
                    id: 'html-button-response',
                    name: 'HTML + Button',
                    icon: 'fas fa-mouse-pointer',
                    description: 'Show HTML content and collect button response',
                    category: 'basic',
                    parameters: {
                        stimulus: { type: 'string', default: '<p>Click a button to continue.</p>' },
                        choices: { type: 'array', default: ['Continue'] },
                        prompt: { type: 'string', default: '' },
                        stimulus_duration: { type: 'number', default: null, min: 0, max: 30000 },
                        trial_duration: { type: 'number', default: null, min: 0, max: 60000 },
                        response_ends_trial: { type: 'boolean', default: true }
                    }
                },
                {
                    id: 'image-keyboard-response',
                    name: 'Image + Keyboard',
                    icon: 'fas fa-image',
                    description: 'Show image and collect keyboard response',
                    category: 'stimulus',
                    parameters: {
                        stimulus: { type: 'string', default: 'img/sitting.png' },
                        choices: { type: 'array', default: ['f', 'j'] },
                        stimulus_duration: { type: 'number', default: null },
                        trial_duration: { type: 'number', default: null }
                    }
                }
            );

            // Block (task-scoped)
            // Block stays available for advanced authoring / parameter windows.
            baseComponents.push(createBlockComponentDef(taskType));

            // Add specialized components based on data collection settings
            // (these are task-agnostic and should be available for all tasks).
            if (this.dataCollection['mouse-tracking']) {
                baseComponents.push({
                    id: 'mouse-tracking',
                    name: 'Mouse Tracking',
                    icon: 'fas fa-mouse',
                    description: 'Track mouse movement and clicks',
                    category: 'tracking',
                    parameters: {
                        track_movement: { type: 'boolean', default: true },
                        track_clicks: { type: 'boolean', default: true },
                        sampling_rate: { type: 'number', default: 50 }
                    }
                });
            }

            if (this.dataCollection['eye-tracking']) {
                baseComponents.push({
                    id: 'eye-tracking',
                    name: 'Eye Tracking',
                    icon: 'fas fa-eye',
                    description: 'WebGazer-based eye tracking',
                    category: 'tracking',
                    parameters: {
                        calibration_points: { type: 'number', default: 9 },
                        prediction_points: { type: 'number', default: 50 },
                        sample_rate: { type: 'number', default: 30 }
                    }
                });

                // Optional preface instructions researchers can place *before* calibration.
                baseComponents.push({
                    id: 'eye-tracking-calibration-instructions',
                    name: 'Calibration Instructions',
                    icon: 'fas fa-eye',
                    description: 'Preface screen shown before the eye-tracking calibration dots',
                    category: 'tracking',
                    type: 'html-keyboard-response',
                    parameters: {
                        stimulus: {
                            type: 'string',
                            default: 'Eye tracking calibration\n\nWe will briefly calibrate the camera-based eye tracking.\n\nPlease sit comfortably, keep your head still, and look at each dot as it appears.\nPress SPACE while looking at each dot.\n\nPress any key to begin.'
                        },
                        choices: { type: 'select', default: 'ALL_KEYS', options: ['ALL_KEYS', 'space', 'enter', 'escape'] },
                        prompt: { type: 'string', default: '' },
                        stimulus_duration: { type: 'number', default: null, min: 0, max: 30000 },
                        trial_duration: { type: 'number', default: null, min: 0, max: 60000 },
                        response_ends_trial: { type: 'boolean', default: true }
                    },
                    data: {
                        type: 'html-keyboard-response',
                        stimulus: 'Eye tracking calibration\n\nWe will briefly calibrate the camera-based eye tracking.\n\nPlease sit comfortably, keep your head still, and look at each dot as it appears.\nPress SPACE while looking at each dot.\n\nPress any key to begin.',
                        choices: 'ALL_KEYS',
                        prompt: '',
                        stimulus_duration: null,
                        trial_duration: null,
                        response_ends_trial: true,
                        data: { plugin_type: 'eye-tracking-calibration-instructions' }
                    }
                });
            }

            return baseComponents;
        }

        // Add task-specific components
        if (taskType === 'rdm') {
            baseComponents.push(
                {
                    id: 'rdm-trial',
                    name: 'RDM Trial',
                    icon: 'fas fa-circle',
                    description: 'Random Dot Motion trial with configurable parameters',
                    category: 'stimulus',
                    parameters: {
                        coherence: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
                        direction: { type: 'number', default: 0, min: 0, max: 360 },
                        speed: { type: 'number', default: 6, min: 1, max: 20 },
                        total_dots: { type: 'number', default: 150, min: 10, max: 1000 },
                        dot_size: { type: 'number', default: 4, min: 1, max: 20 },
                        dot_color: { type: 'COLOR', default: '#FFFFFF' },
                        aperture_diameter: { type: 'number', default: 350, min: 50, max: 800 },
                        stimulus_duration: { type: 'number', default: 1500, min: 100, max: 10000 },
                        trial_duration: { type: 'number', default: 3000, min: 500, max: 30000 },
                        transition_duration: { type: 'number', default: 500, min: 0, max: 2000 }
                    }
                },
                {
                    id: 'rdm-practice',
                    name: 'RDM Practice',
                    icon: 'fas fa-graduation-cap',
                    description: 'Practice RDM trial with feedback and instructions',
                    category: 'practice',
                    parameters: {
                        coherence: { type: 'number', default: 0.8, min: 0, max: 1, step: 0.01 },
                        direction: { type: 'number', default: 0, min: 0, max: 360 },
                        dot_color: { type: 'COLOR', default: '#FFFFFF' },
                        feedback_duration: { type: 'number', default: 1000, min: 500, max: 3000 },
                        show_feedback: { type: 'boolean', default: true },
                        practice_instructions: { type: 'string', default: 'Practice trial - feedback provided' },
                        trial_duration: { type: 'number', default: 3000, min: 500, max: 30000 },
                        transition_duration: { type: 'number', default: 500, min: 0, max: 2000 }
                    }
                },
                {
                    id: 'rdm-dot-groups',
                    name: 'RDM Groups',
                    icon: 'fas fa-layer-group',
                    description: 'RDM trial with multiple dot groups (different colors/coherences)',
                    category: 'advanced',
                    parameters: {
                        group_1_percentage: { type: 'number', default: 50, min: 0, max: 100 },
                        group_1_color: { type: 'COLOR', default: '#FF0066' },
                        group_1_coherence: { type: 'number', default: 0.2, min: 0, max: 1, step: 0.01 },
                        group_1_direction: { type: 'number', default: 0, min: 0, max: 359 },
                        group_2_percentage: { type: 'number', default: 50, min: 0, max: 100 },
                        group_2_color: { type: 'COLOR', default: '#0066FF' },
                        group_2_coherence: { type: 'number', default: 0.8, min: 0, max: 1, step: 0.01 },
                        group_2_direction: { type: 'number', default: 180, min: 0, max: 359 },
                        total_dots: { type: 'number', default: 200, min: 50, max: 1000 },
                        trial_duration: { type: 'number', default: 3000, min: 500, max: 30000 },
                        transition_duration: { type: 'number', default: 500, min: 0, max: 2000 },
                        aperture_diameter: { type: 'number', default: 350, min: 50, max: 800 }
                    }
                },
                {
                    id: 'rdm-adaptive',
                    name: 'RDM Adaptive',
                    icon: 'fas fa-chart-line',
                    description: 'Adaptive RDM trial with QUEST or staircase procedures',
                    category: 'advanced',
                    parameters: {
                        algorithm: { type: 'select', default: 'quest', options: ['quest', 'staircase', 'simple'] },
                        target_performance: { type: 'number', default: 0.82, min: 0.5, max: 1, step: 0.01 },
                        initial_coherence: { type: 'number', default: 0.1, min: 0, max: 1, step: 0.01 },
                        step_size: { type: 'number', default: 0.05, min: 0.01, max: 0.2, step: 0.01 },
                        trial_duration: { type: 'number', default: 3000, min: 500, max: 30000 },
                        transition_duration: { type: 'number', default: 500, min: 0, max: 2000 }
                    }
                }
            );

            // Add one canonical, task-scoped Block definition.
            baseComponents.push(createBlockComponentDef('rdm'));
        }

        // Add generic stimulus components (RDM mode)
        baseComponents.push(
            {
                id: 'html-keyboard-response',
                name: 'HTML + Keyboard',
                icon: 'fas fa-keyboard',
                description: 'Show HTML content and collect keyboard response',
                category: 'basic',
                parameters: {
                    stimulus: { type: 'string', default: '<p>Press a key to continue.</p>' },
                    choices: { type: 'select', default: 'ALL_KEYS', options: ['ALL_KEYS', 'space', 'enter', 'escape'] },
                    prompt: { type: 'string', default: '' },
                    stimulus_duration: { type: 'number', default: null, min: 0, max: 30000 },
                    trial_duration: { type: 'number', default: null, min: 0, max: 60000 },
                    response_ends_trial: { type: 'boolean', default: true }
                }
            },
            {
                id: 'image-keyboard-response',
                name: 'Image + Keyboard',
                icon: 'fas fa-image',
                description: 'Show image and collect keyboard response',
                category: 'stimulus',
                parameters: {
                    stimulus: { type: 'string', default: 'img/sitting.png' },
                    choices: { type: 'array', default: ['f', 'j'] },
                    stimulus_duration: { type: 'number', default: null },
                    trial_duration: { type: 'number', default: null }
                }
            },
            {
                id: 'html-button-response',
                name: 'HTML + Button',
                icon: 'fas fa-mouse-pointer',
                description: 'Show HTML content and collect button response',
                category: 'stimulus',
                parameters: {
                    stimulus: { type: 'string', default: '<p>Click a button</p>' },
                    choices: { type: 'array', default: ['Option 1', 'Option 2'] },
                    trial_duration: { type: 'number', default: null }
                }
            }
        );

        // Add specialized components based on data collection settings
        if (this.dataCollection['mouse-tracking']) {
            baseComponents.push({
                id: 'mouse-tracking',
                name: 'Mouse Tracking',
                icon: 'fas fa-mouse',
                description: 'Track mouse movement and clicks',
                category: 'tracking',
                parameters: {
                    track_movement: { type: 'boolean', default: true },
                    track_clicks: { type: 'boolean', default: true },
                    sampling_rate: { type: 'number', default: 50 }
                }
            });
        }

        if (this.dataCollection['eye-tracking']) {
            baseComponents.push({
                id: 'eye-tracking',
                name: 'Eye Tracking',
                icon: 'fas fa-eye',
                description: 'WebGazer-based eye tracking',
                category: 'tracking',
                parameters: {
                    calibration_points: { type: 'number', default: 9 },
                    prediction_points: { type: 'number', default: 50 },
                    sample_rate: { type: 'number', default: 30 }
                }
            });

            // Optional preface instructions researchers can place *before* calibration.
            baseComponents.push({
                id: 'eye-tracking-calibration-instructions',
                name: 'Calibration Instructions',
                icon: 'fas fa-eye',
                description: 'Preface screen shown before the eye-tracking calibration dots',
                category: 'tracking',
                type: 'html-keyboard-response',
                parameters: {
                    stimulus: {
                        type: 'string',
                        default: 'Eye tracking calibration\n\nWe will briefly calibrate the camera-based eye tracking.\n\nPlease sit comfortably, keep your head still, and look at each dot as it appears.\nPress SPACE while looking at each dot.\n\nPress any key to begin.'
                    },
                    choices: { type: 'select', default: 'ALL_KEYS', options: ['ALL_KEYS', 'space', 'enter', 'escape'] },
                    prompt: { type: 'string', default: '' },
                    stimulus_duration: { type: 'number', default: null, min: 0, max: 30000 },
                    trial_duration: { type: 'number', default: null, min: 0, max: 60000 },
                    response_ends_trial: { type: 'boolean', default: true }
                },
                data: {
                    type: 'html-keyboard-response',
                    stimulus: 'Eye tracking calibration\n\nWe will briefly calibrate the camera-based eye tracking.\n\nPlease sit comfortably, keep your head still, and look at each dot as it appears.\nPress SPACE while looking at each dot.\n\nPress any key to begin.',
                    choices: 'ALL_KEYS',
                    prompt: '',
                    stimulus_duration: null,
                    trial_duration: null,
                    response_ends_trial: true,
                    data: { plugin_type: 'eye-tracking-calibration-instructions' }
                }
            });
        }

        // Add RDM task-specific components if RDM is selected
        const currentTaskType = document.getElementById('taskType')?.value;
        // Note: RDM components already added above, so no need to add them again here

        return baseComponents;
    }

    /**
     * Create component card element
     */
    createComponentCard(component) {
        const col = document.createElement('div');
        col.className = 'col-md-6 mb-3';
        
        col.innerHTML = `
            <div class="component-card" data-component-id="${component.id}">
                <div class="icon">
                    <i class="${component.icon}"></i>
                </div>
                <div class="title">${component.name}</div>
                <div class="description">${component.description}</div>
                <div class="mt-2">
                    <span class="badge bg-secondary">${component.category}</span>
                </div>
            </div>
        `;
        
        // Add click handler
        col.querySelector('.component-card').addEventListener('click', () => {
            this.addComponentToTimeline(component);
        });
        
        return col;
    }

    /**
     * Show component library modal
     */
    showComponentLibrary() {
        const modal = new bootstrap.Modal(document.getElementById('componentLibraryModal'));
        modal.show();
    }

    /**
     * Add component to timeline
     */
    addComponentToTimeline(componentDef) {
        // Get timeline container
        const timelineContainer = document.getElementById('timelineComponents');
        if (!timelineContainer) {
            console.error('Timeline container not found');
            return;
        }
        
        // For html-keyboard-response instructions-like components, use simple data format like the Figma prototype.
        if (componentDef.id === 'instructions' || componentDef.id === 'eye-tracking-calibration-instructions') {
            // Hide empty state if visible
            const emptyState = timelineContainer.querySelector('.empty-timeline');
            if (emptyState) {
                emptyState.style.display = 'none';
            }
            
            const instructionsComponent = document.createElement('div');
            instructionsComponent.className = 'timeline-component card mb-2';
            instructionsComponent.dataset.componentType = 'html-keyboard-response';
            // Preserve the builder-specific identity even though the exported jsPsych type is html-keyboard-response.
            // This lets the UI distinguish calibration preface vs generic instructions reliably.
            instructionsComponent.dataset.builderComponentId = componentDef.id;
            const instructionsData = {
                ...(componentDef.data || {}),
                // Default Instructions cards should follow the auto-generated template until a human edits them.
                // Calibration preface instructions should not be auto-templated.
                auto_generated: componentDef.id === 'instructions'
                    ? !!(componentDef.data?.auto_generated ?? true)
                    : false
            };
            instructionsComponent.dataset.componentData = JSON.stringify(instructionsData);

            const title = (componentDef.id === 'eye-tracking-calibration-instructions')
                ? 'Calibration Instructions'
                : 'Instructions';
            const subtitle = (componentDef.id === 'eye-tracking-calibration-instructions')
                ? 'Preface shown before eye-tracking calibration'
                : 'Welcome screen with task instructions';
            const iconHtml = (componentDef.id === 'eye-tracking-calibration-instructions')
                ? '<i class="fas fa-eye text-info"></i>'
                : '<i class="fas fa-info-circle text-info"></i>';
            
            instructionsComponent.innerHTML = `
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-center">
                        <div class="d-flex align-items-center">
                            <div class="drag-handle me-2" style="cursor: move; color: #ccc;">
                                <i class="fas fa-grip-vertical"></i>
                            </div>
                            <div>
                                <h6 class="card-title mb-1">
                                    ${iconHtml} ${title}
                                </h6>
                                <small class="text-muted cf-component-label">${subtitle}</small>
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
            
            timelineContainer.appendChild(instructionsComponent);
            
            // Don't call renderTimeline() to avoid clearing existing components
        } else {
            // For other components, also create DOM elements directly instead of using timeline array
            // This prevents clearing existing components
            const componentElement = document.createElement('div');
            componentElement.className = 'timeline-component card mb-2';
            componentElement.dataset.componentType = componentDef.id;
            
            // Store component data
            const componentData = {
                type: componentDef.id,
                name: componentDef.name,
                ...this.getDefaultParameters(componentDef.parameters || {})
            };

            // Apply task-level defaults to new components (so the settings panel actually matters).
            if (componentDef.id === 'flanker-trial') {
                Object.assign(componentData, this.getFlankerDefaultsForNewComponent());
            }

            if (componentDef.id === 'stroop-trial') {
                Object.assign(componentData, this.getStroopDefaultsForNewComponent());
            }

            if (componentDef.id === 'emotional-stroop-trial') {
                Object.assign(componentData, this.getEmotionalStroopDefaultsForNewComponent());
            }

            if (componentDef.id === 'simon-trial') {
                Object.assign(componentData, this.getSimonDefaultsForNewComponent());
            }

            if (componentDef.id === 'task-switching-trial') {
                Object.assign(componentData, this.getTaskSwitchingDefaultsForNewComponent());
            }

            if (componentDef.id === 'pvt-trial') {
                Object.assign(componentData, this.getPvtDefaultsForNewComponent());
            }

            if (componentDef.id === 'mot-trial') {
                Object.assign(componentData, this.getMotDefaultsForNewComponent());
            }

            if (componentDef.id === 'gabor-trial') {
                Object.assign(componentData, this.getGaborDefaultsForNewComponent());
            }

            if (componentDef.id === 'continuous-image-presentation') {
                Object.assign(componentData, this.getContinuousImageDefaultsForNewComponent());
            }

            if (componentDef.id === 'soc-dashboard') {
                Object.assign(componentData, this.getSocDashboardDefaultsForNewComponent());
            }

            if (componentDef.id === 'nback-trial-sequence') {
                Object.assign(componentData, this.getNbackDefaultsForNewSequence());
            }

            if (componentDef.id === 'block') {
                const currentTaskType = document.getElementById('taskType')?.value || 'rdm';
                if (currentTaskType === 'gabor') {
                    Object.assign(componentData, this.getGaborDefaultsForNewBlock());
                }
                if (currentTaskType === 'continuous-image') {
                    Object.assign(componentData, this.getContinuousImageDefaultsForNewBlock());
                }
                if (currentTaskType === 'stroop') {
                    Object.assign(componentData, this.getStroopDefaultsForNewBlock());
                }
                if (currentTaskType === 'emotional-stroop') {
                    Object.assign(componentData, this.getEmotionalStroopDefaultsForNewBlock());
                }
                if (currentTaskType === 'simon') {
                    Object.assign(componentData, this.getSimonDefaultsForNewBlock());
                }
                if (currentTaskType === 'task-switching') {
                    Object.assign(componentData, this.getTaskSwitchingDefaultsForNewBlock());
                }
                if (currentTaskType === 'pvt') {
                    Object.assign(componentData, this.getPvtDefaultsForNewBlock());
                }
                if (currentTaskType === 'mot') {
                    Object.assign(componentData, this.getMotDefaultsForNewBlock());
                }
                if (currentTaskType === 'nback') {
                    Object.assign(componentData, this.getNbackDefaultsForNewBlock());
                }
            }

            componentElement.dataset.componentData = JSON.stringify(componentData);
            
            componentElement.innerHTML = `
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-center">
                        <div class="d-flex align-items-center">
                            <div class="drag-handle me-2" style="cursor: move; color: #ccc;">
                                <i class="fas fa-grip-vertical"></i>
                            </div>
                            <div>
                                <h6 class="card-title mb-1">
                                    <i class="${componentDef.icon} text-primary"></i> ${componentDef.name}
                                </h6>
                                <small class="text-muted cf-component-label">${componentDef.description}</small>
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
            
            timelineContainer.appendChild(componentElement);
            
            // Hide empty state if visible
            const emptyState = timelineContainer.querySelector('.empty-timeline');
            if (emptyState) {
                emptyState.style.display = 'none';
            }
        }
        
        this.updateJSON();

        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('componentLibraryModal'));
        if (modal) modal.hide();
    }

    /**
     * Get default parameter values
     */
    getDefaultParameters(parameterDefs) {
        const params = {};

        const cloneDefault = (value) => {
            if (!value || typeof value !== 'object') return value;
            try {
                // Modern browsers
                return structuredClone(value);
            } catch {
                // Fallback for plain JSON-able objects
                try {
                    return JSON.parse(JSON.stringify(value));
                } catch {
                    return value;
                }
            }
        };

        for (const [key, def] of Object.entries(parameterDefs)) {
            params[key] = cloneDefault(def.default);
        }
        return params;
    }

    /**
     * Clear timeline
     */
    clearTimeline() {
        if (confirm('Are you sure you want to clear the entire timeline?')) {
            try {
                const assetCache = window.CogFlowAssetCache || window.PsychJsonAssetCache;
                if (assetCache && typeof assetCache.clearAll === 'function') {
                    assetCache.clearAll();
                }
            } catch {
                // ignore
            }
            this.timeline = [];
            this.componentCounter = 0;
            this.timelineBuilder.renderTimeline();
            this.updateJSON();
        }
    }

    /**
     * Update JSON preview
     */
    updateJSON() {
        // Update any dynamic instructions components
        if (typeof updateInstructionsComponents === 'function') {
            updateInstructionsComponents();
        }
        
        const json = this.generateJSON();
        const formatted = JSON.stringify(json, null, 2);
        const highlighted = this.highlightJSON(formatted);
        
        document.getElementById('jsonOutput').innerHTML = highlighted;
    }

    /**
     * Generate JSON configuration
     */
    generateJSON() {
        const taskType = document.getElementById('taskType')?.value || 'rdm';
        const theme = (document.getElementById('experimentTheme')?.value || 'dark').toString();
        const rewardsEnabled = !!document.getElementById('rewardsEnabled')?.checked;
        const config = {
            experiment_type: this.experimentType,
            task_type: taskType,
            data_collection: { ...this.dataCollection },
            ui_settings: {
                theme: (theme === 'light') ? 'light' : 'dark'
            },
            reward_settings: {
                enabled: rewardsEnabled
            },
            timeline: this.getTimelineFromDOM()
        };

        // Add task-specific defaults
        if (taskType === 'rdm') {
            config.display_parameters = this.getRDMDisplayParameters();
            config.aperture_parameters = this.getRDMApertureParameters();
            config.dot_parameters = this.getRDMDotParameters();
            config.motion_parameters = this.getRDMMotionParameters();
            config.timing_parameters = this.getRDMTimingParameters();
            config.response_parameters = this.getRDMResponseParameters();
        }

        // Add experimental control parameters to match Figma prototype
        config.frame_rate = 60;
        config.duration = 30;
        config.update_interval = 1000;

        // Add experiment-specific parameters
        if (this.experimentType === 'trial-based') {
            const numTrials = document.getElementById('numTrials')?.value;
            const iti = document.getElementById('iti')?.value;
            const randomizeOrder = document.getElementById('randomizeOrder')?.checked;
            
            if (numTrials) config.num_trials = parseInt(numTrials);
            if (iti) config.default_iti = parseInt(iti);
            if (randomizeOrder !== undefined) config.randomize_order = randomizeOrder;
        } else if (this.experimentType === 'continuous') {
            const frameRate = document.getElementById('frameRate')?.value;
            const duration = document.getElementById('duration')?.value;
            const updateInterval = document.getElementById('updateInterval')?.value;
            
            if (frameRate) config.frame_rate = parseInt(frameRate);
            if (duration) config.duration = parseInt(duration);
            if (updateInterval) config.update_interval = parseInt(updateInterval);

            // Continuous-mode default transitions (applied to timeline components if not overridden)
            const defaultTransitionDuration = document.getElementById('defaultTransitionDuration')?.value;
            const defaultTransitionType = document.getElementById('defaultTransitionType')?.value;
            if (defaultTransitionDuration !== undefined || defaultTransitionType !== undefined) {
                config.transition_settings = {
                    duration_ms: defaultTransitionDuration ? parseInt(defaultTransitionDuration) : 0,
                    type: defaultTransitionType || 'both'
                };
            }
        }

        // Export task-specific experiment-wide settings
        if (taskType === 'rdm') {
            const canvasWidth = document.getElementById('canvasWidth')?.value;
            const canvasHeight = document.getElementById('canvasHeight')?.value;
            const backgroundColor = document.getElementById('backgroundColor')?.value;
            const fixationDuration = document.getElementById('fixationDuration')?.value;
            const responseKeys = document.getElementById('responseKeys')?.value;

            if (canvasWidth || canvasHeight || backgroundColor) {
                config.display_settings = {
                    canvas_width: canvasWidth ? parseInt(canvasWidth) : 600,
                    canvas_height: canvasHeight ? parseInt(canvasHeight) : 600,
                    background_color: backgroundColor || '#404040'
                };
            }

            if (fixationDuration) {
                config.fixation_duration = parseInt(fixationDuration);
            }

            // Only export response keys when the default response device is keyboard.
            const defaultDevice = document.getElementById('defaultResponseDevice')?.value || 'keyboard';
            if (defaultDevice === 'keyboard' && responseKeys) {
                config.response_keys = responseKeys.split(',').map(key => key.trim());
            }
        }

        if (taskType === 'flanker') {
            const leftKey = document.getElementById('flankerLeftKey')?.value;
            const rightKey = document.getElementById('flankerRightKey')?.value;
            const stimulusDuration = document.getElementById('flankerStimulusDurationMs')?.value;
            const trialDuration = document.getElementById('flankerTrialDurationMs')?.value;
            const itiMs = document.getElementById('flankerItiMs')?.value;

            config.flanker_settings = {
                left_key: leftKey || 'f',
                right_key: rightKey || 'j',
                stimulus_type: document.getElementById('flankerStimulusType')?.value || 'arrows',
                target_stimulus: document.getElementById('flankerTargetStimulus')?.value || 'H',
                distractor_stimulus: document.getElementById('flankerDistractorStimulus')?.value || 'S',
                neutral_stimulus: document.getElementById('flankerNeutralStimulus')?.value || '–',
                show_fixation_dot: !!document.getElementById('flankerShowFixationDot')?.checked,
                show_fixation_cross_between_trials: !!document.getElementById('flankerShowFixationCrossBetweenTrials')?.checked,
                stimulus_duration_ms: stimulusDuration ? parseInt(stimulusDuration) : 800,
                trial_duration_ms: trialDuration ? parseInt(trialDuration) : 1500,
                iti_ms: itiMs ? parseInt(itiMs) : 500
            };
        }

        if (taskType === 'sart') {
            const goKey = document.getElementById('sartGoKey')?.value;
            const nogoDigit = document.getElementById('sartNoGoDigit')?.value;
            const stimulusDuration = document.getElementById('sartStimulusDurationMs')?.value;
            const maskDuration = document.getElementById('sartMaskDurationMs')?.value;
            const itiMs = document.getElementById('sartItiMs')?.value;

            config.sart_settings = {
                go_key: goKey || 'space',
                nogo_digit: nogoDigit !== undefined && nogoDigit !== null && `${nogoDigit}` !== '' ? parseInt(nogoDigit) : 3,
                stimulus_duration_ms: stimulusDuration ? parseInt(stimulusDuration) : 250,
                mask_duration_ms: maskDuration ? parseInt(maskDuration) : 900,
                iti_ms: itiMs ? parseInt(itiMs) : 0
            };
        }

        if (taskType === 'gabor') {
            const parseStringList = (raw) => {
                if (raw === undefined || raw === null) return [];
                return raw
                    .toString()
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean);
            };

            const responseTask = document.getElementById('gaborResponseTask')?.value || 'discriminate_tilt';
            const leftKey = document.getElementById('gaborLeftKey')?.value || 'f';
            const rightKey = document.getElementById('gaborRightKey')?.value || 'j';
            const yesKey = document.getElementById('gaborYesKey')?.value || 'f';
            const noKey = document.getElementById('gaborNoKey')?.value || 'j';

            const highValueColor = document.getElementById('gaborHighValueColor')?.value || '#00aa00';
            const lowValueColor = document.getElementById('gaborLowValueColor')?.value || '#0066ff';

            const spatialCueValidityRaw = document.getElementById('gaborSpatialCueValidity')?.value;
            const spatialCueValidity = (spatialCueValidityRaw !== undefined && spatialCueValidityRaw !== null && `${spatialCueValidityRaw}` !== '')
                ? parseFloat(spatialCueValidityRaw)
                : 0.8;

            const spatialCueEnabled = !!document.getElementById('gaborSpatialCueEnabled')?.checked;
            const spatialCueOptions = parseStringList(document.getElementById('gaborSpatialCueOptions')?.value || 'none,left,right,both');
            const spatialCueProbRaw = document.getElementById('gaborSpatialCueProbability')?.value;
            const spatialCueProb = (spatialCueProbRaw !== undefined && spatialCueProbRaw !== null && `${spatialCueProbRaw}` !== '')
                ? parseFloat(spatialCueProbRaw)
                : 1;

            const valueCueEnabled = !!document.getElementById('gaborValueCueEnabled')?.checked;
            const leftValueOptions = parseStringList(document.getElementById('gaborLeftValueOptions')?.value || 'neutral,high,low');
            const rightValueOptions = parseStringList(document.getElementById('gaborRightValueOptions')?.value || 'neutral,high,low');
            const valueCueProbRaw = document.getElementById('gaborValueCueProbability')?.value;
            const valueCueProb = (valueCueProbRaw !== undefined && valueCueProbRaw !== null && `${valueCueProbRaw}` !== '')
                ? parseFloat(valueCueProbRaw)
                : 1;

            const fixationMsRaw = document.getElementById('gaborFixationMs')?.value;
            const placeholdersMsRaw = document.getElementById('gaborPlaceholdersMs')?.value;
            const cueMsRaw = document.getElementById('gaborCueMs')?.value;
            const cueDelayMinRaw = document.getElementById('gaborCueDelayMinMs')?.value;
            const cueDelayMaxRaw = document.getElementById('gaborCueDelayMaxMs')?.value;
            const stimMsRaw = document.getElementById('gaborStimulusDurationMs')?.value;
            const maskMsRaw = document.getElementById('gaborMaskDurationMs')?.value;

            const spatialFreqRaw = document.getElementById('gaborSpatialFrequency')?.value;
            const spatialFreq = (spatialFreqRaw !== undefined && spatialFreqRaw !== null && `${spatialFreqRaw}` !== '')
                ? parseFloat(spatialFreqRaw)
                : 0.06;
            const waveform = (document.getElementById('gaborGratingWaveform')?.value || 'sinusoidal').toString();

            const patchDiameterDegRaw = document.getElementById('gaborPatchDiameterDeg')?.value;
            const patchDiameterDeg = (patchDiameterDegRaw !== undefined && patchDiameterDegRaw !== null && `${patchDiameterDegRaw}` !== '')
                ? parseFloat(patchDiameterDegRaw)
                : 6;

            const patchBorderEnabled = !!document.getElementById('gaborPatchBorderEnabled')?.checked;
            const patchBorderWidthRaw = document.getElementById('gaborPatchBorderWidthPx')?.value;
            const patchBorderWidth = (patchBorderWidthRaw !== undefined && patchBorderWidthRaw !== null && `${patchBorderWidthRaw}` !== '')
                ? Number.parseInt(patchBorderWidthRaw, 10)
                : 2;
            const patchBorderColor = (document.getElementById('gaborPatchBorderColor')?.value || '#ffffff').toString();
            const patchBorderOpacityRaw = document.getElementById('gaborPatchBorderOpacity')?.value;
            const patchBorderOpacity = (patchBorderOpacityRaw !== undefined && patchBorderOpacityRaw !== null && `${patchBorderOpacityRaw}` !== '')
                ? Number.parseFloat(patchBorderOpacityRaw)
                : 0.22;

            config.gabor_settings = {
                response_task: responseTask,
                left_key: leftKey,
                right_key: rightKey,
                yes_key: yesKey,
                no_key: noKey,

                high_value_color: highValueColor,
                low_value_color: lowValueColor,

                spatial_frequency_cyc_per_px: Number.isFinite(spatialFreq) ? spatialFreq : 0.06,
                grating_waveform: waveform,

                patch_diameter_deg: Number.isFinite(patchDiameterDeg) ? Math.max(0.1, patchDiameterDeg) : 6,

                patch_border_enabled: patchBorderEnabled,
                patch_border_width_px: Number.isFinite(patchBorderWidth) ? Math.max(0, Math.min(50, patchBorderWidth)) : 2,
                patch_border_color: patchBorderColor,
                patch_border_opacity: Number.isFinite(patchBorderOpacity) ? Math.max(0, Math.min(1, patchBorderOpacity)) : 0.22,

                spatial_cue_validity: Number.isFinite(spatialCueValidity) ? spatialCueValidity : 0.8,

                spatial_cue_enabled: spatialCueEnabled,
                spatial_cue_probability: Number.isFinite(spatialCueProb) ? Math.max(0, Math.min(1, spatialCueProb)) : 1,
                spatial_cue_options: Array.isArray(spatialCueOptions) ? spatialCueOptions : ['none', 'left', 'right', 'both'],

                value_cue_enabled: valueCueEnabled,
                value_cue_probability: Number.isFinite(valueCueProb) ? Math.max(0, Math.min(1, valueCueProb)) : 1,
                left_value_options: Array.isArray(leftValueOptions) ? leftValueOptions : ['neutral', 'high', 'low'],
                right_value_options: Array.isArray(rightValueOptions) ? rightValueOptions : ['neutral', 'high', 'low'],

                fixation_ms: fixationMsRaw ? parseInt(fixationMsRaw) : 1000,
                placeholders_ms: placeholdersMsRaw ? parseInt(placeholdersMsRaw) : 400,
                cue_ms: cueMsRaw ? parseInt(cueMsRaw) : 300,
                cue_delay_min_ms: cueDelayMinRaw ? parseInt(cueDelayMinRaw) : 100,
                cue_delay_max_ms: cueDelayMaxRaw ? parseInt(cueDelayMaxRaw) : 200,
                stimulus_duration_ms: stimMsRaw ? parseInt(stimMsRaw) : 67,
                mask_duration_ms: maskMsRaw ? parseInt(maskMsRaw) : 67
            };
        }

        if (taskType === 'continuous-image') {
            const d = this.getCurrentContinuousImageDefaults();
            config.continuous_image_settings = {
                mask_type: d.mask_type,
                image_duration_ms: d.image_duration_ms,
                transition_duration_ms: d.transition_duration_ms,
                transition_frames: d.transition_frames,
                choice_keys: d.choice_keys
            };
        }

        if (taskType === 'stroop') {
            const stimuli = this.getCurrentStroopStimuliFromUI();
            const n = Array.isArray(stimuli) ? stimuli.length : 0;

            const responseMode = (document.getElementById('stroopDefaultResponseMode')?.value || 'color_naming').toString();
            const responseDevice = (document.getElementById('stroopDefaultResponseDevice')?.value || 'keyboard').toString();

            const choiceKeys = this.parseStroopChoiceKeysFromUI(Math.max(2, n));
            const congruentKey = (document.getElementById('stroopCongruentKey')?.value || 'f').toString();
            const incongruentKey = (document.getElementById('stroopIncongruentKey')?.value || 'j').toString();

            const fontSizePx = Number.parseInt(document.getElementById('stroopStimulusFontSizePx')?.value || '64', 10);
            const stimMs = Number.parseInt(document.getElementById('stroopStimulusDurationMs')?.value || '0', 10);
            const trialMs = Number.parseInt(document.getElementById('stroopTrialDurationMs')?.value || '2000', 10);
            const itiMs = Number.parseInt(document.getElementById('stroopItiMs')?.value || '500', 10);

            config.stroop_settings = {
                stimuli: Array.isArray(stimuli) ? stimuli : [],
                response_mode: responseMode,
                response_device: responseDevice,

                choice_keys: choiceKeys,
                congruent_key: congruentKey,
                incongruent_key: incongruentKey,

                stimulus_font_size_px: Number.isFinite(fontSizePx) ? fontSizePx : 64,
                stimulus_duration_ms: Number.isFinite(stimMs) ? stimMs : 0,
                trial_duration_ms: Number.isFinite(trialMs) ? trialMs : 2000,
                iti_ms: Number.isFinite(itiMs) ? itiMs : 500
            };
        }

        if (taskType === 'emotional-stroop') {
            const stimuli = this.getCurrentStroopStimuliFromUI();
            const n = Array.isArray(stimuli) ? stimuli.length : 0;

            const parsed = this.parseEmotionalStroopWordListsFromUI();
            const wordListCount = (parsed?.word_list_count === 3 ? 3 : 2);
            const wordLists = Array.isArray(parsed?.word_lists) ? parsed.word_lists : [];
            const wordOptions = Array.isArray(parsed?.word_options) ? parsed.word_options : this.parseEmotionalStroopWordOptionsFromUI();
            const responseDevice = (document.getElementById('stroopDefaultResponseDevice')?.value || 'keyboard').toString();
            const choiceKeys = this.parseStroopChoiceKeysFromUI(Math.max(2, n));

            const fontSizePx = Number.parseInt(document.getElementById('stroopStimulusFontSizePx')?.value || '64', 10);
            const stimMs = Number.parseInt(document.getElementById('stroopStimulusDurationMs')?.value || '0', 10);
            const trialMs = Number.parseInt(document.getElementById('stroopTrialDurationMs')?.value || '2000', 10);
            const itiMs = Number.parseInt(document.getElementById('stroopItiMs')?.value || '500', 10);

            config.emotional_stroop_settings = {
                word_list_count: wordListCount,
                word_lists: wordLists,
                // Convenience / legacy shape
                word_options: Array.isArray(wordOptions) ? wordOptions : [],
                stimuli: Array.isArray(stimuli) ? stimuli : [],

                response_mode: 'color_naming',
                response_device: responseDevice,
                choice_keys: choiceKeys,

                stimulus_font_size_px: Number.isFinite(fontSizePx) ? fontSizePx : 64,
                stimulus_duration_ms: Number.isFinite(stimMs) ? stimMs : 0,
                trial_duration_ms: Number.isFinite(trialMs) ? trialMs : 2000,
                iti_ms: Number.isFinite(itiMs) ? itiMs : 500
            };
        }

        if (taskType === 'simon') {
            const stimuli = this.getCurrentSimonStimuliFromUI();

            const responseDevice = (document.getElementById('simonDefaultResponseDevice')?.value || 'keyboard').toString();
            const leftKey = (document.getElementById('simonLeftKey')?.value || 'f').toString();
            const rightKey = (document.getElementById('simonRightKey')?.value || 'j').toString();

            const circleDiameterPx = Number.parseInt(document.getElementById('simonCircleDiameterPx')?.value || '140', 10);

            const stimMs = Number.parseInt(document.getElementById('simonStimulusDurationMs')?.value || '0', 10);
            const trialMs = Number.parseInt(document.getElementById('simonTrialDurationMs')?.value || '1500', 10);
            const itiMs = Number.parseInt(document.getElementById('simonItiMs')?.value || '500', 10);

            config.simon_settings = {
                stimuli: Array.isArray(stimuli) ? stimuli : [],
                response_device: responseDevice,
                left_key: leftKey,
                right_key: rightKey,
                circle_diameter_px: Number.isFinite(circleDiameterPx) ? circleDiameterPx : 140,
                stimulus_duration_ms: Number.isFinite(stimMs) ? stimMs : 0,
                trial_duration_ms: Number.isFinite(trialMs) ? trialMs : 1500,
                iti_ms: Number.isFinite(itiMs) ? itiMs : 500
            };
        }

        if (taskType === 'task-switching') {
            const parseStringList = (raw) => {
                return (raw ?? '')
                    .toString()
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean);
            };

            const safeInt = (raw, fallback) => {
                const v = Number.parseInt(raw, 10);
                return Number.isFinite(v) ? v : fallback;
            };

            const mode = (document.getElementById('taskSwitchingStimulusSetMode')?.value || 'letters_numbers').toString();
            const leftKey = (document.getElementById('taskSwitchingLeftKey')?.value || 'f').toString();
            const rightKey = (document.getElementById('taskSwitchingRightKey')?.value || 'j').toString();
            const position = (document.getElementById('taskSwitchingStimulusPosition')?.value || 'top').toString();
            const borderEnabled = !!document.getElementById('taskSwitchingBorderEnabled')?.checked;

            const cueTypeRaw = (document.getElementById('taskSwitchingCueType')?.value || 'explicit').toString().trim();
            const cueType = (cueTypeRaw === 'position' || cueTypeRaw === 'color' || cueTypeRaw === 'explicit') ? cueTypeRaw : 'explicit';
            const task1CueText = (document.getElementById('taskSwitchingTask1CueText')?.value || 'LETTERS').toString();
            const task2CueText = (document.getElementById('taskSwitchingTask2CueText')?.value || 'NUMBERS').toString();
            const cueFontSizePx = safeInt(document.getElementById('taskSwitchingCueFontSizePx')?.value, 28);
            const cueDurationMs = safeInt(document.getElementById('taskSwitchingCueDurationMs')?.value, 0);
            const cueGapMs = safeInt(document.getElementById('taskSwitchingCueGapMs')?.value, 0);
            const cueColorHex = (document.getElementById('taskSwitchingCueColorHex')?.value || '#FFFFFF').toString();

            const task1Pos = (document.getElementById('taskSwitchingTask1Position')?.value || 'left').toString();
            const task2Pos = (document.getElementById('taskSwitchingTask2Position')?.value || 'right').toString();
            const task1ColorHex = (document.getElementById('taskSwitchingTask1ColorHex')?.value || '#FFFFFF').toString();
            const task2ColorHex = (document.getElementById('taskSwitchingTask2ColorHex')?.value || '#FFFFFF').toString();

            const task1A = parseStringList(document.getElementById('taskSwitchingTask1CategoryA')?.value);
            const task1B = parseStringList(document.getElementById('taskSwitchingTask1CategoryB')?.value);
            const task2A = parseStringList(document.getElementById('taskSwitchingTask2CategoryA')?.value);
            const task2B = parseStringList(document.getElementById('taskSwitchingTask2CategoryB')?.value);

            config.task_switching_settings = {
                stimulus_set_mode: (mode === 'custom') ? 'custom' : 'letters_numbers',
                stimulus_position: position,
                border_enabled: borderEnabled,
                left_key: leftKey,
                right_key: rightKey,

                cue_type: cueType,
                task_1_cue_text: task1CueText,
                task_2_cue_text: task2CueText,
                cue_font_size_px: cueFontSizePx,
                cue_duration_ms: cueDurationMs,
                cue_gap_ms: cueGapMs,
                cue_color_hex: cueColorHex,

                task_1_position: task1Pos,
                task_2_position: task2Pos,
                task_1_color_hex: task1ColorHex,
                task_2_color_hex: task2ColorHex,

                tasks: [
                    { category_a_tokens: task1A, category_b_tokens: task1B },
                    { category_a_tokens: task2A, category_b_tokens: task2B }
                ]
            };
        }

        if (taskType === 'pvt') {
            const responseDevice = (document.getElementById('pvtDefaultResponseDevice')?.value || 'keyboard').toString();
            const responseKey = (document.getElementById('pvtResponseKey')?.value || 'space').toString();

            const addTrialPerFalseStart = !!document.getElementById('pvtAddTrialPerFalseStart')?.checked;

            const feedbackEnabled = !!document.getElementById('pvtFeedbackEnabled')?.checked;
            const feedbackMessage = (document.getElementById('pvtFeedbackMessage')?.value || '').toString();

            const foreperiodMs = Number.parseInt(document.getElementById('pvtForeperiodMs')?.value || '4000', 10);
            const trialMs = Number.parseInt(document.getElementById('pvtTrialDurationMs')?.value || '10000', 10);
            const itiMs = Number.parseInt(document.getElementById('pvtItiMs')?.value || '0', 10);

            config.pvt_settings = {
                response_device: responseDevice,
                response_key: responseKey,
                foreperiod_ms: Number.isFinite(foreperiodMs) ? foreperiodMs : 4000,
                trial_duration_ms: Number.isFinite(trialMs) ? trialMs : 10000,
                iti_ms: Number.isFinite(itiMs) ? itiMs : 0,
                feedback_enabled: feedbackEnabled,
                feedback_message: feedbackMessage,
                add_trial_per_false_start: addTrialPerFalseStart
            };
        }

        if (taskType === 'mot') {
            const numObjects = Number.parseInt(document.getElementById('motNumObjectsDefault')?.value || '8', 10);
            const numTargets = Number.parseInt(document.getElementById('motNumTargetsDefault')?.value || '4', 10);
            const speed = Number.parseFloat(document.getElementById('motSpeedDefault')?.value || '150');
            const motionType = (document.getElementById('motMotionTypeDefault')?.value || 'linear').toString();
            const probeMode = (document.getElementById('motProbeModeDefault')?.value || 'click').toString();
            const cueMs = Number.parseInt(document.getElementById('motCueDurationMsDefault')?.value || '2000', 10);
            const trackingMs = Number.parseInt(document.getElementById('motTrackingDurationMsDefault')?.value || '8000', 10);
            const itiMs = Number.parseInt(document.getElementById('motItiMsDefault')?.value || '1000', 10);
            const showFeedback = !!document.getElementById('motShowFeedbackDefault')?.checked;

            config.mot_settings = {
                num_objects: Number.isFinite(numObjects) ? numObjects : 8,
                num_targets: Number.isFinite(numTargets) ? numTargets : 4,
                speed_px_per_s: Number.isFinite(speed) ? speed : 150,
                motion_type: motionType,
                probe_mode: probeMode,
                cue_duration_ms: Number.isFinite(cueMs) ? cueMs : 2000,
                tracking_duration_ms: Number.isFinite(trackingMs) ? trackingMs : 8000,
                iti_ms: Number.isFinite(itiMs) ? itiMs : 1000,
                show_feedback: showFeedback
            };
        }

        if (taskType === 'nback') {
            const safeInt = (raw, fallback) => {
                const v = Number.parseInt(raw, 10);
                return Number.isFinite(v) ? v : fallback;
            };

            const safeFloat01 = (raw, fallback) => {
                const v = Number.parseFloat(raw);
                if (!Number.isFinite(v)) return fallback;
                return Math.max(0, Math.min(1, v));
            };

            const renderMode = (document.getElementById('nbackDefaultRenderMode')?.value || 'token').toString();
            const responseDevice = (document.getElementById('nbackDefaultDevice')?.value || 'keyboard').toString();

            config.nback_settings = {
                n: safeInt(document.getElementById('nbackDefaultN')?.value, 2),
                seed: (document.getElementById('nbackDefaultSeed')?.value || '').toString(),

                stimulus_mode: (document.getElementById('nbackDefaultStimulusMode')?.value || 'letters').toString(),
                stimulus_pool: (document.getElementById('nbackDefaultStimulusPool')?.value || '').toString(),
                target_probability: safeFloat01(document.getElementById('nbackDefaultTargetProb')?.value, 0.25),

                render_mode: renderMode,
                ...(renderMode === 'custom_html'
                    ? { stimulus_template_html: (document.getElementById('nbackDefaultTemplateHtml')?.value || '').toString() }
                    : {}),

                stimulus_duration_ms: safeInt(document.getElementById('nbackDefaultStimulusMs')?.value, 500),
                isi_duration_ms: safeInt(document.getElementById('nbackDefaultIsiMs')?.value, 700),
                trial_duration_ms: safeInt(document.getElementById('nbackDefaultTrialMs')?.value, 1200),

                show_fixation_cross_between_trials: !!document.getElementById('nbackDefaultShowFixationCrossBetweenTrials')?.checked,

                response_paradigm: (document.getElementById('nbackDefaultParadigm')?.value || 'go_nogo').toString(),
                response_device: responseDevice,
                go_key: (document.getElementById('nbackDefaultGoKey')?.value || 'space').toString(),
                match_key: (document.getElementById('nbackDefaultMatchKey')?.value || 'j').toString(),
                nonmatch_key: (document.getElementById('nbackDefaultNonmatchKey')?.value || 'f').toString(),
                show_buttons: !!document.getElementById('nbackDefaultShowButtons')?.checked,

                show_feedback: !!document.getElementById('nbackDefaultFeedback')?.checked,
                feedback_duration_ms: safeInt(document.getElementById('nbackDefaultFeedbackMs')?.value, 250)
            };
        }

        if (taskType === 'soc-dashboard') {
            const title = (document.getElementById('socTitle')?.value || 'SOC Dashboard').toString();
            const wallpaperUrl = (document.getElementById('socWallpaperUrl')?.value || '').toString().trim();
            const defaultApp = (document.getElementById('socDefaultApp')?.value || 'soc').toString();

            const durationRaw = document.getElementById('socSessionDurationMs')?.value;
            const durationMs = (durationRaw !== undefined && durationRaw !== null && `${durationRaw}` !== '')
                ? parseInt(durationRaw)
                : 60000;

            const numTasksRaw = document.getElementById('socNumTasks')?.value;
            const numTasks = (numTasksRaw !== undefined && numTasksRaw !== null && `${numTasksRaw}` !== '')
                ? parseInt(numTasksRaw)
                : 1;

            const safeNumTasks = Number.isFinite(numTasks)
                ? Math.max(1, Math.min(4, Math.floor(numTasks)))
                : 1;

            config.soc_dashboard_settings = {
                title,
                wallpaper_url: wallpaperUrl,
                background_color: (document.getElementById('socBackgroundColor')?.value || '#0b1220').toString(),
                default_app: defaultApp,
                num_tasks: safeNumTasks,
                trial_duration_ms: Number.isFinite(durationMs) ? durationMs : 60000,
                end_key: (document.getElementById('socEndKey')?.value || 'escape').toString(),
                icons_clickable: !!document.getElementById('socIconsClickable')?.checked,
                log_icon_clicks: !!document.getElementById('socLogIconClicks')?.checked,
                icon_clicks_are_distractors: !!document.getElementById('socIconClicksAreDistractors')?.checked
            };
        }

        return config;
    }

    /**
     * Build a preview payload for the current Flanker defaults.
     */
    getCurrentFlankerDefaults() {
        return {
            type: 'flanker-trial',
            name: 'Flanker Defaults',
            left_key: document.getElementById('flankerLeftKey')?.value || 'f',
            right_key: document.getElementById('flankerRightKey')?.value || 'j',
            stimulus_type: document.getElementById('flankerStimulusType')?.value || 'arrows',
            target_stimulus: document.getElementById('flankerTargetStimulus')?.value || 'H',
            distractor_stimulus: document.getElementById('flankerDistractorStimulus')?.value || 'S',
            neutral_stimulus: document.getElementById('flankerNeutralStimulus')?.value || '–',
            show_fixation_dot: !!document.getElementById('flankerShowFixationDot')?.checked,
            show_fixation_cross_between_trials: !!document.getElementById('flankerShowFixationCrossBetweenTrials')?.checked,
            target_direction: 'left',
            congruency: 'congruent',
            stimulus_duration_ms: parseInt(document.getElementById('flankerStimulusDurationMs')?.value || '800', 10),
            trial_duration_ms: parseInt(document.getElementById('flankerTrialDurationMs')?.value || '1500', 10),
            iti_ms: parseInt(document.getElementById('flankerItiMs')?.value || '500', 10)
        };
    }

    getFlankerDefaultsForNewComponent() {
        // Defaults panel values; used when adding new Flanker timeline items.
        return {
            stimulus_type: document.getElementById('flankerStimulusType')?.value || 'arrows',
            target_stimulus: document.getElementById('flankerTargetStimulus')?.value || 'H',
            distractor_stimulus: document.getElementById('flankerDistractorStimulus')?.value || 'S',
            neutral_stimulus: document.getElementById('flankerNeutralStimulus')?.value || '–',
            show_fixation_dot: !!document.getElementById('flankerShowFixationDot')?.checked,
            show_fixation_cross_between_trials: !!document.getElementById('flankerShowFixationCrossBetweenTrials')?.checked,
            left_key: document.getElementById('flankerLeftKey')?.value || 'f',
            right_key: document.getElementById('flankerRightKey')?.value || 'j',
            stimulus_duration_ms: parseInt(document.getElementById('flankerStimulusDurationMs')?.value || '800', 10),
            trial_duration_ms: parseInt(document.getElementById('flankerTrialDurationMs')?.value || '1500', 10),
            iti_ms: parseInt(document.getElementById('flankerItiMs')?.value || '500', 10)
        };
    }

    /**
     * Build a preview payload for the current SART defaults.
     */
    getCurrentSartDefaults() {
        return {
            type: 'sart-trial',
            name: 'SART Defaults',
            digit: 1,
            nogo_digit: parseInt(document.getElementById('sartNoGoDigit')?.value || '3', 10),
            go_key: document.getElementById('sartGoKey')?.value || 'space',
            stimulus_duration_ms: parseInt(document.getElementById('sartStimulusDurationMs')?.value || '250', 10),
            mask_duration_ms: parseInt(document.getElementById('sartMaskDurationMs')?.value || '900', 10),
            trial_duration_ms: 1150,
            iti_ms: parseInt(document.getElementById('sartItiMs')?.value || '0', 10)
        };
    }

    getCurrentStroopStimuliFromUI() {
        const sizeEl = document.getElementById('stroopStimulusSetSize');
        const rawN = Number.parseInt(sizeEl?.value || '4', 10);
        const n = Number.isFinite(rawN) ? Math.max(2, Math.min(7, rawN)) : 4;

        const fallback = [
            { name: 'RED', color: '#ff0000' },
            { name: 'GREEN', color: '#00aa00' },
            { name: 'BLUE', color: '#0066ff' },
            { name: 'YELLOW', color: '#ffd200' },
            { name: 'PURPLE', color: '#7a3cff' },
            { name: 'ORANGE', color: '#ff7a00' },
            { name: 'PINK', color: '#ff3c8f' }
        ];

        const stimuli = [];
        for (let i = 1; i <= n; i += 1) {
            const nameRaw = document.getElementById(`stroopStimulusName_${i}`)?.value;
            const colorRaw = document.getElementById(`stroopStimulusColor_${i}`)?.value;

            const name = (nameRaw ?? fallback[i - 1]?.name ?? `COLOR_${i}`).toString().trim();
            const color = (colorRaw ?? fallback[i - 1]?.color ?? '#ffffff').toString().trim();
            stimuli.push({ name, color });
        }

        return stimuli;
    }

    getCurrentSimonStimuliFromUI() {
        const fallback = [
            { name: 'BLUE', color: '#0066ff' },
            { name: 'ORANGE', color: '#ff7a00' }
        ];

        const n1 = (document.getElementById('simonStimulusName_1')?.value ?? fallback[0].name).toString().trim() || fallback[0].name;
        const c1 = (document.getElementById('simonStimulusColor_1')?.value ?? fallback[0].color).toString().trim() || fallback[0].color;
        const n2 = (document.getElementById('simonStimulusName_2')?.value ?? fallback[1].name).toString().trim() || fallback[1].name;
        const c2 = (document.getElementById('simonStimulusColor_2')?.value ?? fallback[1].color).toString().trim() || fallback[1].color;

        return [
            { name: n1, color: c1 },
            { name: n2, color: c2 }
        ];
    }

    parseStroopChoiceKeysFromUI(stimulusCount) {
        const raw = document.getElementById('stroopChoiceKeys')?.value;
        const keys = (raw ?? '')
            .toString()
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        if (keys.length >= stimulusCount) return keys.slice(0, stimulusCount);

        // Fill up with 1..N if missing
        const out = keys.slice();
        for (let i = out.length + 1; i <= stimulusCount; i += 1) {
            out.push(`${i}`);
        }
        return out;
    }

    parseEmotionalStroopWordOptionsFromUI() {
        // Back-compat helper: return a single flattened list of all word lists.
        // Prefer the word-list UI when present.
        const parsed = this.parseEmotionalStroopWordListsFromUI();
        if (parsed && Array.isArray(parsed.word_options)) return parsed.word_options;

        const raw = document.getElementById('emotionalStroopWordList1Words')?.value;
        return (raw ?? '')
            .toString()
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
    }

    parseEmotionalStroopWordListsFromUI() {
        const parseList = (raw) => {
            return (raw ?? '')
                .toString()
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
        };

        const countRaw = Number.parseInt(document.getElementById('emotionalStroopWordListCount')?.value || '2', 10);
        const count = Number.isFinite(countRaw) ? (countRaw === 3 ? 3 : 2) : 2;

        const lists = [];
        const l1Label = (document.getElementById('emotionalStroopWordList1Label')?.value || 'Neutral').toString().trim() || 'Neutral';
        const l1Words = parseList(document.getElementById('emotionalStroopWordList1Words')?.value);
        lists.push({ label: l1Label, words: l1Words });

        const l2Label = (document.getElementById('emotionalStroopWordList2Label')?.value || 'Negative').toString().trim() || 'Negative';
        const l2Words = parseList(document.getElementById('emotionalStroopWordList2Words')?.value);
        lists.push({ label: l2Label, words: l2Words });

        if (count === 3) {
            const l3Label = (document.getElementById('emotionalStroopWordList3Label')?.value || 'Positive').toString().trim() || 'Positive';
            const l3Words = parseList(document.getElementById('emotionalStroopWordList3Words')?.value);
            lists.push({ label: l3Label, words: l3Words });
        }

        const wordOptions = lists.flatMap((l) => Array.isArray(l.words) ? l.words : []).filter(Boolean);

        return {
            word_list_count: count,
            word_lists: lists,
            word_options: Array.from(new Set(wordOptions))
        };
    }

    /**
     * Build a preview payload for the current Stroop defaults.
     */
    getCurrentStroopDefaults() {
        const stimuli = this.getCurrentStroopStimuliFromUI();
        const n = stimuli.length;

        const responseMode = (document.getElementById('stroopDefaultResponseMode')?.value || 'color_naming').toString();
        const responseDevice = (document.getElementById('stroopDefaultResponseDevice')?.value || 'keyboard').toString();

        const choiceKeys = this.parseStroopChoiceKeysFromUI(n);
        const congruentKey = (document.getElementById('stroopCongruentKey')?.value || 'f').toString();
        const incongruentKey = (document.getElementById('stroopIncongruentKey')?.value || 'j').toString();

        const fontSizePx = Number.parseInt(document.getElementById('stroopStimulusFontSizePx')?.value || '64', 10);
        const stimMs = Number.parseInt(document.getElementById('stroopStimulusDurationMs')?.value || '0', 10);
        const trialMs = Number.parseInt(document.getElementById('stroopTrialDurationMs')?.value || '2000', 10);
        const itiMs = Number.parseInt(document.getElementById('stroopItiMs')?.value || '500', 10);

        return {
            type: 'stroop-trial',
            name: 'Stroop Defaults',

            word: (stimuli[0]?.name || 'RED').toString(),
            ink_color_name: (stimuli[1]?.name || stimuli[0]?.name || 'BLUE').toString(),
            congruency: 'auto',

            response_mode: responseMode,
            response_device: responseDevice,
            choice_keys: choiceKeys,
            congruent_key: congruentKey,
            incongruent_key: incongruentKey,

            stimulus_font_size_px: Number.isFinite(fontSizePx) ? fontSizePx : 64,
            stimulus_duration_ms: Number.isFinite(stimMs) ? stimMs : 0,
            trial_duration_ms: Number.isFinite(trialMs) ? trialMs : 2000,
            iti_ms: Number.isFinite(itiMs) ? itiMs : 500,

            // Non-standard field: helps preview components that want defaults context.
            stroop_settings: {
                stimuli,
                response_mode: responseMode,
                response_device: responseDevice,
                choice_keys: choiceKeys,
                congruent_key: congruentKey,
                incongruent_key: incongruentKey
            }
        };
    }

    /**
     * Build a preview payload for the current Emotional Stroop defaults.
     */
    getCurrentEmotionalStroopDefaults() {
        const stimuli = this.getCurrentStroopStimuliFromUI();
        const n = stimuli.length;
        const listsParsed = this.parseEmotionalStroopWordListsFromUI();
        const wordLists = listsParsed?.word_lists || [];
        const words = listsParsed?.word_options || [];

        const responseDevice = (document.getElementById('stroopDefaultResponseDevice')?.value || 'keyboard').toString();
        const choiceKeys = this.parseStroopChoiceKeysFromUI(Math.max(2, n));

        const fontSizePx = Number.parseInt(document.getElementById('stroopStimulusFontSizePx')?.value || '64', 10);
        const stimMs = Number.parseInt(document.getElementById('stroopStimulusDurationMs')?.value || '0', 10);
        const trialMs = Number.parseInt(document.getElementById('stroopTrialDurationMs')?.value || '2000', 10);
        const itiMs = Number.parseInt(document.getElementById('stroopItiMs')?.value || '500', 10);

        return {
            type: 'emotional-stroop-trial',
            name: 'Emotional Stroop Defaults',

            word: (words[0] || 'HAPPY').toString(),
            word_list_label: (wordLists[0]?.label || '').toString(),
            word_list_index: 1,
            ink_color_name: (stimuli[0]?.name || 'BLUE').toString(),

            response_mode: 'color_naming',
            response_device: responseDevice,
            choice_keys: choiceKeys,

            stimulus_font_size_px: Number.isFinite(fontSizePx) ? fontSizePx : 64,
            stimulus_duration_ms: Number.isFinite(stimMs) ? stimMs : 0,
            trial_duration_ms: Number.isFinite(trialMs) ? trialMs : 2000,
            iti_ms: Number.isFinite(itiMs) ? itiMs : 500,

            // Non-standard field: helps preview use ink palette context.
            stroop_settings: {
                stimuli,
                response_mode: 'color_naming',
                response_device: responseDevice,
                choice_keys: choiceKeys
            }
        };
    }

    /**
     * Build a preview payload for the current Simon defaults.
     */
    getCurrentSimonDefaults() {
        const stimuli = this.getCurrentSimonStimuliFromUI();

        const responseDevice = (document.getElementById('simonDefaultResponseDevice')?.value || 'keyboard').toString();
        const leftKey = (document.getElementById('simonLeftKey')?.value || 'f').toString();
        const rightKey = (document.getElementById('simonRightKey')?.value || 'j').toString();

        const circleDiameterPx = Number.parseInt(document.getElementById('simonCircleDiameterPx')?.value || '140', 10);

        const stimMs = Number.parseInt(document.getElementById('simonStimulusDurationMs')?.value || '0', 10);
        const trialMs = Number.parseInt(document.getElementById('simonTrialDurationMs')?.value || '1500', 10);
        const itiMs = Number.parseInt(document.getElementById('simonItiMs')?.value || '500', 10);

        return {
            type: 'simon-trial',
            name: 'Simon Defaults',

            stimulus_side: 'left',
            stimulus_color_name: (stimuli[0]?.name || 'BLUE').toString(),

            response_device: responseDevice,
            left_key: leftKey,
            right_key: rightKey,
            circle_diameter_px: Number.isFinite(circleDiameterPx) ? circleDiameterPx : 140,

            stimulus_duration_ms: Number.isFinite(stimMs) ? stimMs : 0,
            trial_duration_ms: Number.isFinite(trialMs) ? trialMs : 1500,
            iti_ms: Number.isFinite(itiMs) ? itiMs : 500,

            // Non-standard field: helps preview components that want defaults context.
            simon_settings: {
                stimuli,
                response_device: responseDevice,
                left_key: leftKey,
                right_key: rightKey,
                circle_diameter_px: Number.isFinite(circleDiameterPx) ? circleDiameterPx : 140
            }
        };
    }

    /**
     * Build a preview payload for the current PVT defaults.
     */
    getCurrentPvtDefaults() {
        const responseDevice = (document.getElementById('pvtDefaultResponseDevice')?.value || 'keyboard').toString();
        const responseKey = (document.getElementById('pvtResponseKey')?.value || 'space').toString();

        const addTrialPerFalseStart = !!document.getElementById('pvtAddTrialPerFalseStart')?.checked;

        const feedbackEnabled = !!document.getElementById('pvtFeedbackEnabled')?.checked;
        const feedbackMessage = (document.getElementById('pvtFeedbackMessage')?.value || '').toString();

        const foreperiodMs = Number.parseInt(document.getElementById('pvtForeperiodMs')?.value || '4000', 10);
        const trialMs = Number.parseInt(document.getElementById('pvtTrialDurationMs')?.value || '10000', 10);
        const itiMs = Number.parseInt(document.getElementById('pvtItiMs')?.value || '0', 10);

        return {
            type: 'pvt-trial',
            name: 'PVT Defaults',

            response_device: responseDevice,
            response_key: responseKey,

            foreperiod_ms: Number.isFinite(foreperiodMs) ? foreperiodMs : 4000,
            trial_duration_ms: Number.isFinite(trialMs) ? trialMs : 10000,
            iti_ms: Number.isFinite(itiMs) ? itiMs : 0,

            // Preview-only fields (mirrors pvt_settings export)
            feedback_enabled: feedbackEnabled,
            feedback_message: feedbackMessage,
            add_trial_per_false_start: addTrialPerFalseStart
        };
    }

    /**
     * Build a preview payload for the current MOT defaults.
     */
    getCurrentMotDefaults() {
        const d = this.getMotDefaultsForNewComponent();
        return {
            type: 'mot-trial',
            name: 'MOT Defaults',
            num_objects: Number.isFinite(Number(d.num_objects)) ? Number(d.num_objects) : 8,
            num_targets: Number.isFinite(Number(d.num_targets)) ? Number(d.num_targets) : 4,
            speed_px_per_s: Number.isFinite(Number(d.speed_px_per_s)) ? Number(d.speed_px_per_s) : 150,
            motion_type: (d.motion_type || 'linear').toString(),
            probe_mode: (d.probe_mode || 'click').toString(),
            cue_duration_ms: Number.isFinite(Number(d.cue_duration_ms)) ? Number(d.cue_duration_ms) : 2000,
            tracking_duration_ms: Number.isFinite(Number(d.tracking_duration_ms)) ? Number(d.tracking_duration_ms) : 8000,
            iti_ms: Number.isFinite(Number(d.iti_ms)) ? Number(d.iti_ms) : 1000,
            show_feedback: !!d.show_feedback
        };
    }

    /**
     * Build a preview payload for the current N-back defaults.
     * We return a `block` payload so the preview matches the real authoring unit.
     */
    getCurrentNbackDefaults() {
        const safeInt = (raw, fallback) => {
            const v = Number.parseInt(raw, 10);
            return Number.isFinite(v) ? v : fallback;
        };

        const safeFloat01 = (raw, fallback) => {
            const v = Number.parseFloat(raw);
            if (!Number.isFinite(v)) return fallback;
            return Math.max(0, Math.min(1, v));
        };

        const cap = this.getExperimentWideLengthCapForBlocks();
        const defaultLen = this.getExperimentWideBlockLengthDefault();

        const renderMode = (document.getElementById('nbackDefaultRenderMode')?.value || 'token').toString();
        const responseDevice = (document.getElementById('nbackDefaultDevice')?.value || 'keyboard').toString();

        const blockLen = (() => {
            const raw = safeInt(defaultLen, 40);
            const len = Number.isFinite(raw) ? Math.max(1, raw) : 40;
            if (Number.isFinite(cap) && cap > 0) return Math.min(len, cap);
            return len;
        })();

        return {
            type: 'block',
            name: 'N-back Defaults',
            block_component_type: 'nback-block',
            block_length: blockLen,
            seed: (document.getElementById('nbackDefaultSeed')?.value || '').toString(),

            nback_n: safeInt(document.getElementById('nbackDefaultN')?.value, 2),
            nback_stimulus_mode: (document.getElementById('nbackDefaultStimulusMode')?.value || 'letters').toString(),
            nback_stimulus_pool: (document.getElementById('nbackDefaultStimulusPool')?.value || '').toString(),
            nback_target_probability: safeFloat01(document.getElementById('nbackDefaultTargetProb')?.value, 0.25),

            nback_render_mode: renderMode,
            ...(renderMode === 'custom_html'
                ? { nback_stimulus_template_html: (document.getElementById('nbackDefaultTemplateHtml')?.value || '').toString() }
                : {}),

            nback_stimulus_duration_ms: safeInt(document.getElementById('nbackDefaultStimulusMs')?.value, 500),
            nback_isi_duration_ms: safeInt(document.getElementById('nbackDefaultIsiMs')?.value, 700),
            nback_trial_duration_ms: safeInt(document.getElementById('nbackDefaultTrialMs')?.value, 1200),

            nback_show_fixation_cross_between_trials: !!document.getElementById('nbackDefaultShowFixationCrossBetweenTrials')?.checked,

            nback_response_paradigm: (document.getElementById('nbackDefaultParadigm')?.value || 'go_nogo').toString(),
            nback_response_device: responseDevice,
            nback_go_key: (document.getElementById('nbackDefaultGoKey')?.value || 'space').toString(),
            nback_match_key: (document.getElementById('nbackDefaultMatchKey')?.value || 'j').toString(),
            nback_nonmatch_key: (document.getElementById('nbackDefaultNonmatchKey')?.value || 'f').toString(),
            nback_show_buttons: !!document.getElementById('nbackDefaultShowButtons')?.checked,

            nback_show_feedback: !!document.getElementById('nbackDefaultFeedback')?.checked,
            nback_feedback_duration_ms: safeInt(document.getElementById('nbackDefaultFeedbackMs')?.value, 250)
        };
    }

    getNbackDefaultsForNewBlock() {
        const safeInt = (raw, fallback) => {
            const v = Number.parseInt(raw, 10);
            return Number.isFinite(v) ? v : fallback;
        };

        const safeFloat01 = (raw, fallback) => {
            const v = Number.parseFloat(raw);
            if (!Number.isFinite(v)) return fallback;
            return Math.max(0, Math.min(1, v));
        };

        const cap = this.getExperimentWideLengthCapForBlocks();
        const defaultLen = this.getExperimentWideBlockLengthDefault();

        const renderMode = (document.getElementById('nbackDefaultRenderMode')?.value || 'token').toString();

        const blockLen = (() => {
            const raw = safeInt(defaultLen, 40);
            const len = Number.isFinite(raw) ? Math.max(1, raw) : 40;
            if (Number.isFinite(cap) && cap > 0) return Math.min(len, cap);
            return len;
        })();

        return {
            block_component_type: 'nback-block',
            block_length: blockLen,
            seed: (document.getElementById('nbackDefaultSeed')?.value || '').toString(),

            nback_n: safeInt(document.getElementById('nbackDefaultN')?.value, 2),
            nback_stimulus_mode: (document.getElementById('nbackDefaultStimulusMode')?.value || 'letters').toString(),
            nback_stimulus_pool: (document.getElementById('nbackDefaultStimulusPool')?.value || '').toString(),
            nback_target_probability: safeFloat01(document.getElementById('nbackDefaultTargetProb')?.value, 0.25),

            nback_render_mode: renderMode,
            ...(renderMode === 'custom_html'
                ? { nback_stimulus_template_html: (document.getElementById('nbackDefaultTemplateHtml')?.value || '<div style="font-size:72px; font-weight:700; letter-spacing:0.02em;">{{TOKEN}}</div>').toString() }
                : {}),

            nback_stimulus_duration_ms: safeInt(document.getElementById('nbackDefaultStimulusMs')?.value, 500),
            nback_isi_duration_ms: safeInt(document.getElementById('nbackDefaultIsiMs')?.value, 700),
            nback_trial_duration_ms: safeInt(document.getElementById('nbackDefaultTrialMs')?.value, 1200),

            nback_show_fixation_cross_between_trials: !!document.getElementById('nbackDefaultShowFixationCrossBetweenTrials')?.checked,

            nback_response_paradigm: (document.getElementById('nbackDefaultParadigm')?.value || 'go_nogo').toString(),
            // New blocks inherit response device from experiment defaults.
            nback_response_device: 'inherit',
            nback_go_key: (document.getElementById('nbackDefaultGoKey')?.value || 'space').toString(),
            nback_match_key: (document.getElementById('nbackDefaultMatchKey')?.value || 'j').toString(),
            nback_nonmatch_key: (document.getElementById('nbackDefaultNonmatchKey')?.value || 'f').toString(),
            nback_show_buttons: !!document.getElementById('nbackDefaultShowButtons')?.checked,

            nback_show_feedback: !!document.getElementById('nbackDefaultFeedback')?.checked,
            nback_feedback_duration_ms: safeInt(document.getElementById('nbackDefaultFeedbackMs')?.value, 250)
        };
    }

    getNbackDefaultsForNewSequence() {
        const safeInt = (raw, fallback) => {
            const v = Number.parseInt(raw, 10);
            return Number.isFinite(v) ? v : fallback;
        };

        const safeFloat01 = (raw, fallback) => {
            const v = Number.parseFloat(raw);
            if (!Number.isFinite(v)) return fallback;
            return Math.max(0, Math.min(1, v));
        };

        const cap = this.getExperimentWideLengthCapForBlocks();
        const defaultLen = this.getExperimentWideBlockLengthDefault();

        const renderMode = (document.getElementById('nbackDefaultRenderMode')?.value || 'token').toString();

        const length = (() => {
            const raw = safeInt(defaultLen, 24);
            const len = Number.isFinite(raw) ? Math.max(1, raw) : 24;
            if (Number.isFinite(cap) && cap > 0) return Math.min(len, cap);
            return len;
        })();

        return {
            length,
            seed: (document.getElementById('nbackDefaultSeed')?.value || '').toString(),
            n: safeInt(document.getElementById('nbackDefaultN')?.value, 2),

            stimulus_mode: (document.getElementById('nbackDefaultStimulusMode')?.value || 'letters').toString(),
            stimulus_pool: (document.getElementById('nbackDefaultStimulusPool')?.value || '').toString(),
            target_probability: safeFloat01(document.getElementById('nbackDefaultTargetProb')?.value, 0.25),

            render_mode: renderMode,
            ...(renderMode === 'custom_html'
                ? { stimulus_template_html: (document.getElementById('nbackDefaultTemplateHtml')?.value || '').toString() }
                : {}),

            stimulus_duration_ms: safeInt(document.getElementById('nbackDefaultStimulusMs')?.value, 500),
            isi_duration_ms: safeInt(document.getElementById('nbackDefaultIsiMs')?.value, 700),
            trial_duration_ms: safeInt(document.getElementById('nbackDefaultTrialMs')?.value, 1200),

            show_fixation_cross_between_trials: !!document.getElementById('nbackDefaultShowFixationCrossBetweenTrials')?.checked,

            response_paradigm: (document.getElementById('nbackDefaultParadigm')?.value || 'go_nogo').toString(),
            response_device: 'inherit',
            go_key: (document.getElementById('nbackDefaultGoKey')?.value || 'space').toString(),
            match_key: (document.getElementById('nbackDefaultMatchKey')?.value || 'j').toString(),
            nonmatch_key: (document.getElementById('nbackDefaultNonmatchKey')?.value || 'f').toString(),
            show_buttons: !!document.getElementById('nbackDefaultShowButtons')?.checked,

            show_feedback: !!document.getElementById('nbackDefaultFeedback')?.checked,
            feedback_duration_ms: safeInt(document.getElementById('nbackDefaultFeedbackMs')?.value, 250)
        };
    }

    getPvtDefaultsForNewComponent() {
        return {
            response_device: 'inherit',
            response_key: (document.getElementById('pvtResponseKey')?.value || 'space').toString(),
            foreperiod_ms: Number.parseInt(document.getElementById('pvtForeperiodMs')?.value || '4000', 10),
            trial_duration_ms: Number.parseInt(document.getElementById('pvtTrialDurationMs')?.value || '10000', 10),
            iti_ms: Number.parseInt(document.getElementById('pvtItiMs')?.value || '0', 10)
        };
    }

    getPvtDefaultsForNewBlock() {
        const foreperiod = Number.parseInt(document.getElementById('pvtForeperiodMs')?.value || '4000', 10);
        const trialMs = Number.parseInt(document.getElementById('pvtTrialDurationMs')?.value || '10000', 10);
        const itiMs = Number.parseInt(document.getElementById('pvtItiMs')?.value || '0', 10);

        // Default to a wide foreperiod window for variability.
        const minFp = 2000;
        const maxFp = 10000;

        return {
            block_component_type: 'pvt-trial',

            pvt_response_device: 'inherit',
            pvt_response_key: (document.getElementById('pvtResponseKey')?.value || 'space').toString(),

            pvt_foreperiod_min: Number.isFinite(minFp) ? minFp : (Number.isFinite(foreperiod) ? foreperiod : 4000),
            pvt_foreperiod_max: Number.isFinite(maxFp) ? maxFp : (Number.isFinite(foreperiod) ? foreperiod : 4000),

            pvt_trial_duration_min: Number.isFinite(trialMs) ? trialMs : 10000,
            pvt_trial_duration_max: Number.isFinite(trialMs) ? trialMs : 10000,
            pvt_iti_min: Number.isFinite(itiMs) ? itiMs : 0,
            pvt_iti_max: Number.isFinite(itiMs) ? itiMs : 0
        };
    }

    getMotDefaultsForNewComponent() {
        return {
            num_objects: Number.parseInt(document.getElementById('motNumObjectsDefault')?.value || '8', 10),
            num_targets: Number.parseInt(document.getElementById('motNumTargetsDefault')?.value || '4', 10),
            speed_px_per_s: Number.parseFloat(document.getElementById('motSpeedDefault')?.value || '150'),
            motion_type: (document.getElementById('motMotionTypeDefault')?.value || 'linear').toString(),
            probe_mode: (document.getElementById('motProbeModeDefault')?.value || 'click').toString(),
            cue_duration_ms: Number.parseInt(document.getElementById('motCueDurationMsDefault')?.value || '2000', 10),
            tracking_duration_ms: Number.parseInt(document.getElementById('motTrackingDurationMsDefault')?.value || '8000', 10),
            iti_ms: Number.parseInt(document.getElementById('motItiMsDefault')?.value || '1000', 10),
            show_feedback: !!document.getElementById('motShowFeedbackDefault')?.checked
        };
    }

    getMotDefaultsForNewBlock() {
        const d = this.getMotDefaultsForNewComponent();
        const speed = Number.isFinite(Number(d.speed_px_per_s)) ? Number(d.speed_px_per_s) : 150;
        const tracking = Number.isFinite(Number(d.tracking_duration_ms)) ? Number(d.tracking_duration_ms) : 8000;
        const cue = Number.isFinite(Number(d.cue_duration_ms)) ? Number(d.cue_duration_ms) : 2000;
        const iti = Number.isFinite(Number(d.iti_ms)) ? Number(d.iti_ms) : 1000;
        const nums = Number.isFinite(Number(d.num_objects)) ? Number(d.num_objects) : 8;
        const tgts = Number.isFinite(Number(d.num_targets)) ? Number(d.num_targets) : 4;

        return {
            block_component_type: 'mot-trial',
            mot_num_objects_options: String(nums),
            mot_num_targets_options: String(tgts),
            mot_motion_type: (d.motion_type || 'linear').toString(),
            mot_probe_mode: (d.probe_mode || 'click').toString(),
            mot_show_feedback: !!d.show_feedback,
            mot_speed_px_per_s_min: speed,
            mot_speed_px_per_s_max: speed,
            mot_tracking_duration_ms_min: tracking,
            mot_tracking_duration_ms_max: tracking,
            mot_cue_duration_ms_min: cue,
            mot_cue_duration_ms_max: cue,
            mot_iti_ms_min: iti,
            mot_iti_ms_max: iti
        };
    }

    getSimonDefaultsForNewComponent() {
        const stimuli = this.getCurrentSimonStimuliFromUI();

        return {
            stimulus_side: 'left',
            stimulus_color_name: (stimuli[0]?.name || 'BLUE').toString(),
            response_device: 'inherit',
            left_key: (document.getElementById('simonLeftKey')?.value || 'f').toString(),
            right_key: (document.getElementById('simonRightKey')?.value || 'j').toString(),
            circle_diameter_px: Number.parseInt(document.getElementById('simonCircleDiameterPx')?.value || '140', 10),
            stimulus_duration_ms: Number.parseInt(document.getElementById('simonStimulusDurationMs')?.value || '0', 10),
            trial_duration_ms: Number.parseInt(document.getElementById('simonTrialDurationMs')?.value || '1500', 10),
            iti_ms: Number.parseInt(document.getElementById('simonItiMs')?.value || '500', 10)
        };
    }

    getSimonDefaultsForNewBlock() {
        const stimuli = this.getCurrentSimonStimuliFromUI();
        const names = (Array.isArray(stimuli) ? stimuli : [])
            .map(s => (s?.name ?? '').toString().trim())
            .filter(Boolean);
        const nameList = names.join(',');

        const stimMs = Number.parseInt(document.getElementById('simonStimulusDurationMs')?.value || '0', 10);
        const trialMs = Number.parseInt(document.getElementById('simonTrialDurationMs')?.value || '1500', 10);
        const itiMs = Number.parseInt(document.getElementById('simonItiMs')?.value || '500', 10);

        return {
            block_component_type: 'simon-trial',

            simon_color_options: nameList || 'BLUE,ORANGE',
            simon_side_options: 'left,right',

            simon_response_device: 'inherit',
            simon_left_key: (document.getElementById('simonLeftKey')?.value || 'f').toString(),
            simon_right_key: (document.getElementById('simonRightKey')?.value || 'j').toString(),

            simon_stimulus_duration_min: Number.isFinite(stimMs) ? stimMs : 0,
            simon_stimulus_duration_max: Number.isFinite(stimMs) ? stimMs : 0,
            simon_trial_duration_min: Number.isFinite(trialMs) ? trialMs : 1500,
            simon_trial_duration_max: Number.isFinite(trialMs) ? trialMs : 1500,
            simon_iti_min: Number.isFinite(itiMs) ? itiMs : 500,
            simon_iti_max: Number.isFinite(itiMs) ? itiMs : 500
        };
    }

    sampleTaskSwitchingStimulusPairFromUI() {
        const parseStringList = (raw) => {
            return (raw ?? '')
                .toString()
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
        };

        const pick = (arr, fallback) => {
            if (!Array.isArray(arr) || arr.length === 0) return fallback;
            const idx = Math.floor(Math.random() * arr.length);
            return (arr[Math.max(0, Math.min(arr.length - 1, idx))] ?? fallback);
        };

        const mode = (document.getElementById('taskSwitchingStimulusSetMode')?.value || 'letters_numbers').toString();

        const builtIn = {
            task1A: ['A', 'E', 'I', 'O', 'U'],
            task1B: ['B', 'C', 'D', 'F', 'G', 'H', 'J', 'K'],
            task2A: ['1', '3', '5', '7', '9'],
            task2B: ['2', '4', '6', '8']
        };

        const tokens = (() => {
            if (mode !== 'custom') return builtIn;

            const task1A = parseStringList(document.getElementById('taskSwitchingTask1CategoryA')?.value);
            const task1B = parseStringList(document.getElementById('taskSwitchingTask1CategoryB')?.value);
            const task2A = parseStringList(document.getElementById('taskSwitchingTask2CategoryA')?.value);
            const task2B = parseStringList(document.getElementById('taskSwitchingTask2CategoryB')?.value);

            return {
                task1A: (task1A.length > 0) ? task1A : builtIn.task1A,
                task1B: (task1B.length > 0) ? task1B : builtIn.task1B,
                task2A: (task2A.length > 0) ? task2A : builtIn.task2A,
                task2B: (task2B.length > 0) ? task2B : builtIn.task2B
            };
        })();

        const task1Pool = [...(tokens.task1A || []), ...(tokens.task1B || [])].filter(Boolean);
        const task2Pool = [...(tokens.task2A || []), ...(tokens.task2B || [])].filter(Boolean);

        const stimulusTask1 = (pick(task1Pool, 'A') ?? 'A').toString();
        const stimulusTask2 = (pick(task2Pool, '1') ?? '1').toString();
        const combined = `${stimulusTask1} ${stimulusTask2}`.trim();

        return {
            stimulus_task_1: stimulusTask1,
            stimulus_task_2: stimulusTask2,
            stimulus: combined
        };
    }

    getTaskSwitchingDefaultsForNewComponent() {
        const pair = this.sampleTaskSwitchingStimulusPairFromUI();

        const cueTypeRaw = (document.getElementById('taskSwitchingCueType')?.value || 'explicit').toString().trim();
        const cueType = (cueTypeRaw === 'position' || cueTypeRaw === 'color' || cueTypeRaw === 'explicit') ? cueTypeRaw : 'explicit';

        return {
            task_index: 1,
            ...pair,
            stimulus_position: (document.getElementById('taskSwitchingStimulusPosition')?.value || 'top').toString(),
            border_enabled: !!document.getElementById('taskSwitchingBorderEnabled')?.checked,
            left_key: (document.getElementById('taskSwitchingLeftKey')?.value || 'f').toString(),
            right_key: (document.getElementById('taskSwitchingRightKey')?.value || 'j').toString(),

            cue_type: cueType,
            task_1_position: (document.getElementById('taskSwitchingTask1Position')?.value || 'left').toString(),
            task_2_position: (document.getElementById('taskSwitchingTask2Position')?.value || 'right').toString(),
            task_1_color_hex: (document.getElementById('taskSwitchingTask1ColorHex')?.value || '#FFFFFF').toString(),
            task_2_color_hex: (document.getElementById('taskSwitchingTask2ColorHex')?.value || '#FFFFFF').toString(),
            stimulus_color_hex: '#FFFFFF',
            task_1_cue_text: (document.getElementById('taskSwitchingTask1CueText')?.value || 'LETTERS').toString(),
            task_2_cue_text: (document.getElementById('taskSwitchingTask2CueText')?.value || 'NUMBERS').toString(),
            cue_font_size_px: Number.parseInt(document.getElementById('taskSwitchingCueFontSizePx')?.value || '28', 10),
            cue_duration_ms: Number.parseInt(document.getElementById('taskSwitchingCueDurationMs')?.value || '0', 10),
            cue_gap_ms: Number.parseInt(document.getElementById('taskSwitchingCueGapMs')?.value || '0', 10),
            cue_color_hex: (document.getElementById('taskSwitchingCueColorHex')?.value || '#FFFFFF').toString(),

            stimulus_duration_ms: 0,
            trial_duration_ms: 2000,
            iti_ms: 500
        };
    }

    getTaskSwitchingDefaultsForNewBlock() {
        const cap = this.getExperimentWideLengthCapForBlocks();
        const defaultLen = this.getExperimentWideBlockLengthDefault();

        const safeInt = (raw, fallback) => {
            const v = Number.parseInt(raw, 10);
            return Number.isFinite(v) ? v : fallback;
        };

        const blockLen = (() => {
            const raw = safeInt(defaultLen, 40);
            const len = Number.isFinite(raw) ? Math.max(1, raw) : 40;
            if (Number.isFinite(cap) && cap > 0) return Math.min(len, cap);
            return len;
        })();

        return {
            block_component_type: 'task-switching-trial',
            block_length: blockLen,
            seed: '',

            // New block-level task switching controls
            ts_trial_type: 'switch',
            ts_single_task_index: 1,
            ts_cue_type: (() => {
                const raw = (document.getElementById('taskSwitchingCueType')?.value || 'explicit').toString().trim();
                return (raw === 'position' || raw === 'color' || raw === 'explicit') ? raw : 'explicit';
            })(),

            ts_task_1_position: (document.getElementById('taskSwitchingTask1Position')?.value || 'left').toString(),
            ts_task_2_position: (document.getElementById('taskSwitchingTask2Position')?.value || 'right').toString(),
            ts_task_1_color_hex: (document.getElementById('taskSwitchingTask1ColorHex')?.value || '#FFFFFF').toString(),
            ts_task_2_color_hex: (document.getElementById('taskSwitchingTask2ColorHex')?.value || '#FFFFFF').toString(),
            ts_task_1_cue_text: (document.getElementById('taskSwitchingTask1CueText')?.value || 'LETTERS').toString(),
            ts_task_2_cue_text: (document.getElementById('taskSwitchingTask2CueText')?.value || 'NUMBERS').toString(),
            ts_cue_font_size_px: safeInt(document.getElementById('taskSwitchingCueFontSizePx')?.value, 28),
            ts_cue_duration_ms: safeInt(document.getElementById('taskSwitchingCueDurationMs')?.value, 0),
            ts_cue_gap_ms: safeInt(document.getElementById('taskSwitchingCueGapMs')?.value, 0),
            ts_cue_color_hex: (document.getElementById('taskSwitchingCueColorHex')?.value || '#FFFFFF').toString(),

            // Appearance/response defaults seeded from the Task Switching defaults panel
            ts_stimulus_position: (document.getElementById('taskSwitchingStimulusPosition')?.value || 'top').toString(),
            ts_stimulus_color_hex: '#FFFFFF',
            ts_border_enabled: !!document.getElementById('taskSwitchingBorderEnabled')?.checked,
            ts_left_key: (document.getElementById('taskSwitchingLeftKey')?.value || 'f').toString(),
            ts_right_key: (document.getElementById('taskSwitchingRightKey')?.value || 'j').toString(),

            // Timing windows seeded from defaults panel
            ts_stimulus_duration_min: 0,
            ts_stimulus_duration_max: 0,
            ts_trial_duration_min: 2000,
            ts_trial_duration_max: 2000,
            ts_iti_min: 500,
            ts_iti_max: 500
        };
    }

    getCurrentTaskSwitchingDefaults() {
        const position = (document.getElementById('taskSwitchingStimulusPosition')?.value || 'top').toString();
        const borderEnabled = !!document.getElementById('taskSwitchingBorderEnabled')?.checked;
        const leftKey = (document.getElementById('taskSwitchingLeftKey')?.value || 'f').toString();
        const rightKey = (document.getElementById('taskSwitchingRightKey')?.value || 'j').toString();

        const cueTypeRaw = (document.getElementById('taskSwitchingCueType')?.value || 'explicit').toString().trim();
        const cueType = (cueTypeRaw === 'position' || cueTypeRaw === 'color' || cueTypeRaw === 'explicit') ? cueTypeRaw : 'explicit';

        const pair = this.sampleTaskSwitchingStimulusPairFromUI();

        return {
            type: 'task-switching-trial',
            name: 'Task Switching Defaults',

            task_index: 1,
            ...pair,
            stimulus_position: position,
            border_enabled: borderEnabled,
            left_key: leftKey,
            right_key: rightKey,

            cue_type: cueType,
            task_1_position: (document.getElementById('taskSwitchingTask1Position')?.value || 'left').toString(),
            task_2_position: (document.getElementById('taskSwitchingTask2Position')?.value || 'right').toString(),
            task_1_color_hex: (document.getElementById('taskSwitchingTask1ColorHex')?.value || '#FFFFFF').toString(),
            task_2_color_hex: (document.getElementById('taskSwitchingTask2ColorHex')?.value || '#FFFFFF').toString(),
            stimulus_color_hex: '#FFFFFF',
            task_1_cue_text: (document.getElementById('taskSwitchingTask1CueText')?.value || 'LETTERS').toString(),
            task_2_cue_text: (document.getElementById('taskSwitchingTask2CueText')?.value || 'NUMBERS').toString(),
            cue_font_size_px: Number.parseInt(document.getElementById('taskSwitchingCueFontSizePx')?.value || '28', 10),
            cue_duration_ms: Number.parseInt(document.getElementById('taskSwitchingCueDurationMs')?.value || '0', 10),
            cue_gap_ms: Number.parseInt(document.getElementById('taskSwitchingCueGapMs')?.value || '0', 10),
            cue_color_hex: (document.getElementById('taskSwitchingCueColorHex')?.value || '#FFFFFF').toString(),

            stimulus_duration_ms: 0,
            trial_duration_ms: 2000,
            iti_ms: 500
        };
    }

    getStroopDefaultsForNewComponent() {
        const stimuli = this.getCurrentStroopStimuliFromUI();
        const n = stimuli.length;
        const choiceKeys = this.parseStroopChoiceKeysFromUI(n);

        return {
            // Provide reasonable starting values; researcher can override per-trial.
            word: (stimuli[0]?.name || 'RED').toString(),
            ink_color_name: (stimuli[1]?.name || stimuli[0]?.name || 'BLUE').toString(),
            congruency: 'auto',

            response_mode: 'inherit',
            response_device: 'inherit',

            choice_keys: choiceKeys,
            congruent_key: (document.getElementById('stroopCongruentKey')?.value || 'f').toString(),
            incongruent_key: (document.getElementById('stroopIncongruentKey')?.value || 'j').toString(),

            stimulus_font_size_px: Number.parseInt(document.getElementById('stroopStimulusFontSizePx')?.value || '64', 10),
            stimulus_duration_ms: Number.parseInt(document.getElementById('stroopStimulusDurationMs')?.value || '0', 10),
            trial_duration_ms: Number.parseInt(document.getElementById('stroopTrialDurationMs')?.value || '2000', 10),
            iti_ms: Number.parseInt(document.getElementById('stroopItiMs')?.value || '500', 10)
        };
    }

    getStroopDefaultsForNewBlock() {
        const stimuli = this.getCurrentStroopStimuliFromUI();
        const n = stimuli.length;
        const names = stimuli.map(s => (s?.name ?? '').toString().trim()).filter(Boolean);
        const nameList = names.join(',');
        const choiceKeys = this.parseStroopChoiceKeysFromUI(n).join(',');

        const stimMs = Number.parseInt(document.getElementById('stroopStimulusDurationMs')?.value || '0', 10);
        const trialMs = Number.parseInt(document.getElementById('stroopTrialDurationMs')?.value || '2000', 10);
        const itiMs = Number.parseInt(document.getElementById('stroopItiMs')?.value || '500', 10);

        return {
            block_component_type: 'stroop-trial',

            stroop_word_options: nameList,
            stroop_congruency_options: 'auto,congruent,incongruent',

            stroop_response_mode: 'inherit',
            stroop_response_device: 'inherit',
            stroop_choice_keys: choiceKeys,
            stroop_congruent_key: (document.getElementById('stroopCongruentKey')?.value || 'f').toString(),
            stroop_incongruent_key: (document.getElementById('stroopIncongruentKey')?.value || 'j').toString(),

            stroop_stimulus_duration_min: Number.isFinite(stimMs) ? stimMs : 0,
            stroop_stimulus_duration_max: Number.isFinite(stimMs) ? stimMs : 0,
            stroop_trial_duration_min: Number.isFinite(trialMs) ? trialMs : 2000,
            stroop_trial_duration_max: Number.isFinite(trialMs) ? trialMs : 2000,
            stroop_iti_min: Number.isFinite(itiMs) ? itiMs : 500,
            stroop_iti_max: Number.isFinite(itiMs) ? itiMs : 500
        };
    }

    getEmotionalStroopDefaultsForNewComponent() {
        const stimuli = this.getCurrentStroopStimuliFromUI();
        const n = stimuli.length;
        const choiceKeys = this.parseStroopChoiceKeysFromUI(Math.max(2, n));
        const listsParsed = this.parseEmotionalStroopWordListsFromUI();
        const words = listsParsed?.word_options || [];
        const wordLists = listsParsed?.word_lists || [];

        return {
            word: (words[0] || 'HAPPY').toString(),
            word_list_label: (wordLists[0]?.label || '').toString(),
            word_list_index: 1,
            ink_color_name: (stimuli[0]?.name || 'BLUE').toString(),

            response_device: 'inherit',
            choice_keys: choiceKeys,

            stimulus_font_size_px: Number.parseInt(document.getElementById('stroopStimulusFontSizePx')?.value || '64', 10),
            stimulus_duration_ms: Number.parseInt(document.getElementById('stroopStimulusDurationMs')?.value || '0', 10),
            trial_duration_ms: Number.parseInt(document.getElementById('stroopTrialDurationMs')?.value || '2000', 10),
            iti_ms: Number.parseInt(document.getElementById('stroopItiMs')?.value || '500', 10)
        };
    }

    getEmotionalStroopDefaultsForNewBlock() {
        const stimuli = this.getCurrentStroopStimuliFromUI();
        const names = (Array.isArray(stimuli) ? stimuli : [])
            .map(s => (s?.name ?? '').toString().trim())
            .filter(Boolean);
        const inkList = names.join(',');

        const parsed = this.parseEmotionalStroopWordListsFromUI();
        const lists = Array.isArray(parsed?.word_lists) ? parsed.word_lists : [];
        const flattened = Array.isArray(parsed?.word_options) ? parsed.word_options : [];
        const wordList = flattened.join(',');

        const n = Math.max(2, names.length);
        const choiceKeys = this.parseStroopChoiceKeysFromUI(n).join(',');

        const stimMs = Number.parseInt(document.getElementById('stroopStimulusDurationMs')?.value || '0', 10);
        const trialMs = Number.parseInt(document.getElementById('stroopTrialDurationMs')?.value || '2000', 10);
        const itiMs = Number.parseInt(document.getElementById('stroopItiMs')?.value || '500', 10);

        return {
            block_component_type: 'emotional-stroop-trial',

            emostroop_word_list_count: (parsed?.word_list_count === 3 ? 3 : 2),

            emostroop_word_list_1_label: (lists[0]?.label || 'Neutral').toString(),
            emostroop_word_list_1_words: (Array.isArray(lists[0]?.words) ? lists[0].words.join(',') : 'CHAIR,TABLE,WINDOW'),

            emostroop_word_list_2_label: (lists[1]?.label || 'Negative').toString(),
            emostroop_word_list_2_words: (Array.isArray(lists[1]?.words) ? lists[1].words.join(',') : 'SAD,ANGRY,FEAR'),

            emostroop_word_list_3_label: (lists[2]?.label || 'Positive').toString(),
            emostroop_word_list_3_words: (Array.isArray(lists[2]?.words) ? lists[2].words.join(',') : 'HAPPY,JOY,LOVE'),

            // Back-compat / convenience: flattened pool (preview may still use it if needed)
            emostroop_word_options: wordList || 'HAPPY,SAD,ANGRY,CHAIR',
            emostroop_ink_color_options: inkList || 'RED,GREEN,BLUE,YELLOW',

            emostroop_response_device: 'inherit',
            emostroop_choice_keys: choiceKeys,

            emostroop_stimulus_duration_min: Number.isFinite(stimMs) ? stimMs : 0,
            emostroop_stimulus_duration_max: Number.isFinite(stimMs) ? stimMs : 0,
            emostroop_trial_duration_min: Number.isFinite(trialMs) ? trialMs : 2000,
            emostroop_trial_duration_max: Number.isFinite(trialMs) ? trialMs : 2000,
            emostroop_iti_min: Number.isFinite(itiMs) ? itiMs : 500,
            emostroop_iti_max: Number.isFinite(itiMs) ? itiMs : 500
        };
    }

    /**
     * Build a preview payload for the current Gabor defaults.
     */
    getCurrentGaborDefaults() {
        const responseTask = document.getElementById('gaborResponseTask')?.value || 'discriminate_tilt';
        const leftKey = document.getElementById('gaborLeftKey')?.value || 'f';
        const rightKey = document.getElementById('gaborRightKey')?.value || 'j';
        const yesKey = document.getElementById('gaborYesKey')?.value || 'f';
        const noKey = document.getElementById('gaborNoKey')?.value || 'j';

        const patchDiameterDeg = Number.parseFloat(document.getElementById('gaborPatchDiameterDeg')?.value || '6');

        const patchBorderEnabled = !!document.getElementById('gaborPatchBorderEnabled')?.checked;
        const patchBorderWidth = Number.parseInt(document.getElementById('gaborPatchBorderWidthPx')?.value || '2', 10);
        const patchBorderColor = (document.getElementById('gaborPatchBorderColor')?.value || '#ffffff').toString();
        const patchBorderOpacity = Number.parseFloat(document.getElementById('gaborPatchBorderOpacity')?.value || '0.22');

        return {
            type: 'gabor-trial',
            name: 'Gabor Defaults',

            response_task: responseTask,
            left_key: leftKey,
            right_key: rightKey,
            yes_key: yesKey,
            no_key: noKey,

            target_location: 'left',
            target_tilt_deg: 45,
            distractor_orientation_deg: 0,
            spatial_cue: 'none',
            left_value: 'neutral',
            right_value: 'neutral',

            // Use panel timings for the trial-level preview
            stimulus_duration_ms: parseInt(document.getElementById('gaborStimulusDurationMs')?.value || '67', 10),
            mask_duration_ms: parseInt(document.getElementById('gaborMaskDurationMs')?.value || '67', 10),

            spatial_frequency_cyc_per_px: Number.parseFloat(document.getElementById('gaborSpatialFrequency')?.value || '0.06'),
            grating_waveform: (document.getElementById('gaborGratingWaveform')?.value || 'sinusoidal').toString(),

            patch_diameter_deg: Number.isFinite(patchDiameterDeg) ? Math.max(0.1, patchDiameterDeg) : 6,

            // Optional colors to render value cues in preview
            high_value_color: document.getElementById('gaborHighValueColor')?.value || '#00aa00',
            low_value_color: document.getElementById('gaborLowValueColor')?.value || '#0066ff',

            patch_border_enabled: patchBorderEnabled,
            patch_border_width_px: Number.isFinite(patchBorderWidth) ? Math.max(0, Math.min(50, patchBorderWidth)) : 2,
            patch_border_color: patchBorderColor,
            patch_border_opacity: Number.isFinite(patchBorderOpacity) ? Math.max(0, Math.min(1, patchBorderOpacity)) : 0.22
        };
    }

    /**
     * Build a preview payload for the current SOC Dashboard defaults.
     */
    getCurrentSocDashboardDefaults() {
        return {
            type: 'soc-dashboard',
            name: 'SOC Dashboard Defaults',
            title: (document.getElementById('socTitle')?.value || 'SOC Dashboard').toString(),
            wallpaper_url: (document.getElementById('socWallpaperUrl')?.value || '').toString().trim(),
            background_color: (document.getElementById('socBackgroundColor')?.value || '#0b1220').toString(),
            default_app: (document.getElementById('socDefaultApp')?.value || 'soc').toString(),
            num_tasks: parseInt(document.getElementById('socNumTasks')?.value || '1', 10),
            trial_duration_ms: parseInt(document.getElementById('socSessionDurationMs')?.value || '60000', 10),
            end_key: (document.getElementById('socEndKey')?.value || 'escape').toString(),
            icons_clickable: !!document.getElementById('socIconsClickable')?.checked,
            log_icon_clicks: !!document.getElementById('socLogIconClicks')?.checked,
            icon_clicks_are_distractors: !!document.getElementById('socIconClicksAreDistractors')?.checked
        };
    }

    getSocDashboardDefaultsForNewComponent() {
        const d = this.getCurrentSocDashboardDefaults();
        const { type, name, ...rest } = d;
        // Ensure predictable arrays for composition/preview, even before export.
        rest.desktop_icons = [];
        rest.subtasks = [];
        return rest;
    }

    getCurrentContinuousImageDefaults() {
        const safeInt = (raw, fallback, { min = null, max = null } = {}) => {
            const v = Number.parseInt(raw ?? '', 10);
            if (!Number.isFinite(v)) return fallback;
            const clampedMin = (min === null) ? v : Math.max(min, v);
            return (max === null) ? clampedMin : Math.min(max, clampedMin);
        };

        const normalizeCipMaskType = (raw) => {
            const t0 = (raw ?? '').toString().trim();
            const t = t0.toLowerCase();

            // New UI values
            if (t === 'pure_noise') return 'pure_noise';
            if (t === 'noise_and_shuffle') return 'noise_and_shuffle';
            if (t === 'advanced_transform') return 'advanced_transform';

            // Friendly labels
            if (t === 'pure noise') return 'pure_noise';
            if (t === 'noise and shuffle') return 'noise_and_shuffle';
            if (t === 'advanced transform') return 'advanced_transform';

            // Legacy values
            if (t === 'noise') return 'noise_and_shuffle';
            if (t === 'sprite') return 'pure_noise';
            if (t === 'blank') return 'pure_noise';

            return 'noise_and_shuffle';
        };

        const maskTypeRaw = (document.getElementById('cipDefaultMaskType')?.value || 'noise_and_shuffle').toString();
        const maskType = normalizeCipMaskType(maskTypeRaw);
        const maskNoiseAmp = safeInt(document.getElementById('cipDefaultMaskNoiseAmp')?.value, 24, { min: 0, max: 128 });
        const maskBlockSize = safeInt(document.getElementById('cipDefaultMaskBlockSize')?.value, 12, { min: 1, max: 128 });

        return {
            mask_type: maskType,
            mask_noise_amp: maskNoiseAmp,
            mask_block_size: maskBlockSize,
            image_duration_ms: safeInt(document.getElementById('cipDefaultImageDurationMs')?.value, 750, { min: 0, max: 60000 }),
            transition_duration_ms: safeInt(document.getElementById('cipDefaultTransitionDurationMs')?.value, 250, { min: 0, max: 60000 }),
            transition_frames: safeInt(document.getElementById('cipDefaultTransitionFrames')?.value, 8, { min: 2, max: 60 }),
            choice_keys: (document.getElementById('cipDefaultChoiceKeys')?.value || 'f,j').toString().trim() || 'f,j'
        };
    }

    getContinuousImageDefaultsForNewComponent() {
        const d = this.getCurrentContinuousImageDefaults();
        return {
            image_duration_ms: d.image_duration_ms,
            transition_duration_ms: d.transition_duration_ms,
            transition_frames: d.transition_frames,
            choices: d.choice_keys
        };
    }

    getContinuousImageDefaultsForNewBlock() {
        const d = this.getCurrentContinuousImageDefaults();
        return {
            block_component_type: 'continuous-image-presentation',
            cip_mask_type: d.mask_type,
            cip_mask_noise_amp: d.mask_noise_amp,
            cip_mask_block_size: d.mask_block_size,
            cip_image_duration_ms: d.image_duration_ms,
            cip_transition_duration_ms: d.transition_duration_ms,
            cip_transition_frames: d.transition_frames,
            cip_choice_keys: d.choice_keys
        };
    }

    stopCipDefaultsPreview() {
        const timers = Array.isArray(this._cipPreviewTimeouts) ? this._cipPreviewTimeouts : [];
        for (const id of timers) {
            try {
                clearTimeout(id);
            } catch {
                // no-op
            }
        }
        this._cipPreviewTimeouts = [];

        const imageLayer = document.getElementById('cipPreviewImageLayer');
        const maskLayer = document.getElementById('cipPreviewMaskLayer');
        if (imageLayer) imageLayer.style.opacity = '0';
        if (maskLayer) maskLayer.style.opacity = '1';
    }

    renderCipPreviewMask(maskType) {
        const maskLayer = document.getElementById('cipPreviewMaskLayer');
        const canvas = document.getElementById('cipPreviewMaskCanvas');
        if (!maskLayer) return;

        const t = (maskType ?? '').toString().trim().toLowerCase();
        const isNoisyMask = (t === 'noise') || (t === 'pure_noise') || (t === 'noise_and_shuffle') || (t === 'advanced_transform');

        if (canvas && isNoisyMask) {
            canvas.style.display = 'block';
            const ctx = canvas.getContext && canvas.getContext('2d');
            if (ctx) {
                const w = canvas.width || 240;
                const h = canvas.height || 140;
                const img = ctx.createImageData(w, h);

                const rawAmp = Number.parseInt(document.getElementById('cipDefaultMaskNoiseAmp')?.value ?? '24', 10);
                const amp = Number.isFinite(rawAmp) ? Math.max(0, Math.min(128, rawAmp)) : 24;

                for (let i = 0; i < img.data.length; i += 4) {
                    const v = Math.max(0, Math.min(255, Math.round(128 + (Math.random() * 2 - 1) * amp)));
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

        if (t === 'blank') {
            maskLayer.style.backgroundImage = 'none';
            maskLayer.style.backgroundColor = '#000';
            return;
        }

        maskLayer.style.backgroundColor = '#111';
        maskLayer.style.backgroundSize = '20px 20px';
        maskLayer.style.backgroundImage = 'repeating-linear-gradient(45deg, rgba(255,255,255,0.12), rgba(255,255,255,0.12) 10px, rgba(255,255,255,0.02) 10px, rgba(255,255,255,0.02) 20px)';
    }

    playCipDefaultsPreview() {
        this.stopCipDefaultsPreview();

        const d = this.getCurrentContinuousImageDefaults();
        const preview = document.getElementById('cipDefaultsPreview');
        const imageLayer = document.getElementById('cipPreviewImageLayer');
        const maskLayer = document.getElementById('cipPreviewMaskLayer');

        if (!preview || !imageLayer || !maskLayer) {
            return;
        }

        this.renderCipPreviewMask(d.mask_type);

        const frames = Math.max(2, Number.parseInt(d.transition_frames ?? 8, 10) || 8);
        const transitionMs = Math.max(0, Number.parseInt(d.transition_duration_ms ?? 250, 10) || 250);
        const imageMs = Math.max(0, Number.parseInt(d.image_duration_ms ?? 750, 10) || 750);

        const stepMs = Math.max(1, Math.floor(transitionMs / frames));

        const setMix = (alphaImage) => {
            const a = Math.max(0, Math.min(1, alphaImage));
            imageLayer.style.opacity = `${a}`;
            maskLayer.style.opacity = `${1 - a}`;
        };

        const timeouts = [];

        for (let i = 0; i <= frames; i += 1) {
            const t = i * stepMs;
            timeouts.push(setTimeout(() => setMix(i / frames), t));
        }

        const afterTransition = frames * stepMs;
        timeouts.push(setTimeout(() => setMix(1), afterTransition));

        const afterHold = afterTransition + imageMs;
        timeouts.push(setTimeout(() => setMix(1), afterHold));

        for (let i = 0; i <= frames; i += 1) {
            const t = afterHold + i * stepMs;
            timeouts.push(setTimeout(() => setMix(1 - (i / frames)), t));
        }

        const end = afterHold + frames * stepMs;
        timeouts.push(setTimeout(() => setMix(0), end));

        this._cipPreviewTimeouts = timeouts;
    }

    getGaborDefaultsForNewComponent() {
        // Defaults panel values; used when adding new Gabor timeline items.
        const patchDiameterDeg = Number.parseFloat(document.getElementById('gaborPatchDiameterDeg')?.value || '6');
        return {
            response_task: document.getElementById('gaborResponseTask')?.value || 'discriminate_tilt',
            left_key: document.getElementById('gaborLeftKey')?.value || 'f',
            right_key: document.getElementById('gaborRightKey')?.value || 'j',
            yes_key: document.getElementById('gaborYesKey')?.value || 'f',
            no_key: document.getElementById('gaborNoKey')?.value || 'j',
            stimulus_duration_ms: parseInt(document.getElementById('gaborStimulusDurationMs')?.value || '67', 10),
            mask_duration_ms: parseInt(document.getElementById('gaborMaskDurationMs')?.value || '67', 10),
            spatial_frequency_cyc_per_px: Number.parseFloat(document.getElementById('gaborSpatialFrequency')?.value || '0.06'),
            grating_waveform: (document.getElementById('gaborGratingWaveform')?.value || 'sinusoidal').toString(),

            patch_diameter_deg: Number.isFinite(patchDiameterDeg) ? Math.max(0.1, patchDiameterDeg) : 6,

            patch_border_enabled: !!document.getElementById('gaborPatchBorderEnabled')?.checked,
            patch_border_width_px: Number.parseInt(document.getElementById('gaborPatchBorderWidthPx')?.value || '2', 10),
            patch_border_color: (document.getElementById('gaborPatchBorderColor')?.value || '#ffffff').toString(),
            patch_border_opacity: Number.parseFloat(document.getElementById('gaborPatchBorderOpacity')?.value || '0.22')
        };
    }

    getGaborDefaultsForNewBlock() {
        // Defaults panel values; used when adding new Block timeline items under the Gabor task.
        // These are editor-only block params that become parameter_values/parameter_windows on export.
        const stim = parseInt(document.getElementById('gaborStimulusDurationMs')?.value || '67', 10);
        const mask = parseInt(document.getElementById('gaborMaskDurationMs')?.value || '67', 10);

        const freq = Number.parseFloat(document.getElementById('gaborSpatialFrequency')?.value || '0.06');
        const safeFreq = Number.isFinite(freq) ? freq : 0.06;

        const pd = Number.parseFloat(document.getElementById('gaborPatchDiameterDeg')?.value || '6');
        const safePd = Number.isFinite(pd) ? Math.max(0.1, pd) : 6;

        return {
            gabor_response_task: document.getElementById('gaborResponseTask')?.value || 'discriminate_tilt',
            gabor_left_key: document.getElementById('gaborLeftKey')?.value || 'f',
            gabor_right_key: document.getElementById('gaborRightKey')?.value || 'j',
            gabor_yes_key: document.getElementById('gaborYesKey')?.value || 'f',
            gabor_no_key: document.getElementById('gaborNoKey')?.value || 'j',

            gabor_spatial_frequency_min: safeFreq,
            gabor_spatial_frequency_max: safeFreq,
            gabor_grating_waveform_options: (document.getElementById('gaborGratingWaveform')?.value || 'sinusoidal').toString(),

            gabor_patch_diameter_deg_min: safePd,
            gabor_patch_diameter_deg_max: safePd,

            gabor_patch_border_enabled: !!document.getElementById('gaborPatchBorderEnabled')?.checked,
            gabor_patch_border_width_px: Number.parseInt(document.getElementById('gaborPatchBorderWidthPx')?.value || '2', 10),
            gabor_patch_border_color: (document.getElementById('gaborPatchBorderColor')?.value || '#ffffff').toString(),
            gabor_patch_border_opacity: Number.parseFloat(document.getElementById('gaborPatchBorderOpacity')?.value || '0.22'),

            gabor_spatial_cue_enabled: !!document.getElementById('gaborSpatialCueEnabled')?.checked,
            gabor_spatial_cue_options: (document.getElementById('gaborSpatialCueOptions')?.value || 'none,left,right,both').toString(),
            gabor_spatial_cue_probability: Number.parseFloat(document.getElementById('gaborSpatialCueProbability')?.value || '1'),

            gabor_value_cue_enabled: !!document.getElementById('gaborValueCueEnabled')?.checked,
            gabor_left_value_options: (document.getElementById('gaborLeftValueOptions')?.value || 'neutral,high,low').toString(),
            gabor_right_value_options: (document.getElementById('gaborRightValueOptions')?.value || 'neutral,high,low').toString(),
            gabor_value_cue_probability: Number.parseFloat(document.getElementById('gaborValueCueProbability')?.value || '1'),

            gabor_adaptive_mode: 'none',
            gabor_quest_parameter: 'target_tilt_deg',
            gabor_quest_target_performance: 0.82,
            gabor_quest_start_value: 45,
            gabor_quest_start_sd: 20,
            gabor_quest_beta: 3.5,
            gabor_quest_delta: 0.01,
            gabor_quest_gamma: 0.5,
            gabor_quest_min_value: -90,
            gabor_quest_max_value: 90,
            gabor_stimulus_duration_min: Number.isFinite(stim) ? stim : 67,
            gabor_stimulus_duration_max: Number.isFinite(stim) ? stim : 67,
            gabor_mask_duration_min: Number.isFinite(mask) ? mask : 67,
            gabor_mask_duration_max: Number.isFinite(mask) ? mask : 67
        };
    }

    getDefaultTransitionSettings() {
        if (this.experimentType !== 'continuous') {
            return null;
        }

        const durationRaw = document.getElementById('defaultTransitionDuration')?.value;
        const typeRaw = document.getElementById('defaultTransitionType')?.value;

        const durationMs = (durationRaw !== undefined && durationRaw !== null && durationRaw !== '')
            ? parseInt(durationRaw)
            : 0;

        const type = (typeof typeRaw === 'string' && typeRaw.trim() !== '') ? typeRaw : 'both';
        return { duration_ms: Number.isFinite(durationMs) ? durationMs : 0, type };
    }

    getExperimentWideLengthCapForBlocks() {
        // Trial-based: cap is num_trials.
        if (this.experimentType === 'trial-based') {
            const raw = document.getElementById('numTrials')?.value;
            const n = Number.parseInt(raw ?? '', 10);
            return (Number.isFinite(n) && n > 0) ? n : null;
        }

        // Continuous: cap is total frames = duration (sec) * frame_rate.
        if (this.experimentType === 'continuous') {
            const durRaw = document.getElementById('duration')?.value;
            const frRaw = document.getElementById('frameRate')?.value;
            const durationSec = Number.parseFloat(durRaw ?? '');
            const frameRate = Number.parseFloat(frRaw ?? '60');
            if (!Number.isFinite(durationSec) || durationSec <= 0) return null;
            if (!Number.isFinite(frameRate) || frameRate <= 0) return null;
            return Math.max(1, Math.round(durationSec * frameRate));
        }

        return null;
    }

    getExperimentWideBlockLengthDefault() {
        return this.getExperimentWideLengthCapForBlocks() ?? 100;
    }

    findBlockLengthViolations(config) {
        const cap = this.getExperimentWideLengthCapForBlocks();
        if (!cap) return [];

        const timeline = Array.isArray(config?.timeline) ? config.timeline : [];
        const violations = [];

        for (const c of timeline) {
            if (!c || typeof c !== 'object') continue;
            if (c.type !== 'block') continue;

            const len = Number.parseInt(c.block_length ?? c.length ?? '', 10);
            if (!Number.isFinite(len)) continue;
            if (len <= cap) continue;

            const rawType = (c.block_component_type ?? c.component_type ?? 'unknown').toString();
            const safeType = rawType.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'unknown';
            violations.push(`Block (${safeType}) length ${len} exceeds experiment length ${cap}.`);
        }

        return violations;
    }

    /**
     * Get timeline components from DOM
     */
    getTimelineFromDOM() {
        const timelineContainer = document.getElementById('timelineComponents');
        if (!timelineContainer) {
            return [];
        }

        const components = [];
        const componentElements = timelineContainer.querySelectorAll('.timeline-component');
        
        componentElements.forEach(element => {
            try {
                const rawData = element.dataset.componentData || '{}';
                console.log('Raw component data from DOM:', rawData);
                
                const componentData = JSON.parse(rawData);
                console.log('Parsed component data:', componentData);

                // Defensive: if a save path accidentally dropped `type`, recover it from the
                // timeline element metadata so export/validation still works.
                if (!componentData.type) {
                    const fallbackType = element.dataset.componentType;
                    if (fallbackType) {
                        componentData.type = fallbackType;
                    }
                }
                
                const transformed = this.transformComponent(componentData);
                console.log('Transformed component:', transformed);
                
                components.push(transformed);
            } catch (e) {
                console.warn('Failed to parse component data:', e, element);
            }
        });

        const taskType = document.getElementById('taskType')?.value || 'rdm';
        if (taskType === 'soc-dashboard') {
            return this.composeSocDashboardTimeline(components);
        }

        return components;
    }

    composeSocDashboardTimeline(components) {
        const output = [];
        let currentSession = null;

        function extractSubtaskParams(component) {
            const raw = (component && typeof component === 'object') ? component : {};
            const fromNested = (raw.parameters && typeof raw.parameters === 'object') ? raw.parameters : null;
            const bag = fromNested || raw;

            const params = {};
            for (const [k, v] of Object.entries(bag)) {
                if (k === 'type' || k === 'name' || k === 'title' || k === 'parameters') continue;
                params[k] = v;
            }
            return params;
        }

        function isSocSubtaskType(t) {
            return t === 'soc-subtask-sart-like'
                || t === 'soc-subtask-flanker-like'
                || t === 'soc-subtask-nback-like'
                || t === 'soc-subtask-wcst-like'
                || t === 'soc-subtask-pvt-like';
        }

        function mapSocSubtaskKind(t) {
            switch (t) {
                case 'soc-subtask-sart-like': return 'sart-like';
                case 'soc-subtask-flanker-like': return 'flanker-like';
                case 'soc-subtask-nback-like': return 'nback-like';
                case 'soc-subtask-wcst-like': return 'wcst-like';
                case 'soc-subtask-pvt-like': return 'pvt-like';
                default: return 'unknown';
            }
        }

        for (const component of components) {
            if (!component || typeof component !== 'object') continue;

            if (component.type === 'soc-dashboard') {
                currentSession = component;
                if (!Array.isArray(currentSession.desktop_icons)) {
                    currentSession.desktop_icons = [];
                }
                if (!Array.isArray(currentSession.subtasks)) {
                    currentSession.subtasks = [];
                }
                output.push(currentSession);
                continue;
            }

            if (isSocSubtaskType(component.type)) {
                const subtask = {
                    type: mapSocSubtaskKind(component.type),
                    title: (component.title || component.name || 'Subtask').toString(),
                    ...extractSubtaskParams(component)
                };

                if (currentSession) {
                    currentSession.subtasks.push(subtask);
                } else {
                    // If there is no session yet, keep the component as-is so the
                    // user can spot the ordering problem.
                    output.push(component);
                }
                continue;
            }

            if (component.type === 'soc-dashboard-icon') {
                const icon = {
                    label: (component.label || component.name || 'Icon').toString(),
                    app: (component.app || 'soc').toString(),
                    icon_text: (component.icon_text || '').toString(),
                    row: Number.isFinite(Number(component.row)) ? parseInt(component.row, 10) : 0,
                    col: Number.isFinite(Number(component.col)) ? parseInt(component.col, 10) : 0,
                    distractor: !!component.distractor
                };

                if (currentSession) {
                    currentSession.desktop_icons.push(icon);
                } else {
                    // If there is no session yet, keep the component as-is so the
                    // user can spot the ordering problem.
                    output.push(component);
                }
                continue;
            }

            output.push(component);
        }

        return output;
    }

    /**
     * Transform component parameters for JSON output
     */
    transformComponent(component) {
        console.log('transformComponent called with:', component);
        console.log('component.type:', component.type);
        
        // Handle html-keyboard-response components (Instructions) differently
        if (component.type === 'html-keyboard-response') {
            // Instructions components store parameters directly on the component object
            const instructionsComponent = {
                type: component.type,
                stimulus: component.stimulus,
                choices: component.choices,
                prompt: component.prompt,
                stimulus_duration: component.stimulus_duration,
                trial_duration: component.trial_duration,
                response_ends_trial: component.response_ends_trial,
                data: component.data
            };
            
            // Remove undefined/null values to clean up the JSON
            Object.keys(instructionsComponent).forEach(key => {
                if (instructionsComponent[key] === undefined || instructionsComponent[key] === null) {
                    delete instructionsComponent[key];
                }
            });
            
            console.log('Transformed Instructions component:', instructionsComponent);
            return instructionsComponent;
        }
        
        // Handle other component types - check if they have nested or flat parameter structure
        let baseComponent;
        
        if (component.parameters && typeof component.parameters === 'object') {
            // Nested structure (like from addTrialToTimeline)
            console.log('Using nested structure for component:', component.type);
            baseComponent = {
                type: component.type,
                ...component.parameters
            };
        } else {
            // Flat structure (like from component library) - spread all properties except type and name
            console.log('Using flat structure for component:', component.type);
            const { type, name, ...parameters } = component;
            console.log('Extracted type:', type, 'name:', name, 'parameters:', parameters);
            baseComponent = {
                type: type,
                ...parameters
            };
        }

        console.log('Base component before RDM check:', baseComponent);

        // Back-compat: old configs may include this, but DRT is now handled via separate timeline items.
        if (baseComponent.detection_response_task_enabled !== undefined) {
            delete baseComponent.detection_response_task_enabled;
        }

        // Special handling for Block components (compact range/window representation)
        if (baseComponent.type === 'block') {
            return this.transformBlock(baseComponent);
        }

        // Note: rdm-dot-groups is handled later so it still benefits from
        // per-component response override generation/cleanup.

        // Per-component response overrides (RDM components)
        if (baseComponent.type && baseComponent.type.startsWith('rdm-')) {
            // Continuous-mode default transitions: apply if component doesn't specify
            if (this.experimentType === 'continuous') {
                const defaults = this.getDefaultTransitionSettings();
                if (defaults) {
                    if (baseComponent.transition_duration === undefined || baseComponent.transition_duration === null || baseComponent.transition_duration === '') {
                        baseComponent.transition_duration = defaults.duration_ms;
                    }
                    if (baseComponent.transition_type === undefined || baseComponent.transition_type === null || baseComponent.transition_type === '') {
                        baseComponent.transition_type = defaults.type;
                    }
                }
            } else {
                // Trial-based output should not include transition fields
                if ('transition_duration' in baseComponent) delete baseComponent.transition_duration;
                if ('transition_type' in baseComponent) delete baseComponent.transition_type;
            }

            const override = this.buildRDMResponseParametersOverride(baseComponent);
            if (override) {
                baseComponent.response_parameters_override = override;
            }

            // Remove editor-only override fields from exported component (kept in DOM dataset)
            [
                'response_device',
                'response_keys',
                'require_response_mode',
                'end_condition_on_response_mode',
                'feedback_mode',
                'feedback_duration_ms',
                'mouse_segments',
                'mouse_start_angle_deg',
                'mouse_selection_mode',
                'response_target_group',
                'cue_border_mode',
                'cue_border_color',
                'cue_border_width'
            ]
                .forEach(key => {
                    if (key in baseComponent) {
                        delete baseComponent[key];
                    }
                });

            // Keep aperture border (outline) params nested for clarity in hand-edited JSON.
            // Remove any flat fields to avoid confusion.
            const outline = {};

            // New editor shape: mode + width/color (only treat as override when mode is explicit true/false)
            if (baseComponent.show_aperture_outline_mode !== undefined) {
                const mode = (baseComponent.show_aperture_outline_mode ?? 'inherit').toString().trim().toLowerCase();
                delete baseComponent.show_aperture_outline_mode;

                if (mode === 'true' || mode === 'false') {
                    outline.show_aperture_outline = (mode === 'true');

                    const widthRaw = Number(baseComponent.aperture_outline_width);
                    if (Number.isFinite(widthRaw)) outline.aperture_outline_width = widthRaw;

                    const colorRaw = (typeof baseComponent.aperture_outline_color === 'string') ? baseComponent.aperture_outline_color.trim() : '';
                    if (colorRaw) outline.aperture_outline_color = colorRaw;
                }

                // These are editor-only fields; never export them flat.
                if (baseComponent.aperture_outline_width !== undefined) delete baseComponent.aperture_outline_width;
                if (baseComponent.aperture_outline_color !== undefined) delete baseComponent.aperture_outline_color;
            }

            // Legacy support: flat boolean + width/color
            if (baseComponent.show_aperture_outline !== undefined) {
                outline.show_aperture_outline = baseComponent.show_aperture_outline;
                delete baseComponent.show_aperture_outline;
            }
            if (baseComponent.aperture_outline_width !== undefined) {
                outline.aperture_outline_width = baseComponent.aperture_outline_width;
                delete baseComponent.aperture_outline_width;
            }
            if (baseComponent.aperture_outline_color !== undefined) {
                outline.aperture_outline_color = baseComponent.aperture_outline_color;
                delete baseComponent.aperture_outline_color;
            }
            if (Object.keys(outline).length > 0) {
                const ap = (baseComponent.aperture_parameters && typeof baseComponent.aperture_parameters === 'object')
                    ? baseComponent.aperture_parameters
                    : {};
                baseComponent.aperture_parameters = { ...ap, ...outline };
            }
        }

        // Special handling for RDM dot groups (after override generation)
        if (baseComponent.type === 'rdm-dot-groups') {
            baseComponent = this.transformRDMDotGroups(baseComponent);
            console.log('Transformed RDM dot groups:', baseComponent);
        }

        console.log('Final transformed component:', baseComponent);
        return baseComponent;
    }

    transformBlock(blockComponent) {
        const componentTypeRaw = (
            blockComponent.block_component_type
            || blockComponent.component_type
            || blockComponent.blockComponentType
            || blockComponent.componentType
            || 'rdm-trial'
        );
        const lengthRaw = blockComponent.block_length;
        const length = Math.max(1, parseInt(lengthRaw ?? 1));
        const samplingMode = blockComponent.sampling_mode || 'per-trial';

        // Block editors sometimes store values under `parameter_values`.
        // Prefer top-level keys when present (they reflect the current editor UI), but fall back to nested.
        const blockParams = (blockComponent && typeof blockComponent === 'object')
            ? ((blockComponent.parameter_values && typeof blockComponent.parameter_values === 'object')
                ? { ...blockComponent.parameter_values, ...blockComponent }
                : blockComponent)
            : {};

        // If the inner type wasn't on block_component_type, it may be stored in parameter_values/component_type.
        // Keep local componentType in sync for downstream branch selection.
        const innerTypeFromParams = (
            blockParams.block_component_type
            || blockParams.component_type
            || blockParams.blockComponentType
            || blockParams.componentType
            || null
        );
        const resolvedComponentType = (typeof innerTypeFromParams === 'string' && innerTypeFromParams.trim() !== '')
            ? innerTypeFromParams
            : componentTypeRaw;

        const isGaborQuestBlock = resolvedComponentType === 'gabor-quest';
        const exportComponentType = isGaborQuestBlock ? 'gabor-trial' : resolvedComponentType;

        const seedStr = (blockComponent.seed ?? '').toString().trim();
        const seed = seedStr === '' ? null : Number.parseInt(seedStr, 10);
        const hasSeed = Number.isFinite(seed);

        const windows = {};
        const values = {};

        const addWindow = (name, minVal, maxVal) => {
            const minNum = Number(minVal);
            const maxNum = Number(maxVal);
            if (!Number.isFinite(minNum) || !Number.isFinite(maxNum)) return;
            windows[name] = { min: minNum, max: maxNum };
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
            // de-dupe while preserving order
            return Array.from(new Set(nums));
        };

        if (resolvedComponentType === 'rdm-trial') {
            addWindow('coherence', blockComponent.coherence_min, blockComponent.coherence_max);
            addWindow('speed', blockComponent.speed_min, blockComponent.speed_max);

            const dirs = parseNumberList(blockComponent.direction_options, { min: 0, max: 359 });
            if (dirs.length > 0) {
                values.direction = dirs;
            }

            if (typeof blockComponent.dot_color === 'string' && blockComponent.dot_color.trim() !== '') {
                values.dot_color = blockComponent.dot_color;
            }
        } else if (resolvedComponentType === 'rdm-practice') {
            addWindow('coherence', blockComponent.practice_coherence_min, blockComponent.practice_coherence_max);
            addWindow('feedback_duration', blockComponent.practice_feedback_duration_min, blockComponent.practice_feedback_duration_max);

            const dirs = parseNumberList(blockComponent.practice_direction_options, { min: 0, max: 359 });
            if (dirs.length > 0) {
                values.direction = dirs;
            }

            if (typeof blockComponent.dot_color === 'string' && blockComponent.dot_color.trim() !== '') {
                values.dot_color = blockComponent.dot_color;
            }
        } else if (resolvedComponentType === 'rdm-adaptive') {
            addWindow('initial_coherence', blockComponent.adaptive_initial_coherence_min, blockComponent.adaptive_initial_coherence_max);
            addWindow('step_size', blockComponent.adaptive_step_size_min, blockComponent.adaptive_step_size_max);

            const algo = blockComponent.adaptive_algorithm;
            if (typeof algo === 'string' && algo.trim() !== '') {
                values.algorithm = algo;
            }
            const tp = Number(blockComponent.adaptive_target_performance);
            if (Number.isFinite(tp)) {
                values.target_performance = tp;
            }

            if (typeof blockComponent.dot_color === 'string' && blockComponent.dot_color.trim() !== '') {
                values.dot_color = blockComponent.dot_color;
            }
        } else if (resolvedComponentType === 'rdm-dot-groups') {
            addWindow('group_1_percentage', blockComponent.group_1_percentage_min, blockComponent.group_1_percentage_max);
            addWindow('group_1_coherence', blockComponent.group_1_coherence_min, blockComponent.group_1_coherence_max);
            addWindow('group_1_speed', blockComponent.group_1_speed_min, blockComponent.group_1_speed_max);

            addWindow('group_2_coherence', blockComponent.group_2_coherence_min, blockComponent.group_2_coherence_max);
            addWindow('group_2_speed', blockComponent.group_2_speed_min, blockComponent.group_2_speed_max);

            const g1Dirs = parseNumberList(blockComponent.group_1_direction_options, { min: 0, max: 359 });
            if (g1Dirs.length > 0) {
                values.group_1_direction = g1Dirs;
            }
            const g2Dirs = parseNumberList(blockComponent.group_2_direction_options, { min: 0, max: 359 });
            if (g2Dirs.length > 0) {
                values.group_2_direction = g2Dirs;
            }

            // Dot colors (for cue-border target-group-color and general group styling)
            const fallbackDotColor = (typeof blockComponent.dot_color === 'string' && blockComponent.dot_color.trim() !== '')
                ? blockComponent.dot_color
                : null;

            const g1Color = (typeof blockComponent.group_1_color === 'string' && blockComponent.group_1_color.trim() !== '')
                ? blockComponent.group_1_color
                : fallbackDotColor;
            const g2Color = (typeof blockComponent.group_2_color === 'string' && blockComponent.group_2_color.trim() !== '')
                ? blockComponent.group_2_color
                : fallbackDotColor;

            if (g1Color) values.group_1_color = g1Color;
            if (g2Color) values.group_2_color = g2Color;
        } else if (resolvedComponentType === 'flanker-trial') {
            // Generic task fields; interpreter defines how these are rendered/scored.
            const parseStringList = (raw) => {
                if (raw === undefined || raw === null) return [];
                return raw
                    .toString()
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean);
            };

            const congruency = parseStringList(blockComponent.flanker_congruency_options);
            if (congruency && congruency.length > 0) {
                values.congruency = Array.from(new Set(congruency));
            }

            const experimentStimType = (() => {
                const el = document.getElementById('flankerStimulusType');
                const v = (el && typeof el.value === 'string') ? el.value : null;
                const s = (v ?? 'arrows').toString().trim();
                return s || 'arrows';
            })();

            const stimType = (blockComponent.flanker_stimulus_type ?? experimentStimType).toString().trim();
            const stimTypeNorm = stimType.toLowerCase();
            const isArrows = (stimTypeNorm === '' || stimTypeNorm === 'arrows');
            if (stimType) {
                values.stimulus_type = stimType;
            }

            if (isArrows) {
                const dirs = parseStringList(blockComponent.flanker_target_direction_options);
                if (dirs && dirs.length > 0) {
                    values.target_direction = Array.from(new Set(dirs));
                }
            } else {
                const targetStim = parseStringList(blockComponent.flanker_target_stimulus_options);
                if (targetStim.length > 0) {
                    values.target_stimulus = Array.from(new Set(targetStim));
                }

                const distractorStim = parseStringList(blockComponent.flanker_distractor_stimulus_options);
                if (distractorStim.length > 0) {
                    values.distractor_stimulus = Array.from(new Set(distractorStim));
                }

                const neutralStim = parseStringList(blockComponent.flanker_neutral_stimulus_options);
                if (neutralStim.length > 0) {
                    values.neutral_stimulus = Array.from(new Set(neutralStim));
                }
            }

            const lk = (blockComponent.flanker_left_key ?? '').toString().trim();
            const rk = (blockComponent.flanker_right_key ?? '').toString().trim();
            if (lk) values.left_key = lk;
            if (rk) values.right_key = rk;

            values.show_fixation_dot = !!(blockComponent.flanker_show_fixation_dot ?? false);
            values.show_fixation_cross_between_trials = !!(blockComponent.flanker_show_fixation_cross_between_trials ?? false);

            addWindow('stimulus_duration_ms', blockComponent.flanker_stimulus_duration_min, blockComponent.flanker_stimulus_duration_max);
            addWindow('trial_duration_ms', blockComponent.flanker_trial_duration_min, blockComponent.flanker_trial_duration_max);
            addWindow('iti_ms', blockComponent.flanker_iti_min, blockComponent.flanker_iti_max);
        } else if (resolvedComponentType === 'sart-trial') {
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

            const digits = parseIntList(blockComponent.sart_digit_options);
            if (digits.length > 0) {
                values.digit = Array.from(new Set(digits));
            }

            const nogo = Number.parseInt(blockComponent.sart_nogo_digit, 10);
            if (Number.isFinite(nogo)) {
                values.nogo_digit = nogo;
            }

            const goKey = (blockComponent.sart_go_key ?? '').toString().trim();
            if (goKey) {
                values.go_key = goKey;
            }

            addWindow('stimulus_duration_ms', blockComponent.sart_stimulus_duration_min, blockComponent.sart_stimulus_duration_max);
            addWindow('mask_duration_ms', blockComponent.sart_mask_duration_min, blockComponent.sart_mask_duration_max);
            addWindow('trial_duration_ms', blockComponent.sart_trial_duration_min, blockComponent.sart_trial_duration_max);
            addWindow('iti_ms', blockComponent.sart_iti_min, blockComponent.sart_iti_max);
        } else if (resolvedComponentType === 'gabor-trial' || resolvedComponentType === 'gabor-quest' || resolvedComponentType === 'gabor-learning') {
            const parseStringList = (raw) => {
                if (raw === undefined || raw === null) return [];
                return raw
                    .toString()
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean);
            };

            const responseTask = (blockComponent.gabor_response_task ?? '').toString().trim();
            if (responseTask) {
                values.response_task = responseTask;
            }

            const lk = (blockComponent.gabor_left_key ?? '').toString().trim();
            const rk = (blockComponent.gabor_right_key ?? '').toString().trim();
            const yk = (blockComponent.gabor_yes_key ?? '').toString().trim();
            const nk = (blockComponent.gabor_no_key ?? '').toString().trim();
            if (lk) values.left_key = lk;
            if (rk) values.right_key = rk;
            if (yk) values.yes_key = yk;
            if (nk) values.no_key = nk;

            const locs = parseStringList(blockComponent.gabor_target_location_options);
            if (locs.length > 0) {
                values.target_location = Array.from(new Set(locs));
            }

            const tilts = parseNumberList(blockComponent.gabor_target_tilt_options, { min: -90, max: 90 });
            if (tilts.length > 0) {
                values.target_tilt_deg = Array.from(new Set(tilts));
            }

            const dis = parseNumberList(blockComponent.gabor_distractor_orientation_options, { min: 0, max: 179 });
            if (dis.length > 0) {
                values.distractor_orientation_deg = Array.from(new Set(dis));
            }

            const cues = parseStringList(blockComponent.gabor_spatial_cue_options);
            if (cues.length > 0) {
                values.spatial_cue = Array.from(new Set(cues));
            }

            if (blockComponent.gabor_spatial_cue_enabled !== undefined) {
                values.spatial_cue_enabled = !!blockComponent.gabor_spatial_cue_enabled;
            }
            const pSpatial = Number(blockComponent.gabor_spatial_cue_probability);
            if (Number.isFinite(pSpatial)) {
                values.spatial_cue_probability = Math.max(0, Math.min(1, pSpatial));
            }
            const pSpatialValidity = Number(blockComponent.gabor_spatial_cue_validity_probability);
            if (Number.isFinite(pSpatialValidity)) {
                values.spatial_cue_validity_probability = Math.max(0, Math.min(1, pSpatialValidity));
            }

            const lv = parseStringList(blockComponent.gabor_left_value_options);
            if (lv.length > 0) {
                values.left_value = Array.from(new Set(lv));
            }

            const rv = parseStringList(blockComponent.gabor_right_value_options);
            if (rv.length > 0) {
                values.right_value = Array.from(new Set(rv));
            }

            if (blockComponent.gabor_value_cue_enabled !== undefined) {
                values.value_cue_enabled = !!blockComponent.gabor_value_cue_enabled;
            }
            const pValue = Number(blockComponent.gabor_value_cue_probability);
            if (Number.isFinite(pValue)) {
                values.value_cue_probability = Math.max(0, Math.min(1, pValue));
            }

            const valueTarget = (blockComponent.gabor_value_target_value ?? '').toString().trim().toLowerCase();
            if (valueTarget === 'high' || valueTarget === 'low' || valueTarget === 'neutral' || valueTarget === 'any') {
                values.value_target_value = valueTarget;
            }

            const pRewardHigh = Number(blockComponent.gabor_reward_availability_high);
            if (Number.isFinite(pRewardHigh)) {
                values.reward_availability_high = Math.max(0, Math.min(1, pRewardHigh));
            }
            const pRewardLow = Number(blockComponent.gabor_reward_availability_low);
            if (Number.isFinite(pRewardLow)) {
                values.reward_availability_low = Math.max(0, Math.min(1, pRewardLow));
            }
            const pRewardNeutral = Number(blockComponent.gabor_reward_availability_neutral);
            if (Number.isFinite(pRewardNeutral)) {
                values.reward_availability_neutral = Math.max(0, Math.min(1, pRewardNeutral));
            }

            addWindow('spatial_frequency_cyc_per_px', blockComponent.gabor_spatial_frequency_min, blockComponent.gabor_spatial_frequency_max);
            addWindow('contrast', blockComponent.gabor_contrast_min, blockComponent.gabor_contrast_max);

            addWindow('patch_diameter_deg', blockComponent.gabor_patch_diameter_deg_min, blockComponent.gabor_patch_diameter_deg_max);

            const waveforms = parseStringList(blockComponent.gabor_grating_waveform_options);
            if (waveforms.length > 0) {
                values.grating_waveform = Array.from(new Set(waveforms));
            }

            if (blockComponent.gabor_patch_border_enabled !== undefined) {
                values.patch_border_enabled = !!blockComponent.gabor_patch_border_enabled;
            }
            const bw = Number(blockComponent.gabor_patch_border_width_px);
            if (Number.isFinite(bw)) {
                values.patch_border_width_px = Math.max(0, Math.min(50, bw));
            }
            const bc = (typeof blockComponent.gabor_patch_border_color === 'string')
                ? blockComponent.gabor_patch_border_color.trim()
                : '';
            if (bc) {
                values.patch_border_color = bc;
            }
            const bo = Number(blockComponent.gabor_patch_border_opacity);
            if (Number.isFinite(bo)) {
                values.patch_border_opacity = Math.max(0, Math.min(1, bo));
            }

            const adaptiveMode = isGaborQuestBlock
                ? 'quest'
                : (blockComponent.gabor_adaptive_mode ?? 'none').toString().trim();
            if (adaptiveMode === 'quest') {
                values.adaptive = {
                    mode: 'quest',
                    parameter: (blockComponent.gabor_quest_parameter ?? 'target_tilt_deg').toString(),
                    target_performance: Number(blockComponent.gabor_quest_target_performance),
                    start_value: Number(blockComponent.gabor_quest_start_value),
                    start_sd: Number(blockComponent.gabor_quest_start_sd),
                    beta: Number(blockComponent.gabor_quest_beta),
                    delta: Number(blockComponent.gabor_quest_delta),
                    gamma: Number(blockComponent.gabor_quest_gamma),
                    min_value: Number(blockComponent.gabor_quest_min_value),
                    max_value: Number(blockComponent.gabor_quest_max_value),
                    quest_trials_coarse: Number(blockComponent.gabor_quest_trials_coarse),
                    quest_trials_fine: Number(blockComponent.gabor_quest_trials_fine),
                    staircase_per_location: !!blockComponent.gabor_quest_staircase_per_location,
                    store_location_threshold: !!blockComponent.gabor_quest_store_location_threshold
                };

                // Clean up NaNs if the user left fields empty
                Object.keys(values.adaptive).forEach(k => {
                    const v = values.adaptive[k];
                    if (typeof v === 'number' && !Number.isFinite(v)) {
                        delete values.adaptive[k];
                    }
                });
            }

            // Learning block controls
            const streakLen = Number(blockComponent.gabor_learning_streak_length);
            if (Number.isFinite(streakLen)) values.learning_streak_length = Math.max(1, Math.round(streakLen));

            const targetAcc = Number(blockComponent.gabor_learning_target_accuracy);
            if (Number.isFinite(targetAcc)) values.learning_target_accuracy = Math.max(0, Math.min(1, targetAcc));

            const maxTrials = Number(blockComponent.gabor_learning_max_trials);
            if (Number.isFinite(maxTrials)) values.learning_max_trials = Math.max(1, Math.round(maxTrials));

            if (blockComponent.gabor_show_feedback !== undefined) {
                values.show_feedback = !!blockComponent.gabor_show_feedback;
            }

            const fbDur = Number(blockComponent.gabor_feedback_duration_ms);
            if (Number.isFinite(fbDur)) values.feedback_duration_ms = Math.max(0, Math.round(fbDur));

            addWindow('stimulus_duration_ms', blockComponent.gabor_stimulus_duration_min, blockComponent.gabor_stimulus_duration_max);
            addWindow('mask_duration_ms', blockComponent.gabor_mask_duration_min, blockComponent.gabor_mask_duration_max);
        }

        // Aperture border (outline) settings apply to all RDM-derived block component types.
        if (resolvedComponentType && resolvedComponentType.startsWith('rdm-')) {
            const modeRaw = (blockComponent.show_aperture_outline_mode ?? 'inherit').toString().trim();
            const widthRaw = Number(blockComponent.aperture_outline_width);
            const colorRaw = (typeof blockComponent.aperture_outline_color === 'string') ? blockComponent.aperture_outline_color.trim() : '';

            const hasWidth = Number.isFinite(widthRaw);
            const hasColor = colorRaw !== '';

            const ap = {};
            // Only emit a per-block override when the user explicitly chooses true/false.
            // (Width/color have defaults in the UI, so treating their presence as intent causes accidental overrides.)
            if (modeRaw === 'true' || modeRaw === 'false') {
                ap.show_aperture_outline = (modeRaw === 'true');
                if (hasWidth) ap.aperture_outline_width = widthRaw;
                if (hasColor) ap.aperture_outline_color = colorRaw;
            }

            if (Object.keys(ap).length > 0) {
                const existing = (values.aperture_parameters && typeof values.aperture_parameters === 'object')
                    ? values.aperture_parameters
                    : {};
                values.aperture_parameters = { ...existing, ...ap };
            }
        } else if (resolvedComponentType === 'stroop-trial') {
            const parseStringList = (raw) => {
                if (raw === undefined || raw === null) return [];
                return raw
                    .toString()
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean);
            };

            const words = parseStringList(blockComponent.stroop_word_options);
            if (words.length > 0) values.word = Array.from(new Set(words));

            // Ink colors are *named* entries from the experiment-wide stimulus palette.
            // Prefer the same stimulus list as words (palette-driven), but support legacy
            // stroop_ink_color_options if it exists in older configs.
            const legacyInks = parseStringList(blockComponent.stroop_ink_color_options);
            const inks = (legacyInks.length > 0) ? legacyInks : words;
            if (inks.length > 0) values.ink_color_name = Array.from(new Set(inks));

            const congr = parseStringList(blockComponent.stroop_congruency_options);
            if (congr.length > 0) values.congruency = Array.from(new Set(congr));

            const mode = (blockComponent.stroop_response_mode ?? 'inherit').toString().trim();
            if (mode && mode !== 'inherit') values.response_mode = mode;

            const dev = (blockComponent.stroop_response_device ?? 'inherit').toString().trim();
            if (dev && dev !== 'inherit') values.response_device = dev;

            // Only export response mappings when the block explicitly overrides to keyboard.
            // If the block inherits (or uses mouse), let experiment-wide stroop_settings drive mappings.
            if (dev === 'keyboard') {
                if (mode === 'congruency') {
                    const ck = (blockComponent.stroop_congruent_key ?? '').toString().trim();
                    const ik = (blockComponent.stroop_incongruent_key ?? '').toString().trim();
                    if (ck) values.congruent_key = ck;
                    if (ik) values.incongruent_key = ik;
                } else {
                    const choiceKeys = parseStringList(blockComponent.stroop_choice_keys);
                    if (choiceKeys.length > 0) values.choice_keys = choiceKeys;
                }
            }

            addWindow('stimulus_duration_ms', blockComponent.stroop_stimulus_duration_min, blockComponent.stroop_stimulus_duration_max);
            addWindow('trial_duration_ms', blockComponent.stroop_trial_duration_min, blockComponent.stroop_trial_duration_max);
            addWindow('iti_ms', blockComponent.stroop_iti_min, blockComponent.stroop_iti_max);
        } else if (resolvedComponentType === 'emotional-stroop-trial') {
            const parseStringList = (raw) => {
                if (raw === undefined || raw === null) return [];
                return raw
                    .toString()
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean);
            };

            const countRaw = Number.parseInt((blockComponent.emostroop_word_list_count ?? '2').toString(), 10);
            const count = Number.isFinite(countRaw) ? (countRaw === 3 ? 3 : 2) : 2;

            const lists = [];
            const l1Label = (blockComponent.emostroop_word_list_1_label ?? 'Neutral').toString().trim() || 'Neutral';
            const l1Words = parseStringList(blockComponent.emostroop_word_list_1_words);
            lists.push({ label: l1Label, words: l1Words });

            const l2Label = (blockComponent.emostroop_word_list_2_label ?? 'Negative').toString().trim() || 'Negative';
            const l2Words = parseStringList(blockComponent.emostroop_word_list_2_words);
            lists.push({ label: l2Label, words: l2Words });

            if (count === 3) {
                const l3Label = (blockComponent.emostroop_word_list_3_label ?? 'Positive').toString().trim() || 'Positive';
                const l3Words = parseStringList(blockComponent.emostroop_word_list_3_words);
                lists.push({ label: l3Label, words: l3Words });
            }

            values.word_lists = lists;

            // Back-compat / convenience: also export a flattened pool
            const wordsFlat = lists.flatMap((l) => Array.isArray(l.words) ? l.words : []);
            const legacyWords = (wordsFlat.length > 0) ? wordsFlat : parseStringList(blockComponent.emostroop_word_options);
            if (legacyWords.length > 0) values.word = Array.from(new Set(legacyWords));

            // Ink colors are named entries from the experiment-wide ink palette.
            const inks = parseStringList(blockComponent.emostroop_ink_color_options);
            if (inks.length > 0) values.ink_color_name = Array.from(new Set(inks));

            const dev = (blockComponent.emostroop_response_device ?? 'inherit').toString().trim();
            if (dev && dev !== 'inherit') values.response_device = dev;

            // Only export response mappings when the block explicitly overrides to keyboard.
            if (dev === 'keyboard') {
                const choiceKeys = parseStringList(blockComponent.emostroop_choice_keys);
                if (choiceKeys.length > 0) values.choice_keys = choiceKeys;
            }

            addWindow('stimulus_duration_ms', blockComponent.emostroop_stimulus_duration_min, blockComponent.emostroop_stimulus_duration_max);
            addWindow('trial_duration_ms', blockComponent.emostroop_trial_duration_min, blockComponent.emostroop_trial_duration_max);
            addWindow('iti_ms', blockComponent.emostroop_iti_min, blockComponent.emostroop_iti_max);
        } else if (resolvedComponentType === 'simon-trial') {
            const parseStringList = (raw) => {
                if (raw === undefined || raw === null) return [];
                return raw
                    .toString()
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean);
            };

            const colors = parseStringList(blockComponent.simon_color_options);
            if (colors.length > 0) values.stimulus_color_name = Array.from(new Set(colors));

            const sides = parseStringList(blockComponent.simon_side_options);
            if (sides.length > 0) values.stimulus_side = Array.from(new Set(sides));

            const dev = (blockComponent.simon_response_device ?? 'inherit').toString().trim();
            if (dev && dev !== 'inherit') values.response_device = dev;

            // Only export response mappings when the block explicitly overrides to keyboard.
            if (dev === 'keyboard') {
                const lk = (blockComponent.simon_left_key ?? '').toString().trim();
                const rk = (blockComponent.simon_right_key ?? '').toString().trim();
                if (lk) values.left_key = lk;
                if (rk) values.right_key = rk;
            }

            addWindow('stimulus_duration_ms', blockComponent.simon_stimulus_duration_min, blockComponent.simon_stimulus_duration_max);
            addWindow('trial_duration_ms', blockComponent.simon_trial_duration_min, blockComponent.simon_trial_duration_max);
            addWindow('iti_ms', blockComponent.simon_iti_min, blockComponent.simon_iti_max);
        } else if (resolvedComponentType === 'task-switching-trial') {
            const trialType = (blockComponent.ts_trial_type ?? '').toString().trim();
            if (trialType) {
                const tt = trialType.toLowerCase();
                values.trial_type = (tt === 'single') ? 'single' : 'switch';
            }

            const singleTaskIndex = Number.parseInt(blockComponent.ts_single_task_index, 10);
            if (Number.isFinite(singleTaskIndex)) {
                values.single_task_index = (singleTaskIndex === 2) ? 2 : 1;
            }

            const cueType = (blockComponent.ts_cue_type ?? '').toString().trim();
            if (cueType) {
                const ct = cueType.toLowerCase();
                values.cue_type = (ct === 'position' || ct === 'color' || ct === 'explicit') ? ct : 'explicit';
            }

            const t1Pos = (blockComponent.ts_task_1_position ?? '').toString().trim();
            const t2Pos = (blockComponent.ts_task_2_position ?? '').toString().trim();
            if (t1Pos) values.task_1_position = t1Pos;
            if (t2Pos) values.task_2_position = t2Pos;

            const t1Color = (blockComponent.ts_task_1_color_hex ?? '').toString().trim();
            const t2Color = (blockComponent.ts_task_2_color_hex ?? '').toString().trim();
            if (t1Color) values.task_1_color_hex = t1Color;
            if (t2Color) values.task_2_color_hex = t2Color;

            const t1Cue = (blockComponent.ts_task_1_cue_text ?? '').toString();
            const t2Cue = (blockComponent.ts_task_2_cue_text ?? '').toString();
            if (t1Cue.trim() !== '') values.task_1_cue_text = t1Cue;
            if (t2Cue.trim() !== '') values.task_2_cue_text = t2Cue;

            const cueFont = Number.parseInt(blockComponent.ts_cue_font_size_px, 10);
            if (Number.isFinite(cueFont)) values.cue_font_size_px = Math.max(8, Math.min(96, cueFont));

            const cueDur = Number.parseInt(blockComponent.ts_cue_duration_ms, 10);
            if (Number.isFinite(cueDur)) values.cue_duration_ms = Math.max(0, cueDur);

            const cueGap = Number.parseInt(blockComponent.ts_cue_gap_ms, 10);
            if (Number.isFinite(cueGap)) values.cue_gap_ms = Math.max(0, cueGap);

            const cueColor = (blockComponent.ts_cue_color_hex ?? '').toString().trim();
            if (cueColor) values.cue_color_hex = cueColor;

            const stimPos = (blockComponent.ts_stimulus_position ?? '').toString().trim();
            if (stimPos) values.stimulus_position = stimPos;

            const stimColor = (blockComponent.ts_stimulus_color_hex ?? '').toString().trim();
            if (stimColor) values.stimulus_color_hex = stimColor;

            if (blockComponent.ts_border_enabled !== undefined) {
                values.border_enabled = !!blockComponent.ts_border_enabled;
            }

            const lk = (blockComponent.ts_left_key ?? '').toString().trim();
            const rk = (blockComponent.ts_right_key ?? '').toString().trim();
            if (lk) values.left_key = lk;
            if (rk) values.right_key = rk;

            addWindow('stimulus_duration_ms', blockComponent.ts_stimulus_duration_min, blockComponent.ts_stimulus_duration_max);
            addWindow('trial_duration_ms', blockComponent.ts_trial_duration_min, blockComponent.ts_trial_duration_max);
            addWindow('iti_ms', blockComponent.ts_iti_min, blockComponent.ts_iti_max);
        } else if (resolvedComponentType === 'pvt-trial') {
            const dev = (blockComponent.pvt_response_device ?? 'inherit').toString().trim();
            if (dev && dev !== 'inherit') values.response_device = dev;

            const usesKeyboard = (dev === 'keyboard' || dev === 'both');
            if (usesKeyboard) {
                const key = (blockComponent.pvt_response_key ?? '').toString().trim();
                if (key) values.response_key = key;
            }

            addWindow('foreperiod_ms', blockComponent.pvt_foreperiod_min, blockComponent.pvt_foreperiod_max);
            addWindow('trial_duration_ms', blockComponent.pvt_trial_duration_min, blockComponent.pvt_trial_duration_max);
            addWindow('iti_ms', blockComponent.pvt_iti_min, blockComponent.pvt_iti_max);
        } else if (resolvedComponentType === 'mot-trial') {
            const parseIntCSV = (raw) => {
                if (raw === undefined || raw === null) return [];
                return raw.toString().split(',').map(s => s.trim()).filter(Boolean)
                    .map(s => Number.parseInt(s, 10)).filter(n => Number.isFinite(n));
            };
            const nums = parseIntCSV(blockComponent.mot_num_objects_options);
            if (nums.length > 0) values.num_objects = Array.from(new Set(nums));
            const tgts = parseIntCSV(blockComponent.mot_num_targets_options);
            if (tgts.length > 0) values.num_targets = Array.from(new Set(tgts));
            const mtype = (blockComponent.mot_motion_type ?? '').toString().trim();
            if (mtype) values.motion_type = mtype;
            const pm = (blockComponent.mot_probe_mode ?? '').toString().trim();
            if (pm) values.probe_mode = pm;
            if (blockComponent.mot_show_feedback !== undefined) {
                values.show_feedback = !!blockComponent.mot_show_feedback;
            }
            addWindow('speed_px_per_s', blockComponent.mot_speed_px_per_s_min, blockComponent.mot_speed_px_per_s_max);
            addWindow('tracking_duration_ms', blockComponent.mot_tracking_duration_ms_min, blockComponent.mot_tracking_duration_ms_max);
            addWindow('cue_duration_ms', blockComponent.mot_cue_duration_ms_min, blockComponent.mot_cue_duration_ms_max);
            addWindow('iti_ms', blockComponent.mot_iti_ms_min, blockComponent.mot_iti_ms_max);
        } else if (resolvedComponentType === 'html-keyboard-response') {
            const stim = (blockComponent.stimulus_html ?? blockComponent.stimulus ?? '').toString();
            if (stim.trim() !== '') {
                values.stimulus_html = stim;
            }
            const prompt = (blockComponent.prompt ?? '').toString();
            if (prompt.trim() !== '') {
                values.prompt = prompt;
            }
            const choices = (blockComponent.choices ?? '').toString().trim();
            if (choices !== '') {
                values.choices = choices;
            }
        } else if (resolvedComponentType === 'html-button-response') {
            const stim = (blockComponent.stimulus_html ?? blockComponent.stimulus ?? '').toString();
            if (stim.trim() !== '') {
                values.stimulus_html = stim;
            }
            const prompt = (blockComponent.prompt ?? '').toString();
            if (prompt.trim() !== '') {
                values.prompt = prompt;
            }
            const btnChoices = (blockComponent.button_choices ?? blockComponent.choices ?? '').toString().trim();
            if (btnChoices !== '') {
                // Interpreter accepts either `choices` or `button_choices`.
                values.choices = btnChoices;
            }
            const btnHtml = (blockComponent.button_html ?? '').toString();
            if (btnHtml.trim() !== '') {
                values.button_html = btnHtml;
            }
        } else if (resolvedComponentType === 'image-keyboard-response') {
            const img = (blockComponent.stimulus_image ?? blockComponent.stimulus ?? '').toString().trim();
            if (img !== '') {
                values.stimulus_image = img;
            }
            const imgsRaw = (blockComponent.stimulus_images ?? '').toString();
            if (imgsRaw.trim() !== '') {
                values.stimulus_images = imgsRaw;
            }
            const prompt = (blockComponent.prompt ?? '').toString();
            if (prompt.trim() !== '') {
                values.prompt = prompt;
            }
            const choices = (blockComponent.choices ?? '').toString().trim();
            if (choices !== '') {
                values.choices = choices;
            }
        } else if (resolvedComponentType === 'continuous-image-presentation') {
            // Continuous Image Presentation (CIP): export the per-block cip_* fields, including hidden URL lists.
            // IMPORTANT: the Interpreter consumes these from block.parameter_values (not from top-level config defaults).
            const safeInt = (raw, fallback = null, { min = null, max = null } = {}) => {
                if (raw === undefined || raw === null || raw === '') return fallback;
                const v = Number.parseInt(raw, 10);
                if (!Number.isFinite(v)) return fallback;
                const clampedMin = (min === null) ? v : Math.max(min, v);
                return (max === null) ? clampedMin : Math.min(max, clampedMin);
            };

            const safeStr = (raw) => (raw === undefined || raw === null) ? '' : raw.toString();

            // Always include these keys (even if empty) so JSON preview/export reflects true state.
            values.cip_asset_code = safeStr(blockParams.cip_asset_code).trim();
            values.cip_mask_type = safeStr(blockParams.cip_mask_type).trim() || 'noise_and_shuffle';
            values.cip_mask_noise_amp = safeInt(blockParams.cip_mask_noise_amp, 24, { min: 0, max: 128 });
            values.cip_mask_block_size = safeInt(blockParams.cip_mask_block_size, 12, { min: 1, max: 128 });
            values.cip_repeat_mode = safeStr(blockParams.cip_repeat_mode).trim() || 'no_repeats';
            values.cip_images_per_block = safeInt(blockParams.cip_images_per_block, 0, { min: 0, max: 50000 });

            values.cip_image_duration_ms = safeInt(blockParams.cip_image_duration_ms, 750, { min: 0, max: 60000 });
            values.cip_transition_duration_ms = safeInt(blockParams.cip_transition_duration_ms, 250, { min: 0, max: 60000 });
            values.cip_transition_frames = safeInt(blockParams.cip_transition_frames, 8, { min: 2, max: 60 });
            values.cip_choice_keys = safeStr(blockParams.cip_choice_keys).trim() || 'f,j';

            values.cip_asset_filenames = safeStr(blockParams.cip_asset_filenames);

            // Hidden/persisted lists (populated by the CIP asset modal)
            values.cip_image_urls = safeStr(blockParams.cip_image_urls);
            values.cip_mask_to_image_sprite_urls = safeStr(blockParams.cip_mask_to_image_sprite_urls);
            values.cip_image_to_mask_sprite_urls = safeStr(blockParams.cip_image_to_mask_sprite_urls);
        }

        const out = {
            type: 'block',
            component_type: exportComponentType,
            length: length,
            sampling_mode: samplingMode,
            parameter_windows: windows
        };

        if (Object.keys(values).length > 0) {
            out.parameter_values = values;
        }

        // Continuous-mode transitions for generated trials (fixed per block)
        if (this.experimentType === 'continuous' && resolvedComponentType !== 'continuous-image-presentation') {
            const defaults = this.getDefaultTransitionSettings();
            const duration = (blockComponent.transition_duration !== undefined && blockComponent.transition_duration !== null && blockComponent.transition_duration !== '')
                ? parseInt(blockComponent.transition_duration)
                : (defaults?.duration_ms ?? 0);

            const type = (typeof blockComponent.transition_type === 'string' && blockComponent.transition_type.trim() !== '')
                ? blockComponent.transition_type
                : (defaults?.type ?? 'both');

            out.parameter_values = out.parameter_values || {};
            out.parameter_values.transition_duration = Number.isFinite(duration) ? duration : 0;
            out.parameter_values.transition_type = type;
        }

        // Optional per-block response override
        if (resolvedComponentType && resolvedComponentType.startsWith('rdm-')) {
            const override = this.buildRDMResponseParametersOverride(blockComponent);
            if (override) {
                out.response_parameters_override = override;
            }
        }

        if (hasSeed) {
            out.seed = seed;
        }

        return out;
    }

    /**
     * Build per-component response override by inheriting experiment defaults
     * and applying any component-specific overrides.
     */
    buildRDMResponseParametersOverride(componentParams) {
        const responseDevice = componentParams.response_device;
        const responseKeys = componentParams.response_keys;
        const requireMode = componentParams.require_response_mode;

        // Continuous-only behavior override
        const endConditionMode = componentParams.end_condition_on_response_mode;

        // Feedback override
        const feedbackMode = componentParams.feedback_mode;
        const feedbackDurationRaw = componentParams.feedback_duration_ms;

        // Dot-groups target + cue border
        const responseTargetGroup = componentParams.response_target_group ?? componentParams.custom_response ?? componentParams.customResponse;
        const cueBorderMode = componentParams.cue_border_mode;
        const cueBorderColor = componentParams.cue_border_color;
        const cueBorderWidth = componentParams.cue_border_width;

        const hasDeviceOverride = typeof responseDevice === 'string' && responseDevice !== '' && responseDevice !== 'inherit';
        const hasKeysOverride = typeof responseKeys === 'string' && responseKeys.trim() !== '';
        const hasRequireOverride = typeof requireMode === 'string' && requireMode !== '' && requireMode !== 'inherit';
        const hasEndConditionOverride = (
            this.experimentType === 'continuous' &&
            typeof endConditionMode === 'string' &&
            endConditionMode !== '' &&
            endConditionMode !== 'inherit'
        );
        const hasFeedbackOverride = typeof feedbackMode === 'string' && feedbackMode !== '' && feedbackMode !== 'inherit';
        const hasMouseOverride = (
            responseDevice === 'mouse' &&
            (componentParams.mouse_segments !== undefined || componentParams.mouse_start_angle_deg !== undefined || componentParams.mouse_selection_mode !== undefined)
        );

        const hasTargetOverride = typeof responseTargetGroup === 'string' && responseTargetGroup !== '' && responseTargetGroup !== 'none';
        const hasCueOverride = typeof cueBorderMode === 'string' && cueBorderMode !== '' && cueBorderMode !== 'off';

        if (!hasDeviceOverride && !hasKeysOverride && !hasRequireOverride && !hasEndConditionOverride && !hasFeedbackOverride && !hasMouseOverride && !hasTargetOverride && !hasCueOverride) {
            return null;
        }

        // Start from experiment-wide defaults
        const defaults = this.getRDMResponseParameters();
        const merged = JSON.parse(JSON.stringify(defaults));

        // Apply device override
        if (hasDeviceOverride) {
            merged.response_device = responseDevice;
        }

        // Apply require_response override
        if (hasRequireOverride) {
            merged.require_response = requireMode === 'true';
        }

        // Apply continuous-only end condition behavior
        if (hasEndConditionOverride) {
            merged.end_condition_on_response = endConditionMode === 'true';
        }

        // Apply feedback override
        if (hasFeedbackOverride) {
            if (feedbackMode === 'off') {
                if (merged.feedback) {
                    delete merged.feedback;
                }
            } else {
                const duration = (feedbackDurationRaw !== undefined && feedbackDurationRaw !== null && feedbackDurationRaw !== '')
                    ? parseInt(feedbackDurationRaw)
                    : (merged.feedback?.duration_ms ?? 500);

                merged.feedback = {
                    enabled: true,
                    type: feedbackMode,
                    duration_ms: Number.isFinite(duration) ? duration : 500
                };
            }
        }

        const effectiveDevice = merged.response_device || 'keyboard';

        // Apply key overrides (keyboard only)
        if (effectiveDevice === 'keyboard' && hasKeysOverride) {
            const choices = responseKeys.split(',').map(k => k.trim()).filter(Boolean);
            merged.choices = choices;
            merged.key_mapping = {
                [choices[0] || 'f']: 'left',
                [choices[1] || 'j']: 'right'
            };
        }

        // If not keyboard, remove keyboard-only fields inherited from defaults.
        if (effectiveDevice !== 'keyboard') {
            if (merged.choices) delete merged.choices;
            if (merged.key_mapping) delete merged.key_mapping;
        }

        // Apply mouse overrides
        if (effectiveDevice === 'mouse') {
            merged.mouse_response = {
                enabled: true,
                mode: 'aperture-segments',
                segments: parseInt(componentParams.mouse_segments ?? merged.mouse_response?.segments ?? 2),
                start_angle_deg: parseFloat(componentParams.mouse_start_angle_deg ?? merged.mouse_response?.start_angle_deg ?? 0),
                selection_mode: componentParams.mouse_selection_mode ?? merged.mouse_response?.selection_mode ?? 'click'
            };
        } else {
            // Keep output clean if not a mouse-response component
            if (merged.mouse_response) {
                delete merged.mouse_response;
            }
        }

        // Apply dot-group target + cue border (if present)
        if (hasTargetOverride) {
            merged.target_group = responseTargetGroup;
        }

        const resolvedCue = this.resolveCueBorderFromComponent(componentParams, merged);
        if (resolvedCue) {
            merged.cue_border = resolvedCue;
        }

        return merged;
    }

    resolveCueBorderFromComponent(componentParams, mergedResponseParams) {
        const target = componentParams.response_target_group ?? componentParams.custom_response ?? componentParams.customResponse;
        const mode = componentParams.cue_border_mode;

        if (!target || target === 'none' || !mode || mode === 'off') {
            return null;
        }

        const width = parseInt(componentParams.cue_border_width ?? 4);

        let color;
        if (mode === 'custom') {
            color = componentParams.cue_border_color || '#FFFFFF';
        } else if (mode === 'target-group-color') {
            if (target === 'group_1') {
                color = componentParams.group_1_color || '#FF0066';
            } else if (target === 'group_2') {
                color = componentParams.group_2_color || '#0066FF';
            } else {
                // Fallback for unexpected targets
                color = '#FFFFFF';
            }
        } else {
            return null;
        }

        return {
            enabled: true,
            mode,
            target_group: target,
            color,
            width
        };
    }

    /**
     * Transform flat RDM dot groups parameters to nested structure
     */
    transformRDMDotGroups(component) {
        const transformed = {
            type: component.type
        };

        // DRT is configured via separate timeline items; do not export per-component flags.

        // Preserve response override if it was generated upstream
        if (component.response_parameters_override) {
            transformed.response_parameters_override = component.response_parameters_override;
        }

        // Preserve nested aperture parameters if present (e.g., aperture outline fields)
        if (component.aperture_parameters && typeof component.aperture_parameters === 'object') {
            transformed.aperture_parameters = { ...component.aperture_parameters };
        }

        // Group configuration
        transformed.group_1_percentage = (component.group_1_percentage ?? 50);
        transformed.group_1_color = component.group_1_color ?? '#FF0066';
        transformed.group_1_coherence = (component.group_1_coherence ?? 0.2);
        if (component.group_1_direction !== undefined) transformed.group_1_direction = component.group_1_direction;

        // Optional per-group speeds
        if (component.group_1_speed !== undefined && component.group_1_speed !== null && component.group_1_speed !== '') {
            transformed.group_1_speed = component.group_1_speed;
        }

        transformed.group_2_percentage = (component.group_2_percentage ?? 50);
        transformed.group_2_color = component.group_2_color ?? '#0066FF';
        transformed.group_2_coherence = (component.group_2_coherence ?? 0.8);
        if (component.group_2_direction !== undefined) transformed.group_2_direction = component.group_2_direction;

        if (component.group_2_speed !== undefined && component.group_2_speed !== null && component.group_2_speed !== '') {
            transformed.group_2_speed = component.group_2_speed;
        }

        // Common dot-groups parameters from schema
        if (component.total_dots !== undefined) transformed.total_dots = component.total_dots;
        if (component.aperture_diameter !== undefined) transformed.aperture_diameter = component.aperture_diameter;
        if (component.trial_duration !== undefined) transformed.trial_duration = component.trial_duration;
        if (component.transition_duration !== undefined) transformed.transition_duration = component.transition_duration;

        return transformed;
    }

    /**
     * Get RDM display parameters from UI - SIMPLIFIED
     */
    getRDMDisplayParameters() {
        return {
            canvas_width: parseInt(document.getElementById('canvasWidth')?.value || 600),
            canvas_height: parseInt(document.getElementById('canvasHeight')?.value || 600),
            background_color: "#404040"
        };
    }

    /**
     * Get RDM aperture parameters from UI
     */
    getRDMApertureParameters() {
        const expAperture = (this.currentExperiment && typeof this.currentExperiment === 'object' && this.currentExperiment.aperture_parameters && typeof this.currentExperiment.aperture_parameters === 'object')
            ? this.currentExperiment.aperture_parameters
            : {};

        const out = {
            shape: document.getElementById('apertureShape')?.value || 'circle',
            diameter: parseInt(document.getElementById('apertureDiameter')?.value || 350),
            center_x: parseInt(document.getElementById('canvasWidth')?.value || 600) / 2,
            center_y: parseInt(document.getElementById('canvasHeight')?.value || 600) / 2
        };

        // Experiment-wide aperture outline controls
        const enabledEl = document.getElementById('apertureOutlineEnabled');
        if (enabledEl) {
            out.show_aperture_outline = !!enabledEl.checked;
        } else if (expAperture.show_aperture_outline !== undefined) {
            // Back-compat when loading older templates or if UI isn't present
            out.show_aperture_outline = expAperture.show_aperture_outline;
        }

        const widthEl = document.getElementById('apertureOutlineWidth');
        if (widthEl && widthEl.value !== '' && widthEl.value !== null && widthEl.value !== undefined) {
            const w = Number(widthEl.value);
            if (Number.isFinite(w)) out.aperture_outline_width = w;
        } else if (expAperture.aperture_outline_width !== undefined) {
            out.aperture_outline_width = expAperture.aperture_outline_width;
        }

        const colorEl = document.getElementById('apertureOutlineColor');
        if (colorEl && typeof colorEl.value === 'string' && colorEl.value.trim() !== '') {
            out.aperture_outline_color = colorEl.value.trim();
        } else if (expAperture.aperture_outline_color !== undefined) {
            out.aperture_outline_color = expAperture.aperture_outline_color;
        }

        return out;
    }

    /**
     * Get RDM dot parameters from UI including groups
     */
    getRDMDotParameters() {
        const params = {
            total_dots: parseInt(document.getElementById('totalDots')?.value || 150),
            dot_size: parseInt(document.getElementById('dotSize')?.value || 4),
            dot_color: document.getElementById('dotColor')?.value || '#FFFFFF',
            lifetime_frames: parseInt(document.getElementById('dotLifetime')?.value || 60)
        };

        // Add dot groups configuration if enabled
        const groupsConfig = this.getDotGroupsConfiguration();
        if (groupsConfig) {
            params.groups = groupsConfig;
        }

        return params;
    }

    /**
     * Get RDM motion parameters from UI
     */
    getRDMMotionParameters() {
        return {
            coherence: parseFloat(document.getElementById('motionCoherence')?.value || 0.5),
            direction: parseInt(document.getElementById('motionDirection')?.value || 0),
            speed: parseInt(document.getElementById('motionSpeed')?.value || 6),
            noise_type: document.getElementById('noiseType')?.value || 'random_direction'
        };
    }

    /**
     * Get RDM timing parameters from UI
     */
    getRDMTimingParameters() {
        return {
            fixation_duration: parseInt(document.getElementById('fixationDuration')?.value || 500),
            stimulus_duration: parseInt(document.getElementById('stimulusDuration')?.value || 1500),
            response_deadline: parseInt(document.getElementById('responseDeadline')?.value || 2500),
            inter_trial_interval: parseInt(document.getElementById('interTrialInterval')?.value || 1200)
        };
    }

    /**
     * Get RDM response parameters from UI
     */
    getRDMResponseParameters() {
        const requireResponse = document.getElementById('requireResponse')?.checked !== false;

        const responseDevice = document.getElementById('defaultResponseDevice')?.value || 'keyboard';
        
        const responseParams = {
            require_response: requireResponse,
            response_device: responseDevice
        };

        // Continuous-only: response ends condition
        if (this.experimentType === 'continuous') {
            const endOnResponse = document.getElementById('endConditionOnResponse')?.checked === true;
            responseParams.end_condition_on_response = endOnResponse;
        }

        // Optional feedback (works in either mode; interpretation is up to runtime)
        const feedbackType = document.getElementById('defaultFeedbackType')?.value || 'off';
        if (feedbackType !== 'off') {
            const durationRaw = document.getElementById('defaultFeedbackDuration')?.value;
            const duration = (durationRaw !== undefined && durationRaw !== null && durationRaw !== '') ? parseInt(durationRaw) : 500;
            responseParams.feedback = {
                enabled: true,
                type: feedbackType,
                duration_ms: Number.isFinite(duration) ? duration : 500
            };
        }

        // Only include keyboard keys/mapping when keyboard is the active response device.
        if (responseDevice === 'keyboard') {
            const keysValue = document.getElementById('responseKeys')?.value || 'f,j';
            const choices = keysValue.split(',').map(key => key.trim()).filter(Boolean);
            responseParams.choices = choices;
            responseParams.key_mapping = {
                [choices[0] || 'f']: 'left',
                [choices[1] || 'j']: 'right'
            };
        }

        if (responseDevice === 'mouse') {
            responseParams.mouse_response = {
                enabled: true,
                mode: 'aperture-segments',
                segments: parseInt(document.getElementById('mouseApertureSegments')?.value || 2),
                start_angle_deg: parseFloat(document.getElementById('mouseSegmentStartAngle')?.value || 0),
                selection_mode: document.getElementById('mouseSelectionMode')?.value || 'click'
            };
        }

        if (responseDevice === 'touch') {
            responseParams.touch_response = {
                enabled: true
            };
        }

        if (responseDevice === 'voice') {
            responseParams.voice_response = {
                enabled: true
            };
        }

        return responseParams;
    }

    /**
     * Get dot groups configuration from UI
     */
    getDotGroupsConfiguration() {
        // This method should be available from the HTML script section
        if (typeof window !== 'undefined' && window.getDotGroupsConfiguration) {
            return window.getDotGroupsConfiguration();
        }
        return null;
    }

    /**
     * Add basic JSON syntax highlighting
     */
    highlightJSON(json) {
        // Important: JSON Preview is rendered via innerHTML.
        // Escape HTML-sensitive characters first so that HTML embedded in JSON string
        // values (e.g., Instructions stimulus) is shown literally and not interpreted.
        const escaped = String(json)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        return escaped
            .replace(/("([^"\\]|\\.)*")\s*:/g, '<span class="json-key">$1</span>:')
            .replace(/:\s*("([^"\\]|\\.)*")/g, ': <span class="json-string">$1</span>')
            .replace(/:\s*(\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
            .replace(/:\s*(true|false)/g, ': <span class="json-boolean">$1</span>')
            .replace(/:\s*(null)/g, ': <span class="json-null">$1</span>');
    }

    /**
     * Validate JSON configuration
     */
    validateJSON() {
        try {
            const config = this.generateJSON();
            const validation = this.schemaValidator.validate(config);

            const blockLengthErrors = this.findBlockLengthViolations(config);
            
            if (validation.valid && blockLengthErrors.length === 0) {
                this.showValidationResult('success', 'Configuration is valid!');
            } else {
                const allErrors = [];
                if (!validation.valid) {
                    allErrors.push(...(validation.errors || []));
                }
                if (blockLengthErrors.length > 0) {
                    allErrors.push(...blockLengthErrors);
                }
                this.showValidationResult('error', `Validation errors: ${allErrors.join(' | ')}`);
            }
        } catch (error) {
            this.showValidationResult('error', `Validation failed: ${error.message}`);
        }
    }

    /**
     * Show validation result
     */
    showValidationResult(type, message) {
        // Create temporary alert
        const alert = document.createElement('div');
        alert.className = `alert alert-${type === 'success' ? 'success' : 'danger'} alert-dismissible fade show position-fixed`;
        alert.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
        alert.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        
        document.body.appendChild(alert);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (alert.parentNode) {
                alert.remove();
            }
        }, 5000);
    }

    /**
     * Show a simple overlay containing the JSON that researchers need to paste into JATOS.
     * This is a robust fallback when clipboard permissions are blocked.
     */
    showExportTokenOverlay({ title, subtitle, jsonText }) {
        try {
            const existing = document.getElementById('cogflowExportTokenOverlay');
            if (existing) existing.remove();
        } catch {
            // ignore
        }

        const overlay = document.createElement('div');
        overlay.id = 'cogflowExportTokenOverlay';
        overlay.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:100000',
            'background:rgba(0,0,0,0.6)',
            'display:flex',
            'align-items:flex-start',
            'justify-content:center',
            'padding:24px',
            'overflow:auto'
        ].join(';');

        const card = document.createElement('div');
        card.className = 'card';
        card.style.cssText = 'width:min(900px, 100%); box-shadow: 0 8px 30px rgba(0,0,0,0.35);';

        const header = document.createElement('div');
        header.className = 'card-header d-flex align-items-start justify-content-between gap-3';

        const hWrap = document.createElement('div');
        const hTitle = document.createElement('div');
        hTitle.style.cssText = 'font-weight:600;';
        hTitle.textContent = title || 'Export Complete';
        const hSub = document.createElement('div');
        hSub.className = 'text-muted';
        hSub.style.cssText = 'margin-top:4px; font-size: 0.95rem;';
        hSub.textContent = subtitle || 'Copy this JSON somewhere safe (paste into JATOS Component Properties JSON).';
        hWrap.appendChild(hTitle);
        hWrap.appendChild(hSub);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'btn btn-sm btn-outline-secondary';
        closeBtn.textContent = 'Close';

        header.appendChild(hWrap);
        header.appendChild(closeBtn);

        const body = document.createElement('div');
        body.className = 'card-body';

        const note = document.createElement('div');
        note.className = 'alert alert-warning';
        note.style.cssText = 'margin-bottom: 12px;';
        note.textContent = 'Keep these tokens private. The interpreter typically needs only the read token, but the write token allows overwriting this config.';

        const textarea = document.createElement('textarea');
        textarea.className = 'form-control';
        textarea.style.cssText = 'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; min-height: 240px;';
        textarea.readOnly = true;
        textarea.value = (jsonText || '').toString();

        const actions = document.createElement('div');
        actions.className = 'd-flex gap-2 justify-content-end';
        actions.style.cssText = 'margin-top: 12px;';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'btn btn-primary';
        copyBtn.textContent = 'Copy JSON';

        const selectBtn = document.createElement('button');
        selectBtn.type = 'button';
        selectBtn.className = 'btn btn-outline-primary';
        selectBtn.textContent = 'Select All';

        actions.appendChild(selectBtn);
        actions.appendChild(copyBtn);

        body.appendChild(note);
        body.appendChild(textarea);
        body.appendChild(actions);

        card.appendChild(header);
        card.appendChild(body);
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        const close = () => {
            try { overlay.remove(); } catch { /* ignore */ }
        };

        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        selectBtn.addEventListener('click', () => {
            try {
                textarea.focus();
                textarea.select();
            } catch {
                // ignore
            }
        });

        copyBtn.addEventListener('click', async () => {
            const text = textarea.value || '';
            try {
                await navigator.clipboard.writeText(text);
                this.showValidationResult('success', 'Copied tokens JSON to clipboard.');
            } catch (e) {
                this.showValidationResult('warning', 'Clipboard copy blocked. Use Select All then Ctrl+C.');
                try {
                    textarea.focus();
                    textarea.select();
                } catch {
                    // ignore
                }
            }
        });

        // Convenience: auto-select so a researcher can Ctrl+C immediately.
        try {
            textarea.focus();
            textarea.select();
        } catch {
            // ignore
        }
    }

    /**
     * Copy JSON to clipboard
     */
    async copyJSONToClipboard() {
        try {
            const json = JSON.stringify(this.generateJSON(), null, 2);
            await navigator.clipboard.writeText(json);
            this.showValidationResult('success', 'JSON copied to clipboard!');
        } catch (error) {
            console.error('Failed to copy JSON:', error);
            this.showValidationResult('error', 'Failed to copy JSON to clipboard');
        }
    }

    /**
     * Export JSON file
     */
    async exportJSON() {
        let config = this.generateJSON();

        // Safety: blocks cannot be longer than the experiment-wide length.
        const blockLengthErrors = this.findBlockLengthViolations(config);
        if (blockLengthErrors.length > 0) {
            this.showValidationResult('error', `Cannot export: ${blockLengthErrors.join(' | ')}`);
            return;
        }

        const naming = this.getExportFilename(config);
        if (!naming) return;

        // Resilience: store a local snapshot as soon as Export is initiated.
        // This helps recover the config even if Token Store / network is unavailable.
        try {
            const jsonSnapshot = JSON.stringify(config, null, 2);
            this.persistExportBackup({
                jsonText: jsonSnapshot,
                naming,
                source: 'export_start'
            });

            // Additional resilience: if running inside JATOS, upload the snapshot as a result file.
            // This does NOT end/advance the component; it's a best-effort server-side backup.
            try {
                const uploaded = await this.tryUploadExportBackupToJatos({ jsonText: jsonSnapshot, naming });
                if (uploaded?.ok) {
                    this.showValidationResult('success', `Saved export backup to JATOS result files: ${uploaded.filename}`);
                } else {
                    // Only warn when we likely expected JATOS to be present.
                    const p = (window.location && typeof window.location.pathname === 'string') ? window.location.pathname : '';
                    if (p.includes('/publix/')) {
                        const reason = uploaded && uploaded.reason ? uploaded.reason : 'unknown';
                        this.showValidationResult('warning', `Could not save export backup to JATOS (${reason}). Export will continue.`);
                    }
                }
            } catch (e) {
                console.warn('JATOS export backup upload failed:', e);
                this.showValidationResult(
                    'warning',
                    `Could not save export backup to JATOS. Export will continue. (${e?.message || 'Unknown error'})`
                );
            }
        } catch (e) {
            console.warn('Failed to persist export backup:', e);
            this.showValidationResult(
                'warning',
                'Could not persist an export backup locally (storage quota or privacy mode). Export will continue.'
            );
        }

        // Preferred flow: upload directly via Microsoft Graph (requires Entra ID app registration)
        // Initial deployment mode skips Graph entirely to avoid setup prompts.
        const graphClient = this.isInitialDeploymentMode() ? null : window.GraphSharePointClient;
        if (graphClient?.uploadJsonToOneDriveFolder) {
            try {
                // If Graph isn't configured, optionally configure; otherwise fall back to token store.
                // IMPORTANT: check this BEFORE attempting any asset uploads via Graph.
                const runtime = graphClient.getRuntimeConfig?.() || {};
                if (!runtime.clientId) {
                    const shouldConfigure = confirm(
                        'SharePoint (Graph) export is not configured yet (missing clientId).\n\nConfigure now?\n\nCancel = use Token Store / local fallback.'
                    );
                    if (shouldConfigure) {
                        const updated = await graphClient.promptAndPersistSettings();
                        if (!updated?.clientId) {
                            throw new Error('Graph export not configured (missing clientId)');
                        }
                    } else {
                        throw new Error('Graph export not configured (missing clientId)');
                    }
                }

                // Upload any cached local assets (e.g., images/audio) referenced by asset://... in the config.
                if (graphClient.uploadFileToOneDriveFolder && (window.CogFlowAssetCache || window.PsychJsonAssetCache)) {
                    try {
                        config = await this.uploadAssetRefsToGraphAndRewriteConfig(config, naming, graphClient);
                    } catch (e) {
                        console.warn('Asset upload failed (continuing with JSON-only):', e);
                        this.showValidationResult('warning', `Asset upload failed; exporting JSON only. (${e?.message || 'Unknown error'})`);
                    }
                }

                const json = JSON.stringify(config, null, 2);

                const driveItem = await graphClient.uploadJsonToOneDriveFolder({
                    jsonText: json,
                    filename: naming.filename
                });

                const webUrl = driveItem?.webUrl;
                if (webUrl) {
                    try {
                        window.open(webUrl, '_blank', 'noopener');
                    } catch {
                        // ignore
                    }
                }

                this.showValidationResult('success', `Uploaded ${naming.filename} to SharePoint via Microsoft Graph.`);
                return;
            } catch (error) {
                console.error('Graph export failed:', error);
                this.showValidationResult('warning', `Graph export unavailable; trying Token Store. (${error?.message || 'Unknown error'})`);
            }
        }

        // Fallback #1: Token store API (mutable per export code)
        try {
            const baseUrl = this.getTokenStoreBaseUrl();
            if (!baseUrl) {
                if (this.isInitialDeploymentMode()) {
                    this.showValidationResult('error', 'Token Store base URL is not set (COGFLOW_TOKEN_STORE_BASE_URL). Export cannot continue in initial deployment mode.');
                    return;
                }
                throw new Error('Token store URL not set');
            }

            const taskType = naming && naming.taskType ? naming.taskType : (config && config.task_type ? config.task_type : 'task');

            let record = this.getTokenStoreRecordForCodeAndTask(naming.code, taskType);
            if (record) {
                const ok = confirm(
                    `A Token Store record already exists for export code ${naming.code} and task ${String(taskType).toUpperCase()}.\n\nContinuing will OVERWRITE the previously uploaded config for this task.\n\nContinue?`
                );
                if (!ok) {
                    this.showValidationResult('warning', 'Export cancelled.');
                    return;
                }
            }

            if (!record) {
                this.showValidationResult('warning', `No token found for code ${naming.code} (${String(taskType).toUpperCase()}). Creating a new token...`);
                record = await this.createTokenStoreConfig(baseUrl);
                this.setTokenStoreRecordForCodeAndTask(naming.code, taskType, record, { filename: naming.filename });
            }

            // Rewrite bare filenames like "img1.png" to previously uploaded Token Store URLs (if available).
            try {
                config = this.rewriteBareAssetFilenamesToTokenStoreUrls(config, { code: naming.code, taskType });
            } catch (e) {
                console.warn('Bare-filename asset rewrite failed (continuing):', e);
            }

            // Upload cached assets referenced by asset://... and rewrite config to use unguessable Worker URLs.
            try {
                config = await this.uploadAssetRefsToTokenStoreAndRewriteConfig(config, naming, baseUrl, record);
            } catch (e) {
                console.warn('Token store asset upload failed (continuing with JSON-only):', e);
                this.showValidationResult('warning', `Asset upload failed; exporting JSON only. (${e?.message || 'Unknown error'})`);
            }

            await this.uploadConfigToTokenStore(baseUrl, record, config, naming);

            // Persist/refresh per-task record metadata (filename, timestamp).
            try {
                this.setTokenStoreRecordForCodeAndTask(naming.code, taskType, record, { filename: naming.filename });
            } catch {
                // ignore
            }

            // Best-effort: copy JATOS-friendly component properties to clipboard.
            const props = {
                config_store_base_url: baseUrl,
                config_store_config_id: record.config_id,
                config_store_read_token: record.read_token,
                // Optional (kept for researchers/admins who need to update the same config later)
                config_store_write_token: record.write_token
            };
            const propsText = JSON.stringify(props, null, 2);
            try {
                await navigator.clipboard.writeText(propsText);
            } catch {
                // ignore
            }

            // Always show an overlay so tokens can't get lost due to clipboard permissions.
            this.showExportTokenOverlay({
                title: 'Token Store export complete',
                subtitle: 'Paste this JSON into JATOS Component Properties (JSON). For multi-task runs under the same export code, use the “JATOS Props” button to generate a bundle JSON.',
                jsonText: propsText
            });

            this.showValidationResult(
                'success',
                `Uploaded config to Token Store.\nConfig ID: ${record.config_id}.\nRead token copied (JATOS Component Properties JSON).`
            );
            return;
        } catch (e) {
            console.error('Token store export failed:', e);
            if (this.isInitialDeploymentMode()) {
                this.showValidationResult('error', `Token Store export failed. (${e?.message || 'Unknown error'})`);
                return;
            }
            this.showValidationResult('warning', `Token Store export failed; falling back to local download. (${e?.message || 'Unknown error'})`);
        }

        // Fallback #2: local download + open SharePoint folder URL.
        const json = JSON.stringify(config, null, 2);
        return this.exportJSONLegacy({ json, filename: naming.filename });
    }

    exportJSONLegacy({ json, filename }) {
        // If the config contains asset:// refs, local download will not include the binary files.
        // We warn so the researcher knows to use a hosted export flow (or replace with URLs).
        try {
            const assetRefs = this.findAssetRefsInString(json);
            if (assetRefs.length > 0) {
                const msg = this.isInitialDeploymentMode()
                    ? `This config references ${assetRefs.length} local asset(s) (asset://...). Use "Export" (Token Store) to upload images, or replace with URLs.`
                    : `This config references ${assetRefs.length} local asset(s) (asset://...). Use SharePoint/Graph export to upload images, or replace with URLs.`;
                this.showValidationResult('warning', msg);
            }
        } catch {
            // ignore
        }

        this.downloadJsonToFile(json, filename);

        const sharepointUrl = this.getSharePointFolderUrl();
        if (sharepointUrl) {
            try {
                window.open(sharepointUrl, '_blank', 'noopener');
            } catch {
                // ignore
            }
            this.showValidationResult('success', `Saved ${filename}. SharePoint folder opened in a new tab.`);
        } else {
            this.showValidationResult('success', `Saved ${filename}. (SharePoint URL not set.)`);
        }
    }

    findAssetRefsInString(rawText) {
        const text = (rawText ?? '').toString();
        const re = /asset:\/\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/g;
        const out = [];
        let m;
        while ((m = re.exec(text)) !== null) {
            out.push(`asset://${m[1]}/${m[2]}`);
        }
        return Array.from(new Set(out));
    }

    async uploadAssetRefsToGraphAndRewriteConfig(config, naming, graphClient) {
        const cfg = (config && typeof config === 'object') ? config : {};
        const jsonText = JSON.stringify(cfg);
        const refs = this.findAssetRefsInString(jsonText);
        if (refs.length === 0) return cfg;

        const base = String(naming?.filename || 'export').replace(/\.json$/i, '');
        const sanitizeFileName = (s) => {
            return String(s || '')
                .replace(/[^A-Za-z0-9._-]/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_+|_+$/g, '')
                .slice(0, 160) || 'asset';
        };

        const uploadedByRef = new Map();

        for (const ref of refs) {
            const m = /^asset:\/\/([^/]+)\/([^/]+)$/.exec(ref);
            if (!m) continue;
            const componentId = m[1];
            const field = m[2];

            const assetCache = window.CogFlowAssetCache || window.PsychJsonAssetCache;
            const entry = assetCache?.get?.(componentId, field);
            const file = entry?.file;
            if (!file) {
                console.warn('Missing cached file for', ref);
                continue;
            }

            const originalName = entry?.filename || file.name || `${field}`;
            const extMatch = /\.[A-Za-z0-9]{1,8}$/.exec(originalName);
            const ext = extMatch ? extMatch[0] : '';

            const outName = sanitizeFileName(`${base}-asset-${componentId}-${field}`) + ext;

            if (!uploadedByRef.has(ref)) {
                await graphClient.uploadFileToOneDriveFolder({
                    file,
                    filename: outName,
                    contentType: entry?.mime || file.type || 'application/octet-stream'
                });
                uploadedByRef.set(ref, outName);
            }
        }

        // Rewrite any asset:// refs anywhere in the config (including HTML templates)
        const replaceInString = (s) => {
            const raw = (s ?? '').toString();
            return raw.replace(/asset:\/\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/g, (full) => {
                const mapped = uploadedByRef.get(full);
                return mapped ? mapped : full;
            });
        };

        const rewriteDeep = (x) => {
            if (typeof x === 'string') return replaceInString(x);
            if (Array.isArray(x)) return x.map(rewriteDeep);
            if (x && typeof x === 'object') {
                const out = {};
                for (const [k, v] of Object.entries(x)) {
                    out[k] = rewriteDeep(v);
                }
                return out;
            }
            return x;
        };

        const rewritten = rewriteDeep(cfg);
        const uploadedCount = uploadedByRef.size;
        if (uploadedCount > 0) {
            this.showValidationResult('success', `Uploaded ${uploadedCount} image asset(s) referenced by asset://...`);
        } else {
            this.showValidationResult('warning', `Found ${refs.length} asset reference(s), but no cached files were available to upload.`);
        }
        return rewritten;
    }

    /**
     * Save current configuration as template
     */
    saveTemplate() {
        const name = prompt('Enter template name:');
        if (name) {
            this.templates[name] = {
                timeline: [...this.timeline],
                experimentType: this.experimentType,
                dataCollection: { ...this.dataCollection },
                taskType: document.getElementById('taskType')?.value || 'rdm'
            };
            
            // Save to localStorage
            localStorage.setItem('cogflow_templates', JSON.stringify(this.templates));
            localStorage.setItem('psychjson_templates', JSON.stringify(this.templates));
            this.showValidationResult('success', `Template "${name}" saved successfully!`);
        }
    }

    /**
     * Load template
     */
    loadTemplate() {
        // Load templates from localStorage
        const saved = localStorage.getItem('cogflow_templates') || localStorage.getItem('psychjson_templates');
        if (saved) {
            this.templates = JSON.parse(saved);
        }
        
        const templateNames = Object.keys(this.templates);
        if (templateNames.length === 0) {
            this.showValidationResult('warning', 'No saved templates found');
            return;
        }
        
        // Show template selection (simple prompt for now, could be enhanced with modal)
        const selection = prompt(`Select template:\n${templateNames.map((name, i) => `${i + 1}. ${name}`).join('\n')}\n\nEnter number:`);
        const index = parseInt(selection) - 1;
        
        if (index >= 0 && index < templateNames.length) {
            const templateName = templateNames[index];
            const template = this.templates[templateName];
            
            this.timeline = [...template.timeline];
            this.experimentType = template.experimentType;
            this.dataCollection = { ...template.dataCollection };

            // Restore task type dropdown (if present)
            if (template.taskType) {
                this.setElementValue('taskType', template.taskType);
            }
            
            // Update UI
            this.updateExperimentTypeUI();
            this.timelineBuilder.renderTimeline();
            this.updateJSON();
            this.showValidationResult('success', `Template "${templateName}" loaded successfully!`);
        }
    }

    /**
     * Load default RDM template and populate UI
     */
    loadDefaultRDMTemplate() {
        // Default RDM parameters
        const defaultRDM = {
            experiment_meta: {
                name: "RDM Experiment",
                version: "1.0.0",
                description: "Random Dot Motion task",
                author: "Psychology Lab",
                jsPsych_version: "8.0+"
            },
            experiment_type: "trial-based",
            data_collection: {
                reaction_time: { enabled: true },
                accuracy: { enabled: true },
                mouse_tracking: { enabled: false },
                keyboard_tracking: { enabled: false },
                eye_tracking: { enabled: false }
            },
            display_parameters: {
                canvas_width: 600,
                canvas_height: 600,
                background_color: "#404040"
            },
            aperture_parameters: {
                shape: "circle",
                diameter: 350,
                center_x: 400,
                center_y: 300,
                show_aperture_outline: false,
                aperture_outline_width: 2,
                aperture_outline_color: "#FFFFFF"
            },
            dot_parameters: {
                total_dots: 150,
                dot_size: 4,
                dot_color: "#FFFFFF",
                lifetime_frames: 60
            },
            motion_parameters: {
                coherence: 0.5,
                direction: 0,
                speed: 6,
                noise_type: "random_direction"
            },
            timing_parameters: {
                fixation_duration: 500,
                stimulus_duration: 1500,
                response_deadline: 2500,
                inter_trial_interval: 1200
            },
            response_parameters: {
                choices: ["f", "j"],
                require_response: true
            },
            timeline: []
        };

        // Store the template
        this.currentExperiment = defaultRDM;

        // Ensure task type defaults to RDM
        this.setElementValue('taskType', 'rdm');
        
        // Populate UI with default values
        this.populateRDMUI();

        // Timeline should start empty; researchers can load a template instead.
    }

    /**
     * Populate RDM UI elements with template values
     */
    populateRDMUI() {
        const exp = this.currentExperiment;
        
        // Display parameters
        this.setElementValue('canvasWidth', exp.display_parameters?.canvas_width);
        this.setElementValue('canvasHeight', exp.display_parameters?.canvas_height);
        
        // Aperture parameters
        this.setElementValue('apertureShape', exp.aperture_parameters?.shape);
        this.setElementValue('apertureDiameter', exp.aperture_parameters?.diameter);
        this.setElementChecked('apertureOutlineEnabled', exp.aperture_parameters?.show_aperture_outline);
        this.setElementValue('apertureOutlineWidth', exp.aperture_parameters?.aperture_outline_width);
        this.setElementValue('apertureOutlineColor', exp.aperture_parameters?.aperture_outline_color);
        
        // Dot parameters
        this.setElementValue('totalDots', exp.dot_parameters?.total_dots);
        this.setElementValue('dotSize', exp.dot_parameters?.dot_size);
        this.setElementValue('dotColor', exp.dot_parameters?.dot_color);
        this.setElementValue('dotLifetime', exp.dot_parameters?.lifetime_frames);
        
        // Motion parameters
        this.setElementValue('motionCoherence', exp.motion_parameters?.coherence);
        this.setElementValue('motionDirection', exp.motion_parameters?.direction);
        this.setElementValue('motionSpeed', exp.motion_parameters?.speed);
        this.setElementValue('noiseType', exp.motion_parameters?.noise_type);
        
        // Timing parameters
        this.setElementValue('stimulusDuration', exp.timing_parameters?.stimulus_duration);
        this.setElementValue('responseDeadline', exp.timing_parameters?.response_deadline);
        this.setElementValue('interTrialInterval', exp.timing_parameters?.inter_trial_interval);
        this.setElementValue('fixationDuration', exp.timing_parameters?.fixation_duration);
        
        // Response parameters
        // Default response device (drives modality-specific UI)
        {
            const rp = exp.response_parameters || {};
            const inferred = (typeof rp.response_device === 'string' && rp.response_device.trim() !== '')
                ? rp.response_device.trim()
                : (rp.mouse_response ? 'mouse'
                    : (rp.touch_response ? 'touch'
                        : (rp.voice_response ? 'voice' : 'keyboard')));

            this.setElementValue('defaultResponseDevice', inferred);
        }

        if (exp.response_parameters?.choices) {
            this.setElementValue('responseKeys', exp.response_parameters.choices.join(','));
        }
        this.setElementChecked('requireResponse', exp.response_parameters?.require_response);

        // Continuous-only end-on-response (if present in template)
        if (exp.response_parameters && typeof exp.response_parameters.end_condition_on_response === 'boolean') {
            this.setElementChecked('endConditionOnResponse', exp.response_parameters.end_condition_on_response);
        }

        // Optional feedback defaults (if present in template)
        if (exp.response_parameters?.feedback?.type) {
            this.setElementValue('defaultFeedbackType', exp.response_parameters.feedback.type);
            this.setElementValue('defaultFeedbackDuration', exp.response_parameters.feedback.duration_ms);
        }

        // Mouse response (optional)
        if (exp.response_parameters?.mouse_response) {
            this.setElementValue('mouseApertureSegments', exp.response_parameters.mouse_response.segments);
            this.setElementValue('mouseSegmentStartAngle', exp.response_parameters.mouse_response.start_angle_deg);
            this.setElementValue('mouseSelectionMode', exp.response_parameters.mouse_response.selection_mode);
        }
        this.setElementChecked('enableFixation', true);
        
        // Update coherence display
        const coherenceSlider = document.getElementById('motionCoherence');
        const coherenceValue = document.getElementById('coherenceValue');
        if (coherenceSlider && coherenceValue) {
            coherenceValue.textContent = parseFloat(coherenceSlider.value).toFixed(2);
        }

        this.updateConditionalUI();
    }

    /**
     * Helper to set element value safely
     */
    setElementValue(id, value) {
        const element = document.getElementById(id);
        if (element && value !== undefined && value !== null) {
            element.value = value;
        }
    }

    /**
     * Helper to set checkbox state safely
     */
    setElementChecked(id, checked) {
        const element = document.getElementById(id);
        if (element && checked !== undefined) {
            element.checked = checked;
        }
    }

    /**
     * Add sample trials to the timeline
     */
    addSampleTrials() {
        const taskType = document.getElementById('taskType')?.value || 'rdm';
        if (taskType !== 'rdm') {
            return;
        }

        const trials = [
            { name: "Practice - High Coherence", coherence: 0.8, direction: 0, color: "#FFFF00" },
            { name: "Practice - High Coherence", coherence: 0.8, direction: 180, color: "#FFFF00" },
            { name: "Test - Low Coherence", coherence: 0.1, direction: 0, color: "#FFFFFF" },
            { name: "Test - Medium Coherence", coherence: 0.5, direction: 180, color: "#FFFFFF" },
            { name: "Test - High Coherence", coherence: 0.9, direction: 0, color: "#FFFFFF" }
        ];

        trials.forEach((trial, index) => {
            this.addTrialToTimeline(trial, index + 1);
        });
    }

    /**
     * Add a trial to the timeline UI
     */
    addTrialToTimeline(trial, index) {
        const timelineContainer = document.getElementById('timelineComponents');
        if (!timelineContainer) return;

        const trialElement = document.createElement('div');
        trialElement.className = 'timeline-component card mb-2';
        trialElement.dataset.componentType = 'rdm-trial';
        
        // Store component data for editing and preview
        const componentData = {
            type: 'rdm-trial',
            name: trial.name,
            parameters: {
                coherence: trial.coherence,
                direction: trial.direction,
                dot_color: trial.color, // Map color to dot_color for schema compatibility
                speed: 6, // Default speed
                total_dots: 150, // Default total dots
                dot_size: 4, // Default dot size
                aperture_diameter: 350, // Default aperture
                stimulus_duration: 1500, // Default duration
                trial_duration: 3000, // Default trial duration for continuous mode
                transition_duration: 500, // Default transition duration
                ...trial // Include any other trial properties
            }
        };
        trialElement.dataset.componentData = JSON.stringify(componentData);
        
        trialElement.innerHTML = `
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-center">
                    <div class="d-flex align-items-center">
                        <div class="drag-handle me-2" style="cursor: move; color: #ccc;">
                            <i class="fas fa-grip-vertical"></i>
                        </div>
                        <div>
                            <h6 class="card-title mb-1">${trial.name}</h6>
                            <small class="text-muted">RDM Trial</small>
                            <div class="mt-1">
                                <span class="badge bg-secondary">Trial ${index}</span>
                                <span class="badge" style="background-color: ${trial.color}; color: #000000;">●</span>
                            </div>
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

        // Hide empty state when adding components
        const emptyState = timelineContainer.querySelector('.empty-timeline');
        if (emptyState) {
            emptyState.style.display = 'none';
        }

        timelineContainer.appendChild(trialElement);
    }

    /**
     * Get current RDM parameters for preview
     */
    getCurrentRDMParameters() {
        // Helper function to safely get element value with fallback
        const getValue = (id, fallback, type = 'string') => {
            const element = document.getElementById(id);
            if (!element) return fallback;
            
            const value = element.value;
            if (!value && value !== 0) return fallback;
            
            switch (type) {
                case 'number':
                    const num = parseFloat(value);
                    return isNaN(num) ? fallback : num;
                case 'int':
                    const int = parseInt(value);
                    return isNaN(int) ? fallback : int;
                default:
                    return value;
            }
        };

        // Collect parameters from the current form
        return {
            canvas_width: getValue('canvasWidth', 600, 'int'),
            canvas_height: getValue('canvasHeight', 600, 'int'),
            aperture_shape: getValue('apertureShape', 'circle'),
            aperture_diameter: getValue('apertureDiameter', 350, 'int'),
            background_color: getValue('backgroundColor', '#404040'),
            dot_size: getValue('dotSize', 4, 'int'),
            dot_color: getValue('dotColor', '#ffffff'),
            total_dots: getValue('totalDots', 150, 'int'),
            coherence: getValue('motionCoherence', 0.5, 'number'),
            coherent_direction: getValue('motionDirection', 0, 'int'),
            speed: getValue('motionSpeed', 5, 'int'),
            lifetime_frames: getValue('dotLifetime', 60, 'int'),
            noise_type: 'random_direction',

            // Aperture outline defaults
            show_aperture_outline: (() => {
                const el = document.getElementById('apertureOutlineEnabled');
                return el ? !!el.checked : false;
            })(),
            aperture_outline_width: getValue('apertureOutlineWidth', 2, 'number'),
            aperture_outline_color: getValue('apertureOutlineColor', '#FFFFFF')
        };
    }

    /**
     * Save parameters from modal
     */
    saveParameters() {
        // Prefer the schema-driven save path (TimelineBuilder). The legacy save logic below
        // only collected a fixed set of RDM fields and could overwrite dataset.componentData
        // without preserving critical fields like `type`, which can break Block export.
        if (this.timelineBuilder && typeof this.timelineBuilder.saveComponentParameters === 'function') {
            this.timelineBuilder.saveComponentParameters();
            return;
        }

        // Get the currently edited component (stored when modal was opened)
        const currentComponent = this.currentEditingComponent;
        if (!currentComponent) {
            console.warn('No component currently being edited');
            return;
        }
        
        // Collect parameters from the modal
        const parameters = {
            canvas_width: this.getModalValue('modalCanvasWidth', 600, 'int'),
            canvas_height: this.getModalValue('modalCanvasHeight', 600, 'int'),
            aperture_shape: this.getModalValue('modalApertureShape', 'circle'),
            aperture_size: this.getModalValue('modalApertureSize', 300, 'int'),
            background_color: this.getModalValue('modalBackgroundColor', '#404040'),
            dot_size: this.getModalValue('modalDotSize', 4, 'int'),
            dot_color: this.getModalValue('modalDotColor', '#ffffff'),
            total_dots: this.getModalValue('modalTotalDots', 150, 'int'),
            coherence: this.getModalValue('modalMotionCoherence', 0.5, 'number'),
            coherent_direction: this.getModalValue('modalMotionDirection', 0, 'int'),
            speed: this.getModalValue('modalMotionSpeed', 5, 'int'),
            lifetime_frames: this.getModalValue('modalDotLifetime', 60, 'int'),
            noise_type: 'random_direction'
        };

        // Legacy fallback: merge into existing component data and preserve `type`.
        let existing = {};
        try {
            existing = JSON.parse(currentComponent.dataset.componentData || '{}') || {};
        } catch {
            existing = {};
        }

        const preservedType = existing.type || currentComponent.dataset.componentType;
        const preservedName = existing.name;

        let updated;
        if (existing.parameters && typeof existing.parameters === 'object') {
            updated = {
                type: preservedType,
                name: preservedName,
                ...existing,
                parameters: {
                    ...existing.parameters,
                    ...parameters
                }
            };
        } else {
            updated = {
                type: preservedType,
                name: preservedName,
                ...existing,
                ...parameters
            };
        }

        // Store parameters in the component's data attribute
        currentComponent.dataset.componentData = JSON.stringify(updated);
        
        // Update the component's visual display
        if (typeof parameters.coherence === 'number' && typeof parameters.coherent_direction === 'number' && typeof parameters.total_dots === 'number') {
            this.updateComponentDisplay(currentComponent, parameters);
        }
        
        // Close the modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('parameterModal'));
        if (modal) {
            modal.hide();
        }
        
        // Update JSON
        this.updateJSON();
        
        console.log('Saved parameters for component:', parameters);
    }
    
    /**
     * Helper method to get modal values safely
     */
    getModalValue(id, fallback, type = 'string') {
        const element = document.getElementById(id);
        if (!element) return fallback;
        
        const value = element.value;
        if (!value && value !== 0) return fallback;
        
        switch (type) {
            case 'number':
                const num = parseFloat(value);
                return isNaN(num) ? fallback : num;
            case 'int':
                const int = parseInt(value);
                return isNaN(int) ? fallback : int;
            default:
                return value;
        }
    }
    
    /**
     * Update component display with new parameters
     */
    updateComponentDisplay(component, parameters) {
        const titleElement = component.querySelector('.card-title');
        const descriptionElement = component.querySelector('.text-muted');
        const badgeContainer = component.querySelector('.mt-1');
        
        // Cosmetic: do not render parameter summaries in the timeline cards.
        // Keep the existing description/type text unchanged.
        
        // Add a "configured" badge to show this component has custom parameters
        if (badgeContainer) {
            // Remove existing configured badge if present
            const existingBadge = badgeContainer.querySelector('.badge-configured');
            if (existingBadge) {
                existingBadge.remove();
            }
            
            // Add configured badge
            const configuredBadge = document.createElement('span');
            configuredBadge.className = 'badge bg-success badge-configured ms-1';
            configuredBadge.textContent = 'Configured';
            configuredBadge.title = 'Component has custom parameters';
            badgeContainer.appendChild(configuredBadge);
        }
    }
    
    /**
     * Set the currently editing component (called when modal opens)
     */
    setEditingComponent(component) {
        this.currentEditingComponent = component;
    }
    
    /**
     * Preview current component with modal values
     */
    previewCurrentComponent() {
        // Get current parameters from the parameter form
        const modalBody = document.getElementById('parameterModalBody');
        if (!modalBody) {
            console.error('Parameter modal body not found');
            return;
        }

        // Determine component type being edited (so previews route correctly)
        let componentType = 'psychophysics-rdm';
        let componentName = undefined;
        let storedData = null;
        try {
            if (this.currentEditingComponent?.dataset?.componentData) {
                storedData = JSON.parse(this.currentEditingComponent.dataset.componentData);
                if (storedData?.type) componentType = storedData.type;
                if (storedData?.name) componentName = storedData.name;
            }
        } catch (e) {
            console.warn('Could not parse currentEditingComponent for preview type:', e);
        }

        // If stored type is missing, fall back to the timeline element metadata
        if ((!componentType || componentType === 'psychophysics-rdm') && this.currentEditingComponent?.dataset?.componentType) {
            componentType = this.currentEditingComponent.dataset.componentType;
        }

        // Survey-response has a custom editor (questions list) and cannot be previewed
        // by scraping generic input ids.
        if (componentType === 'survey-response') {
            if (!this.timelineBuilder || typeof this.timelineBuilder.collectSurveyResponseFromModal !== 'function') {
                console.error('TimelineBuilder survey collector not available');
                return;
            }

            const survey = this.timelineBuilder.collectSurveyResponseFromModal(modalBody);
            const previewData = {
                type: 'survey-response',
                name: componentName || storedData?.name || 'Survey Response',
                ...(storedData && typeof storedData === 'object' ? storedData : {}),
                ...survey
            };

            console.log('Preview data for component type:', previewData.type, previewData);
            if (window.componentPreview) {
                window.componentPreview.showPreview(previewData);
            } else {
                console.error('ComponentPreview not found');
            }
            return;
        }

        // Collect current form values
        const inputs = modalBody.querySelectorAll('input, textarea, select');
        const currentParams = {};

        inputs.forEach(input => {
            // Ignore disabled fields (hidden modality-specific controls)
            if (input.disabled) return;

            let paramName = input.id.replace('param_', '');
            // Handle simple field names (no param_ prefix)
            if (paramName === input.id) {
                paramName = input.id;
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

            currentParams[paramName] = value;
        });

        console.log('Preview parameters from form:', currentParams);

        // componentType/componentName already resolved above

        // Instructions component - simple structure
        if (currentParams.instructionsText !== undefined) {
            const previewData = {
                type: 'html-keyboard-response',
                stimulus: currentParams.instructionsText || 'No instructions provided',
                choices: currentParams.responseKeys || 'ALL_KEYS'
            };

            console.log('Preview data for component type:', previewData.type, previewData);
            if (window.componentPreview) {
                window.componentPreview.showPreview(previewData);
            } else {
                console.error('ComponentPreview not found');
            }
            return;
        }

        const isRdmLike = (() => {
            const t = (componentType ?? '').toString();
            if (t.includes('rdm') || t === 'psychophysics-rdm' || t === 'rdk') return true;
            if (storedData && typeof storedData === 'object' && storedData.coherence !== undefined) return true;
            if (currentParams.coherence !== undefined) return true;
            return false;
        })();

        // Non-RDM previews: do NOT inject RDM defaults (it forces the preview to look like RDM).
        if (!isRdmLike) {
            const previewData = {
                type: componentType,
                name: componentName,
                ...(storedData && typeof storedData === 'object' ? storedData : {}),
                ...currentParams
            };

            console.log('Preview data for component type:', previewData.type, previewData);
            if (window.componentPreview) {
                window.componentPreview.showPreview(previewData);
            } else {
                console.error('ComponentPreview not found');
            }
            return;
        }

        // RDM previews: merge experiment-wide display defaults so preview matches the main UI
        const display = this.getRDMDisplayParameters();
        const aperture = this.getRDMApertureParameters();
        const dotDefaults = this.getRDMDotParameters();
        const motionDefaults = this.getRDMMotionParameters();

        // Build a preview payload that ComponentPreview understands (flat params)
        const previewData = {
            type: componentType,
            name: componentName,

            canvas_width: display.canvas_width,
            canvas_height: display.canvas_height,
            background_color: display.background_color,

            aperture_shape: aperture.shape,
            aperture_diameter: aperture.diameter,

            dot_size: dotDefaults.dot_size,
            dot_color: dotDefaults.dot_color,
            total_dots: dotDefaults.total_dots,
            lifetime_frames: dotDefaults.lifetime_frames,

            coherence: motionDefaults.coherence,
            direction: motionDefaults.direction,
            speed: motionDefaults.speed,
            noise_type: motionDefaults.noise_type,

            // Include any experiment-wide dot-groups config if present
            ...(dotDefaults.groups ? { groups: dotDefaults.groups } : {})
        };

        // Apply modal overrides (ignore *_hex helper fields, but use them as fallback)
        Object.entries(currentParams).forEach(([key, value]) => {
            if (key.endsWith('_hex')) return;
            previewData[key] = value;
        });

        // If a color field is missing but a *_hex field exists, use it
        Object.entries(currentParams).forEach(([key, value]) => {
            if (!key.endsWith('_hex')) return;
            const baseKey = key.slice(0, -4);
            if (previewData[baseKey] === undefined || previewData[baseKey] === '' || previewData[baseKey] === null) {
                previewData[baseKey] = value;
            }
        });

        console.log('Preview data for component type:', previewData.type, previewData);

        // Show preview with correct component data
        if (window.componentPreview) {
            window.componentPreview.showPreview(previewData);
        } else {
            console.error('ComponentPreview not found');
        }
    }

    /**
     * Publish the current config to the CogFlow Platform backend.
     *
     * Activated when window.COGFLOW_PLATFORM_URL is set (e.g. "http://localhost:8000").
     * Study metadata is read from window.COGFLOW_STUDY_SLUG / COGFLOW_STUDY_NAME /
     * COGFLOW_CONFIG_VERSION, or prompted via the UI when absent.
     *
     * Called by the "Platform Publish" button in the platform version of index.html.
     */
    async publishToPlatform() {
        const toSlug = (value) => String(value || '')
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 64);

        const getCsrfToken = () => {
            try {
                const fromCookie = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
                if (fromCookie && fromCookie[1]) return decodeURIComponent(fromCookie[1]);
                const fromMeta = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
                return (fromMeta || '').trim();
            } catch {
                return '';
            }
        };

        const safePrompt = (message, defaultValue = '') => {
            try {
                return window.prompt(message, defaultValue);
            } catch {
                return null;
            }
        };

        const requestPublishMetadata = ({ initialName = '', initialSlug = '', initialVersion = '' }) => {
            const modalEl = document.getElementById('publishMetadataModal');
            const bootstrapApi = window.bootstrap;
            if (!modalEl || !bootstrapApi?.Modal) {
                return Promise.resolve(null);
            }

            const nameInput = modalEl.querySelector('#publishStudyName');
            const slugInput = modalEl.querySelector('#publishStudySlug');
            const versionInput = modalEl.querySelector('#publishConfigVersion');
            const confirmBtn = modalEl.querySelector('#publishMetaConfirmBtn');
            const errorEl = modalEl.querySelector('#publishMetaError');
            if (!nameInput || !slugInput || !versionInput || !confirmBtn || !errorEl) {
                return Promise.resolve(null);
            }

            return new Promise((resolve) => {
                const modal = bootstrapApi.Modal.getOrCreateInstance(modalEl);
                let settled = false;
                let slugTouched = false;

                const clearError = () => {
                    errorEl.textContent = '';
                    errorEl.classList.add('d-none');
                };

                const showError = (message) => {
                    errorEl.textContent = message;
                    errorEl.classList.remove('d-none');
                };

                const cleanup = () => {
                    modalEl.removeEventListener('hidden.bs.modal', onHidden);
                    confirmBtn.removeEventListener('click', onConfirm);
                    nameInput.removeEventListener('input', onNameInput);
                    slugInput.removeEventListener('input', onSlugInput);
                };

                const finish = (value) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve(value);
                };

                const onHidden = () => finish(null);

                const onSlugInput = () => {
                    if (slugInput.value.trim()) slugTouched = true;
                    clearError();
                };

                const onNameInput = () => {
                    clearError();
                    if (!slugTouched) {
                        slugInput.value = toSlug(nameInput.value);
                    }
                };

                const onConfirm = () => {
                    const studyName = String(nameInput.value || '').trim();
                    const studySlug = toSlug(slugInput.value);
                    const configVersion = String(versionInput.value || '').trim();

                    if (!studyName) {
                        showError('Study name is required.');
                        nameInput.focus();
                        return;
                    }
                    if (!studySlug) {
                        showError('Study slug is required and must be URL-safe.');
                        slugInput.focus();
                        return;
                    }
                    if (!configVersion) {
                        showError('Config version is required.');
                        versionInput.focus();
                        return;
                    }

                    finish({
                        study_name: studyName,
                        study_slug: studySlug,
                        config_version: configVersion,
                    });
                    modal.hide();
                };

                clearError();
                nameInput.value = initialName;
                slugInput.value = initialSlug;
                versionInput.value = initialVersion;
                slugTouched = Boolean(initialSlug);

                modalEl.addEventListener('hidden.bs.modal', onHidden);
                confirmBtn.addEventListener('click', onConfirm);
                nameInput.addEventListener('input', onNameInput);
                slugInput.addEventListener('input', onSlugInput);

                modal.show();
                nameInput.focus();
                nameInput.select();
            });
        };

        const platformUrl = (
            typeof window.COGFLOW_PLATFORM_URL === 'string'
                ? window.COGFLOW_PLATFORM_URL.trim().replace(/\/+$/, '')
                : ''
        );
        if (!platformUrl) {
            this.showValidationResult(
                'error',
                'Platform URL not configured. Set window.COGFLOW_PLATFORM_URL before publishing.'
            );
            return;
        }

        // Build config payload
        let config;
        try {
            config = this.generateJSON();
        } catch (e) {
            this.showValidationResult('error', `Could not generate config: ${e?.message || String(e)}`);
            return;
        }

        // Block on validation errors (same as exportJSON)
        const blockLengthErrors = this.findBlockLengthViolations(config);
        if (blockLengthErrors.length > 0) {
            this.showValidationResult('error', `Cannot publish: ${blockLengthErrors.join(' | ')}`);
            return;
        }

        // Study metadata — collect from platform globals/saved values, then prompt via modal if needed.
        const publishMetaKey = 'cogflow_platform_publish_meta_v1';
        let savedMeta = {};
        try {
            savedMeta = JSON.parse(localStorage.getItem(publishMetaKey) || '{}') || {};
        } catch {
            savedMeta = {};
        }

        const defaultVersionLabel = `v${new Date().toISOString().slice(0, 10)}`;

        let studyName = (
            (typeof window.COGFLOW_STUDY_NAME === 'string' && window.COGFLOW_STUDY_NAME.trim()) ||
            (typeof savedMeta.study_name === 'string' && savedMeta.study_name.trim()) ||
            ''
        );
        let studySlug = (
            (typeof window.COGFLOW_STUDY_SLUG === 'string' && window.COGFLOW_STUDY_SLUG.trim()) ||
            (typeof savedMeta.study_slug === 'string' && savedMeta.study_slug.trim()) ||
            ''
        );

        let versionLabel = (
            (typeof window.COGFLOW_CONFIG_VERSION === 'string' && window.COGFLOW_CONFIG_VERSION.trim()) ||
            (typeof savedMeta.config_version === 'string' && savedMeta.config_version.trim()) ||
            defaultVersionLabel
        );

        const defaultName = (config?.task_name || config?.task_type || 'Untitled Study').toString().trim();
        if (!studyName) studyName = defaultName;
        if (!studySlug) {
            studySlug = toSlug(studyName) || (config && config.task_type ? `${config.task_type}-study` : 'untitled-study');
        }

        const metadataNeeded = !window.COGFLOW_STUDY_NAME || !window.COGFLOW_STUDY_SLUG;
        if (metadataNeeded) {
            const modalMeta = await requestPublishMetadata({
                initialName: studyName,
                initialSlug: studySlug,
                initialVersion: versionLabel,
            });

            if (modalMeta) {
                studyName = modalMeta.study_name;
                studySlug = modalMeta.study_slug;
                versionLabel = modalMeta.config_version;
            } else {
                const enteredName = safePrompt('Enter study name for Platform Publish:', studyName || defaultName);
                if (enteredName === null) {
                    this.showValidationResult('warning', 'Publish canceled.');
                    return;
                }
                studyName = String(enteredName || '').trim();
                if (!studyName) {
                    this.showValidationResult('error', 'Study name is required for publish.');
                    return;
                }

                const enteredSlug = safePrompt('Enter study slug (URL-safe id):', studySlug || toSlug(studyName));
                if (enteredSlug === null) {
                    this.showValidationResult('warning', 'Publish canceled.');
                    return;
                }
                studySlug = toSlug(enteredSlug);
                if (!studySlug) {
                    this.showValidationResult('error', 'Study slug is required for publish.');
                    return;
                }

                const enteredVersion = safePrompt('Enter config version label:', versionLabel || defaultVersionLabel);
                if (enteredVersion === null) {
                    this.showValidationResult('warning', 'Publish canceled.');
                    return;
                }
                versionLabel = String(enteredVersion || '').trim() || defaultVersionLabel;
            }
        }

        try {
            const meta = { study_name: studyName, study_slug: studySlug, config_version: versionLabel };
            localStorage.setItem(publishMetaKey, JSON.stringify(meta));
            window.COGFLOW_STUDY_NAME = studyName;
            window.COGFLOW_STUDY_SLUG = studySlug;
            window.COGFLOW_CONFIG_VERSION = versionLabel;
        } catch {
            // ignore storage errors
        }

        const builderVersion = (
            typeof window.__COGFLOW_BUILDER_VERSION === 'string'
                ? window.__COGFLOW_BUILDER_VERSION
                : 'unknown'
        );

        const payload = {
            study_slug: studySlug,
            study_name: studyName,
            config_version_label: versionLabel,
            builder_version: builderVersion,
            runtime_mode: 'django',
            config,
        };

        this.showValidationResult('success', `Publishing to ${platformUrl}…`);

        try {
            const csrfToken = getCsrfToken();
            const response = await fetch(`${platformUrl}/api/v1/configs/publish`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {})
                },
                body: JSON.stringify(payload),
            });

            const data = await response.json().catch(() => ({}));

            if (response.ok) {
                const dashUrl = data.dashboard_url || `${platformUrl}/studies/${data.study_slug || studySlug}/`;
                this.showValidationResult(
                    'success',
                    `Published! Study: ${data.study_slug || studySlug} · Config ID: ${data.config_version_id || '—'}\nDashboard: ${dashUrl}`
                );
            } else {
                const errMsg = data.detail || data.error || JSON.stringify(data);
                this.showValidationResult('error', `Publish failed (${response.status}): ${errMsg}`);
            }
        } catch (e) {
            this.showValidationResult('error', `Publish error: ${e?.message || String(e)}`);
        }
    }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = JsonBuilder;
}