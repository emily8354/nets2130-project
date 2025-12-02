import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from './supabaseClient';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import './App.css';
import Navbar from './components/Navbar';
import LogActivityModal from './components/LogActivityModal';
import StravaBanner from './components/StravaBanner';
import StravaActivities from './components/StravaActivities';
import LoggedActivities from './components/LoggedActivities';
import Profile from './pages/Profile';
import Leaderboards from './pages/Leaderboards';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';

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

// ActivityForm removed - now in LogActivityModal component

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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchProfileAndSetUser = async (accessToken) => {
    // Ask backend for profile using the Supabase access token
    const resp = await fetch(`${API_BASE}/api/profiles/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const payload = await resp.json();
    const supaUser = payload.user;
    const profile = payload.profile || {};
    const clientUser = {
      id: supaUser?.id,
      email: supaUser?.email,
      username: profile.display_name || (supaUser?.email ? supaUser.email.split('@')[0] : 'user'),
      teamId: profile.team_id || null,
      city: profile.city || null,
      units: profile.units || 'km',
      // preserve any legacy fields expected by the UI
      points: 0,
      streak: 0,
      password: null,
    };
    onAuth(clientUser);
  };

  const handleEmailSignUp = async () => {
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) return alert(error.message || 'Sign up failed');
    // After sign up, prompt user to verify email. Attempt to sign in immediately.
    try {
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        alert('Signed up — please check your email to confirm. Then sign in.');
        return;
      }
      const accessToken = signInData.session?.access_token;
      if (accessToken) await fetchProfileAndSetUser(accessToken);
    } catch (err) {
      console.error(err);
    }
  };

  const handleEmailLogin = async () => {
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return alert(error.message || 'Login failed');
    const accessToken = data.session?.access_token;
    if (accessToken) await fetchProfileAndSetUser(accessToken);
  };

  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (error) alert(error.message || 'Google sign-in failed');
  };

  const handlePhoneSend = async () => {
    if (!phone) return alert('Enter phone number with country code, e.g. +15555551234');
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithOtp({ phone });
    setLoading(false);
    if (error) return alert(error.message || 'Failed to send OTP');
    alert('OTP sent — check your phone. Complete sign-in with the code or via the link sent by Supabase.');
  };

  return (
    <div className="card">
      <h3 style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #2EEAC3 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', textAlign: 'center' }}>Sign in or Create Account</h3>

      <label>
        Email
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </label>

      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Choose a strong password" />
      </label>

      <div className="button-row">
        <button onClick={handleEmailLogin} disabled={loading}>Sign in</button>
        <button onClick={handleEmailSignUp} disabled={loading}>Create account</button>
      </div>

      <hr />

      <div style={{ textAlign: 'center' }}>
        <button onClick={handleGoogleLogin} className="oauth-button">Continue with Google</button>
      </div>

      <hr />

      <label>
        Phone (SMS OTP)
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+15555551234" />
      </label>
      <div className="button-row">
        <button onClick={handlePhoneSend} disabled={loading}>Send OTP</button>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [unit, setUnit] = useState(() => {
    try {
      return localStorage.getItem('distanceUnit') || 'km';
    } catch (e) {
      return 'km';
    }
  });
  const [leaderboard, setLeaderboard] = useState({ teamLeaderboard: [], cityLeaderboard: [], individualLeaderboard: [] });
  const [mapPoints, setMapPoints] = useState([]);
  const [stravaConnected, setStravaConnected] = useState(false);
  const [teamMembers, setTeamMembers] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activityRefreshTrigger, setActivityRefreshTrigger] = useState(0);

  // On app load, try to restore Supabase session (including after OAuth redirects)
  useEffect(() => {
    let mounted = true;
    const restore = async () => {
      try {
        // If the OAuth provider redirected back with session info in the URL,
        // getSessionFromUrl will parse and store it. If there's nothing to parse,
        // it will throw or return null depending on SDK; ignore errors.
        if (typeof supabase.auth.getSessionFromUrl === 'function') {
          try {
            await supabase.auth.getSessionFromUrl({ storeSession: true });
            // clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
          } catch (e) {
            // ignore - no session in URL
          }
        }

        // Finally, read current session (if any)
        const sessionResp = await supabase.auth.getSession();
        const session = sessionResp?.data?.session;
        const accessToken = session?.access_token;
        if (accessToken && mounted) {
          // fetch profile & set user
          try {
            const resp = await fetch(`${API_BASE}/api/profiles/me`, {
              headers: { Authorization: `Bearer ${accessToken}` }
            });
            const payload = await resp.json();
            const supaUser = payload.user;
            const profile = payload.profile || {};
            const clientUser = {
              id: supaUser?.id,
              email: supaUser?.email,
              username: profile.display_name || (supaUser?.email ? supaUser.email.split('@')[0] : 'user'),
              teamId: profile.team_id || null,
              city: profile.city || null,
              units: profile.units || 'km',
              points: 0,
              streak: 0,
              password: null,
            };
            setUser(clientUser);
          } catch (err) {
            console.error('Error restoring profile after session:', err);
          }
        }
      } catch (err) {
        console.error('Error restoring Supabase session:', err);
      }
    };
    restore();
    return () => { mounted = false; };
  }, []);

  // Handle Strava OAuth callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const stravaSuccess = urlParams.get('strava_success');
    const stravaError = urlParams.get('strava_error');
    const username = urlParams.get('username');
    const supaUserId = urlParams.get('supaUserId');

    if (stravaSuccess === 'true' && (username || supaUserId)) {
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

  // Keep track of whether this user has a Strava connection
  useEffect(() => {
    if (!user) return;
    // Prefer checking by Supabase user id
    const userId = user.id || user.username;
    fetch(`${API_BASE}/api/strava/status?userId=${userId}`)
      .then((res) => res.json())
      .then((status) => {
        setStravaConnected(Boolean(status.connected));
      })
      .catch((err) => {
        console.error('Error fetching Strava status:', err);
      });
  }, [user]);

  const handleUnitChange = (nextUnit) => {
    setUnit(nextUnit);
    try {
      localStorage.setItem('distanceUnit', nextUnit);
    } catch (e) {
      // ignore
    }
  };

  const handleLogout = () => {
    // clear frontend state and preferences
    setUser(null);
    try {
      // keep unit persisted unless user wants it cleared; we'll keep it
    } catch (e) {}
    // Optionally: redirect handled by Router since login view shows when no user
  };

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
      <BrowserRouter>
        <main className="layout login-layout">
          <header className="login-header">
            <div className="login-brand">
              <a href="/" style={{ textDecoration: 'none' }}>
                <h1 style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #2EEAC3 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', margin: 0 }}>Kinnect</h1>
              </a>
              <img src="/no-bg-KinnectApp.png" alt="Kinnect" className="app-icon large below-title" />
            </div>
          </header>

          <Routes>
            <Route path="/signup" element={<SignupPage onAuth={setUser} />} />
            <Route path="/login" element={<LoginPage onAuth={setUser} />} />
            <Route path="/" element={<LoginPage onAuth={setUser} />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </main>
      </BrowserRouter>
    );
  }

  const handleActivityLogged = () => {
    refreshData();
    // Trigger refresh of logged activities list
    setActivityRefreshTrigger(prev => prev + 1);
  };

  const handleStravaConnectionChange = () => {
    setStravaConnected((prev) => !prev);
  };

  // Calculate quick stats (dummy data for now - can be enhanced with real data)
  const quickStats = {
    weekDistance: '12 km', // This would come from actual activity data
    currentStreak: user.streak || 3,
    badges: 4, // This would be calculated from earned badges
  };

  return (
    <BrowserRouter>
      <main className="layout">
        <Navbar user={user} onLogActivityClick={() => setIsModalOpen(true)} />

        <Routes>
          <Route path="/profile" element={<Profile user={user} onLogout={handleLogout} onUnitChange={handleUnitChange} unit={unit} stravaConnected={stravaConnected} onConnectionChange={handleStravaConnectionChange} />} />
          <Route path="/leaderboards" element={<Leaderboards user={user} />} />
          <Route
            path="/"
            element={(
              <div className="dashboard-container">
                {/* Hero Section */}
                <section className="hero-section">
                  <h2 className="hero-welcome">
                    Welcome back, {user.username}!
                  </h2>
                  <div className="quick-stats">
                    <div className="stat-pill">
                      This week: {quickStats.weekDistance}
                    </div>
                    <div className="stat-pill">
                      Current streak: {quickStats.currentStreak} days
                    </div>
                    <div className="stat-pill">
                      Badges: {quickStats.badges}
                    </div>
                  </div>
                </section>

                {/* Strava Banner */}
                <StravaBanner user={user} onConnectionChange={handleStravaConnectionChange} />

                {/* Two Column Layout */}
                <div className="dashboard-grid">
                  {/* Left Column */}
                  <div className="dashboard-left">
                    {/* Streaks & Badges above the Activity Map */}
                    <StreaksAndBadges user={user} />
                    <ActivityMap mapPoints={mapPoints} teamMembers={teamMembers} />
                  </div>

                  {/* Right Column (swapped: StravaActivities above Leaderboard) */}
                  <div className="dashboard-right">
                    <LoggedActivities user={user} unit={unit} refreshTrigger={activityRefreshTrigger} />
                    <StravaActivities user={user} unit={unit} />
                    <Leaderboard data={leaderboard} />
                  </div>
                </div>
              </div>
            )}
          />
        </Routes>

        {/* Log Activity Modal */}
        <LogActivityModal
          user={user}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onLogged={handleActivityLogged}
        />
      </main>
    </BrowserRouter>
  );
}