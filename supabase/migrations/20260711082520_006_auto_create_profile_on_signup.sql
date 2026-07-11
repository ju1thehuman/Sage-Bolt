/*
# Auto-create profile on user signup

## Problem
No trigger exists to auto-create a `profiles` row when a new auth user registers.
The auth context passes `display_name` via `options.data` in `signUp()`, but nothing
inserts it into the `profiles` table. New users end up with a session but no profile row,
causing the UI to show null names/initials.

## Fix
1. Create `handle_new_user()` function that inserts a `profiles` row from the new auth user's metadata.
2. Create a trigger on `auth.users` AFTER INSERT that calls `handle_new_user()`.
3. The function extracts `display_name` from `raw_user_meta_data` and generates `avatar_initials`.

## Security
- The function runs with SECURITY DEFINER (needed to insert into profiles from the auth trigger).
- The trigger fires on auth.users INSERT, which only happens during signup.
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  display_name text;
  initials text;
BEGIN
  display_name := COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1));
  
  -- Generate initials from display_name (first letter of first two words)
  initials := UPPER(SUBSTRING(display_name FROM 1 FOR 1));
  IF POSITION(' ' IN display_name) > 0 THEN
    initials := initials || UPPER(SUBSTRING(display_name FROM POSITION(' ' IN display_name) + 1 FOR 1));
  END IF;
  
  INSERT INTO public.profiles (id, display_name, avatar_initials)
  VALUES (NEW.id, display_name, initials)
  ON CONFLICT (id) DO NOTHING;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
