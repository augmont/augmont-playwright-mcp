import type { ReportAiSummary, ReportCodeSnippet, RunReport, TestStep } from '@/lib/types';
import {
  callOpenRouterWithFallback,
  extractJsonFromModelText,
  getOpenRouterApiKey,
} from '@/server/openrouter';

const REPORT_SUMMARY_SYSTEM = `You are a senior QA engineer and frontend developer writing study guides for Augmont LGD Portal Playwright test reports.

Return ONLY valid JSON (no markdown fences) matching:
{
  "headline": "short status line",
  "narrative": "2-4 sentences elaborating pass or fail for developers and testers",
  "whyFailed": "required on failure: root-cause style explanation of WHY it failed (not just the raw error)",
  "rootCause": "optional one-line technical root cause",
  "developerActions": ["actionable fix steps for developers"],
  "preventionActions": ["optional: how to prevent this class of bug / attack"],
  "testerActions": ["how testers should document / re-test"],
  "studyNotes": "what teammates should learn from this run",
  "codeSnippets": [
    {
      "title": "short title",
      "language": "typescript" | "javascript" | "bash" | "text",
      "code": "short helpful snippet (Playwright locator, assert, curl, or fix hint)",
      "why": "why this snippet helps"
    }
  ]
}

Rules:
- On SUCCESS: explain what the suite proved, list 1-3 Playwright-style reference snippets that mirror the happy path (useful as a living guide), leave whyFailed empty or omit.
- On FAILURE: explain WHY it failed (timeout vs missing UI vs wrong URL vs auth vs API), map to likely product vs test issue, include 1-3 debug/fix snippets (locator, expect, screenshot assert).
- Keep code snippets short (4-12 lines). Use Playwright TypeScript style matching this project's steps (getByText, goto, expect URL).
- Be concrete: mention step labels, portal paths, and error keywords from the payload.
- Do not invent secrets or credentials.`;

const VAPT_SUMMARY_SYSTEM = `You are a senior AppSec / API security engineer writing VAPT remediation & prevention guides for Augmont LGD Portal API security probe reports.

Return ONLY valid JSON (no markdown fences) matching:
{
  "headline": "short security status line",
  "narrative": "2-4 sentences: what the probes found and business risk",
  "whyFailed": "required when findings failed: which attacks/checks failed and why it matters (OWASP/CWE oriented)",
  "rootCause": "optional one-line technical root cause",
  "developerActions": ["immediate fix steps for each failed finding"],
  "preventionActions": ["how to PREVENT this attack class next time — controls, gates, config, reviews"],
  "testerActions": ["how security/QA should re-test and evidence the fix"],
  "studyNotes": "what the team should learn about preventing similar issues",
  "codeSnippets": [
    {
      "title": "short title",
      "language": "typescript" | "javascript" | "bash" | "nginx" | "text",
      "code": "short hardening snippet (headers, auth guard, validation, curl retest)",
      "why": "why this prevents the issue"
    }
  ]
}

Rules:
- This is API VAPT (HTTP probes), NOT a UI crawl. Focus on auth, CORS, headers, cookies, error hygiene, method tamper, injection-surface hygiene.
- Always populate preventionActions with 4–8 concrete preventions (WAF/rate-limit, auth middleware, CSP/HSTS, parameterized queries, 405 for bad methods, generic 4xx errors, SameSite cookies, TLS redirect, least-privilege routes).
- Map findings to OWASP Top 10 / CWE when present in the payload.
- Include 1–3 hardening snippets (Express/Next middleware, nginx headers, curl re-check) — NOT active exploit payloads.
- Do not invent secrets or credentials.`;

function compactSteps(steps: TestStep[]) {
  return steps.slice(0, 40).map((s) => ({
    id: s.id,
    label: s.label,
    status: s.status,
    description: s.description,
    message: s.message,
    detail: s.detail,
    hasScreenshot: Boolean(s.screenshotPath),
  }));
}

function inferFailHints(msg: string): string[] {
  const hints: string[] = [];
  if (/timeout/i.test(msg)) {
    tipsTimeout(hints);
  }
  if (/strict mode/i.test(msg)) {
    hints.push('Multiple elements matched — tighten the locator (role + name, or a unique CSS).');
  }
  if (/net::|ERR_|ECONNREFUSED/i.test(msg)) {
    hints.push('Portal/API may be down or the base URL is wrong — confirm localhost:4200 / API is up.');
  }
  if (/redirect|login/i.test(msg)) {
    hints.push('Possible auth/session issue — ensure buyer/admin credentials and that the session survived navigation.');
  }
  if (!hints.length) {
    hints.push('Compare the failure screenshot with the expected UI; decide if the product changed or the step is stale.');
  }
  return hints;
}

