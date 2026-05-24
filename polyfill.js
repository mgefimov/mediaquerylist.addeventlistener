(function (w) {
  function getProto() {
    if (w.MediaQueryList) {
      return w.MediaQueryList.prototype;
    }
    if (typeof w.matchMedia === "function") {
      const mql = w.matchMedia("all");
      return Object.getPrototypeOf(mql);
    }
  }
  const proto = getProto();

  if (!proto) return;

  proto.addEventListener = proto.addEventListener ||
    function (e /* change */, l) {
      proto.addListener.call(this, l);
    };

  proto.removeEventListener = proto.removeEventListener ||
    function (e /* change */, l) {
      proto.removeListener.call(this, l);
    }
})(window);
