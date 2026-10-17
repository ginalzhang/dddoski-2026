import type { Comment, Short } from '@/lib/api/types';

// Seed data for the in-memory mock backend. Real Shorts, with quizzes written
// from each video's transcript. Remove once the real API is live.

type SeedShort = Omit<Short, 'url' | 'thumbnailUrl' | 'likedByMe'>;

export type SeedQuiz = {
    videoId: string;
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
};

const shorts: SeedShort[] = [
    {
        id: '-kwF6M4juiU',
        title: 'Not a rainbow!',
        durationSeconds: 31,
        viewCount: 208945,
        likes: 14200,
        commentsCount: 312,
        date: '2026-02-04T18:00:00.000Z',
        channelName: 'minutephysics',
        channelUsername: 'minutephysics',
        channelAvatarUrl: null,
        isChannelVerified: true,
        hashtags: ['physics', 'color'],
    },
    {
        id: '0fV8kYoGDNM',
        title: 'When 2 + 2 = 3.999999999…',
        durationSeconds: 32,
        viewCount: 988899,
        likes: 61300,
        commentsCount: 1904,
        date: '2026-02-28T18:00:00.000Z',
        channelName: 'minutephysics',
        channelUsername: 'minutephysics',
        channelAvatarUrl: null,
        isChannelVerified: true,
        hashtags: ['relativity', 'physics'],
    },
    {
        id: '-YWWzPiaJlE',
        title: 'GREAT White Shark News!',
        durationSeconds: 44,
        viewCount: 242493,
        likes: 9800,
        commentsCount: 421,
        date: '2023-12-11T20:00:00.000Z',
        channelName: 'SciShow',
        channelUsername: 'scishow',
        channelAvatarUrl: null,
        isChannelVerified: true,
        hashtags: ['science', 'scishow', 'shark', 'marine'],
    },
    {
        id: '-xdysAIg9k8',
        title: 'This single-celled organism is HUGE.',
        durationSeconds: 51,
        viewCount: 502177,
        likes: 27400,
        commentsCount: 836,
        date: '2023-10-28T00:00:00.000Z',
        channelName: 'SciShow',
        channelUsername: 'scishow',
        channelAvatarUrl: null,
        isChannelVerified: true,
        hashtags: ['shorts', 'science', 'biology'],
    },
    {
        id: '2GUah9xHVto',
        title: 'Can something go faster than it’s pushed?',
        durationSeconds: 61,
        viewCount: 12068653,
        likes: 512000,
        commentsCount: 9133,
        date: '2026-04-09T11:00:03.000Z',
        channelName: 'Veritasium',
        channelUsername: 'veritasium',
        channelAvatarUrl: null,
        isChannelVerified: true,
        hashtags: ['physics', 'engineering'],
    },
    {
        id: '3HQkVfZ4DNY',
        title: "The World's Heaviest Weight",
        durationSeconds: 60,
        viewCount: 3712807,
        likes: 168000,
        commentsCount: 2210,
        date: '2026-07-30T13:00:16.000Z',
        channelName: 'Veritasium',
        channelUsername: 'veritasium',
        channelAvatarUrl: null,
        isChannelVerified: true,
        hashtags: ['engineering', 'measurement'],
    },
    {
        id: '2_Z7FB3vfFg',
        title: 'Zippers are stronger than you think...',
        durationSeconds: 64,
        viewCount: 4479059,
        likes: 201000,
        commentsCount: 3877,
        date: '2026-06-12T13:00:18.000Z',
        channelName: 'Veritasium',
        channelUsername: 'veritasium',
        channelAvatarUrl: null,
        isChannelVerified: true,
        hashtags: ['engineering', 'history'],
    },
    {
        id: '5EPPBDdhe6o',
        title: 'The Worm with 4 Nobel Prizes',
        durationSeconds: 66,
        viewCount: 1579549,
        likes: 98100,
        commentsCount: 1502,
        date: '2026-02-14T15:00:15.000Z',
        channelName: 'Kurzgesagt – In a Nutshell',
        channelUsername: 'kurzgesagt',
        channelAvatarUrl: null,
        isChannelVerified: true,
        hashtags: ['biology', 'science'],
    },
    {
        id: '2acc7oyXIZI',
        title: 'Let’s Steal a New Moon',
        durationSeconds: 70,
        viewCount: 1260861,
        likes: 84700,
        commentsCount: 2048,
        date: '2026-06-10T14:00:28.000Z',
        channelName: 'Kurzgesagt – In a Nutshell',
        channelUsername: 'kurzgesagt',
        channelAvatarUrl: null,
        isChannelVerified: true,
        hashtags: ['space', 'moons'],
    },
];

