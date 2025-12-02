-- Migration: Create friendships and friend_requests tables
-- Run this migration to set up the database schema for friend functionality

-- Friend requests table (pending requests)
CREATE TABLE IF NOT EXISTS friend_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL, -- User who sent the request
    receiver_id UUID NOT NULL, -- User who received the request
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'accepted', 'rejected'
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Ensure a user can't send duplicate requests
    UNIQUE(sender_id, receiver_id),
    
    -- Foreign key constraints (assuming profiles table exists)
    CONSTRAINT fk_sender FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT fk_receiver FOREIGN KEY (receiver_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Prevent self-friending
    CONSTRAINT no_self_friend CHECK (sender_id != receiver_id)
);

-- Friendships table (accepted friendships)
CREATE TABLE IF NOT EXISTS friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user1_id UUID NOT NULL, -- First user in friendship
    user2_id UUID NOT NULL, -- Second user in friendship
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- Ensure unique friendships (user1_id < user2_id to prevent duplicates)
    UNIQUE(user1_id, user2_id),
    
    -- Foreign key constraints
    CONSTRAINT fk_user1 FOREIGN KEY (user1_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user2 FOREIGN KEY (user2_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Ensure user1_id < user2_id to prevent duplicate friendships
    CONSTRAINT ordered_users CHECK (user1_id < user2_id)
);

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_friend_requests_sender ON friend_requests(sender_id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver ON friend_requests(receiver_id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_status ON friend_requests(status);
CREATE INDEX IF NOT EXISTS idx_friendships_user1 ON friendships(user1_id);
CREATE INDEX IF NOT EXISTS idx_friendships_user2 ON friendships(user2_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_friend_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
CREATE TRIGGER update_friend_requests_updated_at 
    BEFORE UPDATE ON friend_requests 
    FOR EACH ROW 
    EXECUTE FUNCTION update_friend_requests_updated_at();

