/**
 * Joins class names, skipping falsy parts. There is no tailwind-merge here:
 * a className passed to a primitive is appended, not merged, so do not pass a
 * utility that conflicts with one the primitive already sets (use its props).
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
