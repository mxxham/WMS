"use client";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { ActionMenu, MenuDanger, MenuNote, MenuSection } from "@/components/app/action-menu";
import { ConfirmButton } from "@/components/app/confirm-button";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ROLES } from "@/lib/username";
import { createUser, resetPassword, setActive, setRole, setUserApps } from "./actions";
import { APP_LABEL, type AppId } from "@/lib/apps";

export type UserRow = { id: string; name: string; username: string; role: string; active: boolean; apps: AppId[]; default_app: AppId | null };
const ROLE: Record<string, string> = { operator: "Operator", supervisor: "Supervisor", admin: "Admin" };

export function UsersClient({ rows, me, shared, locked }: { rows: UserRow[]; me: string; shared: string[]; locked: boolean }) {
  const tag = (u: UserRow) => `${u.id === me ? " (Anda)" : ""}${shared.includes(u.id) ? " (akun bersama)" : ""}`;
  const lockedShared = (u: UserRow) => locked && shared.includes(u.id);
  return (
    <div className="space-y-4">
      <AddUser />
      {/* Phone: cards. Desktop: a table. */}
      <ul className="space-y-2 md:hidden">
        {rows.map((u) => (
          <li key={u.id} className={cn("flex items-center gap-3 rounded-lg bg-white p-3", !u.active && "opacity-60")}>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{u.name}{tag(u)}</span>
              <span className="block text-sm text-steel-500">{u.username} · {ROLE[u.role]} · {u.active ? "Aktif" : "Nonaktif"}</span>
            </span>
            <UserMenu u={u} self={u.id === me} lockedShared={lockedShared(u)} />
          </li>
        ))}
      </ul>
      <div className="hidden rounded-lg bg-white md:block">
        <Table>
          <thead><tr><Th>Nama</Th><Th>Nama pengguna</Th><Th>Peran</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>{rows.map((u) => (
            <tr key={u.id} className={cn(!u.active && "text-steel-500")}>
              <Td>{u.name}{tag(u)}</Td><Td>{u.username}</Td><Td>{ROLE[u.role]}</Td>
              <Td>{u.active ? "Aktif" : "Nonaktif"}</Td>
              <Td className="text-right"><UserMenu u={u} self={u.id === me} lockedShared={lockedShared(u)} /></Td>
            </tr>
          ))}</tbody>
        </Table>
      </div>
    </div>
  );
}

