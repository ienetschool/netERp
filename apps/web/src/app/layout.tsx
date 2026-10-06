import type { Metadata } from 'next';
import { Providers } from '@/components/Providers';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: {
    default: 'netERp — Enterprise Resource Planning',
    template: '%s · netERp',
  },
  description:
    'netERp unifies finance, sales, procurement, inventory, HR and payroll in one connected, permission-aware workspace.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
