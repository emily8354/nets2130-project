-- Migration: Add team_id column to profiles table
-- Run this in your Supabase SQL Editor

-- Add team_id column to profiles table (references teams table)
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS team_id UUID;

-- Add foreign key constraint (if teams table exists)
-- Note: This will fail if teams table doesn't exist yet, so run teams migration first
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'teams') THEN
    ALTER TABLE profiles
    ADD CONSTRAINT fk_profiles_team_id 
    FOREIGN KEY (team_id) 
    REFERENCES teams(id) 
    ON DELETE SET NULL;
  END IF;
END $$;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS profiles_team_id_idx ON profiles(team_id);

-- Add comment for documentation
COMMENT ON COLUMN profiles.team_id IS 'Reference to the team the user belongs to';

