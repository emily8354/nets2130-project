import React, { useState } from 'react';
import { API_BASE } from '../config/api';
import { supabase } from '../supabaseClient';

const defaultActivity = { type: 'run', title: '', date: '', time: '', distance: 5, distanceUnit: 'km', distanceKm: 5, durationMinutes: 30 };

function LogActivityModal({ user, isOpen, onClose, onLogged }) {
  const [activity, setActivity] = useState(defaultActivity);
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const updateField = (field, value) => {
    setActivity((prev) => ({ ...prev, [field]: value }));
    // Clear errors when user changes input
    if (error) setError(null);
    if (warnings.length > 0) setWarnings([]);
  };

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setWarnings([]);
    setLoading(true);

    try {
      // Get auth token if available
      const headers = { 'Content-Type': 'application/json' };
      try {
        const { data: { session } = {} } = await supabase.auth.getSession();
        if (session?.access_token) {
          headers.Authorization = `Bearer ${session.access_token}`;
        }
      } catch (err) {
        // Ignore if supabase not available
        console.warn('Could not get auth session:', err);
      }

      // Normalize distance to kilometers (backend expects distanceKm)
      const distanceInput = Number(activity.distance || 0);
      const distanceKm = activity.distanceUnit === 'mi' ? distanceInput * 1.60934 : distanceInput;

      const payloadBody = {
        username: user.username,
        user_id: user.id || null, // Include user_id if available (Supabase)
        title: activity.title,
        type: activity.type,
        distanceKm,
        durationMinutes: Number(activity.durationMinutes) || 0,
        date: activity.date || new Date().toISOString().split('T')[0],
        time: activity.time,
      };

      const response = await fetch(`${API_BASE}/api/activities`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payloadBody),
      });

      if (!response.ok) {
        let payload;
        try {
          payload = await response.json();
        } catch (e) {
          setError(`Server error (${response.status}): ${response.statusText}`);
          setLoading(false);
          return;
        }
        
        // Handle QC validation errors
        if (payload.error === 'Activity validation failed' && payload.details) {
          setError(payload.details.join('. '));
          if (payload.warnings && payload.warnings.length > 0) {
            setWarnings(payload.warnings);
          }
          setLoading(false);
          return;
        }
        setError(payload.error || 'Failed to log activity');
        setLoading(false);
        return;
      }

      const payload = await response.json();

      // Check for QC warnings even if accepted
      if (payload.qc && payload.qc.warnings && payload.qc.warnings.length > 0) {
        setWarnings(payload.qc.warnings);
        // Still close modal but show warnings
        setTimeout(() => {
          alert(`Activity logged successfully!\n\nWarnings:\n${payload.qc.warnings.join('\n')}`);
        }, 100);
      }

      onLogged(payload);
      setActivity(defaultActivity);
      onClose();
    } catch (err) {
      console.error('Error logging activity:', err);
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setActivity(defaultActivity);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Log Activity</h3>
          <button className="modal-close" onClick={handleCancel}>×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            {error && (
              <div style={{ 
                padding: '0.75rem', 
                marginBottom: '1rem', 
                backgroundColor: '#fee', 
                border: '1px solid #fcc', 
                borderRadius: '4px',
                color: '#c33'
              }}>
                <strong>Validation Error:</strong>
                <div style={{ marginTop: '0.25rem' }}>{error}</div>
              </div>
            )}
            {warnings.length > 0 && !error && (
              <div style={{ 
                padding: '0.75rem', 
                marginBottom: '1rem', 
                backgroundColor: '#fff3cd', 
                border: '1px solid #ffc107', 
                borderRadius: '4px',
                color: '#856404'
              }}>
                <strong>⚠️ Warnings:</strong>
                <ul style={{ margin: '0.25rem 0 0 1.25rem', padding: 0 }}>
                  {warnings.map((warning, idx) => (
                    <li key={idx}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            <label>
              Title
              <input value={activity.title} onChange={(e) => updateField('title', e.target.value)} placeholder="Morning run" />
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
              <label style={{ flex: 1, minWidth: 0 }}>
                Date
                <input type="date" value={activity.date} onChange={(e) => updateField('date', e.target.value)} />
              </label>
              <label style={{ width: 140 }}>
                Time
                <input type="time" value={activity.time} onChange={(e) => updateField('time', e.target.value)} />
              </label>
            </div>
            <label>
              Type
              <select value={activity.type} onChange={(e) => updateField('type', e.target.value)}>
                <option value="run">Run</option>
                <option value="walk">Walk</option>
                <option value="workout">Workout</option>
              </select>
            </label>
            {activity.type !== 'workout' && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                <label style={{ flex: 2, minWidth: 0 }}>
                  Distance
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={activity.distance}
                    onChange={(e) => updateField('distance', e.target.value)}
                  />
                </label>
                <label style={{ flex: 1, maxWidth: 120 }}>
                  Unit
                  <select value={activity.distanceUnit} onChange={(e) => updateField('distanceUnit', e.target.value)}>
                    <option value="km">km</option>
                    <option value="mi">mi</option>
                  </select>
                </label>
              </div>
            )}
            {/* Always show duration (minutes) for all activity types */}
            <label>
              Duration (minutes)
              <input
                type="number"
                min="0"
                value={activity.durationMinutes}
                onChange={(e) => updateField('durationMinutes', Number(e.target.value))}
              />
            </label>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={handleCancel}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Logging...' : 'Add Activity'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default LogActivityModal;

