import type { WebLoadRequestStep } from '@/lib/types';
import { applyParamsToPath } from '@/lib/load-request-params';
import { ensureLgdApiV1Base } from '@/lib/api-url';
import { resolveOutgoingBody } from '@/lib/load-request-body';

export type RequestExportFormat =
  | 'curl'
  | 'http'
  | 'js-fetch'
  | 'js-axios'
  | 'node-fetch'
  | 'node-axios'
  | 'node-http'
  | 'python-requests'
  | 'python-http'
  | 'go'
  | 'java-okhttp'
  | 'php-curl'
  | 'csharp'
  | 'ruby'
  | 'httpie';

export const REQUEST_EXPORT_FORMATS: Array<{
  id: RequestExportFormat;
  label: string;
  group: string;
  ext: string;
}> = [
  { id: 'curl', label: 'cURL', group: 'Shell', ext: 'sh' },
  { id: 'httpie', label: 'HTTPie', group: 'Shell', ext: 'sh' },
  { id: 'http', label: 'HTTP', group: 'Raw', ext: 'http' },
  { id: 'js-fetch', label: 'JavaScript — Fetch', group: 'JavaScript', ext: 'js' },
  { id: 'js-axios', label: 'JavaScript — Axios', group: 'JavaScript', ext: 'js' },
  { id: 'node-fetch', label: 'Node.js — Fetch', group: 'Node.js', ext: 'js' },
  { id: 'node-axios', label: 'Node.js — Axios', group: 'Node.js', ext: 'js' },
  { id: 'node-http', label: 'Node.js — http', group: 'Node.js', ext: 'js' },
  { id: 'python-requests', label: 'Python — requests', group: 'Python', ext: 'py' },
  { id: 'python-http', label: 'Python — http.client', group: 'Python', ext: 'py' },
  { id: 'go', label: 'Go — net/http', group: 'Go', ext: 'go' },
  { id: 'java-okhttp', label: 'Java — OkHttp', group: 'Java', ext: 'java' },
  { id: 'csharp', label: 'C# — HttpClient', group: 'C#', ext: 'cs' },
  { id: 'php-curl', label: 'PHP — cURL', group: 'PHP', ext: 'php' },
  { id: 'ruby', label: 'Ruby — Net::HTTP', group: 'Ruby', ext: 'rb' },
];

export type ResolvedExportRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
};

function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function jsString(s: string): string {
  return JSON.stringify(s);
}

