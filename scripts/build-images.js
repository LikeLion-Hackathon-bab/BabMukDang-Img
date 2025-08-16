import sharp from "sharp";
import glob from "fast-glob";
import xxhash from "xxhashjs";
import fs from "fs/promises";
import path from "path";
import { rgbaToThumbHash, thumbHashToDataURL } from "thumbhash";

const SIZES = [160, 320, 480, 640]; // 필요시 확장
const OUT_DIR = "public/img";
const RAW_DIR = "assets/raw";

const h = (buf) => xxhash.h32(0xabcdef).update(buf).digest().toString(16);

function getFileBase(id, hash) {
  return `${id}.${hash}`; // cat_123.9a1f2 같은 형태를 원하면 `${id}.${hash}`
}

async function toAvifWebpVariants(inputBuf, width) {
  const base = sharp(inputBuf).resize({ width, withoutEnlargement: true });
  const [avif, webp] = await Promise.all([
    base.avif({ quality: 50 }).toBuffer(),
    base.webp({ quality: 70 }).toBuffer(),
  ]);
  return { avif, webp };
}

async function makeLQIPs(inputBuf) {
  // 아주 작은 32~48px 정사각으로 다운샘플
  const tiny = await sharp(inputBuf)
    .resize(64, 64, { fit: "cover" })
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });
  const { data, info } = tiny; // RGBA raw
  // ThumbHash는 RGBA → dataURL 생성
  const thDataURL = thumbHashToDataURL(
    rgbaToThumbHash(info.width, info.height, data)
  );
  return {
    thumbhashDataURL: thDataURL,
    aspectRatio: info.width / info.height,
  };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const files = await glob(`${RAW_DIR}/*.{jpg,jpeg,png}`, {
    caseSensitiveMatch: false,
  });
  const manifest = [];

  let idCounter = 0;
  for (const file of files) {
    idCounter++;
    const id = path.basename(file).replace(/\.(jpg|jpeg|png)$/i, "");
    const inputBuf = await fs.readFile(file);
    const baseHash = h(inputBuf).slice(0, 8);
    const fileBase = getFileBase(id || `cat_${idCounter}`, baseHash);

    const lqip = await makeLQIPs(inputBuf);

    // 사이즈별로 AVIF/WebP 생성
    const entries = [];
    for (const w of SIZES) {
      const { avif, webp } = await toAvifWebpVariants(inputBuf, w);
      const avifName = `${fileBase}.${w}.avif`;
      // const webpName = `${fileBase}.${w}.webp`;
      await Promise.all([
        fs.writeFile(path.join(OUT_DIR, avifName), avif),
        // fs.writeFile(path.join(OUT_DIR, webpName), webp),
      ]);
      entries.push({
        width: w,
        avif: `/img/${avifName}`,
        // webp: `/img/${webpName}`,
      });
    }

    // srcset과 기본 src(중간값)를 구성
    const mid = entries[Math.min(1, entries.length - 1)];
    manifest.push({
      id: id || `cat_${idCounter}`,
      name: id,
      aspectRatio: lqip.aspectRatio,
      placeholder: {
        thumbhashDataURL: lqip.thumbhashDataURL,
      },
      images: {
        avifSrcset: entries.map((e) => `${e.avif} ${e.width}w`).join(", "),
        // webpSrcset: entries.map((e) => `${e.webp} ${e.width}w`).join(", "),
        // 기본 src는 webp 320 같은 것
        src: entries.find((e) => e.width === 320)?.avif || entries[0].avif,
        // sizes: "(max-width: 480px) 33vw, (max-width: 1024px) 20vw, 160px",
      },
    });
  }

  await fs.writeFile(
    "public/categories.json",
    JSON.stringify(manifest, null, 2)
  );
  console.log(`Done. Wrote ${manifest.length} items.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
