-- =====================================================================
-- 0072  Mark the shared site account (app_metadata.shared)
--
--  Final review of the login work (12 Oct): once LOGIN_REQUIRED is on,
--  every floor device still holding the shared Gudang session kept
--  working as admin without signing in, and while it is off any admin
--  could deactivate or re-password the account every device runs on.
--  The app now recognises the shared account by app_metadata.shared
--  (in the JWT, set only by the server): with login required its
--  session is signed out; with login not required Pengguna leaves it
--  alone. This marks live's Gudang account; the middleware also marks
--  the site account the first time it signs a device in (other setups).
-- =====================================================================

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"shared": true}'::jsonb
where id = '5e853334-8d85-4466-b14c-4a1837afd92b';
