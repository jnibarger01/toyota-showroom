export type ViewerControlAction = "zoom-in" | "zoom-out" | "reset-camera" | "toggle-auto-rotate";
export type ViewerControlState = { autoRotate: boolean };

const CONTROL_EVENT = "toyota-showroom:viewer-control";
const STATE_EVENT = "toyota-showroom:viewer-state";

function eventTarget(): Window | null {
  return typeof window === "undefined" ? null : window;
}

export function dispatchViewerControl(action: ViewerControlAction): void {
  eventTarget()?.dispatchEvent(new CustomEvent<ViewerControlAction>(CONTROL_EVENT, { detail: action }));
}

export function subscribeViewerControl(listener: (action: ViewerControlAction) => void): () => void {
  const target = eventTarget();
  if (!target) return () => undefined;
  const handler = (event: Event) => listener((event as CustomEvent<ViewerControlAction>).detail);
  target.addEventListener(CONTROL_EVENT, handler);
  return () => target.removeEventListener(CONTROL_EVENT, handler);
}

export function publishViewerState(state: ViewerControlState): void {
  eventTarget()?.dispatchEvent(new CustomEvent<ViewerControlState>(STATE_EVENT, { detail: state }));
}

export function subscribeViewerState(listener: (state: ViewerControlState) => void): () => void {
  const target = eventTarget();
  if (!target) return () => undefined;
  const handler = (event: Event) => listener((event as CustomEvent<ViewerControlState>).detail);
  target.addEventListener(STATE_EVENT, handler);
  return () => target.removeEventListener(STATE_EVENT, handler);
}
