const compact = new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
});

export function formatCount(n: number) {
    return compact.format(n);
}

/** 212 → "3:32" */
export function formatDuration(totalSeconds: number) {
    const s = Math.max(0, Math.round(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
];

export function formatTimeAgo(iso: string, now = Date.now()) {
    const diff = (new Date(iso).getTime() - now) / 1000;
    for (const [unit, secs] of steps) {
        if (Math.abs(diff) >= secs) return relative.format(Math.round(diff / secs), unit);
    }
    return 'just now';
}

export function initials(name: string) {
    return name
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]!.toUpperCase())
        .join('');
}
