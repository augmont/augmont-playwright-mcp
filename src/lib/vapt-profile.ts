import type { VaptProfile } from '@/lib/types';

/** Normalize profile string; default higher (full multi → fail-level). */
export function normalizeVaptProfile(raw: unknown): VaptProfile {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (s === 'basic') return 'basic';
  if (s === 'advanced') return 'advanced';
  if (s === 'higher' || s === 'high' || s === 'fail-level') return 'higher';
  return 'higher';
}

export function vaptProfileLabel(profile: VaptProfile | undefined): string {
  const p = normalizeVaptProfile(profile);
  if (p === 'basic') return 'Basic';
  if (p === 'advanced') return 'Advanced';
  return 'Higher';
}

export function vaptProfileHint(profile: VaptProfile | undefined): string {
  const p = normalizeVaptProfile(profile);
  if (p === 'basic') return 'Baseline catalogue probes only';
  if (p === 'advanced') return 'Baseline → AI multi-query';
  return 'Baseline → AI multi → fail-level on pass';
}

/** Whether runtime AI multi-query should run for this profile. */
export function vaptProfileUsesAiMulti(profile: VaptProfile | undefined): boolean {
  const p = normalizeVaptProfile(profile);
  return p === 'advanced' || p === 'higher';
}

/** Whether AI fail-level escalation on clean pass should run. */
export function vaptProfileUsesFailLevel(profile: VaptProfile | undefined): boolean {
  return normalizeVaptProfile(profile) === 'higher';
}
