import { customerIdentity } from './customer-auth';
import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../chatgpt-auth';
import { initialProducts, initialSettings } from './seed';
export const E = env as any;
export const db = () => E.DB as D1Database;
export const now = () => Date.now();
export const id = () => crypto.randomUUID();
export const parse = (x: any) => { try {
    return JSON.parse(x || '{}');
}
catch {
    return {};
} };
export const row = (r: any) => r ? { ...r, ...(r.data ? { data: parse(r.data) } : {}), ...(r.items ? { items: parse(r.items) } : {}) } : null;
export async function all(sql: string, ...args: any[]) { return (await db().prepare(sql).bind(...args).all()).results as any[]; }
export async function one(sql: string, ...args: any[]) { return db().prepare(sql).bind(...args).first() as Promise<any>; }
export async function run(sql: string, ...args: any[]) { return db().prepare(sql).bind(...args).run(); }
export async function settings() { const rows = await all('SELECT * FROM settings WHERE key != ?', 'secrets'); return Object.fromEntries(rows.map(r => [r.key, parse(r.value)])); }
export async function seed() {
    const done = await one('SELECT key FROM settings WHERE key=?', 'seeded');
    if (done)
        return;
    const stmts = initialProducts.map(p => db().prepare('INSERT OR IGNORE INTO products (id,slug,name,name_fr,category,gender,family,price,mrp,stock,status,data,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(p.id, p.slug, p.name, p.name_fr, p.category, p.gender, p.family, p.price, p.mrp, p.stock, p.status, JSON.stringify(p.data), now()));
    for (const [k, v] of Object.entries(initialSettings))
        stmts.push(db().prepare('INSERT OR IGNORE INTO settings VALUES (?,?,?)').bind(k, JSON.stringify(v), now()));
    stmts.push(db().prepare('INSERT OR IGNORE INTO settings VALUES (?,?,?)').bind('seeded', 'true', now()));
    await db().batch(stmts);
}
export async function identity(req: Request) { const platform = await getChatGPTUser(); const external = await customerIdentity(req); const u = external?.user || platform; const c = req.headers.get('cookie')?.match(/(?:^|; )bp_guest=([a-f0-9-]{36})/)?.[1]; return { user: u, platform, authCookie: external?.cookie, owner: u ? 'user:' + u.userId : 'guest:' + (c || id()), fresh: !c && !u }; }
export async function admin() { const u = await getChatGPTUser(); if (!u)
    throw new AppError('Sign in to continue.', 401); if (!await one('SELECT id FROM admins WHERE id=?', u.userId))
    throw new AppError('Administrator access required.', 403); return u; }
export class AppError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}
export async function rate(key: string, max = 80) { const window = Math.floor(now() / 60000); const k = key + ':' + window; const r = await one('INSERT INTO limits (key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count', k, now() + 120000); if (r.count > max)
    throw new AppError('Too many requests. Please try again shortly.', 429); if (Math.random() < 0.02)
    await run('DELETE FROM limits WHERE expires<?', now()); }
export async function log(actor: string, action: string, entity: string) { await run('INSERT INTO audit VALUES (?,?,?,?,?)', id(), actor, action, entity, now()); }
export function safeText(x: any, max = 1000) { return typeof x === 'string' ? x.trim().slice(0, max) : ''; }
export const validImage = (s: string) => /^\/assets\/[a-zA-Z0-9/_.-]+$/.test(s) || /^\/api\/media\/[a-zA-Z0-9_.-]+$/.test(s) || /^https:\/\//.test(s);
export async function discountRows() { return (await all("SELECT * FROM campaigns WHERE kind='discount' AND enabled=1")).map(row).filter(c => (!c.data.start || Date.parse(c.data.start) <= now()) && (!c.data.end || Date.parse(c.data.end) > now())); }
export function effective(p: any, discounts: any[]) { let price = p.price; let label = ''; for (const c of discounts) {
    const d = c.data;
    if (d.scope === 'products' && !d.products?.includes(p.id))
        continue;
    if (d.scope === 'categories' && !d.categories?.includes(p.category))
        continue;
    const n = d.type === 'fixed' ? Math.max(0, p.price - Math.round(d.value * 100)) : Math.round(p.price * (100 - d.value) / 100);
    if (n < price) {
        price = n;
        label = c.name;
    }
} return { effectivePrice: price, discountLabel: label }; }
export async function catalog(adminView = false) { const offers = await discountRows(); return (await all('SELECT * FROM products' + (adminView ? '' : " WHERE status='published'") + ' ORDER BY id')).map(p => ({ ...row(p), ...effective(p, offers) })); }
export async function getCart(owner: string) { let c = await one('SELECT * FROM carts WHERE owner=?', owner); if (!c) {
    await run('INSERT OR IGNORE INTO carts VALUES (?,?,?,0,?,?,?,0)', id(), owner, '[]', '{}', now(), now());
    c = await one('SELECT * FROM carts WHERE owner=?', owner);
} const products = await catalog(); const cart = row(c); const lines = cart.items.map((i: any) => { const p = products.find(p => p.id === i.id); return p ? { ...i, product: p, lineTotal: p.effectivePrice * i.qty } : null; }).filter(Boolean); return { ...cart, lines, total: lines.reduce((n: number, l: any) => n + l.lineTotal, 0), shipping: 0 }; }
async function encryptionKey() { if (!E.STORE_ENCRYPTION_KEY)
    throw new AppError('Secret storage key is not configured.', 503); return crypto.subtle.importKey('raw', Uint8Array.from(atob(E.STORE_ENCRYPTION_KEY), c => c.charCodeAt(0)), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }
export async function setSecrets(values: any) { const old = await secrets(); for (const [k, v] of Object.entries(values))
    if (['RESEND_API_KEY', 'SHIPROCKET_EMAIL', 'SHIPROCKET_PASSWORD', 'META_ACCESS_TOKEN', 'SHIPROCKET_WEBHOOK_TOKEN', 'SUPABASE_ANON_KEY', 'RESEND_WEBHOOK_SECRET', 'META_APP_SECRET'].includes(k) && typeof v === 'string' && v.trim())
        old[k] = v.trim(); const iv = crypto.getRandomValues(new Uint8Array(12)); const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(), new TextEncoder().encode(JSON.stringify(old))); const value = JSON.stringify({ iv: btoa(String.fromCharCode(...iv)), cipher: btoa(String.fromCharCode(...new Uint8Array(cipher))) }); await run('INSERT INTO settings VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated=excluded.updated', 'secrets', value, now()); }
export async function secrets() { const r = await one('SELECT value FROM settings WHERE key=?', 'secrets'); if (!r)
    return {} as any; const p = parse(r.value); const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Uint8Array.from(atob(p.iv), c => c.charCodeAt(0)) }, await encryptionKey(), Uint8Array.from(atob(p.cipher), c => c.charCodeAt(0))); return parse(new TextDecoder().decode(clear)); }
