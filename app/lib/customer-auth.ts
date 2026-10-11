import { AppError, E, one, parse, secrets, rate } from './server';
export async function authConfig() { const s = parse((await one('SELECT value FROM settings WHERE key=?', 'authentication'))?.value); const sec = await secrets(); if (!s.enabled || !s.url || !sec.SUPABASE_ANON_KEY)
    throw new AppError('Phone/email sign-in: Configuration required.', 503); if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(s.url))
    throw new AppError('Invalid authentication provider URL.'); return { url: s.url, key: sec.SUPABASE_ANON_KEY }; }
export async function authRequest(path: string, body?: any, token?: string) { const c = await authConfig(); const r = await fetch(c.url + '/auth/v1/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { apikey: c.key, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); const d: any = await r.json(); if (!r.ok)
    throw new AppError('Verification failed or expired. Please request a new code.', r.status === 429 ? 429 : 400); return d; }
async function key() { return crypto.subtle.importKey('raw', Uint8Array.from(atob(E.STORE_ENCRYPTION_KEY), c => c.charCodeAt(0)), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }
export async function sessionCookie(session: any, secure: boolean) { const iv = crypto.getRandomValues(new Uint8Array(12)); const data = { access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at || Math.floor(Date.now() / 1000) + session.expires_in }; const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(JSON.stringify(data))); const encoded = btoa(String.fromCharCode(...iv, ...new Uint8Array(cipher))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); return `bp_customer=${encoded}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure ? '; Secure' : ''}`; }
export async function customerIdentity(req: Request) { const value = req.headers.get('cookie')?.match(/(?:^|; )bp_customer=([A-Za-z0-9_-]+)/)?.[1]; if (!value)
    return null; try {
    const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
    const decoded = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await key(), bytes.slice(12));
    let session = parse(new TextDecoder().decode(decoded));
    let cookie = '';
    if (session.expires_at < Date.now() / 1000 + 60) {
        session = await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
        cookie = await sessionCookie(session, new URL(req.url).protocol === 'https:');
    }
    ;
    const u = await authRequest('user', undefined, session.access_token);
    return { user: { userId: 'supabase:' + u.id, email: u.email || '', displayName: u.user_metadata?.name || u.email || u.phone, fullName: u.user_metadata?.name || null, phone: u.phone || '', authProvider: 'supabase' }, cookie };
}
catch {
    return null;
} }
