// Kinnect prototype backend demonstrating core workflow
// Node.js + Express with in-memory storage for clarity

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const {
  encrypt,
  decrypt,
  generateState,
  exchangeCodeForTokens,
  refreshAccessToken,
  isTokenExpired,
  stravaApiRequest
} = require('./strava-utils');

// Supabase client (server-side, service role)
let supabase;
try {
  const { createClient } = require('@supabase/supabase-js');
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
} catch (e) {
  // supabase-js might not be installed yet; endpoints that use it will check and return helpful errors
  console.warn('Supabase client not initialized (is @supabase/supabase-js installed?)');
}
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Rate limiting for Strava API endpoints
const stravaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each IP to 200 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

// Store OAuth state for CSRF protection (in production, use Redis or session store)
const oauthStates = new Map();

/**********************
 * In-memory mock data
 **********************/
// In production/authenticated mode, user data is stored in Supabase profiles.
// Remove in-memory demo users to avoid persisting demo accounts.
const users = {};

// Teams hold aggregated totals derived from their members' activities
const teams = {
  'team-alpha': {
    id: 'team-alpha',
    name: 'Team Alpha',
    city: 'Philadelphia',
    totalPoints: 1195,
    totalActivities: 45,
  },
};

// Activities stored in-memory for demo; encourage moving to a persistent table.
const activities = [];

// Strava connections storage (in-memory, structured for easy DB migration)
// Format: { username: { stravaAthleteId, accessTokenEncrypted, refreshTokenEncrypted, expiresAt, scope, createdAt, updatedAt } }
const stravaConnections = {};

// Encryption key (in production, use environment variable)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

/**********************
 * Helper functions
 **********************/
const generateId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

const getToday = () => new Date().toISOString().slice(0, 10);

// Helper function to get city coordinates
function getCityCoordinates(city) {
  const cityMap = {
    'Philadelphia': { lat: 39.9526, lng: -75.1652 },
    'New York': { lat: 40.7128, lng: -74.0060 },
    'Los Angeles': { lat: 34.0522, lng: -118.2437 },
    'Chicago': { lat: 41.8781, lng: -87.6298 },
    'San Francisco': { lat: 37.7749, lng: -122.4194 },
    'Boston': { lat: 42.3601, lng: -71.0589 },
    'Seattle': { lat: 47.6062, lng: -122.3321 },
    'Miami': { lat: 25.7617, lng: -80.1918 },
    'Austin': { lat: 30.2672, lng: -97.7431 },
  };
  return cityMap[city] || { lat: 39.9526, lng: -75.1652 }; // Default coordinates
}

function calculatePoints(activity) {
  switch (activity.type) {
    case 'run':
      return activity.distanceKm * 10; // 10 pts per km
    case 'walk':
      return activity.distanceKm * 5; // 5 pts per km
    case 'workout':
      return activity.durationMinutes; // 1 pt per minute
    default:
      return 10;
  }
}

function updateUserProgress(user, activityPoints, date) {
  // Update streak: increment if last activity was yesterday, reset otherwise
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (user.lastActivityDate === date) {
    // Already logged today, streak unchanged
  } else if (user.lastActivityDate === yesterday) {
    user.streak += 1;
  } else {
    user.streak = 1;
  }
  user.lastActivityDate = date;

  user.points += activityPoints;
}

function updateTeamProgress(teamId) {
  const team = teams[teamId];
  if (!team) return;

  // Aggregate totals from member activities
  const teamMembers = Object.values(users).filter((user) => user.teamId === teamId);
  team.totalPoints = teamMembers.reduce((sum, member) => sum + member.points, 0);
  const memberUsernames = new Set(teamMembers.map((member) => member.username));
  team.totalActivities = activities.filter((activity) => memberUsernames.has(activity.username)).length;
}

