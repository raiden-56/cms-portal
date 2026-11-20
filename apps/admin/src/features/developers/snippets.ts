/**
 * Code generation for the developer portal: per-framework setup, sample code that uses the
 * project's real content types, and request snippets that mirror the API explorer's state.
 *
 * Generated code never embeds a real key. Keys are read from environment variables.
 */
import { PAGE_TYPE_ID, toPascalCase } from '@meridian/shared';
import type { ContentType, SchemaResponse } from '@/lib/types';
import type { SnippetItem } from './shared';

export type Framework = 'nextjs' | 'react' | 'vue' | 'angular' | 'react-native' | 'flutter' | 'node' | 'curl';

export interface FrameworkInfo {
  id: Framework;
  label: string;
  mark: string;
  tagline: string;
  /** Where the code runs, which decides whether a secret key may be used. */
  runtime: 'server' | 'browser' | 'device';
}

export const FRAMEWORKS: FrameworkInfo[] = [
  { id: 'nextjs', label: 'Next.js', mark: 'N', tagline: 'App Router with on-demand revalidation', runtime: 'server' },
  { id: 'react', label: 'React', mark: 'R', tagline: 'Single-page apps built with Vite', runtime: 'browser' },
  { id: 'vue', label: 'Vue', mark: 'V', tagline: 'Vue 3 with a reusable composable', runtime: 'browser' },
  { id: 'angular', label: 'Angular', mark: 'A', tagline: 'An injectable service on HttpClient', runtime: 'browser' },
  { id: 'react-native', label: 'React Native', mark: 'RN', tagline: 'iOS and Android apps', runtime: 'device' },
  { id: 'flutter', label: 'Flutter', mark: 'F', tagline: 'Dart with the http package', runtime: 'device' },
  { id: 'node', label: 'Node.js', mark: 'JS', tagline: 'Servers, scripts and static builds', runtime: 'server' },
  { id: 'curl', label: 'cURL', mark: '>_', tagline: 'Any language over plain HTTP', runtime: 'server' },
];

export const frameworkInfo = (id: Framework) => FRAMEWORKS.find((f) => f.id === id) as FrameworkInfo;

export const camel = (value: string) => {
  const pascal = toPascalCase(value);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
};

export interface SnippetContext {
  apiUrl: string;
  /** apiId of the content type used in examples. */
  type: string;
  /** Variable name for a list of that type, e.g. `articles`. */
  listVar: string;
  typeLabel: string;
  titleField: string;
  relationField: string | null;
  filter: { field: string; value: string } | null;
}

const exampleType = (schema: SchemaResponse | undefined): ContentType | undefined =>
  schema?.types.find((t) => !t.isSystem && t.kind === 'COLLECTION') ?? schema?.types.find((t) => t.apiId === PAGE_TYPE_ID);

/** Derives the names used in examples from the project's real content model. */
export function snippetContext(apiUrl: string, schema: SchemaResponse | undefined): SnippetContext {
  const type = exampleType(schema);
  if (!type) return { apiUrl, type: PAGE_TYPE_ID, listVar: 'pages', typeLabel: 'Pages', titleField: 'title', relationField: null, filter: null };
  const visible = type.fields.filter((f) => !f.config.private && f.type !== 'password');
  const choice = visible.find((f) => (f.type === 'select' || f.type === 'radio') && f.config.options?.length);
  const flag = visible.find((f) => f.type === 'boolean');
  return {
    apiUrl,
    type: type.apiId,
    listVar: camel(type.apiId) || 'items',
    typeLabel: type.displayName,
    titleField: type.options.titleField ?? visible.find((f) => f.type === 'text')?.apiId ?? 'id',
    relationField: visible.find((f) => f.type === 'relation' || f.type === 'relations')?.apiId ?? null,
    filter: choice ? { field: choice.apiId, value: choice.config.options?.[0]?.value ?? '' } : flag ? { field: flag.apiId, value: 'true' } : null,
  };
}

const indent = (text: string, spaces: number) =>
  text
    .split('\n')
    .map((line, i) => (i === 0 || !line ? line : ' '.repeat(spaces) + line))
    .join('\n');

// ─── Setup ───────────────────────────────────────────────────────────────────

export function installSnippet(framework: Framework): SnippetItem | null {
  if (framework === 'curl') return null;
  if (framework === 'flutter') return { label: 'Install', language: 'bash', code: 'flutter pub add http' };
  if (framework === 'angular') return { label: 'Install', language: 'bash', code: '# Uses Angular’s built-in HttpClient — nothing to install.\n# Make sure provideHttpClient() is in your app config.' };
  return { label: 'Install', language: 'bash', code: 'npm install @meridian/sdk' };
}

