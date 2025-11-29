import React, { useState } from 'react';

const API_BASE = 'http://localhost:4000';

const defaultActivity = { type: 'run', distanceKm: 5, durationMinutes: 30 };

function LogActivityModal({ user, isOpen, onClose, onLogged }) {
  const [activity, setActivity] = useState(defaultActivity);

  if (!isOpen) return null;

  const updateField = (field, value) => setActivity((prev) => ({ ...prev, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    const response = await fetch(`${API_BASE}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, ...activity }),
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
              Type
              <select value={activity.type} onChange={(e) => updateField('type', e.target.value)}>
                <option value="run">Run</option>
                <option value="walk">Walk</option>
                <option value="workout">Workout</option>
              </select>
            </label>
            {activity.type !== 'workout' && (
              <label>
                Distance (km)
                <input
                  type="number"
                  min="0"
                  value={activity.distanceKm}
                  onChange={(e) => updateField('distanceKm', Number(e.target.value))}
                />
              </label>
            )}
            {activity.type === 'workout' && (
              <label>
                Duration (minutes)
                <input
                  type="number"
                  min="0"
                  value={activity.durationMinutes}
                  onChange={(e) => updateField('durationMinutes', Number(e.target.value))}
                />
              </label>
            )}
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

