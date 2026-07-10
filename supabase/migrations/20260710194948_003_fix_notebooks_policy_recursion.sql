/*
# Fix notebooks policy infinite recursion

## Problem
The notebooks SELECT policy checked notebook_collaborators which checked notebooks,
creating an infinite loop.

## Solution
Create two separate SECURITY DEFINER helper functions that bypass RLS to check
membership without recursion:
1. is_notebook_owner(nb_id) - checks auth.uid() = notebooks.user_id directly
2. is_notebook_collaborator(nb_id) - checks notebook_collaborators.user_id directly

Both functions bypass RLS (SECURITY DEFINER), so they don't trigger the policies
that would cause recursion.

Then all policies use these functions exclusively.
*/

-- Helper: check if current user is owner
CREATE OR REPLACE FUNCTION is_notebook_owner(nb_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM notebooks n
    WHERE n.id = nb_id
    AND n.user_id = auth.uid()
  );
$$;

-- Helper: check if current user is collaborator
CREATE OR REPLACE FUNCTION is_notebook_collaborator(nb_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM notebook_collaborators c
    WHERE c.notebook_id = nb_id
    AND c.user_id = auth.uid()
  );
$$;

-- Combined helper
CREATE OR REPLACE FUNCTION can_access_notebook(nb_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT is_notebook_owner(nb_id) OR is_notebook_collaborator(nb_id);
$$;

-- ============================================================================
-- Rewrite notebooks policies (no recursion - only check own user_id or use helper)
-- ============================================================================
DROP POLICY IF EXISTS "notebooks_select" ON notebooks;
CREATE POLICY "notebooks_select" ON notebooks FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR is_notebook_collaborator(id)
  );

DROP POLICY IF EXISTS "notebooks_insert" ON notebooks;
CREATE POLICY "notebooks_insert" ON notebooks FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notebooks_update" ON notebooks;
CREATE POLICY "notebooks_update" ON notebooks FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notebooks_delete" ON notebooks;
CREATE POLICY "notebooks_delete" ON notebooks FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ============================================================================
-- Fix notebook_collaborators policies (no recursion)
-- ============================================================================
DROP POLICY IF EXISTS "collab_select" ON notebook_collaborators;
CREATE POLICY "collab_select" ON notebook_collaborators FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR is_notebook_owner(notebook_id)
  );

DROP POLICY IF EXISTS "collab_insert" ON notebook_collaborators;
CREATE POLICY "collab_insert" ON notebook_collaborators FOR INSERT
  TO authenticated WITH CHECK (is_notebook_owner(notebook_id));

DROP POLICY IF EXISTS "collab_delete" ON notebook_collaborators;
CREATE POLICY "collab_delete" ON notebook_collaborators FOR DELETE
  TO authenticated USING (is_notebook_owner(notebook_id));

-- ============================================================================
-- All other tables use can_access_notebook helper (already set in migration 002)
-- Re-apply to be safe
-- ============================================================================
DROP POLICY IF EXISTS "blocks_select" ON note_blocks;
CREATE POLICY "blocks_select" ON note_blocks FOR SELECT
  TO authenticated USING (can_access_notebook(notebook_id));

DROP POLICY IF EXISTS "blocks_insert" ON note_blocks;
CREATE POLICY "blocks_insert" ON note_blocks FOR INSERT
  TO authenticated WITH CHECK (can_access_notebook(notebook_id));

DROP POLICY IF EXISTS "blocks_update" ON note_blocks;
CREATE POLICY "blocks_update" ON note_blocks FOR UPDATE
  TO authenticated
  USING (can_access_notebook(notebook_id))
  WITH CHECK (can_access_notebook(notebook_id));

DROP POLICY IF EXISTS "blocks_delete" ON note_blocks;
CREATE POLICY "blocks_delete" ON note_blocks FOR DELETE
  TO authenticated USING (can_access_notebook(notebook_id));

DROP POLICY IF EXISTS "email_logs_select" ON email_logs;
CREATE POLICY "email_logs_select" ON email_logs FOR SELECT
  TO authenticated USING (can_access_notebook(notebook_id));

DROP POLICY IF EXISTS "email_logs_insert" ON email_logs;
CREATE POLICY "email_logs_insert" ON email_logs FOR INSERT
  TO authenticated WITH CHECK (can_access_notebook(notebook_id));

DROP POLICY IF EXISTS "insights_select" ON insights;
CREATE POLICY "insights_select" ON insights FOR SELECT
  TO authenticated USING (can_access_notebook(notebook_id));

DROP POLICY IF EXISTS "insights_insert" ON insights;
CREATE POLICY "insights_insert" ON insights FOR INSERT
  TO authenticated WITH CHECK (can_access_notebook(notebook_id));

DROP POLICY IF EXISTS "insights_delete" ON insights;
CREATE POLICY "insights_delete" ON insights FOR DELETE
  TO authenticated USING (auth.uid() = user_id OR is_notebook_owner(notebook_id));

DROP POLICY IF EXISTS "notebook_tags_select" ON notebook_tags;
CREATE POLICY "notebook_tags_select" ON notebook_tags FOR SELECT
  TO authenticated USING (can_access_notebook(notebook_id));

DROP POLICY IF EXISTS "notebook_tags_insert" ON notebook_tags;
CREATE POLICY "notebook_tags_insert" ON notebook_tags FOR INSERT
  TO authenticated WITH CHECK (can_access_notebook(notebook_id));

DROP POLICY IF EXISTS "notebook_tags_delete" ON notebook_tags;
CREATE POLICY "notebook_tags_delete" ON notebook_tags FOR DELETE
  TO authenticated USING (can_access_notebook(notebook_id));
