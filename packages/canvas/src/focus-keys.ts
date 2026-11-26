import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type RefObject } from "react";

/**
 * The menu and dialogs from the keyboard: the menu follows the menu pattern (arrows,
 * Home/End, Escape back to its button) and a dialog takes focus, keeps Tab inside and gives
 * focus back when it closes. The steps are pure so they are tested without a browser.
 */

/** Where an arrow, Home or End key moves focus in a menu of `count` items; undefined: not a menu key. */
export function menuStep(index: number, count: number, key: string): number | undefined {
  if (!count) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return index < 0 ? 0 : (index + 1) % count;
  if (key === "ArrowUp") return index < 0 ? count - 1 : (index - 1 + count) % count;
  return undefined;
}

/** Where Tab goes inside a dialog of `count` controls: wrap at the ends, otherwise undefined (the browser's own Tab). */
export function trapStep(index: number, count: number, backwards: boolean): number | undefined {
  if (!count) return undefined;
  if (index < 0) return backwards ? count - 1 : 0;
  if (!backwards && index === count - 1) return 0;
  if (backwards && index === 0) return count - 1;
  return undefined;
}

/**
 * The menu button to return to after a menu item was chosen. The item closes with its menu
 * before a dialog it opens can see where focus was, so the menu leaves its button here: a
 * dialog opening now takes it, otherwise the menu puts focus back on it itself.
 */
let returnTo: HTMLElement | null = null;

const FOCUSABLE = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
const focusables = (root: HTMLElement | null) =>
  root ? [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0) : [];

/**
 * A dialog that takes focus when it opens (its first control), keeps Tab inside, closes on
 * Escape, and gives focus back when it closes: to where it was, or to `fallback` when that is
 * gone (a menu item that opened the dialog has closed with its menu). Opened from the board,
 * the keyboard stays on the board.
 */
export function useDialogFocus<T extends HTMLElement>(onClose: () => void, fallback = ".menu-button") {
  const ref = useRef<T>(null);
  const latest = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const back = active ?? returnTo;
    returnTo = null;
    const root = ref.current;
    if (root && !root.contains(document.activeElement)) (focusables(root)[0] ?? root).focus();
    // Bound on the element itself: the canvas's own key handling sits between it and React's root.
    const keydown = (event: KeyboardEvent) => latest.current(event);
    root?.addEventListener("keydown", keydown);
    return () => {
      root?.removeEventListener("keydown", keydown);
      // Opened from the board (nothing focused): leave the keyboard on the board.
      if (!back || back === document.body) return;
      (back.isConnected ? back : document.querySelector<HTMLElement>(fallback))?.focus();
    };
    // Only on open and close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const list = focusables(ref.current);
    const to = trapStep(list.indexOf(document.activeElement as HTMLElement), list.length, event.shiftKey);
    if (to === undefined) return;
    event.preventDefault();
    list[to].focus();
  };
  latest.current = onKeyDown;
  return { ref, tabIndex: -1 };
}

/**
 * A menu opened from `button`: its first item takes focus, arrows, Home and End move between
 * items, Escape closes it and puts focus back on the button, and Tab closes it and moves on.
 */
export function useMenuKeys<T extends HTMLElement>(open: boolean, close: () => void, button: RefObject<HTMLElement | null>) {
  const ref = useRef<T>(null);
  const latest = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    if (open) {
      const root = ref.current;
      root?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
      // Bound on the menu itself: the canvas's own key handling (Escape clears the board's
      // selection) sits between it and React's root.
      const keydown = (event: KeyboardEvent) => latest.current(event);
      root?.addEventListener("keydown", keydown);
      return () => root?.removeEventListener("keydown", keydown);
    }
    // An item was chosen and nothing else took the keyboard: back to the menu's button.
    if (returnTo === button.current && document.activeElement === document.body) returnTo?.focus();
    if (returnTo === button.current) returnTo = null;
  }, [open, button]);
  /** Choosing an item: remember the button so focus can come back to it. */
  const onClickCapture = (event: ReactMouseEvent) => {
    if ((event.target as HTMLElement).closest("[role=menuitem]")) returnTo = button.current;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      button.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      close();
      return;
    }
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const to = menuStep(items.indexOf(document.activeElement as HTMLElement), items.length, event.key);
    if (to === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    items[to].focus();
  };
  latest.current = onKeyDown;
  return { ref, onClickCapture };
}
