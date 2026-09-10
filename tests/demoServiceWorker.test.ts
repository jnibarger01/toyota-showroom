import { describe, expect, it, vi } from "vitest";
import { syncDemoServiceWorker } from "../lib/pwa/demoServiceWorker";

/**
 * The gate is the point. A service worker registered against the production Worker deployment could
 * serve stale configuration responses, which is a worse failure than the download cost it saves —
 * so these mostly assert that registration does *not* happen, and that an existing registration is
 * actively torn down when the app turns out to have a real backend.
 */
function makeContainer(registrations: Array<{ scriptURL: string; unregister: () => Promise<boolean> }> = []) {
  return {
    register: vi.fn(async () => ({}) as ServiceWorkerRegistration),
    getRegistrations: vi.fn(async () =>
      registrations.map((entry) => ({
        active: { scriptURL: entry.scriptURL },
        unregister: entry.unregister,
      })),
    ),
  } as unknown as ServiceWorkerContainer & { register: ReturnType<typeof vi.fn>; getRegistrations: ReturnType<typeof vi.fn> };
}

describe("syncDemoServiceWorker", () => {
  it("registers on the demo surface, scoped to the app's base path", async () => {
    const serviceWorker = makeContainer();
    await expect(syncDemoServiceWorker("local", { serviceWorker, basePath: "/toyota-showroom/" })).resolves.toBe(
      "registered",
    );
    expect(serviceWorker.register).toHaveBeenCalledWith("/toyota-showroom/sw.js", { scope: "/toyota-showroom/" });
  });

  it("registers at the root when served without a base path", async () => {
    const serviceWorker = makeContainer();
    await syncDemoServiceWorker("local", { serviceWorker });
    expect(serviceWorker.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("does nothing while detection is still unresolved", async () => {
    const serviceWorker = makeContainer();
    // Registering here could install against a Worker deployment; unregistering could undo a valid
    // demo cache on every load. Neither is safe before the mode is known.
    await expect(syncDemoServiceWorker("unknown", { serviceWorker })).resolves.toBe("skipped");
    expect(serviceWorker.register).not.toHaveBeenCalled();
    expect(serviceWorker.getRegistrations).not.toHaveBeenCalled();
  });

  it("never registers against a real Worker backend", async () => {
    const serviceWorker = makeContainer();
    await syncDemoServiceWorker("worker", { serviceWorker });
    expect(serviceWorker.register).not.toHaveBeenCalled();
  });

  it("tears down a demo worker left behind from a previous visit", async () => {
    const unregister = vi.fn(async () => true);
    const serviceWorker = makeContainer([{ scriptURL: "https://example.com/toyota-showroom/sw.js", unregister }]);

    await expect(syncDemoServiceWorker("worker", { serviceWorker })).resolves.toBe("unregistered");
    expect(unregister).toHaveBeenCalled();
  });

  it("leaves unrelated service workers on the origin alone", async () => {
    const unregister = vi.fn(async () => true);
    const serviceWorker = makeContainer([{ scriptURL: "https://example.com/other-app/worker.js", unregister }]);

    await expect(syncDemoServiceWorker("worker", { serviceWorker })).resolves.toBe("skipped");
    expect(unregister).not.toHaveBeenCalled();
  });

  it("skips where the browser has no service worker support", async () => {
    await expect(syncDemoServiceWorker("local", { serviceWorker: undefined })).resolves.toBe("skipped");
  });

  it("swallows a registration failure rather than breaking the page it is optimising", async () => {
    const serviceWorker = makeContainer();
    serviceWorker.register.mockRejectedValue(new Error("insecure context"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(syncDemoServiceWorker("local", { serviceWorker })).resolves.toBe("skipped");
    warn.mockRestore();
  });
});
