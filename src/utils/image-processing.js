export async function compressImageFile(file, {
  maxSide,
  outputType = "image/webp",
  outputExtension = ".webp",
  outputQuality = 0.84,
} = {}) {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const ratio = Math.min(1, Number(maxSide || 0) / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const width = Math.max(1, Math.round((image.naturalWidth || 1) * ratio));
  const height = Math.max(1, Math.round((image.naturalHeight || 1) * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);
  const blob = await canvasToBlob(canvas, outputType, outputQuality);
  return new File([blob], replaceExtension(file.name || `image-${Date.now()}`, outputExtension), {
    type: outputType,
  });
}

export function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not process image."));
    }, type, quality);
  });
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load image."));
    image.src = src;
  });
}

function replaceExtension(name, extension) {
  const safeName = String(name || "image").replace(/\.[^.]+$/, "");
  return `${safeName}${extension}`;
}
