import { mkdir } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron as electron } from "playwright-core";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDir = resolve(rootDir, "artifacts");
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173/";

const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];

const sampleObjSource = `
v 0 0.55 0
v 0.45 0 0
v 0 0 0.45
v -0.45 0 0
v 0 0 -0.45
v 0 -0.55 0
f 1 2 3
f 1 3 4
f 1 4 5
f 1 5 2
f 6 3 2
f 6 4 3
f 6 5 4
f 6 2 5
`;

const sampleStlSource = `
solid verification
facet normal 0 0 1
  outer loop
    vertex 0 0.55 0
    vertex -0.45 -0.35 0
    vertex 0.45 -0.35 0
  endloop
endfacet
facet normal 0 1 0
  outer loop
    vertex 0 0.55 0
    vertex 0.45 -0.35 0
    vertex 0 0 0.55
  endloop
endfacet
facet normal 1 0 0
  outer loop
    vertex 0.45 -0.35 0
    vertex -0.45 -0.35 0
    vertex 0 0 0.55
  endloop
endfacet
facet normal 0 -1 0
  outer loop
    vertex -0.45 -0.35 0
    vertex 0 0.55 0
    vertex 0 0 0.55
  endloop
endfacet
endsolid verification
`;

const setRangeValue = async (page, ariaLabel, value) => {
  await page.locator(`input[aria-label="${ariaLabel}"]`).evaluate((element, nextValue) => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(element, String(nextValue));
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
};

const readSceneStats = async (page) =>
  page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const canvas = document.querySelector("canvas.three-canvas");
    const dock = document.querySelector(".control-dock");
    const brandMark = document.querySelector(".brand-mark");
    const toolbar = document.querySelector(".reference-toolbar");
    const viewport = document.querySelector(".three-viewport");

    if (!(canvas instanceof HTMLCanvasElement)) {
      return { ok: false, reason: "missing canvas" };
    }

    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) {
      return { ok: false, reason: "missing webgl context" };
    }

    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const strideX = Math.max(1, Math.floor(width / 180));
    const strideY = Math.max(1, Math.floor(height / 120));
    let samples = 0;
    let nonBlank = 0;
    let colorful = 0;
    let brightest = 0;

    for (let y = 0; y < height; y += strideY) {
      for (let x = 0; x < width; x += strideX) {
        const index = (y * width + x) * 4;
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const alpha = pixels[index + 3];
        const brightness = (red + green + blue) / 3;

        samples += 1;
        brightest = Math.max(brightest, brightness);

        if (alpha > 0 && brightness > 8) {
          nonBlank += 1;
        }

        if (Math.max(red, green, blue) - Math.min(red, green, blue) > 8) {
          colorful += 1;
        }
      }
    }

    const rectFor = (element) => {
      if (!(element instanceof HTMLElement)) {
        return null;
      }

      const rect = element.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width,
      };
    };

    const dockRect = rectFor(dock);
    const toolbarRect = rectFor(toolbar);
    const insideViewport = (rect) =>
      rect &&
      rect.left >= 0 &&
      rect.top >= 0 &&
      rect.right <= window.innerWidth &&
      rect.bottom <= window.innerHeight;

    return {
      brandMarkPresent: Boolean(brandMark),
      brightest,
      canvasHeight: height,
      canvasWidth: width,
      colorfulRatio: colorful / samples,
      dockInsideViewport: dockRect ? insideViewport(dockRect) : true,
      nonBlankRatio: nonBlank / samples,
      ok: true,
      samples,
      threeViewportRect: rectFor(viewport),
      toolbarInsideViewport: toolbarRect ? insideViewport(toolbarRect) : true,
      toolbarPresent: Boolean(toolbar),
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });

await mkdir(screenshotDir, { recursive: true });

const electronApp = await electron.launch({
  args: [rootDir],
  cwd: rootDir,
  executablePath: electronPath,
  env: {
    ...process.env,
    OPEN_DEVTOOLS: "0",
    VITE_DEV_SERVER_URL: devServerUrl,
  },
});

const results = [];
const browserConsoleErrors = [];
const pageErrors = [];
let page;
let storedLocalStorage = null;

