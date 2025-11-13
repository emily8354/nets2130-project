// Kinnect prototype backend demonstrating core workflow
// Node.js + Express with in-memory storage for clarity

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

/**********************
 * In-memory mock data
 **********************/
// Users are keyed by username for quick lookup
// Stored information includes credentials (plain text for demo only!), points, streaks, teams, and location
const users = {
  alice: {
    username: 'alice',
    password: 'pass123',
    city: 'New York',
    teamId: 'team-nyc',
    points: 120,
    streak: 3,
    lastActivityDate: '2024-05-09',
  },
};

// Teams hold aggregated totals derived from their members' activities
const teams = {
  'team-nyc': {
    id: 'team-nyc',
    name: 'NYC Hustlers',
    city: 'New York',
    totalPoints: 320,
    totalActivities: 15,
  },
};

// Activities log each action performed by a user
// In a real database we would store timestamps, metadata, etc.
const activities = [
  {
    id: 'act-1',
    username: 'alice',
    type: 'run',
    distanceKm: 5,
    durationMinutes: 30,
    pointsEarned: 50,
    date: '2024-05-09',
  },
];

/**********************
 * Helper functions
 **********************/
const generateId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

const getToday = () => new Date().toISOString().slice(0, 10);

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
  const teamLeaderboard = Object.values(teams)
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .map((team, index) => ({ rank: index + 1, ...team }));

  const cityMap = {};
  Object.values(users).forEach((user) => {
    if (!cityMap[user.city]) {
      cityMap[user.city] = { city: user.city, points: 0, streak: 0 };
    }
    cityMap[user.city].points += user.points;
    cityMap[user.city].streak = Math.max(cityMap[user.city].streak, user.streak);
  });
  const cityLeaderboard = Object.values(cityMap).sort((a, b) => b.points - a.points);

  const individualLeaderboard = Object.values(users)
    .sort((a, b) => b.points - a.points)
    .map((user, index) => ({ rank: index + 1, username: user.username, points: user.points, streak: user.streak }));

  return { teamLeaderboard, cityLeaderboard, individualLeaderboard };
}

/**********************
 * Auth endpoints (mocked)
 **********************/
app.post('/signup', (req, res) => {
  const { username, password, city, teamName } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }
  if (users[username]) {
    return res.status(409).json({ error: 'User already exists' });
  }

  const teamId = Object.keys(teams).find((id) => teams[id].name === teamName) || generateId('team');
  if (!teams[teamId]) {
    teams[teamId] = { id: teamId, name: teamName || 'Solo Adventurers', city: city || 'Unknown', totalPoints: 0, totalActivities: 0 };
  }

  users[username] = {
    username,
    password,
    city: city || 'Unknown',
    teamId,
    points: 0,
    streak: 0,
    lastActivityDate: null,
  };

  updateTeamProgress(teamId);

  res.json({ message: 'Signup successful', user: users[username] });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = users[username];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({ message: 'Login successful', user });
});

/**********************
 * Activity workflow
 **********************/
app.post('/activities', (req, res) => {
  const { username, type, distanceKm = 0, durationMinutes = 0, date = getToday() } = req.body;
  const user = users[username];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const activity = {
    id: generateId('act'),
    username,
    type,
    distanceKm,
    durationMinutes,
    date,
  };
  const points = calculatePoints(activity);
  activity.pointsEarned = points;

  activities.push(activity);
  updateUserProgress(user, points, date);
  updateTeamProgress(user.teamId);

  res.json({ message: 'Activity logged', activity, user });
});

app.get('/activities/:username', (req, res) => {
  const userActivities = activities.filter((activity) => activity.username === req.params.username);
  res.json(userActivities);
});

/**********************
 * Leaderboards & dashboard
 **********************/
app.get('/leaderboard', (req, res) => {
  res.json(getLeaderboards());
});

app.get('/activity-map', (req, res) => {
  // Mocked geo data for a heatmap or activity map
  const mapPoints = activities.map((activity, index) => ({
    id: `map-${index}`,
    username: activity.username,
    lat: 40.7 + Math.random() * 0.1,
    lng: -74 + Math.random() * 0.1,
    intensity: activity.pointsEarned,
    type: activity.type,
  }));
  res.json({ mapPoints });
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
