/*
# Add user_id to note_blocks for per-author attribution

## Purpose
In collaborative workspaces, each note block should be tagged to the user who created it.
This allows the UI to show author attribution (name, avatar color) per block, similar to
Slack/Teams message styling.

## Changes

### 1. New column on `note_blocks`
- `user_id` (uuid, nullable initially, then set NOT NULL after backfill) — references auth.users(id) ON DELETE SET NULL.

### 2. Backfill existing rows
- Existing rows get user_id set to their notebook's user_id (the notebook owner).

### 3. Set NOT NULL with DEFAULT auth.uid()
- After backfill, set the column to NOT NULL with DEFAULT auth.uid() so future inserts
  from the frontend automatically get the authenticated user's ID.

### 4. RLS policy changes on `note_blocks`
Old policies restricted access to the notebook OWNER only.
New policies allow any authenticated user who is either the notebook owner OR a registered
collaborator to SELECT, INSERT, and UPDATE blocks. DELETE is restricted to the block author
or the notebook owner.
*/

-- 1. Add user_id column as nullable first
ALTER TABLE note_blocks
  ADD COLUMN IF NOT EXISTS user_id uuid;

-- 2. Backfill existing rows: set user_id to the notebook's owner
UPDATE note_blocks
SET user_id = notebooks.user_id
FROM notebooks
WHERE note_blocks.notebook_id = notebooks.id
  AND note_blocks.user_id IS NULL;

-- 3. Set NOT NULL and add DEFAULT auth.uid()
ALTER TABLE note_blocks
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN user_id SET DEFAULT auth.uid();

-- 4. Add foreign key constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'note_blocks_user_id_fkey'
    AND table_name = 'note_blocks'
  ) THEN
    ALTER TABLE note_blocks
      ADD CONSTRAINT note_blocks_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 5. Add index for author-based queries
CREATE INDEX IF NOT EXISTS idx_note_blocks_user_id ON note_blocks(user_id);

-- 6. Drop old policies and create new ones
DROP POLICY IF EXISTS "select_own_note_blocks" ON note_blocks;
DROP POLICY IF EXISTS "insert_own_note_blocks" ON note_blocks;
DROP POLICY IF EXISTS "update_own_note_blocks" ON note_blocks;
DROP POLICY IF EXISTS "delete_own_note_blocks" ON note_blocks;

-- SELECT: notebook owner OR collaborator
CREATE POLICY "select_note_blocks" ON note_blocks FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = note_blocks.notebook_id
      AND (
        notebooks.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM notebook_collaborators
          WHERE notebook_collaborators.notebook_id = notebooks.id
          AND notebook_collaborators.user_id = auth.uid()
        )
      )
    )
  );

-- INSERT: notebook owner OR collaborator, user_id must match auth.uid()
CREATE POLICY "insert_note_blocks" ON note_blocks FOR INSERT
  TO authenticated WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = note_blocks.notebook_id
      AND (
        notebooks.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM notebook_collaborators
          WHERE notebook_collaborators.notebook_id = notebooks.id
          AND notebook_collaborators.user_id = auth.uid()
        )
      )
    )
  );

-- UPDATE: notebook owner OR collaborator
CREATE POLICY "update_note_blocks" ON note_blocks FOR UPDATE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = note_blocks.notebook_id
      AND (
        notebooks.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM notebook_collaborators
          WHERE notebook_collaborators.notebook_id = notebooks.id
          AND notebook_collaborators.user_id = auth.uid()
        )
      )
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = note_blocks.notebook_id
      AND (
        notebooks.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM notebook_collaborators
          WHERE notebook_collaborators.notebook_id = notebooks.id
          AND notebook_collaborators.user_id = auth.uid()
        )
      )
    )
  );

-- DELETE: block author OR notebook owner
CREATE POLICY "delete_note_blocks" ON note_blocks FOR DELETE
  TO authenticated USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = note_blocks.notebook_id
      AND notebooks.user_id = auth.uid()
    )
  );
