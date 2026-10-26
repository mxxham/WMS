import { CkbHeader, CkbBody, Notice } from "@/components/ckb/ui";
import { RpcButton } from "@/components/ckb/rpc-button";
import { Button } from "@/components/ui/button";

/** Shown instead of any CKB page while the account has the app but no CKB role. */
export function NoRole({ shellAdmin, shared, name, schemaMissing = false }: { shellAdmin: boolean; shared: boolean; name: string; schemaMissing?: boolean }) {
  if (schemaMissing) {
    return (
      <main>
        <CkbHeader title="CKB 3PL belum siap" />
        <CkbBody className="max-w-2xl">
          <Notice tone="warn" title="Database belum diperbarui untuk CKB 3PL">
            Tabel CKB belum ada di database ini (migrasi 0099-0107 belum diterapkan). Minta admin sistem menjalankan
            migrasi, lalu muat ulang halaman ini. Shell WMS tidak terpengaruh.
          </Notice>
        </CkbBody>
      </main>
    );
  }
  return (
    <main>
      <CkbHeader title="Belum ada peran CKB" />
      <CkbBody className="max-w-2xl">
        {shared ? (
          <Notice tone="warn" title="Akun bersama tidak dipakai untuk CKB 3PL">
            Setiap hitungan, inspeksi dan persetujuan CKB dicatat atas nama orangnya, jadi CKB 3PL perlu akun pribadi.
            Masuk dengan akun Anda sendiri; admin CKB memberi peran di Akses pengguna.
          </Notice>
        ) : (
          <Notice title={`Halo ${name}`}>
            Akun ini sudah punya akses aplikasi CKB 3PL, tetapi belum diberi peran (admin, supervisor, operator atau
            perwakilan customer). Minta admin CKB mengaturnya di Akses pengguna, lalu muat ulang halaman ini.
          </Notice>
        )}
        <div className="flex flex-wrap gap-2">
          {shared && <Button asChild variant="outline"><a href="/login">Masuk dengan akun pribadi</a></Button>}
          {shellAdmin && !shared && (
            <RpcButton rpc="ckb_bootstrap_admin" args={{}} title="Admin CKB pertama"
              summary="Jadikan akun Anda admin CKB 3PL. Hanya bisa sekali, selama belum ada admin CKB sama sekali; setelah itu admin CKB yang mengatur akses."
              confirmLabel="Jadikan saya admin CKB">
              Jadikan saya admin CKB pertama
            </RpcButton>
          )}
        </div>
      </CkbBody>
    </main>
  );
}
