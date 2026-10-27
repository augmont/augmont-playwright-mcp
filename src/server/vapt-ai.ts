import {
  DEFAULT_OPENROUTER_MODEL,
  resolveOpenRouterModelChain,
} from '@/lib/openrouter-models';
import {
  DEFAULT_CLAUDE_MODEL,
  CLAUDE_MODELS,
  normalizeClaudeModelId,
  resolveAiProvider,
  type AiProviderId,
} from '@/lib/ai-provider';
import {
  callOpenRouterChat,
  extractJsonFromModelText,
  getOpenRouterApiKey,
} from '@/server/openrouter';
import {
  callAnthropicChat,
  isAnthropicAuthError,
  requireAnthropicApiKey,
} from '@/server/anthropic';
import { listVaptCases, normalizeVaptCases, VAPT_CHECK_IDS } from '@/server/vapt-store';
import type { VaptCaseIntent, VaptProfile, VaptTestCase } from '@/lib/types';
import { normalizeVaptProfile, vaptProfileHint } from '@/lib/vapt-profile';

export type VaptGenerateIntentMode = VaptCaseIntent | 'both';

const VAPT_SYSTEM_PROMPT = `You are a VAPT (Vulnerability Assessment / Penetration Testing) scenario author for the Augmont LGD Portal.
Return ONLY valid JSON (no markdown fences) matching this schema:

{
  "cases": [
    {
      "id": "vapt-login-main-suite",
      "name": "Login — main VAPT suite (Pass · Higher)",
      "description": "Main login case; attack types are internal scenarios in checks[]",
      "tags": ["vapt", "login", "main", "suite", "pass", "higher"],
      "estimatedMinutes": 8,
      "kind": "vapt",
      "group": "login-main",
      "suiteMode": "combined",
      "vapt": {
        "startUrl": "/login",
        "targetUrl": "/location",
        "method": "POST",
        "headers": { "Content-Type": "application/json" },
        "body": "{\"key\":\"country\"}",
        "useApiBase": true,
        "checks": ["brute-force", "ddos-rate-limit", "sql-injection-surface"],
        "severityGate": "critical" | "high" | "medium" | "low" | "info",
        "intent": "pass" | "fail",
        "profile": "basic" | "advanced" | "higher"
      }
    }
  ]
}

Allowed checks (use only these ids): ${VAPT_CHECK_IDS.join(', ')}

Portal paths (relative to portal baseUrl unless useApiBase is true):
- Always set startUrl to "/login" so MCP evidence begins on the login page
- Prefer API probes with useApiBase=true and targetUrl "/location" (POST) unless the user asks for another path
- Unauth path checks still start MCP on /login; probes may include /buyer, /seller, /admin

PASS vs FAIL cases:
- intent "pass": verify CLEAN / secure posture. Broader check coverage. Name includes "(Pass)". Tags include "pass". Severity gate usually "high". Expect mostly pass findings when controls are good.
- intent "fail": designed to SURFACE hygiene gaps. Focus on checks that commonly fail (api-auth-bypass, api-error-hygiene, security-headers, cookie-flags, info-disclosure, injection-surface, cors-preflight). Name includes "(Fail)". Tags include "fail". Severity gate often "medium" so findings trip the gate. Still passive hygiene only — never invent exploits.

PROFILE (probe depth — must set on every case):
- "basic": baseline catalogue probes only (fewer checks OK, 3–8).
- "advanced": baseline + runtime AI multi-query. Prefer 5–12 checks. Tag "advanced".
- "higher": baseline + AI multi + AI fail-level escalation on clean pass. Prefer full catalogue or 10–20 checks. Tag "higher".

Rules:
- kind must be "vapt".
- Prefer ONE main case per intent unless the user asks for separate suites.
- For intent mode "both": return TWO cases — one pass + one fail (shared target, different intent/checks/gate).
- Do NOT create one case per attack — put attacks as checks on the suite.
- Prefer relative paths.
- startUrl must be "/login" unless the user explicitly asks otherwise.
- useApiBase=true only for API endpoints (targetUrl); MCP still opens startUrl (/login).
- id must start with "vapt-" and be unique kebab-case (include -pass- or -fail- in id when generating pairs).
- Default severityGate to "high" for pass, "medium" for fail unless the user asks otherwise.
- Always set vapt.intent and vapt.profile explicitly.
- Do NOT invent active exploit payloads — probes are passive / hygiene HTTP checks only.
- Catalogue attack ids for internal scenarios: brute-force, ddos-rate-limit, sql-injection-surface, xss-reflection, csrf-surface, rce-surface, command-injection-surface, directory-traversal, file-upload-surface, api-auth-bypass, privilege-escalation, session-hijacking, mitm-tls, ssrf-surface, xxe-surface, deserialization-surface, api-abuse, malware-upload-surface, phishing-credential-surface, zero-day-posture.
- Map user intent to which checks to include (e.g. headers → security-headers; login cookies → cookie-flags; API auth → api-auth-bypass).
`;