/** Where the key goes for each framework. `key` is the value to place in the file (a real key only inside the wizard). */
export function envSnippet(framework: Framework, apiUrl: string, key: string): SnippetItem {
  switch (framework) {
    case 'nextjs':
      return {
        label: 'Environment',
        caption: '.env.local',
        language: 'bash',
        code: `MERIDIAN_URL=${apiUrl}\nMERIDIAN_API_KEY=${key}\n# From Developers → Webhooks, used to verify revalidation calls\nMERIDIAN_WEBHOOK_SECRET=whsec_your_signing_secret`,
      };
    case 'react':
    case 'vue':
      return { label: 'Environment', caption: '.env', language: 'bash', code: `VITE_MERIDIAN_URL=${apiUrl}\nVITE_MERIDIAN_API_KEY=${key}` };
    case 'angular':
      return {
        label: 'Environment',
        caption: 'src/environments/environment.ts',
        language: 'typescript',
        code: `export const environment = {\n  meridianUrl: '${apiUrl}',\n  meridianApiKey: '${key}',\n};`,
      };
    case 'react-native':
      return { label: 'Environment', caption: '.env', language: 'bash', code: `EXPO_PUBLIC_MERIDIAN_URL=${apiUrl}\nEXPO_PUBLIC_MERIDIAN_API_KEY=${key}` };
    case 'flutter':
      return { label: 'Environment', caption: 'Pass at build time', language: 'bash', code: `flutter run \\\n  --dart-define=MERIDIAN_URL=${apiUrl} \\\n  --dart-define=MERIDIAN_API_KEY=${key}` };
    case 'node':
      return { label: 'Environment', caption: '.env', language: 'bash', code: `MERIDIAN_URL=${apiUrl}\nMERIDIAN_API_KEY=${key}` };
    default:
      return { label: 'Environment', caption: 'Shell', language: 'bash', code: `export MERIDIAN_URL=${apiUrl}\nexport MERIDIAN_API_KEY=${key}` };
  }
}

// ─── Reusable pieces ─────────────────────────────────────────────────────────

export const BLOCK_RENDERER = `import type { ComponentType, ReactNode } from 'react';
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
}`;

export const NEXT_REVALIDATE_ROUTE = `import { revalidatePath, revalidateTag } from 'next/cache';
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
}`;

export const NODE_VERIFY = `import { createHmac, timingSafeEqual } from 'node:crypto';

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
}`;

export const CDN_PURGE_RECEIVER = `import express from 'express';
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

app.listen(3001);`;

// ─── Sample code per framework ───────────────────────────────────────────────

const sdkFind = (ctx: SnippetContext) => `cms.content('${ctx.type}').find({ limit: 10, sort: '-publishedAt' })`;