export async function shiprocket(path: string, method = 'GET', body?: any) { const sec = await secrets(); if (!sec.SHIPROCKET_EMAIL || !sec.SHIPROCKET_PASSWORD)
    throw new AppError('Shiprocket: Configuration required.', 503); const auth = await fetch('https://apiv2.shiprocket.in/v1/external/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: sec.SHIPROCKET_EMAIL, password: sec.SHIPROCKET_PASSWORD }) }); const a: any = await auth.json(); if (!auth.ok || !a.token)
    throw new AppError('Shiprocket authentication failed.', 502); const r = await fetch('https://apiv2.shiprocket.in/v1/external/' + path, { method, headers: { Authorization: 'Bearer ' + a.token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const d = await r.json(); if (!r.ok)
    throw new AppError('Shiprocket request failed. Check merchant configuration.', 502); return d as any; }
export async function sendMessage(channel: string, to: string, subject: string, text: string, dedupe: string, owner: string, template?: string) {
    const s = await settings();
    const sec = await secrets();
    const msgId = id();
    let response: Response;
    if (channel === 'email') {
        if (!s.integrations.email.enabled || !sec.RESEND_API_KEY || !s.integrations.email.from)
            throw new AppError('Email: Configuration required.', 503);
    }
    else if (!s.integrations.whatsapp.enabled || !sec.META_ACCESS_TOKEN || !s.integrations.whatsapp.phoneId || !template)
        throw new AppError('WhatsApp: Configuration required.', 503);
    const existing = await one('SELECT * FROM messages WHERE dedupe=?', dedupe);
    if (existing)
        return row(existing);
    await run('INSERT INTO messages VALUES (?,?,?,?,?,?,?)', msgId, dedupe, owner, channel, 'sending', JSON.stringify({ subject }), now());
    try {
        if (channel === 'email')
            response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + sec.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': dedupe }, body: JSON.stringify({ from: s.integrations.email.from, to: [to], subject, text }) });
        else
            response = await fetch(`https://graph.facebook.com/${s.integrations.whatsapp.version}/${s.integrations.whatsapp.phoneId}/messages`, { method: 'POST', headers: { Authorization: 'Bearer ' + sec.META_ACCESS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template: { name: template, language: { code: s.integrations.whatsapp.language }, components: [{ type: 'body', parameters: [{ type: 'text', text }] }] } }) });
        const r: any = await response.json();
        await run('UPDATE messages SET status=?,data=? WHERE id=?', response.ok ? 'accepted' : 'failed', JSON.stringify({ subject, providerId: r.id || r.messages?.[0]?.id, error: response.ok ? null : 'Provider rejected the request' }), msgId);
        if (!response.ok)
            throw new AppError('Message rejected by provider. See message history.', 502);
        return { status: 'accepted', id: msgId };
    }
    catch (e) {
        await run("UPDATE messages SET status='failed' WHERE id=? AND status='sending'", msgId);
        throw e;
    }
}
