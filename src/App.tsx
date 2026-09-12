import {
  Box,
  Check,
  ChevronDown,
  Circle,
  Download,
  Eye,
  EyeOff,
  FileUp,
  Layers,
  Mic,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  RotateCcw,
  Save,
  Square,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import type { CSSProperties, ChangeEvent, DragEvent, KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decompressFrames, parseGIF } from "gifuct-js";
import "./App.css";
import { ThreeViewport } from "./components/ThreeViewport";
import type { SymbolModelSource, SymbolPrimitive, VideoCurvePoint } from "./components/ThreeViewport";
import runnerVideoUrl from "./assets/preset-4-runner.mov";
import recoveredDefaultPresets from "./default-presets.json";
import { mapGridMidiMessage, scaleMidiValue } from "./midiController";

type SourceKind = "audio" | "file" | "idle" | "live-audio" | "webcam";

type GradientStop = {
  color: string;
  offset: number;
};

type HsbColor = {
  b: number;
  h: number;
  s: number;
};

type ColorPickerState = {
  stopIndex: number;
  x: number;
  y: number;
} | null;

type Point = {
  x: number;
  y: number;
};

type CurvePointMode = "smooth" | "corner";

type CurveDragTarget = {
  index: number;
  target: "anchor" | "handleIn" | "handleOut";
};

type CurveResizeState = {
  pointerId: number;
  startHeight: number;
  startY: number;
};

type CurvePreset = {
  label: string;
  points?: VideoCurvePoint[];
  value: string;
};

type ControlPanelId = "audio-response" | "environment-lighting" | "contrast" | "dot-grid" | "midi-controller" | "random-effector" | "collision-effector" | "video-effects" | "symbol" | "presets";

type CollapsedPanels = Record<ControlPanelId, boolean>;

type SliderFieldProps = {
  ariaLabel: string;
  disabled?: boolean;
  label: string;
  max: number;
  min: number;
  onValueChange: (value: number) => void;
  step?: number;
  value: number;
};

function SliderField({ ariaLabel, disabled = false, label, max, min, onValueChange, step = 1, value }: SliderFieldProps) {
  const applyValue = (rawValue: string) => {
    const nextValue = Number(rawValue);
    if (Number.isFinite(nextValue)) {
      onValueChange(Math.min(max, Math.max(min, nextValue)));
    }
  };

  return (
    <label className="slider-field">
      <span>{label}</span>
      <span className="slider-input-row">
        <input
          aria-label={ariaLabel}
          disabled={disabled}
          max={max}
          min={min}
          onChange={(event) => applyValue(event.target.value)}
          step={step}
          style={{ "--range-progress": `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
          type="range"
          value={value}
        />
        <input
          aria-label={`${ariaLabel} value`}
          className="number-field"
          disabled={disabled}
          max={max}
          min={min}
          onChange={(event) => applyValue(event.target.value)}
          step={step}
          type="number"
          value={value}
        />
      </span>
    </label>
  );
}

const SHOW_SCENE_VISIBILITY_CONTROLS = false as boolean;

const DEFAULT_COLLAPSED_PANELS: CollapsedPanels = {
  "audio-response": true,
  "environment-lighting": true,
  contrast: true,
  "dot-grid": true,
  "random-effector": true,
  "collision-effector": true,
  "video-effects": true,
  "midi-controller": false,
  presets: true,
  symbol: true,
};

const DEFAULT_LIVE_AUDIO_EFFECT_INTENSITY = 68;
const DEFAULT_LIVE_AUDIO_RESPONSE_DELAY = 5;
const DEFAULT_2_LIVE_AUDIO_EFFECT_INTENSITY = 63;
const DEFAULT_2_LIVE_AUDIO_RESPONSE_DELAY = 92;
const DEFAULT_2_LIVE_AUDIO_GRADIENT_STOPS: GradientStop[] = [
  { color: "#005EF7", offset: 0 },
  { color: "#56F97A", offset: 33 },
  { color: "#8200FF", offset: 68 },
  { color: "#260014", offset: 100 },
];
const DEFAULT_4_LIVE_AUDIO_GRADIENT_STOPS: GradientStop[] = [
  { color: "#050505", offset: 11 },
  { color: "#5F5F5F", offset: 60 },
  { color: "#ffffff", offset: 100 },
];

const sourceActiveMessage = (sourceKind: SourceKind) => {
  if (sourceKind === "webcam") {
    return "Webcam active";
  }

  if (sourceKind === "audio") {
    return "Audio active";
  }

  if (sourceKind === "live-audio") {
    return "Live audio active";
  }

  return "Video active";
};

type SceneSettings = {
  audioBackgroundColor: string;
  audioEffectIntensity: number;
  audioForegroundColor: string;
  audioGradientColors: string[];
  audioGradientStops: GradientStop[];
  collisionsEnabled: boolean;
  dynamicallyAwareCollision: boolean;
  dynamicCollisionResponse: number;
  environmentIntensity: number;
  environmentRotationX: number;
  environmentRotationY: number;
  environmentRotationZ: number;
  fillLightColor: string;
  fillLightIntensity: number;
  dotColumns: number;
  dotRows: number;
  effectVisible: boolean;
  flatSymbols: boolean;
  floorVisible: boolean;
  grayscaleVideo: boolean;
  luminositySizing: boolean;
  luminosityZSeparation: number;
  randomPositionX: number;
  randomPositionY: number;
  randomPositionZ: number;
  randomRotationX: number;
  randomRotationY: number;
  randomRotationZ: number;
  randomScale: number;
  screenVisible: boolean;
  showHdriBackground: boolean;
  sourceKind: SourceKind;
  symbolPrimitive: SymbolPrimitive;
  symbolScale: number;
  symbolSpacing: number;
  videoCurvePoints: VideoCurvePoint[];
  videoCurvePreset: string;
  videoGradientEnabled: boolean;
  videoZoom: number;
};

type ScenePreset = {
  createdAt: number;
  id: string;
  name: string;
  settings: SceneSettings;
};

type PresetSlot = 1 | 2 | 3 | 4;
type PresetAssignments = Partial<Record<PresetSlot, string>>;

const OPENING_PRESET_SETTLE_MS = 1600;

const DEFAULT_CURVE_POINTS: VideoCurvePoint[] = [
  {
    anchor: { x: 0, y: 100 },
    handleIn: { x: 0, y: 100 },
    handleOut: { x: 26, y: 84 },
    mode: "smooth",
  },
  {
    anchor: { x: 52, y: 47 },
    handleIn: { x: 34, y: 70 },
    handleOut: { x: 69, y: 25 },
    mode: "smooth",
  },
  {
    anchor: { x: 100, y: 0 },
    handleIn: { x: 74, y: 14 },
    handleOut: { x: 100, y: 0 },
    mode: "smooth",
  },
];

const CURVE_PRESETS = [
  { label: "Custom", value: "custom" },
  {
    label: "Linear",
    value: "linear",
    points: [
      {
        anchor: { x: 0, y: 100 },
        handleIn: { x: 0, y: 100 },
        handleOut: { x: 33, y: 67 },
        mode: "smooth",
      },
      {
        anchor: { x: 100, y: 0 },
        handleIn: { x: 67, y: 33 },
        handleOut: { x: 100, y: 0 },
        mode: "smooth",
      },
    ],
  },
  {
    label: "Ease in",
    value: "easeIn",
    points: [
      {
        anchor: { x: 0, y: 100 },
        handleIn: { x: 0, y: 100 },
        handleOut: { x: 38, y: 98 },
        mode: "smooth",
      },
      {
        anchor: { x: 100, y: 0 },
        handleIn: { x: 82, y: 28 },
        handleOut: { x: 100, y: 0 },
        mode: "smooth",
      },
    ],
  },
  {
    label: "Ease out",
    value: "easeOut",
    points: [
      {
        anchor: { x: 0, y: 100 },
        handleIn: { x: 0, y: 100 },
        handleOut: { x: 18, y: 72 },
        mode: "smooth",
      },
      {
        anchor: { x: 100, y: 0 },
        handleIn: { x: 62, y: 2 },
        handleOut: { x: 100, y: 0 },
        mode: "smooth",
      },
    ],
  },
  { label: "S curve", value: "sCurve", points: DEFAULT_CURVE_POINTS },
] satisfies CurvePreset[];

const CURVE_PRESET_OPTIONS = CURVE_PRESETS.map(({ label, value }) => ({ label, value }));

const curveFromLegacyContrast = (legacyContrast: number) => {
  const contrast = Number.isFinite(legacyContrast)
    ? Math.min(150, Math.max(50, Math.round(legacyContrast)))
    : 100;

  if (contrast === 100) {
    return DEFAULT_CURVE_POINTS;
  }

  const clampCurveValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

  return [
    {
      anchor: { x: 0, y: 100 },
      handleIn: { x: 0, y: 100 },
      handleOut: { x: 30, y: clampCurveValue(100 - ((contrast - 100) * 0.25), 0, 100) },
      mode: "smooth" as CurvePointMode,
    },
    {
      anchor: { x: 50, y: clampCurveValue(50 - ((contrast - 100) * 0.18), 18, 82) },
      handleIn: { x: 35, y: 68 },
      handleOut: { x: 65, y: 32 },
      mode: "smooth" as CurvePointMode,
    },
    {
      anchor: { x: 100, y: 0 },
      handleIn: { x: 70, y: clampCurveValue((contrast - 100) * 0.25, 0, 100) },
      handleOut: { x: 100, y: 0 },
      mode: "smooth" as CurvePointMode,
    },
  ];
};

const VIVID_PINK_GRADIENT_STOPS: GradientStop[] = [
  { color: "#B6FF00", offset: 0 },
  { color: "#FF2BD6", offset: 18 },
  { color: "#FF4AEA", offset: 68 },
  { color: "#A855FF", offset: 100 },
];

const DEFAULT_RED_GRADIENT_STOPS: GradientStop[] = [
  { color: "#ff3030", offset: 0 },
  { color: "#ffffff", offset: 100 },
];

const BRIGHT_COLOR_GRADE_CURVE_POINTS: VideoCurvePoint[] = [
  {
    anchor: { x: 0, y: 96 },
    handleIn: { x: 0, y: 96 },
    handleOut: { x: 18, y: 74 },
    mode: "smooth",
  },
  {
    anchor: { x: 46, y: 38 },
    handleIn: { x: 28, y: 62 },
    handleOut: { x: 68, y: 20 },
    mode: "smooth",
  },
  {
    anchor: { x: 100, y: 0 },
    handleIn: { x: 82, y: 5 },
    handleOut: { x: 100, y: 0 },
    mode: "smooth",
  },
];

const DEFAULT_SCENE_SETTINGS: SceneSettings = {
  audioBackgroundColor: "#ff3030",
  audioEffectIntensity: 100,
  audioForegroundColor: "#ffffff",
  audioGradientColors: DEFAULT_RED_GRADIENT_STOPS.map((stop) => stop.color),
  audioGradientStops: DEFAULT_RED_GRADIENT_STOPS,
  collisionsEnabled: false,
  dynamicallyAwareCollision: false,
  dynamicCollisionResponse: 100,
  environmentIntensity: 100,
  environmentRotationX: 0,
  environmentRotationY: 0,
  environmentRotationZ: 0,
  fillLightColor: "#ffffff",
  fillLightIntensity: 100,
  dotColumns: 48,
  dotRows: 27,
  effectVisible: true,
  flatSymbols: false,
  floorVisible: false,
  grayscaleVideo: false,
  luminositySizing: false,
  luminosityZSeparation: 0,
  randomPositionX: 0,
  randomPositionY: 0,
  randomPositionZ: 0,
  randomRotationX: 0,
  randomRotationY: 0,
  randomRotationZ: 0,
  randomScale: 0,
  screenVisible: false,
  showHdriBackground: false,
  sourceKind: "file",
  symbolPrimitive: "sphere",
  symbolScale: 100,
  symbolSpacing: 225,
  videoCurvePoints: DEFAULT_CURVE_POINTS,
  videoCurvePreset: "sCurve",
  videoGradientEnabled: false,
  videoZoom: 100,
};

const SHARED_PRESETS = recoveredDefaultPresets as unknown as ScenePreset[];

const STORAGE_KEYS = {
  activePreset: "video-plane-studio.active-preset",
  latestSettings: "video-plane-studio.latest-settings",
  preset1Override: "video-plane-studio.preset-1-override",
  preset2Override: "video-plane-studio.preset-2-override",
  preset3Override: "video-plane-studio.preset-3-override",
  preset4Override: "video-plane-studio.preset-4-override",
  presetAssignments: "video-plane-studio.preset-assignments",
  presetLibraryVersion: "video-plane-studio.preset-library-version",
  presets: "video-plane-studio.presets",
} as const;

const PRESET_LIBRARY_VERSION = "11";
const STARTER_PRESET_NAMES = ["Default 1", "Default 2", "Default 3", "Default 4"] as const;

const TOP_PRESET_DETAILS = [
  { effect: "Default 1", source: "Built-in runner video" },
  { effect: "Default 2", source: "Webcam" },
  { effect: "Default 3", source: "Live audio" },
  { effect: "Default 4", source: "Webcam" },
] as const;

const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const DOT_COLUMNS_MIN = 1;
const DOT_COLUMNS_MAX = 88;
const DOT_ROWS_MIN = 1;
const DOT_ROWS_MAX = 88;
const SYMBOL_SPACING_MIN = 0;
const SYMBOL_SPACING_MAX = 400;
const SYMBOL_SCALE_MIN = 10;
const SYMBOL_SCALE_MAX = 1000;
const SYMBOL_SCALE_DISPLAY_DIVISOR = 10;
const MIDI_SYMBOL_SCALE_MAX = 200;
const SYMBOL_SCALE_RENDER_FACTOR = 0.5;

const readBoolean = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const readColor = (value: unknown, fallback: string) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
const readGradientColors = (value: unknown, fallback: string[]) => {
  const colors = Array.isArray(value)
    ? value.filter((color): color is string => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color))
    : [];

  if (colors.length >= 2) {
    return colors.slice(0, 6);
  }

  return fallback;
};

const normalizeGradientStops = (stops: GradientStop[]) =>
  [...stops]
    .map((stop) => ({
      color: readColor(stop.color, DEFAULT_SCENE_SETTINGS.audioForegroundColor),
      offset: clampNumber(stop.offset, 0, 100, 0),
    }))
    .sort((first, second) => first.offset - second.offset);

const readGradientStops = (value: unknown, fallbackColors: string[]): GradientStop[] => {
  const rawStops = Array.isArray(value)
    ? value.filter((stop): stop is Partial<GradientStop> => Boolean(stop) && typeof stop === "object")
    : [];

  if (rawStops.length >= 2) {
    return normalizeGradientStops(rawStops.map((stop, index) => ({
      color: readColor(stop.color, fallbackColors[index] ?? DEFAULT_SCENE_SETTINGS.audioForegroundColor),
      offset: clampNumber(
        stop.offset,
        0,
        100,
        rawStops.length <= 1 ? 0 : (index / (rawStops.length - 1)) * 100,
      ),
    }))).slice(0, 8);
  }

  return normalizeGradientStops(fallbackColors.map((color, index) => ({
    color,
    offset: fallbackColors.length <= 1 ? 0 : (index / (fallbackColors.length - 1)) * 100,
  })));
};

const mirrorCurveHandle = (anchor: Point, handle: Point) => ({
  x: anchor.x * 2 - handle.x,
  y: anchor.y * 2 - handle.y,
});

const smoothCurvePoint = (point: VideoCurvePoint): VideoCurvePoint => {
  const inDistance = Math.hypot(point.handleIn.x - point.anchor.x, point.handleIn.y - point.anchor.y);
  const outDistance = Math.hypot(point.handleOut.x - point.anchor.x, point.handleOut.y - point.anchor.y);

  if (outDistance >= inDistance) {
    return {
      ...point,
      handleIn: mirrorCurveHandle(point.anchor, point.handleOut),
      mode: "smooth",
    };
  }

  return {
    ...point,
    handleOut: mirrorCurveHandle(point.anchor, point.handleIn),
    mode: "smooth",
  };
};

const cloneCurvePoints = (points: VideoCurvePoint[]) =>
  points.map((point) => ({
    anchor: { ...point.anchor },
    handleIn: { ...point.handleIn },
    handleOut: { ...point.handleOut },
    mode: point.mode,
  }));

const buildCurvePath = (curvePoints: VideoCurvePoint[]) => {
  if (curvePoints.length === 0) {
    return "";
  }

  return curvePoints.slice(1).reduce((path, point, index) => {
    const previousPoint = curvePoints[index];

    return `${path} C ${previousPoint.handleOut.x} ${previousPoint.handleOut.y}, ${point.handleIn.x} ${point.handleIn.y}, ${point.anchor.x} ${point.anchor.y}`;
  }, `M ${curvePoints[0].anchor.x} ${curvePoints[0].anchor.y}`);
};

const readCurvePoint = (value: unknown, fallback: VideoCurvePoint): VideoCurvePoint => {
  const raw = value && typeof value === "object"
    ? value as Partial<VideoCurvePoint>
    : {};

  const readPoint = (pointValue: unknown, pointFallback: Point) => {
    const point = pointValue && typeof pointValue === "object" ? pointValue as Partial<Point> : {};
    return {
      x: typeof point.x === "number" && Number.isFinite(point.x) ? clamp(point.x, -100, 200) : pointFallback.x,
      y: typeof point.y === "number" && Number.isFinite(point.y) ? clamp(point.y, -100, 200) : pointFallback.y,
    };
  };

  return {
    anchor: readPoint(raw.anchor, fallback.anchor),
    handleIn: readPoint(raw.handleIn, fallback.handleIn),
    handleOut: readPoint(raw.handleOut, fallback.handleOut),
    mode: raw.mode === "corner" ? "corner" : fallback.mode,
  };
};

const readCurvePoints = (value: unknown, fallback: VideoCurvePoint[]) => {
  if (!Array.isArray(value) || value.length < 2) {
    return cloneCurvePoints(fallback);
  }

  return value
    .slice(0, 8)
    .map((point, index) => readCurvePoint(point, fallback[Math.min(index, fallback.length - 1)] ?? DEFAULT_CURVE_POINTS[0]))
    .sort((first, second) => first.anchor.x - second.anchor.x);
};

const curvePresetLabel = (value: string) =>
  CURVE_PRESETS.find((preset) => preset.value === value)?.label ?? "Custom";

const buildGradientCss = (stops: GradientStop[]) => {
  const orderedStops = normalizeGradientStops(stops);
  const stopCss = orderedStops
    .map((stop) => `${stop.color} ${stop.offset}%`)
    .join(", ");

  return `linear-gradient(90deg, ${stopCss})`;
};

const hexToRgb = (color: string) => {
  const normalized = readColor(color, "#ffffff").slice(1);
  return {
    b: Number.parseInt(normalized.slice(4, 6), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    r: Number.parseInt(normalized.slice(0, 2), 16),
  };
};

const rgbToHex = ({ b, g, r }: { b: number; g: number; r: number }) =>
  `#${[r, g, b].map((channel) => clampNumber(channel, 0, 255, 0).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

const sampleGradientHexColor = (stops: GradientStop[], offset: number) => {
  const orderedStops = normalizeGradientStops(stops);
  const nextIndex = orderedStops.findIndex((stop) => stop.offset >= offset);

  if (nextIndex <= 0) {
    return orderedStops[0]?.color ?? DEFAULT_SCENE_SETTINGS.audioBackgroundColor;
  }

  if (nextIndex === -1) {
    return orderedStops[orderedStops.length - 1]?.color ?? DEFAULT_SCENE_SETTINGS.audioForegroundColor;
  }

  const previousStop = orderedStops[nextIndex - 1];
  const nextStop = orderedStops[nextIndex];
  const range = Math.max(0.001, nextStop.offset - previousStop.offset);
  const mix = clamp((offset - previousStop.offset) / range, 0, 1);
  const previousColor = hexToRgb(previousStop.color);
  const nextColor = hexToRgb(nextStop.color);

  return rgbToHex({
    b: previousColor.b + (nextColor.b - previousColor.b) * mix,
    g: previousColor.g + (nextColor.g - previousColor.g) * mix,
    r: previousColor.r + (nextColor.r - previousColor.r) * mix,
  });
};

const hexToHsb = (color: string): HsbColor => {
  const { b, g, r } = hexToRgb(color);
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0) {
    if (max === red) {
      hue = 60 * (((green - blue) / delta) % 6);
    } else if (max === green) {
      hue = 60 * ((blue - red) / delta + 2);
    } else {
      hue = 60 * ((red - green) / delta + 4);
    }
  }

  if (hue < 0) {
    hue += 360;
  }

  return {
    b: max * 100,
    h: hue,
    s: max === 0 ? 0 : (delta / max) * 100,
  };
};

const hsbToHex = ({ b, h, s }: HsbColor) => {
  const hue = ((h % 360) + 360) % 360;
  const saturation = Math.min(100, Math.max(0, s)) / 100;
  const brightness = Math.min(100, Math.max(0, b)) / 100;
  const chroma = brightness * saturation;
  const hueSlice = hue / 60;
  const x = chroma * (1 - Math.abs((hueSlice % 2) - 1));
  const m = brightness - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (hueSlice >= 0 && hueSlice < 1) {
    red = chroma;
    green = x;
  } else if (hueSlice < 2) {
    red = x;
    green = chroma;
  } else if (hueSlice < 3) {
    green = chroma;
    blue = x;
  } else if (hueSlice < 4) {
    green = x;
    blue = chroma;
  } else if (hueSlice < 5) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }

  return rgbToHex({
    b: (blue + m) * 255,
    g: (green + m) * 255,
    r: (red + m) * 255,
  });
};

const sanitizeSettings = (value: unknown): SceneSettings => {
  const raw = value && typeof value === "object"
    ? value as Partial<SceneSettings>
    : {};
  const rawLegacy = value && typeof value === "object"
    ? value as { videoContrast?: unknown; videoCurvePoints?: unknown; videoCurvePreset?: unknown; randomPosition?: unknown; randomRotation?: unknown }
    : {};
  const fallbackGradientColors = [
    readColor(raw.audioBackgroundColor, DEFAULT_SCENE_SETTINGS.audioBackgroundColor),
    readColor(raw.audioForegroundColor, DEFAULT_SCENE_SETTINGS.audioForegroundColor),
  ];
  const audioGradientColors = readGradientColors(raw.audioGradientColors, fallbackGradientColors);
  const audioGradientStops = readGradientStops(raw.audioGradientStops, audioGradientColors);
  const videoCurvePreset = typeof rawLegacy.videoCurvePreset === "string"
    ? rawLegacy.videoCurvePreset
    : DEFAULT_SCENE_SETTINGS.videoCurvePreset;
  const legacyContrast = clampNumber(rawLegacy.videoContrast, 50, 150, 100);
  const fallbackCurve = curveFromLegacyContrast(legacyContrast);

  return {
    audioBackgroundColor: audioGradientStops[0]?.color ?? DEFAULT_SCENE_SETTINGS.audioBackgroundColor,
    audioEffectIntensity: clampNumber(raw.audioEffectIntensity, 0, 100, DEFAULT_SCENE_SETTINGS.audioEffectIntensity),
    audioForegroundColor: audioGradientStops[audioGradientStops.length - 1]?.color ?? DEFAULT_SCENE_SETTINGS.audioForegroundColor,
    audioGradientColors: audioGradientStops.map((stop) => stop.color),
    audioGradientStops,
    collisionsEnabled: readBoolean(raw.collisionsEnabled, DEFAULT_SCENE_SETTINGS.collisionsEnabled),
    dynamicallyAwareCollision: readBoolean(raw.dynamicallyAwareCollision, DEFAULT_SCENE_SETTINGS.dynamicallyAwareCollision),
    dynamicCollisionResponse: clampNumber(raw.dynamicCollisionResponse, 0, 300, DEFAULT_SCENE_SETTINGS.dynamicCollisionResponse),
    environmentIntensity: clampNumber(raw.environmentIntensity, 0, 300, DEFAULT_SCENE_SETTINGS.environmentIntensity),
    environmentRotationX: clampNumber(raw.environmentRotationX, 0, 360, DEFAULT_SCENE_SETTINGS.environmentRotationX),
    environmentRotationY: clampNumber(raw.environmentRotationY, 0, 360, DEFAULT_SCENE_SETTINGS.environmentRotationY),
    environmentRotationZ: clampNumber(raw.environmentRotationZ, 0, 360, DEFAULT_SCENE_SETTINGS.environmentRotationZ),
    fillLightColor: readColor(raw.fillLightColor, DEFAULT_SCENE_SETTINGS.fillLightColor),
    fillLightIntensity: clampNumber(raw.fillLightIntensity, 0, 300, DEFAULT_SCENE_SETTINGS.fillLightIntensity),
    dotColumns: clampNumber(raw.dotColumns, DOT_COLUMNS_MIN, DOT_COLUMNS_MAX, DEFAULT_SCENE_SETTINGS.dotColumns),
    dotRows: clampNumber(raw.dotRows, DOT_ROWS_MIN, DOT_ROWS_MAX, DEFAULT_SCENE_SETTINGS.dotRows),
    effectVisible: readBoolean(raw.effectVisible, DEFAULT_SCENE_SETTINGS.effectVisible),
    flatSymbols: readBoolean(raw.flatSymbols, DEFAULT_SCENE_SETTINGS.flatSymbols),
    floorVisible: SHOW_SCENE_VISIBILITY_CONTROLS
      ? readBoolean(raw.floorVisible, DEFAULT_SCENE_SETTINGS.floorVisible)
      : DEFAULT_SCENE_SETTINGS.floorVisible,
    grayscaleVideo: readBoolean(raw.grayscaleVideo, DEFAULT_SCENE_SETTINGS.grayscaleVideo),
    luminositySizing: readBoolean(raw.luminositySizing, DEFAULT_SCENE_SETTINGS.luminositySizing),
    luminosityZSeparation: clampNumber(
      raw.luminosityZSeparation,
      0,
      100,
      DEFAULT_SCENE_SETTINGS.luminosityZSeparation,
    ),
    randomPositionX: clampNumber(raw.randomPositionX, 0, 500, clampNumber(rawLegacy.randomPosition, 0, 500, DEFAULT_SCENE_SETTINGS.randomPositionX)),
    randomPositionY: clampNumber(raw.randomPositionY, 0, 500, clampNumber(rawLegacy.randomPosition, 0, 500, DEFAULT_SCENE_SETTINGS.randomPositionY)),
    randomPositionZ: clampNumber(raw.randomPositionZ, 0, 500, clampNumber(rawLegacy.randomPosition, 0, 500, DEFAULT_SCENE_SETTINGS.randomPositionZ)),
    randomRotationX: clampNumber(raw.randomRotationX, 0, 360, clampNumber(rawLegacy.randomRotation, 0, 360, DEFAULT_SCENE_SETTINGS.randomRotationX)),
    randomRotationY: clampNumber(raw.randomRotationY, 0, 360, clampNumber(rawLegacy.randomRotation, 0, 360, DEFAULT_SCENE_SETTINGS.randomRotationY)),
    randomRotationZ: clampNumber(raw.randomRotationZ, 0, 360, clampNumber(rawLegacy.randomRotation, 0, 360, DEFAULT_SCENE_SETTINGS.randomRotationZ)),
    randomScale: clampNumber(raw.randomScale, 0, 500, DEFAULT_SCENE_SETTINGS.randomScale),
    screenVisible: SHOW_SCENE_VISIBILITY_CONTROLS
      ? readBoolean(raw.screenVisible, DEFAULT_SCENE_SETTINGS.screenVisible)
      : DEFAULT_SCENE_SETTINGS.screenVisible,
    showHdriBackground: readBoolean(raw.showHdriBackground, DEFAULT_SCENE_SETTINGS.showHdriBackground),
    sourceKind: raw.sourceKind === "webcam" || raw.sourceKind === "live-audio" || raw.sourceKind === "file"
      ? raw.sourceKind
      : DEFAULT_SCENE_SETTINGS.sourceKind,
    symbolPrimitive: raw.symbolPrimitive === "square" ? "square" : DEFAULT_SCENE_SETTINGS.symbolPrimitive,
    symbolScale: clampNumber(raw.symbolScale, SYMBOL_SCALE_MIN, SYMBOL_SCALE_MAX, DEFAULT_SCENE_SETTINGS.symbolScale),
    symbolSpacing: clampNumber(raw.symbolSpacing, SYMBOL_SPACING_MIN, SYMBOL_SPACING_MAX, DEFAULT_SCENE_SETTINGS.symbolSpacing),
    videoCurvePoints: readCurvePoints(rawLegacy.videoCurvePoints, fallbackCurve),
    videoCurvePreset,
    videoGradientEnabled: readBoolean(raw.videoGradientEnabled, DEFAULT_SCENE_SETTINGS.videoGradientEnabled),
    videoZoom: clampNumber(raw.videoZoom, 100, 200, DEFAULT_SCENE_SETTINGS.videoZoom),
  };
};

const sanitizePresetCollection = (value: unknown): ScenePreset[] => {
  const rawPresets = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { presets?: unknown }).presets)
      ? (value as { presets: unknown[] }).presets
      : [];

  return rawPresets.flatMap((preset): ScenePreset[] => {
    if (!preset || typeof preset !== "object") {
      return [];
    }

    const rawPreset = preset as Partial<ScenePreset>;
    if (typeof rawPreset.id !== "string" || typeof rawPreset.name !== "string") {
      return [];
    }

    return [{
      createdAt: typeof rawPreset.createdAt === "number" ? rawPreset.createdAt : Date.now(),
      id: rawPreset.id,
      name: rawPreset.name,
      settings: sanitizeSettings(rawPreset.settings),
    }];
  });
};

const readStoredSettings = () => {
  return DEFAULT_SCENE_SETTINGS;
};

const readLatestSettings = () => {
  try {
    const storedSettings = window.localStorage.getItem(STORAGE_KEYS.latestSettings);
    return storedSettings ? sanitizeSettings(JSON.parse(storedSettings)) : null;
  } catch {
    return null;
  }
};

const readStoredPresets = () => {
  try {
    const storedPresets = window.localStorage.getItem(STORAGE_KEYS.presets);
    const parsedPresets: unknown = storedPresets ? JSON.parse(storedPresets) : [];
    const presets = sanitizePresetCollection(parsedPresets);

    if (presets.length > 0) {
      if (window.localStorage.getItem(STORAGE_KEYS.presetLibraryVersion) !== PRESET_LIBRARY_VERSION) {
        const updatedPresets = presets.filter((preset) => preset.name.trim().toLowerCase() !== "pixel").map((preset) => {
          const sharedPreset = SHARED_PRESETS.find((candidate) => candidate.id === preset.id);
          return sharedPreset
            ? { ...preset, name: sharedPreset.name, settings: sharedPreset.settings }
            : preset;
        });
        window.localStorage.setItem(STORAGE_KEYS.presets, JSON.stringify(updatedPresets));
        window.localStorage.setItem(STORAGE_KEYS.presetLibraryVersion, PRESET_LIBRARY_VERSION);
        return updatedPresets;
      }
      return presets;
    }

    const starterPresets = SHARED_PRESETS.map((sharedPreset, index): ScenePreset => {
      const slot = index + 1;
      const overrideKey = [
        STORAGE_KEYS.preset1Override,
        STORAGE_KEYS.preset2Override,
        STORAGE_KEYS.preset3Override,
        STORAGE_KEYS.preset4Override,
      ][index];
      const storedOverride = overrideKey ? window.localStorage.getItem(overrideKey) : null;
      const settings = storedOverride
        ? sanitizeSettings(JSON.parse(storedOverride))
        : sharedPreset.settings;

      return {
        createdAt: Date.now() - (SHARED_PRESETS.length - index),
        id: `starter-preset-${slot}`,
        name: STARTER_PRESET_NAMES[index],
        settings: slot === 2
          ? { ...settings, luminositySizing: true, luminosityZSeparation: 20 }
          : slot === 3
            ? { ...settings, dotColumns: 15, dotRows: 12, sourceKind: "live-audio" }
            : settings,
      };
    });
    const starterAssignments: PresetAssignments = {
      1: starterPresets[0].id,
      2: starterPresets[1].id,
      3: starterPresets[2].id,
      4: starterPresets[3].id,
    };

    window.localStorage.setItem(STORAGE_KEYS.presets, JSON.stringify(starterPresets));
    window.localStorage.setItem(STORAGE_KEYS.presetAssignments, JSON.stringify(starterAssignments));
    window.localStorage.setItem(STORAGE_KEYS.presetLibraryVersion, PRESET_LIBRARY_VERSION);
    return starterPresets;
  } catch {
    return SHARED_PRESETS.map((preset, index) => ({
      ...preset,
      createdAt: index + 1,
      id: `starter-preset-${index + 1}`,
      name: STARTER_PRESET_NAMES[index],
    }));
  }
};

const readStoredPresetAssignments = (): PresetAssignments => {
  try {
    const storedAssignments = window.localStorage.getItem(STORAGE_KEYS.presetAssignments);
    const parsedAssignments: unknown = storedAssignments ? JSON.parse(storedAssignments) : {};
    const assignments = parsedAssignments && typeof parsedAssignments === "object"
      ? parsedAssignments as Record<string, unknown>
      : {};
    const storedPresets = sanitizePresetCollection(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.presets) ?? "[]"));
    const storedPresetIds = new Set(storedPresets.map((preset) => preset.id));
    const fourthAssignment = typeof assignments["4"] === "string" && storedPresetIds.has(assignments["4"])
      ? assignments["4"]
      : "starter-preset-4";
    return {
      1: typeof assignments["1"] === "string" ? assignments["1"] : undefined,
      2: typeof assignments["2"] === "string" ? assignments["2"] : undefined,
      3: typeof assignments["3"] === "string" ? assignments["3"] : undefined,
      4: fourthAssignment,
    };
  } catch {
    return {};
  }
};

