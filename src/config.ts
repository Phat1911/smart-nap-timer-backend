import 'dotenv/config';

function require_env(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  port:            parseInt(process.env.PORT ?? '3000', 10),
  payos: {
    clientId:     require_env('PAYOS_CLIENT_ID'),
    apiKey:       require_env('PAYOS_API_KEY'),
    checksumKey:  require_env('PAYOS_CHECKSUM_KEY'),
  },
  app: {
    returnUrl:    process.env.APP_RETURN_URL  ?? 'smartnaptimer://payment/success',
    cancelUrl:    process.env.APP_CANCEL_URL  ?? 'smartnaptimer://payment/cancel',
    backendUrl:   process.env.BACKEND_URL     ?? 'http://localhost:3000',
  },
};

// Tier pricing in VND
export const TIER_VND_PRICE: Record<'pro' | 'max', number> = {
  pro: 59000,
  max: 109000,
};
