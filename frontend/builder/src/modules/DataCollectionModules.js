/**
 * Data Collection Modules
 * 
 * Handles different data collection modalities for experimental psychology tasks
 * Supports reaction time, accuracy, mouse tracking, keyboard tracking, and eye tracking
 */

class DataCollectionModules {
    constructor() {
        this.modules = {
            'reaction-time': new ReactionTimeModule(),
            'accuracy': new AccuracyModule(),
            'correctness': new CorrectnessModule(),
            'mouse-tracking': new MouseTrackingModule(),
            'keyboard-tracking': new KeyboardTrackingModule(),
            'eye-tracking': new EyeTrackingModule()
        };
        
        this.activeModules = new Set(['reaction-time', 'accuracy']);
    }

    /**
     * Toggle a specific module on/off
     */
    toggleModule(moduleId, isActive) {
        if (isActive) {
            this.activeModules.add(moduleId);
        } else {
            this.activeModules.delete(moduleId);
        }
        
        if (this.modules[moduleId]) {
            this.modules[moduleId].setActive(isActive);
        }
    }

    /**
     * Get parameters for active modules
     */
    getActiveModuleParameters() {
        const parameters = {};
        
        for (const moduleId of this.activeModules) {
            if (this.modules[moduleId]) {
                parameters[moduleId] = this.modules[moduleId].getParameters();
            }
        }
        
        return parameters;
    }

    /**
     * Get jsPsych extensions for active modules
     */
    getJsPsychExtensions() {
        const extensions = [];
        
        for (const moduleId of this.activeModules) {
            if (this.modules[moduleId] && this.modules[moduleId].getJsPsychExtension) {
                const extension = this.modules[moduleId].getJsPsychExtension();
                if (extension) extensions.push(extension);
            }
        }
        
        return extensions;
    }

    /**
     * Get initialization code for active modules
     */
    getInitializationCode() {
        const initCode = [];
        
        for (const moduleId of this.activeModules) {
            if (this.modules[moduleId] && this.modules[moduleId].getInitializationCode) {
                const code = this.modules[moduleId].getInitializationCode();
                if (code) initCode.push(code);
            }
        }
        
        return initCode.join('\n\n');
    }
}

/**
 * Base class for data collection modules
 */
class DataCollectionModule {
    constructor(name, description) {
        this.name = name;
        this.description = description;
        this.isActive = false;
        this.parameters = {};
    }

    setActive(active) {
        this.isActive = active;
    }

    getParameters() {
        return this.parameters;
    }

    updateParameter(key, value) {
        this.parameters[key] = value;
    }

    // Override in subclasses
    getJsPsychExtension() {
        return null;
    }

    getInitializationCode() {
        return '';
    }
}

/**
 * Reaction Time Module
 */
class ReactionTimeModule extends DataCollectionModule {
    constructor() {
        super('Reaction Time', 'Collect reaction time data from keyboard/button responses');
        this.parameters = {
            minimum_valid_rt: 100,
            maximum_valid_rt: 10000,
            collect_rt_on: ['keydown', 'click'],
            rt_precision: 'milliseconds'
        };
    }

    getJsPsychExtension() {
        return {
            type: 'reaction-time',
            params: {
                minimum_valid_rt: this.parameters.minimum_valid_rt,
                maximum_valid_rt: this.parameters.maximum_valid_rt
            }
        };
    }

    getInitializationCode() {
        return `
// Reaction Time Module Configuration
const reactionTimeConfig = {
    minimum_valid_rt: ${this.parameters.minimum_valid_rt},
    maximum_valid_rt: ${this.parameters.maximum_valid_rt},
    collect_rt_on: ${JSON.stringify(this.parameters.collect_rt_on)},
    rt_precision: "${this.parameters.rt_precision}"
};`;
    }
}

/**
 * Accuracy Module
 */
class AccuracyModule extends DataCollectionModule {
    constructor() {
        super('Accuracy', 'Track correct/incorrect responses and calculate accuracy metrics');
        this.parameters = {
            track_correct: true,
            track_incorrect: true,
            calculate_percentage: true,
            feedback_on_error: false,
            error_feedback_duration: 1000
        };
    }

