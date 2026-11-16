-- =====================================================================
-- 0138  An item's description never degrades to its SKU
--
-- 10 Nov 2026: item names showed as their SKU everywhere they are read from
-- items.description: Inventory, the Excel exports, the picklists, the SAP
-- reconciliation ("550062462 550062462"). import_snapshot (0002 ... 0132)
-- inserts coalesce(description, sku) and, on an existing item, keeps the old
-- description only when the new one is empty; a row sent without a
-- description arrives as the SKU, which is not empty, and overwrote the real
-- name. The Import page sends description: null for a sheet without that
-- column, and so did the 9 Nov stock rebase (import_snapshot from a script).
--
-- Now a trigger keeps the stored name whenever an update would replace a real
-- name with nothing or with the SKU itself, whichever path the update comes
-- from. A new item without a name still starts as its SKU (as before), and a
-- real new name still replaces the old one.
-- =====================================================================

create or replace function public.items_keep_description() returns trigger language plpgsql as $$
begin
  if (nullif(trim(coalesce(new.description, '')), '') is null or trim(new.description) = new.sku)
     and nullif(trim(coalesce(old.description, '')), '') is not null and trim(old.description) <> old.sku then
    new.description := old.description;
  end if;
  return new;
end $$;

drop trigger if exists items_keep_description on public.items;

create trigger items_keep_description before update of description on public.items
  for each row execute function public.items_keep_description();
