const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync("scanner.js","utf8");

class FakeElement {
  constructor(){this.value="";this.className="";this.textContent="";this.disabled=false;this.children=[];this.dataset={};this.classList={toggle(){},add(){},remove(){}}}
  replaceChildren(...v){this.children=v}
  append(...v){this.children.push(...v)}
  addEventListener(name,callback){this.listeners=this.listeners||{};this.listeners[name]=callback}
  querySelector(){return new FakeElement()}
  setAttribute(){}
  removeAttribute(){}
  style={}
}
const elements = new Map();
const getId=id=>{if(!elements.has(id))elements.set(id,new FakeElement());return elements.get(id)};
const doc = {
  getElementById:getId,
  createElement:(tag)=>{const e=new FakeElement();e.tagName=String(tag).toUpperCase();return e},
  querySelector:(q)=>q.includes("materialMode")?{value:"no-bones",checked:true}:new FakeElement(),
  querySelectorAll:()=>[]
};
const store = new Map();
const STORED_KEY="alhelli-label-scanner-v2";
// Simulate a real phone refreshing a page with labels from yesterday.
store.set(STORED_KEY,JSON.stringify([
  {barcode:"9667800031057",weight:"0.690",photoName:"old-sheet.jpg",cropKey:"old-crop"},
  {barcode:"9667770031903",weight:"1.000",kind:"bone",sheetId:"old-bone-sheet"}
]));
let urlCount=0;
const sandbox = {
  document:doc,window:{},
  URL:{createObjectURL:()=>("blob:label-"+(++urlCount)),revokeObjectURL:()=>{}},
  localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  console,Date,confirm:()=>true
};
vm.runInNewContext(source,sandbox,{filename:"scanner.js",timeout:2000});
assert.equal(store.has(STORED_KEY),false,"Every reload must erase saved labels");
assert.equal(getId("labelCount").textContent,"0 labels","Page starts with an empty sheet");
assert.equal(getId("issueTotal").textContent,"0.000 kg");
assert.equal(getId("mincedTotal").textContent,"0.000 kg");
assert.equal(getId("bonelessTotal").textContent,"0.000 kg");
assert.equal(getId("wasteTotal").textContent,"0.000 kg");
assert.equal(getId("printBtn").disabled,true);
assert.equal(getId("saveBtn").disabled,true);
assert.equal(getId("extraWeight").textContent,"0.000 kg");
assert.equal(getId("extraPrice").textContent,"0.000 BD");

assert.ok(source.includes('initialCropCleanup=cropStoreAction("clear")'),
  "Old IndexedDB sticker photos must be cleared on page initialization");
assert.ok(source.includes('operation==="clear"?store.clear()'),
  "The IndexedDB clear operation must delete existing crops");
assert.ok(!source.includes('restore();render();'),
  "Previous saved sheets must never be restored");
console.log("Refresh reset passed: old saved sheets removed and all current totals reset.");

