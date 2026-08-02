/** Owns the shared grid pointer gesture that coordinates graph-node dragging
 * and marquee selection. Keeps capture/release, threshold, zoom transforms,
 * temporary node x/y/fx/fy updates, hover/drag CSS, hit testing, shift
 * pinning, pointer-cancel rollback, and blank/graph click suppression. All
 * persistent outcomes (Bin/folder drop, pin/release of positions, selection
 * updates, saving) delegate to commands — never passing the raw event. */
export function createPointerController({
  window,
  document,
  elements,
  store,
  commands,
  graph,
  marquee,
  zoomTransform,
  // Decides whether one item may sit inside a given set of regions. Optional
  // so the controller still works with no sets in play at all.
  canDropInsideRegions = null,
  group,
  visiblePlacementIdFor,
  closeMenu,
  setSuppressGraphClick,
  setSuppressBlankClick,
  consumeSuppressGraphClick,
}) {
  let drag = null;
  let shiftKeydown = null;
  let shiftKeyup = null;
  let abortController = null;

  function installShiftListeners() {
    if (shiftKeydown) return;
    shiftKeydown = (event) => {
      if (event.key === 'Shift' && drag) {
        drag.pinOnRelease = true;
        for (const id of drag.itemIds) {
          const node = graph._getNode(id);
          if (node?.shell) {
            node.shell.classList.remove('will-release');
            node.shell.classList.add('will-pin');
          }
        }
      }
    };
    shiftKeyup = (event) => {
      if (event.key === 'Shift' && drag) {
        drag.pinOnRelease = false;
        for (const id of drag.itemIds) {
          const node = graph._getNode(id);
          if (node?.shell) {
            node.shell.classList.remove('will-pin');
            node.shell.classList.add('will-release');
          }
        }
      }
    };
    window.addEventListener('keydown', shiftKeydown, { capture: true });
    window.addEventListener('keyup', shiftKeyup, { capture: true });
  }

  function removeShiftListeners() {
    if (shiftKeydown) {
      window.removeEventListener('keydown', shiftKeydown, { capture: true });
      shiftKeydown = null;
    }
    if (shiftKeyup) {
      window.removeEventListener('keyup', shiftKeyup, { capture: true });
      shiftKeyup = null;
    }
  }

  function clearDragVisuals() {
    document.querySelectorAll('.graph-dragging').forEach((el) =>
      el.classList.remove('graph-dragging', 'will-pin', 'will-release'));
    document.querySelectorAll('.graph-drop-target').forEach((el) =>
      el.classList.remove('graph-drop-target'));
    // Queried separately: a blocked tile has already lost .graph-dragging by
    // the time this runs on some paths, and a marker left behind would stick
    // to the tile for the rest of the session.
    document.querySelectorAll('.graph-move-blocked').forEach((el) =>
      el.classList.remove('graph-move-blocked'));
    elements.binButton?.classList.remove('graph-bin-drop-target');
  }

  function transformFor(viewport) {
    if (!viewport) return { x: 0, y: 0, k: 1 };
    try {
      return zoomTransform(viewport);
    } catch {
      return { x: 0, y: 0, k: 1 };
    }
  }

  function clientToWorld(clientX, clientY) {
    const viewport = elements.grid.querySelector('.graph-viewport');
    const transform = transformFor(viewport);
    const rect = viewport?.getBoundingClientRect();
    const localX = rect ? clientX - rect.left : clientX;
    const localY = rect ? clientY - rect.top : clientY;
    return {
      x: (localX - transform.x) / transform.k,
      y: (localY - transform.y) / transform.k,
    };
  }

  function onDoubleClick(event) {
    if (consumeSuppressGraphClick()) return;
    const tile = event.target.closest('.icon-item');
    if (!tile) return;
    commands.activateItem(tile.dataset.id, { revealDirectoryTarget: true });
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    const session = store.getSession();

    // Alt is excluded alongside Ctrl: Alt+click batch-expands relative to the
    // current selection, so it must not select the tile or start a drag —
    // that would destroy the selection the gesture depends on.
    if (!event.target.closest('[data-expand]') && !event.target.closest('button')
      && !event.ctrlKey && !event.altKey) {
      const tile = event.target.closest('.icon-item');
      const shell = tile?.closest('.graph-node-shell');
      if (shell && event.pointerType !== 'touch' && !tile.classList.contains('bin-origin-ghost')) {
        const itemId = tile.dataset.id;
        if (!session.selected.has(itemId)) {
          commands.selectItem(itemId, { shiftKey: false, ctrlKey: false, visibleItemIds: [] });
        }
        const dragPlacementIds = new Map();
        for (const id of session.selected) {
          if (group(id)) continue;
          const placementId = visiblePlacementIdFor(id);
          if (placementId) dragPlacementIds.set(id, placementId);
        }
        drag = {
          pointerId: event.pointerId,
          itemIds: [...session.selected],
          placementIds: dragPlacementIds,
          primaryNodeId: itemId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startWorldX: null,
          startWorldY: null,
          initialPositions: new Map(),
          // Where each item was last legally placed. The swept constraint
          // resolves from here rather than from the drag's origin, so an item
          // held against a wall slides along it as the pointer moves instead of
          // re-testing the whole journey from the start every frame.
          lastValid: new Map(),
          pinOnRelease: event.shiftKey,
          moved: false,
          thresholdPassed: false,
          // The regions exactly as drawn when the gesture began. The preview
          // and the release check both judge against this snapshot rather than
          // the live geometry: reheating the simulation on every pointer move
          // recomputes regions with the dragged item at its new position, so
          // the live answer would depend on whether a redraw happened to run
          // between the drag and the release — a quick and a slow release could
          // reach different verdicts at the same coordinates. Freezing them at
          // drag start makes the outcome deterministic. undefined (no graph
          // method) falls back to the live regions via setIdsAtPoint's default.
          regionSnapshot: graph.getSetRegions?.(),
        };
        closeMenu();
        event.preventDefault();
        return;
      }
    }

    if (
      event.target.closest('.icon-item')
      || !event.target.closest('[data-blank-parent], [data-icon-grid]')
    ) return;

    closeMenu();
    marquee.start({
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      preserveSelection: event.ctrlKey,
    });
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (drag && event.pointerId === drag.pointerId) {
      const session = store.getSession();
      const shiftHeld = event.shiftKey === true;
      if (shiftHeld !== drag.pinOnRelease) {
        drag.pinOnRelease = shiftHeld;
        for (const id of drag.itemIds) {
          const node = graph._getNode(id);
          if (node?.shell) {
            if (shiftHeld) {
              node.shell.classList.remove('will-release');
              node.shell.classList.add('will-pin');
            } else {
              node.shell.classList.remove('will-pin');
              node.shell.classList.add('will-release');
            }
          }
        }
      }
      if (!drag.thresholdPassed) {
        const dx = event.clientX - drag.startClientX;
        const dy = event.clientY - drag.startClientY;
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        drag.thresholdPassed = true;
        drag.moved = true;
        elements.grid.setPointerCapture(event.pointerId);
        installShiftListeners();
        const start = clientToWorld(drag.startClientX, drag.startClientY);
        drag.startWorldX = start.x;
        drag.startWorldY = start.y;
        const pinClass = drag.pinOnRelease ? 'will-pin' : 'will-release';
        for (const id of drag.itemIds) {
          const node = graph._getNode(id);
          if (node) {
            drag.initialPositions.set(id, {
              x: node.x, y: node.y, fx: node.fx, fy: node.fy,
            });
            if (node.shell) {
              node.shell.classList.add('graph-dragging', pinClass);
            }
          }
        }
      }
      if (!drag.moved) return;
      const world = clientToWorld(event.clientX, event.clientY);
      const deltaX = world.x - drag.startWorldX;
      const deltaY = world.y - drag.startWorldY;
      for (const id of drag.itemIds) {
        const node = graph._getNode(id);
        if (!node) continue;
        const initial = drag.initialPositions.get(id);
        if (!initial) continue;
        const proposed = { x: initial.x + deltaX, y: initial.y + deltaY };
        // Stop at the membrane rather than pass through it. The tile used to
        // follow the cursor anywhere and revert on release, which reads as the
        // drag being broken rather than as a boundary being enforced. It now
        // travels as far along the path as it legally can and stays there while
        // the pointer carries on — the wall is felt, not explained afterwards.
        //
        // Each item is resolved from its own last accepted position, so one
        // blocked item in a multi-item drag stops on its own wall without
        // dragging the rest of the selection to a halt.
        const previous = drag.lastValid.get(id) ?? { x: initial.x, y: initial.y };
        const resolved = graph.constrainSetMotion
          ? graph.constrainSetMotion(id, previous, proposed, drag.regionSnapshot)
          : { x: proposed.x, y: proposed.y, blocked: false };
        drag.lastValid.set(id, { x: resolved.x, y: resolved.y });
        node.fx = resolved.x;
        node.fy = resolved.y;
        node.x = node.fx;
        node.y = node.fy;
        node.positioned = true;
        node.shell?.classList.toggle('graph-move-blocked', resolved.blocked === true);
      }
      graph.reheat(0.12);

      if (!session.binMode && elements.binButton) {
        const overBin = elements.binButton.contains(document.elementFromPoint(event.clientX, event.clientY));
        elements.binButton.classList.toggle('graph-bin-drop-target', overBin);
      }
      return;
    }

    if (marquee.isActive(event.pointerId)) {
      marquee.move({
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      });
    }
  }

  function hitTest(event) {
    const session = store.getSession();
    const hitBin = !session.binMode && elements.binButton?.contains(document.elementFromPoint(event.clientX, event.clientY));
    const shells = [...elements.grid.querySelectorAll('.graph-node-shell')];
    let hitFolderId = null;
    if (!hitBin) {
      // Disable the dragged shells so the non-dragged destination folder
      // remains hit-testable under the pointer.
      const draggedShells = shells.filter((shell) =>
        drag.itemIds.includes(shell.dataset.graphNodeId));
      try {
        for (const shell of draggedShells) {
          shell.style.pointerEvents = 'none';
        }
        const elementAtPoint = document.elementFromPoint(event.clientX, event.clientY);
        const hitShell = elementAtPoint?.closest('.graph-node-shell');
        if (hitShell && !drag.itemIds.includes(hitShell.dataset.graphNodeId)) {
          const hitItem = hitShell.querySelector('.icon-item');
          if (hitItem?.dataset.kind === 'group') {
            hitFolderId = hitItem.dataset.id;
          }
        }
      } finally {
        for (const shell of draggedShells) {
          shell.style.pointerEvents = '';
        }
      }
    }
    return { hitBin, hitFolderId };
  }

  /** Whether an item may sit where it has been dragged.
   *
   * The destination regions come from the same polygons that are drawn, so the
   * rule is decided against what the user can see rather than against a
   * separate idea of where the sets are. The snapshot is the geometry captured
   * when the drag began: during the drag the item's own motion reheats the
   * simulation and recomputes the live regions, so judging against those would
   * make the answer depend on whether a redraw has run yet. */
  function mayMoveTo(itemId, position, regionSnapshot) {
    if (!canDropInsideRegions || !graph.setIdsAtPoint) return true;
    return canDropInsideRegions(itemId, graph.setIdsAtPoint(position, regionSnapshot));
  }

  /** Puts back every item whose destination its sets do not allow.
   *
   * The movement itself is now clamped at the membrane as it happens, so a
   * normal release is already legal and this changes nothing. It is kept as a
   * defensive check: geometry can be replaced mid-gesture, and a position that
   * slipped through should not be committed just because the preview accepted
   * it.
   *
   * Each item is judged on its own: one blocked item in a multi-item drag
   * returns to where it started while the rest keep their new positions,
   * rather than vetoing the whole gesture. */
  function revertDisallowedMoves(current) {
    if (!current) return;
    for (const id of current.itemIds) {
      const node = graph._getNode(id);
      const initial = current.initialPositions.get(id);
      if (!node || !initial) continue;
      if (mayMoveTo(id, { x: node.x, y: node.y }, current.regionSnapshot)) continue;
      node.x = initial.x;
      node.y = initial.y;
      node.fx = initial.fx;
      node.fy = initial.fy;
      node.positioned = initial.fx != null;
    }
  }

  function onPointerUp(event) {
    if (drag && event.pointerId === drag.pointerId) {
      if (elements.grid.hasPointerCapture(event.pointerId)) {
        elements.grid.releasePointerCapture(event.pointerId);
      }
      if (drag.moved) {
        drag.pinOnRelease = event.shiftKey === true;
        removeShiftListeners();
        setSuppressGraphClick(true);
        clearDragVisuals();
        const { hitBin, hitFolderId } = hitTest(event);
        // Enforce the set movement rules before anything is committed. Only a
        // free move on the canvas is governed by them: dropping into the Bin
        // or a folder is a different gesture entirely, and a set that follows
        // its members would otherwise block the user from filing anything.
        if (!hitBin && !hitFolderId) revertDisallowedMoves(drag);
        const dragCopy = {
          itemIds: [...drag.itemIds],
          placementIds: drag.placementIds,
          pinOnRelease: drag.pinOnRelease,
        };
        drag = null;

        if (hitBin) {
          commands.dragDropToBin({ itemIds: dragCopy.itemIds });
        } else if (hitFolderId) {
          commands.dragDropToFolder({
            itemIds: dragCopy.itemIds,
            placementIds: dragCopy.placementIds,
            folderId: hitFolderId,
          });
        } else if (dragCopy.pinOnRelease) {
          const positions = {};
          for (const id of dragCopy.itemIds) {
            const node = graph._getNode(id);
            if (node) positions[id] = { x: node.x, y: node.y };
          }
          commands.pinDraggedNodes({ positions });
          graph._setSimulationDecay();
        } else {
          commands.releaseDraggedNodes({ itemIds: dragCopy.itemIds });
          for (const id of dragCopy.itemIds) {
            const node = graph._getNode(id);
            if (node) {
              node.fx = null;
              node.fy = null;
              node.positioned = false;
            }
          }
          graph.reheat(0.25);
        }
        return;
      }
      removeShiftListeners();
      drag = null;
      return;
    }

    if (marquee.isActive(event.pointerId)) {
      setSuppressBlankClick(marquee.finish(event.pointerId));
    }
  }

  function onPointerCancel(event) {
    if (drag && event.pointerId === drag.pointerId) {
      if (elements.grid.hasPointerCapture(event.pointerId)) {
        elements.grid.releasePointerCapture(event.pointerId);
      }
      removeShiftListeners();
      if (drag.moved) {
        for (const id of drag.itemIds) {
          const node = graph._getNode(id);
          const initial = drag.initialPositions.get(id);
          if (node && initial) {
            node.x = initial.x;
            node.y = initial.y;
            node.fx = initial.fx;
            node.fy = initial.fy;
          }
        }
        graph.reheat(0.2);
      }
      clearDragVisuals();
      removeShiftListeners();
      drag = null;
      return;
    }

    if (marquee.isActive(event.pointerId)) {
      setSuppressBlankClick(marquee.finish(event.pointerId));
    }
  }

  /** Cancels an in-progress drag (used by menu-open and graph destruction). */
  function cancelDrag() {
    if (!drag) return;
    removeShiftListeners();
    clearDragVisuals();
    drag = null;
  }

  function mount() {
    abortController = new AbortController();
    const signal = abortController.signal;
    elements.grid.addEventListener('pointerdown', onPointerDown, { signal });
    elements.grid.addEventListener('dblclick', onDoubleClick, { signal });
    elements.grid.addEventListener('pointermove', onPointerMove, { signal });
    elements.grid.addEventListener('pointerup', onPointerUp, { signal });
    elements.grid.addEventListener('pointercancel', onPointerCancel, { signal });
  }

  function destroy() {
    abortController?.abort();
    abortController = null;
    cancelDrag();
  }

  // Exposed so set hit-testing converts click coordinates exactly the way
  // dragging does. Two conversions that drift apart would mean clicking a set
  // somewhere other than where its outline is drawn.
  return { mount, destroy, cancelDrag, clientToWorld };
}
