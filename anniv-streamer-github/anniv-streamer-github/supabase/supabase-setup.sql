-- =====================================================================
-- Anniversaire de Tone : base de données (étape 1)
--
-- À coller dans Supabase > SQL Editor > New query, puis « Run ».
-- On peut le relancer sans danger : tout est écrit pour être rejouable.
--
-- Principe :
--   * Le public ne peut RIEN écrire directement dans la base. Les fiches
--     seront envoyées par une fonction serveur (étape suivante) qui vérifie
--     tout (clip Twitch, tailles, dessin) avant d'enregistrer.
--   * Le public ne lit que les fiches VALIDÉES, à partir du 30 novembre,
--     et jamais la colonne « word » (le mot).
--   * Les modérateurs voient tout et peuvent changer le statut d'une fiche.
--   * Tone (streamer) voit les fiches validées avec les mots, à partir du
--     30 novembre.
-- =====================================================================


-- 1) Date d'ouverture du résumé : 30 novembre 2026, 00h00 heure de Paris.
--    Pour tester avant, remplacer la date ici puis relancer ce bloc.
create or replace function public.resume_ouvert()
returns boolean
language sql
stable
as $$
  select now() >= ((timestamp '2026-11-30 00:00:00') at time zone 'Europe/Paris');
$$;


-- 2) Équipe : qui est modérateur, qui est le streamer.
--    Cette table n'est lisible par personne via l'API (aucune règle d'accès) :
--    on la remplit uniquement depuis le SQL Editor.
create table if not exists public.equipe (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role    text not null check (role in ('moderateur', 'streamer'))
);

alter table public.equipe enable row level security;
revoke all on public.equipe from anon, authenticated;

create or replace function public.est_equipe(roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.equipe e
    where e.user_id = (select auth.uid())
      and e.role = any (roles)
  );
$$;

revoke all on function public.est_equipe(text[]) from public;
grant execute on function public.est_equipe(text[]) to anon, authenticated;


-- 3) Les fiches
create table if not exists public.fiches (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  status       text not null default 'pending'
               check (status in ('pending', 'approved', 'rejected')),
  pseudo       text not null check (char_length(btrim(pseudo)) between 1 and 40),
  game         text check (game is null or char_length(game) <= 80),
  clip         text check (clip is null or char_length(clip) <= 300),
  clip_title   text check (clip_title is null or char_length(clip_title) <= 200),
  clip_thumb   text check (clip_thumb is null or char_length(clip_thumb) <= 500),
  word         text check (word is null or char_length(word) <= 3000),
  drawing_path text check (drawing_path is null or char_length(drawing_path) <= 200)
);

create index if not exists fiches_status_created_idx
  on public.fiches (status, created_at);

alter table public.fiches enable row level security;


-- 4) Droits sur les colonnes
--    On retire tout, puis on redonne seulement le nécessaire.
revoke all on public.fiches from anon, authenticated;

-- Public : lecture de quelques colonnes seulement (pas « word », pas « status »).
grant select (id, pseudo, game, clip, clip_title, clip_thumb, drawing_path)
  on public.fiches to anon;

-- Comptes connectés (équipe) : lecture de tout, modification du statut seulement.
grant select on public.fiches to authenticated;
grant update (status) on public.fiches to authenticated;


-- 5) Règles d'accès (lignes visibles)
drop policy if exists "public_resume_valide"    on public.fiches;
drop policy if exists "moderateurs_lecture"     on public.fiches;
drop policy if exists "moderateurs_statut"      on public.fiches;
drop policy if exists "streamer_lecture"        on public.fiches;

-- Public : fiches validées, une fois le résumé ouvert.
create policy "public_resume_valide"
  on public.fiches
  for select
  to anon
  using (status = 'approved' and public.resume_ouvert());

-- Modérateurs : toutes les fiches, tout le temps.
create policy "moderateurs_lecture"
  on public.fiches
  for select
  to authenticated
  using (public.est_equipe(array['moderateur']));

-- Modérateurs : changer le statut (seule colonne modifiable, voir plus haut).
create policy "moderateurs_statut"
  on public.fiches
  for update
  to authenticated
  using (public.est_equipe(array['moderateur']))
  with check (public.est_equipe(array['moderateur']));

-- Streamer : fiches validées, avec les mots, une fois le résumé ouvert.
create policy "streamer_lecture"
  on public.fiches
  for select
  to authenticated
  using (
    status = 'approved'
    and public.resume_ouvert()
    and public.est_equipe(array['streamer'])
  );


-- 6) Dessins : un espace de stockage dont les images sont lisibles par lien.
--    Les noms de fichiers sont aléatoires et on ne peut pas lister le contenu.
--    Personne ne peut envoyer de fichier directement : seule la fonction serveur le fait.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dessins', 'dessins', true, 300000, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- 7) PLUS TARD, une fois les comptes créés (Authentication > Users > Add user),
--    on leur donne un rôle. Remplacer les adresses, retirer les « -- », puis lancer.
--
-- insert into public.equipe (user_id, role)
--   select id, 'moderateur' from auth.users where email = 'moderateur@exemple.fr'
--   on conflict (user_id) do update set role = excluded.role;
--
-- insert into public.equipe (user_id, role)
--   select id, 'streamer' from auth.users where email = 'tone@exemple.fr'
--   on conflict (user_id) do update set role = excluded.role;
