/**
 * Trial Manager Module
 * 
 * Manages trial-based and continuous experiment configurations
 * Handles trial generation, randomization, and parameter management
 */

class TrialManager {
    constructor(jsonBuilder) {
        this.jsonBuilder = jsonBuilder;
        this.trialTemplates = {};
        this.trialVariables = {};
        this.factorialDesign = {};
        
        this.initializeTrialTemplates();
    }

    /**
     * Initialize built-in trial templates
     */
    initializeTrialTemplates() {
        this.trialTemplates = {
            'simple-rt': {
                name: 'Simple Reaction Time',
                description: 'Basic reaction time task with stimulus presentation',
                template: {
                    type: 'html-keyboard-response',
                    stimulus: '<div style="font-size: 60px;">+</div>',
                    choices: ['space'],
                    trial_duration: 2000,
                    stimulus_duration: 1000,
                    data: {
                        task: 'simple-rt',
                        correct_response: 'space'
                    }
                },
                variables: {
                    stimulus_duration: [500, 1000, 1500],
                    stimulus: ['<div style="font-size: 60px;">+</div>', '<div style="font-size: 60px;">*</div>']
                }
            },

            'choice-rt': {
                name: 'Choice Reaction Time',
                description: 'Two-choice reaction time with left/right responses',
                template: {
                    type: 'image-keyboard-response',
                    stimulus: 'img/arrow_left.png',
                    choices: ['f', 'j'],
                    trial_duration: 3000,
                    data: {
                        task: 'choice-rt',
                        stimulus_type: 'arrow',
                        correct_response: 'f'
                    }
                },
                variables: {
                    stimulus: ['img/arrow_left.png', 'img/arrow_right.png'],
                    correct_response: ['f', 'j']
                }
            },

            'go-nogo': {
                name: 'Go/No-Go Task',
                description: 'Inhibitory control task with go and no-go trials',
                template: {
                    type: 'html-keyboard-response',
                    stimulus: '<div style="font-size: 48px; color: green;">GO</div>',
                    choices: ['space'],
                    trial_duration: 2000,
                    data: {
                        task: 'go-nogo',
                        trial_type: 'go',
                        correct_response: 'space'
                    }
                },
                variables: {
                    stimulus: [
                        '<div style="font-size: 48px; color: green;">GO</div>',
                        '<div style="font-size: 48px; color: red;">STOP</div>'
                    ],
                    trial_type: ['go', 'nogo'],
                    correct_response: ['space', null],
                    choices: [['space'], []]
                }
            },

            'stroop': {
                name: 'Stroop Task',
                description: 'Color-word interference task',
                template: {
                    type: 'html-keyboard-response',
                    stimulus: '<div style="font-size: 48px; color: red;">RED</div>',
                    choices: ['r', 'g', 'b', 'y'],
                    trial_duration: 3000,
                    data: {
                        task: 'stroop',
                        word: 'red',
                        color: 'red',
                        congruent: true,
                        correct_response: 'r'
                    }
                },
                variables: {
                    word: ['red', 'green', 'blue', 'yellow'],
                    color: ['red', 'green', 'blue', 'yellow'],
                    congruent: [true, false]
                }
            },

            'n-back': {
                name: 'N-Back Working Memory',
                description: 'Working memory task with n-back matching',
                template: {
                    type: 'html-keyboard-response',
                    stimulus: '<div style="font-size: 72px;">A</div>',
                    choices: ['y', 'n'],
                    trial_duration: 3000,
                    stimulus_duration: 2000,
                    data: {
                        task: 'n-back',
                        stimulus: 'A',
                        n_back_level: 2,
                        target: false,
                        correct_response: 'n'
                    }
                },
                variables: {
                    stimulus: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
                    n_back_level: [1, 2, 3],
                    target: [true, false]
                }
            },

            'simon': {
                name: 'Simon Task',
                description: 'Spatial interference task',
                template: {
                    type: 'html-keyboard-response',
                    stimulus: '<div style="position: absolute; left: 200px; top: 300px; width: 50px; height: 50px; background-color: red; border-radius: 50%;"></div>',
                    choices: ['f', 'j'],
                    trial_duration: 2000,
                    data: {
                        task: 'simon',
                        stimulus_color: 'red',
                        stimulus_position: 'left',
                        correct_response: 'f',
                        congruent: true
                    }
                },
                variables: {
                    stimulus_color: ['red', 'blue'],
                    stimulus_position: ['left', 'right'],
                    correct_response: ['f', 'j'],
                    congruent: [true, false]
                }
            }
        };
    }

    /**
     * Generate trials from template with factorial design
     */
    generateTrialsFromTemplate(templateName, options = {}) {
        const template = this.trialTemplates[templateName];
        if (!template) {
            throw new Error(`Trial template '${templateName}' not found`);
        }

        const {
            repetitions = 1,
            randomize = true,
            balanceFactors = true,
            includeBreaks = false,
            breakInterval = 50
        } = options;

        // Generate factorial combinations
        const trialCombinations = this.generateFactorialCombinations(
            template.variables || {}, 
            template.template
        );

        // Repeat trials as specified
        let trials = [];
        for (let rep = 0; rep < repetitions; rep++) {
            trials = trials.concat(trialCombinations.map(trial => ({
                ...trial,
                data: {
                    ...trial.data,
                    repetition: rep + 1
                }
            })));
        }

        // Randomize if requested
        if (randomize) {
            trials = this.shuffleTrials(trials);
        }

        // Add breaks if requested
        if (includeBreaks && breakInterval > 0) {
            trials = this.insertBreaks(trials, breakInterval);
        }

        return trials;
    }

