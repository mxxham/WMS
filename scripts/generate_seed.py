#!/usr/bin/env python3
"""
Generate supabase/seed.sql and docs/DATA_ISSUES.md from the WMS workbook.

Usage: python3 scripts/generate_seed.py path/to/Warehouse_Management_System.xlsx

Reads cached values (data_only) from:
  WMS          -> bins + opening stock (Lokasi, Batch, GR date, Expired Date, item, Remain Qty)
  MASTER DATA  -> UPP, VOLUME per SKU
  Master SKU   -> base unit of measure
  K_ONE        -> pick lines, used only to derive a provisional ABC class
Nothing is invented: rows with problems are imported as-is where safe and
always listed in DATA_ISSUES.md; rows that cannot be imported are listed too.
"""
import sys, re, datetime, collections
from openpyxl import load_workbook

SRC = sys.argv[1] if len(sys.argv) > 1 else "Warehouse_Management_System.xlsx"
TODAY = datetime.date(2026, 9, 24)  # snapshot date of the file
RACK = re.compile(r"^(C[A-Z])(\d{2})([A-E])(\d{2})$")

wb = load_workbook(SRC, read_only=True, data_only=True)
issues = collections.defaultdict(list)

def q(v):
    if v is None: return "null"
    return "'" + str(v).replace("'", "''") + "'"

# ---------- master data ----------
upp, vol = {}, {}
for r in list(wb["MASTER DATA"].iter_rows(values_only=True))[1:]:
    if r[0]: upp[str(r[0])] = r[4]; vol[str(r[0])] = r[5]
base_uom, sku_desc = {}, {}
for r in list(wb["Master SKU"].iter_rows(values_only=True))[2:]:
    if r[1]: base_uom[str(r[1])] = r[3]; sku_desc[str(r[1])] = r[2]

# ---------- provisional ABC from K_ONE pick lines ----------
lines = collections.Counter()
for r in list(wb["K_ONE"].iter_rows(values_only=True))[2:]:
    mat, to_loc, task = r[7], r[9], r[17]
    if mat and not to_loc and task == "completed":  # pick line (not a replenishment move)
        lines[str(mat)] += 1
total = sum(lines.values()); abc = {}; cum = 0
for sku, n in sorted(lines.items(), key=lambda x: (-x[1], x[0])):
    cum += n; abc[sku] = "A" if cum / total <= 0.80 else ("B" if cum / total <= 0.95 else "C")

# ---------- WMS rows ----------
bins, stock, items = {}, {}, {}
for i, r in enumerate(wb["WMS"].iter_rows(min_row=5, max_col=41, values_only=True), start=5):
    loc = r[7]
    if loc is None and all(v is None for v in r[:15]): continue
    if loc is None: issues["Baris tanpa kode bin (tidak diimpor)"].append(f"baris {i}"); continue
    code = str(loc).strip().upper()
    m = RACK.match(code)
    if m:
        zone, rack, level, pos, status = m[1], m[2], m[3], m[4], "active"
    elif code in ("STAGING",):
        zone, rack, level, pos, status = "STAGING", None, None, None, "active"
    elif code == "QUARANTINE":
        zone, rack, level, pos, status = "QUARANTINE", None, None, None, "blocked"
    elif re.match(r"^STG_\d{2}$", code):
        zone, rack, level, pos, status = "STAGING", None, None, code[4:], "active"
    else:
        issues["Format kode bin tidak dikenal (tidak diimpor)"].append(f"baris {i}: {code}"); continue
    bins.setdefault(code, (zone, rack, level, pos, status))
    if r[34] == "#N/A" and m:
        issues["Aisle tidak ada di tabel status 'warehouse mapping' (diimpor sebagai active)"].append(zone)

    sku = r[11]; qty = r[21]
    if sku is None:
        if not isinstance(qty, (int, float)):
            issues["Qty error formula Excel (bin diimpor, stok tidak)"].append(f"baris {i}: {code} Remain Qty = {qty}")
        continue
    sku = str(sku)
    if not isinstance(qty, (int, float)):
        issues["Qty error formula Excel (bin diimpor, stok tidak)"].append(f"baris {i}: {code} SKU {sku} Remain Qty = {qty}"); continue
    if qty < 0:
        issues["Qty negatif (tidak diimpor)"].append(f"baris {i}: {code} SKU {sku} qty {qty}"); continue
    if qty == 0:
        issues["SKU tercatat di bin tetapi Remain Qty = 0 (stok tidak dibuat)"].append(f"{code} SKU {sku}"); continue

    batch = r[8]
    if batch is None:
        batch = ""; issues["Batch kosong (diimpor dengan batch kosong)"].append(f"baris {i}: {code} SKU {sku}")
    elif isinstance(batch, datetime.datetime):
        issues["Batch terbaca sebagai tanggal oleh Excel, isi asli hilang (diimpor sebagai teks tanggal)"].append(
            f"baris {i}: {code} SKU {sku} -> {batch.date()}")
        batch = batch.date().isoformat()
    else:
        batch = str(batch).strip()

    exp = r[10]
    if isinstance(exp, datetime.datetime):
        exp = exp.date()
        if exp < TODAY:
            issues["Expired date sudah lewat per 24-Sep-2026 (diimpor, tampil merah)"].append(f"baris {i}: {code} SKU {sku} exp {exp}")
    else:
        if code != "QUARANTINE":
            issues["Expired date kosong/tidak valid (diimpor tanpa tanggal)"].append(f"baris {i}: {code} SKU {sku} nilai={exp!r}")
        exp = None
    gr = r[9].date() if isinstance(r[9], datetime.datetime) else None

    key = (code, sku, batch)
    if key in stock:
        issues["Duplikat bin+SKU+batch (qty dijumlahkan)"].append(f"baris {i}: {key}")
        stock[key]["qty"] += qty
    else:
        stock[key] = {"qty": qty, "exp": exp, "gr": gr}
    desc = r[12] if r[12] not in (None, "", "#N/A") else sku_desc.get(sku, sku)
    items.setdefault(sku, desc)
    if sku not in base_uom: issues["SKU tidak ada di sheet Master SKU (UoM kosong)"].append(sku)
    if sku not in upp: issues["SKU tidak ada di MASTER DATA (UPP kosong, utilisasi tidak dihitung)"].append(sku)

