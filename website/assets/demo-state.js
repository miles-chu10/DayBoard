// A separate, in-memory sample. This module has no connection to DayBoard or provider accounts.
// The names, times and lists mirror the app's own demo mode (main/services/demo-data.ts), so the
// website sample shows the same fictional day as the Mac app's screenshots.

// `day` is days from today (negative is overdue). `time` is a reminder's due time, if any.
function task(id, title, day, list = "Work", notes = "", source = "Tasks", time = "") {
  return { id, title, day, list, notes, source, time, done: false };
}

export function createDemoState() {
  return {
    nextTask: 1,
    tasks: [
      task("t1", "Finalize launch announcement", 0, "Work", "Share draft with Priya before 3 PM"),
      task("t2", "Review pull request for onboarding", 0),
      task("t3", "Pick up dry cleaning", 0, "Reminders", "", "Reminders", "5:30 PM"),
      task("t4", "Send Q4 budget to finance", -1),
      task("t5", "Submit expense report", -5),
      task("t6", "Follow up with design agency", -7, "Work", "Ask for revised timeline"),
      task("t7", "Call Mom", 0, "Family", "", "Reminders", "7:00 PM"),
      task("t8", "Prep slides for roadmap sync", 1),
      task("t9", "Water the plants", 1, "Reminders", "", "Reminders"),
      task("t10", "Book flights for conference", 3, "Personal"),
      task("t11", "Renew passport", 5, "Errands", "", "Reminders"),
      task("t12", "Update team wiki", null),
    ],
    suggestions: [
      {
        id: "s1",
        title: "Review launch copy",
        from: "Priya Shah · Launch announcement — final copy?",
      },
      {
        id: "s2",
        title: "Submit the Q4 budget",
        from: "Finance Team · Reminder: Q4 budget due Friday",
      },
    ],
    mail: [
      {
        id: "m1",
        from: "Priya Shah",
        initials: "PS",
        subject: "Launch announcement — final copy?",
        snippet:
          "Hey Alex, I made a few edits to the headline. Can you take a look before we send it out",
        chip: "Final-copy decision requested",
        time: "1:32 PM",
        age: "30m",
        triage: "Needs reply",
        unread: true,
        status: "inbox",
        body: "Hi Alex,\n\nThe launch copy is ready for a final pass. Could you review the headline and send your thoughts before the roadmap sync?\n\nThanks,\nPriya",
      },
      {
        id: "m2",
        from: "Sam Patel",
        initials: "SP",
        subject: "Lunch today?",
        snippet: "Still good for 12:30? I booked a table at Blue Bottle.",
        chip: "Confirm lunch plans",
        time: "Yesterday",
        age: "1 day",
        stale: true,
        triage: "Needs reply",
        unread: false,
        status: "inbox",
        body: "Hey Alex,\n\nStill good for 12:30? I booked a table at Blue Bottle. Let me know and I’ll hold it.\n\nSam",
      },
      {
        id: "m3",
        from: "Jordan Lee",
        initials: "JL",
        subject: "Agenda for tomorrow's 1:1",
        snippet:
          "A couple of things I'd like to cover: hiring plan, the design system rollout, and",
        chip: "Agenda for your next one-on-one",
        time: "12:02 PM",
        triage: "FYI",
        unread: true,
        status: "inbox",
        body: "Hi Alex,\n\nFor tomorrow’s 1:1, let’s cover the hiring plan, the design system rollout and next week’s priorities. Add anything else you’d like to discuss.\n\nJordan",
      },
      {
        id: "m4",
        from: "Finance Team",
        initials: "FT",
        subject: "Reminder: Q4 budget due Friday",
        snippet:
          "Please submit your department's Q4 budget in the shared sheet by end of day Friday.",
        chip: "Budget due Friday",
        time: "9:02 AM",
        triage: "FYI",
        unread: true,
        status: "inbox",
        body: "Hi Alex,\n\nPlease submit your department's Q4 budget in the shared sheet by end of day Friday.\n\nFinance Team",
      },
      {
        id: "m5",
        from: "Design Weekly",
        initials: "DW",
        subject: "10 onboarding patterns worth stealing",
        snippet: "This week: progressive disclosure, empty states that teach, and more.",
        chip: "Optional newsletter",
        time: "Nov 7",
        triage: "Ignorable",
        unread: false,
        status: "inbox",
        body: "This week: progressive disclosure, empty states that teach, and more.",
      },
    ],
    note: "# Launch checklist\n\n- Final copy from Priya\n- Confirm the press date\n- Schedule the announcement email\n\n## Notes from the team\nKeep the message clear and practical.",
  };
}

