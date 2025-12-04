-- Migration: Add strava_activity_id column to activities table
-- Run this in your Supabase SQL Editor

ALTER TABLE activities
ADD COLUMN IF NOT EXISTS strava_activity_id BIGINT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_activities_strava_id ON activities(strava_activity_id);

-- Add comment
COMMENT ON COLUMN activities.strava_activity_id IS 'Strava activity ID if this activity was imported from Strava';

