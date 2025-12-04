import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

const API_BASE = 'http://localhost:4000';

export default function CreateProfile({ onProfileComplete }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [city, setCity] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }
    
    if (!city.trim()) {
      setError('Please enter your location');
      return;
    }

    setLoading(true);
    try {
      // Get the current session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Not logged in. Please log in again.');
        setLoading(false);
        return;
      }

      const accessToken = session.access_token;

      // Create/update profile via backend
      const response = await fetch(`${API_BASE}/api/profiles/upsert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          display_name: username.trim(),
          city: city.trim()
        })
      });

      const payload = await response.json();
      
      if (!response.ok) {
        setError(payload.error || 'Failed to create profile');
        setLoading(false);
        return;
      }

      // Profile created successfully, fetch updated profile and notify parent
      const profileResp = await fetch(`${API_BASE}/api/profiles/me`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const profileData = await profileResp.json();
      
      const profile = profileData.profile || payload.profile || {};
      
      const clientUser = {
        id: profileData.user?.id,
        email: profileData.user?.email,
        username: profile.display_name || username.trim(),
        teamId: profile.team_id || null,
        city: profile.city || city.trim(),
        units: profile.units || 'km',
        lat: profile.lat || null,
        lng: profile.lng || null,
        points: profile.points || 0,
        streak: profile.streak || 0,
        badges: profile.badges || [],
        password: null,
      };

      // Call the completion handler which will update state and trigger re-render
      onProfileComplete(clientUser);
      // Navigate to dashboard immediately
      navigate('/', { replace: true });
    } catch (err) {
      console.error('Error creating profile:', err);
      setError('An error occurred. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card card">
        <h3 style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #2EEAC3 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', textAlign: 'center', fontSize: '2rem', marginBottom: '0.1rem' }}>
          Create Your Profile
        </h3>
        <p style={{ textAlign: 'center', color: '#cbd5e1', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
          Set up your profile to start connecting with friends!
        </p>
        
        <form onSubmit={handleSubmit}>
          <label style={{ marginBottom: '1rem' }}>
            Username
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Choose a username"
              maxLength={50}
              disabled={loading}
              required
            />
            <small style={{ display: 'block', marginTop: '0.25rem', color: '#94a3b8', fontSize: '0.8rem' }}>
              This is how other users will see you
            </small>
          </label>

          <label style={{ marginBottom: '1rem' }}>
            Location
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g., Philadelphia, New York, Los Angeles"
              maxLength={100}
              disabled={loading}
              required
            />
            <small style={{ display: 'block', marginTop: '0.25rem', color: '#94a3b8', fontSize: '0.8rem' }}>
              Your city or location (helps friends find you)
            </small>
          </label>

          {error && (
            <div style={{ 
              background: 'rgba(239, 68, 68, 0.1)', 
              border: '1px solid rgba(239, 68, 68, 0.3)', 
              color: '#fca5a5', 
              padding: '0.75rem', 
              borderRadius: '8px', 
              marginBottom: '1rem',
              fontSize: '0.875rem'
            }}>
              {error}
            </div>
          )}

          <div className="button-row">
            <button type="submit" disabled={loading}>
              {loading ? 'Creating Profile...' : 'Create Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

