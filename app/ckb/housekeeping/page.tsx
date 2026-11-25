import type { Metadata } from "next";
import { requireCkb } from "@/lib/ckb/auth";
import { createClient } from "@/lib/supabase/server";
import { isLead } from "@/lib/ckb/permissions";
import { isUuid } from "@/lib/ckb/evidence";
import { addDays, jakartaToday, monthEnd, monthStart, weekStart, type GridRow } from "@/lib/ckb/housekeeping";
import { lastWeeks } from "@/lib/ckb/hk-quality";
import { TabsNav } from "@/components/app/tabs-nav";
import { CkbBody, CkbHeader, EmptyState, Notice } from "@/components/ckb/ui";
import { UploadQueueRunner } from "./upload-queue";
import { FindingsTab } from "./tabs/findings-tab";
import { QualityTab, type FindingRow, type ScoreItem } from "./tabs/quality-tab";
import type { ChecklistItem } from "./score-dialog";
import type { CustomerFinding, QualityCell } from "./tabs/customer-quality";
import { AreasClient, type Absence, type AreaRow, type Holiday, type PicRow, type Staff } from "./tabs/areas-tab";
import { CustomerTab, type Compliance, type WeekCell } from "./tabs/customer-tab";
import { HistoryTab } from "./tabs/history-tab";
import { RecapTab, type QueueItem } from "./tabs/recap-tab";
import { PicToday, type MyDay } from "./tabs/today-tab";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Housekeeping" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BASE = "/ckb/housekeeping";
type Sp = Record<string, string | undefined>;
type Db = Awaited<ReturnType<typeof createClient>>;

export default async function HousekeepingPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const user = await requireCkb(BASE);
  const sp = await searchParams;
  const db = await createClient();
  const today = jakartaToday();

  if (user.ckbRole === "customer") return <CustomerPage db={db} ids={user.customerIds} sp={sp} today={today} />;

  const lead = isLead(user.ckbRole);
  // A lead sees "Hari ini" only when they own racks themselves.
  const own = lead ? await db.from("ckb_hk_assignments").select("area_id", { count: "exact", head: true }).eq("pic_user_id", user.id).is("to_date", null) : null;
  const hasToday = !lead || (own?.count ?? 0) > 0;
  const [queueCount, fixedCount, openCount] = await Promise.all([
    lead ? db.from("ckb_hk_checkins").select("id", { count: "exact", head: true }).eq("status", "SUBMITTED") : null,
    lead ? db.from("ckb_hk_findings").select("id", { count: "exact", head: true }).eq("status", "FIXED") : null,
    lead ? null : db.from("ckb_hk_findings").select("id", { count: "exact", head: true }).eq("status", "OPEN"),   // RLS: only the racks the PIC holds
  ]);

  const tabs = lead
    ? [{ key: "recap", label: "Rekap", badge: queueCount?.count ?? 0 }, { key: "quality", label: "Kualitas", badge: fixedCount?.count ?? 0 }, { key: "areas", label: "Area & PIC" }, ...(hasToday ? [{ key: "today", label: "Hari ini" }] : [])]
    : [{ key: "today", label: "Hari ini" }, { key: "findings", label: "Temuan", badge: openCount?.count ?? 0 }, { key: "history", label: "Riwayat" }];
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? tabs[0].key;   // a hand-edited ?tab= falls back to the default

  return (
    <main>
      <CkbHeader title="Housekeeping" live={["ckb_hk_checkins", "ckb_hk_findings", "ckb_hk_scores"]}
        subtitle={lead ? "Siapa sudah mengirim foto, siapa terlewat, dan apa yang perlu ditinjau." : "Foto sebelum dan sesudah untuk setiap rak Anda, Senin sampai Jumat."} />
      <TabsNav base={BASE} tabs={tabs} active={tab} />
      <CkbBody>
        <UploadQueueRunner userId={user.id} />
        {tab === "recap" && <RecapPage db={db} sp={sp} today={today} />}
        {tab === "quality" && <QualityPage db={db} sp={sp} today={today} userId={user.id} isAdmin={user.ckbRole === "admin"} />}
        {tab === "findings" && <FindingsPage db={db} today={today} />}
        {tab === "areas" && <AreasPage db={db} today={today} isAdmin={user.ckbRole === "admin"} />}
        {(tab === "today" || tab === "history") && <PicPage db={db} today={today} history={tab === "history"} />}
      </CkbBody>
    </main>
  );
}

async function settings(db: Db) {
  const { data } = await db.from("ckb_settings").select("value").eq("key", "housekeeping").maybeSingle();
  const set = (data?.value ?? {}) as { late_window_working_days?: number; max_photos_per_kind?: number; max_edge_px?: number };
  return { windowDays: set.late_window_working_days ?? 3, maxPerKind: set.max_photos_per_kind ?? 3, maxEdge: set.max_edge_px ?? 1600 };
}

