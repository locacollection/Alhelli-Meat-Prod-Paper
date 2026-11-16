const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const parser=require("../barcode-learning-labels.js");
const photo=require("../barcode-learning-scan.js");
const core=require("../barcode-learning-core.js");
const samples=require("../fish-barcode-samples.js");
const p=samples.PRODUCTS["6668"];
function word(text,x,y,confidence=95){
  return {text,confidence,bbox:{x0:x-16,x1:x+16,y0:y-7,y1:y+7}};
}
assert.equal(parser.amount("0.020"),20);
assert.equal(parser.amount("8.750"),8750);
assert.equal(parser.amount("٠.٠٢٠"),20);
assert.equal(parser.amount("1.1234"),null);
assert.equal(parser.detectProduct("SALMON FILLET WITH SKIN FISH PER KG"),"6668");
assert.equal(parser.detectProduct("SALMON FISH BONE"),"7144");
assert.equal(parser.detectProduct("ATLANTIC SALMON FRESH SUPER"),"6376");
const printText="SALMON FILLET WITH SKIN WEIGHT 0.020 UNIT PRICE 8.750 TOTAL PRICE 0.175";
const testResult={data:{text:printText,words:[
  word("0.020",82,140),word("8.750",213,140),word("0.175",212,203),
  word("15/11/26",160,90),word("18/11/26",235,100)
]}};
const box={x:20,y:180,w:100,h:12};
const extracted=parser.detectPrinted(testResult,{barcodeBox:box});
assert.equal(extracted.weight_grams,20);
assert.equal(extracted.unit_price_fils,8750);
assert.equal(extracted.total_price_fils,175);
assert.equal(extracted.product_code,"6668");
assert.deepEqual(extracted.read_from_photo,{weight:true,unit:true,total:true});
const review=parser.review(extracted,p,"9666684001750",core,"966668");
assert.equal(review.complete,true,JSON.stringify(review.warnings));
assert.equal(review.barcode_price_fils,175);
assert.equal(review.warnings.length,0);
assert.equal(parser.derivePriceFromBarcode("9666684001750",core,"966668"),175);
assert.equal(parser.derivePriceFromBarcode("9666684001750",core,"966376"),null);
assert.equal(parser.derivePriceFromBarcode("9666684001751",core,"966668"),null);
const fallback=parser.detectPrinted({data:{text:
  "SALMON FILLET WITH SKIN\nWEIGHT 0.006\nUNIT PRICE 8.750\nTOTAL PRICE 0.055"}});
assert.equal(fallback.weight_grams,6);
assert.equal(fallback.unit_price_fils,8750);
assert.equal(fallback.total_price_fils,55);
const missing=parser.detectPrinted({data:{text:"SALMON FILLET WITH SKIN\nWEIGHT 0.020"}});
const missingChecked=parser.review(missing,p,"9666684001750",core,"966668");
assert.equal(missingChecked.weight_grams,20);
assert.equal(missingChecked.unit_price_fils,8750);
assert.equal(missingChecked.total_price_fils,175);
assert.ok(missingChecked.warnings.some(x=>x.includes("saved item rate")));
assert.ok(missingChecked.warnings.some(x=>x.includes("barcode")));
const conflicting=parser.review({...extracted,total_price_fils:180},p,"9666684001750",core,"966668");
assert.ok(conflicting.warnings.some(x=>/differs.*barcode/i.test(x)));
assert.equal(conflicting.complete,false);
const wrongRate=parser.review({...extracted,unit_price_fils:8800},p,
  "9666684001750",core,"966668");
assert.ok(wrongRate.warnings.some(x=>/unit price differs/i.test(x)));
const unknown=parser.review({weight_grams:null,unit_price_fils:null,total_price_fils:null,
  read_from_photo:{}},null,"",core,"");
assert.ok(unknown.warnings.some(x=>/weight unreadable/i.test(x)));
assert.equal(unknown.complete,false);
// This approximates the 5-up salmon photos; a barcode crop must not extend
// into the previous sticker's barcode/printed total.
const current={x:200,y:490,w:180,h:26};
const previous={x:210,y:270,w:170,h:24};
const bounds=parser.labelCropRegion(1000,1500,current,[previous,current]);
assert.ok(bounds.y>=previous.y+previous.h+4);
assert.ok(bounds.w>0&&bounds.h>0);
assert.equal(bounds.barcodeBox.x,current.x-bounds.x);
// The 7406 cheese example reported by the Android screenshot must be read
// from the photo: 0.460 kg, 2.100 BD/kg, 0.965 BD total.
const cheese=parser.detectPrinted({data:{text:
  "CHEES BRAMIL W/PEPR\nWEIGHT 0.460\nUNIT PRICE 2.100\nTOTAL PRICE 0.965"}});
