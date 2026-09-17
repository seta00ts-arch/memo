import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(source: string): string {
  const raw = marked.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(raw, { ADD_ATTR: ["target"] });
}

export interface ToolbarAction {
  label: string;
  title: string;
  apply: (text: string, selStart: number, selEnd: number) => { text: string; selStart: number; selEnd: number };
}

function wrapSelection(prefix: string, suffix: string) {
  return (text: string, selStart: number, selEnd: number) => {
    const before = text.slice(0, selStart);
    const selected = text.slice(selStart, selEnd) || "テキスト";
    const after = text.slice(selEnd);
    const newText = `${before}${prefix}${selected}${suffix}${after}`;
    return { text: newText, selStart: selStart + prefix.length, selEnd: selStart + prefix.length + selected.length };
  };
}

function prefixLines(prefix: string) {
  return (text: string, selStart: number, selEnd: number) => {
    const before = text.slice(0, selStart);
    const selected = text.slice(selStart, selEnd) || "見出し";
    const after = text.slice(selEnd);
    const lines = selected.split("\n").map((l) => `${prefix}${l}`);
    const newSelected = lines.join("\n");
    const newText = `${before}${newSelected}${after}`;
    return { text: newText, selStart: before.length, selEnd: before.length + newSelected.length };
  };
}

export const TOOLBAR_ACTIONS: ToolbarAction[] = [
  { label: "H", title: "見出し", apply: prefixLines("## ") },
  { label: "B", title: "太字", apply: wrapSelection("**", "**") },
  { label: "•", title: "箇条書き", apply: prefixLines("- ") },
  { label: "☑", title: "チェックリスト", apply: prefixLines("- [ ] ") },
  {
    label: "🔗",
    title: "リンク",
    apply: (text, selStart, selEnd) => {
      const before = text.slice(0, selStart);
      const selected = text.slice(selStart, selEnd) || "リンク文字列";
      const after = text.slice(selEnd);
      const insertion = `[${selected}](https://)`;
      const newText = `${before}${insertion}${after}`;
      const urlPos = before.length + selected.length + 3;
      return { text: newText, selStart: urlPos, selEnd: urlPos + 8 };
    },
  },
];