function AddUser() {
  const [f, setF] = useState({ name: "", username: "", password: "", role: "operator" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <ConfirmButton title="Tambah pengguna" confirmLabel="Buat akun"
      summary={`Buat akun ${f.name || "baru"} (${f.username.trim().toLowerCase() || "nama pengguna"}) sebagai ${ROLE[f.role]}. Berikan nama pengguna dan kata sandi awal kepada orangnya.`}
      extra={
        <div className="space-y-3">
          <div><Label htmlFor="nu-name">Nama</Label><Input id="nu-name" value={f.name} onChange={set("name")} /></div>
          <div><Label htmlFor="nu-user">Nama pengguna</Label><Input id="nu-user" value={f.username} onChange={set("username")} autoCapitalize="none" spellCheck={false} placeholder="mis. ani" /></div>
          <div><Label htmlFor="nu-pass">Kata sandi awal (min. 8)</Label><Input id="nu-pass" value={f.password} onChange={set("password")} autoComplete="new-password" /></div>
          <div><Label htmlFor="nu-role">Peran</Label>
            <Select id="nu-role" value={f.role} onChange={set("role")}>{ROLES.map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}</Select></div>
        </div>
      }
      onConfirm={async () => {
        const err = await createUser(f);
        if (!err) setF({ name: "", username: "", password: "", role: "operator" });
        return err;
      }}>
      <UserPlus className="h-4 w-4" />Tambah pengguna
    </ConfirmButton>
  );
}

function UserMenu({ u, self, lockedShared }: { u: UserRow; self: boolean; lockedShared: boolean }) {
  const [role, setR] = useState(u.role);
  const [pw, setPw] = useState("");
  const [apps, setApps] = useState<AppId[]>(u.apps ?? []);
  const [defaultApp, setDefaultApp] = useState<AppId | null>(u.default_app);
  const [appsError, setAppsError] = useState<string | null>(null);
  const bothApps = apps.length === 2;
  const singleApp = apps.length === 1 ? apps[0] : null;
  const effectiveDefault = bothApps ? defaultApp : singleApp;
  const hasAnyApp = apps.length > 0;

  const handleAppToggle = (app: AppId) => {
    setApps((prev) => prev.includes(app) ? prev.filter((a) => a !== app) : [...prev, app]);
    setAppsError(null);
  };

  const handleDefaultAppChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setDefaultApp(e.target.value as AppId);
  };

  const handleSaveApps = async () => {
    const err = await setUserApps(u.id, apps, effectiveDefault);
    if (err) setAppsError(err);
    return err;
  };

  if (lockedShared) {
    return (
      <ActionMenu title={u.name}>
        <MenuNote>Akun bersama: semua perangkat memakainya selama login belum diwajibkan. Peran, status dan kata sandinya bisa diubah setelah LOGIN_REQUIRED aktif.</MenuNote>
      </ActionMenu>
    );
  }
  return (
    <ActionMenu title={u.name}>
      <MenuSection>
        {!self && (
          <div><ConfirmButton size="sm" variant="outline" title={`Ubah peran ${u.name}`} confirmLabel="Simpan peran"
            summary={`${u.name} menjadi ${ROLE[role]}. Menu dan izin mengikuti peran baru saat halaman dimuat ulang.`}
            extra={<div><Label htmlFor={`role-${u.id}`}>Peran</Label>
              <Select id={`role-${u.id}`} value={role} onChange={(e) => setR(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}</Select></div>}
            onConfirm={() => setRole(u.id, role)}>Ubah peran</ConfirmButton></div>
        )}
        <div><ConfirmButton size="sm" variant="outline" title={`Reset kata sandi ${u.name}`} confirmLabel="Simpan kata sandi"
          summary={`Kata sandi ${u.username} diganti. Sesi yang sedang masuk tetap berjalan sampai Keluar.`}
          extra={<div><Label htmlFor={`pw-${u.id}`}>Kata sandi baru (min. 8)</Label><Input id={`pw-${u.id}`} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>}
          onConfirm={() => resetPassword(u.id, pw)}>Reset kata sandi</ConfirmButton></div>
      </MenuSection>
      <MenuSection>
        <div className="space-y-2">
          <Label className="block text-sm font-medium">Akses aplikasi</Label>
          <div className="flex flex-wrap gap-3">
            {(["shell_wms", "ckb_3pl"] as AppId[]).map((app) => (
              <Label key={app} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={apps.includes(app)}
                  onChange={() => handleAppToggle(app)}
                  className="h-4 w-4 rounded-md border-steel-300 text-ckb focus:ring-ckb"
                />
                {APP_LABEL[app]}
              </Label>
            ))}
          </div>
          {bothApps && (
            <div>
              <Label htmlFor={`default-app-${u.id}`} className="block text-sm font-medium mb-1">Aplikasi utama</Label>
              <Select
                id={`default-app-${u.id}`}
                value={effectiveDefault ?? ""}
                onChange={handleDefaultAppChange}
                className="w-full max-w-xs"
              >
                {apps.map((app) => (
                  <option key={app} value={app}>{APP_LABEL[app]}</option>
                ))}
              </Select>
            </div>
          )}
          {singleApp && (
            <div className="text-sm text-steel-500">
              Aplikasi utama: <span className="font-medium">{APP_LABEL[singleApp]}</span> (otomatis)
            </div>
          )}
          {!hasAnyApp && (
            <p className="text-sm text-steel-500 italic">Tidak ada akses aplikasi — centang untuk memberi akses.</p>
          )}
          <div className="flex items-center gap-2">
            <ConfirmButton
              size="sm"
              variant="outline"
              title={`Simpan akses aplikasi ${u.name}`}
              confirmLabel="Simpan"
              summary={apps.length === 0
                ? `Hapus semua akses aplikasi untuk ${u.name}.`
                : bothApps
                ? `Akses aplikasi ${u.name}: ${apps.map((a) => APP_LABEL[a]).join(", ")}. Aplikasi utama: ${APP_LABEL[effectiveDefault!]}.`
                : `Akses aplikasi ${u.name}: ${APP_LABEL[singleApp!]}.`}
              extra={appsError ? <p className="text-sm text-bad">{appsError}</p> : undefined}
              onConfirm={handleSaveApps}
            >
              Simpan
            </ConfirmButton>
          </div>
        </div>
      </MenuSection>
      {!self && (
        <MenuDanger>
          <div><ConfirmButton size="sm" variant={u.active ? "danger" : "outline"} title={`${u.active ? "Nonaktifkan" : "Aktifkan"} ${u.name}`}
            confirmLabel={u.active ? "Nonaktifkan" : "Aktifkan"}
            summary={u.active
              ? `${u.name} tidak bisa masuk lagi, dan sesi yang masih terbuka langsung tidak bisa melakukan apa pun. Riwayat kerjanya tetap tersimpan.`
              : `${u.name} bisa masuk lagi dengan kata sandinya.`}
            onConfirm={() => setActive(u.id, !u.active)}>{u.active ? "Nonaktifkan" : "Aktifkan"}</ConfirmButton></div>
        </MenuDanger>
      )}
    </ActionMenu>
  );
}
