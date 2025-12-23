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

// Calculate calories burned based on activity type, duration, and distance
// Uses MET (Metabolic Equivalent of Task) values
function calculateCalories(activity) {
  const { type, distanceKm, durationMinutes } = activity;
  
  // Average weight in kg (can be made user-specific later)
  const weightKg = 70;
  const durationHours = durationMinutes / 60;
  
  let metValue;
  switch (type) {
    case 'run':
      // Running: ~10 METs for moderate pace, ~11.5 for fast pace
      // Use distance-based calculation: ~1 kcal per kg per km
      return Math.round(weightKg * distanceKm);
    case 'walk':
      // Walking: ~3.5 METs, or ~0.5 kcal per kg per km
      return Math.round(weightKg * distanceKm * 0.5);
    case 'workout':
      // General workout: ~6 METs
      // Calories = METs × weight(kg) × hours
      return Math.round(6 * weightKg * durationHours);
    default:
      // Default: ~5 METs
      return Math.round(5 * weightKg * durationHours);
  }
}

function calculatePoints(activity) {
  // Points based on calories burned: 1 point per 10 calories
  const calories = calculateCalories(activity);
  return Math.max(1, Math.round(calories / 10));
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
        console.log('[LEADERBOARD] Building leaderboards...');
        
        // Fetch profiles
        const { data: profiles, error: profilesError } = await supabase.from('profiles').select('*');
        if (profilesError) {
          console.error('[LEADERBOARD] Error fetching profiles:', profilesError);
        }

        // Fetch activities from database
        const { data: dbActivities, error: activitiesError } = await supabase
          .from('activities')
          .select('user_id, points_earned')
          .limit(10000); // Reasonable limit
        
        if (activitiesError) {
          console.error('[LEADERBOARD] Error fetching activities:', activitiesError);
        }

        // Aggregate points from database activities
        const pointsByUser = {};
        (dbActivities || []).forEach((act) => {
          if (act.user_id) {
            pointsByUser[act.user_id] = (pointsByUser[act.user_id] || 0) + (act.points_earned || 0);
          }
        });

        // Also include points from profiles table (in case they're stored there)
        (profiles || []).forEach((p) => {
          if (p.points && p.points > 0) {
            pointsByUser[p.id] = (pointsByUser[p.id] || 0) + (p.points || 0);
          }
        });

        // Fetch teams and team members
        const { data: teamsData, error: teamsError } = await supabase
          .from('teams')
          .select('id, name');
        
        if (teamsError) {
          console.error('[LEADERBOARD] Error fetching teams:', teamsError);
        }

        const { data: teamMembersData, error: membersError } = await supabase
          .from('team_members')
          .select('team_id, user_id');
        
        if (membersError) {
          console.error('[LEADERBOARD] Error fetching team members:', membersError);
        }

        // Build map of user_id -> team_id
        const userToTeamMap = {};
        (teamMembersData || []).forEach((member) => {
          userToTeamMap[member.user_id] = member.team_id;
        });

        // Build map of team_id -> team name
        const teamIdToName = {};
        (teamsData || []).forEach((team) => {
          teamIdToName[team.id] = team.name;
        });

        // Individual leaderboard
        const individual = (profiles || []).map((p) => ({
          id: p.id,
          display_name: p.display_name || p.id,
          city: p.city || null,
          team_id: userToTeamMap[p.id] || null,
          points: pointsByUser[p.id] || (p.points || 0),
          streak: p.streak || 0
        }));
        individual.sort((a, b) => b.points - a.points);
        const individualLeaderboard = individual.map((u, idx) => ({
          rank: idx + 1,
          username: u.display_name,
          points: u.points,
          teamId: u.team_id
        }));

        // Team leaderboard - aggregate by team
        const teamMap = {};
        const teamActivityCount = {};
        
        // Count activities per team
        (dbActivities || []).forEach((act) => {
          const teamId = userToTeamMap[act.user_id];
          if (teamId) {
            teamActivityCount[teamId] = (teamActivityCount[teamId] || 0) + 1;
          }
        });

        // Aggregate points by team
        individual.forEach((u) => {
          if (!u.team_id) return;
          if (!teamMap[u.team_id]) {
            teamMap[u.team_id] = {
              id: u.team_id,
              name: teamIdToName[u.team_id] || u.team_id,
              totalPoints: 0,
              totalActivities: 0
            };
          }
          teamMap[u.team_id].totalPoints += u.points;
          teamMap[u.team_id].totalActivities = teamActivityCount[u.team_id] || 0;
        });

        const teamLeaderboard = Object.values(teamMap)
    .sort((a, b) => b.totalPoints - a.totalPoints)
          .map((t, i) => ({ rank: i + 1, ...t }));

        console.log(`[LEADERBOARD] Built leaderboards: ${teamLeaderboard.length} teams, ${individualLeaderboard.length} individuals`);

        // City leaderboard
  const cityMap = {};
        individual.forEach((u) => {
          const city = u.city || 'Unknown';
          if (!cityMap[city]) cityMap[city] = { city, points: 0, streak: 0 };
          cityMap[city].points += u.points;
          // Track highest streak in city
          if (u.streak > (cityMap[city].streak || 0)) {
            cityMap[city].streak = u.streak;
          }
  });
  const cityLeaderboard = Object.values(cityMap).sort((a, b) => b.points - a.points);

  return { teamLeaderboard, cityLeaderboard, individualLeaderboard };
      } catch (err) {
        console.error('[LEADERBOARD] Exception building leaderboards:', err);
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
    const { display_name, avatar_url, team_id, city, units, lat, lng, points, streak, badges } = req.body;
    
    // Get coordinates from city if lat/lng not provided
    let finalLat = lat;
    let finalLng = lng;
    if (!finalLat || !finalLng) {
      const coords = getCityCoordinates(city || '');
      finalLat = coords.lat;
      finalLng = coords.lng;
    }
    
    const profileRow = {
      id: user.id,
      display_name: display_name || user.user_metadata?.display_name || user.email.split('@')[0],
      avatar_url: avatar_url || null,
      team_id: team_id || null,
      city: city || null,
      units: units || 'km',
      lat: finalLat || null,
      lng: finalLng || null,
      points: points !== undefined ? points : 0,
      streak: streak !== undefined ? streak : 0,
      badges: badges || [],
      status: 'online',
      last_seen: new Date().toISOString()
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
app.post('/activities', async (req, res) => {
  // Accept either username (legacy) or user_id (supabase) in body
  const { username, user_id, type, distanceKm = 0, durationMinutes = 0, date = getToday() } = req.body;
  
  // If Supabase is configured, require user_id and authentication
  if (supabase) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    if (!token) return res.status(401).json({ error: 'Missing Bearer token' });
    
    try {
      const user = await getSupabaseUserFromToken(token);
      if (!user) return res.status(401).json({ error: 'Invalid token' });
      
      const activity = {
        user_id: user.id,
        type,
        distance_km: distanceKm,
        duration_minutes: durationMinutes,
        date,
      };
      const points = calculatePoints({ type, distanceKm, durationMinutes });
      activity.points_earned = points;

      // Save to database
      const { data: savedActivity, error: dbError } = await supabase
        .from('activities')
        .insert(activity)
        .select()
        .single();

      if (dbError) {
        console.error('Error saving activity to database:', dbError);
        // Fall back to in-memory if table doesn't exist
        activities.push({ ...activity, id: generateId('act'), pointsEarned: points });
        return res.json({ message: 'Activity logged (in-memory fallback)', activity: { ...activity, pointsEarned: points } });
      }

      // Update user's points and streak in profile
      const { data: profile } = await supabase.from('profiles').select('points, streak, last_activity_date').eq('id', user.id).single();
      if (profile) {
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        let newStreak = profile.streak || 0;
        if (profile.last_activity_date === date) {
          // Already logged today, streak unchanged
        } else if (profile.last_activity_date === yesterday) {
          newStreak += 1;
        } else {
          newStreak = 1;
        }
        
        await supabase.from('profiles').update({
          points: (profile.points || 0) + points,
          streak: newStreak,
          last_activity_date: date
        }).eq('id', user.id);
      }

      return res.json({ 
        message: 'Activity logged', 
        activity: {
          id: savedActivity.id,
          user_id: savedActivity.user_id,
          type: savedActivity.type,
          distanceKm: savedActivity.distance_km,
          durationMinutes: savedActivity.duration_minutes,
          pointsEarned: savedActivity.points_earned,
          date: savedActivity.date
        }
      });
    } catch (err) {
      console.error('Error in activities endpoint:', err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
  
  // Fallback: in-memory storage (legacy)
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
  res.json({ message: 'Activity logged', activity });
});

// Import Strava activity/activities to user's activities
app.post('/api/activities/import-strava', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured on server' });
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

  try {
    console.log('[IMPORT] Starting Strava activity import');
    const user = await getSupabaseUserFromToken(token);
    if (!user) {
      console.error('[IMPORT] Invalid token');
      return res.status(401).json({ error: 'Invalid token' });
    }

    console.log(`[IMPORT] User: ${user.id}`);
    const { stravaActivityIds, importAll = false } = req.body;
    console.log(`[IMPORT] Request: importAll=${importAll}, stravaActivityIds=${JSON.stringify(stravaActivityIds)}`);
    
    // Get user's Strava connection
    const userId = user.id;
    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      return res.status(400).json({ error: 'Strava not connected. Please connect your Strava account first.' });
    }

    let activitiesToImport = [];
    
    if (importAll) {
      // Fetch all Strava activities
      console.log(`[IMPORT] Importing all Strava activities for user ${userId}`);
      let page = 1;
      let hasMore = true;
      const allStravaActivities = [];
      
      while (hasMore && page <= 10) { // Limit to 10 pages (100 activities) to avoid rate limits
        try {
          const activities = await stravaApiRequest(
            `/athlete/activities?per_page=30&page=${page}`,
            accessToken
          );
          if (activities && activities.length > 0) {
            allStravaActivities.push(...activities);
            hasMore = activities.length === 30;
            page++;
          } else {
            hasMore = false;
          }
        } catch (err) {
          console.error(`[IMPORT] Error fetching page ${page}:`, err);
          hasMore = false;
        }
      }
      
      activitiesToImport = allStravaActivities;
      console.log(`[IMPORT] Found ${activitiesToImport.length} Strava activities to import`);
    } else if (stravaActivityIds && Array.isArray(stravaActivityIds) && stravaActivityIds.length > 0) {
      // Import specific activities by ID
      console.log(`[IMPORT] Importing ${stravaActivityIds.length} specific Strava activities`);
      for (const activityId of stravaActivityIds) {
        try {
          const activity = await stravaApiRequest(`/activities/${activityId}`, accessToken);
          if (activity) {
            activitiesToImport.push(activity);
          }
        } catch (err) {
          console.error(`[IMPORT] Error fetching activity ${activityId}:`, err);
        }
      }
    } else {
      return res.status(400).json({ error: 'stravaActivityIds array or importAll=true required' });
    }

    if (activitiesToImport.length === 0) {
      return res.json({ message: 'No activities to import', imported: 0, skipped: 0 });
    }

    // Convert Strava activities to our format and check for duplicates
    const imported = [];
    const skipped = [];
    
    for (const stravaActivity of activitiesToImport) {
      try {
        // Convert Strava activity type to our format
        let activityType = 'workout';
        if (stravaActivity.type === 'Run' || stravaActivity.type === 'TrailRun') {
          activityType = 'run';
        } else if (stravaActivity.type === 'Walk' || stravaActivity.type === 'Hike') {
          activityType = 'walk';
        } else if (stravaActivity.type === 'Ride' || stravaActivity.type === 'EBikeRide') {
          activityType = 'workout';
        }

        const distanceKm = (stravaActivity.distance || 0) / 1000; // Convert meters to km
        const durationMinutes = Math.round((stravaActivity.moving_time || stravaActivity.elapsed_time || 0) / 60);
        const activityDate = stravaActivity.start_date_local 
          ? stravaActivity.start_date_local.split('T')[0] 
          : new Date(stravaActivity.start_date * 1000).toISOString().split('T')[0];

        // Check if this activity already exists by Strava ID first, then by date+type+distance
        const { data: existingByStravaId } = await supabase
          .from('activities')
          .select('id')
          .eq('user_id', userId)
          .eq('strava_activity_id', stravaActivity.id)
          .limit(1)
          .single();
        
        if (existingByStravaId) {
          skipped.push({ id: stravaActivity.id, reason: 'Already imported' });
          continue;
        }
        
        // Also check by date and approximate distance to avoid duplicates
        const { data: existing } = await supabase
          .from('activities')
          .select('id')
          .eq('user_id', userId)
          .eq('date', activityDate)
          .eq('type', activityType)
          .gte('distance_km', distanceKm * 0.95) // Allow 5% variance
          .lte('distance_km', distanceKm * 1.05)
          .limit(1)
          .single();

        if (existing) {
          skipped.push({ id: stravaActivity.id, reason: 'Already imported' });
          continue;
        }

        // Create activity
        const activity = {
          user_id: userId,
          type: activityType,
          distance_km: distanceKm,
          duration_minutes: durationMinutes,
          date: activityDate,
          strava_activity_id: stravaActivity.id, // Store Strava ID to track imported activities
        };
        const points = calculatePoints({ type: activityType, distanceKm, durationMinutes });
        activity.points_earned = points;

        // Save to database
        console.log(`[IMPORT] Saving activity: ${JSON.stringify(activity)}`);
        const { data: savedActivity, error: dbError } = await supabase
          .from('activities')
          .insert(activity)
          .select()
          .single();

        if (dbError) {
          console.error(`[IMPORT] Error saving activity ${stravaActivity.id}:`, dbError);
          console.error(`[IMPORT] Full error details:`, JSON.stringify(dbError, null, 2));
          skipped.push({ id: stravaActivity.id, reason: dbError.message || String(dbError) });
          continue;
        }

        console.log(`[IMPORT] Successfully saved activity ${stravaActivity.id} as ${savedActivity.id}`);

        imported.push({
          stravaId: stravaActivity.id,
          activityId: savedActivity.id,
          date: activityDate,
          points
        });
      } catch (err) {
        console.error(`[IMPORT] Error processing activity ${stravaActivity.id}:`, err);
        skipped.push({ id: stravaActivity.id, reason: err.message });
      }
    }

    // Update user's points and streak in profile
    if (imported.length > 0) {
      const totalPoints = imported.reduce((sum, a) => sum + a.points, 0);
      console.log(`[IMPORT] Updating profile: ${totalPoints} total points from ${imported.length} activities`);
      const { data: profile, error: profileError } = await supabase.from('profiles').select('points, streak, last_activity_date').eq('id', userId).single();
      if (profileError) {
        console.error(`[IMPORT] Error fetching profile:`, profileError);
      }
      if (profile) {
        // Find the most recent activity date from imported activities
        const activityDates = imported.map(a => a.date).sort().reverse();
        const mostRecentDate = activityDates[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        
        let newStreak = profile.streak || 0;
        // Update streak based on most recent activity
        if (profile.last_activity_date === mostRecentDate) {
          // Already logged on this date, streak unchanged
        } else if (profile.last_activity_date === yesterday) {
          newStreak += 1;
        } else {
          // Check if activities are consecutive days
          const lastDate = profile.last_activity_date ? new Date(profile.last_activity_date) : null;
          const newDate = new Date(mostRecentDate);
          if (lastDate && (newDate - lastDate) === 86400000) {
            // Consecutive day
            newStreak += 1;
          } else {
            // Not consecutive, reset to 1
            newStreak = 1;
          }
        }
        
        // Update points and streak
        const { error: updateError } = await supabase.from('profiles').update({
          points: (profile.points || 0) + totalPoints,
          streak: newStreak,
          last_activity_date: mostRecentDate
        }).eq('id', userId);
        
        if (updateError) {
          console.error(`[IMPORT] Error updating profile:`, updateError);
        } else {
          console.log(`[IMPORT] Profile updated: points=${(profile.points || 0) + totalPoints}, streak=${newStreak}`);
        }
      } else {
        console.error(`[IMPORT] Profile not found for user ${userId}`);
      }
    } else {
      console.log(`[IMPORT] No activities imported, skipping profile update`);
    }

    console.log(`[IMPORT] Imported ${imported.length} activities, skipped ${skipped.length}`);
    res.json({
      message: `Imported ${imported.length} activities`,
      imported: imported.length,
      skipped: skipped.length,
      details: { imported, skipped: skipped.slice(0, 10) } // Limit skipped details
    });
  } catch (err) {
    console.error('[IMPORT] Exception importing Strava activities:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.get('/activities/:identifier', async (req, res) => {
  const identifier = req.params.identifier;
  
  // If Supabase is configured, fetch from database
  if (supabase) {
    try {
      console.log(`[ACTIVITIES GET] Fetching activities for identifier: ${identifier}`);
      
      // Try to fetch by user_id (UUID) first
      const { data: userActivities, error } = await supabase
        .from('activities')
        .select('*')
        .eq('user_id', identifier)
        .order('date', { ascending: false })
        .limit(100);
      
      if (error) {
        console.error('[ACTIVITIES GET] Error fetching activities:', error);
        // Fallback to in-memory
        const userActivities = activities.filter((activity) => 
          activity.username === identifier || activity.user_id === identifier
        );
        return res.json(userActivities);
      }
      
      console.log(`[ACTIVITIES GET] Found ${userActivities?.length || 0} activities`);
      
      // Transform database format to frontend format
      const transformed = (userActivities || []).map(a => ({
        id: a.id,
        user_id: a.user_id,
        type: a.type,
        distanceKm: a.distance_km,
        durationMinutes: a.duration_minutes,
        pointsEarned: a.points_earned,
        date: a.date
      }));
      
      return res.json(transformed);
    } catch (err) {
      console.error('[ACTIVITIES GET] Exception:', err);
      return res.status(500).json({ error: err.message || String(err) });
    }
  }
  
  // Fallback: in-memory storage
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
        // Fetch activities from database
        const { data: dbActivities, error: activitiesError } = await supabase
          .from('activities')
          .select('*')
          .order('date', { ascending: false })
          .limit(500);
        
        if (activitiesError) {
          console.error('Error fetching activities for map:', activitiesError);
          // Fallback to in-memory
        } else if (dbActivities && dbActivities.length > 0) {
          // Fetch profiles for location data
          const { data: profiles } = await supabase.from('profiles').select('*');
          const profileById = {};
          (profiles || []).forEach((p) => { profileById[p.id] = p; });

          const mapPoints = dbActivities.map((activity, index) => {
            const uid = activity.user_id;
            const profile = profileById[uid];
            const coords = profile ? getCityCoordinates(profile.city || 'Unknown') : { lat: 39.9526, lng: -75.1652 };
    return {
              id: activity.id || `map-${index}`,
              userId: uid,
              username: profile?.display_name || uid,
              lat: profile?.lat || coords.lat + (Math.random() - 0.5) * 0.01,
              lng: profile?.lng || coords.lng + (Math.random() - 0.5) * 0.01,
              intensity: activity.points_earned || 1,
      type: activity.type,
      date: activity.date,
    };
  });

          return res.json({ mapPoints });
        }
      } catch (err) {
        console.error('Error building activity map from Supabase:', err);
      }
    }

    // Fallback: return empty map or based on minimal activities (in-memory)
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
  const redirectUri = encodeURIComponent(process.env.STRAVA_REDIRECT_URI || 'https://nets2130.vercel.app/api/strava/callback');
  const scope = 'read,activity:read_all';
  const authUrl = `https://www.strava.com/oauth/authorize?client_id=${process.env.STRAVA_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}`;

  res.json({ authUrl, state });
  })();
});

// GET /api/strava/callback - Handle OAuth callback
app.get('/api/strava/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`https://nets2130.vercel.app?strava_error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return res.redirect(`https://nets2130.vercel.app?strava_error=${encodeURIComponent('Missing authorization code or state')}`);
  }

  // Validate state to prevent CSRF
  const stateData = oauthStates.get(state);
  if (!stateData) {
    return res.redirect(`https://nets2130.vercel.app?strava_error=${encodeURIComponent('Invalid state parameter')}`);
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
    const redirectBase = 'https://nets2130.vercel.app';
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
    res.redirect(`https://nets2130.vercel.app?strava_error=${encodeURIComponent(error.message)}`);
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
  const { username, userId, per_page = 30, page = 1, excludeImported = false } = req.query;
  const id = userId || username;
  if (!id) return res.status(400).json({ error: 'username or userId required' });

  try {
    const accessToken = await getValidAccessToken(id);
    let activities = await stravaApiRequest(
      `/athlete/activities?per_page=${per_page}&page=${page}`,
      accessToken
    );
    
    // If excludeImported is true and we have Supabase, filter out already imported activities
    if (excludeImported === 'true' && supabase && userId) {
      try {
        // Get all imported Strava activity IDs for this user
        const { data: importedActivities } = await supabase
          .from('activities')
          .select('strava_activity_id')
          .eq('user_id', userId)
          .not('strava_activity_id', 'is', null);
        
        if (importedActivities && importedActivities.length > 0) {
          const importedIds = new Set(importedActivities.map(a => String(a.strava_activity_id)));
          activities = activities.filter(activity => !importedIds.has(String(activity.id)));
        }
      } catch (err) {
        console.error('[STRAVA] Error filtering imported activities:', err);
        // Continue without filtering if there's an error
      }
    }
    
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
 * Friends endpoints
 **********************/

// Send a friend request
app.post('/api/friends/request', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured on server' });
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

  try {
    const user = await getSupabaseUserFromToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });

    const { receiver_id } = req.body;
    if (!receiver_id) return res.status(400).json({ error: 'receiver_id required' });
    if (receiver_id === user.id) return res.status(400).json({ error: 'Cannot send friend request to yourself' });

    // Check if request already exists (either direction)
    const { data: existingRequests } = await supabase
      .from('friend_requests')
      .select('*')
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`);

    const existing = existingRequests?.find(req => 
      (req.sender_id === user.id && req.receiver_id === receiver_id) ||
      (req.sender_id === receiver_id && req.receiver_id === user.id)
    );

    if (existing) {
      if (existing.status === 'pending') {
        return res.status(400).json({ error: 'Friend request already exists' });
      }
      if (existing.status === 'accepted') {
        return res.status(400).json({ error: 'Already friends' });
      }
    }

    // Check if already friends
    const user1_id = user.id < receiver_id ? user.id : receiver_id;
    const user2_id = user.id < receiver_id ? receiver_id : user.id;
    
    const { data: friendship } = await supabase
      .from('friendships')
      .select('*')
      .eq('user1_id', user1_id)
      .eq('user2_id', user2_id)
      .single();

    if (friendship) {
      return res.status(400).json({ error: 'Already friends' });
    }

    // Create friend request
    const { data, error } = await supabase
      .from('friend_requests')
      .insert({
        sender_id: user.id,
        receiver_id: receiver_id,
        status: 'pending'
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message || error });
    res.json({ message: 'Friend request sent', request: data });
  } catch (err) {
    console.error('Error sending friend request', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Accept or reject a friend request
app.post('/api/friends/respond', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured on server' });
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

  try {
    const user = await getSupabaseUserFromToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });

    const { request_id, action } = req.body; // action: 'accept' or 'reject'
    if (!request_id || !action) return res.status(400).json({ error: 'request_id and action required' });
    if (!['accept', 'reject'].includes(action)) return res.status(400).json({ error: 'action must be "accept" or "reject"' });

    // Get the friend request
    const { data: request, error: fetchError } = await supabase
      .from('friend_requests')
      .select('*')
      .eq('id', request_id)
      .eq('receiver_id', user.id)
      .eq('status', 'pending')
      .single();

    if (fetchError || !request) {
      return res.status(404).json({ error: 'Friend request not found' });
    }

    if (action === 'accept') {
      // Create friendship (ensure user1_id < user2_id)
      const user1_id = request.sender_id < request.receiver_id ? request.sender_id : request.receiver_id;
      const user2_id = request.sender_id < request.receiver_id ? request.receiver_id : request.sender_id;

      const { error: friendshipError } = await supabase
        .from('friendships')
        .insert({
          user1_id: user1_id,
          user2_id: user2_id
        });

      if (friendshipError) {
        return res.status(500).json({ error: friendshipError.message || friendshipError });
      }
    }

    // Update request status
    const { data: updated, error: updateError } = await supabase
      .from('friend_requests')
      .update({ status: action === 'accept' ? 'accepted' : 'rejected' })
      .eq('id', request_id)
      .select()
      .single();

    if (updateError) return res.status(500).json({ error: updateError.message || updateError });

    res.json({ message: `Friend request ${action}ed`, request: updated });
  } catch (err) {
    console.error('Error responding to friend request', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Get friend requests (sent and received)
app.get('/api/friends/requests', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured on server' });
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

  try {
    const user = await getSupabaseUserFromToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });

    // Get sent requests
    const { data: sentRequestsData } = await supabase
      .from('friend_requests')
      .select('*')
      .eq('sender_id', user.id)
      .eq('status', 'pending');

    // Get received requests
    const { data: receivedRequestsData } = await supabase
      .from('friend_requests')
      .select('*')
      .eq('receiver_id', user.id)
      .eq('status', 'pending');

    // Fetch profile data for senders and receivers
    const sentRequests = await Promise.all((sentRequestsData || []).map(async (req) => {
      const { data: receiver } = await supabase.from('profiles').select('display_name, id').eq('id', req.receiver_id).single();
      return { ...req, receiver: receiver || { id: req.receiver_id } };
    }));

    const receivedRequests = await Promise.all((receivedRequestsData || []).map(async (req) => {
      const { data: sender } = await supabase.from('profiles').select('display_name, id').eq('id', req.sender_id).single();
      return { ...req, sender: sender || { id: req.sender_id } };
    }));

    res.json({
      sent: sentRequests,
      received: receivedRequests
    });
  } catch (err) {
    console.error('Error fetching friend requests', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Debug endpoint to list all profiles (for testing)
app.get('/api/profiles/debug', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured on server' });
  try {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, display_name, city, created_at')
      .limit(50);
    
    if (error) {
      return res.status(500).json({ error: error.message || error });
    }
    
    res.json({ 
      count: profiles?.length || 0,
      profiles: profiles || []
    });
  } catch (err) {
    console.error('Error in debug endpoint:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Search profiles by username/display_name
app.get('/api/profiles/search', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured on server' });
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

  try {
    const user = await getSupabaseUserFromToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });

    const { q } = req.query;
    if (!q || q.trim().length === 0) {
      return res.json({ profiles: [] });
    }

    const searchTerm = q.trim();
    console.log(`[SEARCH] User ${user.id} searching for profiles with display_name containing: "${searchTerm}"`);

    // Use service role client to bypass RLS - search all profiles
    // First, get all profiles to see what we have
    const { data: allProfiles, error: allError } = await supabase
      .from('profiles')
      .select('id, display_name, city')
      .limit(100);
    
    if (allError) {
      console.error('[SEARCH] Error fetching all profiles:', allError);
    } else {
      console.log(`[SEARCH] Total profiles in DB: ${allProfiles?.length || 0}`);
      if (allProfiles && allProfiles.length > 0) {
        console.log('[SEARCH] Sample profiles:', allProfiles.slice(0, 5).map(p => ({ id: p.id, name: p.display_name })));
      }
    }

    // Search profiles by display_name (case-insensitive)
    // Use service role to bypass RLS - this should work
    let profiles = [];
    let error = null;
    
    // Primary search query - use ilike for case-insensitive search
    const searchQuery = supabase
      .from('profiles')
      .select('id, display_name, city')
      .ilike('display_name', `%${searchTerm}%`)
      .limit(50);
    
    const result = await searchQuery;
    error = result.error;
    profiles = result.data || [];
    
    if (error) {
      console.error('[SEARCH] Error in search query:', error);
      // Try a simpler query as fallback
      const fallbackQuery = supabase
        .from('profiles')
        .select('id, display_name, city')
        .limit(50);
      const fallbackResult = await fallbackQuery;
      if (!fallbackResult.error && fallbackResult.data) {
        // Filter in JavaScript as fallback
        profiles = fallbackResult.data.filter(p => 
          p.display_name && 
          p.display_name.toLowerCase().includes(searchTerm.toLowerCase())
        );
        error = null;
        console.log(`[SEARCH] Fallback search found ${profiles.length} profiles`);
      }
    }

    // Try to get lat/lng if columns exist (optional)
    if (!error && profiles.length > 0) {
      try {
        const { data: profilesWithCoords } = await supabase
          .from('profiles')
          .select('id, lat, lng')
          .in('id', profiles.map(p => p.id));
        
        if (profilesWithCoords) {
          const coordsMap = new Map(profilesWithCoords.map(p => [p.id, { lat: p.lat, lng: p.lng }]));
          profiles = profiles.map(p => ({ ...p, ...coordsMap.get(p.id) }));
        }
      } catch (e) {
        // lat/lng columns don't exist, that's okay
        console.log('[SEARCH] lat/lng columns not available');
      }
    }

    if (error) {
      console.error('[SEARCH] Final error:', error);
      return res.status(500).json({ error: error.message || String(error) });
    }

    // Filter out current user and ensure display_name exists
    const filtered = (profiles || []).filter(p => {
      const isValid = p.id !== user.id && 
                      p.display_name && 
                      p.display_name.trim().length > 0;
      if (!isValid && p.id === user.id) {
        console.log(`[SEARCH] Filtered out current user: ${p.display_name}`);
      }
      return isValid;
    });

    console.log(`[SEARCH] Found ${profiles?.length || 0} total profiles, ${filtered.length} after filtering`);
    if (filtered.length > 0) {
      console.log('[SEARCH] Returning profiles:', filtered.slice(0, 3).map(p => ({ id: p.id, display_name: p.display_name })));
    }

    res.json({ profiles: filtered });
  } catch (err) {
    console.error('[SEARCH] Exception in profile search:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Get friends list
app.get('/api/friends', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured on server' });
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

  try {
    const user = await getSupabaseUserFromToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });

    // Get friendships where user is either user1 or user2
    const { data: friendships } = await supabase
      .from('friendships')
      .select('*')
      .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`);

    // Fetch profile data and transform to friend list
    const friends = await Promise.all((friendships || []).map(async (friendship) => {
      const friendId = friendship.user1_id === user.id ? friendship.user2_id : friendship.user1_id;
      const { data: friendProfile } = await supabase
        .from('profiles')
        .select('display_name, id, city, avatar_url')
        .eq('id', friendId)
        .single();
      
      return {
        id: friendProfile?.id || friendId,
        display_name: friendProfile?.display_name || friendId,
        city: friendProfile?.city || null,
        avatar_url: friendProfile?.avatar_url || null,
        friendship_id: friendship.id,
        created_at: friendship.created_at
      };
    }));

    res.json({ friends });
  } catch (err) {
    console.error('Error fetching friends', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Remove a friend
app.delete('/api/friends/:friendship_id', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured on server' });
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

  try {
    const user = await getSupabaseUserFromToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });

    const { friendship_id } = req.params;

    // Verify user is part of this friendship
    const { data: friendship } = await supabase
      .from('friendships')
      .select('*')
      .eq('id', friendship_id)
      .single();

    if (friendship && friendship.user1_id !== user.id && friendship.user2_id !== user.id) {
      return res.status(403).json({ error: 'Not authorized to remove this friendship' });
    }

    if (!friendship) {
      return res.status(404).json({ error: 'Friendship not found' });
    }

    // Delete friendship
    const { error } = await supabase
      .from('friendships')
      .delete()
      .eq('id', friendship_id);

    if (error) return res.status(500).json({ error: error.message || error });

    res.json({ message: 'Friend removed' });
  } catch (err) {
    console.error('Error removing friend', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

/**********************
 * Teams endpoints
 **********************/

// Create a team
app.post('/api/teams', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured on server' });
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

  try {
    const user = await getSupabaseUserFromToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });

    const { name, description, city } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    console.log(`[TEAMS CREATE] User ${user.id} creating team "${name}"`);

    // Create team
    const { data: team, error: teamError } = await supabase
      .from('teams')
      .insert({
        name: name,
        description: description || null,
        city: city || null,
        created_by: user.id
      })
      .select()
      .single();

    if (teamError) {
      console.error('[TEAMS CREATE] Error creating team:', teamError);
      return res.status(500).json({ error: teamError.message || teamError });
    }

    console.log(`[TEAMS CREATE] Team created with ID: ${team.id}`);

    // Add creator as team owner
    const { data: member, error: memberError } = await supabase
      .from('team_members')
      .insert({
        team_id: team.id,
        user_id: user.id,
        role: 'owner'
      })
      .select()
      .single();

    if (memberError) {
      console.error('[TEAMS CREATE] Error adding owner as member:', memberError);
      // Rollback team creation if member insert fails
      await supabase.from('teams').delete().eq('id', team.id);
      return res.status(500).json({ error: memberError.message || memberError });
    }

    console.log(`[TEAMS CREATE] Owner added as member: ${member.id}`);

    // Fetch the complete team with creator and members
    const { data: creator } = await supabase.from('profiles').select('display_name, id').eq('id', user.id).single();
    const teamWithDetails = {
      ...team,
      creator: creator || { id: user.id, display_name: 'Unknown' },
      members: [{
        user_id: user.id,
        role: 'owner',
        profile: creator || { id: user.id, display_name: 'Unknown' }
      }]
    };

    res.json({ message: 'Team created', team: teamWithDetails });
  } catch (err) {
    console.error('[TEAMS CREATE] Exception:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Get all teams
app.get('/api/teams', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured on server' });

  try {
    // Fetch teams
    const { data: teamsData, error: teamsError } = await supabase
      .from('teams')
      .select('*')
      .order('created_at', { ascending: false });

    if (teamsError) {
      console.error('[TEAMS] Error fetching teams:', teamsError);
      return res.status(500).json({ error: teamsError.message || teamsError });
    }

    if (!teamsData || teamsData.length === 0) {
      return res.json({ teams: [] });
    }

    // Fetch members for all teams
    const teamIds = teamsData.map(t => t.id);
    const { data: membersData, error: membersError } = await supabase
      .from('team_members')
      .select('team_id, user_id, role')
      .in('team_id', teamIds);

    if (membersError) {
      console.error('[TEAMS] Error fetching members:', membersError);
      // Continue without members rather than failing completely
    }

    // Group members by team_id
    const membersByTeam = {};
    (membersData || []).forEach(member => {
      if (!membersByTeam[member.team_id]) {
        membersByTeam[member.team_id] = [];
      }
      membersByTeam[member.team_id].push(member);
    });

    // Fetch creator profiles and member profiles
    const creatorIds = [...new Set(teamsData.map(t => t.created_by))];
    const memberUserIds = [...new Set((membersData || []).map(m => m.user_id))];
    const allUserIds = [...new Set([...creatorIds, ...memberUserIds])];

    const { data: profilesData, error: profilesError } = await supabase
      .from('profiles')
      .select('id, display_name, city')
      .in('id', allUserIds);

    if (profilesError) {
      console.error('[TEAMS] Error fetching profiles:', profilesError);
    }

    // Create profile lookup map
    const profileMap = {};
    (profilesData || []).forEach(profile => {
      profileMap[profile.id] = profile;
    });

    // Build teams with creator and members
    const teams = teamsData.map(team => {
      const creator = profileMap[team.created_by] || { id: team.created_by, display_name: 'Unknown' };
      const members = (membersByTeam[team.id] || []).map(member => ({
        user_id: member.user_id,
        role: member.role,
        profile: profileMap[member.user_id] || { id: member.user_id, display_name: 'Unknown' }
      }));

      return {
        ...team,
        creator,
        members
      };
    });

    console.log(`[TEAMS] Returning ${teams.length} teams`);
    res.json({ teams });
  } catch (err) {
    console.error('[TEAMS] Exception fetching teams:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Get a specific team
app.get('/api/teams/:team_id', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured on server' });

  try {
    const { team_id } = req.params;

    const { data: teamData, error } = await supabase
      .from('teams')
      .select('*')
      .eq('id', team_id)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Team not found' });
      return res.status(500).json({ error: error.message || error });
    }

    // Fetch creator and members
    const { data: creator } = await supabase.from('profiles').select('display_name, id').eq('id', teamData.created_by).single();
    const { data: membersData } = await supabase.from('team_members').select('user_id, role').eq('team_id', team_id);
    const members = await Promise.all((membersData || []).map(async (member) => {
      const { data: profile } = await supabase.from('profiles').select('display_name, id, city').eq('id', member.user_id).single();
      return { ...member, profile: profile || { id: member.user_id } };
    }));
    
    const team = { ...teamData, creator: creator || { id: teamData.created_by }, members };

    res.json({ team });
  } catch (err) {
    console.error('Error fetching team', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Join a team
app.post('/api/teams/:team_id/join', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured on server' });
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

  try {
    const user = await getSupabaseUserFromToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });

    const { team_id } = req.params;

    // Check if team exists
    const { data: team } = await supabase.from('teams').select('*').eq('id', team_id).single();
    if (!team) return res.status(404).json({ error: 'Team not found' });

    // Check if already a member
    const { data: existing } = await supabase
      .from('team_members')
      .select('*')
      .eq('team_id', team_id)
      .eq('user_id', user.id)
      .single();

    if (existing) return res.status(400).json({ error: 'Already a member of this team' });

    // Add member
    const { data: member, error } = await supabase
      .from('team_members')
      .insert({
        team_id: team_id,
        user_id: user.id,
        role: 'member'
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message || error });

    res.json({ message: 'Joined team', member });
  } catch (err) {
    console.error('Error joining team', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Leave a team
app.post('/api/teams/:team_id/leave', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured on server' });
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

  try {
    const user = await getSupabaseUserFromToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });

    const { team_id } = req.params;

    // Check if member
    const { data: member } = await supabase
      .from('team_members')
      .select('*')
      .eq('team_id', team_id)
      .eq('user_id', user.id)
      .single();

    if (!member) return res.status(404).json({ error: 'Not a member of this team' });

    // Owners cannot leave (they must delete the team or transfer ownership)
    if (member.role === 'owner') {
      return res.status(400).json({ error: 'Team owners cannot leave. Delete the team or transfer ownership first.' });
    }

    // Remove member
    const { error } = await supabase
      .from('team_members')
      .delete()
      .eq('team_id', team_id)
      .eq('user_id', user.id);

    if (error) return res.status(500).json({ error: error.message || error });

    res.json({ message: 'Left team' });
  } catch (err) {
    console.error('Error leaving team', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Update team (only owner/admin)
app.put('/api/teams/:team_id', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured on server' });
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

  try {
    const user = await getSupabaseUserFromToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });

    const { team_id } = req.params;
    const { name, description, city } = req.body;

    // Check if user is owner or admin
    const { data: member } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', team_id)
      .eq('user_id', user.id)
      .single();

    if (!member || !['owner', 'admin'].includes(member.role)) {
      return res.status(403).json({ error: 'Only team owners and admins can update the team' });
    }

    // Update team
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (city !== undefined) updates.city = city;

    const { data: team, error } = await supabase
      .from('teams')
      .update(updates)
      .eq('id', team_id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message || error });

    res.json({ message: 'Team updated', team });
  } catch (err) {
    console.error('Error updating team', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Delete team (only owner)
app.delete('/api/teams/:team_id', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured on server' });
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

  try {
    const user = await getSupabaseUserFromToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid token' });

    const { team_id } = req.params;

    // Check if user is owner
    const { data: member } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', team_id)
      .eq('user_id', user.id)
      .single();

    if (!member || member.role !== 'owner') {
      return res.status(403).json({ error: 'Only team owners can delete the team' });
    }

    // Delete team (cascade will delete team_members)
    const { error } = await supabase
      .from('teams')
      .delete()
      .eq('id', team_id);

    if (error) return res.status(500).json({ error: error.message || error });

    res.json({ message: 'Team deleted' });
  } catch (err) {
    console.error('Error deleting team', err);
    res.status(500).json({ error: err.message || String(err) });
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