    getInitializationCode() {
        return `
// Accuracy Module Configuration
const accuracyConfig = {
    track_correct: ${this.parameters.track_correct},
    track_incorrect: ${this.parameters.track_incorrect},
    calculate_percentage: ${this.parameters.calculate_percentage},
    feedback_on_error: ${this.parameters.feedback_on_error},
    error_feedback_duration: ${this.parameters.error_feedback_duration}
};

// Accuracy tracking functions
function checkAccuracy(response, correctAnswer) {
    const isCorrect = response === correctAnswer;
    return {
        correct: isCorrect,
        response: response,
        correct_answer: correctAnswer
    };
}`;
    }
}

/**
 * Mouse Tracking Module
 */
class MouseTrackingModule extends DataCollectionModule {
    constructor() {
        super('Mouse Tracking', 'Track mouse movements, clicks, and trajectories');
        this.parameters = {
            track_movement: true,
            track_clicks: true,
            track_wheel: false,
            sampling_rate: 50, // Hz
            normalize_coordinates: true,
            track_velocity: true,
            track_acceleration: false
        };
    }

    getJsPsychExtension() {
        return {
            type: 'mouse-tracking',
            params: {
                sampling_rate: this.parameters.sampling_rate,
                track_movement: this.parameters.track_movement,
                track_clicks: this.parameters.track_clicks
            }
        };
    }

    getInitializationCode() {
        return `
// Mouse Tracking Module Configuration
const mouseTrackingConfig = {
    sampling_rate: ${this.parameters.sampling_rate},
    track_movement: ${this.parameters.track_movement},
    track_clicks: ${this.parameters.track_clicks},
    track_wheel: ${this.parameters.track_wheel},
    normalize_coordinates: ${this.parameters.normalize_coordinates},
    track_velocity: ${this.parameters.track_velocity},
    track_acceleration: ${this.parameters.track_acceleration}
};

// Mouse tracking data storage
let mouseTrackingData = {
    positions: [],
    clicks: [],
    timestamps: []
};

// Mouse tracking event listeners
if (mouseTrackingConfig.track_movement) {
    document.addEventListener('mousemove', function(e) {
        const timestamp = performance.now();
        const position = mouseTrackingConfig.normalize_coordinates ? 
            { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight } :
            { x: e.clientX, y: e.clientY };
        
        mouseTrackingData.positions.push(position);
        mouseTrackingData.timestamps.push(timestamp);
    });
}

if (mouseTrackingConfig.track_clicks) {
    document.addEventListener('click', function(e) {
        const timestamp = performance.now();
        const clickData = {
            x: e.clientX,
            y: e.clientY,
            button: e.button,
            timestamp: timestamp
        };
        mouseTrackingData.clicks.push(clickData);
    });
}`;
    }
}

/**
 * Keyboard Tracking Module
 */
class KeyboardTrackingModule extends DataCollectionModule {
    constructor() {
        super('Keyboard Tracking', 'Track all keyboard presses, timing, and typing patterns');
        this.parameters = {
            track_all_keys: false,
            track_specific_keys: true,
            monitored_keys: ['Space', 'Enter', 'ArrowLeft', 'ArrowRight'],
            track_key_timing: true,
            track_typing_speed: false,
            track_inter_key_interval: true
        };
    }

    getInitializationCode() {
        return `
// Keyboard Tracking Module Configuration
const keyboardTrackingConfig = {
    track_all_keys: ${this.parameters.track_all_keys},
    track_specific_keys: ${this.parameters.track_specific_keys},
    monitored_keys: ${JSON.stringify(this.parameters.monitored_keys)},
    track_key_timing: ${this.parameters.track_key_timing},
    track_typing_speed: ${this.parameters.track_typing_speed},
    track_inter_key_interval: ${this.parameters.track_inter_key_interval}
};

// Keyboard tracking data storage
let keyboardTrackingData = {
    keyPresses: [],
    keyReleases: [],
    interKeyIntervals: []
};

let lastKeyTime = null;

// Keyboard event listeners
document.addEventListener('keydown', function(e) {
    const timestamp = performance.now();
    
    if (keyboardTrackingConfig.track_all_keys || 
        keyboardTrackingConfig.monitored_keys.includes(e.code)) {
        
        const keyData = {
            key: e.key,
            code: e.code,
            timestamp: timestamp,
            type: 'keydown'
        };
        
        keyboardTrackingData.keyPresses.push(keyData);
        
        if (keyboardTrackingConfig.track_inter_key_interval && lastKeyTime !== null) {
            const interval = timestamp - lastKeyTime;
            keyboardTrackingData.interKeyIntervals.push(interval);
        }
        
        lastKeyTime = timestamp;
    }
});

document.addEventListener('keyup', function(e) {
    if (keyboardTrackingConfig.track_all_keys || 
        keyboardTrackingConfig.monitored_keys.includes(e.code)) {
        
        const timestamp = performance.now();
        const keyData = {
            key: e.key,
            code: e.code,
            timestamp: timestamp,
            type: 'keyup'
        };
        
        keyboardTrackingData.keyReleases.push(keyData);
    }
});`;
    }
}

