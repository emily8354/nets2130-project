-- Migration: Update profiles table to include location, streak, badges, and points
-- Run this in your Supabase SQL Editor

-- Add new columns to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS streak INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_activity_date DATE,
ADD COLUMN IF NOT EXISTS badges JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'offline',
ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP WITH TIME ZONE;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS profiles_points_idx ON profiles(points DESC);
CREATE INDEX IF NOT EXISTS profiles_streak_idx ON profiles(streak DESC);
CREATE INDEX IF NOT EXISTS profiles_city_idx ON profiles(city);
CREATE INDEX IF NOT EXISTS profiles_location_idx ON profiles USING GIST (point(lng, lat)) WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN profiles.lat IS 'Latitude coordinate for user location';
COMMENT ON COLUMN profiles.lng IS 'Longitude coordinate for user location';
COMMENT ON COLUMN profiles.points IS 'Total points earned by user';
COMMENT ON COLUMN profiles.streak IS 'Current consecutive days streak';
COMMENT ON COLUMN profiles.badges IS 'JSON array of earned badge IDs';
COMMENT ON COLUMN profiles.status IS 'User status: online, active, or offline';
COMMENT ON COLUMN profiles.last_seen IS 'Timestamp of last activity';

