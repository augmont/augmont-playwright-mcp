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
  getAnthropicApiKey,
  isAnthropicAuthError,
  requireAnthropicApiKey,
} from '@/server/anthropic';
import { loadPortalUiGuideExcerpt } from '@/server/portal-ui-guide';
import { formatGuideSelectorsForPrompt } from '@/server/selector-guide-store';
import { summarizeExistingCasesForPrompt } from '@/server/test-case-duplicates';
import type { WebTestCase } from '@/lib/types';

export { getOpenRouterApiKey } from '@/server/openrouter';
export { getAnthropicApiKey } from '@/server/anthropic';

const SYSTEM_PROMPT = `You are a test-case author for the Augmont LGD Portal (Angular SPA).
Return ONLY valid JSON (no markdown fences) matching this schema:

{
  "cases": [
    {
      "id": "kebab-case-suite-id",
      "name": "Short suite name",
      "description": "One sentence covering happy + error paths",
      "tags": ["web", "combined-suite", "..."],
      "estimatedMinutes": 5,
      "role": "public" | "buyer" | "seller" | "admin",
      "suiteMode": "combined",
      "group": "optional folder label",
      "pairId": "same as id",
      "positiveSteps": [
        {
          "id": "step-id",
          "label": "Human label",
          "action": "goto" | "click" | "fill" | "assertVisible" | "assertUrl" | "wait" | "loginRole" | "ensureBuyer",
          "url": "optional relative path or assertUrl substring",
          "selector": "optional CSS",
          "value": "fill text | wait ms | buyer for loginRole/ensureBuyer",
          "text": "visible text for click/assertVisible",
          "timeoutMs": 10000
        }
      ],
      "negativeSteps": [
        { "id": "step-neg-1", "label": "Invalid path step", "action": "fill", "value": "wrong-..." }
      ],
      "steps": []
    }
  ]
}

Portal routes (base is the portal origin, e.g. http://localhost:4200):
- Public: /, /login, /register, /forgot-password, /about-us, /contact-us, /bookademo,
  /terms-and-conditions, /return-policy, /privacy-policy, /disclaimer, /news-insights, /download-app
- Buyer (after ensureBuyer / loginRole buyer): /buyer, /buyer/products, /buyer/cart, /buyer/wishlist
- Product grid cards: Angular host \`app-product-card\` (NOT \`.product-card\`).
- Wishlist (CRITICAL — do not invent .badge):
  - Add: click \`app-product-card i.ph-heart:not(.ph-fill)\` (empty heart). Prefer empty heart only — do not click already-filled hearts.
  - After add: assert \`app-product-card i.ph-fill.ph-heart\` (filled heart on the card).
  - Header control: \`button.wishlist-trigger\` (\`aria-label="Wishlist"\`). Count text is inside \`button.wishlist-trigger .cart-text\` — NEVER use \`button.wishlist-trigger .badge\` (that class does not exist).
  - Open wishlist: click \`button.wishlist-trigger\` or goto \`/buyer/wishlist\`; page title "My Wishlist"; items via \`app-wishlist-item\`.
- Cart header: \`button.cart-trigger\` / \`#cartButton\`; amount also uses \`.cart-text\` (not .badge).
- Add to cart on cards: plain \`<button>\` with visible text "Add to Cart" (no aria-label / .add-to-cart). Prefer click with selector \`app-product-card\` + text \`Add to Cart\`. After add, button shows "Added to Cart". Cart page items: \`app-cart-item\`; remove with trash \`i.ph-trash\` (not heart).
- Prefer selectors that match the portal DOM; use \`||\` to list fallbacks.
  /buyer/orders, /buyer/my-account, /buyer/buyback
- Seller: /seller (auth-guarded — unauthenticated users redirect to /login)
- Admin: /admin, /admin/buyers, /admin/orders (auth-guarded)

Selector preference (highest priority first):
0. **CURATED MCP SELECTORS** / LEARNED SELECTORS from the prompt (human-picked data-id — always prefer these when the control matches)
1. \`[data-testid="…"]\` or \`[data-id="…"]\` from LIVE DOM SNAPSHOT (or suggested-data-id if none yet — put real live selector in \`selector\`)
2. Stable \`#id\` (e.g. #mobileNumber, #email, #cartButton)
3. \`[formControlName="…"]\`
4. Visible button/link text via \`text\` (+ optional CSS \`selector\` root)
5. Semantic CSS / aria-label
6. PrimeNG tags — overlays mount on <body>

The portal often has NO data-testid yet. When LIVE DOM SNAPSHOT lists \`suggested-data-id\`, put the **real** \`selector\` from the snapshot on the step, and also set \`text\` to the visible label. Prefer \`data-testid\` / \`data-id\` whenever the live page already has them.

Rules:
- kind is always web-flow (omit kind; server sets it).
- ALWAYS return ONE combined suite per flow (suiteMode "combined") — NEVER separate Positive and Negative cases.
  - positiveSteps: happy path — valid inputs, success asserts (URL/content/button states).
  - negativeSteps: invalid/unauthorized/error path — wrong password, missing field, blocked action; assert error toast/message or that the user stays on the form / is not granted access.
  - Also set "steps" equal to positiveSteps for compatibility.
  - Single id/name (no -positive/-negative suffixes, no "(Positive)" / "(Negative)" in the name). Tag with "combined-suite".
  - The server merges any legacy pairs into one forked suite automatically.
- Prefer loginRole with value buyer|admin|seller when the user has set credentials in the app header.
- Prefer ensureBuyer only when no buyer credentials are set (signup once per tab).
- Do NOT invent seller signup — use loginRole seller only when seller credentials are provided.
- Keep Lab Grown Diamonds (/buyer/products) and Lab grow non-cert / Melee (/buyer/products/melee) as SEPARATE cases — never combine both catalogs into one case.
- Diamonds catalog: assertVisible "Lab Grown Diamonds", search placeholder "Search with cert number or SKU Id", click "Switch to grid view" then "Switch to table view", assert "Availability" / "Set Filters".
- Non-cert catalog: goto /buyer/products/melee, assert "Lab Grown Melee", search "Search by shape, color, clarity, cut or size", grid/table toggles, "Set Filters".
- Diamonds filters: goto /buyer/products, click "Set Filters", assert "Filters", "Main Filters", "Advanced Filters", "Shapes", "Color", "Carat", "Clarity", "Apply & Find Diamonds", "Reset Filter"; click "Advanced Filters" and assert "Depth", "Table", "L/W Ratio".
- Non-cert filters: /buyer/products/melee + Set Filters → assert "Filters", "Shapes", "Color", "Clarity", "Carat", "Apply & Find Diamonds".
- Tag Diamonds cases with "lgd-diamonds" and non-cert cases with "non-cert".
- Buyer resource tabs: /buyer/resource/overview|setup|markups|shopify-guide|installation-guide|faq.
- Do not invent arbitrary JS or Playwright code — only the step schema above.
- After every goto, include assertUrl (and assertVisible when useful).
- Keep 4–12 steps per case unless the user asks for more.
- Never use id "signup-login" or "signup-all" (reserved — multi-country signup suite).
- For multi-country signup coverage, tell the user to run the built-in Signup & Login suite.
- Base EVERY selector/button label/URL on the PORTAL UI FLOW REFERENCE when provided — do not invent UI elements.
- DUPLICATE RULE: EXISTING TEST CASES are already saved. Reuse the same id only when the user asks for that exact same case. If the prompt is a NEW or DIFFERENT flow (even related), CREATE new case(s) with a new kebab-case id — do NOT return an empty cases array. The server filters true duplicates after you respond.
- Only return {"cases":[]} when the user prompt is empty or impossible to turn into steps.`;

