// Run the ocr-worker logic in Node on a PNG (decoded to gray via sharp-less path: use pngjs-free approach by python pre-step)
const fs = require('fs');
const TesseractCore = require('/home/user/cjtest/aud/tesseract/tesseract-core-simd.wasm.js');
(async () => {
  const [grayPath, w, h] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])];
  const M = await TesseractCore({});
  M.FS.mkdir('/tessdata');
  M.FS.writeFile('/tessdata/eng.traineddata', fs.readFileSync('/home/user/audiveris/tessdata/eng.traineddata'));
  const api = new M.TessBaseAPI();
  console.log('init', api.Init('/tessdata', 'eng', 0));
  const gray = fs.readFileSync(grayPath);
  const ptr = M._malloc(w * h); M.HEAPU8.set(gray, ptr);
  api.SetImage(ptr, w, h, 1, w); api.SetSourceResolution(70); api.SetPageSegMode(3);
  const t0 = Date.now(); M.destroy(api.AnalyseLayout()); console.log('recognize', api.Recognize(null), Date.now() - t0, 'ms');
  const it = api.GetIterator(); let n = 0, skipped = 0, words = [];
  let next;
  do {
    next = 4;
    if (it.Empty(4)) continue;
    if (it.IsAtBeginningOf(3)) {
      const f = it.getWordFontAttributes();
      if (!f.font_name) { skipped++; next = 3; continue; }
      words.push(it.GetUTF8Text(3) + (f.is_italic ? '/i' : '') + '@' + f.pointsize); n++;
    }
  } while (it.Next(next));
  console.log('words', n, 'skipped(no font)', skipped);
  console.log(words.join(' '));
})();
