// DayBoard Reminders helper: a small EventKit CLI for Apple Reminders and Mac Calendar events, line-delimited JSON over stdin/stdout.
// Re-implemented from the operations main/services/apple-reminders.ts uses and the data shapes
// documented in the Glaze SDK's `reminders.d.ts` (read for reference only; no source copied).
//
// Protocol: each stdin line is `{"id": string, "op": string, "params": object}`.
// Each stdout line is `{"id": string, "ok": true, "result": any}` or
// `{"id": string, "ok": false, "error": string}`. One line per request; stdout is flushed after
// every line so the parent process can read responses as they arrive.

import EventKit
import Foundation

let store = EKEventStore()

// MARK: - JSON helpers

typealias JSONObject = [String: Any]

func readLine_(from handle: FileHandle) -> String? {
  var lineData = Data()
  var byte: UInt8 = 0
  while true {
    let chunk = handle.readData(ofLength: 1)
    if chunk.isEmpty { return lineData.isEmpty ? nil : String(data: lineData, encoding: .utf8) }
    byte = chunk[0]
    if byte == 0x0A { return String(data: lineData, encoding: .utf8) }
    lineData.append(byte)
  }
}

func writeLine(_ object: JSONObject) {
  guard let data = try? JSONSerialization.data(withJSONObject: object, options: []) else { return }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func obj(_ params: JSONObject, _ key: String) -> JSONObject {
  return (params[key] as? JSONObject) ?? [:]
}

func str(_ params: JSONObject, _ key: String) -> String? {
  return params[key] as? String
}

func requestedCalendarId(_ params: JSONObject) throws -> String? {
  guard let value = params["calendarId"] else { return nil }
  guard let id = value as? String, !id.isEmpty else {
    throw HelperError.message("\"calendarId\" must be a non-empty string")
  }
  return id
}

func requireStr(_ params: JSONObject, _ key: String) throws -> String {
  guard let value = params[key] as? String, !value.isEmpty else {
    throw HelperError.message("\"\(key)\" is required")
  }
  return value
}

func int(_ params: JSONObject, _ key: String) -> Int? {
  if let n = params[key] as? Int { return n }
  if let n = params[key] as? NSNumber { return n.intValue }
  return nil
}

func boolVal(_ params: JSONObject, _ key: String) -> Bool? {
  return params[key] as? Bool
}

// MARK: - EventTime encode/decode

func pad(_ n: Int, _ width: Int) -> String {
  var s = String(n)
  while s.count < width { s = "0" + s }
  return s
}

/// Encodes EventKit's `DateComponents` back to the wire `EventTime` shape.
func encodeEventTime(_ components: DateComponents?) -> Any {
  guard let c = components, let y = c.year, let m = c.month, let d = c.day else { return NSNull() }
  guard let hour = c.hour, let minute = c.minute else {
    return ["kind": "date", "date": "\(pad(y, 4))-\(pad(m, 2))-\(pad(d, 2))"]
  }
  let second = c.second ?? 0
  let dateTime = "\(pad(y, 4))-\(pad(m, 2))-\(pad(d, 2))T\(pad(hour, 2)):\(pad(minute, 2)):\(pad(second, 2))"
  return ["kind": "date-time", "dateTime": dateTime, "timeZone": c.timeZone?.identifier as Any]
}

let isoFormatter: ISO8601DateFormatter = {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime]
  return formatter
}()

func encodeInstant(_ date: Date?) -> Any {
  guard let date = date else { return NSNull() }
  return isoFormatter.string(from: date)
}

// MARK: - Reminder / Calendar encoding

func refValue(_ reminder: EKReminder) -> String {
  return reminder.calendarItemIdentifier
}