export function sampleSnippets(framework: Framework, ctx: SnippetContext): SnippetItem[] {
  const { type, listVar, titleField, apiUrl } = ctx;
  switch (framework) {
    case 'nextjs':
      return [
        {
          label: 'Client',
          caption: 'lib/cms.ts',
          language: 'typescript',
          code: `import { createCMSClient } from '@meridian/sdk';

// Runs on the server only. Never expose this key through a NEXT_PUBLIC_ variable.
export const cms = createCMSClient({
  baseURL: process.env.MERIDIAN_URL!,
  apiKey: process.env.MERIDIAN_API_KEY!,
});`,
        },
        {
          label: `List ${ctx.typeLabel.toLowerCase()}`,
          caption: `app/${type}/page.tsx`,
          language: 'tsx',
          code: `import { cms } from '@/lib/cms';

export default async function Page() {
  const { data: ${listVar}, meta } = await ${sdkFind(ctx)};

  return (
    <main>
      <h1>${ctx.typeLabel} ({meta.total})</h1>
      <ul>
        {${listVar}.map((entry) => (
          <li key={entry.id}>{entry.${titleField}}</li>
        ))}
      </ul>
    </main>
  );
}`,
        },
        {
          label: 'Render pages',
          caption: 'app/[[...path]]/page.tsx',
          language: 'tsx',
          code: `import { notFound } from 'next/navigation';
import { BlockRenderer } from '@/components/BlockRenderer';
import { cms } from '@/lib/cms';

// One route renders every page built in Meridian's page builder.
export default async function CmsPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const page = await cms.pages.getByPath('/' + path.join('/'));
  if (!page) notFound();

  return <BlockRenderer blocks={page.blocks} />;
}`,
        },
        { label: 'Block renderer', caption: 'components/BlockRenderer.tsx', language: 'tsx', code: BLOCK_RENDERER },
        { label: 'Revalidate on publish', caption: 'app/api/revalidate/route.ts', language: 'typescript', code: NEXT_REVALIDATE_ROUTE },
      ];
    case 'react':
      return [
        {
          label: 'Client',
          caption: 'src/cms.ts',
          language: 'typescript',
          code: `import { createCMSClient } from '@meridian/sdk';

// A read-only key is safe here: it can only read published content.
export const cms = createCMSClient({
  baseURL: import.meta.env.VITE_MERIDIAN_URL,
  apiKey: import.meta.env.VITE_MERIDIAN_API_KEY,
});`,
        },
        {
          label: `List ${ctx.typeLabel.toLowerCase()}`,
          caption: `src/${toPascalCase(type)}List.tsx`,
          language: 'tsx',
          code: `import { useEffect, useState } from 'react';
import { cms } from './cms';

export function ${toPascalCase(type)}List() {
  const [${listVar}, set${toPascalCase(type)}] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      ${sdkFind(ctx)}
        .then(({ data }) => !cancelled && set${toPascalCase(type)}(data))
        .catch((err) => !cancelled && setError(err.message));

    load();
    // Refresh the moment an editor publishes — no redeploy, no polling.
    const unsubscribe = cms.subscribe((event) => {
      if (event.contentType === '${type}') load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  if (error) return <p role="alert">{error}</p>;
  return (
    <ul>
      {${listVar}.map((entry) => (
        <li key={entry.id}>{entry.${titleField}}</li>
      ))}
    </ul>
  );
}`,
        },
        {
          label: 'Render pages',
          caption: 'src/CmsPage.tsx',
          language: 'tsx',
          code: `import { useEffect, useState } from 'react';
import { BlockRenderer, type Block } from './BlockRenderer';
import { cms } from './cms';

export function CmsPage({ path }: { path: string }) {
  const [blocks, setBlocks] = useState<Block[] | null>(null);

  useEffect(() => {
    cms.pages.getByPath(path).then((page) => setBlocks(page?.blocks ?? []));
  }, [path]);

  return blocks ? <BlockRenderer blocks={blocks} /> : null;
}`,
        },
        { label: 'Block renderer', caption: 'src/BlockRenderer.tsx', language: 'tsx', code: BLOCK_RENDERER },
      ];
    case 'vue':
      return [
        {
          label: 'Composable',
          caption: 'src/composables/useContent.ts',
          language: 'typescript',
          code: `import { onMounted, onUnmounted, ref } from 'vue';
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
}`,
        },
        {
          label: `List ${ctx.typeLabel.toLowerCase()}`,
          caption: `src/components/${toPascalCase(type)}List.vue`,
          language: 'vue',
          code: `<script setup lang="ts">
import { useContent } from '@/composables/useContent';

const { items, loading, error } = useContent('${type}', { limit: 10, sort: '-publishedAt' });
</script>

<template>
  <p v-if="loading">Loading…</p>
  <p v-else-if="error" role="alert">{{ error }}</p>
  <ul v-else>
    <li v-for="entry in items" :key="entry.id">{{ entry.${titleField} }}</li>
  </ul>
</template>`,
        },
        {
          label: 'Render pages',
          caption: 'src/components/CmsPage.vue',
          language: 'vue',
          code: `<script setup lang="ts">
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
</script>

<template>
  <template v-for="block in blocks" :key="block.id">
    <component :is="components[block.type]" v-if="components[block.type]" v-bind="block.props" />
  </template>
</template>`,
        },
      ];
    case 'angular':
      return [
        {
          label: 'Service',
          caption: 'src/app/cms.service.ts',
          language: 'typescript',
          code: `import { HttpClient, HttpParams } from '@angular/common/http';
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
}`,
        },
        {
          label: `List ${ctx.typeLabel.toLowerCase()}`,
          caption: `src/app/${type}.component.ts`,
          language: 'typescript',
          code: `import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { CmsService } from './cms.service';

@Component({
  selector: 'app-${type}',
  template: \`
    <ul>
      @for (entry of items(); track entry.id) {
        <li>{{ entry.${titleField} }}</li>
      }
    </ul>
  \`,
})
export class ${toPascalCase(type)}Component {
  private readonly cms = inject(CmsService);
  readonly items = toSignal(
    this.cms.list<any>('${type}', { limit: 10, sort: '-publishedAt' }).pipe(map((response) => response.data)),
    { initialValue: [] },
  );
}`,
        },
      ];
    case 'react-native':
      return [
        {
          label: 'Client',
          caption: 'src/cms.ts',
          language: 'typescript',
          code: `import { createCMSClient } from '@meridian/sdk';

// Apps can be unpacked, so only ever ship a read-only key.
export const cms = createCMSClient({
  baseURL: process.env.EXPO_PUBLIC_MERIDIAN_URL!,
  apiKey: process.env.EXPO_PUBLIC_MERIDIAN_API_KEY!,
});`,
        },
        {
          label: `List ${ctx.typeLabel.toLowerCase()}`,
          caption: `src/screens/${toPascalCase(type)}Screen.tsx`,
          language: 'tsx',
          code: `import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text } from 'react-native';
import { cms } from '../cms';

export function ${toPascalCase(type)}Screen() {
  const [${listVar}, set${toPascalCase(type)}] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data } = await ${sdkFind(ctx)};
      set${toPascalCase(type)}(data);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <FlatList
      data={${listVar}}
      keyExtractor={(entry) => entry.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
      renderItem={({ item }) => <Text>{item.${titleField}}</Text>}
    />
  );
}`,
        },
      ];
    case 'flutter':
      return [
        {
          label: 'Client',
          caption: 'lib/cms_client.dart',
          language: 'dart',
          code: `import 'dart:convert';
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
);`,
        },
        {
          label: `List ${ctx.typeLabel.toLowerCase()}`,
          caption: `lib/${type.replace(/-/g, '_')}_screen.dart`,
          language: 'dart',
          code: `import 'package:flutter/material.dart';
import 'cms_client.dart';

class ${toPascalCase(type)}Screen extends StatelessWidget {
  const ${toPascalCase(type)}Screen({super.key});

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<dynamic>>(
      future: cms.list('${type}', params: {'limit': '10', 'sort': '-publishedAt'}),
      builder: (context, snapshot) {
        if (snapshot.hasError) return Center(child: Text('\${snapshot.error}'));
        if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
        final entries = snapshot.data!;
        return ListView.builder(
          itemCount: entries.length,
          itemBuilder: (context, index) => ListTile(title: Text('\${entries[index]['${titleField}']}')),
        );
      },
    );
  }
}`,
        },
      ];
    case 'node':
      return [
        {
          label: 'Fetch content',
          caption: 'fetch-content.mjs',
          language: 'javascript',
          code: `import { createCMSClient } from '@meridian/sdk';

const cms = createCMSClient({
  baseURL: process.env.MERIDIAN_URL,
  apiKey: process.env.MERIDIAN_API_KEY,
});

const { data: ${listVar}, meta } = await ${sdkFind(ctx)};
console.log(\`\${meta.total} ${ctx.typeLabel.toLowerCase()}\`, ${listVar}.map((entry) => entry.${titleField}));

const home = await cms.pages.getByPath('/');
console.log(home?.blocks.map((block) => block.type));

const data = await cms.graphql('{ ${listVar}(limit: 3) { total items { id } } }');
console.log(data);`,
        },
        { label: 'Verify webhooks', caption: 'verify-meridian-webhook.js', language: 'javascript', code: NODE_VERIFY },
      ];
    default:
      return [
        {
          label: 'Requests',
          caption: 'Shell',
          language: 'bash',
          code: `# List ${ctx.typeLabel.toLowerCase()}
curl -H "Authorization: Bearer $MERIDIAN_API_KEY" \\
  "${apiUrl}/api/v1/${type}?limit=10&sort=-publishedAt"

# A page by its URL path
curl -H "Authorization: Bearer $MERIDIAN_API_KEY" \\
  "${apiUrl}/api/v1/pages?path=/"

# GraphQL
curl -X POST "${apiUrl}/api/v1/graphql" \\
  -H "Authorization: Bearer $MERIDIAN_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"{ ${listVar}(limit: 3) { total items { id } } }"}'`,
        },
      ];
  }
}

