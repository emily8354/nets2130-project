import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

const API_BASE = 'http://localhost:4000';

export default function Friends({ user }) {
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState({ sent: [], received: [] });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

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

  const loadFriends = async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/friends`, { headers });
      if (res.ok) {
        const data = await res.json();
        setFriends(data.friends || []);
      }
    } catch (err) {
      console.error('Error loading friends:', err);
    }
  };

  const loadRequests = async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/friends/requests`, { headers });
      if (res.ok) {
        const data = await res.json();
        setRequests(data);
      }
    } catch (err) {
      console.error('Error loading requests:', err);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([loadFriends(), loadRequests()]);
      setLoading(false);
    };
    if (user) loadData();
  }, [user]);

  const handleSendRequest = async (receiverId) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/friends/request`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ receiver_id: receiverId })
      });
      const data = await res.json();
      if (res.ok) {
        alert('Friend request sent!');
        await loadRequests();
        setSearchResults([]);
        setSearchQuery('');
      } else {
        alert(data.error || 'Failed to send friend request');
      }
    } catch (err) {
      console.error('Error sending request:', err);
      alert('Error sending friend request');
    }
  };

  const handleRespondToRequest = async (requestId, action) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/friends/respond`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ request_id: requestId, action })
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Friend request ${action}ed!`);
        await Promise.all([loadFriends(), loadRequests()]);
      } else {
        alert(data.error || `Failed to ${action} friend request`);
      }
    } catch (err) {
      console.error(`Error ${action}ing request:`, err);
      alert(`Error ${action}ing friend request`);
    }
  };

  const handleRemoveFriend = async (friendshipId, friendName) => {
    if (!confirm(`Remove ${friendName} from your friends?`)) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/friends/${friendshipId}`, {
        method: 'DELETE',
        headers
      });
      if (res.ok) {
        alert('Friend removed');
        await loadFriends();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to remove friend');
      }
    } catch (err) {
      console.error('Error removing friend:', err);
      alert('Error removing friend');
    }
  };

  const searchUsers = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      // Search profiles by display_name
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id, display_name, city')
        .ilike('display_name', `%${searchQuery}%`)
        .limit(10);

      if (error) throw error;

      // Filter out current user and existing friends
      const friendIds = new Set(friends.map(f => f.id));
      const requestIds = new Set([
        ...requests.sent.map(r => r.receiver?.id || r.receiver_id),
        ...requests.received.map(r => r.sender?.id || r.sender_id)
      ]);

      const filtered = (profiles || []).filter(
        p => p.id !== user?.id && !friendIds.has(p.id) && !requestIds.has(p.id)
      );
      setSearchResults(filtered);
    } catch (err) {
      console.error('Error searching users:', err);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      searchUsers();
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>;
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '1rem' }}>
      <h2>Friends</h2>

      {/* Search for users */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3>Add Friends</h3>
        <input
          type="text"
          placeholder="Search by name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem' }}
        />
        {searching && <p className="small">Searching...</p>}
        {searchResults.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {searchResults.map((profile) => (
              <li key={profile.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', borderBottom: '1px solid #eee' }}>
                <div>
                  <strong>{profile.display_name}</strong>
                  {profile.city && <span className="small" style={{ marginLeft: '0.5rem' }}>• {profile.city}</span>}
                </div>
                <button
                  onClick={() => handleSendRequest(profile.id)}
                  className="btn-primary"
                  style={{ padding: '0.25rem 0.75rem' }}
                >
                  Send Request
                </button>
              </li>
            ))}
          </ul>
        )}
        {searchQuery && !searching && searchResults.length === 0 && (
          <p className="small">No users found</p>
        )}
      </div>

      {/* Received requests */}
      {requests.received.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3>Friend Requests ({requests.received.length})</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {requests.received.map((request) => (
              <li key={request.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', borderBottom: '1px solid #eee' }}>
                <div>
                  <strong>{request.sender?.display_name || request.sender_id}</strong>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => handleRespondToRequest(request.id, 'accept')}
                    className="btn-primary"
                    style={{ padding: '0.25rem 0.75rem' }}
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleRespondToRequest(request.id, 'reject')}
                    className="btn-secondary"
                    style={{ padding: '0.25rem 0.75rem' }}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sent requests */}
      {requests.sent.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3>Sent Requests ({requests.sent.length})</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {requests.sent.map((request) => (
              <li key={request.id} style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>
                <strong>{request.receiver?.display_name || request.receiver_id}</strong>
                <span className="small" style={{ marginLeft: '0.5rem', color: '#666' }}>Pending</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Friends list */}
      <div className="card">
        <h3>My Friends ({friends.length})</h3>
        {friends.length === 0 ? (
          <p className="small">No friends yet. Search for users above to add friends!</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {friends.map((friend) => (
              <li key={friend.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', borderBottom: '1px solid #eee' }}>
                <div>
                  <strong>{friend.display_name}</strong>
                  {friend.city && <span className="small" style={{ marginLeft: '0.5rem' }}>• {friend.city}</span>}
                </div>
                <button
                  onClick={() => handleRemoveFriend(friend.friendship_id, friend.display_name)}
                  className="btn-secondary"
                  style={{ padding: '0.25rem 0.75rem' }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

