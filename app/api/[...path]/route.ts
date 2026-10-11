import { runAutomations, restoreCart, unsubscribe, shippingAction, orderNotifications } from '../../lib/operations';
import { authRequest, sessionCookie } from '../../lib/customer-auth';
import { E, db, now, id, parse, row, all, one, run, seed, settings, identity, admin, AppError, rate, log, safeText, validImage, catalog, getCart, setSecrets, secrets, discountRows, shiprocket, sendMessage } from '../../lib/server';
export const dynamic = 'force-dynamic';
const json = (v: any, status = 200, extra: any = {}) => Response.json(v, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra } });
async function handle(req: Request) {
    let ctx: any;
    try {
        const url = new URL(req.url);
        const path = url.pathname.replace(/^\/api\//, '');
        const method = req.method;
        const jobAuthorized = path === 'automation/run' && E.AUTOMATION_TOKEN && req.headers.get('authorization') === 'Bearer ' + E.AUTOMATION_TOKEN;
        if (method !== 'GET' && !jobAuthorized && req.headers.get('origin') !== url.origin)
            throw new AppError('Invalid request origin.', 403);
        if (Number(req.headers.get('content-length') || 0) > 12 * 1024 * 1024)
            throw new AppError('File is too large.', 413);
        await seed();
        ctx = await identity(req);
        const respond = (data: any, status = 200) => json(data, status, ctx.authCookie ? { 'Set-Cookie': ctx.authCookie } : ctx.fresh ? { 'Set-Cookie': `bp_guest=${ctx.owner.slice(6)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${url.protocol === 'https:' ? '; Secure' : ''}` } : {});
        const body = async () => { try {
            return await req.json() as any;
        }
        catch {
            throw new AppError('Invalid request body.');
        } };
        if (path === 'automation/run' && method === 'POST') {
            if (!jobAuthorized)
                throw new AppError('Automation authorization required.', 403);
            return respond(await runAutomations(url.origin, 'scheduler'));
        }
        if (path.startsWith('media/') && method === 'GET') {
            const key = path.slice(6);
            if (!/^[a-zA-Z0-9_.-]+$/.test(key))
                throw new AppError('Not found', 404);
            const object = await E.BUCKET.get(key);
            if (!object)
                throw new AppError('Not found', 404);
            return new Response(object.body, { headers: { 'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
        }
        if (path === 'bootstrap' && method === 'GET') {
            const s = await settings();
            const u = ctx.user;
            const platform = ctx.platform;
            return respond({ products: await catalog(), settings: s, offers: await discountRows(), user: u ? { id: u.userId, name: u.displayName, email: u.email } : null, isAdmin: !!(platform && await one('SELECT id FROM admins WHERE id=?', platform.userId)), needsSetup: !(await one('SELECT id FROM admins LIMIT 1')), cart: await getCart(ctx.owner), wishlist: parse((await one('SELECT items FROM wishlists WHERE owner=?', ctx.owner))?.items || '[]') });
        }
        if (path === 'auth/send' && method === 'POST') {
            await rate('otp:' + ctx.owner, 4);
            const b = await body();
            const email = safeText(b.email, 254).toLowerCase();
            const phone = safeText(b.phone, 20);
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone && !/^\+91[6-9][0-9]{9}$/.test(phone) || !email && !phone)
                throw new AppError('Enter a valid email or Indian mobile number.');
            await authRequest('otp', { ...(email ? { email } : { phone }), create_user: true });
            return respond({ ok: true });
        }
        if (path === 'auth/verify' && method === 'POST') {
            await rate('verify:' + ctx.owner, 8);
            const b = await body();
            if (!/^[0-9]{6,8}$/.test(b.token))
                throw new AppError('Enter the verification code.');
            const session = await authRequest('verify', { ...(b.email ? { email: safeText(b.email, 254).toLowerCase(), type: 'email' } : { phone: safeText(b.phone, 20), type: 'sms' }), token: b.token });
            if (!session.access_token)
                throw new AppError('Verification did not create a session.');
            return json({ ok: true }, 200, { 'Set-Cookie': await sessionCookie(session, url.protocol === 'https:') });
        }
        if (path === 'auth/logout' && method === 'POST')
            return json({ ok: true }, 200, { 'Set-Cookie': 'bp_customer=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
        if (path === 'cart') {
            if (method === 'POST') {
                await rate(ctx.owner);
                const b = await body();
                const p = await one("SELECT * FROM products WHERE id=? AND status='published'", safeText(b.id, 100));
                if (!p)
                    throw new AppError('Product unavailable.');
                if (!Number.isInteger(b.qty) || b.qty < 0 || b.qty > Math.min(10, p.stock))
                    throw new AppError('Please choose an available quantity.');
                const c = await getCart(ctx.owner);
                const items = c.items.filter((i: any) => i.id !== p.id);
                if (b.qty)
                    items.push({ id: p.id, qty: b.qty });
                await run('UPDATE carts SET items=?,version=version+1,updated=?,completed=0 WHERE owner=?', JSON.stringify(items), now(), ctx.owner);
                await run('INSERT INTO events VALUES (?,?,?,?,?)', id(), ctx.owner, b.qty ? 'add_to_cart' : 'remove_from_cart', JSON.stringify({ product: p.id }), now());
            }
            return respond(await getCart(ctx.owner));
        }
        if (path === 'wishlist' && method === 'POST') {
            const b = await body();
            const p = await one('SELECT id FROM products WHERE id=?', safeText(b.id, 100));
            if (!p)
                throw new AppError('Product unavailable.');
            let items = parse((await one('SELECT items FROM wishlists WHERE owner=?', ctx.owner))?.items || '[]');
            items = items.includes(p.id) ? items.filter((x: any) => x !== p.id) : [...items, p.id];
            await run('INSERT INTO wishlists VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET items=excluded.items', ctx.owner, JSON.stringify(items));
            return respond(items);
        }
        if (path === 'events' && method === 'POST') {
            await rate(ctx.owner, 120);
            const b = await body();
            if (!['visit', 'category_view', 'product_view', 'view_cart', 'begin_checkout', 'shipping_details', 'payment_method', 'payment_submitted'].includes(b.name))
                throw new AppError('Invalid event');
            await run('INSERT INTO events VALUES (?,?,?,?,?)', id(), ctx.owner, b.name, JSON.stringify({ path: safeText(b.path, 200), product: safeText(b.product, 100) }), now());
            return respond({ ok: true });
        }
        if (path === 'subscribe' && method === 'POST') {
            await rate(ctx.owner, 5);
            const b = await body();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email) || b.consent !== true)
                throw new AppError('Please enter a valid email and accept marketing emails.');
            await run('INSERT INTO subscribers VALUES (?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET consent=1,language=excluded.language', b.email.toLowerCase(), b.language === 'fr' ? 'fr' : 'en', 1, id(), now());
            return respond({ ok: true });
        }
        if (path === 'recover' && method === 'POST') {
            const b = await body();
            return respond(await restoreCart(safeText(b.token, 4000), ctx.owner));
        }
        if (path === 'unsubscribe' && method === 'POST') {
            const b = await body();
            return respond(await unsubscribe(safeText(b.token, 4000)));
        }
        if (path === 'account') {
            if (!ctx.user)
                throw new AppError('Please sign in to your account.', 401);
            let c = await one('SELECT * FROM customers WHERE id=?', ctx.user.userId);
            if (!c) {
                await run('INSERT OR IGNORE INTO customers VALUES (?,?,?,?,?,?,?)', ctx.user.userId, ctx.user.email, ctx.user.displayName, 'en', '{}', now(), now());
                c = await one('SELECT * FROM customers WHERE id=?', ctx.user.userId);
            }
            if (method === 'POST') {
                const b = await body();
                const data = { phone: safeText(b.phone, 20), addresses: Array.isArray(b.addresses) ? b.addresses.slice(0, 10) : [], emailMarketing: b.emailMarketing === true, whatsappMarketing: b.whatsappMarketing === true, whatsappTransactional: b.whatsappTransactional === true, consentUpdated: now() };
                await run('UPDATE customers SET name=?,language=?,data=?,updated=? WHERE id=?', safeText(b.name, 100) || ctx.user.displayName, b.language === 'fr' ? 'fr' : 'en', JSON.stringify(data), now(), ctx.user.userId);
                c = await one('SELECT * FROM customers WHERE id=?', ctx.user.userId);
            }
            return respond({ profile: row(c), orders: (await all('SELECT * FROM orders WHERE owner=? ORDER BY created DESC', ctx.owner)).map(row) });
        }
        if (path === 'account/request' && method === 'POST') {
            if (!ctx.user)
                throw new AppError('Sign in required.', 401);
            const b = await body();
            if (!['delete', 'export'].includes(b.kind))
                throw new AppError('Invalid request');
            await run('INSERT INTO requests VALUES (?,?,?,?,?)', id(), ctx.owner, b.kind, 'pending', now());
            return respond({ ok: true });
        }
        if (path === 'serviceability' && method === 'POST') {
            const b = await body();
            if (!/^[1-9][0-9]{5}$/.test(b.pincode))
                throw new AppError('Enter a valid Indian PIN code.');
            const s = await settings();
            if (s.payments.mode === 'test')
                return respond({ test: true, message: 'Test checkout. Live delivery serviceability is not yet verified.' });
            if (!s.integrations.shiprocket.enabled)
                throw new AppError('Shipping configuration required before live checkout.', 503);
            const r = await shiprocket('courier/serviceability/?' + new URLSearchParams({ pickup_postcode: s.integrations.shiprocket.pickupPincode, delivery_postcode: b.pincode, cod: '0', weight: String(s.integrations.shiprocket.weight) }));
            return respond({ serviceable: !!r.data?.available_courier_companies?.length, shipping: 0 });
        }
        if (path === 'checkout' && method === 'POST') {
            await rate(ctx.owner, 8);
            const b = await body();
            const existing = await one('SELECT * FROM orders WHERE checkout_key=?', safeText(b.key, 100));
            if (existing) {
                if (existing.owner !== ctx.owner)
                    throw new AppError('Invalid checkout key', 403);
                return respond(row(existing));
            }
            const s = await settings();
            if (!s.payments.enabled)
                throw new AppError('Checkout is currently unavailable.');
            const a = b.address || {};
            for (const k of ['name', 'address', 'city', 'state'])
                if (!safeText(a[k], 300))
                    throw new AppError('Please complete your delivery address.');
            if (!/^[6-9][0-9]{9}$/.test(a.phone) || !/^[1-9][0-9]{5}$/.test(a.pincode) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email))
                throw new AppError('Check your Indian phone number, PIN code and email.');
            if (!b.key || !b.reference || String(b.reference).length > 100)
                throw new AppError('Enter your payment reference.');
            const c = await getCart(ctx.owner);
            if (b.key !== c.id + ':' + c.version)
                throw new AppError('Your bag has changed. Please refresh.');
            if (!c.lines.length || c.lines.length !== c.items.length)
                throw new AppError('Your bag has changed. Please review it.');
            if (c.lines.some((l: any) => l.qty > l.product.stock))
                throw new AppError('Some products are no longer available in that quantity.');
            const test = s.payments.mode !== 'live';
            if (!test) {
                if (!s.payments.upiId || !s.payments.receiver || !s.integrations.shiprocket.enabled)
                    throw new AppError('Payment and shipping configuration required.', 503);
                if (c.lines.some((l: any) => l.product.data.sample))
                    throw new AppError('Sample products cannot be ordered in live mode.');
                const sr = await shiprocket('courier/serviceability/?' + new URLSearchParams({ pickup_postcode: s.integrations.shiprocket.pickupPincode, delivery_postcode: a.pincode, cod: '0', weight: String(s.integrations.shiprocket.weight) }));
                if (!sr.data?.available_courier_companies?.length)
                    throw new AppError('This PIN code is not serviceable.');
            }
            const orderId = id();
            const number = 'BP-' + new Date().getUTCFullYear() + '-' + orderId.slice(0, 8).toUpperCase();
            const items = c.lines.map((l: any) => ({ id: l.id, name: l.product.name, nameFr: l.product.name_fr, sku: l.product.data.sku, qty: l.qty, price: l.product.effectivePrice, image: l.product.data.images[0], size: l.product.data.size }));
            const data = { address: Object.fromEntries(['name', 'address', 'city', 'state', 'phone', 'pincode', 'email'].map(k => [k, safeText(a[k], 300)])), reference: safeText(b.reference, 100), language: b.language === 'fr' ? 'fr' : 'en', shipping: 0, country: 'IN', emailMarketing: b.emailMarketing === true, whatsappMarketing: b.whatsappMarketing === true, whatsappTransactional: b.whatsappTransactional === true, consentAt: now(), history: [{ status: 'pending_verification', at: now() }] };
            const stmts = c.lines.map((l: any) => db().prepare('UPDATE products SET stock=CASE WHEN price=? AND status=? THEN stock-? ELSE -1 END WHERE id=?').bind(l.product.price, 'published', l.qty, l.id));
            stmts.push(db().prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(orderId, safeText(b.key, 100), ctx.owner, number, 'pending_verification', 'pending', c.total, JSON.stringify(items), JSON.stringify(data), test ? 1 : 0, now(), now()));
            stmts.push(db().prepare("UPDATE carts SET items='[]',version=version+1,completed=1,updated=?,data=? WHERE owner=?").bind(now(), JSON.stringify({ orderId }), ctx.owner));
            stmts.push(db().prepare('INSERT INTO events VALUES (?,?,?,?,?)').bind(id(), ctx.owner, 'order_submitted', JSON.stringify({ orderId, test }), now()));
            try {
                await db().batch(stmts);
            }
            catch {
                const dupe = await one('SELECT * FROM orders WHERE checkout_key=? AND owner=?', b.key, ctx.owner);
                if (dupe)
                    return respond(row(dupe));
                throw new AppError('Availability changed. Please refresh your bag.');
            }
            const saved = row(await one('SELECT * FROM orders WHERE id=?', orderId));
            await orderNotifications(saved, url.origin);
            return respond(saved, 201);
        }
        if (path.startsWith('orders/') && method === 'GET') {
            const o = await one('SELECT * FROM orders WHERE id=? AND owner=?', path.split('/')[1], ctx.owner);
            if (!o)
                throw new AppError('Order not found.', 404);
            return respond(row(o));
        }
        if (path === 'admin/setup' && method === 'POST') {
            await rate('admin-setup:' + ctx.owner, 5);
            if (!ctx.platform)
                throw new AppError('Sign in with ChatGPT first.', 401);
            const b = await body();
            if (!E.ADMIN_SETUP_TOKEN || b.token !== E.ADMIN_SETUP_TOKEN)
                throw new AppError('Invalid setup key.', 403);
            const r = await run('INSERT INTO admins SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM admins)', ctx.platform.userId, ctx.platform.email, now());
            if (!r.meta.changes)
                throw new AppError('Administrator already configured.', 409);
            await log(ctx.user.userId, 'administrator_setup', ctx.user.email);
            return respond({ ok: true });
        }
        if (path.startsWith('admin/')) {
            const u = await admin();
            await rate('admin:' + u.userId, 160);
            const action = path.slice(6);
            if (action === 'run-automations' && method === 'POST')
                return respond(await runAutomations(url.origin, u.userId));
            if (action === 'shipping-action' && method === 'POST')
                return respond(await shippingAction(await body(), u.userId));
            if (action === 'overview') {
                const orders = (await all('SELECT * FROM orders ORDER BY created DESC LIMIT 500')).map(row);
                const ev = await all('SELECT name,COUNT(*) count,COUNT(DISTINCT visitor) visitors FROM events GROUP BY name');
                const sec = await secrets();
                return respond({ orders, products: await catalog(true), customers: (await all('SELECT * FROM customers ORDER BY created DESC LIMIT 500')).map(row), campaigns: (await all('SELECT * FROM campaigns')).map(row), carts: (await all("SELECT * FROM carts WHERE completed=0 AND items!='[]' ORDER BY updated DESC LIMIT 200")).map(row), subscribers: await all('SELECT email,language,consent,created FROM subscribers'), messages: (await all('SELECT * FROM messages ORDER BY created DESC LIMIT 100')).map(row), audit: await all('SELECT * FROM audit ORDER BY created DESC LIMIT 100'), requests: await all('SELECT * FROM requests ORDER BY created DESC'), events: ev, settings: await settings(), secretStatus: Object.fromEntries(Object.keys(sec).map(k => [k, true])) });
            }
            if (action === 'product' && method === 'POST') {
                const b = await body();
                if (!safeText(b.name, 150) || !safeText(b.name_fr, 150) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(b.slug))
                    throw new AppError('Enter both product names and a valid URL slug.');
                if (!Number.isInteger(b.price) || b.price < 0 || !Number.isInteger(b.stock) || b.stock < 0 || b.stock > 100000 || !Number.isInteger(b.mrp) || b.mrp < b.price)
                    throw new AppError('Check price, MRP and stock.');
                if (!['draft', 'published', 'archived'].includes(b.status))
                    throw new AppError('Invalid status.');
                if (!Array.isArray(b.data?.images) || b.data.images.some((x: any) => typeof x !== 'string' || !validImage(x)))
                    throw new AppError('Invalid product images.');
                const pid = b.id || id();
                await run('INSERT INTO products VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,name=excluded.name,name_fr=excluded.name_fr,category=excluded.category,gender=excluded.gender,family=excluded.family,price=excluded.price,mrp=excluded.mrp,stock=excluded.stock,status=excluded.status,data=excluded.data,updated=excluded.updated', pid, b.slug, safeText(b.name, 150), safeText(b.name_fr, 150), safeText(b.category, 50), safeText(b.gender, 20), safeText(b.family, 50), b.price, b.mrp, b.stock, b.status, JSON.stringify(b.data), now());
                await log(u.userId, 'product_saved', pid);
                return respond({ id: pid });
            }
            if (action === 'upload' && method === 'POST') {
                const f = (await req.formData()).get('file');
                if (!(f instanceof File) || !['image/png', 'image/jpeg', 'image/webp'].includes(f.type) || f.size > 10 * 1024 * 1024)
                    throw new AppError('Upload a PNG, JPEG or WebP under 10 MB.');
                const bytes = new Uint8Array(await f.arrayBuffer());
                if (!(bytes[0] === 137 && bytes[1] === 80 || bytes[0] === 255 && bytes[1] === 216 || bytes[0] === 82 && bytes[1] === 73))
                    throw new AppError('Invalid image file.');
                const key = id() + '.' + (f.type === 'image/jpeg' ? 'jpg' : f.type.split('/')[1]);
                await E.BUCKET.put(key, bytes, { httpMetadata: { contentType: f.type } });
                await log(u.userId, 'image_uploaded', key);
                return respond({ url: '/api/media/' + key });
            }
            if (action === 'settings' && method === 'POST') {
                const b = await body();
                if (!['store', 'payments', 'homepage', 'popup', 'recovery', 'integrations', 'policies', 'translations', 'authentication'].includes(b.key))
                    throw new AppError('Invalid settings group');
                if (JSON.stringify(b.value).length > 100000)
                    throw new AppError('Settings too large');
                if (b.key === 'payments' && b.value.mode === 'live' && (!b.value.upiId || !b.value.receiver))
                    throw new AppError('A real UPI ID and receiver are required for live mode.');
                if (b.key === 'store' && b.value.whatsappEnabled && !/^[1-9][0-9]{9,14}$/.test(b.value.whatsapp))
                    throw new AppError('Enter your international WhatsApp number, digits only.');
                await run('INSERT INTO settings VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated=excluded.updated', b.key, JSON.stringify(b.value), now());
                await log(u.userId, 'settings_saved', b.key);
                return respond({ ok: true });
            }
            if (action === 'secrets' && method === 'POST') {
                await setSecrets(await body());
                await log(u.userId, 'integration_credentials_updated', 'secrets');
                return respond({ ok: true });
            }
            if (action === 'campaign' && method === 'POST') {
                const b = await body();
                if (!b.name || !['discount', 'email', 'whatsapp'].includes(b.kind))
                    throw new AppError('Campaign name and type required');
                if (b.kind === 'discount' && (!Number.isFinite(b.data.value) || b.data.value < 0 || (b.data.type !== 'fixed' && b.data.value > 100)))
                    throw new AppError('Invalid discount');
                const cid = b.id || id();
                await run('INSERT INTO campaigns VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,name=excluded.name,enabled=excluded.enabled,data=excluded.data,updated=excluded.updated', cid, b.kind, safeText(b.name, 150), b.enabled ? 1 : 0, JSON.stringify(b.data), now());
                await log(u.userId, 'campaign_saved', cid);
                return respond({ id: cid });
            }
            if (action === 'order' && method === 'POST') {
                const b = await body();
                const o = row(await one('SELECT * FROM orders WHERE id=?', b.id));
                if (!o)
                    throw new AppError('Order not found', 404);
                if (!['paid', 'failed', 'clarification', 'cancelled', 'processing', 'shipped', 'delivered', 'returned'].includes(b.status))
                    throw new AppError('Invalid order status');
                if (o.status === 'cancelled' || o.status === 'returned')
                    throw new AppError('This order is closed.');
                if (['processing', 'shipped', 'delivered'].includes(b.status) && o.payment_status !== 'paid')
                    throw new AppError('Verify payment before fulfilment.');
                if (b.status === 'paid' && b.verified !== true)
                    throw new AppError('Confirm that you verified the payment.');
                if (b.status === 'cancelled' && o.payment_status === 'paid')
                    throw new AppError('Paid orders require a return/refund review.');
                const d = { ...o.data, tracking: safeText(b.tracking || o.data.tracking, 100), courier: safeText(b.courier || o.data.courier, 100), history: [...o.data.history, { status: b.status, at: now(), note: safeText(b.note, 1000) }] };
                const status = b.status === 'paid' ? 'processing' : b.status;
                const pay = b.status === 'paid' ? 'paid' : b.status === 'failed' ? 'failed' : o.payment_status;
                const stmts = [db().prepare('UPDATE orders SET status=?,payment_status=?,data=?,updated=? WHERE id=? AND status=? AND updated=?').bind(status, pay, JSON.stringify(d), now(), o.id, o.status, o.updated)];
                if (b.status === 'cancelled')
                    for (const i of o.items)
                        stmts.unshift(db().prepare('UPDATE products SET stock=stock+? WHERE id=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND status=? AND updated=?)').bind(i.qty, i.id, o.id, o.status, o.updated));
                const updated = await db().batch(stmts);
                if (!updated[updated.length - 1].meta.changes)
                    throw new AppError('Order changed. Reload before updating.', 409);
                await log(u.userId, 'order_' + b.status, o.id);
                await orderNotifications(row(await one('SELECT * FROM orders WHERE id=?', o.id)), url.origin);
                return respond({ ok: true });
            }
            if (action === 'ship' && method === 'POST') {
                const b = await body();
                const o = row(await one('SELECT * FROM orders WHERE id=?', b.id));
                if (!o || o.payment_status !== 'paid' || o.test)
                    throw new AppError('Only verified live orders can be shipped.');
                const s = await settings();
                if (!s.integrations.shiprocket.enabled)
                    throw new AppError('Shiprocket: Configuration required.', 503);
                if (o.data.shipmentId)
                    return respond(o.data);
                if (o.data.shipmentPending)
                    throw new AppError('Shipment creation requires reconciliation in Shiprocket before retry.', 409);
                const locked = await run("UPDATE orders SET data=json_set(data,'$.shipmentPending',1) WHERE id=? AND json_extract(data,'$.shipmentPending') IS NULL", o.id);
                if (!locked.meta.changes)
                    throw new AppError('Shipment already being created.', 409);
                const a = o.data.address;
                const p = s.integrations.shiprocket;
                const r = await shiprocket('orders/create/adhoc', 'POST', { order_id: o.number, order_date: new Date(o.created).toISOString().slice(0, 16).replace('T', ' '), pickup_location: p.pickup, billing_customer_name: a.name, billing_last_name: '', billing_address: a.address, billing_city: a.city, billing_pincode: a.pincode, billing_state: a.state, billing_country: 'India', billing_email: a.email, billing_phone: a.phone, shipping_is_billing: true, order_items: o.items.map((i: any) => ({ name: i.name, sku: i.sku, units: i.qty, selling_price: i.price / 100 })), payment_method: 'Prepaid', sub_total: o.total / 100, shipping_charges: 0, length: p.length, breadth: p.width, height: p.height, weight: p.weight });
                const d = { ...o.data, shipmentPending: false, shipmentId: r.shipment_id, shiprocketOrderId: r.order_id };
                await run('UPDATE orders SET data=?,updated=? WHERE id=?', JSON.stringify(d), now(), o.id);
                await log(u.userId, 'shipment_created', o.id);
                return respond(d);
            }
            if (action === 'tracking' && method === 'POST') {
                const b = await body();
                const o = row(await one('SELECT * FROM orders WHERE id=?', b.id));
                if (!o?.data.shipmentId)
                    throw new AppError('No shipment attached.');
                const r = await shiprocket('courier/track/shipment/' + encodeURIComponent(o.data.shipmentId));
                o.data.trackingResponse = r;
                o.data.trackingUpdated = now();
                await run('UPDATE orders SET data=?,updated=? WHERE id=?', JSON.stringify(o.data), now(), o.id);
                return respond(r);
            }
            if (action === 'test-email' && method === 'POST') {
                const b = await body();
                return respond(await sendMessage('email', u.email, 'BUORGE PARIS — connection test', 'Your transactional email connection is working.', 'test-' + id(), 'user:' + u.userId));
            }
            if (action === 'export' && method === 'GET') {
                return respond({ exportedAt: now(), products: await catalog(true), settings: await settings(), orders: (await all('SELECT * FROM orders')).map(row), customers: (await all('SELECT * FROM customers')).map(row), campaigns: (await all('SELECT * FROM campaigns')).map(row), audit: await all('SELECT * FROM audit') });
            }
        }
        throw new AppError('Not found.', 404);
    }
    catch (e: any) {
        console.error('API error', e instanceof AppError ? e.message : String(e));
        return json({ error: e instanceof AppError ? e.message : 'The request could not be completed. Please try again.' }, e instanceof AppError ? e.status : 500);
    }
}
export const GET = handle;
export const POST = handle;
