import React from 'react';
import { Link } from 'react-router-dom';

function Navbar({ user, onLogActivityClick }) {
  const streak = user?.streak || 3; // Dummy data for now

  return (
    <nav className="navbar">
      <div className="navbar-left">
        <h1 className="navbar-logo">Kinnect</h1>
      </div>
      <div className="navbar-center">
        <Link to="/" className="nav-link">Dashboard</Link>
        <Link to="/activity" className="nav-link">Activity</Link>
        <Link to="/leaderboards" className="nav-link">Leaderboards</Link>
        <Link to="/profile" className="nav-link">Profile</Link>
      </div>
      <div className="navbar-right">
        <div className="streak-chip">
          🔥 {streak}-day streak
        </div>
        <button className="btn-primary" onClick={onLogActivityClick}>
          + Log Activity
        </button>
      </div>
    </nav>
  );
}

export default Navbar;

