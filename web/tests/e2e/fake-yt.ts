import type { Page } from "@playwright/test";

/**
 * Fake window.YT injected via addInitScript. Renders a plain div inside the target element,
 * reports duration 0 until "metadata" (80 ms after load), then window.__FAKE_YT_DURATION__ (default 2 s).
 * Time advances in real time while PLAYING; ENDED fires at the end. Video IDs listed in
 * window.__FAKE_YT_ERROR_IDS__ (or localStorage "__FAKE_YT_ERROR_IDS__") emit onError(150).
 */
export function fakeYouTubeScript() {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const w = window as any;
  w.__FAKE_YT_LOG__ = [];
  if (w.__FAKE_YT_DURATION__ === undefined) w.__FAKE_YT_DURATION__ = 2;
  const errIds = (): string[] => {
    let ls: string[] = [];
    try {
      ls = JSON.parse(localStorage.getItem("__FAKE_YT_ERROR_IDS__") || "[]");
    } catch {}
    return [...(w.__FAKE_YT_ERROR_IDS__ || []), ...ls];
  };
  class Player {
    opts: any;
    div: HTMLDivElement;
    state = -1;
    t = 0;
    dur = 0;
    vid: string | null = null;
    muted = false;
    wantPlay = false;
    last = Date.now();
    timer: any;
    constructor(el: any, opts: any) {
      const target: HTMLElement = typeof el === "string" ? document.getElementById(el)! : el;
      this.opts = opts || {};
      this.div = document.createElement("div");
      this.div.setAttribute("data-testid", "fake-yt");
      this.div.style.cssText = "width:100%;height:100%;background:#222;color:#888;font:12px monospace";
      target.appendChild(this.div);
      w.__FAKE_YT_PLAYERS__ = (w.__FAKE_YT_PLAYERS__ || 0) + 1;
      setTimeout(() => this.opts.events?.onReady?.({ target: this }), 10);
      this.timer = setInterval(() => this.tick(), 50);
    }
    log(name: string, arg?: unknown) {
      w.__FAKE_YT_LOG__.push({ name, arg, vid: this.vid, at: Date.now() });
    }
    emit(s: number) {
      this.state = s;
      this.last = Date.now();
      this.opts.events?.onStateChange?.({ data: s, target: this });
    }
    start(idArg: any, autoplay: boolean) {
      const id = typeof idArg === "object" ? idArg.videoId : idArg;
      this.vid = id;
      this.t = 0;
      this.dur = 0;
      this.wantPlay = autoplay;
      this.div.textContent = "fake:" + id;
      this.div.dataset.videoId = id;
      this.emit(-1);
      setTimeout(() => {
        if (this.vid !== id) return;
        if (errIds().includes(id)) {
          this.log("error", 150);
          this.opts.events?.onError?.({ data: 150, target: this });
          return;
        }
        this.dur = Number(w.__FAKE_YT_DURATION__) || 2;
        if (this.wantPlay) this.emit(1);
        else this.emit(5);
      }, 80);
    }
    tick() {
      const now = Date.now();
      const dt = (now - this.last) / 1000;
      this.last = now;
      if (this.state === 1) {
        this.t += dt;
        if (this.t >= this.dur) {
          this.t = this.dur;
          this.emit(0);
        }
      }
    }
    loadVideoById(id: any) {
      this.log("loadVideoById", id);
      this.start(id, true);
    }
    cueVideoById(id: any) {
      this.log("cueVideoById", id);
      this.start(id, false);
    }
    playVideo() {
      this.log("playVideo");
      if (this.dur > 0) this.emit(1);
      else this.wantPlay = true;
    }
    pauseVideo() {
      this.log("pauseVideo");
      this.wantPlay = false;
      if (this.state === 1) this.emit(2);
    }
    mute() {
      this.log("mute");
      this.muted = true;
    }
    unMute() {
      this.log("unMute");
      this.muted = false;
    }
    isMuted() {
      return this.muted;
    }
    seekTo(s: number) {
      this.log("seekTo", s);
      this.t = s;
    }
    getCurrentTime() {
      return this.t;
    }
    getDuration() {
      return this.dur;
    }
    getPlayerState() {
      return this.state;
    }
    destroy() {
      clearInterval(this.timer);
      this.div.remove();
    }
  }
  w.YT = {
    Player,
    PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
  };
  setTimeout(() => w.onYouTubeIframeAPIReady?.(), 0);
}

export async function installFakeYT(page: Page) {
  await page.route("https://www.youtube.com/**", (r) => r.abort());
  await page.addInitScript(fakeYouTubeScript);
}
