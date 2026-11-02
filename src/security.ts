import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const randomToken = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function equal(a: string, b: string) { const x=Buffer.from(a),y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y); }
export async function passwordHash(password: string) { const salt=randomToken(); const key=await scrypt(password,salt,64) as Buffer; return `${salt}:${key.toString('hex')}`; }
export async function passwordValid(password: string, stored: string) { const [salt,hash]=stored.split(':'); if(!salt||!hash) return false; return equal((await scrypt(password,salt,64) as Buffer).toString('hex'),hash); }
export class Vault {
  private key: Buffer;
  constructor(secret: string) { this.key=createHash('sha256').update(secret).digest(); }
  seal(owner: string, token: string) { const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',this.key,iv); c.setAAD(Buffer.from(owner)); return [iv,c.update(token,'utf8'),c.final(),c.getAuthTag()].map(b=>b.toString('base64url')).join('.'); }
  open(owner: string, sealed: string) { const [iv,data,tail,tag]=sealed.split('.').map(s=>Buffer.from(s,'base64url')); const d=createDecipheriv('aes-256-gcm',this.key,iv);d.setAAD(Buffer.from(owner));d.setAuthTag(tag);return Buffer.concat([d.update(data),d.update(tail),d.final()]).toString('utf8'); }
}
