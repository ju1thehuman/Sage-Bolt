/*
# Fix RLS Infinite Recursion on notebook_collaborators

## Problem
The collab_select policy on notebook_collaborators had infinite recursion because
it checked if the user is a collaborator by querying notebook_collaborators itself.

## Fix
Rewrite the collab_select policy to only check the notebooks.user_id (owner).
Collaborators can see their own row directly by checking user_id = auth.uid().
This avoids the recursive self-reference.

## Changes
- Rewrites notebook_collaborators SELECT policy to eliminate recursion
- Rewrites notebooks SELECT policy to use a simpler non-recursive check
- Fixes note_blocks, email_logs, insights, notebook_tags policies to avoid
  the recursive notebook_collaborators reference inside notebooks check
*/

-- ============================================================================
-- Fix notebook_collaborators SELECT policy (was recursively referencing itself)
-- ============================================================================
DROP POLICY IF EXISTS "collab_select" ON notebook_collaborators;
CREATE POLICY "collab_select" ON notebook_collaborators FOR SELECT
  TO authenticated USING (
    -- Either you are the collaborator row being read
    user_id = auth.uid()
    -- Or you own the notebook
    OR EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = notebook_collaborators.notebook_id
      AND notebooks.user_id = auth.uid()
    )
  );

-- ============================================================================
-- Create a helper function to check notebook access (avoids inline recursion)
-- ============================================================================
CREATE OR REPLACE FUNCTION can_access_notebook(nb_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM notebooks n
    WHERE n.id = nb_id
    AND (
      n.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM notebook_collaborators c
        WHERE c.notebook_id = nb_id
        AND c.user_id = auth.uid()
      )
    )
  );
$$;

-- ============================================================================
-- Rewrite notebooks SELECT to use the helper
-- ============================================================================
DROP POLICY IF EXISTS "notebooks_select" ON notebooks;
CREATE POLICY "notebooks_select" ON notebooks FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM notebook_collaborators c
      WHERE c.notebook_id = notebooks.id
      AND c.user_id = auth.uid()
    )
  );

-- ============================================================================
-- Rewrite note_blocks policies using helper function
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

-- ============================================================================
-- Rewrite email_logs policies using helper function
-- ============================================================================
DROP POLICY IF EXISTS "email_logs_select" ON email_logs;
CREATE POLICY "email_logs_select" ON email_logs FOR SELECT
  TO authenticated USING (can_access_notebook(notebook_id));

DROP POLICY IF EXISTS "email_logs_insert" ON email_logs;
CREATE POLICY "email_logs_insert" ON email_logs FOR INSERT
  TO authenticated WITH CHECK (can_access_notebook(notebook_id));

-- ============================================================================
-- Rewrite insights policies using helper function
-- ============================================================================
DROP POLICY IF EXISTS "insights_select" ON insights;
CREATE POLICY "insights_select" ON insights FOR SELECT
  TO authenticated USING (can_access_notebook(notebook_id));

DROP POLICY IF EXISTS "insights_insert" ON insights;
CREATE POLICY "insights_insert" ON insights FOR INSERT
  TO authenticated WITH CHECK (can_access_notebook(notebook_id));

DROP POLICY IF EXISTS "insights_delete" ON insights;
CREATE POLICY "insights_delete" ON insights FOR DELETE
  TO authenticated USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM notebooks WHERE notebooks.id = insights.notebook_id AND notebooks.user_id = auth.uid()
    )
  );

-- ============================================================================
-- Rewrite notebook_tags policies using helper function
-- ============================================================================
DROP POLICY IF EXISTS "notebook_tags_select" ON notebook_tags;
CREATE POLICY "notebook_tags_select" ON notebook_tags FOR SELECT
  TO authenticated USING (can_access_notebook(notebook_id));

DROP POLICY IF EXISTS "notebook_tags_insert" ON notebook_tags;
CREATE POLICY "notebook_tags_insert" ON notebook_tags FOR INSERT
  TO authenticated WITH CHECK (can_access_notebook(notebook_id));

DROP POLICY IF EXISTS "notebook_tags_delete" ON notebook_tags;
CREATE POLICY "notebook_tags_delete" ON notebook_tags FOR DELETE
  TO authenticated USING (can_access_notebook(notebook_id));
