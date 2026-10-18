/* Experimental capture checks and pixel differences, separate from ML segmentation. */
(function (root) {
  'use strict';
  const version = 'capture-checks-v1';
  const region = { cx: .5, cy: .32, rx: .15, ry: .18 };
  const limits = { brightnessDelta: 25, minBrightness: 45, maxBrightness: 215, aspectDelta: .05, centerShift: .08, areaRatioMin: .75, areaRatioMax: 1.33, minSharpnessRatio: .4, minSharpness: 65 };
  const round = n => Math.round(n * 100) / 100;
  function checkPair(a, b, maskA, maskB) {
    const reasons = [], aq = a.quality, bq = b.quality;
    const brightnessDelta = Math.abs(aq.brightness - bq.brightness);
    if (brightnessDelta > limits.brightnessDelta) reasons.push('Lighting changed substantially between these photographs.');
    if ([aq.brightness,bq.brightness].some(v=>v<limits.minBrightness||v>limits.maxBrightness)) reasons.push('At least one photograph is too dark or too bright for this demo’s capture checks.');
    if (Math.abs(a.width/a.height-b.width/b.height) > limits.aspectDelta) reasons.push('Image proportions differ. Repeat the same framing.');
    if (Math.min(aq.sharpness,bq.sharpness) < limits.minSharpness || Math.min(aq.sharpness,bq.sharpness)/Math.max(1,aq.sharpness,bq.sharpness) < limits.minSharpnessRatio) reasons.push('Image detail is low or differs substantially. Retake with a steady camera and consistent focus.');
    if (!maskA || !maskB) reasons.push('No usable hair mask was available to check framing.');
    else {
      if (Math.hypot(maskA.cx-maskB.cx,maskA.cy-maskB.cy)>limits.centerShift) reasons.push('The hair mask moved substantially within the frame. Match the head position.');
      const ratio=maskB.area/Math.max(maskA.area,.0001);
      if(ratio<limits.areaRatioMin||ratio>limits.areaRatioMax) reasons.push('The apparent hair-mask size changed substantially. Match camera distance and framing.');
    }
    return {status:reasons.length?'retake':'no-warning',reasons,brightnessDelta:round(brightnessDelta),alignmentVerified:false};
  }
  function regionDifference(a,b,width,height) {
    let sum=0,count=0;const heat=new Uint8ClampedArray(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      if(((x/width-region.cx)/region.rx)**2+((y/height-region.cy)/region.ry)**2>1)continue;
      const p=(y*width+x)*4,d=(Math.abs(a[p]-b[p])+Math.abs(a[p+1]-b[p+1])+Math.abs(a[p+2]-b[p+2]))/3;
      sum+=d;count++;
      if(d>=12){heat[p]=238;heat[p+1]=131;heat[p+2]=45;heat[p+3]=Math.min(210,80+d*2);}
    }
    return {meanAbsoluteDifference:round(sum/Math.max(1,count)),pixelCount:count,heat};
  }
  function maskStats(data,width,height) {
    let count=0,xSum=0,ySum=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]>0){count++;xSum+=x/width;ySum+=y/height;}
    return count?{cx:xSum/count,cy:ySum/count,area:count/(width*height)}:null;
  }
  async function pixels(url,signal) {
    const response=await fetch(url,{signal});if(!response.ok)throw Error('A comparison image could not be loaded.');
    const bitmap=await createImageBitmap(await response.blob());
    try{const canvas=document.createElement('canvas');canvas.width=256;canvas.height=192;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,256,192);return ctx.getImageData(0,0,256,192).data;}finally{bitmap.close();}
  }
  async function inspect(samples,result,{signal}={}) {
    const frames=await Promise.all(samples.map(s=>pixels(s.url,signal)));
    const observations=samples.map(s=>result.observations.find(o=>o.photoId===s.id));
    const masks=await Promise.all(observations.map(async o=>o.maskUrl?maskStats(await pixels(o.maskUrl,signal),256,192):null));
    const comparisons=observations.map((o,i)=>{
      const quality=checkPair(observations[0],o,masks[0],masks[i]);
      const difference=regionDifference(frames[0],frames[i],256,192);
      let heatmap=null;
      if(quality.status==='no-warning'){
        const c=document.createElement('canvas');c.width=256;c.height=192;c.getContext('2d').putImageData(new ImageData(difference.heat,256,192),0,0);heatmap=c.toDataURL('image/png');
      }
      return {photoId:samples[i].id,...quality,meanAbsoluteDifference:quality.status==='retake'?null:difference.meanAbsoluteDifference,regionPixels:difference.pixelCount,heatmap};
    });
    if(signal?.aborted)throw new DOMException('Analysis cancelled','AbortError');
    return {version,region,limits,normalization:'Images resized to 256 × 192; fixed normalized crown guide. No anatomical registration or exposure correction.',comparisons};
  }
  const api={version,region,limits,checkPair,regionDifference,maskStats,inspect};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DemoCompare=Object.freeze(api);
})(globalThis);
