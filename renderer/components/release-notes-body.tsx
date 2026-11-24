import { Sparkles, Wrench, ListChecks } from "lucide-react";
import {
  displayVersion,
  sectionTitle,
  type ReleaseNoteInline,
  type ReleaseNotes,
} from "@shared/release-notes";

import { openExternal } from "../lib/ipc";

// Release notes as the Software Update window and What's New show them.

function Inline({ parts }: { parts: readonly ReleaseNoteInline[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.kind === "strong" ? (
          <strong key={index} className="font-semibold text-primary">
            {part.text}
          </strong>
        ) : part.kind === "code" ? (
          <code key={index} className="rounded bg-control-subtle px-1 font-mono text-[0.92em]">
            {part.text}
          </code>
        ) : part.kind === "link" ? (
          <button
            key={index}
            type="button"
            className="text-link underline-offset-2 hover:underline"
            onClick={() => void openExternal(part.href)}
          >
            {part.text}
          </button>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

export function NotesBody({
  notes,
  heading = true,
}: {
  notes: ReleaseNotes;
  /** Off where the surrounding window already names the version. */
  heading?: boolean;
}) {
  return (
    <div className="space-y-4">
      {heading ? (
        <h2 className="text-large font-semibold text-primary">
          DayBoard {displayVersion(notes.version)}
          {notes.subtitle ? (
            <span className="block text-regular font-normal text-secondary">{notes.subtitle}</span>
          ) : null}
        </h2>
      ) : null}
      {notes.summary.map((paragraph, index) => (
        <p key={index} className="text-regular text-secondary">
          <Inline parts={paragraph} />
        </p>
      ))}
      {notes.sections.map((section, index) => {
        const Icon =
          section.kind === "new" ? Sparkles : section.kind === "fixed" ? Wrench : ListChecks;
        return (
          <section key={index} className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-regular font-semibold text-primary">
              <Icon className="size-4 text-accent" aria-hidden />
              {sectionTitle(section)}
            </h3>
            {section.paragraphs.map((paragraph, p) => (
              <p key={p} className="text-regular text-secondary">
                <Inline parts={paragraph} />
              </p>
            ))}
            {section.items.length ? (
              <ul className="list-disc space-y-1.5 pl-5 text-regular text-secondary marker:text-tertiary">
                {section.items.map((item, i) => (
                  <li key={i}>
                    <Inline parts={item} />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