const readStoredActivePreset = () => {
  return "";
};

const readStoredPreset1Override = () => {
  try {
    const storedSettings = window.localStorage.getItem(STORAGE_KEYS.preset1Override);
    return storedSettings ? sanitizeSettings(JSON.parse(storedSettings)) : null;
  } catch {
    return null;
  }
};

const readStoredPreset4Override = () => {
  try {
    const storedSettings = window.localStorage.getItem(STORAGE_KEYS.preset4Override);
    return storedSettings ? sanitizeSettings(JSON.parse(storedSettings)) : null;
  } catch {
    return null;
  }
};

const readStoredPreset2Override = () => {
  try {
    const storedSettings = window.localStorage.getItem(STORAGE_KEYS.preset2Override);
    return storedSettings ? sanitizeSettings(JSON.parse(storedSettings)) : null;
  } catch {
    return null;
  }
};

const readStoredPreset3Override = () => {
  try {
    const storedSettings = window.localStorage.getItem(STORAGE_KEYS.preset3Override);
    return storedSettings ? sanitizeSettings(JSON.parse(storedSettings)) : null;
  } catch {
    return null;
  }
};

const stopStream = (stream: MediaStream | null) => {
  stream?.getTracks().forEach((track) => track.stop());
};

const analyzeAudioLevelScale = async (file: File) => {
  try {
    const AudioContextClass =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      return 1;
    }

    const audioContext = new AudioContextClass();
    const audioBuffer = await audioContext.decodeAudioData(await file.arrayBuffer());
    const windowSize = Math.max(128, Math.floor(audioBuffer.sampleRate * 0.035));
    let maxWindowRms = 0;

    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
      const samples = audioBuffer.getChannelData(channel);
      for (let start = 0; start < samples.length; start += windowSize) {
        let total = 0;
        const end = Math.min(samples.length, start + windowSize);

        for (let index = start; index < end; index += 1) {
          total += samples[index] * samples[index];
        }

        maxWindowRms = Math.max(maxWindowRms, Math.sqrt(total / Math.max(1, end - start)));
      }
    }

    void audioContext.close();
    return Math.min(3.2, Math.max(0.42, 0.32 / Math.max(0.08, maxWindowRms)));
  } catch {
    return 1;
  }
};

