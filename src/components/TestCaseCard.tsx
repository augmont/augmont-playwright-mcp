import Link from 'next/link';
import type { TestCaseMeta } from '@/lib/types';

export function TestCaseCard({ test }: { test: TestCaseMeta }) {
  return (
    <Link href={`/tests/${test.id}`} className="test-card">
      <h2>{test.name}</h2>
      <p>{test.description}</p>
      <div className="tag-row">
        {test.tags.map((tag) => (
          <span key={tag} className="tag">
            {tag}
          </span>
        ))}
        <span className="tag">~{test.estimatedMinutes} min</span>
      </div>
    </Link>
  );
}
