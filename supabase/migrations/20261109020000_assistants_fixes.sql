-- Assistants, after review (v73): a command's times, status and result are the server's, not
-- what the sender wrote (an assistant could backdate a command past the page's "only right
-- away" rule for starting sound or the mic).
create function private.device_commands_pin() returns trigger
  language plpgsql security invoker set search_path = '' as $$
begin
  new.created_at := now();
  new.updated_at := now();
  new.status := 'sent';
  new.result := null;
  return new;
end $$;
create trigger device_commands_pin before insert on public.device_commands
  for each row execute function private.device_commands_pin();
