export type ViewFilter =
  | { kind: "inbox" }
  | { kind: "all" }
  | { kind: "favorites" }
  | { kind: "notebook"; id: string; name: string }
  | { kind: "tag"; tag: string }
  | { kind: "trash" }
  | { kind: "settings" };