# Rack gaps (e.g. pillars) so the reviewer can confirm they are intentional.
racks = collections.defaultdict(set)
for c, (z, rk, lv, p, s) in bins.items():
    if rk: racks[z].add(int(rk))
for z, s in sorted(racks.items()):
    miss = sorted(set(range(1, max(s) + 1)) - s)
    if miss: issues["Nomor rak tidak ada di data (cek: tiang/pilar?)"].append(f"{z}: {', '.join(f'{m:02d}' for m in miss)}")

# ---------- seed.sql ----------
out = ["-- Generated by scripts/generate_seed.py from " + SRC.split('/')[-1],
       "-- Opening stock is posted as 'adjustment' movements so it is traceable in the ledger.",
       "begin;"]
out.append("insert into public.bins (bin_code, zone, rack, level, position, status, capacity) values")
out.append(",\n".join(f"({q(c)},{q(z)},{q(rk)},{q(lv)},{q(p)},{q(s)},{1 if rk else 'null'})" for c, (z, rk, lv, p, s) in sorted(bins.items())))
out.append("on conflict (bin_code) do nothing;")
out.append("insert into public.items (sku, description, uom, upp, volume_l, abc_class) values")
out.append(",\n".join(
    f"({q(s)},{q(d)},{q(base_uom.get(s))},{q(upp.get(s)) if upp.get(s) is not None else 'null'},"
    f"{round(vol[s], 3) if vol.get(s) is not None else 'null'},{q(abc.get(s, 'C'))})"
    for s, d in sorted(items.items())))
out.append("on conflict (sku) do nothing;")
out.append("insert into public.movements (type, item_id, batch_lot, quantity, to_bin_id, expiry_date, received_date, note)")
out.append("select 'adjustment', it.id, v.batch, v.qty, b.id, v.exp::date, v.gr::date, 'OPENING BALANCE WMS 24-Sep-2026'")
out.append("from (values")
out.append(",\n".join(f"({q(c)},{q(s)},{q(b)},{v['qty']},{q(v['exp'])},{q(v['gr'])})" for (c, s, b), v in sorted(stock.items())))
out.append(") as v(bin, sku, batch, qty, exp, gr)")
out.append("join public.bins b on b.bin_code = v.bin join public.items it on it.sku = v.sku;")
out.append("select public.recompute_bin_positions();")
out.append("commit;")
open("supabase/seed.sql", "w").write("\n".join(out) + "\n")

# ---------- report ----------
rep = ["# Laporan kualitas data WMS (snapshot 24 September 2026)", "",
       f"Sumber: `{SRC.split('/')[-1]}`, sheet `WMS` (+ MASTER DATA, Master SKU, K_ONE).", "",
       f"- Bin diimpor: **{len(bins)}** ({sum(1 for v in bins.values() if v[1])} bin rak, {sum(1 for v in bins.values() if not v[1])} lokasi lantai)",
       f"- SKU: **{len(items)}**", f"- Baris stok (bin+SKU+batch, qty > 0): **{len(stock)}**",
       f"- Total qty: **{sum(v['qty'] for v in stock.values()):,.0f}**",
       f"- ABC sementara dari {total} baris picking K_ONE: A={sum(1 for x in abc.values() if x=='A')}, "
       f"B={sum(1 for x in abc.values() if x=='B')}, C={sum(1 for x in abc.values() if x=='C')} SKU; SKU tanpa picking = C.", "",
       "Tidak ada baris yang dibuang diam-diam. Semua kasus di bawah perlu dicek dengan tim gudang.", ""]
for k, v in issues.items():
    uniq = list(dict.fromkeys(v))
    rep.append(f"## {k} ({len(uniq)})")
    rep += [f"- {x}" for x in uniq[:60]]
    if len(uniq) > 60: rep.append(f"- … dan {len(uniq) - 60} lainnya")
    rep.append("")
open("docs/DATA_ISSUES.md", "w").write("\n".join(rep))
print(f"bins={len(bins)} items={len(items)} stock_rows={len(stock)} issues={ {k: len(set(v)) for k, v in issues.items()} }")
