'use client';

import * as React from 'react';
import { ArrowUpIcon, MessageCircleIcon, ThumbsUpIcon } from 'lucide-react';

import { api, ApiError, type Comment, type Short } from '@/lib/api';
import { formatCount, formatTimeAgo, initials } from '@/lib/format';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

type CommentsSheetProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    short: Short;
    onPosted: () => void;
};

export function CommentsSheet({ open, onOpenChange, short, onPosted }: CommentsSheetProps) {
    const [comments, setComments] = React.useState<Comment[] | null>(null);
    const [draft, setDraft] = React.useState('');
    const [posting, setPosting] = React.useState(false);

    const fetchKey = open ? short.id : null;
    const [prevKey, setPrevKey] = React.useState<string | null>(null);
    if (fetchKey !== prevKey) {
        setPrevKey(fetchKey);
        if (fetchKey) setComments(null);
    }

    React.useEffect(() => {
        if (!fetchKey) return;
        let cancelled = false;
        api.getComments(fetchKey)
            .then((list) => !cancelled && setComments(list))
            .catch(() => !cancelled && setComments([]));
        return () => {
            cancelled = true;
        };
    }, [fetchKey]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const text = draft.trim();
        if (!text || posting) return;
        setPosting(true);
        try {
            const comment = await api.postComment(short.id, text);
            setComments((prev) => [comment, ...(prev ?? [])]);
            setDraft('');
            onPosted();
        } catch (err) {
            toast.add({
                title: "Comment didn't post",
                description: err instanceof ApiError ? err.message : 'Try again in a moment.',
                type: 'error',
            });
        } finally {
            setPosting(false);
        }
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side='right' className='gap-0 sm:max-w-md'>
                <SheetHeader>
                    <SheetTitle>Comments</SheetTitle>
                    <SheetDescription>{formatCount(short.commentsCount)} people had thoughts</SheetDescription>
                </SheetHeader>
                <Separator />
                <ScrollArea className='min-h-0 flex-1'>
                    <div className='flex flex-col gap-5 p-6'>
                        {comments === null &&
                            [0, 1, 2, 3].map((i) => (
                                <div key={i} className='flex gap-3'>
                                    <Skeleton className='size-8 rounded-full' />
                                    <div className='flex flex-1 flex-col gap-2'>
                                        <Skeleton className='h-3 w-28' />
                                        <Skeleton className='h-4 w-full' />
                                    </div>
                                </div>
                            ))}
                        {comments?.length === 0 && (
                            <Empty>
                                <EmptyHeader>
                                    <EmptyMedia variant='icon'>
                                        <MessageCircleIcon />
                                    </EmptyMedia>
                                    <EmptyTitle>No comments yet</EmptyTitle>
                                    <EmptyDescription>Everyone is too busy rewatching.</EmptyDescription>
                                </EmptyHeader>
                            </Empty>
                        )}
                        {comments?.map((c) => (
                            <CommentRow key={c.id} comment={c} />
                        ))}
                    </div>
                </ScrollArea>
                <Separator />
                <SheetFooter>
                    <form onSubmit={handleSubmit}>
                        <InputGroup>
                            <InputGroupInput
                                aria-label='Add a comment'
                                placeholder='Add a comment…'
                                value={draft}
                                maxLength={500}
                                onChange={(e) => setDraft(e.target.value)}
                                disabled={posting}
                            />
                            <InputGroupAddon align='inline-end'>
                                <InputGroupButton type='submit' variant='default' size='icon-xs' aria-label='Post comment' disabled={!draft.trim() || posting}>
                                    {posting ? <Spinner /> : <ArrowUpIcon />}
                                </InputGroupButton>
                            </InputGroupAddon>
                        </InputGroup>
                    </form>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}

function CommentRow({ comment }: { comment: Comment }) {
    return (
        <div className='flex gap-3'>
            <Avatar>
                {comment.authorAvatarUrl && <AvatarImage src={comment.authorAvatarUrl} alt='' />}
                <AvatarFallback>{initials(comment.authorName)}</AvatarFallback>
            </Avatar>
            <div className='flex min-w-0 flex-1 flex-col gap-1'>
                <div className='flex items-baseline gap-2 text-xs'>
                    <span className='truncate font-medium'>{comment.isMine ? 'You' : comment.authorName}</span>
                    <span className='shrink-0 text-muted-foreground'>{formatTimeAgo(comment.createdAt)}</span>
                </div>
                <p className='text-sm leading-relaxed text-pretty'>{comment.text}</p>
                <div className='flex items-center gap-1.5 text-xs text-muted-foreground'>
                    <ThumbsUpIcon className='size-3.5' />
                    <span className='tabular-nums'>{formatCount(comment.likes)}</span>
                </div>
            </div>
        </div>
    );
}
