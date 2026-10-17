// Every line of judgment the app passes on its users.

export function pick<T>(list: readonly T[]): T {
    return list[Math.floor(Math.random() * list.length)];
}

export const tooEarly = ['Finish the video first.', 'Nice try. Keep watching.', "The video isn't over. Neither is your obligation.", 'Scrolling is a privilege, not a right.'] as const;

export const noGoingBack = ['There is no going back.', 'The past is behind you. So is that video.', 'Up is not a direction here.'] as const;

export const wrongAnswer = [
    'Your attention span has been noted.',
    'Rolling it back to 0:00. Get comfortable.',
    'The video believed in you.',
    'Bold choice. Incorrect, but bold.',
    'Were you even looking?',
] as const;

export const rightAnswer = ['Retained.', 'Correct. You may proceed.', 'Knowledge acquired.', 'Your teachers would be cautiously proud.'] as const;
