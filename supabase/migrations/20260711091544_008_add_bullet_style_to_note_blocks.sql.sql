-- Add bullet_style column to note_blocks
-- Allows users to choose bullet style: dot, arrow, checkbox, numbered
ALTER TABLE note_blocks
  ADD COLUMN IF NOT EXISTS bullet_style text DEFAULT 'dot';