async function PicPage({ db, today, history }: { db: Db; today: string; history: boolean }) {
  const from = addDays(today, history ? -30 : -10);
  const [days, hol, set] = await Promise.all([
    db.rpc("ckb_hk_my_days", { p_from: from, p_to: today }),
    db.from("ckb_hk_holidays").select("holiday_date").gte("holiday_date", from).lte("holiday_date", today),
    settings(db),
  ]);
  const err = days.error ?? hol.error;
  return (
    <>
      {err && <Notice tone="bad">Housekeeping tidak bisa dimuat: {err.message}</Notice>}
      {history
        ? <HistoryTab rows={(days.data ?? []) as MyDay[]} today={today} />
        : <PicToday rows={(days.data ?? []) as MyDay[]} holidays={(hol.data ?? []).map((h) => h.holiday_date as string)} today={today}
            windowDays={set.windowDays} maxPerKind={set.maxPerKind} maxEdge={set.maxEdge} />}
    </>
  );
}

async function RecapPage({ db, sp, today }: { db: Db; sp: Sp; today: string }) {
  const monday = weekStart(DATE.test(sp.week ?? "") ? sp.week! : today);
  const customerId = isUuid(sp.c) ? sp.c : null;
  const [recap, customers, queue, total, set] = await Promise.all([
    db.rpc("ckb_hk_recap", { p_from: monday, p_to: addDays(monday, 4), p_customer: customerId }),
    db.from("ckb_customers").select("id, name").order("name"),
    db.from("ckb_hk_checkins").select("id, work_date, attempt, late, on_behalf_by, pic_name, submitted_at, area_id, ckb_hk_areas(code, name), ckb_hk_photos(id, kind, withdrawn_at)")
      .eq("status", "SUBMITTED").order("submitted_at", { ascending: true }).limit(50),
    db.from("ckb_hk_checkins").select("id", { count: "exact", head: true }).eq("status", "SUBMITTED"),
    settings(db),
  ]);
  const error = recap.error ?? queue.error;
  return (
    <>
      {error && <Notice tone="bad">Rekap tidak bisa dimuat: {error.message}</Notice>}
      <RecapTab monday={monday} today={today} rows={(recap.data ?? []) as GridRow[]} queue={(queue.data ?? []) as unknown as QueueItem[]} queueTotal={total.count ?? 0}
        customers={(customers.data ?? []) as { id: string; name: string }[]} customerId={customerId} maxPerKind={set.maxPerKind} maxEdge={set.maxEdge} />
    </>
  );
}

const FINDING_COLUMNS = "id, area_id, item_label, description, evidence_photo_id, due_date, status, raised_by, raised_name, raised_at, fixed_by, fixed_name, fixed_at, fix_note, fix_photo_id, verified_name, verified_at, verify_note, reopen_count, reopen_note, cancel_reason, ckb_hk_areas(code, name)";

async function QualityPage({ db, sp, today, userId, isAdmin }: { db: Db; sp: Sp; today: string; userId: string; isAdmin: boolean }) {
  const week = weekStart(DATE.test(sp.week ?? "") ? sp.week! : today);
  const customerId = isUuid(sp.c) ? sp.c : null;
  const since = lastWeeks(today, 8)[0];
  let scoresQ = db.from("ckb_hk_scores").select("area_id, week_start, version, pct, scored_name").gte("week_start", since).order("week_start");
  let findingsQ = db.from("ckb_hk_findings").select(FINDING_COLUMNS).order("raised_at", { ascending: false }).limit(300);
  if (customerId) { scoresQ = scoresQ.eq("customer_id", customerId); findingsQ = findingsQ.eq("customer_id", customerId); }
  const [recap, customers, items, scores, findings] = await Promise.all([
    db.rpc("ckb_hk_recap", { p_from: week, p_to: addDays(week, 4), p_customer: customerId }),
    db.from("ckb_customers").select("id, name").order("name"),
    db.from("ckb_hk_checklist_items").select("id, label, sort, active").order("sort"),
    scoresQ.limit(5000), findingsQ,
  ]);
  const error = recap.error ?? items.error ?? scores.error ?? findings.error;
  return (
    <>
      {error && <Notice tone="bad">Kualitas tidak bisa dimuat: {error.message}</Notice>}
      <QualityTab week={week} today={today} userId={userId} isAdmin={isAdmin} rows={(recap.data ?? []) as GridRow[]} scores={(scores.data ?? []) as ScoreItem[]}
        items={(items.data ?? []) as ChecklistItem[]} findings={(findings.data ?? []) as unknown as FindingRow[]}
        customers={(customers.data ?? []) as { id: string; name: string }[]} customerId={customerId} />
    </>
  );
}