export type VaptAiProgressEvent = {
  type: 'status' | 'model_start' | 'model_ok' | 'model_fail' | 'parse_fail';
  message: string;
  model?: string;
  at?: string;
};

function progress(
  onProgress: ((e: VaptAiProgressEvent) => void) | undefined,
  event: VaptAiProgressEvent,
) {
  onProgress?.({ ...event, at: event.at || new Date().toISOString() });
}

function normalizeIntentMode(raw: unknown): VaptGenerateIntentMode {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (s === 'fail' || s === 'negative' || s === 'failure') return 'fail';
  if (s === 'both' || s === 'pass-fail' || s === 'pass_and_fail') return 'both';
  return 'pass';
}

function applyModeDefaults(
  cases: VaptTestCase[],
  intentMode: VaptGenerateIntentMode,
  profile: VaptProfile,
): VaptTestCase[] {
  return cases.map((c, index) => {
    let intent: VaptCaseIntent = c.vapt.intent || 'pass';
    if (intentMode === 'pass') intent = 'pass';
    else if (intentMode === 'fail') intent = 'fail';
    else if (intentMode === 'both') {
      // Prefer model intent; if missing, alternate pass/fail
      intent = c.vapt.intent || (index === 0 ? 'pass' : 'fail');
    }
    const resolvedProfile = normalizeVaptProfile(c.vapt.profile || profile);
    const tags = Array.from(
      new Set([...(c.tags || []), 'vapt', intent, resolvedProfile]),
    );
    const nameHasIntent =
      /\bpass\b/i.test(c.name) || /\bfail\b/i.test(c.name);
    const name = nameHasIntent
      ? c.name
      : `${c.name} (${intent === 'pass' ? 'Pass' : 'Fail'} · ${resolvedProfile === 'basic' ? 'Basic' : resolvedProfile === 'advanced' ? 'Advanced' : 'Higher'})`;
    return {
      ...c,
      name,
      tags,
      vapt: {
        ...c.vapt,
        intent,
        profile: resolvedProfile,
      },
    };
  });
}

