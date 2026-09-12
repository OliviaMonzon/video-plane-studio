import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';

// Exercise the production solver, including its persistent state, without WebGL.
const source = readFileSync(new URL('../src/components/ThreeViewport.tsx', import.meta.url), 'utf8');
const start = source.indexOf('    const resolveInstanceCollisions = (');
const end = source.indexOf('\n    const resize =', start);
assert(start >= 0 && end > start);
const columns = 83, rows = 88, count = columns * rows;
const state = { THREE, performance: { now: () => 2000 },
  SCREEN_WIDTH: 16, SCREEN_HEIGHT: 9,
  COLLISION_STARTUP_HOLD_MS: 250, COLLISION_STARTUP_RAMP_MS: 750,
  collisionWarmupStartedAt: 0, clamp01: x => Math.max(0, Math.min(1, x)),
  stableRandom: (a, b) => ((Math.sin(a * 12.9898 + b * 78.233) * 43758.5453) % 1 + 1) % 1,
  dotColumnsRef: { current: columns }, dotRowsRef: { current: rows },
  dynamicallyAwareCollisionRef: { current: false }, dynamicCollisionResponseRef: { current: 1 },
};
for (const name of ['Positions','Targets','Velocities']) state['collision'+name] = new Float32Array(count*3);
for (const name of ['Radii','ColorMotion','AudioMotion']) state['collision'+name] = new Float32Array(count);
for (const name of ['ImpulseCooldown','Initialized']) state['collision'+name] = new Uint8Array(count);
vm.createContext(state);
vm.runInContext(ts.transpile(source.slice(start,end)+'\nglobalThis.solve = resolveInstanceCollisions;', {target:ts.ScriptTarget.ES2022}),state);
const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1),new THREE.MeshBasicMaterial(),count);
const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), pos = new THREE.Vector3(), size = new THREE.Vector3();
function frame(phase, sparse=false) {
 for(let i=0;i<count;i++) {
  const x=i%columns, y=Math.floor(i/columns);
  pos.set(x*0.20,y*0.13,0);
  const radius=sparse ? 0.03 : 0.12 + 0.10*Math.max(0,Math.sin(x*0.4+phase)*Math.cos(y*0.2-phase));
  size.setScalar(radius); matrix.compose(pos,rotation,size); mesh.setMatrixAt(i,matrix);
 }
 state.solve(mesh,count,false);
 assert(state.collisionPositions.every(Number.isFinite),'positions must remain finite');
 return state.collisionPositions.slice();
}
const loop = Array.from({length:12},(_,i)=>frame(i*Math.PI/6));
for(let i=0;i<12;i++) {
 const next=frame(i*Math.PI/6);
 assert.deepEqual(next,loop[i],`frame ${i} must not retain drift from the previous loop`);
}
// Even a large existing displacement must clear on the next positional frame.
state.collisionPositions.fill(100);
assert.deepEqual(frame(0),loop[0]);
// Dynamic mode still preserves a bounce, then damps it rapidly when free.
state.dynamicallyAwareCollisionRef.current=true;
state.collisionInitialized.fill(0); frame(0,true);
state.collisionVelocities.fill(0.1);
frame(0,true);
assert(state.collisionVelocities.some(v=>v>0),'dynamic bounce should be preserved');
for(let i=0;i<30;i++) frame(0,true);
let error=0;
for(let i=0;i<count*3;i++) error=Math.max(error,Math.abs(state.collisionPositions[i]-state.collisionTargets[i]));
assert(error<0.001,`residual displacement ${error} exceeds tolerance`);
console.log(`PASS: ${count} spheres; identical positions across two loops; old scatter clears in one frame; dynamic bounce settles in 31 frames (max error ${error.toFixed(6)}).`);
