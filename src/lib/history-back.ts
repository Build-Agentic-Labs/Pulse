/**
 * Whether the browser can step back to an earlier page of this app in the current tab.
 * Uses the Navigation API, whose history list only holds same-origin entries — so "true"
 * never sends someone back to the site they came from. Unsupported browsers answer false,
 * which falls back to a fixed destination rather than guessing from history.length.
 */
export function canGoBackInApp(): boolean {
  if (typeof window === "undefined") return false;
  const navigation = (window as Window & { navigation?: { canGoBack?: boolean } }).navigation;
  return navigation?.canGoBack === true;
}