export type AiGenerateResult = {
  data: unknown;
  model: string;
  attempted: string[];
};

export type AiProgressEvent = {
  type: 'status' | 'model_start' | 'model_ok' | 'model_fail' | 'parse_fail' | 'done' | 'error';
  message: string;
  model?: string;
  at?: string;
};

function progress(
  onProgress: ((e: AiProgressEvent) => void) | undefined,
  event: AiProgressEvent,
) {
  onProgress?.({ ...event, at: event.at || new Date().toISOString() });
}

/** Generate / normalize web test cases via OpenRouter or Claude. */
export async function claudeGenerateTestCases(input: {
  prompt: string;
  baseUrl?: string;
  apiUrl?: string;
  mode?: 'generate' | 'upload';
  fileContent?: string;
  /** Specific model id, or "auto" to try free models in order */
  model?: string | null;
  /** openrouter | claude */
  provider?: AiProviderId | string | null;
  role?: 'public' | 'buyer' | 'seller' | 'admin';
  /** Existing store cases — fed to the model to avoid duplicates */
  existingCases?: WebTestCase[];
  /** Include portal UI guide excerpt (selectors / flows) */
  includeUiGuide?: boolean;
  /** Live Playwright DOM scrape of real pages (data-id / selectors) */
  liveDomSnapshot?: string;
  /** When set (MCP click-flow create), force case metadata if the model omits it */
  forceCaseName?: string;
  forceCaseDescription?: string;
  forceCaseTags?: string[];
  /** Client session key (header AI setup) — preferred over server .env */
  openRouterApiKey?: string | null;
  anthropicApiKey?: string | null;
  onProgress?: (event: AiProgressEvent) => void;
}): Promise<AiGenerateResult> {
  const provider = resolveAiProvider(input.provider);

  if (provider === 'claude') {
    requireAnthropicApiKey(input.anthropicApiKey);
  } else {
    if (!getOpenRouterApiKey(input.openRouterApiKey)) {
      throw new Error(
        'OpenRouter API key missing. Add OPENROUTER_API_KEY to .env.local, or open header → AI setup, paste your OpenRouter key, Save for this tab, then retry.',
      );
    }
  }

  const userParts: string[] = [];
  if (input.baseUrl) userParts.push(`Portal URL: ${input.baseUrl}`);
  if (input.apiUrl) userParts.push(`API URL: ${input.apiUrl}`);
  if (input.role) userParts.push(`Target role bucket: ${input.role}`);

  if (input.includeUiGuide !== false && input.mode !== 'upload') {
    progress(input.onProgress, {
      type: 'status',
      message: 'Loading portal UI guide (selectors & flows)…',
    });
    const curated = formatGuideSelectorsForPrompt();
    if (curated) {
      userParts.push(curated);
    }
    const guide = loadPortalUiGuideExcerpt({
      prompt: input.prompt,
      role: input.role,
      maxChars: 16_000,
    });
    userParts.push(
      'PORTAL UI FLOW REFERENCE (selectors, buttons, APIs — use these exactly; LEARNED / MCP-picked selectors override stale docs):',
      guide,
    );
  }

  if (input.liveDomSnapshot?.trim()) {
    const isRecordedFlow = /RECORDED MCP CLICK FLOW/i.test(input.liveDomSnapshot);
    userParts.push(
      isRecordedFlow
        ? 'RECORDED MCP CLICK FLOW + LIVE DOM (user navigated and clicked in MCP view). Convert this capture into accurate steps — preserve click/fill order and selectors:'
        : 'LIVE DOM SNAPSHOT (from internal Playwright browser — REAL page elements). For every click/fill/assertVisible step, copy selector + text from this list. Prefer data-testid / data-id / id / formControlName when present:',
      input.liveDomSnapshot.trim(),
    );
  }

  if (input.forceCaseName?.trim()) {
    userParts.push(
      `FORCE CASE METADATA (use exactly): name="${input.forceCaseName.trim()}"` +
        (input.forceCaseDescription
          ? `; description="${input.forceCaseDescription.trim()}"`
          : '') +
        (input.forceCaseTags?.length
          ? `; tags=${JSON.stringify(input.forceCaseTags)}`
          : '') +
        '. If the user only provided a name, invent a clear description and tags from the recorded flow.',
    );
  }

  if (input.existingCases?.length) {
    const summary = summarizeExistingCasesForPrompt(input.existingCases, {
      role: input.role,
      maxCases: 50,
    });
    userParts.push(
      'EXISTING TEST CASES (already saved — if the user asks for the exact same id/name, omit it; otherwise CREATE new cases for anything not found):',
      summary,
    );
  }

  if (input.mode === 'upload') {
    userParts.push(
      'Parse the uploaded content into one or more web test cases using the schema.',
      'If the content already looks like JSON cases, normalize fields; otherwise invent sensible steps from the description.',
      'If the content is a Python Playwright / pytest-playwright script: map page.goto→goto, locator/click/fill/get_by_*→click|fill, expect().to_be_visible→assertVisible, expect(page).to_have_url→assertUrl, wait_for_timeout→wait. One test_* = one case. Keep real selectors (data-id, CSS).',
      'CRITICAL: Never merge multiple tests into one case. Return separate objects in cases[]. Put the same "group" (suite / file name) on every case from this upload.',
      'Skip any case that matches an EXISTING TEST CASE above.',
      'Uploaded content:',
      input.fileContent || '',
    );
  } else {
    userParts.push('User prompt for new web test case(s):', input.prompt);
  }

  const userContent = userParts.join('\n\n');
  const attempted: string[] = [];
  const errors: string[] = [];

  // —— Claude (Anthropic) path ——
  if (provider === 'claude') {
    const apiKey = requireAnthropicApiKey(input.anthropicApiKey);
    const primary = normalizeClaudeModelId(
      input.model || process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL,
    );
    const chain = [
      primary,
      ...CLAUDE_MODELS.map((m) => m.id).filter((id) => id !== primary),
    ].slice(0, 3);
    const maxTokens = Number(
      process.env.CLAUDE_MAX_TOKENS || (input.mode === 'upload' ? 4500 : 4096),
    );

    progress(input.onProgress, {
      type: 'status',
      message: `Starting AI generate · Claude (${chain.length} model fallbacks)`,
    });

    for (let i = 0; i < chain.length; i++) {
      const modelId = chain[i]!;
      attempted.push(modelId);
      progress(input.onProgress, {
        type: 'model_start',
        model: modelId,
        message: `Thinking with Claude ${modelId} (${i + 1}/${chain.length})…`,
      });
      try {
        const { text, model } = await callAnthropicChat({
          apiKey,
          model: modelId,
          system: SYSTEM_PROMPT,
          user: userContent,
          maxTokens,
        });
        progress(input.onProgress, {
          type: 'status',
          model,
          message: `Response received from ${model} · parsing JSON…`,
        });
        try {
          const data = extractJsonFromModelText(text);
          progress(input.onProgress, {
            type: 'model_ok',
            model,
            message: `Parsed test cases from ${model}`,
          });
          return { data, model, attempted };
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
          message: `${modelId} failed: ${message}${i < chain.length - 1 ? ' — trying next…' : ''}`,
        });
        if (isAnthropicAuthError(message)) break;
      }
    }

    throw new Error(
      `All Claude models failed (${attempted.length} tried).\n${errors.slice(-5).join('\n')}`,
    );
  }

  // —— OpenRouter path ——
  const apiKey = getOpenRouterApiKey(input.openRouterApiKey)!;
  const chainFull = resolveOpenRouterModelChain(
    input.model || process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
  );
  // Upload should not burn the free daily quota — keep the chain short.
  const chain =
    input.mode === 'upload' ? chainFull.slice(0, 4) : chainFull;
  const maxTokens = Number(
    process.env.OPENROUTER_MAX_TOKENS || (input.mode === 'upload' ? 4500 : 3500),
  );

  progress(input.onProgress, {
    type: 'status',
    message: `Starting AI generate · OpenRouter free failover (${chain.length} models)`,
  });

  // Prefer one request with OpenRouter `models` failover (max 3 fallbacks).
  // openrouter/free already auto-routes — do not attach a models[] list.
  const coding = chain.filter((id) => id !== 'openrouter/free');
  const batches: Array<{ primary: string; fallbacks: string[] }> =
    input.mode === 'upload'
      ? [
          {
            primary: chain[0]!,
            fallbacks: chain[0] === 'openrouter/free' ? [] : chain.slice(1, 4),
          },
          ...coding.slice(0, 2).map((primary) => ({
            primary,
            fallbacks: coding.filter((id) => id !== primary).slice(0, 3),
          })),
        ]
      : [
          {
            primary: chain[0]!,
            fallbacks:
              chain[0] === 'openrouter/free' ? [] : chain.slice(1, 4),
          },
          ...coding.slice(0, 3).map((primary) => ({
            primary,
            fallbacks: coding.filter((id) => id !== primary).slice(0, 3),
          })),
        ];

  const seenAttempt = new Set<string>();
  for (let i = 0; i < batches.length; i++) {
    const { primary, fallbacks } = batches[i]!;
    if (seenAttempt.has(primary)) continue;
    seenAttempt.add(primary);
    const label =
      fallbacks.length > 0
        ? `${primary} (+${fallbacks.length} free fallbacks)`
        : primary;
    attempted.push(primary, ...fallbacks.filter((f) => !attempted.includes(f)));
    progress(input.onProgress, {
      type: 'model_start',
      model: primary,
      message: `Thinking with ${label} (${i + 1}/${batches.length})…`,
    });
    try {
      const { text, model } = await callOpenRouterChat({
        apiKey,
        model: primary,
        fallbackModels: fallbacks,
        system: SYSTEM_PROMPT,
        user: userContent,
        maxTokens,
        jsonMode: true,
      });
      progress(input.onProgress, {
        type: 'status',
        model,
        message: `Response received from ${model} · parsing JSON…`,
      });
      try {
        const data = extractJsonFromModelText(text);
        progress(input.onProgress, {
          type: 'model_ok',
          model,
          message: `Parsed test cases from ${model}`,
        });
        return { data, model, attempted };
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : 'Invalid JSON';
        errors.push(`${model}: ${msg}`);
        progress(input.onProgress, {
          type: 'parse_fail',
          model,
          message: `${model} returned invalid JSON — trying next…`,
        });
        continue;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`${primary}: ${message}`);
      progress(input.onProgress, {
        type: 'model_fail',
        model: primary,
        message: `${primary} failed: ${message}${i < batches.length - 1 ? ' — trying next…' : ''}`,
      });
    }
  }

  throw new Error(
    `All OpenRouter models failed (${attempted.length} tried). Free models rotate often — use Auto or openrouter/free, and check OpenRouter rate limits.\n${errors.slice(-5).join('\n')}`,
  );
}

