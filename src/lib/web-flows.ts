import type { WebFlowRole } from '@/lib/types';

export type WebFlowId = WebFlowRole;

export interface WebFlowMeta {
  id: WebFlowId;
  name: string;
  eyebrow: string;
  description: string;
  href: string;
}

export const WEB_FLOWS: WebFlowMeta[] = [
  {
    id: 'public',
    name: 'Public flow',
    eyebrow: 'Unauthenticated',
    description:
      'Home, about, contact, policies, register shell, and multi-country Signup & Login.',
    href: '/tests/flow/public',
  },
  {
    id: 'buyer',
    name: 'Buyer flow',
    eyebrow: 'Buyer account',
    description:
      'Login with buyer credentials from Set credentials (header), then products, cart, wishlist, orders, account, and more.',
    href: '/tests/flow/buyer',
  },
  {
    id: 'admin',
    name: 'Admin flow',
    eyebrow: 'Admin account',
    description:
      'Login with admin credentials from Set credentials (header), then buyers, sellers, orders, products, and admin tools.',
    href: '/tests/flow/admin',
  },
  {
    id: 'seller',
    name: 'Seller flow',
    eyebrow: 'Seller account',
    description:
      'Auth guard checks and seller home (set Seller credentials in the header to run logged-in).',
    href: '/tests/flow/seller',
  },
];

export function isWebFlowId(value: string): value is WebFlowId {
  return WEB_FLOWS.some((f) => f.id === value);
}

export function getWebFlow(id: string): WebFlowMeta | undefined {
  return WEB_FLOWS.find((f) => f.id === id);
}