const {decode,priceVerifier,checkDigit,roundedPrice,fixed3,verify,readUniqueDecimal,ocrFields,shouldAutoConfirm,encodeFromPrinted,fillCatalogUnit,catalogFromBarcode,fromBarcode,matchPrintedOCR,addLabel,totals,paperState,preparePaper,labelCropBounds,buildRow,keepLabelCrop,productionCalculation,insertManualEntry,groupBoneSheetRows,appendBoneReviewGroup,classifyPhotoBarcodes,addPhotos,scanTargetPercent,setScanTargets,setScanTargetState,beginScanStage,finishScanStage,scanStageHide}=sandbox.window.MeatProductionChecks;
assert.equal(readUniqueDecimal("WEIGHT 1.000"),"1.000");
assert.equal(readUniqueDecimal("UNIT PRICE 4.500"),"4.500");
assert.equal(readUniqueDecimal("1.000 4.500"),"");
const mincedOCR=ocrFields("PAKISTANI BEEF MIN KG\nWEIGHT 1.000 UNIT PRICE 4.500\nTOTAL PRICE 4.500",decode("9667802045007"));
assert.equal(mincedOCR.weight,"1.000");
assert.equal(mincedOCR.unit,"4.500");
assert.equal(mincedOCR.printed,"4.500");
const bonelessOCR=ocrFields("PAK BEEF W/OUT BONE\nWEIGHT 1.000 UNIT PRICE 4.500\nTOTAL PRICE 4.500",decode("9667812045004"));
assert.equal(bonelessOCR.weight,"1.000");
assert.equal(bonelessOCR.printed,"4.500");
assert.equal(fixed3("3.500"),3500);
assert.equal(fixed3("6.500"),6500);
assert.equal(fixed3("bad"),null);
assert.equal(roundedPrice(505,4500),2275);
assert.equal(roundedPrice(100,3190),320);
assert.equal(roundedPrice(3500,4500),15750);
assert.equal(roundedPrice(6500,4500),29250);
const samples=[
 ["9667771003206",null],
 ["9667800022758",2275],
 ["9667802045007",4500],
 ["9667812045004",4500],
 ["9667806157508",15750],
 ["9667818292501",29250]
];
for(const [code,price] of samples){
 if(price===null)continue;const data=decode(code);
 assert.equal(data.error,undefined,code+": "+data.error);
 assert.equal(data.price,price);
 assert.equal(priceVerifier(price),Number(code[6]));
 assert.equal(checkDigit(code.slice(0,12)),Number(code[12]));
}
for(const x of [
 {barcode:"9667806157508",weight:"3.500",unit:"4.500",printed:"15.750"},
 {barcode:"9667818292501",weight:"6.500",unit:"4.500",printed:"29.250"}
])assert.equal(verify(x).ok,true,JSON.stringify(verify(x)));
assert.equal(verify({barcode:"9667806157508",weight:"3.500",unit:"4.500",printed:"15.745"}).ok,false);
const missingWeight=verify({barcode:"9667812045004",weight:"",unit:"4.500",printed:"4.500"});
assert.equal(missingWeight.ok,false);
assert.match(missingWeight.reason,/Printed weight missing/);
assert.match(missingWeight.reason,/approximately 1.000 kg/);
assert.equal(verify({barcode:"9667812045004",weight:"1.000",unit:"4.500",printed:"4.500"}).ok,true);
const automaticMinced={barcode:"9667802045007",weight:"1.000",unit:"4.500",printed:"4.500"};
const automaticBoneless={barcode:"9667812045004",weight:"1.000",unit:"4.500",printed:"4.500"};
const recovered=fillCatalogUnit(decode("9667807018006"),{
  barcode:"9667807018006",weight:"0.400",printed:"1.800",unit:""
});
assert.equal(recovered.unit,"4.500");
assert.equal(recovered.unitSource,"catalog");
assert.equal(verify(recovered).ok,true);
assert.equal(fillCatalogUnit(decode("9667807018006"),{barcode:"9667807018006",weight:"0.500",printed:"1.800",unit:""}).unit,"");
assert.equal(fillCatalogUnit(decode("9667807018006"),{barcode:"9667807018006",weight:"0.400",printed:"1.805",unit:""}).unit,"");
assert.equal(fillCatalogUnit(decode("9667807018006"),{barcode:"9667807018006",weight:"0.400",printed:"1.800",unit:"5.000"}).unit,"5.000");
assert.equal(shouldAutoConfirm(automaticMinced,true,3),true);
assert.equal(shouldAutoConfirm(automaticBoneless,true,3),true);
assert.equal(shouldAutoConfirm(automaticMinced,false,3),false);
assert.equal(shouldAutoConfirm(automaticMinced,true,2),false);
assert.equal(shouldAutoConfirm({...automaticMinced,weight:"3.500"},true,3),false);
assert.equal(shouldAutoConfirm({...automaticBoneless,printed:"15.750"},true,3),false);
assert.equal(fixed3(automaticMinced.weight)+fixed3(automaticBoneless.weight),2000);

assert.equal(verify({barcode:"9667806157508",weight:"3.400",unit:"4.500",printed:"15.750"}).ok,false);
assert.equal(verify({barcode:"9667806157500",weight:"3.500",unit:"4.500",printed:"15.750"}).ok,false);
assert.equal(verify({barcode:"9667770031903",weight:"1.000",unit:"3.190",printed:"3.190"}).ok,true);

const printedLabelExamples=[
  ["6777",5,3190,"9667778000154"],
  ["6777",100,3190,"9667771003206"],
  ["6777",300,3190,"9667775009556"],
  ["6777",400,3190,"9667777012752"],
  ["6777",500,3190,"9667776015952"],
  ["6777",505,3190,"9667778016100"],
  ["6777",1000,3190,"9667770031903"],
  ["6777",1410,3190,"9667772045007"],
  ["6777",2000,3190,"9667779063806"],
  ["6777",2775,3190,"9667777088504"],
  ["6777",5000,3190,"9667774159504"],
  ["6777",5780,3190,"9667770184401"],
  ["6780",505,4500,"9667800022758"],
  ["6780",1000,4500,"9667802045007"],
  ["6781",1000,4500,"9667812045004"]
];
for(const [item,grams,unit,barcode] of printedLabelExamples){
  assert.equal(encodeFromPrinted(item,grams,unit),barcode,"Printed label example "+item+" "+grams+" g");
}
const exhaustive=new Set();
for(const [item,unit] of [["6777",3190],["6780",4500],["6781",4500]]){
  for(let grams=5;grams<=10000;grams+=5){
    const code=encodeFromPrinted(item,grams,unit);
    assert.match(code,/^\d{13}$/);
    assert.equal(checkDigit(code.slice(0,12)),Number(code[12]));
    assert.equal(priceVerifier(Number(code.slice(7,12))),Number(code[6]));
    assert.equal(exhaustive.has(code),false,"Unexpected duplicate "+code);
    exhaustive.add(code);
  }
}
assert.equal(exhaustive.size,6000);
assert.equal(encodeFromPrinted("6780",3500,4500),"9667806157508");
assert.equal(encodeFromPrinted("6781",6500,4500),"9667818292501");
console.log("Exhaustive EAN barcode audit passed: 6000 unique codes, 15 real printed-label matches.");


