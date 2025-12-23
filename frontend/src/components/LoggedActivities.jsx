import React, { useState, useEffect } from 'react';
import { API_BASE } from '../config/api';

function LoggedActivities({ user, unit = 'km', refreshTrigger }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (user) {
      fetchActivities();
    }
  }, [user, refreshTrigger]);

  // Listen for activity import events
  useEffect(() => {
    const handleActivityImported = () => {
      fetchActivities();
    };
    window.addEventListener('activityImported', handleActivityImported);
    return () => window.removeEventListener('activityImported', handleActivityImported);
  }, [user]);

  const fetchActivities = async () => {
    setLoading(true);
    setError(null);
    try {
      // Use user ID (UUID) to fetch activities - backend expects user_id
      const userId = user.id || user.username;
      const response = await fetch(`${API_BASE}/api/activities/${encodeURIComponent(userId)}`);

      if (!response.ok) {
        throw new Error('Failed to fetch activities');
      }

      const data = await response.json();
      // Sort by date (newest first)
      const sorted = data.sort((a, b) => new Date(b.date) - new Date(a.date));
      setActivities(sorted);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching logged activities:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  const formatDistance = (km) => {
    if (unit === 'mi') {
      const miles = km / 1.60934;
      return `${miles.toFixed(2)} mi`;
    }
    return `${km.toFixed(2)} km`;
  };

  const formatDuration = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getActivityTypeIcon = (type) => {
    const icons = {
      run: '🏃',
      walk: '🚶',
      workout: '💪',
    };
    return icons[type?.toLowerCase()] || '🏃';
  };

  if (loading) {
    return (
      <div className="card">
        <h3>My Activities</h3>
        <p>Loading activities...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h3>My Activities</h3>
        <p className="error">{error}</p>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="card">
        <h3>My Activities</h3>
        <p className="small">No activities logged yet. Click "Log Activity" to add your first activity!</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>My Activities</h3>
      <div className="activities-list">
        {activities.map((activity) => (
          <div key={activity.id} className="activity-item">
            <div className="activity-header">
              <span className="activity-icon">{getActivityTypeIcon(activity.type)}</span>
              <div className="activity-info">
                <h4>{activity.title || activity.type || 'Activity'}</h4>
                <p className="small">{formatDate(activity.date)}</p>
              </div>
            </div>
            <div className="activity-stats">
              {activity.distanceKm > 0 && (
                <div className="stat">
                  <span className="stat-label">Distance</span>
                  <span className="stat-value">{formatDistance(activity.distanceKm)}</span>
                </div>
              )}
              {activity.durationMinutes > 0 && (
                <div className="stat">
                  <span className="stat-label">Time</span>
                  <span className="stat-value">{formatDuration(activity.durationMinutes)}</span>
                </div>
              )}
              {activity.pointsEarned > 0 && (
                <div className="stat">
                  <span className="stat-label">Points</span>
                  <span className="stat-value">{activity.pointsEarned} pts</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default LoggedActivities;

