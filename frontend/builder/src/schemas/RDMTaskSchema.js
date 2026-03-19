/**
 * RDM Task Schema Validation
 * 
 * Validates JSON configurations specifically for Random Dot Motion tasks
 * Extends the base jsPsych schema with RDM-specific validation rules
 */

class RDMTaskSchema {
    constructor() {
        this.schema = this.defineRDMSchema();
        this.validationRules = this.defineValidationRules();
    }

    /**
     * Define the complete RDM schema structure
     */
    defineRDMSchema() {
        return {
            experiment_meta: {
                required: true,
                type: 'object',
                properties: {
                    name: { type: 'string', required: true },
                    version: { type: 'string', required: true },
                    description: { type: 'string', required: true },
                    author: { type: 'string', required: false },
                    created_date: { type: 'string', required: false },
                    jsPsych_version: { type: 'string', required: true },
                    estimated_duration: { type: 'string', required: false }
                }
            },

            experiment_type: {
                required: true,
                type: 'string',
                enum: ['trial-based', 'continuous'],
                description: 'Type of experimental presentation'
            },

            timeline_type: {
                required: true,
                type: 'string',
                enum: ['trial-based', 'frame-based', 'event-driven'],
                description: 'How the timeline is structured'
            },

            data_collection: {
                required: true,
                type: 'object',
                properties: {
                    reaction_time: {
                        type: 'object',
                        properties: {
                            enabled: { type: 'boolean', required: true },
                            precision: { type: 'string', enum: ['milliseconds', 'microseconds'] },
                            min_valid_rt: { type: 'number', min: 0 },
                            max_valid_rt: { type: 'number', min: 1 },
                            collect_on: { type: 'string', enum: ['response', 'stimulus_offset', 'stimulus_onset'] }
                        }
                    },
                    accuracy: {
                        type: 'object',
                        properties: {
                            enabled: { type: 'boolean', required: true },
                            track_confidence: { type: 'boolean' },
                            feedback_mode: { type: 'string', enum: ['none', 'immediate', 'delayed'] },
                            feedback_delay: { type: 'number', min: 0 }
                        }
                    },
                    mouse_tracking: {
                        type: 'object',
                        properties: {
                            enabled: { type: 'boolean', required: true },
                            sampling_rate: { type: 'number', min: 1, max: 120 },
                            track_trajectory: { type: 'boolean' },
                            track_velocity: { type: 'boolean' },
                            normalize_coordinates: { type: 'boolean' }
                        }
                    },
                    eye_tracking: {
                        type: 'object',
                        properties: {
                            enabled: { type: 'boolean', required: true },
                            sampling_rate: { type: 'number', min: 1, max: 120 },
                            aoi_definitions: { type: 'array' }
                        }
                    }
                }
            },

            display_parameters: {
                required: true,
                type: 'object',
                properties: {
                    canvas: {
                        type: 'object',
                        properties: {
                            width: { type: 'number', min: 100, max: 2000 },
                            height: { type: 'number', min: 100, max: 2000 },
                            background_color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
                            border: { type: 'boolean' },
                            fullscreen: { type: 'boolean' }
                        }
                    },
                    aperture: {
                        type: 'object',
                        properties: {
                            shape: { type: 'string', enum: ['circle', 'rectangle', 'ellipse'] },
                            diameter: { type: 'number', min: 50, max: 1000 },
                            width: { type: 'number', min: 50, max: 1000 },
                            height: { type: 'number', min: 50, max: 1000 },
                            center_x: { type: 'number' },
                            center_y: { type: 'number' },
                            border_width: { type: 'number', min: 0 },
                            border_color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
                            mask_outside: { type: 'boolean' }
                        }
                    },
                    fixation: {
                        type: 'object',
                        properties: {
                            enabled: { type: 'boolean' },
                            type: { type: 'string', enum: ['cross', 'dot', 'circle', 'square'] },
                            size: { type: 'number', min: 2, max: 50 },
                            color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
                            thickness: { type: 'number', min: 1, max: 10 },
                            duration: { type: 'string', enum: ['continuous', 'pre_stimulus_only', 'custom'] }
                        }
                    }
                }
            },

            dot_parameters: {
                required: true,
                type: 'object',
                properties: {
                    population: {
                        type: 'object',
                        properties: {
                            total_dots: { type: 'number', min: 1, max: 10000 },
                            dot_groups: { 
                                type: 'array',
                                minItems: 1,
                                items: {
                                    type: 'object',
                                    properties: {
                                        group_id: { type: 'string', required: true },
                                        proportion: { type: 'number', min: 0, max: 1 },
                                        color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
                                        size: { type: 'number', min: 1, max: 20 },
                                        shape: { type: 'string', enum: ['circle', 'square'] }
                                    }
                                }
                            },
                            density: { type: 'string', enum: ['uniform', 'gaussian', 'custom'] },
                            spatial_distribution: { type: 'string', enum: ['random', 'grid', 'clustered'] }
                        }
                    },
                    appearance: {
                        type: 'object',
                        properties: {
                            dot_size: { type: 'number', min: 1, max: 20 },
                            dot_color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
                            anti_aliasing: { type: 'boolean' },
                            opacity: { type: 'number', min: 0, max: 1 },
                            luminance: { type: 'number', min: 0, max: 255 }
                        }
                    },
                    lifecycle: {
                        type: 'object',
                        properties: {
                            dot_lifetime: {
                                type: 'object',
                                properties: {
                                    enabled: { type: 'boolean' },
                                    min_lifetime: { type: 'number', min: 1 },
                                    max_lifetime: { type: 'number', min: 1 },
                                    unit: { type: 'string', enum: ['frames', 'milliseconds'] }
                                }
                            },
                            regeneration: {
                                type: 'object',
                                properties: {
                                    method: { type: 'string', enum: ['random_position', 'opposite_side', 'fixed_position'] },
                                    maintain_density: { type: 'boolean' },
                                    avoid_fixation: { type: 'boolean' },
                                    avoidance_radius: { type: 'number', min: 0 }
                                }
                            }
                        }
                    }
                }
            },

            motion_parameters: {
                required: true,
                type: 'object',
                properties: {
                    global_motion: {
                        type: 'object',
                        properties: {
                            coherence: { 
                                type: ['number', 'string'], 
                                min: 0, 
                                max: 1,
                                enum_string: ['trial_variable', 'adaptive'] 
                            },
                            direction: { 
                                type: ['number', 'string'], 
                                min: 0, 
                                max: 360,
                                enum_string: ['trial_variable'] 
                            },
                            speed: { type: 'number', min: 0.1, max: 100 },
                            motion_type: { type: 'string', enum: ['linear', 'radial', 'rotational', 'complex'] },
                            reference_frame: { type: 'string', enum: ['lab', 'retinal'] }
                        }
                    },
                    noise_motion: {
                        type: 'object',
                        properties: {
                            type: { 
                                type: 'string', 
                                enum: ['random_direction', 'random_walk', 'brownian', 'correlated_noise'] 
                            },
                            step_size: { type: 'number', min: 0.1, max: 50 },
                            direction_change_probability: { type: 'number', min: 0, max: 1 },
                            speed_variation: { type: 'number', min: 0, max: 1 }
                        }
                    },
                    boundary_behavior: {
                        type: 'object',
                        properties: {
                            edge_behavior: { type: 'string', enum: ['wrap', 'bounce', 'disappear', 'regenerate'] },
                            aperture_behavior: { type: 'string', enum: ['reflect', 'wrap', 'disappear', 'regenerate'] },
                            collision_detection: { type: 'boolean' }
                        }
                    }
                }
            },

            temporal_parameters: {
                required: true,
                type: 'object',
                properties: {
                    timing: {
                        type: 'object',
                        properties: {
                            frame_rate: { type: 'number', enum: [30, 60, 75, 90, 120] },
                            stimulus_duration: { type: 'number', min: 100, max: 30000 },
                            pre_stimulus_blank: { type: 'number', min: 0, max: 5000 },
                            post_stimulus_blank: { type: 'number', min: 0, max: 5000 },
                            inter_trial_interval: { type: 'number', min: 0, max: 10000 },
                            response_timeout: { type: 'number', min: 500, max: 30000 }
                        }
                    },
                    motion_onset: {
                        type: 'object',
                        properties: {
                            delay: { type: 'number', min: 0, max: 5000 },
                            ramp_duration: { type: 'number', min: 0, max: 2000 },
                            ramp_type: { type: 'string', enum: ['linear', 'exponential', 'sigmoid'] }
                        }
                    }
                }
            },

            response_parameters: {
                required: true,
                type: 'object',
                properties: {
                    response_type: { 
                        type: 'string', 
                        enum: ['keyboard', 'mouse', 'gamepad', 'touch'] 
                    },
                    keyboard_responses: {
                        type: 'object',
                        properties: {
                            choices: { 
                                type: 'array',
                                minItems: 1,
                                items: { type: 'string' }
                            },
                            choice_mapping: { type: 'object' },
                            require_response: { type: 'boolean' },
                            response_deadline: { type: 'number', min: 100 },
                            response_window: { 
                                type: 'string', 
                                enum: ['during_stimulus', 'after_stimulus', 'during_and_after_stimulus'] 
                            }
                        }
                    },
                    confidence_rating: {
                        type: 'object',
                        properties: {
                            enabled: { type: 'boolean' },
                            scale: { type: 'string', enum: ['1-4', '1-7', 'slider'] },
                            labels: { type: 'array' },
                            prompt: { type: 'string' },
                            required: { type: 'boolean' },
                            timeout: { type: 'number', min: 1000 }
                        }
                    }
                }
            }
        };
    }

