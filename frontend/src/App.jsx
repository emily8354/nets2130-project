import React, { useState, useEffect } from 'react';
import './App.css';

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

function ActivityMap({ mapPoints }) {
  return (
    <div className="card">
      <h3>Live Activity Map</h3>
      <p className="small">Mock heatmap of today's global contributions.</p>
      <div className="map">
        {mapPoints.map((point) => (
          <div key={point.id} className="map-dot" style={{ left: `${point.lng + 75}%`, top: `${50 - point.lat}%` }}>
            <span>{point.username}</span>
            <small>{point.type} · {point.intensity} pts</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function Rewards({ user, catalog, onRedeem }) {
  const redeem = async (rewardId) => {
    const response = await fetch(`${API_BASE}/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, rewardId }),
    });
    const payload = await response.json();
    onRedeem(payload);
  };

  return (
    <div className="card">
      <h3>Rewards</h3>
      <p>Points: {user.points} · Streak: {user.streak} days</p>
      <ul>
        {catalog.map((reward) => {
          const unlocked = user.points >= reward.requiredPoints;
          const claimed = user.rewards.includes(reward.name);
          return (
            <li key={reward.id}>
              <strong>{reward.name}</strong> — {reward.requiredPoints} pts
              <button disabled={!unlocked} onClick={() => redeem(reward.id)}>
                {claimed ? 'Claimed' : unlocked ? 'Redeem' : 'Locked'}
              </button>
            </li>
          );
        })}
      </ul>
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
      body: JSON.stringify({ username, password, city: 'New York', teamName: 'NYC Hustlers' }),
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
      <h3>Kinnect Login</h3>
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
  const [rewardsCatalog, setRewardsCatalog] = useState([]);

  useEffect(() => {
    fetch(`${API_BASE}/leaderboard`).then((res) => res.json()).then(setLeaderboard);
    fetch(`${API_BASE}/activity-map`).then((res) => res.json()).then((data) => setMapPoints(data.mapPoints));
    fetch(`${API_BASE}/rewards`).then((res) => res.json()).then((data) => setRewardsCatalog(data.catalog));
  }, []);

  const refreshData = () => {
    fetch(`${API_BASE}/leaderboard`).then((res) => res.json()).then(setLeaderboard);
    fetch(`${API_BASE}/activity-map`).then((res) => res.json()).then((data) => setMapPoints(data.mapPoints));
  };

  if (!user) {
    return (
      <main className="layout">
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

  const handleRedeem = () => {
    refreshData();
    fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, password: user.password }),
    })
      .then((res) => res.json())
      .then((data) => setUser(data.user));
  };

  return (
    <main className="layout">
      <header>
        <h1>Kinnect Dashboard</h1>
        <p>Welcome back, {user.username}! Keep the streak alive.</p>
      </header>
      <section className="grid">
        <ActivityForm user={user} onLogged={handleActivityLogged} />
        <Leaderboard data={leaderboard} />
        <ActivityMap mapPoints={mapPoints} />
        <Rewards user={user} catalog={rewardsCatalog} onRedeem={handleRedeem} />
      </section>
    </main>
  );
}