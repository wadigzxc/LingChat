import { enableAutoUnmount } from "@vue/test-utils";
import { afterEach, vi } from "vitest";

const createUnlisten = () => vi.fn();

const tauriMocks = vi.hoisted(() => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
  emit: vi.fn(async () => undefined),
  invoke: vi.fn(async () => undefined),
  listen: vi.fn(async () => vi.fn()),
}));

export { tauriMocks };

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  convertFileSrc: tauriMocks.convertFileSrc,
  invoke: tauriMocks.invoke,
}));

vi.mock("@tauri-apps/api/event", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/event")>()),
  emit: tauriMocks.emit,
  listen: tauriMocks.listen,
}));

export function resetTauriMocks(): void {
  tauriMocks.convertFileSrc.mockReset();
  tauriMocks.convertFileSrc.mockImplementation(
    (path: string) => `asset://localhost/${encodeURIComponent(path)}`
  );
  tauriMocks.emit.mockReset();
  tauriMocks.emit.mockResolvedValue(undefined);
  tauriMocks.invoke.mockReset();
  tauriMocks.invoke.mockResolvedValue(undefined);
  tauriMocks.listen.mockReset();
  tauriMocks.listen.mockImplementation(async () => createUnlisten());
}

class ResizeObserverMock implements ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

class IntersectionObserverMock implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
}

Object.defineProperties(window, {
  matchMedia: {
    configurable: true,
    value: vi.fn(
      (query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      })
    ),
  },
  scrollTo: { configurable: true, value: vi.fn() },
});

Object.defineProperties(globalThis, {
  IntersectionObserver: { configurable: true, value: IntersectionObserverMock },
  ResizeObserver: { configurable: true, value: ResizeObserverMock },
});

enableAutoUnmount(afterEach);

afterEach(() => {
  resetTauriMocks();
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
