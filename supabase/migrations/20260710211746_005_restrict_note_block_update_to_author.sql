/*
# Restrict note_blocks UPDATE to block author only

## Problem
The previous UPDATE policy allowed any notebook collaborator to edit any block,
regardless of who created it. This means User B could silently overwrite User A's notes.

## Fix
Replace the broad collaborator UPDATE policy with one that requires
`auth.uid() = user_id` — only the person who created the block can modify it.
The notebook owner retains the ability to DELETE any block (unchanged).

## Changed policies
- `update_note_blocks`: was "notebook owner OR collaborator"; now "block author only"

## Unchanged policies
- `select_note_blocks`: notebook owner OR collaborator (read-all still allowed)
- `insert_note_blocks`: notebook owner OR collaborator, user_id must equal auth.uid()
- `delete_note_blocks`: block author OR notebook owner
*/

DROP POLICY IF EXISTS "update_note_blocks" ON note_blocks;

CREATE POLICY "update_note_blocks" ON note_blocks FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