function hintsFromVapt(title: string): string {
  if (/header/i.test(title)) return 'Missing or weak security response headers';
  if (/cookie/i.test(title)) return 'Cookie security flags incomplete';
  if (/tls|https/i.test(title)) return 'Transport / URL scheme inconsistency';
  if (/admin|buyer|unauth/i.test(title)) return 'Sensitive path exposure without auth';
  if (/cors/i.test(title)) return 'Permissive CORS configuration';
  if (/auth|unauthenticated/i.test(title)) return 'Missing API authentication / authorization';
  if (/method/i.test(title)) return 'HTTP method allow-list too wide';
  if (/injection|reflect|stack|malformed/i.test(title)) return 'Weak input validation / error hygiene';
  return 'Security probe failed severity gate';
}

function preventionTipsForFinding(f: {
  checkId?: string;
  category?: string;
  title?: string;
  recommendation?: string;
}): string[] {
  const tips: string[] = [];
  const key = `${f.checkId || ''} ${f.category || ''} ${f.title || ''}`.toLowerCase();
  if (f.recommendation) tips.push(f.recommendation);

  if (/security-headers|csp|x-frame|hsts|content-security/i.test(key)) {
    tips.push(
      'Set baseline headers at the reverse proxy / CDN: CSP, HSTS (HTTPS), X-Frame-Options or frame-ancestors, X-Content-Type-Options: nosniff, Referrer-Policy.',
    );
    tips.push('Add a CI check that fails merges when required security headers are missing on public routes.');
  }
  if (/cookie|session/i.test(key)) {
    tips.push(
      'Issue session cookies with HttpOnly; Secure; SameSite=Lax (or Strict). Prefer short idle timeouts and rotate session IDs on login.',
    );
  }
  if (/tls|https|transport/i.test(key)) {
    tips.push('Force HTTPS at the edge (301 HTTP→HTTPS) and enable HSTS only after HTTPS is stable.');
  }
  if (/unauth|access-control|admin|buyer/i.test(key)) {
    tips.push(
      'Protect /admin, /buyer, /seller with auth middleware; deny by default and redirect anonymous users to /login.',
    );
  }
  if (/cors/i.test(key)) {
    tips.push(
      'Allow CORS only for known portal origins; never use Access-Control-Allow-Origin: * with credentials.',
    );
  }
  if (/api-auth|auth-bypass|auth\b/i.test(key)) {
    tips.push(
      'Require Bearer/session auth on all sensitive APIs; return 401 when credentials are missing and 403 when role is insufficient.',
    );
  }
  if (/method-tamper|method/i.test(key)) {
    tips.push(
      'Explicitly allow listed HTTP methods per route; respond with 405 Method Not Allowed for TRACE/PUT/DELETE if unused.',
    );
  }
  if (/error-hygiene|info-disclosure|stack|malformed/i.test(key)) {
    tips.push(
      'Validate JSON early; map parse errors to generic 400 responses; never return stack traces or SQL text to clients.',
    );
  }
  if (/injection/i.test(key)) {
    tips.push(
      'Use parameterized queries / ORM bindings; encode outputs; treat all client fields as untrusted (defense in depth).',
    );
  }
  if (/api-location|api\b/i.test(key)) {
    tips.push(
      'Centralize API error handlers and request validation (schema) so every endpoint shares the same safe error shape.',
    );
  }

  // de-dupe while preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tips) {
    const k = t.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t.trim());
  }
  return out;
}

function buildVaptPreventionActions(
  findings: Array<{
    status: string;
    checkId?: string;
    category?: string;
    title?: string;
    recommendation?: string;
  }>,
): string[] {
  const failed = findings.filter((f) => f.status === 'fail' || f.status === 'error');
  const source = failed.length ? failed : findings;
  const tips: string[] = [];
  for (const f of source.slice(0, 12)) {
    tips.push(...preventionTipsForFinding(f));
  }
  tips.push(
    'Re-run the same VAPT case in CI/staging after each fix; keep severityGate at high (or stricter) before release.',
  );
  tips.push(
    'Track each failed finding as a security ticket with owner, OWASP/CWE, evidence screenshot, and retest proof.',
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tips) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= 10) break;
  }
  return out;
}

