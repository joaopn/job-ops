import { vi } from "vitest";

type WindowVirtualizerTestEnvironmentOptions = {
  viewportHeight?: number;
  rowHeight?: number;
};

/**
 * Sets up jsdom so a `@tanstack/react-virtual` virtualizer can compute
 * visible items. Stubs:
 *   - `window.innerHeight` (for window-mode virtualizers)
 *   - `HTMLElement.prototype.offsetHeight` for virtual-row elements
 *   - `HTMLElement.prototype.getBoundingClientRect` for element-mode
 *     scroll containers (those with `data-virtual-scroll-container="true"`)
 *   - `ResizeObserver` (no-op shim that fires once on observe with the
 *     scroll container's faked rect, so element-mode virtualizers see a
 *     non-zero viewport on first mount)
 *
 * Despite the legacy name, this helper also supports element-mode
 * virtualizers via the `data-virtual-scroll-container` attribute.
 */
export const setupWindowVirtualizerTestEnvironment = (
  options: WindowVirtualizerTestEnvironmentOptions = {},
) => {
  const { viewportHeight = 240, rowHeight = 84 } = options;
  const innerHeightDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "innerHeight",
  );
  const scrollYDescriptor = Object.getOwnPropertyDescriptor(window, "scrollY");
  const scrollY = window.scrollY ?? 0;

  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: viewportHeight,
  });
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    value: scrollY,
    writable: true,
  });

  const offsetHeightSpy = vi
    .spyOn(HTMLElement.prototype, "offsetHeight", "get")
    .mockImplementation(function (this: HTMLElement) {
      if (this.dataset.virtualRow === "true") {
        return rowHeight;
      }
      if (this.dataset.virtualScrollContainer === "true") {
        return viewportHeight;
      }
      return 0;
    });

  const originalGetBoundingClientRect =
    HTMLElement.prototype.getBoundingClientRect;
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      if (this.dataset.virtualScrollContainer === "true") {
        return {
          bottom: viewportHeight,
          height: viewportHeight,
          left: 0,
          right: 0,
          top: 0,
          width: 0,
          x: 0,
          y: 0,
          toJSON() {
            return this;
          },
        } as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    },
  });

  const originalResizeObserver = globalThis.ResizeObserver;

  class VirtualResizeObserver {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      const contentRect = target.getBoundingClientRect();
      this.callback(
        [
          {
            target,
            contentRect,
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }

    unobserve() {}

    disconnect() {}
  }

  globalThis.ResizeObserver = VirtualResizeObserver as typeof ResizeObserver;

  const cleanup = () => {
    offsetHeightSpy.mockRestore();
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: originalGetBoundingClientRect,
    });
    globalThis.ResizeObserver = originalResizeObserver;

    if (innerHeightDescriptor) {
      Object.defineProperty(window, "innerHeight", innerHeightDescriptor);
    } else {
      Reflect.deleteProperty(window, "innerHeight");
    }

    if (scrollYDescriptor) {
      Object.defineProperty(window, "scrollY", scrollYDescriptor);
    } else {
      Reflect.deleteProperty(window, "scrollY");
    }
  };

  return {
    cleanup,
  };
};