// `day` is days from today. Calendars follow the demo account: Work, Personal and Family.
export const demoMeetings = Object.freeze([
  {
    id: "e6",
    day: 0,
    allDay: true,
    time: "All day",
    end: "",
    title: "Launch week",
    detail: "Launch week for the new onboarding flow.",
    calendar: "Work",
  },
  {
    id: "e1",
    day: 0,
    time: "9:30 AM",
    end: "9:45 AM",
    title: "Team standup",
    detail: "Progress, plans and anything in the way.",
    calendar: "Work",
  },
  {
    id: "e2",
    day: 0,
    time: "11:00 AM",
    end: "12:00 PM",
    title: "Design review: onboarding flow",
    location: "Studio B",
    detail: "Walk through the new first-run screens and agree on copy.",
    calendar: "Work",
  },
  {
    id: "e3",
    day: 0,
    time: "12:30 PM",
    end: "1:30 PM",
    title: "Lunch with Sam",
    location: "Blue Bottle Café",
    detail: "Catch up over lunch near the office.",
    calendar: "Personal",
  },
  {
    id: "e4",
    day: 0,
    time: "3:00 PM",
    end: "4:00 PM",
    title: "Q4 roadmap sync",
    detail: "Review launch plans, owners and the next milestone. 1 other attendee.",
    calendar: "Work",
    meet: true,
  },
  {
    id: "e5",
    day: 0,
    time: "6:30 PM",
    end: "7:30 PM",
    title: "Yoga",
    detail: "Evening class.",
    calendar: "Personal",
  },
  {
    id: "e7",
    day: 1,
    time: "9:30 AM",
    end: "9:45 AM",
    title: "Team standup",
    detail: "Progress, plans and anything in the way.",
    calendar: "Work",
  },
  {
    id: "e8",
    day: 1,
    time: "10:30 AM",
    end: "11:00 AM",
    title: "1:1 with Jordan",
    detail: "Hiring plan, design system rollout and next week’s priorities.",
    calendar: "Work",
  },
  {
    id: "e9",
    day: 1,
    time: "2:00 PM",
    end: "3:00 PM",
    title: "Dentist appointment",
    detail: "Regular checkup.",
    calendar: "Personal",
  },
  {
    id: "e11",
    day: 2,
    time: "1:00 PM",
    end: "2:00 PM",
    title: "Customer interview",
    detail: "Onboarding feedback session.",
    calendar: "Work",
  },
  {
    id: "e12",
    day: 2,
    time: "5:00 PM",
    end: "6:30 PM",
    title: "Mia's soccer game",
    location: "Riverside Park",
    detail: "Bring the folding chairs.",
    calendar: "Family",
  },
]);

export function reduceDemo(state, action) {
  if (action.type === "reset") return createDemoState();
  const next = structuredClone(state);
  if (action.type === "toggle-task") {
    const item = next.tasks.find((entry) => entry.id === action.id);
    if (item) item.done = !item.done;
  } else if (action.type === "add-task") {
    const title = typeof action.title === "string" ? action.title.trim().slice(0, 120) : "";
    if (!title || next.tasks.length >= 30) return state;
    next.tasks.push(task(`new${next.nextTask++}`, title, 0));
  } else if (action.type === "add-suggestion") {
    const suggestion = next.suggestions.find((item) => item.id === action.id);
    if (!suggestion) return state;
    next.tasks.push(task(`suggested-${suggestion.id}`, suggestion.title, 0));
    next.suggestions = next.suggestions.filter((item) => item.id !== action.id);
  } else if (action.type === "dismiss-suggestion") {
    if (!next.suggestions.some((item) => item.id === action.id)) return state;
    next.suggestions = next.suggestions.filter((item) => item.id !== action.id);
  } else if (action.type === "mail-status") {
    const mail = next.mail.find((item) => item.id === action.id);
    if (!mail || !["inbox", "snoozed", "archived"].includes(action.status)) return state;
    mail.status = action.status;
    mail.unread = false;
  } else if (action.type === "read-mail") {
    const mail = next.mail.find((item) => item.id === action.id);
    if (!mail || !mail.unread) return state;
    mail.unread = false;
  } else if (action.type === "note") {
    if (typeof action.value !== "string") return state;
    next.note = action.value.slice(0, 4000);
  } else {
    return state;
  }
  return next;
}