// ─── Request snippets (API explorer) ─────────────────────────────────────────

export interface RequestFilter {
  field: string;
  op: string;
  value: string;
}

export interface RequestSpec {
  method: string;
  /** Path under /api/v1 with path parameters already substituted, e.g. `/articles/hello-world`. */
  path: string;
  params: Record<string, string>;
  filters: RequestFilter[];
  body?: unknown;
}

/**
 * Encodes a query value but leaves the characters that are safe and readable in a query string.
 * Quotes are always encoded so a value can never break out of a generated string literal.
 */
export const enc = (value: string) =>
  encodeURIComponent(value).replace(/%2C/g, ',').replace(/%2F/g, '/').replace(/%3A/g, ':').replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');

export function buildQuery(spec: Pick<RequestSpec, 'params' | 'filters'>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(spec.params)) {
    if (value !== '') parts.push(`${key}=${enc(value)}`);
  }
  for (const f of spec.filters) {
    if (!f.field || (f.value === '' && f.op !== 'null')) continue;
    parts.push(f.op === 'eq' ? `filter[${f.field}]=${enc(f.value)}` : `filter[${f.field}][${f.op}]=${enc(f.value || 'true')}`);
  }
  return parts.join('&');
}

export const requestPath = (spec: RequestSpec) => {
  const query = buildQuery(spec);
  return `${spec.path}${query ? `?${query}` : ''}`;
};

