import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const API_BASE = 'http://localhost:4000';

export default function Teams({ user }) {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '', city: '' });
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [myTeams, setMyTeams] = useState([]);

  const getAuthHeaders = async () => {
    const headers = { 'Content-Type': 'application/json' };
    try {
      const { data: { session } = {} } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch (err) {
      console.error('Error getting session:', err);
    }
    return headers;
  };

  const loadTeams = async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/teams`, { headers });
      if (res.ok) {
        const data = await res.json();
        const allTeams = data.teams || [];
        console.log('[FRONTEND TEAMS] Loaded teams:', allTeams.length);
        console.log('[FRONTEND TEAMS] Current user ID:', user?.id);
        console.log('[FRONTEND TEAMS] Sample team members:', allTeams[0]?.members);
        
        setTeams(allTeams);
        
        // Find teams user is a member of
        const userTeams = allTeams.filter(team => {
          const isMember = team.members?.some(member => {
            const matches = member.user_id === user?.id;
            if (matches) {
              console.log(`[FRONTEND TEAMS] User is member of team "${team.name}"`);
            }
            return matches;
          });
          return isMember;
        });
        
        console.log('[FRONTEND TEAMS] User teams:', userTeams.length);
        setMyTeams(userTeams);
      } else {
        const errorData = await res.json().catch(() => ({}));
        console.error('[FRONTEND TEAMS] Error response:', res.status, errorData);
        alert(`Failed to load teams: ${errorData.error || res.statusText}`);
      }
    } catch (err) {
      console.error('[FRONTEND TEAMS] Exception loading teams:', err);
      alert('Error loading teams. Check console for details.');
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await loadTeams();
      setLoading(false);
    };
    if (user) loadData();
  }, [user]);

  const handleCreateTeam = async (e) => {
    e.preventDefault();
    if (!createForm.name.trim()) {
      alert('Team name is required');
      return;
    }

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/teams`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: createForm.name,
          description: createForm.description || null,
          city: createForm.city || null
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert('Team created successfully!');
        setShowCreateForm(false);
        setCreateForm({ name: '', description: '', city: '' });
        await loadTeams();
      } else {
        alert(data.error || 'Failed to create team');
      }
    } catch (err) {
      console.error('Error creating team:', err);
      alert('Error creating team');
    }
  };

  const handleJoinTeam = async (teamId) => {
    try {
      console.log(`[FRONTEND TEAMS] Joining team ${teamId}`);
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/teams/${teamId}/join`, {
        method: 'POST',
        headers
      });
      const data = await res.json();
      console.log(`[FRONTEND TEAMS] Join response:`, res.status, data);
      if (res.ok) {
        alert('Joined team!');
        await loadTeams();
      } else {
        alert(data.error || 'Failed to join team');
      }
    } catch (err) {
      console.error('[FRONTEND TEAMS] Exception joining team:', err);
      alert(`Error joining team: ${err.message}`);
    }
  };

  const handleLeaveTeam = async (teamId) => {
    if (!confirm('Leave this team?')) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/teams/${teamId}/leave`, {
        method: 'POST',
        headers
      });
      const data = await res.json();
      if (res.ok) {
        alert('Left team');
        await loadTeams();
      } else {
        alert(data.error || 'Failed to leave team');
      }
    } catch (err) {
      console.error('Error leaving team:', err);
      alert('Error leaving team');
    }
  };

  const handleDeleteTeam = async (teamId) => {
    if (!confirm('Delete this team? This action cannot be undone.')) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/teams/${teamId}`, {
        method: 'DELETE',
        headers
      });
      const data = await res.json();
      if (res.ok) {
        alert('Team deleted');
        await loadTeams();
        setSelectedTeam(null);
      } else {
        alert(data.error || 'Failed to delete team');
      }
    } catch (err) {
      console.error('Error deleting team:', err);
      alert('Error deleting team');
    }
  };

  const loadTeamDetails = async (teamId) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/teams/${teamId}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setSelectedTeam(data.team);
      }
    } catch (err) {
      console.error('Error loading team details:', err);
    }
  };

  const isMember = (team) => {
    return team.members?.some(member => member.user_id === user?.id);
  };

  const isOwner = (team) => {
    return team.members?.some(member => member.user_id === user?.id && member.role === 'owner');
  };

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>;
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2>Teams</h2>
        <button onClick={() => setShowCreateForm(!showCreateForm)} className="btn-primary">
          {showCreateForm ? 'Cancel' : 'Create Team'}
        </button>
      </div>

      {/* Create team form */}
      {showCreateForm && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3>Create New Team</h3>
          <form onSubmit={handleCreateTeam}>
            <div style={{ marginBottom: '1rem' }}>
              <label>
                Team Name <span style={{ color: 'red' }}>*</span>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  required
                  style={{ width: '100%', padding: '0.5rem', marginTop: '0.25rem' }}
                />
              </label>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label>
                Description
                <textarea
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem', marginTop: '0.25rem', minHeight: '80px' }}
                />
              </label>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label>
                City
                <input
                  type="text"
                  value={createForm.city}
                  onChange={(e) => setCreateForm({ ...createForm, city: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem', marginTop: '0.25rem' }}
                />
              </label>
            </div>
            <button type="submit" className="btn-primary">Create Team</button>
          </form>
        </div>
      )}

      {/* My Teams */}
      {myTeams.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3>My Teams ({myTeams.length})</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {myTeams.map((team) => (
              <li
                key={team.id}
                style={{
                  padding: '1rem',
                  borderBottom: '1px solid #eee',
                  cursor: 'pointer'
                }}
                onClick={() => loadTeamDetails(team.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{team.name}</strong>
                    {isOwner(team) && <span style={{ marginLeft: '0.5rem', color: '#8b5cf6', fontSize: '0.875rem' }}>👑 Owner</span>}
                    {team.city && <span className="small" style={{ marginLeft: '0.5rem' }}>• {team.city}</span>}
                    {team.description && <p className="small" style={{ marginTop: '0.25rem' }}>{team.description}</p>}
                    <p className="small" style={{ marginTop: '0.25rem' }}>
                      {team.members?.length || 0} member{team.members?.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {isOwner(team) ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteTeam(team.id);
                        }}
                        className="btn-secondary"
                        style={{ padding: '0.25rem 0.75rem' }}
                      >
                        Delete
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleLeaveTeam(team.id);
                        }}
                        className="btn-secondary"
                        style={{ padding: '0.25rem 0.75rem' }}
                      >
                        Leave
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* All Teams */}
      <div className="card">
        <h3>All Teams ({teams.length})</h3>
        {teams.length === 0 ? (
          <p className="small">No teams yet. Create one above!</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {teams.map((team) => {
              const member = isMember(team);
              return (
                <li
                  key={team.id}
                  style={{
                    padding: '1rem',
                    borderBottom: '1px solid #eee',
                    cursor: 'pointer'
                  }}
                  onClick={() => loadTeamDetails(team.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong>{team.name}</strong>
                      {team.city && <span className="small" style={{ marginLeft: '0.5rem' }}>• {team.city}</span>}
                      {team.description && <p className="small" style={{ marginTop: '0.25rem' }}>{team.description}</p>}
                      <p className="small" style={{ marginTop: '0.25rem' }}>
                        Created by {team.creator?.display_name || 'Unknown'} • {team.members?.length || 0} member{team.members?.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div>
                      {member ? (
                        <span className="small" style={{ color: '#8b5cf6' }}>Member</span>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleJoinTeam(team.id);
                          }}
                          className="btn-primary"
                          style={{ padding: '0.25rem 0.75rem' }}
                        >
                          Join
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Team Details Modal */}
      {selectedTeam && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={() => setSelectedTeam(null)}
        >
          <div
            className="card"
            style={{ maxWidth: 500, width: '90%', maxHeight: '80vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3>{selectedTeam.name}</h3>
              <button onClick={() => setSelectedTeam(null)} className="btn-secondary">Close</button>
            </div>
            {selectedTeam.description && <p>{selectedTeam.description}</p>}
            {selectedTeam.city && <p className="small">📍 {selectedTeam.city}</p>}
            <h4>Members ({selectedTeam.members?.length || 0})</h4>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {selectedTeam.members?.map((member) => (
                <li key={member.user_id} style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>
                  <strong>{member.profile?.display_name || member.user_id}</strong>
                  {member.role === 'owner' && <span style={{ marginLeft: '0.5rem', color: '#8b5cf6' }}>👑</span>}
                  {member.role === 'admin' && <span style={{ marginLeft: '0.5rem', color: '#666' }}>Admin</span>}
                  {member.profile?.city && <span className="small" style={{ marginLeft: '0.5rem' }}>• {member.profile.city}</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

