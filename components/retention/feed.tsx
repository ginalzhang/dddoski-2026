'use client';

import * as React from 'react';
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, type PanInfo } from 'motion/react';
import { RefreshCwIcon, TrophyIcon, WifiOffIcon } from 'lucide-react';

import { api, type Genre, type QuizAttemptResult, type Short, type UserStats } from '@/lib/api';
import { noGoingBack, pick, tooEarly } from '@/lib/copy';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { ActionRail, FeedNav, KeyboardHints, StatsHeader } from '@/components/retention/chrome';
import { CommentsSheet } from '@/components/retention/comments-sheet';
import { Confetti, makeConfetti, type ConfettiPiece } from '@/components/retention/confetti';
import { GenreBar, readSavedGenre, saveGenre } from '@/components/retention/genre-bar';
import { QuizDialog } from '@/components/retention/quiz-dialog';
import { ShortCard, type Callout, type Phase } from '@/components/retention/short-card';
import type { PlayerStatus, ShortPlayerHandle } from '@/components/retention/short-player';

const PAGE_SIZE = 4;
const SWIPE_DISTANCE = 90;
const SWIPE_VELOCITY = 600;

// Card size: as tall as the viewport allows (minus header and padding),
// capped so it stays a phone-sized object on a projector.
function isDemo() {
    return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo');
}

const STAGE_SIZE = 'aspect-[9/16] w-[min(calc((100dvh-8.75rem)*9/16),calc(100vw-7.5rem),30rem)]';