assert.equal(catalogFromBarcode("9667807018006").grams,400);
assert.equal(catalogFromBarcode("9667818036457").grams,810);
assert.equal(catalogFromBarcode("9667807018006").price,1800);
assert.equal(catalogFromBarcode("9667818036457").price,3645);
assert.equal(catalogFromBarcode("9667807018000").ok,false);
const firstBarcodeOnly=fromBarcode("9667807018006",{source:"barcode scan"});
const secondBarcodeOnly=fromBarcode("9667818036457",{source:"barcode scan"});
assert.equal(firstBarcodeOnly.weight,"0.400");
assert.equal(firstBarcodeOnly.unit,"4.500");
assert.equal(firstBarcodeOnly.printed,"1.800");
assert.equal(secondBarcodeOnly.weight,"0.810");
assert.equal(secondBarcodeOnly.printed,"3.645");
assert.equal(firstBarcodeOnly.confirmed,true);
assert.equal(secondBarcodeOnly.confirmed,true);
assert.equal(firstBarcodeOnly.weightSource,"catalog");
assert.equal(verify(firstBarcodeOnly).ok,true);
assert.equal(matchPrintedOCR(firstBarcodeOnly,{}).confirmed,true);
assert.equal(matchPrintedOCR(firstBarcodeOnly,{weight:"0.400",unit:"4.500",printed:"1.800"}).confirmed,true);
const ocrConflict=matchPrintedOCR(firstBarcodeOnly,{weight:"0.400",unit:"4.500",printed:"3.645"});
assert.equal(ocrConflict.confirmed,true);
assert.equal(ocrConflict.ocrConflict,"");
assert.match(ocrConflict.ocrWarning,/3.645/);
assert.equal(ocrConflict.weight,"0.400");
assert.equal(ocrConflict.printed,"1.800");
const realSecond=matchPrintedOCR(fromBarcode("9667800031057"),{
  weight:"0.690",unit:"4.500",printed:"3.108"
});
assert.equal(realSecond.confirmed,true);
assert.equal(realSecond.weight,"0.690");
assert.equal(realSecond.printed,"3.105");
assert.match(realSecond.ocrWarning,/3.108/);
assert.equal(realSecond.ocrConflict,"");
assert.equal(realSecond.weightSource,"catalog"); // OCR cannot overwrite catalog weight
assert.equal(verify({barcode:"9667800031057",weight:"0.691",unit:"4.500",printed:"3.105"}).ok,false);
assert.match(verify({barcode:"9667800031057",weight:"0.691",unit:"4.500",printed:"3.105"}).reason,/0.005 kg increments/);
assert.equal(verify({barcode:"9667800031057",weight:"0.685",unit:"4.500",printed:"3.105"}).ok,false);
assert.equal(fromBarcode("9667800031057",{
  barcode:"9667800031057",weight:"0.691",unit:"4.500",printed:"3.108",
  confirmed:true,autoConfirmed:false
}).weight,"0.690");
const ocrWeightIncorrect=matchPrintedOCR(fromBarcode("9667800031057"),{
  weight:"0.691",unit:"4.500",printed:"3.105"
});
assert.equal(ocrWeightIncorrect.confirmed,true);
assert.equal(ocrWeightIncorrect.weight,"0.690");
assert.equal(ocrWeightIncorrect.weightSource,"catalog");
assert.match(ocrWeightIncorrect.ocrWarning,/0.691/);

const realFourth=fromBarcode("9667808036450");
assert.equal(realFourth.confirmed,true);
assert.equal(realFourth.weight,"0.810");
assert.equal(decode(realFourth.barcode).code,"6780");
const productConflict=matchPrintedOCR(realFourth,{ocrProduct:"6781"});
assert.equal(productConflict.confirmed,false);
assert.match(productConflict.ocrConflict,/Product category/);
const fourMinced=[
  "9667807018006",
  "9667800031057",
  encodeFromPrinted("6780",740,4500),
  "9667808036450"
];
assert.equal(fourMinced.reduce((sum,code)=>sum+catalogFromBarcode(code).grams,0),2640);
assert.ok(fourMinced.every(code=>catalogFromBarcode(code).info.code==="6780"));
console.log("4-label photo audit passed: minced 2.640 kg, OCR 3.108 false reading ignored.");
const noOCRNeeded=matchPrintedOCR(secondBarcodeOnly,{});
assert.equal(noOCRNeeded.confirmed,true);
assert.equal(noOCRNeeded.weight,"0.810");
// Check that the production paper aggregates barcode-derived labels without OCR.
// Reset previous demo entries left in the mock UI.
addLabel({barcode:"9667807018006",source:"barcode scan"});
addLabel({barcode:"9667818036457",source:"barcode scan"});
const productionTotals=totals();
assert.equal(productionTotals.m,400);
assert.equal(productionTotals.b,810);
const productionPaper=paperState();
assert.equal(productionPaper.original,1210);
assert.equal(productionPaper.waste,0);
assert.equal(productionPaper.error,"");

