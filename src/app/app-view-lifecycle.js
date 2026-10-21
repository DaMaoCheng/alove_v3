const viewDisposers = new WeakMap();

export function registerViewDisposer(view, disposer) {
  if (view && typeof disposer === "function") viewDisposers.set(view, disposer);
  return view;
}

export function disposeView(view) {
  const disposer = view && viewDisposers.get(view);
  if (typeof disposer !== "function") return;
  viewDisposers.delete(view);
  disposer();
}
