'use client';

import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BrainIcon, EyeIcon, RotateCcwIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Wordmark } from '@/components/retention/chrome';
import { Feed } from '@/components/retention/feed';

const rules = [
    {
        icon: EyeIcon,
        title: 'Watch the whole video',
        description: `I'll know if you scroll early 👀.`,
    },
    {
        icon: BrainIcon,
        title: 'Pass a pop quiz to scroll',
        description: 'Make sure you pay attention',
    },
    {
        icon: RotateCcwIcon,
        title: 'Get it wrong, watch it again',
        description: 'From the start, as many times as it takes.',
    },
];

export function RetentionApp() {
    const [started, setStarted] = React.useState(false);
    const reduceMotion = useReducedMotion();

    return (
        <AnimatePresence mode='wait'>
            {started ? (
                <motion.div key='feed' initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
                    <Feed />
                </motion.div>
            ) : (
                <motion.main
                    key='intro'
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, filter: 'blur(8px)' }}
                    transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
                    className='flex min-h-dvh items-center justify-center p-6'
                >
                    <div className='flex w-full max-w-md flex-col gap-10'>
                        <div className='flex flex-col gap-5'>
                            <Wordmark />
                            <div className='flex flex-col gap-3'>
                                <h1 className='font-heading text-5xl leading-[1.02] font-semibold tracking-[-0.03em] text-balance'>
                                    Short videos.
                                    <br />
                                    <span className='text-muted-foreground'>Long-term memory.</span>
                                </h1>
                                <p className='text-base leading-relaxed text-pretty text-muted-foreground'>The feed you can&apos;t mindlessly scroll. Every video ends in an exam.</p>
                            </div>
                        </div>

                        <ItemGroup className='gap-2'>
                            {rules.map((rule, i) => (
                                <Item key={rule.title} variant='muted'>
                                    <ItemMedia variant='icon'>
                                        <rule.icon />
                                    </ItemMedia>
                                    <ItemContent>
                                        <ItemTitle>
                                            {i + 1}. {rule.title}
                                        </ItemTitle>
                                        <ItemDescription>{rule.description}</ItemDescription>
                                    </ItemContent>
                                </Item>
                            ))}
                        </ItemGroup>

                        <div className='flex flex-col gap-3'>
                            <Button size='lg' className='h-11 text-base' onClick={() => setStarted(true)} autoFocus>
                                I accept the consequences
                            </Button>
                            <p className='text-center text-xs text-muted-foreground'>Sound on. By continuing you agree to learn something.</p>
                        </div>
                    </div>
                </motion.main>
            )}
        </AnimatePresence>
    );
}
