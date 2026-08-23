'use client';

import { useParams } from 'next/navigation';

import { AdminGate } from '../../../src/app/gate';
import { CaseScreen } from '../../../src/product/case';

export default function CasePage() {
  const parameters = useParams<{ caseId: string }>();
  return (
    <AdminGate title="Case">
      <CaseScreen caseId={parameters.caseId} />
    </AdminGate>
  );
}
