// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createOverlayCard, type OverlayHandlers } from "../src/lib/overlay-card";
import type { NowPlaying } from "../src/lib/state";

const track: NowPlaying = {
  trackKey: "/artist/track",
  trackUrl: "https://soundcloud.com/artist/track",
  title: "Fliederregen",
  artist: "Ben Böhmer",
  artistUrl: "https://soundcloud.com/artist",
  artworkUrl: "https://i1.sndcdn.com/artworks-x-t50x50.jpg",
  playing: true,
  position: 10,
  duration: 300,
  liked: false,
  reposted: false,
  shuffle: false,
  repeat: "none",
  volume: 8,
  muted: false,
  updatedAt: Date.now(),
};

function make(): { card: ReturnType<typeof createOverlayCard>; handlers: OverlayHandlers } {
  const handlers: OverlayHandlers = { onCommand: vi.fn(), onDismiss: vi.fn(), onOpen: vi.fn() };
  const card = createOverlayCard(handlers);
  document.body.append(card.host);
  return { card, handlers };
}

const q = (card: ReturnType<typeof createOverlayCard>, selector: string) =>
  card.host.shadowRoot!.querySelector<HTMLElement>(selector)!;

describe("overlay card", () => {
  it("renders the track and keeps its styles in a shadow root", () => {
    const { card } = make();
    card.update(track);
    expect(card.host.shadowRoot).not.toBeNull();
    expect(q(card, ".title").textContent).toBe("Fliederregen");
    expect(q(card, ".artist").textContent).toBe("Ben Böhmer");
    expect(q(card, ".artwork img").getAttribute("src")).toBe(track.artworkUrl);
    expect(q(card, ".play").title).toBe("Pause");
    expect(q(card, ".controls .icon:nth-child(4)").classList.contains("active")).toBe(false);
  });

  it("reflects paused and liked state", () => {
    const { card } = make();
    card.update({ ...track, playing: false, liked: true });
    expect(q(card, ".play").title).toBe("Play");
    expect(q(card, "[aria-label=Unlike]").classList.contains("active")).toBe(true);
  });

  it("sends commands and flips the play button optimistically", () => {
    const { card, handlers } = make();
    card.update(track);
    q(card, ".play").click();
    expect(handlers.onCommand).toHaveBeenCalledWith("play-pause");
    expect(q(card, ".play").title).toBe("Play");
    q(card, "[aria-label=Next]").click();
    expect(handlers.onCommand).toHaveBeenCalledWith("next");
    q(card, ".close").click();
    expect(handlers.onDismiss).toHaveBeenCalled();
    q(card, ".title").click();
    expect(handlers.onOpen).toHaveBeenCalledWith(track.trackUrl);
  });

  it("does not take focus when a button is pressed", () => {
    const { card } = make();
    card.update(track);
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    q(card, ".play").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("is hidden until shown", () => {
    const { card } = make();
    expect(card.host.hidden).toBe(true);
    expect(card.visible).toBe(false);
    card.update(track);
    card.show();
    expect(card.host.hidden).toBe(false);
    expect(card.visible).toBe(true);
    card.hide();
    expect(card.visible).toBe(false);
  });
});
