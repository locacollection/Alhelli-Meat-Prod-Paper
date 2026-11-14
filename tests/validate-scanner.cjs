const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync("scanner.js","utf8");

class FakeElement {
  constructor(){this.value="";this.className="";this.textContent="";this.disabled=false;this.children=[];this.dataset={};this.classList={toggle(){},add(){},remove(){}}}
  replaceChildren(...v){this.children=v}
  append(...v){this.children.push(...v)}
  addEventListener(){}
  querySelector(){return new FakeElement()}
  setAttribute(){}
}
const elements = new Map();
const getId=id=>{if(!elements.has(id))elements.set(id,new FakeElement());return elements.get(id)};
const doc = {
  getElementById:getId,
  createElement:()=>new FakeElement(),
  querySelector:(q)=>q.includes("materialMode")?{value:"no-bones",checked:true}:new FakeElement(),
  querySelectorAll:()=>[]
};
const store = new Map();
const sandbox = {
  document:doc,window:{},
  localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},
  console,Date,confirm:()=>true
};
vm.runInNewContext(source,sandbox,{filename:"scanner.js",timeout:2000});
const {decode,priceVerifier,checkDigit,roundedPrice,fixed3,verify,readUniqueDecimal,ocrFields,shouldAutoConfirm,encodeFromPrinted,fillCatalogUnit,catalogFromBarcode,fromBarcode,matchPrintedOCR,addLabel,totals,paperState,preparePaper}=sandbox.window.MeatProductionChecks;
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
assert.equal(verify({barcode:"9667770031903",weight:"1.000",unit:"3.190",printed:"3.190"}).ok,false);

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
assert.equal(ocrConflict.confirmed,false);
assert.match(ocrConflict.ocrConflict,/printed/);
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
console.log("A4 store-form print tests passed: 6777 issue, 6780/6781 GRN, no individual sticker rows.");
console.log("Barcode-first scanner checks passed: catalog 0.400 + 0.810 kg, OCR optional, GRN/issue 1.210 kg.");
console.log("Scanner validation tests passed: verified EAN, internal price digit, rounding, label consistency, and product constraints.");
