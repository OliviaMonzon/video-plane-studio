import { useEffect, useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type SymbolModelSource =
  | { format: "obj"; source: string }
  | { format: "stl"; source: ArrayBuffer };

export type SymbolPrimitive = "sphere" | "square";

export type VideoCurvePoint = {
  anchor: { x: number; y: number };
  handleIn: { x: number; y: number };
  handleOut: { x: number; y: number };
  mode: "corner" | "smooth";
};

export type GradientStop = {
  color: string;
  offset: number;
};

type ThreeViewportProps = {
  audioBackgroundColor: string;
  audioEffectIntensity: number;
  environmentIntensity: number;
  environmentRotationX: number;
  environmentRotation: number;
  environmentRotationZ: number;
  fillLightColor: string;
  fillLightIntensity: number;
  audioForegroundColor: string;
  audioGradientColors: string[];
  audioGradientStops: GradientStop[];
  collisionsEnabled: boolean;
  dynamicallyAwareCollision: boolean;
  dynamicCollisionResponse: number;
  hdriMapUrl: string | null;
  showHdriBackground: boolean;
  audioLevelScale: number;
  audioMuted: boolean;
  liveAudioPaused: boolean;
  liveAudioStream: MediaStream | null;
  liveAudioResponseDelay: number;
  dotColumns: number;
  dotRows: number;
  effectVisible: boolean;
  flatSymbols: boolean;
  floorVisible: boolean;
  grayscaleVideo: boolean;
  luminositySizing: boolean;
  luminosityZSeparation: number;
  mirrorVideo: boolean;
  minimumVideoZoom: number;
  randomPositionX: number;
  randomPositionY: number;
  randomPositionZ: number;
  randomRotationX: number;
  randomRotationY: number;
  randomRotationZ: number;
  randomScale: number;
  videoVerticalCropPosition: number;
  onSymbolStatus?: (status: string) => void;
  resetSignal: number;
  screenVisible: boolean;
  symbolModelSource: SymbolModelSource | null;
  symbolPrimitive: SymbolPrimitive;
  symbolScale: number;
  symbolRevision: number;
  symbolSpacing: number;
  videoCurvePoints: VideoCurvePoint[];
  videoElement: HTMLVideoElement | null;
  imageElement: HTMLCanvasElement | null;
  videoFrameVisible: boolean;
  videoGradientEnabled: boolean;
  webcamColorCorrection: boolean;
  videoZoom: number;
  videoRevision: number;
};

const CAMERA_HOME = new THREE.Vector3(0, 1.48, 3.65);

const stableRandom = (index: number, channel: number) => {
  const value = Math.sin((index + 1) * 12.9898 + (channel + 1) * 78.233) * 43758.5453;
  return value - Math.floor(value);
};
const CAMERA_TARGET = new THREE.Vector3(0, 1.48, -1.15);
const SCREEN_WIDTH = 4.8;
const SCREEN_HEIGHT = 2.7;
const SCREEN_Z = -1.15;
const SCREEN_CENTER_Y = 1.48;
const LUMINOSITY_Z_RANGE = 2.1;
const PROCESSED_VIDEO_WIDTH = 1280;
const PROCESSED_VIDEO_HEIGHT = 720;
const DOT_MOTION_SMOOTHING_MS = 240;
const DOT_MOTION_DEADBAND = 0.008;
const DOT_SAMPLE_MIN_MS = 33;
const LIVE_AUDIO_SAMPLE_MIN_MS = 16;
const LOOP_CROSSFADE_MS = 260;
const COLLISION_STARTUP_HOLD_MS = 250;
const COLLISION_STARTUP_RAMP_MS = 750;
const AUDIO_BAND_COUNT = 24;
const AUDIO_MOTION_ATTACK = 0.22;
const AUDIO_MOTION_RELEASE = 0.085;
const AUDIO_PITCH_FLOOR_HZ = 90;
const AUDIO_PITCH_CEILING_HZ = 1200;
const CURVE_LOOKUP_SIZE = 1024;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const softLimit = (value: number) => 1 - Math.exp(-Math.max(0, value));
const DEFAULT_VIDEO_CURVE_POINTS: VideoCurvePoint[] = [
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

const cubicAt = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const inverseT = 1 - t;
  return (inverseT ** 3) * p0 + 3 * (inverseT ** 2) * t * p1 + 3 * inverseT * (t ** 2) * p2 + (t ** 3) * p3;
};

const solveCurveSample = (points: VideoCurvePoint[], value: number) => {
  const curvePoints = points.length >= 2 ? points : DEFAULT_VIDEO_CURVE_POINTS;
  const inputX = clamp01(value) * 100;
  const sortedPoints = [...curvePoints].sort((first, second) => first.anchor.x - second.anchor.x);
  const nextIndex = sortedPoints.findIndex((point) => point.anchor.x >= inputX);

  if (nextIndex <= 0) {
    return clamp01(1 - sortedPoints[0].anchor.y / 100);
  }

  if (nextIndex === -1) {
    return clamp01(1 - sortedPoints[sortedPoints.length - 1].anchor.y / 100);
  }

  const previousPoint = sortedPoints[nextIndex - 1];
  const nextPoint = sortedPoints[nextIndex];
  let low = 0;
  let high = 1;

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const mid = (low + high) / 2;
    const x = cubicAt(previousPoint.anchor.x, previousPoint.handleOut.x, nextPoint.handleIn.x, nextPoint.anchor.x, mid);

    if (x < inputX) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const t = (low + high) / 2;
  const y = cubicAt(previousPoint.anchor.y, previousPoint.handleOut.y, nextPoint.handleIn.y, nextPoint.anchor.y, t);
  return clamp01(1 - y / 100);
};

const buildCurveLookup = (points: VideoCurvePoint[]) => {
  const lookup = new Float32Array(CURVE_LOOKUP_SIZE);

  for (let index = 0; index < lookup.length; index += 1) {
    lookup[index] = solveCurveSample(points, index / (lookup.length - 1));
  }

  return lookup;
};

const sampleCurveLookup = (lookup: Float32Array, value: number) => {
  const position = clamp01(value) * (lookup.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(lookup.length - 1, lowerIndex + 1);
  const mix = position - lowerIndex;

  return lookup[lowerIndex] + (lookup[upperIndex] - lookup[lowerIndex]) * mix;
};

const audioReactionMix = (value: number, curveLookup: Float32Array) => {
  const lifted = Math.pow(clamp01((value - 0.04) / 0.52), 0.86);
  return sampleCurveLookup(curveLookup, lifted);
};

const applyColorEffects = (color: THREE.Color, curveLookup: Float32Array, grayscale: boolean) => {
  let red = color.r;
  let green = color.g;
  let blue = color.b;

  if (grayscale) {
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const adjusted = sampleCurveLookup(curveLookup, luminance);
    color.setRGB(adjusted, adjusted, adjusted);
    return;
  }

  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const adjustedLuminance = sampleCurveLookup(curveLookup, luminance);
  const luminanceScale = adjustedLuminance / Math.max(0.001, luminance);
  red = clamp01(red * luminanceScale);
  green = clamp01(green * luminanceScale);
  blue = clamp01(blue * luminanceScale);
  color.setRGB(red, green, blue);
};

const colorToRgb = (color: THREE.Color, alpha = 1) =>
  `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${alpha})`;

const sampleGradientColor = (stops: Array<{ color: THREE.Color; offset: number }>, amount: number, target: THREE.Color) => {
  const orderedStops = [...stops].sort((first, second) => first.offset - second.offset);

  if (orderedStops.length === 0) {
    target.set("#ffffff");
    return target;
  }

  if (orderedStops.length === 1) {
    target.copy(orderedStops[0].color);
    return target;
  }

  const position = clamp01(amount) * 100;
  const nextIndex = orderedStops.findIndex((stop) => stop.offset >= position);

  if (nextIndex <= 0) {
    target.copy(orderedStops[0].color);
    return target;
  }

  if (nextIndex === -1) {
    target.copy(orderedStops[orderedStops.length - 1].color);
    return target;
  }

  const previousStop = orderedStops[nextIndex - 1];
  const nextStop = orderedStops[nextIndex];
  const range = Math.max(0.001, nextStop.offset - previousStop.offset);
  const mix = (position - previousStop.offset) / range;
  target.copy(previousStop.color).lerp(nextStop.color, mix);
  return target;
};

const drawAudioGuideFrame = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  gradientColors: string[],
  curveLookup: Float32Array,
  grayscale: boolean,
) => {
  const validColors = gradientColors.length >= 2 ? gradientColors : ["#ffffff", "#050505"];
  const background = new THREE.Color(validColors[0]);
  const foreground = new THREE.Color(validColors[validColors.length - 1]);
  applyColorEffects(background, curveLookup, grayscale);
  applyColorEffects(foreground, curveLookup, grayscale);

  const guideGradient = context.createLinearGradient(0, 0, width, height);
  validColors.forEach((color, index) => {
    const stopColor = new THREE.Color(color);
    applyColorEffects(stopColor, curveLookup, grayscale);
    stopColor.multiplyScalar(0.28);
    guideGradient.addColorStop(validColors.length === 1 ? 0 : index / (validColors.length - 1), colorToRgb(stopColor, 1));
  });
  const gridColor = background.clone().lerp(foreground, 0.32);
  const markColor = foreground.clone().lerp(new THREE.Color("#ffffff"), 0.18);

  context.fillStyle = guideGradient;
  context.fillRect(0, 0, width, height);

  context.save();
  context.lineWidth = Math.max(1, width / 900);
  context.strokeStyle = colorToRgb(gridColor, 0.38);
  const columns = 16;
  const rows = 9;
  for (let column = 1; column < columns; column += 1) {
    const x = (width / columns) * column;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let row = 1; row < rows; row += 1) {
    const y = (height / rows) * row;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const radius = Math.min(width, height) * 0.095;
  context.strokeStyle = colorToRgb(markColor, 0.64);
  context.lineWidth = Math.max(4, width / 210);
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.stroke();

  context.lineWidth = Math.max(3, width / 320);
  for (let index = 0; index < 4; index += 1) {
    const x = centerX - radius * 0.58 + index * radius * 0.38;
    const barHeight = radius * (0.46 + index * 0.16);
    context.beginPath();
    context.moveTo(x, centerY + barHeight * 0.5);
    context.lineTo(x, centerY - barHeight * 0.5);
    context.stroke();
  }
  context.restore();
};

const resampleAudioWaves = (
  source: Float32Array,
  sourceColumns: number,
  sourceRows: number,
  targetColumns: number,
  targetRows: number,
) => {
  const target = new Float32Array(targetColumns * targetRows);

  if (source.length === 0 || sourceColumns <= 0 || sourceRows <= 0) {
    return target;
  }

  for (let row = 0; row < targetRows; row += 1) {
    const sourceRow = Math.min(
      sourceRows - 1,
      Math.round((row / Math.max(1, targetRows - 1)) * Math.max(0, sourceRows - 1)),
    );

    for (let column = 0; column < targetColumns; column += 1) {
      const sourceColumn = Math.min(
        sourceColumns - 1,
        Math.round((column / Math.max(1, targetColumns - 1)) * Math.max(0, sourceColumns - 1)),
      );
      target[row * targetColumns + column] = source[sourceRow * sourceColumns + sourceColumn] ?? 0;
    }
  }

  return target;
};

const createIdleTexture = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;

  const context = canvas.getContext("2d");
  if (!context) {
    return new THREE.CanvasTexture(canvas);
  }

  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#15191f");
  gradient.addColorStop(0.48, "#07090c");
  gradient.addColorStop(1, "#111411");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "rgba(255, 255, 255, 0.035)";
  for (let y = 0; y < canvas.height; y += 24) {
    context.fillRect(0, y, canvas.width, 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
};

const createStudioBackdropTexture = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) {
    return new THREE.Texture();
  }

  const backdrop = context.createLinearGradient(0, 0, 0, canvas.height);
  backdrop.addColorStop(0, "#172033");
  backdrop.addColorStop(0.42, "#394353");
  backdrop.addColorStop(0.52, "#202733");
  backdrop.addColorStop(1, "#07090d");
  context.fillStyle = backdrop;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.filter = "blur(28px)";
  context.fillStyle = "rgba(232, 241, 255, 0.9)";
  context.fillRect(90, 64, 110, 250);
  context.fillRect(760, 44, 140, 300);
  context.fillStyle = "rgba(255, 216, 166, 0.55)";
  context.fillRect(420, 30, 130, 80);
  context.filter = "none";

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
};

const applyCameraHome = (
  camera: THREE.PerspectiveCamera | null,
  controls: OrbitControls | null,
) => {
  if (!camera || !controls) {
    return;
  }

  camera.position.copy(CAMERA_HOME);
  controls.target.copy(CAMERA_TARGET);
  controls.update();
};

const normalizeSymbolGeometry = (geometry: THREE.BufferGeometry) => {
  const normalized = geometry.clone();
  normalized.deleteAttribute("color");
  normalized.computeVertexNormals();
  normalized.computeBoundingBox();

  const box = normalized.boundingBox;
  if (!box) {
    return normalized;
  }

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  const largestAxis = Math.max(size.x, size.y, size.z);
  if (largestAxis <= Number.EPSILON) {
    return normalized;
  }

  normalized.translate(-center.x, -center.y, -center.z);
  normalized.scale(1 / largestAxis, 1 / largestAxis, 1 / largestAxis);
  normalized.computeVertexNormals();
  normalized.computeBoundingSphere();
  return normalized;
};

const createSphereSymbolGeometry = () => {
  // This is still one shared, instanced mesh draw. The modestly denser sphere
  // removes visible facets at close range without multiplying draw calls.
  const sphereGeometry = new THREE.SphereGeometry(0.5, 32, 20);
  const normalizedGeometry = normalizeSymbolGeometry(sphereGeometry);
  sphereGeometry.dispose();
  return normalizedGeometry;
};

const createSquareSymbolGeometry = () => {
  const boxGeometry = new THREE.BoxGeometry(0.86, 0.86, 0.86);
  const normalizedGeometry = normalizeSymbolGeometry(boxGeometry);
  boxGeometry.dispose();
  return normalizedGeometry;
};

const createPrimitiveSymbolGeometry = (primitive: SymbolPrimitive) =>
  primitive === "square" ? createSquareSymbolGeometry() : createSphereSymbolGeometry();

const parseObjSymbolGeometry = (source: string) => {
  const loader = new OBJLoader();
  const object = loader.parse(source);
  const geometries: THREE.BufferGeometry[] = [];

  object.updateMatrixWorld(true);
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.geometry) {
      return;
    }

    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);

    if (!geometry.getAttribute("normal")) {
      geometry.computeVertexNormals();
    }

    if (geometry.getAttribute("position")?.count) {
      geometries.push(geometry);
    }
  });

  if (geometries.length === 0) {
    throw new Error("No mesh geometry found in OBJ");
  }

  const mergedGeometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
  geometries.forEach((geometry) => {
    if (geometry !== mergedGeometry) {
      geometry.dispose();
    }
  });

  if (!mergedGeometry) {
    throw new Error("OBJ geometry could not be merged");
  }

  const normalizedGeometry = normalizeSymbolGeometry(mergedGeometry);
  mergedGeometry.dispose();
  return normalizedGeometry;
};

