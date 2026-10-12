"use client";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { ActionMenu, MenuDanger, MenuSection } from "@/components/app/action-menu";
import { ConfirmButton } from "@/components/app/confirm-button";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ROLES } from "@/lib/username";
import { createUser, resetPassword, setActive, setRole } from "./actions";

export type UserRow = { id: string; name: string; username: string; role: string; active: boolean };
const ROLE: Record<string, string> = { operator: "Operator", supervisor: "Supervisor", admin: "Admin" };

export function UsersClient({ rows, me }: { rows: UserRow[]; me: string }) {
  return (
    <div className="space-y-4">
      <AddUser />
      {/* Phone: cards. Desktop: a table. */}
      <ul className="space-y-2 md:hidden">
        {rows.map((u) => (
          <li key={u.id} className={cn("flex items-center gap-3 rounded-lg bg-white p-3", !u.active && "opacity-60")}>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{u.name}{u.id === me && " (Anda)"}</span>
              <span className="block text-sm text-steel-500">{u.username} · {ROLE[u.role]} · {u.active ? "Aktif" : "Nonaktif"}</span>
            </span>
            <UserMenu u={u} self={u.id === me} />
          </li>
        ))}
      </ul>
      <div className="hidden rounded-lg bg-white md:block">
        <Table>
          <thead><tr><Th>Nama</Th><Th>Nama pengguna</Th><Th>Peran</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>{rows.map((u) => (
            <tr key={u.id} className={cn(!u.active && "text-steel-500")}>
              <Td>{u.name}{u.id === me && " (Anda)"}</Td><Td>{u.username}</Td><Td>{ROLE[u.role]}</Td>
              <Td>{u.active ? "Aktif" : "Nonaktif"}</Td>
              <Td className="text-right"><UserMenu u={u} self={u.id === me} /></Td>
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

function UserMenu({ u, self }: { u: UserRow; self: boolean }) {
  const [role, setR] = useState(u.role);
  const [pw, setPw] = useState("");
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
