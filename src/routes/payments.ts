import { Router, Request, Response } from 'express';
import { getPayOS } from '../payos';
import { config, TIER_VND_PRICE } from '../config';

const router = Router();

// In-memory order store (resets on server restart -- fine for MVP)
// Maps orderCode -> { tier, userId, status }
const orders = new Map<number, {
  tier:    'pro' | 'max';
  userId:  string;
  status:  'pending' | 'paid' | 'cancelled';
}>();

// ── POST /payments/create ──────────────────────────────────────────────────────
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

    // Store order
    orders.set(orderCode, { tier, userId, status: 'pending' });

    return res.json({
      checkoutUrl: link.checkoutUrl,
      orderCode,
      amount,
      tier,
    });
  } catch (err: any) {
    console.error('[payments/create]', err?.message ?? err);
    return res.status(500).json({ error: 'Failed to create payment link.' });
  }
});

// ── GET /payments/status/:orderCode ───────────────────────────────────────────
// App polls this after user returns from PayOS checkout
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

// ── POST /payments/webhook ─────────────────────────────────────────────────────
// PayOS calls this when a payment is confirmed
// IMPORTANT: always return 200 even on signature error (PayOS health check requirement)
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const payos = getPayOS();
    const data  = await payos.webhooks.verify(req.body);

    const orderCode = data.orderCode;
    const order     = orders.get(orderCode);

    if (order && order.status === 'pending') {
      order.status = 'paid';
      orders.set(orderCode, order);
      console.log(`[webhook] Order ${orderCode} paid -- tier: ${order.tier}, user: ${order.userId}`);
    }

    return res.status(200).json({ success: true });
  } catch (err: any) {
    // Return 200 even on bad signature -- PayOS tests with invalid signatures
    console.warn('[webhook] signature error (may be PayOS health check):', err?.message);
    return res.status(200).json({ received: false, error: 'invalid_signature' });
  }
});

export default router;
