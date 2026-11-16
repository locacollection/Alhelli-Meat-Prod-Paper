const assert=require("node:assert/strict");
const photo=require("../barcode-learning-scan.js");
const labels=require("../barcode-learning-labels.js");
let crops=0,recognitions=0,updates=0;
global.document={
  createElement(tag){
    if(tag!=="canvas")throw new Error("Unexpected element "+tag);
    const canvas={width:0,height:0};
    const context={
      imageSmoothingEnabled:false,
      drawImage(){crops++},
      getImageData(x,y,width,height){
        const data=new Uint8ClampedArray(width*height*4);
        for(let i=0;i<data.length;i+=4){
          data[i]=data[i+1]=data[i+2]=210;data[i+3]=255;
        }
        return {data,width,height};
      },
      putImageData(image){assert.ok(image.data.length>0)}
    };
    canvas.getContext=()=>context;
    return canvas;
  }
};
(async()=>{
  const readings=["0.460","0.460","2.100","2.100","0.965","0.965"];
  const worker={
    async setParameters(opts){
      updates++;
      assert.ok(["7","13","3"].includes(opts.tessedit_pageseg_mode));
    },
    async recognize(){
      const text=readings[recognitions++]||"";
      return {data:{text}};
    }
  };
  const canvas={width:630,height:390};
  const anchor={x:80,y:210,w:170,h:18};
  const got=await photo.readNumberBoxes(worker,canvas,anchor,labels,()=>{},{});
  assert.deepEqual(got.values,{weight:460,unit:2100,total:965});
  assert.equal(recognitions,6);
  assert.equal(updates,9);
  assert.ok(crops>=9);
  const filled=labels.supplementPrinted({
    weight_grams:null,unit_price_fils:null,total_price_fils:null,
    read_from_photo:{weight:false,unit:false,total:false}
  },got.values);
  assert.equal(filled.weight_grams,460);
  assert.equal(filled.unit_price_fils,2100);
  assert.equal(filled.total_price_fils,965);
  // Reproduction of 7144 bone label: weight visibly 0.200 kg, but old
  // OCR used to return "Not detected" despite correct barcode/total.
  let boneReads=0;
  const boneWorker={
    async setParameters(){},
    async recognize(){boneReads++;return {data:{text:"0.200"}}}
  };
  const bone=await photo.readNumberBoxes(boneWorker,canvas,anchor,labels,()=>{},{
    unit_price_fils:1000,total_price_fils:200
  });
  assert.equal(bone.values.weight,200,
    "Focused OCR must preserve 0.200 kg rather than erase readable number");
  assert.equal(boneReads,2);
  const corrected=labels.supplementPrinted({
    weight_grams:20,unit_price_fils:1000,total_price_fils:200,
    read_from_photo:{weight:true,unit:true,total:true}
  },bone.values,{core:require("../barcode-learning-core.js")});
  assert.equal(corrected.weight_grams,200,
    "A correct focused 0.200 kg reading must win over mistaken whole-label OCR 0.020");
  assert.ok(corrected.ocr_conflicts.some(x=>x.includes("Confirm weight on photo")));
  console.log("Numeric cell OCR passed: isolated sticker fields, high-contrast upscaling, and missing-field recovery.");
})().catch(err=>{console.error(err);process.exitCode=1});
