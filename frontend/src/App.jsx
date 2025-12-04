import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';
import Navbar from './components/Navbar';
import LogActivityModal from './components/LogActivityModal';
import Profile from './pages/Profile';
import Leaderboards from './pages/Leaderboards';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import CreateProfile from './pages/CreateProfile';
import Friends from './pages/Friends';
import Teams from './pages/Teams';
import Dashboard from './pages/Dashboard';

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
    
    // Check if profile is complete (has username and city)
    const hasUsername = profile.display_name && profile.display_name.trim().length > 0;
    const hasCity = profile.city && profile.city.trim().length > 0;
    const isProfileComplete = hasUsername && hasCity;
    
    if (!isProfileComplete) {
      // Profile incomplete, set flag to show create profile page
      setNeedsProfile(true);
      return;
    }
    
    const clientUser = {
      id: supaUser?.id,
      email: supaUser?.email,
      username: profile.display_name || (supaUser?.email ? supaUser.email.split('@')[0] : 'user'),
      teamId: profile.team_id || null,
      city: profile.city || null,
      units: profile.units || 'km',
      lat: profile.lat || null,
      lng: profile.lng || null,
      points: profile.points || 0,
      streak: profile.streak || 0,
      badges: profile.badges || [],
      password: null,
    };
    setNeedsProfile(false);
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
  const [needsProfile, setNeedsProfile] = useState(false);
  const [unit, setUnit] = useState(() => {
    try {
      return localStorage.getItem('distanceUnit') || 'km';
    } catch (e) {
      return 'km';
    }
  });
  const [stravaConnected, setStravaConnected] = useState(false);
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
            // Check if profile is complete
            const hasUsername = profile.display_name && profile.display_name.trim().length > 0;
            const hasCity = profile.city && profile.city.trim().length > 0;
            const isProfileComplete = hasUsername && hasCity;
            
            if (!isProfileComplete) {
              setNeedsProfile(true);
              return;
            }
            
            const clientUser = {
              id: supaUser?.id,
              email: supaUser?.email,
              username: profile.display_name || (supaUser?.email ? supaUser.email.split('@')[0] : 'user'),
              teamId: profile.team_id || null,
              city: profile.city || null,
              units: profile.units || 'km',
              lat: profile.lat || null,
              lng: profile.lng || null,
              points: profile.points || 0,
              streak: profile.streak || 0,
              badges: profile.badges || [],
              password: null,
            };
            setNeedsProfile(false);
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
    setNeedsProfile(false);
    // clear frontend state and preferences
    setUser(null);
    try {
      // keep unit persisted unless user wants it cleared; we'll keep it
    } catch (e) {}
    // Optionally: redirect handled by Router since login view shows when no user
  };



  // Show create profile page if user is logged in but profile is incomplete
  if (needsProfile) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/create-profile" element={<CreateProfile onProfileComplete={(user) => { setNeedsProfile(false); setUser(user); }} />} />
          <Route path="*" element={<Navigate to="/create-profile" replace />} />
        </Routes>
      </BrowserRouter>
    );
  }

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
            <Route path="/create-profile" element={<CreateProfile onProfileComplete={(user) => { setNeedsProfile(false); setUser(user); }} />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
      </main>
      </BrowserRouter>
    );
  }

  const handleActivityLogged = () => {
    // Trigger refresh of logged activities list
    setActivityRefreshTrigger(prev => prev + 1);
  };

  const handleStravaConnectionChange = () => {
    setStravaConnected((prev) => !prev);
  };

  return (
    <BrowserRouter>
    <main className="layout">
        <Navbar user={user} onLogActivityClick={() => setIsModalOpen(true)} />

        <Routes>
          <Route path="/create-profile" element={<Navigate to="/" replace />} />
          <Route path="/profile" element={<Profile user={user} onLogout={handleLogout} onUnitChange={handleUnitChange} unit={unit} stravaConnected={stravaConnected} onConnectionChange={handleStravaConnectionChange} />} />
          <Route path="/leaderboards" element={<Leaderboards user={user} />} />
          <Route path="/friends" element={<Friends user={user} />} />
          <Route path="/teams" element={<Teams user={user} />} />
          <Route
            path="/"
            element={
              <Dashboard 
                user={user} 
                unit={unit} 
                onConnectionChange={handleStravaConnectionChange}
                activityRefreshTrigger={activityRefreshTrigger}
              />
            }
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