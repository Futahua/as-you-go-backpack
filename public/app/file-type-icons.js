// Fallback artwork only. Native and authored icons retain precedence.
const families=[['pdf','PDF','#c38c88'],['doc docx odt rtf','DOC','#91abc4'],['xls xlsx ods csv','XLS','#96b59d'],['ppt pptx odp','PPT','#c3a188'],['png jpg jpeg gif webp svg ico bmp avif heic','IMG','#b19bc3'],['mp3 wav flac ogg m4a aac','♫','#b9a0be'],['mp4 mkv mov avi webm m4v','▶','#a79dc6'],['zip rar 7z tar gz bz2','ZIP','#b9ac82'],['js ts jsx tsx py java css html json xml yaml yml sql sh ps1','</>','#8fb6b2'],['dwg dxf rvt rfa skp blend obj fbx','CAD','#91b6be'],['md txt log','TXT','#aeb6bd'],['exe msi apk','APP','#9aaec0']];
export function fileTypeIcon(path){
 if(typeof path!=='string')return '';let name=path.split(/[\\/]/).pop();try{name=decodeURIComponent(name);}catch{}const ext=name.split('.').pop().toLowerCase(),family=families.find(([extensions])=>extensions.split(' ').includes(ext));if(!family)return '';
 const [,label,color]=family;const text=label==='</>'?'&lt;/&gt;':label;
 return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2.5h9l5 5v14H5z" fill="${color}" fill-opacity=".13" stroke="${color}" stroke-width="1.25"/><path d="M14 2.5v5h5" fill="none" stroke="${color}"/><text x="12" y="16" text-anchor="middle" fill="${color}" font-family="system-ui,sans-serif" font-size="6.4" font-weight="700">${text}</text></svg>`;
}
