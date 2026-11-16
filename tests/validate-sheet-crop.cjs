const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const sheet=require("../sheet-crop.js");
const root=path.resolve(__dirname,"..");
const read=name=>fs.readFileSync(path.join(root,name),"utf8");

// Geometry must remain normalized to the original sheet, even when a label is
// scanned from a small manual crop of the full photo.
const rect=sheet.normalRect({x:.7,y:.8,w:.6,h:.8});
assert.deepEqual(rect,{x:.7,y:.8,w:.30000000000000004,h:.19999999999999996});
const chosen=sheet.mapRect({x:.2,y:.1,w:.5,h:.6},{x:.1,y:.3,w:.4,h:.5});
assert.ok(Math.abs(chosen.x-.18)<1e-9);
assert.ok(Math.abs(chosen.y-.35)<1e-9);
assert.ok(Math.abs(chosen.w-.2)<1e-9);
assert.ok(Math.abs(chosen.h-.3)<1e-9);
const whole=sheet.mapRect({x:.1,y:.2,w:.3,h:.4});
assert.ok(Math.abs(whole.x-.1)<1e-9&&Math.abs(whole.w-.3)<1e-9);

function contains(out,barcode,dimensions){
  const {width,height}=dimensions;
  const centerX=(barcode.x+barcode.w/2)/width;
  const centerY=(barcode.y+barcode.h/2)/height;
  assert.ok(out.x<=centerX&&centerX<=out.x+out.w,"Crop must contain detected barcode horizontally");
  assert.ok(out.y<=centerY&&centerY<=out.y+out.h,"Crop must contain detected barcode vertically");
}
const horizontal={x:300,y:720,w:80,h:13};
const verticallyOriented={x:730,y:400,w:14,h:95};
contains(sheet.barcodeRegion(horizontal,1000,1800),horizontal,{width:1000,height:1800});
contains(sheet.barcodeRegion(verticallyOriented,1000,1800),verticallyOriented,{width:1000,height:1800});
const corner=sheet.barcodeRegion({x:1,y:1,w:60,h:18},600,800);
assert.ok(corner.x>=0&&corner.y>=0);
assert.ok(corner.x+corner.w<=1.00001&&corner.y+corner.h<=1.00001);

const js=read("sheet-crop.js");
const learning=read("barcode-learning.js");
const photoScanner=read("barcode-learning-scan.js");
const production=read("scanner.js");
const learnHtml=read("barcode-learning.html");
const indexHtml=read("index.html");
const deploy=read(".github/workflows/deploy-pages.yml");

assert.match(js,/new File\(\[blob\]/,"Crop must produce an actual rescan-able File");
assert.match(js,/naturalWidth/,"Crop must use full original photo dimensions");
assert.match(js,/imageSmoothingQuality="high"/);
assert.match(js,/contrast\(1\.28\)/);
assert.match(js,/pointerdown/);
assert.match(js,/pointermove/);
assert.match(js,/Scan full sheet/);
assert.match(js,/Use crop and rescan/);
assert.match(js,/sheet-editor-barcode/);
assert.match(js,/imageWidth/);

assert.ok(photoScanner.includes("sheetBox,barcodeBox"),"Learning detector must return original-sheet coordinates");
assert.ok(learning.includes("Find label & adjust crop"),"Learning requires per-label crop action");
assert.ok(learning.includes("prepareLearningPhotos"),"Learning photo should be cropped before scanning");
assert.ok(learning.includes("rereadManuallyCroppedLabel"),"Learning must rerun OCR on adjusted crop");
assert.ok(learning.includes("sheetPhotoUrl=fullUrl"),"Learning must retain the original sheet URL");
assert.ok(learning.includes("mapRect(label.sheetBox,meta.rect)"),
  "Learning detector bbox must map back to original sheet");
assert.ok(production.includes("chooseProductionSheetCrop"),"Production must support crop before scan");
assert.ok(production.includes("recropProductionLabel"),"Production must support source-sheet locate/recrop");
assert.ok(production.includes("sheetBox=editor.mapRect"),"Production must map scan region to full original sheet");
assert.ok(production.includes("await readLabelCloseup(result.file,entry)"),"Production must reread the edited crop");
assert.ok(production.includes("clearSourceSheets()"),"Production should release old source images");
assert.ok(learnHtml.indexOf('sheet-crop.js')<learnHtml.indexOf('barcode-learning-scan.js'));
assert.ok(indexHtml.indexOf('sheet-crop.js')<indexHtml.indexOf('scanner.js'));
assert.ok(deploy.includes("sheet-crop.js sheet-crop.css"));

console.log("Manual sheet crop checks passed: normalized geometry, horizontal/vertical label mask, original-resolution cropping, learning and production wiring, source cleanup, deployment.");
