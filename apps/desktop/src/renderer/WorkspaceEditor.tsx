import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/features/register.all.js';
import 'monaco-editor/languages/definitions/typescript/register.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/language/json/monaco.contribution';
import 'monaco-editor/languages/definitions/css/register.js';
import 'monaco-editor/languages/definitions/html/register.js';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import 'monaco-editor/languages/definitions/sql/register.js';
import 'monaco-editor/languages/definitions/powershell/register.js';
import 'monaco-editor/languages/definitions/shell/register.js';
import 'monaco-editor/languages/definitions/yaml/register.js';
import 'monaco-editor/languages/definitions/xml/register.js';
import 'monaco-editor/languages/definitions/java/register.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker&inline';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker&inline';
import type { TextEdit } from '../../../../packages/shared-types/workspace-text';

(self as typeof self & { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = { getWorker: (_id, label) => label === 'json' ? new JsonWorker() : new EditorWorker() };
for(const dark of [true,false])monaco.editor.defineTheme(dark?'workspace-dark':'workspace-light',{
  base:dark?'vs-dark':'vs',inherit:true,
  rules:[
    {token:'keyword',foreground:dark?'D89CFF':'7B20A3'},
    {token:'string',foreground:dark?'B9E58B':'236A20'},
    {token:'number',foreground:dark?'FFB072':'9D4510'},
    {token:'comment',foreground:dark?'8FAB91':'526C56',fontStyle:'italic'},
    {token:'type',foreground:dark?'65D8E8':'006A80'},
    {token:'type.identifier',foreground:dark?'65D8E8':'006A80'},
    {token:'identifier',foreground:dark?'DFE9F5':'243448'},
    {token:'delimiter',foreground:dark?'D6DFEB':'404C59'},
    {token:'operator',foreground:dark?'E8C86B':'775900'},
    {token:'tag',foreground:dark?'FF9090':'A02F35'},
    {token:'attribute.name',foreground:dark?'82C9FF':'075DA3'},
  ],
  colors:{
    ...(dark?{'editor.background':'#1B1E25','editor.foreground':'#DFE9F5','editorLineNumber.foreground':'#8190A4','editorLineNumber.activeForeground':'#E4EAF3'}:{'editor.background':'#FAFBFC','editor.foreground':'#243448','editorLineNumber.foreground':'#6C7887'}),
    ...Object.fromEntries(Array.from({length:6},(_,i)=>[
      [`editorIndentGuide.background${i+1}`,dark?'#4C5C74':'#B8C5D6'],
      [`editorIndentGuide.activeBackground${i+1}`,dark?'#93C5FD':'#3976BA'],
      [`editorBracketPairGuide.background${i+1}`,dark?'#4C5C74':'#B8C5D6'],
      [`editorBracketPairGuide.activeBackground${i+1}`,dark?'#93C5FD':'#3976BA'],
    ]).flat()),
  },
});
function language(path: string) {
  const extension = path.split('.').pop()?.toLowerCase() || '';
  const languages: Record<string, string> = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', json: 'json', css: 'css', html: 'html', py: 'python', md: 'markdown', sql: 'sql', yml: 'yaml', yaml: 'yaml', ps1: 'powershell', sh: 'shell', xml: 'xml', java:'java' };
  return Object.hasOwn(languages, extension) ? languages[extension] : 'plaintext';
}
export function WorkspaceEditor({ path, text, original, readOnly, onChange, onSave }: {
  path: string; text: string; original?: string; readOnly: boolean; onChange(text: string, edits: readonly TextEdit[]): void; onSave(): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | monaco.editor.IStandaloneDiffEditor | undefined>(undefined);
  const model = useRef<monaco.editor.ITextModel | undefined>(undefined);
  const change = useRef(onChange); change.current = onChange;
  const save = useRef(onSave); save.current = onSave;
  useEffect(() => {
    const codeOptions:monaco.editor.IEditorOptions={fontFamily:'D2Coding, monospace',fontSize:14,fontLigatures:false,
      guides:{indentation:true,highlightActiveIndentation:'always',bracketPairs:true,bracketPairsHorizontal:'active',highlightActiveBracketPair:true},
      bracketPairColorization:{enabled:true,independentColorPoolPerBracketType:true},
    };
    const modified = monaco.editor.createModel(text, language(path)); model.current = modified;
    let base: monaco.editor.ITextModel | undefined;
    if (original !== undefined) {
      base = monaco.editor.createModel(original, language(path));
      const diff = monaco.editor.createDiffEditor(host.current!, { ...codeOptions, automaticLayout: true, editContext: false, readOnly, originalEditable: false, renderSideBySide: true, minimap: { enabled: false } });
      diff.setModel({ original: base, modified }); editor.current = diff;
    } else editor.current = monaco.editor.create(host.current!, { ...codeOptions, model: modified, automaticLayout: true, editContext: false, readOnly, minimap: { enabled: false }, scrollBeyondLastLine: false });
    const code = 'getModifiedEditor' in editor.current ? editor.current.getModifiedEditor() : editor.current;
    code.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save.current());
    const subscription = modified.onDidChangeContent(event => change.current(modified.getValue(), event.changes));
    let disposed=false;
    void document.fonts.load('14px D2Coding').then(()=>{if(!disposed){monaco.editor.remeasureFonts();editor.current?.layout();}});
    const applyTheme = () => monaco.editor.setTheme(document.documentElement.dataset.theme === 'dark' ? 'workspace-dark' : 'workspace-light');
    applyTheme(); const observer = new MutationObserver(applyTheme); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { disposed=true;observer.disconnect(); subscription.dispose(); editor.current?.dispose(); modified.dispose(); base?.dispose(); };
  }, [path, original !== undefined]);
  useEffect(() => { if (model.current && model.current.getValue() !== text) model.current.setValue(text); }, [text]);
  useEffect(() => { editor.current?.updateOptions({ readOnly }); }, [readOnly]);
  useEffect(() => { const e = editor.current; if (e && 'getOriginalEditor' in e && original !== undefined) { const m = e.getOriginalEditor().getModel(); if (m?.getValue() !== original) m?.setValue(original); } }, [original]);
  return <div ref={host} className="workspace-editor" aria-label="코드 편집기" data-testid="workspace-editor" />;
}