/**
 * Eye Tracking Module (WebGazer integration)
 */
class EyeTrackingModule extends DataCollectionModule {
    constructor() {
        super('Eye Tracking', 'WebGazer-based eye tracking via webcam');
        this.parameters = {
            calibration_points: 9,
            calibration_tolerance: 50,
            prediction_points: 50,
            sample_rate: 30, // Hz
            store_video: false,
            face_detection: true,
            precision_filter: true,
            smoothing_factor: 0.1
        };
    }

    getJsPsychExtension() {
        return {
            type: 'webgazer',
            params: {
                sample_rate: this.parameters.sample_rate,
                calibration_points: this.parameters.calibration_points
            }
        };
    }

    getInitializationCode() {
        return `
// Eye Tracking Module Configuration (WebGazer)
const eyeTrackingConfig = {
    calibration_points: ${this.parameters.calibration_points},
    calibration_tolerance: ${this.parameters.calibration_tolerance},
    prediction_points: ${this.parameters.prediction_points},
    sample_rate: ${this.parameters.sample_rate},
    store_video: ${this.parameters.store_video},
    face_detection: ${this.parameters.face_detection},
    precision_filter: ${this.parameters.precision_filter},
    smoothing_factor: ${this.parameters.smoothing_factor}
};

// Eye tracking data storage
let eyeTrackingData = {
    gazePoints: [],
    calibrationData: [],
    validationData: []
};

// WebGazer initialization function
function initializeWebGazer() {
    return new Promise((resolve, reject) => {
        if (typeof webgazer === 'undefined') {
            console.error('WebGazer library not loaded');
            reject('WebGazer library not loaded');
            return;
        }
        
        webgazer.setGazeListener(function(data, elapsedTime) {
            if (data) {
                eyeTrackingData.gazePoints.push({
                    x: data.x,
                    y: data.y,
                    timestamp: elapsedTime
                });
            }
        }).begin();
        
        webgazer.showVideoPreview(true)
               .showPredictionPoints(eyeTrackingConfig.prediction_points > 0);
        
        // Wait for webcam to initialize
        setTimeout(() => {
            resolve();
        }, 3000);
    });
}

// Calibration function
function calibrateEyeTracker() {
    return new Promise((resolve) => {
        // Create calibration points
        const calibrationPoints = generateCalibrationPoints(eyeTrackingConfig.calibration_points);
        let currentPoint = 0;
        
        function showCalibrationPoint() {
            if (currentPoint >= calibrationPoints.length) {
                resolve();
                return;
            }
            
            const point = calibrationPoints[currentPoint];
            // Show calibration dot at point position
            // This would need to be integrated with your display system
            
            setTimeout(() => {
                webgazer.recordScreenPosition(point.x, point.y);
                currentPoint++;
                showCalibrationPoint();
            }, 2000);
        }
        
        showCalibrationPoint();
    });
}

function generateCalibrationPoints(numPoints) {
    const points = [];
    const margin = 0.1;
    
    if (numPoints === 9) {
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                points.push({
                    x: (margin + (1 - 2 * margin) * j / 2) * window.innerWidth,
                    y: (margin + (1 - 2 * margin) * i / 2) * window.innerHeight
                });
            }
        }
    }
    
    return points;
}`;
    }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        DataCollectionModules,
        DataCollectionModule,
        ReactionTimeModule,
        AccuracyModule,
        MouseTrackingModule,
        KeyboardTrackingModule,
        EyeTrackingModule
    };
}

/**
 * Correctness Module
 *
 * Intended to support online correctness computation (vs post-hoc).
 * This is currently a lightweight toggle container.
 */
class CorrectnessModule extends DataCollectionModule {
    constructor() {
        super('Correctness', 'Compute correctness online during task execution');
        this.parameters = {
            enabled: true
        };
    }
}