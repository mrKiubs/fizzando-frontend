// vectorize-icons.mjs
// Standalone PNG -> clean monochrome SVG (Potrace + SVGO)
// Usage:
//   node vectorize-icons.mjs ./input_png ./output_svg [rename_map.json]
//
// Node >= 18
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import fg from "fast-glob";
import sharp from "sharp";
import * as potrace from "potrace"; // ✅ API corretta
import { optimize } from "svgo";

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error(
    "Usage: node vectorize-icons.mjs <src_png_dir> <out_svg_dir> [rename_map.json]"
  );
  process.exit(1);
}
const SRC_DIR = args[0];
const OUT_DIR = args[1];
const RENAME_MAP_FILE = args[2] || null;

const PREPROC = {
  grayscale: true,
  normalize: true,
  median: 3,
  blur: 0.5,
  threshold: 220,
};

// Opzioni supportate da potrace.trace(...)
const TRACE = {
  threshold: PREPROC.threshold,
  turdSize: 3,
  turnPolicy: potrace.Potrace.TURNPOLICY_MINORITY,
  optTolerance: 0.3,
  alphaMax: 1.0,
  blackOnWhite: false, // figura bianca su trasparente
  // color: '#ffffff',   // opzionale: colore iniziale (poi lo forziamo a currentColor)
  // background: '#000000'
};

const SVGO_CFG = {
  multipass: true,
  plugins: [
    "removeDoctype",
    "removeXMLProcInst",
    "removeComments",
    "removeMetadata",
    "removeUselessDefs",
    "removeEditorsNSData",
    "removeEmptyAttrs",
    "removeHiddenElems",
    "removeEmptyText",
    "removeEmptyContainers",
    { name: "convertShapeToPath", params: { convertArcs: true } },
    { name: "mergePaths", params: { force: true } },
    { name: "convertTransform", params: { removeUseless: true } },
  ],
};

const exists = async (p) => !!(await stat(p).catch(() => null));
const ensureDir = (d) => mkdir(d, { recursive: true });

const loadRenameMap = async (file) => {
  if (!file || !(await exists(file))) return {};
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return {};
  }
};

// Preprocess: binarizza per silhouette pulita
const preprocessToBuffer = async (pngPath) => {
  let img = sharp(pngPath).trim();
  img = PREPROC.grayscale ? img.grayscale() : img;
  img = PREPROC.normalize ? img.normalize() : img;
  if (PREPROC.median) img = img.median(PREPROC.median);
  if (PREPROC.blur) img = img.blur(PREPROC.blur);
  img = img.threshold(PREPROC.threshold, { grayscale: true });
  return img.png().toBuffer();
};

// ✅ API giusta: potrace.trace(buffer, options, cb)
const potraceToSVG = (pngBuffer) =>
  new Promise((resolve, reject) => {
    potrace.trace(pngBuffer, TRACE, (err, svg) => {
      if (err) return reject(err);
      resolve(svg);
    });
  });

// Pulisci/ottimizza e rendi tintabile (fill: currentColor)
const postProcessSVG = (svgText) => {
  let svg = svgText
    .replace(/fill="black"/g, 'fill="#ffffff"')
    .replace(/stroke="black"/g, 'stroke="#ffffff"')
    .replace(/fill="#000000"/g, 'fill="#ffffff"')
    .replace(/stroke="#000000"/g, 'stroke="#ffffff"');

  svg = optimize(svg, SVGO_CFG).data;

  svg = svg
    .replace(/fill="#ffffff"/g, 'fill="currentColor"')
    .replace(/stroke="#ffffff"/g, 'stroke="none"');

  // Assicura viewBox e rimuovi width/height fissi
  if (!/viewBox=/.test(svg)) {
    const mW = svg.match(/width="([\d.]+)"/);
    const mH = svg.match(/height="([\d.]+)"/);
    if (mW && mH) {
      const w = parseFloat(mW[1]);
      const h = parseFloat(mH[1]);
      svg = svg
        .replace(/<svg([^>]+)>/, `<svg$1 viewBox="0 0 ${w} ${h}">`)
        .replace(/(width|height)="[^"]*"/g, "");
    }
  } else {
    svg = svg.replace(/(width|height)="[^"]*"/g, "");
  }
  return svg;
};

(async () => {
  const renameMap = await loadRenameMap(RENAME_MAP_FILE);
  await ensureDir(OUT_DIR);

  const files = await fg(`${SRC_DIR}/**/*.png`, { onlyFiles: true });
  if (!files.length) {
    console.error(`No PNG files found in ${SRC_DIR}`);
    process.exit(1);
  }

  console.log(`Vectorizing ${files.length} PNG(s) → ${OUT_DIR}`);
  for (const png of files) {
    const base = basename(png, ".png");
    const outName = (renameMap[base] || base) + ".svg";
    const outPath = join(OUT_DIR, outName);
    try {
      const pre = await preprocessToBuffer(png);
      const svgRaw = await potraceToSVG(pre);
      const svg = postProcessSVG(svgRaw);
      await writeFile(outPath, svg, "utf8");
      console.log("✓", outName);
    } catch (e) {
      console.error("✗", png, e.message);
    }
  }
  console.log("Done.");
})();
