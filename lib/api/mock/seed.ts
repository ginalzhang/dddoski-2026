import type { Comment } from '@/lib/api/types';

// Fake comments so the comments sheet isn't empty. Videos and quizzes come
// from data/quizzes.json (see ./data.ts).

type SeedComment = Omit<Comment, 'id' | 'videoId' | 'isMine' | 'createdAt'> & {
    hoursAgo: number;
};

const genericComments: SeedComment[] = [
    {
        authorName: 'attention_span_of_a_moth',
        authorAvatarUrl: null,
        text: 'Failed this one 4 times. I now know more about this than my own family.',
        likes: 2104,
        hoursAgo: 3,
    },
    {
        authorName: 'Priya K.',
        authorAvatarUrl: null,
        text: "The rewatch penalty is genuinely the first thing that's made me pay attention since 2019.",
        likes: 877,
        hoursAgo: 11,
    },
    {
        authorName: 'speedrun_gary',
        authorAvatarUrl: null,
        text: 'Any% no-rewatch WR. Do not ask how many attempts it took.',
        likes: 340,
        hoursAgo: 26,
    },
    {
        authorName: 'Marisol',
        authorAvatarUrl: null,
        text: "I came here to doomscroll and instead I'm learning against my will.",
        likes: 129,
        hoursAgo: 49,
    },
];

const specificComments: Record<string, SeedComment[]> = {
    '0fV8kYoGDNM': [
        {
            authorName: 'sheep_enjoyer',
            authorAvatarUrl: null,
            text: 'The sheep is the real physicist here.',
            likes: 4410,
            hoursAgo: 1,
        },
    ],
    '-xdysAIg9k8': [
        {
            authorName: 'deckhand_dan',
            authorAvatarUrl: null,
            text: 'Every sailor I know has two eyeballs. Suspicious.',
            likes: 931,
            hoursAgo: 5,
        },
    ],
    '2_Z7FB3vfFg': [
        {
            authorName: 'jeans_guy',
            authorAvatarUrl: null,
            text: 'My fly would like a word.',
            likes: 3022,
            hoursAgo: 2,
        },
    ],
};

export function seedCommentsFor(videoId: string, now: number): Comment[] {
    const list = [...(specificComments[videoId] ?? []), ...genericComments];
    return list.map(({ hoursAgo, ...c }, i) => ({
        ...c,
        id: `${videoId}-seed-${i}`,
        videoId,
        isMine: false,
        createdAt: new Date(now - hoursAgo * 3_600_000).toISOString(),
    }));
}
