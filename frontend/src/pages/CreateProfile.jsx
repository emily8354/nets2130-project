import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import './CreateProfile.css';

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
    <div className="create-profile-container">
      <div className="create-profile-card">
        <h2>Create Your Profile</h2>
        <p className="subtitle">Set up your profile to start connecting with friends!</p>
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Choose a username"
              maxLength={50}
              disabled={loading}
              required
            />
            <small>This is how other users will see you</small>
          </div>

          <div className="form-group">
            <label htmlFor="city">Location</label>
            <input
              id="city"
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g., Philadelphia, New York, Los Angeles"
              maxLength={100}
              disabled={loading}
              required
            />
            <small>Your city or location (helps friends find you)</small>
          </div>

          {error && <div className="error-message">{error}</div>}

          <button type="submit" disabled={loading} className="submit-button">
            {loading ? 'Creating Profile...' : 'Create Profile'}
          </button>
        </form>
      </div>
    </div>
  );
}

