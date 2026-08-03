/// <reference types="vite/client" />

interface Navigator {
  /** Present in browsers that support WebGPU; absent otherwise. No `@webgpu/types` dependency needed for this truthy check. */
  readonly gpu?: unknown;
}
