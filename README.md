# Sketchboard

A hand-drawn whiteboard in the browser — an Excalidraw-style infinite canvas with a warm, sketchy feel. Local-first: everything is saved in your browser, and a single-file standalone build runs fully offline.

## Features

- **Hand-drawn engine** — rough.js strokes, hachure fills, Virgil handwriting font
- **Infinite canvas** — zoom without limits, pan with mouse or trackpad
- **Shapes & tools** — rectangle, diamond, ellipse, arrow (with smart endpoint binding), line, freedraw, text, eraser
- **Sticky notes** — status dots, tags, and voting dots for retrospectives
- **Frames** — named regions; drag to carry their contents; `⌘F` to jump between them
- **Presentation mode** — full-screen frame walkthrough with slide transitions, laser pointer, and fading ink annotations (`I`)
- **Charts from data** — paste cells from Excel/Sheets or drop a `.csv` / `.xlsx` file to draw a hand-styled chart; double-click to edit the numbers
- **Boards** — multiple boards with search and per-board camera, theme, and zen preference
- **Movable UI** — drag any floating bar by its grip; zen mode (`Z`) hides all chrome
- **Live collaboration** — same-network rooms with presence, named cursors, and an explicit follow-the-presenter toggle (requires the dev server)
- **Export** — PNG, SVG, or a standalone HTML snapshot
- **Themes** — light and dark

## Live collaboration

Share → **Live session** starts a room on your network; guests join the link and everyone's edits and cursors stay in sync through a small WebSocket relay (`server/collab.mjs`). The relay never inspects board data — it just routes messages between room members.

- **Presence island** — the collapsible panel in the top-right corner lists who's in the room: a color dot (stable per session, assigned from a fixed palette by join order), a name, and a role — one host, everyone else a guest. It updates live as people join and leave, and steps aside in zen mode.
- **Named cursors** — remote pointers carry a small name tag under the arrow. It stays visible while the owner moves and fades after ~2 s of stillness, so quiet corners of the board don't collect labels.
- **Follow the presenter** — guests choose to follow with an explicit toggle (never automatic): while it's on, the presenter's camera — including presentation frame advances — stays in sync; toggling it off lets a guest explore freely without being yanked back. Panning and zooming never change the toggle. The presenter sees a subtle "N guests following" count in the presentation bar while the show runs.

## Run it

```bash
npm install
npm run dev        # dev server with live-collab relay
```

## Standalone single file

`sketchboard.html` is a self-contained build — double-click it and it works offline (except live collaboration). Rebuild it with:

```bash
npm run build:standalone
```

## Test

```bash
npm test               # full smoke suite (starts its own dev server)
npm run test:standalone
```

## Stack

React 19 · Vite · rough.js · lucide-react · xlsx · WebSocket relay for live sessions

## License

MIT
