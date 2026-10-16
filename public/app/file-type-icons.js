// Fallback artwork only. Native and authored icons retain precedence.
const families=[['pdf','PDF','#c38c88'],['doc docx odt rtf','DOC','#91abc4'],['xls xlsx ods csv','XLS','#96b59d'],['ppt pptx odp','PPT','#c3a188'],['png jpg jpeg gif webp svg ico bmp avif heic','IMG','#b19bc3'],['mp3 wav flac ogg m4a aac','♫','#b9a0be'],['mp4 mkv mov avi webm m4v','▶','#a79dc6'],['zip rar 7z tar gz bz2','ZIP','#b9ac82'],['js ts jsx tsx py java css html json xml yaml yml sql sh ps1','</>','#8fb6b2'],['dwg dxf rvt rfa skp blend obj fbx','CAD','#91b6be'],['md txt log','TXT','#aeb6bd'],['exe msi apk','APP','#9aaec0']];
export function fileTypeIcon(path){
 if(typeof path!=='string')return '';let name=path.split(/[\\/]/).pop();try{name=decodeURIComponent(name);}catch{}const ext=name.split('.').pop().toLowerCase(),family=families.find(([extensions])=>extensions.split(' ').includes(ext));if(!family)return '';
 const [,label,color]=family;const text=label==='</>'?'&lt;/&gt;':label;
 return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2.5h9l5 5v14H5z" fill="${color}" fill-opacity=".13" stroke="${color}" stroke-width="1.25"/><path d="M14 2.5v5h5" fill="none" stroke="${color}"/><text x="12" y="16" text-anchor="middle" fill="${color}" font-family="system-ui,sans-serif" font-size="6.4" font-weight="700">${text}</text></svg>`;
}

const outline=paths=>`<svg viewBox="0 0 20 20" aria-hidden="true">${paths.map(d=>`<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
export function fileFallbackIcon(item={}){
 if(item.kind==='folder'||item.kind==='group')return outline(['M2.5 6h5l1.5 2h8.5v8.5h-15z']);
 return fileTypeIcon(item.target||item.path)||fileTypeIcon(item.name)||outline(['M5 2.5h7l3 3v12H5z','M12 2.5v4h4']);
}
export async function phoneGraphFallback(item,stat){
 if(item?.icon)return item.icon;
 let entry=null;try{const result=await stat(item.target);if(result?.ok)entry=result.entry;}catch{}
 return 'data:image/svg+xml,'+encodeURIComponent(fileFallbackIcon({...item,...entry,target:item.target}).replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" ').replaceAll('currentColor','#b4c0ba'));
}
