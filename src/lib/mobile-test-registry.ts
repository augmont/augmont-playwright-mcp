import type { TestCaseMeta, TestStep } from '@/lib/types';

export const MOBILE_LAUNCH_ID = 'mobile-app-launch';
export const MOBILE_ONBOARDING_ID = 'mobile-onboarding';
export const MOBILE_SIGNUP_ID = 'mobile-signup-login';

export type MobileTestId =
  | typeof MOBILE_LAUNCH_ID
  | typeof MOBILE_ONBOARDING_ID
  | typeof MOBILE_SIGNUP_ID;

export function isMobileTestId(id: string): id is MobileTestId {
  return (
    id === MOBILE_LAUNCH_ID ||
    id === MOBILE_ONBOARDING_ID ||
    id === MOBILE_SIGNUP_ID
  );
}

export function buildMobileLaunchTest(): TestCaseMeta {
  return {
    id: MOBILE_LAUNCH_ID,
    name: 'Mobile — App launch',
    description:
      'Start emulator + install APK once (skipped if already running). Dismiss ANR and confirm Augmont LGD is foreground.',
    tags: ['mobile', 'android', 'launch', 'emulator'],
    estimatedMinutes: 4,
    kind: 'mobile-launch',
  };
}

export function buildMobileOnboardingTest(): TestCaseMeta {
  return {
    id: MOBILE_ONBOARDING_ID,
    name: 'Mobile — Onboarding',
    description:
      'Reuses the already-open app (skips emulator/APK/launch). Walks Continue/Skip onboarding only.',
    tags: ['mobile', 'android', 'onboarding'],
    estimatedMinutes: 3,
    kind: 'mobile-onboarding',
  };
}

export function buildMobileSignupTest(): TestCaseMeta {
  return {
    id: MOBILE_SIGNUP_ID,
    name: 'Mobile — Signup & Login',
    description:
      'Reuses the open app (skips relaunch). Continues from onboarding → Signup → fill form — no second emulator start.',
    tags: ['mobile', 'android', 'signup', 'login', 'auth'],
    estimatedMinutes: 5,
    kind: 'mobile-signup',
  };
}

export const MOBILE_TEST_CASES: TestCaseMeta[] = [
  buildMobileLaunchTest(),
  buildMobileOnboardingTest(),
  buildMobileSignupTest(),
];

export function getMobileTestCase(id: string): TestCaseMeta | undefined {
  return MOBILE_TEST_CASES.find((t) => t.id === id);
}

export function buildMobileSteps(
  testId: MobileTestId,
  platform: 'android' | 'ios' = 'android',
): TestStep[] {
  const isIos = platform === 'ios';
  const commonBoot: TestStep[] = [
    {
      id: 'boot-emulator',
      label: isIos
        ? 'Boot iOS Simulator (skip if already running)'
        : 'Boot Android emulator (skip if already running)',
      status: 'pending',
    },
    {
      id: 'install-apk',
      label: isIos
        ? 'Install app (Simulator .app — Diawi IPA will not work)'
        : 'Install APK (skip if already installed)',
      status: 'pending',
    },
    {
      id: 'launch-app',
      label: 'Open app (skip if already open)',
      status: 'pending',
    },
    {
      id: 'dismiss-anr',
      label: isIos
        ? 'Settle Simulator UI'
        : 'Dismiss System UI / process ANR dialogs',
      status: 'pending',
    },
    { id: 'verify-foreground', label: 'Verify app is in foreground', status: 'pending' },
  ];

  if (testId === MOBILE_LAUNCH_ID) {
    return [
      ...commonBoot,
      { id: 'wrap-up', label: 'Finalize mobile launch report', status: 'pending' },
    ];
  }

  if (testId === MOBILE_ONBOARDING_ID) {
    return [
      ...commonBoot,
      {
        id: 'onboarding',
        label: 'Complete onboarding (Continue / Skip)',
        status: 'pending',
      },
      { id: 'wrap-up', label: 'Finalize onboarding report', status: 'pending' },
    ];
  }

  return [
    ...commonBoot,
    {
      id: 'onboarding',
      label: 'Complete onboarding (Continue / Skip)',
      status: 'pending',
    },
    { id: 'open-signup', label: 'Open Signup screen', status: 'pending' },
    { id: 'fill-signup', label: 'Fill signup form fields', status: 'pending' },
    { id: 'submit-signup', label: 'Submit signup / continue', status: 'pending' },
    { id: 'wrap-up', label: 'Finalize mobile signup report', status: 'pending' },
  ];
}
