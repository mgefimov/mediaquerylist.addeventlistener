/**
 * Polyfill for MediaQueryList.addEventListener / removeEventListener.
 */

/**
 * A listener as accepted by EventTarget: a callback function, or an object with
 * a `handleEvent` method.
 * @typedef {EventListenerOrEventListenerObject} Listener
 */

/**
 * The option flags this polyfill understands, after the boolean / object /
 * omitted `options` argument has been normalized.
 * @typedef {object} NormalizedOptions
 * @property {boolean} capture
 * @property {boolean} [once]
 * @property {AbortSignal} [signal]
 */

/**
 * One registered listener, tracked per MediaQueryList instance.
 * @typedef {object} ListenerRecord
 * @property {"change"} type
 * @property {Listener} listener   The callback exactly as supplied by the caller.
 * @property {boolean} capture     Part of the (type, listener, capture) identity.
 * @property {EventListener} wrapper The function actually handed to the legacy
 *   addListener — the listener itself for plain callbacks, or a wrapper for
 *   object / `once` listeners.
 * @property {() => void} [teardown] Detaches the AbortSignal handler, when a
 *   `signal` option was given.
 */

(function (w) {
  /**
   * Resolve the MediaQueryList prototype to patch. Prefer the constructor, but
   * fall back to the prototype of a live match in engines that hide it.
   * @returns {MediaQueryList | undefined}
   */
  function getProto() {
    if (w.MediaQueryList) {
      return w.MediaQueryList.prototype;
    }
    if (typeof w.matchMedia === "function") {
      const mql = w.matchMedia("all");
      return Object.getPrototypeOf(mql);
    }
  }

  /**
   * The options argument may be a boolean (legacy `useCapture`), an object, or
   * omitted. Normalize it to the flags we care about.
   * https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener
   * @param {boolean | AddEventListenerOptions} [options]
   * @returns {NormalizedOptions}
   */
  function normalizeOptions(options) {
    if (typeof options === "boolean") {
      return { capture: options };
    }
    const opts = options || {};
    return { capture: !!opts.capture, once: !!opts.once, signal: opts.signal };
  }

  /**
   * Per-instance list of listeners registered through the polyfilled API. We
   * need it to (a) recover the exact function we handed to the legacy
   * addListener when removeEventListener is called, and (b) reject duplicate
   * (type, listener, capture) registrations the way EventTarget does.
   * @param {MediaQueryList} mql
   * @returns {ListenerRecord[]}
   */
  function getRegistry(mql) {
    let registry = registries.get(mql);
    if (!registry) {
      registry = [];
      registries.set(mql, registry);
    }
    return registry;
  }

  /**
   * @param {ListenerRecord[]} registry
   * @param {string} type
   * @param {Listener} listener
   * @param {boolean} capture
   * @returns {number} Index of the matching record, or -1.
   */
  function findRecord(registry, type, listener, capture) {
    return registry.findIndex(
      (record) =>
        record.type === type &&
        record.listener === listener &&
        record.capture === capture
    );
  }

  const proto = getProto();

  if (!proto) return;

  /** @type {WeakMap<MediaQueryList, ListenerRecord[]>} */
  const registries = new WeakMap();

  proto.addEventListener =
    proto.addEventListener ||
    /**
     * @this {MediaQueryList}
     * @param {string} type
     * @param {Listener | null} listener
     * @param {boolean | AddEventListenerOptions} [options]
     * @returns {void}
     */
    function (type, listener, options) {
      if (type !== "change" || listener == null) return;

      const { capture, once, signal } = normalizeOptions(options);

      if (signal && signal.aborted) return;

      const registry = getRegistry(this);

      if (findRecord(registry, type, listener, capture) !== -1) return;

      const remove = () =>
        this.removeEventListener(type, listener, { capture: capture });

      /** @type {EventListener} */
      const wrapper =
        typeof listener === "function" && !once
          ? listener
          : (event) => {
            if (once) remove();
            // Dispatch the way the spec does: a function receives the
            // MediaQueryList as `this`; an object's handleEvent is called.
            if (typeof listener === "function") {
              listener.call(this, event);
            } else if (listener && typeof listener.handleEvent === "function") {
              listener.handleEvent(event);
            }
          };

      /** @type {ListenerRecord} */
      const record = { type: type, listener: listener, capture: capture, wrapper: wrapper };

      if (signal) {
        signal.addEventListener("abort", remove);
        record.teardown = () => signal.removeEventListener("abort", remove);
      }

      registry.push(record);
      proto.addListener.call(this, wrapper);
    };

  proto.removeEventListener =
    proto.removeEventListener ||
    /**
     * @this {MediaQueryList}
     * @param {string} type
     * @param {Listener | null} listener
     * @param {boolean | EventListenerOptions} [options]
     * @returns {void}
     */
    function (type, listener, options) {
      if (type !== "change" || listener == null) return;

      const { capture } = normalizeOptions(options);
      const registry = getRegistry(this);
      const index = findRecord(registry, type, listener, capture);
      if (index === -1) return;

      const [record] = registry.splice(index, 1);
      proto.removeListener.call(this, record.wrapper);
      if (record.teardown) record.teardown();
    };
})(window);
