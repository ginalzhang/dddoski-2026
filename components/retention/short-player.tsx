'use client';

import * as React from 'react';
import Image from 'next/image';
import { type MotionValue } from 'motion/react';
import { cn } from '@/lib/utils';
import { createPlayer, PlayerState, type YTPlayer } from '@/lib/youtube';

export type PlayerStatus = 'loading' | 'playing' | 'paused' | 'ended' | 'error';

export type ShortPlayerHandle = {
    /** Back to 0:00 and play. Used for forced rewatches. */
    restart(): void;
    toggle(): void;
    /** Seconds left in the video. */
    remaining(): number;
    /** Development only: jump to the last moment of the video. */
    devSkipToEnd(): void;
};

type ShortPlayerProps = {
    videoId: string;
    title: string;
    poster: string;
    muted: boolean;
    /** 0–1, written every frame. */
    progress: MotionValue<number>;
    onStatusChange: (status: PlayerStatus) => void;
    onEnded: () => void;
    /** Browser refused unmuted autoplay; the player fell back to muted. */
    onAutoplayBlocked: () => void;
    ref?: React.Ref<ShortPlayerHandle>;
};

// How far past the furthest-watched point playback may jump before we treat it
// as a skip attempt and snap back. Covers normal buffering jitter.
const SEEK_TOLERANCE_S = 1.5;

export function ShortPlayer({ videoId, title, poster, muted, progress, onStatusChange, onEnded, onAutoplayBlocked, ref }: ShortPlayerProps) {
    const hostRef = React.useRef<HTMLDivElement>(null);
    const playerRef = React.useRef<YTPlayer | null>(null);
    const maxTimeRef = React.useRef(0);
    const lastTimeRef = React.useRef(0);
    const endedRef = React.useRef(false);
    const mutedRef = React.useRef(muted);
    const [started, setStarted] = React.useState(false);

    const emitStatus = React.useEffectEvent(onStatusChange);
    const emitEnded = React.useEffectEvent(onEnded);
    const emitBlocked = React.useEffectEvent(onAutoplayBlocked);

    React.useImperativeHandle(ref, () => ({
        restart() {
            const p = playerRef.current;
            if (!p) return;
            maxTimeRef.current = 0;
            lastTimeRef.current = 0;
            endedRef.current = false;
            progress.set(0);
            p.seekTo(0, true);
            p.playVideo();
        },
        toggle() {
            const p = playerRef.current;
            if (!p) return;
            if (p.getPlayerState() === PlayerState.PLAYING) p.pauseVideo();
            else p.playVideo();
        },
        remaining() {
            const p = playerRef.current;
            if (!p) return 0;
            return Math.max(0, p.getDuration() - p.getCurrentTime());
        },
        devSkipToEnd() {
            const p = playerRef.current;
            if (!p) return;
            const end = p.getDuration() - 0.5;
            maxTimeRef.current = end;
            p.seekTo(end, true);
            p.playVideo();
        },
    }));

    React.useEffect(() => {
        mutedRef.current = muted;
        const p = playerRef.current;
        if (!p) return;
        if (muted) p.mute();
        else p.unMute();
    }, [muted]);

    React.useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        let disposed = false;
        let raf = 0;
        let blockTimer: ReturnType<typeof setTimeout> | undefined;

        // The API replaces this node with an iframe, so React never owns it.
        const mount = document.createElement('div');
        host.appendChild(mount);
        maxTimeRef.current = 0;
        lastTimeRef.current = 0;
        endedRef.current = false;
        progress.set(0);
        setStarted(false);
        emitStatus('loading');

        const finish = (p: YTPlayer) => {
            if (endedRef.current) return;
            endedRef.current = true;
            p.pauseVideo();
            progress.set(1);
            emitStatus('ended');
            emitEnded();
        };

        const tick = () => {
            const p = playerRef.current;
            if (p && !endedRef.current) {
                const t = p.getCurrentTime();
                const d = p.getDuration();
                const playing = p.getPlayerState() === PlayerState.PLAYING;
                // Shorts embeds loop instead of firing ENDED, so catch the last
                // moment ourselves (or the wrap back to 0:00 if we missed it).
                const wrapped = lastTimeRef.current > d - 1.5 && t < 1;
                if (d > 0 && (t >= d - 0.3 || wrapped)) {
                    finish(p);
                } else {
                    if (playing && t > maxTimeRef.current + SEEK_TOLERANCE_S) {
                        p.seekTo(maxTimeRef.current, true);
                    } else if (t > maxTimeRef.current) {
                        maxTimeRef.current = t;
                    }
                    lastTimeRef.current = t;
                    if (d > 0) progress.set(Math.min(1, maxTimeRef.current / d));
                }
            }
            raf = requestAnimationFrame(tick);
        };

        const creating = createPlayer(mount, {
            videoId,
            width: '100%',
            height: '100%',
            playerVars: {
                autoplay: 1,
                controls: 0,
                disablekb: 1,
                fs: 0,
                iv_load_policy: 3,
                playsinline: 1,
                rel: 0,
                cc_load_policy: 0,
                origin: window.location.origin,
            },
            events: {
                onReady: ({ target }) => {
                    if (disposed) return;
                    playerRef.current = target;
                    if (mutedRef.current) target.mute();
                    else target.unMute();
                    target.playVideo();
                    raf = requestAnimationFrame(tick);
                    blockTimer = setTimeout(() => {
                        const s = target.getPlayerState();
                        if (s === PlayerState.UNSTARTED || s === PlayerState.CUED) {
                            target.mute();
                            target.playVideo();
                            emitBlocked();
                        }
                    }, 1800);
                },
                onStateChange: ({ data, target }) => {
                    if (disposed) return;
                    if (endedRef.current) {
                        // Already finished; don't let a loop restart it behind the overlay.
                        if (data === PlayerState.PLAYING) target.pauseVideo();
                        return;
                    }
                    if (data === PlayerState.PLAYING) {
                        setStarted(true);
                        emitStatus('playing');
                    } else if (data === PlayerState.PAUSED) {
                        emitStatus('paused');
                    } else if (data === PlayerState.BUFFERING) {
                        emitStatus('loading');
                    } else if (data === PlayerState.ENDED) {
                        finish(target);
                    }
                },
                onError: () => {
                    if (!disposed) emitStatus('error');
                },
            },
        });

        return () => {
            disposed = true;
            cancelAnimationFrame(raf);
            clearTimeout(blockTimer);
            creating.then((p) => p.destroy()).catch(() => {});
            playerRef.current = null;
            mount.remove();
        };
    }, [videoId, progress]);

    return (
        <div className='absolute inset-0 bg-black'>
            <div
                ref={hostRef}
                aria-label={`Video: ${title}`}
                // A vertical iframe gets YouTube's Shorts UI (logo, like, share).
                // A 16:9 one doesn't, so render landscape and crop to the 9:16
                // video in the middle. 316.05% = (16/9) / (9/16).
                className='absolute inset-0 [&_iframe]:pointer-events-none [&_iframe]:absolute [&_iframe]:top-0 [&_iframe]:left-1/2 [&_iframe]:h-full [&_iframe]:w-[316.05%] [&_iframe]:max-w-none [&_iframe]:-translate-x-1/2'
            />
            <Image src={poster} alt='' fill sizes='480px' priority className={cn('object-cover transition-opacity duration-500', started && 'opacity-0')} />
        </div>
    );
}
