import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Node 26+ exposes an experimental Web Storage global that is `undefined`
 * unless `--localstorage-file` is set. That shadows jsdom's Storage and
 * breaks any test that touches `window.localStorage`. Provide an in-memory
 * shim when the environment left it empty.
 */
if (typeof window !== "undefined" && !window.localStorage) {
  const data = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key) {
      data.delete(key);
    },
    setItem(key, value) {
      data.set(String(key), String(value));
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    enumerable: true,
    value: storage,
  });
}

afterEach(() => {
  cleanup();
});
