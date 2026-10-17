// Minimal typings + loader for the YouTube IFrame Player API.
// https://developers.google.com/youtube/iframe_api_reference

export const PlayerState = {
    UNSTARTED: -1,
    ENDED: 0,
    PLAYING: 1,
    PAUSED: 2,
    BUFFERING: 3,
    CUED: 5,
} as const;

export interface YTPlayer {
    playVideo(): void;
    pauseVideo(): void;
    /** Snaps to the nearest supported rate; YouTube tops out at 2. */
    setPlaybackRate(rate: number): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    mute(): void;
    unMute(): void;
    isMuted(): boolean;
    getCurrentTime(): number;
    getDuration(): number;
    getPlayerState(): number;
    destroy(): void;
}

type PlayerOptions = {
    videoId: string;
    width?: string | number;
    height?: string | number;
    playerVars?: Record<string, string | number>;
    events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: number; target: YTPlayer }) => void;
        onError?: (e: { data: number }) => void;
    };
};

declare global {
    interface Window {
        YT?: { Player: new (el: HTMLElement, opts: PlayerOptions) => YTPlayer };
        onYouTubeIframeAPIReady?: () => void;
    }
}

let loading: Promise<NonNullable<Window['YT']>> | null = null;

export function loadYouTubeApi() {
    if (loading) return loading;
    loading = new Promise((resolve) => {
        if (window.YT?.Player) return resolve(window.YT);
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
            prev?.();
            resolve(window.YT!);
        };
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        document.head.appendChild(script);
    });
    return loading;
}

export function createPlayer(el: HTMLElement, opts: PlayerOptions) {
    return loadYouTubeApi().then((YT) => new YT.Player(el, opts));
}
