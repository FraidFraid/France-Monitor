import type { Radar2dManifest } from './radar-2d.ts';

export async function installRadar2dObservation(options: {
  readonly manifest: Radar2dManifest;
  readonly enabled: boolean;
  readonly installOverlay: (manifest: Radar2dManifest, enabled: boolean) => Promise<void>;
  readonly reportSuccess: () => void;
  readonly isCurrent?: () => boolean;
}): Promise<boolean> {
  await options.installOverlay(options.manifest, options.enabled);
  if (options.isCurrent && !options.isCurrent()) return false;
  options.reportSuccess();
  return true;
}

export async function runRadar2dToggleTransition(options: {
  readonly enabled: boolean;
  readonly loadManifest: () => Promise<void>;
  readonly disableOverlay: () => Promise<void>;
  readonly syncEnabled: (enabled: boolean) => void;
  readonly onError: (error: unknown) => void;
  readonly isCurrent?: () => boolean;
}): Promise<void> {
  const isCurrent = options.isCurrent ?? (() => true);
  if (!options.enabled) {
    try {
      await options.disableOverlay();
      if (!isCurrent()) return;
      options.syncEnabled(false);
    } catch (error) {
      if (!isCurrent()) return;
      options.syncEnabled(true);
      options.onError(error);
    }
    return;
  }

  try {
    await options.loadManifest();
    if (!isCurrent()) {
      try {
        await options.disableOverlay();
      } catch (cleanupError) {
        options.onError(cleanupError);
      }
      return;
    }
    options.syncEnabled(true);
  } catch (error) {
    if (!isCurrent()) return;
    options.onError(error);
    try {
      await options.disableOverlay();
    } catch (cleanupError) {
      options.onError(cleanupError);
    }
    options.syncEnabled(false);
  }
}
