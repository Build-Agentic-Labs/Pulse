export const ACCOUNT_MENU_VISIBILITY_EVENT = "pulse:account-menu-visibility";

export function announceAccountMenuVisibility(isOpen: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<boolean>(ACCOUNT_MENU_VISIBILITY_EVENT, {
      detail: isOpen,
    }),
  );
}