async function FindingsPage({ db, today }: { db: Db; today: string }) {
  // RLS returns only the racks this PIC holds.
  const { data, error } = await db.from("ckb_hk_findings").select(FINDING_COLUMNS).in("status", ["OPEN", "FIXED", "VERIFIED"]).order("raised_at", { ascending: false }).limit(100);
  return (
    <>
      {error && <Notice tone="bad">Temuan tidak bisa dimuat: {error.message}</Notice>}
      <FindingsTab findings={(data ?? []) as unknown as FindingRow[]} today={today} />
    </>
  );
}

async function AreasPage({ db, today, isAdmin }: { db: Db; today: string; isAdmin: boolean }) {
  const since = addDays(today, -90);
  const [areas, pics, customers, staff, holidays, absences] = await Promise.all([
    db.from("ckb_hk_areas").select("id, code, name, kind, customer_id, active, note").order("code").limit(1000),
    db.from("ckb_hk_assignments").select("area_id, pic_user_id, pic_name, from_date").is("to_date", null).limit(1000),
    db.from("ckb_customers").select("id, name").eq("active", true).order("name"),
    db.rpc("ckb_hk_staff"),
    db.from("ckb_hk_holidays").select("holiday_date, reason").gte("holiday_date", since).order("holiday_date", { ascending: false }).limit(60),
    db.from("ckb_hk_absences").select("id, user_id, from_date, to_date, reason, recorded_name").gte("to_date", since).order("from_date", { ascending: false }).limit(100),
  ]);
  const error = areas.error ?? pics.error ?? staff.error ?? holidays.error ?? absences.error;
  return (
    <>
      {error && <Notice tone="bad">Data tidak bisa dimuat: {error.message}</Notice>}
      <AreasClient areas={(areas.data ?? []) as AreaRow[]} pics={(pics.data ?? []) as PicRow[]} customers={(customers.data ?? []) as { id: string; name: string }[]}
        staff={(staff.data ?? []) as Staff[]} holidays={(holidays.data ?? []) as Holiday[]} absences={(absences.data ?? []) as Absence[]} isAdmin={isAdmin} today={today} />
    </>
  );
}

/** A customer's representative: their racks and locations, read only, no names, no tabs. */
async function CustomerPage({ db, ids, sp, today }: { db: Db; ids: string[]; sp: Sp; today: string }) {
  const { data: cust } = ids.length ? await db.from("ckb_customers").select("id, name").in("id", ids).order("name") : { data: [] };
  const customers = (cust ?? []) as { id: string; name: string }[];
  if (!customers.length) {
    return (
      <main><CkbHeader title="Housekeeping" subtitle="Kebersihan dan kerapian rak customer Anda." />
        <CkbBody><EmptyState title="Belum ada customer untuk akun Anda">Minta admin CKB menetapkan customer untuk akun ini.</EmptyState></CkbBody></main>
    );
  }
  const current = customers.find((c) => c.id === sp.c) ?? customers[0];
  const monday = weekStart(DATE.test(sp.week ?? "") ? sp.week! : today);
  const month = monthStart(DATE.test(sp.month ?? "") ? sp.month! : today);
  const mFrom = month, mTo = monthEnd(month) > today ? today : monthEnd(month);
  const [wk, mk, cw, cm, ql, fd] = await Promise.all([
    db.rpc("ckb_hk_customer_week", { p_customer: current.id, p_from: monday, p_to: addDays(monday, 4) }),
    db.rpc("ckb_hk_customer_week", { p_customer: current.id, p_from: mFrom, p_to: mTo < mFrom ? mFrom : mTo }),
    db.rpc("ckb_hk_compliance", { p_customer: current.id, p_from: monday, p_to: addDays(monday, 4) }),
    db.rpc("ckb_hk_compliance", { p_customer: current.id, p_from: mFrom, p_to: mTo < mFrom ? mFrom : mTo }),
    db.rpc("ckb_hk_customer_quality", { p_customer: current.id, p_from: lastWeeks(today, 8)[0], p_to: today }),
    db.rpc("ckb_hk_customer_findings", { p_customer: current.id }),
  ]);
  const error = wk.error ?? mk.error ?? cw.error ?? cm.error ?? ql.error ?? fd.error;
  return (
    <main>
      <CkbHeader title="Housekeeping" subtitle={`Foto sebelum dan sesudah, setiap hari kerja · ${current.name}`} />
      <CkbBody>
        {error && <Notice tone="bad">Data housekeeping tidak bisa dimuat: {error.message}</Notice>}
        <CustomerTab customerId={current.id} customerName={current.name} customers={customers} monday={monday} month={month} today={today}
          cells={(wk.data ?? []) as WeekCell[]} monthCells={(mk.data ?? []) as WeekCell[]} week={(cw.data ?? []) as Compliance[]} monthComp={(cm.data ?? []) as Compliance[]}
          quality={(ql.data ?? []) as QualityCell[]} findings={(fd.data ?? []) as CustomerFinding[]} />
      </CkbBody>
    </main>
  );
}
