import{u as te,b as He,J as Ue,r as P,bo as U,j as e,l as ze,m as Ye,n as O,L as I,c_ as Qe,c0 as Ge,B as y,$ as Ve,ai as Je,T as b,k as Xe,S as x,C as z,p as ne,a6 as f,bE as Ze,aO as F,db as q,b5 as T,aP as et,dm as tt,a4 as Y,a5 as nt,d as st,b1 as rt,q as at,z as it}from"./index-T0LZ5PpG.js";import{b as Q,f as ot}from"./text-Cn9a8Xz6.js";import{a as G}from"./openapi-Bp7vOz3e.js";import{d as lt,l as V,g as dt,C as ct,k as pt}from"./snippets-DMBNK_Dl.js";import{S as u}from"./shared-DL7GMbBS.js";import{T as ht}from"./TableContainer-Dg5HNjEd.js";import{T as ut,a as mt,b as J,c as gt}from"./TableRow-B0kYUal1.js";import"./Tabs-FRWX4aNl.js";import"./Chip-ozW70XWP.js";const K=/^[A-Za-z_$][\w$]*$/,W=t=>K.test(t)?`.${t}`:`['${t}']`,B=t=>K.test(t)?t:`'${t}'`,A=t=>`'${t.replace(/\\/g,"\\\\").replace(/'/g,"\\'")}'`;function _(t){if(typeof t=="string")return A(t);if(Array.isArray(t))return`[${t.map(_).join(", ")}]`;if(t&&typeof t=="object"){const s=Object.entries(t);return s.length?`{ ${s.map(([r,i])=>`${B(r)}: ${_(i)}`).join(", ")} }`:"{}"}return String(t)}const yt=t=>t.replace(/\\/g,"\\\\").replace(/`/g,"\\`").replace(/\$\{/g,"\\${"),H=t=>[...t.fields].sort((s,r)=>s.position-r.position).filter(s=>!s.config.private&&s.type!=="password");function ft(t){const s=t.config.options?.map(r=>A(r.value))??[];switch(t.type){case"integer":case"decimal":case"rating":return"number";case"boolean":case"checkbox":return"boolean";case"select":case"radio":return s.length?s.join(" | "):"string";case"multiselect":return s.length?`(${s.join(" | ")})[]`:"string[]";case"image":case"video":case"file":return"MediaAsset | null";case"images":case"files":return"MediaAsset[]";case"relation":return"Reference | null";case"relations":return"Reference[]";case"richtext":return"RichText";case"json":case"component":case"geolocation":return"unknown";case"repeatable":case"dynamiczone":return"unknown[]";default:return"string"}}function xt(t){return H(t).map(s=>{const r=ft(s),i=!s.required&&!r.endsWith("| null")&&!r.endsWith("[]")&&r!=="unknown";return`  ${B(s.apiId)}${s.required?"":"?"}: ${r}${i?" | null":""};`})}function X(t,s,r,i){for(const p of[s,...t.filter(c=>c!==s)]){const c=H(p).find(l=>l.type===r);if(c)return{type:p.apiId,field:c.apiId,real:!0}}return{type:s.apiId,field:i,real:!1}}function bt(t){const s=G(t,"PATCH");if(Object.keys(s.data).length>0)return _(s.data);const r=G(t,"POST"),i=Object.entries(r.data)[0];return i?_({[i[0]]:i[1]}):"{}"}const Z=`query Articles($limit: Int = 5) {
  articles(limit: $limit, sort: "-publishedAt") {
    total
    items {
      id
      title
      slug
    }
  }
}`;function vt(t,s,r){const i={apiUrl:t,defaultLocale:r.defaultLocale,locale:r.locales.find(o=>o!==r.defaultLocale)??r.defaultLocale,projectSlug:r.projectSlug,environmentKey:r.environmentKey},p=(s?.types??[]).filter(o=>!o.isSystem),c=p.find(o=>o.kind==="COLLECTION"),l=p.find(o=>o.kind==="SINGLE")?.apiId??null;if(!s||!c)return{...i,example:!0,type:"articles",typeName:"Article",listVar:"articles",label:"articles",titleField:"title",relationField:"author",filter:{field:"category",value:"news"},fieldNames:["title","slug"],richText:{type:"articles",field:"body",real:!1},image:{type:"articles",field:"cover",real:!1},singleType:l,writeData:"{ title: 'Hello from the API' }",interfaceBody:["  title: string;","  slug: string;","  category?: 'news' | 'guides' | null;","  body?: RichText | null;","  cover?: MediaAsset | null;","  author?: Reference | null;"],graphql:{query:Z,listField:"articles"}};const a=H(c),S=a.filter(o=>["text","slug","uid","textarea","email","url"].includes(o.type)),w=c.options.titleField??a.find(o=>o.type==="text")?.apiId??null,v=a.find(o=>(o.type==="select"||o.type==="radio")&&o.config.options?.length),j=a.find(o=>o.type==="boolean"),m=lt(s).find(o=>o.apiId===c.apiId),d=[...new Set([w,...S.map(o=>o.apiId)].filter(o=>!!o))].slice(0,2);return{...i,example:!1,type:c.apiId,typeName:Q(c.singularName)||Q(c.apiId),listVar:V(c.apiId)||"entries",label:c.displayName.toLowerCase(),titleField:w,relationField:a.find(o=>o.type==="relation"||o.type==="relations")?.apiId??null,filter:v?{field:v.apiId,value:v.config.options?.[0]?.value??""}:j?{field:j.apiId,value:"true"}:null,fieldNames:d,richText:X(p,c,"richtext","body"),image:X(p,c,"image","cover"),singleType:l,writeData:bt(c),interfaceBody:xt(c),graphql:{query:m?dt(m):Z,listField:m?.listField??V(c.apiId)}}}function wt(t){const{apiUrl:s,type:r,listVar:i}=t,p='-H "Authorization: Bearer $MERIDIAN_API_KEY"',c=`entry${W(t.titleField??"id")}`,l=s.replace(/^http/,"ws"),a=t.filter?.value==="true"||t.filter?.value==="false",S=[...t.filter?[`${B(t.filter.field)}: ${a?t.filter.value:A(t.filter.value)}`]:[],"publishedAt: { gte: '2026-01-01' }"].join(", "),w=[...t.filter?[`filter[${t.filter.field}]=${encodeURIComponent(t.filter.value)}`]:[],"filter[publishedAt][gte]=2026-01-01"].join("&"),v=t.relationField?`[${A(t.relationField)}]`:"'*'",j=t.relationField??"*",m=t.richText,d=t.image,o=t.graphql.query.replace(/\s+/g," ").trim(),k="npm install @meridian/sdk",R=`MERIDIAN_URL=${s}
# Created under Developers → API keys. Keep real keys out of version control.
MERIDIAN_API_KEY=mrd_ro_your_key`,$=`import { createCMSClient } from '@meridian/sdk';

export const cms = createCMSClient({
  baseURL: process.env.MERIDIAN_URL!, // ${s}
  apiKey: process.env.MERIDIAN_API_KEY,
});`,se=`import { cms } from './lib/cms';

const { data: ${i}, meta } = await cms.content('${r}').find({ limit: 10, sort: '-publishedAt' });

console.log(\`\${meta.total} ${t.label}\`);
for (const entry of ${i}) console.log(entry.id, ${c});`,re=`curl ${p} \\
  "${s}/api/v1/${r}?limit=10&sort=-publishedAt"`,ae=`{
  "data": [
    {
      "id": "8f0c…",
      "type": "${r}",
      "locale": "${t.defaultLocale}",
      "createdAt": "…",
      "updatedAt": "…",
      "publishedAt": "…"${t.titleField?`,
      "${t.titleField}": "…"`:""}
    }
  ],
  "meta": { "total": 42, "limit": 10, "offset": 0, "page": 1, "pageCount": 5 }
}`,ie=`curl ${p} "${s}/api/v1/"`,oe=`import { createCMSClient } from '@meridian/sdk';

// A read-only key (mrd_ro_…) can only read published content, so it may ship to browsers.
export const cms = createCMSClient({
  baseURL: '${s}',
  apiKey: import.meta.env.VITE_MERIDIAN_API_KEY,
});`,le=`import { createCMSClient } from '@meridian/sdk';

// Preview (mrd_pv_…) and read/write (mrd_rw_…) keys are secrets: server-side code only.
// The client throws if one of them is constructed in a browser.
export const cms = createCMSClient({
  baseURL: process.env.MERIDIAN_URL!,
  apiKey: process.env.MERIDIAN_API_KEY!,
});`,de=`import { createCMSClient } from '@meridian/sdk';

// Needs a read/write key. Writes pass the same validation, versioning and audit log as the admin.
const admin = createCMSClient({
  baseURL: process.env.MERIDIAN_URL!,
  apiKey: process.env.MERIDIAN_WRITE_KEY!,
});

const ${i} = admin.content('${r}');
const entry = await ${i}.create(${t.writeData}, { publish: false });
await ${i}.update(entry.id, ${t.writeData}, { publish: true }); // changes only the fields you pass
await ${i}.unpublish(entry.id);
await ${i}.delete(entry.id); // moves it to the trash`,ce=[`const ${i} = cms.content('${r}');`,"",`const { data, meta } = await ${i}.find({`,"  // Pagination: limit is at most 100 (default 25); use page or offset","  limit: 20,","  page: 2,",'  // A leading "-" sorts descending; pass an array to sort by several fields',"  sort: '-publishedAt',","  // Case-insensitive search across text fields","  search: 'design',","  // Equals, or an operator: eq ne gt gte lt lte contains startsWith in nin null",`  filter: { ${S} },`,"  // Expand relations, nested with dots up to 4 levels; '*' expands every first-level relation",`  populate: ${v},`,...t.fieldNames.length?["  // Return only these fields (system attributes are always included)",`  fields: [${t.fieldNames.map(A).join(", ")}],`]:[],"  // Falls back to the locale's fallback, then the project default",`  locale: ${A(t.locale)},`,"});","console.log(meta.total, meta.page, meta.pageCount);","","// One entry by id or slug. Resolves to null when it does not exist or is not published.",`const entry = await ${i}.findOne('my-slug', { populate: ${v} });`,"","// Every matching entry: the SDK walks the pages for you.",`for await (const item of ${i}.all({ filter: { ${S} } })) {`,"  console.log(item.id);","}",...t.singleType?["","// A single type returns its one entry (null until it is published).",`const single = await cms.content('${t.singleType}').single();`]:[]].join(`
`),pe=["# List, newest first, second page",`curl ${p} \\`,`  "${s}/api/v1/${r}?limit=20&page=2&sort=-publishedAt"`,"",'# Filter: filter[field]=value is "equals"; filter[field][operator]=value for the rest.',"# -g stops curl from interpreting the square brackets.",`curl -g ${p} \\`,`  "${s}/api/v1/${r}?${w}"`,"","# Search, expand relations, trim the payload and pick a locale",`curl ${p} \\`,`  "${s}/api/v1/${r}?search=design&populate=${j}${t.fieldNames.length?`&fields=${t.fieldNames.join(",")}`:""}&locale=${t.locale}"`,"","# One entry by id or slug",`curl ${p} \\`,`  "${s}/api/v1/${r}/my-slug"`,...t.singleType?["","# A single type returns its one entry",`curl ${p} \\`,`  "${s}/api/v1/${t.singleType}"`]:[]].join(`
`),he=`// Resolve a URL to a page. null when no published page lives at that path.
const page = await cms.pages.getByPath('/');

if (page) {
  console.log(page.title, page.path, page.seo.title);
  console.log(page.blocks.map((block) => block.type));
}

// Pages can also be listed, filtered and sorted like any content type.
const { data: pages } = await cms.pages.list({ sort: 'title', limit: 50 });`,ue=`import type { ComponentType } from 'react';
import type { Block } from '@meridian/sdk';
import { FeatureGrid } from './blocks/FeatureGrid';
import { Hero } from './blocks/Hero';
import { RichText } from './blocks/RichText';

// Map each block type coming from Meridian to one of YOUR components.
// Meridian stores structured data only; how a "hero" looks is entirely up to you.
const components: Record<string, ComponentType<any>> = {
  hero: Hero,
  text: RichText,
  'feature-grid': FeatureGrid,
};

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block) => {
        const Component = components[block.type];
        if (!Component) return null; // a type this frontend does not implement: skip it, never crash
        return (
          <Component key={block.id} {...block.props} blockStyle={block.style}>
            {block.children?.length ? <Blocks blocks={block.children} /> : null}
          </Component>
        );
      })}
    </>
  );
}`,me=`import { notFound } from 'next/navigation';
import { Blocks } from '@/components/Blocks';
import { cms } from '@/lib/cms';

// One catch-all route renders every page built in the page builder.
export default async function CmsPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const page = await cms.pages.getByPath('/' + path.join('/'));
  if (!page) notFound();

  return <Blocks blocks={page.blocks} />;
}`,ge=`# Resolve a URL path
curl ${p} \\
  "${s}/api/v1/pages?path=/"

# By id or slug
curl ${p} \\
  "${s}/api/v1/pages/{id-or-slug}"`,ye=`{
  "data": {
    "id": "…",
    "type": "pages",
    "title": "…",
    "slug": "…",
    "path": "/",
    "parent": null,
    "template": "default",
    "seo": { "title": "…", "description": "…", "ogImage": { "url": "…" } },
    "blocks": [
      {
        "id": "b1",
        "type": "hero",
        "props": { "heading": "…", "primaryLabel": "…", "primaryUrl": "…" },
        "style": { "align": "center", "padding": { "top": 96, "bottom": 96 } }
      },
      {
        "id": "b2",
        "type": "section",
        "props": {},
        "children": [{ "id": "b3", "type": "text", "props": { "…": "…" } }]
      }
    ]
  }
}`,fe=`// richtext: 'html' returns sanitized HTML instead of the JSON document.
const entry = await cms.content('${m.type}').findOne('my-slug', { richtext: 'html' });

export function RichTextHtml({ html }: { html: string }) {
  return <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

// <RichTextHtml html={entry${W(m.field)}} />`,xe=`// Default: a structured JSON document that you render with your own components.
const entry = await cms.content('${m.type}').findOne('my-slug');

// entry${W(m.field)} →
// { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '…' }] }] }

type RichTextNode = { type: string; text?: string; content?: RichTextNode[] };

// Walk the tree yourself, for example to build a plain-text excerpt.
export function plainText(node: RichTextNode): string {
  return node.text ?? (node.content ?? []).map(plainText).join(' ');
}`,be=`# JSON document (default)
curl ${p} \\
  "${s}/api/v1/${m.type}/my-slug"

# Sanitized HTML
curl ${p} \\
  "${s}/api/v1/${m.type}/my-slug?richtext=html"`,ve=`${s}/media/{id}/{revision}/{filename}?w=800&h=600&fit=cover&format=webp&q=75`,we=`const entry = await cms.content('${d.type}').findOne('my-slug');

// Media fields are always expanded to objects: { id, url, width, height, alt, … }
const image = entry?${K.test(d.field)?`.${d.field}`:`.['${d.field}']`};
if (image) {
  const src = cms.media.url(image, { w: 1200, h: 630, fit: 'cover', format: 'webp', q: 75 });

  // Responsive images: one URL per width. Variants are generated once, then served as plain files.
  const srcSet = [480, 960, 1440].map((w) => \`\${cms.media.url(image, { w, format: 'webp' })} \${w}w\`).join(', ');
}`,je=`<img
  src="{url}?w=960&format=webp&q=75"
  srcset="{url}?w=480&format=webp 480w, {url}?w=960&format=webp 960w, {url}?w=1440&format=webp 1440w"
  sizes="(min-width: 960px) 960px, 100vw"
  width="{width}" height="{height}" alt="{alt}" loading="lazy"
/>`,ke=`import { cms } from '@/lib/cms';

// Preview URL in Settings → Project:
//   https://www.example.com/api/preview?token={token}&path={path}
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return new Response('Missing preview token', { status: 400 });

  // Exchanges the one-hour token for exactly that draft. No API key is involved.
  const draft = await cms.preview(token);
  return Response.json(draft);
}`,Re=`import { createCMSClient } from '@meridian/sdk';

// A preview key (mrd_pv_…) on a staging server sees working copies of everything.
const preview = createCMSClient({
  baseURL: process.env.MERIDIAN_URL!,
  apiKey: process.env.MERIDIAN_PREVIEW_KEY!,
});

const { data: drafts } = await preview.content('${r}').find({ status: 'draft' });
const draft = await preview.content('${r}').findOne('my-slug', { status: 'draft' });`,$e=`# Exchange a preview token from the admin (no API key)
curl "${s}/api/v1/preview?token=$PREVIEW_TOKEN"

# Drafts with a preview key
curl -H "Authorization: Bearer $MERIDIAN_PREVIEW_KEY" \\
  "${s}/api/v1/${r}?status=draft"`,Se=t.graphql.query,Ie=`const query = /* GraphQL */ \`
${yt(t.graphql.query)}
\`;

// Resolves to the "data" object; throws MeridianError when the response has errors.
const data = await cms.graphql<{ ${t.graphql.listField}: { total: number; items: { id: string }[] } }>(query, { limit: 5 });
console.log(data.${t.graphql.listField}.total);`,Te=`curl -X POST "${s}/api/v1/graphql" \\
  ${p} \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({query:o,variables:{limit:5}}).replace(/'/g,"'\\''")}'`,Ee=`{
  "id": "…",
  "event": "content.published",
  "project": "${t.projectSlug}",
  "environment": "${t.environmentKey}",
  "contentType": "${r}",
  "documentId": "…",
  "slug": "…",
  "locale": "${t.defaultLocale}",
  "timestamp": "2026-01-01T10:00:00.000Z"
}`,Ae=`X-Meridian-Signature:  sha256=HMAC_SHA256(secret, timestamp + "." + rawBody)
X-Meridian-Timestamp:  unix seconds
X-Meridian-Delivery:   stable id across retries; de-duplicate on it
X-Meridian-Event:      event name, e.g. content.published`,Ce=`import { revalidatePath, revalidateTag } from 'next/cache';
import { parseWebhook } from '@meridian/sdk/webhooks';

interface MeridianEvent {
  event: string;
  contentType?: string;
  path?: string | null;
}

export async function POST(request: Request) {
  let hook;
  try {
    // Checks X-Meridian-Signature against the raw body and rejects stale timestamps.
    hook = await parseWebhook<MeridianEvent>(request, process.env.MERIDIAN_WEBHOOK_SECRET!);
  } catch {
    return new Response('Invalid signature', { status: 401 });
  }

  // Refresh whatever the event touched, e.g. fetches tagged '${r}'.
  if (hook.event.contentType) revalidateTag(hook.event.contentType);
  if (hook.event.path) revalidatePath(hook.event.path);

  return Response.json({ revalidated: true, delivery: hook.deliveryId });
}`,Pe=`import { createCMSClient } from '@meridian/sdk';

// Tag the requests so the webhook route can revalidate exactly these.
export const ${i}Client = createCMSClient({
  baseURL: process.env.MERIDIAN_URL!,
  apiKey: process.env.MERIDIAN_API_KEY,
  fetchOptions: { next: { tags: ['${r}'] } },
});`,Me=`// Opens a WebSocket to /api/v1/events and reconnects automatically.
const stop = cms.subscribe(
  (event) => {
    if (event.event === 'content.published' && event.contentType === '${r}') {
      console.log('Published', event.documentId, event.slug);
    }
  },
  { onStatus: (status) => console.log('Live events:', status) }, // connecting | open | closed
);

// Later, for example when the component unmounts:
stop();`,Ne=`import WebSocket from 'ws';

// Node has no global WebSocket in older versions: pass an implementation.
const stop = cms.subscribe((event) => console.log(event.event, event.contentType), { WebSocket });`,Le=`const socket = new WebSocket('${l}/api/v1/events');

// The first message authenticates. The key is never part of the URL.
socket.addEventListener('open', () => {
  socket.send(JSON.stringify({ type: 'auth', token: MERIDIAN_API_KEY }));
});

socket.addEventListener('message', (message) => {
  const frame = JSON.parse(message.data);
  // { "type": "event", "data": { "event": "content.published", "contentType": "${r}", … } }
  if (frame.type === 'event') console.log(frame.data.event, frame.data.contentType, frame.data.documentId);
});`,qe=`# The response carries an ETag
curl -i ${p} \\
  "${s}/api/v1/${r}"

# Send it back: 304 Not Modified, with no body, while nothing has changed
curl -i ${p} \\
  -H 'If-None-Match: "<etag from the first response>"' \\
  "${s}/api/v1/${r}"`,_e=`import { createCMSClient } from '@meridian/sdk';

// Default: every request revalidates with If-None-Match, so a publish shows on the next request.
// With ttlMs, responses are served from memory for that long before they are revalidated.
const cms = createCMSClient({
  baseURL: process.env.MERIDIAN_URL!,
  apiKey: process.env.MERIDIAN_API_KEY,
  cache: { ttlMs: 60_000 },
});

// Forget cached responses the moment Meridian reports a change.
cms.subscribe((event) => cms.cache.clear(event.contentType));`,De=`{
  "error": {
    "code": "validation_failed",
    "message": "Some fields are invalid",
    "details": [{ "path": "…", "message": "…", "code": "min" }],
    "requestId": "…"
  }
}`,Oe=`import { MeridianError } from '@meridian/sdk';

try {
  const { data } = await cms.content('${r}').find({ limit: 10 });
} catch (err) {
  if (err instanceof MeridianError) {
    console.error(err.status, err.code, err.message, err.requestId);
    if (err.status === 422) console.error(err.details); // field-level problems
    if (err.retryable) {
      // 429, 5xx or a network failure: safe to try again later.
      // Reads are already retried twice with backoff; writes are never retried.
    }
  }
  throw err;
}`,Fe=`async function meridian(path: string, attempt = 0): Promise<unknown> {
  const response = await fetch(\`${s}/api/v1\${path}\`, {
    headers: { Authorization: \`Bearer \${process.env.MERIDIAN_API_KEY}\` },
  });

  // Rate limited: wait as long as the server asks, then try again.
  if (response.status === 429 && attempt < 3) {
    const seconds = Number(response.headers.get('Retry-After') ?? 1);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    return meridian(path, attempt + 1);
  }

  const body = await response.json();
  if (!response.ok) {
    throw new Error(\`\${body.error.code}: \${body.error.message} (request \${body.error.requestId})\`);
  }
  return body;
}

const ${i} = await meridian('/${r}?limit=10');`,D=t.interfaceBody.join(`
`),We=[`import type { ${D.includes("MediaAsset")?"Entry, MediaAsset":"Entry"} } from '@meridian/sdk';`,...D.includes("Reference")?["","/** A relation that has not been expanded with populate. */","interface Reference {","  id: string;","  type: string;","}"]:[],...D.includes("RichText")?["","/** A JSON document by default; an HTML string when you ask for richtext: 'html'. */","type RichText = { type: string; text?: string; content?: RichText[] } | string;"]:[],"",`export interface ${t.typeName} {`,...t.interfaceBody.length?t.interfaceBody:["  // This content type has no fields yet."],"}","",`// Entry<${t.typeName}> adds the system attributes: id, type, locale, createdAt, updatedAt, publishedAt.`,`export type ${t.typeName}Entry = Entry<${t.typeName}>;`].join(`
`),Ke=`import type { Block, ListResult, Page } from '@meridian/sdk';
import type { ${t.typeName}, ${t.typeName}Entry } from './types';

const ${i} = cms.content<${t.typeName}>('${r}');

const list: ListResult<${t.typeName}Entry> = await ${i}.find({ limit: 10 });
const one: ${t.typeName}Entry | null = await ${i}.findOne('my-slug');

const page: Page | null = await cms.pages.getByPath('/');
const blocks: Block[] = page?.blocks ?? [];`,Be=`# The OpenAPI 3.1 document describes this environment's content model.
curl ${p} \\
  "${s}/api/v1/openapi.json" -o openapi.json

# Generate types for every endpoint and schema
npx openapi-typescript openapi.json -o src/meridian.d.ts`;return{install:k,env:R,client:$,firstRequest:se,firstCurl:re,listResponse:ae,rawHeader:ie,browserClient:oe,serverClient:le,writes:de,fetchSdk:ce,fetchRest:pe,pageSdk:he,blocks:ue,pageRoute:me,pageRest:ge,pageResponse:ye,richHtml:fe,richJson:xe,richRest:be,mediaPattern:ve,mediaSdk:we,mediaImg:je,previewRoute:ke,previewKey:Re,previewRest:$e,graphqlQuery:Se,graphqlSdk:Ie,graphqlCurl:Te,webhookPayload:Ee,webhookHeaders:Ae,webhookNext:Ce,webhookTagged:Pe,webhookNode:pt,realtimeSdk:Me,realtimeNode:Ne,realtimeRaw:Le,cacheCurl:qe,cacheSdk:_e,cdnPurge:ct,errorShape:De,errorSdk:Oe,errorFetch:Fe,typesInterface:We,typesUsage:Ke,typesOpenapi:Be}}const E=[{id:"sdk-quick-start",nav:"Quick start",title:"Quick start"},{id:"sdk-authentication",nav:"Authentication",title:"Authentication and key types"},{id:"sdk-fetching",nav:"Fetching content",title:"Fetching content"},{id:"sdk-pages",nav:"Pages and blocks",title:"Pages and blocks"},{id:"sdk-rich-text",nav:"Rich text",title:"Rich text"},{id:"sdk-media",nav:"Media and images",title:"Media and image transformations"},{id:"sdk-preview",nav:"Drafts and preview",title:"Drafts and preview"},{id:"sdk-graphql",nav:"GraphQL",title:"GraphQL"},{id:"sdk-webhooks",nav:"Webhooks",title:"Webhooks and signature verification"},{id:"sdk-realtime",nav:"Real-time events",title:"Real-time events"},{id:"sdk-caching",nav:"Caching",title:"Caching"},{id:"sdk-errors",nav:"Errors and rate limits",title:"Errors and rate limits"},{id:"sdk-typescript",nav:"TypeScript types",title:"TypeScript types"}],jt=t=>E.find(s=>s.id===t)?.title??"",kt=["section","columns","hero","text","image","video","split","feature-grid","cards","testimonials","faq","pricing","stats","logos","gallery","cta","contact","team","blog-listing","product-listing","breadcrumbs","navigation","footer","html","json"],Rt=["content.created","content.updated","content.deleted","content.published","content.unpublished","content.scheduled","page.published","page.unpublished","media.uploaded","media.updated","media.deleted","schema.updated","release.published"],$t=["image/jpeg","image/png","image/webp","image/avif"],n=({children:t})=>e.jsx(y,{component:"code",sx:{fontFamily:et,fontSize:"0.75rem",px:1,py:.25,borderRadius:"4px",bgcolor:"surface.sunken",overflowWrap:"anywhere"},children:t}),h=({children:t})=>e.jsx(b,{variant:"body2",sx:{lineHeight:1.7,maxWidth:780},children:t}),M=({children:t})=>e.jsx(b,{variant:"subtitle1",component:"h3",sx:{fontWeight:600,pt:1.5},children:t});function C({children:t}){return e.jsxs(x,{direction:"row",spacing:2.5,role:"note",sx:{border:1,borderColor:"border.subtle",bgcolor:"surface.subtle",borderRadius:"8px",px:3.5,py:2.5,maxWidth:780},children:[e.jsx(tt,{sx:{fontSize:17,color:"text.secondary",mt:.5,flexShrink:0}}),e.jsx(b,{variant:"body2",color:"text.secondary",sx:{lineHeight:1.65},children:t})]})}function N({label:t,head:s,rows:r}){return e.jsx(ht,{sx:{border:1,borderColor:"border.subtle",borderRadius:"8px","& tbody tr:last-of-type td":{borderBottom:0}},children:e.jsxs(ut,{size:"small","aria-label":t,children:[e.jsx(mt,{children:e.jsx(J,{children:s.map(i=>e.jsx(Y,{sx:{whiteSpace:"nowrap"},children:i},i))})}),e.jsx(gt,{children:r.map((i,p)=>e.jsx(J,{children:i.map((c,l)=>e.jsx(Y,{sx:{verticalAlign:"top",color:l===0?"text.primary":"text.secondary"},children:c},l))},p))})]})})}function ee({label:t,items:s}){return e.jsx(x,{direction:"row",component:"ul","aria-label":t,sx:{listStyle:"none",m:0,p:0,flexWrap:"wrap",gap:1.5},children:s.map(r=>e.jsx(y,{component:"li",sx:{display:"flex"},children:e.jsx(nt,{label:e.jsx(f,{sx:{fontSize:"0.6875rem"},children:r})})},r))})}function g({id:t,children:s}){return e.jsxs(ne,{component:"section",id:t,"aria-labelledby":`${t}-title`,sx:{borderRadius:"10px",p:{xs:4,md:6},scrollMarginTop:{xs:84,md:16},minWidth:0},children:[e.jsx(b,{variant:"h3",component:"h2",id:`${t}-title`,tabIndex:-1,sx:{mb:3.5,outline:"none"},children:jt(t)}),e.jsx(x,{spacing:3.5,sx:{minWidth:0},children:s})]})}function L({number:t,title:s,children:r}){return e.jsxs(x,{direction:"row",spacing:3,component:"li",sx:{minWidth:0},children:[e.jsx(y,{"aria-hidden":!0,sx:{width:24,height:24,flexShrink:0,borderRadius:"50%",border:1,borderColor:"border.strong",display:"grid",placeItems:"center",fontSize:"0.75rem",fontWeight:600,color:"text.secondary",fontVariantNumeric:"tabular-nums"},children:t}),e.jsxs(y,{sx:{minWidth:0,flex:1},children:[e.jsx(b,{variant:"subtitle2",component:"h3",sx:{fontWeight:600,mb:1.5,lineHeight:"24px"},children:s}),e.jsx(x,{spacing:2,children:r})]})]})}function St(){const t=te(),s=t.can("media.read"),r=st({queryKey:["sdk-docs","image-example",t.project.id],queryFn:()=>it.get(`${t.projectBase}/media`,{pageSize:1,kind:"image"}).then(l=>l.items[0]??null),enabled:s,staleTime:6e4});if(!s)return e.jsx(C,{children:"A live example with one of your own images appears here for roles that can view the media library."});if(r.isPending)return e.jsx(rt,{variant:"rounded",height:168,sx:{borderRadius:"8px"},"aria-label":"Loading an example image"});if(r.isError)return e.jsx(y,{sx:{border:1,borderColor:"border.subtle",borderRadius:"8px"},children:e.jsx(at,{compact:!0,error:r.error,onRetry:()=>{r.refetch()}})});const i=r.data;if(!i)return e.jsxs(C,{children:["Upload an image to the"," ",e.jsx(q,{component:I,to:t.href("media"),color:"secondary",children:"media library"})," ","and a live example, with its real URL and a preview, appears here."]});const p=$t.includes(i.mimeType),c=p?`${i.url}?w=480&h=320&fit=cover&format=webp&q=75`:i.url;return e.jsxs(x,{direction:{xs:"column",sm:"row"},spacing:4,sx:{border:1,borderColor:"border.subtle",borderRadius:"8px",p:3.5,alignItems:{sm:"flex-start"}},children:[e.jsx(y,{component:"img",src:c,alt:i.alt||i.filename,loading:"lazy",sx:{width:{xs:"100%",sm:240},maxWidth:320,aspectRatio:"3 / 2",objectFit:"cover",borderRadius:"6px",border:1,borderColor:"border.subtle",bgcolor:"surface.sunken",flexShrink:0}}),e.jsxs(y,{sx:{minWidth:0,flex:1},children:[e.jsx(b,{variant:"subtitle2",sx:{fontWeight:600},children:"Live example from your media library"}),e.jsxs(b,{variant:"caption",color:"text.secondary",component:"p",sx:{mt:.5,mb:2},children:[i.filename,i.width&&i.height?` · original ${i.width} × ${i.height}`:""," · ",ot(i.size),p?" · requested at 480 × 320, cropped to cover, as WebP at quality 75":" · this format is served as uploaded, without transformations"]}),e.jsx(T,{code:c})]})]})}function qt(){const t=te(),s=He();Ue([]);const[r,i]=P.useState(E[0].id),p=P.useRef(0),c=!s.isPending,l=P.useMemo(()=>vt(U,s.data,{defaultLocale:t.defaultLocale,locales:t.project.locales.map(d=>d.code),projectSlug:t.project.slug,environmentKey:t.environment.key}),[s.data,t.defaultLocale,t.project.locales,t.project.slug,t.environment.key]),a=P.useMemo(()=>wt(l),[l]),S=s.data?.builtinBlocks?.length?s.data.builtinBlocks:kt;P.useEffect(()=>{if(!c||typeof IntersectionObserver>"u")return;const d=new Set,o=new IntersectionObserver(k=>{for(const $ of k)$.isIntersecting?d.add($.target.id):d.delete($.target.id);if(Date.now()<p.current)return;const R=E.find($=>d.has($.id));R&&i(R.id)},{rootMargin:"-88px 0px -55% 0px"});for(const k of E){const R=document.getElementById(k.id);R&&o.observe(R)}return()=>o.disconnect()},[c]);const w=d=>{const o=document.getElementById(d);if(!o)return;const k=typeof window.matchMedia=="function"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;p.current=Date.now()+1e3,o.scrollIntoView({behavior:k?"auto":"smooth",block:"start"}),i(d),document.getElementById(`${d}-title`)?.focus({preventScroll:!0})},v=t.href("dev/explorer"),j=t.can("schema.read"),m=t.can("token.manage");return e.jsxs(ze,{children:[e.jsx(Ye,{title:"SDK documentation",description:"How to connect a website or application to this project. Every sample uses your API URL and your own content types, so it can be copied as it stands.",actions:e.jsxs(e.Fragment,{children:[m&&e.jsx(O,{variant:"outlined",startIcon:e.jsx(Qe,{}),component:I,to:t.href("dev/keys"),children:"API keys"}),j&&e.jsx(O,{variant:"outlined",startIcon:e.jsx(Ge,{}),component:I,to:v,children:"API explorer"})]})}),e.jsx(y,{sx:{display:{xs:"block",md:"none"},position:"sticky",top:0,zIndex:3,bgcolor:"background.default",mx:-4,px:4,py:2.5,mb:3,borderBottom:1,borderColor:"border.subtle"},children:e.jsx(Ve,{select:!0,fullWidth:!0,label:"Section",value:r,onChange:d=>w(d.target.value),disabled:!c,children:E.map(d=>e.jsx(Je,{value:d.id,children:d.nav},d.id))})}),e.jsxs(y,{sx:{display:"grid",gridTemplateColumns:{xs:"minmax(0, 1fr)",md:"208px minmax(0, 1fr)"},gap:{xs:4,md:6},alignItems:"start"},children:[e.jsxs(y,{component:"nav","aria-label":"Documentation sections",sx:{display:{xs:"none",md:"block"},position:"sticky",top:16,maxHeight:"calc(100vh - 96px)",overflowY:"auto"},children:[e.jsx(b,{variant:"caption",color:"text.secondary",component:"div",sx:{fontWeight:600,px:2.5,mb:1.5},children:"On this page"}),e.jsx(y,{component:"ul",sx:{listStyle:"none",m:0,p:0},children:E.map(d=>{const o=d.id===r;return e.jsx(y,{component:"li",children:e.jsx(Xe,{onClick:()=>w(d.id),disabled:!c,"aria-current":o?"location":void 0,sx:{width:"100%",justifyContent:"flex-start",textAlign:"left",px:2.5,py:1.5,borderRadius:"7px",fontSize:"0.8125rem",lineHeight:1.35,color:o?"text.primary":"text.secondary",fontWeight:o?600:400,bgcolor:o?"action.selected":"transparent","&:hover":{bgcolor:o?"action.selected":"action.hover"}},children:d.nav})},d.id)})})]}),c?e.jsxs(x,{spacing:5,sx:{minWidth:0},children:[e.jsx(ne,{sx:{borderRadius:"10px",display:"grid",gridTemplateColumns:{xs:"1fr",lg:"repeat(3, minmax(0, 1fr))"},overflow:"hidden"},children:[{label:"API URL",value:U,hint:`REST under /api/v1 · ${t.environment.name} is chosen by the key`},{label:"Package",value:"@meridian/sdk",hint:"No dependencies · Node 18+, browsers, edge, React Native"},{label:"Authentication",value:"Authorization: Bearer <API key>",hint:"One key per project and environment"}].map((d,o)=>e.jsxs(y,{sx:{p:4,minWidth:0,borderTop:{xs:o?1:0,lg:0},borderLeft:{lg:o?1:0},borderColor:"border.subtle"},children:[e.jsx(b,{variant:"caption",color:"text.secondary",component:"div",children:d.label}),e.jsxs(x,{direction:"row",spacing:1,sx:{alignItems:"center",minWidth:0,mt:.5},children:[e.jsx(f,{sx:{fontSize:"0.8125rem",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},children:d.value}),e.jsx(Ze,{value:d.value,label:`Copy ${d.label.toLowerCase()}`})]}),e.jsx(b,{variant:"caption",color:"text.secondary",component:"div",sx:{mt:.5},children:d.hint})]},d.label))}),s.isError&&e.jsxs(F,{severity:"warning",action:e.jsx(O,{color:"inherit",size:"small",onClick:()=>{s.refetch()},children:"Try again"}),children:["The content model could not be loaded, so the samples use an example type named ",e.jsx(n,{children:"articles"})," instead of your own."]}),!s.isError&&l.example&&e.jsxs(C,{children:["This environment has no collection type yet, so the samples use an example type named ",e.jsx(n,{children:"articles"}),". They switch to your own types as soon as you"," ",e.jsx(q,{component:I,to:t.href("model/types"),color:"secondary",children:"create one"}),"."]}),e.jsxs(g,{id:"sdk-quick-start",children:[e.jsxs(h,{children:["Meridian delivers content over a REST and a GraphQL API. The SDK is a small TypeScript client for both, with no dependencies, that runs wherever ",e.jsx(n,{children:"fetch"})," exists. Five steps take you from nothing to a list of ",l.label,"."]}),e.jsxs(x,{component:"ol",spacing:4,sx:{listStyle:"none",m:0,p:0},children:[e.jsx(L,{number:1,title:"Create an API key",children:e.jsxs(h,{children:["A key belongs to one project and one environment. A read-only key is all you need to read published content, and it is safe in browser code."," ",m?e.jsx(q,{component:I,to:t.href("dev/keys"),color:"secondary",children:"Create one under API keys"}):"Ask an administrator of this organization for one."]})}),e.jsx(L,{number:2,title:"Install the SDK",children:e.jsx(T,{code:a.install,language:"bash"})}),e.jsx(L,{number:3,title:"Add the URL and the key to your environment",children:e.jsx(T,{code:a.env,language:".env"})}),e.jsx(L,{number:4,title:"Create a client",children:e.jsx(u,{items:[{label:"Client",caption:"lib/cms.ts",language:"typescript",code:a.client}]})}),e.jsx(L,{number:5,title:`Fetch ${l.label}`,children:e.jsx(u,{items:[{label:"SDK",language:"typescript",code:a.firstRequest},{label:"cURL",language:"bash",code:a.firstCurl},{label:"Response shape",language:"json",code:a.listResponse}]})})]})]}),e.jsxs(g,{id:"sdk-authentication",children:[e.jsxs(h,{children:["Every request carries an API key in the ",e.jsx(n,{children:"Authorization"})," header. The key alone decides which project and environment you read, and what you are allowed to do there. There are three kinds, told apart by their prefix."]}),e.jsx(N,{label:"Key types",head:["Type","Prefix","Can read","Where it may run"],rows:[["Read-only",e.jsx(n,{children:"mrd_ro_"},"p"),"Published content only","Browser, mobile app or server"],["Preview",e.jsx(n,{children:"mrd_pv_"},"p"),"Published content and drafts","Server only"],["Read/write",e.jsx(n,{children:"mrd_rw_"},"p"),"Everything, and it can create, update, publish and delete","Server only"]]}),e.jsx(F,{severity:"warning",sx:{maxWidth:780},children:"Preview and read/write keys are secrets. Anyone can read what ships in a bundle, so keep them on a server. The API refuses them when a request carries a browser origin that is not on the key’s allow-list, and the SDK throws if one is constructed in a browser."}),e.jsx(u,{items:[{label:"Header",language:"bash",code:a.rawHeader},{label:"Browser client",caption:"src/cms.ts",language:"typescript",code:a.browserClient},{label:"Server client",caption:"lib/cms.ts",language:"typescript",code:a.serverClient},{label:"Writing content",caption:"Server only",language:"typescript",code:a.writes}]}),e.jsx(h,{children:"Keys are shown once, when they are created, and stored only as a hash. Each key can be limited to specific browser origins, given an expiry and its own rate limit, rotated, or revoked. Writes made with a read/write key go through the same validation, versioning, approval rules and audit log as the admin."})]}),e.jsxs(g,{id:"sdk-fetching",children:[e.jsxs(h,{children:["Every content type gets endpoints named after its API identifier: ",e.jsxs(n,{children:["GET /api/v1/",l.type]})," lists entries and ",e.jsxs(n,{children:["GET /api/v1/",l.type,"/","{id-or-slug}"]})," returns one. The same parameters work in the SDK, over REST and in GraphQL."]}),e.jsx(u,{items:[{label:"SDK",language:"typescript",code:a.fetchSdk},{label:"REST",language:"bash",code:a.fetchRest}],maxHeight:520}),e.jsx(N,{label:"Query parameters",head:["Parameter","Example","Meaning"],rows:[[e.jsx(n,{children:"limit, offset / page"},"p"),e.jsx(f,{children:"limit=20&page=2"},"e"),"Pagination. limit is at most 100 and defaults to 25."],[e.jsx(n,{children:"sort"},"p"),e.jsx(f,{children:"sort=-publishedAt"},"e"),"Comma-separated fields. A leading - sorts descending."],[e.jsx(n,{children:"search"},"p"),e.jsx(f,{children:"search=design"},"e"),"Case-insensitive, across text fields."],[e.jsx(n,{children:"filter[field]"},"p"),e.jsx(f,{children:l.filter?`filter[${l.filter.field}]=${l.filter.value}`:"filter[slug]=my-slug"},"e"),"Equals."],[e.jsx(n,{children:"filter[field][op]"},"p"),e.jsx(f,{children:"filter[publishedAt][gte]=2026-01-01"},"e"),"Operators: eq ne gt gte lt lte contains startsWith in nin null."],[e.jsx(n,{children:"populate"},"p"),e.jsx(f,{children:`populate=${l.relationField??"*"}`},"e"),"Expand relations, nested with dots up to 4 levels. * expands every first-level relation."],[e.jsx(n,{children:"fields"},"p"),e.jsx(f,{children:`fields=${l.fieldNames.length?l.fieldNames.join(","):"title,slug"}`},"e"),"Return only these fields. System attributes are always included."],[e.jsx(n,{children:"locale"},"p"),e.jsx(f,{children:`locale=${l.locale}`},"e"),"Falls back to the locale’s fallback, then to the project default."],[e.jsx(n,{children:"richtext"},"p"),e.jsx(f,{children:"richtext=html"},"e"),"Rich text as sanitized HTML instead of a JSON document."],[e.jsx(n,{children:"status"},"p"),e.jsx(f,{children:"status=draft"},"e"),"Drafts. Preview and read/write keys only."]]}),e.jsxs(h,{children:[e.jsx(n,{children:"id"})," is the document id: stable across edits and shared by every locale variant. Media fields are always expanded to objects with URLs. Relations are references of the form ",e.jsx(n,{children:"{ id, type }"})," until you ask for them with"," ",e.jsx(n,{children:"populate"}),". Fields marked private in the content model, and password fields, are never returned."]})]}),e.jsxs(g,{id:"sdk-pages",children:[e.jsxs(h,{children:["Pages are built by editors in the page builder and delivered as structured data. Meridian does not render pages for you, on purpose: a block is ",e.jsx(n,{children:"{ id, type, props, style, children }"}),", and nothing in it depends on React, Vue or any other framework."]}),e.jsxs(h,{children:["Your application owns the look. Keep a map from block ",e.jsx(n,{children:"type"})," to your own component and render the tree. Skip types you have not implemented, and never crash on them. ",e.jsx(n,{children:"style"})," carries the editor’s layout choices, such as background, spacing, alignment, per-device columns and visibility, for you to honour in your own design system."]}),e.jsx(u,{items:[{label:"Blocks renderer",caption:"components/Blocks.tsx",language:"tsx",code:a.blocks},{label:"Next.js route",caption:"app/[[...path]]/page.tsx",language:"tsx",code:a.pageRoute},{label:"Fetch a page",language:"typescript",code:a.pageSdk},{label:"REST",language:"bash",code:a.pageRest},{label:"Response shape",language:"json",code:a.pageResponse}],maxHeight:520}),e.jsx(M,{children:"Built-in block types"}),e.jsx(ee,{label:"Built-in block types",items:S}),e.jsxs(h,{children:["Components your team marked as page blocks arrive with their own type names. Each block’s props are described by ",e.jsx(n,{children:"GET /api/v1/content-types"}),". Listing blocks such as ",e.jsx(n,{children:"blog-listing"})," name a content type and a limit; fetch those entries yourself, which keeps listings fresh without republishing the page."]})]}),e.jsxs(g,{id:"sdk-rich-text",children:[e.jsxs(h,{children:["Rich text fields are returned as a structured JSON document by default, so you can render every node with your own components. Ask for ",e.jsx(n,{children:"richtext=html"})," and the same field arrives as sanitized HTML, ready to place in a page."]}),e.jsx(N,{label:"Rich text formats",head:["Format","How to ask","You get","Choose it when"],rows:[["JSON document","Default",e.jsx(n,{children:"{ type: 'doc', content: [ … ] }"},"v"),"You render nodes with your own components, or the content feeds a native app."],["HTML",e.jsx(n,{children:"richtext=html"},"h"),"A sanitized HTML string","You want to place the content in a page with your own typography styles."]]}),e.jsx(u,{items:[{label:"HTML",language:"tsx",code:a.richHtml},{label:"JSON document",language:"typescript",code:a.richJson},{label:"REST",language:"bash",code:a.richRest}]}),!l.richText.real&&!l.example&&e.jsxs(C,{children:["None of your content types has a rich text field yet, so these samples use a field named ",e.jsx(n,{children:l.richText.field}),"."]})]}),e.jsxs(g,{id:"sdk-media",children:[e.jsx(h,{children:"Media URLs are immutable: they include a revision that changes when a file is replaced, so they can be cached forever. Add transformation parameters to resize, crop and convert an image. A variant is generated on the first request and stored, so later requests are plain file reads."}),e.jsx(T,{code:a.mediaPattern}),e.jsx(N,{label:"Image transformation parameters",head:["Parameter","Values","Meaning"],rows:[[e.jsx(n,{children:"w, h"},"p"),"1–4096","Width and height in pixels."],[e.jsx(n,{children:"fit"},"p"),"cover (default), contain, fill, inside, outside","How the image fills the requested box."],[e.jsx(n,{children:"position"},"p"),"center, top, right, bottom, left, entropy, attention","Which part to keep when cropping."],[e.jsx(n,{children:"format"},"p"),"webp, avif, jpeg, png","Output format."],[e.jsx(n,{children:"q"},"p"),"1–100 (default 80)","Quality."]]}),e.jsx(St,{}),e.jsx(u,{items:[{label:"SDK",language:"typescript",code:a.mediaSdk},{label:"HTML",language:"html",code:a.mediaImg}]}),!l.image.real&&!l.example&&e.jsxs(C,{children:["None of your content types has an image field yet, so the SDK sample uses a field named ",e.jsx(n,{children:l.image.field}),"."]})]}),e.jsxs(g,{id:"sdk-preview",children:[e.jsx(h,{children:"Read-only keys can never see drafts, whatever parameters they send. There are two ways to show unpublished content, and both belong on a server."}),e.jsx(M,{children:"Preview links, for editors"}),e.jsxs(h,{children:["Set a preview URL under Settings → Project, for example ",e.jsx(n,{children:"https://www.example.com/api/preview?token={token}&path={path}"}),". When an editor chooses Preview, Meridian issues a token that is valid for one hour and for exactly that entry. Your route exchanges it for the draft, and no API key is involved."]}),e.jsx(M,{children:"Preview keys, for staging sites"}),e.jsxs(h,{children:["A ",e.jsx(n,{children:"mrd_pv_"})," key may add ",e.jsx(n,{children:"status=draft"})," to any read to see the working copy of everything. Use it on a staging server that should always show the latest edits."]}),e.jsx(u,{items:[{label:"Preview route",caption:"app/api/preview/route.ts",language:"typescript",code:a.previewRoute},{label:"Preview key",caption:"Server only",language:"typescript",code:a.previewKey},{label:"REST",language:"bash",code:a.previewRest}]})]}),e.jsxs(g,{id:"sdk-graphql",children:[e.jsxs(h,{children:["Send a ",e.jsx(n,{children:"POST"})," to ",e.jsx(n,{children:"/api/v1/graphql"})," with the same key. The schema is generated from your content model: every collection gets a list field that returns ",e.jsx(n,{children:"{ items, total, limit, offset }"})," and a field that returns one entry by id or slug."]}),e.jsx(u,{items:[{label:"Query",language:"graphql",code:a.graphqlQuery},{label:"SDK",language:"typescript",code:a.graphqlSdk},{label:"cURL",language:"bash",code:a.graphqlCurl}]}),e.jsxs(h,{children:["Relations are real fields that you can select through. ",e.jsx(n,{children:"filter"})," takes the same shape as the SDK, for example ",e.jsx(n,{children:"{ price: { gte: 10 } }"}),". Read/write keys also get create, update, publish, unpublish and delete mutations for every type. Queries may nest up to 10 levels.",j&&e.jsxs(e.Fragment,{children:[" ",e.jsx(q,{component:I,to:v,color:"secondary",children:"Try queries against live data in the API explorer"}),"."]})]})]}),e.jsxs(g,{id:"sdk-webhooks",children:[e.jsxs(h,{children:["Publishing makes content available from the API immediately. If your own application caches, through a CDN, static generation or an in-memory cache, a webhook tells it when to refresh. Add one under Developers → Webhooks, choose the events, and Meridian sends a JSON ",e.jsx(n,{children:"POST"})," to your URL."]}),e.jsx(ee,{label:"Webhook events",items:Rt}),e.jsx(M,{children:"Verify every delivery"}),e.jsxs(h,{children:["Each delivery is signed with the webhook’s signing secret. The signature is an HMAC-SHA256 over the timestamp, a dot and the raw request body. Check it against the body exactly as it was received, before parsing it, and reject old timestamps so a captured request cannot be replayed. ",e.jsx(n,{children:"parseWebhook"})," from ",e.jsx(n,{children:"@meridian/sdk/webhooks"})," does all of this and throws when the signature is wrong."]}),e.jsx(T,{code:a.webhookHeaders,language:"headers"}),e.jsx(u,{items:[{label:"Next.js revalidation",caption:"app/api/revalidate/route.ts",language:"typescript",code:a.webhookNext},{label:"Tagged client",caption:"lib/cms.ts",language:"typescript",code:a.webhookTagged},{label:"Node.js, by hand",caption:"verify-meridian-webhook.js",language:"javascript",code:a.webhookNode},{label:"Payload",language:"json",code:a.webhookPayload}],maxHeight:520}),e.jsx(M,{children:"Delivery and retries"}),e.jsxs(h,{children:["Respond with a 2xx status within 10 seconds. Server errors, timeouts and 429 responses are retried with exponential backoff; other 4xx responses are not. Retries carry the same ",e.jsx(n,{children:"X-Meridian-Delivery"})," id, so use it to ignore duplicates. Every attempt is logged under the webhook, where you can inspect payloads and redeliver."]})]}),e.jsxs(g,{id:"sdk-realtime",children:[e.jsxs(h,{children:["For interfaces that should update while they are open, subscribe to live events. ",e.jsx(n,{children:"cms.subscribe"})," opens a WebSocket to ",e.jsx(n,{children:"/api/v1/events"}),", reconnects automatically and returns a function that closes the connection."]}),e.jsx(u,{items:[{label:"SDK",language:"typescript",code:a.realtimeSdk},{label:"Node.js",language:"typescript",code:a.realtimeNode},{label:"Plain WebSocket",language:"javascript",code:a.realtimeRaw}]}),e.jsxs(h,{children:["The first message authenticates the connection with ",e.jsx(n,{children:"{ type: 'auth', token }"}),", so the key never appears in a URL. The server then pushes ",e.jsx(n,{children:"{ type: 'event', data }"})," for that key’s environment only. Events have the same names and fields as webhook payloads. A read-only key is enough, and it is the only kind that belongs in a browser."]})]}),e.jsxs(g,{id:"sdk-caching",children:[e.jsxs(h,{children:["Published responses carry an ",e.jsx(n,{children:"ETag"})," and ",e.jsx(n,{children:"Cache-Control: public, max-age=0, must-revalidate"}),". Send the tag back in ",e.jsx(n,{children:"If-None-Match"})," and you get a 304 with no body while nothing has changed. The SDK does this for every request. ",e.jsx(n,{children:"X-Cache: HIT"})," or ",e.jsx(n,{children:"MISS"})," reports Meridian’s own response cache."]}),e.jsx(F,{severity:"warning",sx:{maxWidth:780},children:"Meridian’s cache is invalidated the moment content is published, so the API always serves the latest version. A CDN or framework cache in front of your own site is a separate layer: it only updates when your webhook purges or revalidates it."}),e.jsx(u,{items:[{label:"Conditional request",language:"bash",code:a.cacheCurl},{label:"SDK cache",caption:"lib/cms.ts",language:"typescript",code:a.cacheSdk},{label:"Purge a CDN",caption:"server.js",language:"javascript",code:a.cdnPurge}],maxHeight:520}),e.jsx(h,{children:"The CDN sample is a webhook receiver that verifies the signature, skips duplicate deliveries and calls the provider’s purge API with the paths from the event. Media URLs change whenever a file is replaced, so they never need purging."})]}),e.jsxs(g,{id:"sdk-errors",children:[e.jsxs(h,{children:["Every error has the same shape. Quote ",e.jsx(n,{children:"requestId"})," when you report a problem."]}),e.jsx(T,{code:a.errorShape,language:"json"}),e.jsx(N,{label:"Error codes",head:["Status","Code","Meaning"],rows:[["400",e.jsx(n,{children:"bad_request"},"c"),"Malformed query, such as an unknown field in a filter or a bad number."],["401",e.jsx(n,{children:"unauthorized"},"c"),"Missing, unknown, expired or revoked key."],["403",e.jsx(n,{children:"forbidden"},"c"),"Key type or origin not allowed for this operation."],["404",e.jsx(n,{children:"not_found"},"c"),"No such content, or it is not published."],["409",e.jsx(n,{children:"conflict"},"c"),"For example, publishing something that still needs approval."],["422",e.jsx(n,{children:"validation_failed"},"c"),"Field-level problems, listed in details."],["429",e.jsx(n,{children:"rate_limited"},"c"),"Too many requests. Wait for the time given in Retry-After."]]}),e.jsxs(h,{children:["Rate limits are counted per key and per minute, 600 by default, and can be set for each key. Every response reports ",e.jsx(n,{children:"X-RateLimit-Limit"}),", ",e.jsx(n,{children:"X-RateLimit-Remaining"})," and ",e.jsx(n,{children:"X-RateLimit-Reset"}),". Over the limit, the API answers 429 with a ",e.jsx(n,{children:"Retry-After"})," header."]}),e.jsx(u,{items:[{label:"SDK",language:"typescript",code:a.errorSdk},{label:"fetch with Retry-After",language:"typescript",code:a.errorFetch}]}),e.jsxs(h,{children:["In the SDK, ",e.jsx(n,{children:"findOne"}),", ",e.jsx(n,{children:"single"})," and the ",e.jsx(n,{children:"pages.get…"})," methods resolve to ",e.jsx(n,{children:"null"})," when content does not exist or is not published, so optional content needs no try/catch. Everything else throws"," ",e.jsx(n,{children:"MeridianError"})," with ",e.jsx(n,{children:"status"}),", ",e.jsx(n,{children:"code"}),", ",e.jsx(n,{children:"details"}),", ",e.jsx(n,{children:"requestId"})," and ",e.jsx(n,{children:"retryable"}),". Failed and rate-limited reads are retried twice with backoff; writes are never retried."]})]}),e.jsxs(g,{id:"sdk-typescript",children:[e.jsxs(h,{children:["The SDK is written in TypeScript and exports the types you need: ",e.jsx(n,{children:"Entry"}),", ",e.jsx(n,{children:"ListResult"}),", ",e.jsx(n,{children:"ListParams"}),", ",e.jsx(n,{children:"QueryParams"}),", ",e.jsx(n,{children:"Page"}),", ",e.jsx(n,{children:"Block"}),", ",e.jsx(n,{children:"MediaAsset"}),", ",e.jsx(n,{children:"ContentEvent"}),", ",e.jsx(n,{children:"ImageTransform"})," ","and ",e.jsx(n,{children:"MeridianError"}),". Describe a content type once and pass it as a generic; every method then returns typed entries."]}),e.jsx(u,{items:[{label:"Your types",caption:"types.ts",language:"typescript",code:a.typesInterface},{label:"Typed requests",language:"typescript",code:a.typesUsage},{label:"From OpenAPI",language:"bash",code:a.typesOpenapi}]}),e.jsx(C,{children:l.example?e.jsx(e.Fragment,{children:"The interface is an example. Once this environment has a collection type, it is generated from that type’s fields."}):e.jsxs(e.Fragment,{children:["The interface is generated from the current fields of ",e.jsx(n,{children:l.type}),". Copy it again after the content model changes, or generate types for every endpoint from the OpenAPI document."]})})]})]}):e.jsxs(x,{spacing:5,"aria-busy":"true","aria-label":"Loading documentation",children:[e.jsx(z,{height:96}),e.jsx(z,{height:420,count:3})]})]})]})}export{qt as default};
//# sourceMappingURL=SdkDocsPage-B5whHkUy.js.map
