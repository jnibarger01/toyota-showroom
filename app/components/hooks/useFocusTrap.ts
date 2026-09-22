import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(", ");

type FocusTrapOptions = {
  active?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onEscape?: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

/** Keeps keyboard focus inside an active modal and restores it when the modal closes. */
export function useFocusTrap<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  { active = true, initialFocusRef, onEscape, returnFocusRef }: FocusTrapOptions = {},
) {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = containerRef.current;
    if (!container) return;
    const returnFocusTarget = returnFocusRef?.current;

    const preferred = initialFocusRef?.current;
    (preferred ?? container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR))?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const current = document.activeElement;
      const currentIndex = current instanceof HTMLElement ? focusable.indexOf(current) : -1;
      const nextIndex = event.shiftKey
        ? currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1
        : currentIndex === -1 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1;

      event.preventDefault();
      focusable[nextIndex]?.focus();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      (returnFocusTarget ?? previousFocusRef.current)?.focus();
    };
  }, [active, containerRef, initialFocusRef, returnFocusRef]);
}
