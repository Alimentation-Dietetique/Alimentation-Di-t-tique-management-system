-- =====================================================================
--  Alimentation Diététique — management system schema (Supabase / Postgres)
--  Run this ENTIRE file once in Supabase → SQL Editor → New query → Run.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- enums ----------
do $$ begin
  create type business_type as enum ('books','tofu','cantine');
exception when duplicate_object then null; end $$;

do $$ begin
  create type price_kind as enum ('detail','supply');
exception when duplicate_object then null; end $$;

-- ---------- products ----------
create table if not exists products (
  id           uuid primary key default gen_random_uuid(),
  business     business_type not null,
  name         text not null,
  unit         text not null default 'piece',          -- 'piece', 'kg', ...
  price_detail numeric(12,2) not null default 0,        -- normal price
  price_supply numeric(12,2),                           -- bulk / supplier price (null = n/a, e.g. cantine)
  price_tiers  jsonb,                                   -- optional, mainly tofu:
                                                        -- [{"label":"1kg","qty":1,"detail":1500,"supply":1300}, ...]
  track_stock  boolean not null default true,
  stock        numeric(12,3) not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------- customers ----------
create table if not exists customers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  note       text,
  created_at timestamptz not null default now()
);

-- ---------- sales (one per receipt) ----------
create table if not exists sales (
  id          uuid primary key default gen_random_uuid(),
  business    business_type not null,
  price_type  price_kind not null default 'detail',
  customer_id uuid references customers(id) on delete set null,
  total       numeric(12,2) not null,
  amount_paid numeric(12,2) not null default 0,          -- outstanding = total - amount_paid (a debt when > 0)
  seller      text,
  note        text,
  created_at  timestamptz not null default now()
);

create table if not exists sale_items (
  id           uuid primary key default gen_random_uuid(),
  sale_id      uuid not null references sales(id) on delete cascade,
  product_id   uuid references products(id) on delete set null,
  product_name text not null,                            -- snapshot, survives product edits/deletes
  quantity     numeric(12,3) not null,
  unit_price   numeric(12,2) not null,
  line_total   numeric(12,2) not null
);

-- ---------- payments against debts ----------
create table if not exists payments (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid references sales(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  amount      numeric(12,2) not null,
  note        text,
  created_at  timestamptz not null default now()
);

-- ---------- expenses (business null = overall / shared) ----------
create table if not exists expenses (
  id         uuid primary key default gen_random_uuid(),
  business   business_type,                              -- null = shared (rent, staff food, transport)
  category   text not null,
  amount     numeric(12,2) not null,
  note       text,
  created_at timestamptz not null default now()
);

-- ---------- stock movement audit ----------
create table if not exists stock_movements (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  change     numeric(12,3) not null,                     -- + restock, - sale
  reason     text not null,                              -- 'sale','restock','adjustment'
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_created  on sales (created_at);
create index if not exists idx_sales_business on sales (business);
create index if not exists idx_items_sale     on sale_items (sale_id);
create index if not exists idx_exp_created    on expenses (created_at);
create index if not exists idx_pay_sale       on payments (sale_id);
create index if not exists idx_prod_business  on products (business);

-- =====================================================================
--  RPC: create a whole sale atomically (sale + items + stock decrement)
--  Client calls: supabase.rpc('create_sale', { payload: {...} })
-- =====================================================================
create or replace function create_sale(payload jsonb)
returns uuid
language plpgsql
security definer
as $$
declare
  v_sale_id uuid;
  v_item    jsonb;
  v_total   numeric(12,2) := 0;
  v_paid    numeric(12,2);
begin
  for v_item in select * from jsonb_array_elements(payload->'items') loop
    v_total := v_total + (v_item->>'line_total')::numeric;
  end loop;

  -- if amount_paid omitted -> treat as fully paid
  v_paid := coalesce(nullif(payload->>'amount_paid','')::numeric, v_total);

  insert into sales (business, price_type, customer_id, total, amount_paid, seller, note)
  values (
    (payload->>'business')::business_type,
    coalesce((payload->>'price_type')::price_kind, 'detail'),
    nullif(payload->>'customer_id','')::uuid,
    v_total,
    v_paid,
    payload->>'seller',
    payload->>'note'
  )
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(payload->'items') loop
    insert into sale_items (sale_id, product_id, product_name, quantity, unit_price, line_total)
    values (
      v_sale_id,
      nullif(v_item->>'product_id','')::uuid,
      v_item->>'product_name',
      (v_item->>'quantity')::numeric,
      (v_item->>'unit_price')::numeric,
      (v_item->>'line_total')::numeric
    );

    if nullif(v_item->>'product_id','') is not null then
      update products
        set stock = stock - (v_item->>'quantity')::numeric
        where id = (v_item->>'product_id')::uuid and track_stock = true;

      insert into stock_movements (product_id, change, reason)
      select (v_item->>'product_id')::uuid, -1 * (v_item->>'quantity')::numeric, 'sale'
      where exists (select 1 from products
                    where id = (v_item->>'product_id')::uuid and track_stock = true);
    end if;
  end loop;

  return v_sale_id;
end;
$$;

-- =====================================================================
--  RPC: record a payment against a debt
-- =====================================================================
create or replace function record_payment(p_sale_id uuid, p_amount numeric, p_note text default null)
returns void
language plpgsql
security definer
as $$
begin
  insert into payments (sale_id, customer_id, amount, note)
  select p_sale_id, s.customer_id, p_amount, p_note from sales s where s.id = p_sale_id;

  update sales set amount_paid = amount_paid + p_amount where id = p_sale_id;
end;
$$;

-- =====================================================================
--  RPC: restock a product
-- =====================================================================
create or replace function restock_product(p_product_id uuid, p_qty numeric, p_note text default null)
returns void
language plpgsql
security definer
as $$
begin
  update products set stock = stock + p_qty where id = p_product_id;
  insert into stock_movements (product_id, change, reason, note)
  values (p_product_id, p_qty, 'restock', p_note);
end;
$$;

-- =====================================================================
--  RPC: cancel / delete a sale and restore stock
-- =====================================================================
create or replace function delete_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_item record;
begin
  for v_item in select product_id, quantity from sale_items where sale_id = p_sale_id loop
    if v_item.product_id is not null then
      update products set stock = stock + v_item.quantity where id = v_item.product_id and track_stock = true;
      insert into stock_movements (product_id, change, reason, note)
      values (v_item.product_id, v_item.quantity, 'adjustment', 'Sale cancelled/deleted');
    end if;
  end loop;

  delete from sales where id = p_sale_id;
end;
$$;

-- =====================================================================
--  Row Level Security — internal tool, any signed-in user has full access
-- =====================================================================
alter table products        enable row level security;
alter table customers       enable row level security;
alter table sales           enable row level security;
alter table sale_items      enable row level security;
alter table payments        enable row level security;
alter table expenses        enable row level security;
alter table stock_movements enable row level security;

do $$
declare t text;
begin
  foreach t in array array['products','customers','sales','sale_items','payments','expenses','stock_movements']
  loop
    execute format('drop policy if exists auth_all on %I;', t);
    execute format('create policy auth_all on %I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;

grant execute on function create_sale(jsonb)                  to authenticated;
grant execute on function record_payment(uuid, numeric, text) to authenticated;
grant execute on function restock_product(uuid, numeric, text) to authenticated;
grant execute on function delete_sale(uuid)                  to authenticated;