const parseStlSymbolGeometry = (source: ArrayBuffer) => {
  const loader = new STLLoader();
  const geometry = loader.parse(source);
  const normalizedGeometry = normalizeSymbolGeometry(geometry);
  geometry.dispose();
  return normalizedGeometry;
};

type SymbolMetrics = {
  baseCellHeight: number;
  baseCellWidth: number;
  columns: number;
  depthScale: number;
  luminosityDepth: number;
  rows: number;
  samePlaneOffset: number;
  symbolSize: number;
  x: number;
  y: number;
  z: number;
};

type AudioMotion = {
  bands: Float32Array;
  level: number;
  pitchShiftLevel: number;
  toneLevel: number;
  tonePosition: number;
  transientLevel: number;
  timestamp: number;
  voiceLevel: number;
};

const getSymbolMetrics = (
  row: number,
  column: number,
  luminance: number,
  columns: number,
  rows: number,
  spacing: number,
  uniformScale: number,
  luminositySizing: boolean,
  flatSymbols: boolean,
  luminosityZSeparation: number,
): SymbolMetrics => {
  const baseCellWidth = SCREEN_WIDTH / columns;
  const baseCellHeight = SCREEN_HEIGHT / rows;
  // Symbol size and grid spacing are independent controls. Spacing changes
  // only the distance between instance centers; it must never resize them.
  const baseSymbolSize = Math.hypot(baseCellWidth, baseCellHeight) * 1.18 * uniformScale;
  // Preserve the established 175% opening-preset footprint while allowing
  // lower values to gather toward the center and higher values to spread out.
  const gridSpread = 0.5 + Math.max(0, spacing) / 3.5;
  const luminanceScale = luminositySizing ? 0.34 + luminance * 1.24 : 1;
  const symbolSize = baseSymbolSize * luminanceScale;
  const depthScale = flatSymbols ? 0.08 : 1;
  const samePlaneOffset = Math.max(0.08, symbolSize * 0.42);
  const luminosityDepth = luminance * LUMINOSITY_Z_RANGE * luminosityZSeparation;

  return {
    baseCellHeight,
    baseCellWidth,
    columns,
    depthScale,
    luminosityDepth,
    rows,
    samePlaneOffset,
    symbolSize,
    x: (baseCellWidth * (column + 0.5) - SCREEN_WIDTH / 2) * gridSpread,
    y: SCREEN_CENTER_Y + (SCREEN_HEIGHT / 2 - baseCellHeight * (row + 0.5)) * gridSpread,
    z: SCREEN_Z + samePlaneOffset + luminosityDepth,
  };
};