    /**
     * Generate all factorial combinations of variables
     */
    generateFactorialCombinations(variables, baseTemplate) {
        // Get all variable names
        const variableNames = Object.keys(variables);
        if (variableNames.length === 0) {
            return [{ ...baseTemplate }];
        }

        // Generate all combinations
        const combinations = this.cartesianProduct(variables);
        
        return combinations.map(combination => {
            const trial = { ...baseTemplate };
            
            // Apply variable values
            variableNames.forEach(varName => {
                const value = combination[varName];
                
                // Set the parameter value
                if (varName in trial) {
                    trial[varName] = value;
                }
                
                // Also set in data object for analysis
                if (!trial.data) trial.data = {};
                trial.data[varName] = value;
            });

            return trial;
        });
    }

    /**
     * Calculate cartesian product of variable arrays
     */
    cartesianProduct(variables) {
        const keys = Object.keys(variables);
        if (keys.length === 0) return [{}];
        
        return keys.reduce((acc, key) => {
            const values = variables[key];
            const newAcc = [];
            
            acc.forEach(accItem => {
                values.forEach(value => {
                    newAcc.push({
                        ...accItem,
                        [key]: value
                    });
                });
            });
            
            return newAcc;
        }, [{}]);
    }

    /**
     * Shuffle trials using Fisher-Yates algorithm
     */
    shuffleTrials(trials) {
        const shuffled = [...trials];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    /**
     * Insert break screens into trial sequence
     */
    insertBreaks(trials, interval) {
        const trialsWithBreaks = [];
        
        trials.forEach((trial, index) => {
            trialsWithBreaks.push(trial);
            
            // Insert break after every interval trials (but not after the last trial)
            if ((index + 1) % interval === 0 && index < trials.length - 1) {
                trialsWithBreaks.push(this.createBreakTrial(index + 1, trials.length));
            }
        });
        
        return trialsWithBreaks;
    }

    /**
     * Create a break trial
     */
    createBreakTrial(currentTrial, totalTrials) {
        const progress = Math.round((currentTrial / totalTrials) * 100);
        
        return {
            type: 'html-keyboard-response',
            stimulus: `
                <div style="text-align: center; font-size: 18px;">
                    <h2>Break Time</h2>
                    <p>You have completed ${currentTrial} out of ${totalTrials} trials.</p>
                    <p>Progress: ${progress}%</p>
                    <div style="width: 300px; height: 20px; border: 1px solid #ccc; margin: 20px auto;">
                        <div style="width: ${progress}%; height: 100%; background-color: #007bff;"></div>
                    </div>
                    <p>Take a moment to rest, then press the spacebar to continue.</p>
                </div>
            `,
            choices: ['space'],
            data: {
                trial_type: 'break',
                progress: progress
            }
        };
    }

    /**
     * Create practice block from main trials
     */
    createPracticeBlock(trials, practiceCount = 5, randomSelect = true) {
        let practiceTrials;
        
        if (randomSelect) {
            // Randomly select trials for practice
            const shuffled = this.shuffleTrials([...trials]);
            practiceTrials = shuffled.slice(0, practiceCount);
        } else {
            // Take first N trials
            practiceTrials = trials.slice(0, practiceCount);
        }
        
        // Mark as practice trials
        return practiceTrials.map((trial, index) => ({
            ...trial,
            data: {
                ...trial.data,
                trial_type: 'practice',
                practice_trial: index + 1,
                give_feedback: true // Usually want feedback in practice
            }
        }));
    }

    /**
     * Generate continuous experiment parameters
     */
    generateContinuousParameters(options = {}) {
        const {
            duration = 60, // seconds
            frameRate = 60, // fps
            updateInterval = 16, // ms (1000/60 for 60fps)
            parameterUpdates = [],
            eventTriggers = []
        } = options;

        const totalFrames = duration * frameRate;
        const parameters = {
            experiment_type: 'continuous',
            duration_seconds: duration,
            frame_rate: frameRate,
            total_frames: totalFrames,
            update_interval: updateInterval,
            parameter_timeline: [],
            event_triggers: eventTriggers
        };

        // Generate parameter timeline
        for (let frame = 0; frame < totalFrames; frame++) {
            const timeMs = (frame / frameRate) * 1000;
            const frameParams = this.calculateFrameParameters(frame, timeMs, parameterUpdates);
            
            if (Object.keys(frameParams).length > 0) {
                parameters.parameter_timeline.push({
                    frame: frame,
                    time_ms: timeMs,
                    parameters: frameParams
                });
            }
        }

        return parameters;
    }

    /**
     * Calculate parameters for a specific frame
     */
    calculateFrameParameters(frame, timeMs, parameterUpdates) {
        const frameParams = {};
        
        parameterUpdates.forEach(update => {
            const { parameter, function_type, ...options } = update;
            
            let value;
            switch (function_type) {
                case 'sine_wave':
                    value = this.sineWave(timeMs, options);
                    break;
                case 'linear_ramp':
                    value = this.linearRamp(timeMs, options);
                    break;
                case 'step_function':
                    value = this.stepFunction(timeMs, options);
                    break;
                case 'random_walk':
                    value = this.randomWalk(frame, options);
                    break;
                case 'gaussian_noise':
                    value = this.gaussianNoise(options);
                    break;
                default:
                    value = options.default_value || 0;
            }
            
            frameParams[parameter] = value;
        });
        
        return frameParams;
    }

    /**
     * Sine wave parameter function
     */
    sineWave(timeMs, options) {
        const { amplitude = 1, frequency = 1, phase = 0, offset = 0 } = options;
        return amplitude * Math.sin(2 * Math.PI * frequency * (timeMs / 1000) + phase) + offset;
    }

    /**
     * Linear ramp parameter function
     */
    linearRamp(timeMs, options) {
        const { start_value = 0, end_value = 1, duration = 1000 } = options;
        const progress = Math.min(timeMs / duration, 1);
        return start_value + (end_value - start_value) * progress;
    }

    /**
     * Step function parameter
     */
    stepFunction(timeMs, options) {
        const { steps = [], default_value = 0 } = options;
        
        for (const step of steps) {
            if (timeMs >= step.start_time && timeMs < step.end_time) {
                return step.value;
            }
        }
        
        return default_value;
    }

    /**
     * Random walk parameter
     */
    randomWalk(frame, options) {
        const { step_size = 0.1, bounds = null, start_value = 0 } = options;
        
        // This is simplified - in practice, you'd maintain state
        if (!this.randomWalkState) this.randomWalkState = {};
        if (!this.randomWalkState[frame]) {
            this.randomWalkState[frame] = start_value;
        }
        
        const currentValue = this.randomWalkState[frame - 1] || start_value;
        const step = (Math.random() - 0.5) * 2 * step_size;
        let newValue = currentValue + step;
        
        // Apply bounds if specified
        if (bounds) {
            newValue = Math.max(bounds.min, Math.min(bounds.max, newValue));
        }
        
        this.randomWalkState[frame] = newValue;
        return newValue;
    }

    /**
     * Gaussian noise parameter
     */
    gaussianNoise(options) {
        const { mean = 0, std_dev = 1 } = options;
        
        // Box-Muller transform for normal distribution
        if (!this.gaussianSpare) {
            const u = Math.random();
            const v = Math.random();
            this.gaussianSpare = Math.sqrt(-2 * Math.log(u)) * Math.sin(2 * Math.PI * v);
            return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * std_dev + mean;
        } else {
            const value = this.gaussianSpare * std_dev + mean;
            this.gaussianSpare = null;
            return value;
        }
    }

    /**
     * Validate trial configuration
     */
    validateTrialConfiguration(trials) {
        const errors = [];
        const warnings = [];

        if (!Array.isArray(trials)) {
            errors.push('Trials must be an array');
            return { valid: false, errors, warnings };
        }

        trials.forEach((trial, index) => {
            // Check required fields
            if (!trial.type) {
                errors.push(`Trial ${index}: Missing 'type' field`);
            }

            // Check for common issues
            if (trial.choices && Array.isArray(trial.choices) && trial.choices.length === 0) {
                warnings.push(`Trial ${index}: Empty choices array`);
            }

            if (trial.trial_duration && trial.trial_duration < 100) {
                warnings.push(`Trial ${index}: Very short trial duration (${trial.trial_duration}ms)`);
            }

            if (!trial.data || typeof trial.data !== 'object') {
                warnings.push(`Trial ${index}: Missing or invalid data object`);
            }
        });

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Get available trial templates
     */
    getAvailableTemplates() {
        return Object.keys(this.trialTemplates).map(key => ({
            id: key,
            ...this.trialTemplates[key]
        }));
    }

    /**
     * Get trial template by name
     */
    getTemplate(templateName) {
        return this.trialTemplates[templateName] || null;
    }

    /**
     * Add custom trial template
     */
    addCustomTemplate(name, template) {
        this.trialTemplates[name] = template;
    }

    /**
     * Remove trial template
     */
    removeTemplate(templateName) {
        delete this.trialTemplates[templateName];
    }

    /**
     * Export trial configuration as jsPsych timeline
     */
    exportAsJsPsychTimeline(trials) {
        return {
            timeline: trials,
            timeline_variables: this.extractTimelineVariables(trials),
            randomize_order: false, // Can be overridden
            repetitions: 1 // Can be overridden
        };
    }

    /**
     * Extract timeline variables from trials
     */
    extractTimelineVariables(trials) {
        // This would analyze trials and extract common variable patterns
        // Simplified implementation for now
        return [];
    }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TrialManager;
}