// The official-looking A4 form prints only aggregate Recipe Issue and Recipe GRN rows.
// It must not print each scanned sticker as its own line.
const printableHtml=fs.readFileSync("index.html","utf8");
const paperSection=printableHtml.slice(printableHtml.indexOf('<section id="printPaper"'),printableHtml.indexOf('</section>',printableHtml.indexOf('<section id="printPaper"')));
assert.ok(paperSection.includes('Recipe Issue (Sub Contract PO)'));
assert.ok(paperSection.includes('Recipe GRN (Bundling)'));
assert.ok(!paperSection.includes('ppLabels'));
assert.ok(!paperSection.includes('EAN-13'));
preparePaper();
assert.equal(getId("ppIssueRows").children.length,10);
assert.equal(getId("ppIssueRows").children[0].children[0].textContent,"6777");
assert.equal(getId("ppIssueRows").children[0].children[3].textContent,"1.210");
assert.equal(getId("ppGrn").children.length,9);
assert.equal(getId("ppGrn").children[0].children[0].textContent,"6780");
assert.equal(getId("ppGrn").children[0].children[3].textContent,"0.400");
assert.equal(getId("ppGrn").children[1].children[0].textContent,"6781");
assert.equal(getId("ppGrn").children[1].children[3].textContent,"0.810");
assert.equal(getId("ppGrn").children[2].children[1].textContent,"");

// Date-based paper snapshots must contain checked, complete production quantities.
// Value information counts only finished 6780 and 6781 labels, not original 6777 twice.
assert.ok(source.includes("window.MeatProductionApp={paperSnapshot,preparePaper,paperState}"));
const pageHtml=fs.readFileSync("index.html","utf8");
for(const id of ["printBtn","saveBtn","paperPreviewDialog","savePaperDialog","savedPaperList","extraWeight","extraPrice"])
  assert.ok(pageHtml.includes('id="'+id+'"'),"Missing paper UI "+id);
assert.ok(!pageHtml.includes("Print production paper / Save PDF"));
assert.ok(pageHtml.includes("Preview Paper")&&pageHtml.includes("Save Paper"));
assert.ok(pageHtml.includes('id="alsoPdf"'),"Optional PDF checkbox must exist");
console.log("A4 store-form print tests passed: 6777 issue, 6780/6781 GRN, no individual sticker rows.");
const explicitWrongWeight=addLabel({barcode:"9667800031057",weight:"0.691",
  unit:"4.500",printed:"3.108",confirmed:true});
assert.equal(explicitWrongWeight.weight,"0.690");
assert.equal(explicitWrongWeight.printed,"3.105");
assert.equal(verify(explicitWrongWeight).ok,true);

console.log("Barcode-first scanner checks passed: catalog 0.400 + 0.810 kg, OCR optional, GRN/issue 1.210 kg.");

// Combined paper: normal 8 kg output plus separately labelled bone-in 5 -> 3 kg.
const scanEntry=(item,grams,kind,sheetId)=>fromBarcode(encodeFromPrinted(item,grams,item==="6777"?3190:4500),
  {kind,sheetId,source:"test"});
const mixedEntries=[
  scanEntry("6780",2000,"normal","normal-1"),
  scanEntry("6781",6000,"normal","normal-1"),
  scanEntry("6777",5000,"bone","bone-1"),
  scanEntry("6780",3000,"bone","bone-1")
];
const separated=groupBoneSheetRows(mixedEntries.filter(e=>e.kind==="bone").map((entry,index)=>({entry,index})));
assert.equal(separated.length,1);
assert.equal(separated[0].number,1);
assert.equal(separated[0].rows.length,2);
const separateCards=[buildRow(mixedEntries[2],2),buildRow(mixedEntries[3],3)];
const flattened=(node)=>[node,...(node.children||[]).flatMap(flattened)];
const origID=flattened(separateCards[0]).find(node=>node.className==="label-item-code");
const outID=flattened(separateCards[1]).find(node=>node.className==="label-item-code");
assert.equal(origID.textContent,"6777");
assert.equal(outID.textContent,"6780");
assert.ok(separateCards[0].className.includes("product-6777"));
assert.ok(separateCards[1].className.includes("product-6780"));
assert.ok(flattened(separateCards[0]).some(node=>node.className==="label-item-role"&&node.textContent.includes("ORIGINAL")));
assert.ok(flattened(separateCards[1]).some(node=>node.className==="label-item-role"&&node.textContent.includes("MINCED")));
assert.ok(!flattened(separateCards[0]).some(node=>node.className==="label-evidence"||node.className==="label-source-photo"));
assert.ok(!flattened(separateCards[1]).some(node=>node.className==="label-evidence"||node.className==="label-source-photo"));
const bonelessCard=buildRow(scanEntry("6781",6000,"normal","normal-1"),4);
assert.equal(flattened(bonelessCard).find(node=>node.className==="label-item-code").textContent,"6781");
const boneSheetWrapper=new FakeElement();
appendBoneReviewGroup(boneSheetWrapper,"sheet-A",mixedEntries.slice(2).map((entry,index)=>({entry,index})));
assert.equal(boneSheetWrapper.children.length,1);
assert.ok(flattened(boneSheetWrapper.children[0]).some(node=>node.className==="processing-portion"));
// The same scan control accepts both label-sheet formats.
const normalCodes=[
  encodeFromPrinted("6780",2000,4500),
  encodeFromPrinted("6781",6000,4500)
];
const boneCodes=[
  encodeFromPrinted("6777",5000,3190),
  encodeFromPrinted("6780",3000,4500)
];
assert.equal(classifyPhotoBarcodes(normalCodes),"normal");
assert.equal(classifyPhotoBarcodes(boneCodes),"bone");
assert.equal(classifyPhotoBarcodes([...normalCodes,...boneCodes]),"bone");
assert.equal(classifyPhotoBarcodes([]),"normal");
assert.equal(classifyPhotoBarcodes([normalCodes[0],encodeFromPrinted("6777",5000,3190)]),"bone");
assert.equal(typeof addPhotos,"function");
const oneScanHtml=fs.readFileSync("index.html","utf8");
assert.equal((oneScanHtml.match(/id="sheetPhotos"/g)||[]).length,1);
assert.equal((oneScanHtml.match(/id="cameraPhoto"/g)||[]).length,1);
assert.equal(oneScanHtml.includes('id="bonePhotos"'),false);
assert.equal(oneScanHtml.includes('id="boneCamera"'),false);
assert.equal(oneScanHtml.includes('class="source-cards"'),false);
assert.ok(oneScanHtml.includes('unified-scan'));
const oneScanJS=fs.readFileSync("scanner.js","utf8");
assert.ok(!oneScanJS.includes('$("bonePhotos").addEventListener'));
assert.ok(!oneScanJS.includes('$("boneCamera").addEventListener'));
console.log("Unified scanner tests passed: normal and bone-in sheets auto-classified from barcodes.");