function buildVaptSnippets(report: RunReport): ReportCodeSnippet[] {
  const target = report.vaptFindings?.targetUrl || report.apiUrl || report.baseUrl || 'https://api.example';
  const fails = (report.vaptFindings?.findings || []).filter(
    (f) => f.status === 'fail' || f.status === 'error',
  );
  const snippets: ReportCodeSnippet[] = [
    {
      title: 'Retest API probe with curl',
      language: 'bash',
      code: [
        `curl -i -X POST '${target}' \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -d '{}'`,
        `# Expect: 401/403 when unauth, never stack traces, no * CORS.`,
      ].join('\n'),
      why: 'Quickly verify remediation on the same endpoint the VAPT case hit.',
    },
  ];
  if (fails.some((f) => /header|csp|hsts/i.test(`${f.checkId} ${f.title}`))) {
    snippets.push({
      title: 'Baseline security headers (Express/Next middleware sketch)',
      language: 'typescript',
      code: [
        `res.setHeader('Content-Security-Policy', "default-src 'self'");`,
        `res.setHeader('X-Frame-Options', 'DENY');`,
        `res.setHeader('X-Content-Type-Options', 'nosniff');`,
        `res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');`,
        `// On HTTPS only:`,
        `res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');`,
      ].join('\n'),
      why: 'Prevents clickjacking, MIME sniffing, and weak transport signals flagged by security-headers probes.',
    });
  }
  if (fails.some((f) => /auth|unauth|access/i.test(`${f.checkId} ${f.category} ${f.title}`))) {
    snippets.push({
      title: 'Deny-by-default API auth guard',
      language: 'typescript',
      code: [
        `export function requireAuth(req, res, next) {`,
        `  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });`,
        `  return next();`,
        `}`,
        `// app.use('/api', requireAuth);`,
      ].join('\n'),
      why: 'Stops unauthenticated acceptance (api-auth-bypass / unauth-sensitive class findings).',
    });
  }
  if (fails.some((f) => /injection|error-hygiene|stack/i.test(`${f.checkId} ${f.title}`))) {
    snippets.push({
      title: 'Safe JSON error shape (no stack leak)',
      language: 'typescript',
      code: [
        `app.use((err, _req, res, _next) => {`,
        `  console.error(err); // server-side only`,
        `  res.status(err.status || 400).json({ error: 'Bad request' });`,
        `});`,
      ].join('\n'),
      why: 'Prevents info-disclosure / api-error-hygiene failures from verbose exception bodies.',
    });
  }
  return snippets.slice(0, 3);
}

function tipsTimeout(hints: string[]) {
  hints.push(
    'Timed out waiting for UI — element missing, slow load, wrong page, or text/selector changed.',
  );
}

function buildLocalSnippets(report: RunReport, failed: TestStep[]): ReportCodeSnippet[] {
  const base = report.baseUrl || 'http://localhost:4200';
  if (!failed.length) {
    const passed = (report.steps || []).filter((s) => s.status === 'passed').slice(0, 2);
    const snippets: ReportCodeSnippet[] = [
      {
        title: 'Happy-path navigation check',
        language: 'typescript',
        code: [
          `await page.goto('${base}');`,
          `await expect(page).toHaveURL(/\\/buyer|\\/login|\\//);`,
          `// Re-run this suite after UI changes as a regression baseline.`,
        ].join('\n'),
        why: 'Documents the portal entry point this suite relies on.',
      },
    ];
    for (const step of passed) {
      if (/goto|open|url/i.test(step.label) || /Opened |URL matches/i.test(step.message || '')) {
        snippets.push({
          title: `Reference: ${step.label}`,
          language: 'typescript',
          code: [
            `// ${step.label}`,
            `// Observed: ${step.message || 'passed'}`,
            `await expect(page.getByText(/expected visible copy/i)).toBeVisible();`,
          ].join('\n'),
          why: 'Passed step — keep as expected behaviour for developers studying this flow.',
        });
        break;
      }
    }
    return snippets.slice(0, 3);
  }

  const f = failed[0]!;
  const err = f.message || report.error || 'Step failed';
  return [
    {
      title: 'Reproduce the failed assertion',
      language: 'typescript',
      code: [
        `// Failed step: ${f.label}`,
        `// Error: ${err.slice(0, 160)}`,
        `await page.screenshot({ path: 'debug-${f.id}.png', fullPage: true });`,
        `await expect(page.getByText(/${(f.label.match(/[A-Za-z0-9 /%]+/)?.[0] || 'target').trim().slice(0, 40)}/i)).toBeVisible({ timeout: 10000 });`,
      ].join('\n'),
      why: 'Capture UI state and re-assert the same condition the suite expected.',
    },
    {
      title: 'Debug locator uniqueness',
      language: 'typescript',
      code: [
        `const loc = page.getByText(/Main Filters|Set Filters|Continue/i);`,
        `console.log('matches', await loc.count());`,
        `await expect(loc.first()).toBeVisible();`,
      ].join('\n'),
      why: 'Timeouts and strict-mode errors often mean zero or many matches.',
    },
    {
      title: 'Confirm URL before asserting UI',
      language: 'typescript',
      code: [
        `console.log('url', page.url());`,
        `await expect(page).toHaveURL(/buyer\\/products|login/);`,
      ].join('\n'),
      why: 'Many false failures happen on the wrong route after auth redirect.',
    },
  ];
}

