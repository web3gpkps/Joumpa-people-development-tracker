/** Input checks shared by the BMI and Penggantian forms. Number display lives in lib/format. */

/** True when the typed text has more than one digit after the decimal separator. */
export function hasMoreThanOneDecimal(raw: string): boolean {
  const match = /[.,](\d+)\s*$/.exec(raw.trim());
  return Boolean(match && match[1].length > 1);
}

/** A date input's value while the person is still typing can be "0002-10-25". */
export { isValidIsoDate as isPlausibleDate } from "@/lib/dates";
