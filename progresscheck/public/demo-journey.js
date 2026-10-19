/* Fictional patient context, source-image comparison, and a controllable product tour. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const notes = {
    appearance: ['My starting crown photograph for this fictional check-in journey.', 'A sample follow-up to practice comparing the same view.', 'Another check-in. I want to inspect the focus before comparing it.', 'My fourth sample photograph, ready for a side-by-side review.'],
    unchanged: ['The starting photograph for the unchanged-image control.', 'The same source image is repeated to test consistent measurements.', 'No new photograph was taken. This is still the same control image.', 'All four entries use the same image, despite their fictional dates.'],
    lighting: ['The baseline reference for the capture-quality demonstration.', 'The baseline image is repeated for this sample check-in.', 'The baseline image is repeated again; this is not a new capture.', 'This generated example is deliberately dark to demonstrate a retake request.']
  };
  const scenes = [
    {id:'patient-profile', title:'Meet the demo patient', text:'Alex Morgan is fictional. This profile gives the sample check-ins a story; it is separate from account records.', time:7000},
    {id:'timeline', title:'Four weekly check-ins', text:'Each date is a sample entry. Select any week to inspect it. These dates do not represent an expected treatment timeline.', time:7000},
    {id:'compare-section', title:'Look closely at the source images', text:'Drag the divider or use the arrow keys on the slider. This reveals two original sample images; it does not align anatomy or measure growth.', time:8000},
    {id:'analysis-panel', title:'Run the image model', text:'The model measures hair-classified image area on this device, then the app checks capture conditions. The report opens only when this run succeeds.', time:1500},
    {id:'report', title:'Read the generated evidence', text:'The report separates the fictional story from actual measurements and capture warnings. Open the method details or download a PDF to inspect the evidence.', time:12000},
    {id:'mock-review', title:'Close the loop with a mock review', text:'This feedback is a scripted workflow example, not a clinician assessment. You can now try another scenario or replay the presentation.', time:10000}
  ];
  let api, view='slider', position=50, active=false, paused=false, scene=0, pending=false, failed=false, timer=null, animation=null, epoch=0;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function update(next) {
    $('#profile-scenario').textContent=next.scenario.title;
    $('#profile-checkins').replaceChildren(...next.samples.map((sample,i)=>{
      const button=document.createElement('button'); button.type='button'; button.dataset.profileWeek=i;
      button.setAttribute('aria-pressed',String(next.selected===i));
      const title=document.createElement('strong'); title.textContent=i?`Week ${i}`:'Baseline';
      const date=document.createElement('span'); date.textContent=sample.date;
      const check=next.result?.comparison.comparisons.find(c=>c.photoId===sample.id);
      const state=document.createElement('small'); state.textContent=check?.status==='retake'?'Retake needed':check?'Measured':'Sample ready';
      button.append(title,date,state);button.onclick=()=>api.selectWeek(i);return button;
    }));
    $('#profile-note-heading').textContent=`Week ${next.selected} · Fictional patient note`;
    $('#profile-note').textContent=notes[next.scenario.id][next.selected];
  }
  function setPosition(value) {
    position=Math.max(0,Math.min(100,Number(value)));
    $('#compare-reveal').style.setProperty('--reveal',position+'%');
    $('#comparison-range').value=String(Math.round(position));
    $('#comparison-range').setAttribute('aria-valuetext',`${Math.round(position)}% baseline, ${100-Math.round(position)}% selected week`);
  }
  function setView(value) {
    view=value;$('#comparison').hidden=value!=='side';$('#slider-comparison').hidden=value!=='slider';
    $('#view-side').setAttribute('aria-pressed',String(value==='side'));$('#view-slider').setAttribute('aria-pressed',String(value==='slider'));
  }
  function renderComparison({samples,selected,result,overlay,differences,region}) {
    const sample=samples[selected],observation=i=>result?.observations.find(o=>o.photoId===samples[i].id);
    const check=result?.comparison.comparisons.find(c=>c.photoId===sample.id);
    $('#reveal-baseline').src=samples[0].url;
    $('#reveal-current').src=sample.url;$('#reveal-current').alt=`Synthetic Week ${selected} crown photograph`;
    $('#reveal-current-label').textContent=`Week ${selected}`;
    $('#comparison-range-label').textContent=`Reveal baseline and Week ${selected}`;
    [['#reveal-baseline-mask',observation(0)?.maskUrl],['#reveal-current-mask',observation(selected)?.maskUrl]].forEach(([selector,url])=>{
      $(selector).hidden=!(overlay&&url);if(url)$(selector).src=url;else $(selector).removeAttribute('src');
    });
    $('#reveal-difference').hidden=!(differences&&check?.heatmap&&check.status!=='retake');
    if(check?.heatmap)$('#reveal-difference').src=check.heatmap;else $('#reveal-difference').removeAttribute('src');
    $('#reveal-guide').hidden=!region;
    $('#slider-caption').textContent=selected===0?'Both sides show the same baseline image.':`Baseline on the left; Week ${selected} on the right. Synthetic images, not anatomically aligned.`;
    setPosition(position);setView(view);
  }
  function clearMotion(){clearTimeout(timer);timer=null;cancelAnimationFrame(animation);animation=null;}
  function controls(message) {
    $('#tour-count').textContent=`${scene+1} / ${scenes.length}`;
    $('#tour-title').textContent=scenes[scene].title;
    $('#tour-description').textContent=message||scenes[scene].text;
    $('#tour-state').textContent=failed?'Needs another run':paused?'Paused':pending?'Analyzing':'Playing';
    $('#tour-pause').textContent=paused?'Resume':'Pause';$('#tour-pause').disabled=failed;
    $('#tour-back').disabled=scene===0||pending;
    $('#tour-next').disabled=pending;
    $('#tour-next').textContent=failed?'Retry analysis':scene===scenes.length-1?'Finish':'Next →';
    $('#play-presentation').disabled=active||api.isBusy();
  }
  function animateSlider() {
    if(reduced()||scene!==2||paused||!active)return;
    const start=performance.now();
    const frame=now=>{if(!active||paused||scene!==2)return;setPosition(50+30*Math.sin((now-start)/1500));animation=requestAnimationFrame(frame);};
    animation=requestAnimationFrame(frame);
  }
  function schedule() {
    clearMotion();if(!active||paused||pending||failed)return;
    timer=setTimeout(()=>scene===scenes.length-1?stop(true):enter(scene+1),scenes[scene].time);
    animateSlider();
  }
  async function enter(index) {
    clearMotion();scene=index;failed=false;
    const runEpoch=++epoch;
    document.querySelectorAll('.presentation-focus').forEach(el=>el.classList.remove('presentation-focus'));
    const target=document.getElementById(scenes[scene].id);target.classList.add('presentation-focus');
    if(scene===2){setView('slider');setPosition(50);}
    if(scene===5)api.openReview();
    target.setAttribute('tabindex','-1');
    target.scrollIntoView({behavior:reduced()?'instant':'smooth',block:'start'});
    if(scene===3){
      pending=true;controls();
      const success=await api.run();
      if(!active||epoch!==runEpoch)return;
      pending=false;
      if(!success){failed=true;paused=true;controls('This analysis did not finish. Retry it to continue, or exit the presentation. Any earlier completed report is preserved.');return;}
    }
    controls();schedule();
  }
  function start(){
    if(active||api.isBusy())return;
    active=true;paused=false;pending=false;failed=false;
    $('#presentation-toolbar').hidden=false;$('#presentation-complete').hidden=true;document.body.classList.add('presentation-active');
    enter(0);$('#tour-pause').focus({preventScroll:true});
  }
  function pause(){if(!active||paused)return;paused=true;clearMotion();controls();}
  function stop(finished=false){
    if(!active)return;
    const cancel=pending;
    active=false;pending=false;epoch++;clearMotion();
    document.body.classList.remove('presentation-active');document.querySelectorAll('.presentation-focus').forEach(el=>el.classList.remove('presentation-focus'));
    $('#presentation-toolbar').hidden=true;$('#presentation-complete').hidden=!finished;
    if(cancel)api.cancel();
    $('#play-presentation').disabled=api.isBusy();
    if(finished){$('#presentation-complete').setAttribute('tabindex','-1');$('#presentation-complete').focus({preventScroll:true});$('#presentation-complete').scrollIntoView({behavior:reduced()?'instant':'smooth',block:'center'});}
    else $('#play-presentation').focus({preventScroll:true});
  }
  function init(callbacks){
    api=callbacks;
    $('#view-slider').onclick=()=>setView('slider');$('#view-side').onclick=()=>setView('side');
    $('#comparison-range').oninput=e=>setPosition(e.target.value);
    const canvas=$('#compare-reveal');let pointer=null;
    const move=e=>{const box=canvas.getBoundingClientRect();setPosition(100*(e.clientX-box.left)/box.width);};
    canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;pointer=e.pointerId;canvas.setPointerCapture(pointer);move(e);$('#comparison-range').focus({preventScroll:true});});
    canvas.addEventListener('pointermove',e=>{if(e.pointerId===pointer)move(e);});
    canvas.addEventListener('pointerup',e=>{if(e.pointerId===pointer){pointer=null;canvas.releasePointerCapture(e.pointerId);}});
    canvas.addEventListener('pointercancel',()=>{pointer=null;});canvas.addEventListener('lostpointercapture',()=>{pointer=null;});
    $('#play-presentation').onclick=start;$('#replay-presentation').onclick=start;
    $('#tour-pause').onclick=()=>{if(paused){paused=false;controls();schedule();}else pause();};
    $('#tour-next').onclick=()=>{if(pending)return;if(failed)enter(3);else if(scene===scenes.length-1)stop(true);else enter(scene+1);};
    $('#tour-back').onclick=()=>{if(!pending&&scene>0)enter(scene-1);};$('#tour-exit').onclick=()=>stop();
    document.addEventListener('pointerdown',e=>{if(active&&!e.target.closest('#presentation-toolbar'))pause();},true);
    document.addEventListener('wheel',()=>pause(),{passive:true});
    document.addEventListener('click',e=>{if(active&&!pending&&e.target.closest('#run-analysis,#continue-analysis,#start-demo,#continue-compare,[data-step],#open-review,#finish-demo'))stop();},true);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active){stop();return;}if(active&&!e.target.closest('#presentation-toolbar')&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(e.key))pause();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  }
  window.DemoJourney={init,update,renderComparison,stop,get active(){return active;},busyChanged(){if(api)$('#play-presentation').disabled=active||api.isBusy();}};
})();
