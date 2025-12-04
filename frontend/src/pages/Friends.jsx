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
    
    // Don't search if query is too short (less than 1 character)
    if (searchQuery.trim().length < 1) {
      setSearchResults([]);
      return;
    }
    
    setSearching(true);
    try {
      // Search profiles via backend API (bypasses RLS)
      const headers = await getAuthHeaders();
      const query = searchQuery.trim();
      const url = `${API_BASE}/api/profiles/search?q=${encodeURIComponent(query)}`;
      
      console.log('[FRONTEND] Searching for:', query);
      console.log('[FRONTEND] URL:', url);
      console.log('[FRONTEND] Headers:', { ...headers, Authorization: headers.Authorization ? 'Bearer ***' : 'missing' });
      
      const res = await fetch(url, { headers });
      
      console.log('[FRONTEND] Response status:', res.status, res.statusText);
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error('[FRONTEND] Search API error:', errorData);
        console.error('[FRONTEND] Response text:', await res.text().catch(() => ''));
        throw new Error(errorData.error || `Search failed: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      const profiles = data.profiles || [];
      
      console.log('[FRONTEND] Raw search results:', profiles);
      console.log('[FRONTEND] Number of results:', profiles.length);

      // Filter out existing friends and pending requests
      const friendIds = new Set(friends.map(f => f.id));
      const requestIds = new Set([
        ...requests.sent.map(r => r.receiver?.id || r.receiver_id),
        ...requests.received.map(r => r.sender?.id || r.sender_id)
      ]);

      console.log('[FRONTEND] Friend IDs:', Array.from(friendIds));
      console.log('[FRONTEND] Request IDs:', Array.from(requestIds));
      console.log('[FRONTEND] Current user ID:', user?.id);

      const filtered = profiles.filter(
        p => {
          const isNotSelf = p.id !== user?.id;
          const isNotFriend = !friendIds.has(p.id);
          const isNotRequest = !requestIds.has(p.id);
          const shouldInclude = isNotSelf && isNotFriend && isNotRequest;
          if (!shouldInclude) {
            console.log(`[FRONTEND] Filtered out profile ${p.display_name}:`, { isNotSelf, isNotFriend, isNotRequest });
          }
          return shouldInclude;
        }
      );
      
      console.log('[FRONTEND] Filtered results:', filtered);
      console.log('[FRONTEND] Final count:', filtered.length);
      setSearchResults(filtered);
    } catch (err) {
      console.error('[FRONTEND] Error searching users:', err);
      console.error('[FRONTEND] Error details:', err.message, err.stack);
      setSearchResults([]);
      // Show error to user
      alert(`Search error: ${err.message}. Check console for details.`);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    // Search immediately if query is empty (to clear results)
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    
    // Debounce search for 200ms to show results as you type
    const timeoutId = setTimeout(() => {
      searchUsers();
    }, 200);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, friends, requests]);

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>;
  }

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '1rem' }}>
      <h2>Friends</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
        {/* Left Column - Add Friends and Sent Requests */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Add Friends */}
          <div className="card">
            <h3>Add Friends</h3>
            <input
              type="text"
              placeholder="Search by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem', textAlign: 'left', boxSizing: 'border-box' }}
            />
            {searching && <p className="small">Searching...</p>}
            {!searching && searchQuery.trim().length > 0 && searchResults.length === 0 && (
              <p className="small" style={{ color: '#666' }}>No users found matching "{searchQuery}"</p>
            )}
            {searchResults.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {searchResults.map((profile) => (
                  <li key={profile.id} style={{ padding: '0.5rem', borderBottom: '1px solid rgba(139, 92, 246, 0.2)' }}>
                    <div style={{ marginBottom: '0.5rem' }}>
                      <strong>{profile.display_name || 'Unknown User'}</strong>
                      {profile.city && <div className="small" style={{ color: '#cbd5e1' }}>{profile.city}</div>}
                    </div>
                    <button
                      onClick={() => handleSendRequest(profile.id)}
                      className="btn-primary"
                      style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem', width: '100%' }}
                    >
                      Send Request
                    </button>
                  </li>
                ))}
              </ul>
            )}
            
            {/* Received requests in Add Friends card */}
            {requests.received.length > 0 && (
              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(139, 92, 246, 0.2)' }}>
                <h4 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Friend Requests ({requests.received.length})</h4>
                <ul style={{ listStyle: 'none', padding: 0 }}>
                  {requests.received.map((request) => (
                    <li key={request.id} style={{ padding: '0.5rem', borderBottom: '1px solid rgba(139, 92, 246, 0.2)' }}>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <strong>{request.sender?.display_name || request.sender_id}</strong>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => handleRespondToRequest(request.id, 'accept')}
                          className="btn-primary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.875rem', flex: 1 }}
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => handleRespondToRequest(request.id, 'reject')}
                          className="btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.875rem', flex: 1 }}
                        >
                          Reject
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Sent Requests */}
          <div className="card">
            <h3>Sent Requests ({requests.sent.length})</h3>
            {requests.sent.length === 0 ? (
              <p className="small" style={{ color: '#cbd5e1' }}>No pending sent requests</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {requests.sent.map((request) => (
                  <li key={request.id} style={{ padding: '0.5rem', borderBottom: '1px solid rgba(139, 92, 246, 0.2)' }}>
                    <strong>{request.receiver?.display_name || request.receiver_id}</strong>
                    <div className="small" style={{ color: '#cbd5e1', marginTop: '0.25rem' }}>Pending</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right Column - My Friends */}
        <div className="card">
          <h3>My Friends ({friends.length})</h3>
          {friends.length === 0 ? (
            <p className="small" style={{ color: '#cbd5e1' }}>No friends yet. Search for users to add friends!</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {friends.map((friend) => (
                <li key={friend.id} style={{ padding: '0.5rem', borderBottom: '1px solid rgba(139, 92, 246, 0.2)' }}>
                  <div style={{ marginBottom: '0.5rem' }}>
                    <strong>{friend.display_name}</strong>
                    {friend.city && <div className="small" style={{ color: '#cbd5e1' }}>{friend.city}</div>}
                  </div>
                  <button
                    onClick={() => handleRemoveFriend(friend.friendship_id, friend.display_name)}
                    className="btn-secondary"
                    style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem', width: '100%' }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

