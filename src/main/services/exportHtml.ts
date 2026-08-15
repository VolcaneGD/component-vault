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
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_COMPONENTS = 1_000;
const MAX_ENCODED_COMPONENT_CHARACTERS = 10 * 1024 * 1024;
const MAX_INFLATED_COMPONENT_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_INFLATED_COMPONENT_BYTES = 12 * 1024 * 1024;
const MAX_CODE_BYTES = 2_000_000;

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
  const serializedComponents: Buffer[] = [];
  let totalInflatedBytes = 0;
  for (const component of validated.components) {
    const serialized = Buffer.from(JSON.stringify(component), 'utf8');
    if (serialized.length > MAX_INFLATED_COMPONENT_BYTES) {
      throw new Error('Invalid Component Vault export payload');
    }
    totalInflatedBytes += serialized.length;
    if (totalInflatedBytes > MAX_TOTAL_INFLATED_COMPONENT_BYTES) {
      throw new Error('Export payload exceeds the cumulative size limit');
    }
    serializedComponents.push(serialized);
  }

  const envelope: EmbeddedEnvelope = {
    format: FORMAT,
    version: VERSION,
    library: validated.library,
    components: serializedComponents.map((component) => ({
      encoding: 'gzip-base64',
      data: gzipSync(component).toString('base64'),
    })),
  };

  const document = standaloneDocument(escapeScriptJson(JSON.stringify(envelope)));
  if (Buffer.byteLength(document, 'utf8') > MAX_SOURCE_BYTES) {
    throw new Error('Export payload exceeds the standalone file size limit');
  }
  return document;
};

