"use client";

import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";

/**
 * Error boundary for this area, inside the shell. `retry` re-fetches the segment; the copy
 * never shows error.message, which production replaces with a digest.
 */
export default function AreaError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <ErrorState
      title="Halaman ini gagal dimuat"
      cause={
        error.digest
          ? `Terjadi galat di server (kode ${error.digest}). Data Anda yang sudah tersimpan tidak terpengaruh.`
          : "Terjadi galat saat menampilkan halaman. Data Anda yang sudah tersimpan tidak terpengaruh."
      }
      action={
        <Button variant="secondary" onClick={() => retry()}>
          Coba muat lagi
        </Button>
      }
    />
  );
}
