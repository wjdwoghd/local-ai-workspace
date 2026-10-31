// One-time migration through the existing authenticated local API. Never logs content or credentials.
const {readFile,mkdir,lstat,writeFile,realpath}=require('node:fs/promises');
const {execFileSync}=require('node:child_process');
const {join,resolve}=require('node:path');
async function main(){
  const [sourceFile,profilesFile,destination]=process.argv.slice(2);if(!sourceFile||!profilesFile||!destination)throw Error('Missing migration paths');
  const directory=resolve(destination);await mkdir(directory,{recursive:true});const stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||(await realpath(directory)).toLowerCase()!==directory.toLowerCase())throw Error('Invalid migration directory');
  const marker=join(directory,'.legacy-migrated');try{await lstat(marker);console.log('Local history migration: already completed');return;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(process.platform==='win32'){
    const system=process.env.SystemRoot||'C:\\Windows';
    const sid=execFileSync(join(system,'System32','whoami.exe'),['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true}).match(/S-1-(?:\d+-)+\d+/)?.[0];if(!sid)throw Error('Windows identity unavailable');
    execFileSync(join(system,'System32','icacls.exe'),[directory,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)(F)`,'*S-1-5-18:(OI)(CI)(F)','*S-1-5-32-544:(OI)(CI)(F)'],{windowsHide:true,stdio:'ignore'});
  }
  async function json(file){const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>1024*1024)throw Error('Invalid migration input');return JSON.parse(await readFile(file,'utf8'));}
  let source,profiles;try{source=await json(sourceFile);profiles=await json(profilesFile);}catch(e){if(e.code==='ENOENT'){await writeFile(marker,'no-legacy-source',{flag:'wx',mode:0o600});console.log('Local history migration: no legacy source');return;}throw e;}
  if(!/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(source.url)||!/^[-_A-Za-z0-9]{43}$/.test(source.pairing)||!Array.isArray(profiles)||profiles.some(p=>!p||!/^[-a-f0-9]{36}$/.test(p.id)))throw Error('Invalid legacy settings');
  async function call(path,credential,body){const r=await fetch(source.url+path,{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000),redirect:'error'});const result=await r.json();if(!r.ok||!result.ok)throw Error('Legacy request failed');return result.data;}
  let migrated=0,conversations=0,skipped=0;
  for(const profile of profiles){
    const path=join(directory,profile.id+'.json');try{await lstat(path);skipped++;continue;}catch(e){if(e.code!=='ENOENT')throw e;}
    let credential;
    try{credential=(await call('/api/local/session',source.pairing,{profile:profile.id})).credential;
      const items=await call('/api/action',credential,{action:'conversations'}),saved=[];
      for(const c of items){if(!/^[a-f0-9-]{36}$/.test(c.id))throw Error('Invalid conversation');saved.push({owner:profile.id,id:c.id,title:c.title,messages:await call('/api/action',credential,{action:'messages',id:c.id})});}
      await writeFile(path,JSON.stringify(saved),{flag:'wx',mode:0o600});migrated++;conversations+=saved.length;
    }finally{if(credential)await call('/api/action',credential,{action:'logout'}).catch(()=>{});}
  }
  await writeFile(marker,JSON.stringify({version:1,profiles:migrated,conversations,completedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
  console.log(`Local history migration: ${migrated} profiles, ${conversations} conversations; ${skipped} existing stores preserved`);
}
main().catch(()=>{console.error('Local history migration failed; legacy server and existing history were preserved.');process.exitCode=1;});
