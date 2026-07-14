'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_API_URL, suggestApiUrl } from '@/lib/api-url';
import type { AiProviderId } from '@/lib/ai-provider';

export type TestMode = 'web' | 'mobile' | 'web-load' | 'vapt';
export type MobilePlatform = 'android' | 'ios';

interface AppStore {
  _hasHydrated: boolean;
  testMode: TestMode | null;
  baseUrl: string;
  apiUrl: string;
  mobilePlatform: MobilePlatform | null;
  appDriveUrl: string;
  appiumUrl: string;
  osVersion: string;
  deviceVersion: string;
  /** Active AI backend for generate / upload / validate */
  aiProvider: AiProviderId;
  openRouterEnabled: boolean;
  claudeEnabled: boolean;
  setHasHydrated: (value: boolean) => void;
  setTestMode: (mode: TestMode) => void;
  setBaseUrl: (url: string) => void;
  setApiUrl: (url: string) => void;
  setUrls: (baseUrl: string, apiUrl: string) => void;
  setWebLoadUrls: (baseUrl: string, apiUrl?: string) => void;
  setVaptUrls: (baseUrl: string, apiUrl?: string) => void;
  clearUrls: () => void;
  setMobilePlatform: (platform: MobilePlatform) => void;
  setMobileSetup: (appDriveUrl: string, appiumUrl: string, apiUrl?: string) => void;
  setMobileVersions: (osVersion: string, deviceVersion: string) => void;
  clearMobile: () => void;
  setAiProvider: (provider: AiProviderId) => void;
  setOpenRouterEnabled: (enabled: boolean) => void;
  setClaudeEnabled: (enabled: boolean) => void;
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      _hasHydrated: false,
      testMode: null,
      baseUrl: '',
      apiUrl: '',
      mobilePlatform: null,
      appDriveUrl: '',
      appiumUrl: '',
      osVersion: '',
      deviceVersion: '',
      aiProvider:
        process.env.NEXT_PUBLIC_AI_PROVIDER === 'claude' ? 'claude' : 'openrouter',
      openRouterEnabled: process.env.NEXT_PUBLIC_AI_PROVIDER !== 'claude',
      claudeEnabled: process.env.NEXT_PUBLIC_AI_PROVIDER === 'claude',
      setHasHydrated: (value) => set({ _hasHydrated: value }),
      setTestMode: (mode) => set({ testMode: mode }),
      setBaseUrl: (url) => {
        const baseUrl = normalizeUrl(url);
        set((state) => ({
          testMode: state.testMode || 'web',
          baseUrl,
          apiUrl: state.apiUrl || suggestApiUrl(baseUrl),
        }));
      },
      setApiUrl: (url) => set({ apiUrl: normalizeUrl(url) }),
      setUrls: (baseUrl, apiUrl) =>
        set({
          testMode: 'web',
          baseUrl: normalizeUrl(baseUrl),
          apiUrl: normalizeUrl(apiUrl),
        }),
      setWebLoadUrls: (baseUrl, apiUrl) =>
        set((state) => ({
          testMode: 'web-load',
          baseUrl: normalizeUrl(baseUrl),
          apiUrl: normalizeUrl(apiUrl || state.apiUrl || suggestApiUrl(baseUrl)),
        })),
      setVaptUrls: (baseUrl, apiUrl) =>
        set((state) => ({
          testMode: 'vapt',
          baseUrl: normalizeUrl(baseUrl),
          apiUrl: normalizeUrl(apiUrl || state.apiUrl || suggestApiUrl(baseUrl)),
        })),
      clearUrls: () => set({ baseUrl: '', apiUrl: '' }),
      setMobilePlatform: (platform) =>
        set((state) => ({
          testMode: 'mobile',
          mobilePlatform: platform,
          osVersion: state.mobilePlatform === platform ? state.osVersion : '',
          deviceVersion: state.mobilePlatform === platform ? state.deviceVersion : '',
        })),
      setMobileSetup: (appDriveUrl, appiumUrl, apiUrl) =>
        set((state) => ({
          testMode: 'mobile',
          appDriveUrl: appDriveUrl.trim(),
          appiumUrl: normalizeUrl(appiumUrl),
          apiUrl: normalizeUrl(apiUrl || state.apiUrl || DEFAULT_API_URL),
        })),
      setMobileVersions: (osVersion, deviceVersion) =>
        set({
          testMode: 'mobile',
          osVersion: osVersion.trim(),
          deviceVersion: deviceVersion.trim(),
        }),
      clearMobile: () =>
        set({
          mobilePlatform: null,
          appDriveUrl: '',
          appiumUrl: '',
          osVersion: '',
          deviceVersion: '',
        }),
      setAiProvider: (provider) =>
        set({
          aiProvider: provider,
          openRouterEnabled: provider === 'openrouter',
          claudeEnabled: provider === 'claude',
        }),
      setOpenRouterEnabled: (enabled) =>
        set((state) => {
          if (enabled) {
            return {
              openRouterEnabled: true,
              claudeEnabled: false,
              aiProvider: 'openrouter' as const,
            };
          }
          // Turning off active OpenRouter → switch to Claude if possible
          if (state.aiProvider === 'openrouter') {
            return {
              openRouterEnabled: false,
              claudeEnabled: true,
              aiProvider: 'claude' as const,
            };
          }
          return { openRouterEnabled: false };
        }),
      setClaudeEnabled: (enabled) =>
        set((state) => {
          if (enabled) {
            return {
              claudeEnabled: true,
              openRouterEnabled: false,
              aiProvider: 'claude' as const,
            };
          }
          if (state.aiProvider === 'claude') {
            return {
              claudeEnabled: false,
              openRouterEnabled: true,
              aiProvider: 'openrouter' as const,
            };
          }
          return { claudeEnabled: false };
        }),
    }),
    {
      name: 'lgd-playwright-mcp',
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      partialize: (state) => ({
        testMode: state.testMode,
        baseUrl: state.baseUrl,
        apiUrl: state.apiUrl,
        mobilePlatform: state.mobilePlatform,
        appDriveUrl: state.appDriveUrl,
        appiumUrl: state.appiumUrl,
        osVersion: state.osVersion,
        deviceVersion: state.deviceVersion,
        aiProvider: state.aiProvider,
        openRouterEnabled: state.openRouterEnabled,
        claudeEnabled: state.claudeEnabled,
      }),
    },
  ),
);

export function isWebReady(s: {
  testMode: TestMode | null;
  baseUrl: string;
  apiUrl: string;
}): boolean {
  const mode = s.testMode || (s.baseUrl && s.apiUrl ? 'web' : null);
  return mode === 'web' && !!s.baseUrl && !!s.apiUrl;
}

export function isWebLoadReady(s: {
  testMode: TestMode | null;
  baseUrl: string;
}): boolean {
  return s.testMode === 'web-load' && !!s.baseUrl;
}

export function isVaptReady(s: {
  testMode: TestMode | null;
  baseUrl: string;
}): boolean {
  return s.testMode === 'vapt' && !!s.baseUrl;
}

export function isMobileReady(s: {
  testMode: TestMode | null;
  mobilePlatform: MobilePlatform | null;
  appDriveUrl: string;
  appiumUrl: string;
  apiUrl: string;
  osVersion: string;
  deviceVersion: string;
}): boolean {
  return (
    s.testMode === 'mobile' &&
    !!s.mobilePlatform &&
    !!s.appDriveUrl &&
    !!s.appiumUrl &&
    !!s.apiUrl &&
    !!s.osVersion &&
    !!s.deviceVersion
  );
}

export { normalizeUrl };
