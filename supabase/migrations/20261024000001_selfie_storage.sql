-- Phase 3: private selfie storage. Browser clients may access only their own
-- device-session folder; admins will use server-side signed URLs in Phase 6.

insert into storage.buckets (id, name, public)
values ('selfies', 'selfies', false)
on conflict (id) do update set public = false;

create policy "players can read their own selfies"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'selfies'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "players can upload their own selfies"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'selfies'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "players can replace their own selfies"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'selfies'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'selfies'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