func encodeReminder(_ reminder: EKReminder) -> JSONObject {
  return [
    "ref": ["value": refValue(reminder)],
    "externalId": reminder.calendarItemExternalIdentifier as Any,
    "calendarId": reminder.calendar?.calendarIdentifier ?? "",
    "title": reminder.title ?? "",
    "location": reminder.location as Any,
    "notes": reminder.notes as Any,
    "url": reminder.url?.absoluteString as Any,
    "creationDate": encodeInstant(reminder.creationDate),
    "lastModifiedDate": encodeInstant(reminder.lastModifiedDate),
    "start": encodeEventTime(reminder.startDateComponents),
    "due": encodeEventTime(reminder.dueDateComponents),
    "isCompleted": reminder.isCompleted,
    "completionDate": encodeInstant(reminder.completionDate),
    "priority": reminder.priority,
    "alarms": [],
    "recurrenceRules": (reminder.recurrenceRules ?? []).map { rule -> JSONObject in
      let frequency: String
      switch rule.frequency {
      case .daily: frequency = "daily"
      case .weekly: frequency = "weekly"
      case .monthly: frequency = "monthly"
      case .yearly: frequency = "yearly"
      @unknown default: frequency = "daily"
      }
      return [
        "calendarIdentifier": reminder.calendar?.calendarIdentifier ?? "",
        "frequency": frequency,
        "interval": rule.interval,
        "firstDayOfWeek": NSNull(),
        "daysOfTheWeek": [],
        "daysOfTheMonth": [],
        "daysOfTheYear": [],
        "weeksOfTheYear": [],
        "monthsOfTheYear": [],
        "setPositions": [],
        "end": NSNull(),
      ]
    },
  ]
}

func calendarTypeName(_ type: EKCalendarType) -> String {
  switch type {
  case .local: return "local"
  case .calDAV: return "caldav"
  case .exchange: return "exchange"
  case .subscription: return "subscription"
  case .birthday: return "birthday"
  @unknown default: return "unknown"
  }
}

func encodeCalendar(_ calendar: EKCalendar) -> JSONObject {
  var entityTypes: [String] = []
  if calendar.allowedEntityTypes.contains(.event) { entityTypes.append("event") }
  if calendar.allowedEntityTypes.contains(.reminder) { entityTypes.append("reminder") }
  return [
    "id": calendar.calendarIdentifier,
    "title": calendar.title,
    "color": calendar.cgColor.flatMap { color -> String? in
      guard let components = color.components, components.count >= 3 else { return nil }
      let r = Int(components[0] * 255), g = Int(components[1] * 255), b = Int(components[2] * 255)
      return String(format: "#%02x%02x%02x", r, g, b)
    } as Any,
    "type": calendarTypeName(calendar.type),
    "source": calendar.source?.title as Any,
    "sourceId": calendar.source?.sourceIdentifier ?? "",
    "entityTypes": entityTypes,
    "supportedAvailabilities": [],
    "allowsContentModifications": calendar.allowsContentModifications,
    "isSubscribed": calendar.isSubscribed,
    "isImmutable": calendar.isImmutable,
  ]
}

// MARK: - Event encoding

let localInstantFormatter: ISO8601DateFormatter = {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime]
  formatter.timeZone = .current
  return formatter
}()

func participantStatusName(_ status: EKParticipantStatus) -> String? {
  switch status {
  case .accepted: return "accepted"
  case .declined: return "declined"
  case .tentative: return "tentative"
  case .pending: return "needsAction"
  default: return nil
  }
}

func participantEmail(_ participant: EKParticipant) -> String? {
  let text = participant.url.absoluteString
  guard text.lowercased().hasPrefix("mailto:") else { return nil }
  let email = String(text.dropFirst(7)).removingPercentEncoding ?? String(text.dropFirst(7))
  return email.isEmpty ? nil : email
}

