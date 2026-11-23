import Foundation

enum HelperError: Error, CustomStringConvertible {
  case message(String)

  var description: String {
    switch self {
    case .message(let text): return text
    }
  }
}

struct EventTimeInput {
  let year: Int
  let month: Int
  let day: Int
  let hour: Int?
  let minute: Int?
  let second: Int?
  let timeZone: TimeZone?
}

private func parseDateOnly(_ date: String) throws -> (Int, Int, Int) {
  guard date.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else {
    throw HelperError.message("invalid date \"\(date)\"")
  }
  let parts = date.split(separator: "-").compactMap { Int($0) }
  guard parts.count == 3, (1...9999).contains(parts[0]) else {
    throw HelperError.message("invalid date \"\(date)\"")
  }
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(secondsFromGMT: 0)!
  let components = DateComponents(year: parts[0], month: parts[1], day: parts[2])
  guard components.isValidDate(in: calendar) else {
    throw HelperError.message("invalid date \"\(date)\"")
  }
  return (parts[0], parts[1], parts[2])
}

func parseEventTime(_ value: Any?) throws -> EventTimeInput? {
  guard let dict = value as? [String: Any] else { return nil }
  let kind = dict["kind"] as? String
  if kind == "date" {
    let (y, m, d) = try parseDateOnly(dict["date"] as? String ?? "")
    return EventTimeInput(year: y, month: m, day: d, hour: nil, minute: nil, second: nil, timeZone: nil)
  }
  if kind == "date-time" {
    let dateTime = dict["dateTime"] as? String ?? ""
    guard dateTime.range(of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$"#, options: .regularExpression) != nil else {
      throw HelperError.message("invalid dateTime \"\(dateTime)\"")
    }
    let pieces = dateTime.split(separator: "T")
    let (y, m, d) = try parseDateOnly(String(pieces[0]))
    let timeParts = pieces[1].split(separator: ":").compactMap { Int($0) }
    guard timeParts.count >= 2,
      (0...23).contains(timeParts[0]),
      (0...59).contains(timeParts[1]),
      timeParts.count < 3 || (0...59).contains(timeParts[2])
    else {
      throw HelperError.message("invalid time in \"\(dateTime)\"")
    }
    let tz: TimeZone
    if let tzName = dict["timeZone"] as? String {
      guard let named = TimeZone(identifier: tzName) else {
        throw HelperError.message("invalid timeZone \"\(tzName)\"")
      }
      tz = named
    } else if dict["timeZone"] == nil || dict["timeZone"] is NSNull {
      tz = .current
    } else {
      throw HelperError.message("invalid timeZone")
    }
    return EventTimeInput(
      year: y, month: m, day: d,
      hour: timeParts[0], minute: timeParts[1], second: timeParts.count > 2 ? timeParts[2] : 0,
      timeZone: tz
    )
  }
  throw HelperError.message("invalid event time kind")
}

func toDateComponents(_ input: EventTimeInput) -> DateComponents {
  var components = DateComponents()
  components.calendar = Calendar(identifier: .gregorian)
  components.year = input.year
  components.month = input.month
  components.day = input.day
  if let hour = input.hour {
    components.hour = hour
    components.minute = input.minute
    components.second = input.second
    components.timeZone = input.timeZone
  }
  return components
}

func selectCalendar<T>(
  id: String?,
  lookup: (String) -> T?,
  defaultCalendar: () -> T?,
  isUsable: (T) -> Bool,
  noun: String = "Reminders list"
) throws -> T {
  let calendar: T
  if let id {
    guard !id.isEmpty, let found = lookup(id) else {
      throw HelperError.message("\(noun) \"\(id)\" was not found.")
    }
    calendar = found
  } else {
    guard let found = defaultCalendar() else {
      throw HelperError.message("No default \(noun) is configured.")
    }
    calendar = found
  }
  guard isUsable(calendar) else {
    throw HelperError.message("\(noun) is not writable.")
  }
  return calendar
}

func pageReminders<T>(
  _ reminders: [T], completed: Bool, limit: Int,
  dueDate: (T) -> Date?, completionDate: (T) -> Date?
) -> (items: [T], truncated: Bool) {
  let sorted = reminders.sorted { left, right in
    if completed {
      let leftCompletion = completionDate(left) ?? .distantPast
      let rightCompletion = completionDate(right) ?? .distantPast
      if leftCompletion != rightCompletion { return leftCompletion > rightCompletion }
    }
    return (dueDate(left) ?? .distantFuture) < (dueDate(right) ?? .distantFuture)
  }
  return (Array(sorted.prefix(limit)), reminders.count > limit)
}

// MARK: - Calendar event times

/// Parses an RFC 3339 instant, with or without fractional seconds.
func parseInstant(_ value: String) -> Date? {
  let plain = ISO8601DateFormatter()
  plain.formatOptions = [.withInternetDateTime]
  if let date = plain.date(from: value) { return date }
  let fractional = ISO8601DateFormatter()
  fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return fractional.date(from: value)
}

/// A timed event boundary: an RFC 3339 instant string, or a wall-clock `EventTime` in a zone.
func eventInstant(_ value: Any?, field: String) throws -> Date {
  if let text = value as? String {
    guard let date = parseInstant(text) else { throw HelperError.message("invalid \(field) \"\(text)\"") }
    return date
  }
  guard let input = try parseEventTime(value), input.hour != nil else {
    throw HelperError.message("\"\(field)\" must be a date and time")
  }
  // toDateComponents carries the zone, which Calendar.date(from:) honors.
  guard let date = Calendar(identifier: .gregorian).date(from: toDateComponents(input)) else {
    throw HelperError.message("invalid \(field)")
  }
  return date
}

/// Local midnight at the start of a YYYY-MM-DD day.
func dayStart(_ value: Any?, field: String, calendar: Calendar = .current) throws -> Date {
  guard let text = value as? String, let input = try parseEventTime(["kind": "date", "date": text]) else {
    throw HelperError.message("\"\(field)\" must be a date")
  }
  guard let date = calendar.date(from: DateComponents(year: input.year, month: input.month, day: input.day)) else {
    throw HelperError.message("invalid \(field)")
  }
  return date
}

func dayString(_ date: Date, calendar: Calendar = .current) -> String {
  let c = calendar.dateComponents([.year, .month, .day], from: date)
  return "\(pad4(c.year ?? 0))-\(pad2(c.month ?? 0))-\(pad2(c.day ?? 0))"
}

private func pad2(_ n: Int) -> String { n < 10 ? "0\(n)" : String(n) }
private func pad4(_ n: Int) -> String { String(repeating: "0", count: max(0, 4 - String(n).count)) + String(n) }

/// EventKit stores an all-day event's end inside its last day (often 23:59:59), and some CalDAV
/// servers store the next midnight. Both become the exclusive next day, the wire format.
func allDayExclusiveEnd(start: Date, end: Date, calendar: Calendar = .current) -> Date {
  let inclusive = end > start ? end.addingTimeInterval(-1) : start
  let lastDay = calendar.startOfDay(for: inclusive)
  return calendar.date(byAdding: .day, value: 1, to: lastDay) ?? lastDay
}
