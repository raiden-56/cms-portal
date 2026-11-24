import{bB as m}from"./index-T0LZ5PpG.js";import{b as l}from"./text-Cn9a8Xz6.js";const x=[{id:"nextjs",label:"Next.js",mark:"N",tagline:"App Router with on-demand revalidation",runtime:"server"},{id:"react",label:"React",mark:"R",tagline:"Single-page apps built with Vite",runtime:"browser"},{id:"vue",label:"Vue",mark:"V",tagline:"Vue 3 with a reusable composable",runtime:"browser"},{id:"angular",label:"Angular",mark:"A",tagline:"An injectable service on HttpClient",runtime:"browser"},{id:"react-native",label:"React Native",mark:"RN",tagline:"iOS and Android apps",runtime:"device"},{id:"flutter",label:"Flutter",mark:"F",tagline:"Dart with the http package",runtime:"device"},{id:"node",label:"Node.js",mark:"JS",tagline:"Servers, scripts and static builds",runtime:"server"},{id:"curl",label:"cURL",mark:">_",tagline:"Any language over plain HTTP",runtime:"server"}],Y=e=>x.find(n=>n.id===e),h=e=>{const n=l(e);return n.charAt(0).toLowerCase()+n.slice(1)},N=e=>e?.types.find(n=>!n.isSystem&&n.kind==="COLLECTION")??e?.types.find(n=>n.apiId===m);function V(e,n){const t=N(n);if(!t)return{apiUrl:e,type:m,listVar:"pages",typeLabel:"Pages",titleField:"title",relationField:null,filter:null};const a=t.fields.filter(s=>!s.config.private&&s.type!=="password"),r=a.find(s=>(s.type==="select"||s.type==="radio")&&s.config.options?.length),o=a.find(s=>s.type==="boolean");return{apiUrl:e,type:t.apiId,listVar:h(t.apiId)||"items",typeLabel:t.displayName,titleField:t.options.titleField??a.find(s=>s.type==="text")?.apiId??"id",relationField:a.find(s=>s.type==="relation"||s.type==="relations")?.apiId??null,filter:r?{field:r.apiId,value:r.config.options?.[0]?.value??""}:o?{field:o.apiId,value:"true"}:null}}const d=(e,n)=>e.split(`
`).map((t,a)=>a===0||!t?t:" ".repeat(n)+t).join(`
`);function H(e){return e==="curl"?null:e==="flutter"?{label:"Install",language:"bash",code:"flutter pub add http"}:e==="angular"?{label:"Install",language:"bash",code:`# Uses Angular’s built-in HttpClient — nothing to install.
# Make sure provideHttpClient() is in your app config.`}:{label:"Install",language:"bash",code:"npm install @meridian/sdk"}}function J(e,n,t){switch(e){case"nextjs":return{label:"Environment",caption:".env.local",language:"bash",code:`MERIDIAN_URL=${n}
MERIDIAN_API_KEY=${t}
# From Developers → Webhooks, used to verify revalidation calls
MERIDIAN_WEBHOOK_SECRET=whsec_your_signing_secret`};case"react":case"vue":return{label:"Environment",caption:".env",language:"bash",code:`VITE_MERIDIAN_URL=${n}
VITE_MERIDIAN_API_KEY=${t}`};case"angular":return{label:"Environment",caption:"src/environments/environment.ts",language:"typescript",code:`export const environment = {
  meridianUrl: '${n}',
  meridianApiKey: '${t}',
};`};case"react-native":return{label:"Environment",caption:".env",language:"bash",code:`EXPO_PUBLIC_MERIDIAN_URL=${n}
EXPO_PUBLIC_MERIDIAN_API_KEY=${t}`};case"flutter":return{label:"Environment",caption:"Pass at build time",language:"bash",code:`flutter run \\
  --dart-define=MERIDIAN_URL=${n} \\
  --dart-define=MERIDIAN_API_KEY=${t}`};case"node":return{label:"Environment",caption:".env",language:"bash",code:`MERIDIAN_URL=${n}
MERIDIAN_API_KEY=${t}`};default:return{label:"Environment",caption:"Shell",language:"bash",code:`export MERIDIAN_URL=${n}
export MERIDIAN_API_KEY=${t}`}}}const C=`import type { ComponentType, ReactNode } from 'react';
import { Hero } from './blocks/Hero';
import { Faq } from './blocks/Faq';
import { Section } from './blocks/Section';

export interface Block {
  id: string;
  type: string;
  props: Record<string, any>;
  style?: Record<string, any>;
  children?: Block[];
}

// Map each block type coming from Meridian to one of YOUR components.
// Meridian only stores structured data; how a "hero" looks is entirely up to you.
const components: Record<string, ComponentType<any>> = {
  hero: Hero,
  faq: Faq,
  section: Section,
};

export function BlockRenderer({ blocks }: { blocks: Block[] }): ReactNode {
  return blocks.map((block) => {
    const Component = components[block.type];
    if (!Component) return null; // unknown block type: skip it, or show a notice in development
    return (
      <Component key={block.id} {...block.props} blockStyle={block.style}>
        {block.children?.length ? <BlockRenderer blocks={block.children} /> : null}
      </Component>
    );
  });
}`,T=`import { revalidatePath, revalidateTag } from 'next/cache';
import { verifyWebhookSignature } from '@meridian/sdk/webhooks';

export async function POST(request: Request) {
  // Verify the raw body exactly as it was sent, before parsing it.
  const payload = await request.text();
  const valid = await verifyWebhookSignature({
    payload,
    signature: request.headers.get('x-meridian-signature'),
    timestamp: request.headers.get('x-meridian-timestamp'),
    secret: process.env.MERIDIAN_WEBHOOK_SECRET!,
  });
  if (!valid) return new Response('Invalid signature', { status: 401 });

  const event = JSON.parse(payload);
  // A release carries every document it changed; a single publish carries one.
  const documents = event.documents ?? [event];
  for (const doc of documents) {
    if (doc.contentType) revalidateTag(doc.contentType);
    if (doc.path) revalidatePath(doc.path);
  }
  return Response.json({ revalidated: true, event: event.event });
}`,L=`import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Meridian signs every delivery:
 *   X-Meridian-Signature: sha256=HMAC_SHA256(secret, timestamp + "." + rawBody)
 */
export function verifyMeridianWebhook(rawBody, headers, secret) {
  const timestamp = headers['x-meridian-timestamp'];
  const received = headers['x-meridian-signature'] ?? '';
  const expected = 'sha256=' + createHmac('sha256', secret).update(\`\${timestamp}.\${rawBody}\`).digest('hex');

  // Reject anything older than five minutes to stop replayed requests.
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 300;
  return fresh && received.length === expected.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}`,z=`import express from 'express';
import { verifyMeridianWebhook } from './verify-meridian-webhook.js';

const app = express();
const seen = new Set(); // use Redis or your database in production

// express.raw keeps the body byte-for-byte, which the signature check needs.
app.post('/hooks/meridian', express.raw({ type: 'application/json' }), async (req, res) => {
  const body = req.body.toString('utf8');
  if (!verifyMeridianWebhook(body, req.headers, process.env.MERIDIAN_WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }

  // The delivery id is the same on every retry, so duplicates are easy to skip.
  const deliveryId = req.headers['x-meridian-delivery'];
  if (seen.has(deliveryId)) return res.status(200).json({ duplicate: true });
  seen.add(deliveryId);

  const event = JSON.parse(body);
  const paths = (event.documents ?? [event]).map((doc) => doc.path).filter(Boolean);

  // Example: Cloudflare. Swap in your CDN's purge API.
  await fetch(\`https://api.cloudflare.com/client/v4/zones/\${process.env.CF_ZONE_ID}/purge_cache\`, {
    method: 'POST',
    headers: { Authorization: \`Bearer \${process.env.CF_API_TOKEN}\`, 'Content-Type': 'application/json' },
    body: JSON.stringify(paths.length ? { files: paths.map((p) => \`https://www.example.com\${p}\`) } : { purge_everything: true }),
  });

  res.status(200).json({ purged: paths.length || 'everything' });
});

app.listen(3001);`,v=e=>`cms.content('${e.type}').find({ limit: 10, sort: '-publishedAt' })`;function W(e,n){const{type:t,listVar:a,titleField:r,apiUrl:o}=n;switch(e){case"nextjs":return[{label:"Client",caption:"lib/cms.ts",language:"typescript",code:`import { createCMSClient } from '@meridian/sdk';

// Runs on the server only. Never expose this key through a NEXT_PUBLIC_ variable.
export const cms = createCMSClient({
  baseURL: process.env.MERIDIAN_URL!,
  apiKey: process.env.MERIDIAN_API_KEY!,
});`},{label:`List ${n.typeLabel.toLowerCase()}`,caption:`app/${t}/page.tsx`,language:"tsx",code:`import { cms } from '@/lib/cms';

export default async function Page() {
  const { data: ${a}, meta } = await ${v(n)};

  return (
    <main>
      <h1>${n.typeLabel} ({meta.total})</h1>
      <ul>
        {${a}.map((entry) => (
          <li key={entry.id}>{entry.${r}}</li>
        ))}
      </ul>
    </main>
  );
}`},{label:"Render pages",caption:"app/[[...path]]/page.tsx",language:"tsx",code:`import { notFound } from 'next/navigation';
import { BlockRenderer } from '@/components/BlockRenderer';
import { cms } from '@/lib/cms';

// One route renders every page built in Meridian's page builder.
export default async function CmsPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const page = await cms.pages.getByPath('/' + path.join('/'));
  if (!page) notFound();

  return <BlockRenderer blocks={page.blocks} />;
}`},{label:"Block renderer",caption:"components/BlockRenderer.tsx",language:"tsx",code:C},{label:"Revalidate on publish",caption:"app/api/revalidate/route.ts",language:"typescript",code:T}];case"react":return[{label:"Client",caption:"src/cms.ts",language:"typescript",code:`import { createCMSClient } from '@meridian/sdk';

// A read-only key is safe here: it can only read published content.
export const cms = createCMSClient({
  baseURL: import.meta.env.VITE_MERIDIAN_URL,
  apiKey: import.meta.env.VITE_MERIDIAN_API_KEY,
});`},{label:`List ${n.typeLabel.toLowerCase()}`,caption:`src/${l(t)}List.tsx`,language:"tsx",code:`import { useEffect, useState } from 'react';
import { cms } from './cms';

export function ${l(t)}List() {
  const [${a}, set${l(t)}] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      ${v(n)}
        .then(({ data }) => !cancelled && set${l(t)}(data))
        .catch((err) => !cancelled && setError(err.message));

    load();
    // Refresh the moment an editor publishes — no redeploy, no polling.
    const unsubscribe = cms.subscribe((event) => {
      if (event.contentType === '${t}') load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  if (error) return <p role="alert">{error}</p>;
  return (
    <ul>
      {${a}.map((entry) => (
        <li key={entry.id}>{entry.${r}}</li>
      ))}
    </ul>
  );
}`},{label:"Render pages",caption:"src/CmsPage.tsx",language:"tsx",code:`import { useEffect, useState } from 'react';
import { BlockRenderer, type Block } from './BlockRenderer';
import { cms } from './cms';

export function CmsPage({ path }: { path: string }) {
  const [blocks, setBlocks] = useState<Block[] | null>(null);

  useEffect(() => {
    cms.pages.getByPath(path).then((page) => setBlocks(page?.blocks ?? []));
  }, [path]);

  return blocks ? <BlockRenderer blocks={blocks} /> : null;
}`},{label:"Block renderer",caption:"src/BlockRenderer.tsx",language:"tsx",code:C}];case"vue":return[{label:"Composable",caption:"src/composables/useContent.ts",language:"typescript",code:`import { onMounted, onUnmounted, ref } from 'vue';
import { createCMSClient } from '@meridian/sdk';

// A read-only key is safe here: it can only read published content.
export const cms = createCMSClient({
  baseURL: import.meta.env.VITE_MERIDIAN_URL,
  apiKey: import.meta.env.VITE_MERIDIAN_API_KEY,
});

export function useContent<T = Record<string, any>>(type: string, params: Record<string, unknown> = {}) {
  const items = ref<T[]>([]);
  const loading = ref(true);
  const error = ref<string | null>(null);

  async function load() {
    try {
      const { data } = await cms.content(type).find(params);
      items.value = data as T[];
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
  }

  let unsubscribe = () => {};
  onMounted(() => {
    void load();
    unsubscribe = cms.subscribe((event) => event.contentType === type && load());
  });
  onUnmounted(() => unsubscribe());

  return { items, loading, error };
}`},{label:`List ${n.typeLabel.toLowerCase()}`,caption:`src/components/${l(t)}List.vue`,language:"vue",code:`<script setup lang="ts">
import { useContent } from '@/composables/useContent';

const { items, loading, error } = useContent('${t}', { limit: 10, sort: '-publishedAt' });
<\/script>

<template>
  <p v-if="loading">Loading…</p>
  <p v-else-if="error" role="alert">{{ error }}</p>
  <ul v-else>
    <li v-for="entry in items" :key="entry.id">{{ entry.${r} }}</li>
  </ul>
</template>`},{label:"Render pages",caption:"src/components/CmsPage.vue",language:"vue",code:`<script setup lang="ts">
import { ref, watchEffect } from 'vue';
import { cms } from '@/composables/useContent';
import HeroBlock from './blocks/HeroBlock.vue';
import FaqBlock from './blocks/FaqBlock.vue';

const props = defineProps<{ path: string }>();
const blocks = ref<any[]>([]);

// Map each block type coming from Meridian to one of YOUR components.
const components: Record<string, unknown> = { hero: HeroBlock, faq: FaqBlock };

watchEffect(async () => {
  const page = await cms.pages.getByPath(props.path);
  blocks.value = page?.blocks ?? [];
});
<\/script>

<template>
  <template v-for="block in blocks" :key="block.id">
    <component :is="components[block.type]" v-if="components[block.type]" v-bind="block.props" />
  </template>
</template>`}];case"angular":return[{label:"Service",caption:"src/app/cms.service.ts",language:"typescript",code:`import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../environments/environment';

export interface ListResponse<T> {
  data: T[];
  meta: { total: number; limit: number; offset: number; page: number; pageCount: number };
}

@Injectable({ providedIn: 'root' })
export class CmsService {
  private readonly http = inject(HttpClient);
  private readonly base = \`\${environment.meridianUrl}/api/v1\`;
  // Use a read-only key: it ships to the browser.
  private readonly headers = { Authorization: \`Bearer \${environment.meridianApiKey}\` };

  list<T>(type: string, params: Record<string, string | number> = {}): Observable<ListResponse<T>> {
    return this.http.get<ListResponse<T>>(\`\${this.base}/\${type}\`, {
      headers: this.headers,
      params: new HttpParams({ fromObject: params }),
    });
  }

  one<T>(type: string, idOrSlug: string): Observable<T> {
    return this.http.get<{ data: T }>(\`\${this.base}/\${type}/\${idOrSlug}\`, { headers: this.headers }).pipe(map((r) => r.data));
  }

  pageByPath<T>(path: string): Observable<T> {
    return this.http.get<{ data: T }>(\`\${this.base}/pages\`, { headers: this.headers, params: { path } }).pipe(map((r) => r.data));
  }
}`},{label:`List ${n.typeLabel.toLowerCase()}`,caption:`src/app/${t}.component.ts`,language:"typescript",code:`import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { CmsService } from './cms.service';

@Component({
  selector: 'app-${t}',
  template: \`
    <ul>
      @for (entry of items(); track entry.id) {
        <li>{{ entry.${r} }}</li>
      }
    </ul>
  \`,
})
export class ${l(t)}Component {
  private readonly cms = inject(CmsService);
  readonly items = toSignal(
    this.cms.list<any>('${t}', { limit: 10, sort: '-publishedAt' }).pipe(map((response) => response.data)),
    { initialValue: [] },
  );
}`}];case"react-native":return[{label:"Client",caption:"src/cms.ts",language:"typescript",code:`import { createCMSClient } from '@meridian/sdk';

// Apps can be unpacked, so only ever ship a read-only key.
export const cms = createCMSClient({
  baseURL: process.env.EXPO_PUBLIC_MERIDIAN_URL!,
  apiKey: process.env.EXPO_PUBLIC_MERIDIAN_API_KEY!,
});`},{label:`List ${n.typeLabel.toLowerCase()}`,caption:`src/screens/${l(t)}Screen.tsx`,language:"tsx",code:`import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text } from 'react-native';
import { cms } from '../cms';

export function ${l(t)}Screen() {
  const [${a}, set${l(t)}] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data } = await ${v(n)};
      set${l(t)}(data);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <FlatList
      data={${a}}
      keyExtractor={(entry) => entry.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
      renderItem={({ item }) => <Text>{item.${r}}</Text>}
    />
  );
}`}];case"flutter":return[{label:"Client",caption:"lib/cms_client.dart",language:"dart",code:`import 'dart:convert';
import 'package:http/http.dart' as http;

class CmsClient {
  CmsClient({required this.baseUrl, required this.apiKey});

  final String baseUrl;
  final String apiKey; // apps can be unpacked: use a read-only key

  Map<String, String> get _headers => {'Authorization': 'Bearer $apiKey'};

  Future<List<dynamic>> list(String type, {Map<String, String> params = const {}}) async {
    final uri = Uri.parse('$baseUrl/api/v1/$type').replace(queryParameters: params);
    final response = await http.get(uri, headers: _headers);
    if (response.statusCode != 200) {
      throw Exception('Meridian responded \${response.statusCode}: \${response.body}');
    }
    return (jsonDecode(response.body) as Map<String, dynamic>)['data'] as List<dynamic>;
  }

  Future<Map<String, dynamic>> pageByPath(String path) async {
    final uri = Uri.parse('$baseUrl/api/v1/pages').replace(queryParameters: {'path': path});
    final response = await http.get(uri, headers: _headers);
    if (response.statusCode != 200) {
      throw Exception('Meridian responded \${response.statusCode}: \${response.body}');
    }
    return (jsonDecode(response.body) as Map<String, dynamic>)['data'] as Map<String, dynamic>;
  }
}

final cms = CmsClient(
  baseUrl: const String.fromEnvironment('MERIDIAN_URL'),
  apiKey: const String.fromEnvironment('MERIDIAN_API_KEY'),
);`},{label:`List ${n.typeLabel.toLowerCase()}`,caption:`lib/${t.replace(/-/g,"_")}_screen.dart`,language:"dart",code:`import 'package:flutter/material.dart';
import 'cms_client.dart';

class ${l(t)}Screen extends StatelessWidget {
  const ${l(t)}Screen({super.key});

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<dynamic>>(
      future: cms.list('${t}', params: {'limit': '10', 'sort': '-publishedAt'}),
      builder: (context, snapshot) {
        if (snapshot.hasError) return Center(child: Text('\${snapshot.error}'));
        if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
        final entries = snapshot.data!;
        return ListView.builder(
          itemCount: entries.length,
          itemBuilder: (context, index) => ListTile(title: Text('\${entries[index]['${r}']}')),
        );
      },
    );
  }
}`}];case"node":return[{label:"Fetch content",caption:"fetch-content.mjs",language:"javascript",code:`import { createCMSClient } from '@meridian/sdk';

const cms = createCMSClient({
  baseURL: process.env.MERIDIAN_URL,
  apiKey: process.env.MERIDIAN_API_KEY,
});

const { data: ${a}, meta } = await ${v(n)};
console.log(\`\${meta.total} ${n.typeLabel.toLowerCase()}\`, ${a}.map((entry) => entry.${r}));

const home = await cms.pages.getByPath('/');
console.log(home?.blocks.map((block) => block.type));

const data = await cms.graphql('{ ${a}(limit: 3) { total items { id } } }');
console.log(data);`},{label:"Verify webhooks",caption:"verify-meridian-webhook.js",language:"javascript",code:L}];default:return[{label:"Requests",caption:"Shell",language:"bash",code:`# List ${n.typeLabel.toLowerCase()}
curl -H "Authorization: Bearer $MERIDIAN_API_KEY" \\
  "${o}/api/v1/${t}?limit=10&sort=-publishedAt"

# A page by its URL path
curl -H "Authorization: Bearer $MERIDIAN_API_KEY" \\
  "${o}/api/v1/pages?path=/"

# GraphQL
curl -X POST "${o}/api/v1/graphql" \\
  -H "Authorization: Bearer $MERIDIAN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"{ ${a}(limit: 3) { total items { id } } }"}'`}]}}const _=e=>encodeURIComponent(e).replace(/%2C/g,",").replace(/%2F/g,"/").replace(/%3A/g,":").replace(/'/g,"%27").replace(/\(/g,"%28").replace(/\)/g,"%29");function P(e){const n=[];for(const[t,a]of Object.entries(e.params))a!==""&&n.push(`${t}=${_(a)}`);for(const t of e.filters)!t.field||t.value===""&&t.op!=="null"||n.push(t.op==="eq"?`filter[${t.field}]=${_(t.value)}`:`filter[${t.field}][${t.op}]=${_(t.value||"true")}`);return n.join("&")}const E=e=>{const n=P(e);return`${e.path}${n?`?${n}`:""}`},b=e=>e.body!==void 0&&e.body!==null&&!["GET","DELETE"].includes(e.method),p=e=>e.method==="GET",M="Write requests need a read/write key, which is a secret: send them from your server, never from client-side code.";function D(e,n){const t=[`curl${e.method==="GET"?"":` -X ${e.method}`} "${n}/api/v1${E(e)}"`,'  -H "Authorization: Bearer $MERIDIAN_API_KEY"'];return b(e)&&(t.push('  -H "Content-Type: application/json"'),t.push(`  -d '${JSON.stringify(e.body,null,2).replace(/'/g,"'\\''")}'`)),t.join(` \\
`)}function f(e,n,t,a=[],r){const o=r??`'${n}/api/v1${E(e)}'`,s=`Authorization: \`Bearer \${${t}}\``,i=[];return p(e)||i.push(`method: '${e.method}',`),i.push(b(e)?`headers: {
    ${s},
    'Content-Type': 'application/json',
  },`:`headers: { ${s} },`),b(e)&&i.push(`body: JSON.stringify(${d(JSON.stringify(e.body,null,2),2)}),`),i.push(...a),`fetch(${o}, {
  ${i.join(`
  `)}
})`}const B=e=>e.method==="DELETE"?"":`
const result = await response.json();`;function y(e,n=1){if(typeof e=="string")return`'${e.replace(/\\/g,"\\\\").replace(/'/g,"\\'")}'`;if(Array.isArray(e))return`[${e.map(t=>y(t,n)).join(", ")}]`;if(e&&typeof e=="object"){const t=Object.entries(e);if(t.length===0)return"{}";const a="  ".repeat(n);return`{
${t.map(([r,o])=>`${a}${/^[A-Za-z_$][\w$]*$/.test(r)?r:`'${r}'`}: ${y(o,n+1)},`).join(`
`)}
${"  ".repeat(n-1)}}`}return String(e)}function j(e,n=[]){const t={};for(const[r,o]of Object.entries(e.params))o===""||n.includes(r)||(["limit","offset","page"].includes(r)&&Number.isFinite(Number(o))?t[r]=Number(o):r==="populate"||r==="fields"?t[r]=o.split(",").map(s=>s.trim()).filter(Boolean):t[r]=o);const a={};for(const r of e.filters)!r.field||r.value===""&&r.op!=="null"||(r.op==="eq"?a[r.field]=r.value:a[r.field]={...a[r.field]??{},[r.op]:r.op==="in"||r.op==="nin"?r.value.split(",").map(o=>o.trim()):r.value});return Object.keys(a).length&&(t.filter=a),t}function O(e){const n=`import { createCMSClient } from '@meridian/sdk';

const cms = createCMSClient({
  baseURL: process.env.MERIDIAN_URL!,
  apiKey: process.env.MERIDIAN_API_KEY!,
});
`,t=e.path.split("/").filter(Boolean),[a,r]=t;if(p(e)&&a&&t.length<=2&&!["media","preview","content-types","openapi.json"].includes(a)){if(a===m&&!r&&e.params.path)return`${n}
const page = await cms.pages.getByPath(${y(e.params.path)});`;if(a===m&&r)return`${n}
const page = await cms.pages.getBySlug(${y(r)});`;const o=j(e),s=Object.keys(o).length?y(o):"";return a===m?`${n}
const { data: pages, meta } = await cms.pages.list(${s});`:r?`${n}
const entry = await cms.content(${y(a)}).findOne(${y(r)}${s?`, ${s}`:""});`:`${n}
const { data, meta } = await cms.content(${y(a)}).find(${s});`}return`// ${p(e)?"Typed request":M}
interface MeridianError {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

const response = await ${f(e,"","process.env.MERIDIAN_API_KEY",[],`\`\${process.env.MERIDIAN_URL}/api/v1${E(e)}\``)};
if (!response.ok) {
  const { error } = (await response.json()) as MeridianError;
  throw new Error(\`\${error.code}: \${error.message}\`);
}${e.method==="DELETE"?"":`
const result: { data: Record<string, unknown> } = await response.json();`}`}const $=(e,n,t)=>p(e)?n:`${t(M)}
${n}`;function G(e,n){const t=c=>`// ${c}`,a=`${n}/api/v1${E(e)}`,r=b(e)?JSON.stringify(e.body,null,2):"",o=`const response = await ${f(e,n,"process.env.MERIDIAN_API_KEY")};
if (!response.ok) throw new Error(\`Meridian responded \${response.status}\`);${B(e)}`,s=p(e)?`import { useEffect, useState } from 'react';

export function Example() {
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    ${d(f(e,n,"import.meta.env.VITE_MERIDIAN_API_KEY",["signal: controller.signal,"]),4)}
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(\`Meridian responded \${response.status}\`))))
      .then(setResult)
      .catch((err) => err.name !== 'AbortError' && setError(err.message));
    return () => controller.abort();
  }, []);

  if (error) return <p role="alert">{error}</p>;
  return <pre>{JSON.stringify(result, null, 2)}</pre>;
}`:`import { useState } from 'react';

export function Example() {
  const [status, setStatus] = useState<number | null>(null);

  async function submit() {
    const response = await ${d(f(e,n,"import.meta.env.VITE_MERIDIAN_API_KEY"),4)};
    setStatus(response.status);
  }

  return <button onClick={submit}>Send{status ? \` (\${status})\` : ''}</button>;
}`,i=p(e)?`// app/example/page.tsx — a server component, so the key never reaches the browser
export default async function Page() {
  const response = await ${d(f(e,n,"process.env.MERIDIAN_API_KEY",[`next: { tags: ['${e.path.split("/").filter(Boolean)[0]??"content"}'] }, // refreshed by your Meridian webhook`]),2)};
  if (!response.ok) throw new Error(\`Meridian responded \${response.status}\`);
  const result = await response.json();

  return <pre>{JSON.stringify(result, null, 2)}</pre>;
}`:`// app/actions.ts — a server action, so the read/write key stays on the server
'use server';

export async function submit() {
  const response = await ${d(f(e,n,"process.env.MERIDIAN_API_KEY"),2)};
  if (!response.ok) throw new Error(\`Meridian responded \${response.status}\`);${e.method==="DELETE"?"":`
  return response.json();`}
}`,u=`<script setup lang="ts">
import { ${p(e)?"onMounted, ref":"ref"} } from 'vue';

const result = ref<unknown>(null);

${p(e)?"onMounted(async () => {":"async function submit() {"}
  const response = await ${d(f(e,n,"import.meta.env.VITE_MERIDIAN_API_KEY"),2)};
  result.value = ${e.method==="DELETE"?"response.status":"await response.json()"};
}${p(e)?");":""}
<\/script>

<template>
  ${p(e)?"<pre>{{ result }}</pre>":`<button @click="submit">Send</button>
  <pre>{{ result }}</pre>`}
</template>`,g=`import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../environments/environment';

@Injectable({ providedIn: 'root' })
export class ExampleService {
  private readonly http = inject(HttpClient);

  send() {
    return this.http.request('${e.method}', '${a}', {
      headers: { Authorization: \`Bearer \${environment.meridianApiKey}\` },${b(e)?`
      body: ${d(r,6)},`:""}
    });
  }
}`,I=`import { useEffect, useState } from 'react';
import { ${p(e)?"ScrollView, Text":"Button, Text, View"} } from 'react-native';

export function ExampleScreen() {
  const [result, setResult] = useState<unknown>(null);

  ${p(e)?`useEffect(() => {
    load();
  }, []);

  async function load() {`:"async function submit() {"}
    const response = await ${d(f(e,n,"process.env.EXPO_PUBLIC_MERIDIAN_API_KEY"),4)};
    setResult(${e.method==="DELETE"?"response.status":"await response.json()"});
  }

  return ${p(e)?`(
    <ScrollView>
      <Text>{JSON.stringify(result, null, 2)}</Text>
    </ScrollView>
  );`:`(
    <View>
      <Button title="Send" onPress={submit} />
      <Text>{JSON.stringify(result)}</Text>
    </View>
  );`}
}`,S=e.method.toLowerCase(),R=`import 'dart:convert';
import 'package:http/http.dart' as http;

const apiKey = String.fromEnvironment('MERIDIAN_API_KEY');

Future<${e.method==="DELETE"?"int":"dynamic"}> send() async {
  final response = await http.${S}(
    Uri.parse('${a.replace(/\$/g,"\\$")}'),
    headers: {
      'Authorization': 'Bearer $apiKey',${b(e)?`
      'Content-Type': 'application/json',`:""}
    },${b(e)?`
    body: jsonEncode(${d(r,4)}),`:""}
  );
  if (response.statusCode >= 400) {
    throw Exception('Meridian responded \${response.statusCode}: \${response.body}');
  }
  return ${e.method==="DELETE"?"response.statusCode":"jsonDecode(response.body)"};
}`;return[{label:"JavaScript",language:"javascript",code:$(e,o,t)},{label:"TypeScript (SDK)",language:"typescript",code:O(e)},{label:"React",language:"tsx",code:$(e,s,t)},{label:"Next.js",language:"tsx",code:i},{label:"Vue",language:"vue",code:$(e,u,c=>`<!-- ${c} -->`)},{label:"Angular",language:"typescript",code:$(e,g,t)},{label:"React Native",language:"tsx",code:$(e,I,t)},{label:"Flutter",language:"dart",code:$(e,R,t)},{label:"cURL",language:"bash",code:D(e,n)}]}const A=/^[_A-Za-z][_0-9A-Za-z]*$/,w=[{name:"id",type:"ID!"},{name:"locale",type:"String!"},{name:"status",type:"String",description:"Only when reading drafts"},{name:"createdAt",type:"DateTime"},{name:"updatedAt",type:"DateTime"},{name:"publishedAt",type:"DateTime"}];function K(e){const n=new Set(["Query","Mutation","Media","JSON","DateTime","Page"]),t=new Map;for(const s of e.types){if(s.isSystem&&s.apiId===m){t.set(s.apiId,"Page");continue}let i=l(s.singularName)||l(s.apiId);A.test(i)||(i=`Type${l(s.apiId)}`);for(let u=2;n.has(i);u+=1)i=`${l(s.singularName)}${u}`;n.add(i),t.set(s.apiId,i)}const a=new Set,r=(s,i)=>{let u=A.test(s)&&!a.has(s)?s:i;for(let g=2;a.has(u);g+=1)u=`${i}${g}`;return a.add(u),u},o=s=>{switch(s){case"integer":return"Int";case"decimal":case"rating":return"Float";case"boolean":case"checkbox":return"Boolean";case"multiselect":return"[String!]";case"image":case"video":case"file":return"Media";case"images":case"files":return"[Media!]";case"json":case"richtext":case"component":case"repeatable":case"dynamiczone":case"geolocation":return"JSON";default:return"String"}};return e.types.map(s=>{const i=t.get(s.apiId),u=s.isSystem&&s.apiId===m,g=s.kind==="SINGLE",I=g?null:r(h(s.apiId),`${h(i)}List`),S=g?r(h(s.apiId),`${h(i)}Single`):r(h(i),`${h(i)}Item`),R=u?[...w,{name:"title",type:"String"},{name:"slug",type:"String"},{name:"path",type:"String"},{name:"parent",type:"JSON"},{name:"description",type:"String"},{name:"template",type:"String"},{name:"category",type:"String"},{name:"seo",type:"JSON"},{name:"blocks",type:"JSON",description:"Tree of blocks to render with your own components"}]:[...w,...s.fields.filter(c=>!c.config.private&&c.type!=="password"&&A.test(c.apiId)).flatMap(c=>{if(c.type==="relation"||c.type==="relations"){const k=t.get(c.config.targetType??"");return k?[{name:c.apiId,type:c.type==="relation"?k:`[${k}!]`,description:c.config.helpText}]:[]}return[{name:c.apiId,type:o(c.type),description:c.config.helpText}]})];return{apiId:s.apiId,displayName:s.displayName,typeName:i,listField:I,itemField:S,single:g,fields:R}})}function X(e){if(!e)return`{
  __typename
}`;const n=K(e),t=n.find(a=>!a.single&&a.apiId!==m)??n.find(a=>a.apiId===m)??n[0];return t?q(t):`{
  __typename
}`}function q(e){const n=["ID!","String","String!","Int","Float","Boolean","[String!]","JSON","DateTime"],t=e.fields.filter(r=>!["locale","status","createdAt","updatedAt","blocks","seo","parent"].includes(r.name)).slice(0,8),a=r=>t.map(o=>o.type.includes("Media")?`${r}${o.name} {
${r}  url
${r}  alt
${r}}`:n.includes(o.type)?`${r}${o.name}`:`${r}${o.name} {
${r}  id
${r}}`).join(`
`);return e.single||!e.listField?`query {
  ${e.itemField} {
${a("    ")}
  }
}`:`query ${l(e.apiId)}($limit: Int = 5) {
  ${e.listField}(limit: $limit, sort: "-publishedAt") {
    total
    items {
${a("      ")}
    }
  }
}`}export{z as C,x as F,T as N,G as a,V as b,D as c,K as d,_ as e,Y as f,q as g,W as h,J as i,H as j,L as k,h as l,E as r,X as s};
//# sourceMappingURL=snippets-DMBNK_Dl.js.map
