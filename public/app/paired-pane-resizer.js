/** Explicit clasp for the navigator/preview edge. Pane owners keep their own widths. */
const CLASP_KEY = 'papers:ayg:pane-clasped';
const WIDTHS_KEY = 'papers:ayg:pane-unclasped-widths';
const TARGET_GAP = 34;

export function separatedPaneWidths(snapshot, targetGap = TARGET_GAP) {
  const leftWidth = Math.max(176, Number(snapshot?.leftWidth) || 176);
  const rightWidth = Math.max(300, Number(snapshot?.rightWidth) || 300);
  const gap = Number.isFinite(Number(snapshot?.gap)) ? Number(snapshot.gap) : targetGap;
  if (gap >= targetGap) return { leftWidth, rightWidth };
  let remaining = Math.max(0, targetGap - gap);
  let leftShrink = Math.min(remaining / 2, leftWidth - 176);
  let rightShrink = Math.min(remaining / 2, rightWidth - 300);
  remaining -= leftShrink + rightShrink;
  if (remaining > 0) {
    const extraLeft = Math.min(remaining, leftWidth - 176 - leftShrink);
    leftShrink += extraLeft;
    remaining -= extraLeft;
  }
  if (remaining > 0) rightShrink += Math.min(remaining, rightWidth - 300 - rightShrink);
  return {
    leftWidth: leftWidth - leftShrink,
    rightWidth: rightWidth - rightShrink,
  };
}