export const seedShorts: Short[] = shorts.map((s) => ({
    ...s,
    url: `https://www.youtube.com/shorts/${s.id}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${s.id}/oardefault.jpg`,
    likedByMe: false,
}));

export const seedQuizzes: SeedQuiz[] = [
    {
        videoId: '-kwF6M4juiU',
        question: 'Why did Newton include indigo as a color of the rainbow?',
        options: [
            'Indigo dye was the most valuable color of his era',
            'To match the seven notes of the Western musical scale',
            'His prism had a flaw that produced an extra band',
            'Indigo was his word for the color of the sky',
        ],
        correctIndex: 1,
        explanation: 'Newton wanted seven colors to line up with the seven notes of the scale. Do, re, mi, indigo.',
    },
    {
        videoId: '0fV8kYoGDNM',
        question: 'A sheep walks 2 mph on a train moving 2 mph. Relative to the ground, the sheep is moving…',
        options: ['Exactly 4 mph', 'Very slightly less than 4 mph', 'Very slightly more than 4 mph', "2 mph, because the train doesn't count"],
        correctIndex: 1,
        explanation: "Special relativity: velocities don't simply add. The sheep comes up an imperceptible hair short of 4 mph.",
    },
    {
        videoId: '-YWWzPiaJlE',
        question: "What helped Cape Cod's gray seal population recover?",
        options: ['A captive breeding program', 'Fewer great white sharks in the area', 'The 1972 Marine Mammal Protection Act', 'Rising summer water temperatures'],
        correctIndex: 2,
        explanation: 'The seals were regionally extinct by the 1960s. The 1972 act brought them back, and the sharks followed the snacks.',
    },
    {
        videoId: '-xdysAIg9k8',
        question: 'What is the common name of the giant single-celled alga Valonia ventricosa?',
        options: ["Mermaid's marble", "Sailor's eyeball", 'Sea grape', "Neptune's pearl"],
        correctIndex: 1,
        explanation: "Sailor's eyeball. Delightfully creepy, as advertised.",
    },
    {
        videoId: '2GUah9xHVto',
        question: "As the board is pushed, which way does the cart's big wheel turn?",
        options: ['The same way the board pushes it', "It doesn't turn. The cart slides", 'Opposite to the way the board pushes it', 'It alternates direction every rotation'],
        correctIndex: 2,
        explanation: "The wheel spins against the push, just like Blackbird's propeller pushing back on the air to outrun the wind.",
    },
    {
        videoId: '3HQkVfZ4DNY',
        question: 'Roughly how much does each calibrated mass under the floor weigh?',
        options: ['5,000 lbs', '50,000 lbs', '500,000 lbs', '1,000,000 lbs'],
        correctIndex: 1,
        explanation: 'About 50,000 lbs each. Twenty of them add up to one million pounds of force.',
    },
    {
        videoId: '2_Z7FB3vfFg',
        question: "What did Gideon Sundback's zipper machine use as its raw material?",
        options: ['Flat sheets of brass', 'Molten zinc poured into molds', 'Y-shaped metal wire', 'Pre-stamped teeth bought in bulk'],
        correctIndex: 2,
        explanation: "Y-shaped wire, sliced, dimpled and clamped onto fabric with enough precision that teeth can't wiggle loose.",
    },
    {
        videoId: '5EPPBDdhe6o',
        question: 'How many cells did scientists track in C. elegans from cradle to grave?',
        options: ['302', '959', '10,000', '37 trillion'],
        correctIndex: 1,
        explanation: '959 cells. (302 is its neuron count, if you were tempted.)',
    },
    {
        videoId: '2acc7oyXIZI',
        question: 'Which stolen moon could give Earth a donut-shaped ring?',
        options: ['Titan', 'Amalthea', 'Io', 'Europa'],
        correctIndex: 2,
        explanation: 'Io. Over 400 volcanoes, sulfur plumes 300 km high, and a short-lived ring as a housewarming gift.',
    },
];

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
