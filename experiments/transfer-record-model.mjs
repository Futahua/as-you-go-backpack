// Isolated experiment, not imported by production. The recipient owns receipts,
// disk bytes and AYG writes; initiator is deliberately absent from intent identity.
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const identity=s=>`${s.dev}:${s.ino}`;
export async function sourceReference(file){return{id:identity(await fs.stat(file)),version:hash(await fs.readFile(file))};}
export class Recipient {
 constructor(root){this.root=root;this.queue=Promise.resolve();this.copies=0;}
 async read(name,fallback){try{return JSON.parse(await fs.readFile(path.join(this.root,name),'utf8'));}catch(e){if(e.code==='ENOENT')return structuredClone(fallback);throw e;}}
 async write(name,value){const dest=path.join(this.root,name),temp=dest+'.pending';await fs.mkdir(this.root,{recursive:true});await fs.writeFile(temp,JSON.stringify(value));await fs.rename(temp,dest);}
 async document(){return this.read('ayg.json',{revision:0,links:[],other:[]});}
 async ownerEdit(label){const d=await this.document();d.other.push(label);d.revision++;await this.write('ayg.json',d);}
 submit(intent,{initiator,afterBytes,crashAfterPromote=false}={}){const work=this.queue.catch(()=>{}).then(()=>this.run(intent,{initiator,afterBytes,crashAfterPromote}));this.queue=work;return work;}
 async run(intent,{afterBytes,crashAfterPromote}){
  const receipts=await this.read('receipts.json',{}),canonical=JSON.stringify(intent);let r=receipts[intent.id];if(r&&r.intent!==canonical)throw Error('Operation ID reused for different intent');
  if(!r){const actual=await sourceReference(intent.sourcePath);if(actual.id!==intent.sourceId||actual.version!==intent.sourceVersion)throw Error('Source changed');r=receipts[intent.id]={intent:canonical,phase:'planned',path:path.join(this.root,intent.id+'-'+path.basename(intent.name))};await this.write('receipts.json',receipts);}
  if(r.phase==='planned'){
   const actual=await sourceReference(intent.sourcePath);if(actual.id!==intent.sourceId||actual.version!==intent.sourceVersion)throw Error('Source changed');
   const staging=r.path+'.part';await fs.copyFile(intent.sourcePath,staging);if(hash(await fs.readFile(staging))!==intent.sourceVersion)throw Error('Copy bytes changed');this.copies++;r.identity=identity(await fs.stat(staging));r.phase='prepared';await this.write('receipts.json',receipts);
  }
  if(r.phase==='prepared'){
   try{const s=await fs.stat(r.path);if(identity(s)!==r.identity)throw Error('Destination replaced');}catch(e){if(e.code!=='ENOENT')throw e;await fs.rename(r.path+'.part',r.path);}
   if(crashAfterPromote)throw Error('Simulated crash after promotion');r.phase='received';await this.write('receipts.json',receipts);
  }
  // A received acknowledgement cannot outrank the owner's current disk state.
  let current;try{current=await fs.stat(r.path);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!current||identity(current)!==r.identity){
   // Test stand-in for the production owner's identity resolver. Bounded to
   // this fixture directory, deliberately not a whole-device content scan.
   let found=false;for(const name of await fs.readdir(this.root)){const candidate=path.join(this.root,name),stat=await fs.stat(candidate);if(identity(stat)===r.identity){r.path=candidate;current=stat;found=true;break;}}
   if(!found)throw Error('Destination deleted or unavailable');await this.write('receipts.json',receipts);
  }
  if(identity(current)!==r.identity||hash(await fs.readFile(r.path))!==intent.sourceVersion)throw Error('Destination replaced');
  if(r.phase==='linked')return structuredClone(r);
  const before=await this.document();await afterBytes?.(this,r);const currentDoc=await this.document();if(currentDoc.revision!==before.revision)return{...r,linkPending:true};
  if(!currentDoc.links.some(x=>x.transferId===intent.id))currentDoc.links.push({transferId:intent.id,targetIdentity:r.identity,path:r.path});currentDoc.revision++;await this.write('ayg.json',currentDoc);r.phase='linked';await this.write('receipts.json',receipts);return structuredClone(r);
 }
}

export async function contentReuseDecision(candidate,expected,{sameDestination=true,explicitDuplicate=false}={}){
 if(explicitDuplicate)return 'new-copy';
 const before=await fs.stat(candidate);if(before.size!==expected.size)return 'different-content';
 const digest=hash(await fs.readFile(candidate)),after=await fs.stat(candidate);
 if(identity(before)!==identity(after)||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('Candidate changed');
 if(digest!==expected.version)return 'different-content';
 return sameDestination?'reuse-existing':'reuse-bytes-for-new-file';
}
