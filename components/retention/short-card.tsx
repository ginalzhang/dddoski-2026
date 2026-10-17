'use client';

import * as React from 'react';
import Image from 'next/image';
import { AnimatePresence, motion, type MotionValue } from 'motion/react';
import { BadgeCheckIcon, LockOpenIcon, PlayIcon, RotateCcwIcon, Volume2Icon, VolumeXIcon } from 'lucide-react';

import type { Short } from '@/lib/api';
import { initials } from '@/lib/format';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Spinner } from '@/components/ui/spinner';
import { ShortPlayer, type PlayerStatus, type ShortPlayerHandle } from '@/components/retention/short-player';

export type Phase = 'watching' | 'ended' | 'quiz' | 'passed';

export type Callout = { id: number; title: string; description?: string };

type ShortCardProps = {
    short: Short;
    phase: Phase;
    /** How many times this short has been failed. */
    failures: number;
    muted: boolean;
    speed: number;
    status: PlayerStatus;
    progress: MotionValue<number>;
    playerRef: React.Ref<ShortPlayerHandle>;
    onToggleMute: () => void;
    onTogglePlay: () => void;
    onStatusChange: (s: PlayerStatus) => void;
    onEnded: () => void;
    onAutoplayBlocked: () => void;
    onDuration: (seconds: number) => void;
    onOpenQuiz: () => void;
    callout: Callout | null;
};

const fade = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.2 },
};

export function ShortCard({
    short,
    phase,
    failures,
    muted,
    speed,
    status,
    progress,
    playerRef,
    onToggleMute,
    onTogglePlay,
    onStatusChange,
    onEnded,
    onAutoplayBlocked,
    onDuration,
    onOpenQuiz,
    callout,
}: ShortCardProps) {
    const isOver = phase !== 'watching';

    return (
        <div className='relative isolate size-full overflow-hidden rounded-3xl bg-black text-white shadow-2xl ring-1 ring-white/10'>
            <ShortPlayer
                ref={playerRef}
                videoId={short.id}
                title={short.title}
                poster={short.thumbnailUrl}
                muted={muted}
                speed={speed}
                progress={progress}
                onStatusChange={onStatusChange}
                onEnded={onEnded}
                onAutoplayBlocked={onAutoplayBlocked}
                onDuration={onDuration}
            />

            {/* Catches clicks so YouTube's own UI is unreachable (no scrubbing). */}
            <button
                type='button'
                aria-label={status === 'paused' ? 'Play' : 'Pause'}
                className='absolute inset-0 cursor-pointer outline-none'
                onClick={onTogglePlay}
                disabled={isOver}
            />

            <AnimatePresence>
                {!isOver && status === 'paused' && (
                    <motion.div key='paused' {...fade} className='pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40'>
                        <div className='flex size-16 items-center justify-center rounded-full bg-black/50 backdrop-blur-md'>
                            <PlayIcon className='size-7 translate-x-0.5 fill-current' />
                        </div>
                    </motion.div>
                )}
                {!isOver && status === 'loading' && (
                    <motion.div key='loading' {...fade} className='pointer-events-none absolute inset-0 flex items-center justify-center'>
                        <Spinner className='size-6' />
                    </motion.div>
                )}
            </AnimatePresence>

            <div className='pointer-events-none absolute inset-x-0 top-16 flex justify-center px-6' aria-live='polite'>
                <AnimatePresence mode='popLayout'>
                    {callout && (
                        <motion.div
                            key={callout.id}
                            initial={{ opacity: 0, y: -12, scale: 0.96, filter: 'blur(4px)' }}
                            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                            exit={{ opacity: 0, y: -8, scale: 0.98, filter: 'blur(4px)' }}
                            transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                            className='flex max-w-full flex-col items-center gap-0.5 rounded-2xl bg-black/65 px-4 py-2.5 text-center ring-1 ring-white/10 backdrop-blur-xl'
                        >
                            <span className='text-sm font-semibold tracking-tight'>{callout.title}</span>
                            {callout.description && <span className='text-xs text-white/70 tabular-nums'>{callout.description}</span>}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <div className='pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent p-4'>
                <div className='flex min-h-8 items-center'>
                    {failures > 0 && (
                        <Badge>
                            <RotateCcwIcon data-icon='inline-start' />
                            Rewatch #{failures}
                        </Badge>
                    )}
                </div>
                <Button
                    variant='ghost'
                    size='icon'
                    className='pointer-events-auto rounded-full bg-black/30 text-white backdrop-blur-md hover:bg-black/50 hover:text-white'
                    aria-label={muted ? 'Unmute' : 'Mute'}
                    onClick={onToggleMute}
                >
                    {muted ? <VolumeXIcon /> : <Volume2Icon />}
                </Button>
            </div>

            <div className='pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2.5 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pt-20 pb-6'>
                <div className='flex items-center gap-2'>
                    <Avatar size='sm'>
                        {short.channelAvatarUrl && <AvatarImage src={short.channelAvatarUrl} alt='' />}
                        <AvatarFallback className='text-[10px]'>{initials(short.channelName)}</AvatarFallback>
                    </Avatar>
                    <span className='truncate text-sm font-semibold tracking-tight'>@{short.channelUsername}</span>
                    {short.isChannelVerified && <BadgeCheckIcon className='size-4 shrink-0 text-white/70' aria-label='Verified' />}
                </div>
                <p className='line-clamp-2 text-[15px] leading-snug font-medium text-pretty'>{short.title}</p>
                {short.hashtags.length > 0 && <p className='truncate text-xs text-white/65'>{short.hashtags.map((h) => `#${h}`).join('  ')}</p>}
            </div>

            <div role='progressbar' aria-label='Watched' className='pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-white/20'>
                <motion.div className='h-full origin-left bg-primary' style={{ scaleX: progress }} />
            </div>

            <AnimatePresence>
                {isOver && (
                    <motion.div
                        key='ended'
                        initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
                        animate={{ opacity: 1, backdropFilter: 'blur(24px)' }}
                        exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
                        transition={{ type: 'spring', bounce: 0, duration: 0.45 }}
                        className='absolute inset-0 isolate flex flex-col items-center justify-center gap-5 bg-black/55 p-8 text-center'
                    >
                        {/* The embed goes black at the end, so blur the thumbnail in behind. */}
                        <Image src={short.thumbnailUrl} alt='' fill sizes='480px' className='-z-10 scale-110 object-cover opacity-50 blur-2xl' />
                        <motion.div
                            initial={{ scale: 0.85, y: 8 }}
                            animate={{ scale: 1, y: 0 }}
                            transition={{ type: 'spring', bounce: 0.25, duration: 0.5 }}
                            className='flex size-14 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15'
                        >
                            <LockOpenIcon className='size-6' />
                        </motion.div>
                        <div className='flex flex-col gap-1.5'>
                            <h2 className='font-heading text-2xl font-semibold tracking-tight'>Quiz unlocked</h2>
                            <p className='text-sm text-balance text-white/70'>One question stands between you and the next video.</p>
                        </div>
                        <Button size='lg' onClick={onOpenQuiz}>
                            Take the quiz
                        </Button>
                        <p className='flex items-center gap-1.5 text-xs text-white/55'>
                            or press <Kbd>↓</Kbd>
                        </p>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