export function Feed() {
    const reduceMotion = useReducedMotion();

    const [items, setItems] = React.useState<Short[]>([]);
    const [nextCursor, setNextCursor] = React.useState<string | null>(null);
    const [hasMore, setHasMore] = React.useState(true);
    const [loadingPage, setLoadingPage] = React.useState(true);
    const [feedError, setFeedError] = React.useState(false);

    const [index, setIndex] = React.useState(0);
    const [phase, setPhase] = React.useState<Phase>('watching');
    const [failures, setFailures] = React.useState(0);
    const [status, setStatus] = React.useState<PlayerStatus>('loading');
    const [muted, setMuted] = React.useState(false);
    // Presenter-only fast forward (S). Deliberately left out of the keyboard hints.
    const [speed, setSpeed] = React.useState(1);
    const [commentsOpen, setCommentsOpen] = React.useState(false);
    const [stats, setStats] = React.useState<UserStats | null>(null);
    const [confetti, setConfetti] = React.useState<ConfettiPiece[]>([]);
    const [genres, setGenres] = React.useState<Genre[] | null>(null);
    const [genre, setGenre] = React.useState<string | null>(null);
    const genreRef = React.useRef<string | null>(null);

    const players = React.useRef(new Map<string, ShortPlayerHandle>());
    const requestedPages = React.useRef(new Set<string>());
    const watchRecorded = React.useRef<Promise<void>>(Promise.resolve());
    const lastToastAt = React.useRef(0);
    const calloutTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
    const [callout, setCallout] = React.useState<Callout | null>(null);
    const dragging = React.useRef(false);
    const progress = useMotionValue(0);
    const stageY = useMotionValue(0);
    const stageX = useMotionValue(0);

    const current: Short | undefined = items[index];
    const player = () => (current ? players.current.get(current.id) : undefined);
    const overlayOpen = phase === 'quiz' || phase === 'passed' || commentsOpen;

    // ---- data -------------------------------------------------------------

    // Fetches a page. Callers flip the loading flags first (initial state
    // already has `loadingPage: true`), so this only sets state on settle.
    // Pages are keyed by genre too, and a page that lands after the genre
    // changed is dropped.
    const fetchPage = React.useCallback((cursor: string | null) => {
        const g = genreRef.current;
        const key = `${g ?? 'all'}:${cursor ?? 'start'}`;
        if (requestedPages.current.has(key)) return;
        requestedPages.current.add(key);
        api.getFeed({ cursor, limit: PAGE_SIZE, genre: g })
            .then((page) => {
                if (genreRef.current !== g) return;
                setItems((prev) => {
                    const seen = new Set(prev.map((s) => s.id));
                    return [...prev, ...page.items.filter((s) => !seen.has(s.id))];
                });
                setNextCursor(page.nextCursor);
                setHasMore(page.nextCursor !== null);
            })
            .catch(() => {
                requestedPages.current.delete(key);
                if (genreRef.current === g) setFeedError(true);
            })
            .finally(() => {
                if (genreRef.current === g) setLoadingPage(false);
            });
    }, []);

    function loadPage(cursor: string | null) {
        setLoadingPage(true);
        setFeedError(false);
        fetchPage(cursor);
    }

    React.useEffect(() => {
        // A saved genre that no longer exists falls back to everything.
        const saved = readSavedGenre();
        genreRef.current = saved;
        fetchPage(null);
        api.getGenres()
            .then((list) => {
                setGenres(list);
                if (saved && list.some((g) => g.id === saved)) setGenre(saved);
                else if (saved) {
                    saveGenre(null);
                    genreRef.current = null;
                    requestedPages.current.clear();
                    setItems([]);
                    fetchPage(null);
                }
            })
            .catch(() => setGenres([]));
        api.getStats()
            .then(setStats)
            .catch(() => {});
    }, [fetchPage]);

    // Switching genre only replaces what's queued *after* the current short.
    // The current one stays put, so you can't dodge a quiz by changing genre.
    function changeGenre(next: string | null) {
        genreRef.current = next;
        setGenre(next);
        saveGenre(next);
        requestedPages.current.clear();
        setItems((list) => list.slice(0, index + 1));
        setNextCursor(null);
        setHasMore(true);
        setLoadingPage(true);
        setFeedError(false);
        fetchPage(null);
        if (current && phase !== 'passed') {
            const label = next ? (genres?.find((g) => g.id === next)?.label ?? next) : 'Everything';
            say(`Up next: ${label}`, 'Finish this one first.');
        }
    }

    function updateShort(id: string, patch: (s: Short) => Short) {
        setItems((list) => list.map((s) => (s.id === id ? patch(s) : s)));
    }

    // ---- feedback ---------------------------------------------------------

    // Gate messages appear on the card itself, where the user is looking.
    function scold(title: string, description?: string) {
        clearTimeout(calloutTimer.current);
        setCallout({ id: Date.now(), title, description });
        calloutTimer.current = setTimeout(() => setCallout(null), 2200);
    }

    function say(title: string, description?: string) {
        const now = Date.now();
        if (now - lastToastAt.current < 1200) return;
        lastToastAt.current = now;
        toast.add({ title, description });
    }

    // Rubber-band the card against the direction the user tried to go.
    function nudge(dir: 1 | -1) {
        if (reduceMotion) return;
        animate(stageY, dir * -40, { type: 'spring', bounce: 0, duration: 0.2 }).then(() => animate(stageY, 0, { type: 'spring', bounce: 0.45, duration: 0.55 }));
    }

    function shake() {
        if (reduceMotion) return;
        animate(stageX, [0, -18, 16, -12, 9, -5, 0], { duration: 0.45 });
    }

    // ---- flow -------------------------------------------------------------

    function goNext() {
        const nextIndex = index + 1;
        // Keep a couple of shorts queued up ahead.
        if (hasMore && !loadingPage && nextIndex >= items.length - 2) loadPage(nextCursor);
        setIndex(nextIndex);
        setPhase('watching');
        setFailures(0);
        setStatus('loading');
        setCallout(null);
        progress.set(0);
    }

    function tryAdvance(fromSwipe = false) {
        if (!current) return;
        if (phase === 'watching') {
            if (!fromSwipe) nudge(1);
            const left = Math.ceil(player()?.remaining() ?? 0);
            scold(pick(tooEarly), left > 0 ? `${left}s to go.` : undefined);
        } else if (phase === 'ended') {
            setPhase('quiz');
        } else if (phase === 'passed') {
            goNext();
        }
    }

    function tryBack(fromSwipe = false) {
        if (!fromSwipe) nudge(-1);
        scold(pick(noGoingBack));
    }

    function handleEnded() {
        if (!current) return;
        setPhase((p) => (p === 'watching' ? 'ended' : p));
        watchRecorded.current = api.recordWatch(current.id, { completed: true, secondsWatched: current.durationSeconds }).catch(() => {});
    }

    function handleStatus(next: PlayerStatus) {
        setStatus(next);
        if (next === 'error') {
            say("This one won't play here.", 'Skipping it. Consider yourself lucky.');
            goNext();
        }
    }

    function handleAnswered(result: QuizAttemptResult) {
        setStats(result.stats);
        if (result.correct) {
            setPhase('passed');
            setConfetti(makeConfetti());
        } else {
            shake();
        }
    }

    function handleRewatch() {
        setFailures((f) => f + 1);
        setPhase('watching');
        player()?.restart();
    }

    function togglePlay() {
        if (dragging.current || phase !== 'watching') return;
        player()?.toggle();
    }

    function toggleLike() {
        if (!current) return;
        const id = current.id;
        const liked = !current.likedByMe;
        const before = current;
        updateShort(id, (s) => ({ ...s, likedByMe: liked, likes: s.likes + (liked ? 1 : -1) }));
        api.setLike(id, liked)
            .then((r) => updateShort(id, (s) => ({ ...s, likedByMe: r.liked, likes: r.likes })))
            .catch(() => {
                updateShort(id, () => before);
                say("Couldn't save that like.");
            });
    }

    function share() {
        if (!current) return;
        navigator.clipboard
            .writeText(current.url)
            .then(() => toast.add({ title: 'Link copied', description: "They'll have to pass the quiz too." }))
            .catch(() => say("Couldn't copy the link."));
    }

    // ---- input ------------------------------------------------------------

    const onKeyDown = React.useEffectEvent((e: KeyboardEvent) => {
        if (overlayOpen || !current || e.metaKey || e.ctrlKey || e.altKey) return;
        const target = e.target instanceof HTMLElement ? e.target : null;
        if (target?.closest('input, textarea, [contenteditable]')) return;
        if (target?.closest('button') && (e.key === ' ' || e.key === 'Enter')) return;

        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        switch (key) {
            case 'ArrowDown':
            case 'j':
                e.preventDefault();
                tryAdvance();
                break;
            case 'ArrowUp':
            case 'k':
                e.preventDefault();
                tryBack();
                break;
            case 'Enter':
                if (phase === 'ended') setPhase('quiz');
                break;
            case ' ':
                e.preventDefault();
                togglePlay();
                break;
            case 's':
                setSpeed((s) => (s === 1 ? 2 : 1));
                break;
            case 'm':
                setMuted((m) => !m);
                break;
            case 'l':
                toggleLike();
                break;
            case 'c':
                setCommentsOpen(true);
                break;
            case 'e':
                // Shift+E jumps to the end so you don't have to sit through it.
                // Dev builds, or any build opened with ?demo=1 (for live demos).
                if (e.shiftKey && (process.env.NODE_ENV === 'development' || isDemo())) player()?.devSkipToEnd();
                break;
        }
    });

    // Trackpads keep firing wheel events after a flick, so one gesture = one
    // action: after triggering, ignore wheel input until it goes quiet.
    const wheel = React.useRef({ acc: 0, cooling: false, timer: 0 as unknown as ReturnType<typeof setTimeout> });
    const onWheel = React.useEffectEvent((e: WheelEvent) => {
        if (overlayOpen) return;
        const w = wheel.current;
        clearTimeout(w.timer);
        w.timer = setTimeout(() => {
            w.acc = 0;
            w.cooling = false;
        }, 220);
        if (w.cooling) return;
        w.acc += e.deltaY;
        if (Math.abs(w.acc) > 50) {
            w.cooling = true;
            if (w.acc > 0) tryAdvance();
            else tryBack();
        }
    });

    React.useEffect(() => {
        const key = (e: KeyboardEvent) => onKeyDown(e);
        const wh = (e: WheelEvent) => onWheel(e);
        window.addEventListener('keydown', key);
        window.addEventListener('wheel', wh, { passive: true });
        return () => {
            window.removeEventListener('keydown', key);
            window.removeEventListener('wheel', wh);
        };
    }, []);

    function handleDragEnd(_: unknown, info: PanInfo) {
        setTimeout(() => (dragging.current = false), 0);
        const { offset, velocity } = info;
        if (offset.y < -SWIPE_DISTANCE || velocity.y < -SWIPE_VELOCITY) tryAdvance(true);
        else if (offset.y > SWIPE_DISTANCE || velocity.y > SWIPE_VELOCITY) tryBack(true);
    }

    // ---- render -----------------------------------------------------------

    const transition = reduceMotion ? { duration: 0.2 } : ({ type: 'spring', bounce: 0, duration: 0.55 } as const);
    const slide = reduceMotion ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : { initial: { y: '108%' }, animate: { y: 0 }, exit: { y: '-108%' } };

    const atEnd = !current && !hasMore && !loadingPage && !feedError;

    return (
        <div className='flex h-dvh flex-col overflow-hidden'>
            <StatsHeader stats={stats} />
            <GenreBar genres={genres} value={genre} onChange={changeGenre} className='shrink-0 justify-center px-6 pb-2' />

            <main className='relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6'>
                {current ? (
                    <div className='flex items-end gap-4'>
                        <motion.div
                            className={`relative ${STAGE_SIZE}`}
                            style={{ y: stageY, x: stageX }}
                            drag={overlayOpen ? false : 'y'}
                            dragConstraints={{ top: 0, bottom: 0 }}
                            dragElastic={0.18}
                            onDragStart={() => (dragging.current = true)}
                            onDragEnd={handleDragEnd}
                        >
                            <AnimatePresence initial={false}>
                                <motion.div key={current.id} className='absolute inset-0' {...slide} transition={transition}>
                                    <ShortCard
                                        short={current}
                                        phase={phase}
                                        failures={failures}
                                        callout={callout}
                                        muted={muted}
                                        speed={speed}
                                        status={status}
                                        progress={progress}
                                        playerRef={(handle: ShortPlayerHandle | null) => {
                                            const id = current.id;
                                            if (handle) players.current.set(id, handle);
                                            return () => {
                                                players.current.delete(id);
                                            };
                                        }}
                                        onToggleMute={() => setMuted((m) => !m)}
                                        onTogglePlay={togglePlay}
                                        onStatusChange={handleStatus}
                                        onEnded={handleEnded}
                                        onAutoplayBlocked={() => {
                                            setMuted(true);
                                            scold('Started muted', 'Your browser insisted. Press M to unmute.');
                                        }}
                                        onDuration={(d) => {
                                            const id = current.id;
                                            const seconds = Math.round(d);
                                            updateShort(id, (s) => (s.durationSeconds === seconds ? s : { ...s, durationSeconds: seconds }));
                                        }}
                                        onOpenQuiz={() => setPhase('quiz')}
                                    />
                                </motion.div>
                            </AnimatePresence>
                        </motion.div>
                        <ActionRail short={current} onLike={toggleLike} onComments={() => setCommentsOpen(true)} onShare={share} />
                    </div>
                ) : atEnd ? (
                    <FeedEnd stats={stats} />
                ) : feedError ? (
                    <FeedError onRetry={() => loadPage(nextCursor)} />
                ) : (
                    <div className='flex items-end gap-4'>
                        <Skeleton className={`${STAGE_SIZE} rounded-3xl`} />
                        <div className='flex flex-col gap-4 pb-8'>
                            {[0, 1, 2].map((i) => (
                                <Skeleton key={i} className='size-12 rounded-full' />
                            ))}
                        </div>
                    </div>
                )}

                {current && (
                    <div className='absolute top-1/2 right-6 hidden -translate-y-1/2 md:flex'>
                        <FeedNav locked={phase === 'watching'} onPrev={() => tryBack()} onNext={() => tryAdvance()} />
                    </div>
                )}
                <KeyboardHints className='absolute bottom-6 left-6 hidden xl:flex' />
            </main>

            <Confetti pieces={confetti} />
            {current && (
                <>
                    <QuizDialog
                        open={phase === 'quiz' || phase === 'passed'}
                        short={current}
                        attempt={failures + 1}
                        watchRecorded={() => watchRecorded.current}
                        onAnswered={handleAnswered}
                        onDismiss={() => setPhase('ended')}
                        onRewatch={handleRewatch}
                        onNext={goNext}
                    />
                    <CommentsSheet
                        open={commentsOpen}
                        onOpenChange={setCommentsOpen}
                        short={current}
                        onPosted={() => updateShort(current.id, (s) => ({ ...s, commentsCount: s.commentsCount + 1 }))}
                    />
                </>
            )}
        </div>
    );
}