    /**
     * Define validation rules for RDM-specific constraints
     */
    defineValidationRules() {
        return {
            coherence_direction_consistency: {
                description: 'Coherence and direction must be consistent across trial definitions',
                validate: (config) => {
                    const errors = [];
                    
                    if (config.trial_structure && config.trial_structure.trial_types) {
                        config.trial_structure.trial_types.forEach((trial, index) => {
                            if (trial.coherence === 'trial_variable' && typeof trial.direction !== 'number') {
                                errors.push(`Trial ${index}: If coherence is trial_variable, direction should be specified`);
                            }
                        });
                    }
                    
                    return errors;
                }
            },

            dot_population_consistency: {
                description: 'Dot group proportions must sum to 1.0',
                validate: (config) => {
                    const errors = [];
                    
                    if (config.dot_parameters && config.dot_parameters.population && config.dot_parameters.population.dot_groups) {
                        const totalProportion = config.dot_parameters.population.dot_groups.reduce((sum, group) => {
                            return sum + (group.proportion || 0);
                        }, 0);
                        
                        if (Math.abs(totalProportion - 1.0) > 0.001) {
                            errors.push(`Dot group proportions sum to ${totalProportion}, should sum to 1.0`);
                        }
                    }
                    
                    return errors;
                }
            },

            aperture_canvas_fit: {
                description: 'Aperture must fit within canvas dimensions',
                validate: (config) => {
                    const errors = [];
                    
                    const canvas = config.display_parameters?.canvas;
                    const aperture = config.display_parameters?.aperture;
                    
                    if (canvas && aperture) {
                        if (aperture.shape === 'circle') {
                            const radius = aperture.diameter / 2;
                            const centerX = aperture.center_x;
                            const centerY = aperture.center_y;
                            
                            if (centerX - radius < 0 || centerX + radius > canvas.width) {
                                errors.push('Circular aperture extends beyond canvas width');
                            }
                            if (centerY - radius < 0 || centerY + radius > canvas.height) {
                                errors.push('Circular aperture extends beyond canvas height');
                            }
                        }
                    }
                    
                    return errors;
                }
            },

            temporal_consistency: {
                description: 'Temporal parameters must be logically consistent',
                validate: (config) => {
                    const errors = [];
                    
                    const timing = config.temporal_parameters?.timing;
                    
                    if (timing) {
                        if (timing.response_timeout && timing.stimulus_duration && 
                            timing.response_timeout < timing.stimulus_duration) {
                            errors.push('Response timeout should be >= stimulus duration');
                        }
                        
                        if (timing.frame_rate && timing.stimulus_duration) {
                            const frameCount = (timing.stimulus_duration / 1000) * timing.frame_rate;
                            if (frameCount < 2) {
                                errors.push('Stimulus duration too short for specified frame rate');
                            }
                        }
                    }
                    
                    return errors;
                }
            },

            motion_parameter_consistency: {
                description: 'Motion parameters must be physically plausible',
                validate: (config) => {
                    const errors = [];
                    
                    const motion = config.motion_parameters?.global_motion;
                    const timing = config.temporal_parameters?.timing;
                    
                    if (motion && timing && config.display_parameters?.aperture) {
                        const pixelsPerFrame = motion.speed;
                        const framesPerSecond = timing.frame_rate;
                        const pixelsPerSecond = pixelsPerFrame * framesPerSecond;
                        const apertureDiameter = config.display_parameters.aperture.diameter;
                        
                        // Check if dots could traverse aperture in reasonable time
                        const traversalTime = apertureDiameter / pixelsPerSecond;
                        const stimulusDuration = timing.stimulus_duration / 1000;
                        
                        if (traversalTime > stimulusDuration * 2) {
                            errors.push('Dot speed may be too slow for stimulus duration');
                        }
                        
                        if (traversalTime < stimulusDuration / 10) {
                            errors.push('Dot speed may be too fast for stimulus duration');
                        }
                    }
                    
                    return errors;
                }
            },

            response_mapping_consistency: {
                description: 'Response mappings must cover all possible trial types',
                validate: (config) => {
                    const errors = [];
                    
                    const responses = config.response_parameters?.keyboard_responses;
                    const trialTypes = config.trial_structure?.trial_types;
                    
                    if (responses && trialTypes) {
                        const mappedResponses = Object.values(responses.choice_mapping || {});
                        
                        trialTypes.forEach((trial, index) => {
                            if (trial.correct_response && !responses.choices.includes(trial.correct_response)) {
                                errors.push(`Trial ${index}: correct_response '${trial.correct_response}' not in keyboard choices`);
                            }
                        });
                    }
                    
                    return errors;
                }
            }
        };
    }

