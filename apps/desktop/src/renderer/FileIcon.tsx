const icons = import.meta.glob('./assets/material/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export function materialIcon(name: string, directory = false, open = false) {
  const lower = name.toLowerCase();
  const extensions: Record<string,string> = { ts:'typescript',tsx:'react_ts',js:'javascript',jsx:'react',json:'json',html:'html',htm:'html',css:'css',scss:'sass',sass:'sass',md:'markdown',py:'python',java:'java',cs:'csharp',cpp:'cpp',c:'c',h:'c',go:'go',rs:'rust',sql:'database',xml:'xml',yml:'yaml',yaml:'yaml',ps1:'powershell',sh:'console',bash:'console',png:'image',jpg:'image',jpeg:'image',gif:'image',svg:'image',webp:'image',pdf:'pdf',zip:'zip',gz:'zip',vue:'vue',svelte:'svelte',txt:'document' };
  const folders=folderNames as Record<string,string>,normalized=lower.replace(/^\./,''),extension=lower.split('.').pop()||'';
  const folder=Object.hasOwn(folders,lower)?folders[lower]:Object.hasOwn(folders,normalized)?folders[normalized]:'folder-base';
  const key = directory ? folder+(open?'-open':'') : lower === 'package.json' || lower.includes('lock.yaml') ? 'npm' : lower.startsWith('dockerfile') ? 'docker' : lower.startsWith('.git') ? 'git' : Object.hasOwn(extensions,extension)?extensions[extension]:'document';
  return { key, src: icons[`./assets/material/${key}.svg`] || icons['./assets/material/document.svg'] };
}
export function FileIcon({ name, directory, open }: { name: string; directory?: boolean; open?: boolean }) {
  const icon = materialIcon(name, directory, open);
  return <img className="material-file-icon" src={icon.src} alt="" aria-hidden="true" data-icon={icon.key} draggable={false} />;
}
import folderNames from './assets/material/folder-names.json';