func encodeEvent(_ event: EKEvent) -> JSONObject {
  let start: String
  let end: String
  if event.isAllDay {
    start = dayString(event.startDate)
    end = dayString(allDayExclusiveEnd(start: event.startDate, end: event.endDate ?? event.startDate))
  } else {
    start = localInstantFormatter.string(from: event.startDate)
    end = localInstantFormatter.string(from: event.endDate ?? event.startDate)
  }
  let participants = event.attendees ?? []
  let me = participants.first { $0.isCurrentUser }
  return [
    "id": event.eventIdentifier ?? "",
    "occurrenceDate": encodeInstant(event.occurrenceDate),
    "startInstant": encodeInstant(event.startDate),
    "externalId": event.calendarItemExternalIdentifier as Any,
    "calendarId": event.calendar?.calendarIdentifier ?? "",
    "title": event.title ?? "",
    "start": start,
    "end": end,
    "allDay": event.isAllDay,
    "location": event.location as Any,
    "notes": event.notes as Any,
    "url": event.url?.absoluteString as Any,
    "recurring": event.hasRecurrenceRules,
    "attendees": participants.filter { !$0.isCurrentUser }.compactMap(participantEmail),
    "hasAttendees": event.hasAttendees,
    "organizerIsSelf": event.organizer?.isCurrentUser ?? false,
    "selfStatus": (me.flatMap { participantStatusName($0.participantStatus) }) as Any,
  ]
}

// MARK: - Operations

func authStatusName(_ status: EKAuthorizationStatus) -> String {
  switch status {
  case .notDetermined: return "not-determined"
  case .restricted: return "restricted"
  case .denied: return "denied"
  case .fullAccess: return "full-access"
  default: return "unknown"
  }
}

func opStatus() -> JSONObject {
  let status = EKEventStore.authorizationStatus(for: .reminder)
  return ["result": authStatusName(status)]
}

func opRequestAccess() throws -> JSONObject {
  let semaphore = DispatchSemaphore(value: 0)
  var granted = false
  var failure: Error?
  store.requestFullAccessToReminders { ok, error in
    granted = ok
    failure = error
    semaphore.signal()
  }
  semaphore.wait()
  if let failure = failure { throw HelperError.message(failure.localizedDescription) }
  let status = EKEventStore.authorizationStatus(for: .reminder)
  return ["result": authStatusName(granted ? .fullAccess : status)]
}

func requireCalendar(_ id: String?) throws -> EKCalendar {
  return try selectCalendar(
    id: id,
    lookup: { store.calendar(withIdentifier: $0) },
    defaultCalendar: { store.defaultCalendarForNewReminders() },
    isUsable: {
      $0.allowedEntityTypes.contains(.reminder) && $0.allowsContentModifications && !$0.isSubscribed && !$0.isImmutable
    }
  )
}

func findReminder(ref: String) throws -> EKReminder {
  guard let item = store.calendarItem(withIdentifier: ref) as? EKReminder else {
    throw HelperError.message("Reminder \"\(ref)\" was not found.")
  }
  return item
}

func fetchReminders(calendars: [EKCalendar]?, completed: Bool?) throws -> [EKReminder] {
  let predicate: NSPredicate
  if completed == true {
    predicate = store.predicateForCompletedReminders(withCompletionDateStarting: nil, ending: nil, calendars: calendars)
  } else {
    predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars)
  }
  let semaphore = DispatchSemaphore(value: 0)
  var results: [EKReminder] = []
  store.fetchReminders(matching: predicate) { reminders in
    results = reminders ?? []
    semaphore.signal()
  }
  semaphore.wait()
  return results
}

func opGetCalendars() -> JSONObject {
  let calendars = store.calendars(for: .reminder).map(encodeCalendar)
  return ["result": calendars]
}

func opGetReminders(_ params: JSONObject) throws -> JSONObject {
  let completed = boolVal(params, "completed")
  let limit = int(params, "limit") ?? 200
  let all = try fetchReminders(calendars: nil, completed: completed)
  let page = pageReminders(
    all, completed: completed == true, limit: limit,
    dueDate: { $0.dueDateComponents?.date }, completionDate: { $0.completionDate }
  )
  return ["result": ["reminders": page.items.map(encodeReminder), "truncated": page.truncated]]
}

