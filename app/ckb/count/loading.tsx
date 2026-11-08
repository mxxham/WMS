import { Bone, PageSkeleton } from "@/components/loading/skeleton";

export default function Loading() {
  return (
    <PageSkeleton label="Memuat hitungan Anda">
      {[0, 1, 2].map((i) => <Bone key={i} className="h-24 rounded-2xl" />)}
    </PageSkeleton>
  );
}