/** Deterministic elaborate summary (always available; used when AI is off/fails). */
export function buildLocalReportAiSummary(report: RunReport): ReportAiSummary {
  const steps = report.steps || [];
  const failed = steps.filter((s) => s.status === 'failed');
  const passed = steps.filter((s) => s.status === 'passed').length;
  const skipped = steps.filter((s) => s.status === 'skipped').length;
  const isFail = report.status === 'failed' || failed.length > 0;
  const codeSnippets = buildLocalSnippets(report, failed);
  const vapt = report.vaptFindings;

  if (vapt) {
    const fails = (vapt.findings || []).filter((f) => f.status === 'fail' || f.status === 'error');
    const remediations = fails
      .map((f) => f.recommendation)
      .filter(Boolean)
      .slice(0, 6) as string[];
    const preventionActions = buildVaptPreventionActions(vapt.findings || []);
    const vaptSnippets = buildVaptSnippets(report);

    if (!fails.length && !isFail) {
      return {
        headline: `VAPT PASS — ${report.testName}`,
        narrative: [
          `Security probes completed with ${vapt.passed} pass / ${vapt.failed} fail / ${vapt.info} info across ${vapt.checked} checks.`,
          vapt.targetUrl ? `Target: ${vapt.targetUrl}.` : '',
          'Baseline OWASP-oriented API/web smoke passed — keep controls in place to prevent regressions.',
        ]
          .filter(Boolean)
          .join(' '),
        developerActions: [
          'Keep required security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options) on all public responses.',
          'Keep auth middleware on sensitive APIs; return 401/403 for anonymous callers.',
          'Re-run VAPT after deploying auth, cookie, CORS, or API gateway changes.',
        ],
        preventionActions: [
          ...preventionActions.slice(0, 6),
          'Document allowed origins, methods, and auth schemes in an API security checklist for each release.',
        ].slice(0, 10),
        testerActions: [
          'Attach the PDF findings + prevention section as evidence in the release checklist.',
          'Re-run the same VAPT case against staging after config changes.',
        ],
        studyNotes:
          'Pass evidence shows the “good” baseline. Study preventionActions so the team knows how to keep attacks blocked after future changes.',
        codeSnippets: vaptSnippets,
        model: 'local-template',
      };
    }

    const top = fails[0];
    return {
      headline: `VAPT ${isFail || fails.length ? 'FINDINGS' : 'REVIEW'} — ${report.testName}`,
      narrative: [
        `VAPT run recorded ${vapt.failed} fail / ${vapt.passed} pass / ${vapt.info} info (${vapt.checked} checks).`,
        top
          ? `Highest-signal issue: "${top.title}" (${top.severity}) — ${top.evidence || top.recommendation || ''}`.trim()
          : report.error || 'Review findings table for details.',
        'Use Developer actions for immediate fixes and How to prevent for lasting controls.',
      ].join(' '),
      whyFailed: fails.length
        ? fails
            .slice(0, 5)
            .map(
              (f) =>
                `[${f.severity}] ${f.title}${f.recommendation ? ` — Fix: ${f.recommendation}` : ''}`,
            )
            .join(' ')
        : undefined,
      rootCause: top?.category || hintsFromVapt(top?.title || ''),
      developerActions: remediations.length
        ? remediations
        : [
            'Prioritize failed findings at high/critical severity before release.',
            'Fix headers, cookie flags, TLS redirects, auth gates, or API error hygiene as listed.',
          ],
      preventionActions,
      testerActions: [
        'Copy severity, OWASP/CWE, evidence, prevention bullets, and screenshot into the security ticket.',
        'Re-test the same VAPT case after fixes; severityGate must stay clear.',
        'Verify network payloads no longer show the weak response pattern (open CORS, 200 unauth, stack traces).',
      ],
      studyNotes:
        'Failed VAPT findings are remediation + prevention tickets — not UI flakes. Map each finding to an owner (app / infra / API) and track the prevention control that stops regression.',
      codeSnippets: vaptSnippets,
      model: 'local-template',
    };
  }

  if (!isFail) {
    return {
      headline: `SUCCESS — ${report.testName}`,
      narrative: [
        `All executed steps passed (${passed} passed, ${skipped} skipped).`,
        report.testDescription
          ? `This suite validates: ${report.testDescription}`
          : 'This suite is a healthy regression baseline for the portal flow.',
        'Developers should treat pass messages as the expected UI/API behaviour.',
        'Testers can re-run after releases and compare step timing and messages with this report.',
      ].join(' '),
      developerActions: [
        'Keep this report as a living guide of the happy path.',
        'When changing selectors or routes, update matching web-flow steps and re-run.',
        'Use the code snippets below as Playwright reference for onboarding.',
      ],
      testerActions: [
        'Archive or share the PDF as evidence of a green run.',
        'Re-run after UI/API changes; any new failure is a regression signal.',
      ],
      studyNotes:
        'Study the full step log: each passed step shows what the product did. New team members can walk the same path in the portal.',
      codeSnippets,
      model: 'local-template',
    };
  }

  const first = failed[0];
  const err = first?.message || report.error || 'Unknown failure';
  const hints = inferFailHints(err);

  return {
    headline: `FAILURE — ${first?.label || report.testName}`,
    narrative: [
      `The run stopped because "${first?.label || 'a step'}" failed.`,
      `Observed error: ${err}`,
      passed > 0
        ? `${passed} earlier step(s) passed — those areas are still healthy; focus on the failed step and screenshot.`
        : 'No steps passed before the failure — check boot, auth, or portal availability first.',
      skipped > 0 ? `${skipped} later step(s) were skipped after the failure.` : '',
    ]
      .filter(Boolean)
      .join(' '),
    whyFailed: [
      `Why it failed: ${hints.join(' ')}`,
      first?.description ? `Step purpose was: ${first.description}` : '',
      first?.detail || '',
    ]
      .filter(Boolean)
      .join(' '),
    rootCause: hints[0],
    developerActions: [
      'Open the failure screenshot in this report and compare with the expected UI.',
      'Fix the product bug or update the step locator/URL/text, then re-run the same test id.',
      'Use the code snippets below to reproduce and harden the assertion.',
    ],
    testerActions: [
      'File a bug with: Run ID, step label, error message, screenshot, portal URL, and this PDF.',
      'Mark severity based on whether earlier steps passed (partial flow still works).',
      'Re-test the same case after the fix lands.',
    ],
    studyNotes:
      'Failed reports are study material: read whyFailed, then the failed step Purpose/Result/Notes, then the screenshot.',
    codeSnippets,
    model: 'local-template',
  };
}