const hasBody = (spec: RequestSpec) => spec.body !== undefined && spec.body !== null && !['GET', 'DELETE'].includes(spec.method);
const isRead = (spec: RequestSpec) => spec.method === 'GET';
const WRITE_WARNING = 'Write requests need a read/write key, which is a secret: send them from your server, never from client-side code.';

export function curlSnippet(spec: RequestSpec, apiUrl: string): string {
  const lines = [`curl${spec.method === 'GET' ? '' : ` -X ${spec.method}`} "${apiUrl}/api/v1${requestPath(spec)}"`, '  -H "Authorization: Bearer $MERIDIAN_API_KEY"'];
  if (hasBody(spec)) {
    lines.push('  -H "Content-Type: application/json"');
    lines.push(`  -d '${JSON.stringify(spec.body, null, 2).replace(/'/g, "'\\''")}'`);
  }
  return lines.join(' \\\n');
}

/**
 * A `fetch(...)` call for the request, parameterised by how the key is read in that environment.
 * `urlExpr` overrides the URL expression (used when the base URL comes from an environment variable).
 */
function fetchCall(spec: RequestSpec, apiUrl: string, keyExpr: string, extra: string[] = [], urlExpr?: string): string {
  const url = urlExpr ?? `'${apiUrl}/api/v1${requestPath(spec)}'`;
  const auth = `Authorization: \`Bearer \${${keyExpr}}\``;
  const options: string[] = [];
  if (!isRead(spec)) options.push(`method: '${spec.method}',`);
  options.push(hasBody(spec) ? `headers: {\n    ${auth},\n    'Content-Type': 'application/json',\n  },` : `headers: { ${auth} },`);
  if (hasBody(spec)) options.push(`body: JSON.stringify(${indent(JSON.stringify(spec.body, null, 2), 2)}),`);
  options.push(...extra);
  return `fetch(${url}, {\n  ${options.join('\n  ')}\n})`;
}

const readResult = (spec: RequestSpec) => (spec.method === 'DELETE' ? '' : '\nconst result = await response.json();');

function toLiteral(value: unknown, depth = 1): string {
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (Array.isArray(value)) return `[${value.map((v) => toLiteral(v, depth)).join(', ')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const pad = '  '.repeat(depth);
    return `{\n${entries.map(([k, v]) => `${pad}${/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`}: ${toLiteral(v, depth + 1)},`).join('\n')}\n${'  '.repeat(depth - 1)}}`;
  }
  return String(value);
}

/** The explorer's query parameters as an options object for the SDK. */
function sdkParams(spec: RequestSpec, omit: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(spec.params)) {
    if (raw === '' || omit.includes(key)) continue;
    if (['limit', 'offset', 'page'].includes(key) && Number.isFinite(Number(raw))) out[key] = Number(raw);
    else if (key === 'populate' || key === 'fields') out[key] = raw.split(',').map((s) => s.trim()).filter(Boolean);
    else out[key] = raw;
  }
  const filter: Record<string, unknown> = {};
  for (const f of spec.filters) {
    if (!f.field || (f.value === '' && f.op !== 'null')) continue;
    if (f.op === 'eq') filter[f.field] = f.value;
    else filter[f.field] = { ...((filter[f.field] as object | undefined) ?? {}), [f.op]: f.op === 'in' || f.op === 'nin' ? f.value.split(',').map((s) => s.trim()) : f.value };
  }
  if (Object.keys(filter).length) out.filter = filter;
  return out;
}

