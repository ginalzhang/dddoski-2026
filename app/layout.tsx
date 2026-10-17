import type { Metadata } from 'next';
import { Space_Grotesk, Figtree } from 'next/font/google';
import './globals.css';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';

const figtreeHeading = Figtree({ subsets: ['latin'], variable: '--font-heading' });

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
    title: 'DDoski Hack Night 2026',
    description: 'DDoski Hack Night 2026 Project Submission',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
    return (
        <html lang='en' className={cn('dark h-full', 'antialiased', 'font-sans', spaceGrotesk.variable, figtreeHeading.variable)}>
            <body className='min-h-full flex flex-col'>
                <Toaster>
                    <TooltipProvider>{children}</TooltipProvider>
                </Toaster>
            </body>
        </html>
    );
}
