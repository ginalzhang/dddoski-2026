'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDownIcon, CircleCheckIcon, CircleXIcon, RotateCcwIcon } from 'lucide-react';

import { api, ApiError, type Quiz, type QuizAttemptResult, type Short } from '@/lib/api';
import { pick, rightAnswer, wrongAnswer } from '@/lib/copy';
import { formatDuration } from '@/lib/format';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldContent, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Kbd } from '@/components/ui/kbd';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';

type QuizDialogProps = {
    open: boolean;
    short: Short;
    /** 1-based attempt the user is on. Changing it refetches the quiz. */
    attempt: number;
    /** Resolves once the server has the completed watch. */
    watchRecorded: () => Promise<void>;
    onAnswered: (result: QuizAttemptResult) => void;
    /** Closed before answering. */
    onDismiss: () => void;
    onRewatch: () => void;
    onNext: () => void;
};

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; quiz: Quiz };

export function QuizDialog({ open, short, attempt, watchRecorded, onAnswered, onDismiss, onRewatch, onNext }: QuizDialogProps) {
    const [load, setLoad] = React.useState<Load>({ state: 'loading' });
    const [selected, setSelected] = React.useState<string | null>(null);
    const [submitting, setSubmitting] = React.useState(false);
    const [submitError, setSubmitError] = React.useState<string | null>(null);
    const [result, setResult] = React.useState<QuizAttemptResult | null>(null);
    const [verdict, setVerdict] = React.useState('');
    const [reloadKey, setReloadKey] = React.useState(0);
    const actionRef = React.useRef<HTMLButtonElement>(null);

    // Move focus to Next / Rewatch so Enter continues.
    React.useEffect(() => {
        if (result) actionRef.current?.focus();
    }, [result]);

    // A new attempt (or retry) means a fresh quiz: reset during render, then fetch.
    const fetchKey = open ? `${short.id}:${attempt}:${reloadKey}` : null;
    const [prevKey, setPrevKey] = React.useState<string | null>(null);
    if (fetchKey !== prevKey) {
        setPrevKey(fetchKey);
        if (fetchKey) {
            setLoad({ state: 'loading' });
            setSelected(null);
            setResult(null);
            setSubmitError(null);
        }
    }

    React.useEffect(() => {
        if (!fetchKey) return;
        let cancelled = false;
        api.getQuiz(short.id)
            .then((quiz) => !cancelled && setLoad({ state: 'ready', quiz }))
            .catch((e: unknown) => {
                if (cancelled) return;
                setLoad({
                    state: 'error',
                    message: e instanceof ApiError ? e.message : 'Something went wrong.',
                });
            });
        return () => {
            cancelled = true;
        };
    }, [fetchKey, short.id]);

    async function submit() {
        if (load.state !== 'ready' || !selected || submitting || result) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            await watchRecorded();
            const res = await api.submitQuizAttempt(short.id, {
                quizId: load.quiz.id,
                optionId: selected,
            });
            setVerdict(pick(res.correct ? rightAnswer : wrongAnswer));
            setResult(res);
            onAnswered(res);
        } catch (e) {
            setSubmitError(e instanceof ApiError ? e.message : "Couldn't submit. Try again.");
        } finally {
            setSubmitting(false);
        }
    }

    function handleOpenChange(next: boolean) {
        if (next) return;
        if (!result) onDismiss();
        else if (result.correct) onNext();
        else onRewatch();
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (load.state !== 'ready' || result) return;
        const n = Number(e.key);
        if (n >= 1 && n <= load.quiz.options.length) {
            e.preventDefault();
            setSelected(load.quiz.options[n - 1].id);
        } else if (e.key === 'Enter' && selected) {
            e.preventDefault();
            submit();
        }
    }

    const answered = result !== null;

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className='sm:max-w-lg' onKeyDown={handleKeyDown}>
                <DialogHeader>
                    <div className='flex items-center gap-2'>
                        <Badge variant='secondary'>Pop quiz</Badge>
                        {attempt > 1 && <Badge variant='destructive'>Attempt {attempt}</Badge>}
                    </div>
                    {load.state === 'ready' ? (
                        <DialogTitle className='text-xl leading-snug tracking-tight text-pretty'>{load.quiz.question}</DialogTitle>
                    ) : (
                        <DialogTitle className='sr-only'>Pop quiz</DialogTitle>
                    )}
                    <DialogDescription>About “{short.title}”. Get it right to keep scrolling.</DialogDescription>
                </DialogHeader>

                {load.state === 'loading' && (
                    <div className='flex flex-col gap-3'>
                        <Skeleton className='h-7 w-4/5' />
                        {[0, 1, 2, 3].map((i) => (
                            <Skeleton key={i} className='h-14 w-full rounded-2xl' />
                        ))}
                    </div>
                )}

                {load.state === 'error' && (
                    <Alert variant='destructive'>
                        <CircleXIcon />
                        <AlertTitle>Couldn&apos;t load the quiz</AlertTitle>
                        <AlertDescription>{load.message}</AlertDescription>
                    </Alert>
                )}

                {load.state === 'ready' && (
                    <RadioGroup value={selected} onValueChange={(v) => setSelected(v as string)} disabled={answered || submitting} aria-label='Answers'>
                        {load.quiz.options.map((opt, i) => (
                            <FieldLabel key={opt.id} htmlFor={`${load.quiz.id}-${opt.id}`}>
                                <Field orientation='horizontal' data-invalid={answered && !result.correct && selected === opt.id}>
                                    <Kbd>{i + 1}</Kbd>
                                    <FieldContent>
                                        <FieldTitle className='leading-snug'>{opt.text}</FieldTitle>
                                    </FieldContent>
                                    <RadioGroupItem value={opt.id} id={`${load.quiz.id}-${opt.id}`} />
                                </Field>
                            </FieldLabel>
                        ))}
                    </RadioGroup>
                )}

                <AnimatePresence initial={false} mode='popLayout'>
                    {result && (
                        <motion.div
                            key={result.correct ? 'right' : 'wrong'}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
                        >
                            {result.correct ? (
                                <Alert>
                                    <CircleCheckIcon className='text-success' />
                                    <AlertTitle>{verdict}</AlertTitle>
                                    <AlertDescription>
                                        {result.explanation}
                                        {result.stats.streak > 1 && <span className='block pt-1'>{result.stats.streak} first-try passes in a row.</span>}
                                    </AlertDescription>
                                </Alert>
                            ) : (
                                <Alert variant='destructive'>
                                    <CircleXIcon />
                                    <AlertTitle>Incorrect. {verdict}</AlertTitle>
                                    <AlertDescription>The video will play again from the start. That&apos;s {formatDuration(short.durationSeconds)} more of your life.</AlertDescription>
                                </Alert>
                            )}
                        </motion.div>
                    )}
                    {submitError && !result && (
                        <Alert variant='destructive'>
                            <CircleXIcon />
                            <AlertTitle>{submitError}</AlertTitle>
                        </Alert>
                    )}
                </AnimatePresence>

                <DialogFooter>
                    {load.state === 'error' ? (
                        <Button onClick={() => setReloadKey((k) => k + 1)}>Try again</Button>
                    ) : !result ? (
                        <Button size='lg' onClick={submit} disabled={!selected || submitting || load.state !== 'ready'}>
                            {submitting && <Spinner data-icon='inline-start' />}
                            Submit answer
                        </Button>
                    ) : result.correct ? (
                        <Button size='lg' onClick={onNext} ref={actionRef}>
                            Next video
                            <ArrowDownIcon data-icon='inline-end' />
                        </Button>
                    ) : (
                        <Button size='lg' onClick={onRewatch} ref={actionRef}>
                            <RotateCcwIcon data-icon='inline-start' />
                            Rewatch
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