    /**
     * Validate complete RDM configuration
     */
    validate(config) {
        const errors = [];
        const warnings = [];
        
        try {
            // Basic schema validation
            const schemaValidation = this.validateSchema(config, this.schema);
            errors.push(...schemaValidation.errors);
            warnings.push(...schemaValidation.warnings);
            
            // RDM-specific rule validation
            Object.values(this.validationRules).forEach(rule => {
                const ruleErrors = rule.validate(config);
                errors.push(...ruleErrors);
            });
            
            // Performance warnings
            const performanceWarnings = this.checkPerformanceConstraints(config);
            warnings.push(...performanceWarnings);
            
        } catch (error) {
            errors.push(`Validation error: ${error.message}`);
        }
        
        return {
            valid: errors.length === 0,
            errors,
            warnings,
            task_type: 'rdm'
        };
    }

    /**
     * Basic schema structure validation
     */
    validateSchema(config, schema, path = '') {
        const errors = [];
        const warnings = [];
        
        Object.entries(schema).forEach(([key, definition]) => {
            const currentPath = path ? `${path}.${key}` : key;
            const value = config[key];
            
            // Check required fields
            if (definition.required && (value === undefined || value === null)) {
                errors.push(`Missing required field: ${currentPath}`);
                return;
            }
            
            // Skip validation if field is not present and not required
            if (value === undefined || value === null) return;
            
            // Type validation
            if (definition.type) {
                if (!this.validateType(value, definition.type)) {
                    errors.push(`${currentPath}: Expected ${definition.type}, got ${typeof value}`);
                }
            }
            
            // Enum validation
            if (definition.enum && !definition.enum.includes(value)) {
                errors.push(`${currentPath}: Value '${value}' not in allowed values: ${definition.enum.join(', ')}`);
            }
            
            // Range validation
            if (typeof value === 'number') {
                if (definition.min !== undefined && value < definition.min) {
                    errors.push(`${currentPath}: Value ${value} below minimum ${definition.min}`);
                }
                if (definition.max !== undefined && value > definition.max) {
                    errors.push(`${currentPath}: Value ${value} above maximum ${definition.max}`);
                }
            }
            
            // Pattern validation for strings
            if (typeof value === 'string' && definition.pattern) {
                const regex = new RegExp(definition.pattern);
                if (!regex.test(value)) {
                    errors.push(`${currentPath}: Value '${value}' does not match required pattern`);
                }
            }
            
            // Recursive validation for objects
            if (definition.type === 'object' && definition.properties) {
                const nestedValidation = this.validateSchema(value, definition.properties, currentPath);
                errors.push(...nestedValidation.errors);
                warnings.push(...nestedValidation.warnings);
            }
            
            // Array validation
            if (definition.type === 'array' && Array.isArray(value)) {
                if (definition.minItems && value.length < definition.minItems) {
                    errors.push(`${currentPath}: Array has ${value.length} items, minimum ${definition.minItems}`);
                }
                if (definition.maxItems && value.length > definition.maxItems) {
                    errors.push(`${currentPath}: Array has ${value.length} items, maximum ${definition.maxItems}`);
                }
            }
        });
        
        return { errors, warnings };
    }

