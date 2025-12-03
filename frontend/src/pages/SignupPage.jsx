import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { Link } from 'react-router-dom';

export default function SignupPage({ onAuth }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchProfileAndSetUser = async (accessToken) => {
    const resp = await fetch(`http://localhost:4000/api/profiles/me`, {
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
      // Profile incomplete - redirect to create profile
      window.location.href = '/create-profile';
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
    onAuth(clientUser);
  };

  const handleEmailSignUp = async () => {
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) return alert(error.message || 'Sign up failed');
    // Try to sign in after sign up
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

  const handleGoogleSignUp = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (error) alert(error.message || 'Google sign-up failed');
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card card">
      <h3 style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #2EEAC3 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', textAlign: 'center' }}>Create account</h3>

      <label>
        Email
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </label>

      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Choose a strong password" />
      </label>

      <div className="button-row">
        <button onClick={handleEmailSignUp} disabled={loading}>Create account</button>
      </div>

      <div style={{ textAlign: 'center' }}>
        <button onClick={handleGoogleSignUp} className="oauth-button">Continue with Google</button>
      </div>

      {/* Phone SMS OTP removed per request - using only email/password and Google OAuth */}

      <p style={{ textAlign: 'center' }}>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
      </div>
    </div>
  );
}