type PresetDropdownOption = {
  label: string;
  value: string;
};

function PresetDropdown({
  ariaLabel = "Saved presets",
  onChange,
  options,
  value,
}: {
  ariaLabel?: string;
  onChange: (value: string) => void;
  options: PresetDropdownOption[];
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const selectShellRef = useRef<HTMLSpanElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const closeSelectOnOutsidePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;

      if (target && selectShellRef.current?.contains(target)) {
        return;
      }

      setOpen(false);
    };

    document.addEventListener("pointerdown", closeSelectOnOutsidePointerDown);

    return () => {
      document.removeEventListener("pointerdown", closeSelectOnOutsidePointerDown);
    };
  }, [open]);

  return (
    <span className="preset-select-shell" ref={selectShellRef}>
      <button
        aria-expanded={open}
        aria-label={ariaLabel}
        className="preset-select-trigger"
        onClick={() => setOpen((isOpen) => !isOpen)}
        type="button"
      >
        <span>{selected.label}</span>
        <ChevronDown aria-hidden="true" className="preset-select-chevron" size={15} />
      </button>
      {open ? (
        <span className="preset-select-menu" role="listbox">
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className="preset-select-option"
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              role="option"
              type="button"
            >
              <span>{option.label}</span>
              {option.value === value ? <Check aria-hidden="true" size={15} /> : null}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

type CollapsibleControlSectionProps = {
  ariaLabel: string;
  children: ReactNode;
  collapsed: boolean;
  detail?: ReactNode;
  id: ControlPanelId;
  onToggle: (id: ControlPanelId) => void;
  title: string;
};

function CollapsibleControlSection({
  ariaLabel,
  children,
  collapsed,
  detail,
  id,
  onToggle,
  title,
}: CollapsibleControlSectionProps) {
  const contentId = `${id}-panel-content`;

  return (
    <section className="resolution-panel" data-collapsed={collapsed} aria-label={ariaLabel}>
      <button
        aria-controls={contentId}
        aria-expanded={!collapsed}
        className="panel-heading panel-heading-button"
        onClick={() => onToggle(id)}
        type="button"
      >
        <span className="panel-title">
          <ChevronDown aria-hidden="true" className="panel-heading-chevron" size={15} />
          <span>{title}</span>
        </span>
        {detail ? <output>{detail}</output> : null}
      </button>
      <div className="panel-content" hidden={collapsed} id={contentId}>
        {children}
      </div>
    </section>
  );
}

type GradientColorPickerProps = {
  canDelete: boolean;
  color: string;
  onDelete: () => void;
  onChange: (color: string) => void;
  onClose: () => void;
};

function GradientColorPicker({ canDelete, color, onChange, onClose, onDelete }: GradientColorPickerProps) {
  const [hexDraft, setHexDraft] = useState(color);
  const hsb = hexToHsb(color);
  const [selectedHue, setSelectedHue] = useState(() => hsb.h);
  const hueColor = hsbToHex({ b: 100, h: selectedHue, s: 100 });

  useEffect(() => {
    setHexDraft(color);
    const nextHsb = hexToHsb(color);
    if (nextHsb.s > 0) {
      setSelectedHue(nextHsb.h);
    }
  }, [color]);

  const updateWithHsb = (patch: Partial<HsbColor>) => {
    onChange(hsbToHex({ ...hsb, h: selectedHue, ...patch }));
  };

  const handleColorFieldPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (event.type === "pointermove" && event.buttons !== 1) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100));
    updateWithHsb({ b: 100 - y, s: x });
  };

  const handleHuePointer = (event: PointerEvent<HTMLDivElement>) => {
    if (event.type === "pointermove" && event.buttons !== 1) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const nextHue = Math.min(360, Math.max(0, ((event.clientX - rect.left) / rect.width) * 360));
    setSelectedHue(nextHue);
    onChange(hsbToHex({ ...hsb, h: nextHue }));
  };

  const updateHex = (value: string) => {
    setHexDraft(value);
    const nextValue = value.startsWith("#") ? value : `#${value}`;
    if (/^#[0-9a-f]{6}$/i.test(nextValue)) {
      onChange(nextValue.toUpperCase());
    }
  };

  return (
    <div className="color-picker-panel">
      <button
        aria-label="Close color picker"
        className="color-picker-close"
        onClick={onClose}
        title="Close"
        type="button"
      >
        <X aria-hidden="true" size={14} />
      </button>
      <div
        className="color-field"
        data-mode="hsb"
        onPointerDown={handleColorFieldPointer}
        onPointerMove={handleColorFieldPointer}
        style={
          {
            "--picker-hue": hueColor,
            "--picker-l": `${100 - hsb.b}%`,
            "--picker-s": `${hsb.s}%`,
          } as CSSProperties
        }
      >
        <button aria-label="Color field position" className="color-field-cursor" type="button" />
      </div>
      <div
        className="hue-rail"
        onPointerDown={handleHuePointer}
        onPointerMove={handleHuePointer}
        style={{ "--picker-h": `${(selectedHue / 360) * 100}%` } as CSSProperties}
      >
        <button aria-label="Hue position" className="hue-cursor" type="button" />
      </div>
      <div className="color-picker-bottom" data-mode="hex">
        <span className="picker-mode-label">Hex</span>
        <div className="picker-channel-group">
          <input
            aria-label="Hex color"
            className="picker-field-control picker-hex-input"
            maxLength={7}
            onBlur={() => setHexDraft(color)}
            onChange={(event) => updateHex(event.target.value)}
            spellCheck={false}
            value={hexDraft}
          />
        </div>
        <button
          aria-label="Delete gradient color"
          className="picker-delete-button"
          disabled={!canDelete}
          onClick={onDelete}
          title="Delete color"
          type="button"
        >
          <Trash2 aria-hidden="true" size={13} />
        </button>
      </div>
    </div>
  );
}

type CurvesEditorProps = {
  onPresetChange: (preset: string) => void;
  onPointsChange: (points: VideoCurvePoint[]) => void;
  points: VideoCurvePoint[];
  preset: string;
};

function CurvesEditor({ onPointsChange, onPresetChange, points, preset }: CurvesEditorProps) {
  const [selectedCurveIndex, setSelectedCurveIndex] = useState(1);
  const [dragCurveTarget, setDragCurveTarget] = useState<CurveDragTarget | null>(null);
  const [curveHeight, setCurveHeight] = useState(178);
  const [curveResizeState, setCurveResizeState] = useState<CurveResizeState | null>(null);
  const curveClickRef = useRef<{ index: number; time: number } | null>(null);
  const curvePath = buildCurvePath(points);

  const commitPoints = (nextPoints: VideoCurvePoint[]) => {
    onPresetChange("custom");
    onPointsChange(cloneCurvePoints(nextPoints));
  };

  function applyCurvePreset(value: string) {
    const nextPreset = CURVE_PRESETS.find((candidate) => candidate.value === value);
    onPresetChange(value);

    if (!nextPreset?.points) {
      return;
    }

    const nextPoints = cloneCurvePoints(nextPreset.points);
    onPointsChange(nextPoints);
    setSelectedCurveIndex(Math.min(1, nextPoints.length - 1));
  }

  const getRawCurvePointFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();

    return {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    };
  };

  const getCurvePointFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const point = getRawCurvePointFromPointer(event);

    return {
      x: clamp(point.x, 0, 100),
      y: clamp(point.y, 0, 100),
    };
  };

  const translateCurveHandle = (point: Point, deltaX: number, deltaY: number) => ({
    x: point.x + deltaX,
    y: point.y + deltaY,
  });

  const updateCurvePointFromPointer = (event: PointerEvent<HTMLDivElement>, activeTarget: CurveDragTarget) => {
    const nextPoint = activeTarget.target === "anchor" ? getCurvePointFromPointer(event) : getRawCurvePointFromPointer(event);
    const nextPoints = points.map((point, index) => {
      if (index !== activeTarget.index) {
        return point;
      }

      if (activeTarget.target === "anchor") {
        const deltaX = nextPoint.x - point.anchor.x;
        const deltaY = nextPoint.y - point.anchor.y;

        return {
          ...point,
          anchor: nextPoint,
          handleIn: translateCurveHandle(point.handleIn, deltaX, deltaY),
          handleOut: translateCurveHandle(point.handleOut, deltaX, deltaY),
        };
      }

      if (activeTarget.target === "handleIn" && point.mode === "smooth") {
        return {
          ...point,
          handleIn: nextPoint,
          handleOut: mirrorCurveHandle(point.anchor, nextPoint),
        };
      }

      if (activeTarget.target === "handleOut" && point.mode === "smooth") {
        return {
          ...point,
          handleIn: mirrorCurveHandle(point.anchor, nextPoint),
          handleOut: nextPoint,
        };
      }

      return {
        ...point,
        [activeTarget.target]: nextPoint,
      };
    });

    commitPoints(nextPoints);
  };

  const startCurveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-curve-target]");

    if (!target) {
      return;
    }

    const curveTarget = target.dataset.curveTarget as CurveDragTarget["target"] | undefined;
    const curveIndex = Number(target.dataset.curveIndex);

    if ((curveTarget !== "anchor" && curveTarget !== "handleIn" && curveTarget !== "handleOut") || !Number.isFinite(curveIndex)) {
      return;
    }

    event.stopPropagation();
    if (curveTarget === "anchor") {
      const now = window.performance.now();
      const previousClick = curveClickRef.current;
      const isDoubleClick = (previousClick?.index === curveIndex && now - previousClick.time < 450) || event.detail >= 2;

      if (isDoubleClick) {
        curveClickRef.current = null;
        toggleCurvePointModeAt(curveIndex);
        return;
      }

      curveClickRef.current = { index: curveIndex, time: now };
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedCurveIndex(curveIndex);
    setDragCurveTarget({ index: curveIndex, target: curveTarget });
  };

  const dragCurvePoint = (event: PointerEvent<HTMLDivElement>) => {
    if (dragCurveTarget === null) {
      return;
    }

    event.preventDefault();
    updateCurvePointFromPointer(event, dragCurveTarget);
  };

  const stopCurveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragCurveTarget !== null && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setDragCurveTarget(null);
  };

  function addCurvePointFromDoubleClick(event: MouseEvent<SVGSVGElement>) {
    const target = event.target as SVGElement;

    if (!target.closest(".curve-line, .curve-line-hit, .curve-line-path")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = {
      x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
    };
    const nextPoint: VideoCurvePoint = {
      anchor,
      handleIn: { x: clamp(anchor.x - 12, 0, 100), y: anchor.y },
      handleOut: { x: clamp(anchor.x + 12, 0, 100), y: anchor.y },
      mode: "smooth",
    };
    const naturalIndex = points.findIndex((point, index) => index > 0 && point.anchor.x > anchor.x);
    const insertIndex = naturalIndex === -1 ? points.length - 1 : naturalIndex;
    const nextPoints = [...points];

    nextPoints.splice(insertIndex, 0, nextPoint);
    setSelectedCurveIndex(insertIndex);
    commitPoints(nextPoints);
  }

  function toggleCurvePointModeAt(index: number) {
    setSelectedCurveIndex(index);
    commitPoints(points.map((point, pointIndex): VideoCurvePoint => {
      if (pointIndex !== index) {
        return point;
      }

      return point.mode === "smooth" ? { ...point, mode: "corner" } : smoothCurvePoint(point);
    }));
  }

  function startCurveResize(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setCurveResizeState({
      pointerId: event.pointerId,
      startHeight: curveHeight,
      startY: event.clientY,
    });
  }

  function dragCurveResize(event: PointerEvent<HTMLButtonElement>) {
    if (curveResizeState === null || curveResizeState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    setCurveHeight(clamp(curveResizeState.startHeight + event.clientY - curveResizeState.startY, 120, 360));
  }

  function stopCurveResize(event: PointerEvent<HTMLButtonElement>) {
    if (curveResizeState !== null && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setCurveResizeState(null);
  }

  function removeSelectedCurvePoint() {
    if (selectedCurveIndex <= 0 || selectedCurveIndex >= points.length - 1) {
      return;
    }

    const nextPoints = points.filter((_, index) => index !== selectedCurveIndex);
    setSelectedCurveIndex(clamp(selectedCurveIndex - 1, 0, nextPoints.length - 1));
    commitPoints(nextPoints);
  }

  const handleCurveKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Backspace" && event.key !== "Delete") {
      return;
    }

    event.preventDefault();
    removeSelectedCurvePoint();
  };

  return (
    <div className="curves-editor">
      <div className="curve-preset-row">
        <span>Preset</span>
        <PresetDropdown
          ariaLabel="Curve presets"
          onChange={applyCurvePreset}
          options={CURVE_PRESET_OPTIONS}
          value={preset}
        />
      </div>
      <div
        className="curve-box"
        onKeyDown={handleCurveKeyDown}
        style={{ "--curve-height": `${curveHeight}px` } as CSSProperties}
        tabIndex={0}
      >
        <div
          className="curve-stage"
          onPointerCancel={stopCurveDrag}
          onPointerDown={startCurveDrag}
          onPointerMove={dragCurvePoint}
          onPointerUp={stopCurveDrag}
        >
          <svg aria-hidden="true" className="curve-line" onDoubleClick={addCurvePointFromDoubleClick} preserveAspectRatio="none" viewBox="0 0 100 100">
            {points.map((point, index) => (
              index === selectedCurveIndex && index > 0 ? (
                <line
                  className="curve-handle-line"
                  key={`${index}-handle-in-line`}
                  x1={point.anchor.x}
                  x2={point.handleIn.x}
                  y1={point.anchor.y}
                  y2={point.handleIn.y}
                />
              ) : null
            ))}
            {points.map((point, index) => (
              index === selectedCurveIndex && index < points.length - 1 ? (
                <line
                  className="curve-handle-line"
                  key={`${index}-handle-out-line`}
                  x1={point.anchor.x}
                  x2={point.handleOut.x}
                  y1={point.anchor.y}
                  y2={point.handleOut.y}
                />
              ) : null
            ))}
            <path className="curve-line-path" d={curvePath} fill="none" />
            <path className="curve-line-hit" d={curvePath} fill="none" />
          </svg>
          {points.map((point, index) => (
            index === selectedCurveIndex && index > 0 ? (
              <button
                aria-label={`Curve point ${index + 1} incoming handle`}
                className="curve-bezier-handle"
                data-curve-index={index}
                data-curve-target="handleIn"
                data-selected="true"
                key={`${index}-handle-in`}
                style={{ "--curve-x": `${point.handleIn.x}%`, "--curve-y": `${point.handleIn.y}%` } as CSSProperties}
                type="button"
              />
            ) : null
          ))}
          {points.map((point, index) => (
            <button
              aria-label={`Curve point ${index + 1}`}
              className="curve-point"
              data-curve-index={index}
              data-curve-mode={point.mode}
              data-curve-target="anchor"
              data-selected={selectedCurveIndex === index}
              key={`${index}-anchor`}
              style={{ "--curve-x": `${point.anchor.x}%`, "--curve-y": `${point.anchor.y}%` } as CSSProperties}
              type="button"
            />
          ))}
          {points.map((point, index) => (
            index === selectedCurveIndex && index < points.length - 1 ? (
              <button
                aria-label={`Curve point ${index + 1} outgoing handle`}
                className="curve-bezier-handle"
                data-curve-index={index}
                data-curve-target="handleOut"
                data-selected="true"
                key={`${index}-handle-out`}
                style={{ "--curve-x": `${point.handleOut.x}%`, "--curve-y": `${point.handleOut.y}%` } as CSSProperties}
                type="button"
              />
            ) : null
          ))}
        </div>
        <button
          aria-label="Resize curves vertically"
          className="curve-resize-handle"
          onPointerCancel={stopCurveResize}
          onPointerDown={startCurveResize}
          onPointerMove={dragCurveResize}
          onPointerUp={stopCurveResize}
          type="button"
        />
      </div>
    </div>
  );
}