function getLeaderboards() {
  // If Supabase is configured, build leaderboards from profiles and activities
  if (supabase) {
    return (async () => {
      try {
        const { data: profiles } = await supabase.from('profiles').select('*');

        // Aggregate points from in-memory activities (if any)
        const pointsByUser = {};
        activities.forEach((act) => {
          const uid = act.user_id || act.username;
          pointsByUser[uid] = (pointsByUser[uid] || 0) + (act.pointsEarned || 0);
        });

        // Individual leaderboard
        const individual = (profiles || []).map((p) => ({ id: p.id, display_name: p.display_name || p.id, city: p.city || null, team_id: p.team_id || null, points: pointsByUser[p.id] || 0 }));
        individual.sort((a, b) => b.points - a.points);
        const individualLeaderboard = individual.map((u, idx) => ({ rank: idx + 1, username: u.display_name, points: u.points, teamId: u.team_id }));

        // Team leaderboard
        const teamMap = {};
        individual.forEach((u) => {
          if (!u.team_id) return;
          if (!teamMap[u.team_id]) teamMap[u.team_id] = { id: u.team_id, name: u.team_id, totalPoints: 0, totalActivities: 0 };
          teamMap[u.team_id].totalPoints += u.points;
        });
        const teamLeaderboard = Object.values(teamMap).sort((a, b) => b.totalPoints - a.totalPoints).map((t, i) => ({ rank: i + 1, ...t }));

        // City leaderboard
        const cityMap = {};
        individual.forEach((u) => {
          const city = u.city || 'Unknown';
          if (!cityMap[city]) cityMap[city] = { city, points: 0, streak: 0 };
          cityMap[city].points += u.points;
        });
        const cityLeaderboard = Object.values(cityMap).sort((a, b) => b.points - a.points);

        return { teamLeaderboard, cityLeaderboard, individualLeaderboard };
      } catch (err) {
        console.error('Error building leaderboards from Supabase:', err);
        return { teamLeaderboard: [], cityLeaderboard: [], individualLeaderboard: [] };
      }
    })();
  }

  // Fallback: empty leaderboards when no supabase configured
  return { teamLeaderboard: [], cityLeaderboard: [], individualLeaderboard: [] };
}

/**********************
 * Auth endpoints (mocked)
 **********************/
// NOTE: In-memory signup/login endpoints removed. Use Supabase Auth instead.
// Server-side Supabase endpoints are available at:
// - POST /api/auth/signup  (admin create user + profile upsert)
// - Frontend should use Supabase client (anon key) to signIn/signUp and then call /api/profiles/me

/**
 * Supabase-backed endpoints
 * - POST /api/auth/signup => create a Supabase auth user (server-side) and a profile row
 * - GET /api/profiles/me => read profile for the current user (requires Bearer token)
 * - POST /api/profiles/upsert => upsert profile for current user (requires Bearer token)
 */

// Helper to get supabase user from access token
async function getSupabaseUserFromToken(token) {
  if (!supabase) throw new Error('Supabase client not configured');
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error) {
    // some versions return error when token invalid
    return null;
  }
  return data?.user || null;
}

