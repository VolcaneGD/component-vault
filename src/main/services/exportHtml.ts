import { open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type {
  ExportComponent,
  ExportPayload,
} from '../../shared/contracts';
import { isPreviewPolicy } from '../../shared/contracts';
export { createCopyText, sanitizeDownloadFileName } from '../../shared/exportCode';

const FORMAT = 'component-vault';
const VERSION = 1;
const MAX_SOURCE_CHARACTERS = 25 * 1024 * 1024;
const MAX_COMPONENTS = 1_000;
const MAX_ENCODED_COMPONENT_CHARACTERS = 10 * 1024 * 1024;
const MAX_INFLATED_COMPONENT_BYTES = 6 * 1024 * 1024;

interface EmbeddedComponent {
  encoding: 'gzip-base64';
  data: string;
}

interface EmbeddedEnvelope {
  format: typeof FORMAT;
  version: typeof VERSION;
  library: ExportPayload['library'];
  components: EmbeddedComponent[];
}

export type AtomicSaveResult =
  | { ok: true; path: string; html: string }
  | { ok: false; path: string; html: string; message: string; temporaryPath?: never };

export const createStandaloneHtml = async (payload: ExportPayload): Promise<string> => {
  const validated = validateExportPayload(payload);
  if (!validated) throw new Error('Invalid Component Vault export payload');

  const envelope: EmbeddedEnvelope = {
    format: FORMAT,
    version: VERSION,
    library: validated.library,
    components: validated.components.map((component) => ({
      encoding: 'gzip-base64',
      data: gzipSync(Buffer.from(JSON.stringify(component), 'utf8')).toString('base64'),
    })),
  };

  return standaloneDocument(escapeScriptJson(JSON.stringify(envelope)));
};

export const parseComponentVaultHtml = (source: string): ExportPayload | null => {
  if (typeof source !== 'string' || source.length > MAX_SOURCE_CHARACTERS) return null;
  const matches = [...source.matchAll(
    /<script\b(?=[^>]*\bid=["']component-vault-data["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script\s*>/gi,
  )];
  if (matches.length !== 1) return null;

  try {
    const envelope = JSON.parse(matches[0][1]) as unknown;
    if (!isEmbeddedEnvelope(envelope)) return null;
    const components = envelope.components.map((entry) => {
      const compressed = Buffer.from(entry.data, 'base64');
      if (compressed.toString('base64') !== entry.data) throw new Error('Invalid Base64 payload');
      const inflated = gunzipSync(compressed, { maxOutputLength: MAX_INFLATED_COMPONENT_BYTES });
      const component = JSON.parse(inflated.toString('utf8')) as unknown;
      if (!isExportComponent(component)) throw new Error('Invalid component payload');
      return component;
    });
    return validateExportPayload({
      format: FORMAT,
      version: VERSION,
      library: envelope.library,
      components,
    });
  } catch {
    return null;
  }
};

export const saveStandaloneHtmlAtomically = async (
  destination: string,
  html: string,
): Promise<AtomicSaveResult> => {
  const temporaryPath = join(
    dirname(destination),
    `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, 'wx');
    await handle.writeFile(html, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, destination);
    return { ok: true, path: destination, html };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    return {
      ok: false,
      path: destination,
      html,
      message: error instanceof Error ? error.message : 'Unable to save export',
    };
  }
};

const escapeScriptJson = (source: string): string => source
  .replace(/&/g, '\\u0026')
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

const isEmbeddedEnvelope = (value: unknown): value is EmbeddedEnvelope => {
  if (!isRecord(value)
    || value.format !== FORMAT
    || value.version !== VERSION
    || !isLibrary(value.library)
    || !Array.isArray(value.components)
    || value.components.length > MAX_COMPONENTS) return false;
  return value.components.every((entry) => isRecord(entry)
    && entry.encoding === 'gzip-base64'
    && typeof entry.data === 'string'
    && entry.data.length <= MAX_ENCODED_COMPONENT_CHARACTERS
    && entry.data.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.data));
};

const validateExportPayload = (value: unknown): ExportPayload | null => {
  if (!isRecord(value)
    || value.format !== FORMAT
    || value.version !== VERSION
    || !isLibrary(value.library)
    || !Array.isArray(value.components)
    || value.components.length > MAX_COMPONENTS
    || !value.components.every(isExportComponent)) return null;
  return {
    format: FORMAT,
    version: VERSION,
    library: { name: value.library.name, description: value.library.description },
    components: value.components.map((component) => ({
      name: component.name,
      description: component.description,
      category: component.category,
      tags: [...component.tags],
      html: component.html,
      css: component.css,
      javascript: component.javascript,
      previewPolicy: {
        allowScripts: component.previewPolicy.allowScripts,
        allowForms: component.previewPolicy.allowForms,
        allowPopups: component.previewPolicy.allowPopups,
        externalNetworkEnabled: component.previewPolicy.externalNetworkEnabled ?? false,
        allowedOrigins: [...component.previewPolicy.allowedOrigins],
      },
    })),
  };
};

const isLibrary = (value: unknown): value is ExportPayload['library'] => isRecord(value)
  && isBoundedString(value.name, 255, false)
  && isBoundedString(value.description, 10_000);

const isExportComponent = (value: unknown): value is ExportComponent => isRecord(value)
  && isBoundedString(value.name, 255, false)
  && isBoundedString(value.description, 10_000)
  && isBoundedString(value.category, 255)
  && Array.isArray(value.tags)
  && value.tags.length <= 100
  && value.tags.every((tag) => isBoundedString(tag, 100))
  && isBoundedString(value.html, 2_000_000)
  && isBoundedString(value.css, 2_000_000)
  && isBoundedString(value.javascript, 2_000_000)
  && isPreviewPolicy(value.previewPolicy);

const isBoundedString = (value: unknown, maximum: number, allowEmpty = true): value is string =>
  typeof value === 'string' && value.length <= maximum && (allowEmpty || value.trim().length > 0);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const standaloneDocument = (embeddedJson: string): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; frame-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>Component Vault Standalone Library</title>
  <style>
    :root{color-scheme:dark;font:14px/1.5 Inter,Segoe UI,sans-serif;background:#090b10;color:#e8eaf2}*{box-sizing:border-box}body{margin:0;min-height:100vh}.app{display:grid;grid-template-columns:270px minmax(0,1fr);min-height:100vh}.sidebar{background:linear-gradient(180deg,#131722,#0d1018);border-right:1px solid #282e3d;padding:22px 16px;display:flex;flex-direction:column;gap:18px}.brand{font-size:18px;font-weight:750;letter-spacing:-.02em}.brand small{display:block;color:#8891a5;font-size:11px;text-transform:uppercase;letter-spacing:.13em}.sidebar input,.workspace input,.workspace textarea{width:100%;border:1px solid #30384a;border-radius:9px;background:#0c0f16;color:#f4f6fb;padding:9px 11px}.items{list-style:none;padding:0;margin:0;display:grid;gap:6px;overflow:auto}.item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px}.item>button:first-child{text-align:left;overflow:hidden;text-overflow:ellipsis}.item[aria-current=true]>button:first-child{background:#725cff;color:#fff;border-color:#8d7cff}button{border:1px solid #30384a;border-radius:8px;background:#191e2b;color:#dfe3ee;padding:8px 10px;cursor:pointer}button:hover{background:#252b3b}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid #9b8cff;outline-offset:2px}.sidebar-actions{margin-top:auto;display:grid;gap:8px}.workspace{padding:24px;min-width:0}.workspace-header{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:18px}.workspace-header h1{margin:0;font-size:22px}.toolbar{display:flex;gap:8px;flex-wrap:wrap}.editor-grid{display:grid;grid-template-columns:minmax(340px,.9fr) minmax(360px,1.1fr);gap:16px;min-height:calc(100vh - 105px)}.panel{border:1px solid #282e3d;border-radius:14px;background:#11151f;overflow:hidden;box-shadow:0 16px 42px #0007}.panel-header{padding:12px;border-bottom:1px solid #282e3d;display:grid;gap:9px}.tabs{display:flex;gap:6px;padding:10px 12px;border-bottom:1px solid #282e3d}.tabs button[aria-selected=true]{background:#725cff;color:#fff}.code-pane{padding:12px}.code-pane textarea{min-height:360px;resize:vertical;font:13px/1.55 Consolas,monospace;tab-size:2}.copy-row{display:flex;gap:7px;padding:0 12px 12px;flex-wrap:wrap}.preview-panel{display:grid;grid-template-rows:auto minmax(0,1fr)}.preview-heading{padding:12px 15px;border-bottom:1px solid #282e3d;display:flex;justify-content:space-between}.preview-heading span:last-child{color:#69d6a2}.preview{width:100%;height:100%;min-height:450px;border:0;background:#fff}.status{min-height:20px;color:#9ea7ba;font-size:12px}@media(max-width:900px){.app{grid-template-columns:220px minmax(0,1fr)}.editor-grid{grid-template-columns:1fr}.preview{min-height:360px}}@media(max-width:650px){.app{display:block}.sidebar{border-right:0;border-bottom:1px solid #282e3d}.items{max-height:160px}.workspace{padding:14px}}
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar" aria-label="Component library">
      <div class="brand"><small>Offline library</small><span id="library-name"></span></div>
      <ul id="items" class="items"></ul>
      <div class="sidebar-actions">
        <button id="add-files" type="button">Add HTML files</button>
        <input id="file-input" type="file" accept=".html,.htm,text/html" multiple hidden>
        <button id="save-library" type="button">Save edited HTML</button>
        <div id="status" class="status" role="status" aria-live="polite"></div>
      </div>
    </aside>
    <main class="workspace">
      <header class="workspace-header"><h1>Component workbench</h1><div class="toolbar"><button id="move-up" type="button">Move up</button><button id="move-down" type="button">Move down</button></div></header>
      <div class="editor-grid">
        <section class="panel" aria-label="Code editor">
          <div class="panel-header"><label>Component name<input id="component-name"></label></div>
          <div class="tabs" role="tablist"><button role="tab" data-tab="html" aria-selected="true">HTML</button><button role="tab" data-tab="css" aria-selected="false">CSS</button><button role="tab" data-tab="javascript" aria-selected="false">JavaScript</button></div>
          <div class="code-pane"><textarea id="code" spellcheck="false" aria-label="Component code"></textarea></div>
          <div class="copy-row"><button data-copy="html">Copy HTML</button><button data-copy="css">Copy CSS</button><button data-copy="javascript">Copy JavaScript</button><button data-copy="css-linked-html">Copy CSS-linked HTML</button><button data-copy="full-code">Copy full code</button><button id="download-css">Download CSS</button></div>
        </section>
        <section class="panel preview-panel" aria-label="Sandboxed preview"><div class="preview-heading"><span>Live Preview</span><span>Sandboxed</span></div><iframe id="preview" class="preview" title="Component preview" sandbox="allow-scripts"></iframe></section>
      </div>
    </main>
  </div>
  <script id="component-vault-data" type="application/json">${embeddedJson}</script>
  <script>
  (()=>{'use strict';
    const dataNode=document.getElementById('component-vault-data');const envelope=JSON.parse(dataNode.textContent);let components=[];let selected=0;let tab='html';
    const $=id=>document.getElementById(id);const status=$('status');
    const bytesFromBase64=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
    const base64FromBytes=value=>{let binary='';for(let index=0;index<value.length;index+=32768)binary+=String.fromCharCode(...value.subarray(index,index+32768));return btoa(binary)};
    const decompress=async value=>{const stream=new Blob([bytesFromBase64(value)]).stream().pipeThrough(new DecompressionStream('gzip'));return JSON.parse(await new Response(stream).text())};
    const compress=async value=>{const stream=new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'));return base64FromBytes(new Uint8Array(await new Response(stream).arrayBuffer()))};
    const safeName=(name,extension)=>{let value=String(name||'').trim().replace(/\\.[^.]+$/,'').replace(/[<>:"\\/\\\\|?*\\u0000-\\u001f]/g,'-').replace(/\\s+/g,'-').replace(/-+/g,'-').replace(/^[. -]+|[. -]+$/g,'').slice(0,120)||'component';if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value))value+='-file';return value+extension};
    const copyText=async value=>{try{await navigator.clipboard.writeText(value)}catch{const area=document.createElement('textarea');area.value=value;document.body.append(area);area.select();document.execCommand('copy');area.remove()}status.textContent='Copied'};
    const fullCode=component=>'<!doctype html>\\n<html><head><meta charset="utf-8">\\n<style>'+component.css.replace(/<\\/style/gi,'<\\\\/style')+'</style>\\n</head><body>\\n'+component.html+'\\n<scr'+'ipt>'+component.javascript.replace(/<\\/script/gi,'<\\\\/script')+'<\\/scr'+'ipt>\\n</body></html>';
    const copyValue=(component,kind)=>kind==='html'?component.html:kind==='css'?component.css:kind==='javascript'?component.javascript:kind==='css-linked-html'?'<link rel="stylesheet" href="'+safeName(component.name,'.css')+'">\\n'+component.html:fullCode(component);
    const download=(content,name,type)=>{const url=URL.createObjectURL(new Blob([content],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),0)};
    const current=()=>components[selected];
    const preview=()=>{const component=current();if(!component){$('preview').srcdoc='';return}const script=component.javascript.replace(/<\\/script/gi,'<\\\\/script');$('preview').srcdoc='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \\'none\\'; style-src \\'unsafe-inline\\'; script-src \\'unsafe-inline\\'; img-src data: blob:; media-src data: blob:; connect-src \\'none\\'; object-src \\'none\\'; base-uri \\'none\\'; form-action \\'none\\'"><style>'+component.css+'</style>'+component.html+'<scr'+'ipt>'+script+'<\\/scr'+'ipt>'};
    const render=()=>{const component=current();$('library-name').textContent=envelope.library.name;const list=$('items');list.replaceChildren();components.forEach((item,index)=>{const li=document.createElement('li');li.className='item';li.setAttribute('aria-current',String(index===selected));const button=document.createElement('button');button.type='button';button.textContent=item.name||'Untitled component';button.onclick=()=>{selected=index;render()};const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove '+(item.name||'component'));remove.onclick=()=>{components.splice(index,1);selected=Math.max(0,Math.min(selected,components.length-1));render()};li.append(button,remove);list.append(li)});$('component-name').value=component?.name||'';$('code').value=component?.[tab]||'';document.querySelectorAll('[data-tab]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.tab===tab)));preview()};
    $('component-name').oninput=event=>{if(current()){current().name=event.target.value;render()}};$('code').oninput=event=>{if(current()){current()[tab]=event.target.value;preview()}};
    document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{tab=button.dataset.tab;render()});document.querySelectorAll('[data-copy]').forEach(button=>button.onclick=()=>current()&&copyText(copyValue(current(),button.dataset.copy)));
    $('download-css').onclick=()=>current()&&download(current().css,safeName(current().name,'.css'),'text/css;charset=utf-8');
    const move=offset=>{const target=selected+offset;if(target<0||target>=components.length)return;[components[selected],components[target]]=[components[target],components[selected]];selected=target;render()};$('move-up').onclick=()=>move(-1);$('move-down').onclick=()=>move(1);
    $('add-files').onclick=()=>$('file-input').click();$('file-input').onchange=async event=>{for(const file of event.target.files){components.push({name:file.name.replace(/\\.(?:html?|HTML?)$/,''),description:'',category:'',tags:[],html:await file.text(),css:'',javascript:'',previewPolicy:{allowScripts:false,allowForms:false,allowPopups:false,externalNetworkEnabled:false,allowedOrigins:[]}})}selected=Math.max(0,components.length-1);event.target.value='';render()};
    $('save-library').onclick=async()=>{status.textContent='Preparing file…';try{envelope.components=await Promise.all(components.map(async component=>({encoding:'gzip-base64',data:await compress(component)})));dataNode.textContent=JSON.stringify(envelope).replace(/&/g,'\\\\u0026').replace(/</g,'\\\\u003c').replace(/>/g,'\\\\u003e').replace(/\\u2028/g,'\\\\u2028').replace(/\\u2029/g,'\\\\u2029');download('<!doctype html>\\n'+document.documentElement.outerHTML,safeName(envelope.library.name,'.html'),'text/html;charset=utf-8');status.textContent='Saved edited library'}catch{status.textContent='Could not create the file. Your edits are still here.'}};
    Promise.all(envelope.components.map(entry=>entry.encoding==='gzip-base64'?decompress(entry.data):Promise.reject(new Error('Unsupported encoding')))).then(value=>{components=value;render()}).catch(()=>{status.textContent='This Component Vault file is damaged or unsupported.'});
  })();
  </script>
</body>
</html>`;
