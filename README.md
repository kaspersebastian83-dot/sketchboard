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
- **Live collaboration** — Share → Live session starts a room on your network (requires the dev server)
- **Export** — PNG, SVG, or a standalone HTML snapshot
- **Themes** — light and dark

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
