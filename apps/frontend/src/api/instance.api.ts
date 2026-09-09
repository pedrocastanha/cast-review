export type CredentialsMode = 'stored' | 'ephemeral';

export interface InstanceInfo {
  credentialsMode: CredentialsMode;
  demoLogin: boolean;
}

let cached: Promise<InstanceInfo> | null = null;

export function fetchInstanceInfo(): Promise<InstanceInfo> {
  cached ??= fetch('/api/instance')
    .then((res) => (res.ok ? res.json() : null))
    .then((body: Partial<InstanceInfo> | null) => ({
      credentialsMode:
        body?.credentialsMode === 'ephemeral'
          ? ('ephemeral' as const)
          : ('stored' as const),
      demoLogin: body?.demoLogin === true,
    }))
    .catch(() => ({ credentialsMode: 'stored' as const, demoLogin: false }));

  return cached;
}