export function installPairedPaneResizer({ document, navigator, preview }) {
  const left = document.querySelector('#workspace-navigator');
  const right = document.querySelector('.file-capability-panel');
  if (!left || !right) return;
  const win = document.defaultView;
  const storage = win?.localStorage;

  const strip = document.createElement('div');
  strip.className = 'paired-pane-resizer';
  strip.setAttribute('role', 'separator');
  strip.setAttribute('aria-orientation', 'vertical');
  strip.setAttribute('aria-label', 'Resize clasped panes');

  const clasp = document.createElement('button');
  clasp.type = 'button';
  clasp.className = 'pane-clasp-toggle';
  clasp.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.2 6.2 6.7 4.7a3 3 0 0 0-4.2 4.2l2.6 2.6a3 3 0 0 0 4.2 0l1.4-1.4M11.8 13.8l1.5 1.5a3 3 0 1 0 4.2-4.2l-2.6-2.6a3 3 0 0 0-4.2 0l-1.4 1.4M7.2 12.8l5.6-5.6" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.body.append(strip, clasp);

  let clasped = false;
  let dragging = false;
  let previouslyEligible = false;
  let independent = null;
  try { clasped = storage?.getItem(CLASP_KEY) === '1'; } catch {}
  try {
    const parsed = JSON.parse(storage?.getItem(WIDTHS_KEY) || 'null');
    if (parsed && Number.isFinite(Number(parsed.leftWidth)) && Number.isFinite(Number(parsed.rightWidth))) independent = parsed;
  } catch {}

  const eligible = () => !left.hidden
    && !navigator.isCollapsed()
    && right.classList.contains('expanded')
    && !right.classList.contains('fills-tab')
    && !right.classList.contains('full-page');

  const cssWidth = (element, rect) => {
    const value = Number.parseFloat(win?.getComputedStyle?.(element)?.width || '');
    return Number.isFinite(value) ? value : rect.width;
  };

  const snapshotIndependent = () => {
    const a = left.getBoundingClientRect();
    const b = right.getBoundingClientRect();
    return {
      leftWidth: cssWidth(left, a),
      rightWidth: cssWidth(right, b),
      gap: b.left - a.right,
    };
  };

  const persist = () => {
    try { storage?.setItem(CLASP_KEY, clasped ? '1' : '0'); } catch {}
    if (independent) {
      try { storage?.setItem(WIDTHS_KEY, JSON.stringify(independent)); } catch {}
    }
  };

  const setClaspClasses = () => {
    left.classList.toggle('pane-clasped', clasped && eligible());
    right.classList.toggle('pane-clasped', clasped && eligible());
    clasp.classList.toggle('active', clasped);
    clasp.setAttribute('aria-pressed', String(clasped));
    clasp.title = clasped ? 'Separate panes' : 'Clasp panes';
    clasp.setAttribute('aria-label', clasp.title);
  };

  const seamBounds = (a, b) => {
    const viewport = win?.innerWidth || Math.max(a.right, b.right);
    const previewMax = Math.max(300, b.right - a.left - 182);
    return {
      min: Math.max(a.left + 179, b.right - previewMax - 3),
      max: b.right - 303,
    };
  };

  const applySeam = (requestedX) => {
    const a = left.getBoundingClientRect();
    const b = right.getBoundingClientRect();
    const bounds = seamBounds(a, b);
    if (bounds.min > bounds.max) return false;
    const x = Math.max(bounds.min, Math.min(bounds.max, requestedX));
    navigator.setWidth(x - a.left - 3, { nativeEdge: true });
    preview.setWidth(b.right - x - 3);
    preview.refreshPreviewGeometry();
    // Width owners are allowed to clamp (viewport, DPI, responsive CSS). Close
    // any remaining rendered gap using the ACTUAL post-clamp edges so clasping
    // still means one physical seam rather than merely matching requested widths.
    for (let pass = 0; pass < 4; pass++) {
      const actualLeft = left.getBoundingClientRect();
      const actualRight = right.getBoundingClientRect();
      const gap = actualRight.left - actualLeft.right;
      if (Math.abs(gap) <= 2) break;
      const leftWidth = cssWidth(left, actualLeft);
      const rightWidth = cssWidth(right, actualRight);
      navigator.setWidth(leftWidth + gap / 2, { nativeEdge: true });
      preview.setWidth(rightWidth + gap / 2);
      preview.refreshPreviewGeometry();
    }
    const finalLeft = left.getBoundingClientRect();
    const finalRight = right.getBoundingClientRect();
    return Math.abs(finalRight.left - finalLeft.right) <= 3;
  };

  const nativeChrome = () => right.classList.contains('native-chrome-layout');
  const chromeEdge = () => Number.isFinite(Number(right.dataset?.chromeLeft)) ? Number(right.dataset.chromeLeft) : right.getBoundingClientRect().left;
  const followChrome = () => {
    const a = left.getBoundingClientRect();
    const delta = chromeEdge() - a.right;
    if (Math.abs(delta) > .5) navigator.setWidth(Math.max(176, cssWidth(left, a) + delta), { nativeEdge: true });
  };

  const snapTogether = () => {
    if (!clasped || !eligible()) return;
    if (nativeChrome()) { followChrome(); return; }
    const a = left.getBoundingClientRect();
    const b = right.getBoundingClientRect();
    applySeam((a.right + b.left) / 2);
  };

  function refresh() {
    const active = eligible();
    const reopened = active && !previouslyEligible;
    previouslyEligible = active;
    clasp.hidden = !active;
    setClaspClasses();
    if (!active) {
      if(left.style.maxWidth)left.style.maxWidth='';
      strip.hidden = true;
      return;
    }
    if (nativeChrome()) {
      const limit = Math.max(176, chromeEdge() - left.getBoundingClientRect().left) + 'px';
      if (left.style.maxWidth !== limit) left.style.maxWidth = limit;
    }
    if (clasped && (reopened || nativeChrome())) {
      if (!nativeChrome()) left.style.maxWidth = '';
      snapTogether();
    }
    const a = left.getBoundingClientRect();
    const b = right.getBoundingClientRect();
    const center = nativeChrome() ? chromeEdge() : (a.right + b.left) / 2;
    const available=Math.max(176,b.left-a.left);
    const limit=active?available+'px':'';
    if(left.style.maxWidth!==limit)left.style.maxWidth=limit;
    clasp.style.left = `${Math.round(center - 15)}px`;
    clasp.style.top = `${Math.round(Math.max(a.top, b.top) + 4)}px`;
    strip.hidden = !clasped || nativeChrome();
    if (!clasped) return;
    strip.style.left = `${Math.round(center - 5)}px`;
    strip.style.top = `${Math.round(Math.max(a.top, b.top))}px`;
    strip.style.height = `${Math.max(0, Math.round(Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)))}px`;
  }

  clasp.addEventListener('click', () => {
    if (!eligible()) return;
    if (!clasped) {
      independent = snapshotIndependent();
      clasped = true;
      persist();
      setClaspClasses();
      snapTogether();
      win?.requestAnimationFrame?.(refresh);
      return;
    }
    clasped = false;
    persist();
    setClaspClasses();
    if (independent) {
      const widths = separatedPaneWidths(independent);
      navigator.setWidth(widths.leftWidth);
      if (!nativeChrome()) {
        preview.setWidth(widths.rightWidth);
        preview.refreshPreviewGeometry();
      }
    }
    win?.requestAnimationFrame?.(refresh);
  });

  strip.addEventListener('pointerdown', (event) => {
    if (!clasped || nativeChrome() || event.button !== 0) return;
    dragging = true;
    strip.setPointerCapture?.(event.pointerId);
    left.classList.add('resizing');
    right.classList.add('resizing');
    event.preventDefault();
    event.stopPropagation();
  });
  strip.addEventListener('pointermove', (event) => {
    if (!dragging || !clasped) return;
    applySeam(event.clientX);
    refresh();
    event.preventDefault();
  });
  const finish = () => {
    dragging = false;
    left.classList.remove('resizing');
    right.classList.remove('resizing');
    refresh();
  };
  strip.addEventListener('pointerup', finish);
  strip.addEventListener('pointercancel', finish);

  const observer = new win.ResizeObserver(refresh);
  observer.observe(left);
  observer.observe(right);
  const mutations = new win.MutationObserver(refresh);
  mutations.observe(left, { attributes: true, attributeFilter: ['class', 'hidden'] });
  mutations.observe(right, { attributes: true, attributeFilter: ['class'] });
  win.addEventListener('resize', () => {
    if (clasped) snapTogether();
    win.requestAnimationFrame?.(refresh);
  });
  refresh();
  if (clasped) win.requestAnimationFrame?.(() => { snapTogether(); refresh(); });

  return Object.freeze({ isClasped: () => clasped, refresh });
}