function App() {
  const [initialSettings] = useState(readStoredSettings);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const modelInputRef = useRef<HTMLInputElement | null>(null);
  const presetBackupInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const gifPlaybackTimeoutRef = useRef<number | null>(null);
  const hasStartedDefaultExperienceRef = useRef(false);
  const presetHintTimeoutRef = useRef<number | null>(null);
  const openingPlaybackTimeoutRef = useRef<number | null>(null);
  const applyTopPresetRef = useRef<((preset: ScenePreset, index: number) => Promise<void>) | null>(null);
  const activeTopPresetIndexRef = useRef(-1);
  const selectedTopPresetIndexRef = useRef(-1);
  const presetLiveAudioRestoreRef = useRef<SceneSettings | null>(null);
  const presetLiveAudioDelayRestoreRef = useRef(DEFAULT_LIVE_AUDIO_RESPONSE_DELAY);
  const presetAssignmentsRef = useRef<PresetAssignments>({});
  const midiPresetValuesRef = useRef<Array<Partial<Pick<SceneSettings, "luminosityZSeparation" | "symbolScale">>>>([{ }, { }, { }, { }]);
  const streamRef = useRef<MediaStream | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [imageElement, setImageElement] = useState<HTMLCanvasElement | null>(null);
  const [liveAudioStream, setLiveAudioStream] = useState<MediaStream | null>(null);
  const [videoRevision, setVideoRevision] = useState(0);
  const [sourceKind, setSourceKind] = useState<SourceKind>("idle");
  const [sourceName, setSourceName] = useState("No source");
  const [audioBackgroundColor, setAudioBackgroundColor] = useState(initialSettings.audioBackgroundColor);
  const [audioEffectIntensity, setAudioEffectIntensity] = useState(initialSettings.audioEffectIntensity);
  const [environmentIntensity, setEnvironmentIntensity] = useState(100);
  const [environmentRotationX, setEnvironmentRotationX] = useState(0);
  const [environmentRotation, setEnvironmentRotation] = useState(0);
  const [environmentRotationZ, setEnvironmentRotationZ] = useState(0);
  const [fillLightColor, setFillLightColor] = useState("#ffffff");
  const [fillLightIntensity, setFillLightIntensity] = useState(100);
  const [hdriMapUrl, setHdriMapUrl] = useState<string | null>(null);
  const [showHdriBackground, setShowHdriBackground] = useState(false);
  const hdriInputRef = useRef<HTMLInputElement>(null);
  const [audioForegroundColor, setAudioForegroundColor] = useState(initialSettings.audioForegroundColor);
  const [audioGradientColors, setAudioGradientColors] = useState(initialSettings.audioGradientColors);
  const [audioGradientStops, setAudioGradientStops] = useState(initialSettings.audioGradientStops);
  const [collisionsEnabled, setCollisionsEnabled] = useState(initialSettings.collisionsEnabled);
  const [dynamicallyAwareCollision, setDynamicallyAwareCollision] = useState(initialSettings.dynamicallyAwareCollision);
  const [dynamicCollisionResponse, setDynamicCollisionResponse] = useState(initialSettings.dynamicCollisionResponse);
  const [selectedGradientStopIndex, setSelectedGradientStopIndex] = useState(initialSettings.audioGradientStops.length - 1);
  const [dragGradientStopIndex, setDragGradientStopIndex] = useState<number | null>(null);
  const [colorPickerState, setColorPickerState] = useState<ColorPickerState>(null);
  const [audioLevelScale, setAudioLevelScale] = useState(1);
  const [liveAudioResponseDelay, setLiveAudioResponseDelay] = useState(DEFAULT_LIVE_AUDIO_RESPONSE_DELAY);
  const [floorVisible, setFloorVisible] = useState(initialSettings.floorVisible);
  const [screenVisible, setScreenVisible] = useState(initialSettings.screenVisible);
  const [effectVisible, setEffectVisible] = useState(initialSettings.effectVisible);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [collapsedPanels, setCollapsedPanels] = useState<CollapsedPanels>(DEFAULT_COLLAPSED_PANELS);
  const [dotColumns, setDotColumns] = useState(initialSettings.dotColumns);
  const [dotRows, setDotRows] = useState(initialSettings.dotRows);
  const [symbolScale, setSymbolScale] = useState(initialSettings.symbolScale);
  const [symbolSpacing, setSymbolSpacing] = useState(initialSettings.symbolSpacing);
  const [grayscaleVideo, setGrayscaleVideo] = useState(initialSettings.grayscaleVideo);
  const [luminositySizing, setLuminositySizing] = useState(initialSettings.luminositySizing);
  const [luminosityZSeparation, setLuminosityZSeparation] = useState(initialSettings.luminosityZSeparation);
  const [randomPositionX, setRandomPositionX] = useState(initialSettings.randomPositionX);
  const [randomPositionY, setRandomPositionY] = useState(initialSettings.randomPositionY);
  const [randomPositionZ, setRandomPositionZ] = useState(initialSettings.randomPositionZ);
  const [randomRotationX, setRandomRotationX] = useState(initialSettings.randomRotationX);
  const [randomRotationY, setRandomRotationY] = useState(initialSettings.randomRotationY);
  const [randomRotationZ, setRandomRotationZ] = useState(initialSettings.randomRotationZ);
  const [randomScale, setRandomScale] = useState(initialSettings.randomScale);
  const [flatSymbols, setFlatSymbols] = useState(initialSettings.flatSymbols);
  const [videoCurvePoints, setVideoCurvePoints] = useState(() => cloneCurvePoints(initialSettings.videoCurvePoints));
  const [videoCurvePreset, setVideoCurvePreset] = useState(initialSettings.videoCurvePreset);
  const [videoGradientEnabled, setVideoGradientEnabled] = useState(initialSettings.videoGradientEnabled);
  const [videoZoom, setVideoZoom] = useState(initialSettings.videoZoom);
  const [presets, setPresets] = useState<ScenePreset[]>(readStoredPresets);
  const [presetAssignments, setPresetAssignments] = useState<PresetAssignments>(readStoredPresetAssignments);
  const [activePresetId, setActivePresetId] = useState(readStoredActivePreset);
  const [presetName, setPresetName] = useState("");
  const [presetHintSlot, setPresetHintSlot] = useState<number | null>(null);
  const [symbolName, setSymbolName] = useState("Sphere");
  const [symbolModelSource, setSymbolModelSource] = useState<SymbolModelSource | null>(null);
  const [symbolPrimitive, setSymbolPrimitive] = useState<SymbolPrimitive>("sphere");
  const [symbolRevision, setSymbolRevision] = useState(0);
  const [symbolStatus, setSymbolStatus] = useState("Sphere active");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSampleVideoDropTarget, setIsSampleVideoDropTarget] = useState(false);
  const [pendingPresetSource, setPendingPresetSource] = useState<SourceKind | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [resetSignal, setResetSignal] = useState(0);
  const [message, setMessage] = useState("Ready");
  const [, setMidiStatus] = useState("Looking for Grid controller…");

  activeTopPresetIndexRef.current = SHARED_PRESETS.findIndex((preset) => activePresetId === `shared:${preset.id}`);
  presetAssignmentsRef.current = presetAssignments;

  const releaseSource = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    setLiveAudioStream(null);

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    if (gifPlaybackTimeoutRef.current !== null) {
      window.clearTimeout(gifPlaybackTimeoutRef.current);
      gifPlaybackTimeoutRef.current = null;
    }
    if (imageElement) {
      imageElement.width = 0;
      imageElement.height = 0;
    }
  }, [imageElement]);

  useEffect(() => {
    return () => {
      if (presetHintTimeoutRef.current !== null) {
        window.clearTimeout(presetHintTimeoutRef.current);
      }
      if (openingPlaybackTimeoutRef.current !== null) {
        window.clearTimeout(openingPlaybackTimeoutRef.current);
      }
      releaseSource();
    };
  }, [releaseSource]);

  useEffect(() => {
    if (videoElement) {
      videoElement.muted = sourceKind === "webcam" || sourceKind === "live-audio";
    }
  }, [sourceKind, videoElement]);

  useEffect(() => {
    if (!colorPickerState) {
      return undefined;
    }

    const closeColorPickerOnOutsidePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;

      if (target?.closest(".floating-color-picker") || target?.closest("[data-gradient-stop-index]")) {
        return;
      }

      setColorPickerState(null);
    };

    const closeColorPickerOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setColorPickerState(null);
      }
    };

    document.addEventListener("pointerdown", closeColorPickerOnOutsidePointerDown);
    document.addEventListener("keydown", closeColorPickerOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeColorPickerOnOutsidePointerDown);
      document.removeEventListener("keydown", closeColorPickerOnEscape);
    };
  }, [colorPickerState]);

  const currentSettings = useMemo<SceneSettings>(() => ({
    audioBackgroundColor,
    audioEffectIntensity,
    audioForegroundColor,
    audioGradientColors,
    audioGradientStops,
    collisionsEnabled,
    dynamicallyAwareCollision,
    dynamicCollisionResponse,
    environmentIntensity,
    environmentRotationX,
    environmentRotationY: environmentRotation,
    environmentRotationZ,
    fillLightColor,
    fillLightIntensity,
    dotColumns,
    dotRows,
    effectVisible,
    flatSymbols,
    floorVisible,
    grayscaleVideo,
    luminositySizing,
    luminosityZSeparation,
    randomPositionX,
    randomPositionY,
    randomPositionZ,
    randomRotationX,
    randomRotationY,
    randomRotationZ,
    randomScale,
    screenVisible,
    showHdriBackground,
    sourceKind,
    symbolPrimitive,
    symbolScale,
    symbolSpacing,
    videoCurvePoints,
    videoCurvePreset,
    videoGradientEnabled,
    videoZoom,
  }), [
    audioBackgroundColor,
    audioEffectIntensity,
    audioForegroundColor,
    audioGradientColors,
    audioGradientStops,
    collisionsEnabled,
    dynamicallyAwareCollision,
    dynamicCollisionResponse,
    environmentIntensity,
    environmentRotationX,
    environmentRotation,
    environmentRotationZ,
    fillLightColor,
    fillLightIntensity,
    dotColumns,
    dotRows,
    effectVisible,
    flatSymbols,
    floorVisible,
    grayscaleVideo,
    luminositySizing,
    luminosityZSeparation,
    randomPositionX,
    randomPositionY,
    randomPositionZ,
    randomRotationX,
    randomRotationY,
    randomRotationZ,
    randomScale,
    screenVisible,
    showHdriBackground,
    sourceKind,
    symbolPrimitive,
    symbolScale,
    symbolSpacing,
    videoCurvePoints,
    videoCurvePreset,
    videoGradientEnabled,
    videoZoom,
  ]);

  const applySettings = useCallback((settings: SceneSettings, applySource = true) => {
    setAudioEffectIntensity(settings.audioEffectIntensity);
    setCollisionsEnabled(settings.collisionsEnabled);
    setDynamicallyAwareCollision(settings.dynamicallyAwareCollision);
    setDynamicCollisionResponse(settings.dynamicCollisionResponse);
    setEnvironmentIntensity(settings.environmentIntensity);
    setEnvironmentRotationX(settings.environmentRotationX);
    setEnvironmentRotation(settings.environmentRotationY);
    setEnvironmentRotationZ(settings.environmentRotationZ);
    setFillLightColor(settings.fillLightColor);
    setFillLightIntensity(settings.fillLightIntensity);
    setDotColumns(settings.dotColumns);
    setDotRows(settings.dotRows);
    setEffectVisible(settings.effectVisible);
    setFlatSymbols(settings.flatSymbols);
    setFloorVisible(settings.floorVisible);
    setGrayscaleVideo(settings.grayscaleVideo);
    setLuminositySizing(settings.luminositySizing);
    setLuminosityZSeparation(settings.luminosityZSeparation);
    setRandomPositionX(settings.randomPositionX);
    setRandomPositionY(settings.randomPositionY);
    setRandomPositionZ(settings.randomPositionZ);
    setRandomRotationX(settings.randomRotationX);
    setRandomRotationY(settings.randomRotationY);
    setRandomRotationZ(settings.randomRotationZ);
    setRandomScale(settings.randomScale);
    setScreenVisible(settings.screenVisible);
    setShowHdriBackground(settings.showHdriBackground);
    if (applySource) {
      setPendingPresetSource(settings.sourceKind);
    }
    setSymbolName(settings.symbolPrimitive === "square" ? "Cube" : "Sphere");
    setSymbolModelSource(null);
    setSymbolPrimitive(settings.symbolPrimitive);
    setSymbolStatus(settings.symbolPrimitive === "square" ? "Cube active" : "Sphere active");
    setSymbolScale(settings.symbolScale);
    setSymbolSpacing(settings.symbolSpacing);
    setVideoCurvePoints(cloneCurvePoints(settings.videoCurvePoints));
    setVideoCurvePreset(settings.videoCurvePreset);
    setVideoGradientEnabled(settings.videoGradientEnabled);
    setAudioGradientColors(settings.audioGradientColors);
    setAudioGradientStops(settings.audioGradientStops);
    setAudioBackgroundColor(settings.audioGradientStops[0]?.color ?? DEFAULT_SCENE_SETTINGS.audioBackgroundColor);
    setAudioForegroundColor(settings.audioGradientStops[settings.audioGradientStops.length - 1]?.color ?? DEFAULT_SCENE_SETTINGS.audioForegroundColor);
  }, []);

  const markCustomSettings = () => {
    setActivePresetId("");
  };

  const restorePresetLiveAudioVariant = useCallback(() => {
    const settings = presetLiveAudioRestoreRef.current;
    if (!settings) {
      return;
    }

    applySettings(settings, false);
    setLiveAudioResponseDelay(presetLiveAudioDelayRestoreRef.current);
    presetLiveAudioRestoreRef.current = null;
  }, [applySettings]);

  const toggleControlPanel = useCallback((id: ControlPanelId) => {
    setCollapsedPanels((panels) => ({
      ...panels,
      [id]: !panels[id],
    }));
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarVisible((visible) => {
      if (!visible) {
        setCollapsedPanels(DEFAULT_COLLAPSED_PANELS);
      }

      return !visible;
    });
  }, []);

  const syncGradientStops = (nextStops: GradientStop[]) => {
    const normalizedStops = normalizeGradientStops(nextStops).slice(0, 8);
    setAudioGradientStops(normalizedStops);
    setAudioGradientColors(normalizedStops.map((stop) => stop.color));
    setAudioBackgroundColor(normalizedStops[0]?.color ?? DEFAULT_SCENE_SETTINGS.audioBackgroundColor);
    setAudioForegroundColor(normalizedStops[normalizedStops.length - 1]?.color ?? DEFAULT_SCENE_SETTINGS.audioForegroundColor);
  };

  const updateGradientStop = (index: number, patch: Partial<GradientStop>) => {
    markCustomSettings();
    setAudioGradientStops((stops) => {
      const nextStops = stops.map((stop, stopIndex) =>
        stopIndex === index
          ? {
              ...stop,
              ...patch,
              color: patch.color ? readColor(patch.color, stop.color) : stop.color,
              offset: patch.offset === undefined ? stop.offset : clampNumber(patch.offset, 0, 100, stop.offset),
            }
          : stop,
      );
      setAudioGradientColors(nextStops.map((stop) => stop.color));
      setAudioBackgroundColor(nextStops[0]?.color ?? DEFAULT_SCENE_SETTINGS.audioBackgroundColor);
      setAudioForegroundColor(nextStops[nextStops.length - 1]?.color ?? DEFAULT_SCENE_SETTINGS.audioForegroundColor);
      return nextStops;
    });
  };

  const offsetFromGradientClientX = (element: HTMLElement, clientX: number) => {
    const rect = element.getBoundingClientRect();
    return clampNumber(((clientX - rect.left) / rect.width) * 100, 0, 100, 0);
  };

  const offsetFromGradientPointer = (event: PointerEvent<HTMLDivElement>) => {
    return offsetFromGradientClientX(event.currentTarget, event.clientX);
  };

  const addGradientStopAtOffset = (offset: number) => {
    markCustomSettings();
    const nextStop = { color: sampleGradientHexColor(audioGradientStops, offset), offset };
    const nextStops = normalizeGradientStops([...audioGradientStops, nextStop]);
    const nextIndex = nextStops.findIndex((stop) => stop.color === nextStop.color && stop.offset === nextStop.offset);
    syncGradientStops(nextStops);
    setSelectedGradientStopIndex(nextIndex === -1 ? nextStops.length - 1 : nextIndex);
  };

  const removeGradientStop = (index: number) => {
    markCustomSettings();
    if (audioGradientStops.length <= 2) {
      return;
    }

    const nextStops = audioGradientStops.filter((_, stopIndex) => stopIndex !== index);
    syncGradientStops(nextStops);
    setSelectedGradientStopIndex(Math.min(Math.max(index - 1, 0), nextStops.length - 1));
  };

  useEffect(() => {
    const deleteSelectedGradientStop = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Delete" || colorPickerState || audioGradientStops.length <= 2) {
        return;
      }

      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLInputElement
        || activeElement instanceof HTMLTextAreaElement
        || activeElement?.getAttribute("contenteditable") === "true"
      ) {
        return;
      }

      event.preventDefault();
      removeGradientStop(selectedGradientStopIndex);
    };

    window.addEventListener("keydown", deleteSelectedGradientStop);
    return () => window.removeEventListener("keydown", deleteSelectedGradientStop);
  }, [audioGradientStops.length, colorPickerState, removeGradientStop, selectedGradientStopIndex]);

  const startGradientDrag = (event: PointerEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-gradient-stop-index]");

    if (!target) {
      return;
    }

    const stopIndex = Number(target.dataset.gradientStopIndex);
    if (event.detail >= 2) {
      setSelectedGradientStopIndex(stopIndex);
      setDragGradientStopIndex(null);
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedGradientStopIndex(stopIndex);
    setDragGradientStopIndex(stopIndex);
  };

  const dragGradientStop = (event: PointerEvent<HTMLDivElement>) => {
    if (dragGradientStopIndex === null) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    if (audioGradientStops.length > 2 && (event.clientY < rect.top - 22 || event.clientY > rect.bottom + 22)) {
      removeGradientStop(dragGradientStopIndex);
      setDragGradientStopIndex(null);
      return;
    }

    updateGradientStop(dragGradientStopIndex, { offset: offsetFromGradientPointer(event) });
  };

  const stopGradientDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (dragGradientStopIndex !== null) {
      setAudioGradientStops((stops) => {
        const draggedStop = stops[dragGradientStopIndex];
        if (!draggedStop) {
          return stops;
        }

        const nextStops = normalizeGradientStops(stops);
        const nextIndex = nextStops.findIndex((stop) => stop.color === draggedStop.color && stop.offset === draggedStop.offset);
        const selectedIndex = nextIndex === -1 ? Math.min(dragGradientStopIndex, nextStops.length - 1) : nextIndex;
        setAudioGradientColors(nextStops.map((stop) => stop.color));
        setAudioBackgroundColor(nextStops[0]?.color ?? DEFAULT_SCENE_SETTINGS.audioBackgroundColor);
        setAudioForegroundColor(nextStops[nextStops.length - 1]?.color ?? DEFAULT_SCENE_SETTINGS.audioForegroundColor);
        setSelectedGradientStopIndex(selectedIndex);
        setColorPickerState((state) => state ? { ...state, stopIndex: selectedIndex } : state);
        return nextStops;
      });
    }

    setDragGradientStopIndex(null);
  };

  const openGradientStopPicker = (index: number, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    setSelectedGradientStopIndex(index);
    setColorPickerState({
      stopIndex: index,
      x: Math.min(window.innerWidth - 245, Math.max(8, rect.left)),
      y: Math.min(window.innerHeight - 245, rect.bottom + 9),
    });
  };

  const handleResetEffect = () => {
    applySettings(DEFAULT_SCENE_SETTINGS);
    setActivePresetId("");
    setPresetName("");
    setResetSignal((signal) => signal + 1);
    setMessage("Effect reset");
  };

  const presetOptions = useMemo<PresetDropdownOption[]>(() => [
    { label: "Latest settings", value: "" },
    ...presets.map((preset) => ({ label: preset.name, value: preset.id })),
  ], [presets]);
  const activeSavedPreset = useMemo(
    () => presets.find((candidate) => candidate.id === activePresetId),
    [activePresetId, presets],
  );
  const sharedPresets = SHARED_PRESETS;

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.latestSettings, JSON.stringify(currentSettings));
    } catch {
      setMessage("Settings could not be saved");
    }
  }, [currentSettings]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.presetAssignments, JSON.stringify(presetAssignments));
    } catch {
      setMessage("Preset assignment could not be saved");
    }
  }, [presetAssignments]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.presets, JSON.stringify(presets));
    } catch {
      setMessage("Preset storage full");
    }
  }, [presets]);

  useEffect(() => {
    try {
      if (activeSavedPreset) {
        window.localStorage.setItem(STORAGE_KEYS.activePreset, activePresetId);
        return;
      }

      window.localStorage.removeItem(STORAGE_KEYS.activePreset);
    } catch {
      setMessage("Preset selection could not be saved");
    }
  }, [activePresetId, activeSavedPreset]);

  useEffect(() => {
    if (activePresetId && !activePresetId.startsWith("shared:") && !presets.some((preset) => preset.id === activePresetId)) {
      setActivePresetId("");
    }
  }, [activePresetId, presets]);

  const loadVideoElement = useCallback(
    async (
      setup: () => void,
      nextKind: SourceKind,
      nextName: string,
      forceMuted = isMuted,
      autoPlay = true,
    ) => {
      if (!videoElement) {
        return;
      }

      if (openingPlaybackTimeoutRef.current !== null) {
        window.clearTimeout(openingPlaybackTimeoutRef.current);
        openingPlaybackTimeoutRef.current = null;
      }

      releaseSource();
      videoElement.pause();
      videoElement.srcObject = null;
      videoElement.removeAttribute("src");
      videoElement.load();

      setup();

      videoElement.loop = true;
      videoElement.playsInline = true;
      videoElement.muted = nextKind === "webcam" || nextKind === "live-audio";
      const sourceObject = videoElement.srcObject as unknown;
      setLiveAudioStream(
        nextKind === "live-audio" && sourceObject instanceof MediaStream
          ? sourceObject
          : null,
      );
      setIsMuted(forceMuted);
      setSourceKind(nextKind);
      setSourceName(nextName);
      setVideoRevision((revision) => revision + 1);

      if (!autoPlay) {
        videoElement.load();
        videoElement.currentTime = 0;
        setIsPlaying(false);
        setMessage("Preparing Preset 1");
        return;
      }

      try {
        await videoElement.play();
        setIsPlaying(true);
        setMessage(sourceActiveMessage(nextKind));
      } catch {
        setIsPlaying(false);
        setMessage("Paused");
      }
    },
    [imageElement, isMuted, releaseSource, videoElement],
  );

  const importVideoFile = useCallback(async (file: File) => {
    const isGif = file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
    if (!file.type.startsWith("video/") && !isGif) {
      setMessage("Drop an MP4, MOV, WebM, or GIF here");
      return;
    }

    if (isGif) {
      if (!videoElement || !imageElement) {
        return;
      }

      const parsedGif = parseGIF(await file.arrayBuffer());
      const frames = decompressFrames(parsedGif, true);
      if (frames.length === 0) {
        setMessage("This GIF has no playable frames");
        return;
      }

      releaseSource();
      videoElement.pause();
      videoElement.srcObject = null;
      videoElement.removeAttribute("src");
      videoElement.load();
      imageElement.width = parsedGif.lsd.width;
      imageElement.height = parsedGif.lsd.height;
      const gifContext = imageElement.getContext("2d");
      const patchCanvas = document.createElement("canvas");
      const patchContext = patchCanvas.getContext("2d");
      if (!gifContext || !patchContext) {
        setMessage("GIF playback is unavailable");
        return;
      }

      let frameIndex = 0;
      const renderGifFrame = () => {
        const frame = frames[frameIndex];
        const { height, left, top, width } = frame.dims;
        if (frame.disposalType === 2) {
          gifContext.clearRect(0, 0, imageElement.width, imageElement.height);
        }
        if (patchCanvas.width !== width || patchCanvas.height !== height) {
          patchCanvas.width = width;
          patchCanvas.height = height;
        }
        const patch = patchContext.createImageData(width, height);
        patch.data.set(frame.patch);
        patchContext.putImageData(patch, 0, 0);
        gifContext.drawImage(patchCanvas, left, top);
        frameIndex = (frameIndex + 1) % frames.length;
        gifPlaybackTimeoutRef.current = window.setTimeout(
          () => window.requestAnimationFrame(renderGifFrame),
          Math.max(20, frame.delay || 100),
        );
      };
      renderGifFrame();
      setAudioLevelScale(1);
      setVideoZoom(100);
      setSourceKind("file");
      setSourceName(file.name);
      setIsMuted(true);
      setIsPlaying(true);
      setVideoRevision((revision) => revision + 1);
      setMessage("GIF active");
      return;
    }

    setAudioLevelScale(await analyzeAudioLevelScale(file));
    setVideoZoom(100);
    await loadVideoElement(
      () => {
        if (!videoElement) {
          return;
        }

        const objectUrl = URL.createObjectURL(file);
        objectUrlRef.current = objectUrl;
        videoElement.src = objectUrl;
      },
      "file",
      file.name,
      false,
    );
  }, [imageElement, loadVideoElement, releaseSource, videoElement]);

  const handleImportVideo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    await importVideoFile(file);
  };

  const handleImportAudio = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setAudioLevelScale(await analyzeAudioLevelScale(file));
    await loadVideoElement(
      () => {
        if (!videoElement) {
          return;
        }

        const objectUrl = URL.createObjectURL(file);
        objectUrlRef.current = objectUrl;
        videoElement.src = objectUrl;
      },
      "audio",
      file.name,
      false,
    );
  };

  const handleStartPresetRunnerVideo = async (autoPlay = true) => {
    restorePresetLiveAudioVariant();
    await loadVideoElement(
      () => {
        if (videoElement) {
          videoElement.src = runnerVideoUrl;
        }
      },
      "file",
      "Runner demo",
      true,
      autoPlay,
    );
  };

  const handleImportModel = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      const extension = file.name.toLowerCase().split(".").pop();
      const isStl = extension === "stl";
      const source: SymbolModelSource = isStl
        ? { format: "stl", source: await file.arrayBuffer() }
        : { format: "obj", source: await file.text() };
      setSymbolName(file.name);
      setSymbolModelSource(source);
      setSymbolStatus(isStl ? "Loading STL" : "Loading OBJ");
      setSymbolRevision((revision) => revision + 1);
    } catch {
      setSymbolStatus("Model unavailable");
    }
  };

  const handleUsePrimitiveSymbol = (primitive: SymbolPrimitive) => {
    markCustomSettings();
    setSymbolName(primitive === "square" ? "Cube" : "Sphere");
    setSymbolPrimitive(primitive);
    setSymbolModelSource(null);
    setSymbolRevision((revision) => revision + 1);
  };

  const handleApplyPreset = (presetId: string) => {
    if (!presetId) {
      setActivePresetId("");
      return;
    }

    const preset = presets.find((candidate) => candidate.id === presetId);
    if (!preset) {
      setActivePresetId("");
      return;
    }

    selectedTopPresetIndexRef.current = -1;
    presetLiveAudioRestoreRef.current = null;
    applySettings(preset.settings);
    setActivePresetId(preset.id);
    setPresetName(preset.name);
    setMessage(`${preset.name} loaded`);
  };

  const handleAssignPresetSlot = (slot: PresetSlot) => {
    if (!activeSavedPreset) {
      setMessage("Load a saved preset before assigning it");
      return;
    }
    const isAlreadyAssigned = presetAssignments[slot] === activeSavedPreset.id;
    setPresetAssignments((assignments) => {
      if (assignments[slot] === activeSavedPreset.id) {
        const nextAssignments = { ...assignments };
        delete nextAssignments[slot];
        return nextAssignments;
      }

      const nextAssignments = Object.fromEntries(
        Object.entries(assignments).filter(([, presetId]) => presetId !== activeSavedPreset.id),
      ) as PresetAssignments;
      return { ...nextAssignments, [slot]: activeSavedPreset.id };
    });
    setMessage(
      isAlreadyAssigned
        ? `${activeSavedPreset.name} unassigned from Preset ${slot}`
        : `${activeSavedPreset.name} assigned to Preset ${slot}`,
    );
  };

  const showTopPresetHint = (slot: number) => {
    setPresetHintSlot(slot);

    if (presetHintTimeoutRef.current !== null) {
      window.clearTimeout(presetHintTimeoutRef.current);
    }

    presetHintTimeoutRef.current = window.setTimeout(() => {
      setPresetHintSlot(null);
      presetHintTimeoutRef.current = null;
    }, 3200);
  };

  const handleApplyTopPreset = async (preset: ScenePreset, index: number) => {
    selectedTopPresetIndexRef.current = index;
    presetLiveAudioRestoreRef.current = null;
    const slot = index + 1;
    const details = TOP_PRESET_DETAILS[index];
    const assignedPreset = presets.find((candidate) => candidate.id === presetAssignments[slot as PresetSlot]);
    const savedPreset1 = slot === 1
      ? [...presets]
          .filter((candidate) => candidate.name.trim().toLowerCase() === "latest one")
          .sort((left, right) => right.createdAt - left.createdAt)[0]
        ?? [...presets]
          .filter((candidate) => ["1", "one"].includes(candidate.name.trim().toLowerCase()))
          .sort((left, right) => right.createdAt - left.createdAt)[0]
      : null;
    const savedPreset2 = slot === 2
      ? presets.find((candidate) => candidate.name.trim() === "2")
      : null;
    const storedPreset2Settings = slot === 2 ? readStoredPreset2Override() : null;
    const latestSettings = slot === 2 && !storedPreset2Settings ? readLatestSettings() : null;
    const defaultSettings = slot === 1
      ? {
          ...(savedPreset1?.settings ?? preset.settings),
          grayscaleVideo: false,
          videoGradientEnabled: false,
        }
      : slot === 2
      ? {
          ...(savedPreset2?.settings ?? storedPreset2Settings ?? latestSettings ?? preset.settings),
          grayscaleVideo: false,
          videoGradientEnabled: false,
        }
      : slot === 3
      ? {
          ...preset.settings,
          grayscaleVideo: false,
          videoGradientEnabled: false,
        }
      : slot === 4
      ? {
          ...preset.settings,
          grayscaleVideo: true,
          videoGradientEnabled: false,
        }
      : preset.settings;
    const resolvedSettings = assignedPreset
      ? {
          ...assignedPreset.settings,
          sourceKind: slot === 2 && assignedPreset.name.trim().toLowerCase() === "second"
            ? "webcam" as const
            : assignedPreset.settings.sourceKind,
        }
      : defaultSettings;
    const settings = {
      ...resolvedSettings,
      ...midiPresetValuesRef.current[index],
      ...(slot === 3 ? { dotColumns: 15, dotRows: 12 } : {}),
      sourceKind: slot === 3 ? "live-audio" as const : resolvedSettings.sourceKind,
    };

    showTopPresetHint(slot);
    if (slot === 2 && !storedPreset2Settings && latestSettings) {
      try {
        window.localStorage.setItem(STORAGE_KEYS.preset2Override, JSON.stringify(latestSettings));
      } catch {
        setMessage("Droplet effect could not be saved");
      }
    }
    if (settings.sourceKind === "webcam") {
      setMessage("Waiting for camera permission");
      const webcamStarted = await handleStartWebcam();
      if (!webcamStarted) {
        return;
      }
      applySettings(settings, false);
    } else if (settings.sourceKind === "live-audio") {
      applySettings(settings, false);
      // Enter the audio-only visual state before waiting for microphone
      // permission so Preset 3 displays its blue idle palette immediately.
      setSourceKind("live-audio");
      setSourceName("Live audio");
      if (sourceKind !== "live-audio" || !liveAudioStream) {
        setMessage("Preset selected — starting microphone");
        void handleStartLiveAudio().then((started) => {
          if (!started) {
            setMessage("Preset 3 selected — allow microphone access for live motion");
          }
        });
      }
    } else {
      applySettings(settings);
    }
    if (slot === 2 || slot === 3) {
      setAudioGradientColors(settings.audioGradientColors);
      setAudioGradientStops(settings.audioGradientStops);
      setAudioBackgroundColor(settings.audioBackgroundColor);
      setAudioForegroundColor(settings.audioForegroundColor);
    }
    setActivePresetId(`shared:${preset.id}`);
    setPresetName("");
    setMessage(`${details.effect} selected`);
  };

  applyTopPresetRef.current = handleApplyTopPreset;

  useEffect(() => {
    let midiAccess: MIDIAccess | null = null;
    let disposed = false;
    let midiRetryTimeout: number | null = null;
    let ignoreMidiUntil = performance.now() + 1000;
    const handleMidiMessage = (event: MIDIMessageEvent) => {
      if (!event.data) {
        return;
      }
      if (window.studioShell) {
        window.studioShell.broadcastMidi(Array.from(event.data));
      }
      if (performance.now() < ignoreMidiUntil) {
        return;
      }

      const action = mapGridMidiMessage(event.data);
      if (!action) {
        return;
      }

      if (action.kind === "preset") {
        void applyTopPresetRef.current?.(SHARED_PRESETS[action.presetIndex], action.presetIndex);
        return;
      }

      const presetIndex = action.presetIndex;
      const settingName: "luminosityZSeparation" | "symbolScale" = action.kind === "symbolScale"
        ? "symbolScale"
        : "luminosityZSeparation";
      const settingValue = action.kind === "symbolScale"
        ? scaleMidiValue(action.value, SYMBOL_SCALE_MIN, MIDI_SYMBOL_SCALE_MAX)
        : scaleMidiValue(action.value, 0, 100);
      midiPresetValuesRef.current[presetIndex][settingName] = settingValue;

      const applyLiveValue = () => {
        const latestValue = midiPresetValuesRef.current[presetIndex][settingName] ?? settingValue;
        if (settingName === "symbolScale") {
          setSymbolScale(latestValue);
        } else {
          setLuminosityZSeparation(latestValue);
        }
      };

      if (activeTopPresetIndexRef.current === presetIndex) {
        applyLiveValue();
      }
    };

    const connectInputs = () => {
      if (!midiAccess || disposed) {
        return;
      }
      const inputs = [...midiAccess.inputs.values()];
      inputs.forEach((input) => {
        input.onmidimessage = handleMidiMessage;
        void input.open().then((openedInput) => {
          openedInput.onmidimessage = handleMidiMessage;
        }).catch(() => {
          setMidiStatus("Grid controller could not be opened");
        });
      });
      ignoreMidiUntil = performance.now() + 750;
      const grid = inputs.find((input) => input.name?.toLowerCase().includes("grid"));
      setMidiStatus(grid ? `${grid.name} connected` : inputs.length > 0 ? `${inputs[0].name ?? "MIDI controller"} connected` : "Grid controller not connected");
    };

    if (!window.studioShell && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      const eventSource = new EventSource("http://127.0.0.1:5174/events");
      eventSource.addEventListener("status", () => setMidiStatus("Grid connected through desktop app"));
      eventSource.addEventListener("midi", (event) => {
        try {
          handleMidiMessage(new MessageEvent("midimessage", { data: new Uint8Array(JSON.parse((event as MessageEvent<string>).data)) }) as MIDIMessageEvent);
        } catch {
          setMidiStatus("Grid bridge received an invalid message");
        }
      });
      eventSource.onerror = () => setMidiStatus("Open the desktop app to control Safari");
      return () => eventSource.close();
    }

    if (!navigator.requestMIDIAccess) {
      setMidiStatus("MIDI is unavailable in this browser");
      return;
    }

    const startMidi = () => {
      void navigator.requestMIDIAccess?.({ sysex: false }).then((access) => {
        if (disposed) {
          return;
        }
        midiAccess = access;
        midiAccess.onstatechange = connectInputs;
        connectInputs();
      }).catch(() => {
        if (!disposed) {
          setMidiStatus("Reconnecting Grid controller…");
          midiRetryTimeout = window.setTimeout(startMidi, 1500);
        }
      });
    };
    startMidi();

    return () => {
      disposed = true;
      if (midiRetryTimeout !== null) {
        window.clearTimeout(midiRetryTimeout);
      }
      if (midiAccess) {
        midiAccess.onstatechange = null;
        midiAccess.inputs.forEach((input) => {
          input.onmidimessage = null;
        });
      }
    };
  }, []);

  const handleSavePreset = () => {
    const createdAt = Date.now();
    const name = presetName.trim() || `Preset ${presets.length + 1}`;
    const existingPreset = [...presets]
      .filter((candidate) => candidate.name.trim().toLowerCase() === name.toLowerCase())
      .sort((left, right) => right.createdAt - left.createdAt)[0];
    const preset: ScenePreset = {
      createdAt: existingPreset?.createdAt ?? createdAt,
      id: existingPreset?.id ?? `preset-${createdAt}`,
      name,
      settings: currentSettings,
    };

    setPresets((currentPresets) => existingPreset
      ? currentPresets.map((candidate) => candidate.id === existingPreset.id ? preset : candidate)
      : [...currentPresets, preset]);
    setActivePresetId(preset.id);
    setPresetName("");
    setMessage(`${name} saved`);
  };

  const handleExportPresets = () => {
    const backup = {
      assignments: presetAssignments,
      exportedAt: new Date().toISOString(),
      format: "video-plane-studio-presets",
      presets,
      version: 1,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.download = `video-plane-studio-presets-${new Date().toISOString().slice(0, 10)}.json`;
    link.href = url;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setMessage(`${presets.length} presets exported`);
  };

  const handleImportPresets = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid backup");
      }
      const rawBackup = parsed as { assignments?: unknown; format?: unknown; presets?: unknown };
      const importedPresets = sanitizePresetCollection(rawBackup.presets);
      if (rawBackup.format !== "video-plane-studio-presets" || !Array.isArray(rawBackup.presets) || importedPresets.length !== rawBackup.presets.length || importedPresets.length === 0) {
        throw new Error("Invalid backup");
      }

      const importedIds = new Set(importedPresets.map((preset) => preset.id));
      const rawAssignments = rawBackup.assignments && typeof rawBackup.assignments === "object"
        ? rawBackup.assignments as Record<string, unknown>
        : {};
      const importedAssignments: PresetAssignments = {};
      ([1, 2, 3, 4] as PresetSlot[]).forEach((slot) => {
        const presetId = rawAssignments[String(slot)];
        if (typeof presetId === "string" && importedIds.has(presetId)) {
          importedAssignments[slot] = presetId;
        }
      });

      setPresets(importedPresets);
      setPresetAssignments(importedAssignments);
      setActivePresetId("");
      setPresetName("");
      setMessage(`${importedPresets.length} presets restored from ${file.name}`);
    } catch {
      setMessage("That file is not a valid Video Plane Studio preset backup");
    }
  };

  const handleUpdatePreset = () => {
    const preset = activeSavedPreset;
    if (!preset) {
      handleSavePreset();
      return;
    }

    const name = presetName.trim() || preset.name;
    setPresets((currentPresets) =>
      currentPresets.map((candidate) =>
        candidate.id === preset.id
          ? { ...candidate, name, settings: currentSettings }
          : candidate,
      ),
    );
    setPresetName("");
    setMessage(`${name} updated`);
  };

  const handleDeletePreset = () => {
    const preset = activeSavedPreset;
    if (!preset) {
      return;
    }

    setPresets((currentPresets) => currentPresets.filter((candidate) => candidate.id !== preset.id));
    setActivePresetId("");
    setPresetName("");
    setMessage(`${preset.name} deleted`);
  };

  const handleStartWebcam = async (): Promise<boolean> => {
    if (!videoElement) {
      return false;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("Webcam unavailable");
      return false;
    }

    try {
      restorePresetLiveAudioVariant();
      setAudioLevelScale(1);
      setLiveAudioResponseDelay(DEFAULT_LIVE_AUDIO_RESPONSE_DELAY);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          height: { ideal: 720 },
          width: { ideal: 1280 },
        },
      });

      await loadVideoElement(
        () => {
          if (!videoElement) {
            return;
          }

          streamRef.current = stream;
          videoElement.srcObject = stream;
        },
        "webcam",
        "Webcam",
        true,
      );
      return true;
    } catch {
      setMessage("Camera permission needed");
      return false;
    }
  };

  const handleStartLiveAudio = async (): Promise<boolean> => {
    if (!videoElement) {
      return false;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("Live audio unavailable");
      return false;
    }

    try {
      setAudioLevelScale(1);
      // The clicked preset takes priority while React is still rendering the switch.
      // Otherwise the previous preset's Live Audio colors can leak into the new one.
      const liveAudioPresetIndex = selectedTopPresetIndexRef.current >= 0
        ? selectedTopPresetIndexRef.current
        : activeTopPresetIndexRef.current;
      const useDefault2Variant = liveAudioPresetIndex === 1;
      const useDefault4Variant = liveAudioPresetIndex === 3;
      if (useDefault2Variant || useDefault4Variant) {
        if (!presetLiveAudioRestoreRef.current) {
          presetLiveAudioRestoreRef.current = {
            ...currentSettings,
            audioGradientColors: [...currentSettings.audioGradientColors],
            audioGradientStops: currentSettings.audioGradientStops.map((stop) => ({ ...stop })),
            videoCurvePoints: cloneCurvePoints(currentSettings.videoCurvePoints),
          };
          presetLiveAudioDelayRestoreRef.current = liveAudioResponseDelay;
        }
      }
      if (useDefault2Variant) {
        const gradientStops = DEFAULT_2_LIVE_AUDIO_GRADIENT_STOPS.map((stop) => ({ ...stop }));
        setAudioEffectIntensity(DEFAULT_2_LIVE_AUDIO_EFFECT_INTENSITY);
        setLiveAudioResponseDelay(DEFAULT_2_LIVE_AUDIO_RESPONSE_DELAY);
        setCollisionsEnabled(true);
        setDynamicallyAwareCollision(true);
        setAudioGradientColors(gradientStops.map((stop) => stop.color));
        setAudioGradientStops(gradientStops);
        setAudioBackgroundColor(gradientStops[0].color);
        setAudioForegroundColor(gradientStops[gradientStops.length - 1].color);
      } else if (useDefault4Variant) {
        const gradientStops = DEFAULT_4_LIVE_AUDIO_GRADIENT_STOPS.map((stop) => ({ ...stop }));
        setAudioEffectIntensity(DEFAULT_LIVE_AUDIO_EFFECT_INTENSITY);
        setLiveAudioResponseDelay(DEFAULT_LIVE_AUDIO_RESPONSE_DELAY);
        setGrayscaleVideo(true);
        setVideoGradientEnabled(true);
        setAudioGradientColors(gradientStops.map((stop) => stop.color));
        setAudioGradientStops(gradientStops);
        setAudioBackgroundColor(gradientStops[0].color);
        setAudioForegroundColor(gradientStops[gradientStops.length - 1].color);
      } else {
        presetLiveAudioRestoreRef.current = null;
        setAudioEffectIntensity(DEFAULT_LIVE_AUDIO_EFFECT_INTENSITY);
        setLiveAudioResponseDelay(DEFAULT_LIVE_AUDIO_RESPONSE_DELAY);
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          channelCount: { ideal: 1 },
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: { ideal: 48000 },
        },
        video: false,
      });

      await loadVideoElement(
        () => {
          if (!videoElement) {
            return;
          }

          streamRef.current = stream;
          videoElement.srcObject = stream;
        },
        "live-audio",
        "Live audio",
        true,
      );
      return true;
    } catch {
      setMessage("Audio permission needed");
      return false;
    }
  };

  useEffect(() => {
    if (!pendingPresetSource) {
      return;
    }

    setPendingPresetSource(null);
    if (pendingPresetSource === "webcam") {
      void handleStartWebcam();
    } else if (pendingPresetSource === "live-audio") {
      void handleStartLiveAudio();
    } else {
      void handleStartPresetRunnerVideo();
    }
  }, [pendingPresetSource]);

  const togglePlay = async () => {
    if (!videoElement || sourceKind === "idle") {
      return;
    }

    if (sourceKind === "file" && sourceName.toLowerCase().endsWith(".gif")) {
      setMessage("GIF playback is automatic");
      return;
    }

    if (videoElement.paused) {
      try {
        await videoElement.play();
        setIsPlaying(true);
        setMessage(sourceActiveMessage(sourceKind));
      } catch {
        setMessage("Playback blocked");
      }
      return;
    }

    videoElement.pause();
    setIsPlaying(false);
    setMessage("Paused");
  };

  useEffect(() => {
    if (!videoElement || hasStartedDefaultExperienceRef.current) {
      return;
    }

    const assignedPreset1 = presets.find((candidate) => candidate.id === presetAssignments[1]);
    const savedPreset1 = [...presets]
      .filter((candidate) => candidate.name.trim().toLowerCase() === "latest one")
      .sort((left, right) => right.createdAt - left.createdAt)[0]
      ?? [...presets]
        .filter((candidate) => ["1", "one"].includes(candidate.name.trim().toLowerCase()))
        .sort((left, right) => right.createdAt - left.createdAt)[0];
    const preset1Settings = assignedPreset1?.settings
      ?? savedPreset1?.settings
      ?? readStoredPreset1Override()
      ?? SHARED_PRESETS[0].settings;

    hasStartedDefaultExperienceRef.current = true;
    void handleStartPresetRunnerVideo(false).then(() => {
      applySettings({
        ...preset1Settings,
        audioBackgroundColor: DEFAULT_RED_GRADIENT_STOPS[0].color,
        audioForegroundColor: DEFAULT_RED_GRADIENT_STOPS[DEFAULT_RED_GRADIENT_STOPS.length - 1].color,
        audioGradientColors: DEFAULT_RED_GRADIENT_STOPS.map((stop) => stop.color),
        audioGradientStops: DEFAULT_RED_GRADIENT_STOPS,
        grayscaleVideo: false,
        sourceKind: "file",
        videoGradientEnabled: false,
      }, false);
      setActivePresetId(`shared:${SHARED_PRESETS[0].id}`);
      setPresetName("");
      setMessage("Preset 1 settling");
      openingPlaybackTimeoutRef.current = window.setTimeout(() => {
        openingPlaybackTimeoutRef.current = null;
        void videoElement.play().then(() => {
          setIsPlaying(true);
          setMessage("Sample Video with Preset 1 selected");
        }).catch(() => {
          setIsPlaying(false);
          setMessage("Press play to start the sample video");
        });
      }, OPENING_PRESET_SETTLE_MS);
    });
  }, [presetAssignments, presets, videoElement]);

  return (
    <main className="studio-app" data-sidebar-visible={sidebarVisible}>
      <ThreeViewport
        audioBackgroundColor={audioBackgroundColor}
        audioEffectIntensity={audioEffectIntensity / 100}
        environmentIntensity={environmentIntensity / 100}
        environmentRotationX={environmentRotationX}
        environmentRotation={environmentRotation}
        environmentRotationZ={environmentRotationZ}
        fillLightColor={fillLightColor}
        fillLightIntensity={fillLightIntensity / 100}
        audioForegroundColor={audioForegroundColor}
        audioGradientColors={audioGradientColors}
        audioGradientStops={audioGradientStops}
        collisionsEnabled={collisionsEnabled}
        dynamicallyAwareCollision={dynamicallyAwareCollision}
        dynamicCollisionResponse={dynamicCollisionResponse / 100}
        hdriMapUrl={hdriMapUrl}
        showHdriBackground={showHdriBackground}
        audioLevelScale={audioLevelScale}
        audioMuted={isMuted}
        liveAudioPaused={sourceKind === "live-audio" && !isPlaying}
        liveAudioStream={liveAudioStream}
        liveAudioResponseDelay={liveAudioResponseDelay / 100}
        dotColumns={dotColumns}
        dotRows={dotRows}
        effectVisible={effectVisible}
        flatSymbols={flatSymbols}
        floorVisible={floorVisible}
        grayscaleVideo={grayscaleVideo}
        luminositySizing={luminositySizing}
        luminosityZSeparation={luminosityZSeparation / 100}
        randomPositionX={randomPositionX / 100}
        randomPositionY={randomPositionY / 100}
        randomPositionZ={randomPositionZ / 100}
        randomRotationX={randomRotationX}
        randomRotationY={randomRotationY}
        randomRotationZ={randomRotationZ}
        randomScale={randomScale / 100}
        mirrorVideo={sourceKind === "webcam"}
        onSymbolStatus={setSymbolStatus}
        resetSignal={resetSignal}
        screenVisible={screenVisible}
        symbolSpacing={symbolSpacing / 100}
        symbolModelSource={symbolModelSource}
        symbolPrimitive={symbolPrimitive}
        symbolScale={(symbolScale / 100) * SYMBOL_SCALE_RENDER_FACTOR}
        symbolRevision={symbolRevision}
        videoCurvePoints={videoCurvePoints}
        videoElement={videoElement}
        imageElement={imageElement}
        videoFrameVisible={sourceKind !== "audio" && sourceKind !== "live-audio"}
        videoGradientEnabled={videoGradientEnabled}
        webcamColorCorrection={sourceKind === "webcam"}
        minimumVideoZoom={sourceKind === "file" && sourceName === "Runner demo" ? 1.15 : 1}
        videoVerticalCropPosition={sourceKind === "file" && sourceName === "Runner demo" ? 1 : 0.5}
        videoZoom={videoZoom / 100}
        videoRevision={videoRevision}
      />

      <button
        aria-label={sidebarVisible ? "Hide controls" : "Show controls"}
        className="sidebar-toggle-button"
        onClick={toggleSidebar}
        title={sidebarVisible ? "Hide controls" : "Show controls"}
        type="button"
      >
        {sidebarVisible ? <PanelRightClose aria-hidden="true" size={17} /> : <PanelRightOpen aria-hidden="true" size={17} />}
      </button>

      <div className="top-control-bar">
        <section
          className="top-control-group"
          aria-label="Shared presets"
          data-active={activePresetId.startsWith("shared:")}
        >
          <span className="top-control-label">PRESET</span>
          <div className="top-preset-bar">
            {sharedPresets.map((preset, index) => {
              const slot = (index + 1) as PresetSlot;
              const assignedPreset = presets.find((candidate) => candidate.id === presetAssignments[slot]);
              const presetTitle = assignedPreset?.name ?? preset.name;
              return (
              <span className="top-preset-item" data-hint-visible={presetHintSlot === index + 1} key={`${preset.id}-${index}`}>
                <button
                  aria-describedby={`top-preset-hint-${index + 1}`}
                  aria-label={`Apply ${presetTitle}`}
                  aria-pressed={activePresetId === `shared:${preset.id}`}
                  className="top-preset-button"
                  onClick={() => void handleApplyTopPreset(preset, index)}
                  title={presetTitle}
                  type="button"
                >
                  {index + 1}
                </button>
                <span className="top-preset-hint" id={`top-preset-hint-${index + 1}`} role="tooltip">
                  <strong>{presetTitle}</strong>
                  {!assignedPreset ? <span>{TOP_PRESET_DETAILS[index].source}</span> : null}
                </span>
              </span>
              );
            })}
          </div>
        </section>

        <section
          className="top-control-group"
          aria-label="Sources"
          data-active={sourceKind !== "idle"}
        >
          <span className="top-control-label">SOURCE</span>
          <div className="top-control-actions">
            <button
              aria-pressed={sourceKind === "file" && sourceName === "Runner demo"}
              className="top-source-button"
              data-drop-active={isSampleVideoDropTarget}
              onDragEnter={(event: DragEvent<HTMLButtonElement>) => {
                event.preventDefault();
                event.stopPropagation();
                setIsSampleVideoDropTarget(true);
              }}
              onDragLeave={(event: DragEvent<HTMLButtonElement>) => {
                const nextTarget = event.relatedTarget;
                if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                  setIsSampleVideoDropTarget(false);
                }
              }}
              onDragOver={(event: DragEvent<HTMLButtonElement>) => {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "copy";
                setIsSampleVideoDropTarget(true);
              }}
              onDrop={(event: DragEvent<HTMLButtonElement>) => {
                event.preventDefault();
                event.stopPropagation();
                setIsSampleVideoDropTarget(false);
                const file = event.dataTransfer.files[0];
                if (file) {
                  void importVideoFile(file);
                }
              }}
              onClick={() => void handleStartPresetRunnerVideo()}
              title="Use the built-in sample video or drop an MP4, MOV, WebM, or GIF"
              type="button"
            >
              <Play aria-hidden="true" size={15} />
              <span>Sample Video</span>
            </button>
            <button
              aria-pressed={sourceKind === "webcam"}
              className="top-source-button"
              onClick={() => void handleStartWebcam()}
              title="Use your webcam"
              type="button"
            >
              <Video aria-hidden="true" size={15} />
              <span>Webcam</span>
            </button>
            <button
              aria-pressed={sourceKind === "live-audio"}
              className="top-source-button"
              onClick={() => void handleStartLiveAudio()}
              title="Use live microphone audio"
              type="button"
            >
              <Mic aria-hidden="true" size={15} />
              <span>Live Audio</span>
            </button>
          </div>
        </section>
      </div>

      <video
        ref={setVideoElement}
        className="hidden-video-source"
        loop
        muted={sourceKind === "webcam" || sourceKind === "live-audio"}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        playsInline
      />

      <canvas
        ref={setImageElement}
        className="hidden-video-source"
      />

      <input
        ref={fileInputRef}
        accept="video/*,image/gif,.gif"
        className="file-input"
        onChange={handleImportVideo}
        type="file"
      />

      <input
        ref={audioInputRef}
        accept="audio/*"
        className="file-input"
        onChange={handleImportAudio}
        type="file"
      />

      <input
        ref={modelInputRef}
        accept=".obj,.stl"
        className="file-input"
        onChange={handleImportModel}
        type="file"
      />

      <input
        ref={presetBackupInputRef}
        accept="application/json,.json"
        className="file-input"
        onChange={(event) => void handleImportPresets(event)}
        type="file"
      />

      <input
        ref={hdriInputRef}
        accept=".hdr,.jpg,.jpeg,.png,image/vnd.radiance,image/jpeg,image/png"
        className="file-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            setHdriMapUrl(URL.createObjectURL(file));
          }
        }}
        type="file"
      />

      {sidebarVisible ? <section className="control-dock" aria-label="Video controls">
        <header className="dock-header">
          <div className="dock-title-group">
            <h1><span>Video</span><span>Plane</span><span>Studio</span></h1>
          </div>
        </header>

        {SHOW_SCENE_VISIBILITY_CONTROLS ? <div className="toggle-group" aria-label="Scene visibility">
          <label className="visibility-toggle" title={screenVisible ? "Hide video plane" : "Show video plane"}>
            <span className="toggle-label">{screenVisible ? <Eye aria-hidden="true" size={16} /> : <EyeOff aria-hidden="true" size={16} />}</span>
            <span className="visibility-label">Video plane</span>
            <input
              checked={screenVisible}
              onChange={(event) => {
                markCustomSettings();
                setScreenVisible(event.target.checked);
              }}
              type="checkbox"
            />
            <span className="toggle-shell">
              <span className="toggle-thumb" />
            </span>
          </label>
          <label className="visibility-toggle" title={effectVisible ? "Hide effect" : "Show effect"}>
            <span className="toggle-label">
              <Square aria-hidden="true" size={15} />
            </span>
            <span className="visibility-label">Effect</span>
            <input
              checked={effectVisible}
              onChange={(event) => {
                markCustomSettings();
                setEffectVisible(event.target.checked);
              }}
              type="checkbox"
            />
            <span className="toggle-shell">
              <span className="toggle-thumb" />
            </span>
          </label>
          <label className="visibility-toggle" title={floorVisible ? "Hide floor plane" : "Show floor plane"}>
            <span className="toggle-label">
              <Layers aria-hidden="true" size={16} />
            </span>
            <span className="visibility-label">Floor</span>
            <input
              checked={floorVisible}
              onChange={(event) => {
                markCustomSettings();
                setFloorVisible(event.target.checked);
              }}
              type="checkbox"
            />
            <span className="toggle-shell">
              <span className="toggle-thumb" />
            </span>
          </label>
        </div> : null}

        <CollapsibleControlSection
          ariaLabel="Dot grid resolution"
          collapsed={collapsedPanels["dot-grid"]}
          id="dot-grid"
          onToggle={toggleControlPanel}
          title="Dot Grid"
        >
          <label className="slider-field">
            <span>Columns</span>
            <span className="slider-input-row">
              <input
                aria-label="Columns"
                max={DOT_COLUMNS_MAX}
                min={DOT_COLUMNS_MIN}
                onChange={(event) => {
                  markCustomSettings();
                  setDotColumns(Number(event.target.value));
                }}
                step="1"
                style={{ "--range-progress": `${((dotColumns - DOT_COLUMNS_MIN) / (DOT_COLUMNS_MAX - DOT_COLUMNS_MIN)) * 100}%` } as CSSProperties}
                type="range"
                value={dotColumns}
              />
              <input
                aria-label="Columns value"
                className="number-field"
                max={DOT_COLUMNS_MAX}
                min={DOT_COLUMNS_MIN}
                onChange={(event) => {
                  markCustomSettings();
                  setDotColumns(clampNumber(Number(event.target.value), DOT_COLUMNS_MIN, DOT_COLUMNS_MAX, DEFAULT_SCENE_SETTINGS.dotColumns));
                }}
                type="number"
                value={dotColumns}
              />
            </span>
          </label>
          <label className="slider-field">
            <span>Rows</span>
            <span className="slider-input-row">
              <input
                aria-label="Rows"
                max={DOT_ROWS_MAX}
                min={DOT_ROWS_MIN}
                onChange={(event) => {
                  markCustomSettings();
                  setDotRows(Number(event.target.value));
                }}
                step="1"
                style={{ "--range-progress": `${((dotRows - DOT_ROWS_MIN) / (DOT_ROWS_MAX - DOT_ROWS_MIN)) * 100}%` } as CSSProperties}
                type="range"
                value={dotRows}
              />
              <input
                aria-label="Rows value"
                className="number-field"
                max={DOT_ROWS_MAX}
                min={DOT_ROWS_MIN}
                onChange={(event) => {
                  markCustomSettings();
                  setDotRows(clampNumber(Number(event.target.value), DOT_ROWS_MIN, DOT_ROWS_MAX, DEFAULT_SCENE_SETTINGS.dotRows));
                }}
                type="number"
                value={dotRows}
              />
            </span>
          </label>
          <SliderField
            ariaLabel="Uniform symbol size"
            label={`Symbol size ${symbolScale / SYMBOL_SCALE_DISPLAY_DIVISOR}%`}
            max={SYMBOL_SCALE_MAX / SYMBOL_SCALE_DISPLAY_DIVISOR}
            min={SYMBOL_SCALE_MIN / SYMBOL_SCALE_DISPLAY_DIVISOR}
            onValueChange={(value) => {
              markCustomSettings();
              setSymbolScale(value * SYMBOL_SCALE_DISPLAY_DIVISOR);
            }}
            value={symbolScale / SYMBOL_SCALE_DISPLAY_DIVISOR}
          />
          <SliderField ariaLabel="Symbol spacing" label={`Spacing ${symbolSpacing}%`} max={SYMBOL_SPACING_MAX} min={SYMBOL_SPACING_MIN} onValueChange={(value) => { markCustomSettings(); setSymbolSpacing(value); }} step={5} value={symbolSpacing} />
        </CollapsibleControlSection>

        <CollapsibleControlSection
          ariaLabel="Collision effector"
          collapsed={collapsedPanels["collision-effector"]}
          id="collision-effector"
          onToggle={toggleControlPanel}
          title="Collision Effector"
        >
          <label className="switch-field">
            <span className="switch-label">Enable collisions</span>
            <input
              aria-label="Enable instance collisions"
              checked={collisionsEnabled}
              onChange={(event) => {
                markCustomSettings();
                setCollisionsEnabled(event.target.checked);
              }}
              type="checkbox"
            />
            <span className="toggle-shell">
              <span className="toggle-thumb" />
            </span>
          </label>
          <label className="switch-field">
            <span className="switch-label">Dynamically aware collision</span>
            <input
              aria-label="Enable dynamically aware collision"
              checked={dynamicallyAwareCollision}
              disabled={!collisionsEnabled}
              onChange={(event) => {
                markCustomSettings();
                setDynamicallyAwareCollision(event.target.checked);
              }}
              type="checkbox"
            />
            <span className="toggle-shell">
              <span className="toggle-thumb" />
            </span>
          </label>
          <SliderField ariaLabel="Dynamic collision response" disabled={!collisionsEnabled || !dynamicallyAwareCollision} label={`Dynamic response ${dynamicCollisionResponse}%`} max={300} min={0} onValueChange={(value) => { markCustomSettings(); setDynamicCollisionResponse(value); }} value={dynamicCollisionResponse} />
        </CollapsibleControlSection>

        <CollapsibleControlSection
          ariaLabel="Random effector"
          collapsed={collapsedPanels["random-effector"]}
          id="random-effector"
          onToggle={toggleControlPanel}
          title="Random Effector"
        >
          <SliderField ariaLabel="Random position X" label={`Position X ${randomPositionX}%`} max={500} min={0} onValueChange={(value) => { markCustomSettings(); setRandomPositionX(value); }} value={randomPositionX} />
          <SliderField ariaLabel="Random position Y" label={`Position Y ${randomPositionY}%`} max={500} min={0} onValueChange={(value) => { markCustomSettings(); setRandomPositionY(value); }} value={randomPositionY} />
          <SliderField ariaLabel="Random position Z" label={`Position Z ${randomPositionZ}%`} max={500} min={0} onValueChange={(value) => { markCustomSettings(); setRandomPositionZ(value); }} value={randomPositionZ} />
          <SliderField ariaLabel="Random rotation X" label={`Rotation X ${randomRotationX}°`} max={360} min={0} onValueChange={(value) => { markCustomSettings(); setRandomRotationX(value); }} value={randomRotationX} />
          <SliderField ariaLabel="Random rotation Y" label={`Rotation Y ${randomRotationY}°`} max={360} min={0} onValueChange={(value) => { markCustomSettings(); setRandomRotationY(value); }} value={randomRotationY} />
          <SliderField ariaLabel="Random rotation Z" label={`Rotation Z ${randomRotationZ}°`} max={360} min={0} onValueChange={(value) => { markCustomSettings(); setRandomRotationZ(value); }} value={randomRotationZ} />
          <SliderField ariaLabel="Uniform random scale" label={`Uniform scale ${randomScale}%`} max={500} min={0} onValueChange={(value) => { markCustomSettings(); setRandomScale(value); }} value={randomScale} />
        </CollapsibleControlSection>

        <CollapsibleControlSection
          ariaLabel="Audio response"
          collapsed={collapsedPanels["audio-response"]}
          id="audio-response"
          onToggle={toggleControlPanel}
          title="Audio Response"
        >
          <SliderField ariaLabel="Audio effect intensity" label={`Intensity ${audioEffectIntensity}%`} max={100} min={0} onValueChange={(value) => { markCustomSettings(); setAudioEffectIntensity(value); }} value={audioEffectIntensity} />
          <SliderField
            ariaLabel="Live audio response delay"
            disabled={sourceKind !== "live-audio"}
            label={`Response delay ${liveAudioResponseDelay}%`}
            max={100}
            min={0}
            onValueChange={setLiveAudioResponseDelay}
            value={liveAudioResponseDelay}
          />
        </CollapsibleControlSection>

        <CollapsibleControlSection
          ariaLabel="Contrast adjustment"
          collapsed={collapsedPanels.contrast}
          id="contrast"
          onToggle={toggleControlPanel}
          title="Contrast"
        >
          <CurvesEditor
            onPointsChange={(points) => {
              markCustomSettings();
              setVideoCurvePoints(points);
            }}
            onPresetChange={(preset) => {
              markCustomSettings();
              setVideoCurvePreset(preset);
            }}
            points={videoCurvePoints}
            preset={videoCurvePreset}
          />
        </CollapsibleControlSection>

        <CollapsibleControlSection
          ariaLabel="Video colors"
          collapsed={collapsedPanels["video-effects"]}
          id="video-effects"
          onToggle={toggleControlPanel}
          title="Video Colors"
        >
          <label className="switch-field">
            <span className="switch-label">Grayscale</span>
            <input
              aria-label="Grayscale video"
              checked={grayscaleVideo}
              onChange={(event) => {
                markCustomSettings();
                setGrayscaleVideo(event.target.checked);
              }}
              type="checkbox"
            />
            <span className="toggle-shell">
              <span className="toggle-thumb" />
            </span>
          </label>
          <label className="switch-field">
            <span className="switch-label">Gradient video</span>
            <input
              aria-label="Gradient video colors"
              checked={videoGradientEnabled}
              onChange={(event) => {
                markCustomSettings();
                setVideoGradientEnabled(event.target.checked);
              }}
              type="checkbox"
            />
            <span className="toggle-shell">
              <span className="toggle-thumb" />
            </span>
          </label>
          <div className="gradient-editor" aria-label="Audio gradient colors">
            <div
                className="gradient-preview"
                onDoubleClick={(event) => {
                  const target = (event.target as HTMLElement).closest("[data-gradient-stop-index]");
                  if (target) {
                    openGradientStopPicker(Number((target as HTMLElement).dataset.gradientStopIndex), target as HTMLElement);
                    return;
                  }

                  addGradientStopAtOffset(offsetFromGradientClientX(event.currentTarget, event.clientX));
                }}
                onPointerCancel={stopGradientDrag}
                onPointerDown={startGradientDrag}
                onPointerMove={dragGradientStop}
                onPointerUp={stopGradientDrag}
                style={{ "--gradient": buildGradientCss(audioGradientStops) } as CSSProperties}
            >
              <div className="gradient-track" />
              {audioGradientStops.map((stop, index) => (
                <button
                  aria-label={`${stop.color} gradient stop`}
                  aria-keyshortcuts="Delete"
                  className="gradient-handle"
                  data-gradient-stop-index={index}
                  data-selected={selectedGradientStopIndex === index}
                  key={`${stop.color}-${index}`}
                  style={{ "--color": stop.color, "--stop": `${stop.offset}%` } as CSSProperties}
                  type="button"
                />
              ))}
            </div>
          </div>
        </CollapsibleControlSection>

        <CollapsibleControlSection
          ariaLabel="Instanced symbol"
          collapsed={collapsedPanels.symbol}
          id="symbol"
          onToggle={toggleControlPanel}
          title="Symbol"
        >
          <SliderField ariaLabel="Luminosity Z separation" label={`Z separation ${luminosityZSeparation}%`} max={100} min={0} onValueChange={(value) => { markCustomSettings(); setLuminosityZSeparation(value); }} value={luminosityZSeparation} />
          <label className="switch-field">
            <span className="switch-label">Luminosity size</span>
            <input
              aria-label="Luminosity sizing"
              checked={luminositySizing}
              onChange={(event) => {
                markCustomSettings();
                setLuminositySizing(event.target.checked);
              }}
              type="checkbox"
            />
            <span className="toggle-shell">
              <span className="toggle-thumb" />
            </span>
          </label>
          <label className="switch-field">
            <span className="switch-label">Flat shape</span>
            <input
              aria-label="Flat shape"
              checked={flatSymbols}
              onChange={(event) => {
                markCustomSettings();
                setFlatSymbols(event.target.checked);
              }}
              type="checkbox"
            />
            <span className="toggle-shell">
              <span className="toggle-thumb" />
            </span>
          </label>
          <div className="symbol-command-grid">
            <button className="command-button" onClick={() => modelInputRef.current?.click()} type="button">
              <FileUp aria-hidden="true" size={17} />
              <span>Model</span>
            </button>
            <button
              aria-pressed={symbolPrimitive === "sphere" && symbolModelSource === null}
              className="command-button"
              onClick={() => handleUsePrimitiveSymbol("sphere")}
              type="button"
            >
              <Circle aria-hidden="true" size={17} />
              <span>Sphere</span>
            </button>
            <button
              aria-pressed={symbolPrimitive === "square" && symbolModelSource === null}
              className="command-button"
              onClick={() => handleUsePrimitiveSymbol("square")}
              type="button"
            >
              <Box aria-hidden="true" size={17} />
              <span>Cube</span>
            </button>
          </div>
        </CollapsibleControlSection>

        <CollapsibleControlSection
          ariaLabel="Environment and lighting"
          collapsed={collapsedPanels["environment-lighting"]}
          id="environment-lighting"
          onToggle={toggleControlPanel}
          title="Environment & Lighting"
        >
          <div className="button-row">
            <button className="secondary-button" onClick={() => hdriInputRef.current?.click()} type="button">
              <FileUp aria-hidden="true" size={15} />
              {hdriMapUrl ? "Replace HDRI" : "Upload HDRI"}
            </button>
            {hdriMapUrl ? <button className="secondary-button" onClick={() => setHdriMapUrl(null)} type="button">Studio HDRI</button> : null}
          </div>
          <label className="switch-field">
            <span className="switch-label">Show HDRI background</span>
            <input aria-label="Show HDRI background" checked={showHdriBackground} onChange={(event) => setShowHdriBackground(event.target.checked)} type="checkbox" />
            <span className="toggle-shell"><span className="toggle-thumb" /></span>
          </label>
          <SliderField ariaLabel="HDRI intensity" label={`HDRI intensity ${environmentIntensity}%`} max={300} min={0} onValueChange={setEnvironmentIntensity} value={environmentIntensity} />
          <SliderField ariaLabel="HDRI rotation X" label={`HDRI rotation X ${environmentRotationX}°`} max={360} min={0} onValueChange={setEnvironmentRotationX} value={environmentRotationX} />
          <SliderField ariaLabel="HDRI rotation Y" label={`HDRI rotation Y ${environmentRotation}°`} max={360} min={0} onValueChange={setEnvironmentRotation} value={environmentRotation} />
          <SliderField ariaLabel="HDRI rotation Z" label={`HDRI rotation Z ${environmentRotationZ}°`} max={360} min={0} onValueChange={setEnvironmentRotationZ} value={environmentRotationZ} />
          <label className="light-color-field">
            <span>Fill light color</span>
            <input aria-label="Fill light color" onChange={(event) => setFillLightColor(event.target.value)} type="color" value={fillLightColor} />
          </label>
          <SliderField ariaLabel="Fill light intensity" label={`Fill light intensity ${fillLightIntensity}%`} max={300} min={0} onValueChange={setFillLightIntensity} value={fillLightIntensity} />
        </CollapsibleControlSection>

        <CollapsibleControlSection
          ariaLabel="Presets"
          collapsed={collapsedPanels.presets}
          id="presets"
          onToggle={toggleControlPanel}
          title="Presets"
        >
          <div className="preset-group">
            <span className="preset-group-label">Recently saved</span>
          </div>
          <PresetDropdown
            onChange={handleApplyPreset}
            options={presetOptions}
            value={activePresetId}
          />
          <div className="preset-assignment-row" aria-label="Assign selected preset to viewer button">
            <span>Assign to</span>
            {([1, 2, 3, 4] as PresetSlot[]).map((slot) => (
              <button
                aria-label={`Assign selected preset to Preset ${slot}`}
                aria-pressed={presetAssignments[slot] === activeSavedPreset?.id}
                className="preset-assignment-button"
                disabled={!activeSavedPreset}
                key={slot}
                onClick={() => handleAssignPresetSlot(slot)}
                type="button"
              >
                {slot}
              </button>
            ))}
          </div>
          <input
            aria-label="Preset name"
            className="preset-name-input"
            onChange={(event) => setPresetName(event.target.value)}
            placeholder={activeSavedPreset ? "Rename or update" : "Preset name"}
            type="text"
            value={presetName}
          />
          <div className="preset-command-grid">
            <button className="command-button" onClick={handleSavePreset} type="button">
              <Save aria-hidden="true" size={16} />
              <span>Save</span>
            </button>
            <button className="command-button" disabled={!activeSavedPreset} onClick={handleUpdatePreset} type="button">
              <Save aria-hidden="true" size={16} />
              <span>Update</span>
            </button>
            <button
              aria-label="Delete preset"
              className="round-button preset-delete-button"
              disabled={!activeSavedPreset}
              onClick={handleDeletePreset}
              title="Delete preset"
              type="button"
            >
              <Trash2 aria-hidden="true" size={16} />
            </button>
          </div>
          <div className="preset-transfer-grid">
            <button className="command-button" onClick={handleExportPresets} type="button">
              <Download aria-hidden="true" size={16} />
              <span>Export JSON</span>
            </button>
            <button className="command-button" onClick={() => presetBackupInputRef.current?.click()} type="button">
              <Upload aria-hidden="true" size={16} />
              <span>Import JSON</span>
            </button>
          </div>
        </CollapsibleControlSection>

        <div className="transport-row">
          <button
            aria-label={isPlaying ? "Pause" : "Play"}
            className="round-button"
            disabled={sourceKind === "idle"}
            onClick={togglePlay}
            title={isPlaying ? "Pause" : "Play"}
            type="button"
          >
            {isPlaying ? <Pause aria-hidden="true" size={17} /> : <Play aria-hidden="true" size={17} />}
          </button>
          <button
            aria-label="Reset effect"
            className="round-button"
            onClick={handleResetEffect}
            title="Reset effect"
            type="button"
          >
            <RotateCcw aria-hidden="true" size={17} />
          </button>
        </div>
      </section> : null}
      {colorPickerState ? (
        <div
          className="floating-color-picker"
          style={
            {
              "--picker-x": `${colorPickerState.x}px`,
              "--picker-y": `${colorPickerState.y}px`,
            } as CSSProperties
          }
        >
          <GradientColorPicker
            canDelete={audioGradientStops.length > 2}
            color={audioGradientStops[colorPickerState.stopIndex]?.color ?? DEFAULT_SCENE_SETTINGS.audioForegroundColor}
            onClose={() => setColorPickerState(null)}
            onChange={(color) => updateGradientStop(colorPickerState.stopIndex, { color })}
            onDelete={() => {
              removeGradientStop(colorPickerState.stopIndex);
              setColorPickerState(null);
            }}
          />
        </div>
      ) : null}
    </main>
  );
}

export default App;
