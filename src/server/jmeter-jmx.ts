import { writeFileSync } from 'fs';
import type { WebLoadConfig, WebLoadHttpMethod } from '@/lib/types';

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseUrl(targetUrl: string): {
  protocol: string;
  domain: string;
  port: string;
  path: string;
} {
  const u = new URL(targetUrl);
  const protocol = u.protocol.replace(':', '') || 'http';
  const port =
    u.port ||
    (protocol === 'https' ? '443' : protocol === 'http' ? '80' : '');
  return {
    protocol,
    domain: u.hostname,
    port,
    path: `${u.pathname}${u.search}` || '/',
  };
}

export type ResolvedLoadSampler = {
  name: string;
  url: string;
  method: WebLoadHttpMethod;
  headers?: Record<string, string>;
  body?: string;
  thinkTimeMs?: number;
  extractJson?: {
    varName: string;
    jsonPath: string;
    defaultValue?: string;
  };
};

function headerManagerXml(headers: Record<string, string> | undefined): string {
  const entries = Object.entries(headers || {});
  const headerXml = entries
    .map(
      ([name, value]) => `
          <elementProp name="" elementType="Header">
            <stringProp name="Header.name">${xmlEscape(name)}</stringProp>
            <stringProp name="Header.value">${xmlEscape(value)}</stringProp>
          </elementProp>`,
    )
    .join('');
  return `
          <HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="HTTP Headers" enabled="true">
            <collectionProp name="HeaderManager.headers">${headerXml}
            </collectionProp>
          </HeaderManager>
          <hashTree/>`;
}

function samplerXml(s: ResolvedLoadSampler): string {
  const { protocol, domain, port, path } = parseUrl(s.url);
  const method = s.method || 'GET';
  const body = s.body || '';
  const hasBody = Boolean(body) && !['GET', 'HEAD'].includes(method);
  const bodyXml = hasBody
    ? `
        <boolProp name="HTTPSampler.postBodyRaw">true</boolProp>
        <elementProp name="HTTPsampler.Arguments" elementType="Arguments">
          <collectionProp name="Arguments.arguments">
            <elementProp name="" elementType="HTTPArgument">
              <boolProp name="HTTPArgument.always_encode">false</boolProp>
              <stringProp name="Argument.value">${xmlEscape(body)}</stringProp>
              <stringProp name="Argument.metadata">=</stringProp>
            </elementProp>
          </collectionProp>
        </elementProp>`
    : `
        <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" enabled="true">
          <collectionProp name="Arguments.arguments"/>
        </elementProp>`;

  // ConstantTimer as sibling AFTER the sampler = think time before the next request
  const thinkAfter =
    s.thinkTimeMs && s.thinkTimeMs > 0
      ? `
        <ConstantTimer guiclass="ConstantTimerGui" testclass="ConstantTimer" testname="Think ${s.thinkTimeMs}ms" enabled="true">
          <stringProp name="ConstantTimer.delay">${Math.round(s.thinkTimeMs)}</stringProp>
        </ConstantTimer>
        <hashTree/>`
      : '';

  const extract = s.extractJson
    ? `
          <JSONPostProcessor guiclass="JSONPostProcessorGui" testclass="JSONPostProcessor" testname="Extract ${xmlEscape(s.extractJson.varName)}" enabled="true">
            <stringProp name="JSONPostProcessor.referenceNames">${xmlEscape(s.extractJson.varName)}</stringProp>
            <stringProp name="JSONPostProcessor.jsonPathExprs">${xmlEscape(s.extractJson.jsonPath)}</stringProp>
            <stringProp name="JSONPostProcessor.match_numbers">1</stringProp>
            <stringProp name="JSONPostProcessor.defaultValues">${xmlEscape(s.extractJson.defaultValue || 'NOT_FOUND')}</stringProp>
          </JSONPostProcessor>
          <hashTree/>`
    : '';

  return `
        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${xmlEscape(s.name)}" enabled="true">
          <stringProp name="HTTPSampler.domain">${xmlEscape(domain)}</stringProp>
          <stringProp name="HTTPSampler.port">${xmlEscape(port)}</stringProp>
          <stringProp name="HTTPSampler.protocol">${xmlEscape(protocol)}</stringProp>
          <stringProp name="HTTPSampler.path">${xmlEscape(path)}</stringProp>
          <stringProp name="HTTPSampler.method">${xmlEscape(method)}</stringProp>
          <boolProp name="HTTPSampler.follow_redirects">true</boolProp>
          <boolProp name="HTTPSampler.auto_redirects">false</boolProp>
          <boolProp name="HTTPSampler.use_keepalive">true</boolProp>
          <boolProp name="HTTPSampler.DO_MULTIPART_POST">false</boolProp>
          <stringProp name="HTTPSampler.connect_timeout">10000</stringProp>
          <stringProp name="HTTPSampler.response_timeout">30000</stringProp>
          ${bodyXml}
        </HTTPSamplerProxy>
        <hashTree>
          ${headerManagerXml(s.headers)}
          ${extract}
        </hashTree>${thinkAfter}`;
}

