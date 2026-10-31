// MIT assets from the same pinned upstream revision as the existing file icons.
const {readFile,writeFile}=require('node:fs/promises');
const {join}=require('node:path');
const ts=require('typescript');
const revision='23e86c06d09e92571ef027184c00cad78e8c827f';
const base=`https://raw.githubusercontent.com/material-extensions/vscode-material-icon-theme/${revision}/`;
const families='base src test config docs components python java javascript api database images public scripts admin resource lib utils app packages server client tools functions controller secure keys git github vscode css sass font views json node rust'.split(' ').map(n=>'folder-'+n);
const openPath='M14.483 6H4.721a1 1 0 0 0-.949.684L2 12V5h12a1 1 0 0 0-1-1H7.562a1 1 0 0 1-.64-.232l-.644-.536A1 1 0 0 0 5.638 3H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h11l2.403-5.606A1 1 0 0 0 14.483 6';
async function get(path){const r=await fetch(base+path);if(!r.ok)throw Error(`${path}: ${r.status}`);return r.text();}
async function main(){
  const destination=join(__dirname,'../src/renderer/assets/material'),map={};
  const source=ts.createSourceFile('folders.ts',await get('src/core/icons/folderIcons.ts'),ts.ScriptTarget.Latest,true);
  function visit(node){
    if(ts.isObjectLiteralExpression(node)){
      const props=Object.fromEntries(node.properties.filter(ts.isPropertyAssignment).map(p=>[p.name.getText(source),p.initializer]));
      if(props.name&&ts.isStringLiteral(props.name)&&families.includes(props.name.text)&&props.folderNames&&ts.isArrayLiteralExpression(props.folderNames)){
        for(const n of props.folderNames.elements)if(ts.isStringLiteral(n))map[n.text.toLowerCase()]=props.name.text;
      }
    }
    ts.forEachChild(node,visit);
  }visit(source);
  let index=0;
  await Promise.all(Array.from({length:6},async()=>{
    while(index<families.length){const key=families[index++],svg=await get(`icons/${key}.svg`);
      if(!svg.includes('id="folder"'))throw Error('Unexpected folder SVG: '+key);
      const opened=svg.replace(/<path\b[^>]*\bid="folder"[^>]*>/,tag=>tag.replace(/\bd="[^"]*"/,`d="${openPath}"`));
      if(opened===svg)throw Error('Open folder generation failed: '+key);
      await writeFile(join(destination,key+'.svg'),svg);await writeFile(join(destination,key+'-open.svg'),opened);
    }
  }));
  await writeFile(join(destination,'folder-names.json'),JSON.stringify(map,null,2)+'\n');
  console.log(`Material folder assets: ${families.length} families, ${Object.keys(map).length} names`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
