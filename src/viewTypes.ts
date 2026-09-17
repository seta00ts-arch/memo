export type ViewFilter =
  | { kind: "inbox" }
  | { kind: "all" }
  | { kind: "favorites" }
  | { kind: "notebook"; id: string; name: string }
  | { kind: "notebooks" }
  | { kind: "tag"; tag: string }
  | { kind: "tags" }
  | { kind: "trash" }
  | { kind: "settings" };
