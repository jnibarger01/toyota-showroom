/**
 * Respects `prefers-reduced-motion` across the showroom's animated surfaces.
 *
 * The 3D stage animates in five places — ride-height changes, camera preset moves, the
 * cinematic tour timeline, the placeholder-to-vehicle cross-fade, and OrbitControls' inertial damping — and none of them
 * consulted the user's motion preference. For someone with a vestibular disorder, a camera that
 * swings across the scene over 0.85 s is not a flourish; it is the specific thing the OS-level
 * setting exists to turn off.
 *
 * ## Why this is queried per animation rather than read once
 *
 * The preference can change mid-session: a user toggles it in system settings precisely *because*
 * a page is making them ill, and a value captured at mount would ignore that until reload. Reading
 * the media query at each call site costs a `matchMedia` lookup on an interaction boundary — never
 * in the render loop — which is far below the noise floor here.
 *
 * ## What "reduced" means in this codebase
 *
 * Reduced, not removed. Every one of these animations communicates a state change — the vehicle
 * settled at a new ride height, the camera arrived somewhere else, the real model replaced its
 * placeholder. Cutting them to zero duration preserves that information as an instant transition,
 * which is what the spec asks for: the end state still happens, the journey to it does not.
 */

/**
 * Whether the user has asked for reduced motion.
 *
 * Returns `false` when `matchMedia` is unavailable (server render, older test environments)
 * rather than throwing. That default is the honest one: a browser that cannot express the
 * preference has not expressed it, and every call site here is inside a client-only effect where
 * the real value is available by the time it matters.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Collapses an animation duration to zero when reduced motion is requested.
 *
 * Zero rather than a small non-zero value: GSAP treats a zero duration as an immediate set, so the
 * tween's `onComplete` still fires and the end state is still reached through the same code path.
 * Call sites therefore need no branch of their own, which is what keeps this from being a rule
 * that quietly stops being applied to whichever animation someone adds next.
 */
export function motionDuration(seconds: number): number {
  return prefersReducedMotion() ? 0 : seconds;
}
