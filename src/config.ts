import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DEPLOYMENT_PROFILE: z.enum(['standard','free-paper']).default('standard'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.url(), DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(32), REGISTRATION_CODE: z.string().default(''),
  FYERS_APP_ID: z.string().default(''), FYERS_APP_SECRET: z.string().default(''),
  LIVE_TRADING_ENABLED: z.enum(['true','false']).default('false'),
  BROKER_APP_APPROVED: z.enum(['true','false']).default('false'),
  DEDICATED_EGRESS_CONFIRMED: z.enum(['true','false']).default('false'),
  SMTP_HOST: z.string().default(''), SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(''), SMTP_PASSWORD: z.string().default(''),
  MAIL_FROM: z.string().default('QuantPilot <noreply@example.com>'),
  NSE_HOLIDAYS: z.string().default(''), MCX_HOLIDAYS: z.string().default(''),
  MCX_SQUARE_OFF: z.string().regex(/^2[0-3]:[0-5][0-9]$/).default('23:00'),
});
export type Config = z.infer<typeof schema>;
export function config(env: NodeJS.ProcessEnv = process.env): Config {
  const c = schema.parse({ ...env, APP_ORIGIN: env.APP_ORIGIN || env.RENDER_EXTERNAL_URL || 'http://localhost:3000' });
  if(c.DEPLOYMENT_PROFILE==='free-paper' && c.LIVE_TRADING_ENABLED==='true') throw new Error('Free hosting supports paper trading only');
  c.APP_ORIGIN = new URL(c.APP_ORIGIN).origin;
  if (c.NODE_ENV === 'production' && (!c.APP_ORIGIN.startsWith('https://') || c.ENCRYPTION_KEY.startsWith('replace-'))) throw new Error('Production requires HTTPS and a generated encryption key');
  if (c.NODE_ENV === 'production' && !c.SMTP_HOST && !c.REGISTRATION_CODE) throw new Error('Configure SMTP verification or private invite registration');
  if (c.LIVE_TRADING_ENABLED === 'true' && (c.BROKER_APP_APPROVED !== 'true' || c.DEDICATED_EGRESS_CONFIRMED !== 'true' || !c.FYERS_APP_ID || !c.FYERS_APP_SECRET)) throw new Error('Live trading requires broker approval, verified outbound IP and FYERS credentials');
  return c;
}