func opGetReminder(_ params: JSONObject) throws -> JSONObject {
  let ref = try requireStr(obj(params, "reference"), "value")
  return ["result": encodeReminder(try findReminder(ref: ref))]
}

func applyPatch(_ reminder: EKReminder, _ patch: JSONObject) throws {
  if let title = str(patch, "title") { reminder.title = title }
  if patch["calendarId"] != nil { reminder.calendar = try requireCalendar(requestedCalendarId(patch)) }
  if let priority = int(patch, "priority") { reminder.priority = priority }
  if let notes = str(patch, "notes") { reminder.notes = notes }
  if let location = str(patch, "location") { reminder.location = location }
  if let urlString = str(patch, "url") { reminder.url = URL(string: urlString) }
  if let isCompleted = boolVal(patch, "isCompleted") { reminder.isCompleted = isCompleted }
  if let due = try parseEventTime(patch["due"]) { reminder.dueDateComponents = toDateComponents(due) }
  if let start = try parseEventTime(patch["start"]) { reminder.startDateComponents = toDateComponents(start) }

  let clearFields = (patch["clearFields"] as? [String]) ?? []
  for field in clearFields {
    switch field {
    case "notes": reminder.notes = nil
    case "url": reminder.url = nil
    case "location": reminder.location = nil
    case "start": reminder.startDateComponents = nil
    case "due": reminder.dueDateComponents = nil
    case "completionDate": reminder.completionDate = nil
    case "alarms": reminder.alarms = nil
    case "recurrenceRules": reminder.recurrenceRules = nil
    default: break
    }
  }
}

func opCreateReminder(_ params: JSONObject) throws -> JSONObject {
  let input = obj(params, "input")
  let reminder = EKReminder(eventStore: store)
  reminder.calendar = try requireCalendar(requestedCalendarId(input))
  try applyPatch(reminder, input)
  guard let title = str(input, "title"), !title.isEmpty else {
    throw HelperError.message("\"title\" is required")
  }
  reminder.title = title
  try store.save(reminder, commit: true)
  return ["result": encodeReminder(reminder)]
}

func opUpdateReminder(_ params: JSONObject) throws -> JSONObject {
  let ref = try requireStr(obj(params, "reference"), "value")
  let reminder = try findReminder(ref: ref)
  try applyPatch(reminder, obj(params, "patch"))
  try store.save(reminder, commit: true)
  return ["result": encodeReminder(reminder)]
}

func opDeleteReminder(_ params: JSONObject) throws -> JSONObject {
  let ref = try requireStr(obj(params, "reference"), "value")
  let reminder = try findReminder(ref: ref)
  try store.remove(reminder, commit: true)
  return ["result": NSNull()]
}

// MARK: - Calendar event operations

func eventAuthStatusName(_ status: EKAuthorizationStatus) -> String {
  // Write-only access cannot read events, so it is reported like a denial: Full Access is needed.
  if status == .writeOnly { return "denied" }
  return authStatusName(status)
}

func opEventStatus() -> JSONObject {
  return ["result": eventAuthStatusName(EKEventStore.authorizationStatus(for: .event))]
}

func opRequestEventAccess() throws -> JSONObject {
  let semaphore = DispatchSemaphore(value: 0)
  var granted = false
  var failure: Error?
  store.requestFullAccessToEvents { ok, error in
    granted = ok
    failure = error
    semaphore.signal()
  }
  semaphore.wait()
  if let failure = failure { throw HelperError.message(failure.localizedDescription) }
  // A store created before the grant can keep returning no calendars until it is reset.
  if granted { store.reset() }
  let status = EKEventStore.authorizationStatus(for: .event)
  return ["result": eventAuthStatusName(granted ? .fullAccess : status)]
}

func opGetEventCalendars() -> JSONObject {
  return ["result": store.calendars(for: .event).map(encodeCalendar)]
}

