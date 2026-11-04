-- =====================================================================
-- Anniversaire de Tone : base de données (étape 2)
--
-- À coller dans Supabase > SQL Editor > New query, puis « Run ».
-- Sert à la page pour savoir si un compte connecté est « streamer » ou
-- « moderateur » (la table « equipe » n'est lisible par personne).
-- Rejouable sans danger.
-- =====================================================================
create or replace function public.mon_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select e.role
  from public.equipe e
  where e.user_id = (select auth.uid());
$$;

revoke all on function public.mon_role() from public, anon;
grant execute on function public.mon_role() to authenticated;
