-- Razão — tabelas relacionais (contas, movimentos, orçamentos) + tempo real
--
-- Como aplicar: Supabase → SQL Editor → cole este arquivo inteiro → Run. Pode rodar de novo sem
-- estragar nada (tudo é "if not exists" / recria as políticas).
--
-- O que muda: NADA é apagado nem migrado à força. A tabela finance_data (um registro JSON por usuário)
-- continua sendo a fonte principal do app. Estas tabelas recebem uma cópia normalizada — o app mantém
-- tudo sincronizado sozinho depois de cada salvamento — e servem para consultar por SQL (Power BI,
-- relatórios) e para a sincronização do Open Finance no servidor (api/sync). Enquanto este arquivo não
-- for aplicado, o app simplesmente segue só com finance_data, sem erro.

-- ---------------------------------------------------------------- contas e cartões
create table if not exists public.bank_accounts (
  user_id         uuid        not null references auth.users(id) on delete cascade,
  id              text        not null,              -- mesmo id da conta no app
  name            text        not null,
  bank_name       text,                              -- BTG Pactual, Nubank, Bradesco, Itaú…
  kind            text        not null check (kind in ('conta','cartao')),
  account_number  text,                              -- final da conta/cartão, quando conhecido
  balance         numeric(14,2),                     -- saldo informado pelo banco, ou calculado pelos lançamentos
  opening_balance numeric(14,2) not null default 0,
  pluggy_item_id  text,                              -- conexão do Open Finance que alimenta esta conta
  last_sync       timestamptz,
  sync_status     text        check (sync_status in ('active','pending','error')),
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (user_id, id)
);

-- ---------------------------------------------------------------- movimentos (lançamentos)
create table if not exists public.movements (
  user_id         uuid        not null references auth.users(id) on delete cascade,
  id              text        not null,              -- mesmo id do lançamento no app
  bank_account_id text,
  to_account_id   text,                              -- só em transferência (destino)
  type            text        not null check (type in ('gasto','ganho','investimento','transferencia')),
  category        text,
  amount          numeric(14,2) not null,            -- positivo = renda; negativo = despesa, investimento ou saída de transferência
  payment_method  text,                              -- pix, credito, debito, dinheiro, boleto, deposito, ted
  date            date        not null,
  description     text,
  status          text        not null default 'realizado' check (status in ('realizado','previsto')),
  source          text        not null default 'manual', -- manual | pluggy_sync | importacao
  external_id     text,                              -- id do lançamento no Pluggy (chave contra duplicata)
  series_id       text,                              -- recorrência/parcelamento
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists movements_user_date on public.movements (user_id, date desc);
-- o mesmo lançamento do banco nunca entra duas vezes para o mesmo usuário
create unique index if not exists movements_user_external_id on public.movements (user_id, external_id) where external_id is not null;

-- ---------------------------------------------------------------- orçamentos
create table if not exists public.budgets (
  user_id         uuid        not null references auth.users(id) on delete cascade,
  id              text        not null,              -- "<categoria>|<mês>"
  category        text        not null,
  limit_amount    numeric(14,2) not null,
  month_year      text        not null,              -- 'padrao' (todos os meses) ou 'AAAA-MM' (só aquele mês)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (user_id, id)
);

-- ---------------------------------------------------------------- updated_at automático
create or replace function public.razao_set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
do $$
declare t text;
begin
  foreach t in array array['bank_accounts','movements','budgets'] loop
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.razao_set_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------- segurança (RLS): cada um só vê o que é seu
alter table public.bank_accounts enable row level security;
alter table public.movements     enable row level security;
alter table public.budgets       enable row level security;
do $$
declare t text;
begin
  foreach t in array array['bank_accounts','movements','budgets'] loop
    execute format('drop policy if exists "dono le e grava" on public.%I', t);
    execute format('create policy "dono le e grava" on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- tempo real
-- o app escuta mudanças no próprio registro de finance_data para recarregar sozinho quando outro
-- aparelho salva. Sem isto, ele continua funcionando, só sem o recarregamento instantâneo.
do $$
begin
  alter publication supabase_realtime add table public.finance_data;
exception
  when duplicate_object then null;  -- já estava publicada
  when undefined_object then null;  -- projeto sem a publicação padrão do Realtime
end $$;