function resolveFullUrl(
  step: WebLoadRequestStep,
  apiBaseUrl?: string,
): string {
  const path = applyParamsToPath(step);
  if (/^https?:\/\//i.test(path)) return path;
  const base = ensureLgdApiV1Base(apiBaseUrl || '').replace(/\/+$/, '');
  if (!base) return path.startsWith('/') ? path : `/${path}`;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function resolveExportRequest(
  step: WebLoadRequestStep,
  apiBaseUrl?: string,
): ResolvedExportRequest {
  const method = (step.method || 'GET').toUpperCase();
  const outgoing = resolveOutgoingBody(step);
  const url = resolveFullUrl(step, apiBaseUrl);
  const headers = { ...outgoing.headers };
  // Prefer displayable utf8 bodies for codegen; skip binary blobs
  const body =
    outgoing.bodyEncoding === 'base64'
      ? undefined
      : outgoing.body || undefined;
  return { method, url, headers, body };
}

function headerLines(headers: Record<string, string>, indent = ''): string {
  return Object.entries(headers)
    .map(([k, v]) => `${indent}${k}: ${v}`)
    .join('\n');
}

function genCurl(r: ResolvedExportRequest): string {
  const parts = [`curl --location ${shellSingleQuote(r.url)}`];
  if (r.method !== 'GET') {
    parts.push(`  --request ${r.method}`);
  }
  for (const [k, v] of Object.entries(r.headers)) {
    parts.push(`  --header ${shellSingleQuote(`${k}: ${v}`)}`);
  }
  if (r.body) {
    parts.push(`  --data-raw ${shellSingleQuote(r.body)}`);
  }
  return parts.join(' \\\n');
}

function genHttpie(r: ResolvedExportRequest): string {
  const parts = [`http ${r.method} ${shellSingleQuote(r.url)}`];
  for (const [k, v] of Object.entries(r.headers)) {
    parts.push(`${k}:${shellSingleQuote(v)}`);
  }
  if (r.body) {
    parts.push(`<<< ${shellSingleQuote(r.body)}`);
  }
  return parts.join(' \\\n  ');
}

function genHttp(r: ResolvedExportRequest): string {
  let path = '/';
  try {
    const u = new URL(r.url);
    path = `${u.pathname}${u.search}` || '/';
    return [
      `${r.method} ${path} HTTP/1.1`,
      `Host: ${u.host}`,
      ...Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`),
      '',
      r.body || '',
    ].join('\n');
  } catch {
    return [`${r.method} ${r.url}`, headerLines(r.headers), '', r.body || ''].join(
      '\n',
    );
  }
}

function genJsFetch(r: ResolvedExportRequest, opts?: { node?: boolean }): string {
  const headerObj = Object.entries(r.headers)
    .map(([k, v]) => `    ${jsString(k)}: ${jsString(v)}`)
    .join(',\n');
  const bodyLine = r.body
    ? `,\n  body: ${jsString(r.body)}`
    : '';
  const preamble = opts?.node
    ? `// Node.js 18+ (global fetch)\n`
    : '';
  return `${preamble}const response = await fetch(${jsString(r.url)}, {
  method: ${jsString(r.method)},
  headers: {
${headerObj || '    // (no headers)'}
  }${bodyLine}
});

const data = await response.json();
console.log(response.status, data);`;
}

function genJsAxios(r: ResolvedExportRequest, opts?: { node?: boolean }): string {
  const headerObj = Object.entries(r.headers)
    .map(([k, v]) => `    ${jsString(k)}: ${jsString(v)}`)
    .join(',\n');
  const bodyLine = r.body ? `,\n  data: ${jsString(r.body)}` : '';
  const importLine = opts?.node
    ? `import axios from 'axios';\n\n`
    : `// Requires: npm i axios (or CDN)\n`;
  return `${importLine}const { data, status } = await axios({
  method: ${jsString(r.method.toLowerCase())},
  url: ${jsString(r.url)},
  headers: {
${headerObj || '    // (no headers)'}
  }${bodyLine}
});

console.log(status, data);`;
}

function genNodeHttp(r: ResolvedExportRequest): string {
  let u: URL;
  try {
    u = new URL(r.url);
  } catch {
    return `// Invalid URL: ${r.url}`;
  }
  const lib = u.protocol === 'https:' ? 'https' : 'http';
  const headerObj = Object.entries(r.headers)
    .map(([k, v]) => `    ${jsString(k)}: ${jsString(v)}`)
    .join(',\n');
  return `import ${lib} from '${lib}';

const body = ${r.body ? jsString(r.body) : 'undefined'};

const req = ${lib}.request(
  {
    hostname: ${jsString(u.hostname)},
    port: ${u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80},
    path: ${jsString(`${u.pathname}${u.search}` || '/')},
    method: ${jsString(r.method)},
    headers: {
${headerObj || '      // (no headers)'}
      ${r.body ? `,\n      'Content-Length': Buffer.byteLength(body)` : ''}
    },
  },
  (res) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => console.log(res.statusCode, data));
  },
);

req.on('error', console.error);
${r.body ? 'req.write(body);' : ''}
req.end();`;
}

function genPythonRequests(r: ResolvedExportRequest): string {
  const headerObj = Object.entries(r.headers)
    .map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(',\n');
  const bodyArg = r.body
    ? `,\n    data=${JSON.stringify(r.body)}`
    : '';
  return `import requests

response = requests.request(
    ${JSON.stringify(r.method)},
    ${JSON.stringify(r.url)},
    headers={
${headerObj || '        # (no headers)'}
    }${bodyArg}
)

print(response.status_code)
print(response.text)`;
}

function genPythonHttp(r: ResolvedExportRequest): string {
  let u: URL;
  try {
    u = new URL(r.url);
  } catch {
    return `# Invalid URL: ${r.url}`;
  }
  const headerObj = Object.entries(r.headers)
    .map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(',\n');
  const mod = u.protocol === 'https:' ? 'http.client.HTTPSConnection' : 'http.client.HTTPConnection';
  return `import http.client

conn = ${mod}(${JSON.stringify(u.hostname)}${u.port ? `, ${u.port}` : ''})
payload = ${r.body ? JSON.stringify(r.body) : '""'}
headers = {
${headerObj || '    # (no headers)'}
}
conn.request(${JSON.stringify(r.method)}, ${JSON.stringify(`${u.pathname}${u.search}` || '/')}, payload, headers)
res = conn.getresponse()
print(res.status)
print(res.read().decode())`;
}

function genGo(r: ResolvedExportRequest): string {
  const headerLinesGo = Object.entries(r.headers)
    .map(
      ([k, v]) =>
        `\treq.Header.Set(${JSON.stringify(k)}, ${JSON.stringify(v)})`,
    )
    .join('\n');
  return `package main

import (
\t"fmt"
\t"io"
\t"net/http"
\t"strings"
)

func main() {
\tpayload := strings.NewReader(${r.body ? JSON.stringify(r.body) : `""`})
\treq, err := http.NewRequest(${JSON.stringify(r.method)}, ${JSON.stringify(r.url)}, payload)
\tif err != nil {
\t\tpanic(err)
\t}
${headerLinesGo || '\t// (no headers)'}
\tres, err := http.DefaultClient.Do(req)
\tif err != nil {
\t\tpanic(err)
\t}
\tdefer res.Body.Close()
\tbody, _ := io.ReadAll(res.Body)
\tfmt.Println(res.Status)
\tfmt.Println(string(body))
}`;
}

function genJavaOkHttp(r: ResolvedExportRequest): string {
  const headerLinesJ = Object.entries(r.headers)
    .map(
      ([k, v]) =>
        `      .addHeader(${JSON.stringify(k)}, ${JSON.stringify(v)})`,
    )
    .join('\n');
  return `OkHttpClient client = new OkHttpClient().newBuilder().build();
MediaType mediaType = MediaType.parse(${JSON.stringify(
    r.headers['Content-Type'] || r.headers['content-type'] || 'text/plain',
  )});
RequestBody body = RequestBody.create(mediaType, ${r.body ? JSON.stringify(r.body) : '""'});
Request request = new Request.Builder()
      .url(${JSON.stringify(r.url)})
      .method(${JSON.stringify(r.method)}, ${r.body ? 'body' : 'null'})
${headerLinesJ || '      // (no headers)'}
      .build();
Response response = client.newCall(request).execute();`;
}

function genCsharp(r: ResolvedExportRequest): string {
  const headerLinesCs = Object.entries(r.headers)
    .filter(([k]) => k.toLowerCase() !== 'content-type')
    .map(
      ([k, v]) =>
        `client.DefaultRequestHeaders.TryAddWithoutValidation(${JSON.stringify(k)}, ${JSON.stringify(v)});`,
    )
    .join('\n');
  const ct =
    r.headers['Content-Type'] || r.headers['content-type'] || 'application/json';
  return `using var client = new HttpClient();
${headerLinesCs || '// (no extra headers)'}
using var content = new StringContent(${r.body ? JSON.stringify(r.body) : '""'}, System.Text.Encoding.UTF8, ${JSON.stringify(ct)});
var response = await client.${r.method === 'GET' ? 'GetAsync' : 'SendAsync'}(
${
  r.method === 'GET'
    ? `    ${JSON.stringify(r.url)}`
    : `    new HttpRequestMessage(new HttpMethod(${JSON.stringify(r.method)}), ${JSON.stringify(r.url)}) { Content = content }`
}
);
var result = await response.Content.ReadAsStringAsync();
Console.WriteLine((int)response.StatusCode);
Console.WriteLine(result);`;
}

function genPhpCurl(r: ResolvedExportRequest): string {
  const headerArr = Object.entries(r.headers)
    .map(([k, v]) => `  ${JSON.stringify(`${k}: ${v}`)}`)
    .join(',\n');
  return `<?php
$curl = curl_init();
curl_setopt_array($curl, [
  CURLOPT_URL => ${JSON.stringify(r.url)},
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_CUSTOMREQUEST => ${JSON.stringify(r.method)},
  CURLOPT_HTTPHEADER => [
${headerArr || '    // (no headers)'}
  ]${r.body ? `,\n  CURLOPT_POSTFIELDS => ${JSON.stringify(r.body)}` : ''}
]);
$response = curl_exec($curl);
$err = curl_error($curl);
curl_close($curl);
if ($err) {
  echo "cURL Error #: " . $err;
} else {
  echo $response;
}`;
}

function genRuby(r: ResolvedExportRequest): string {
  let u: URL;
  try {
    u = new URL(r.url);
  } catch {
    return `# Invalid URL: ${r.url}`;
  }
  const headerRuby = Object.entries(r.headers)
    .map(([k, v]) => `request[${JSON.stringify(k)}] = ${JSON.stringify(v)}`)
    .join('\n');
  const klass =
    (
      {
        GET: 'Get',
        POST: 'Post',
        PUT: 'Put',
        PATCH: 'Patch',
        DELETE: 'Delete',
        HEAD: 'Head',
      } as Record<string, string>
    )[r.method] || 'Post';
  return `require 'net/http'
require 'uri'

uri = URI.parse(${JSON.stringify(r.url)})
http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = (uri.scheme == 'https')

request = Net::HTTP::${klass}.new(uri)
${headerRuby || '# (no headers)'}
${r.body ? `request.body = ${JSON.stringify(r.body)}` : ''}

response = http.request(request)
puts response.code
puts response.body`;
}

export function exportRequestCode(
  format: RequestExportFormat,
  step: WebLoadRequestStep,
  apiBaseUrl?: string,
): string {
  const r = resolveExportRequest(step, apiBaseUrl);
  switch (format) {
    case 'curl':
      return genCurl(r);
    case 'httpie':
      return genHttpie(r);
    case 'http':
      return genHttp(r);
    case 'js-fetch':
      return genJsFetch(r);
    case 'js-axios':
      return genJsAxios(r);
    case 'node-fetch':
      return genJsFetch(r, { node: true });
    case 'node-axios':
      return genJsAxios(r, { node: true });
    case 'node-http':
      return genNodeHttp(r);
    case 'python-requests':
      return genPythonRequests(r);
    case 'python-http':
      return genPythonHttp(r);
    case 'go':
      return genGo(r);
    case 'java-okhttp':
      return genJavaOkHttp(r);
    case 'csharp':
      return genCsharp(r);
    case 'php-curl':
      return genPhpCurl(r);
    case 'ruby':
      return genRuby(r);
    default:
      return genCurl(r);
  }
}

export function downloadExportFile(
  filename: string,
  content: string,
  mime = 'text/plain;charset=utf-8',
) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
