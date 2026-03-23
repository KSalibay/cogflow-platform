/**
 * Unified Schema System - Simple and Direct
 * No complex transformations, just parameter definitions
 */

class UnifiedSchema {
    constructor() {
        this.parameterTypes = {
            STRING: 'string',
            NUMBER: 'number', 
            BOOLEAN: 'boolean',
            COLOR: 'color',
            SELECT: 'select'
        };
        
        // Single parameter definition used by all components
        this.standardParameters = this.createStandardParameters();
    }

    createStandardParameters() {
        return {
            // Basic identification
            name: { 
                type: this.parameterTypes.STRING,
                default: '',
                description: 'Component name'
            },

            // RDM Motion Parameters
            coherence: { 
                type: this.parameterTypes.NUMBER,
                default: 0.5,
                min: 0,
                max: 1,
                step: 0.01,
                description: 'Motion coherence (0-1)'
            },
            direction: { 
                type: this.parameterTypes.NUMBER,
                default: 0,
                min: 0,
                max: 359,
                description: 'Motion direction in degrees'
            },
            speed: { 
                type: this.parameterTypes.NUMBER,
                default: 6,
                min: 1,
                max: 20,
                description: 'Dot movement speed'
            },

            // RDM Dot Parameters
            dot_color: {
                type: this.parameterTypes.COLOR,
                default: '#FFFFFF',
                description: 'Color of the dots'
            },
            total_dots: { 
                type: this.parameterTypes.NUMBER,
                default: 150,
                min: 10,
                max: 1000,
                description: 'Total number of dots'
            },
            dot_size: { 
                type: this.parameterTypes.NUMBER,
                default: 4,
                min: 1,
                max: 20,
                description: 'Size of dots in pixels'
            },

            // RDM Display Parameters
            aperture_diameter: { 
                type: this.parameterTypes.NUMBER,
                default: 350,
                min: 50,
                max: 800,
                description: 'Aperture diameter in pixels'
            },
            stimulus_duration: { 
                type: this.parameterTypes.NUMBER,
                default: 1500,
                min: 100,
                max: 10000,
                description: 'Stimulus duration in milliseconds'
            },

            // Instructions Parameters
            stimulus: {
                type: this.parameterTypes.STRING,
                default: 'Welcome to the experiment.',
                description: 'Instruction text to display'
            },

            // RDM Groups Parameters
            enable_groups: { 
                type: this.parameterTypes.BOOLEAN,
                default: false,
                description: 'Enable dot groups functionality'
            },
            group_1_percentage: { 
                type: this.parameterTypes.NUMBER,
                default: 50,
                min: 0,
                max: 100,
                description: 'Percentage of dots in group 1'
            },
            group_1_color: { 
                type: this.parameterTypes.COLOR,
                default: '#FF0066',
                description: 'Color for group 1 dots'
            },
            group_1_coherence: { 
                type: this.parameterTypes.NUMBER,
                default: 0.2,
                min: 0,
                max: 1,
                step: 0.01,
                description: 'Motion coherence for group 1'
            },
            group_2_percentage: { 
                type: this.parameterTypes.NUMBER,
                default: 50,
                min: 0,
                max: 100,
                description: 'Percentage of dots in group 2'
            },
            group_2_color: { 
                type: this.parameterTypes.COLOR,
                default: '#0066FF',
                description: 'Color for group 2 dots'
            },
            group_2_coherence: { 
                type: this.parameterTypes.NUMBER,
                default: 0.8,
                min: 0,
                max: 1,
                step: 0.01,
                description: 'Motion coherence for group 2'
            },

            // Adaptive Parameters
            algorithm: { 
                type: this.parameterTypes.SELECT,
                default: 'quest',
                options: ['quest', 'staircase', 'simple'],
                description: 'Adaptive algorithm to use'
            },
            target_performance: { 
                type: this.parameterTypes.NUMBER,
                default: 0.82,
                min: 0.5,
                max: 1.0,
                step: 0.01,
                description: 'Target performance level'
            },
            initial_coherence: { 
                type: this.parameterTypes.NUMBER,
                default: 0.1,
                min: 0,
                max: 1,
                step: 0.01,
                description: 'Initial coherence estimate'
            },
            step_size: { 
                type: this.parameterTypes.NUMBER,
                default: 0.05,
                min: 0.001,
                max: 0.5,
                step: 0.001,
                description: 'Step size for adjustments'
            },

            // MOT Parameters
            num_objects: {
                type: this.parameterTypes.NUMBER,
                default: 8,
                min: 2,
                max: 20,
                description: 'Total number of objects on screen'
            },
            num_targets: {
                type: this.parameterTypes.NUMBER,
                default: 4,
                min: 1,
                max: 10,
                description: 'Number of target objects to track'
            },
            object_radius_px: {
                type: this.parameterTypes.NUMBER,
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
                description: 'Alternate flash color used to cue targets during cue phase'
            },
            mot_background_color: {
                type: this.parameterTypes.COLOR,
                default: '#111111',
                description: 'Canvas background color'
            },
            arena_width_px: {
                type: this.parameterTypes.NUMBER,
                default: 700,
                min: 200,
                max: 1400,
                description: 'Width of the arena canvas in pixels'
            },
            arena_height_px: {
                type: this.parameterTypes.NUMBER,
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
            speed_px_per_s: {
                type: this.parameterTypes.NUMBER,
                default: 150,
                min: 20,
                max: 600,
                description: 'Object speed in pixels per second'
            },
            motion_type: {
                type: this.parameterTypes.SELECT,
                default: 'linear',
                options: ['linear', 'curved'],
                description: 'Trajectory type: linear or curved'
            },
            tracking_duration_ms: {
                type: this.parameterTypes.NUMBER,
                default: 8000,
                min: 1000,
                max: 30000,
                description: 'Duration of the tracking phase (ms)'
            },
            cue_duration_ms: {
                type: this.parameterTypes.NUMBER,
                default: 2000,
                min: 500,
                max: 5000,
                description: 'Duration of the cue phase (ms)'
            },
            probe_mode: {
                type: this.parameterTypes.SELECT,
                default: 'click',
                options: ['click', 'number_entry'],
                description: 'Probe interaction mode'
            }
        };
    }

    /**
     * Get parameters for any component type - SAME SCHEMA FOR ALL
     */
    getComponentParameters(componentType) {
        // Return relevant parameters based on component type
        const allParams = this.standardParameters;
        
        switch (componentType) {
            case 'rdm-trial':
                return this.filterParameters(allParams, [
                    'name', 'coherence', 'direction', 'speed', 'dot_color', 
                    'total_dots', 'dot_size', 'aperture_diameter', 'stimulus_duration'
                ]);
                
            case 'rdm-practice':
                return this.filterParameters(allParams, [
                    'name', 'coherence', 'direction', 'speed', 'dot_color', 
                    'total_dots', 'dot_size', 'aperture_diameter', 'stimulus_duration'
                ]);
                
            case 'rdm-dot-groups':
                return this.filterParameters(allParams, [
                    'name', 'enable_groups', 'group_1_percentage', 'group_1_color', 'group_1_coherence',
                    'group_2_percentage', 'group_2_color', 'group_2_coherence',
                    'total_dots', 'aperture_diameter', 'stimulus_duration'
                ]);
                
            case 'rdm-adaptive':
                return this.filterParameters(allParams, [
                    'name', 'algorithm', 'target_performance', 'initial_coherence', 'step_size',
                    'direction', 'speed', 'dot_color', 'total_dots', 'stimulus_duration'
                ]);
                
            case 'html-keyboard-response':
            case 'instructions':
                return this.filterParameters(allParams, ['name', 'stimulus']);

            case 'mot-trial':
                return this.filterParameters(allParams, [
                    'name', 'num_objects', 'num_targets', 'object_radius_px',
                    'object_color', 'target_cue_color', 'mot_background_color',
                    'arena_width_px', 'arena_height_px', 'boundary_behavior',
                    'speed_px_per_s', 'motion_type',
                    'tracking_duration_ms', 'cue_duration_ms', 'probe_mode'
                ]);

            default:
                return {};
        }
    }

    /**
     * Filter parameters to only include specified ones
     */
    filterParameters(allParams, paramNames) {
        const filtered = {};
        paramNames.forEach(name => {
            if (allParams[name]) {
                filtered[name] = allParams[name];
            }
        });
        return filtered;
    }

    /**
     * Simple component schema - NO COMPLEX TRANSFORMATIONS
     */
    getPluginSchema(componentType) {
        return {
            name: componentType,
            description: `${componentType} component`,
            parameters: this.getComponentParameters(componentType)
        };
    }
}

// Expose globally (browser) and for optional CommonJS usage.
if (typeof window !== 'undefined') {
    window.UnifiedSchema = UnifiedSchema;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UnifiedSchema;
}