try {
  page = await electronApp.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserConsoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.waitForURL((url) => url.href.startsWith(devServerUrl), { timeout: 15000 });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("canvas.three-canvas", { state: "visible", timeout: 10000 });
  storedLocalStorage = await page.evaluate(() => {
    const storedEntries = {};
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key) {
        storedEntries[key] = window.localStorage.getItem(key) ?? "";
      }
    }
    return storedEntries;
  });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("canvas.three-canvas", { state: "visible", timeout: 10000 });

  const browserWindow = await electronApp.browserWindow(page);

  for (const viewport of viewports) {
    await browserWindow.evaluate(
      (win, bounds) => {
        win.setBounds(bounds);
      },
      { height: viewport.height, width: viewport.width, x: 40, y: 40 },
    );

    await page.waitForTimeout(600);

    const stats = await readSceneStats(page);
    const screenshotPath = resolve(screenshotDir, `scene-${viewport.name}.png`);
    await page.screenshot({ path: screenshotPath });

    if (!stats.ok) {
      throw new Error(`${viewport.name}: ${stats.reason}`);
    }

    if (stats.nonBlankRatio < 0.08 || stats.brightest < 28) {
      throw new Error(`${viewport.name}: canvas appears blank`);
    }

    if (viewport.name === "desktop" && stats.colorfulRatio < 0.001) {
      throw new Error(`${viewport.name}: canvas has too little color variation`);
    }

    if (stats.toolbarPresent) {
      throw new Error(`${viewport.name}: left toolbar should be removed`);
    }

    if (stats.brandMarkPresent) {
      throw new Error(`${viewport.name}: camera mark should be removed from the right rail`);
    }

    if (!stats.dockInsideViewport || !stats.toolbarInsideViewport) {
      throw new Error(`${viewport.name}: controls are outside the viewport`);
    }

    if (viewport.name === "desktop") {
      const topPresetCount = await page.locator(".top-preset-button").count();
      if (topPresetCount !== 4) {
        throw new Error("desktop: top preset buttons are missing");
      }

      const hiddenRect = stats.threeViewportRect;
      const dockCountWhenHidden = await page.locator(".control-dock").count();
      if (dockCountWhenHidden !== 0) {
        throw new Error("desktop: right rail should start hidden");
      }

      await page.locator(".sidebar-toggle-button").click();
      await page.waitForTimeout(300);

      const dockCountWhenShown = await page.locator(".control-dock").count();
      const visibleRect = await page.locator(".three-viewport").boundingBox();
      if (dockCountWhenShown !== 1) {
        throw new Error("desktop: right rail did not show");
      }

      if (!hiddenRect || !visibleRect || hiddenRect.width <= visibleRect.width) {
        throw new Error("desktop: viewer did not contract when the right rail opened");
      }

      await page.evaluate(() => {
        ["Dot grid resolution", "Contrast adjustment", "Video colors", "Instanced symbol"].forEach((label) => {
          const section = document.querySelector(`section[aria-label="${label}"]`);
          const button = section?.querySelector("button.panel-heading-button");
          if (section?.getAttribute("data-collapsed") === "true" && button instanceof HTMLButtonElement) {
            button.click();
          }
        });
      });
      await page.waitForTimeout(100);

      await setRangeValue(page, "Symbol spacing", 400);
      await setRangeValue(page, "Luminosity Z separation", 80);
      const adjustedControlValues = await page.evaluate(() => ({
        spacing: document.querySelector('input[aria-label="Symbol spacing"]')?.value ?? "",
        zSeparation: document.querySelector('input[aria-label="Luminosity Z separation"]')?.value ?? "",
      }));
      if (adjustedControlValues.spacing !== "400" || adjustedControlValues.zSeparation !== "80") {
        throw new Error("desktop: adjusted spacing and Z separation controls did not update");
      }
      await page.locator(".curve-box").waitFor({ timeout: 3000 });
      const gradientHandle = page.locator(".gradient-handle").last();
      await gradientHandle.dblclick();
      await page.locator(".floating-color-picker").waitFor({ timeout: 3000 });
      await page.locator('input[aria-label="Hex color"]').fill("#0000FF");
      if (await gradientHandle.getAttribute("aria-label") !== "#0000FF gradient stop") {
        throw new Error("desktop: edited gradient color did not update");
      }
      await page.locator(".three-viewport").click({ position: { x: 24, y: 24 } });
      await page.locator(".floating-color-picker").waitFor({ state: "detached", timeout: 3000 });
      await gradientHandle.click();
      await page.getByRole("button", { name: "Close color picker" }).click();
      await page.locator(".floating-color-picker").waitFor({ state: "detached", timeout: 3000 });
      await page.locator('input[aria-label="Grayscale video"]').check({ force: true });
      await page.locator('input[aria-label="Luminosity sizing"]').check({ force: true });
      await page.locator('input[aria-label="Flat shape"]').check({ force: true });
      await page.waitForTimeout(500);

      const adjustedStats = await readSceneStats(page);
      if (!adjustedStats.ok || adjustedStats.nonBlankRatio < 0.01 || adjustedStats.brightest < 28) {
        throw new Error("desktop: adjusted video and instance controls did not render");
      }

      await page.evaluate(() => {
        const section = document.querySelector('section[aria-label="Presets"]');
        const button = section?.querySelector("button.panel-heading-button");
        if (section?.getAttribute("data-collapsed") === "true" && button instanceof HTMLButtonElement) {
          button.click();
        }
      });
      await page.waitForTimeout(100);
      await page.locator('input[aria-label="Preset name"]').fill("Verification Preset");
      await page.getByRole("button", { exact: true, name: "Save" }).click();
      await page.getByRole("button", { name: "Saved presets" }).click();
      await page.getByRole("option", { name: "Verification Preset" }).click();

      const removedPresetTransferButtons = await page.evaluate(() => ({
        exportButtons: Array.from(document.querySelectorAll("button")).filter((button) => button.textContent?.trim() === "Export").length,
        importButtons: Array.from(document.querySelectorAll("button")).filter((button) => button.textContent?.trim() === "Import").length,
        presetJsonInputs: document.querySelectorAll('input[accept="application/json,.json"]').length,
      }));
      if (
        removedPresetTransferButtons.exportButtons !== 0 ||
        removedPresetTransferButtons.importButtons !== 0 ||
        removedPresetTransferButtons.presetJsonInputs !== 0
      ) {
        throw new Error("desktop: removed preset import/export controls are still present");
      }

      await page.getByRole("button", { name: "Saved presets" }).click();
      await page.getByRole("option", { name: "Verification Preset" }).waitFor({ timeout: 3000 });
      await page.getByRole("button", { name: "Saved presets" }).click();

      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForSelector("canvas.three-canvas", { state: "visible", timeout: 10000 });
      await page.locator(".sidebar-toggle-button").click();
      await page.locator(".control-dock").waitFor({ timeout: 3000 });
      await page.evaluate(() => {
        const section = document.querySelector('section[aria-label="Dot grid resolution"]');
        const button = section?.querySelector("button.panel-heading-button");
        if (section?.getAttribute("data-collapsed") === "true" && button instanceof HTMLButtonElement) {
          button.click();
        }
      });
      await page.waitForTimeout(100);
      await page.locator('input[aria-label="Columns value"]').waitFor({ timeout: 3000 });
      await page.locator('input[aria-label="Rows value"]').waitFor({ timeout: 3000 });
      const defaultGridValues = await page.evaluate(() => ({
        columns: document.querySelector('input[aria-label="Columns value"]')?.value ?? "",
        rows: document.querySelector('input[aria-label="Rows value"]')?.value ?? "",
      }));
      if (defaultGridValues.columns !== "48" || defaultGridValues.rows !== "27") {
        throw new Error("desktop: dot grid did not reset to default values");
      }
      const defaultControlValues = await page.evaluate(() => ({
        spacing: document.querySelector('input[aria-label="Symbol spacing"]')?.value ?? "",
        zSeparation: document.querySelector('input[aria-label="Luminosity Z separation"]')?.value ?? "",
      }));
      if (defaultControlValues.spacing !== "225" || defaultControlValues.zSeparation !== "0") {
        throw new Error("desktop: spacing and Z separation did not reset to default values");
      }
      await page.evaluate(() => {
        const section = document.querySelector('section[aria-label="Contrast adjustment"]');
        const button = section?.querySelector("button.panel-heading-button");
        if (section?.getAttribute("data-collapsed") === "true" && button instanceof HTMLButtonElement) {
          button.click();
        }
      });
      await page.getByRole("region", { name: "Contrast adjustment" }).locator(".curve-box").waitFor({ timeout: 3000 });

      await page.locator('input[accept=".obj,.stl"]').setInputFiles({
        buffer: Buffer.from(sampleObjSource),
        mimeType: "text/plain",
        name: "verification-symbol.obj",
      });
      await page.waitForTimeout(500);

      const importedStats = await readSceneStats(page);
      if (!importedStats.ok || importedStats.nonBlankRatio < 0.08 || importedStats.brightest < 28) {
        throw new Error("desktop: OBJ instances did not render");
      }

      await page.locator('input[accept=".obj,.stl"]').setInputFiles({
        buffer: Buffer.from(sampleStlSource),
        mimeType: "model/stl",
        name: "verification-symbol.stl",
      });
      await page.waitForTimeout(500);

      const importedStlStats = await readSceneStats(page);
      if (!importedStlStats.ok || importedStlStats.nonBlankRatio < 0.08 || importedStlStats.brightest < 28) {
        throw new Error("desktop: STL instances did not render");
      }
    }

    results.push({
      ...viewport,
      screenshotPath,
      stats,
    });
  }

  if (browserConsoleErrors.length > 0 || pageErrors.length > 0) {
    throw new Error(`Browser errors: ${[...browserConsoleErrors, ...pageErrors].join(" | ")}`);
  }

  console.log(JSON.stringify({ ok: true, results }, null, 2));
} finally {
  if (page && storedLocalStorage) {
    try {
      await page.evaluate((entries) => {
        window.localStorage.clear();
        Object.entries(entries).forEach(([key, value]) => {
          window.localStorage.setItem(key, String(value));
        });
      }, storedLocalStorage);
    } catch {
      // The app is closing; storage restore is best effort.
    }
  }
  await electronApp.close();
}
