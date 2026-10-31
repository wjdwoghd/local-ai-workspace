import { isValidElement, memo, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import powershell from 'highlight.js/lib/languages/powershell';
import { common } from 'lowlight';
import type { Citation } from '../../../../packages/shared-types/search';
import { safeWebURL } from '../../../../packages/shared-types/search';
import 'katex/dist/katex.min.css';
import './markdown.css';

type AstNode = { type:string; value?:string; url?:string; children?:AstNode[]; position?:{start:{offset?:number};end:{offset?:number}} };
function citationLinks(text:string, citations:Citation[]) {
  return () => (tree:AstNode) => {
    function visit(parent:AstNode) {
      if (!parent.children || ['link','code','inlineCode','html','math','inlineMath'].includes(parent.type)) return;
      for(let i=0;i<parent.children.length;i++) {
        const child=parent.children[i];
        if(child.type!=='text'||!child.value){visit(child);continue;}
        const value=child.value,ranges:{start:number;end:number;index:number}[]=[];
        for(const match of value.matchAll(/\[D\d+\]/g)) {const index=citations.findIndex(c=>c.kind==='document'&&c.title.startsWith(match[0]+' '));if(index>=0)ranges.push({start:match.index!,end:match.index!+match[0].length,index});}
        const start=child.position?.start.offset;
        if(start!==undefined)citations.forEach((c,index)=>{if(c.kind!=='web'||!safeWebURL(c.url)||!Number.isInteger(c.start)||!Number.isInteger(c.end))return;const a=c.start!-start,b=c.end!-start;if(a>=0&&b>a&&b<=value.length&&value.slice(a,b)===text.slice(c.start,c.end))ranges.push({start:a,end:b,index});});
        if(!ranges.length)continue;
        ranges.sort((a,b)=>a.start-b.start);const nodes:AstNode[]=[];let offset=0;
        for(const range of ranges){if(range.start<offset)continue;if(range.start>offset)nodes.push({type:'text',value:value.slice(offset,range.start)});nodes.push({type:'link',url:`#citation-${range.index}`,children:[{type:'text',value:value.slice(range.start,range.end)}]});offset=range.end;}
        if(offset<value.length)nodes.push({type:'text',value:value.slice(offset)});
        parent.children.splice(i,1,...nodes);i+=nodes.length-1;
      }
    }
    visit(tree);
  };
}
function mathDelimiters(text:string) {
  let fence='',length=0;
  return text.split('\n').map(line=>{
    const match=line.match(/^ {0,3}(`{3,}|~{3,})/);
    if(match){if(!fence){fence=match[1][0];length=match[1].length;}else if(match[1][0]===fence&&match[1].length>=length)fence='';return line;}
    if(fence)return line;
    return line.split(/(`+[^`]*`+)/g).map((part,i)=>i%2?part:part.replace(/\\\[/g,'$$$$').replace(/\\\]/g,'$$$$').replace(/\\\(/g,'$').replace(/\\\)/g,'$')).join('');
  }).join('\n');
}
function CodeBlock({children}:{children?:ReactNode}) {
  const ref=useRef<HTMLPreElement>(null),[copied,setCopied]=useState(false),[error,setError]=useState('');
  const language=isValidElement<{className?:string}>(children)?children.props.className?.match(/language-([^\s]+)/)?.[1]:undefined;
  return <div className="markdown-code"><div className="markdown-code-toolbar"><span>{language||'코드'}</span><button type="button" onClick={async()=>{try{await window.desktop.copyText(ref.current?.textContent||'');setCopied(true);setError('');}catch{setError('복사하지 못했습니다.');}}}>{copied?'복사됨':'코드 복사'}</button></div><pre ref={ref}>{children}</pre>{error&&<small role="status">{error}</small>}</div>;
}
export const Markdown = memo(function Markdown({text,citations=[],onCitation}:{text:string;citations?:Citation[];onCitation?(citation:Citation):void}) {
  const cite=useMemo(()=>citationLinks(text,citations),[text,citations]);
  return <div className="markdown-body"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm,remarkMath,cite]} rehypePlugins={[[rehypeKatex,{trust:false,throwOnError:false,maxExpand:1000}],[rehypeHighlight,{ignoreMissing:true,detect:true,languages:{...common,powershell},subset:['javascript','typescript','python','sql','bash','json','powershell']}]]} components={{
    pre:({children})=><CodeBlock>{children}</CodeBlock>,
    table:({children})=><div className="markdown-table"><table>{children}</table></div>,
    a:({href,children})=>{const match=href?.match(/^#citation-(\d+)$/);if(match&&citations[Number(match[1])])return <button type="button" className="inline-citation" onClick={()=>onCitation?.(citations[Number(match[1])])}>{children}</button>;return href&&safeWebURL(href)?<a href={href} onClick={e=>{e.preventDefault();void window.desktop.openSource(href);}}>{children}</a>:<span>{children}</span>;},
    img:({alt})=><span>{alt||'이미지'}</span>,
  }}>{mathDelimiters(text)}</ReactMarkdown></div>;
});
