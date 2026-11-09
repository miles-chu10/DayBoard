import { finished } from "node:stream/promises";
import { createPackage } from "@electron/asar";

// @electron/asar 3.x resolves createPackage with its output stream before that
// stream has flushed, so reading the archive right away can see a partly
// written file on a busy machine. Wait for the stream to finish first.
export async function packAsar(source, archive) {
  const out = await createPackage(source, archive);
  if (out) await finished(out);
}
