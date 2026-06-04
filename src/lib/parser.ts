import type { PostmanAuth, PostmanCollection, PostmanItem } from '../types/postman'
import { detectRequestProtocol, type RequestProtocol } from './requestProtocol'

const VARIABLE_REGEX = /\{\{(\w+)\}\}/g

export type { RequestProtocol }

export interface ParsedRequest {
  id: string;
  name: string;
  method: string;
  protocol: RequestProtocol;
  url: string;
  /** Index path through nested Postman item arrays back to the raw collection item. */
  itemPath: number[];
  folderPath: string[];
  auth: string;
  /** Present when Postman auth type is basic (username/password fields). */
  basicAuth?: { username: string; password: string };
  headers: Array<{ key: string; value: string }>;
  bodyRaw?: string;
  hasDescription: boolean;
}

export interface ParsedFolder {
  name: string;
  path: string[];
  requestCount: number;
  requests: ParsedRequest[];
}

export interface ParsedCollection {
  name: string;
  version: string;
  totalRequests: number;
  totalFolders: number;
  methods: Record<string, number>;
  authTypes: Record<string, number>;
  variables: string[];
  definedVariables: string[];
  requests: ParsedRequest[];
  folders: ParsedFolder[];
}

function extractVariables(text: string): string[] {
  const matches = text.match(VARIABLE_REGEX);
  return matches ? [...new Set(matches.map((m) => m.slice(2, -2)))] : [];
}

function getUrlString(url: string | { raw?: string; host?: string[] | string; path?: string[] } | undefined): string {
  if (!url) return '';
  if (typeof url === 'string') return url;
  const raw = url.raw;
  if (raw) return raw;
  const host = Array.isArray(url.host) ? url.host.join('.') : (url.host as string) || '';
  const path = (url.path || []).join('/');
  return `${host}/${path}`;
}

function getAuthType(auth: PostmanAuth | undefined): string {
  if (!auth?.type) return 'noauth';
  const t = auth.type.toLowerCase();
  if (t === 'bearertoken' || t === 'bearer') return 'bearer';
  if (t === 'basic' || t === 'basicauth') return 'basic';
  if (t === 'apikey') return 'apikey';
  if (t === 'oauth1' || t === 'oauth2') return t;
  return t || 'noauth';
}

function getBasicAuthCreds(auth: PostmanAuth | undefined): { username: string; password: string } | undefined {
  if (!auth?.basic?.length) return undefined;
  const username = auth.basic.find((e) => e.key === 'username')?.value ?? '';
  const password = auth.basic.find((e) => e.key === 'password')?.value ?? '';
  if (!username && !password) return undefined;
  return { username, password };
}

function parseItem(
  item: PostmanItem,
  folderPath: string[],
  itemPath: number[],
  acc: {
    requests: ParsedRequest[];
    methods: Record<string, number>;
    authTypes: Record<string, number>;
    variables: Set<string>;
    idCounts: Map<string, number>;
  }
): void {
  if (item.request) {
    const req = item.request;
    const method = (req.method || 'GET').toUpperCase();
    const url = getUrlString(req.url);
    const headers = (req.header || []).filter((h) => !h.disabled).map((h) => ({ key: h.key, value: h.value }));
    const auth = getAuthType(req.auth);
    const basicAuth = auth === 'basic' ? getBasicAuthCreds(req.auth) : undefined;

    const bodyRaw = req.body?.raw ?? req.body?.urlencoded?.map((e) => `${e.key}=${e.value}`).join('&');
    const graphqlQuery = req.body?.graphql?.query;
    const protocol = detectRequestProtocol({
      method,
      url,
      headers: req.header || [],
      bodyMode: req.body?.mode,
      bodyRaw: bodyRaw || graphqlQuery,
      graphqlQuery,
    });

    const allText = [url, headers.map((h) => h.key + h.value).join(''), bodyRaw || graphqlQuery || ''].join(' ');
    const vars = extractVariables(allText);
    vars.forEach((v) => acc.variables.add(v));

    acc.methods[method] = (acc.methods[method] || 0) + 1;
    acc.authTypes[auth] = (acc.authTypes[auth] || 0) + 1;

    const baseId = `${folderPath.join('/')}/${item.name}`.replace(/^\//, '') || item.name;
    const seen = (acc.idCounts.get(baseId) ?? 0) + 1;
    acc.idCounts.set(baseId, seen);
    const id = seen > 1 ? `${baseId}#${seen}` : baseId;

    acc.requests.push({
      id,
      name: item.name,
      method,
      protocol,
      url,
      itemPath,
      folderPath,
      auth,
      basicAuth,
      headers,
      bodyRaw: bodyRaw || undefined,
      hasDescription: !!(req.description && String(req.description).trim()),
    });
  }

  if (item.item) {
    const newPath = [...folderPath, item.name];
    item.item.forEach((child, index) => parseItem(child, newPath, [...itemPath, index], acc));
  }
}

export function parseCollection(json: unknown): ParsedCollection {
  const col = json as PostmanCollection;
  if (!col?.item) throw new Error('Invalid Postman collection format')

  const acc = {
    requests: [] as ParsedRequest[],
    methods: {} as Record<string, number>,
    authTypes: {} as Record<string, number>,
    variables: new Set<string>(),
    idCounts: new Map<string, number>(),
  }

  col.item.forEach((item, index) => parseItem(item, [], [index], acc))

  const definedVariables = (col.variable || []).map((v) => v.key)
  const allVars = [...acc.variables, ...definedVariables]
  const variables = [...new Set(allVars)]

  const folderMap = new Map<string, ParsedFolder>()
  acc.requests.forEach((r) => {
    const pathKey = r.folderPath.join('/')
    const folder = folderMap.get(pathKey) || {
      name: r.folderPath[r.folderPath.length - 1] || 'Root',
      path: r.folderPath,
      requestCount: 0,
      requests: [],
    }
    folder.requestCount++
    folder.requests.push(r)
    folderMap.set(pathKey, folder)
  })

  const rootRequests = acc.requests.filter((r) => r.folderPath.length === 0)
  if (rootRequests.length > 0 && !folderMap.has('')) {
    folderMap.set('', {
      name: 'Root',
      path: [],
      requestCount: rootRequests.length,
      requests: rootRequests,
    })
  }

  const folders = Array.from(folderMap.values()).filter((f) => f.requests.length > 0)

  const schema = col.info?.schema || ''
  const version = schema.includes('2.1') ? '2.1' : schema.includes('2.0') ? '2.0' : '2.1'

  return {
    name: col.info?.name || 'Untitled',
    version,
    totalRequests: acc.requests.length,
    totalFolders: folders.length,
    methods: acc.methods,
    authTypes: acc.authTypes,
    variables,
    definedVariables,
    requests: acc.requests,
    folders,
  }
}
