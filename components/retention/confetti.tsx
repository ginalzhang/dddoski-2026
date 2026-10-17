'use client';

import { motion } from 'motion/react';

const COLORS = ['#e11d48', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ffffff'];

export type ConfettiPiece = { id: string; x: number; y: number; rotate: number; color: string; w: number; delay: number };

// Random pieces for one burst. Call from an event handler, not during render.
export function makeConfetti(): ConfettiPiece[] {
    const key = Date.now();
    return Array.from({ length: 70 }, (_, i) => ({
        id: `${key}-${i}`,
        x: (Math.random() - 0.5) * 900,
        y: -300 - Math.random() * 450,
        rotate: (Math.random() - 0.5) * 720,
        color: COLORS[i % COLORS.length],
        w: 6 + Math.random() * 6,
        delay: Math.random() * 0.15,
    }));
}

// One-shot burst from the bottom centre.
export function Confetti({ pieces }: { pieces: ConfettiPiece[] }) {
    if (!pieces.length) return null;
    return (
        <div aria-hidden className='pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex justify-center'>
            {pieces.map((p) => (
                <motion.span
                    key={p.id}
                    className='absolute bottom-0 rounded-[2px]'
                    style={{ width: p.w, height: p.w * 0.45, backgroundColor: p.color }}
                    initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
                    animate={{ x: p.x, y: [0, p.y, p.y + 500], rotate: p.rotate, opacity: [1, 1, 0] }}
                    transition={{ duration: 1.8, delay: p.delay, ease: 'easeOut', times: [0, 0.45, 1] }}
                />
            ))}
        </div>
    );
}
