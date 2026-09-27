-- Minimal stand-in for Supabase's auth schema + roles, for local testing only.
do $$ begin if not exists (select 1 from pg_roles where rolname=$q$authenticated$q$) then create role authenticated nologin; create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname=$q$service_role$q$) then create role service_role nologin; end if; end $$;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
grant usage on schema public to authenticated;
