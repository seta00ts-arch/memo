// Evernoteの.enexエクスポートファイルをインポートする。ブラウザ完結（DOMParserのみ、追加依存なし）。
// ENML（Evernote独自のXHTML方言）は簡易的にMarkdownへ変換する。表現しきれない書式は失われる。

import { useStore } from "../store/useStore";
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_SIZE } from "../types";

// ---- MD5（<en-media hash="...">と<resource>の対応付けのみに使用。暗号用途ではない） ----

function rotl(x: number, c: number): number {
  return (x << c) | (x >>> (32 - c));
}

function toHexLE(n: number): string {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
  }
  return s;
}

const MD5_K = new Int32Array(64);
for (let i = 0; i < 64; i++) {
  MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);
}
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21,
];

export function md5Hex(data: Uint8Array): string {
  let a0 = 0x67452301,
    b0 = 0xefcdab89,
    c0 = 0x98badcfe,
    d0 = 0x10325476;

  const originalLenBits = data.length * 8;
  const withOne = data.length + 1;
  const zeros = ((56 - (withOne % 64)) + 64) % 64;
  const totalLen = withOne + zeros + 8;
  const padded = new Uint8Array(totalLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(totalLen - 8, originalLenBits >>> 0, true);
  view.setUint32(totalLen - 4, Math.floor(originalLenBits / 4294967296), true);

  for (let chunkStart = 0; chunkStart < padded.length; chunkStart += 64) {
    const M = new Int32Array(16);
    for (let j = 0; j < 16; j++) M[j] = view.getInt32(chunkStart + j * 4, true);
    let A = a0,
      B = b0,
      C = c0,
      D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + MD5_K[i] + M[g]) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(F, MD5_S[i])) | 0;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }

  return toHexLE(a0) + toHexLE(b0) + toHexLE(c0) + toHexLE(d0);
}

// ---- base64 → bytes ----

function base64ToBytes(base64: string): Uint8Array {
  const cleaned = base64.replace(/\s+/g, "");
  const bin = atob(cleaned);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---- Evernoteのタイムスタンプ（20230101T120000Z）→ ISO 8601 ----

function evernoteTimestampToIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
}

// ---- ENML → Markdown ----

interface ParsedResource {
  hash: string;
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

function elementToMarkdown(el: Element, resourcesByHash: Map<string, ParsedResource>): string {
  const tag = el.tagName.toLowerCase();

  function childrenMarkdown(): string {
    let out = "";
    for (const child of Array.from(el.childNodes)) {
      out += nodeToMarkdown(child, resourcesByHash);
    }
    return out;
  }

  switch (tag) {
    case "en-note":
      return childrenMarkdown();
    case "div":
    case "p": {
      const todo = el.querySelector(":scope > en-todo");
      let inner = "";
      for (const child of Array.from(el.childNodes)) {
        if (child === todo) continue; // 下でプレフィックスとして処理するので二重にならないよう除外
        inner += nodeToMarkdown(child, resourcesByHash);
      }
      inner = inner.trim();
      if (todo) {
        const checked = todo.getAttribute("checked") === "true";
        return `- [${checked ? "x" : " "}] ${inner}\n`;
      }
      return inner ? `${inner}\n\n` : "";
    }
    case "br":
      return "\n";
    case "b":
    case "strong": {
      const inner = childrenMarkdown().trim();
      return inner ? `**${inner}**` : "";
    }
    case "i":
    case "em": {
      const inner = childrenMarkdown().trim();
      return inner ? `_${inner}_` : "";
    }
    case "a": {
      const href = el.getAttribute("href") ?? "";
      const inner = childrenMarkdown().trim() || href;
      return href ? `[${inner}](${href})` : inner;
    }
    case "ul": {
      const items = Array.from(el.children)
        .filter((c) => c.tagName.toLowerCase() === "li")
        .map((li) => `- ${liInner(li, resourcesByHash)}`);
      return items.length ? `${items.join("\n")}\n\n` : "";
    }
    case "ol": {
      const items = Array.from(el.children)
        .filter((c) => c.tagName.toLowerCase() === "li")
        .map((li, i) => `${i + 1}. ${liInner(li, resourcesByHash)}`);
      return items.length ? `${items.join("\n")}\n\n` : "";
    }
    case "li":
      return `- ${liInner(el, resourcesByHash)}\n`;
    case "en-todo": {
      const checked = el.getAttribute("checked") === "true";
      return `[${checked ? "x" : " "}] `;
    }
    case "en-media": {
      const hash = (el.getAttribute("hash") ?? "").toLowerCase();
      const resource = resourcesByHash.get(hash);
      return resource ? `[添付: ${resource.fileName}]` : "[添付ファイル]";
    }
    case "en-crypt":
      return "[暗号化されたコンテンツ（インポート時は復号できません）]\n\n";
    case "hr":
      return "\n\n---\n\n";
    case "blockquote": {
      const inner = childrenMarkdown().trim();
      return inner
        ? `${inner
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n")}\n\n`
        : "";
    }
    case "table":
      return `${childrenMarkdown().trim()}\n\n`;
    case "tr": {
      const cells = Array.from(el.children).map((c) => nodeToMarkdown(c, resourcesByHash).trim());
      return cells.length ? `${cells.join(" | ")}\n` : "";
    }
    case "td":
    case "th":
      return childrenMarkdown().trim();
    default:
      return childrenMarkdown();
  }
}

function liInner(li: Element, resourcesByHash: Map<string, ParsedResource>): string {
  let out = "";
  for (const child of Array.from(li.childNodes)) out += nodeToMarkdown(child, resourcesByHash);
  return out.trim();
}

function nodeToMarkdown(node: Node, resourcesByHash: Map<string, ParsedResource>): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    return elementToMarkdown(node as Element, resourcesByHash);
  }
  return "";
}

