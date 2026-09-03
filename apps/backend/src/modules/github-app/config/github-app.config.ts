export interface GithubAppConfig {
  appId: string;
  slug: string;
  privateKey: string;
  webhookSecret: string;
  frontendUrl: string;
  payloadRetentionDays: number;
  stateSecret: string;
}

function readPrivateKey(): string {
  const base64 = process.env.GITHUB_APP_PRIVATE_KEY_BASE64?.trim();
  if (base64) return Buffer.from(base64, 'base64').toString('utf8');
  return (process.env.GITHUB_APP_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
}

export function resolveGithubAppConfig(): GithubAppConfig {
  return {
    appId: process.env.GITHUB_APP_ID?.trim() ?? '',
    slug: process.env.GITHUB_APP_SLUG?.trim() ?? '',
    privateKey: readPrivateKey(),
    webhookSecret: process.env.GITHUB_APP_WEBHOOK_SECRET?.trim() ?? '',
    frontendUrl: (
      process.env.FRONTEND_URL?.trim() || 'http://localhost:5173'
    ).replace(/\/$/, ''),
    payloadRetentionDays: Number(
      process.env.GITHUB_WEBHOOK_PAYLOAD_RETENTION_DAYS ?? 7,
    ),
    stateSecret:
      process.env.GITHUB_APP_STATE_SECRET?.trim() ||
      process.env.JWT_ACCESS_SECRET?.trim() ||
      '',
  };
}

export function isGithubAppConfigured(config: GithubAppConfig): boolean {
  return Boolean(
    config.appId && config.privateKey && config.webhookSecret && config.slug,
  );
}