func requireEventCalendar(_ id: String?) throws -> EKCalendar {
  return try selectCalendar(
    id: id,
    lookup: { store.calendar(withIdentifier: $0) },
    defaultCalendar: { store.defaultCalendarForNewEvents },
    isUsable: {
      $0.allowedEntityTypes.contains(.event) && $0.allowsContentModifications && !$0.isSubscribed && !$0.isImmutable
    },
    noun: "Calendar"
  )
}

func requireInstant(_ params: JSONObject, _ key: String) throws -> Date {
  let text = try requireStr(params, key)
  guard let date = parseInstant(text) else { throw HelperError.message("invalid \(key) \"\(text)\"") }
  return date
}

func opGetEvents(_ params: JSONObject) throws -> JSONObject {
  let start = try requireInstant(params, "start")
  let end = try requireInstant(params, "end")
  guard end > start else { throw HelperError.message("\"end\" must be after \"start\"") }
  let limit = int(params, "limit") ?? 1000
  var calendars: [EKCalendar]? = nil
  if let ids = params["calendarIds"] as? [String] {
    let found = ids.compactMap { store.calendar(withIdentifier: $0) }
      .filter { $0.allowedEntityTypes.contains(.event) }
    // An empty array would mean "every calendar" to EventKit; here it means none are shown.
    if found.isEmpty { return ["result": ["events": [], "truncated": false]] }
    calendars = found
  }
  let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
  let events = store.events(matching: predicate)
    .filter { $0.eventIdentifier != nil && $0.status != .canceled }
    .sorted { $0.startDate < $1.startDate }
  return ["result": ["events": events.prefix(limit).map(encodeEvent), "truncated": events.count > limit]]
}

/// Finds one event, or one occurrence of a recurring event by its original occurrence date.
func findEvent(_ reference: JSONObject) throws -> EKEvent {
  let id = try requireStr(reference, "id")
  guard let first = store.event(withIdentifier: id) else {
    throw HelperError.message("This event was not found. It may have been deleted in Calendar.")
  }
  guard first.hasRecurrenceRules || first.isDetached,
    let occurrenceText = str(reference, "occurrenceDate"),
    let occurrence = parseInstant(occurrenceText)
  else { return first }
  var low = occurrence
  var high = occurrence
  if let hintText = str(reference, "start"), let hint = parseInstant(hintText) {
    low = min(low, hint)
    high = max(high, hint)
  }
  let window = store.predicateForEvents(
    withStart: low.addingTimeInterval(-2 * 86_400),
    end: high.addingTimeInterval(2 * 86_400),
    calendars: first.calendar.map { [$0] }
  )
  let match = store.events(matching: window).first { candidate in
    candidate.eventIdentifier == id && abs(candidate.occurrenceDate.timeIntervalSince(occurrence)) < 1
  }
  guard let match else {
    throw HelperError.message("This occurrence was not found. Refresh and try again.")
  }
  return match
}

func applyEventPatch(_ event: EKEvent, _ patch: JSONObject) throws {
  if let title = str(patch, "title") { event.title = title }
  if let notes = str(patch, "notes") { event.notes = notes.isEmpty ? nil : notes }
  if let location = str(patch, "location") { event.location = location.isEmpty ? nil : location }
  if patch["calendarId"] != nil { event.calendar = try requireEventCalendar(requestedCalendarId(patch)) }
  guard let times = patch["times"] as? JSONObject else { return }
  if boolVal(times, "allDay") == true {
    let startDay = try dayStart(times["start"], field: "start")
    let endDay = try dayStart(times["end"], field: "end")
    guard endDay > startDay else { throw HelperError.message("\"end\" must be after \"start\"") }
    event.isAllDay = true
    event.startDate = startDay
    event.endDate = endDay.addingTimeInterval(-1)
  } else {
    let start = try eventInstant(times["start"], field: "start")
    let end = try eventInstant(times["end"], field: "end")
    guard end > start else { throw HelperError.message("The event's end time must be after its start time.") }
    event.isAllDay = false
    event.startDate = start
    event.endDate = end
    if let zoneName = str(times, "timeZone") {
      guard let zone = TimeZone(identifier: zoneName) else { throw HelperError.message("invalid timeZone \"\(zoneName)\"") }
      event.timeZone = zone
    }
  }
}

