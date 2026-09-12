/**
 * Quick Run — the searchable universe, as rows.
 *
 * Section 2.1 of the contract fixes four sources and their identities, and this module is only that
 * mapping:
 *
 * - one row per active folder (a group);
 * - one row per active shortcut **placement** — placement ids are the occurrence identity, so one
 *   shortcut linked into three folders is three rows that share a name and target and differ in
 *   breadcrumb;
 * - a Link is not a record kind at all: it is a shortcut whose target the model's own isWebLink()
 *   classifies as http(s), so there is one shortcut pass here and no second index;
 * - one row per window-layout **member occurrence**, with the containing layout in the breadcrumb.
 *
 * Activeness is the workspace's own rule rather than a parallel one: for groups and layouts the model
 * decides through itemsIn(), and for a placement an active one is simply not binned (the model's
 * activePlacements() is exactly that filter). Rows carry the stable result key section 1.3 preserves a
 * highlight by, and the icon section 1.2 names is drawn by the presentation layer from the row's kind.
 */
import { isWebLink, itemsIn } from '../../workspace-model-20260730b.js';

const KIND_BY_ITEM = Object.freeze({ group: 'folder', shortcut: 'shortcut' });

function labelOf(item) {
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  return name === '' ? 'Untitled' : name;
}

/** The chain of ancestor names above a parent id, for a faint trailing breadcrumb. */
function breadcrumbFor(state, parentId, seen) {
  const parts = [];
  let current = parentId;
  const guard = new Set();
  while (current && !guard.has(current)) {
    guard.add(current);
    const group = (state.groups ?? []).find((candidate) => candidate.id === current);
    if (!group) break;
    parts.unshift(labelOf(group));
    current = group.parentId;
  }
  return parts.join(' / ');
}

function folderRows(state, parentId, seen, rows) {
  for (const item of itemsIn(state, parentId)) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (item.kind === 'group') {
      rows.push({
        kind: 'folder',
        key: 'folder:' + item.id,
        name: labelOf(item),
        breadcrumb: breadcrumbFor(state, item.parentId, seen),
        folderId: item.id,
      });
      folderRows(state, item.id, seen, rows);
    } else if (item.kind === 'shortcut') {
      // isWebLink takes the record, not a bare target string: it reads candidate.target itself.
      const link = isWebLink(item);
      rows.push({
        kind: link ? 'link' : 'shortcut',
        key: 'placement:' + item.id,
        name: labelOf(item),
        breadcrumb: breadcrumbFor(state, item.parentId, seen),
        placementId: item.id,
        shortcutId: item.shortcutId,
        target: item.target,
      });
    }
  }
}

function layoutMemberRows(state, rows) {
  for (const layout of state.windowLayouts ?? []) {
    const layoutName = labelOf(layout);
    const folderChain = breadcrumbFor(state, layout.parentId, new Set());
    const breadcrumb = folderChain === '' ? layoutName : folderChain + ' / ' + layoutName;
    for (const member of layout.arrangement?.members ?? []) {
      rows.push({
        kind: 'layout-item',
        key: 'layout:' + layout.id + ':' + member.id,
        name: typeof member.descriptor?.title === 'string' && member.descriptor.title.trim() !== ''
          ? member.descriptor.title.trim()
          : 'Untitled window',
        breadcrumb,
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