/** Common Android OS versions for the mobile setup sidebar. */
export const ANDROID_OS_VERSIONS = [
  { id: '15', label: 'Android 15' },
  { id: '14', label: 'Android 14' },
  { id: '13', label: 'Android 13' },
  { id: '12', label: 'Android 12' },
  { id: '11', label: 'Android 11' },
] as const;

/** Common Android device / form-factor options. */
export const ANDROID_DEVICES = [
  { id: 'pixel-8', label: 'Pixel 8' },
  { id: 'pixel-7', label: 'Pixel 7' },
  { id: 'galaxy-s24', label: 'Galaxy S24' },
  { id: 'galaxy-s23', label: 'Galaxy S23' },
  { id: 'oneplus-12', label: 'OnePlus 12' },
  { id: 'generic-phone', label: 'Generic phone' },
] as const;

/** Common iOS versions. */
export const IOS_OS_VERSIONS = [
  { id: '18', label: 'iOS 18' },
  { id: '17', label: 'iOS 17' },
  { id: '16', label: 'iOS 16' },
  { id: '15', label: 'iOS 15' },
] as const;

/** Common iOS devices. */
export const IOS_DEVICES = [
  { id: 'iphone-16', label: 'iPhone 16' },
  { id: 'iphone-15', label: 'iPhone 15' },
  { id: 'iphone-14', label: 'iPhone 14' },
  { id: 'iphone-13', label: 'iPhone 13' },
  { id: 'ipad-pro', label: 'iPad Pro' },
  { id: 'generic-iphone', label: 'Generic iPhone' },
] as const;
