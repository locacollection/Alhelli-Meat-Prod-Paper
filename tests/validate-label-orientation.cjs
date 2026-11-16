const assert=require("node:assert/strict");
const photo=require("../barcode-learning-scan.js");
const parser=require("../barcode-learning-labels.js");
const rootSheet={width:1100,height:1600,angle:0,fromAngle:0,
  getContext(){return {drawImage(){}}}};
function fakeCanvas(){
  const c={width:0,height:0,angle:null,fromAngle:0};
  c.getContext=()=>({
    translate(){},
    rotate(rad){c.angle=rad},
    drawImage(src){c.fromAngle=src.angle??src.fromAngle??0}
  });
  return c;
}
global.document={createElement(tag){
  if(tag!=="canvas")throw new Error("Unexpected HTML element "+tag);
  return fakeCanvas();
}};
const vertical={barcode:"9671444000409",x:260,y:515,w:21,h:143,precision:3};
assert.deepEqual(photo.candidateAngles(vertical),[1,3]);
const cw=photo.rotatedBox(vertical,1100,1600,1);
assert.equal(cw.x,1600-515-143);
assert.equal(cw.y,260);
assert.equal(cw.w,143);
assert.equal(cw.h,21);
const ccw=photo.rotatedBox(vertical,1100,1600,3);
assert.equal(ccw.x,515);
assert.equal(ccw.y,1100-260-21);
assert.equal(ccw.w,143);
assert.equal(ccw.h,21);
const normal=photo.rotatedBox(cw,1600,1100,3);
assert.equal(normal.x,vertical.x);
assert.equal(normal.y,vertical.y);
assert.equal(normal.w,vertical.w);
assert.equal(normal.h,vertical.h);
const rotated=photo.rotateCanvas(rootSheet,3);
assert.equal(rotated.width,1600);
assert.equal(rotated.height,1100);
const sticker=photo.rotatedLabelCrop(rootSheet,vertical,[vertical],parser,3);
assert.ok(sticker.canvas.width>vertical.w*3,
  "Cropped sticker must use barcode's long dimension, not thin bar width");
assert.ok(sticker.canvas.height>vertical.h);
assert.ok(sticker.barcodeBox.w>sticker.barcodeBox.h);
assert.equal(sticker.turns,3);
const verticalDuplicates=[
  {...vertical,x:260,y:515},
  {...vertical,x:262,y:530},
  {...vertical,x:261,y:915}
];
const deduped=photo.uniquePositions(verticalDuplicates);
assert.equal(deduped.length,2,
  "Two readings from the same vertical EAN should merge, but separate labels remain distinct.");

// Regression for Android: stacked sheets with 6-9 labels and overlapping
// detection rectangles must never produce the thin one-column preview.
const stacked=Array.from({length:9},(_,i)=>({
  barcode:String(9667800000000+i),x:345+(i%2)*5,y:300+i*255,w:160,h:22,precision:3
}));
const mislocated={...stacked[2],barcode:"9667804093020",
  x:stacked[2].x+9,y:stacked[2].y+6,w:142,h:23};
for(const [i,region] of stacked.entries()){
  const crop=parser.labelCropRegion(1100,2800,region,[...stacked,mislocated]);
  assert.ok(crop.w>=1.85*region.w,
    "Label "+i+" crop must not be narrowed by a neighbouring barcode: "+JSON.stringify(crop));
  assert.ok(crop.h>=.93*region.w,
    "Label "+i+" crop should show its printed weight above the EAN: "+JSON.stringify(crop));
  assert.ok(crop.barcodeBox.x>=0&&crop.barcodeBox.x<=crop.w,
    "Barcode must remain inside the preview");
  assert.ok(crop.y<=region.y&&crop.y+crop.h>=region.y+region.h);
}
const crowded=parser.labelCropRegion(1100,1600,
  {x:300,y:700,w:150,h:19},
  [{x:311,y:704,w:150,h:20,barcode:"a"},
   {x:318,y:708,w:140,h:24,barcode:"b"},
   {x:300,y:440,w:150,h:20,barcode:"c"},
   {x:300,y:970,w:150,h:20,barcode:"d"}]);
assert.ok(crowded.w>=275&&crowded.h>140,
  "Same-location barcode hits cannot clip the whole product label.");
const thinDetectorBox=parser.labelCropRegion(1000,1600,
  {x:350,y:900,w:9,h:16},
  [{x:354,y:902,w:7,h:13}]);
assert.ok(thinDetectorBox.w>=190&&thinDetectorBox.h>=100,
  "Tiled barcode detector may see only a narrow stripe; show the surrounding sticker.");
const stackedRotated=photo.rotatedLabelCrop(rootSheet,
  {barcode:"9667804093020",x:260,y:515,w:21,h:143,precision:3},
  [{barcode:"other",x:261,y:510,w:20,h:145}],parser,3);
assert.ok(stackedRotated.canvas.width>=225&&stackedRotated.canvas.height>=130,
  "Sideways sticker must have a complete preview, not a narrow strip.");

const horizontal={...vertical,w:143,h:21};
assert.deepEqual(photo.candidateAngles(horizontal),[0,2]);
assert.ok(photo.labelRecognitionScore({data:{text:
  "SALMON FISH BONE WEIGHT 0.040 UNIT PRICE 1.000 TOTAL PRICE 0.040"}},parser,40).score>=15);
(async()=>{
  let runs=0;
  const worker={async recognize(crop){
    runs++;
    const upright=crop.fromAngle===-Math.PI/2;
    return {data:{text:upright?
      "SALMON FISH BONE WEIGHT 0.040 UNIT PRICE 1.000 TOTAL PRICE 0.040":
      "Text rotated upside down"}};
  }};
  const selected=await photo.chooseOrientedCrop(rootSheet,vertical,[vertical],
    parser,worker,new Map([[0,rootSheet]]),40);
  assert.equal(selected.turns,3,
    "OCR must select the direction that makes sideways sticker text upright.");
  assert.ok(selected.score>=15);
  assert.equal(selected.fields.product_code,"7144");
  assert.equal(selected.fields.weight_grams,40);
  assert.equal(selected.fields.total_price_fils,40);
  assert.ok(runs<=2);
  const html=require("node:fs").readFileSync(require("node:path").join(__dirname,"../barcode-learning.html"),"utf8");
  const app=require("node:fs").readFileSync(require("node:path").join(__dirname,"../barcode-learning.js"),"utf8");
  for(const id of ["learnOriginalPhotoDialog","learnOriginalImage","learnOriginalClose"]){
    assert.ok(html.includes('id="'+id+'"'),"Missing full sheet review element "+id);
  }
  assert.ok(app.includes("View original sheet"));
  assert.ok(app.includes("showOriginalPhoto(p)"));
  console.log("Label rotation passed: vertical barcode normalization, OCR-picked upright crop, deduplication, and original-sheet review.");
})().catch(e=>{console.error(e);process.exitCode=1});
