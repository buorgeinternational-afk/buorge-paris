import Store from '../store';
import { one, row } from '../lib/server';
const origin = 'https://buorge-paris.ajmal-team-9531.chatgpt.site';
export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: any) { const p = await params; const parts = p.path || []; const fr = parts[0] === 'fr'; const language = fr ? 'fr' : 'en'; const route = parts[0] === 'en' || parts[0] === 'fr' ? parts.slice(1) : parts; let title = fr ? 'BUORGE PARIS — Une présence au-delà des mots' : 'BUORGE PARIS — A presence beyond words'; let description = fr ? 'Découvrez les parfums d’inspiration française de BUORGE PARIS. Livraison offerte en Inde dans les zones desservies.' : 'Discover the French-inspired fragrance collection from BUORGE PARIS. Complimentary delivery within serviceable India.'; if (route[0] === 'products' && route[1])
    try {
        const product = row(await one("SELECT * FROM products WHERE slug=? AND status='published'", route[1]));
        if (product) {
            title = (fr ? product.name_fr : product.data.seoTitle || product.name) + ' | BUORGE PARIS';
            description = fr ? product.data.descriptionFr : product.data.seoDescription || product.data.description;
        }
    }
    catch { } return { title, description, alternates: { canonical: origin + '/' + language + '/' + route.join('/'), languages: { en: origin + '/en/' + route.join('/'), fr: origin + '/fr/' + route.join('/'), 'x-default': origin + '/en/' + route.join('/') } }, robots: { index: false, follow: false }, openGraph: { title, description, locale: fr ? 'fr_FR' : 'en_IN', siteName: 'BUORGE PARIS', images: [origin + '/assets/hero-oud-noir.webp'] } }; }
export default function Page() { return <Store />; }
