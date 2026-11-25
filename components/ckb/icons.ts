import {
  Archive, Boxes, Building2, ChartColumn, ClipboardCheck, FileDown, FileUp, History, House, Images, LayoutDashboard,
  ListChecks, PackageOpen, Settings, Sparkles, Users, type LucideIcon,
} from "lucide-react";

/** Icon per CKB nav item (`CkbNavItem.icon` in lib/ckb/permissions.ts); the sidebar and the home directory both read it. */
export const CKB_ICONS: Record<string, LucideIcon> = {
  home: House, dashboard: LayoutDashboard, rebag: PackageOpen, inspect: ClipboardCheck, count: ListChecks, inventory: Boxes,
  import: FileUp, export: FileDown, reports: ChartColumn, photos: Images, activity: History, customers: Building2,
  users: Users, settings: Settings, housekeeping: Sparkles,
};
export const CKB_FALLBACK_ICON: LucideIcon = Archive;
