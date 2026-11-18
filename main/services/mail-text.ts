/** Turning IMAP fetch results into DayBoard's mail shapes. Electron-free. */

export interface MailAddress {
  name: string;
  email: string;
}

/** Gmail's API writes message and thread IDs in hex; IMAP's X-GM-MSGID and X-GM-THRID are decimal. */
export function gmailHexId(decimal: string): string {
  return BigInt(decimal).toString(16);
}

/** The decimal form IMAP searches need, or null for an ID Gmail never issued. */
export function gmailDecimalId(hex: string): string | null {
  return /^[0-9a-f]{1,16}$/i.test(hex) ? BigInt(`0x${hex}`).toString(10) : null;
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

/** The readable body DayBoard shows and gives to AI features, capped like before. */
export function cleanBody(text: string, max = 6000): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** A one-line preview, about as long as the snippet Gmail's API returned. */
export function snippetFrom(text: string, max = 200): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

export interface BodyStructure {
  part?: string;
  type: string;
  parameters?: Record<string, string>;
  encoding?: string;
  disposition?: string;
  childNodes?: BodyStructure[];
}

export interface TextPart {
  /** The IMAP section, "1" for a message that isn't multipart. */
  key: string;
  html: boolean;
  encoding: string;
  charset: string;
}

function findPart(node: BodyStructure, type: string): BodyStructure | null {
  if (node.type.toLowerCase() === type && node.disposition?.toLowerCase() !== "attachment")
    return node;
  for (const child of node.childNodes ?? []) {
    const found = findPart(child, type);
    if (found) return found;
  }
  return null;
}

/** The part to read: plain text when there is one, else HTML, as Gmail's own preview does. */
export function textPartOf(structure: BodyStructure | undefined): TextPart | null {
  if (!structure) return null;
  const node = findPart(structure, "text/plain") ?? findPart(structure, "text/html");
  if (!node) return null;
  return {
    key: node.part ?? "1",
    html: node.type.toLowerCase() === "text/html",
    encoding: (node.encoding ?? "7bit").toLowerCase(),
    charset: node.parameters?.charset ?? "utf-8",
  };
}

function decodeQuotedPrintable(text: string): Buffer {
  const bytes: number[] = [];
  const source = text.replace(/=\r?\n/g, "");
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const hex = source.slice(index + 1, index + 3);
    if (char === "=" && /^[0-9a-f]{2}$/i.test(hex)) {
      bytes.push(parseInt(hex, 16));
      index += 2;
    } else {
      bytes.push(...Buffer.from(char, "latin1"));
    }
  }
  return Buffer.from(bytes);
}

function decodeCharset(bytes: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Decodes the start of a part fetched raw; a cut-off final sequence is dropped, not garbled. */
export function decodePart(raw: Buffer, part: TextPart, transferDecoded = false): string {
  let bytes = raw;
  if (!transferDecoded && part.encoding === "base64") {
    const clean = raw.toString("latin1").replace(/[^A-Za-z0-9+/=]/g, "");
    bytes = Buffer.from(clean.slice(0, clean.length - (clean.length % 4)), "base64");
  } else if (!transferDecoded && part.encoding === "quoted-printable") {
    bytes = decodeQuotedPrintable(raw.toString("latin1").replace(/=[0-9a-f]?$/i, ""));
  }
  const text = decodeCharset(bytes, part.charset).replace(/�+$/, "");
  return part.html ? htmlToText(text) : text;
}

/** Header fields from a raw header block, unfolded, keyed by lower-case name. */
export function parseHeaders(block: Buffer | undefined): Map<string, string> {
  const headers = new Map<string, string>();
  if (!block) return headers;
  const unfolded = block.toString("utf8").replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!headers.has(name)) headers.set(name, line.slice(colon + 1).trim());
  }
  return headers;
}

export function addressOf(list: { name?: string; address?: string }[] | undefined): MailAddress {
  const first = list?.[0];
  const email = first?.address?.trim() ?? "";
  return { name: first?.name?.trim() || email, email };
}

/** "Name <a@b>" for a To header, with characters that would split the recipient list removed. */
export function formatAddress(address: MailAddress): string {
  const name = address.name.replace(/[",;<>\\\r\n]/g, " ").trim();
  return name && name !== address.email ? `${name} <${address.email}>` : address.email;
}