    /**
     * Validate type including mixed types
     */
    validateType(value, expectedType) {
        if (Array.isArray(expectedType)) {
            return expectedType.some(type => this.validateType(value, type));
        }
        
        switch (expectedType) {
            case 'string':
                return typeof value === 'string';
            case 'number':
                return typeof value === 'number';
            case 'boolean':
                return typeof value === 'boolean';
            case 'array':
                return Array.isArray(value);
            case 'object':
                return typeof value === 'object' && !Array.isArray(value) && value !== null;
            default:
                return true;
        }
    }

    /**
     * Check performance constraints and generate warnings
     */
    checkPerformanceConstraints(config) {
        const warnings = [];
        
        // High dot count warning
        const totalDots = config.dot_parameters?.population?.total_dots;
        if (totalDots > 500) {
            warnings.push(`High dot count (${totalDots}) may impact performance`);
        }
        
        // High frame rate with many dots
        const frameRate = config.temporal_parameters?.timing?.frame_rate;
        if (frameRate > 60 && totalDots > 200) {
            warnings.push('High frame rate with many dots may cause performance issues');
        }
        
        // Mouse tracking with high sampling rate
        const mouseTracking = config.data_collection?.mouse_tracking;
        if (mouseTracking?.enabled && mouseTracking.sampling_rate > 60) {
            warnings.push('High mouse tracking sampling rate may impact performance');
        }
        
        // Very short stimulus duration
        const stimulusDuration = config.temporal_parameters?.timing?.stimulus_duration;
        if (stimulusDuration < 200) {
            warnings.push('Very short stimulus duration may be difficult for participants');
        }
        
        // Very long stimulus duration
        if (stimulusDuration > 10000) {
            warnings.push('Very long stimulus duration may cause fatigue');
        }
        
        return warnings;
    }