// XML宣言はドキュメントの先頭バイトでなければならないが、Evernoteの実際のエクスポートでは
// <content><![CDATA[ の直後に改行や空白が入っている場合があり、そのままではXML宣言が
// 2行目以降に来てしまいパースエラーになる。宣言・DOCTYPE・前後の空白をまとめて取り除く
// （パースには不要なため）ことで、その位置ずれの影響を受けないようにする。
function stripXmlProlog(xml: string): string {
  return xml
    .replace(/^﻿/, "") // BOM
    .trim()
    .replace(/^<\?xml[^>]*\?>/i, "")
    .replace(/<!DOCTYPE[^>]*>/i, "")
    .trim();
}

function hasParserError(doc: Document): boolean {
  return doc.getElementsByTagName("parsererror").length > 0;
}

function enmlToMarkdown(enmlXml: string, resourcesByHash: Map<string, ParsedResource>): string {
  const doc = new DOMParser().parseFromString(stripXmlProlog(enmlXml), "text/xml");
  if (hasParserError(doc)) return "";
  const root = doc.querySelector("en-note") ?? doc.documentElement;
  if (!root) return "";
  const markdown = elementToMarkdown(root, resourcesByHash);
  return markdown.replace(/\n{3,}/g, "\n\n").trim();
}

// ---- .enexファイル全体のパース ----

export interface ParsedEvernoteNote {
  title: string;
  markdown: string;
  tags: string[];
  sourceUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  resources: ParsedResource[];
}

export function parseEnex(xmlText: string): ParsedEvernoteNote[] {
  const doc = new DOMParser().parseFromString(stripXmlProlog(xmlText), "text/xml");
  if (hasParserError(doc)) {
    throw new Error("ENEXファイルを解析できませんでした（形式が不正です）");
  }
  const noteEls = Array.from(doc.querySelectorAll("en-export > note"));
  return noteEls.map((noteEl) => {
    const title = noteEl.querySelector(":scope > title")?.textContent?.trim() || "無題";
    const contentRaw = noteEl.querySelector(":scope > content")?.textContent ?? "";
    const created = evernoteTimestampToIso(noteEl.querySelector(":scope > created")?.textContent);
    const updated = evernoteTimestampToIso(noteEl.querySelector(":scope > updated")?.textContent);
    const tags = Array.from(noteEl.querySelectorAll(":scope > tag"))
      .map((t) => t.textContent?.trim() ?? "")
      .filter(Boolean);
    const sourceUrl = noteEl.querySelector(":scope > note-attributes > source-url")?.textContent?.trim() || null;

    const resources: ParsedResource[] = Array.from(noteEl.querySelectorAll(":scope > resource")).map((r, i) => {
      const base64 = r.querySelector(":scope > data")?.textContent ?? "";
      const bytes = base64ToBytes(base64);
      const mimeType = r.querySelector(":scope > mime")?.textContent?.trim() || "application/octet-stream";
      const fileName =
        r.querySelector(":scope > resource-attributes > file-name")?.textContent?.trim() || `attachment-${i + 1}`;
      return { hash: md5Hex(bytes), bytes, mimeType, fileName };
    });
    const resourcesByHash = new Map(resources.map((r) => [r.hash, r]));

    const markdown = enmlToMarkdown(contentRaw, resourcesByHash);

    return { title, markdown, tags, sourceUrl, createdAt: created, updatedAt: updated, resources };
  });
}

// ---- ストアへのインポート ----

export interface EvernoteImportSummary {
  importedNotes: number;
  importedAttachments: number;
  skippedAttachments: number;
  encryptedNotes: number;
}

export async function importEvernoteExport(file: File, notebookId: string | null): Promise<EvernoteImportSummary> {
  const text = await file.text();
  const parsedNotes = parseEnex(text);
  const store = useStore.getState();

  const summary: EvernoteImportSummary = {
    importedNotes: 0,
    importedAttachments: 0,
    skippedAttachments: 0,
    encryptedNotes: 0,
  };

  for (const parsed of parsedNotes) {
    if (parsed.markdown.includes("暗号化されたコンテンツ")) summary.encryptedNotes++;

    const isArticle = !!parsed.sourceUrl;
    const note = await store.createNote({
      type: isArticle ? "article" : "memo",
      title: parsed.title,
      body: isArticle ? "" : parsed.markdown,
      articleBody: isArticle ? parsed.markdown : undefined,
      sourceUrl: parsed.sourceUrl ?? undefined,
      notebookId,
      tags: parsed.tags,
    });
    summary.importedNotes++;

    for (const resource of parsed.resources) {
      const mimeType = ALLOWED_ATTACHMENT_TYPES.includes(
        resource.mimeType as (typeof ALLOWED_ATTACHMENT_TYPES)[number]
      )
        ? resource.mimeType
        : null;
      if (!mimeType || resource.bytes.length > MAX_ATTACHMENT_SIZE) {
        summary.skippedAttachments++;
        continue;
      }
      try {
        const arrayBuffer = resource.bytes.buffer.slice(
          resource.bytes.byteOffset,
          resource.bytes.byteOffset + resource.bytes.byteLength
        ) as ArrayBuffer;
        const blobFile = new File([arrayBuffer], resource.fileName, { type: mimeType });
        await store.addAttachment(note.id, blobFile);
        summary.importedAttachments++;
      } catch {
        summary.skippedAttachments++;
      }
    }
  }

  return summary;
}