export const parseComponentVaultHtml = (source: string): ExportPayload | null => {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) return null;
  const matches = [...source.matchAll(
    /<script\b(?=[^>]*\bid=["']component-vault-data["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script\s*>/gi,
  )];
  if (matches.length !== 1) return null;

  try {
    const envelope = JSON.parse(matches[0][1]) as unknown;
    if (!isEmbeddedEnvelope(envelope)) return null;
    const components: ExportComponent[] = [];
    let totalInflatedBytes = 0;
    for (const entry of envelope.components) {
      const compressed = Buffer.from(entry.data, 'base64');
      if (compressed.toString('base64') !== entry.data) throw new Error('Invalid Base64 payload');
      if (compressed.length < 4) throw new Error('Invalid gzip payload');
      const remainingBytes = MAX_TOTAL_INFLATED_COMPONENT_BYTES - totalInflatedBytes;
      const declaredInflatedBytes = compressed.readUInt32LE(compressed.length - 4);
      if (remainingBytes <= 0
        || declaredInflatedBytes > MAX_INFLATED_COMPONENT_BYTES
        || declaredInflatedBytes > remainingBytes) {
        throw new Error('Inflated component budget exceeded');
      }
      const inflated = gunzipSync(compressed, {
        maxOutputLength: Math.min(MAX_INFLATED_COMPONENT_BYTES, remainingBytes),
      });
      totalInflatedBytes += inflated.length;
      const component = JSON.parse(inflated.toString('utf8')) as unknown;
      if (!isExportComponent(component)) throw new Error('Invalid component payload');
      components.push(component);
    }
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
  && isBoundedString(value.html, MAX_CODE_BYTES)
  && isBoundedString(value.css, MAX_CODE_BYTES)
  && isBoundedString(value.javascript, MAX_CODE_BYTES)
  && isPreviewPolicy(value.previewPolicy);

const isBoundedString = (value: unknown, maximum: number, allowEmpty = true): value is string =>
  typeof value === 'string'
  && Buffer.byteLength(value, 'utf8') <= maximum
  && (allowEmpty || value.trim().length > 0);

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
    const limits={source:25*1024*1024,count:1000,encoded:10*1024*1024,component:6*1024*1024,total:12*1024*1024,code:2000000,name:255,description:10000,category:255,tags:100,tag:100};
    const utf8Bytes=value=>new TextEncoder().encode(String(value)).byteLength;
    const bytesFromBase64=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
    const base64FromBytes=value=>{let binary='';for(let index=0;index<value.length;index+=32768)binary+=String.fromCharCode(...value.subarray(index,index+32768));return btoa(binary)};
    const bounded=value=>String(value).slice(0,180);const showEditError=value=>{status.textContent=bounded(value+'. Edits are retained.')};
    const limitError=value=>{const error=new Error(value);error.name='LimitError';return error};
    const validText=(value,maximum,required=false)=>typeof value==='string'&&utf8Bytes(value)<=maximum&&(!required||value.trim().length>0);
    const validOrigin=value=>{if(typeof value!=='string')return false;try{const url=new URL(value);return url.protocol==='https:'&&url.origin===value}catch{return false}};
    const componentError=component=>{if(!component||typeof component!=='object'||Array.isArray(component))return'Component data is invalid';if(!validText(component.name,limits.name,true))return'Name exceeds 255 UTF-8 bytes or is empty';if(!validText(component.description,limits.description))return'Description exceeds 10,000 UTF-8 bytes';if(!validText(component.category,limits.category))return'Category exceeds 255 UTF-8 bytes';if(!Array.isArray(component.tags)||component.tags.length>limits.tags||!component.tags.every(tag=>validText(tag,limits.tag)))return'Tags exceed safe UTF-8 limits';if(!validText(component.html,limits.code))return'HTML exceeds 2,000,000 UTF-8 bytes';if(!validText(component.css,limits.code))return'CSS exceeds 2,000,000 UTF-8 bytes';if(!validText(component.javascript,limits.code))return'JavaScript exceeds 2,000,000 UTF-8 bytes';const policy=component.previewPolicy;if(!policy||typeof policy!=='object'||typeof policy.allowScripts!=='boolean'||typeof policy.allowForms!=='boolean'||typeof policy.allowPopups!=='boolean'||(policy.externalNetworkEnabled!==undefined&&typeof policy.externalNetworkEnabled!=='boolean')||!Array.isArray(policy.allowedOrigins)||!policy.allowedOrigins.every(validOrigin))return'Preview policy is invalid';if(utf8Bytes(JSON.stringify(component))>limits.component)return'Component exceeds safe serialized size';return''};
    const componentsError=value=>{if(!Array.isArray(value)||value.length>limits.count)return'Component count exceeds 1,000';let total=0;for(const component of value){const error=componentError(component);if(error)return error;total+=utf8Bytes(JSON.stringify(component));if(total>limits.total)return'Components exceed the cumulative 12 MiB limit'}return''};
    const decompress=async(entry,remaining)=>{if(!entry||entry.encoding!=='gzip-base64'||typeof entry.data!=='string'||entry.data.length>limits.encoded||entry.data.length%4!==0)throw limitError('Encoded component exceeds safe limits');const compressed=bytesFromBase64(entry.data);if(base64FromBytes(compressed)!==entry.data||compressed.length<4)throw new Error('Invalid component encoding');const declared=new DataView(compressed.buffer,compressed.byteOffset+compressed.byteLength-4,4).getUint32(0,true);if(declared>limits.component||declared>remaining)throw limitError('Inflated component exceeds safe limits');const reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();const chunks=[];let total=0;while(true){const result=await reader.read();if(result.done)break;total+=result.value.byteLength;if(total>limits.component||total>remaining){await reader.cancel();throw limitError('Inflated component exceeds safe limits')}chunks.push(result.value)}const combined=new Uint8Array(total);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.byteLength}return{component:JSON.parse(new TextDecoder().decode(combined)),bytes:total}};
    const compress=async value=>{const stream=new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'));return base64FromBytes(new Uint8Array(await new Response(stream).arrayBuffer()))};
    const safeName=(name,extension)=>{let value=String(name||'').trim().replace(/[. ]+$/g,'');if(value.toLowerCase().endsWith(extension))value=value.slice(0,-extension.length);value=value.replace(/[<>:"\\/\\\\|?*\\u0000-\\u001f]/g,'-').replace(/\\s+/g,'-').replace(/-+/g,'-').replace(/^[. -]+|[. -]+$/g,'').slice(0,120)||'component';const dot=value.indexOf('.');const device=dot===-1?value:value.slice(0,dot);if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(device))value=device+'-file'+value.slice(device.length);return value+extension};
    const copyText=async value=>{try{await navigator.clipboard.writeText(value)}catch{const area=document.createElement('textarea');area.value=value;document.body.append(area);area.select();document.execCommand('copy');area.remove()}status.textContent='Copied'};
    const fullCode=component=>'<!doctype html>\\n<html><head><meta charset="utf-8">\\n<style>'+component.css.replace(/<\\/style/gi,'<\\\\/style')+'</style>\\n</head><body>\\n'+component.html+'\\n<scr'+'ipt>'+component.javascript.replace(/<\\/script/gi,'<\\\\/script')+'<\\/scr'+'ipt>\\n</body></html>';
    const copyValue=(component,kind)=>kind==='html'?component.html:kind==='css'?component.css:kind==='javascript'?component.javascript:kind==='css-linked-html'?'<link rel="stylesheet" href="'+safeName(component.name,'.css')+'">\\n'+component.html:fullCode(component);
    const download=(content,name,type)=>{const url=URL.createObjectURL(new Blob([content],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),0)};
    const current=()=>components[selected];
    const preview=()=>{const component=current();if(!component){$('preview').srcdoc='';return}const script=component.javascript.replace(/<\\/script/gi,'<\\\\/script');$('preview').srcdoc='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \\'none\\'; style-src \\'unsafe-inline\\'; script-src \\'unsafe-inline\\'; img-src data: blob:; media-src data: blob:; connect-src \\'none\\'; object-src \\'none\\'; base-uri \\'none\\'; form-action \\'none\\'"><style>'+component.css+'</style>'+component.html+'<scr'+'ipt>'+script+'<\\/scr'+'ipt>'};
    const render=()=>{const component=current();$('library-name').textContent=envelope.library.name;const list=$('items');list.replaceChildren();components.forEach((item,index)=>{const li=document.createElement('li');li.className='item';li.setAttribute('aria-current',String(index===selected));const button=document.createElement('button');button.type='button';button.textContent=item.name||'Untitled component';button.onclick=()=>{selected=index;render()};const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove '+(item.name||'component'));remove.onclick=()=>{components.splice(index,1);selected=Math.max(0,Math.min(selected,components.length-1));render()};li.append(button,remove);list.append(li)});$('component-name').value=component?.name||'';$('code').value=component?.[tab]||'';document.querySelectorAll('[data-tab]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.tab===tab)));preview()};
    $('component-name').oninput=event=>{if(current()){current().name=event.target.value;const error=componentError(current());status.textContent='';if(error)showEditError(error);render()}};$('code').oninput=event=>{if(current()){current()[tab]=event.target.value;const error=componentError(current());status.textContent='';if(error)showEditError(error);preview()}};
    document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{tab=button.dataset.tab;render()});document.querySelectorAll('[data-copy]').forEach(button=>button.onclick=()=>current()&&copyText(copyValue(current(),button.dataset.copy)));
    $('download-css').onclick=()=>current()&&download(current().css,safeName(current().name,'.css'),'text/css;charset=utf-8');
    const move=offset=>{const target=selected+offset;if(target<0||target>=components.length)return;[components[selected],components[target]]=[components[target],components[selected]];selected=target;render()};$('move-up').onclick=()=>move(-1);$('move-down').onclick=()=>move(1);
    $('add-files').onclick=()=>$('file-input').click();$('file-input').onchange=async event=>{for(const file of event.target.files){if(components.length>=limits.count){showEditError('Component count exceeds 1,000');break}if(file.size>limits.code){showEditError('HTML exceeds 2,000,000 UTF-8 bytes');continue}const candidate={name:file.name.replace(/\\.(?:html?|HTML?)$/,''),description:'',category:'',tags:[],html:await file.text(),css:'',javascript:'',previewPolicy:{allowScripts:false,allowForms:false,allowPopups:false,externalNetworkEnabled:false,allowedOrigins:[]}};const error=componentError(candidate);if(error){showEditError(error);continue}components.push(candidate);selected=components.length-1;const allError=componentsError(components);if(allError)showEditError(allError)}event.target.value='';render()};
    $('save-library').onclick=async()=>{const validation=componentsError(components);if(validation){showEditError(validation);return}status.textContent='Preparing file…';try{const encoded=[];for(const component of components)encoded.push({encoding:'gzip-base64',data:await compress(component)});envelope.components=encoded;dataNode.textContent=JSON.stringify(envelope).replace(/&/g,'\\\\u0026').replace(/</g,'\\\\u003c').replace(/>/g,'\\\\u003e').replace(/\\u2028/g,'\\\\u2028').replace(/\\u2029/g,'\\\\u2029');const output='<!doctype html>\\n'+document.documentElement.outerHTML;if(utf8Bytes(output)>limits.source){showEditError('Standalone HTML exceeds the 25 MiB source limit');return}download(output,safeName(envelope.library.name,'.html'),'text/html;charset=utf-8');status.textContent='Saved edited library'}catch{status.textContent='Could not create the file. Your edits are still here.'}};
    (async()=>{try{if(utf8Bytes('<!doctype html>\\n'+document.documentElement.outerHTML)>limits.source)throw limitError('Source exceeds safe limits');if(!envelope||envelope.format!=='component-vault'||envelope.version!==1||!envelope.library||!validText(envelope.library.name,limits.name,true)||!validText(envelope.library.description,limits.description)||!Array.isArray(envelope.components)||envelope.components.length>limits.count)throw limitError('Bundle metadata exceeds safe limits');const restored=[];let total=0;for(const entry of envelope.components){const result=await decompress(entry,limits.total-total);total+=result.bytes;const error=componentError(result.component);if(error)throw limitError(error);restored.push(result.component)}components=restored;render()}catch(error){components=[];$('items').replaceChildren();$('preview').srcdoc='';status.textContent=error&&error.name==='LimitError'?'This Component Vault file exceeds safe offline limits.':'This Component Vault file is damaged or unsupported.'}})();
  })();
  </script>
</body>
</html>`;