/**
 * Build a JMeter 5.x test plan (.jmx) for one or more HTTP samplers + Thread Group.
 */
export function buildHttpLoadJmx(opts: {
  name: string;
  targetUrl: string;
  load: WebLoadConfig;
  /** When provided, multi-request advanced plan; otherwise single primary target */
  samplers?: ResolvedLoadSampler[];
}): string {
  const threads = Math.max(1, opts.load.virtualUsers);
  const ramp = Math.max(0, opts.load.rampUpSec);
  const duration = Math.max(1, opts.load.durationSec);

  const samplers: ResolvedLoadSampler[] =
    opts.samplers && opts.samplers.length
      ? opts.samplers
      : [
          {
            name: `${opts.load.method || 'GET'} ${(() => {
              try {
                return new URL(opts.targetUrl).pathname || '/';
              } catch {
                return opts.load.targetUrl;
              }
            })()}`,
            url: opts.targetUrl,
            method: opts.load.method || 'GET',
            headers: opts.load.headers,
            body: opts.load.body,
          },
        ];

  const samplersXml = samplers.map(samplerXml).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="${xmlEscape(opts.name)}" enabled="true">
      <stringProp name="TestPlan.comments">Generated by LGD Playwright MCP web-load</stringProp>
      <boolProp name="TestPlan.functional_mode">false</boolProp>
      <boolProp name="TestPlan.serialize_threadgroups">false</boolProp>
      <elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments" enabled="true">
        <collectionProp name="Arguments.arguments"/>
      </elementProp>
    </TestPlan>
    <hashTree>
      <CookieManager guiclass="CookiePanel" testclass="CookieManager" testname="HTTP Cookie Manager" enabled="true">
        <collectionProp name="CookieManager.cookies"/>
        <boolProp name="CookieManager.clearEachIteration">true</boolProp>
        <boolProp name="CookieManager.controlledByThreadGroup">false</boolProp>
      </CookieManager>
      <hashTree/>
      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Load VUs" enabled="true">
        <stringProp name="ThreadGroup.on_sample_error">continue</stringProp>
        <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" enabled="true">
          <boolProp name="LoopController.continue_forever">true</boolProp>
          <intProp name="LoopController.loops">-1</intProp>
        </elementProp>
        <stringProp name="ThreadGroup.num_threads">${threads}</stringProp>
        <stringProp name="ThreadGroup.ramp_time">${ramp}</stringProp>
        <boolProp name="ThreadGroup.scheduler">true</boolProp>
        <stringProp name="ThreadGroup.duration">${duration}</stringProp>
        <stringProp name="ThreadGroup.delay">0</stringProp>
        <boolProp name="ThreadGroup.same_user_on_next_iteration">true</boolProp>
      </ThreadGroup>
      <hashTree>
${samplersXml}
        <ResultCollector guiclass="SimpleDataWriter" testclass="ResultCollector" testname="Write results" enabled="true">
          <boolProp name="ResultCollector.error_logging">false</boolProp>
          <objProp>
            <name>saveConfig</name>
            <value class="SampleSaveConfiguration">
              <time>true</time>
              <latency>true</latency>
              <timestamp>true</timestamp>
              <success>true</success>
              <label>true</label>
              <code>true</code>
              <message>true</message>
              <threadName>true</threadName>
              <dataType>true</dataType>
              <encoding>false</encoding>
              <assertions>true</assertions>
              <subresults>false</subresults>
              <responseData>false</responseData>
              <samplerData>false</samplerData>
              <xml>false</xml>
              <fieldNames>true</fieldNames>
              <responseHeaders>false</responseHeaders>
              <requestHeaders>false</requestHeaders>
              <responseDataOnError>false</responseDataOnError>
              <saveAssertionResultsFailureMessage>true</saveAssertionResultsFailureMessage>
              <assertionsResultsToSave>0</assertionsResultsToSave>
              <bytes>true</bytes>
              <sentBytes>true</sentBytes>
              <url>true</url>
              <threadCounts>true</threadCounts>
              <idleTime>true</idleTime>
              <connectTime>true</connectTime>
            </value>
          </objProp>
          <stringProp name="filename"></stringProp>
        </ResultCollector>
        <hashTree/>
      </hashTree>
    </hashTree>
  </hashTree>
</jmeterTestPlan>
`;
}

export function writeHttpLoadJmx(
  filePath: string,
  opts: {
    name: string;
    targetUrl: string;
    load: WebLoadConfig;
    samplers?: ResolvedLoadSampler[];
  },
): void {
  writeFileSync(filePath, buildHttpLoadJmx(opts), 'utf8');
}
