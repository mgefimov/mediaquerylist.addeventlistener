"use strict";

const { describe, test, expect, beforeAll } = require("@jest/globals");

// --- Minimal stand-in for a legacy MediaQueryList ---------------------------
// It exposes only the deprecated addListener/removeListener pair (no modern
// addEventListener), which is exactly the environment the polyfill targets.
class FakeMediaQueryList {
  constructor(media) {
    this.media = media;
    this.matches = false;
    this._listeners = [];
  }

  addListener(cb) {
    this._listeners.push(cb);
  }

  removeListener(cb) {
    const i = this._listeners.indexOf(cb);
    if (i !== -1) this._listeners.splice(i, 1);
  }

  // Test helper: simulate a media change firing every registered callback.
  // Browsers invoke legacy listeners with the MediaQueryList as `this`, so we
  // mirror that here (the polyfill passes plain functions straight through and
  // relies on the host to set the receiver).
  _emit(matches) {
    this.matches = matches;
    const ev = { type: "change", matches: matches, media: this.media };
    // Snapshot first so once/abort removals during dispatch are well-defined.
    this._listeners.slice().forEach((cb) => cb.call(this, ev));
  }
}

let matchMedia;

beforeAll(() => {
  // Install the fake environment, then load the polyfill so it patches the
  // prototype above. The polyfill is an IIFE invoked with `window`, which in
  // CommonJS resolves to globalThis.window.
  globalThis.window = {
    // MediaQueryList: FakeMediaQueryList,
    matchMedia: (media) => new FakeMediaQueryList(media),
  };
  require("../polyfill.js");
  matchMedia = globalThis.window.matchMedia;
});

const last = (mql) => mql._listeners[mql._listeners.length - 1];

describe("API installation", () => {
  test("adds addEventListener / removeEventListener to the prototype", () => {
    const mql = matchMedia("(min-width: 1px)");
    expect(typeof mql.addEventListener).toBe("function");
    expect(typeof mql.removeEventListener).toBe("function");
  });
});

describe("function listeners", () => {
  test("fire on change and stop after removal", () => {
    const mql = matchMedia("(min-width: 1px)");
    let calls = 0;
    let lastEvent = null;
    const fn = function (e) {
      calls++;
      lastEvent = e;
    };

    mql.addEventListener("change", fn);
    mql._emit(true);
    expect(calls).toBe(1);
    expect(lastEvent.matches).toBe(true);

    mql.removeEventListener("change", fn);
    mql._emit(false);
    expect(calls).toBe(1);
  });

  test("are invoked with the MediaQueryList as `this`", () => {
    const mql = matchMedia("(min-width: 1px)");
    let thisArg = null;
    mql.addEventListener("change", function () {
      thisArg = this;
    });
    mql._emit(true);
    expect(thisArg).toBe(mql);
  });

  test("are passed to the legacy addListener by reference (not wrapped)", () => {
    const mql = matchMedia("(min-width: 1px)");
    const fn = () => {};
    mql.addEventListener("change", fn);
    expect(last(mql)).toBe(fn);
  });

  test("add + remove does not throw", () => {
    const mql = matchMedia("(min-width: 1px)");
    const fn = () => {};
    expect(() => {
      mql.addEventListener("change", fn);
      mql.removeEventListener("change", fn);
    }).not.toThrow();
  });
});

describe("object listeners (handleEvent)", () => {
  test("are wrapped, not passed directly, and handleEvent is invoked", () => {
    const mql = matchMedia("(min-width: 1px)");
    let received = null;
    const obj = {
      handleEvent(e) {
        received = e;
      },
    };

    mql.addEventListener("change", obj);
    const registered = last(mql);
    expect(registered).not.toBe(obj);
    expect(typeof registered).toBe("function");

    mql._emit(true);
    expect(received).not.toBeNull();
    expect(received.matches).toBe(true);
  });

  test("handleEvent is called with the listener object as `this`", () => {
    const mql = matchMedia("(min-width: 1px)");
    let thisArg = null;
    const obj = {
      handleEvent() {
        thisArg = this;
      },
    };
    mql.addEventListener("change", obj);
    mql._emit(true);
    expect(thisArg).toBe(obj);
  });

  test("can be removed by reference", () => {
    const mql = matchMedia("(min-width: 1px)");
    let calls = 0;
    const obj = { handleEvent: () => calls++ };

    mql.addEventListener("change", obj);
    mql._emit(true);
    mql.removeEventListener("change", obj);
    mql._emit(false);
    expect(calls).toBe(1);
  });
});

