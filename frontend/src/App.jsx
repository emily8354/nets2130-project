import React, { useState, useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import './App.css';
import StravaConnection from './components/StravaConnection';
import StravaActivities from './components/StravaActivities';

// Fix Leaflet default icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

/**
 * Frontend prototype illustrating Kinnect workflows.
 * Uses fetch against the in-memory Express server; could be replaced with mocked data.
 */
const API_BASE = 'http://localhost:4000';

const defaultActivity = { type: 'run', distanceKm: 5, durationMinutes: 30 };

function ActivityForm({ user, onLogged }) {
  const [activity, setActivity] = useState(defaultActivity);

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
  };

  return (
    <form className="card" onSubmit={submit}>
      <h3>Log Activity</h3>
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
      <button type="submit">Add Activity</button>
    </form>
  );
}

function Leaderboard({ data }) {
  return (
    <div className="card">
      <h3>Leaderboards</h3>
      <section>
        <h4>Teams</h4>
        <ul>
          {data.teamLeaderboard.map((team) => (
            <li key={team.id}>
              #{team.rank} {team.name} — {team.totalPoints} pts / {team.totalActivities} activities
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h4>Cities</h4>
        <ul>
          {data.cityLeaderboard.map((city) => (
            <li key={city.city}>
              {city.city}: {city.points} pts (Top streak: {city.streak})
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h4>Individuals</h4>
        <ul>
          {data.individualLeaderboard.map((user) => (
            <li key={user.username}>
              #{user.rank} {user.username}: {user.points} pts — streak {user.streak}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ActivityMap({ mapPoints, teamMembers }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const heatLayerRef = useRef(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const mapContainerRef = useRef(null);

  // Get status color for marker
  const getStatusColor = (status) => {
    switch (status) {
      case 'active':
        return '#10b981'; // green
      case 'online':
        return '#3b82f6'; // blue
      case 'offline':
        return '#6b7280'; // gray
      default:
        return '#6b7280';
    }
  };

  // Get status icon
  const getStatusIcon = (status) => {
    switch (status) {
      case 'active':
        return '🟢';
      case 'online':
        return '🔵';
      case 'offline':
        return '⚫';
      default:
        return '⚫';
    }
  };

  // Calculate center from user locations if available, default to center coordinates
  const mapCenter = useMemo(() => {
    if (teamMembers && teamMembers.length > 0) {
      const avgLat = teamMembers.reduce((sum, m) => sum + m.lat, 0) / teamMembers.length;
      const avgLng = teamMembers.reduce((sum, m) => sum + m.lng, 0) / teamMembers.length;
      return [avgLat, avgLng];
    }
    if (mapPoints && mapPoints.length > 0) {
      const avgLat = mapPoints.reduce((sum, p) => sum + p.lat, 0) / mapPoints.length;
      const avgLng = mapPoints.reduce((sum, p) => sum + p.lng, 0) / mapPoints.length;
      return [avgLat, avgLng];
    }
    return [39.9526, -75.1652]; // Default center
  }, [teamMembers, mapPoints]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Create map with default center
    const initialCenter = [39.9526, -75.1652]; // Default center
    const initialZoom = 13; // Good zoom level for campus area
    const map = L.map(mapContainerRef.current).setView(initialCenter, initialZoom);
    mapInstanceRef.current = map;

    // Add OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update map center when data changes
  useEffect(() => {
    if (mapInstanceRef.current && mapCenter) {
      mapInstanceRef.current.setView(mapCenter, teamMembers && teamMembers.length > 0 ? 13 : 12);
    }
  }, [mapCenter, teamMembers]);

  // Update heatmap layer
  useEffect(() => {
    if (!mapInstanceRef.current || !mapPoints || mapPoints.length === 0) return;

    // Remove existing heat layer
    if (heatLayerRef.current) {
      mapInstanceRef.current.removeLayer(heatLayerRef.current);
      heatLayerRef.current = null;
    }

    // Prepare heatmap data [lat, lng, intensity]
    const heatData = mapPoints.map(point => {
      const intensity = Math.min(Math.max((point.intensity || 1) / 100, 0.1), 1.0);
      return [Number(point.lat), Number(point.lng), intensity];
    });

    // Add heat layer using leaflet.heat
    try {
      // Check if L.heatLayer is available (from leaflet.heat import)
      if (typeof L !== 'undefined' && typeof L.heatLayer === 'function') {
        const heatLayer = L.heatLayer(heatData, {
          radius: 30,
          blur: 15,
          maxZoom: 17,
          max: 1.0,
          gradient: {
            0.0: '#8b5cf6',  // Purple
            0.3: '#a78bfa',  // Light purple
            0.5: '#06b6d4',  // Cyan
            0.7: '#22d3ee',  // Light cyan
            1.0: '#67e8f9'   // Bright cyan
          }
        });
        heatLayer.addTo(mapInstanceRef.current);
        heatLayerRef.current = heatLayer;
      } else {
        console.warn('Leaflet.heat plugin not loaded - heatmap disabled');
      }
    } catch (error) {
      console.warn('Error creating heat layer:', error);
    }
  }, [mapPoints]);

  // Update markers
  useEffect(() => {
    if (!mapInstanceRef.current || !teamMembers || teamMembers.length === 0) return;

    // Clear existing markers
    markersRef.current.forEach(marker => {
      mapInstanceRef.current.removeLayer(marker);
    });
    markersRef.current = [];

    // Add new markers
    teamMembers.forEach((member) => {
      const lat = Number(member.lat);
      const lng = Number(member.lng);

      if (isNaN(lat) || isNaN(lng)) {
        console.warn(`Invalid coordinates for ${member.username}:`, member);
        return;
      }

      const color = getStatusColor(member.status);
      
      // Create custom icon
      const customIcon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background-color: ${color};
          border: 3px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        "></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      const marker = L.marker([lat, lng], { icon: customIcon })
        .addTo(mapInstanceRef.current)
        .bindPopup(`
          <div class="info-window">
            <h4>${member.username}</h4>
            <p><strong>Status:</strong> ${getStatusIcon(member.status)} ${member.status}</p>
            <p><strong>City:</strong> ${member.city}</p>
            <p><strong>Points:</strong> ${member.points} pts</p>
            <p><strong>Streak:</strong> ${member.streak} days 🔥</p>
            <p><strong>Team:</strong> ${member.teamId}</p>
          </div>
        `)
        .on('click', () => {
          setSelectedMember(member);
        });

      markersRef.current.push(marker);
    });
  }, [teamMembers]);

  return (
    <div className="card map-card">
      <h3>Live Activity Map</h3>
      <p className="small">
        Heat map showing today's activities. Team members marked with status: 
        <span style={{ color: '#10b981' }}> 🟢 Active</span>, 
        <span style={{ color: '#3b82f6' }}> 🔵 Online</span>, 
        <span style={{ color: '#6b7280' }}> ⚫ Offline</span>
      </p>
      <div 
        ref={mapContainerRef} 
        style={{ 
          width: '100%', 
          height: '500px', 
          borderRadius: '12px',
          overflow: 'hidden'
        }}
      />
      {selectedMember && (
        <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(15, 23, 42, 0.6)', borderRadius: '8px', border: '1px solid rgba(139, 92, 246, 0.3)', color: '#f8fafc' }}>
          <h4 style={{ color: '#f8fafc' }}>{selectedMember.username}</h4>
          <p style={{ color: '#cbd5e1' }}><strong>Status:</strong> {getStatusIcon(selectedMember.status)} {selectedMember.status}</p>
          <p style={{ color: '#cbd5e1' }}><strong>City:</strong> {selectedMember.city}</p>
          <p style={{ color: '#cbd5e1' }}><strong>Points:</strong> {selectedMember.points} pts</p>
          <p style={{ color: '#cbd5e1' }}><strong>Streak:</strong> {selectedMember.streak} days 🔥</p>
          <p style={{ color: '#cbd5e1' }}><strong>Team:</strong> {selectedMember.teamId}</p>
          <button onClick={() => setSelectedMember(null)} style={{ marginTop: '0.5rem' }}>Close</button>
        </div>
      )}
    </div>
  );
}

function StreaksAndBadges({ user }) {
  // Define badge milestones
  const streakBadges = [
    { days: 3, name: 'Getting Started', icon: '🔥' },
    { days: 7, name: 'Week Warrior', icon: '💪' },
    { days: 14, name: 'Two Week Champion', icon: '⭐' },
    { days: 30, name: 'Monthly Master', icon: '🏆' },
    { days: 60, name: 'Dedication Deity', icon: '👑' },
    { days: 100, name: 'Century Streak', icon: '💯' },
  ];

  const pointBadges = [
    { points: 100, name: 'First Hundred', icon: '🎯' },
    { points: 500, name: 'Point Collector', icon: '📊' },
    { points: 1000, name: 'Grand Master', icon: '🌟' },
    { points: 2500, name: 'Elite Achiever', icon: '💎' },
    { points: 5000, name: 'Legendary', icon: '⚡' },
  ];

  // Calculate earned badges
  const earnedStreakBadges = streakBadges.filter((badge) => user.streak >= badge.days);
  const earnedPointBadges = pointBadges.filter((badge) => user.points >= badge.points);

  // Find next milestone
  const nextStreakBadge = streakBadges.find((badge) => user.streak < badge.days);
  const nextPointBadge = pointBadges.find((badge) => user.points < badge.points);

  return (
    <div className="card">
      <h3>Streaks & Badges</h3>
      
      {/* Current Streak Display */}
      <div className="streak-display">
        <div className="streak-number">{user.streak || 0}</div>
        <div className="streak-label">Day Streak 🔥</div>
        {nextStreakBadge && (
          <div className="streak-progress">
            <small>
              {nextStreakBadge.days - user.streak} more day{nextStreakBadge.days - user.streak !== 1 ? 's' : ''} until {nextStreakBadge.name} {nextStreakBadge.icon}
            </small>
          </div>
        )}
      </div>

      {/* Streak Badges */}
      <section className="badges-section">
        <h4>Streak Badges</h4>
        <div className="badges-grid">
          {streakBadges.map((badge) => {
            const earned = user.streak >= badge.days;
            return (
              <div key={badge.days} className={`badge ${earned ? 'earned' : 'locked'}`}>
                <div className="badge-icon">{badge.icon}</div>
                <div className="badge-name">{badge.name}</div>
                <div className="badge-requirement">{badge.days} days</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Point Badges */}
      <section className="badges-section">
        <h4>Point Badges</h4>
        <div className="badges-grid">
          {pointBadges.map((badge) => {
            const earned = user.points >= badge.points;
            return (
              <div key={badge.points} className={`badge ${earned ? 'earned' : 'locked'}`}>
                <div className="badge-icon">{badge.icon}</div>
                <div className="badge-name">{badge.name}</div>
                <div className="badge-requirement">{badge.points} pts</div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Login({ onAuth }) {
  const [username, setUsername] = useState('alice');
  const [password, setPassword] = useState('pass123');

  const authenticate = async (path) => {
    const response = await fetch(`${API_BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, city: 'Philadelphia', teamName: 'Team Alpha' }),
    });
    const payload = await response.json();
    if (payload.user) {
      onAuth(payload.user);
    } else {
      alert(payload.error || 'Something went wrong');
    }
  };

  return (
    <div className="card">
      <h3 style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', textAlign: 'center' }}>Login</h3>
      <label>
        Username
        <input value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <div className="button-row">
        <button onClick={() => authenticate('login')}>Login</button>
        <button onClick={() => authenticate('signup')}>Sign Up</button>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [leaderboard, setLeaderboard] = useState({ teamLeaderboard: [], cityLeaderboard: [], individualLeaderboard: [] });
  const [mapPoints, setMapPoints] = useState([]);
  const [stravaConnected, setStravaConnected] = useState(false);
  const [teamMembers, setTeamMembers] = useState([]);

  // Handle Strava OAuth callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const stravaSuccess = urlParams.get('strava_success');
    const stravaError = urlParams.get('strava_error');
    const username = urlParams.get('username');

    if (stravaSuccess === 'true' && username) {
      alert('Successfully connected to Strava!');
      setStravaConnected(true);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (stravaError) {
      alert(`Strava connection error: ${decodeURIComponent(stravaError)}`);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    
    fetch(`${API_BASE}/leaderboard`).then((res) => res.json()).then(setLeaderboard);
    fetch(`${API_BASE}/activity-map`).then((res) => res.json()).then((data) => setMapPoints(data.mapPoints));
    // Fetch team members for the logged-in user's team
    fetch(`${API_BASE}/team-members?teamId=${user.teamId}`)
      .then((res) => res.json())
      .then((data) => {
        console.log('Team members loaded:', data.members);
        setTeamMembers(data.members || []);
      })
      .catch((error) => {
        console.error('Error loading team members:', error);
      });
  }, [user]);

  const refreshData = () => {
    if (!user) return;
    
    fetch(`${API_BASE}/leaderboard`).then((res) => res.json()).then(setLeaderboard);
    fetch(`${API_BASE}/activity-map`).then((res) => res.json()).then((data) => setMapPoints(data.mapPoints));
    // Fetch team members for the logged-in user's team
    fetch(`${API_BASE}/team-members?teamId=${user.teamId}`)
      .then((res) => res.json())
      .then((data) => setTeamMembers(data.members || []));
  };

  if (!user) {
    return (
      <main className="layout">
        <header style={{ marginBottom: '2rem' }}>
          <h1 style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Kinnect</h1>
        </header>
        <Login onAuth={setUser} />
      </main>
    );
  }

  const handleActivityLogged = () => {
    refreshData();
    fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, password: user.password }),
    })
      .then((res) => res.json())
      .then((data) => setUser(data.user));
  };

  const handleStravaConnectionChange = () => {
    setStravaConnected((prev) => !prev);
  };

  return (
    <main className="layout">
      <header>
        <h1 style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Kinnect</h1>
        <p>Welcome back, {user.username}! Keep the streak alive! 🔥</p>
      </header>
      <section className="grid">
        <ActivityForm user={user} onLogged={handleActivityLogged} />
        <StravaConnection user={user} onConnectionChange={handleStravaConnectionChange} />
        <StravaActivities user={user} />
        <StreaksAndBadges user={user} />
        <Leaderboard data={leaderboard} />
        <ActivityMap mapPoints={mapPoints} teamMembers={teamMembers} />
      </section>
    </main>
  );
}