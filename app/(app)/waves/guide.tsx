"use client";
import { CircleHelp } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

type Section = { title: string; body: string[]; desktopOnly?: boolean };

/** Every situation on the Wave page: when it happens, what to tap, what the system does. */
const SECTIONS: Section[] = [
  { title: "Mulai picking", body: [
    "Tiap wave menulis langkah berikutnya dalam satu kalimat. Jika tertulis Mulai picking, tekan tombol itu.",
    "Baris muncul berurutan sesuai jalur jalan. Ambil barang, lalu posting baris itu di tempat.",
  ] },
  { title: "Sesuai, Berbeda dan Ubah", body: [
    "Sesuai: ambil persis seperti rencana. Scan label rak (atau ketik kodenya), lalu Posting.",
    "Berbeda: jumlah, bin asal, atau tujuan sisa palet tidak sama dengan rencana. Isi yang benar, lalu Posting.",
    "Ubah: membetulkan baris yang Anda posting sendiri, selama wave masih berjalan dan belum diaudit.",
  ] },
  { title: "Stok kurang", body: [
    "Sistem mencatat isi bin lebih sedikit dari yang perlu diambil. Baris ini tertahan dan wave menulis: baris tertahan, perbaiki dulu.",
    "Supervisor membuka Perlu ditangani dan memakai Perbaiki. Picker yang menemukan barang di bin lain memakai Berbeda.",
  ] },
  { title: "Menunggu Bin To Bin", body: [
    "Baris ini mengambil dari pickface yang baru diisi oleh Bin To Bin di baris lain. Kerjakan Bin To Bin itu dulu, lalu baris ini.",
  ] },
  { title: "Minta supervisor", body: [
    "Jika sistem menolak posting picker (koreksi stok besar, baris orang lain, sudah diaudit, wave ditunda), permintaan dikirim ke supervisor.",
    "Picker lanjut ke baris berikutnya. Supervisor melihatnya di Perlu ditangani.",
  ] },
  { title: "Tutup wave", body: [
    "Jika semua baris sudah diposting, wave menulis: tutup wave. Tekan Tutup wave untuk menandai wave dan ordernya selesai.",
  ] },
  { title: "Tunda dan Aktifkan", body: [
    "Tunda menahan wave supaya tidak dikerjakan. Baris yang sudah diposting tetap tercatat. Aktifkan membuat wave bisa dikerjakan lagi.",
  ] },
  { title: "Selesaikan wave", body: [
    "Ada di menu Lainnya. Semua baris yang belum diposting langsung diposting sekaligus seolah sudah diambil.",
    "Pakai hanya jika semua barang benar-benar sudah diambil. Baris yang tidak diambil tetapi diposting membuat stok sistem salah.",
  ] },
  { title: "Buka lagi dan Pulihkan wave", body: [
    "Buka lagi (wave selesai): wave berjalan lagi. Baris yang diposting sekaligus oleh Selesaikan wave bisa ikut dibatalkan, stoknya kembali tepat ke bin asalnya.",
    "Pulihkan wave (wave dibatalkan): baris yang ikut dibatalkan kembali ke rencana. Stok tidak berubah. Jika bin tidak cukup lagi, sistem memberi tahu sebelum dipulihkan.",
    "Tidak bisa jika shipment sudah dimuat ke truk.",
  ] },
  { title: "Isi dari picklist", desktopOnly: true, body: [
    "Untuk memasukkan picklist kertas yang sudah diisi di lapangan, semua baris sekaligus. Hanya di komputer.",
  ] },
];

export function WaveGuide({ variant }: { variant: "desktop" | "phone" }) {
  const sections = SECTIONS.filter((s) => variant === "desktop" || !s.desktopOnly);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="inline-flex h-11 items-center gap-1 rounded-md px-2 text-sm font-medium text-steel-700 hover:bg-steel-100">
          <CircleHelp className="h-4 w-4" />Cara pakai
        </button>
      </DialogTrigger>
      <DialogContent title="Cara pakai halaman Wave" className="bg-white text-steel sm:w-[34rem]">
        <div className="space-y-4">
          {sections.map((s) => (
            <section key={s.title} className="space-y-1">
              <h3 className="font-cond text-lg font-semibold">{s.title}</h3>
              {s.body.map((p, i) => <p key={i} className="text-sm leading-relaxed text-steel-700">{p}</p>)}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
