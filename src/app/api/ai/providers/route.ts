import { NextResponse } from 'next/server';
import {
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
  resolveAiProvider,
} from '@/lib/ai-provider';
import { OPENROUTER_AUTO, OPENROUTER_MODELS } from '@/lib/openrouter-models';
import { hasAnthropicApiKey } from '@/server/anthropic';
import { getOpenRouterApiKey } from '@/server/openrouter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function maskKey(key?: string): string | null {
  if (!key) return null;
  if (key.length < 12) return '••••';
  return `${key.slice(0, 10)}…${key.slice(-4)}`;
}

export async function GET() {
  const openRouterKey = getOpenRouterApiKey();
  const claudeKey = process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_API_KEY?.trim();
  return NextResponse.json({
    defaultProvider: resolveAiProvider(null),
    openrouter: {
      configured: Boolean(openRouterKey),
      keyPreview: maskKey(openRouterKey),
      models: OPENROUTER_MODELS,
      auto: OPENROUTER_AUTO,
    },
    claude: {
      configured: hasAnthropicApiKey(),
      keyPreview: maskKey(claudeKey),
      models: CLAUDE_MODELS,
      defaultModel: DEFAULT_CLAUDE_MODEL,
    },
  });
}