const mixed=productionCalculation(mixedEntries);
assert.equal(mixed.error,"");
assert.equal(mixed.normalOriginal,8000);
assert.equal(mixed.boneOriginal,5000);
assert.equal(mixed.original,13000);
assert.equal(mixed.m,5000);
assert.equal(mixed.b,6000);
assert.equal(mixed.waste,2000);
assert.equal(mixed.batches.length,1);
assert.equal(mixed.batches[0].waste,2000);
assert.equal(mixed.original,mixed.m+mixed.b+mixed.waste);
assert.equal(mixed.boneSheets,1);
// The photograph has TWO ordered 6777 -> 6780 pairs on ONE physical sheet.
const photoPairs=[
  scanEntry("6777",3745,"bone","photo-A"),
  scanEntry("6780",2800,"bone","photo-A"),
  scanEntry("6777",4400,"bone","photo-A"),
  scanEntry("6780",3085,"bone","photo-A")
];
const portions=groupBoneSheetRows(photoPairs.map((entry,index)=>({entry,index})));
assert.equal(portions.length,2);
assert.deepEqual(Array.from(portions,x=>x.number),[1,2]);
assert.deepEqual(Array.from(portions,x=>x.rows.length),[2,2]);
assert.equal(portions[1].rows[0].entry.weight,"4.400");
const samePortion=groupBoneSheetRows([
  scanEntry("6777",4000,"bone","one"),
  scanEntry("6780",2500,"bone","one"),
  scanEntry("6781",1000,"bone","one")
].map((entry,index)=>({entry,index})));
assert.equal(samePortion.length,1);
assert.equal(samePortion[0].rows.length,3);
const fromPhoto=productionCalculation(photoPairs);
assert.equal(fromPhoto.error,"");
assert.equal(fromPhoto.original,8145);
assert.equal(fromPhoto.m,5885);
assert.equal(fromPhoto.b,0);
assert.equal(fromPhoto.waste,2260);
assert.deepEqual([...fromPhoto.batches.map(x=>x.waste)],[945,1315]);
assert.equal(fromPhoto.batches.length,2);
// A rare boneless output from an originally bone-in piece is included too.
const boneWithBoneless=productionCalculation([
  scanEntry("6777",4000,"bone","B"),
  scanEntry("6780",2500,"bone","B"),
  scanEntry("6781",1000,"bone","B")
]);
assert.equal(boneWithBoneless.waste,500);
assert.equal(boneWithBoneless.b,1000);
assert.equal(boneWithBoneless.error,"");
// Do not silently infer output or ignore unpaired/negative bone-in batches.
assert.match(productionCalculation([scanEntry("6780",3000,"bone","B")]).error,/before its 6777/);
assert.match(productionCalculation([scanEntry("6777",5000,"bone","B")]).error,/no finished/);
assert.match(productionCalculation([
  scanEntry("6777",3000,"bone","B"),scanEntry("6780",3500,"bone","B")
]).error,/more finished/);
assert.match(productionCalculation([scanEntry("6777",5000,"normal","N")]).error,/normal-production/);
assert.match(productionCalculation([
  scanEntry("6777",5000,"bone","B1"),scanEntry("6780",3000,"bone","B1"),
  scanEntry("6780",2000,"bone","B2")
]).error,/before its 6777/);
assert.equal(productionCalculation([
  scanEntry("6780",2000,"normal","normal-1"),scanEntry("6781",6000,"normal","normal-1")
]).waste,0);
assert.equal(decode(encodeFromPrinted("6777",3745,3190)).code,"6777");
console.log("Combined production checks passed: normal 8 + bone-in 5 -> issue 13, GRN 5/6, wastage 2; 2 original pairs verified.");