const VALIDATE_SYSTEM = `You are a QA reviewer for Augmont LGD Portal Playwright web-flow test cases.
Return ONLY valid JSON (no markdown fences):

{
  "proper": true | false,
  "score": 0-100,
  "summary": "one sentence verdict",
  "issues": ["problem 1", "..."],
  "suggestions": ["fix or improvement 1", "..."],
  "fixedCase": null | {
    "id": "kebab-case-id",
    "name": "name",
    "description": "description",
    "tags": ["web"],
    "estimatedMinutes": 3,
    "role": "public" | "buyer" | "seller" | "admin",
    "steps": [ { "id", "label", "action", "url?", "selector?", "value?", "text?", "timeoutMs?" } ]
  }
}

Rules:
- Proper means: steps are ordered, selectors/text look realistic, goto has matching assertUrl when useful, auth loginRole/ensureBuyer present when role needs it, no invented nonsense selectors.
- If the EDITABLE FLOW CHART is provided, treat it as the intended flow — check the test case matches it.
- If issues are fixable, put a corrected full case in fixedCase (same name/id/role). Otherwise fixedCase=null.
- score 80+ can be proper:true if only minor nits.`;

export type AiValidateResult = {
  proper: boolean;
  score: number;
  summary: string;
  issues: string[];
  suggestions: string[];
  fixedCase: unknown | null;
  model: string;
  attempted: string[];
};