app.post('/api/auth/signup', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured on server' });
  const { email, password, display_name, city, team_id } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  try {
    // Create user via admin API (service_role key)
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name }
    });
    if (error) return res.status(400).json({ error: error.message || error });

    const user = data.user;

    // create profile row
    const profile = {
      id: user.id,
      display_name: display_name || email.split('@')[0],
      avatar_url: null,
      team_id: team_id || null,
      city: city || null,
      units: 'km'
    };
    const { error: upsertErr } = await supabase.from('profiles').upsert(profile);
    if (upsertErr) {
      console.warn('Failed to upsert profile after signup:', upsertErr);
    }

    res.json({ message: 'User created', user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error('Supabase signup error', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.get('/api/profiles/me', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured on server' });
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

  try {
    const user = await getSupabaseUserFromToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });

    const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (error && error.code !== 'PGRST116') return res.status(500).json({ error: error.message || error });

    res.json({ user, profile: data || null });
  } catch (err) {
    console.error('Error fetching profile', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.post('/api/profiles/upsert', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured on server' });
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

  try {
    const user = await getSupabaseUserFromToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });

    // Accept profile fields from body
    const { display_name, avatar_url, team_id, city, units } = req.body;
    const profileRow = {
      id: user.id,
      display_name: display_name || user.user_metadata?.display_name || user.email.split('@')[0],
      avatar_url: avatar_url || null,
      team_id: team_id || null,
      city: city || null,
      units: units || 'km'
    };

    const { data, error } = await supabase.from('profiles').upsert(profileRow).select().limit(1).single();
    if (error) return res.status(500).json({ error: error.message || error });

    res.json({ profile: data });
  } catch (err) {
    console.error('Error upserting profile', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

/**********************
 * Activity workflow
 **********************/
app.post('/activities', (req, res) => {
  // Accept either username (legacy) or user_id (supabase) in body
  const { username, user_id, type, distanceKm = 0, durationMinutes = 0, date = getToday() } = req.body;
  const actor = user_id || username;
  if (!actor) return res.status(400).json({ error: 'username or user_id required' });

  const activity = {
    id: generateId('act'),
    user_id: user_id || null,
    username: username || null,
    type,
    distanceKm,
    durationMinutes,
    date,
  };
  const points = calculatePoints(activity);
  activity.pointsEarned = points;

  activities.push(activity);

  // Note: updateUserProgress and updateTeamProgress require profile/team data; skip in Supabase mode
  res.json({ message: 'Activity logged', activity });
});

app.get('/activities/:identifier', (req, res) => {
  const identifier = req.params.identifier;
  // Support both username and user_id
  const userActivities = activities.filter((activity) => 
    activity.username === identifier || activity.user_id === identifier
  );
  res.json(userActivities);
});

/**********************
 * Leaderboards & dashboard
 **********************/
app.get('/leaderboard', async (req, res) => {
  try {
    const boards = await getLeaderboards();
    res.json(boards);
  } catch (err) {
    console.error('Error returning leaderboard:', err);
    res.json({ teamLeaderboard: [], cityLeaderboard: [], individualLeaderboard: [] });
  }
});

app.get('/activity-map', (req, res) => {
  (async () => {
    // Build map points from activities and profiles when available
    if (supabase) {
      try {
        const { data: profiles } = await supabase.from('profiles').select('*');
        const profileById = {};
        (profiles || []).forEach((p) => { profileById[p.id] = p; });

        const mapPoints = activities.map((activity, index) => {
          const uid = activity.user_id || activity.username;
          const profile = profileById[uid];
          const coords = profile ? getCityCoordinates(profile.city || 'Unknown') : { lat: 39.9526, lng: -75.1652 };
          return {
            id: `map-${index}`,
            userId: uid,
            username: profile?.display_name || uid,
            lat: profile?.lat || coords.lat + (Math.random() - 0.5) * 0.01,
            lng: profile?.lng || coords.lng + (Math.random() - 0.5) * 0.01,
            intensity: activity.pointsEarned || 1,
            type: activity.type,
            date: activity.date,
          };
        });

        return res.json({ mapPoints });
      } catch (err) {
        console.error('Error building activity map from Supabase:', err);
      }
    }

    // Fallback: return empty map or based on minimal activities
    const mapPoints = activities.map((activity, index) => ({
      id: `map-${index}`,
      username: activity.username || activity.user_id,
      lat: 39.9526 + (Math.random() - 0.5) * 0.01,
      lng: -75.1652 + (Math.random() - 0.5) * 0.01,
      intensity: activity.pointsEarned || 1,
      type: activity.type,
      date: activity.date,
    }));
    res.json({ mapPoints });
  })();
});

// New endpoint to get team members with their status and locations
app.get('/team-members', (req, res) => {
  const { teamId } = req.query;
  // If Supabase is configured, fetch profiles for the given teamId
  (async () => {
    if (supabase) {
      try {
        let q = supabase.from('profiles').select('*');
        if (teamId) q = q.eq('team_id', teamId);
        const { data: profiles, error } = await q;
        if (error) {
          console.error('Error querying profiles for team-members:', error);
          return res.status(500).json({ members: [] });
        }

        const now = Date.now();
        const members = (profiles || []).map((p) => {
          // Provide default coordinates based on city
          const coords = getCityCoordinates(p.city || 'Unknown');
          // No real 'lastSeen' tracking yet; mark everyone as online for now
          const lastSeen = now - Math.floor(Math.random() * 600000); // randomize for demo
          const timeSinceLastSeen = now - lastSeen;
          let status = 'offline';
          if (timeSinceLastSeen < 300000) status = 'active';
          else if (timeSinceLastSeen < 900000) status = 'online';

          return {
            username: p.display_name || p.id,
            city: p.city || null,
            teamId: p.team_id || null,
            points: 0,
            streak: 0,
            lat: coords.lat,
            lng: coords.lng,
            status,
            lastSeen,
            lastActivityDate: null,
          };
        });

        return res.json({ members });
      } catch (err) {
        console.error('Error fetching team members from Supabase:', err);
        return res.status(500).json({ members: [] });
      }
    }

    // Fallback: no server-side profiles configured
    res.json({ members: [] });
  })();
});

/**********************
 * Strava OAuth Integration
 **********************/

// Helper function to get valid access token (with auto-refresh)
async function getValidAccessToken(identifier) {
  // identifier may be a Supabase user id (uuid) or a legacy username
  // First, try Supabase-backed tokens
  if (supabase) {
    try {
      const { data: tokenRow, error } = await supabase.from('strava_tokens').select('*').eq('user_id', identifier).single();
      if (!error && tokenRow) {
        const enc = tokenRow.encrypted || {};
        const accessToken = decrypt(enc.access, ENCRYPTION_KEY);
        const refreshToken = decrypt(enc.refresh, ENCRYPTION_KEY);
        const expiresAt = tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() : null;

        if (isTokenExpired(expiresAt)) {
          try {
            const newTokens = await refreshAccessToken(refreshToken, process.env.STRAVA_CLIENT_ID, process.env.STRAVA_CLIENT_SECRET);
            // update DB
            const newEncrypted = { access: encrypt(newTokens.accessToken, ENCRYPTION_KEY), refresh: encrypt(newTokens.refreshToken, ENCRYPTION_KEY) };
            await supabase.from('strava_tokens').upsert({ user_id: identifier, encrypted: newEncrypted, scope: newTokens.scope, expires_at: new Date(newTokens.expiresAt).toISOString() }, { onConflict: 'user_id' });
            return newTokens.accessToken;
          } catch (err) {
            console.error('Failed to refresh Strava token from DB row:', err);
            throw new Error('Token refresh failed. Please reconnect your Strava account.');
          }
        }

        return accessToken;
      }
    } catch (err) {
      console.error('Error querying strava_tokens for user:', err);
    }
  }

  // Fallback to legacy in-memory store keyed by username
  const connection = stravaConnections[identifier];
  if (!connection) {
    throw new Error('No Strava connection found');
  }

  // Decrypt tokens
  const accessToken = decrypt(connection.accessTokenEncrypted, ENCRYPTION_KEY);
  const refreshToken = decrypt(connection.refreshTokenEncrypted, ENCRYPTION_KEY);

  // Check if token is expired
  if (isTokenExpired(connection.expiresAt)) {
    try {
      // Refresh the token
      const newTokens = await refreshAccessToken(
        refreshToken,
        process.env.STRAVA_CLIENT_ID,
        process.env.STRAVA_CLIENT_SECRET
      );

      // Encrypt and store new tokens
      connection.accessTokenEncrypted = encrypt(newTokens.accessToken, ENCRYPTION_KEY);
      connection.refreshTokenEncrypted = encrypt(newTokens.refreshToken, ENCRYPTION_KEY);
      connection.expiresAt = newTokens.expiresAt;
      connection.updatedAt = Date.now();

      return newTokens.accessToken;
    } catch (error) {
      // If refresh fails, remove connection
      delete stravaConnections[identifier];
      throw new Error('Token refresh failed. Please reconnect your Strava account.');
    }
  }

  return accessToken;
}

// GET /api/strava/auth - Generate Strava authorization URL
app.get('/api/strava/auth', (req, res) => {
  const { username } = req.query;

  // Allow the frontend to provide a Supabase access token in Authorization header.
  // If provided and valid, we will associate the state with the Supabase user id (preferred).
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  let stateData = {};

  (async () => {
    if (token && supabase) {
      try {
        const supaUser = await getSupabaseUserFromToken(token);
        if (supaUser) {
          stateData.userId = supaUser.id; // prefer server-side user id binding
        }
      } catch (err) {
        // Ignore - we'll fall back to username if provided
      }
    }

    if (!stateData.userId) {
      if (!username) {
        return res.status(400).json({ error: 'username required when not authenticated via Supabase' });
      }
      if (!users[username]) {
        return res.status(404).json({ error: 'User not found' });
      }
      stateData.username = username;
    }

    const state = generateState();
    stateData.timestamp = Date.now();
    oauthStates.set(state, stateData);

    // Clean up old states (older than 10 minutes)
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    for (const [key, value] of oauthStates.entries()) {
      if (value.timestamp < tenMinutesAgo) {
        oauthStates.delete(key);
      }
    }

    // Note: Callback must go to backend, not frontend, since backend exchanges code for tokens
    const redirectUri = encodeURIComponent(process.env.STRAVA_REDIRECT_URI || 'http://localhost:4000/api/strava/callback');
    const scope = 'read,activity:read_all';
    const authUrl = `https://www.strava.com/oauth/authorize?client_id=${process.env.STRAVA_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}`;

    res.json({ authUrl, state });
  })();
});

// GET /api/strava/callback - Handle OAuth callback
app.get('/api/strava/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`http://localhost:5173?strava_error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return res.redirect(`http://localhost:5173?strava_error=${encodeURIComponent('Missing authorization code or state')}`);
  }

  // Validate state to prevent CSRF
  const stateData = oauthStates.get(state);
  if (!stateData) {
    return res.redirect(`http://localhost:5173?strava_error=${encodeURIComponent('Invalid state parameter')}`);
  }

  oauthStates.delete(state); // Use state only once

  const { username } = stateData;

  try {
    // Exchange code for tokens
    const tokenData = await exchangeCodeForTokens(
      code,
      process.env.STRAVA_CLIENT_ID,
      process.env.STRAVA_CLIENT_SECRET
    );

    // Prepare encrypted payload for storage
    const encryptedPayload = {
      access: encrypt(tokenData.accessToken, ENCRYPTION_KEY),
      refresh: encrypt(tokenData.refreshToken, ENCRYPTION_KEY)
    };

    // Prepare a small, redacted summary for debugging (do NOT include raw tokens)
    let dbPayloadSummary = null;
    try {
      const expiresAtIso = new Date(tokenData.expiresAt).toISOString();
      // encryptedPayload.access/refresh are objects { encrypted, iv, authTag }
      const accessLen = encryptedPayload.access ? JSON.stringify(encryptedPayload.access).length : 0;
      const refreshLen = encryptedPayload.refresh ? JSON.stringify(encryptedPayload.refresh).length : 0;
      dbPayloadSummary = `uid=${stateData.userId || 'N/A'}|exp=${expiresAtIso}|scope=${tokenData.scope || 'N/A'}|alen=${accessLen}|rlen=${refreshLen}`;

      // Console log the redacted pre-upsert payload for local debugging
      console.log('Pre-upsert strava_tokens summary:', dbPayloadSummary);
    } catch (logErr) {
      console.warn('Failed to build strava_tokens payload summary for debug:', logErr);
    }

    // Track DB upsert result for debugging to surface back to the client
    let dbUpsertResult = null;
    let dbUpsertError = null;

    // If the state was created with a Supabase user id, persist tokens server-side into supabase
    if (stateData.userId && supabase) {
      try {
        // Use select() to get the returned row(s) so we can inspect what Supabase returned
        const upsertRes = await supabase
          .from('strava_tokens')
          .upsert(
            {
              user_id: stateData.userId,
              encrypted: encryptedPayload,
              scope: tokenData.scope,
              expires_at: new Date(tokenData.expiresAt).toISOString()
            },
            { onConflict: 'user_id' }
          )
          .select();

        // Log the full response from Supabase for debugging (server-only log)
        console.log('Supabase upsert response for strava_tokens:', JSON.stringify(upsertRes));

        // If Supabase returned an error about ON CONFLICT, fall back to explicit select/insert/update
        if (upsertRes.error && upsertRes.error.code === '42P10') {
          console.warn('Supabase upsert ON CONFLICT failed (no unique constraint). Falling back to explicit insert/update.');
          try {
            const { data: existing } = await supabase.from('strava_tokens').select('*').eq('user_id', stateData.userId).single();
            if (existing) {
              const { error: updErr } = await supabase.from('strava_tokens').update({ encrypted: encryptedPayload, scope: tokenData.scope, expires_at: new Date(tokenData.expiresAt).toISOString() }).eq('user_id', stateData.userId);
              if (updErr) {
                console.error('Fallback update failed:', updErr);
                throw updErr;
              }
            } else {
              const { error: insErr } = await supabase.from('strava_tokens').insert({ user_id: stateData.userId, encrypted: encryptedPayload, scope: tokenData.scope, expires_at: new Date(tokenData.expiresAt).toISOString() });
              if (insErr) {
                console.error('Fallback insert failed:', insErr);
                throw insErr;
              }
            }
            // Successful fallback
            dbUpsertResult = 'ok';
            console.log(`Stored Strava tokens (fallback) for Supabase user: ${stateData.userId}`);
            // Build safe summary from the explicit read
            try {
              const { data: row } = await supabase.from('strava_tokens').select('user_id,athlete_id,expires_at,scope').eq('user_id', stateData.userId).single();
              const rawSummary = { data: row ? [row] : [], error: null };
              dbUpsertRaw = encodeURIComponent(JSON.stringify(rawSummary).slice(0, 400));
            } catch (readErr) {
              console.warn('Failed to read back row after fallback upsert:', readErr);
            }
          } catch (fbErr) {
            console.error('Fallback insert/update error:', fbErr);
            dbUpsertResult = 'error';
            dbUpsertError = encodeURIComponent(String(fbErr.message || fbErr).slice(0, 200));
          }
        } else {
          // Build a safe, truncated summary to include in the redirect (do not leak encrypted tokens)
          try {
            const safeRows = (upsertRes.data || []).map((r) => ({ user_id: r.user_id, athlete_id: r.athlete_id || null, expires_at: r.expires_at, scope: r.scope }));
            const rawSummary = { data: safeRows, error: upsertRes.error ? String(upsertRes.error.message || upsertRes.error) : null };
            // Keep it small
            dbUpsertRaw = encodeURIComponent(JSON.stringify(rawSummary).slice(0, 400));
          } catch (summErr) {
            console.warn('Failed to build safe upsert summary:', summErr);
          }

          console.log(`Stored Strava tokens for Supabase user: ${stateData.userId}`);
          dbUpsertResult = 'ok';
        }
      } catch (dbErr) {
        console.error('Failed to upsert strava_tokens in Supabase (thrown):', dbErr);
        dbUpsertResult = 'error';
        try {
          dbUpsertError = encodeURIComponent(String(dbErr.message || dbErr).slice(0, 200));
        } catch (e) {
          dbUpsertError = 'unknown';
        }
      }
    }

    // Keep in-memory store for legacy/demo mode when username was used
    if (stateData.username) {
      stravaConnections[stateData.username] = {
        stravaAthleteId: tokenData.athlete.id,
        accessTokenEncrypted: encrypt(tokenData.accessToken, ENCRYPTION_KEY),
        refreshTokenEncrypted: encrypt(tokenData.refreshToken, ENCRYPTION_KEY),
        expiresAt: tokenData.expiresAt,
        scope: tokenData.scope,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    }

    // Redirect to frontend with success. If we have a username include it for client UX.
    const redirectBase = 'http://localhost:5173';
    const params = new URLSearchParams({ strava_success: 'true' });
    if (stateData.username) params.set('username', stateData.username);
    if (stateData.userId) params.set('supaUserId', stateData.userId);

    // Surface DB upsert status for easier debugging in the frontend. Keep values short.
    if (dbUpsertResult) {
      params.set('dbStatus', dbUpsertResult);
      if (dbUpsertError) params.set('dbError', dbUpsertError);
      // include the short redacted payload summary to help debugging
      if (dbPayloadSummary) params.set('dbPayloadSummary', dbPayloadSummary);
      // include a truncated safe representation of what Supabase returned (no tokens)
      if (typeof dbUpsertRaw !== 'undefined' && dbUpsertRaw !== null) params.set('dbUpsertRaw', dbUpsertRaw);
    } else if (stateData.username) {
      // legacy in-memory path used
      params.set('dbStatus', 'memory');
    }

    res.redirect(`${redirectBase}?${params.toString()}`);
  } catch (error) {
    console.error('Strava callback error:', error);
    res.redirect(`http://localhost:5173?strava_error=${encodeURIComponent(error.message)}`);
  }
});

// POST /api/strava/refresh - Manually refresh tokens
app.post('/api/strava/refresh', async (req, res) => {
  const { username, userId } = req.body;
  const id = userId || username;
  if (!id) return res.status(400).json({ error: 'username or userId required' });

  try {
    await getValidAccessToken(id);
    res.json({ message: 'Token refreshed successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/strava/disconnect - Remove Strava connection
app.get('/api/strava/disconnect', (req, res) => {
  const { username, userId } = req.query;
  const id = userId || username;
  if (!id) return res.status(400).json({ error: 'username or userId required' });

  // If Supabase is configured, delete the row server-side
  (async () => {
    if (supabase && userId) {
      try {
        const { error } = await supabase.from('strava_tokens').delete().eq('user_id', userId);
        if (error) {
          console.error('Failed to delete strava_tokens row:', error);
          return res.status(500).json({ error: 'Failed to disconnect' });
        }
        return res.json({ message: 'Strava connection removed successfully' });
      } catch (err) {
        console.error('Error deleting strava_tokens:', err);
        return res.status(500).json({ error: 'Failed to disconnect' });
      }
    }

    if (stravaConnections[id]) {
      delete stravaConnections[id];
      return res.json({ message: 'Strava connection removed successfully' });
    }

    res.status(404).json({ error: 'No Strava connection found' });
  })();
});

// GET /api/strava/status - Get connection status
app.get('/api/strava/status', (req, res) => {
  const { username, userId } = req.query;
  const id = userId || username;
  if (!id) return res.status(400).json({ error: 'username or userId required' });

  (async () => {
    if (supabase && userId) {
      try {
        const { data: tokenRow, error } = await supabase.from('strava_tokens').select('*').eq('user_id', userId).single();
        if (!error && tokenRow) {
          const expiresAt = tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() : null;
          return res.json({ connected: true, stravaAthleteId: tokenRow.athlete_id || null, expiresAt, isExpired: isTokenExpired(expiresAt), scope: tokenRow.scope });
        }
        return res.json({ connected: false });
      } catch (err) {
        console.error('Error checking strava_tokens:', err);
        return res.status(500).json({ connected: false });
      }
    }

    const connection = stravaConnections[id];
    if (!connection) return res.json({ connected: false });

    res.json({ connected: true, stravaAthleteId: connection.stravaAthleteId, expiresAt: connection.expiresAt, isExpired: isTokenExpired(connection.expiresAt), scope: connection.scope });
  })();
});

// DEBUG: Server-only endpoint to inspect strava_tokens rows for a given Supabase user id
// This is intended for local debugging only and requires no public auth in this prototype.
app.get('/api/strava/tokens/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!supabase) return res.status(500).json({ error: 'Supabase client not configured' });
  try {
    const { data, error } = await supabase.from('strava_tokens').select('*').eq('user_id', userId).single();
    if (error) {
      return res.status(404).json({ error: 'No tokens found', details: error.message || error });
    }
    return res.json({ row: data });
  } catch (err) {
    console.error('Error fetching strava_tokens row:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// GET /api/strava/athlete - Get athlete profile (with rate limiting)
app.get('/api/strava/athlete', stravaLimiter, async (req, res) => {
  const { username, userId } = req.query;
  const id = userId || username;
  if (!id) return res.status(400).json({ error: 'username or userId required' });

  try {
    const accessToken = await getValidAccessToken(id);
    const athlete = await stravaApiRequest('/athlete', accessToken);
    res.json(athlete);
  } catch (error) {
    if (error.message === 'UNAUTHORIZED') {
      return res.status(401).json({ error: 'Strava authorization failed. Please reconnect your account.' });
    }
    console.error('Strava API error:', error);
    res.status(500).json({ error: 'Failed to fetch athlete data' });
  }
});

// GET /api/strava/activities - Get user's activities (with rate limiting)
app.get('/api/strava/activities', stravaLimiter, async (req, res) => {
  const { username, userId, per_page = 30, page = 1 } = req.query;
  const id = userId || username;
  if (!id) return res.status(400).json({ error: 'username or userId required' });

  try {
    const accessToken = await getValidAccessToken(id);
    const activities = await stravaApiRequest(
      `/athlete/activities?per_page=${per_page}&page=${page}`,
      accessToken
    );
    res.json(activities);
  } catch (error) {
    if (error.message === 'UNAUTHORIZED') {
      return res.status(401).json({ error: 'Strava authorization failed. Please reconnect your account.' });
    }
    console.error('Strava API error:', error);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});

/**********************
 * Server start helper (for integration tests)
 **********************/
if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`Kinnect prototype backend listening on port ${PORT}`);
  });
}

module.exports = app;
