import type { Metadata } from "next";
import "./design.css";
export const metadata: Metadata = {
    title: "BUORGE PARIS — A presence beyond words",
    description: "Discover French-inspired fragrances. Explore the BUORGE PARIS collection, with free shipping within serviceable India.",
    icons: {
        icon: "/favicon.svg",
        shortcut: "/favicon.svg",
    },
};
export default function RootLayout({ children, }: Readonly<{
    children: React.ReactNode;
}>) {
    return (<html lang="en">
      <body className="antialiased">{children}</body>
    </html>);
}
