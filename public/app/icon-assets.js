// AYG owns asset policy; Papers provides verified content-addressed image writes.
export function createIconAssets(host) {
  const references=new Map();
  async function encode(serialized) {
    if(typeof serialized!=='string'||!serialized.includes('data:image/'))return serialized;
    const state=JSON.parse(serialized);
    const statePath=state.view?.preferences?.snapshotStorage?.statePath;
    // Without a configured snapshot folder there is nowhere to externalize icons. Keep them
    // embedded, as before icon assets existed: refusing here blocked every save of the workspace.
    if(typeof statePath!=='string')return serialized;
    const directory=statePath.replace(/[\\/][^\\/]+$/, '')+'/public/icons';
    async function visit(value) {
      if(typeof value==='string'&&/^data:image\//i.test(value)) {
        if(!references.has(value)) {
          const pending=(async()=>{
            const result=await host.fileCapability('store-image-asset',{directory,dataUrl:value});
            if(!result?.ok||!/^([a-f0-9]{64})\.(png|jpg|webp|gif|svg|ico)$/.test(result.filename||''))throw new Error(result?.message||'Icon asset could not be verified.');
            return './icons/'+result.filename;
          })();
          references.set(value,pending);
          pending.catch(()=>{if(references.get(value)===pending)references.delete(value);});
        }
        return await references.get(value);
      }
      if(Array.isArray(value)){for(let i=0;i<value.length;i++)value[i]=await visit(value[i]);return value;}
      if(value&&typeof value==='object'){
        // Sequential writes deduplicate identical images even on first migration.
        for(const k of Object.keys(value))value[k]=await visit(value[k]);
      }
      return value;
    }
    await visit(state);return JSON.stringify(state);
  }
  async function metadata(value) {
    if(!value||typeof value!=='object')return value;
    return {...value,baseSerialized:value.iconAssetMigration?value.baseSerialized:await encode(value.baseSerialized),pendingSnapshots:await Promise.all((value.pendingSnapshots||[]).map(async p=>({...p,serialized:await encode(p.serialized),baseSerialized:await encode(p.baseSerialized)})))};
  }
  return {encode,metadata};
}
