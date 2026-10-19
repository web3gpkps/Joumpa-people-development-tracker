"use server";

import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export type AreaResult = { ok: true } | { ok: false; message: string };

const MAX = 80;

function cleanName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const text = name.replace(/\s+/g, " ").trim();
  return text === "" || text.length > MAX ? null : text;
}

/** Adds an area at the end of the list (pd_areas; RLS: admins only). */
export async function addArea(name: string): Promise<AreaResult> {
  await requireAdmin();
  const clean = cleanName(name);
  if (!clean) return { ok: false, message: `Isi nama area, paling panjang ${MAX} karakter.` };
  const supabase = await createClient();
  const { data: last } = await supabase.from("pd_areas").select("sort").order("sort", { ascending: false }).limit(1);
  const { error } = await supabase.from("pd_areas").insert({ name: clean, sort: (last?.[0]?.sort ?? 0) + 1 });
  if (error) {
    return { ok: false, message: error.code === "23505" ? "Area dengan nama ini sudah ada." : "Area belum tersimpan. Coba lagi." };
  }
  refresh();
  return { ok: true };
}

/** Renames an area; every Rencana Aksi row follows (ON UPDATE CASCADE) and reaches the sheet on the next sync. */
export async function renameArea(from: string, to: string): Promise<AreaResult> {
  await requireAdmin();
  const clean = cleanName(to);
  if (!clean) return { ok: false, message: `Isi nama area, paling panjang ${MAX} karakter.` };
  if (clean === from) return { ok: true };
  const supabase = await createClient();
  const { data, error } = await supabase.from("pd_areas").update({ name: clean }).eq("name", from).select("name");
  if (error) {
    return { ok: false, message: error.code === "23505" ? "Area dengan nama ini sudah ada." : "Nama area belum tersimpan. Coba lagi." };
  }
  if (!data?.length) return { ok: false, message: "Area ini tidak ada lagi. Muat ulang halaman." };
  refresh();
  return { ok: true };
}

/** Moves an area one place up or down in the dropdown order. */
export async function moveArea(name: string, direction: -1 | 1): Promise<AreaResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.from("pd_areas").select("name, sort").order("sort").order("name");
  if (error || !data) return { ok: false, message: "Urutan belum tersimpan. Coba lagi." };
  const i = data.findIndex((a) => a.name === name);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= data.length) return { ok: true };
  const order = data.map((a) => a.name);
  [order[i], order[j]] = [order[j], order[i]];
  for (const [index, area] of order.entries()) {
    const { error: e } = await supabase.from("pd_areas").update({ sort: index + 1 }).eq("name", area);
    if (e) return { ok: false, message: "Urutan belum tersimpan. Coba lagi." };
  }
  refresh();
  return { ok: true };
}

/** Deletes an area no Rencana Aksi row uses (archived rows included); the database refuses otherwise. */
export async function deleteArea(name: string): Promise<AreaResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("pd_areas").delete().eq("name", name);
  if (error) {
    return {
      ok: false,
      message:
        error.code === "23503"
          ? "Area ini masih dipakai di Rencana Aksi (termasuk yang diarsipkan). Ganti dulu area baris-baris itu."
          : "Area belum terhapus. Coba lagi.",
    };
  }
  refresh();
  return { ok: true };
}
