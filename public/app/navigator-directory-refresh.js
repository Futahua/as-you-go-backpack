/** Refresh only changed, visible directory snapshots; never replace a later navigation. */
export const directoryListingSignature = result => JSON.stringify((result?.items||[]).map(x=>[x.path,x.name,x.kind,x.size,x.modifiedAt,x.hidden,x.offline]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
export function createNavigatorDirectoryRefresh({context,cached,list,apply}) {
  let busy=false,cursor=0;
  return async function refresh(){if(busy)return;const visit=context();if(!visit?.paths?.length)return;busy=true;
    try{const paths=[...new Set(visit.paths)],tail=paths.slice(1),selected=[paths[0],...tail.slice(cursor,cursor+5)];cursor=cursor+5>=tail.length?0:cursor+5;const changes=[];
      for(const path of selected){const old=await cached(path);const next=await list(path).catch(()=>null);if(next?.ok&&(!old?.ok||directoryListingSignature(old)!==directoryListingSignature(next)))changes.push({path,result:next});}
      const current=context();if(current?.key===visit.key&&changes.length)await apply(changes);
    }finally{busy=false;}
  };
}
