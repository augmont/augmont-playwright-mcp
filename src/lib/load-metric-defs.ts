/** JMeter-aligned metric & graph definitions shown in the Graphs UI. */

export type LoadDefItem = {
  id: string;
  name: string;
  jmeterListener?: string;
  definition: string;
};

export const LOAD_GRAPH_DEFS: LoadDefItem[] = [
  {
    id: 'hits',
    name: 'Hits / Throughput (RPS)',
    jmeterListener: 'jp@gc - Hits per Second · Aggregate Report Throughput',
    definition:
      'Number of sampler results completed per second. Higher RPS means more traffic handled. Overall RPS uses wall-clock from run start; live charts use ~1s buckets.',
  },
  {
    id: 'response-times',
    name: 'Response times (Avg / Median / p95)',
    jmeterListener: 'Response Times Over Time · Aggregate Report',
    definition:
      'Elapsed time from request start to full response received (JMeter “Elapsed”). Avg is arithmetic mean; Median (p50) is the middle value; p95 / p99 are high-percentile SLA indicators — 95% / 99% of samples were at or below that value.',
  },
  {
    id: 'active-threads',
    name: 'Active threads',
    jmeterListener: 'Active Threads Over Time',
    definition:
      'Concurrent virtual users (allThreads) executing samplers at that moment. Rises during ramp-up, plateaus at configured VUs, then drops at tear-down.',
  },
  {
    id: 'errors',
    name: 'Error %',
    jmeterListener: 'Transactions per Second · Aggregate Report Error %',
    definition:
      'Percentage of samples marked unsuccessful (HTTP error, assertion fail, or connection failure). Keep under your SLA (often ≤1–5%).',
  },
  {
    id: 'kb-s',
    name: 'Network KB/s (received)',
    jmeterListener: 'Bytes Throughput Over Time',
    definition:
      'Received response body bytes per second (KB/s). Shows bandwidth used by the load; useful for large payloads and CDN/API capacity.',
  },
  {
    id: 'kb-sent',
    name: 'Network KB/s (sent)',
    jmeterListener: 'Bytes Throughput Over Time (sent)',
    definition:
      'Request body / uploaded bytes per second. Spikes with large POST/PUT payloads under load.',
  },
  {
    id: 'tps',
    name: 'Transactions per second (OK / KO)',
    jmeterListener: 'Transactions per Second',
    definition:
      'Successful vs failed samples completed each second. Diverging OK and KO lines show when errors start under load.',
  },
  {
    id: 'latency-ttfb',
    name: 'Latency (TTFB)',
    jmeterListener: 'Latencies Over Time',
    definition:
      'Time to first byte (JMeter “Latency” column) — server think time + network until headers arrive. Separate from full Elapsed time.',
  },
  {
    id: 'connect',
    name: 'Connect time',
    jmeterListener: 'Connect Times Over Time',
    definition:
      'TCP / TLS handshake time before the request is sent. Spikes often mean connection pool exhaustion, DNS, or TLS issues.',
  },
  {
    id: 'cumulative',
    name: 'Cumulative samples / errors',
    jmeterListener: 'Aggregate Graph (running totals)',
    definition:
      'Running total of samples and failures from the start of the test. Flat error line = healthy; rising cumulative errors = growing failure rate.',
  },
  {
    id: 'codes-over-time',
    name: 'Response codes over time',
    jmeterListener: 'Response Codes Per Second',
    definition:
      'Per-second counts of 2xx / 4xx / 5xx (and other). Sudden 5xx growth usually means server overload; 4xx often means client/auth/validation issues under load.',
  },
  {
    id: 'distribution',
    name: 'Response time distribution',
    jmeterListener: 'Response Time Distribution · Response Times Percentiles',
    definition:
      'Histogram of how many samples fell into each latency bucket. A long right tail means occasional slow outliers even if averages look fine.',
  },
  {
    id: 'codes-bar',
    name: 'HTTP status codes',
    jmeterListener: 'Response Codes',
    definition:
      'Total count of each HTTP status (and non-HTTP failure codes) across the whole run.',
  },
  {
    id: 'errors-tree',
    name: 'Failed samples',
    jmeterListener: 'View Results Tree (errors)',
    definition:
      'Recent failed samples with label, URL, status, and failure message. Download the full JTL for every sample.',
  },
];

export const LOAD_TABLE_COLUMN_DEFS: LoadDefItem[] = [
  {
    id: 'label',
    name: 'Label',
    jmeterListener: 'Aggregate / Summary Report',
    definition: 'Sampler name (HTTP Request label) as generated in the .jmx plan.',
  },
  {
    id: 'samples',
    name: '# Samples',
    definition: 'Total number of results for this label (successful + failed).',
  },
  {
    id: 'avg',
    name: 'Average',
    definition: 'Mean elapsed response time in milliseconds.',
  },
  {
    id: 'median',
    name: 'Median',
    definition: '50th percentile (p50) — half of samples were faster than this.',
  },
  {
    id: 'min-max',
    name: 'Min / Max',
    definition: 'Fastest and slowest elapsed times observed for this label.',
  },
  {
    id: 'stddev',
    name: 'Std. Dev.',
    definition:
      'Standard deviation of elapsed times — how spread out responses are. High stddev means inconsistent performance.',
  },
  {
    id: 'pct',
    name: 'p90 / p95 / p99',
    definition:
      'Percentiles: e.g. p95 = 95% of samples finished in at most this many ms. Prefer these over Avg for SLAs.',
  },
  {
    id: 'error-pct',
    name: 'Error %',
    definition: '(Failed samples / samples) × 100 for this label.',
  },
  {
    id: 'throughput',
    name: 'Throughput',
    definition:
      'Requests per second for this label over the test wall-clock (JMeter Aggregate “Throughput”).',
  },
  {
    id: 'received',
    name: 'Received / Sent KB/s · KB · Avg Bytes',
    definition:
      'Downloaded and uploaded payload rates and totals (JMeter Received/Sent KB/sec). Avg Bytes is mean response size per sample.',
  },
];

export const LOAD_SUMMARY_METRIC_DEFS: LoadDefItem[] = [
  {
    id: 'engine',
    name: 'Engine',
    definition: 'Apache JMeter CLI drives HTTP load; optional MCP browser for portal view.',
  },
  {
    id: 'vus',
    name: 'Virtual users / Threads',
    definition:
      'Configured concurrency (Thread Group). “Active” / peak threads come from JTL allThreads.',
  },
  {
    id: 'sla',
    name: 'Thresholds / Grade',
    definition:
      'Pass/fail vs your max error % and latency ceilings (p50–p99, avg). Grade summarizes release readiness.',
  },
];