export async function generateVaptCases(input: {
  prompt: string;
  baseUrl?: string;
  apiUrl?: string;
  model?: string | null;
  provider?: AiProviderId | string | null;
  openRouterApiKey?: string | null;
  anthropicApiKey?: string | null;
  fileContent?: string | null;
  visitedPaths?: string[] | null;
  /** pass | fail | both */
  intent?: VaptGenerateIntentMode | string | null;
  /** basic | advanced | higher */
  profile?: VaptProfile | string | null;
  onProgress?: (event: VaptAiProgressEvent) => void;
}): Promise<{ cases: VaptTestCase[]; model: string; attempted: string[] }> {
  const provider = resolveAiProvider(input.provider);
  const prompt = (input.prompt || '').trim();
  const fileContent = (input.fileContent || '').trim();
  const visited = (input.visitedPaths || [])
    .map((p) => String(p || '').trim())
    .filter(Boolean);
  if (!prompt && !fileContent && !visited.length) {
    throw new Error('prompt, file content, or visited paths are required');
  }

  const intentMode = normalizeIntentMode(input.intent);
  const profile = normalizeVaptProfile(input.profile);

  if (provider === 'claude') {
    requireAnthropicApiKey(input.anthropicApiKey);
  } else if (!getOpenRouterApiKey(input.openRouterApiKey)) {
    throw new Error(
      'OpenRouter API key missing. Add OPENROUTER_API_KEY to .env.local, or open header → AI setup, paste your OpenRouter key, Save for this tab, then retry.',
    );
  }

  const existing = listVaptCases();
  const existingSummary = existing
    .slice(0, 40)
    .map(
      (c) =>
        `- ${c.id}: ${c.name} · ${c.vapt.method || 'GET'} ${c.vapt.targetUrl} · intent=${c.vapt.intent || 'pass'} · profile=${c.vapt.profile || 'higher'} · checks=${c.vapt.checks.join(',')}`,
    )
    .join('\n');

  const intentInstruction =
    intentMode === 'both'
      ? 'Generate BOTH a pass-case AND a fail-case (exactly 2 cases) for the same target surface.'
      : intentMode === 'fail'
        ? 'Generate FAIL-case suite(s) only (intent "fail") — oriented to surface hygiene gaps.'
        : 'Generate PASS-case suite(s) only (intent "pass") — oriented to verify clean secure posture.';

  const profileInstruction = `Set every case vapt.profile to "${profile}" (${vaptProfileHint(profile)}).`;

  const userParts = [
    input.baseUrl ? `Portal baseUrl: ${input.baseUrl}` : '',
    input.apiUrl ? `API baseUrl: ${input.apiUrl}` : '',
    existingSummary
      ? `Existing VAPT scenarios (avoid exact duplicates):\n${existingSummary}`
      : 'No existing VAPT scenarios yet.',
    `AUTHORING MODE:\n- ${intentInstruction}\n- ${profileInstruction}`,
    visited.length
      ? `MCP-VISITED PATHS (create passive VAPT probe scenarios for these surfaces):\n${visited.map((p) => `- ${p}`).join('\n')}`
      : '',
    fileContent
      ? `UPLOADED FILE CONTENT (normalize into VAPT cases):\n${fileContent.slice(0, 60_000)}`
      : '',
    prompt
      ? `User request for new VAPT test case(s):\n${prompt}`
      : visited.length
        ? 'User request: Create VAPT probe scenarios from the MCP-visited paths above.'
        : 'User request: Normalize the uploaded content into VAPT scenarios.',
  ].filter(Boolean);

  const userContent = userParts.join('\n\n');
  const attempted: string[] = [];
  const errors: string[] = [];

  const finish = (cases: VaptTestCase[], model: string) => {
    const applied = applyModeDefaults(cases, intentMode, profile);
    return { cases: applied, model, attempted };
  };

  if (provider === 'claude') {
    const apiKey = requireAnthropicApiKey(input.anthropicApiKey);
    const primary = normalizeClaudeModelId(
      input.model || process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL,
    );
    const chain = [
      primary,
      ...CLAUDE_MODELS.map((m) => m.id).filter((id) => id !== primary),
    ].slice(0, 3);

    progress(input.onProgress, {
      type: 'status',
      message: `Generating VAPT ${intentMode} · ${profile} · Claude`,
    });

    for (let i = 0; i < chain.length; i++) {
      const modelId = chain[i]!;
      attempted.push(modelId);
      progress(input.onProgress, {
        type: 'model_start',
        model: modelId,
        message: `Thinking with ${modelId} (${i + 1}/${chain.length})…`,
      });
      try {
        const { text, model } = await callAnthropicChat({
          apiKey,
          model: modelId,
          system: VAPT_SYSTEM_PROMPT,
          user: userContent,
          maxTokens: Number(process.env.CLAUDE_MAX_TOKENS || 3500),
        });
        try {
          const data = extractJsonFromModelText(text);
          const cases = normalizeVaptCases(data, 'claude');
          if (!cases.length) throw new Error('No valid VAPT cases in model JSON');
          progress(input.onProgress, {
            type: 'model_ok',
            model,
            message: `Parsed ${cases.length} VAPT case(s) from ${model}`,
          });
          return finish(cases, model);
        } catch (parseErr) {
          const msg = parseErr instanceof Error ? parseErr.message : 'Invalid JSON';
          errors.push(`${modelId}: ${msg}`);
          progress(input.onProgress, {
            type: 'parse_fail',
            model: modelId,
            message: `${modelId} returned invalid JSON — trying next…`,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`${modelId}: ${message}`);
        progress(input.onProgress, {
          type: 'model_fail',
          model: modelId,
          message: `${modelId} failed: ${message}`,
        });
        if (isAnthropicAuthError(message)) break;
      }
    }

    throw new Error(`All Claude models failed.\n${errors.slice(-5).join('\n')}`);
  }

  const apiKey = getOpenRouterApiKey(input.openRouterApiKey)!;
  const chain = resolveOpenRouterModelChain(
    input.model || process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
  ).slice(0, 5);

  progress(input.onProgress, {
    type: 'status',
    message: `Generating VAPT ${intentMode} · ${profile} · OpenRouter`,
  });

  for (let i = 0; i < chain.length; i++) {
    const modelId = chain[i]!;
    attempted.push(modelId);
    progress(input.onProgress, {
      type: 'model_start',
      model: modelId,
      message: `Thinking with ${modelId} (${i + 1}/${chain.length})…`,
    });
    try {
      const { text, model } = await callOpenRouterChat({
        apiKey,
        model: modelId,
        system: VAPT_SYSTEM_PROMPT,
        user: userContent,
        maxTokens: Number(process.env.OPENROUTER_MAX_TOKENS || 3000),
      });
      try {
        const data = extractJsonFromModelText(text);
        const cases = normalizeVaptCases(data, 'claude');
        if (!cases.length) throw new Error('No valid VAPT cases in model JSON');
        progress(input.onProgress, {
          type: 'model_ok',
          model,
          message: `Parsed ${cases.length} VAPT case(s) from ${model}`,
        });
        return finish(cases, model);
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : 'Invalid JSON';
        errors.push(`${modelId}: ${msg}`);
        progress(input.onProgress, {
          type: 'parse_fail',
          model: modelId,
          message: `${modelId} returned invalid JSON — trying next…`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`${modelId}: ${message}`);
      progress(input.onProgress, {
        type: 'model_fail',
        model: modelId,
        message: `${modelId} failed: ${message}`,
      });
    }
  }

  throw new Error(`All OpenRouter models failed.\n${errors.slice(-5).join('\n')}`);
}
