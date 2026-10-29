import { parentPort, workerData } from 'node:worker_threads';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const parts = [];
let characters = 0;
function add(location, text) {
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return;
  characters += text.length;
  if (characters > 1_000_000) throw Error('Text limit');
  for (let offset = 0; offset < text.length; offset += 1000) {
    parts.push({ location, text: text.slice(offset, offset + 1200) });
    if (parts.length > 1000) throw Error('Chunk limit');
  }
}
const array = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
function nodes(value, tag) {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => key === tag ? array(child) : array(child).flatMap(item => nodes(item, tag)));
}
function textOf(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return nodes(value, 't').map(t => typeof t === 'object' ? t['#text'] ?? '' : t).join('');
}
async function extract() {
  const { name, bytes } = workerData;
  const extension = name.split('.').pop().toLowerCase();
  if (extension === 'txt' || extension === 'md') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) throw Error('Binary text');
    text.split(/\r?\n/).forEach((line, i) => add(`줄 ${i + 1}`, line));
  } else if (extension === 'pdf') {
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw Error('Invalid PDF');
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 300) throw Error('Page limit');
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        add(`페이지 ${p}`, content.items.map(item => item.str ?? '').join(' '));
        page.cleanup();
      }
    } finally { await task.destroy(); }
  } else {
    let total = 0, entries = 0;
    const files = unzipSync(bytes, { filter(file) {
      if (++entries > 3000 || file.originalSize > 10 * 1024 * 1024 || (total += file.originalSize) > 30 * 1024 * 1024) throw Error('Archive limit');
      return /^(word\/document\.xml|ppt\/slides\/slide\d+\.xml|xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/sheet\d+\.xml))$/.test(file.name);
    } });
    const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: false, processEntities: true });
    const xml = path => {
      if (!files[path]) throw Error('Invalid Office file');
      const text = strFromU8(files[path]);
      if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw Error('Unsafe XML');
      // Only standard XML entities are accepted; external entities are disabled.
      return parser.parse(text);
    };
    if (extension === 'docx') nodes(xml('word/document.xml'), 'p').forEach((p, i) => add(`문단 ${i + 1}`, textOf(p)));
    if (extension === 'pptx') {
      const slides = Object.keys(files).filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a,b) => a.localeCompare(b, 'en', { numeric: true }));
      if (!slides.length) throw Error('Invalid presentation');
      slides.forEach(path => add(`슬라이드 ${path.match(/slide(\d+)/)[1]}`, nodes(xml(path), 'p').map(textOf).join(' ')));
    }
    if (extension === 'xlsx') {
      const shared = files['xl/sharedStrings.xml'] ? nodes(xml('xl/sharedStrings.xml'), 'si').map(textOf) : [];
      const workbook = xml('xl/workbook.xml');
      const relationships = nodes(xml('xl/_rels/workbook.xml.rels'), 'Relationship');
      for (const sheet of nodes(workbook, 'sheet')) {
        const relation = relationships.find(r => r['@_Id'] === sheet['@_id']);
        const target = relation?.['@_Target'];
        if (typeof target !== 'string' || relation['@_TargetMode'] === 'External') continue;
        const path = target.startsWith('/xl/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
        if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) continue;
        for (const row of nodes(xml(path), 'row')) {
          const cells = nodes(row, 'c').map(cell => {
            const value = cell['@_t'] === 's' ? shared[Number(cell.v)] ?? '' : cell['@_t'] === 'inlineStr' ? textOf(cell.is) : cell.v ?? '';
            return `${cell['@_r'] ?? ''}: ${value}`;
          });
          add(`시트 ${sheet['@_name']} · 행 ${row['@_r'] ?? '?'}`, cells.join(' | '));
        }
      }
    }
  }
  if (!parts.length) throw Error('No searchable text');
  return parts;
}
extract().then(parts => parentPort.postMessage({ parts })).catch(() => parentPort.postMessage({ error: true }));
