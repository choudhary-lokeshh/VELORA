'use client';

import { useParams } from 'next/navigation';

import { AdminGate } from '../../../../src/app/gate';
import { PaymentScreen } from '../../../../src/product/payments';

export default function PaymentPage() {
  const parameters = useParams<{ paymentId: string }>();
  return (
    <AdminGate title="Payment">
      <PaymentScreen paymentId={parameters.paymentId} />
    </AdminGate>
  );
}
