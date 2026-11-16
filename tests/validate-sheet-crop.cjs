const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const sheet=require("../sheet-crop.js");
const root=path.resolve(__dirname,"..");
const read=name=>fs.readFileSync(path.join(root,name),"utf8");

const rect=sheet.normalRect({x:.7,y:.8,w:.6,h:.8});
assert.deepEqual(rect,{x:.7,y:.8,w:.30000000000000004,h:.19999999999999996});
const chosen=sheet.mapRect({x:.2,y:.1,w:.5,h:.6},{x:.1,y:.3,w:.4,h:.5});
assert.ok(Math.abs(chosen.x-.18)<1e-9);
assert.ok(Math.abs(chosen.y-.35)<1e-9);
assert.ok(Math.abs(chosen.w-.2)<1e-9);
assert.ok(Math.abs(chosen.h-.3)<1e-9);
function equalRect(a,b,label){
  for(const axis of ["x","y","w","h"])
    assert.ok(Math.abs(a[axis]-b[axis])<1e-9,
      label+" "+axis+": "+a[axis]+" vs "+b[axis]);
}
const original={x:.13,y:.21,w:.29,h:.43};
for(const turns of [0,1,2,3]){
  const oriented=sheet.rotateRect(original,turns);
  equalRect(sheet.unrotateRect(oriented,turns),original,"rotation "+turns);
  equalRect(sheet.mapScanRect(oriented,{rect:{x:0,y:0,w:1,h:1},
    rotatedRect:{x:0,y:0,w:1,h:1},rotation:turns}),original,
    "full-sheet rotation "+turns);
}
const crop={x:.14,y:.18,w:.62,h:.46},local={x:.15,y:.2,w:.3,h:.45};
const cw=sheet.mapScanRect(local,{rect:crop,
  rotatedRect:sheet.rotateRect(crop,1),rotation:1});
equalRect(cw,{x:crop.x+local.y*crop.w,
  y:crop.y+(1-local.x-local.w)*crop.h,
  w:local.h*crop.w,h:local.w*crop.h},"clockwise crop");
const ccw=sheet.mapScanRect(local,{rect:crop,
  rotatedRect:sheet.rotateRect(crop,3),rotation:3});
equalRect(ccw,{x:crop.x+(1-local.y-local.h)*crop.w,
  y:crop.y+local.x*crop.h,
  w:local.h*crop.w,h:local.w*crop.h},"counterclockwise crop");

function contains(out,barcode,dimensions){
  const {width,height}=dimensions;
  const centerX=(barcode.x+barcode.w/2)/width;
  const centerY=(barcode.y+barcode.h/2)/height;
  assert.ok(out.x<=centerX&&centerX<=out.x+out.w,"Selected crop includes barcode center horizontally");
  assert.ok(out.y<=centerY&&centerY<=out.y+out.h,"Selected crop includes barcode center vertically");
}
const horizontal={x:300,y:720,w:80,h:13};
const vertical={x:730,y:400,w:14,h:95};
contains(sheet.barcodeRegion(horizontal,1000,1800),horizontal,{width:1000,height:1800});
contains(sheet.barcodeRegion(vertical,1000,1800),vertical,{width:1000,height:1800});
const corner=sheet.barcodeRegion({x:1,y:1,w:60,h:18},600,800);
assert.ok(corner.x>=0&&corner.y>=0);
assert.ok(corner.x+corner.w<=1.00001&&corner.y+corner.h<=1.00001);

const js=read("sheet-crop.js"),css=read("sheet-crop.css");
const learning=read("barcode-learning.js"),production=read("scanner.js");
const photoScanner=read("barcode-learning-scan.js");
const learnHtml=read("barcode-learning.html"),indexHtml=read("index.html");
const deploy=read(".github/workflows/deploy-pages.yml");
assert.match(js,/new File\(\[blob\]/,"Cropped scan should create a File");
assert.match(js,/naturalWidth/,"Use original image pixel dimensions");
assert.match(js,/imageSmoothingQuality="high"/);
assert.match(js,/contrast\(1\.28\)/);
assert.match(js,/pointerdown/);
assert.match(js,/pointermove/);
assert.match(js,/Scan full sheet/);
assert.match(js,/Use crop and rescan/);
assert.match(js,/sheet-editor-barcode/);
assert.match(js,/Rotate left/);
assert.match(js,/Rotate right/);
assert.match(js,/Add area for multi-scan/);
assert.match(js,/mode:"multi"/);
assert.match(js,/imageFile\(area,"selected-"/);
assert.match(js,/ctx\.drawImage\(originalImage,sx,sy,sw,sh/,
  "Always crop high-resolution ORIGINAL pixels rather than scaled preview");
assert.match(css,/sheet-editor-queued-area/);

assert.ok(photoScanner.includes("sheetBox,barcodeBox"),"Learning detector must return source positions");
assert.ok(learning.includes("Find label & adjust crop"),"Learning requires per-label crop action");
assert.ok(learning.includes("prepareLearningPhotos"),"Learning requires crop before scanning");
assert.ok(learning.includes("rereadManuallyCroppedLabel"),"Learning must rescan selected crop");
assert.ok(learning.includes("sheetPhotoUrl=fullUrl"),"Learning must preserve original photo");
assert.ok(learning.includes("mapScanRect(label.sheetBox,meta)"),
  "Learning detector must unrotate crop boxes to original image");
assert.ok(learning.includes('result.mode==="multi"?result.crops:[result]'),
  "Learning should accept multiple manual areas from one sheet");
assert.ok(production.includes("chooseProductionSheetCrop"),"Production must support pre-crop");
assert.ok(production.includes("recropProductionLabel"),"Production must support recrop");
assert.ok(production.includes("sheetBox=editor.mapScanRect"),
  "Production must unrotate crop boxes to source image");
assert.ok(production.includes('choice.mode==="multi"?choice.crops:[choice]'),
  "Production should accept multiple manual areas");
assert.ok(production.includes("sharedSheetId"),
  "Production multi-crops from one photo must retain shared sheet grouping");
assert.ok(production.includes("await readLabelCloseup(result.file,entry)"),
  "Production must OCR recropped label");
assert.ok(production.includes("clearSourceSheets()"),
  "Production should release old source images");
assert.ok(learnHtml.indexOf('sheet-crop.js')<learnHtml.indexOf('barcode-learning-scan.js'));
assert.ok(indexHtml.indexOf('sheet-crop.js')<indexHtml.indexOf('scanner.js'));
assert.ok(deploy.includes("sheet-crop.js sheet-crop.css"));

console.log("Rotatable multi-area sheet crop tests passed: 0/90/180/270 coordinates, source resolution, multi-label crop wiring, labels and Production Paper.");