assert.equal(cheese.weight_grams,460);
assert.equal(cheese.unit_price_fils,2100);
assert.equal(cheese.total_price_fils,965);
assert.deepEqual(parser.numericCandidates(" 0.460 "),[460]);
assert.deepEqual(parser.numericCandidates(" .965 BD "),[965]);
assert.deepEqual(parser.numericCandidates(" 2.100 "),[2100]);
assert.deepEqual(parser.numericCandidates(" 15/11/26 "),[]);
const cheeseBbox={x:50,y:200,w:130,h:18};
const numberAreas=["weight","unit","total"].map(kind=>
  parser.numericWindow(kind,cheeseBbox,650,400));
assert.ok(numberAreas.every(x=>x&&x.w>30&&x.h>20));
assert.ok(numberAreas[0].y<cheeseBbox.y);
assert.ok(numberAreas[2].y>numberAreas[0].y);
const improved=parser.supplementPrinted({
  weight_grams:null,unit_price_fils:null,total_price_fils:null,
  read_from_photo:{weight:false,unit:false,total:false}
},{weight:460,unit:2100,total:965});
assert.equal(improved.weight_grams,460);
assert.equal(improved.unit_price_fils,2100);
assert.equal(improved.total_price_fils,965);
assert.deepEqual(improved.read_from_photo,{weight:true,unit:true,total:true});
const mismatchOCR=parser.supplementPrinted({
  weight_grams:460,unit_price_fils:2100,total_price_fils:965,
  read_from_photo:{weight:true,unit:true,total:true}
},{weight:460,total:970});
assert.equal(mismatchOCR.total_price_fils,null);
assert.ok(mismatchOCR.ocr_conflicts.some(x=>x.includes("disagree")));
const cheeseProfile={item_code:"7406",product_name:"Cheese Bramli W/PEPR",
  weight_step_grams:5,unit_price_fils:2100,rounding_fils:5};
const checkedCheese=core.sampleCheck({
  barcode:"5874046009656",weight_grams:460,total_price_fils:965
},cheeseProfile);
assert.equal(checkedCheese.ok,true,JSON.stringify(checkedCheese));
// The photographed cheese barcode stores 0.965 BD rather than exact grams.
// At the saved 2.100 BD/kg rate, only 0.460 kg matches a 5 g increment.
const inferred=parser.inferUniqueWeight("5874046009656",cheeseProfile,core);
assert.equal(inferred.unique,true);
assert.equal(inferred.weight_grams,460);
assert.equal(inferred.price_fils,965);
assert.equal(inferred.source.includes("Verify"),true);
assert.equal(parser.inferUniqueWeight("5874046009650",cheeseProfile,core),null,
  "Bad EAN check digit must never provide a guess");
assert.equal(parser.inferUniqueWeight("5874046009656",
  {...cheeseProfile,barcode_prefix:"966668"},core),null,
  "Wrong saved prefix must never infer weight");
const oneGramCheese=parser.inferUniqueWeight("5874046009656",
  {...cheeseProfile,weight_step_grams:1},core);
assert.equal(oneGramCheese.unique,false);
assert.deepEqual(oneGramCheese.candidates,[459,460],
  "If the price matches two weights, both must be reported instead of guessing");
const lowRateBone=parser.inferUniqueWeight("9671449000053",{
  item_code:"7144",product_name:"Salmon Fish Bone",
  weight_step_grams:2,unit_price_fils:1000,rounding_fils:5
},core);
assert.equal(lowRateBone.unique,false,
  "The system must not infer exact low-price bone weight if multiple weights match");
const testLabels=[
  {barcode:"9666684001750",x:200,y:260,w:180,precision:3},
  {barcode:"9666684001750",x:201,y:265,w:180,precision:2},
  {barcode:"9666684001750",x:205,y:590,w:180,precision:3}
];
const unique=photo.uniquePositions(testLabels);
assert.equal(unique.length,2,"Separate stickers with identical price EANs must not be merged");
assert.ok(photo.barcodeFromZXing({
  getText:()=>"9666684001750",
  getResultPoints:()=>[
    {getX:()=>20,getY:()=>130},{getX:()=>220,getY:()=>130}]
},500,700).x===520);
const html=fs.readFileSync(path.join(__dirname,"..","barcode-learning.html"),"utf8");
const js=fs.readFileSync(path.join(__dirname,"..","barcode-learning.js"),"utf8");
for(const id of ["learnSinglePhoto","learnPhoto","learnScanProgress","learnPending"])
  assert.ok(html.includes('id="'+id+'"'));
for(const file of ["barcode-learning-scan.js","barcode-learning-labels.js"])
  assert.ok(html.includes(file));
for(const term of ["saveScannedLabel","photoEngine.readFile","readCameraFrame","Confirm & save label"])
  assert.ok(js.includes(term),"Missing functional OCR review: "+term);
const deploy=fs.readFileSync(path.join(__dirname,"..",".github/workflows/deploy-pages.yml"),"utf8");
for(const file of ["barcode-learning-scan.js","barcode-learning-labels.js"])
  assert.ok(deploy.includes(file),"New OCR module not deployed");
console.log("OCR label tests passed: field positions, printed numeric values, barcode cross-check, duplicate physical stickers, crop association and review.");
