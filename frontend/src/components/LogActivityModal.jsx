import React, { useState } from 'react';

const API_BASE = 'http://localhost:4000';

const defaultActivity = { type: 'run', title: '', date: '', time: '', distance: 5, distanceUnit: 'km', distanceKm: 5, durationMinutes: 30 };

function LogActivityModal({ user, isOpen, onClose, onLogged }) {
  const [activity, setActivity] = useState(defaultActivity);

  if (!isOpen) return null;

  const updateField = (field, value) => setActivity((prev) => ({ ...prev, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    // Normalize distance to kilometers (backend expects distanceKm)
    const distanceInput = Number(activity.distance || 0);
    const distanceKm = activity.distanceUnit === 'mi' ? distanceInput * 1.60934 : distanceInput;

    const payloadBody = {
      username: user.username,
      user_id: user.id || null, // Include user_id if available (Supabase)
      title: activity.title,
      type: activity.type,
      distanceKm,
      durationMinutes: activity.durationMinutes,
      date: activity.date,
      time: activity.time,
    };

    const response = await fetch(`${API_BASE}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadBody),
    });
    const payload = await response.json();
    onLogged(payload);
    setActivity(defaultActivity);
    onClose();
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
            <button type="submit" className="btn-primary">
              Add Activity
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default LogActivityModal;

