/*
# Fix email_logs RLS policy

## Problem
The `email_logs_select` policy used `can_access_notebook(notebook_id)` which
allowed any collaborator to read all email logs. Only the notebook owner
should see who briefings were sent to.

## Changes
- Drop `email_logs_select` (uses can_access_notebook — too permissive)
- Add `email_logs_select_own` — only notebook owner can read logs
- Fix `email_logs_insert` to check ownership via notebooks table
*/

DROP POLICY IF EXISTS "email_logs_select" ON email_logs;
DROP POLICY IF EXISTS "email_logs_insert" ON email_logs;

CREATE POLICY "email_logs_select_own"
ON email_logs FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM notebooks
    WHERE notebooks.id = email_logs.notebook_id
    AND notebooks.user_id = auth.uid())
);

CREATE POLICY "email_logs_insert_own"
ON email_logs FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM notebooks
    WHERE notebooks.id = email_logs.notebook_id
    AND notebooks.user_id = auth.uid())
);
