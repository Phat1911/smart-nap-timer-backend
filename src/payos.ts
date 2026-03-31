import { PayOS } from '@payos/node';
import { config } from './config';

// Lazy factory -- reads env vars at call time, never at module load
export function getPayOS(): PayOS {
  return new PayOS({
    clientId:    config.payos.clientId,
    apiKey:      config.payos.apiKey,
    checksumKey: config.payos.checksumKey,
  });
}
