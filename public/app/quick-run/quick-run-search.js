/**
 * Quick Run — the searchable universe, as rows in the shape section 0.2 fixes.
 *
 * Sections 0.2 to 0.4 fix the row, and this module is only that mapping:
 *
 * - one row per active folder, one per active shortcut **placement** (placement ids are the occurrence
 *   identity, so one shortcut in two folders is two rows sharing a name and target and differing in
 *   breadcrumb and result key), one per window-layout member occurrence;
 * - a Link is a shortcut whose target the model's own isWebLink() classifies as http(s) — one pass, no
 *   second index;
 * - the row carries resultKey, type, name, normalizedName, breadcrumb, breadcrumbIds and actionRef, plus
 *   its type-specific authority ids (folder: groupId; shortcut/link: shortcutId and placementId;
 *   layout-item: layoutId and memberId). actionRef stays a reference, never a copy of a mutable object.
 *
 * Result keys are the pinned scheme: folder:<groupId>, shortcut:<placementId>, link:<placementId>,
 * layout-member:<layoutId>:<memberId>. Breadcrumbs come from persisted folder ancestry and use the
 * contract's separator, with the ancestor ids carried alongside so a caller need not re-walk the tree.
 */
import { isWebLink, itemsIn } from '../../workspace-model-20260730b.js';
import { normaliseQueryText } from './quick-run-types.js';

/** The contract's breadcrumb separator (section 0.4). */
export const QUICK_RUN_BREADCRUMB_SEPARATOR = ' › ';

function labelOf(item) {
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  return name === '' ? 'Untitled' : name;
}

/** The ancestor chain above a parent id: names for display, ids for reference. Walked once per row. */
function ancestryFor(state, parentId) {
  const names = [];
  const ids = [];
  let current = parentId;
  const guard = new Set();
  while (current && !guard.has(current)) {
    guard.add(current);
    const group = (state.groups ?? []).find((candidate) => candidate.id === current);
    if (!group) break;
    names.unshift(labelOf(group));
    ids.unshift(group.id);
    current = group.parentId;
  }
  return { breadcrumb: names.join(QUICK_RUN_BREADCRUMB_SEPARATOR), breadcrumbIds: ids };
}

function baseRow(state, id, name, parentId) {
  const ancestry = ancestryFor(state, parentId);
  return {
    resultKey: id,
    type: 'folder',
    name: labelOf({ name }),
    normalizedName: normaliseQueryText(labelOf({ name })),
    breadcrumb: ancestry.breadcrumb,
    breadcrumbIds: ancestry.breadcrumbIds,
    actionRef: null,
  };
}

function folderRows(state, parentId, seen, rows) {
  for (const item of itemsIn(state, parentId)) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (item.kind === 'group') {
      rows.push({ ...baseRow(state, 'folder:' + item.id, item.name, item.parentId), groupId: item.id });
      folderRows(state, item.id, seen, rows);
    } else if (item.kind === 'shortcut') {
      const link = isWebLink(item);
      const type = link ? 'link' : 'shortcut';
      const row = baseRow(state, type + ':' + item.id, item.name, item.parentId);
      rows.push({
        ...row,
        type,
        placementId: item.id,
        shortcutId: item.shortcutId,
        target: item.target,
        // A reference to the shared record, not a copy of it: section 0.2 forbids the latter.
        actionRef: { kind: 'shortcut', shortcutId: item.shortcutId, placementId: item.id },
      });
    }
  }
}

function layoutMemberRows(state, rows) {
  for (const layout of state.windowLayouts ?? []) {
    const layoutName = labelOf(layout);
    const ancestry = ancestryFor(state, layout.parentId);
    const breadcrumb = ancestry.breadcrumb === ''
      ? layoutName
      : ancestry.breadcrumb + QUICK_RUN_BREADCRUMB_SEPARATOR + layoutName;
    for (const member of layout.arrangement?.members ?? []) {
      const title = typeof member.descriptor?.title === 'string' && member.descriptor.title.trim() !== ''
        ? member.descriptor.title.trim()
        : 'Untitled window';
      rows.push({
        resultKey: 'layout-member:' + layout.id + ':' + member.id,
        type: 'layout-item',
        name: title,
        normalizedName: normaliseQueryText(title),
        breadcrumb,
        breadcrumbIds: [...ancestry.breadcrumbIds, layout.id],
        actionRef: { kind: 'layout-member', layoutId: layout.id, memberId: member.id },
        layoutId: layout.id,
        memberId: member.id,
      });
    }
  }
}

/** Every row Quick Run may show, before a query narrows them. */
export function quickRunRows(state) {
  const rows = [];
  folderRows(state, undefined, new Set(), rows);
  layoutMemberRows(state, rows);
  return rows;
}