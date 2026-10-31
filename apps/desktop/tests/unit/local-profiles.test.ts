import { beforeEach, afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalProfiles } from '../../src/main/local-profiles';
import { parseLocalProfileRequest } from '../../../../packages/shared-types/local-profile';
import { LocalWorkspace } from '../../src/main/workspace';

let root: string; let profiles: LocalProfiles;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'local-profiles-')); profiles = new LocalProfiles(join(root, 'profiles')); await profiles.initialize(); });
afterEach(async () => { await rm(root, {recursive:true,force:true,maxRetries:4,retryDelay:100}); });
const add = async (name: string) => { const view = await profiles.profilesRequest({action:'create',name}); return view.profiles.find(p=>p.name===name)!; };
it('keeps profile settings and logs separate across switches and process restarts without a transport', async () => {
  const a=await add('홍길동'), b=await add('김테스트');
  expect(await profiles.execute({action:'me'})).toMatchObject({ok:false,status:401});
  await profiles.profilesRequest({action:'select',id:a.id}); const old=profiles.sessionGeneration;
  await profiles.execute({action:'saveSettings',theme:'dark'}); await profiles.execute({action:'recordGit',operation:'commit',outcome:'succeeded'});
  await profiles.profilesRequest({action:'select',id:b.id}); expect(profiles.sessionGeneration).toBeGreaterThan(old);
  expect(await profiles.execute({action:'settings'})).toEqual({ok:true,data:{theme:'system'}});
  expect(await profiles.execute({action:'activity'})).toEqual({ok:true,data:[]});
  const restarted=new LocalProfiles(join(root,'profiles'));await restarted.initialize();
  expect(restarted.hasSession).toBe(false); await restarted.profilesRequest({action:'select',id:a.id});
  expect(await restarted.execute({action:'settings'})).toEqual({ok:true,data:{theme:'dark'}});
  expect(await restarted.execute({action:'activity'})).toMatchObject({ok:true,data:[{action:'git.commit'}]});
  expect(await restarted.execute({action:'users'})).toMatchObject({ok:false,status:503});
  expect(await restarted.execute({action:'myUsage'})).toMatchObject({ok:false,status:503});
});
it('rejects other profile homes, previously claimed projects and overlapping project paths', async () => {
  const a=await add('홍길동'), b=await add('김테스트');
  await profiles.profilesRequest({action:'select',id:a.id}); const home=profiles.homeDirectory;
  const external=join(root,'external'); await mkdir(external); await mkdir(join(external,'nested'));
  await profiles.claimProject(home); await profiles.claimProject(external);
  await profiles.profilesRequest({action:'select',id:b.id});
  await expect(profiles.claimProject(home)).rejects.toThrow('프로필');
  await expect(profiles.claimProject(external)).rejects.toThrow('다른 팀원');
  await expect(profiles.claimProject(join(external,'nested'))).rejects.toThrow('다른 팀원');
  await expect(profiles.claimProject(root)).rejects.toThrow('프로필');
  expect(await profiles.claimProject(profiles.homeDirectory)).toBe(profiles.homeDirectory);
});
it('invalidates old workspace handles and refuses requests from an outgoing profile', async () => {
  const workspace=new LocalWorkspace(()=>{});
  profiles=new LocalProfiles(join(root,'linked-profiles'),()=>workspace.dispose());await profiles.initialize();
  const a=await add('홍길동'),b=await add('김테스트');
  await profiles.profilesRequest({action:'select',id:a.id}); const info=await workspace.select(profiles.homeDirectory);
  await profiles.profilesRequest({action:'select',id:b.id});
  expect(()=>workspace.assertCurrent(info.id)).toThrow();
  const leaving=profiles.profilesRequest({action:'leave'});
  const late=profiles.execute({action:'saveSettings',theme:'dark'});
  await leaving; expect(await late).toMatchObject({ok:false,status:401}); workspace.dispose();
});
it('imports a local roster once and never embeds credentials or roster paths in saved profile data', async () => {
  const file=join(root,'roster.json');await writeFile(file,JSON.stringify(['홍길동','김테스트']));
  const imported=new LocalProfiles(join(root,'imported'));await imported.initialize(file);
  const view=await imported.profilesRequest({action:'list'});expect(view.profiles).toHaveLength(2);
  const saved=await readFile(join(root,'imported','profiles.json'),'utf8');expect(saved).not.toContain(file);expect(saved).not.toContain('password');
  await writeFile(file,'[]');const restarted=new LocalProfiles(join(root,'imported'));await restarted.initialize(file);
  expect((await restarted.profilesRequest({action:'list'})).profiles).toHaveLength(2);
});
it('preserves malformed state, rejects forged selectors and blocks linked profile directories', async () => {
  for(const raw of [{action:'select',id:'../other'},{action:'create',name:'홍길동',root:'elsewhere'},{action:'list',owner:'other'}])expect(()=>parseLocalProfileRequest(raw)).toThrow();
  const a=await add('홍길동');await profiles.profilesRequest({action:'select',id:a.id});await profiles.profilesRequest({action:'leave'});
  const file=join(root,'profiles',a.id,'state.json');await writeFile(file,'broken');
  await expect(profiles.profilesRequest({action:'select',id:a.id})).rejects.toThrow(); expect(await readFile(file,'utf8')).toBe('broken');
  const b=await add('김테스트'); const outside=join(root,'outside');await mkdir(outside);
  await symlink(outside,join(root,'profiles',b.id),process.platform==='win32'?'junction':'dir');
  await expect(profiles.profilesRequest({action:'select',id:b.id})).rejects.toThrow('링크');
});
