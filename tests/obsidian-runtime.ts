export class TFile {
  path = "";
}

export class TFolder {
  path = "";
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

export function requestUrl(): Promise<never> {
  return Promise.reject(
    new Error("Obsidian requestUrl must be mocked in unit tests.")
  );
}

