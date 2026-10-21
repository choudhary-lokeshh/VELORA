'use client';

import { createContext, useContext, type ReactNode } from 'react';

const IvoryPreview = createContext(false);

export function VisualPreviewProvider({
  children,
  enabled,
}: {
  readonly children: ReactNode;
  readonly enabled: boolean;
}) {
  return (
    <IvoryPreview.Provider value={enabled}>{children}</IvoryPreview.Provider>
  );
}

export function useIvoryPreview(): boolean {
  return useContext(IvoryPreview);
}