// Print one summary paper for the mixed source case.
getId("clearLabels").listeners.click();
for(const e of mixedEntries)addLabel(e);
assert.equal(paperState().error,"");
assert.equal(paperState().original,13000);
assert.equal(paperState().waste,2000);
preparePaper();
assert.equal(getId("ppIssueRows").children[0].children[3].textContent,"13.000");
assert.equal(getId("ppGrn").children[0].children[0].textContent,"6780");
assert.equal(getId("ppGrn").children[0].children[3].textContent,"5.000");
assert.equal(getId("ppGrn").children[1].children[0].textContent,"6781");
assert.equal(getId("ppGrn").children[1].children[3].textContent,"6.000");
assert.equal(getId("ppGrn").children[2].children[1].textContent,"Wastage for Meat");
assert.equal(getId("ppGrn").children[2].children[3].textContent,"2.000");
console.log("Single A4 issue/GRN print passed for combined normal and bone-in sheets.");
const conciseHtml=fs.readFileSync("index.html","utf8");
for(const removed of ["Step 1","Step 2","Step 3","Combined example","Both workflows, one paper",
  'class="intro"','class="combined-method"','id="sampleBtn"','id="balanceText"',
  "Review that all stickers were detected","Tap Preview label","The site combines them into one production paper"]){
  assert.equal(conciseHtml.includes(removed),false,"Unnecessary operator instruction remains: "+removed);
}
for(const required of ['id="sheetPhotos"','id="cameraPhoto"','id="labels"','id="paperWarning"',
  'id="printPaper"','id="ppIssueRows"','id="ppGrn"','id="issueTotal"','id="mincedTotal"',
  'id="bonelessTotal"','id="wasteTotal"']){
  assert.ok(conciseHtml.includes(required),"Required control or paper field missing: "+required);
}
const simplifiedJs=fs.readFileSync("scanner.js","utf8");
assert.ok(!simplifiedJs.includes('$("sampleBtn").addEventListener'));
assert.ok(!simplifiedJs.includes('$("originalWeight").addEventListener'));
assert.ok(!simplifiedJs.includes('show("balanceText"'));
const slimCard=buildRow(scanEntry("6777",3745,"bone","bone-1"),0);
assert.ok(!flattened(slimCard).some(node=>node.className==="label-evidence"||node.className==="label-source-photo"));
assert.ok(flattened(slimCard).some(node=>node.className==="label-item-code"&&node.textContent==="6777"));
assert.ok(flattened(slimCard).some(node=>node.className==="label-price-details"),"Audit details remain available");
console.log("Concise UI checks passed: no instructional panels, all scan/print controls and errors retained.");


// Manual recovery: choosing bone-in starts with 6777 and inserts before
// a previously scanned finished label if the original sticker was missed.
getId("clearLabels").listeners.click();
getId("manualSource").value="bone-new";
assert.match(insertManualEntry(encodeFromPrinted("6780",3000,4500)).error,/must begin/);
const addedOriginal=insertManualEntry(encodeFromPrinted("6777",5000,3190));
assert.ok(addedOriginal.entry);
const sid=addedOriginal.entry.sheetId;
assert.ok(sid);
getId("manualSource").value="bone:"+sid;
const addedOutput=insertManualEntry(encodeFromPrinted("6780",3000,4500));
assert.ok(addedOutput.entry);
assert.equal(productionCalculation([addedOriginal.entry,addedOutput.entry]).waste,2000);
console.log("Manual source/pair sequence tests passed.");
getId("clearLabels").listeners.click();

