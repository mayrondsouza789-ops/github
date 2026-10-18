// No dependencies: test the experimental rules against known pixel/control fixtures.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const context={module:{exports:{}},Uint8ClampedArray};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/demo-compare.js'),'utf8'),context);
const {checkPair,regionDifference}=context.module.exports;
const baseline={width:720,height:540,quality:{brightness:110,sharpness:200}},mask={cx:.5,cy:.32,area:.25};
assert.equal(checkPair(baseline,baseline,mask,mask).status,'no-warning');
for(const quality of [{brightness:30,sharpness:200},{brightness:220,sharpness:200},{brightness:140,sharpness:200},{brightness:110,sharpness:30}])assert.equal(checkPair(baseline,{...baseline,quality},mask,mask).status,'retake');
assert.equal(checkPair(baseline,{...baseline,width:1200},mask,mask).status,'retake');
assert.equal(checkPair(baseline,baseline,mask,{...mask,cx:.8}).status,'retake');
assert.equal(checkPair(baseline,baseline,mask,{...mask,area:.1}).status,'retake');
assert.equal(checkPair(baseline,baseline,mask,null).status,'retake');
const black=new Uint8ClampedArray(256*192*4),white=new Uint8ClampedArray(black.length).fill(255);
assert.equal(regionDifference(black,black,256,192).meanAbsoluteDifference,0);
assert.equal(regionDifference(black,white,256,192).meanAbsoluteDifference,255);
const changedOutsideGuide=black.slice();changedOutsideGuide[0]=255;
assert.equal(regionDifference(black,changedOutsideGuide,256,192).meanAbsoluteDifference,0);
console.log('Demo capture checks and region-difference controls passed. Not clinical validation.');
