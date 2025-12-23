-- Migration: Add QC (Quality Control) columns to activities table
-- Run this in your Supabase SQL Editor

-- Add QC columns to activities table
ALTER TABLE activities 
ADD COLUMN IF NOT EXISTS qc_status TEXT DEFAULT 'accepted',
ADD COLUMN IF NOT EXISTS qc_warnings JSONB,
ADD COLUMN IF NOT EXISTS qc_metrics JSONB;

-- Add comment for documentation
COMMENT ON COLUMN activities.qc_status IS 'QC validation status: accepted, rejected';
COMMENT ON COLUMN activities.qc_warnings IS 'JSON array of QC warnings (if any)';
COMMENT ON COLUMN activities.qc_metrics IS 'JSON object with calculated metrics (speed, pace, etc.)';

-- Create index for QC status if needed for filtering
CREATE INDEX IF NOT EXISTS idx_activities_qc_status ON activities(qc_status);

