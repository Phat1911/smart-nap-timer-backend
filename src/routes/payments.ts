import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { getPayOS } from '../payos';
import { config, TIER_VND_PRICE } from '../config';

const router = Router();

// ── Subscription persistence ──────────────────────────────────────────────────
// Stored in a JSON file so tier grants survive server restarts.
// On Render free tier, the filesystem persists between restarts (not deployments).

const DATA_DIR  = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'subscriptions.json');

interface SubscriptionRecord {
  tier:       'pro' | 'max';
  grantedAt:  string;   // ISO date
  expiresAt:  string;   // ISO date — grantedAt + 30 days
}

// userId -> SubscriptionRecord
type SubscriptionStore = Record<string, SubscriptionRecord>;

function loadSubscriptions(): SubscriptionStore {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) return {};
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw) as SubscriptionStore;
  } catch {
    return {};
  }
}

function saveSubscriptions(store: SubscriptionStore): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    console.error('[subscriptions] Failed to save:', e);
  }
}

function getActiveTier(userId: string): 'free' | 'pro' | 'max' {
  const store = loadSubscriptions();
  const record = store[userId];
  if (!record) return 'free';
  if (new Date(record.expiresAt) <= new Date()) {
    // Expired — clean up and return free
    delete store[userId];
    saveSubscriptions(store);
    return 'free';
  }
  return record.tier;
}

function grantTier(userId: string, tier: 'pro' | 'max'): void {
  const store = loadSubscriptions();
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + 30);   // 30-day subscription

  store[userId] = {
    tier,
    grantedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  saveSubscriptions(store);
  console.log(`[subscriptions] Granted ${tier} to ${userId}, expires ${expiresAt.toISOString()}`);
}

// ── In-memory order store ─────────────────────────────────────────────────────
// Orders only need to live long enough to be confirmed (minutes), so in-memory
// is fine here. Subscriptions are what must survive restarts — handled above.
const orders = new Map<number, {
  tier:    'pro' | 'max';
  userId:  string;
  status:  'pending' | 'paid' | 'cancelled';
}>();

// ── POST /payments/create ─────────────────────────────────────────────────────
// Body: { tier: 'pro' | 'max', userId: string }
// Returns: { checkoutUrl: string, orderCode: number }
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { tier, userId } = req.body as { tier: 'pro' | 'max'; userId: string };

    if (!tier || !['pro', 'max'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier. Must be pro or max.' });
    }
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId is required.' });
    }

    // Generate unique orderCode (last 8 digits of timestamp)
    const orderCode = Number(String(Date.now()).slice(-8));
    const amount    = TIER_VND_PRICE[tier];
    const desc      = tier === 'pro' ? 'SmartNap Pro' : 'SmartNap Max'; // max 25 chars

    const payos = getPayOS();
    const link  = await payos.paymentRequests.create({
      orderCode,
      amount,
      description: desc,
      returnUrl:   config.app.returnUrl,
      cancelUrl:   config.app.cancelUrl,
      items: [{
        name:     tier === 'pro' ? 'Smart Nap Timer Pro' : 'Smart Nap Timer Max',
        quantity: 1,
        price:    amount,
      }],
    });

    orders.set(orderCode, { tier, userId, status: 'pending' });

    return res.json({ checkoutUrl: link.checkoutUrl, orderCode, amount, tier });
  } catch (err: any) {
    console.error('[payments/create]', err?.message ?? err);
    return res.status(500).json({ error: 'Failed to create payment link.' });
  }
});

// ── GET /payments/status/:orderCode ──────────────────────────────────────────
// App polls this after user returns from PayOS checkout.
// Returns: { status: 'pending' | 'paid' | 'cancelled', tier?: string }
router.get('/status/:orderCode', (req: Request, res: Response) => {
  const orderCode = parseInt(req.params.orderCode, 10);
  const order     = orders.get(orderCode);

  if (!order) {
    return res.status(404).json({ error: 'Order not found.' });
  }

  return res.json({
    status: order.status,
    tier:   order.status === 'paid' ? order.tier : undefined,
  });
});

// ── POST /payments/webhook ────────────────────────────────────────────────────
// PayOS calls this when a payment is confirmed.
// IMPORTANT: always return 200 even on signature error (PayOS health check requirement).
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const payos = getPayOS();
    const data  = await payos.webhooks.verify(req.body);

    const orderCode = data.orderCode;
    const order     = orders.get(orderCode);

    if (order && order.status === 'pending') {
      order.status = 'paid';
      orders.set(orderCode, order);
      // Grant a 30-day subscription — persisted to disk
      grantTier(order.userId, order.tier);
    }

    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.warn('[webhook] signature error (may be PayOS health check):', err?.message);
    return res.status(200).json({ received: false, error: 'invalid_signature' });
  }
});

// ── GET /payments/me/tier ─────────────────────────────────────────────────────
// App calls this to read the authoritative tier from the server.
// Automatically returns 'free' if the 30-day subscription has expired.
// Query: ?userId=<deviceId>
// Returns: { tier: 'free' | 'pro' | 'max', expiresAt?: string }
router.get('/me/tier', (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    return res.status(400).json({ error: 'userId query param is required.' });
  }

  const uid   = userId.trim();
  const tier  = getActiveTier(uid);

  // Include expiresAt in the response so the app can show it to the user
  const store  = loadSubscriptions();
  const record = store[uid];

  return res.json({
    tier,
    expiresAt: record ? record.expiresAt : null,
  });
});

export default router;
