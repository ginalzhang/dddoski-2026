'use client';

import * as React from 'react';
import { ChevronDownIcon, ChevronUpIcon, LockIcon, MessageCircleIcon, Share2Icon, ThumbsUpIcon } from 'lucide-react';

import type { Short, UserStats } from '@/lib/api';
import { formatCount, formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function Wordmark({ className }: { className?: string }) {
    return (
        <div className={cn('flex items-center gap-2', className)}>
            <span className='relative flex size-2.5'>
                <span className='absolute inset-0 animate-ping rounded-full bg-primary opacity-60 motion-reduce:hidden' />
                <span className='relative size-2.5 rounded-full bg-primary' />
            </span>
            <span className='font-heading text-lg font-semibold tracking-tight'>Retention</span>
        </div>
    );
}

export function StatsHeader({ stats }: { stats: UserStats | null }) {
    const items = [
        { label: 'Passed', value: stats?.passed, hint: 'Videos you were allowed to leave.' },
        { label: 'Failed', value: stats?.failed, hint: 'Quizzes you got wrong. We keep count.' },
        {
            label: 'Rewatched',
            value: stats ? formatDuration(stats.secondsRewatched) : undefined,
            hint: 'Time spent watching things you already watched.',
            minor: true,
        },
        { label: 'Streak', value: stats?.streak, hint: 'First-try passes in a row.', minor: true },
    ];

    return (
        <header className='flex h-14 shrink-0 items-center justify-between gap-6 px-6'>
            <div className='flex items-center gap-3'>
                <Wordmark />
            </div>
            <dl className='flex items-center gap-4'>
                {items.map((item, i) => (
                    <React.Fragment key={item.label}>
                        {i > 0 && <Separator orientation='vertical' className={cn('h-6', item.minor && 'max-sm:hidden')} />}
                        <Tooltip>
                            <TooltipTrigger render={<div className={cn('flex flex-col items-end gap-0.5', item.minor && 'max-sm:hidden')} />}>
                                <dt className='text-[11px] leading-none tracking-wide text-muted-foreground uppercase'>{item.label}</dt>
                                <dd className='text-sm leading-none font-medium tabular-nums'>{item.value === undefined ? <Skeleton className='h-3.5 w-6' /> : item.value}</dd>
                            </TooltipTrigger>
                            <TooltipContent>{item.hint}</TooltipContent>
                        </Tooltip>
                    </React.Fragment>
                ))}
            </dl>
        </header>
    );
}

type ActionRailProps = {
    short: Short;
    onLike: () => void;
    onComments: () => void;
    onShare: () => void;
};

export function ActionRail({ short, onLike, onComments, onShare }: ActionRailProps) {
    return (
        <div className='flex flex-col items-center gap-4 pb-2'>
            <RailAction label={short.likedByMe ? 'Unlike' : 'Like'} count={formatCount(short.likes)} pressed={short.likedByMe} onClick={onLike}>
                <ThumbsUpIcon className={cn(short.likedByMe && 'fill-current')} />
            </RailAction>
            <RailAction label='Comments' count={formatCount(short.commentsCount)} onClick={onComments}>
                <MessageCircleIcon />
            </RailAction>
            <RailAction label='Share' count='Share' onClick={onShare}>
                <Share2Icon />
            </RailAction>
        </div>
    );
}

function RailAction({ label, count, pressed, onClick, children }: { label: string; count: string; pressed?: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <div className='flex flex-col items-center gap-1.5'>
            <Button variant={pressed ? 'default' : 'secondary'} size='icon-lg' className='size-12 rounded-full' aria-label={label} aria-pressed={pressed} onClick={onClick}>
                {children}
            </Button>
            <span className='text-xs font-medium tabular-nums'>{count}</span>
        </div>
    );
}

type FeedNavProps = {
    locked: boolean;
    onPrev: () => void;
    onNext: () => void;
};

export function FeedNav({ locked, onPrev, onNext }: FeedNavProps) {
    return (
        <div className='flex flex-col gap-3'>
            <Tooltip>
                <TooltipTrigger
                    render={<Button variant='secondary' size='icon-lg' className='size-12 rounded-full text-muted-foreground' aria-label='Previous video' onClick={onPrev} />}
                >
                    <ChevronUpIcon />
                </TooltipTrigger>
                <TooltipContent side='left'>No going back</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button
                            variant='secondary'
                            size='icon-lg'
                            className='relative size-12 rounded-full'
                            aria-label={locked ? 'Next video (locked)' : 'Next video'}
                            onClick={onNext}
                        />
                    }
                >
                    <ChevronDownIcon />
                    {locked && (
                        <span className='absolute -top-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-background ring-1 ring-border'>
                            <LockIcon className='size-3' />
                        </span>
                    )}
                </TooltipTrigger>
                <TooltipContent side='left'>{locked ? 'Finish the video to unlock' : 'Take the quiz'}</TooltipContent>
            </Tooltip>
        </div>
    );
}

export function KeyboardHints({ className }: { className?: string }) {
    const hints: [string, string][] = [
        ['↓', 'Next'],
        ['Space', 'Pause'],
        ['M', 'Mute'],
        ['L', 'Like'],
        ['C', 'Comments'],
    ];
    return (
        <div className={cn('flex flex-col gap-2 text-xs text-muted-foreground', className)}>
            {hints.map(([key, label]) => (
                <div key={key} className='flex items-center gap-2'>
                    <Kbd>{key}</Kbd>
                    <span>{label}</span>
                </div>
            ))}
        </div>
    );
}
