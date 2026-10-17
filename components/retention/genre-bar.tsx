'use client';

import * as React from 'react';

import type { Genre } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const KEY = 'retention:genre';

export function readSavedGenre(): string | null {
    try {
        return localStorage.getItem(KEY);
    } catch {
        return null;
    }
}

export function saveGenre(genre: string | null) {
    try {
        if (genre) localStorage.setItem(KEY, genre);
        else localStorage.removeItem(KEY);
    } catch {}
}

// Genre chips under the header. `null` = everything.
export function GenreBar({ genres, value, onChange, className }: { genres: Genre[] | null; value: string | null; onChange: (genre: string | null) => void; className?: string }) {
    if (!genres) {
        return (
            <div className={cn('flex gap-2', className)}>
                {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className='h-7 w-20 rounded-2xl' />
                ))}
            </div>
        );
    }

    const chips = [{ id: null, label: 'All', count: genres.reduce((n, g) => n + g.count, 0) }, ...genres];

    return (
        <div role='radiogroup' aria-label='Genre' className={cn('flex gap-2 overflow-x-auto', className)}>
            {chips.map((g) => {
                const active = g.id === value;
                return (
                    <Button
                        key={g.id ?? 'all'}
                        role='radio'
                        aria-checked={active}
                        size='sm'
                        variant={active ? 'default' : 'outline'}
                        disabled={g.count === 0}
                        onClick={() => !active && onChange(g.id)}
                    >
                        {g.label}
                        <span className={cn('tabular-nums', active ? 'opacity-70' : 'text-muted-foreground')}>{g.count}</span>
                    </Button>
                );
            })}
        </div>
    );
}
