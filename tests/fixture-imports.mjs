// Backend files reach the same native boundary from different relative depths.
// Fixture maps use one key so no test accidentally loads Electron or personal app state.
export function fixtureImport(specifier) {
  return /(?:^|\/)platform\/index\.(?:js|ts)$/.test(specifier) ? "dayboard:platform" : specifier;
}

// Mac Calendar without access: the calendar source is Google Calendar alone, as before Mac
// calendars existed. Fixtures that bundle a calendar caller map its apple-calendar import here.
export const macCalendarOffStub = `
export const isAppleCalendarId = (id) => typeof id === "string" && id.startsWith("apple:");
export async function getCalendarAccess() { return "not-determined"; }
export async function requestCalendarAccess() { return "not-determined"; }
export async function openCalendarPrivacySettings() {}
export async function getMacCalendars() { return { access: "not-determined", calendars: [] }; }
export async function listCalendarEvents(options) {
  try {
    return { state: "ok", ...(await options.google()) };
  } catch (error) {
    const reason = options.authReason(error);
    if (reason) return { state: reason };
    throw error;
  }
}
const noAccess = async () => { throw new Error("DayBoard needs access to your Mac calendars."); };
export const createAppleEvent = noAccess;
export const updateAppleEvent = noAccess;
export const deleteAppleEvent = noAccess;
export const getAppleEventForEditing = noAccess;
`;
