export async function api(path: string, body?: any): Promise<any> { const r = await fetch('/api/' + path, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : body instanceof FormData ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }); const d: any = await r.json(); if (!r.ok)
    throw new Error(d.error || 'Request failed'); return d; }
export const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value / 100);
export const date = (v: number) => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
