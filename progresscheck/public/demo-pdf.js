(() => {
  'use strict';
  async function photo(url) {
    const response=await fetch(url);if(!response.ok)throw Error('A report photograph could not be loaded.');
    const bitmap=await createImageBitmap(await response.blob());
    try{const c=document.createElement('canvas');c.width=720;c.height=Math.round(720*bitmap.height/bitmap.width);c.getContext('2d').drawImage(bitmap,0,0,c.width,c.height);return {url:c.toDataURL('image/jpeg',.9),ratio:bitmap.height/bitmap.width};}finally{bitmap.close();}
  }
  async function download({scenario,samples,result,summary,review}) {
    if(!window.jspdf?.jsPDF)throw Error('The PDF library did not load. Reload the page and retry.');
    const images=await Promise.all(samples.map(s=>photo(s.url)));
    const pdf=new window.jspdf.jsPDF({unit:'mm',format:'a4',compress:true});
    pdf.setProperties({title:'ProgressCheck demo report - '+scenario.title,subject:'Synthetic image measurements; not medical advice',author:'ProgressCheck Demo'});
    const plain=s=>String(s).replace(/[→]/g,' to ').replace(/[–—−]/g,'-').replace(/[’‘]/g,"'").replace(/[“”]/g,'"').replace(/[·]/g,' | ').replace(/[^\x20-\x7e\n]/g,'');
    const text=(s,x,y,width=174,size=10,bold=false)=>{pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);const lines=pdf.splitTextToSize(plain(s),width);pdf.text(lines,x,y,{lineHeightFactor:1.35});return y+lines.length*size*.3528*1.35;};
    function header(subtitle){pdf.setFillColor(36,75,61);pdf.rect(0,0,210,29,'F');pdf.setTextColor(255,255,255);text('ProgressCheck  /  DEMO REPORT',18,13,174,15,true);text(subtitle,18,22,174,9);pdf.setTextColor(35,51,43);}
    function footer(n){pdf.setDrawColor(210,220,209);pdf.line(18,278,192,278);pdf.setTextColor(85,101,89);text('Synthetic photos | Experimental measurements | Not medical advice',18,284,155,8);text(n+' / 3',181,284,20,8);}
    header('01 / Summary and source images');
    let y=text(scenario.title,18,41,174,21,true);
    y=text(summary.heading,18,y+5,174,13,true);
    y=text(summary.text,18,y+5,174,10);
    y=text('Scenario design: '+scenario.story,18,y+5,174,9);
    y=Math.max(y+10,112);
    const h=Math.min(60,84*images[0].ratio);
    pdf.addImage(images[0].url,'JPEG',18,y,84,h);
    pdf.addImage(images[3].url,'JPEG',108,y,84,h);
    text('Week 0 - synthetic baseline',18,y+h+6,84,9,true);text('Week 3 - synthetic follow-up',108,y+h+6,84,9,true);
    y+=h+18;
    y=text('What the model can tell us',18,y,174,12,true);
    y=text('The model identifies hair-classified image pixels. It does not count follicles or measure density, regrowth or treatment effectiveness. Fuller-looking artwork can have a smaller hair mask.',18,y+4,174,10);
    text('Report generated: '+new Date(result.processedAt).toISOString(),18,y+7,174,8);
    footer(1);
    pdf.addPage();header('02 / Weekly measurements and capture checks');
    y=40;
    for(let i=0;i<samples.length;i++){
      const o=result.observations.find(o=>o.photoId===samples[i].id),c=result.comparison.comparisons[i];
      pdf.addImage(images[i].url,'JPEG',18,y,44,33);
      text('Week '+i+'  |  '+samples[i].date,68,y+4,120,11,true);
      text('Full-image hair mask: '+o.hairAreaPercent.toFixed(2)+'%',68,y+11,120,9);
      text(c.status==='retake'?'Comparison: RETAKE NEEDED':'Comparison: no capture warning (alignment not verified)',68,y+17,120,9);
      text(c.status==='retake'?c.reasons.join(' '):'Crown-guide pixel difference from baseline: '+c.meanAbsoluteDifference.toFixed(2)+' / 255. This is not a growth score.',68,y+24,120,8);
      y+=55;
    }
    footer(2);
    pdf.addPage();header('03 / Interpretation, review and traceability');
    y=text('Capture-check findings',18,42,174,15,true);
    const issues=[...new Set(result.comparison.comparisons.flatMap(c=>c.reasons))];
    y=text(issues.length?issues.join(' '):'No tested capture threshold was exceeded. Passing these checks does not establish that anatomical position, lighting or scale are truly matched.',18,y+5,174,10);
    y=text('Mock reviewer note - illustrative workflow',18,y+12,174,13,true);
    y=text(review||'No mock reviewer note has been opened for this report.',18,y+5,174,10);
    y=text('How the comparison works',18,y+12,174,13,true);
    y=text('Images are resized to a common 256 x 192 grid. The fixed elliptical crown guide is centered at 50% width and 32% height, with radii 15% width and 18% height. Mean absolute RGB difference is computed only inside that guide. Orange highlights mark pixels with an average channel difference of at least 12 / 255. No anatomical alignment or exposure correction is performed.',18,y+5,174,9);
    y=text('Capture thresholds are experimental: brightness difference >25 / 255, brightness outside 45-215, aspect-ratio difference >0.05, hair-mask center shift >0.08, mask area ratio outside 0.75-1.33, sharpness <65 or relative sharpness <0.4. These rules are not clinically validated. Failed comparisons suppress pixel-difference findings.',18,y+5,174,9);
    y=text('Traceability',18,y+12,174,13,true);
    y=text('Model: '+result.modelVersion+'\nExecuted: '+result.processedAt+'\nScenario: '+scenario.id+'\nCapture checks: '+result.comparison.version+'\nRuntime: '+result.delegate+' | '+result.processingMs+' ms',18,y+5,174,9);
    text('All dates and photographs are fictional. No clinical reviewer has assessed these images. This report must not guide diagnosis or treatment.',18,y+9,174,9,true);
    footer(3);
    pdf.save('ProgressCheck-'+scenario.id+'-demo-report.pdf');
  }
  window.DemoPDF=Object.freeze({download});
})();