// Crop geometry keeps each label separate when barcode positions are stacked.
const imgSize={width:1000,height:1600};
const topRegion={barcode:"9667807018006",x:235,y:355,w:190,h:42};
const lowerRegion={barcode:"9667800031057",x:250,y:650,w:192,h:42};
const bottomRegion={barcode:"9667808036450",x:250,y:1080,w:190,h:42};
const firstRect=labelCropBounds(imgSize,topRegion,[topRegion,lowerRegion,bottomRegion]);
const secondRect=labelCropBounds(imgSize,lowerRegion,[topRegion,lowerRegion,bottomRegion]);
assert.ok(firstRect.w>190 && firstRect.h>42);
assert.ok(firstRect.y+firstRect.h<=topRegion.y+topRegion.h+30);
assert.ok(secondRect.y>=topRegion.y+topRegion.h);
assert.ok(secondRect.y<lowerRegion.y);
assert.ok(secondRect.y+secondRect.h<=lowerRegion.y+lowerRegion.h+30);
// Repeated barcode labels must never share the same thumbnail key.
const stickerA=addLabel({barcode:"9667807018006",photoName:"sheet1.jpg"});
const stickerB=addLabel({barcode:"9667807018006",photoName:"sheet1.jpg"});
assert.notEqual(stickerA.id,stickerB.id);
const beforeImageTotal=totals().m;
(async()=>{
  await keepLabelCrop(stickerA,{size:22000},"auto");
  await keepLabelCrop(stickerB,{size:18000},"auto");
  assert.ok(stickerA.cropUrl.startsWith("blob:label-"));
  assert.ok(stickerB.cropUrl.startsWith("blob:label-"));
  assert.notEqual(stickerA.cropKey,stickerB.cropKey);
  assert.notEqual(stickerA.cropUrl,stickerB.cropUrl);
  assert.equal(totals().m,beforeImageTotal);
  const persisted=JSON.parse(store.get("alhelli-label-scanner-v2"));
  assert.equal(persisted[persisted.length-2].cropKey,stickerA.cropKey);
  assert.equal(persisted[persisted.length-1].cropKey,stickerB.cropKey);
  assert.equal(JSON.stringify(persisted).includes("blob:label-"),false);
  const readOnlyCard=buildRow(fromBarcode("9667800031057"),1);
  const elements=(node)=>[node,...(node.children||[]).flatMap(elements)];
  const readOnlyNodes=elements(readOnlyCard);
  assert.ok(readOnlyNodes.some(node=>node.className==="label-barcode"&&node.textContent==="9667800031057"));
  assert.ok(readOnlyNodes.some(node=>node.className==="label-value-number"),"Card must display values as text");
  assert.ok(readOnlyNodes.some(node=>node.tagName==="STRONG"&&node.textContent==="0.690"));
  assert.ok(readOnlyNodes.some(node=>node.tagName==="STRONG"&&node.textContent==="3.105"));
  assert.ok(readOnlyNodes.some(node=>node.tagName==="STRONG"&&node.textContent==="4.500"));
  const primary=readOnlyNodes.find(node=>node.className==="label-primary");
  assert.ok(primary,"Barcode and weight should be displayed together");
  assert.ok(elements(primary).some(node=>node.tagName==="STRONG"&&node.textContent==="0.690"));
  assert.ok(!elements(primary).some(node=>node.tagName==="STRONG"&&node.textContent==="3.105"),
    "Total price must not be visible in the primary scan result");
  assert.ok(!elements(primary).some(node=>node.tagName==="STRONG"&&node.textContent==="4.500"),
    "Unit price must not be visible in the primary scan result");
  const pricePanels=readOnlyNodes.filter(node=>node.className==="label-price-details");
  assert.equal(pricePanels.length,1,"Every label should have one optional price panel");
  assert.equal(pricePanels[0].tagName,"DETAILS");
  assert.notEqual(pricePanels[0].open,true,"Price details should remain collapsed by default");
  assert.equal(pricePanels[0].children[0].tagName,"SUMMARY");
  assert.equal(pricePanels[0].children[0].textContent,"Price details");
  assert.ok(elements(pricePanels[0]).some(node=>node.tagName==="STRONG"&&node.textContent==="3.105"),
    "The total price must remain available for audit on demand");
  assert.ok(elements(pricePanels[0]).some(node=>node.tagName==="STRONG"&&node.textContent==="4.500"),
    "The unit price must remain available for audit on demand");
  assert.ok(!readOnlyNodes.some(node=>node.className==="label-overview"),
    "No always-expanded price grid should remain");
  assert.equal(readOnlyNodes.filter(node=>node.tagName==="INPUT"&&node.type==="text").length,0,
    "There must be no editable text boxes in any label card");
  assert.equal(readOnlyNodes.filter(node=>node.tagName==="INPUT"&&node.type==="number").length,0,
    "There must be no editable number boxes in any label card");
  assert.ok(readOnlyNodes.some(node=>node.className==="mini label-preview-button"),
    "Preview remains available on the read-only card");
  const website=fs.readFileSync("index.html","utf8");
  assert.ok(website.includes('id="manualBarcodeForm"'),"Manual barcode-only form should remain available");
  assert.ok(website.includes('id="manualBarcode"'));
  console.log("Read-only card tests passed: barcode and numeric results shown without editable input fields.");
  const previewCard=buildRow(stickerA,0);
  const previewButtons=elements(previewCard).filter(el=>el.className==="mini label-preview-button");
  assert.equal(previewButtons.length,1,"Each label should have exactly one preview button");
  const previewButton=previewButtons[0];
  assert.ok(previewButton,"Each label should have exactly one preview button");
  assert.equal(previewButton.textContent,"Preview label");
  assert.equal(previewButton.disabled,false);
  assert.equal(typeof previewButton.listeners.click,"function");
  assert.equal(previewCard.children.some(el=>el.className==="label-crop-inline"),false);
  const noPhotoRecord=addLabel({barcode:"9667802045007"});
  const noPhotoCard=buildRow(noPhotoRecord,0);
  const disabledPreview=elements(noPhotoCard).find(el=>el.className==="mini label-preview-button");
  assert.ok(disabledPreview);
  assert.equal(disabledPreview.disabled,true);
  const siteJs=fs.readFileSync("scanner.js","utf8");
  assert.ok(!siteJs.includes("scan-gallery"));
  assert.ok(!siteJs.includes("createReviewTile("));
  assert.ok(!siteJs.includes('className="label-crop-inline"'));
  const html=fs.readFileSync("index.html","utf8");
  assert.ok(html.includes('id="cropDialog"'),"Preview opens the existing dialog");
  console.log("Cropped-label tests passed: unique per-sticker images, correct position, no changes to totals.");
})().catch(err=>{console.error(err);process.exitCode=1});

