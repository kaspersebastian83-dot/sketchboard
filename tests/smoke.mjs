import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import XLSX from 'xlsx';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173'], { cwd: root, stdio: 'pipe' });
let browser;

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch('http://127.0.0.1:5173');
      if (response.ok) return;
    } catch { /* Vite is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Development server did not start');
}

async function scene(page) {
  return page.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1'));
    return ws.boards.find((b) => b.id === ws.activeBoardId).elements;
  });
}

async function drag(page, x1, y1, x2, y2) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5173');
  await expect(page.getByText('A quiet canvas for loud ideas.')).toBeVisible();
  await expect(page.locator('.gesture-hints')).toBeVisible();
  await page.screenshot({ path: path.join(root, 'tests', 'empty-canvas.png') });

  await page.getByTestId('tool-rectangle').click();
  await drag(page, 450, 320, 640, 450);
  expect((await scene(page)).length).toBe(1);
  await expect(page.getByTestId('tool-selection')).toHaveAttribute('aria-pressed', 'true');

  await page.getByLabel('Background color: #a5d8ff').click();
  await expect.poll(async () => (await scene(page))[0].background).toBe('#a5d8ff');
  const originalX = (await scene(page))[0].x;
  await drag(page, 540, 380, 570, 410);
  expect((await scene(page))[0].x).toBeGreaterThan(originalX);
  const moved = (await scene(page))[0];
  await drag(page, moved.x + moved.width, moved.y + moved.height, moved.x + moved.width + 35, moved.y + moved.height + 20);
  expect((await scene(page))[0].width).toBeGreaterThan(moved.width);

  await page.getByLabel('Duplicate selected').click();
  await expect.poll(async () => (await scene(page)).length).toBe(2);
  await page.getByLabel('Undo', { exact: true }).click();
  await expect.poll(async () => (await scene(page)).length).toBe(1);
  await page.getByLabel('Redo', { exact: true }).click();
  await expect.poll(async () => (await scene(page)).length).toBe(2);

  await page.getByTestId('tool-ellipse').click();
  await drag(page, 760, 300, 940, 430);
  expect((await scene(page)).length).toBe(3);

  await page.getByTestId('tool-arrow').click();
  await drag(page, 660, 520, 850, 470);
  expect((await scene(page)).length).toBe(4);

  // Grouping: marquee-select the two rectangles and treat them as one unit.
  await drag(page, 430, 300, 655, 500);
  await page.keyboard.press('ControlOrMeta+G');
  await expect.poll(async () => (await scene(page))[0].groupId).toBeTruthy();
  expect((await scene(page))[0].groupId).toBe((await scene(page))[1].groupId);
  await page.mouse.click(1000, 700);
  await drag(page, 500, 380, 560, 380);
  let rects = await scene(page);
  // The group snaps to the ellipse's center guide line, shaving 1.5px off the drag.
  const groupShift = rects[0].x - 480;
  expect(groupShift).toBeGreaterThan(54);
  expect(groupShift).toBeLessThan(61);
  expect(rects[1].x - 498).toBe(groupShift);
  await page.mouse.click(560, 380);
  await page.mouse.click(560, 380);
  const beforeDrill = await scene(page);
  await page.keyboard.press('ArrowRight');
  const afterDrill = await scene(page);
  expect([0, 1].filter((i) => afterDrill[i].x !== beforeDrill[i].x).length).toBe(1);

  // Alignment: select both rectangles again and align their tops and centers.
  await drag(page, 490, 300, 655, 500);
  await page.getByLabel('Align top edges').click();
  rects = await scene(page);
  expect(rects[0].y).toBe(rects[1].y);
  await page.getByLabel('Center horizontally').click();
  rects = await scene(page);
  expect(rects[0].x).toBe(rects[1].x);

  // Multi-resize: dragging the bounding-box corner scales the whole selection.
  await drag(page, 774.5, 500, 929.5, 650);
  rects = await scene(page);
  expect(rects[0].width).toBeGreaterThan(225);
  expect(rects[1].width).toBe(rects[0].width);
  expect(rects[0].x).toBe(rects[1].x);
  await page.keyboard.press('ControlOrMeta+Shift+G');
  await expect.poll(async () => (await scene(page))[0].groupId).toBeUndefined();
  await page.keyboard.press('Escape');

  await page.getByTestId('tool-text').click();
  await page.mouse.click(460, 610);
  await page.locator('.text-editor').fill('Ideas start here');
  await page.locator('.text-editor').press('ControlOrMeta+Enter');
  expect((await scene(page)).length).toBe(5);
  expect((await scene(page)).at(-1).text).toBe('Ideas start here');

  await page.getByTestId('tool-freedraw').click();
  await page.mouse.move(730, 610);
  await page.mouse.down();
  await page.mouse.move(760, 570, { steps: 5 });
  await page.mouse.move(800, 625, { steps: 5 });
  await page.mouse.move(850, 560, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect((await scene(page)).length).toBe(6);

  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: /Quick flow/ }).click();
  await expect.poll(async () => (await scene(page)).length).toBe(11);
  await page.getByLabel('Undo', { exact: true }).click();
  await expect.poll(async () => (await scene(page)).length).toBe(6);

  await page.getByLabel('Zoom in', { exact: true }).click();
  await expect(page.locator('.zoom-value')).not.toHaveText('100%');
  await expect(page.locator('.gesture-hints .gesture-hint.done')).toHaveCount(1);
  await expect(page.locator('.gesture-hints')).toBeVisible();
  await page.getByTitle('Fit to screen').click();

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const pngDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /PNG image/ }).click();
  expect((await pngDownload).suggestedFilename()).toBe('sketchboard.png');
  const svgDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /SVG vector/ }).click();
  expect((await svgDownload).suggestedFilename()).toBe('sketchboard.svg');
  const sketchDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /Sketch file/ }).click();
  expect((await sketchDownload).suggestedFilename()).toBe('sketchboard.sketch');
  await page.getByLabel('Close dialog').click();

  await page.getByLabel('Toggle color theme').click();
  await expect(page.locator('.app')).toHaveClass(/dark/);
  await page.screenshot({ path: path.join(root, 'tests', 'dark-canvas.png') });
  await page.getByLabel('Toggle color theme').click();
  await page.reload();
  expect((await scene(page)).length).toBe(6);

  // Performance at scale: geometry is cached and reused for unchanged elements.
  await page.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1'));
    const many = [];
    for (let i = 0; i < 400; i += 1) {
      many.push({
        id: `perf-${i}`, type: 'rectangle',
        x: 2000 + (i % 20) * 60, y: 2000 + Math.floor(i / 20) * 50,
        width: 40, height: 30, stroke: '#1971c2', background: '#a5d8ff', fillStyle: 'solid',
        strokeWidth: 2, roughness: 1, opacity: 100,
      });
    }
    localStorage.setItem('sketchboard-workspace-v1', JSON.stringify({
      ...ws,
      boards: ws.boards.map((b) => b.id === ws.activeBoardId ? { ...b, elements: [...b.elements, ...many] } : b),
    }));
  });
  await page.reload();
  await expect.poll(async () => (await scene(page)).length).toBe(406);
  const statsBefore = await page.evaluate(() => ({ ...window.__renderStats }));
  await page.getByLabel('Zoom in', { exact: true }).click();
  await page.getByLabel('Zoom out', { exact: true }).click();
  const statsAfter = await page.evaluate(() => ({ ...window.__renderStats }));
  expect(statsAfter.generated).toBe(statsBefore.generated);
  expect(statsAfter.reused).toBeGreaterThan(statsBefore.reused);
  expect(statsAfter.boundsComputed).toBe(statsBefore.boundsComputed);

  // Culling: only elements inside the viewport are drawn.
  const centerPixel = () => page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const data = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    return [data[0], data[1], data[2]];
  });
  await page.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1'));
    localStorage.setItem('sketchboard-workspace-v1', JSON.stringify({
      ...ws,
      boards: ws.boards.map((b) => b.id === ws.activeBoardId ? { ...b, camera: { x: -1890, y: -1965, zoom: 1 } } : b),
    }));
  });
  await page.reload();
  await expect.poll(centerPixel).toEqual([165, 216, 255]);
  await page.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1'));
    localStorage.setItem('sketchboard-workspace-v1', JSON.stringify({
      ...ws,
      boards: ws.boards.map((b) => b.id === ws.activeBoardId ? { ...b, camera: { x: -5000, y: -5000, zoom: 1 } } : b),
    }));
  });
  await page.reload();
  await expect.poll(centerPixel).toEqual([255, 255, 255]);
  expect((await page.evaluate(() => ({ ...window.__renderStats }))).culled).toBeGreaterThan(0);

  // Restore the small scene for the remaining checks.
  await page.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1'));
    localStorage.setItem('sketchboard-workspace-v1', JSON.stringify({
      ...ws,
      boards: ws.boards.map((b) => b.id === ws.activeBoardId
        ? { ...b, elements: b.elements.filter((el) => !el.id.startsWith('perf-')), camera: { x: 0, y: 0, zoom: 1 } }
        : b),
    }));
  });
  await page.reload();
  await expect.poll(async () => (await scene(page)).length).toBe(6);

  // Sharing: a link carries the whole board; viewers get a read-only copy.
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: /Copy link/ }).click();
  const shareLink = await page.getByLabel('Share link').inputValue();
  expect(shareLink).toContain('#share=');
  await page.getByLabel('Close dialog').click();
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(shareLink);
  await expect(guest.getByText("You're viewing a shared board")).toBeVisible();
  expect(await guest.evaluate(() => localStorage.getItem('sketchboard-workspace-v1'))).toBeNull();
  await guest.getByRole('button', { name: 'Save a copy' }).click();
  await expect.poll(() => guest.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1'));
    return ws?.boards.find((b) => b.id === ws.activeBoardId)?.elements.length ?? 0;
  })).toBe(6);
  await expect(guest.getByText("You're viewing a shared board")).toBeHidden();
  await guestContext.close();

  // Boards: create a second board, search across boards, rename and delete.
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await expect(page.getByTestId('boards-panel')).toBeVisible();
  await page.getByLabel('New board').click();
  await expect.poll(async () => (await scene(page)).length).toBe(0);
  await page.getByTestId('tool-rectangle').click();
  await drag(page, 500, 400, 640, 520);
  await expect.poll(async () => (await scene(page)).length).toBe(1);
  const wsTwo = await page.evaluate(() => JSON.parse(localStorage.getItem('sketchboard-workspace-v1')));
  expect(wsTwo.boards.length).toBe(2);
  expect(wsTwo.boards[1].name).toBe('Untitled board');

  // Search matches board names and the text inside elements.
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.getByLabel('Search boards').fill('Ideas');
  await expect(page.getByText('1 match')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Untitled board/ })).toHaveCount(0);

  // Clicking a search result jumps to the matching element on that board.
  const textElId = await page.evaluate(() => JSON.parse(localStorage.getItem('sketchboard-workspace-v1')).boards[0].elements.find((el) => el.type === 'text' && el.text.includes('Ideas')).id);
  await page.getByRole('button', { name: /^My first board/ }).click();
  await expect.poll(async () => (await scene(page)).length).toBe(6);
  await expect.poll(() => page.evaluate(() => window.__selectedIds ?? [])).toEqual([textElId]);
  const jumpCamera = await page.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1'));
    return ws.boards.find((b) => b.id === ws.activeBoardId).camera;
  });
  expect(Math.abs(jumpCamera.x) + Math.abs(jumpCamera.y)).toBeGreaterThan(0);

  // Switching without a query just loads the board as before.
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.getByLabel('Search boards').fill('');
  await page.getByRole('button', { name: /^My first board/ }).click();
  await expect.poll(async () => (await scene(page)).length).toBe(6);

  // Switch to the new board, rename it, then delete it and land back on the first.
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.getByRole('button', { name: /^Untitled board/ }).click();
  await expect.poll(async () => (await scene(page)).length).toBe(1);
  await page.getByRole('button', { name: 'Boards', exact: true }).click();
  await page.getByLabel('Rename board Untitled board').click();
  await page.getByLabel('Board name').fill('Second board');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  const wsRenamed = await page.evaluate(() => JSON.parse(localStorage.getItem('sketchboard-workspace-v1')));
  expect(wsRenamed.boards.map((b) => b.name)).toContain('Second board');
  await page.getByLabel('Delete board Second board').click();
  await page.getByRole('button', { name: 'Delete board', exact: true }).click();
  const wsDeleted = await page.evaluate(() => JSON.parse(localStorage.getItem('sketchboard-workspace-v1')));
  expect(wsDeleted.boards.length).toBe(1);
  expect(wsDeleted.boards[0].name).toBe('My first board');
  expect(wsDeleted.activeBoardId).toBe(wsDeleted.boards[0].id);
  await expect.poll(async () => (await scene(page)).length).toBe(6);
  await page.keyboard.press('Escape');

  // Legacy migration: a v1 scene becomes the first board of a fresh workspace.
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('sketchboard-scene-v1', JSON.stringify({
      elements: [{
        id: 'legacy-1', type: 'rectangle', x: 10, y: 10, width: 100, height: 80,
        stroke: '#1e1e1e', background: 'transparent', fillStyle: 'hachure',
        strokeWidth: 2, roughness: 1, opacity: 100,
      }],
      camera: { x: 0, y: 0, zoom: 1 },
      theme: 'light',
    }));
  });
  await page.reload();
  await expect.poll(async () => (await scene(page)).length).toBe(1);
  const wsMigrated = await page.evaluate(() => JSON.parse(localStorage.getItem('sketchboard-workspace-v1')));
  expect(wsMigrated.boards.length).toBe(1);
  expect(wsMigrated.boards[0].name).toBe('My first board');

  // Sticky notes: double-click empty canvas drops a note and starts typing.
  await page.mouse.dblclick(500, 500);
  await expect(page.locator('.text-editor')).toBeVisible();
  await page.locator('.text-editor').fill('Remember the milk');
  await page.locator('.text-editor').press('ControlOrMeta+Enter');
  await expect.poll(async () => (await scene(page)).length).toBe(3);
  const noteRect = (await scene(page)).find((el) => el.sticky && el.type === 'rectangle');
  const noteText = (await scene(page)).find((el) => el.sticky && el.type === 'text');
  expect(noteRect.background).toBe('#ffec99');
  expect(noteRect.stroke).toBe('#ffec99');
  expect(noteRect.groupId).toBe(noteText.groupId);
  expect(noteText.text).toBe('Remember the milk');

  // Dragging the note moves the square and its text together.
  await drag(page, 500, 500, 600, 560);
  const movedRect = (await scene(page)).find((el) => el.id === noteRect.id);
  const movedText = (await scene(page)).find((el) => el.id === noteText.id);
  expect(movedRect.x).toBe(noteRect.x + 100);
  expect(movedText.x).toBe(noteText.x + 100);

  // Double-clicking the note's text reopens the editor.
  const textPoint = await page.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1'));
    const els = ws.boards.find((b) => b.id === ws.activeBoardId).elements;
    const t = els.find((el) => el.sticky && el.type === 'text');
    return { x: t.x + 12, y: t.y + 12 };
  });
  await page.mouse.dblclick(textPoint.x, textPoint.y);
  await expect(page.locator('.text-editor')).toBeVisible();
  await page.locator('.text-editor').fill('Buy oat milk');
  await page.locator('.text-editor').press('ControlOrMeta+Enter');
  await expect.poll(async () => (await scene(page)).find((el) => el.sticky && el.type === 'text').text).toBe('Buy oat milk');
  await page.keyboard.press('Escape');

  // Smart arrows: endpoints dropped near shapes bind and follow those shapes.
  await page.getByTestId('tool-rectangle').click();
  await drag(page, 780, 300, 920, 420);
  await page.getByTestId('tool-rectangle').click();
  await drag(page, 1040, 560, 1180, 680);
  const shapeA = (await scene(page)).find((el) => el.type === 'rectangle' && el.x === 780 && el.y === 300);
  const shapeB = (await scene(page)).find((el) => el.type === 'rectangle' && el.x === 1040 && el.y === 560);
  await page.getByTestId('tool-arrow').click();
  await drag(page, 914, 404, 1046, 572);
  const smartArrow = (await scene(page)).find((el) => el.type === 'arrow' && el.startBinding);
  expect(smartArrow.startBinding.id).toBe(shapeA.id);
  expect(smartArrow.endBinding.id).toBe(shapeB.id);
  const endBefore = { x: smartArrow.x + smartArrow.width, y: smartArrow.y + smartArrow.height };

  // Advanced gesture hints: phase two unlocks once zoom and pan are mastered.
  await page.evaluate(() => localStorage.setItem('sketchboard-hints-v1', JSON.stringify({ dismissed: false, zoomed: true, panned: true, editedText: false, snapped: false })));
  await page.reload();
  await expect(page.getByText('Double-click to edit text')).toBeVisible();
  await expect(page.getByText('Drag near an edge to snap')).toBeVisible();
  await page.mouse.dblclick(1100, 250);
  await expect(page.locator('.text-editor')).toBeVisible();
  await expect(page.locator('.gesture-hint.done')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // Paste-to-chart: a copied spreadsheet range becomes an editable hand-drawn chart.
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Month\tApples\tPears\nJan\t4\t8\nFeb\t7\t5\nMar\t5\t9');
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await expect.poll(async () => (await scene(page)).filter((el) => el.chartId).length).toBeGreaterThan(6);
  const barChart = (await scene(page)).filter((el) => el.chartId);
  expect(barChart[0].chart.type).toBe('bar');
  expect(new Set(barChart.map((el) => el.groupId)).size).toBe(1);
  expect(barChart.filter((el) => el.type === 'rectangle').length).toBe(8); // 3 categories x 2 series bars + 2 legend swatches
  // Double-clicking a bar opens the chart editor; switching to line re-renders it.
  const bar = barChart.find((el) => el.type === 'rectangle');
  await page.mouse.dblclick(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await expect(page.getByLabel('Edit chart data')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Line', exact: true }).click();
  await page.getByRole('button', { name: 'Update chart' }).click();
  await expect.poll(async () => (await scene(page)).filter((el) => el.chartId)[0]?.chart.type).toBe('line');
  const lineChart = (await scene(page)).filter((el) => el.chartId);
  expect(lineChart.some((el) => el.type === 'freedraw')).toBe(true);
  // Undo restores the bar chart in one step.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await scene(page)).filter((el) => el.chartId)[0]?.chart.type).toBe('bar');
  // Remove the chart so the board is deterministic for the guide tests below.
  const anyBar = (await scene(page)).find((el) => el.chartId && el.type === 'rectangle');
  await page.mouse.click(anyBar.x + anyBar.width / 2, anyBar.y + anyBar.height / 2);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await scene(page)).filter((el) => el.chartId).length).toBe(0);
  await page.mouse.click(60, 500); // deselect

  // Images: pasting an image file drops it on the board; it renders at the right spot,
  // swaps the style panel for image info, and deletes like any other element.
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 60; c.height = 40;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#e8590c';
    ctx.fillRect(0, 0, 60, 40);
    c.toBlob(async (blob) => {
      const dt = new DataTransfer();
      dt.items.add(new File([await blob.arrayBuffer()], 'block.png', { type: 'image/png' }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    }, 'image/png');
  });
  await expect.poll(async () => (await scene(page)).filter((el) => el.type === 'image').length).toBe(1);
  const imageEl = (await scene(page)).find((el) => el.type === 'image');
  expect(imageEl.name).toBe('block.png');
  expect(imageEl.width / imageEl.height).toBeCloseTo(1.5, 1);
  // Pixels at the image center turn orange once the bitmap decodes (world→screen via stored camera).
  const boardCamera = await page.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1'));
    return ws.boards.find((b) => b.id === ws.activeBoardId).camera;
  });
  const imageScreen = {
    x: (imageEl.x + imageEl.width / 2) * boardCamera.zoom + boardCamera.x,
    y: (imageEl.y + imageEl.height / 2) * boardCamera.zoom + boardCamera.y,
  };
  await expect.poll(() => page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('.drawing-canvas');
    const px = canvas.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data;
    return px[0] > 180 && px[3] > 200; // red channel of #e8590c, fully opaque
  }, imageScreen)).toBe(true);
  // Selecting it shows image info instead of stroke controls.
  await page.mouse.click(imageScreen.x, imageScreen.y);
  await expect.poll(() => page.evaluate(() => window.__selectedIds ?? [])).toEqual([imageEl.id]);
  await expect(page.locator('.image-info')).toBeVisible();
  await expect(page.getByLabel('Stroke color')).toHaveCount(0);
  // Delete it so the board is clean for the tests below.
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await scene(page)).filter((el) => el.type === 'image').length).toBe(0);
  await page.mouse.click(60, 500); // deselect

  // File drop: a .csv or .xlsx dropped on the board becomes a chart at the drop point.
  const dropFile = ({ name, type, payload, isB64, x, y }) => page.evaluate(async ({ name, type, payload, isB64, x, y }) => {
    const dt = new DataTransfer();
    const bytes = isB64 ? Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)) : payload;
    dt.items.add(new File([bytes], name, { type }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, clientX: x, clientY: y }));
  }, { name, type, payload, isB64, x, y });
  const chartEls = async () => (await scene(page)).filter((el) => el.chartId);
  const deleteFirstChart = async () => {
    const rect = (await chartEls()).find((el) => el.type === 'rectangle');
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.keyboard.press('Delete');
  };
  // xlsx: build a real workbook and drop it; overlay shows during the drag.
  const xlsxB64 = XLSX.write((() => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Quarter', 'Revenue', 'Costs'], ['Q1', 12, 7], ['Q2', 18, 9], ['Q3', 15, 8],
    ]), 'FY26');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['City', 'Visitors'], ['Berlin', 5], ['Paris', 9], ['Rom', 7],
    ]), 'Cities');
    return wb;
  })(), { type: 'base64', bookType: 'xlsx' });
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'quarterly.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
  });
  await expect(page.locator('.file-drop-overlay')).toBeVisible();
  await dropFile({ name: 'quarterly.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', payload: xlsxB64, isB64: true, x: 700, y: 400 });
  // A multi-sheet workbook opens a picker; choosing a sheet draws that sheet's chart.
  await expect(page.getByLabel('Choose a sheet')).toBeVisible();
  await expect(page.getByText('FY26')).toBeVisible();
  await expect(page.getByText('Cities')).toBeVisible();
  await expect(page.getByLabel('Choose a sheet').getByText('3 rows · 1 series')).toHaveCount(1);
  // "Chart all sheets" draws one chart per sheet, side by side, in one step.
  await page.getByRole('button', { name: 'Chart all sheets' }).click();
  await expect.poll(async () => new Set((await chartEls()).map((el) => el.chartId)).size).toBe(2);
  await expect.poll(async () => (await chartEls()).some((el) => el.chart.table.series[0].name === 'Visitors')).toBe(true);
  await expect.poll(async () => (await chartEls()).some((el) => el.chart.table.series[1]?.name === 'Costs')).toBe(true);
  const sideBySide = (await chartEls()).filter((el) => el.type === 'rectangle').map((el) => [el.x, el.x + el.width]);
  const rowMin = Math.min(...sideBySide.map((b) => b[0]));
  const rowMax = Math.max(...sideBySide.map((b) => b[1]));
  expect(rowMax - rowMin).toBeGreaterThan(560 + 48 - 60); // two charts span wider than one chart plus the gap
  expect(Math.abs((rowMin + rowMax) / 2 - 700)).toBeLessThan(60); // the row is centered on the drop point
  await expect(page.locator('.file-drop-overlay')).toHaveCount(0);
  // Undo removes both charts in one step.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await chartEls()).length).toBe(0);
  // Dropping again and picking a single sheet draws just that one.
  await dropFile({ name: 'quarterly.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', payload: xlsxB64, isB64: true, x: 700, y: 400 });
  await expect(page.getByLabel('Choose a sheet')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: /Cities/ }).click();
  await expect.poll(async () => (await chartEls()).length).toBeGreaterThan(6);
  const xlsxChart = await chartEls();
  expect(xlsxChart[0].chart.type).toBe('bar');
  expect(xlsxChart.filter((el) => el.type === 'rectangle').length).toBe(3); // 3 single-series bars
  expect(xlsxChart.some((el) => el.chart.table.series[0].name === 'Visitors')).toBe(true);
  const xlsxBounds = xlsxChart.map((el) => [el.x, el.y, el.x + el.width, el.y + el.height]);
  const union = [Math.min(...xlsxBounds.map((b) => b[0])), Math.min(...xlsxBounds.map((b) => b[1])), Math.max(...xlsxBounds.map((b) => b[2])), Math.max(...xlsxBounds.map((b) => b[3]))];
  expect(union[0] - 2 <= 700 && 700 <= union[2] + 2 && union[1] - 2 <= 400 && 400 <= union[3] + 2).toBe(true);
  // The selected chart wears a linked-file badge naming its file and sheet.
  await expect(page.locator('.chart-badge')).toContainText('quarterly.xlsx · Cities');
  // Update-from-file: dropping a workbook whose sheet matches the chart's
  // sheet name refreshes the chart in place — same spot, no duplicate, no picker.
  const boxBefore = xlsxChart.find((el) => el.chart?.box)?.chart.box;
  const v2b64 = XLSX.write((() => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['City', 'Visitors'], ['Berlin', 20], ['Paris', 14], ['Rom', 9],
    ]), 'Cities');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Quarter', 'Revenue'], ['Q1', 12], ['Q2', 18],
    ]), 'FY26');
    return wb;
  })(), { type: 'base64', bookType: 'xlsx' });
  await dropFile({ name: 'quarterly-v2.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', payload: v2b64, isB64: true, x: 700, y: 400 });
  await expect.poll(async () => (await chartEls()).some((el) => el.chart.table.series[0].values[0] === 20)).toBe(true);
  await expect(page.getByLabel('Choose a sheet')).toHaveCount(0); // matched by sheet name, no picker
  expect(new Set((await chartEls()).map((el) => el.chartId)).size).toBe(1); // updated, not duplicated
  expect((await chartEls()).find((el) => el.chart?.box)?.chart.box).toEqual(boxBefore); // same spot
  await expect(page.locator('.chart-badge')).toContainText('quarterly-v2.xlsx · Cities'); // badge tracks the new file
  // A CSV dropped onto the chart updates it too.
  await dropFile({ name: 'update.csv', type: 'text/csv', payload: 'City;Visitors\nBerlin;11\nParis;3\nRom;8', isB64: false, x: 700, y: 400 });
  await expect.poll(async () => (await chartEls()).some((el) => el.chart.table.series[0].values[0] === 11)).toBe(true);
  expect(new Set((await chartEls()).map((el) => el.chartId)).size).toBe(1);
  expect((await chartEls()).find((el) => el.chart?.box)?.chart.box).toEqual(boxBefore);
  await expect(page.locator('.chart-badge')).toContainText('update.csv');
  // Unlinking detaches the chart: a multi-sheet drop now asks instead of matching silently.
  await page.getByRole('button', { name: 'Unlink chart from file' }).click();
  await expect(page.locator('.chart-badge')).toHaveCount(0);
  await dropFile({ name: 'quarterly-v2.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', payload: v2b64, isB64: true, x: 700, y: 400 });
  await expect(page.getByLabel('Choose a sheet')).toBeVisible();
  await expect(page.getByText('replace the data of the chart underneath?')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: /Cities/ }).click();
  await expect.poll(async () => (await chartEls()).some((el) => el.chart.table.series[0].values[0] === 20)).toBe(true);
  expect(new Set((await chartEls()).map((el) => el.chartId)).size).toBe(1);
  expect((await chartEls()).find((el) => el.chart?.box)?.chart.box).toEqual(boxBefore);
  await expect(page.locator('.chart-badge')).toContainText('quarterly-v2.xlsx · Cities');
  // Semicolon CSV (European Excel export) drops and parses too.
  await dropFile({ name: 'euro.csv', type: 'text/csv', payload: 'Stadt;Umsatz\nBerlin;5\nParis;9\nRom;7', isB64: false, x: 1100, y: 620 });
  await expect.poll(async () => (await chartEls()).length).toBeGreaterThan(xlsxChart.length);
  await expect.poll(async () => (await chartEls()).some((el) => el.chart.table.series[0].name === 'Umsatz')).toBe(true);
  // Unsupported files are rejected with a toast, no chart inserted.
  const countBeforePdf = (await chartEls()).length;
  await dropFile({ name: 'notes.pdf', type: 'application/pdf', payload: '%PDF-1.4', isB64: false, x: 300, y: 300 });
  await expect(page.getByText('Drop an image, or a .csv / .tsv / .xlsx file to draw a chart')).toBeVisible();
  await expect.poll(async () => (await chartEls()).length).toBe(countBeforePdf);
  // Clean up both dropped charts so the guide tests below see the seeded board only.
  await deleteFirstChart();
  await deleteFirstChart();
  await expect.poll(async () => (await chartEls()).length).toBe(0);
  await page.mouse.click(60, 500); // deselect

  // Lasso + draw-and-hold: a freehand loop selects by center point, and holding
  // the pointer still before releasing snaps a fresh shape to its perfect form.
  // Teleport to an empty region; screen = world + (3200, 2400).
  await page.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1'));
    localStorage.setItem('sketchboard-workspace-v1', JSON.stringify({
      ...ws,
      boards: ws.boards.map((b) => b.id === ws.activeBoardId ? { ...b, camera: { x: 3200, y: 2400, zoom: 1 } } : b),
    }));
  });
  await page.reload();
  await page.waitForFunction(() => window.__renderStats);
  const elsBefore = (await scene(page)).length;
  await page.getByTestId('tool-rectangle').click();
  await drag(page, 300, 300, 420, 400);
  await page.getByTestId('tool-rectangle').click();
  await drag(page, 900, 300, 1020, 400);
  const drawn = (await scene(page)).slice(elsBefore);
  expect(drawn.length).toBe(2);
  const [rectA, rectB] = drawn;
  // A lasso loop around rect A selects just A (content joins by center point).
  const lassoAround = async (cx, cy, rx, ry, shift = false) => {
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(cx - rx, cy - ry);
    await page.mouse.down();
    for (const [px, py] of [[cx + rx, cy - ry], [cx + rx, cy + ry], [cx - rx, cy + ry], [cx - rx, cy - ry]]) {
      await page.mouse.move(px, py, { steps: 4 });
    }
    await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
  };
  await page.getByTestId('tool-lasso').click();
  await lassoAround(360, 350, 120, 110);
  await expect.poll(() => page.evaluate(() => window.__selectedIds ?? [])).toEqual([rectA.id]);
  // Shift-lasso around rect B adds it to the selection.
  await lassoAround(960, 350, 120, 110, true);
  await expect.poll(() => page.evaluate(() => [...(window.__selectedIds ?? [])].sort())).toEqual([rectA.id, rectB.id].sort());
  // A lasso around empty space clears the selection.
  await lassoAround(700, 650, 150, 100);
  await expect.poll(() => page.evaluate(() => window.__selectedIds ?? [])).toEqual([]);
  // Draw-and-hold: drawing a wide rectangle and holding still snaps it to a
  // 160×160 square centered on the drawn box; a quick drag stays a rectangle.
  await page.getByTestId('tool-rectangle').click();
  await page.mouse.move(300, 600);
  await page.mouse.down();
  await page.mouse.move(460, 660, { steps: 6 });
  await page.waitForTimeout(850); // hold still before releasing
  await page.mouse.up();
  const heldRect = (await scene(page)).at(-1);
  expect(Math.abs(heldRect.width - heldRect.height)).toBeLessThan(1);
  expect(Math.abs(heldRect.width - 160)).toBeLessThan(2);
  expect(Math.abs(heldRect.x - -2900)).toBeLessThan(2);
  expect(Math.abs(heldRect.y - -1850)).toBeLessThan(2);
  await page.getByTestId('tool-rectangle').click();
  await drag(page, 300, 700, 400, 760); // quick release: proportions untouched
  const quickRect = (await scene(page)).at(-1);
  expect(Math.abs(quickRect.width - 100)).toBeLessThan(2);
  expect(Math.abs(quickRect.height - 60)).toBeLessThan(2);
  // Lines keep their length but snap to the nearest 45° when held.
  await page.getByTestId('tool-line').click();
  await page.mouse.move(600, 600);
  await page.mouse.down();
  await page.mouse.move(680, 660, { steps: 6 });
  await page.waitForTimeout(850);
  await page.mouse.up();
  const heldLine = (await scene(page)).at(-1);
  expect(heldLine.type).toBe('line');
  expect(Math.abs(heldLine.width - heldLine.height)).toBeLessThan(1.5);
  expect(Math.abs(Math.hypot(heldLine.width, heldLine.height) - 100)).toBeLessThan(2);
  await page.getByTestId('tool-line').click();
  await drag(page, 600, 700, 680, 760); // quick release: angle untouched
  const quickLine = (await scene(page)).at(-1);
  expect(Math.abs(quickLine.width - 80)).toBeLessThan(2);
  expect(Math.abs(quickLine.height - 60)).toBeLessThan(2);
  // Marquee the test region and delete it so later tests see a clean board.
  await page.keyboard.press('Escape'); // clear selection so the style panel can't swallow the drag
  await page.getByTestId('tool-selection').click();
  await drag(page, 200, 200, 1120, 800);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await scene(page)).length).toBe(elsBefore);

  // Connectors: the arrow tool glues to shape anchors and the arrow follows
  // the shapes as they move. Screen = world + (3200, 2400) here.
  const elsBeforeConnect = (await scene(page)).length;
  await page.getByTestId('tool-rectangle').click();
  await drag(page, 300, 300, 460, 420); // world (-2900,-2100) → (-2740,-1980)
  await page.getByTestId('tool-rectangle').click();
  await drag(page, 800, 300, 960, 420); // world (-2400,-2100) → (-2240,-1980)
  const connA = (await scene(page)).at(-2);
  const connB = (await scene(page)).at(-1);
  // Drag from A's east anchor to B's west anchor (both at screen y 360).
  await page.getByTestId('tool-arrow').click();
  await drag(page, 460, 360, 800, 360);
  const connector = (await scene(page)).find((el) => el.type === 'arrow' && el.startBinding?.anchor);
  expect(connector).toBeTruthy();
  expect(connector.startBinding.id).toBe(connA.id);
  expect(connector.startBinding.anchor).toBe('e');
  expect(connector.endBinding.id).toBe(connB.id);
  expect(connector.endBinding.anchor).toBe('w');
  expect(Math.abs(connector.x - (connA.x + connA.width))).toBeLessThan(1);
  expect(Math.abs(connector.y - (connA.y + connA.height / 2))).toBeLessThan(1);
  expect(Math.abs(connector.x + connector.width - connB.x)).toBeLessThan(1);
  expect(Math.abs(connector.y + connector.height - (connB.y + connB.height / 2))).toBeLessThan(1);
  // Moving B carries the connector's end; the start stays pinned to A.
  await page.keyboard.press('Escape');
  await page.getByTestId('tool-selection').click();
  await page.mouse.click(880, 360);
  await drag(page, 880, 360, 980, 360); // B slides 100 to the right
  const movedB = (await scene(page)).find((el) => el.id === connB.id);
  const carried = (await scene(page)).find((el) => el.type === 'arrow' && el.startBinding?.anchor);
  expect(carried).toBeTruthy();
  expect(Math.abs(carried.x + carried.width - movedB.x)).toBeLessThan(1);
  expect(Math.abs(carried.y + carried.height - (movedB.y + movedB.height / 2))).toBeLessThan(1);
  expect(Math.abs(carried.x - (connA.x + connA.width))).toBeLessThan(1);
  // Cleaning up the shapes takes the arrow along in selection; delete all three.
  await page.keyboard.press('Escape');
  await drag(page, 200, 200, 1120, 800);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await scene(page)).length).toBe(elsBeforeConnect);

  // Frames: named regions that carry their contents, with a jump-to list.
  // Teleport far from the seeded board; screen = world − (1600, 1000).
  await page.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1'));
    localStorage.setItem('sketchboard-workspace-v1', JSON.stringify({
      ...ws,
      boards: ws.boards.map((b) => b.id === ws.activeBoardId ? { ...b, camera: { x: -1600, y: -1000, zoom: 1 } } : b),
    }));
  });
  await page.reload();
  await page.waitForFunction(() => window.__renderStats); // effects attached, keyboard live
  await page.keyboard.press('f');
  await drag(page, 300, 200, 700, 500); // world 1900,1200 → 2300,1500
  await expect.poll(async () => (await scene(page)).filter((el) => el.type === 'frame').length).toBe(1);
  let frame = (await scene(page)).find((el) => el.type === 'frame');
  expect(frame.name).toBe('Frame 1');
  expect(frame.width).toBe(400);
  expect(frame.height).toBe(300);

  // A rectangle drawn inside the frame is a child of it.
  await page.getByTestId('tool-rectangle').click();
  await drag(page, 380, 300, 520, 400); // world 1980,1300 → 2120,1400
  const innerRect = (await scene(page)).find((el) => el.type === 'rectangle' && el.x === 1980 && el.y === 1300);
  expect(innerRect).toBeTruthy();

  // Double-clicking the name chip opens an inline rename; Enter commits.
  await page.mouse.dblclick(330, 190); // chip at world (1910, 1182…1206) → screen (310, 182…206)
  await expect(page.locator('.frame-rename')).toBeVisible();
  await page.locator('.frame-rename').fill('Q4 Retro');
  await page.locator('.frame-rename').press('Enter');
  await expect.poll(async () => (await scene(page)).find((el) => el.type === 'frame').name).toBe('Q4 Retro');

  // Dragging the frame by its chip carries the child rectangle along.
  const rectBefore = (await scene(page)).find((el) => el.id === innerRect.id);
  await drag(page, 330, 190, 430, 240); // chip drag: +100, +50 world
  const rectAfter = (await scene(page)).find((el) => el.id === innerRect.id);
  expect(rectAfter.x).toBe(rectBefore.x + 100);
  expect(rectAfter.y).toBe(rectBefore.y + 50);

  // A frame drawn inside another nests — dragging the outer border moves both.
  await page.keyboard.press('f');
  await drag(page, 500, 300, 620, 420); // world 2100,1300 → 2220,1420, inside the moved outer frame
  const innerFrame = (await scene(page)).find((el) => el.type === 'frame' && el.name === 'Frame 2');
  expect(innerFrame).toBeTruthy();
  await drag(page, 400, 400, 470, 430); // outer frame's left edge: +70, +30 world
  const outerAfter = (await scene(page)).find((el) => el.type === 'frame' && el.name === 'Q4 Retro');
  const innerFrameAfter = (await scene(page)).find((el) => el.id === innerFrame.id);
  expect(outerAfter.x).toBe(2070);
  expect(innerFrameAfter.x).toBe(2170);
  expect(innerFrameAfter.y).toBe(1330);

  // ⌘F opens the jump-to panel; filtering narrows the list; clicking flies.
  await page.keyboard.press('ControlOrMeta+f');
  await expect(page.getByTestId('frames-panel')).toBeVisible();
  await page.getByLabel('Search frames').fill('Q4');
  await expect(page.getByRole('button', { name: /Q4 Retro/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Frame 2/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Q4 Retro/ }).click();
  await expect(page.getByTestId('frames-panel')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1'));
    const board = ws.boards.find((b) => b.id === ws.activeBoardId);
    const cam = board.camera;
    const f = board.elements.find((el) => el.type === 'frame' && el.name === 'Q4 Retro');
    const sx = (f.x + f.width / 2) * cam.zoom + cam.x;
    const sy = (f.y + f.height / 2) * cam.zoom + cam.y;
    return Math.hypot(sx - window.innerWidth / 2, sy - window.innerHeight / 2);
  })).toBeLessThan(3);

  // Escape closes the panel again.
  await page.keyboard.press('ControlOrMeta+f');
  await expect(page.getByTestId('frames-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('frames-panel')).toHaveCount(0);

  // Clean up: fly back, marquee the test region, delete it, restore the camera.
  await page.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1'));
    localStorage.setItem('sketchboard-workspace-v1', JSON.stringify({
      ...ws,
      boards: ws.boards.map((b) => b.id === ws.activeBoardId ? { ...b, camera: { x: -1600, y: -1000, zoom: 1 } } : b),
    }));
  });
  await page.reload();
  await page.waitForFunction(() => window.__renderStats);
  await drag(page, 150, 90, 1400, 880); // marquee over the whole frame test region
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await scene(page)).filter((el) => el.type === 'frame').length).toBe(0);
  await expect.poll(async () => (await scene(page)).length).toBe(8);
  await page.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1'));
    localStorage.setItem('sketchboard-workspace-v1', JSON.stringify({
      ...ws,
      boards: ws.boards.map((b) => b.id === ws.activeBoardId ? { ...b, camera: { x: 0, y: 0, zoom: 1 } } : b),
    }));
  });
  await page.reload();
  await page.waitForFunction(() => window.__renderStats);

  // Dragging a bound shape carries the arrow endpoint along.
  await page.mouse.click(1110, 620);
  await drag(page, 1110, 620, 1184, 660);
  let linked = (await scene(page)).find((el) => el.id === smartArrow.id);
  expect(linked.x + linked.width).toBe(endBefore.x + 74);
  expect(linked.y + linked.height).toBe(endBefore.y + 40);

  // Keyboard nudges move the endpoint one pixel at a time.
  await page.keyboard.press('ArrowRight');
  linked = (await scene(page)).find((el) => el.id === smartArrow.id);
  expect(linked.x + linked.width).toBe(endBefore.x + 75);

  // Deleting the bound shape releases the arrow cleanly.
  await page.keyboard.press('Delete');
  linked = (await scene(page)).find((el) => el.id === smartArrow.id);
  expect(linked.endBinding).toBeUndefined();
  expect(linked.startBinding.id).toBe(shapeA.id);

  // Alignment guides: dragging near another shape's edge snaps with a guide line.
  await page.mouse.move(850, 360);
  await page.mouse.down();
  await page.mouse.move(793, 360, { steps: 6 });
  await expect(page.locator('.snap-guide').first()).toBeVisible();
  expect((await scene(page)).find((el) => el.id === shapeA.id).x).toBe(720);
  await page.mouse.up();
  await expect(page.locator('.snap-guide')).toHaveCount(0);
  expect((await scene(page)).find((el) => el.id === shapeA.id).x).toBe(720);
  await expect(page.locator('.gesture-hints')).toHaveCount(0);

  // Sticky tags, status, and voting dots: a retro toolkit on every note.
  await page.mouse.dblclick(250, 500);
  await expect(page.locator('.text-editor')).toBeVisible();
  await page.locator('.text-editor').fill('Faster sync');
  await page.locator('.text-editor').press('ControlOrMeta+Enter');
  const retroRect = (await scene(page)).find((el) => el.sticky && el.type === 'rectangle' && Math.abs(el.x - 130) < 60);
  expect(retroRect).toBeTruthy();
  // Even with only the note's text selected, its retro tools are offered.
  await expect(page.getByLabel('Went well')).toBeVisible();
  await page.getByLabel('Went well').click();
  await expect.poll(async () => (await scene(page)).find((el) => el.id === retroRect.id).status).toBe('well');
  await page.getByLabel('Add tag').fill('backend');
  await page.getByLabel('Add tag').press('Enter');
  await page.getByLabel('Add tag').fill('ux');
  await page.getByLabel('Add tag').press('Enter');
  await expect.poll(async () => (await scene(page)).find((el) => el.id === retroRect.id).tags.length).toBe(2);
  // Votes go up in the panel, then on the canvas badge; right-click takes one back.
  await page.getByLabel('Add vote').click();
  await page.getByLabel('Add vote').click();
  await expect.poll(async () => (await scene(page)).find((el) => el.id === retroRect.id).votes).toBe(2);
  const badgePoint = { x: retroRect.x + retroRect.width - 14, y: retroRect.y + 40 };
  await page.mouse.click(badgePoint.x, badgePoint.y);
  await expect.poll(async () => (await scene(page)).find((el) => el.id === retroRect.id).votes).toBe(3);
  await page.mouse.click(badgePoint.x, badgePoint.y, { button: 'right' });
  await expect.poll(async () => (await scene(page)).find((el) => el.id === retroRect.id).votes).toBe(2);
  await page.getByLabel('Remove tag backend').click();
  await expect.poll(async () => (await scene(page)).find((el) => el.id === retroRect.id).tags.length).toBe(1);
  // Clean up the note so the remaining checks see the seeded board only.
  await drag(page, 100, 340, 420, 660);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await scene(page)).length).toBe(7);

  // Presentation mode: a clean, full-screen walkthrough of the board's frames.
  // (Frame 1 lives at x≥300 — with a draw tool active the floating style panel
  // covers the top-left 240px and would eat the drag.)
  await page.getByTestId('tool-frame').click();
  await drag(page, 300, 200, 600, 430);
  await page.keyboard.press('f');
  await drag(page, 900, 140, 1200, 380);
  await expect.poll(async () => (await scene(page)).filter((el) => el.type === 'frame').length).toBe(2);
  const cameraNear = async (ex, ey) => page.evaluate(({ ex: x, ey: y }) => {
    const ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1'));
    const cam = ws.boards.find((b) => b.id === ws.activeBoardId).camera;
    return Math.abs(cam.x - x) < 3 && Math.abs(cam.y - y) < 3;
  }, { ex, ey });
  await page.getByRole('button', { name: 'Present' }).click();
  await expect(page.locator('.presentation')).toBeVisible();
  await expect(page.locator('.presentation-title')).toContainText('Frame 1');
  await expect(page.locator('.presentation-title')).toContainText('1 of 2');
  // The camera flies to frame 1: center (450,315) at the 150% cap.
  await expect.poll(() => cameraNear(45, -22.5)).toBe(true);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.presentation-title')).toContainText('Frame 2');
  await expect(page.locator('.presentation-title')).toContainText('2 of 2');
  await expect.poll(() => cameraNear(-855, 60)).toBe(true);
  // Stepping past the last frame wraps back to the first; ← goes back.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.presentation-title')).toContainText('Frame 1');
  await expect.poll(() => cameraNear(45, -22.5)).toBe(true);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.presentation-title')).toContainText('Frame 2');
  // The step is a slide, not a jump: mid-transition the camera sits between
  // the two frames' positions, then settles exactly on the target.
  await page.waitForTimeout(200);
  const midSlide = await page.evaluate(() => window.__camera);
  expect(midSlide.x).toBeLessThan(-100);
  expect(midSlide.x).toBeGreaterThan(-855);
  await expect.poll(() => cameraNear(-855, 60)).toBe(true);
  // Laser pointer: moving the mouse paints a red trail on the overlay canvas,
  // and the trail fades away after the pointer idles.
  const laser = page.locator('.laser-canvas');
  await expect(laser).toBeAttached();
  await page.mouse.move(400, 400);
  await page.mouse.move(700, 500, { steps: 12 });
  await page.waitForTimeout(150);
  const litPixels = await page.evaluate(() => {
    const canvas = document.querySelector('.laser-canvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 150 && data[i + 1] < 110) count += 1;
    return count;
  });
  expect(litPixels).toBeGreaterThan(20);
  await page.waitForTimeout(2400);
  const fadedPixels = await page.evaluate(() => {
    const canvas = document.querySelector('.laser-canvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 150 && data[i + 1] < 110) count += 1;
    return count;
  });
  expect(fadedPixels).toBeLessThan(litPixels);

  // Ephemeral ink: pressing I toggles ink mode; a dragged stroke paints orange
  // ink on the overlay canvas, stays put, then fades to nothing.
  await page.keyboard.press('i');
  await expect(page.locator('.presentation')).toHaveClass(/ink-mode/);
  const inkPixels = async () => page.evaluate(() => {
    const canvas = document.querySelector('.ink-canvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 180 && data[i + 1] > 60 && data[i + 1] < 170 && data[i + 2] < 80) count += 1;
    }
    return count;
  });
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(760, 420, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  expect(await inkPixels()).toBeGreaterThan(20);
  await page.waitForTimeout(4800);
  expect(await inkPixels()).toBe(0);
  // Escape exits ink mode first, then a second Escape leaves the presentation.
  await page.keyboard.press('Escape');
  await expect(page.locator('.presentation')).toHaveClass(/^(?!.*ink-mode).*$/);
  await expect(page.locator('.presentation')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.presentation')).toHaveCount(0);
  // Clean up: reset the camera, then chip-click each frame and delete it.
  await page.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1'));
    localStorage.setItem('sketchboard-workspace-v1', JSON.stringify({
      ...ws,
      boards: ws.boards.map((b) => b.id === ws.activeBoardId ? { ...b, camera: { x: 0, y: 0, zoom: 1 } } : b),
    }));
  });
  await page.reload();
  await page.waitForFunction(() => window.__renderStats);
  await page.mouse.click(320, 194); // frame 1's name chip
  await page.keyboard.press('Delete');
  await page.mouse.click(950, 134); // frame 2's name chip
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await scene(page)).filter((el) => el.type === 'frame').length).toBe(0);
  await expect.poll(async () => (await scene(page)).length).toBe(7);

  // Infinite zoom: zoom far past the old 400% ceiling, then far below the old 10% floor.
  const activeCamera = () => page.evaluate(() => {
    const ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1'));
    return ws.boards.find((b) => b.id === ws.activeBoardId).camera;
  });
  await expect(page.locator('.minimap')).toBeVisible();
  for (let i = 0; i < 12; i++) await page.keyboard.press('=');
  await expect.poll(async () => (await activeCamera()).zoom).toBeGreaterThan(4);
  for (let i = 0; i < 26; i++) await page.keyboard.press('-');
  await expect.poll(async () => (await activeCamera()).zoom).toBeLessThan(0.1);
  await expect(page.locator('.zoom-value')).not.toHaveText('100%');

  // Draw in two far-apart regions of the unbounded canvas while zoomed way out.
  const countBefore = (await scene(page)).length;
  await page.getByTestId('tool-rectangle').click();
  await drag(page, 400, 600, 460, 660);
  await page.getByTestId('tool-rectangle').click();
  await drag(page, 900, 300, 990, 370);
  await expect.poll(async () => (await scene(page)).length).toBe(countBefore + 2);
  const farRects = (await scene(page)).filter((el) => el.type === 'rectangle').slice(-2);
  expect(Math.abs(farRects[0].x - farRects[1].x)).toBeGreaterThan(3000);

  // Minimap navigator: drag across it and the camera pans to follow.
  const camBeforePan = await activeCamera();
  const mapBox = await page.locator('.minimap').boundingBox();
  await page.mouse.move(mapBox.x + mapBox.width * 0.25, mapBox.y + mapBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(mapBox.x + mapBox.width * 0.7, mapBox.y + mapBox.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await activeCamera()).x).not.toBe(camBeforePan.x);
  await page.getByLabel('Hide minimap').click();
  await expect(page.locator('.minimap')).toHaveCount(0);
  await page.getByLabel('Show minimap').click();
  await expect(page.locator('.minimap')).toBeVisible();

  // Mouse-first navigation: plain wheel zooms at the cursor, Shift+wheel pans sideways,
  // right-drag pans, and ⇧1 zooms to fit everything.
  const zoomBeforeWheel = (await activeCamera()).zoom;
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await activeCamera()).zoom).toBeGreaterThan(zoomBeforeWheel);
  const xBeforeShiftWheel = (await activeCamera()).x;
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 120);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await activeCamera()).x).not.toBe(xBeforeShiftWheel);
  await expect(page.locator('.gesture-hints')).toHaveCount(0);
  const camBeforeRightDrag = await activeCamera();
  await page.mouse.move(700, 450);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(760, 500, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await expect.poll(async () => (await activeCamera()).y).not.toBe(camBeforeRightDrag.y);
  const zoomBeforeFit = (await activeCamera()).zoom;
  await page.keyboard.press('Shift+Digit1');
  await expect.poll(async () => (await activeCamera()).zoom).not.toBe(zoomBeforeFit);

  await page.getByLabel('Help and shortcuts').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Keyboard shortcuts', { exact: true })).toBeVisible();
  await page.getByLabel('Close dialog').click();

  await page.mouse.click(1200, 760);
  await page.getByTestId('tool-selection').click();
  await page.keyboard.press('Escape');

  // Movable bars: dragging a bar's grip lifts it off its default dock, the
  // position persists across reloads, and Reset panel positions restores
  // the default layout.
  const toolbar = page.locator('.toolbar');
  const docked = await toolbar.boundingBox();
  const grip = await page.locator('.toolbar .island-grip').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 140, grip.y + grip.height / 2 + 90, { steps: 6 });
  await page.mouse.up();
  const floated = await toolbar.boundingBox();
  expect(Math.abs(floated.x - docked.x)).toBeGreaterThan(100);
  expect(floated.y).toBeGreaterThan(docked.y + 60);
  await page.reload();
  await page.waitForFunction(() => window.__renderStats);
  const persisted = await toolbar.boundingBox();
  expect(Math.abs(persisted.x - docked.x)).toBeGreaterThan(100);
  await page.getByLabel('Main menu').click();
  await page.getByRole('button', { name: 'Reset panel positions' }).click();
  const restored = await toolbar.boundingBox();
  expect(Math.abs(restored.x - docked.x)).toBeLessThan(3);
  expect(Math.abs(restored.y - docked.y)).toBeLessThan(3);

  // Zen mode: Z hides every floating bar and shows the exit hint; Esc brings
  // the UI back.
  await page.keyboard.press('z');
  await expect(page.locator('.app')).toHaveClass(/zen/);
  await expect(page.locator('.toolbar')).toBeHidden();
  await expect(page.locator('.top-left')).toBeHidden();
  await expect(page.locator('.zen-hint')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.app')).not.toHaveClass(/zen/);
  await expect(page.locator('.toolbar')).toBeVisible();
  // Zen is a per-board preference: it survives a reload until Esc turns it off.
  await page.keyboard.press('z');
  await page.reload();
  await page.waitForFunction(() => window.__renderStats);
  await expect(page.locator('.app')).toHaveClass(/zen/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.app')).not.toHaveClass(/zen/);
  // Presentations open in zen for a clean first frame and hand the previous
  // desk state back when they end.
  await page.keyboard.press('f');
  await drag(page, 300, 300, 640, 520);
  await page.getByRole('button', { name: 'Present' }).click();
  await expect(page.locator('.presentation')).toBeVisible();
  await expect(page.locator('.app')).toHaveClass(/zen/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.presentation')).toHaveCount(0);
  await expect(page.locator('.app')).not.toHaveClass(/zen/);
  // Clean up the scratch frame.
  await page.keyboard.press('v');
  await drag(page, 280, 280, 660, 540);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await scene(page)).filter((el) => el.type === 'frame').length).toBe(0);
  await page.screenshot({ path: path.join(root, 'tests', 'whiteboard.png') });

  // Live collaboration: a second browser joins the same room over the dev
  // server's WebSocket relay — board edits, cursors, and the presenter's
  // camera all sync; a guest who pans drops into free navigation and can
  // re-follow with the Follow chip.
  const liveRoom = `smoke-${Date.now().toString(36)}`;
  const liveHost = await browser.newContext();
  const liveHostPage = await liveHost.newPage({ viewport: { width: 1440, height: 900 } });
  await liveHostPage.goto(`http://127.0.0.1:5173/?live=${liveRoom}`);
  await liveHostPage.waitForFunction(() => window.__renderStats);
  await expect(liveHostPage.locator('.live-indicator')).toBeVisible();
  const liveGuest = await browser.newContext();
  const liveGuestPage = await liveGuest.newPage({ viewport: { width: 1440, height: 900 } });
  await liveGuestPage.goto(`http://127.0.0.1:5173/?live=${liveRoom}`);
  await liveGuestPage.waitForFunction(() => window.__renderStats);
  await liveGuestPage.locator('.live-indicator').click();
  // Both sides see a two-person roster with exactly one host.
  await expect.poll(async () => liveGuestPage.locator('.live-roster li').count()).toBe(2);
  expect(await liveGuestPage.locator('.live-roster .live-host').count()).toBe(1);
  // Edits sync: host draws a rectangle, guest receives it (via the relay,
  // into their own persisted scene).
  await liveHostPage.getByTestId('tool-rectangle').click();
  await drag(liveHostPage, 300, 300, 420, 390);
  await expect.poll(async () => (await scene(liveGuestPage)).some((el) => el.type === 'rectangle')).toBe(true);
  // Cursors sync: host moves over the canvas, guest sees a named remote cursor.
  await liveHostPage.mouse.move(500, 500);
  await liveHostPage.mouse.move(620, 560, { steps: 6 });
  await expect.poll(async () => liveGuestPage.locator('.remote-cursor').count()).toBe(1);
  await expect(liveGuestPage.locator('.remote-cursor-name')).not.toHaveText('');
  // Camera follows the host…
  const liveGuestCamBefore = await liveGuestPage.evaluate(() => window.__camera);
  await liveHostPage.keyboard.press('=');
  await expect.poll(async () => (await liveGuestPage.evaluate(() => window.__camera)).zoom).not.toBe(liveGuestCamBefore.zoom);
  // …until the guest pans on their own wheel, which pauses following.
  await liveGuestPage.mouse.move(700, 450);
  await liveGuestPage.mouse.wheel(0, -120);
  await expect(liveGuestPage.locator('.follow-chip')).toBeVisible();
  const liveGuestCamPaused = await liveGuestPage.evaluate(() => window.__camera);
  await liveHostPage.keyboard.press('-');
  // Wait until the host's new camera has actually reached the guest (the
  // host's broadcast is debounced), then confirm the paused guest stayed put.
  await expect.poll(async () => {
    const [last, live] = await Promise.all([
      liveGuestPage.evaluate(() => window.__lastHostCamera),
      liveHostPage.evaluate(() => window.__camera),
    ]);
    return last && Math.abs(last.zoom - live.zoom) < 0.001;
  }).toBe(true);
  expect(Math.abs((await liveGuestPage.evaluate(() => window.__camera)).zoom - liveGuestCamPaused.zoom)).toBeLessThan(0.001);
  // The Follow chip jumps back to the presenter's view.
  await liveGuestPage.getByRole('button', { name: /Follow/ }).click();
  await expect.poll(async () => Math.abs((await liveGuestPage.evaluate(() => window.__camera)).zoom - (await liveHostPage.evaluate(() => window.__camera)).zoom)).toBeLessThan(0.001);
  // Audience lasers: while the host presents, a guest's cursor stays visible
  // above the presentation overlay on the host's screen.
  await liveHostPage.getByTestId('tool-frame').click();
  await drag(liveHostPage, 300, 250, 620, 470);
  await liveHostPage.keyboard.press('f');
  await drag(liveHostPage, 800, 250, 1120, 470);
  await liveGuestPage.waitForTimeout(500);
  await liveHostPage.getByRole('button', { name: 'Present' }).click();
  await expect(liveHostPage.locator('.presentation')).toBeVisible();
  await liveGuestPage.mouse.move(400, 400);
  await liveGuestPage.mouse.move(500, 420, { steps: 5 });
  await expect(liveHostPage.locator('.remote-cursor')).toBeVisible();
  await liveHostPage.keyboard.press('Escape');
  await liveGuestPage.close();
  await liveHost.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await mobile.goto('http://127.0.0.1:5173');
  await mobile.screenshot({ path: path.join(root, 'tests', 'mobile.png') });
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  expect(errors).toEqual([]);
  console.log('PASS: draw, move, duplicate, undo/redo, text, stickies, smart arrows, snap guides, infinite zoom, minimap, mouse navigation, gesture coach, paste-to-chart, images, file drop, lasso select, draw-and-hold, freehand, zoom, PNG/SVG/sketch export, theme, persistence, share, boards, migration, frames, sticky tags and votes, presentation mode, fading ink, movable panels, zen mode, live collaboration, help, and mobile layout.');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
