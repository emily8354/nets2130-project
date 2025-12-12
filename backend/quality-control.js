/**
 * Quality Control (QC) module for activity validation
 * Validates activities before they are accepted into the system
 */

// QC Rules and thresholds
const QC_RULES = {
  // Duration limits (in minutes)
  duration: {
    min: 1, // Minimum 1 minute
    max: 1440, // Maximum 24 hours (1440 minutes)
    // Activity-specific max durations
    activityMax: {
      run: 480, // 8 hours max for running
      walk: 600, // 10 hours max for walking
      workout: 180, // 3 hours max for workout
      bike: 600, // 10 hours max for cycling
      swim: 240, // 4 hours max for swimming
    }
  },
  
  // Distance limits (in km)
  distance: {
    min: 0.01, // Minimum 10 meters
    max: 500, // Maximum 500 km
    // Activity-specific max distances
    activityMax: {
      run: 100, // 100 km max for running (ultra marathon territory)
      walk: 80, // 80 km max for walking
      workout: 0, // Workouts don't have distance
      bike: 500, // 500 km max for cycling
      swim: 50, // 50 km max for swimming
    }
  },
  
  // Speed/pace limits (km/h)
  speed: {
    min: 0.5, // Minimum 0.5 km/h (very slow walk)
    max: {
      run: 25, // 25 km/h max for running (world record pace ~37 km/h, but 25 is reasonable)
      walk: 8, // 8 km/h max for walking (very fast walk)
      workout: 0, // Workouts don't have speed
      bike: 60, // 60 km/h max for cycling (reasonable for amateur)
      swim: 10, // 10 km/h max for swimming (world record pace)
    }
  },
  
  // Minimum pace requirements (minutes per km)
  pace: {
    max: {
      run: 20, // Maximum 20 min/km (very slow but possible)
      walk: 30, // Maximum 30 min/km (very slow walk)
    }
  }
};

/**
 * Validate activity data using QC rules
 * @param {Object} activity - Activity data to validate
 * @param {string} activity.type - Activity type (run, walk, workout, etc.)
 * @param {number} activity.distanceKm - Distance in kilometers
 * @param {number} activity.durationMinutes - Duration in minutes
 * @param {string} activity.date - Activity date
 * @returns {Object} - { valid: boolean, errors: string[], warnings: string[] }
 */
function validateActivity(activity) {
  const { type, distanceKm = 0, durationMinutes = 0, date } = activity;
  const errors = [];
  const warnings = [];
  
  // Basic field validation
  if (!type) {
    errors.push('Activity type is required');
    return { valid: false, errors, warnings };
  }
  
  const validTypes = ['run', 'walk', 'workout', 'bike', 'swim', 'hike', 'yoga', 'other'];
  if (!validTypes.includes(type.toLowerCase())) {
    errors.push(`Invalid activity type: ${type}. Valid types: ${validTypes.join(', ')}`);
  }
  
  // Date validation
  if (date) {
    const activityDate = new Date(date);
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    
    if (isNaN(activityDate.getTime())) {
      errors.push('Invalid date format');
    } else if (activityDate > today) {
      errors.push('Activity date cannot be in the future');
    } else if (activityDate < oneYearAgo) {
      warnings.push('Activity date is more than one year ago');
    }
  }
  
  // Duration validation
  if (durationMinutes < 0) {
    errors.push('Duration cannot be negative');
  } else if (durationMinutes === 0 && distanceKm === 0) {
    errors.push('Either duration or distance must be provided');
  } else if (durationMinutes < QC_RULES.duration.min) {
    errors.push(`Duration must be at least ${QC_RULES.duration.min} minute(s)`);
  } else if (durationMinutes > QC_RULES.duration.max) {
    errors.push(`Duration cannot exceed ${QC_RULES.duration.max} minutes (24 hours)`);
  }
  
  // Activity-specific duration limits
  const activityType = type.toLowerCase();
  const activityMaxDuration = QC_RULES.duration.activityMax[activityType];
  if (activityMaxDuration && durationMinutes > activityMaxDuration) {
    errors.push(`${activityType} duration cannot exceed ${activityMaxDuration} minutes`);
  }
  
  // Distance validation
  if (distanceKm < 0) {
    errors.push('Distance cannot be negative');
  } else if (distanceKm > 0 && distanceKm < QC_RULES.distance.min) {
    warnings.push(`Distance is very small (${distanceKm} km). Did you mean to enter this?`);
  } else if (distanceKm > QC_RULES.distance.max) {
    errors.push(`Distance cannot exceed ${QC_RULES.distance.max} km`);
  }
  
  // Activity-specific distance limits
  const activityMaxDistance = QC_RULES.distance.activityMax[activityType];
  if (activityMaxDistance && distanceKm > activityMaxDistance) {
    errors.push(`${activityType} distance cannot exceed ${activityMaxDistance} km`);
  }
  
  // Speed/pace validation (only if both distance and duration are provided)
  if (distanceKm > 0 && durationMinutes > 0) {
    const speedKmh = (distanceKm / durationMinutes) * 60; // km/h
    const paceMinPerKm = durationMinutes / distanceKm; // minutes per km
    
    // Check speed limits
    const maxSpeed = QC_RULES.speed.max[activityType];
    if (maxSpeed && speedKmh > maxSpeed) {
      errors.push(
        `${activityType} speed (${speedKmh.toFixed(2)} km/h) exceeds maximum reasonable speed (${maxSpeed} km/h)`
      );
    }
    
    if (speedKmh < QC_RULES.speed.min) {
      warnings.push(
        `Very slow speed (${speedKmh.toFixed(2)} km/h). Is this correct?`
      );
    }
    
    // Check pace limits for running/walking
    if ((activityType === 'run' || activityType === 'walk') && paceMinPerKm > QC_RULES.pace.max[activityType]) {
      warnings.push(
        `Very slow pace (${paceMinPerKm.toFixed(1)} min/km). Is this correct?`
      );
    }
    
    // Check for unrealistic combinations
    if (activityType === 'workout' && distanceKm > 0) {
      warnings.push('Workout activities typically don\'t have distance. Did you mean a different activity type?');
    }
    
    if (activityType === 'run' && speedKmh > 20 && distanceKm > 10) {
      warnings.push('Very fast pace for a long distance. Please verify the data.');
    }
    
    if (activityType === 'walk' && speedKmh > 6) {
      warnings.push('Speed suggests running rather than walking. Please verify the activity type.');
    }
  }
  
  // Check for zero values when one is provided
  if (distanceKm > 0 && durationMinutes === 0) {
    warnings.push('Distance provided but no duration. Duration will be estimated.');
  }
  
  if (durationMinutes > 0 && distanceKm === 0 && (activityType === 'run' || activityType === 'walk' || activityType === 'bike')) {
    warnings.push('Duration provided but no distance. Distance-based points will be zero.');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metrics: {
      speedKmh: distanceKm > 0 && durationMinutes > 0 ? (distanceKm / durationMinutes) * 60 : null,
      paceMinPerKm: distanceKm > 0 && durationMinutes > 0 ? durationMinutes / distanceKm : null,
    }
  };
}

/**
 * Get QC statistics for monitoring
 * @returns {Object} QC rules and thresholds
 */
function getQCStats() {
  return {
    rules: QC_RULES,
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  validateActivity,
  getQCStats,
  QC_RULES
};