/** Validate a web test case / flowchart via OpenRouter or Claude. */
export async function claudeValidateTestCase(input: {
  testCase: WebTestCase;
  flowChartPrompt?: string;
  baseUrl?: string;
  apiUrl?: string;
  model?: string | null;
  provider?: AiProviderId | string | null;
  openRouterApiKey?: string | null;
  anthropicApiKey?: string | null;
  onProgress?: (event: AiProgressEvent) => void;
}): Promise<AiValidateResult> {
  const provider = resolveAiProvider(input.provider);

  if (provider === 'claude') {
    requireAnthropicApiKey(input.anthropicApiKey);
  } else {
    if (!getOpenRouterApiKey(input.openRouterApiKey)) {
      throw new Error(
        'OpenRouter API key missing. Add OPENROUTER_API_KEY to .env.local, or open header → AI setup, paste your OpenRouter key, Save for this tab, then retry.',
      );
    }
  }

  const userParts = [
    input.baseUrl ? `Portal URL: ${input.baseUrl}` : '',
    input.apiUrl ? `API URL: ${input.apiUrl}` : '',
    'Validate whether this web test case is proper and executable:',
    JSON.stringify(input.testCase, null, 2),
  ].filter(Boolean);

  if (input.flowChartPrompt?.trim()) {
    userParts.push(input.flowChartPrompt.trim());
    userParts.push(
      'Confirm the test case steps align with the EDITABLE FLOW CHART. If chart and case diverge, prefer the chart and put a fixedCase that matches the chart.',
    );
  }

  const userContent = userParts.join('\n\n');
  const attempted: string[] = [];
  const errors: string[] = [];

  if (provider === 'claude') {
    const modelId = normalizeClaudeModelId(
      input.model || process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL,
    );
    attempted.push(modelId);
    progress(input.onProgress, {
      type: 'status',
      message: `Validating test case · Claude`,
    });
    progress(input.onProgress, {
      type: 'model_start',
      model: modelId,
      message: `Validating with ${modelId}…`,
    });
    const { text, model } = await callAnthropicChat({
      apiKey: requireAnthropicApiKey(input.anthropicApiKey),
      model: modelId,
      system: VALIDATE_SYSTEM,
      user: userContent,
      maxTokens: Number(process.env.CLAUDE_MAX_TOKENS || 3500),
    });
    const parsed = extractJsonFromModelText(text) as Record<string, unknown>;
    return {
      proper: Boolean(parsed.proper),
      score: Number(parsed.score) || 0,
      summary: String(parsed.summary || ''),
      issues: Array.isArray(parsed.issues) ? (parsed.issues as string[]) : [],
      suggestions: Array.isArray(parsed.suggestions)
        ? (parsed.suggestions as string[])
        : [],
      fixedCase: parsed.fixedCase ?? null,
      model,
      attempted,
    };
  }

  const chain = resolveOpenRouterModelChain(
    input.model || process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
  );
  const openRouterKey = getOpenRouterApiKey(input.openRouterApiKey)!;

  progress(input.onProgress, {
    type: 'status',
    message: `Validating test case · OpenRouter free failover`,
  });

  const batches: Array<{ primary: string; fallbacks: string[] }> = [
    {
      primary: chain[0]!,
      fallbacks:
        chain[0] === 'openrouter/free' ? [] : chain.slice(1, 4),
    },
    ...chain
      .filter((id) => id !== 'openrouter/free')
      .slice(0, 3)
      .map((primary) => ({
        primary,
        fallbacks: chain
          .filter((id) => id !== primary && id !== 'openrouter/free')
          .slice(0, 3),
      })),
  ];

  for (const { primary, fallbacks } of batches) {
    attempted.push(primary, ...fallbacks);
    progress(input.onProgress, {
      type: 'model_start',
      model: primary,
      message: `Validating with ${primary}${fallbacks.length ? ` (+${fallbacks.length} fallbacks)` : ''}…`,
    });
    try {
      const { text, model } = await callOpenRouterChat({
        apiKey: openRouterKey,
        model: primary,
        fallbackModels: fallbacks,
        system: VALIDATE_SYSTEM,
        user: userContent,
        maxTokens: Number(process.env.OPENROUTER_MAX_TOKENS || 3500),
      });
      const data = extractJsonFromModelText(text) as {
        proper?: boolean;
        score?: number;
        summary?: string;
        issues?: unknown;
        suggestions?: unknown;
        fixedCase?: unknown;
      };
      progress(input.onProgress, {
        type: 'model_ok',
        model,
        message: `Validation complete via ${model}`,
      });
      return {
        proper: Boolean(data.proper),
        score: typeof data.score === 'number' ? data.score : data.proper ? 80 : 40,
        summary: (data.summary || '').toString() || (data.proper ? 'Looks proper' : 'Needs fixes'),
        issues: Array.isArray(data.issues)
          ? data.issues.map((x) => String(x)).filter(Boolean)
          : [],
        suggestions: Array.isArray(data.suggestions)
          ? data.suggestions.map((x) => String(x)).filter(Boolean)
          : [],
        fixedCase: data.fixedCase ?? null,
        model,
        attempted,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`${primary}: ${message}`);
      progress(input.onProgress, {
        type: 'model_fail',
        model: primary,
        message: `${primary} validate failed: ${message}`,
      });
    }
  }

  throw new Error(
    `All OpenRouter models failed to validate.\n${errors.slice(-5).join('\n')}`,
  );
}