func opGetEvent(_ params: JSONObject) throws -> JSONObject {
  return ["result": encodeEvent(try findEvent(obj(params, "reference")))]
}

func opCreateEvent(_ params: JSONObject) throws -> JSONObject {
  let input = obj(params, "input")
  guard let title = str(input, "title"), !title.trimmingCharacters(in: .whitespaces).isEmpty else {
    throw HelperError.message("\"title\" is required")
  }
  guard input["times"] is JSONObject else { throw HelperError.message("\"times\" is required") }
  let event = EKEvent(eventStore: store)
  event.calendar = try requireEventCalendar(requestedCalendarId(input))
  try applyEventPatch(event, input)
  try store.save(event, span: .thisEvent, commit: true)
  return ["result": encodeEvent(event)]
}

/// Edits only the referenced occurrence (`.thisEvent`), never the rest of a recurring series.
func opUpdateEvent(_ params: JSONObject) throws -> JSONObject {
  let event = try findEvent(obj(params, "reference"))
  guard event.calendar?.allowsContentModifications == true else {
    throw HelperError.message("This calendar is read-only.")
  }
  try applyEventPatch(event, obj(params, "patch"))
  try store.save(event, span: .thisEvent, commit: true)
  return ["result": encodeEvent(event)]
}

func opDeleteEvent(_ params: JSONObject) throws -> JSONObject {
  let event = try findEvent(obj(params, "reference"))
  guard event.calendar?.allowsContentModifications == true else {
    throw HelperError.message("This calendar is read-only.")
  }
  try store.remove(event, span: .thisEvent, commit: true)
  return ["result": NSNull()]
}

func handle(op: String, params: JSONObject) throws -> JSONObject {
  switch op {
  case "status": return opStatus()
  case "requestAccess": return try opRequestAccess()
  case "getCalendars": return opGetCalendars()
  case "getReminders": return try opGetReminders(params)
  case "getReminder": return try opGetReminder(params)
  case "createReminder": return try opCreateReminder(params)
  case "updateReminder": return try opUpdateReminder(params)
  case "deleteReminder": return try opDeleteReminder(params)
  case "eventStatus": return opEventStatus()
  case "requestEventAccess": return try opRequestEventAccess()
  case "getEventCalendars": return opGetEventCalendars()
  case "getEvents": return try opGetEvents(params)
  case "getEvent": return try opGetEvent(params)
  case "createEvent": return try opCreateEvent(params)
  case "updateEvent": return try opUpdateEvent(params)
  case "deleteEvent": return try opDeleteEvent(params)
  default:
    throw HelperError.message("Unknown operation \"\(op)\"")
  }
}

// MARK: - Main loop

setbuf(stdout, nil)
let stdin = FileHandle.standardInput
while let line = readLine_(from: stdin) {
  let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
  if trimmed.isEmpty { continue }
  guard
    let data = trimmed.data(using: .utf8),
    let request = try? JSONSerialization.jsonObject(with: data) as? JSONObject,
    let id = request["id"] as? String,
    let op = request["op"] as? String
  else {
    writeLine(["id": NSNull(), "ok": false, "error": "Malformed request"])
    continue
  }
  let params = (request["params"] as? JSONObject) ?? [:]
  do {
    let response = try handle(op: op, params: params)
    var out: JSONObject = ["id": id, "ok": true]
    out["result"] = response["result"] ?? NSNull()
    writeLine(out)
  } catch {
    writeLine(["id": id, "ok": false, "error": String(describing: error)])
  }
}
