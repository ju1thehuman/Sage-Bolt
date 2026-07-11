/*
# Remove duplicate legacy RLS policies on note_blocks

## What
Drops the old `blocks_select`, `blocks_insert`, `blocks_update`, `blocks_delete`
policies that were superseded by migration 004/005 but never removed.

## Why — CRITICAL SECURITY FIX
Postgres combines all permissive policies with OR. The old `blocks_update`
policy used `can_access_notebook(notebook_id)` which returns true for ANY
collaborator — meaning any collaborator could update ANY block, overriding the
author-only `update_note_blocks` policy (`auth.uid() = user_id`) added in
migration 005. The same issue affected `blocks_delete`. With the legacy
policies gone, the author-scoped policies are the sole authority.

## Changes
- DROP POLICY `blocks_select` on `note_blocks` (replaced by `select_note_blocks`)
- DROP POLICY `blocks_insert` on `note_blocks` (replaced by `insert_note_blocks`)
- DROP POLICY `blocks_update` on `note_blocks` (replaced by `update_note_blocks`)
- DROP POLICY `blocks_delete` on `note_blocks` (replaced by `delete_note_blocks`)

## Verification
After this migration, only 4 policies remain on `note_blocks`:
- select_note_blocks (owner OR collaborator can read)
- insert_note_blocks (auth.uid() = user_id AND can access notebook)
- update_note_blocks (auth.uid() = user_id — author only)
- delete_note_blocks (author OR notebook owner)
*/

DROP POLICY IF EXISTS "blocks_select" ON note_blocks;
DROP POLICY IF EXISTS "blocks_insert" ON note_blocks;
DROP POLICY IF EXISTS "blocks_update" ON note_blocks;
DROP POLICY IF EXISTS "blocks_delete" ON note_blocks;
