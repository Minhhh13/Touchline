/**
 * The Profile's "Send error reports" setting, per device in its own key (`touchline-error-reports-v1`: `off`, or
 * absent for on). Import-free and DOM-light so the Profile screen reads it in every build; only an online build has
 * a reporter that obeys it (`src/online/errors.ts`), which checks it before taking a report and before every post.
 */
export const ERROR_PREF_KEY = 'touchline-error-reports-v1'

export function errorReportsOn(): boolean {
  try {
    return localStorage.getItem(ERROR_PREF_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setErrorReportsOn(on: boolean): void {
  try {
    if (on) localStorage.removeItem(ERROR_PREF_KEY)
    else localStorage.setItem(ERROR_PREF_KEY, 'off')
  } catch {
    // remembered for this visit only: the reporter reads the same key and finds it unchanged
  }
}
