-- v6.0: Add folder support to knowledge_library
-- Run this migration to add folder organization capabilities

-- Add folder column to knowledge_library table
ALTER TABLE knowledge_library
ADD COLUMN IF NOT EXISTS folder TEXT DEFAULT NULL;

-- Create index for faster folder queries
CREATE INDEX IF NOT EXISTS idx_knowledge_library_folder
ON knowledge_library(license_key_hash, folder);

-- Optional: Add comment for documentation
COMMENT ON COLUMN knowledge_library.folder IS 'Folder name for organizing files. NULL means root level.';
