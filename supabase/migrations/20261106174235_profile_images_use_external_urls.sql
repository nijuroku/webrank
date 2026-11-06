-- Profile images are hosted by the user elsewhere. Disable the unused upload
-- policies so Supabase Storage cannot be used for profile image uploads.
drop policy if exists "Public can read player profile images" on storage.objects;
drop policy if exists "Profile owners can read their images" on storage.objects;
drop policy if exists "Profile owners can upload images" on storage.objects;
drop policy if exists "Profile owners can replace images" on storage.objects;
drop policy if exists "Profile owners can delete images" on storage.objects;