const summaryHtml=fs.readFileSync("index.html","utf8");
const summaryStart=summaryHtml.indexOf('<section class="panel summary-panel"');
const summaryEnd=summaryHtml.indexOf('</aside>',summaryStart);
assert.ok(summaryStart>=0 && summaryEnd>summaryStart,"Recipe summary panel must exist");
const summaryMarkup=summaryHtml.slice(summaryStart,summaryEnd);
assert.match(summaryMarkup,/Recipe Issue \(Subcontract PO\)/);
assert.match(summaryMarkup,/Recipe GRN \(Bundling\)/);
for(const id of ["issueTotal","mincedTotal","bonelessTotal","wasteTotal"]){
  assert.match(summaryMarkup,new RegExp('id="'+id+'"'),id+" displayed");
}
for(const former of ["normalIssueTotal","boneIssueTotal","boneBatchContainer","verifiedTotal","boneBatchSummary"]){
  assert.equal(summaryMarkup.includes(former),false,"Do not display intermediate breakdown "+former);
}
assert.equal((summaryMarkup.match(/class="recipe-summary-line/g)||[]).length,4);
assert.equal(summaryMarkup.includes('Pakistani Beef With Bone'),true);
assert.equal(summaryMarkup.includes('Pakistani Beef Minced'),true);
assert.equal(summaryMarkup.includes('Pakistani Beef Without Bone'),true);
assert.equal(summaryMarkup.includes('Wastage For Meat'),true);
console.log("Simple Recipe Issue / GRN preview test passed: exactly four rows, no intermediate totals.");

// The scan overlay must follow real BarcodeDetector regions, not invent them.
const overlayGeometry=scanTargetPercent(
  {barcode:"9667807018006",x:200,y:400,w:100,h:40},
  {width:1000,height:1000}
);
assert.ok(overlayGeometry.left>=19&&overlayGeometry.left<=21);
assert.ok(overlayGeometry.top>=39&&overlayGeometry.top<=41);
assert.ok(overlayGeometry.width>=10&&overlayGeometry.width<=12);
assert.ok(overlayGeometry.height>=4&&overlayGeometry.height<=6);
const photoRegions=[
  {barcode:"9667807018006",x:200,y:400,w:100,h:40},
  {barcode:"9667818036457",x:200,y:650,w:100,h:40}
];
beginScanStage({name:"two-sticker-sheet.jpg"},1,1);
assert.equal(getId("scanStage").hidden,false);
assert.equal(getId("scanStageFile").textContent,"two-sticker-sheet.jpg");
setScanTargets(photoRegions,{width:1000,height:1000});
assert.equal(getId("scanStageMarkers").children.length,2);
assert.equal(getId("scanStageMarkers").children[0].className,"scan-stage-target is-waiting");
setScanTargetState(0,"active");
assert.equal(getId("scanStageMarkers").children[0].className,"scan-stage-target is-active");
setScanTargetState(0,"verified",photoRegions[0].barcode);
setScanTargetState(1,"review",photoRegions[1].barcode);
assert.equal(getId("scanStageProgress").textContent,"2 / 2 checked");
finishScanStage("Review completed",true);
assert.equal(getId("scanStageProgress").textContent,"1 verified · 1 review");
scanStageHide();
assert.equal(getId("scanStage").hidden,true);
assert.equal(getId("scanStageMarkers").children.length,0);
const scanMarkup=fs.readFileSync("index.html","utf8");
assert.ok(scanMarkup.includes('id="scanStage"'));
assert.ok(scanMarkup.includes('id="scanStageMarkers"'));
assert.ok(scanMarkup.includes('id="scanStageSweep"'));
const photoScanStart=source.indexOf("async function scanPhotos(){");
const photoScanEnd=source.indexOf("\nfunction td(",photoScanStart);
assert.ok(photoScanStart>=0&&photoScanEnd>photoScanStart);
const photoScanBody=source.slice(photoScanStart,photoScanEnd);
assert.match(photoScanBody,/scanStageHide\(\);\s*if\(photos\.length\)void scanPhotos\(\);/,
  "Completed scan must hide the green mask before processing newly queued photos");
console.log("Completed-scan UI test passed: overlay automatically hidden after processing.");

const scanCss=fs.readFileSync("scanner.css","utf8");
assert.match(scanCss,/@keyframes scan-barcode-sweep/);
assert.match(scanCss,/@media\(prefers-reduced-motion:reduce\)/);
console.log("Scan mask tests passed: real barcode coordinates, verified/review masks, and reset.");
console.log("Scanner validation tests passed: verified EAN, internal price digit, rounding, label consistency, and product constraints.");