export function ThreeViewport({
  audioBackgroundColor,
  audioEffectIntensity,
  environmentIntensity,
  environmentRotationX,
  environmentRotation,
  environmentRotationZ,
  fillLightColor,
  fillLightIntensity,
  audioForegroundColor,
  audioGradientColors,
  audioGradientStops,
  collisionsEnabled,
  dynamicallyAwareCollision,
  dynamicCollisionResponse,
  hdriMapUrl,
  showHdriBackground,
  audioLevelScale,
  audioMuted,
  liveAudioPaused,
  liveAudioStream,
  liveAudioResponseDelay,
  dotColumns,
  dotRows,
  effectVisible,
  flatSymbols,
  floorVisible,
  grayscaleVideo,
  luminositySizing,
  luminosityZSeparation,
  mirrorVideo,
  minimumVideoZoom,
  randomPositionX,
  randomPositionY,
  randomPositionZ,
  randomRotationX,
  randomRotationY,
  randomRotationZ,
  randomScale,
  videoVerticalCropPosition,
  onSymbolStatus,
  resetSignal,
  screenVisible,
  symbolModelSource,
  symbolPrimitive,
  symbolScale,
  symbolRevision,
  symbolSpacing,
  videoCurvePoints,
  videoElement,
  imageElement,
  videoFrameVisible,
  videoGradientEnabled,
  webcamColorCorrection,
  videoZoom,
  videoRevision,
}: ThreeViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const dotGroupRef = useRef<THREE.Group | null>(null);
  const floorGroupRef = useRef<THREE.Group | null>(null);
  const screenGroupRef = useRef<THREE.Group | null>(null);
  const dotGridRef = useRef<THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null>(null);
  const screenRef = useRef<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const applySymbolGeometryRef = useRef<((geometry: THREE.BufferGeometry) => void) | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);
  const activeAudioSourceRef = useRef<AudioNode | null>(null);
  const mediaElementSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const streamAudioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioWaveDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const audioBandsRef = useRef(new Float32Array(AUDIO_BAND_COUNT));
  const audioBackgroundColorRef = useRef(audioBackgroundColor);
  const audioForegroundColorRef = useRef(audioForegroundColor);
  const audioGradientColorsRef = useRef(audioGradientColors);
  const audioGradientStopsRef = useRef(audioGradientStops);
  const audioEffectIntensityRef = useRef(audioEffectIntensity);
  const environmentIntensityRef = useRef(environmentIntensity);
  const environmentRotationXRef = useRef(environmentRotationX);
  const environmentRotationRef = useRef(environmentRotation);
  const environmentRotationZRef = useRef(environmentRotationZ);
  const fillLightColorRef = useRef(fillLightColor);
  const fillLightIntensityRef = useRef(fillLightIntensity);
  const hdriMapUrlRef = useRef(hdriMapUrl);
  const showHdriBackgroundRef = useRef(showHdriBackground);
  const collisionsEnabledRef = useRef(collisionsEnabled);
  const dynamicallyAwareCollisionRef = useRef(dynamicallyAwareCollision);
  const dynamicCollisionResponseRef = useRef(dynamicCollisionResponse);
  const audioLevelScaleRef = useRef(audioLevelScale);
  const audioMutedRef = useRef(audioMuted);
  const audioLevelRef = useRef(0);
  const audioSourceElementRef = useRef<HTMLVideoElement | null>(null);
  const liveAudioPausedRef = useRef(liveAudioPaused);
  const liveAudioStreamRef = useRef(liveAudioStream);
  const idleTextureRef = useRef<THREE.Texture | null>(null);
  const idleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const onSymbolStatusRef = useRef(onSymbolStatus);
  const symbolGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  const dotColumnsRef = useRef(dotColumns);
  const dotRowsRef = useRef(dotRows);
  const flatSymbolsRef = useRef(flatSymbols);
  const grayscaleVideoRef = useRef(grayscaleVideo);
  const luminositySizingRef = useRef(luminositySizing);
  const luminosityZSeparationRef = useRef(luminosityZSeparation);
  const liveAudioResponseDelayRef = useRef(liveAudioResponseDelay);
  const mirrorVideoRef = useRef(mirrorVideo);
  const minimumVideoZoomRef = useRef(minimumVideoZoom);
  const randomPositionXRef = useRef(randomPositionX);
  const randomPositionYRef = useRef(randomPositionY);
  const randomPositionZRef = useRef(randomPositionZ);
  const randomRotationXRef = useRef(randomRotationX);
  const randomRotationYRef = useRef(randomRotationY);
  const randomRotationZRef = useRef(randomRotationZ);
  const randomScaleRef = useRef(randomScale);
  const videoVerticalCropPositionRef = useRef(videoVerticalCropPosition);
  const symbolSpacingRef = useRef(symbolSpacing);
  const symbolScaleRef = useRef(symbolScale);
  const videoCurveLookupRef = useRef(buildCurveLookup(videoCurvePoints));
  const videoGradientEnabledRef = useRef(videoGradientEnabled);
  const webcamColorCorrectionRef = useRef(webcamColorCorrection);
  const videoZoomRef = useRef(videoZoom);
  const videoElementRef = useRef<HTMLVideoElement | null>(videoElement);
  const imageElementRef = useRef<HTMLCanvasElement | null>(imageElement);
  const videoFrameVisibleRef = useRef(videoFrameVisible);

  useEffect(() => {
    audioBackgroundColorRef.current = audioBackgroundColor;
  }, [audioBackgroundColor]);

  useEffect(() => {
    audioForegroundColorRef.current = audioForegroundColor;
  }, [audioForegroundColor]);

  useEffect(() => {
    audioGradientColorsRef.current = audioGradientColors;
  }, [audioGradientColors]);

  useLayoutEffect(() => {
    audioGradientStopsRef.current = audioGradientStops;
  }, [audioGradientStops]);

  useEffect(() => {
    audioEffectIntensityRef.current = audioEffectIntensity;
  }, [audioEffectIntensity]);

  useEffect(() => { environmentIntensityRef.current = environmentIntensity; }, [environmentIntensity]);
  useEffect(() => { environmentRotationXRef.current = environmentRotationX; }, [environmentRotationX]);
  useEffect(() => { environmentRotationRef.current = environmentRotation; }, [environmentRotation]);
  useEffect(() => { environmentRotationZRef.current = environmentRotationZ; }, [environmentRotationZ]);
  useEffect(() => { fillLightColorRef.current = fillLightColor; }, [fillLightColor]);
  useEffect(() => { fillLightIntensityRef.current = fillLightIntensity; }, [fillLightIntensity]);
  useEffect(() => { hdriMapUrlRef.current = hdriMapUrl; }, [hdriMapUrl]);
  useEffect(() => { showHdriBackgroundRef.current = showHdriBackground; }, [showHdriBackground]);

  useEffect(() => {
    collisionsEnabledRef.current = collisionsEnabled;
  }, [collisionsEnabled]);

  useEffect(() => {
    dynamicallyAwareCollisionRef.current = dynamicallyAwareCollision;
  }, [dynamicallyAwareCollision]);

  useEffect(() => {
    dynamicCollisionResponseRef.current = dynamicCollisionResponse;
  }, [dynamicCollisionResponse]);

  useEffect(() => {
    audioLevelScaleRef.current = audioLevelScale;
  }, [audioLevelScale]);

  useEffect(() => {
    audioMutedRef.current = audioMuted;
    if (audioGainRef.current) {
      audioGainRef.current.gain.value = audioMuted ? 0 : 1;
    }
  }, [audioMuted]);

  useEffect(() => {
    onSymbolStatusRef.current = onSymbolStatus;
  }, [onSymbolStatus]);

  useEffect(() => {
    dotColumnsRef.current = dotColumns;
  }, [dotColumns]);

  useEffect(() => {
    dotRowsRef.current = dotRows;
  }, [dotRows]);

  useEffect(() => {
    flatSymbolsRef.current = flatSymbols;
  }, [flatSymbols]);

  useLayoutEffect(() => {
    grayscaleVideoRef.current = grayscaleVideo;
  }, [grayscaleVideo]);

  useEffect(() => {
    luminositySizingRef.current = luminositySizing;
  }, [luminositySizing]);

  useEffect(() => {
    luminosityZSeparationRef.current = luminosityZSeparation;
  }, [luminosityZSeparation]);

  useEffect(() => {
    liveAudioPausedRef.current = liveAudioPaused;
  }, [liveAudioPaused]);

  useEffect(() => {
    liveAudioResponseDelayRef.current = liveAudioResponseDelay;
  }, [liveAudioResponseDelay]);

  useEffect(() => {
    mirrorVideoRef.current = mirrorVideo;
  }, [mirrorVideo]);

  useEffect(() => {
    minimumVideoZoomRef.current = minimumVideoZoom;
  }, [minimumVideoZoom]);

  useEffect(() => {
    randomPositionXRef.current = randomPositionX;
    randomPositionYRef.current = randomPositionY;
    randomPositionZRef.current = randomPositionZ;
    randomRotationXRef.current = randomRotationX;
    randomRotationYRef.current = randomRotationY;
    randomRotationZRef.current = randomRotationZ;
    randomScaleRef.current = randomScale;
  }, [randomPositionX, randomPositionY, randomPositionZ, randomRotationX, randomRotationY, randomRotationZ, randomScale]);

  useEffect(() => {
    videoVerticalCropPositionRef.current = videoVerticalCropPosition;
  }, [videoVerticalCropPosition]);

  useEffect(() => {
    symbolSpacingRef.current = symbolSpacing;
  }, [symbolSpacing]);

  useEffect(() => {
    symbolScaleRef.current = symbolScale;
  }, [symbolScale]);

  useEffect(() => {
    videoCurveLookupRef.current = buildCurveLookup(videoCurvePoints);
  }, [videoCurvePoints]);

  useEffect(() => {
    videoGradientEnabledRef.current = videoGradientEnabled;
  }, [videoGradientEnabled]);

  useEffect(() => {
    webcamColorCorrectionRef.current = webcamColorCorrection;
  }, [webcamColorCorrection]);

  useEffect(() => {
    videoZoomRef.current = videoZoom;
  }, [videoZoom]);

  useEffect(() => {
    videoElementRef.current = videoElement;
  }, [videoElement, videoRevision]);

  useEffect(() => {
    imageElementRef.current = imageElement;
  }, [imageElement, videoRevision]);

  useEffect(() => {
    liveAudioStreamRef.current = liveAudioStream;
  }, [liveAudioStream]);

  useLayoutEffect(() => {
    videoFrameVisibleRef.current = videoFrameVisible;
  }, [videoFrameVisible]);

  useEffect(() => {
    if (!videoElement) {
      return undefined;
    }

    const resumeAudioContext = () => {
      if (audioContextRef.current?.state === "suspended") {
        void audioContextRef.current.resume();
      }
    };

    try {
      const audioContext = audioContextRef.current ?? new AudioContext({ latencyHint: "interactive" });
      const analyser = audioContext.createAnalyser();
      const gain = audioContext.createGain();
      analyser.fftSize = liveAudioStream ? 256 : 1024;
      analyser.smoothingTimeConstant = liveAudioStream ? 0.12 : 0.42;

      activeAudioSourceRef.current?.disconnect();
      streamAudioSourceRef.current?.disconnect();
      audioAnalyserRef.current?.disconnect();
      audioGainRef.current?.disconnect();

      const source = liveAudioStream
        ? audioContext.createMediaStreamSource(liveAudioStream)
        : mediaElementSourceRef.current ?? audioContext.createMediaElementSource(videoElement);

      if (liveAudioStream) {
        streamAudioSourceRef.current = source as MediaStreamAudioSourceNode;
      } else {
        mediaElementSourceRef.current = source as MediaElementAudioSourceNode;
      }

      source.connect(analyser);
      if (liveAudioStream) {
        audioGainRef.current = null;
      } else {
        analyser.connect(gain);
        gain.connect(audioContext.destination);
        gain.gain.value = audioMutedRef.current ? 0 : 1;
        audioGainRef.current = gain;
      }

      audioContextRef.current = audioContext;
      audioAnalyserRef.current = analyser;
      activeAudioSourceRef.current = source;
      audioDataRef.current = new Uint8Array(analyser.frequencyBinCount);
      audioWaveDataRef.current = new Uint8Array(analyser.fftSize);
      audioBandsRef.current.fill(0);
      audioLevelRef.current = 0;
      audioSourceElementRef.current = liveAudioStream ? null : videoElement;
      videoElement.addEventListener("play", resumeAudioContext);
      if (liveAudioStream && audioContext.state === "suspended") {
        void audioContext.resume();
      }
    } catch {
      audioAnalyserRef.current = null;
      audioDataRef.current = null;
      audioWaveDataRef.current = null;
      audioGainRef.current = null;
      activeAudioSourceRef.current = null;
      audioSourceElementRef.current = null;
    }

    return () => {
      videoElement.removeEventListener("play", resumeAudioContext);
    };
  }, [liveAudioStream, videoElement]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const scene = new THREE.Scene();
    const defaultBackground = new THREE.Color("#050505");
    scene.background = defaultBackground;
    const studioBackdropTexture = createStudioBackdropTexture();
    scene.fog = new THREE.Fog("#050505", 9, 24);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = false;
    renderer.setClearColor("#050505", 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.className = "three-canvas";
    host.appendChild(renderer.domElement);

    // A prefiltered studio environment gives the standard materials broad,
    // HDRI-like reflections instead of the flat look of direct lights alone.
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const environmentTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = environmentTarget.texture;
    let customEnvironmentTarget: THREE.WebGLRenderTarget | null = null;
    let customBackgroundTexture: THREE.Texture | null = null;
    let loadedHdriMapUrl: string | null = null;

    const loadCustomHdri = (url: string | null) => {
      if (!url) {
        customEnvironmentTarget?.dispose();
        customEnvironmentTarget = null;
        customBackgroundTexture?.dispose();
        customBackgroundTexture = null;
        scene.environment = environmentTarget.texture;
        scene.background = defaultBackground;
        return;
      }

      const applyEnvironmentTexture = (texture: THREE.Texture) => {
        if (loadedHdriMapUrl !== url) {
          texture.dispose();
          return;
        }
        texture.mapping = THREE.EquirectangularReflectionMapping;
        const target = pmremGenerator.fromEquirectangular(texture);
        customEnvironmentTarget?.dispose();
        customBackgroundTexture?.dispose();
        customEnvironmentTarget = target;
        customBackgroundTexture = texture;
        scene.environment = target.texture;
      };

      // HDR files contain true high-dynamic-range values. JPEG and PNG 360°
      // panoramas are also useful as environment maps, even though their
      // highlight range is limited by the image format.
      if (/\.hdr(?:$|[?#])/i.test(url)) {
        new RGBELoader().load(url, applyEnvironmentTexture);
      } else {
        new THREE.TextureLoader().load(url, (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.mapping = THREE.EquirectangularReflectionMapping;
          applyEnvironmentTexture(texture);
        });
      }
    };

    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.minDistance = 1.8;
    controls.maxDistance = 15;
    controls.maxPolarAngle = Math.PI * 0.49;
    cameraRef.current = camera;
    controlsRef.current = controls;
    applyCameraHome(camera, controls);

    const worldMaterial = new THREE.MeshBasicMaterial({
      fog: false,
      side: THREE.BackSide,
      toneMapped: false,
    });
    const worldSphere = new THREE.Mesh(new THREE.SphereGeometry(36, 48, 32), worldMaterial);
    worldSphere.position.set(0, SCREEN_CENTER_Y, 0);
    worldSphere.visible = false;
    worldSphere.renderOrder = -2;
    scene.add(worldSphere);

    const fillLight = new THREE.PointLight("#ffffff", 0, 0, 2);
    fillLight.position.set(-2.8, 3.2, 2.8);
    scene.add(fillLight);

    const floorGroup = new THREE.Group();
    floorGroup.visible = true;
    scene.add(floorGroup);
    floorGroupRef.current = floorGroup;

    const floorMaterial = new THREE.MeshStandardMaterial({
      color: "#161a20",
      metalness: 0.18,
      roughness: 0.64,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floorGroup.add(floor);

    const grid = new THREE.GridHelper(24, 48, "#2f363d", "#171b20");
    grid.position.y = 0.004;
    floorGroup.add(grid);

    const idleTexture = createIdleTexture();
    idleTextureRef.current = idleTexture;
    idleCanvasRef.current = idleTexture.image instanceof HTMLCanvasElement ? idleTexture.image : null;

    const processedCanvas = document.createElement("canvas");
    processedCanvas.width = PROCESSED_VIDEO_WIDTH;
    processedCanvas.height = PROCESSED_VIDEO_HEIGHT;
    const processedContext = processedCanvas.getContext("2d");
    const processedTexture = new THREE.CanvasTexture(processedCanvas);
    processedTexture.colorSpace = THREE.SRGBColorSpace;
    processedTexture.minFilter = THREE.LinearFilter;
    processedTexture.magFilter = THREE.LinearFilter;
    processedTexture.generateMipmaps = false;

    const screenGroup = new THREE.Group();
    screenGroup.visible = true;
    scene.add(screenGroup);
    screenGroupRef.current = screenGroup;

    const screenGeometry = new THREE.PlaneGeometry(SCREEN_WIDTH, SCREEN_HEIGHT);
    const screenMaterial = new THREE.MeshBasicMaterial({
      map: processedTexture,
      side: THREE.DoubleSide,
    });
    materialRef.current = screenMaterial;

    const screen = new THREE.Mesh(screenGeometry, screenMaterial);
    screen.renderOrder = 1;
    screen.position.set(0, SCREEN_CENTER_Y, SCREEN_Z);
    screenGroup.add(screen);
    screenRef.current = screen;

    const dotGroup = new THREE.Group();
    dotGroup.visible = effectVisible;
    scene.add(dotGroup);
    dotGroupRef.current = dotGroup;

    const sampleCanvas = document.createElement("canvas");
    const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
    const audioBackgroundColorValue = new THREE.Color(audioBackgroundColorRef.current);
    const audioForegroundColorValue = new THREE.Color(audioForegroundColorRef.current);
    const gradientColorValue = new THREE.Color();
    const videoGradientColorValue = new THREE.Color();
    const dotColor = new THREE.Color();
    const instanceTransform = new THREE.Object3D();
    symbolGeometryRef.current = createPrimitiveSymbolGeometry(symbolPrimitive);

    const applyInstanceTransform = (
      dotGrid: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>,
      index: number,
      row: number,
      column: number,
      luminance = 0.5,
      audioMotion?: AudioMotion,
      audioOnly = false,
      audioWaveOverride?: number,
    ) => {
      const columns = dotColumnsRef.current;
      const rows = dotRowsRef.current;
      let audioWave = audioWaveOverride ?? 0;
      if (audioWaveOverride === undefined && audioMotion && audioMotion.level > 0.002) {
        const normalizedX = columns <= 1 ? 0.5 : column / (columns - 1);
        const normalizedY = rows <= 1 ? 0.5 : row / (rows - 1);
        // Every instance receives a shared pulse, while the left-to-right
        // frequency bands remain a softer local variation. This keeps the
        // whole grid alive instead of making it read as isolated bar columns.
        const bandPosition = Math.pow(normalizedX, 1.65) * Math.max(0, audioMotion.bands.length - 1);
        const lowerBand = Math.floor(bandPosition);
        const upperBand = Math.min(audioMotion.bands.length - 1, lowerBand + 1);
        const blend = bandPosition - lowerBand;
        const bandEnergy = (audioMotion.bands[lowerBand] ?? 0) * (1 - blend) + (audioMotion.bands[upperBand] ?? 0) * blend;
        const centerEmphasis = 0.75 + (1 - Math.abs(normalizedY - 0.5) * 2) * 0.25;
        const voicePosition = audioMotion.toneLevel > 0.015
          ? audioMotion.tonePosition
          : 0.5;
        const voiceOrigin = Math.exp(-(((normalizedX - voicePosition) / 0.27) ** 2));
        const toneOrigin = Math.exp(-(((normalizedX - audioMotion.tonePosition) / 0.18) ** 2));
        const pitchVerticalOrigin = 0.15 + audioMotion.tonePosition * 0.7;
        const pitchVerticalShape = 0.72 + Math.exp(
          -(((normalizedY - pitchVerticalOrigin) / 0.27) ** 2),
        ) * 0.42;
        const transientOrigin = Math.exp(-(((normalizedX - 0.8) / 0.2) ** 2));
        const classifiedEnergy =
          audioMotion.voiceLevel * voiceOrigin * 0.9
          + audioMotion.toneLevel * toneOrigin * pitchVerticalShape * 0.85
          + audioMotion.transientLevel * transientOrigin * 1.2;
        const blendedEnergy = bandEnergy * 0.22 + classifiedEnergy * 0.68 + audioMotion.level * 0.1;
        const pitchTransitionDip = 1 - audioMotion.pitchShiftLevel * 0.28;
        audioWave = softLimit(blendedEnergy * centerEmphasis * 1.02) * pitchTransitionDip;
      }

      const microphoneDelayAmount = liveAudioStreamRef.current ? clamp01(liveAudioResponseDelayRef.current) : 1;
      const audioVisualWave = Math.pow(
        clamp01(audioWave * audioEffectIntensityRef.current * (1.35 - microphoneDelayAmount * 0.35)),
        0.62 + microphoneDelayAmount * 0.52,
      );
      const metrics = getSymbolMetrics(
        row,
        column,
        audioOnly && audioMotion ? audioVisualWave : luminance,
        columns,
        rows,
        symbolSpacingRef.current,
        symbolScaleRef.current,
        luminositySizingRef.current,
        flatSymbolsRef.current,
        luminosityZSeparationRef.current,
      );

      const audioScale = 1 + audioVisualWave * 1.45;
      const audioDepth = audioVisualWave * 0.62;
      const randomScaleAmount = randomScaleRef.current;
      const positionX = (stableRandom(index, 0) - 0.5) * metrics.baseCellWidth * randomPositionXRef.current * 0.8;
      const positionY = (stableRandom(index, 1) - 0.5) * metrics.baseCellHeight * randomPositionYRef.current * 0.8;
      const positionZ = (stableRandom(index, 2) - 0.5) * randomPositionZRef.current * 0.45;
      const rotationX = THREE.MathUtils.degToRad((stableRandom(index, 3) - 0.5) * randomRotationXRef.current * 2);
      const rotationY = THREE.MathUtils.degToRad((stableRandom(index, 4) - 0.5) * randomRotationYRef.current * 2);
      const rotationZ = THREE.MathUtils.degToRad((stableRandom(index, 5) - 0.5) * randomRotationZRef.current * 2);
      const randomSize = Math.max(0.12, 1 + (stableRandom(index, 4) - 0.5) * randomScaleAmount);
      const instanceX = metrics.x + positionX;
      const instanceY = metrics.y + positionY;
      const instanceZ = metrics.z + audioDepth + positionZ;

      instanceTransform.position.set(instanceX, instanceY, instanceZ);
      instanceTransform.rotation.set(rotationX, rotationY, rotationZ);
      instanceTransform.scale.set(
        metrics.symbolSize * audioScale * randomSize,
        metrics.symbolSize * audioScale * randomSize,
        metrics.symbolSize * metrics.depthScale * (1 + audioVisualWave * 2.05) * randomSize,
      );
      instanceTransform.updateMatrix();
      dotGrid.setMatrixAt(index, instanceTransform.matrix);
      return audioWave;
    };

    const disposeDotGrid = () => {
      if (dotGridRef.current) {
        dotGroup.remove(dotGridRef.current);
        dotGridRef.current.geometry.dispose();
        dotGridRef.current.material.dispose();
        dotGridRef.current = null;
      }
    };

    let smoothedLuminance = new Float32Array(dotColumnsRef.current * dotRowsRef.current);
    smoothedLuminance.fill(0.5);
    let lastAudioWaves = new Float32Array(dotColumnsRef.current * dotRowsRef.current);
    let previousFrameLuminance = new Float32Array(dotColumnsRef.current * dotRowsRef.current);
    let videoMotionInitialized = new Uint8Array(dotColumnsRef.current * dotRowsRef.current);
    let collisionPositions = new Float32Array(dotColumnsRef.current * dotRowsRef.current * 3);
    let collisionTargets = new Float32Array(dotColumnsRef.current * dotRowsRef.current * 3);
    let collisionRadii = new Float32Array(dotColumnsRef.current * dotRowsRef.current);
    let collisionVelocities = new Float32Array(dotColumnsRef.current * dotRowsRef.current * 3);
    let collisionColorMotion = new Float32Array(dotColumnsRef.current * dotRowsRef.current);
    let collisionAudioMotion = new Float32Array(dotColumnsRef.current * dotRowsRef.current);
    let collisionImpulseCooldown = new Uint8Array(dotColumnsRef.current * dotRowsRef.current);
    let collisionInitialized = new Uint8Array(dotColumnsRef.current * dotRowsRef.current);
    let collisionActiveUntil = new Float64Array(dotColumnsRef.current * dotRowsRef.current);
    let collisionsWereEnabled = false;
    let collisionWarmupStartedAt = performance.now();
    let lastAudioWaveColumns = dotColumnsRef.current;
    let lastAudioWaveRows = dotRowsRef.current;
    let previousBroadbandTransientEnergy = 0;
    let previousHighFrequencyEnergy = 0;
    let smoothedPitchShiftLevel = 0;
    let smoothedToneLevel = 0;
    let smoothedTonePosition = 0.32;
    let smoothedTransientLevel = 0;
    let smoothedVoiceLevel = 0;
    let liveAudioNoiseFloor = 0.012;
    let liveAudioGateOpen = false;

    const rebuildDotGrid = () => {
      disposeDotGrid();

      const columns = dotColumnsRef.current;
      const rows = dotRowsRef.current;
      smoothedLuminance = new Float32Array(columns * rows);
      smoothedLuminance.fill(0.5);
      lastAudioWaves = resampleAudioWaves(
        lastAudioWaves,
        lastAudioWaveColumns,
        lastAudioWaveRows,
        columns,
        rows,
      );
      previousFrameLuminance = new Float32Array(columns * rows);
      videoMotionInitialized = new Uint8Array(columns * rows);
      collisionPositions = new Float32Array(columns * rows * 3);
      collisionTargets = new Float32Array(columns * rows * 3);
      collisionRadii = new Float32Array(columns * rows);
      collisionVelocities = new Float32Array(columns * rows * 3);
      collisionColorMotion = new Float32Array(columns * rows);
      collisionAudioMotion = new Float32Array(columns * rows);
      collisionImpulseCooldown = new Uint8Array(columns * rows);
      collisionInitialized = new Uint8Array(columns * rows);
      collisionActiveUntil = new Float64Array(columns * rows);
      collisionWarmupStartedAt = performance.now();
      lastAudioWaveColumns = columns;
      lastAudioWaveRows = rows;
      const symbolGeometry = (symbolGeometryRef.current ?? createPrimitiveSymbolGeometry(symbolPrimitive)).clone();
      const symbolMaterial = new THREE.MeshStandardMaterial({
        color: "#ffffff",
        emissive: "#05070a",
        emissiveIntensity: 0.035,
        metalness: 0.16,
        roughness: 0.96,
      });
      const dotGrid = new THREE.InstancedMesh(symbolGeometry, symbolMaterial, columns * rows);
      dotGrid.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      dotGrid.castShadow = true;
      dotGrid.receiveShadow = true;
      dotGrid.renderOrder = 2;

      let index = 0;
      if (videoFrameVisibleRef.current) {
        dotColor.setRGB(0.18, 0.22, 0.26);
      } else {
        // A rebuilt Live Audio grid must start in its preset color, not the
        // neutral gray used while video frames are being sampled.
        dotColor.set(audioGradientStopsRef.current[0]?.color ?? audioBackgroundColorRef.current);
        applyColorEffects(dotColor, videoCurveLookupRef.current, grayscaleVideoRef.current);
      }
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          applyInstanceTransform(dotGrid, index, row, column);
          dotGrid.setColorAt(index, dotColor);
          index += 1;
        }
      }
      dotGrid.instanceMatrix.needsUpdate = true;
      if (dotGrid.instanceColor) {
        dotGrid.instanceColor.setUsage(THREE.DynamicDrawUsage);
      }
      symbolMaterial.needsUpdate = true;
      dotGroup.add(dotGrid);
      dotGridRef.current = dotGrid;
    };

    rebuildDotGrid();
    applySymbolGeometryRef.current = (geometry: THREE.BufferGeometry) => {
      disposeDotGrid();
      symbolGeometryRef.current?.dispose();
      symbolGeometryRef.current = geometry;
      rebuildDotGrid();
    };

    const resolveInstanceCollisions = (
      dotGrid: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>,
      count: number,
      skipStartupWarmup: boolean,
    ) => {
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      let maximumRadius = 0;
      const minimumColliderRadius = Math.min(
        SCREEN_WIDTH / Math.max(1, dotColumnsRef.current),
        SCREEN_HEIGHT / Math.max(1, dotRowsRef.current),
      ) * 0.12;
      const collisionWarmupElapsed = performance.now() - collisionWarmupStartedAt;
      const collisionStrength = skipStartupWarmup
        ? 1
        : clamp01(
            (collisionWarmupElapsed - COLLISION_STARTUP_HOLD_MS) / COLLISION_STARTUP_RAMP_MS,
          );
      const homeAttraction = collisionStrength < 1 ? 0.58 : 0.34;
      const now = performance.now();
      const inputTolerance = minimumColliderRadius * 0.15;
      const settleMs = 350;

      for (let index = 0; index < count; index += 1) {
        dotGrid.getMatrixAt(index, matrix);
        matrix.decompose(position, quaternion, scale);
        const offset = index * 3;
        const radius = Math.max(Math.max(scale.x, scale.y, scale.z) * 0.56, minimumColliderRadius);
        // Resting video pixels are anchored. Overlap alone must never wake them:
        // only a meaningful change in their own source transform can do that.
        const inputChanged = !collisionInitialized[index]
          || Math.abs(position.x - collisionTargets[offset]) > inputTolerance
          || Math.abs(position.y - collisionTargets[offset + 1]) > inputTolerance
          || Math.abs(position.z - collisionTargets[offset + 2]) > Math.max(inputTolerance, radius * 0.08)
          || Math.abs(radius - collisionRadii[index]) > Math.max(inputTolerance, radius * 0.08)
          || collisionColorMotion[index] > 0
          || collisionAudioMotion[index] > 0;
        if (inputChanged || collisionStrength < 1 || skipStartupWarmup) {
          collisionActiveUntil[index] = now + settleMs;
        }
        const sleeping = collisionInitialized[index] && now >= collisionActiveUntil[index];
        collisionTargets[offset] = position.x;
        collisionTargets[offset + 1] = position.y;
        collisionTargets[offset + 2] = position.z;
        if (sleeping) {
          collisionVelocities[offset] = 0;
          collisionVelocities[offset + 1] = 0;
          collisionVelocities[offset + 2] = 0;
        } else if (!collisionInitialized[index]) {
          collisionPositions[offset] = position.x;
          collisionPositions[offset + 1] = position.y;
          collisionPositions[offset + 2] = position.z;
          collisionInitialized[index] = 1;
        } else if (skipStartupWarmup || !dynamicallyAwareCollisionRef.current) {
          // Positional collision has no momentum: solve from this frame's home
          // transforms so displacement cannot accumulate across video loops.
          // Instant live audio follows the same rule.
          collisionPositions[offset] = position.x;
          collisionPositions[offset + 1] = position.y;
          collisionPositions[offset + 2] = position.z;
          collisionVelocities[offset] = 0;
          collisionVelocities[offset + 1] = 0;
          collisionVelocities[offset + 2] = 0;
        } else {
          if (dynamicallyAwareCollisionRef.current) {
            collisionPositions[offset] += collisionVelocities[offset];
            collisionPositions[offset + 1] += collisionVelocities[offset + 1];
            collisionPositions[offset + 2] += collisionVelocities[offset + 2];
            // Damping lets a triggered bounce settle instead of continually
            // re-inheriting movement from the underlying video transform.
            collisionVelocities[offset] *= 0.64;
            collisionVelocities[offset + 1] *= 0.64;
            collisionVelocities[offset + 2] *= 0.64;
          } else {
            collisionVelocities[offset] = 0;
            collisionVelocities[offset + 1] = 0;
            collisionVelocities[offset + 2] = 0;
          }
          // Grid, random, and audio transforms define a home target. Collision
          // lives on top of that target and relaxes back toward it when free.
          collisionPositions[offset] += (position.x - collisionPositions[offset]) * homeAttraction;
          collisionPositions[offset + 1] += (position.y - collisionPositions[offset + 1]) * homeAttraction;
          collisionPositions[offset + 2] += (position.z - collisionPositions[offset + 2]) * homeAttraction;
        }
        collisionRadii[index] = radius;
        maximumRadius = Math.max(maximumRadius, radius);
      }

      const cellSize = Math.max(0.012, maximumRadius * 2);
      const collisionPasses = 10;

      // A few relaxation passes ensure both symbols move apart, rather than
      // pushing only whichever one happened to be processed second.
      for (let pass = 0; pass < collisionPasses; pass += 1) {
        const buckets = new Map<string, number[]>();
        for (let index = 0; index < count; index += 1) {
          const offset = index * 3;
          const x = collisionPositions[offset];
          const y = collisionPositions[offset + 1];
          const z = collisionPositions[offset + 2];
          const cellX = Math.floor(x / cellSize);
          const cellY = Math.floor(y / cellSize);

          for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
            for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
              const neighbors = buckets.get(`${cellX + xOffset}:${cellY + yOffset}`);
              if (!neighbors) {
                continue;
              }

              for (const neighborIndex of neighbors) {
                const neighborOffset = neighborIndex * 3;
                const indexWeight = now < collisionActiveUntil[index] ? 1 : 0;
                const neighborWeight = now < collisionActiveUntil[neighborIndex] ? 1 : 0;
                const totalWeight = indexWeight + neighborWeight;
                if (!totalWeight) continue;
                // Earlier neighbors may already have moved this sphere.
                // Use its current position to avoid compounding stale pushes.
                let deltaX = collisionPositions[offset] - collisionPositions[neighborOffset];
                let deltaY = collisionPositions[offset + 1] - collisionPositions[neighborOffset + 1];
                let deltaZ = collisionPositions[offset + 2] - collisionPositions[neighborOffset + 2];
                let distance = Math.hypot(deltaX, deltaY, deltaZ);
                const minimumDistance = collisionRadii[index] + collisionRadii[neighborIndex];
                if (distance >= minimumDistance) {
                  continue;
                }

                if (distance < 0.0001) {
                  deltaX = stableRandom(index, neighborIndex + 21) - 0.5;
                  deltaY = stableRandom(index, neighborIndex + 31) - 0.5;
                  deltaZ = stableRandom(index, neighborIndex + 41) - 0.5;
                  distance = Math.hypot(deltaX, deltaY, deltaZ);
                }

                const correction = ((minimumDistance - distance) / totalWeight) * collisionStrength;
                const pushX = (deltaX / distance) * correction;
                const pushY = (deltaY / distance) * correction;
                const pushZ = (deltaZ / distance) * correction;
                collisionPositions[offset] += pushX * indexWeight;
                collisionPositions[offset + 1] += pushY * indexWeight;
                collisionPositions[offset + 2] += pushZ * indexWeight;
                collisionPositions[neighborOffset] -= pushX * neighborWeight;
                collisionPositions[neighborOffset + 1] -= pushY * neighborWeight;
                collisionPositions[neighborOffset + 2] -= pushZ * neighborWeight;
                // Dynamic collision is an occasional impulse, not a force that
                // is reapplied on every collision pass. A short cooldown and
                // motion threshold stop static or slow footage from vibrating.
                if (
                  pass === 0
                  && collisionStrength >= 1
                  && dynamicallyAwareCollisionRef.current
                  && indexWeight && neighborWeight
                  && !collisionImpulseCooldown[index]
                  && !collisionImpulseCooldown[neighborIndex]
                ) {
                  const motion = Math.max(
                    collisionColorMotion[index],
                    collisionColorMotion[neighborIndex],
                    collisionAudioMotion[index],
                    collisionAudioMotion[neighborIndex],
                  );
                  if (motion > 0) {
                    const impulse = motion * minimumDistance * 1.8 * dynamicCollisionResponseRef.current;
                    const normalX = deltaX / distance;
                    const normalY = deltaY / distance;
                    const normalZ = deltaZ / distance;
                    collisionVelocities[offset] += normalX * impulse;
                    collisionVelocities[offset + 1] += normalY * impulse;
                    collisionVelocities[offset + 2] += normalZ * impulse;
                    collisionVelocities[neighborOffset] -= normalX * impulse;
                    collisionVelocities[neighborOffset + 1] -= normalY * impulse;
                    collisionVelocities[neighborOffset + 2] -= normalZ * impulse;
                    const cooldownFrames = skipStartupWarmup ? 2 : 9;
                    collisionImpulseCooldown[index] = cooldownFrames;
                    collisionImpulseCooldown[neighborIndex] = cooldownFrames;
                  }
                }
              }
            }
          }

          const key = `${cellX}:${cellY}`;
          const bucket = buckets.get(key);
          if (bucket) {
            bucket.push(index);
          } else {
            buckets.set(key, [index]);
          }
        }
      }

      for (let index = 0; index < count; index += 1) {
        dotGrid.getMatrixAt(index, matrix);
        matrix.decompose(position, quaternion, scale);
        const offset = index * 3;
        position.set(collisionPositions[offset], collisionPositions[offset + 1], collisionPositions[offset + 2]);
        matrix.compose(position, quaternion, scale);
        dotGrid.setMatrixAt(index, matrix);
      }
    };

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    let resizeTimeout: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeout !== null) {
        window.clearTimeout(resizeTimeout);
      }
      resizeTimeout = window.setTimeout(() => {
        resizeTimeout = null;
        resize();
      }, 48);
    });
    resizeObserver.observe(host);
    resize();

    let animationFrame = 0;
    let lastColumns = dotColumnsRef.current;
    let lastRows = dotRowsRef.current;
    let lastSpacing = symbolSpacingRef.current;
    let lastFlatSymbols = flatSymbolsRef.current;
    let lastSampleTime = 0;
    let lastTextureTime = 0;
    let lastVideoTime = 0;
    let loopCrossfadeStartedAt: number | null = null;
    const loopTailCanvas = document.createElement("canvas");
    loopTailCanvas.width = PROCESSED_VIDEO_WIDTH;
    loopTailCanvas.height = PROCESSED_VIDEO_HEIGHT;
    const loopTailContext = loopTailCanvas.getContext("2d");

    const resetSmoothedLuminance = (columns = dotColumnsRef.current, rows = dotRowsRef.current) => {
      smoothedLuminance = new Float32Array(columns * rows);
      smoothedLuminance.fill(0.5);
      lastAudioWaves = resampleAudioWaves(
        lastAudioWaves,
        lastAudioWaveColumns,
        lastAudioWaveRows,
        columns,
        rows,
      );
      lastAudioWaveColumns = columns;
      lastAudioWaveRows = rows;
    };

    const updateProcessedFrame = (timestamp: number) => {
      if (!processedContext) {
        return;
      }

      if (timestamp - lastTextureTime < 33) {
        return;
      }
      lastTextureTime = timestamp;

      const currentVideo = videoElementRef.current;
      const currentImage = imageElementRef.current;
      const shouldShowVideoFrame = videoFrameVisibleRef.current;
      const canUseImage = Boolean(
        shouldShowVideoFrame &&
        currentImage &&
        currentImage.width > 0 &&
        currentImage.height > 0
      );
      const canUseVideo =
        !canUseImage &&
        shouldShowVideoFrame &&
        currentVideo &&
        (currentVideo.src || currentVideo.srcObject) &&
        currentVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        currentVideo.videoWidth > 0 &&
        currentVideo.videoHeight > 0;
      // A loop/seek can briefly have no decoded frame. Keep the last image;
      // replacing it with the idle graphic creates false motion across the
      // entire background and repeatedly wakes resting collisions.
      if (shouldShowVideoFrame && !canUseImage && currentVideo
        && (currentVideo.src || currentVideo.srcObject) && !canUseVideo) {
        return;
      }
      const videoCurveLookup = videoCurveLookupRef.current;
      const useGrayscale = grayscaleVideoRef.current;

      if (canUseVideo && currentVideo) {
        if (currentVideo.currentTime < lastVideoTime - 0.35) {
          loopTailContext?.drawImage(processedCanvas, 0, 0);
          loopCrossfadeStartedAt = timestamp;
        }
        lastVideoTime = currentVideo.currentTime;
      } else {
        lastVideoTime = 0;
        loopCrossfadeStartedAt = null;
      }

      processedContext.save();
      processedContext.clearRect(0, 0, processedCanvas.width, processedCanvas.height);
      processedContext.imageSmoothingEnabled = true;
      processedContext.imageSmoothingQuality = "high";

      if (canUseVideo || canUseImage) {
        const zoom = Math.max(1, minimumVideoZoomRef.current, videoZoomRef.current);
        const sourceWidth = Math.max(canUseImage ? currentImage!.width : currentVideo!.videoWidth, 1);
        const sourceHeight = Math.max(canUseImage ? currentImage!.height : currentVideo!.videoHeight, 1);
        const coverScale = Math.max(
          processedCanvas.width / sourceWidth,
          processedCanvas.height / sourceHeight,
        );
        const width = sourceWidth * coverScale * zoom;
        const height = sourceHeight * coverScale * zoom;
        const x = (processedCanvas.width - width) / 2;
        const y = (processedCanvas.height - height) * videoVerticalCropPositionRef.current;
        if (mirrorVideoRef.current) {
          processedContext.translate(processedCanvas.width, 0);
          processedContext.scale(-1, 1);
        }
        processedContext.drawImage(canUseImage ? currentImage! : currentVideo!, x, y, width, height);
      } else if (!shouldShowVideoFrame) {
        drawAudioGuideFrame(
          processedContext,
          processedCanvas.width,
          processedCanvas.height,
          audioGradientColorsRef.current,
          videoCurveLookup,
          useGrayscale,
        );
      } else if (idleCanvasRef.current) {
        processedContext.drawImage(idleCanvasRef.current, 0, 0, processedCanvas.width, processedCanvas.height);
      }

      processedContext.restore();

      if (canUseVideo || canUseImage || useGrayscale || videoGradientEnabledRef.current) {
        const imageData = processedContext.getImageData(0, 0, processedCanvas.width, processedCanvas.height);
        const pixels = imageData.data;
        const videoGradientStops = audioGradientStopsRef.current.map((stop) => ({
          color: new THREE.Color(stop.color),
          offset: stop.offset,
        }));
        const shouldApplyVideoGradient = videoGradientEnabledRef.current && videoGradientStops.length >= 2;

        for (let index = 0; index < pixels.length; index += 4) {
          let red = pixels[index] / 255;
          let green = pixels[index + 1] / 255;
          let blue = pixels[index + 2] / 255;

          if (useGrayscale) {
            const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
            red = luminance;
            green = luminance;
            blue = luminance;
          }

          if (useGrayscale) {
            const adjusted = sampleCurveLookup(videoCurveLookup, red);
            if (shouldApplyVideoGradient) {
              sampleGradientColor(videoGradientStops, adjusted, videoGradientColorValue);
              const gradientLuminance =
                videoGradientColorValue.r * 0.2126 +
                videoGradientColorValue.g * 0.7152 +
                videoGradientColorValue.b * 0.0722;
              pixels[index] = Math.round(gradientLuminance * 255);
              pixels[index + 1] = Math.round(gradientLuminance * 255);
              pixels[index + 2] = Math.round(gradientLuminance * 255);
              continue;
            }

            pixels[index] = Math.round(adjusted * 255);
            pixels[index + 1] = Math.round(adjusted * 255);
            pixels[index + 2] = Math.round(adjusted * 255);
            continue;
          }

          const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
          const adjustedLuminance = sampleCurveLookup(videoCurveLookup, luminance);
          if (shouldApplyVideoGradient) {
            sampleGradientColor(videoGradientStops, adjustedLuminance, videoGradientColorValue);
            pixels[index] = Math.round(clamp01(videoGradientColorValue.r) * 255);
            pixels[index + 1] = Math.round(clamp01(videoGradientColorValue.g) * 255);
            pixels[index + 2] = Math.round(clamp01(videoGradientColorValue.b) * 255);
            continue;
          }

          const luminanceScale = adjustedLuminance / Math.max(0.001, luminance);
          pixels[index] = Math.round(clamp01(red * luminanceScale) * 255);
          pixels[index + 1] = Math.round(clamp01(green * luminanceScale) * 255);
          pixels[index + 2] = Math.round(clamp01(blue * luminanceScale) * 255);
        }

        processedContext.putImageData(imageData, 0, 0);
      }

      if (loopCrossfadeStartedAt !== null) {
        const progress = Math.min(1, (timestamp - loopCrossfadeStartedAt) / LOOP_CROSSFADE_MS);
        if (progress < 1) {
          processedContext.save();
          processedContext.globalAlpha = 1 - progress;
          processedContext.drawImage(loopTailCanvas, 0, 0);
          processedContext.restore();
        } else {
          loopCrossfadeStartedAt = null;
        }
      }

      processedTexture.needsUpdate = true;
    };

    const updateDotColors = (timestamp: number) => {
      const dotGrid = dotGridRef.current;
      if (!sampleContext) {
        return;
      }

      const useNeutralAudioOnlySymbols = !videoFrameVisibleRef.current;
      const currentVideo = videoElementRef.current;
      const isLiveAudio = Boolean(liveAudioStreamRef.current);
      const isFrozenAudioFrame = Boolean(
        useNeutralAudioOnlySymbols
        && (
          (isLiveAudio && liveAudioPausedRef.current)
          || (!isLiveAudio && currentVideo?.paused && currentVideo.currentTime > 0)
        )
      );

      const columns = dotColumnsRef.current;
      const rows = dotRowsRef.current;
      const spacing = symbolSpacingRef.current;
      const flatSymbols = flatSymbolsRef.current;
      if (
        columns !== lastColumns ||
        rows !== lastRows ||
        Math.abs(spacing - lastSpacing) > 0.001 ||
        flatSymbols !== lastFlatSymbols
      ) {
        lastColumns = columns;
        lastRows = rows;
        lastSpacing = spacing;
        lastFlatSymbols = flatSymbols;
        resetSmoothedLuminance(columns, rows);
        rebuildDotGrid();
        return;
      }

      const sampleDelta = timestamp - lastSampleTime;
      const liveAudioDelayAmount = isLiveAudio ? clamp01(liveAudioResponseDelayRef.current) : 1;
      const instantLiveAudio = isLiveAudio && liveAudioDelayAmount <= 0.001;
      if (sampleDelta < (isLiveAudio ? LIVE_AUDIO_SAMPLE_MIN_MS * liveAudioDelayAmount : DOT_SAMPLE_MIN_MS)) {
        return;
      }
      lastSampleTime = timestamp;
      const motionAlpha = 1 - Math.exp(-sampleDelta / DOT_MOTION_SMOOTHING_MS);

      if (sampleCanvas.width !== columns || sampleCanvas.height !== rows) {
        sampleCanvas.width = columns;
        sampleCanvas.height = rows;
      }

      sampleContext.save();
      sampleContext.clearRect(0, 0, columns, rows);
      sampleContext.imageSmoothingEnabled = true;
      sampleContext.imageSmoothingQuality = "high";
      sampleContext.drawImage(processedCanvas, 0, 0, columns, rows);
      sampleContext.restore();

      const pixels = sampleContext.getImageData(0, 0, columns, rows).data;
      if (!dotGrid) {
        return;
      }

      const analyser = audioAnalyserRef.current;
      const audioData = audioDataRef.current;
      const audioWaveData = audioWaveDataRef.current;
      const audioBands = audioBandsRef.current;
      let audioLevel = audioLevelRef.current;

      if (!isFrozenAudioFrame && analyser && audioData) {
        analyser.smoothingTimeConstant = isLiveAudio ? 0.12 * liveAudioDelayAmount : 0.42;
        if (audioContextRef.current?.state === "suspended" && !videoElementRef.current?.paused) {
          void audioContextRef.current.resume();
        }

        analyser.getByteFrequencyData(audioData);
        if (audioWaveData) {
          analyser.getByteTimeDomainData(audioWaveData);
        }
        let total = 0;
        let peak = 0;
        let waveformTotal = 0;

        for (let index = 0; index < audioData.length; index += 1) {
          total += audioData[index];
          peak = Math.max(peak, audioData[index]);
        }

        if (audioWaveData) {
          for (let index = 0; index < audioWaveData.length; index += 1) {
            const centered = (audioWaveData[index] - 128) / 128;
            waveformTotal += centered * centered;
          }
        }

        const waveformLevel = audioWaveData ? Math.sqrt(waveformTotal / audioWaveData.length) : 0;
        const levelScale = Math.max(0.2, audioLevelScaleRef.current);
        const scaledWaveformLevel = waveformLevel * levelScale;
        let quietInputGate: number;
        if (isLiveAudio) {
          const trackedLevel = Math.min(0.06, scaledWaveformLevel);
          const noiseTrackingRate = liveAudioGateOpen
            ? (trackedLevel < liveAudioNoiseFloor ? 0.1 : 0.0007)
            : 0.035;
          liveAudioNoiseFloor += (trackedLevel - liveAudioNoiseFloor) * noiseTrackingRate;
          const noiseThreshold = Math.max(0.006, Math.min(0.045, liveAudioNoiseFloor * 1.42));

          if (liveAudioGateOpen) {
            if (scaledWaveformLevel < noiseThreshold + 0.0015) {
              liveAudioGateOpen = false;
            }
          } else if (scaledWaveformLevel > noiseThreshold + 0.004) {
            liveAudioGateOpen = true;
          }

          quietInputGate = liveAudioGateOpen
            ? 0.22 + clamp01((scaledWaveformLevel - noiseThreshold) / 0.018) * 0.78
            : 0.12;
        } else {
          quietInputGate = 0.28 + clamp01(
            (scaledWaveformLevel - 0.006) / 0.045,
          ) * 0.72;
        }
        const delayedLiveAudioBoost = isLiveAudio ? 1 + liveAudioDelayAmount * 0.45 : 1;
        const hzPerBin = audioContextRef.current
          ? audioContextRef.current.sampleRate / analyser.fftSize
          : 187.5;
        const averageFrequencyRange = (minimumHz: number, maximumHz: number) => {
          const start = Math.max(0, Math.floor(minimumHz / hzPerBin));
          const end = Math.min(audioData.length, Math.ceil(maximumHz / hzPerBin));
          let rangeTotal = 0;
          let rangePeak = 0;

          for (let index = start; index < end; index += 1) {
            rangeTotal += audioData[index];
            rangePeak = Math.max(rangePeak, audioData[index]);
          }

          const count = Math.max(1, end - start);
          return (rangeTotal / count) * 0.78 + rangePeak * 0.22;
        };
        const voiceEnergy = softLimit(
          Math.max(0, (averageFrequencyRange(180, 1800) - (7 - liveAudioDelayAmount * 4)) / (105 - liveAudioDelayAmount * 27)) * levelScale * delayedLiveAudioBoost,
        ) * quietInputGate;
        const highFrequencyEnergy = softLimit(
          Math.max(0, (averageFrequencyRange(1800, 11000) - (4 - liveAudioDelayAmount * 2)) / (78 - liveAudioDelayAmount * 18)) * levelScale * delayedLiveAudioBoost,
        ) * (0.5 + quietInputGate * 0.5);
        const broadbandTransientEnergy = softLimit(
          Math.max(0, (averageFrequencyRange(120, 8000) - (6 - liveAudioDelayAmount * 3)) / (96 - liveAudioDelayAmount * 24)) * levelScale * delayedLiveAudioBoost,
        ) * (0.18 + quietInputGate * 0.82);
        const toneStartBin = Math.max(1, Math.floor(70 / hzPerBin));
        const toneEndBin = Math.min(audioData.length, Math.ceil(6000 / hzPerBin));
        let tonePeak = 0;
        let tonePeakBin = toneStartBin;
        let toneRangeTotal = 0;
        for (let index = toneStartBin; index < toneEndBin; index += 1) {
          toneRangeTotal += audioData[index];
          if (audioData[index] > tonePeak) {
            tonePeak = audioData[index];
            tonePeakBin = index;
          }
        }
        const toneRangeAverage = toneRangeTotal / Math.max(1, toneEndBin - toneStartBin);
        const toneProminence = Math.max(0, tonePeak - toneRangeAverage * 1.35);
        const toneFrequency = tonePeakBin * hzPerBin;
        const normalizedPitch = clamp01(
          Math.log2(Math.max(AUDIO_PITCH_FLOOR_HZ, toneFrequency) / AUDIO_PITCH_FLOOR_HZ)
            / Math.log2(AUDIO_PITCH_CEILING_HZ / AUDIO_PITCH_FLOOR_HZ),
        );
        const tonePosition = 0.94 - normalizedPitch * 0.88;
        const toneEnergy = softLimit(
          Math.max(0, (toneProminence - 2) / 70) * levelScale,
        ) * quietInputGate;
        const pitchShift = toneEnergy > 0.07 && smoothedToneLevel > 0.07
          ? clamp01(Math.abs(tonePosition - smoothedTonePosition) * 4.2)
          : 0;
        const delayedPitchShift = Math.max(pitchShift, smoothedPitchShiftLevel * 0.64);
        smoothedPitchShiftLevel = pitchShift + (delayedPitchShift - pitchShift) * liveAudioDelayAmount;
        const broadbandOnset = Math.max(
          0,
          broadbandTransientEnergy - previousBroadbandTransientEnergy,
        ) * 6.2;
        const highFrequencyOnset = Math.max(
          0,
          highFrequencyEnergy - previousHighFrequencyEnergy,
        ) * 5.4;
        const transientEnergy = clamp01(Math.max(
          broadbandOnset,
          highFrequencyOnset,
        ));
        previousBroadbandTransientEnergy = broadbandTransientEnergy;
        previousHighFrequencyEnergy = highFrequencyEnergy;
        const delayedVoiceLevel = smoothedVoiceLevel + (voiceEnergy - smoothedVoiceLevel) * (voiceEnergy > smoothedVoiceLevel ? (isLiveAudio ? 0.5 : 0.2) : 0.075);
        smoothedVoiceLevel = voiceEnergy + (delayedVoiceLevel - voiceEnergy) * liveAudioDelayAmount;
        const delayedToneLevel = smoothedToneLevel + (toneEnergy - smoothedToneLevel) * (toneEnergy > smoothedToneLevel ? (isLiveAudio ? 0.46 : 0.2) : 0.055);
        smoothedToneLevel = toneEnergy + (delayedToneLevel - toneEnergy) * liveAudioDelayAmount;
        if (toneEnergy > 0.015) {
          const delayedTonePosition = smoothedTonePosition + (tonePosition - smoothedTonePosition) * 0.32;
          smoothedTonePosition = tonePosition + (delayedTonePosition - tonePosition) * liveAudioDelayAmount;
        }
        const delayedTransientLevel = smoothedTransientLevel + (transientEnergy - smoothedTransientLevel) * (transientEnergy > smoothedTransientLevel ? 0.58 : 0.2);
        smoothedTransientLevel = transientEnergy + (delayedTransientLevel - transientEnergy) * liveAudioDelayAmount;
        const frequencyLevel = Math.max(0, (((total / audioData.length) * 0.8 + peak * 0.2 - 9) / 140) * levelScale);
        const nextAudioLevel = softLimit(
          Math.max(frequencyLevel * delayedLiveAudioBoost * (1.3 - liveAudioDelayAmount * 0.3), waveformLevel * levelScale * (2.65 - liveAudioDelayAmount * 0.05)),
        ) * quietInputGate;
        if (instantLiveAudio) {
          audioLevel = nextAudioLevel;
        } else {
          const delayedLevelAlpha = nextAudioLevel > audioLevel
            ? (isLiveAudio ? 0.42 : AUDIO_MOTION_ATTACK)
            : (isLiveAudio ? 0.12 : AUDIO_MOTION_RELEASE);
          const levelAlpha = isLiveAudio
            ? 1 + (delayedLevelAlpha - 1) * liveAudioDelayAmount
            : delayedLevelAlpha;
          audioLevel += (nextAudioLevel - audioLevel) * levelAlpha;
        }
        audioLevelRef.current = audioLevel;

        for (let band = 0; band < audioBands.length; band += 1) {
          const start = Math.floor((band / audioBands.length) * audioData.length);
          const end = Math.max(start + 1, Math.floor(((band + 1) / audioBands.length) * audioData.length));
          let bandTotal = 0;
          let bandPeak = 0;

          for (let dataIndex = start; dataIndex < end; dataIndex += 1) {
            const value = audioData[dataIndex];
            bandTotal += value;
            bandPeak = Math.max(bandPeak, value);
          }

          const bandAverage = bandTotal / (end - start);
          const rawBand = Math.max(
            0,
            ((bandAverage * 0.75 + bandPeak * 0.25 - (8 - liveAudioDelayAmount * 4)) / (133 - liveAudioDelayAmount * 28)) * levelScale * delayedLiveAudioBoost,
          ) * quietInputGate;
          if (instantLiveAudio) {
            audioBands[band] = rawBand;
          } else {
            const delayedBandAlpha = rawBand > audioBands[band] ? (isLiveAudio ? 0.48 : 0.205) : 0.08;
            const bandAlpha = isLiveAudio
              ? 1 + (delayedBandAlpha - 1) * liveAudioDelayAmount
              : delayedBandAlpha;
            audioBands[band] += (rawBand - audioBands[band]) * bandAlpha;
          }
        }
      } else if (!isFrozenAudioFrame) {
        audioLevel *= 1 - AUDIO_MOTION_RELEASE;
        audioLevelRef.current = audioLevel;
        smoothedVoiceLevel *= 0.9;
        smoothedPitchShiftLevel *= 0.64;
        smoothedToneLevel *= 0.94;
        smoothedTransientLevel *= 0.72;
        for (let band = 0; band < audioBands.length; band += 1) {
          audioBands[band] *= 1 - AUDIO_MOTION_RELEASE;
        }
      }

      const audioMotion: AudioMotion = {
        bands: audioBands,
        level: audioLevel,
        pitchShiftLevel: smoothedPitchShiftLevel,
        toneLevel: smoothedToneLevel,
        tonePosition: smoothedTonePosition,
        transientLevel: smoothedTransientLevel,
        timestamp,
        voiceLevel: smoothedVoiceLevel,
      };

      if (useNeutralAudioOnlySymbols) {
        const audioGradientStops = audioGradientStopsRef.current;
        audioBackgroundColorValue.set(audioGradientStops[0]?.color ?? audioBackgroundColorRef.current);
        audioForegroundColorValue.set(audioGradientStops[audioGradientStops.length - 1]?.color ?? audioForegroundColorRef.current);
        applyColorEffects(audioBackgroundColorValue, videoCurveLookupRef.current, grayscaleVideoRef.current);
        applyColorEffects(audioForegroundColorValue, videoCurveLookupRef.current, grayscaleVideoRef.current);
      }

      for (let index = 0; index < columns * rows; index += 1) {
        const pixelIndex = index * 4;
        const red = useNeutralAudioOnlySymbols ? 1 : pixels[pixelIndex] / 255;
        const green = useNeutralAudioOnlySymbols ? 1 : pixels[pixelIndex + 1] / 255;
        const blue = useNeutralAudioOnlySymbols ? 1 : pixels[pixelIndex + 2] / 255;
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        const previousLuminance = smoothedLuminance[index] ?? luminance;
        const luminanceDelta = luminance - previousLuminance;
        // Ignore normal frame-to-frame texture variation. Only a pronounced,
        // local brightness change arms a single dynamic collision impulse.
        const rawLuminanceDelta = videoMotionInitialized[index]
          ? Math.abs(luminance - previousFrameLuminance[index])
          : 0;
        previousFrameLuminance[index] = luminance;
        videoMotionInitialized[index] = 1;
        const fastMotion = Math.max(0, rawLuminanceDelta - 0.055);
        collisionColorMotion[index] = Math.min(1, fastMotion * 14);
        if (collisionImpulseCooldown[index] > 0) {
          collisionImpulseCooldown[index] -= 1;
        }
        const easedLuminance =
          Math.abs(luminanceDelta) < DOT_MOTION_DEADBAND
            ? previousLuminance
            : previousLuminance + luminanceDelta * motionAlpha;
        const row = Math.floor(index / columns);
        const column = index % columns;
        smoothedLuminance[index] = easedLuminance;
        const frozenAudioWave = lastAudioWaves[index] ?? 0;
        const audioWave = isFrozenAudioFrame
          ? frozenAudioWave
          : applyInstanceTransform(dotGrid, index, row, column, easedLuminance, audioMotion, useNeutralAudioOnlySymbols);
        if (isFrozenAudioFrame) {
          applyInstanceTransform(dotGrid, index, row, column, easedLuminance, audioMotion, true, frozenAudioWave);
        }
        // Audio-only mode uses the same thresholded dynamic-collision path as
        // video. Each column's frequency energy must change substantially
        // before it can create a bounce, so a steady tone stays calm.
        const audioDelta = Math.abs(audioWave - frozenAudioWave);
        collisionAudioMotion[index] = useNeutralAudioOnlySymbols && !isFrozenAudioFrame
          ? Math.min(1, Math.max(0, audioDelta - 0.04) * 11) * audioEffectIntensityRef.current
          : 0;
        if (!isFrozenAudioFrame) {
          lastAudioWaves[index] = audioWave;
        }
        if (useNeutralAudioOnlySymbols) {
          const colorMix = audioReactionMix(
            audioWave * audioEffectIntensityRef.current,
            videoCurveLookupRef.current,
          );
          const audioGradientStops = audioGradientStopsRef.current.map((stop) => {
            const gradientColor = new THREE.Color(stop.color);
            applyColorEffects(gradientColor, videoCurveLookupRef.current, grayscaleVideoRef.current);
            return {
              color: gradientColor,
              offset: stop.offset,
            };
          });
          sampleGradientColor(audioGradientStops, colorMix, gradientColorValue);
          dotColor.copy(gradientColorValue);
        } else {
          if (webcamColorCorrectionRef.current) {
            // Webcam canvas pixels are sRGB. Convert them to Three.js's linear
            // working space so bright camera colors do not become washed out.
            dotColor.setRGB(red, green, blue, THREE.SRGBColorSpace);
          } else {
            dotColor.setRGB(red, green, blue);
          }
        }
        dotGrid.setColorAt(index, dotColor);
      }

      if (collisionsEnabledRef.current) {
        resolveInstanceCollisions(
          dotGrid,
          columns * rows,
          useNeutralAudioOnlySymbols && liveAudioResponseDelayRef.current <= 0.001,
        );
        collisionsWereEnabled = true;
      } else if (collisionsWereEnabled) {
        collisionInitialized.fill(0);
        collisionImpulseCooldown.fill(0);
        collisionsWereEnabled = false;
      }

      dotGrid.instanceMatrix.needsUpdate = true;
      if (dotGrid.instanceColor) {
        dotGrid.instanceColor.needsUpdate = true;
      }
    };

    const animate = () => {
      const timestamp = performance.now();
      const requestedHdriMap = hdriMapUrlRef.current;
      if (requestedHdriMap !== loadedHdriMapUrl) {
        loadedHdriMapUrl = requestedHdriMap;
        loadCustomHdri(requestedHdriMap);
      }
      scene.environmentIntensity = environmentIntensityRef.current;
      const rotationX = THREE.MathUtils.degToRad(environmentRotationXRef.current);
      const rotationY = THREE.MathUtils.degToRad(environmentRotationRef.current);
      const rotationZ = THREE.MathUtils.degToRad(environmentRotationZRef.current);
      scene.environmentRotation.set(rotationX, rotationY, rotationZ);
      const backdropTexture = customBackgroundTexture ?? studioBackdropTexture;
      if (worldMaterial.map !== backdropTexture) {
        worldMaterial.map = backdropTexture;
        worldMaterial.needsUpdate = true;
      }
      worldSphere.visible = showHdriBackgroundRef.current;
      worldSphere.rotation.set(rotationX, rotationY, rotationZ);
      fillLight.color.set(fillLightColorRef.current);
      // Three's physical light units need substantially more output than the
      // old direct-light setup. At 100% this is deliberately visible.
      fillLight.intensity = 120 * fillLightIntensityRef.current;
      updateProcessedFrame(timestamp);
      updateDotColors(timestamp);
      controls.update();
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      if (resizeTimeout !== null) {
        window.clearTimeout(resizeTimeout);
      }
      resizeObserver.disconnect();
      controls.dispose();
      disposeDotGrid();

      screenGeometry.dispose();
      screenMaterial.dispose();
      processedTexture.dispose();
      symbolGeometryRef.current?.dispose();
      floor.geometry.dispose();
      floorMaterial.dispose();
      worldSphere.geometry.dispose();
      worldMaterial.dispose();
      grid.geometry.dispose();
      if (Array.isArray(grid.material)) {
        grid.material.forEach((material) => material.dispose());
      } else {
        grid.material.dispose();
      }
      idleTexture.dispose();
      studioBackdropTexture.dispose();
      customBackgroundTexture?.dispose();
      customEnvironmentTarget?.dispose();
      environmentTarget.dispose();
      pmremGenerator.dispose();
      renderer.dispose();
      renderer.domElement.remove();

      cameraRef.current = null;
      controlsRef.current = null;
      dotGroupRef.current = null;
      floorGroupRef.current = null;
      screenGroupRef.current = null;
      dotGridRef.current = null;
      screenRef.current = null;
      materialRef.current = null;
      applySymbolGeometryRef.current = null;
      idleTextureRef.current = null;
      idleCanvasRef.current = null;
      symbolGeometryRef.current = null;
      activeAudioSourceRef.current?.disconnect();
      streamAudioSourceRef.current?.disconnect();
      audioGainRef.current?.disconnect();
      audioAnalyserRef.current?.disconnect();
      void audioContextRef.current?.close();
      audioAnalyserRef.current = null;
      audioContextRef.current = null;
      audioDataRef.current = null;
      audioWaveDataRef.current = null;
      audioGainRef.current = null;
      activeAudioSourceRef.current = null;
      streamAudioSourceRef.current = null;
      mediaElementSourceRef.current = null;
      audioSourceElementRef.current = null;
    };
  }, []);

  useEffect(() => {
    const applySymbolGeometry = applySymbolGeometryRef.current;
    if (!applySymbolGeometry) {
      return;
    }

    if (!symbolModelSource) {
      applySymbolGeometry(createPrimitiveSymbolGeometry(symbolPrimitive));
      onSymbolStatusRef.current?.(symbolPrimitive === "square" ? "Cube active" : "Sphere active");
      return;
    }

    try {
      if (symbolModelSource.format === "stl") {
        applySymbolGeometry(parseStlSymbolGeometry(symbolModelSource.source));
        onSymbolStatusRef.current?.("STL active");
        return;
      }

      applySymbolGeometry(parseObjSymbolGeometry(symbolModelSource.source));
      onSymbolStatusRef.current?.("OBJ active");
    } catch {
      applySymbolGeometry(createPrimitiveSymbolGeometry(symbolPrimitive));
      onSymbolStatusRef.current?.("Model could not load");
    }
  }, [symbolModelSource, symbolPrimitive, symbolRevision]);

  useEffect(() => {
    if (resetSignal > 0) {
      applyCameraHome(cameraRef.current, controlsRef.current);
    }
  }, [resetSignal]);

  useEffect(() => {
    if (dotGroupRef.current) {
      dotGroupRef.current.visible = effectVisible;
    }
  }, [effectVisible]);

  useEffect(() => {
    if (floorGroupRef.current) {
      floorGroupRef.current.visible = floorVisible;
    }
  }, [floorVisible]);

  useEffect(() => {
    if (screenGroupRef.current) {
      screenGroupRef.current.visible = screenVisible;
    }
  }, [screenVisible]);

  return <div ref={hostRef} className="three-viewport" aria-label="Three.js video scene" />;
}
