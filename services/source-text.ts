export type SourceTextScope = "selection" | "note";

export interface SelectedSourceText {
  text: string;
  scope: SourceTextScope;
}

export function selectSourceText(
  selection: string,
  editorValue: string
): SelectedSourceText {
  if (selection.trim().length > 0) {
    return { text: selection, scope: "selection" };
  }

  return { text: editorValue, scope: "note" };
}

