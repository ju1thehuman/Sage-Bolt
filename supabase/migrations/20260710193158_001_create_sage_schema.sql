/*
# SAGE Collaborative Notebook Schema

## Overview
Creates the full database schema for SAGE — a collaborative AI-powered notebook app.
Users sign up with email/password, create notebooks, invite collaborators, and get
AI-generated strategic analysis of their notes.

## New Tables
1. profiles — user display info
2. notebooks — top-level collaborative spaces
3. notebook_collaborators — maps users to notebooks they're invited to
4. note_blocks — ordered content blocks within a notebook
5. email_logs — history of shared briefings
6. insights — cached AI analysis per notebook
7. tags — AI-extracted topic tags (global)
8. notebook_tags — many-to-many notebooks <-> tags

## Security (RLS)
- profiles: all authenticated can read; users update own.
- notebooks: owner or collaborator can read; owner can insert/update/delete.
- notebook_collaborators: owner or collaborator can read; owner can insert/delete.
- note_blocks: owner or collaborator can read/insert/update/delete.
- email_logs: owner or collaborator can read; authenticated can insert.
- insights: owner or collaborator can read; authenticated can insert.
- tags: all authenticated can read/insert.
- notebook_tags: owner or collaborator can read/insert/delete.

## Notes
1. All owner columns default to auth.uid() so client inserts work.
2. Collaborator access checked via EXISTS subquery on notebook_collaborators.
3. Tables created first, then RLS policies (avoids forward-reference errors).
*/

-- ============================================================================
-- CREATE ALL TABLES FIRST
-- ============================================================================

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  avatar_initials text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT 'indigo',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notebooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  last_updated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notebook_collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id uuid NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz DEFAULT now(),
  UNIQUE (notebook_id, user_id)
);

CREATE TABLE IF NOT EXISTS note_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id uuid NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  type text NOT NULL DEFAULT 'text',
  content text DEFAULT '',
  table_data jsonb,
  poll_data jsonb,
  font_size text DEFAULT 'base',
  bold boolean DEFAULT false,
  italic boolean DEFAULT false,
  highlight_color text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id uuid NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  subject text,
  provider text DEFAULT 'gmail',
  sections_shared jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id uuid NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  analysis jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notebook_tags (
  notebook_id uuid NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (notebook_id, tag_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_notebooks_user_id ON notebooks(user_id);
CREATE INDEX IF NOT EXISTS idx_collab_notebook ON notebook_collaborators(notebook_id);
CREATE INDEX IF NOT EXISTS idx_collab_user ON notebook_collaborators(user_id);
CREATE INDEX IF NOT EXISTS idx_blocks_notebook ON note_blocks(notebook_id);
CREATE INDEX IF NOT EXISTS idx_blocks_position ON note_blocks(notebook_id, position);
CREATE INDEX IF NOT EXISTS idx_email_logs_notebook ON email_logs(notebook_id);
CREATE INDEX IF NOT EXISTS idx_insights_notebook ON insights(notebook_id);

-- ============================================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE notebooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE notebook_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE notebook_tags ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PROFILES POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "profiles_read_all" ON profiles;
CREATE POLICY "profiles_read_all" ON profiles FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

-- ============================================================================
-- NOTEBOOKS POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "notebooks_select" ON notebooks;
CREATE POLICY "notebooks_select" ON notebooks FOR SELECT
  TO authenticated USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM notebook_collaborators
      WHERE notebook_collaborators.notebook_id = notebooks.id
      AND notebook_collaborators.user_id = auth.uid()
    )
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
-- NOTEBOOK_COLLABORATORS POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "collab_select" ON notebook_collaborators;
CREATE POLICY "collab_select" ON notebook_collaborators FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = notebook_collaborators.notebook_id
      AND (notebooks.user_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM notebook_collaborators c2
             WHERE c2.notebook_id = notebooks.id AND c2.user_id = auth.uid()
           ))
    )
  );

DROP POLICY IF EXISTS "collab_insert" ON notebook_collaborators;
CREATE POLICY "collab_insert" ON notebook_collaborators FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = notebook_collaborators.notebook_id
      AND notebooks.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "collab_delete" ON notebook_collaborators;
CREATE POLICY "collab_delete" ON notebook_collaborators FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = notebook_collaborators.notebook_id
      AND notebooks.user_id = auth.uid()
    )
  );

-- ============================================================================
-- NOTE_BLOCKS POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "blocks_select" ON note_blocks;
CREATE POLICY "blocks_select" ON note_blocks FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = note_blocks.notebook_id
      AND (notebooks.user_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM notebook_collaborators
             WHERE notebook_collaborators.notebook_id = notebooks.id
             AND notebook_collaborators.user_id = auth.uid()
           ))
    )
  );

