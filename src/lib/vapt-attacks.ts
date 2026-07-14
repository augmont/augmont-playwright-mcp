import type { VaptCheckId } from '@/lib/types';

/** Labels aligned to the VAPT attack catalogue (defensive probes). */
export const VAPT_ATTACK_LABELS: Record<VaptCheckId, string> = {
  'brute-force': 'Brute Force Attack',
  'ddos-rate-limit': 'DDoS (rate-limit posture)',
  'sql-injection-surface': 'SQL Injection (SQLi) surface',
  'xss-reflection': 'Cross-Site Scripting (XSS)',
  'csrf-surface': 'Cross-Site Request Forgery (CSRF)',
  'rce-surface': 'Remote Code Execution (RCE) surface',
  'command-injection-surface': 'Command Injection surface',
  'directory-traversal': 'Directory Traversal',
  'file-upload-surface': 'File Upload Attack surface',
  'api-auth-bypass': 'Authentication Bypass',
  'privilege-escalation': 'Privilege Escalation',
  'session-hijacking': 'Session Hijacking',
  'mitm-tls': 'Man-in-the-Middle (MITM) / TLS',
  'ssrf-surface': 'SSRF (Server-Side Request Forgery)',
  'xxe-surface': 'XXE (XML External Entity)',
  'deserialization-surface': 'Deserialization Attack surface',
  'api-abuse': 'API Abuse',
  'malware-upload-surface': 'Malware / dangerous upload surface',
  'phishing-credential-surface': 'Phishing / Credential Theft surface',
  'zero-day-posture': 'Zero-Day posture (baseline controls)',
  // legacy / supporting probes
  'api-method-tamper': 'HTTP method tampering',
  'api-error-hygiene': 'Malformed JSON / error leak',
  'injection-surface': 'Injection surface (generic)',
  'cors-preflight': 'CORS preflight abuse',
  'api-location': 'Location API response hygiene',
  'info-disclosure': 'API info disclosure',
  'security-headers': 'Security response headers',
  'cookie-flags': 'Cookie / session flags',
  'tls-url': 'TLS / URL scheme',
  'unauth-sensitive': 'Unauth sensitive paths',
  'cache-control': 'Cache-Control hygiene',
};

export function vaptAttackLabel(check: VaptCheckId): string {
  return VAPT_ATTACK_LABELS[check] || check;
}

export function countAttacks(checks: VaptCheckId[] | undefined): number {
  return Array.isArray(checks) ? checks.length : 0;
}

/** Ordered catalogue attacks used as internal scenarios on the login main suite. */
export const VAPT_CATALOGUE_ATTACKS: VaptCheckId[] = [
  'brute-force',
  'ddos-rate-limit',
  'sql-injection-surface',
  'xss-reflection',
  'csrf-surface',
  'rce-surface',
  'command-injection-surface',
  'directory-traversal',
  'file-upload-surface',
  'api-auth-bypass',
  'privilege-escalation',
  'session-hijacking',
  'mitm-tls',
  'ssrf-surface',
  'xxe-surface',
  'deserialization-surface',
  'api-abuse',
  'malware-upload-surface',
  'phishing-credential-surface',
  'zero-day-posture',
];