function normalizeAiSummary(raw: unknown, fallback: ReportAiSummary): ReportAiSummary {
  if (!raw || typeof raw !== 'object') return fallback;
  const o = raw as Record<string, unknown>;
  const snippetsRaw = Array.isArray(o.codeSnippets) ? o.codeSnippets : [];
  const codeSnippets: ReportCodeSnippet[] = snippetsRaw
    .map((s) => {
      if (!s || typeof s !== 'object') return null;
      const sn = s as Record<string, unknown>;
      const code = typeof sn.code === 'string' ? sn.code.trim() : '';
      if (!code) return null;
      return {
        title: String(sn.title || 'Code tip'),
        language: String(sn.language || 'typescript'),
        code: code.slice(0, 1200),
        why: String(sn.why || ''),
      };
    })
    .filter(Boolean) as ReportCodeSnippet[];

  return {
    headline: String(o.headline || fallback.headline),
    narrative: String(o.narrative || fallback.narrative),
    whyFailed: o.whyFailed != null ? String(o.whyFailed) : fallback.whyFailed,
    rootCause: o.rootCause != null ? String(o.rootCause) : fallback.rootCause,
    developerActions: Array.isArray(o.developerActions)
      ? o.developerActions.map(String).slice(0, 8)
      : fallback.developerActions,
    preventionActions: Array.isArray(o.preventionActions)
      ? o.preventionActions.map(String).slice(0, 10)
      : fallback.preventionActions,
    testerActions: Array.isArray(o.testerActions)
      ? o.testerActions.map(String).slice(0, 8)
      : fallback.testerActions,
    studyNotes: o.studyNotes != null ? String(o.studyNotes) : fallback.studyNotes,
    codeSnippets: codeSnippets.length ? codeSnippets : fallback.codeSnippets,
    model: fallback.model,
  };
}

