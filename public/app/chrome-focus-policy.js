export function installChromeFocusPolicy(documentRef, Observer = documentRef.defaultView?.MutationObserver) {
  const update = () => {
    documentRef.querySelectorAll('button, [role="button"], [role="tab"], input[type="range"], input[type="checkbox"], input[type="radio"], select').forEach((element) => {
      if (element.tabIndex !== -1) element.tabIndex = -1;
    });
  };
  update();
  if (!Observer) return () => {};
  const observer = new Observer(update);
  observer.observe(documentRef.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['tabindex', 'role'] });
  return () => observer.disconnect();
}
