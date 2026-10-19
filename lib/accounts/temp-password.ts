import { randomInt } from "node:crypto";

// No 0/O, 1/l/I: the password is read off the screen and typed on a phone.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGIT = "23456789";
const ALL = UPPER + LOWER + DIGIT;
const pick = (set: string) => set[randomInt(set.length)];

/** A temporary password the owner hands over: at least one upper, one lower and one digit, shuffled. */
export function temporaryPassword(length = 12): string {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT)];
  while (chars.length < length) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
