'use client';

import Link from 'next/link';
import { WEB_FLOWS } from '@/lib/web-flows';

export function WebFlowSelect() {
  return (
    <div className="choice-grid flow-choice-grid">
      {WEB_FLOWS.map((flow) => (
        <Link key={flow.id} href={flow.href} className="choice-card">
          <span className="choice-card-eyebrow">{flow.eyebrow}</span>
          <h2>{flow.name}</h2>
          <p>{flow.description}</p>
          <span className="choice-card-cta">Open tests →</span>
        </Link>
      ))}
    </div>
  );
}
