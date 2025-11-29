import React, { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:4000';

function StravaActivities({ user, unit = 'km' }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [connected, setConnected] = useState(false);

  // Check connection status first
  useEffect(() => {
    if (user) {
      checkConnection();
    }
  }, [user]);

  const checkConnection = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/strava/status?username=${user.username}`);
      const status = await response.json();
      setConnected(status.connected);
      if (status.connected) {
        fetchActivities();
      } else {
        setLoading(false);
      }
    } catch (error) {
      console.error('Error checking connection:', error);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (connected && user) {
      fetchActivities();
    }
  }, [connected, user, page]);

  const fetchActivities = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE}/api/strava/activities?username=${user.username}&per_page=10&page=${page}`
      );

      if (response.status === 401) {
        setError('Strava authorization failed. Please reconnect your account.');
        setLoading(false);
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch activities');
      }

      const data = await response.json();
      if (page === 1) {
        setActivities(data);
      } else {
        setActivities((prev) => [...prev, ...data]);
      }

      setHasMore(data.length === 10);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching Strava activities:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  const formatDistance = (meters) => {
    if (unit === 'mi') {
      const miles = meters / 1609.344;
      if (miles >= 1) return `${miles.toFixed(2)} mi`;
      return `${(miles * 5280).toFixed(0)} ft`;
    }
    // default: kilometers
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(2)} km`;
    }
    return `${meters.toFixed(0)} m`;
  };

  const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
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
      Run: '🏃',
      Ride: '🚴',
      Walk: '🚶',
      Swim: '🏊',
      Workout: '💪',
      Hike: '🥾',
    };
    return icons[type] || '🏃';
  };

  if (!connected) {
    return (
      <div className="card">
        <h3>Strava Activities</h3>
        <p className="small">Connect your Strava account to view your activities here.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h3>Strava Activities</h3>
        <p className="error">{error}</p>
      </div>
    );
  }

  if (activities.length === 0 && !loading) {
    return (
      <div className="card">
        <h3>Strava Activities</h3>
        <p>No activities found. Make sure you have activities in your Strava account.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Strava Activities</h3>
      {loading && activities.length === 0 ? (
        <p>Loading activities...</p>
      ) : (
        <>
          <div className="activities-list">
            {activities.map((activity) => (
              <div key={activity.id} className="activity-item">
                <div className="activity-header">
                  <span className="activity-icon">{getActivityTypeIcon(activity.type)}</span>
                  <div className="activity-info">
                    <h4>{activity.name || activity.type}</h4>
                    <p className="small">{formatDate(activity.start_date_local)}</p>
                  </div>
                </div>
                <div className="activity-stats">
                  {activity.distance > 0 && (
                    <div className="stat">
                      <span className="stat-label">Distance</span>
                      <span className="stat-value">{formatDistance(activity.distance)}</span>
                    </div>
                  )}
                  {activity.moving_time > 0 && (
                    <div className="stat">
                      <span className="stat-label">Time</span>
                      <span className="stat-value">{formatDuration(activity.moving_time)}</span>
                    </div>
                  )}
                  {activity.total_elevation_gain > 0 && (
                    <div className="stat">
                      <span className="stat-label">Elevation</span>
                      <span className="stat-value">{Math.round(activity.total_elevation_gain)} m</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {hasMore && (
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={loading}
              className="load-more-btn"
            >
              {loading ? 'Loading...' : 'Load More'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default StravaActivities;

