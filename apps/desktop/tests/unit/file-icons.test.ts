import { it,expect } from 'vitest';
import { materialIcon } from '../../src/renderer/FileIcon';
it('uses named Material folders and distinct open variants with safe generic fallbacks',()=>{
  for(const [name,key]of [['src','folder-src'],['TESTS','folder-test'],['.config','folder-config'],['python','folder-python'],['docs','folder-docs'],['components','folder-components']]){
    const closed=materialIcon(name,true),opened=materialIcon(name,true,true);
    expect(closed.key).toBe(key);expect(opened.key).toBe(key+'-open');expect(opened.src).toBeTruthy();expect(closed.src).not.toBe(opened.src);
  }
  expect(materialIcon('Modular_Math',true).key).toBe('folder-base');expect(materialIcon('constructor',true).key).toBe('folder-base');expect(materialIcon('__proto__').key).toBe('document');
  expect(materialIcon('solve.py').key).toBe('python');
});