function sdkSnippet(spec: RequestSpec): string {
  const header = `import { createCMSClient } from '@meridian/sdk';

const cms = createCMSClient({
  baseURL: process.env.MERIDIAN_URL!,
  apiKey: process.env.MERIDIAN_API_KEY!,
});
`;
  const segments = spec.path.split('/').filter(Boolean);
  const [type, id] = segments;
  if (isRead(spec) && type && segments.length <= 2 && !['media', 'preview', 'content-types', 'openapi.json'].includes(type)) {
    if (type === PAGE_TYPE_ID && !id && spec.params.path) {
      return `${header}\nconst page = await cms.pages.getByPath(${toLiteral(spec.params.path)});`;
    }
    if (type === PAGE_TYPE_ID && id) return `${header}\nconst page = await cms.pages.getBySlug(${toLiteral(id)});`;
    const params = sdkParams(spec);
    const args = Object.keys(params).length ? toLiteral(params) : '';
    if (type === PAGE_TYPE_ID) return `${header}\nconst { data: pages, meta } = await cms.pages.list(${args});`;
    if (id) return `${header}\nconst entry = await cms.content(${toLiteral(type)}).findOne(${toLiteral(id)}${args ? `, ${args}` : ''});`;
    return `${header}\nconst { data, meta } = await cms.content(${toLiteral(type)}).find(${args});`;
  }
  // Anything else is shown as a typed request, so the snippet always matches what the explorer sends.
  return `// ${isRead(spec) ? 'Typed request' : WRITE_WARNING}
interface MeridianError {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

const response = await ${fetchCall(spec, '', 'process.env.MERIDIAN_API_KEY', [], `\`\${process.env.MERIDIAN_URL}/api/v1${requestPath(spec)}\``)};
if (!response.ok) {
  const { error } = (await response.json()) as MeridianError;
  throw new Error(\`\${error.code}: \${error.message}\`);
}${spec.method === 'DELETE' ? '' : '\nconst result: { data: Record<string, unknown> } = await response.json();'}`;
}

const cautious = (spec: RequestSpec, code: string, comment: (text: string) => string) => (isRead(spec) ? code : `${comment(WRITE_WARNING)}\n${code}`);

/** The current explorer request in nine flavours. */
export function requestSnippets(spec: RequestSpec, apiUrl: string): SnippetItem[] {
  const slash = (text: string) => `// ${text}`;
  const url = `${apiUrl}/api/v1${requestPath(spec)}`;
  const jsonBody = hasBody(spec) ? JSON.stringify(spec.body, null, 2) : '';

  const javascript = `const response = await ${fetchCall(spec, apiUrl, 'process.env.MERIDIAN_API_KEY')};
if (!response.ok) throw new Error(\`Meridian responded \${response.status}\`);${readResult(spec)}`;

  const react = isRead(spec)
    ? `import { useEffect, useState } from 'react';

export function Example() {
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    ${indent(fetchCall(spec, apiUrl, 'import.meta.env.VITE_MERIDIAN_API_KEY', ['signal: controller.signal,']), 4)}
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(\`Meridian responded \${response.status}\`))))
      .then(setResult)
      .catch((err) => err.name !== 'AbortError' && setError(err.message));
    return () => controller.abort();
  }, []);

  if (error) return <p role="alert">{error}</p>;
  return <pre>{JSON.stringify(result, null, 2)}</pre>;
}`
    : `import { useState } from 'react';

export function Example() {
  const [status, setStatus] = useState<number | null>(null);

  async function submit() {
    const response = await ${indent(fetchCall(spec, apiUrl, 'import.meta.env.VITE_MERIDIAN_API_KEY'), 4)};
    setStatus(response.status);
  }

  return <button onClick={submit}>Send{status ? \` (\${status})\` : ''}</button>;
}`;

  const next = isRead(spec)
    ? `// app/example/page.tsx — a server component, so the key never reaches the browser
export default async function Page() {
  const response = await ${indent(fetchCall(spec, apiUrl, 'process.env.MERIDIAN_API_KEY', [`next: { tags: ['${spec.path.split('/').filter(Boolean)[0] ?? 'content'}'] }, // refreshed by your Meridian webhook`]), 2)};
  if (!response.ok) throw new Error(\`Meridian responded \${response.status}\`);
  const result = await response.json();

  return <pre>{JSON.stringify(result, null, 2)}</pre>;
}`
    : `// app/actions.ts — a server action, so the read/write key stays on the server
'use server';

export async function submit() {
  const response = await ${indent(fetchCall(spec, apiUrl, 'process.env.MERIDIAN_API_KEY'), 2)};
  if (!response.ok) throw new Error(\`Meridian responded \${response.status}\`);${spec.method === 'DELETE' ? '' : '\n  return response.json();'}
}`;

  const vue = `<script setup lang="ts">
import { ${isRead(spec) ? 'onMounted, ref' : 'ref'} } from 'vue';

const result = ref<unknown>(null);

${isRead(spec) ? 'onMounted(async () => {' : 'async function submit() {'}
  const response = await ${indent(fetchCall(spec, apiUrl, 'import.meta.env.VITE_MERIDIAN_API_KEY'), 2)};
  result.value = ${spec.method === 'DELETE' ? 'response.status' : 'await response.json()'};
}${isRead(spec) ? ');' : ''}
</script>

<template>
  ${isRead(spec) ? '<pre>{{ result }}</pre>' : '<button @click="submit">Send</button>\n  <pre>{{ result }}</pre>'}
</template>`;

  const angular = `import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../environments/environment';

@Injectable({ providedIn: 'root' })
export class ExampleService {
  private readonly http = inject(HttpClient);

  send() {
    return this.http.request('${spec.method}', '${url}', {
      headers: { Authorization: \`Bearer \${environment.meridianApiKey}\` },${hasBody(spec) ? `\n      body: ${indent(jsonBody, 6)},` : ''}
    });
  }
}`;

  const reactNative = `import { useEffect, useState } from 'react';
import { ${isRead(spec) ? 'ScrollView, Text' : 'Button, Text, View'} } from 'react-native';

export function ExampleScreen() {
  const [result, setResult] = useState<unknown>(null);

  ${isRead(spec) ? 'useEffect(() => {\n    load();\n  }, []);\n\n  async function load() {' : 'async function submit() {'}
    const response = await ${indent(fetchCall(spec, apiUrl, 'process.env.EXPO_PUBLIC_MERIDIAN_API_KEY'), 4)};
    setResult(${spec.method === 'DELETE' ? 'response.status' : 'await response.json()'});
  }

  return ${isRead(spec) ? '(\n    <ScrollView>\n      <Text>{JSON.stringify(result, null, 2)}</Text>\n    </ScrollView>\n  );' : '(\n    <View>\n      <Button title="Send" onPress={submit} />\n      <Text>{JSON.stringify(result)}</Text>\n    </View>\n  );'}
}`;

  const dartMethod = spec.method.toLowerCase();
  const flutter = `import 'dart:convert';
import 'package:http/http.dart' as http;

const apiKey = String.fromEnvironment('MERIDIAN_API_KEY');

Future<${spec.method === 'DELETE' ? 'int' : 'dynamic'}> send() async {
  final response = await http.${dartMethod}(
    Uri.parse('${url.replace(/\$/g, '\\$')}'),
    headers: {
      'Authorization': 'Bearer $apiKey',${hasBody(spec) ? "\n      'Content-Type': 'application/json'," : ''}
    },${hasBody(spec) ? `\n    body: jsonEncode(${indent(jsonBody, 4)}),` : ''}
  );
  if (response.statusCode >= 400) {
    throw Exception('Meridian responded \${response.statusCode}: \${response.body}');
  }
  return ${spec.method === 'DELETE' ? 'response.statusCode' : 'jsonDecode(response.body)'};
}`;

  return [
    { label: 'JavaScript', language: 'javascript', code: cautious(spec, javascript, slash) },
    { label: 'TypeScript (SDK)', language: 'typescript', code: sdkSnippet(spec) },
    { label: 'React', language: 'tsx', code: cautious(spec, react, slash) },
    { label: 'Next.js', language: 'tsx', code: next },
    { label: 'Vue', language: 'vue', code: cautious(spec, vue, (t) => `<!-- ${t} -->`) },
    { label: 'Angular', language: 'typescript', code: cautious(spec, angular, slash) },
    { label: 'React Native', language: 'tsx', code: cautious(spec, reactNative, slash) },
    { label: 'Flutter', language: 'dart', code: cautious(spec, flutter, slash) },
    { label: 'cURL', language: 'bash', code: curlSnippet(spec, apiUrl) },
  ];
}

// ─── GraphQL ─────────────────────────────────────────────────────────────────

const NAME = /^[_A-Za-z][_0-9A-Za-z]*$/;

export interface GraphqlTypeRef {
  apiId: string;
  displayName: string;
  typeName: string;
  /** Query field that lists entries (absent for single types). */
  listField: string | null;
  /** Query field that returns one entry. */
  itemField: string;
  single: boolean;
  fields: { name: string; type: string; description?: string }[];
}

const SYSTEM_GQL_FIELDS = [
  { name: 'id', type: 'ID!' },
  { name: 'locale', type: 'String!' },
  { name: 'status', type: 'String', description: 'Only when reading drafts' },
  { name: 'createdAt', type: 'DateTime' },
  { name: 'updatedAt', type: 'DateTime' },
  { name: 'publishedAt', type: 'DateTime' },
];

/**
 * Describes the auto-generated GraphQL schema for the content model, using the same
 * naming rules as the API (type names from the singular name, query fields from the apiId).
 */
export function describeGraphql(schema: SchemaResponse): GraphqlTypeRef[] {
  const usedTypes = new Set(['Query', 'Mutation', 'Media', 'JSON', 'DateTime', 'Page']);
  const names = new Map<string, string>();
  for (const type of schema.types) {
    if (type.isSystem && type.apiId === PAGE_TYPE_ID) {
      names.set(type.apiId, 'Page');
      continue;
    }
    let name = toPascalCase(type.singularName) || toPascalCase(type.apiId);
    if (!NAME.test(name)) name = `Type${toPascalCase(type.apiId)}`;
    for (let i = 2; usedTypes.has(name); i += 1) name = `${toPascalCase(type.singularName)}${i}`;
    usedTypes.add(name);
    names.set(type.apiId, name);
  }

  const usedFields = new Set<string>();
  const unique = (candidate: string, fallback: string) => {
    let name = NAME.test(candidate) && !usedFields.has(candidate) ? candidate : fallback;
    for (let i = 2; usedFields.has(name); i += 1) name = `${fallback}${i}`;
    usedFields.add(name);
    return name;
  };
  const scalar = (fieldType: string): string => {
    switch (fieldType) {
      case 'integer':
        return 'Int';
      case 'decimal':
      case 'rating':
        return 'Float';
      case 'boolean':
      case 'checkbox':
        return 'Boolean';
      case 'multiselect':
        return '[String!]';
      case 'image':
      case 'video':
      case 'file':
        return 'Media';
      case 'images':
      case 'files':
        return '[Media!]';
      case 'json':
      case 'richtext':
      case 'component':
      case 'repeatable':
      case 'dynamiczone':
      case 'geolocation':
        return 'JSON';
      default:
        return 'String';
    }
  };

  return schema.types.map((type) => {
    const typeName = names.get(type.apiId) as string;
    const page = type.isSystem && type.apiId === PAGE_TYPE_ID;
    const single = type.kind === 'SINGLE';
    const listField = single ? null : unique(camel(type.apiId), `${camel(typeName)}List`);
    const itemField = single ? unique(camel(type.apiId), `${camel(typeName)}Single`) : unique(camel(typeName), `${camel(typeName)}Item`);
    const fields = page
      ? [
          ...SYSTEM_GQL_FIELDS,
          { name: 'title', type: 'String' },
          { name: 'slug', type: 'String' },
          { name: 'path', type: 'String' },
          { name: 'parent', type: 'JSON' },
          { name: 'description', type: 'String' },
          { name: 'template', type: 'String' },
          { name: 'category', type: 'String' },
          { name: 'seo', type: 'JSON' },
          { name: 'blocks', type: 'JSON', description: 'Tree of blocks to render with your own components' },
        ]
      : [
          ...SYSTEM_GQL_FIELDS,
          ...type.fields
            .filter((f) => !f.config.private && f.type !== 'password' && NAME.test(f.apiId))
            .flatMap((f) => {
              if (f.type === 'relation' || f.type === 'relations') {
                const target = names.get(f.config.targetType ?? '');
                return target ? [{ name: f.apiId, type: f.type === 'relation' ? target : `[${target}!]`, description: f.config.helpText }] : [];
              }
              return [{ name: f.apiId, type: scalar(f.type), description: f.config.helpText }];
            }),
        ];
    return { apiId: type.apiId, displayName: type.displayName, typeName, listField, itemField, single, fields };
  });
}

/** A runnable query for the first collection in the project. */
export function starterGraphqlQuery(schema: SchemaResponse | undefined): string {
  if (!schema) return '{\n  __typename\n}';
  const types = describeGraphql(schema);
  const pick = types.find((t) => !t.single && t.apiId !== PAGE_TYPE_ID) ?? types.find((t) => t.apiId === PAGE_TYPE_ID) ?? types[0];
  return pick ? graphqlQueryFor(pick) : '{\n  __typename\n}';
}

/** A runnable query that lists (or, for single types, fetches) one content type. */
export function graphqlQueryFor(pick: GraphqlTypeRef): string {
  const scalars = ['ID!', 'String', 'String!', 'Int', 'Float', 'Boolean', '[String!]', 'JSON', 'DateTime'];
  const chosen = pick.fields.filter((f) => !['locale', 'status', 'createdAt', 'updatedAt', 'blocks', 'seo', 'parent'].includes(f.name)).slice(0, 8);
  const selection = (pad: string) =>
    chosen
      .map((f) => {
        // Object-typed fields need a sub-selection: media exposes its URL, relations their id.
        if (f.type.includes('Media')) return `${pad}${f.name} {\n${pad}  url\n${pad}  alt\n${pad}}`;
        if (!scalars.includes(f.type)) return `${pad}${f.name} {\n${pad}  id\n${pad}}`;
        return `${pad}${f.name}`;
      })
      .join('\n');
  if (pick.single || !pick.listField) return `query {\n  ${pick.itemField} {\n${selection('    ')}\n  }\n}`;
  return `query ${toPascalCase(pick.apiId)}($limit: Int = 5) {\n  ${pick.listField}(limit: $limit, sort: "-publishedAt") {\n    total\n    items {\n${selection('      ')}\n    }\n  }\n}`;
}
