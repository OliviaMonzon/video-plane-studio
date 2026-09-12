import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
async function capture(url) {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const readPixels=CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData=function(...args){const result=readPixels.apply(this,args);if(result.width===83&&result.height===88)window.samplePixels=Array.from(result.data);return result;};
  window.frames=new Map();window.frameId=0;window.testTime=0;window.videos=[];
  performance.now=()=>window.testTime;
  window.requestAnimationFrame=fn=>{window.frames.set(++window.frameId,fn);return window.frameId;};
  window.cancelAnimationFrame=id=>window.frames.delete(id);
  window.step=()=>{window.testTime+=34;const frames=[...window.frames.values()];window.frames.clear();for(const fn of frames)fn(window.testTime);};
  const create=document.createElement.bind(document);document.createElement=function(tag,...args){const el=create(tag,...args);if(tag==='video'){window.videos.push(el);el.addEventListener('play',()=>el.pause());}return el;};
  for(const name of ['bufferData','bufferSubData']) {const original=WebGL2RenderingContext.prototype[name];WebGL2RenderingContext.prototype[name]=function(...args){const data=args[name==='bufferData'?1:2];if(data instanceof Float32Array&&data.length===83*88*16)window.matrices=Array.from(data);return original.apply(this,args);};}
 });
 await page.goto(url);
 await page.getByRole('button',{name:'Apply Default 1',exact:true}).dispatchEvent('click');
 await page.waitForFunction(()=>window.videos.some(v=>v.readyState>=2),{},{polling:100});
 await page.waitForTimeout(4000);

 const samples=[];samples.pixels=[];
 for(let frame=0;frame<85;frame++) {
  const time=frame<35?0.1:((frame-35)%25)*0.25+0.1;
  await page.evaluate(async time=>{await Promise.all(window.videos.filter(v=>v.readyState>=2).map(async v=>{v.pause();if(Math.abs(v.currentTime-time)>0.0001)await new Promise(resolve=>{v.addEventListener('seeked',resolve,{once:true});v.currentTime=time;});}));window.step();window.step();},time);
  if(frame>=35) { samples.push(await page.evaluate(()=>window.matrices));samples.pixels.push(await page.evaluate(()=>window.samplePixels)); }
 }
 assert.deepEqual(errors,[]);assert(samples.every(s=>s?.length===83*88*16));
 await page.screenshot({path:url.endsWith('4174')?'/tmp/reference-preset1.png':'/tmp/restored-preset1.png'});
 await page.close();return samples;
}
try {
 const reference=await capture('http://127.0.0.1:4174');console.log('Reference: captured 50 video frames across two complete cycles.');
 const restored=await capture('http://127.0.0.1:4173');
 let maxError=0, maxScaleError=0, pixelError=0;
 for(let f=0;f<reference.length;f++)for(let i=0;i<reference.pixels[f].length;i++)pixelError=Math.max(pixelError,Math.abs(reference.pixels[f][i]-restored.pixels[f][i]));
 for(let f=0;f<reference.length;f++)for(let i=0;i<reference[f].length;i++){ maxError=Math.max(maxError,Math.abs(reference[f][i]-restored[f][i]));if(i%16<12)maxScaleError=Math.max(maxScaleError,Math.abs(reference[f][i]-restored[f][i])); }
 console.log(JSON.stringify({frames:reference.length,spheres:7304,maxTransformDifference:maxError,maxScaleError,pixelError}));
 assert(maxError<0.00001,'restored preset 1 must match the approved backup');
 console.log('PASS: restored preset 1 matches approved backup sphere transforms.');
} finally {await browser.close();}
