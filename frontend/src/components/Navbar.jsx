import React from 'react';
import { NavLink, Link } from 'react-router-dom';

function Navbar({ user, onLogActivityClick }) {
  const streak = user?.streak || 3; // Dummy data for now

  return (
    <nav className="navbar">
      <div className="navbar-left">
        <Link to="/" className="navbar-left-link" aria-label="Kinnect home">
          <img src="/no-bg-KinnectApp.png" alt="Kinnect" className="app-icon" />
          <h1 className="navbar-logo">Kinnect</h1>
        </Link>
      </div>
      <div className="navbar-center">
        <NavLink to="/" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Dashboard</NavLink>
        <NavLink to="/leaderboards" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Leaderboards</NavLink>
        <NavLink to="/friends" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Friends</NavLink>
        <NavLink to="/teams" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Teams</NavLink>
        <NavLink to="/profile" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Profile</NavLink>
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

