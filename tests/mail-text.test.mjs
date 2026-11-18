import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const text = await loadTs("main/services/mail-text.ts");

test("Gmail IDs convert between IMAP's decimal and the API's hex form", () => {
  assert.equal(text.gmailHexId("1786923145209371745"), "18cc6d220f20dc61");
  assert.equal(text.gmailDecimalId("18cc6d220f20dc61"), "1786923145209371745");
  // IDs saved by older builds keep working; anything else is refused before reaching IMAP.
  assert.equal(text.gmailDecimalId("not-an-id"), null);
  assert.equal(text.gmailDecimalId("1".repeat(17)), null);
});

test("the readable part prefers plain text and skips attachments", () => {
  const structure = {
    type: "multipart/mixed",
    childNodes: [
      { part: "1", type: "text/plain", disposition: "attachment" },
      {
        type: "multipart/alternative",
        childNodes: [
          { part: "2.1", type: "text/html", encoding: "base64" },
          {
            part: "2.2",
            type: "text/plain",
            encoding: "quoted-printable",
            parameters: { charset: "iso-8859-1" },
          },
        ],
      },
    ],
  };
  assert.deepEqual(text.textPartOf(structure), {
    key: "2.2",
    html: false,
    encoding: "quoted-printable",
    charset: "iso-8859-1",
  });
  assert.deepEqual(text.textPartOf({ type: "text/html" }), {
    key: "1",
    html: true,
    encoding: "7bit",
    charset: "utf-8",
  });
  assert.equal(text.textPartOf(undefined), null);
});

test("parts decode from base64, quoted-printable and other charsets, even when cut off", () => {
  const plain = { key: "1", html: false, encoding: "base64", charset: "utf-8" };
  const encoded = Buffer.from("Café at noon").toString("base64");
  assert.equal(text.decodePart(Buffer.from(encoded), plain), "Café at noon");
  // A fetch cut mid-character drops the partial character instead of garbling it.
  const cut = Buffer.from("Café").toString("base64").slice(0, 6);
  assert.equal(text.decodePart(Buffer.from(cut), plain), "Caf");

  const qp = { key: "1", html: false, encoding: "quoted-printable", charset: "iso-8859-1" };
  assert.equal(text.decodePart(Buffer.from("Caf=E9 =\r\nat noon"), qp), "Café at noon");

  const html = { key: "1", html: true, encoding: "7bit", charset: "utf-8" };
  assert.equal(
    text.decodePart(Buffer.from("<style>p{}</style><p>Hi &amp; bye</p>"), html),
    "Hi & bye\n",
  );
  assert.equal(text.decodePart(Buffer.from("already decoded"), plain, true), "already decoded");
});

test("headers unfold and the first value wins", () => {
  const headers = text.parseHeaders(
    Buffer.from(
      "List-Unsubscribe: <mailto:a@x.com>,\r\n <https://x.com/u>\r\nlist-unsubscribe: no\r\n",
    ),
  );
  assert.equal(headers.get("list-unsubscribe"), "<mailto:a@x.com>, <https://x.com/u>");
  assert.equal(text.parseHeaders(undefined).size, 0);
});

test("addresses and previews", () => {
  assert.deepEqual(text.addressOf([{ name: " Sam ", address: "sam@y.org" }]), {
    name: "Sam",
    email: "sam@y.org",
  });
  assert.deepEqual(text.addressOf([{ address: "a@x.com" }]), { name: "a@x.com", email: "a@x.com" });
  assert.equal(
    text.formatAddress({ name: 'Patel, "Sam" <boss>', email: "sam@y.org" }),
    "Patel   Sam   boss <sam@y.org>",
  );
  assert.equal(text.snippetFrom("a\n\n  b", 200), "a b");
  assert.equal(text.snippetFrom("x".repeat(300), 10), `${"x".repeat(9)}…`);
  assert.equal(text.cleanBody("a  \r\n\r\n\r\n\r\nb", 6000), "a\n\nb");
});
