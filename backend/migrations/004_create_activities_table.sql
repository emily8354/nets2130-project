-- Migration: Create activities table
-- Run this in your Supabase SQL Editor

-- Drop constraint if it exists (in case of partial migration)
ALTER TABLE IF EXISTS activities DROP CONSTRAINT IF EXISTS activities_user_id_fkey;

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('run', 'walk', 'workout')),
  distance_km DOUBLE PRECISION DEFAULT 0,
  duration_minutes INTEGER DEFAULT 0,
  points_earned INTEGER DEFAULT 0,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  strava_activity_id BIGINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add strava_activity_id column if it doesn't exist
ALTER TABLE activities ADD COLUMN IF NOT EXISTS strava_activity_id BIGINT;

-- Add foreign key constraint if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'activities_user_id_fkey'
  ) THEN
    ALTER TABLE activities 
    ADD CONSTRAINT activities_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_activities_user_id ON activities(user_id);
CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date DESC);
CREATE INDEX IF NOT EXISTS idx_activities_user_date ON activities(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_activities_strava_id ON activities(strava_activity_id);

-- Enable Row Level Security
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own activities
DROP POLICY IF EXISTS "Users can read own activities" ON activities;
CREATE POLICY "Users can read own activities"
  ON activities FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own activities
DROP POLICY IF EXISTS "Users can insert own activities" ON activities;
CREATE POLICY "Users can insert own activities"
  ON activities FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Note: Service role (used by backend) bypasses RLS automatically
-- No additional policy needed for service role