/**
 * Elaborate pass/fail summary via free OpenRouter models (GPT-OSS / Qwen3 / …),
 * with a rich local fallback when AI is unavailable.
 */
export async function enrichReportWithAiSummary(report: RunReport): Promise<RunReport> {
  const local = buildLocalReportAiSummary(report);
  const guidanceFromSummary = [
    local.headline,
    local.narrative,
    local.whyFailed,
    local.preventionActions?.length
      ? `How to prevent: ${local.preventionActions.join(' ')}`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (!getOpenRouterApiKey()) {
    return {
      ...report,
      guidance: report.guidance || guidanceFromSummary,
      aiSummary: local,
    };
  }

  try {
    const failed = (report.steps || []).filter((s) => s.status === 'failed');
    const user = [
      `Test: ${report.testName} (${report.testId})`,
      report.testDescription ? `Description: ${report.testDescription}` : '',
      `Status: ${report.status}`,
      `Role: ${report.role || 'n/a'}`,
      `Portal: ${report.baseUrl}`,
      report.apiUrl ? `API: ${report.apiUrl}` : '',
      `DurationMs: ${report.durationMs ?? 'n/a'}`,
      `Counts: ${JSON.stringify(report.stepCounts)}`,
      report.error ? `Primary error: ${report.error}` : '',
      `Failed steps: ${JSON.stringify(compactSteps(failed))}`,
      `All steps (compact): ${JSON.stringify(compactSteps(report.steps || []))}`,
      `API errors: ${JSON.stringify((report.apiErrors || []).slice(0, 8))}`,
      report.vaptFindings
        ? `VAPT findings: ${JSON.stringify({
            checked: report.vaptFindings.checked,
            passed: report.vaptFindings.passed,
            failed: report.vaptFindings.failed,
            info: report.vaptFindings.info,
            bySeverity: report.vaptFindings.bySeverity,
            findings: report.vaptFindings.findings?.slice(0, 20),
            networkSample: report.vaptFindings.networkCaptures?.slice(0, 8),
          })}`
        : '',
      report.vaptFindings
        ? 'This is an API VAPT report. Emphasize: (1) why each attack finding matters, (2) immediate fixes in developerActions, (3) lasting how-to-prevent controls in preventionActions, (4) hardening code snippets, (5) retest guidance for QA.'
        : 'Write an elaborate developer/tester study summary with code snippets.',
    ]
      .filter(Boolean)
      .join('\n');

    const { text, model } = await callOpenRouterWithFallback({
      system: report.vaptFindings ? VAPT_SUMMARY_SYSTEM : REPORT_SUMMARY_SYSTEM,
      user,
      // Prefer coding-capable free models first (list order in openrouter-models)
      preferredModel: process.env.OPENROUTER_REPORT_MODEL || 'auto',
      temperature: 0.25,
      maxTokens: Number(process.env.OPENROUTER_REPORT_MAX_TOKENS || 2200),
    });

    const parsed = extractJsonFromModelText(text);
    const aiSummary = normalizeAiSummary(parsed, { ...local, model });
    aiSummary.model = model;

    const guidance = [
      aiSummary.headline,
      aiSummary.narrative,
      aiSummary.whyFailed,
      aiSummary.preventionActions?.length
        ? `How to prevent: ${aiSummary.preventionActions.join(' ')}`
        : '',
    ]
      .filter(Boolean)
      .join(' ');

    return {
      ...report,
      guidance,
      aiSummary,
    };
  } catch (err) {
    console.warn(
      '[report-ai] summary failed, using local template:',
      err instanceof Error ? err.message : err,
    );
    return {
      ...report,
      guidance: report.guidance || guidanceFromSummary,
      aiSummary: local,
    };
  }
}
