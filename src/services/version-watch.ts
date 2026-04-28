export interface AppVersionInfo {
  version: string;
  buildId?: string;
}

const VERSION_URL = '/version.json';

export async function fetchAppVersion(): Promise<AppVersionInfo | null> {
  try {
    const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;

    const data = (await response.json()) as Partial<AppVersionInfo>;
    if (typeof data.version !== 'string' || data.version.length === 0) return null;

    return {
      version: data.version,
      buildId: typeof data.buildId === 'string' ? data.buildId : undefined,
    };
  } catch {
    return null;
  }
}

export function getVersionKey(info: AppVersionInfo): string {
  return `${info.version}:${info.buildId ?? ''}`;
}