DROP POLICY IF EXISTS "blocks_insert" ON note_blocks;
CREATE POLICY "blocks_insert" ON note_blocks FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = note_blocks.notebook_id
      AND (notebooks.user_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM notebook_collaborators
             WHERE notebook_collaborators.notebook_id = notebooks.id
             AND notebook_collaborators.user_id = auth.uid()
           ))
    )
  );

DROP POLICY IF EXISTS "blocks_update" ON note_blocks;
CREATE POLICY "blocks_update" ON note_blocks FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = note_blocks.notebook_id
      AND (notebooks.user_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM notebook_collaborators
             WHERE notebook_collaborators.notebook_id = notebooks.id
             AND notebook_collaborators.user_id = auth.uid()
           ))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = note_blocks.notebook_id
      AND (notebooks.user_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM notebook_collaborators
             WHERE notebook_collaborators.notebook_id = notebooks.id
             AND notebook_collaborators.user_id = auth.uid()
           ))
    )
  );

DROP POLICY IF EXISTS "blocks_delete" ON note_blocks;
CREATE POLICY "blocks_delete" ON note_blocks FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = note_blocks.notebook_id
      AND (notebooks.user_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM notebook_collaborators
             WHERE notebook_collaborators.notebook_id = notebooks.id
             AND notebook_collaborators.user_id = auth.uid()
           ))
    )
  );

-- ============================================================================
-- EMAIL_LOGS POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "email_logs_select" ON email_logs;
CREATE POLICY "email_logs_select" ON email_logs FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = email_logs.notebook_id
      AND (notebooks.user_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM notebook_collaborators
             WHERE notebook_collaborators.notebook_id = notebooks.id
             AND notebook_collaborators.user_id = auth.uid()
           ))
    )
  );

DROP POLICY IF EXISTS "email_logs_insert" ON email_logs;
CREATE POLICY "email_logs_insert" ON email_logs FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = email_logs.notebook_id
      AND (notebooks.user_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM notebook_collaborators
             WHERE notebook_collaborators.notebook_id = notebooks.id
             AND notebook_collaborators.user_id = auth.uid()
           ))
    )
  );

-- ============================================================================
-- INSIGHTS POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "insights_select" ON insights;
CREATE POLICY "insights_select" ON insights FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = insights.notebook_id
      AND (notebooks.user_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM notebook_collaborators
             WHERE notebook_collaborators.notebook_id = notebooks.id
             AND notebook_collaborators.user_id = auth.uid()
           ))
    )
  );

DROP POLICY IF EXISTS "insights_insert" ON insights;
CREATE POLICY "insights_insert" ON insights FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = insights.notebook_id
      AND (notebooks.user_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM notebook_collaborators
             WHERE notebook_collaborators.notebook_id = notebooks.id
             AND notebook_collaborators.user_id = auth.uid()
           ))
    )
  );

DROP POLICY IF EXISTS "insights_delete" ON insights;
CREATE POLICY "insights_delete" ON insights FOR DELETE
  TO authenticated USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = insights.notebook_id
      AND notebooks.user_id = auth.uid()
    )
  );

-- ============================================================================
-- TAGS POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "tags_select" ON tags;
CREATE POLICY "tags_select" ON tags FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "tags_insert" ON tags;
CREATE POLICY "tags_insert" ON tags FOR INSERT
  TO authenticated WITH CHECK (true);

-- ============================================================================
-- NOTEBOOK_TAGS POLICIES
-- ============================================================================
DROP POLICY IF EXISTS "notebook_tags_select" ON notebook_tags;
CREATE POLICY "notebook_tags_select" ON notebook_tags FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = notebook_tags.notebook_id
      AND (notebooks.user_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM notebook_collaborators
             WHERE notebook_collaborators.notebook_id = notebooks.id
             AND notebook_collaborators.user_id = auth.uid()
           ))
    )
  );

DROP POLICY IF EXISTS "notebook_tags_insert" ON notebook_tags;
CREATE POLICY "notebook_tags_insert" ON notebook_tags FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = notebook_tags.notebook_id
      AND (notebooks.user_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM notebook_collaborators
             WHERE notebook_collaborators.notebook_id = notebooks.id
             AND notebook_collaborators.user_id = auth.uid()
           ))
    )
  );

DROP POLICY IF EXISTS "notebook_tags_delete" ON notebook_tags;
CREATE POLICY "notebook_tags_delete" ON notebook_tags FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM notebooks
      WHERE notebooks.id = notebook_tags.notebook_id
      AND (notebooks.user_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM notebook_collaborators
             WHERE notebook_collaborators.notebook_id = notebooks.id
             AND notebook_collaborators.user_id = auth.uid()
           ))
    )
  );

-- ============================================================================
-- TRIGGER: Auto-create profile on signup
-- ============================================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_initials, color)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    UPPER(SUBSTRING(COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)) FROM 1 FOR 2)),
    'indigo'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