function FeedEnd({ stats }: { stats: UserStats | null }) {
    return (
        <Empty className='max-w-md'>
            <EmptyHeader>
                <EmptyMedia variant='icon'>
                    <TrophyIcon />
                </EmptyMedia>
                <EmptyTitle className='font-heading text-xl tracking-tight'>You&apos;ve retained everything.</EmptyTitle>
                <EmptyDescription>
                    {stats && stats.failed > 0
                        ? `${stats.passed} videos, ${stats.failed} failed quizzes. There's nothing left. Consider going outside.`
                        : "Every video, first try. There's nothing left. Consider going outside."}
                </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
                <Button onClick={() => window.location.reload()}>
                    <RefreshCwIcon data-icon='inline-start' />
                    Start over
                </Button>
            </EmptyContent>
        </Empty>
    );
}

function FeedError({ onRetry }: { onRetry: () => void }) {
    return (
        <Empty className='max-w-md'>
            <EmptyHeader>
                <EmptyMedia variant='icon'>
                    <WifiOffIcon />
                </EmptyMedia>
                <EmptyTitle>Couldn&apos;t load the feed</EmptyTitle>
                <EmptyDescription>The server is avoiding you. Not personal, probably.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
                <Button onClick={onRetry}>Try again</Button>
            </EmptyContent>
        </Empty>
    );
}
