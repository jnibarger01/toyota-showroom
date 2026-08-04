/**
 * Programmatic mirror of the CSS custom properties in app/globals.css (goal 16), for code
 * that needs raw values rather than `var(--x)` — e.g. Three.js materials, canvas backgrounds.
 * Keep these two files in sync by hand; there are few enough tokens that a build step isn't
 * worth it yet.
 */
export const colors = {
  dark: {
    bg: "#090c10",
    surface: "#11161c",
    surface2: "#171d24",
    surface3: "#202731",
    border: "#29313b",
    text: "#f4f7fa",
    muted: "#8f99a7",
  },
  light: {
    bg: "#f4f5f7",
    surface: "#ffffff",
    surface2: "#eef0f3",
    surface3: "#e2e5ea",
    border: "#d6dae0",
    text: "#14181f",
    muted: "#5b6572",
  },
  accent: "#eb0a1e",
  accent2: "#ff3b4a",
} as const;

export const fontSizes = {
  xs: "0.6875rem",
  sm: "0.75rem",
  md: "0.8125rem",
  lg: "1rem",
  xl: "1.375rem",
  "2xl": "1.75rem",
} as const;

export const fontWeights = {
  regular: 400,
  medium: 500,
  bold: 700,
} as const;

export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 24,
  6: 32,
} as const;

export const radius = {
  sm: 7,
  md: 9,
  lg: 12,
} as const;

export const motion = {
  durationFastMs: 150,
  durationBaseMs: 300,
  durationSlowMs: 450,
  easeStandard: "cubic-bezier(0.4, 0, 0.2, 1)",
} as const;
