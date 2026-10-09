// Durable Papers page keys distinguish two pages of the same Backpack.
export const pagePaneKey=(page,root)=>page?`page:${page}:root:${root}`:root;
export function readPagePaneSettings(layouts,page,root,legacy=false){
  return layouts[pagePaneKey(page,root)] ?? (legacy&&!layouts[`migration:${root}`]?layouts[root]:undefined);
}
export function writePagePaneSettings(layouts,page,root,settings,legacy=false){
  return {...layouts,[pagePaneKey(page,root)]:settings,...(page&&legacy?{[`migration:${root}`]:page}:{})};
}