describe("event type handling", () => {
  test("non-`change` event types are ignored", () => {
    const mql = matchMedia("(min-width: 1px)");
    let calls = 0;
    mql.addEventListener("click", () => calls++);
    mql._emit(true);
    expect(calls).toBe(0);
  });
});

describe("duplicate registration", () => {
  test("duplicate (type, listener, capture) is ignored", () => {
    const mql = matchMedia("(min-width: 1px)");
    let calls = 0;
    const fn = () => calls++;
    mql.addEventListener("change", fn);
    mql.addEventListener("change", fn); // ignored
    mql._emit(true);
    expect(calls).toBe(1);
  });
});

describe("options: once", () => {
  test("removes the listener after the first invocation", () => {
    const mql = matchMedia("(min-width: 1px)");
    let calls = 0;
    mql.addEventListener("change", () => calls++, { once: true });
    mql._emit(true);
    mql._emit(false);
    mql._emit(true);
    expect(calls).toBe(1);
  });

  test("works with an object listener too", () => {
    const mql = matchMedia("(min-width: 1px)");
    let calls = 0;
    mql.addEventListener("change", { handleEvent: () => calls++ }, { once: true });
    mql._emit(true);
    mql._emit(false);
    expect(calls).toBe(1);
  });
});

describe("options: capture / useCapture", () => {
  test("boolean options (legacy useCapture) is accepted", () => {
    const mql = matchMedia("(min-width: 1px)");
    let calls = 0;
    const fn = () => calls++;
    mql.addEventListener("change", fn, true);
    mql._emit(true);
    expect(calls).toBe(1);
    mql.removeEventListener("change", fn, true);
    mql._emit(false);
    expect(calls).toBe(1);
  });

  test("object and boolean forms do not throw", () => {
    const mql = matchMedia("(min-width: 1px)");
    const fn = () => {};
    expect(() => {
      mql.addEventListener("change", fn, { capture: true, passive: true });
      mql.removeEventListener("change", fn, { capture: true });
      mql.addEventListener("change", fn, true);
      mql.removeEventListener("change", fn, true);
    }).not.toThrow();
  });

  test("capture flag is part of listener identity", () => {
    const mql = matchMedia("(min-width: 1px)");
    let calls = 0;
    const fn = () => calls++;
    // Same callback, different capture => two distinct listeners.
    mql.addEventListener("change", fn, { capture: true });
    mql.addEventListener("change", fn, { capture: false });
    mql._emit(true);
    expect(calls).toBe(2);

    // Removing one capture variant leaves the other registered.
    mql.removeEventListener("change", fn, { capture: true });
    mql._emit(false);
    expect(calls).toBe(3);
  });
});

describe("options: signal", () => {
  test("removes the listener when the signal aborts", () => {
    const mql = matchMedia("(min-width: 1px)");
    const controller = new AbortController();
    let calls = 0;
    mql.addEventListener("change", () => calls++, { signal: controller.signal });

    mql._emit(true);
    expect(calls).toBe(1);

    controller.abort();
    mql._emit(false);
    expect(calls).toBe(1);
  });

  test("an already-aborted signal prevents the listener from being added", () => {
    const mql = matchMedia("(min-width: 1px)");
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    mql.addEventListener("change", () => calls++, { signal: controller.signal });
    mql._emit(true);
    expect(calls).toBe(0);
  });
});

describe("defensive behavior", () => {
  test("null / undefined listener is a no-op (does not throw)", () => {
    const mql = matchMedia("(min-width: 1px)");
    expect(() => mql.addEventListener("change", null)).not.toThrow();
    expect(() => mql.removeEventListener("change", undefined)).not.toThrow();
    expect(() => mql._emit(true)).not.toThrow();
  });

  test("removeEventListener for an unknown listener is a no-op", () => {
    const mql = matchMedia("(min-width: 1px)");
    expect(() => mql.removeEventListener("change", () => {})).not.toThrow();
  });
});
