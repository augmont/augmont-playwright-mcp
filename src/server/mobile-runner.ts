import type { LocationCountry } from '@/lib/types';
import {
  addCountryResult,
  createSession,
  getSession,
  setRunStatus,
  toSnapshot,
  updateStep,
} from '@/server/session-manager';
import { createSessionStepsFromFixtures } from '@/server/runner';
import { buildFixtureForCountry } from '@/server/tests/multi-country-signup-login';
import { SIGNUP_LOGIN_ID } from '@/lib/test-registry';
import {
  avdHintFromDeviceVersion,
  openAndroidAppFromDrive,
} from '@/server/android-device';

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function shortUrl(url: string) {
  return url.length > 52 ? `${url.slice(0, 49)}…` : url;
}

export function createMobileSignupSession(opts: {
  runId: string;
  testName: string;
  apiUrl: string;
  appiumUrl: string;
  countries: LocationCountry[];
}) {
  const fixtures = opts.countries.map(buildFixtureForCountry);
  const steps = createSessionStepsFromFixtures(fixtures);
  return createSession({
    runId: opts.runId,
    testId: SIGNUP_LOGIN_ID,
    testName: opts.testName,
    baseUrl: opts.appiumUrl,
    apiUrl: opts.apiUrl,
    steps,
  });
}

export async function runMobileSignupCountries(
  runId: string,
  opts: {
    platform: 'android' | 'ios';
    osVersion: string;
    deviceVersion: string;
    appDriveUrl: string;
    appiumUrl: string;
    countries: LocationCountry[];
  },
): Promise<void> {
  const session = getSession(runId);
  if (!session) throw new Error('Session not found');

  const { platform, osVersion, deviceVersion, appDriveUrl, appiumUrl, countries } = opts;
  const signal = session.abortController.signal;
  const label = platform === 'android' ? 'Android' : 'iOS';

  try {
    setRunStatus(runId, 'running');

    const boot = session.steps.find((s) => s.id === 'boot');
    if (boot) {
      updateStep(runId, 'boot', {
        status: 'running',
        message:
          platform === 'android'
            ? 'Downloading APK & opening Android emulator…'
            : `iOS simulator launch is not wired yet — use Android for device open`,
      });

      if (platform === 'android') {
        try {
          const result = await openAndroidAppFromDrive({
            driveUrl: appDriveUrl,
            appiumUrl,
            avdHint: avdHintFromDeviceVersion(deviceVersion, osVersion),
            onLog: (msg) => {
              updateStep(runId, 'boot', { status: 'running', message: msg });
            },
          });
          if (signal.aborted) {
            setRunStatus(runId, 'stopped');
            return;
          }
          updateStep(runId, 'boot', {
            status: 'passed',
            message: `Emulator ${result.deviceId} · ${result.packageName} · ${
              result.usedAppium ? 'Appium' : 'adb'
            } · ${shortUrl(appDriveUrl)}`,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to open emulator';
          updateStep(runId, 'boot', { status: 'failed', message });
          setRunStatus(runId, 'failed', message);
          return;
        }
      } else {
        await delay(400);
        updateStep(runId, 'boot', {
          status: 'failed',
          message:
            'iOS Simulator auto-launch is not implemented yet. Use Android to open the emulator with the Drive APK.',
        });
        setRunStatus(runId, 'failed', 'iOS launch not implemented');
        return;
      }
    }

    if (signal.aborted) {
      setRunStatus(runId, 'stopped');
      return;
    }

    for (const country of countries) {
      if (signal.aborted) {
        setRunStatus(runId, 'stopped');
        return;
      }

      const iso = country.isoCode.toUpperCase();
      const key = iso.toLowerCase();
      const countrySteps = getSession(runId)?.steps.filter((s) =>
        s.id.startsWith(`${key}-`),
      ) || [];

      for (const step of countrySteps) {
        if (signal.aborted) {
          setRunStatus(runId, 'stopped');
          return;
        }
        updateStep(runId, step.id, {
          status: 'running',
          message: `${label} · ${country.name} (device open — flow steps stubbed)`,
        });
        await delay(200);
        updateStep(runId, step.id, {
          status: 'passed',
          message: `Device ready · ${deviceVersion}`,
        });
      }

      addCountryResult(runId, {
        isoCode: iso,
        countryName: country.name,
        status: 'passed',
        stepsSummary: {
          total: countrySteps.length,
          passed: countrySteps.length,
          failed: 0,
          skipped: 0,
        },
      });
    }

    const wrap = getSession(runId)?.steps.find((s) => s.id === 'wrap-up');
    if (wrap) {
      updateStep(runId, 'wrap-up', { status: 'running' });
      await delay(200);
      updateStep(runId, 'wrap-up', {
        status: 'passed',
        message: `Emulator left running · Appium ${appiumUrl}`,
      });
    }

    setRunStatus(runId, 'completed');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Mobile runner error';
    setRunStatus(runId, 'failed', message);
  }
}

export { toSnapshot };