    /**
     * Get schema for specific section
     */
    getSchema(section = null) {
        if (section) {
            return this.schema[section] || null;
        }
        return this.schema;
    }

    /**
     * Get validation rules
     */
    getValidationRules() {
        return this.validationRules;
    }

    /**
     * Validate specific RDM component types
     */
    validateComponent(component, componentType) {
        const errors = [];
        const warnings = [];

        try {
            switch (componentType) {
                case 'rdm-trial':
                    return this.validateRDMTrial(component);
                case 'rdm-practice':
                    return this.validateRDMPractice(component);
                case 'rdm-dot-groups':
                    return this.validateRDMDotGroups(component);
                case 'rdm-adaptive':
                    return this.validateRDMAdaptive(component);
                default:
                    errors.push(`Unknown RDM component type: ${componentType}`);
            }
        } catch (error) {
            errors.push(`Validation error for ${componentType}: ${error.message}`);
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    /**
     * Validate basic RDM trial component
     */
    validateRDMTrial(component) {
        const errors = [];
        const warnings = [];

        // Required parameters
        const required = ['coherence', 'direction', 'speed', 'stimulus_duration'];
        for (const param of required) {
            if (component[param] === undefined) {
                errors.push(`Missing required parameter: ${param}`);
            }
        }

        // Coherence validation
        if (component.coherence !== undefined) {
            if (component.coherence < 0 || component.coherence > 1) {
                errors.push('Coherence must be between 0 and 1');
            }
        }

        // Direction validation
        if (component.direction !== undefined) {
            if (component.direction < 0 || component.direction >= 360) {
                errors.push('Direction must be between 0 and 359 degrees');
            }
        }

        // Speed validation
        if (component.speed !== undefined) {
            if (component.speed <= 0) {
                errors.push('Speed must be positive');
            }
        }

        // Stimulus duration validation
        if (component.stimulus_duration !== undefined) {
            if (component.stimulus_duration <= 0) {
                errors.push('Stimulus duration must be positive');
            }
        }

        // Dot parameters validation
        if (component.total_dots !== undefined) {
            if (component.total_dots < 10 || component.total_dots > 1000) {
                warnings.push('Total dots should typically be between 10 and 1000');
            }
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    /**
     * Validate RDM practice trial component
     */
    validateRDMPractice(component) {
        // Start with basic trial validation
        const result = this.validateRDMTrial(component);

        // Practice-specific validation
        if (component.feedback !== undefined) {
            const validFeedback = ['accuracy', 'detailed', 'none'];
            if (!validFeedback.includes(component.feedback)) {
                result.errors.push(`Invalid feedback type: ${component.feedback}. Must be one of: ${validFeedback.join(', ')}`);
            }
        }

        if (component.coherence !== undefined && component.coherence < 0.3) {
            result.warnings.push('Practice trials typically use higher coherence (>0.3) for easier learning');
        }

        if (component.stimulus_duration !== undefined && component.stimulus_duration < 1000) {
            result.warnings.push('Practice trials often use longer stimulus duration (>1000ms) for learning');
        }

        return result;
    }

    /**
     * Validate RDM dot groups component
     */
    validateRDMDotGroups(component) {
        const errors = [];
        const warnings = [];

        // Check if groups are enabled
        if (!component.groups || !component.groups.enabled) {
            errors.push('Dot groups component must have groups enabled');
            return { valid: false, errors, warnings };
        }

        // Validate group definitions
        if (!component.groups.group_definitions || !Array.isArray(component.groups.group_definitions)) {
            errors.push('Group definitions must be an array');
            return { valid: false, errors, warnings };
        }

        const groups = component.groups.group_definitions;
        
        // Check minimum number of groups
        if (groups.length < 2) {
            errors.push('Dot groups component must have at least 2 groups');
        }

        // Validate percentage allocation
        let totalPercentage = 0;
        const groupIds = new Set();

        groups.forEach((group, index) => {
            // Check required properties
            const requiredProps = ['group_id', 'percentage', 'color', 'motion_properties'];
            requiredProps.forEach(prop => {
                if (group[prop] === undefined) {
                    errors.push(`Group ${index + 1} missing required property: ${prop}`);
                }
            });

            // Check unique group IDs
            if (groupIds.has(group.group_id)) {
                errors.push(`Duplicate group ID: ${group.group_id}`);
            }
            groupIds.add(group.group_id);

            // Validate percentage
            if (group.percentage !== undefined) {
                if (group.percentage <= 0 || group.percentage > 100) {
                    errors.push(`Group ${group.group_id} percentage must be between 0 and 100`);
                }
                totalPercentage += group.percentage;
            }

            // Validate motion properties
            if (group.motion_properties) {
                if (group.motion_properties.coherence !== undefined) {
                    if (group.motion_properties.coherence < 0 || group.motion_properties.coherence > 1) {
                        errors.push(`Group ${group.group_id} coherence must be between 0 and 1`);
                    }
                }

                if (group.motion_properties.direction !== undefined) {
                    if (group.motion_properties.direction < 0 || group.motion_properties.direction >= 360) {
                        errors.push(`Group ${group.group_id} direction must be between 0 and 359 degrees`);
                    }
                }
            }

            // Validate clustering parameters
            if (group.distribution === 'clustered') {
                if (!group.cluster_center || !Array.isArray(group.cluster_center) || group.cluster_center.length !== 2) {
                    errors.push(`Group ${group.group_id} clustered distribution requires cluster_center [x, y]`);
                }
                if (group.cluster_radius === undefined || group.cluster_radius <= 0) {
                    errors.push(`Group ${group.group_id} clustered distribution requires positive cluster_radius`);
                }
            }

            // Validate color format
            if (group.color && !group.color.match(/^#[0-9A-Fa-f]{6}$/)) {
                warnings.push(`Group ${group.group_id} color should be in hex format (#RRGGBB)`);
            }
        });

        // Check total percentage
        if (Math.abs(totalPercentage - 100) > 0.1) {
            errors.push(`Total group percentages must equal 100% (currently ${totalPercentage.toFixed(1)}%)`);
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    /**
     * Validate RDM adaptive component
     */
    validateRDMAdaptive(component) {
        const errors = [];
        const warnings = [];

        // Check adaptive algorithm
        if (!component.adaptive_algorithm) {
            errors.push('Adaptive component must specify adaptive_algorithm');
        } else {
            const validAlgorithms = ['quest', 'staircase', 'psi', 'custom'];
            if (!validAlgorithms.includes(component.adaptive_algorithm)) {
                errors.push(`Invalid adaptive algorithm: ${component.adaptive_algorithm}. Must be one of: ${validAlgorithms.join(', ')}`);
            }
        }

        // Validate QUEST parameters
        if (component.adaptive_algorithm === 'quest') {
            if (!component.quest_parameters) {
                errors.push('QUEST algorithm requires quest_parameters');
            } else {
                const questParams = component.quest_parameters;
                
                if (questParams.target_performance !== undefined) {
                    if (questParams.target_performance <= 0 || questParams.target_performance >= 1) {
                        errors.push('QUEST target_performance must be between 0 and 1');
                    }
                }

                if (questParams.threshold_estimate !== undefined && questParams.threshold_estimate < 0) {
                    errors.push('QUEST threshold_estimate must be non-negative');
                }

                if (questParams.threshold_sd !== undefined && questParams.threshold_sd <= 0) {
                    errors.push('QUEST threshold_sd must be positive');
                }
            }
        }

        // Validate staircase parameters
        if (component.adaptive_algorithm === 'staircase') {
            if (!component.staircase_parameters) {
                errors.push('Staircase algorithm requires staircase_parameters');
            } else {
                const staircaseParams = component.staircase_parameters;
                
                if (!staircaseParams.rule) {
                    errors.push('Staircase requires rule specification (e.g., "2-down-1-up")');
                }

                if (staircaseParams.step_size !== undefined && staircaseParams.step_size <= 0) {
                    errors.push('Staircase step_size must be positive');
                }

                if (staircaseParams.min_value !== undefined && staircaseParams.max_value !== undefined) {
                    if (staircaseParams.min_value >= staircaseParams.max_value) {
                        errors.push('Staircase min_value must be less than max_value');
                    }
                }
            }
        }

        // Check stopping criteria
        if (!component.stopping_criteria) {
            warnings.push('Adaptive component should specify stopping_criteria');
        } else {
            const criteria = component.stopping_criteria;
            
            if (criteria.max_trials !== undefined && criteria.max_trials <= 0) {
                errors.push('Stopping criteria max_trials must be positive');
            }

            if (criteria.min_trials !== undefined && criteria.max_trials !== undefined) {
                if (criteria.min_trials > criteria.max_trials) {
                    errors.push('Stopping criteria min_trials must be <= max_trials');
                }
            }

            if (criteria.convergence_threshold !== undefined && criteria.convergence_threshold <= 0) {
                errors.push('Stopping criteria convergence_threshold must be positive');
            }
        }

        return { valid: errors.length === 0, errors, warnings };
    }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RDMTaskSchema;
}