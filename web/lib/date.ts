/**
 * Today's date on the caller's own clock, as the API's `CalendarDate`
 * (`YYYY-MM-DD`).
 *
 * Deliberately not `new Date().toISOString().slice(0, 10)`: that is the *UTC*
 * date, so in JST every entry recorded before 09:00 local would be stamped
 * with yesterday. That is invisible on a form with a date field the user can
 * correct, but the settle screen records `occurred_on` with no field at all
 * (issue #147), so it has to be right without anyone checking.
 */
export function todayLocal(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
