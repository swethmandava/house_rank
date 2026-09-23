'use client';

import { useEffect, useSyncExternalStore } from 'react';

const boardIdPattern = /^[a-zA-Z0-9_-]{6,64}$/;
const subscribeToPath = () => () => undefined;

function currentBoardId() {
  const routeId = window.location.pathname.split('/').filter(Boolean)[0];
  return routeId && routeId !== 'setup' && boardIdPattern.test(routeId)
    ? routeId
    : null;
}

export function useBoardId() {
  const boardId = useSyncExternalStore(
    subscribeToPath,
    currentBoardId,
    () => null,
  );

  useEffect(() => {
    const segments = window.location.pathname.split('/').filter(Boolean);
    const routeId = segments[0];
    const onSetupRoot = routeId === 'setup';
    if (routeId && !onSetupRoot && boardIdPattern.test(routeId)) return;
    if (!routeId || onSetupRoot) {
      const id = createBoardId();
      window.location.replace(`/${id}${onSetupRoot ? '/setup' : ''}`);
      return;
    }
    window.location.replace(`/${createBoardId()}`);
  }, []);

  return boardId;
}

function createBoardId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
}
