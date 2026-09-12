import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.backgroundSamples=[];
  const capture=data=>{
   if(!(data instanceof Float32Array)||data.length!==83*88*16)return;
   const t=performance.now();if(window.lastSample && t-window.lastSample<150)return;window.lastSample=t;
   const positions=[];
   // Interior of the blue sky: avoid the video boundary and moving subject.
   for(let row=3;row<13;row++)for(let col=10;col<70;col++){
    const offset=(row*83+col)*16;positions.push(data[offset+12],data[offset+13],data[offset+14]);
   }
   window.backgroundSamples.push({t,positions});
  };
  for(const proto of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype]){
   for(const name of ['bufferData','bufferSubData']){
    const original=proto[name];proto[name]=function(...args){capture(args[name==='bufferData'?1:2]);return original.apply(this,args);};
   }
  }
 });
 await page.goto(process.env.STUDIO_URL??'http://127.0.0.1:4173');
 await page.getByRole('button',{name:'Apply Default 1',exact:true}).click();
 if(process.env.DYNAMIC_COLLISIONS==='1') {
  await page.getByRole('button',{name:'Show controls',exact:true}).click();
  await page.getByRole('button',{name:'Collision Effector',exact:true}).click();
  await page.getByText('Dynamically aware collision',{exact:true}).click();
  assert(await page.getByLabel('Enable dynamically aware collision',{exact:true}).isChecked());
 }
 await page.waitForFunction(()=>window.backgroundSamples.length>0);
 const start=await page.evaluate(()=>performance.now());
 await page.waitForFunction(t=>performance.now()-t>20500,start,{timeout:35000});
 const samples=await page.evaluate(t=>window.backgroundSamples.filter(s=>s.t>t+6500),start);
 assert(samples.length>20,'must observe repeated rendered frames');
 let maxDrift=0;for(const s of samples)for(let i=0;i<s.positions.length;i++)maxDrift=Math.max(maxDrift,Math.abs(s.positions[i]-samples[0].positions[i]));
 console.log(JSON.stringify({samples:samples.length,backgroundSpheres:600,observationSeconds:14,maxPositionDrift:maxDrift,pageErrors:errors}));
 assert.equal(maxDrift,0,'blue background must remain stationary over two video loops');
 assert.deepEqual(errors,[]);
 await page.screenshot({path:'/tmp/studio-background-stable.png'});
} finally {await browser.close();}
