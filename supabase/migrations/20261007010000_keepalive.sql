-- Razão — batimento contra a pausa por inatividade do Supabase gratuito
--
-- O plano gratuito pausa o projeto depois de 7 dias sem atividade. Uma leitura anônima em finance_data
-- (o que o cron fazia até aqui) volta vazia por causa do RLS e não bastou: o projeto pausou mesmo com o
-- cron diário. Esta função GRAVA um horário numa tabela de uma linha só, o que é atividade real no
-- banco, e é chamada todo dia por dois agendadores independentes (cron da Vercel em /api/keepalive e
-- GitHub Actions em .github/workflows/keepalive.yml).
--
-- Pode rodar de novo sem estragar nada.

create table if not exists public.keepalive_heartbeat (
  id        smallint    primary key default 1 check (id = 1),  -- sempre uma linha só
  pinged_at timestamptz not null default now(),
  source    text
);

-- RLS ligado e nenhuma política: ninguém lê nem grava esta tabela direto pela API, só pela função abaixo
alter table public.keepalive_heartbeat enable row level security;

create or replace function public.keepalive_ping(origem text default 'cron')
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  insert into public.keepalive_heartbeat (id, pinged_at, source)
  values (1, now(), left(coalesce(origem, 'cron'), 40))
  on conflict (id) do update set pinged_at = excluded.pinged_at, source = excluded.source
  returning pinged_at;
$$;

-- a chave anônima é pública (está no app), então qualquer um pode chamar — e tudo bem: a função só
-- atualiza o horário de uma linha, não lê nem expõe dado nenhum
revoke all on function public.keepalive_ping(text) from public;
grant execute on function public.keepalive_ping(text) to anon, authenticated;
