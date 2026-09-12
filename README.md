# Video Plane Studio

React + TypeScript + Electron app with a full-screen Three.js scene and a vertical video plane.

## Run

```bash
pnpm electron:dev
```

## Build

```bash
pnpm build
pnpm start
```

## Scene Check

```bash
pnpm verify:scene
```

The scene uses orbit controls for camera rotation, pan, and zoom. The control dock can import video files, use a mirrored live webcam feed, pause/play imported videos, mute/unmute imported videos, reset the camera, hide/show both the video plane and floor plane, save, import, and export visual presets, automatically remember the latest visual settings, adjust the instanced 3D pixel grid by columns and rows, change instance spacing up to 400% while keeping the grid locked to the video size, apply grayscale and contrast effects to the video, scale instances by luminosity, flatten the instances, and replace the default sphere instance with an imported OBJ or STL symbol.
