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
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker&inline';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker&inline';
import type { TextEdit } from '../../../../packages/shared-types/workspace-text';

(self as typeof self & { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = { getWorker: (_id, label) => label === 'json' ? new JsonWorker() : new EditorWorker() };
function language(path: string) {
  const extension = path.split('.').pop()?.toLowerCase() || '';
  const languages: Record<string, string> = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', json: 'json', css: 'css', html: 'html', py: 'python', md: 'markdown', sql: 'sql', yml: 'yaml', yaml: 'yaml', ps1: 'powershell', sh: 'shell', xml: 'xml' };
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
    const modified = monaco.editor.createModel(text, language(path)); model.current = modified;
    let base: monaco.editor.ITextModel | undefined;
    if (original !== undefined) {
      base = monaco.editor.createModel(original, language(path));
      const diff = monaco.editor.createDiffEditor(host.current!, { automaticLayout: true, editContext: false, readOnly, originalEditable: false, renderSideBySide: true, minimap: { enabled: false } });
      diff.setModel({ original: base, modified }); editor.current = diff;
    } else editor.current = monaco.editor.create(host.current!, { model: modified, automaticLayout: true, editContext: false, readOnly, minimap: { enabled: false }, fontSize: 14, scrollBeyondLastLine: false });
    const code = 'getModifiedEditor' in editor.current ? editor.current.getModifiedEditor() : editor.current;
    code.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save.current());
    const subscription = modified.onDidChangeContent(event => change.current(modified.getValue(), event.changes));
    const applyTheme = () => monaco.editor.setTheme(document.documentElement.dataset.theme === 'dark' ? 'vs-dark' : 'vs');
    applyTheme(); const observer = new MutationObserver(applyTheme); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { observer.disconnect(); subscription.dispose(); editor.current?.dispose(); modified.dispose(); base?.dispose(); };
  }, [path, original !== undefined]);
  useEffect(() => { if (model.current && model.current.getValue() !== text) model.current.setValue(text); }, [text]);
  useEffect(() => { editor.current?.updateOptions({ readOnly }); }, [readOnly]);
  useEffect(() => { const e = editor.current; if (e && 'getOriginalEditor' in e && original !== undefined) { const m = e.getOriginalEditor().getModel(); if (m?.getValue() !== original) m?.setValue(original); } }, [original]);
  return <div ref={host} className="workspace-editor" aria-label="코드 편집기" data-testid="workspace-editor" />;
}
