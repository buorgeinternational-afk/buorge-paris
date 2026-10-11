import { E, db, one, all, row, run, id, now, settings, secrets, sendMessage, shiprocket, AppError, log, parse, safeText } from './server';
const enc = new TextEncoder();
const b64 = (x: Uint8Array) => btoa(String.fromCharCode(...x)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const unb64 = (x: string) => Uint8Array.from(atob(x.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
async function signingKey() { const raw = await crypto.subtle.digest('SHA-256', enc.encode(E.STORE_ENCRYPTION_KEY + ':recovery-links')); return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
export async function signedLink(payload: any) { const part = b64(enc.encode(JSON.stringify(payload))); return part + '.' + b64(new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(), enc.encode(part)))); }
export async function verifyLink(token: string, type: string) { try {
    const [part, sig] = token.split('.');
    if (!await crypto.subtle.verify('HMAC', await signingKey(), unb64(sig), enc.encode(part)))
        throw 0;
    const p = JSON.parse(new TextDecoder().decode(unb64(part)));
    if (p.type !== type || p.expires < now())
        throw 0;
    return p;
}
catch {
    throw new AppError('This link has expired or is invalid.', 400);
} }
export async function unsubscribe(token: string) { const p = await verifyLink(token, 'unsubscribe'); const c = row(await one('SELECT * FROM customers WHERE id=?', p.customer)); if (c) {
    c.data.emailMarketing = false;
    c.data.whatsappMarketing = false;
    c.data.consentUpdated = now();
    await run('UPDATE customers SET data=?,updated=? WHERE id=?', JSON.stringify(c.data), now(), c.id);
    if (c.email)
        await run('UPDATE subscribers SET consent=0 WHERE email=?', c.email);
} return { ok: true }; }
export async function restoreCart(token: string, owner: string) { const p = await verifyLink(token, 'cart'); const c = row(await one('SELECT * FROM carts WHERE id=? AND completed=0', p.cart)); if (!c || !c.items.length)
    throw new AppError('This cart has already been completed or is empty.'); const available = await all("SELECT id,stock FROM products WHERE status='published'"); const items = c.items.map((i: any) => ({ id: i.id, qty: Math.min(i.qty, available.find(x => x.id === i.id)?.stock || 0) })).filter((i: any) => i.qty > 0); await run('INSERT INTO carts VALUES (?,?,?,1,?,?,?,0) ON CONFLICT(owner) DO UPDATE SET items=excluded.items,version=version+1,updated=excluded.updated,completed=0', id(), owner, JSON.stringify(items), JSON.stringify({ recoveredFrom: c.id }), now(), now()); return { ok: true, count: items.length }; }
function segment(c: any, orders: any[], name: string, city: string) { const mine = orders.filter(o => o.owner === 'user:' + c.id && o.payment_status === 'paid' && !o.test); if (name === 'first')
    return mine.length === 1; if (name === 'repeat')
    return mine.length > 1; if (name === 'never')
    return !mine.length; if (name === 'high')
    return mine.reduce((n, o) => n + o.total, 0) >= 1000000; if (name === 'city')
    return mine.some(o => o.data.address.city.toLowerCase() === city.toLowerCase()); if (name === 'oud')
    return mine.some(o => o.items.some((i: any) => /oud/i.test(i.name))); return true; }
export async function runAutomations(origin: string, actor: string) {
    const s = await settings();
    const customers = (await all('SELECT * FROM customers')).map(row);
    const orders = (await all('SELECT * FROM orders')).map(row);
    const outcomes: any[] = [];
    let count = 0;
    for (const raw of await all("SELECT * FROM campaigns WHERE enabled=1 AND kind IN ('email','whatsapp')")) {
        const c = row(raw);
        if (c.data.scheduledAt && Date.parse(c.data.scheduledAt) > now())
            continue;
        for (const customer of customers) {
            if (count >= 30)
                break;
            const channel = c.kind;
            const allowed = channel === 'email' ? customer.data.emailMarketing && customer.email : customer.data.whatsappMarketing && customer.data.phone;
            if (!allowed || !segment(customer, orders, c.data.segment || 'all', c.data.city || ''))
                continue;
            if (await one('SELECT id FROM messages WHERE dedupe=?', 'campaign-' + c.id + '-' + c.updated + '-' + customer.id))
                continue;
            const unsubscribeToken = await signedLink({ type: 'unsubscribe', customer: customer.id, expires: now() + 90 * 86400000 });
            const lang = customer.language === 'fr' ? 'fr' : 'en';
            const text = (lang === 'fr' ? c.data.bodyFr : c.data.body) || c.data.body;
            const body = text + '\n\n' + origin + '/' + lang + '/unsubscribe?token=' + unsubscribeToken;
            try {
                const result = await sendMessage(channel, channel === 'email' ? customer.email : customer.data.phone, (lang === 'fr' ? c.data.subjectFr : c.data.subject) || c.name, body, 'campaign-' + c.id + '-' + c.updated + '-' + customer.id, 'user:' + customer.id, c.data.template);
                outcomes.push({ campaign: c.name, status: result.status });
                count++;
            }
            catch (e: any) {
                outcomes.push({ campaign: c.name, error: e.message });
                break;
            }
        }
    }
    if (s.recovery.enabled) {
        const carts = (await all("SELECT * FROM carts WHERE completed=0 AND items!='[]' AND owner LIKE 'user:%'")).map(row);
        for (const cart of carts) {
            if (count >= 30)
                break;
            const customer = customers.find(c => 'user:' + c.id === cart.owner);
            if (!customer)
                continue;
            const age = (now() - cart.updated) / 3600000;
            for (const hour of s.recovery.hours) {
                if (!Number.isFinite(hour) || hour <= 0 || age < hour)
                    continue;
                const channels = s.recovery.channel === 'both' ? ['email', 'whatsapp'] : [s.recovery.channel];
                for (const channel of channels) {
                    if (count >= 30)
                        break;
                    const allowed = channel === 'email' ? customer.data.emailMarketing && customer.email : customer.data.whatsappMarketing && customer.data.phone;
                    if (!allowed)
                        continue;
                    if (await one('SELECT id FROM messages WHERE dedupe=?', `recovery-${cart.id}-${cart.updated}-${hour}-${channel}`))
                        continue;
                    const latest = row(await one('SELECT * FROM carts WHERE id=?', cart.id));
                    const latestCustomer = row(await one('SELECT * FROM customers WHERE id=?', customer.id));
                    if (latest.completed || latest.updated !== cart.updated || !(channel === 'email' ? latestCustomer.data.emailMarketing : latestCustomer.data.whatsappMarketing))
                        continue;
                    const lang = customer.language === 'fr' ? 'fr' : 'en';
                    const token = await signedLink({ type: 'cart', cart: cart.id, expires: now() + 72 * 3600000 });
                    const unsub = await signedLink({ type: 'unsubscribe', customer: customer.id, expires: now() + 90 * 86400000 });
                    const subject = lang === 'fr' ? 'Votre découverte vous attend' : 'Your discovery is waiting';
                    const productIds = cart.items.map((i: any) => i.id);
                    const products = (await all('SELECT id,name,name_fr,price,data FROM products')).map(row).filter(p => productIds.includes(p.id));
                    const lines = products.map(p => (lang === 'fr' ? p.name_fr : p.name) + ' — ' + origin + p.data.images[0]).join('\n');
                    const body = subject + '\n\n' + lines + '\n\n' + origin + '/' + lang + '/recover?token=' + token + '\n\n' + origin + '/' + lang + '/unsubscribe?token=' + unsub;
                    try {
                        const r = await sendMessage(channel, channel === 'email' ? customer.email : customer.data.phone, subject, body, `recovery-${cart.id}-${cart.updated}-${hour}-${channel}`, cart.owner, s.recovery.template);
                        outcomes.push({ cart: cart.id, status: r.status });
                        count++;
                    }
                    catch (e: any) {
                        outcomes.push({ cart: cart.id, error: e.message });
                        break;
                    }
                }
            }
        }
    }
    await log(actor, 'automations_processed', String(count));
    return { processed: count, outcomes };
}
export async function orderNotifications(order: any, origin: string) { if (order.test)
    return; const s = await settings(); const d = order.data; const fr = d.language === 'fr'; const status = order.payment_status === 'paid' ? (fr ? 'Paiement vérifié' : 'Payment verified') : (fr ? 'Commande reçue — paiement en attente' : 'Order received — payment pending'); const text = `BUORGE PARIS · ${order.number}\n${status}\n${origin}/${fr ? 'fr' : 'en'}/orders/${order.id}`; const types = s.integrations; const result: any[] = []; if (types.email.order && types.email.enabled && d.address.email)
    try {
        result.push(await sendMessage('email', d.address.email, `BUORGE PARIS — ${order.number}`, text, `order-${order.id}-${order.status}-${order.payment_status}-email`, order.owner));
    }
    catch { } if (types.whatsapp.order && types.whatsapp.enabled && d.whatsappTransactional)
    try {
        result.push(await sendMessage('whatsapp', '91' + d.address.phone, order.number, text, `order-${order.id}-${order.status}-${order.payment_status}-whatsapp`, order.owner, types.whatsapp.template));
    }
    catch { } return result; }
export async function shippingAction(body: any, actor: string) {
    const o = row(await one('SELECT * FROM orders WHERE id=?', body.id));
    if (!o || o.test || o.payment_status !== 'paid')
        throw new AppError('Verified live order required.');
    const s = await settings();
    const p = s.integrations.shiprocket;
    if (!p.enabled)
        throw new AppError('Shiprocket: Configuration required.', 503);
    let result: any;
    if (body.action === 'couriers')
        return shiprocket('courier/serviceability/?' + new URLSearchParams({ pickup_postcode: p.pickupPincode, delivery_postcode: o.data.address.pincode, cod: '0', weight: String(p.weight) }));
    if (!o.data.shipmentId)
        throw new AppError('Create the shipment first.');
    if (body.action === 'assign') {
        if (o.data.tracking)
            return o.data;
        if (!Number.isInteger(Number(body.courierId)))
            throw new AppError('Select a valid courier.');
        result = await shiprocket('courier/assign/awb', 'POST', { shipment_id: o.data.shipmentId, courier_id: Number(body.courierId) });
        const awb = result.response?.data;
        if (!awb?.awb_code)
            throw new AppError('The provider did not return an AWB.', 502);
        o.data.tracking = awb.awb_code;
        o.data.courier = awb.courier_name;
    }
    else if (body.action === 'label') {
        result = await shiprocket('courier/generate/label', 'POST', { shipment_id: [o.data.shipmentId] });
        if (!result.label_url)
            throw new AppError('Label is not available yet.', 502);
        o.data.labelUrl = result.label_url;
    }
    else if (body.action === 'track') {
        result = await shiprocket('courier/track/shipment/' + encodeURIComponent(o.data.shipmentId));
        o.data.trackingResponse = result;
        const status = result.tracking_data?.shipment_status;
        const map: any = { 6: 'shipped', 7: 'delivered', 17: 'delivery_issue', 18: 'returned', 19: 'delivery_issue', 20: 'delivery_issue', 38: 'out_for_delivery' };
        if (map[status]) {
            o.status = map[status];
            o.data.history.push({ status: o.status, at: now(), source: 'shiprocket' });
        }
    }
    else
        throw new AppError('Invalid shipping action');
    await run('UPDATE orders SET status=?,data=?,updated=? WHERE id=?', o.status, JSON.stringify(o.data), now(), o.id);
    await log(actor, 'shipping_' + body.action, o.id);
    return { data: o.data, result };
}
